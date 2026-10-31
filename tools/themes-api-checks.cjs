'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
fs.mkdirSync('.local',{recursive:true});const root=fs.mkdtempSync(path.resolve('.local/themes-api-'));
const cwd=path.join(root,'launcher'),repo=path.join(root,'alpha-repo');for(const p of [cwd,repo])fs.mkdirSync(path.join(p,'.git'),{recursive:true});
const claude=path.join(root,'claude','projects','fixture'),codex=path.join(root,'codex','sessions'),copilot=path.join(root,'copilot','session-state');for(const p of [claude,codex,copilot])fs.mkdirSync(p,{recursive:true});
const ts=new Date().toISOString(),write=(file,rows)=>fs.writeFileSync(file,rows.map(r=>JSON.stringify({timestamp:ts,...r})).join('\n')+'\n');
const user={type:'user',cwd,message:{content:'Fix the alpha repo parser and verify the release checks. '.repeat(5)}};
const edit={type:'assistant',cwd,message:{content:[{type:'tool_use',id:'x',name:'Edit',input:{file_path:path.join(repo,'parser.js'),old_string:'before',new_string:'after'}}]}};
write(path.join(claude,'parent.jsonl'),[user,edit,{type:'continued-in',continuedInSessionId:'continued'}]);
write(path.join(claude,'continued.jsonl'),[user,edit]);write(path.join(claude,'unsorted.jsonl'),[{...user,cwd:require('os').homedir(),message:{content:user.message.content.repeat(2)}}]);
write(path.join(codex,'rollout-fixture.jsonl'),[{type:'session_meta',payload:{id:'astra-fixture',cwd}},{type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'x',arguments:JSON.stringify({cmd:'pwd',workdir:repo})}}]);
const cpId='11111111-1111-4111-8111-111111111111',cp=path.join(copilot,cpId);fs.mkdirSync(cp);fs.writeFileSync(path.join(cp,'workspace.yaml'),'id: '+cpId+'\ncwd: '+JSON.stringify(cwd)+'\nname: Alpha repo Copilot\n');write(path.join(cp,'events.jsonl'),[{type:'session.start',data:{sessionId:cpId,context:{cwd}}},{type:'tool.execution_start',data:{toolName:'edit',toolCallId:'edit',arguments:{path:path.join(repo,'cp.js')}}}]);
const config={remoteHost:'themes.example.test',remoteUser:'owner@example.test'};fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
const port=process.env.NEXUS_TEST_PORT||'4791';
const env={...process.env,NEXUS_PORT:port,NEXUS_THEMES_FIXTURE:root,NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_READ_ONLY:'0',NEXUS_CLAUDE_DIR:path.join(root,'claude'),NEXUS_CODEX_DIR:path.join(root,'codex'),NEXUS_COPILOT_DIR:path.join(root,'copilot'),NEXUS_STATE_FILE:path.join(root,'state','state.json'),NEXUS_THEMES_FILE:path.join(root,'state','themes.json'),NEXUS_CONFIG_FILE:path.join(root,'config.json'),NEXUS_DEVICES_FILE:path.join(root,'state','devices.json')};
const base='http://127.0.0.1:'+port,local={'X-Nexus':'1','Content-Type':'application/json'},remote={...local,'X-Forwarded-Host':config.remoteHost,'Tailscale-User-Login':config.remoteUser};
let server;
async function start(){server=spawn(process.execPath,['--require','./tools/themes-test-preload.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let err='';server.stderr.on('data',d=>err+=d);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Startup timeout '+err)),15000);server.once('exit',c=>{clearTimeout(t);reject(Error('Server exited '+c+' '+err));});server.stdout.on('data',d=>{if(String(d).includes(port+'/')){clearTimeout(t);resolve();}});});}
async function stop(){if(server){server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));server=null;}}
async function json(route,body,headers=local){const res=await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();return {status:res.status,...data};}
async function main(){try{
  await start();let result=await json('/api/sessions');assert.equal(result.status,200);assert.equal(result.sessions.length,4);assert.ok(result.sessions.every(s=>s.mainFolder&&s.workFolders&&s.theme));
  assert.ok(result.sessions.some(s=>s.workFoldersPartial),'initial response publishes the available launch-folder answer');
  for(let i=0;i<200;i++){const c=await json('/api/themes');if(!c.workScan.pending)break;await new Promise(r=>setTimeout(r,5));}
  result=await json('/api/sessions');assert.ok(result.sessions.every(s=>!s.workFoldersPartial),'background evidence becomes visible on refresh');
  const cont=result.sessions.find(s=>s.id==='continued');assert.deepEqual(cont.parent,{key:'claude:parent',relation:'continuation'});assert.equal(cont.theme.name,'Alpha Repo');assert.ok(cont.searchText.includes('parser.js'));
  let catalog=await json('/api/themes');assert.equal(catalog.counts.total,4);assert.equal(catalog.unsorted.length,1);assert.equal(catalog.unsorted[0].suggestions[0].themeId,cont.theme.id);
  assert.equal((await json('/api/themes',{op:'create',name:'Denied'},{})).status,403);assert.equal((await json('/api/themes',{op:'create',name:'Denied'},{...local,Origin:'https://evil.example'})).status,403);
  assert.equal((await json('/api/themes',undefined,remote)).status,401);assert.equal((await json('/api/themes',{op:'create',name:'Denied'},remote)).status,401);
  const pairing=await json('/api/pair/new',{});const paired=await fetch(base+'/api/pair',{method:'POST',headers:remote,body:JSON.stringify({code:pairing.code,name:'Themes fixture phone'})});assert.equal(paired.status,200);const phone={...remote,Cookie:paired.headers.get('set-cookie').split(';')[0],Origin:'https://'+config.remoteHost};
  assert.equal((await json('/api/themes',undefined,phone)).status,200);
  const created=await json('/api/themes',{op:'create',name:'Phone Theme',color:'#123456'},phone);assert.equal(created.status,200);const id=created.result.id;
  const assigned=await json('/api/themes/assign',{keys:['claude:parent','astra:astra-fixture'],themeId:id},phone);assert.equal(assigned.result.assigned,2);
  result=await json('/api/sessions');assert.equal(result.sessions.find(s=>s.id==='continued').theme.id,id);assert.equal(result.sessions.find(s=>s.id==='continued').theme.source,'owner');
  assert.equal((await json('/api/themes/assign',{keys:['claude:continued','no-such-key'],themeId:null})).status,400);assert.equal((await json('/api/sessions')).sessions.find(s=>s.id==='continued').theme.id,id,'batch failure is atomic');
  const accepted=await json('/api/themes/accept',{keys:['claude:unsorted']},phone);assert.equal(accepted.result.assigned,1);
  assert.equal((await json('/api/themes',{op:'rename',id,name:'Phone Renamed'},phone)).status,200);assert.equal((await json('/api/themes',{op:'archive',id,archived:true},phone)).status,200);
  // No real CLI is started: the preload intercepts every PTY/process boundary.
  const fork=await json('/api/action',{action:'term-fork',key:'claude:continued'});assert.equal(fork.status,200);let saved=JSON.parse(fs.readFileSync(env.NEXUS_THEMES_FILE));assert.ok(Object.entries(saved.parents).some(([k,p])=>k.startsWith('claude:')&&p.key==='claude:continued'&&p.relation==='fork'));
  const resumed=await json('/api/action',{action:'term-resume',key:'copilot:'+cpId});assert.equal(resumed.status,200);await new Promise(r=>setTimeout(r,750));const cpFork=await json('/api/action',{action:'term-fork-copilot',key:'copilot:'+cpId});assert.equal(cpFork.status,200,JSON.stringify(cpFork));saved=JSON.parse(fs.readFileSync(env.NEXUS_THEMES_FILE));assert.deepEqual(saved.parents[cpFork.result.key],{key:'copilot:'+cpId,relation:'fork'});
  assert.ok(fs.existsSync(path.join(root,'state','work-folders-cache.json')),'the server checkpoints the completed work scan beside scratch state');
  await stop();await start();catalog=await json('/api/themes');assert.equal(catalog.themes.find(t=>t.id===id).name,'Phone Renamed');assert.equal(catalog.themes.find(t=>t.id===id).archived,true);assert.equal((await json('/api/sessions')).sessions.find(s=>s.id==='continued').theme.id,id);
  for(let i=0;i<200&&catalog.workScan.pending;i++){await new Promise(r=>setTimeout(r,5));catalog=await json('/api/themes');}
  assert.equal(catalog.workScan.pending,0);assert.equal(catalog.workScan.bytesRead,0,'server restart uses the durable transcript cache without rescanning');
  const devices=await json('/api/devices');await json('/api/devices/revoke',{id:devices.devices[0].id});assert.equal((await json('/api/themes/accept',{keys:['claude:unsorted']},phone)).status,401);
  console.log('PASS themes HTTP: all agents, canonical continuations, paired-phone CRUD/assign/accept, auth/origin/revocation, atomic batches, stubbed Claude/Copilot forks and restart persistence');
}finally{await stop();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
