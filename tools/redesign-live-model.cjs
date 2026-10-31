'use strict';
// Explicit, single-turn acceptance check. Never part of npm test. All CLI state belongs to TEMP.
const fs=require('fs'),path=require('path'),os=require('os'),{spawn}=require('child_process'),net=require('net');
const {WebSocket}=require('ws'),{TerminalScreen}=require('../terminal-screen');
const stage=process.argv[2],pointer=path.join(os.tmpdir(),'nexus-redesign-model-pointer.json');
const base='http://127.0.0.1:4791',sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(url,body){const response=await fetch(base+url,body?{method:'POST',headers:{'Content-Type':'application/json','X-Nexus':'1'},body:JSON.stringify(body)}:{}),data=await response.json();if(!response.ok)throw Error(data.error);return data;}
async function screen(id){const display=new TerminalScreen(),ws=new WebSocket('ws://127.0.0.1:4791/pty?id='+encodeURIComponent(id),{origin:base});let raw='';ws.on('message',data=>{const m=JSON.parse(data);if(m.t==='o'){display.write(m.d);raw+=m.d;}});await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)});await sleep(500);ws.close();if(stage==='diagnose'){const record=JSON.parse(fs.readFileSync(pointer,'utf8'));fs.writeFileSync(path.join(record.root,'pty.txt'),raw);console.log({pending:display.pending,synchronized:display.synchronized,confirmedRaw:require('../models').confirmed(raw,'claude-haiku-5-5'),confirmedScreen:require('../models').confirmed(display.text(),'claude-haiku-5-5')});}return display.text();}
async function main(){
 if(stage==='start'){
  if(fs.existsSync(pointer))throw Error('Existing throwaway record: inspect it instead of starting another.');
  await new Promise((r,j)=>{const p=net.createServer();p.once('error',j);p.listen(4791,'127.0.0.1',()=>p.close(r));});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-redesign-live-model-')),work=path.join(root,'work'),cli=path.join(work,'claude-config');fs.mkdirSync(cli,{recursive:true});fs.mkdirSync(path.join(root,'codex'));
  const credentials=path.join(os.homedir(),'.claude','.credentials.json');if(fs.existsSync(credentials))fs.copyFileSync(credentials,path.join(cli,'.credentials.json'));
  // Only onboarding and identity metadata; no owner's hooks, projects, MCP servers or sessions.
  let owner={};try{owner=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.claude.json'),'utf8'))}catch{}
  fs.writeFileSync(path.join(cli,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,theme:'dark',oauthAccount:owner.oauthAccount,lastOnboardingVersion:owner.lastOnboardingVersion,projects:{[work]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}}));
  fs.writeFileSync(path.join(cli,'settings.json'),JSON.stringify({autoUpdatesChannel:'stable',permissions:{defaultMode:'default'},env:{CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1'}}));
  const log=fs.openSync(path.join(root,'server.log'),'a'),env={...process.env,NEXUS_PORT:'4791',NEXUS_TEST_TERMINALS:'1',NEXUS_CLAUDE_DIR:cli,NEXUS_CODEX_DIR:path.join(root,'codex'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_UPLOAD_DIR:path.join(root,'uploads'),NEXUS_NO_ACCOUNT_POLL:'1',LOCALAPPDATA:path.join(root,'local'),DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
  const server=spawn(process.execPath,['server.js'],{cwd:path.resolve('.'),env,detached:true,windowsHide:true,stdio:['ignore',log,log]});server.unref();const record={root,work,server:server.pid,paidTurnSent:false};fs.writeFileSync(pointer,JSON.stringify(record));
  for(let i=0;i<60;i++){try{await request('/api/sessions');break;}catch{await sleep(250);}}
  const opened=await request('/api/action',{action:'term-new',cwd:work,model:'claude-opus-5-5'});record.term=opened.result?.term||opened.term;fs.writeFileSync(pointer,JSON.stringify(record));await sleep(4000);console.log(JSON.stringify(record));console.log(await screen(record.term));return;
 }
 const record=JSON.parse(fs.readFileSync(pointer,'utf8'));if(!record.root.startsWith(path.join(os.tmpdir(),'nexus-redesign-live-model-')))throw Error('Invalid root');
 if(stage==='inspect'||stage==='diagnose'){console.log(await request('/api/term-state?term='+record.term));console.log(await screen(record.term));}
 else if(stage==='manual'){
  const visible=await screen(record.term);if(!/Make auto mode your default permission mode\?/.test(visible)||!/❯ Yes, set auto mode/.test(visible))throw Error('Expected only the throwaway onboarding menu.');
  const ws=new WebSocket('ws://127.0.0.1:4791/pty?id='+record.term,{origin:base});await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)});ws.send(JSON.stringify({t:'i',d:'\x1b[B'}));await sleep(300);ws.send(JSON.stringify({t:'i',d:'\r'}));await sleep(1200);ws.close();console.log(await screen(record.term));
 }
 else if(stage==='answer'){const state=await request('/api/term-state?term='+record.term);console.log(await request('/api/action',{action:'term-send',term:record.term,answer:process.argv[3],signature:state.prompt?.signature}));await sleep(1200);console.log(await screen(record.term));}
 else if(stage==='model'){console.log(await request('/api/action',{action:'term-model',term:record.term,model:process.argv[3]||'claude-haiku-5-5'}));console.log(await screen(record.term));}
 else if(stage==='send'){
  if(record.paidTurnSent)throw Error('The single paid turn has already been sent.');
  const list=await request('/api/sessions'),t=list.terms.find(t=>t.id===record.term);if(t?.model!=='claude-haiku-5-5')throw Error('Haiku switch is not confirmed.');
  record.paidTurnSent=true;fs.writeFileSync(pointer,JSON.stringify(record));console.log(await request('/api/action',{action:'term-send',term:record.term,text:'Reply with the word ok'}));
 }
 else if(stage==='verify'){
  const files=[];function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.jsonl'))files.push(f)}}walk(path.join(record.work,'claude-config','projects'));
  let replies=[];for(const file of files)for(const line of fs.readFileSync(file,'utf8').split('\n')){try{const r=JSON.parse(line);if(r.type==='assistant'&&r.message?.model&&r.message.model!=='<synthetic>')replies.push({model:r.message.model,text:r.message.content.filter(x=>x.type==='text').map(x=>x.text).join('')});}catch{}}
  console.log(JSON.stringify(replies));if(!replies.some(r=>r.model==='claude-haiku-5-5'&&r.text.trim().toLowerCase()==='ok'))throw Error('Haiku reply not yet verified.');record.verified=true;fs.writeFileSync(pointer,JSON.stringify(record));
 }
 else if(stage==='close'){if(record.term)await request('/api/action',{action:'term-close',term:record.term});await request('/api/action',{action:'quit'});const credential=path.join(record.work,'claude-config','.credentials.json');if(fs.existsSync(credential))fs.unlinkSync(credential);record.closed=true;fs.writeFileSync(pointer,JSON.stringify(record));console.log('Closed owned throwaway terminal and server; temporary credential copy removed.');}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
