// Real curl requests against our isolated server. Tokens stay in TEMP, never the report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), {WebSocket}=require('ws');
if(process.env.NEXUS_PORT!=='4790')throw Error('Port 4790 required');
const dir=fs.readFileSync('docs/shots/tmp/polish-temp.txt','utf8').trim();
assert(path.resolve(dir).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()+path.sep));
const cfg=JSON.parse(fs.readFileSync('config.json','utf8'));
const remote={Host:cfg.remoteHost,'X-Forwarded-For':'100.64.0.7','Tailscale-User-Login':cfg.remoteUser};
const report=[];
function req(route,{method='GET',headers={},body}={}){
  const headerFile=path.join(dir,'curl-headers.txt');
  const args=['--silent','--show-error','--noproxy','*','--max-time','20','-D',headerFile,'-w','\n%{http_code}','-X',method,'http://127.0.0.1:4790'+route];
  for(const [key,value] of Object.entries(headers))args.push('-H',`${key}: ${value}`);
  if(body!==undefined)args.push('-H','Content-Type: application/json','--data-binary','@-');
  const r=spawnSync('curl.exe',args,{input:body===undefined?undefined:JSON.stringify(body),encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if(r.status!==0)throw Error(r.error?.message || r.stderr);
  const parts=r.stdout.split('\n'),status=Number(parts.pop()),text=parts.join('\n');let data;try{data=JSON.parse(text);}catch{}
  return {status,data,text,headers:fs.readFileSync(headerFile,'utf8')};
}
function check(value,label){assert(value,label);report.push('PASS '+label);}
const localPost=(route,body={})=>req(route,{method:'POST',headers:{'X-Nexus':'1'},body});
if(process.argv.includes('--after-restart')){
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'auth-restart.json'),'utf8'));
  check(req('/api/sessions',{headers:{...remote,Cookie:saved.cookie}}).status===401,'revocation persists after server restart');
  check(req('/api/devices').data.devices.every(d=>d.id!==saved.id),'revoked device remains absent on disk');
  const sessions=req('/api/sessions').data.sessions;
  check(sessions.find(s=>s.kind+':'+s.id===saved.key)?.insights.lastViewed>=saved.at,'shared seen checkpoint persists after restart');
}else{
  check(req('/api/sessions').status===200,'direct PC session access');
  check(req('/api/sessions',{headers:remote}).status===401,'tailnet identity alone cannot read sessions');
  check(req('/',{headers:remote}).status===302,'unpaired phone is sent to pairing');
  check(req('/pair.html',{headers:remote}).status===200,'owner identity can load pairing page');
  for(const file of ['/icon-maskable-512.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest','/favicon.ico'])check(req(file,{headers:remote}).status===200,'unpaired icon/manifest '+file);
  check(req('/api/sessions',{headers:{Host:cfg.remoteHost,'X-Forwarded-For':'100.64.0.7'}}).status===403,'missing identity rejected');
  check(req('/api/sessions',{headers:{...remote,'Tailscale-User-Login':'wrong@example.com'}}).status===403,'wrong identity rejected');
  check(req('/api/sessions',{headers:{...remote,Host:'foreign.example'}}).status===403,'wrong host rejected');
  check(req('/api/sessions',{headers:{Host:'127.0.0.1:4790','X-Forwarded-For':'100.64.0.7'}}).status===403,'forwarded localhost is never trusted as PC');
  check(req('/api/pair/new',{method:'POST',body:{}}).status===403,'code issuance requires action header');
  check(req('/api/pair',{method:'POST',headers:remote,body:{code:'ABCDEFGH'}}).status===403,'redemption requires action header');
  const code=localPost('/api/pair/new').data;
  check(code.expiresAt>Date.now() && code.expiresAt<=Date.now()+600000,'pairing code has ten-minute expiry');
  check(req('/api/pair',{method:'POST',headers:{...remote,'X-Nexus':'1'},body:{code:'BADCODE0'}}).status===400,'invalid pairing code rejected');
  const paired=req('/api/pair',{method:'POST',headers:{...remote,'X-Nexus':'1'},body:{code:code.code,name:'Polish test phone'}});
  check(paired.status===200,'one-time code pairs a phone');
  check(/HttpOnly; Secure; SameSite=Strict/i.test(paired.headers),'pairing cookie remains secure, HttpOnly and SameSite Strict');
  const cookie=paired.headers.match(/set-cookie:\s*([^;\r\n]+)/i)[1];
  check(req('/api/pair',{method:'POST',headers:{...remote,'X-Nexus':'1'},body:{code:code.code}}).status===400,'used code cannot be redeemed twice');
  const headers={...remote,Cookie:cookie,'X-Nexus':'1'};
  const sessions=req('/api/sessions',{headers}).data;
  check(sessions?.remote===true && sessions.sessions.length>0,'paired owner can read sessions, with remote capability metadata');
  check(req('/api/sessions',{headers:{...headers,'Tailscale-User-Login':'wrong@example.com'}}).status===403,'valid cookie never bypasses tailnet identity');
  check(req('/api/pair/new',{method:'POST',headers,body:{}}).status===403,'paired remote cannot issue pairing codes');
  check(req('/api/devices',{headers}).status===403,'paired remote cannot list devices');
  check(req('/api/devices/revoke',{method:'POST',headers,body:{id:'000000000000'}}).status===403,'paired remote cannot revoke devices');
  for(const action of ['quit','popout','resume','fork','new','new-astra','vscode','folder','open-brief'])check(req('/api/action',{method:'POST',headers,body:{action}}).status===403,'PC-only action rejected remotely: '+action);
  check(localPost('/api/action',{action:'check-focus',key:'none'}).status===400,'test mode refuses all model checks');
  const s=sessions.sessions[0],key=s.kind+':'+s.id,at=Date.now();
  check(req('/api/action',{method:'POST',headers,body:{action:'viewed',key,at}}).status===200,'phone can mark a successfully opened session seen');
  check(req('/api/sessions').data.sessions.find(s=>s.kind+':'+s.id===key).insights.lastViewed>=at,'PC observes phone checkpoint in shared state');
  const device=req('/api/devices').data.devices.find(d=>d.name==='Polish test phone');
  check(!!device && device.id.length===12,'PC gets device list without bearer tokens');
  check(req('/api/devices/revoke',{method:'POST',body:{id:device.id}}).status===403,'revocation requires action header');
  check(localPost('/api/devices/revoke',{id:''}).status===404,'empty revoke prefix cannot remove an arbitrary device');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-polish-terminal-'));
  let term,remoteSocket;
  const socket=(h,origin)=>new Promise(resolve=>{const ws=new WebSocket(`ws://127.0.0.1:4790/pty?id=${term}`,{headers:h,origin});const timeout=setTimeout(()=>{ws.terminate();resolve(null);},4000);ws.once('open',()=>{clearTimeout(timeout);resolve(ws);});ws.once('error',()=>{clearTimeout(timeout);resolve(null);});});
  try{
    term=localPost('/api/action',{action:'term-new',cwd:scratch}).data.result.term;
    check(!await socket(remote,'https://'+cfg.remoteHost),'unpaired WebSocket rejected');
    check(!await socket(headers,'https://foreign.example'),'foreign-origin WebSocket rejected');
    remoteSocket=await socket(headers,'https://'+cfg.remoteHost);check(!!remoteSocket,'paired owner WebSocket attaches only to scratch terminal');
    const closed=new Promise(resolve=>remoteSocket.once('close',()=>resolve(true)));
    check(localPost('/api/devices/revoke',{id:device.id}).status===200,'PC revokes device');
    check(await Promise.race([closed,new Promise(r=>setTimeout(()=>r(false),3000))]),'revocation immediately closes existing remote terminal socket');
    check(req('/api/sessions',{headers}).status===401,'revoked cookie immediately loses HTTP access');
    check(!await socket(headers,'https://'+cfg.remoteHost),'revoked cookie cannot reconnect to terminal');
  }finally{remoteSocket?.close();if(term)localPost('/api/action',{action:'term-close',term});}
  check(!req('/api/sessions').data.terms.some(t=>t.id===term),'scratch terminal closed');
  fs.writeFileSync(path.join(dir,'auth-restart.json'),JSON.stringify({cookie,id:device.id,key,at}));
}
console.log(report.join('\n'));
fs.appendFileSync('docs/shots/polish/auth-checks.txt',report.join('\n')+'\n');
