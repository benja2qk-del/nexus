'use strict';
// Real CLIs, new sessions only, isolated state and local non-model provider.
// Never loads credentials or resumes an owner's session. Not part of npm test.
const fs=require('fs'),path=require('path'),net=require('net'),{spawn,execFileSync}=require('child_process'),assert=require('assert/strict');
const {WebSocket}=require('ws'),{TerminalScreen}=require('../terminal-screen');
const pointer=path.resolve('.local/slash-live-pointer.json'),base='http://127.0.0.1:4786',sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(url,body){const r=await fetch(base+url,body?{method:'POST',headers:{'content-type':'application/json','x-nexus':'1'},body:JSON.stringify(body)}:{}),data=await r.json();if(!r.ok)throw Error(data.error);return data;}
async function terminal(id,input){const screen=new TerminalScreen(120,36),ws=new WebSocket(base.replace('http','ws')+'/pty?id='+id,{origin:base});ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='o')screen.write(m.d);});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});await sleep(700);if(input){ws.send(JSON.stringify({t:'i',d:input}));await sleep(1600);}ws.close();return screen.text();}
async function main(){
 const stage=process.argv[2];
 if(stage==='start'){
  await new Promise((r,j)=>{const s=net.createServer();s.once('error',j);s.listen(4786,'127.0.0.1',()=>s.close(r));});
  const root=fs.mkdtempSync(path.resolve('.local/slash-live-')),work=path.join(root,'work');fs.mkdirSync(work);
  execFileSync('git',['init',work],{windowsHide:true,stdio:'ignore'});
  for(const name of ['claude','astra','copilot','local'])fs.mkdirSync(path.join(root,name));
  fs.writeFileSync(path.join(root,'claude','.claude.json'),JSON.stringify({hasCompletedOnboarding:true,lastOnboardingVersion:'2.1.311',theme:'dark',projects:{[work]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}}));
  fs.writeFileSync(path.join(root,'claude','settings.json'),JSON.stringify({permissions:{defaultMode:'default'},autoUpdatesChannel:'stable'}));
  fs.writeFileSync(path.join(root,'astra','config.toml'),`model = "gpt-6-luna"\nmodel_provider = "local_check"\ncheck_for_update_on_startup = false\n[model_providers.local_check]\nname = "Local check - no inference"\nbase_url = "${base}/local-provider/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[projects.${JSON.stringify(work.replaceAll('\\','/'))}]\ntrust_level = "trusted"\n`);
  const env={...process.env};for(const name of Object.keys(env))if(/TOKEN|API_KEY|CREDENTIAL|SECRET|^CLAUDE|^CODEX|^COPILOT|^ANTHROPIC|^OPENAI/i.test(name))delete env[name];
  Object.assign(env,{NEXUS_PORT:'4786',NEXUS_SLASH_LIVE:root,NEXUS_CLAUDE_DIR:path.join(root,'claude'),NEXUS_CODEX_DIR:path.join(root,'astra'),NEXUS_COPILOT_DIR:path.join(root,'copilot'),CLAUDE_CONFIG_DIR:path.join(root,'claude'),CODEX_HOME:path.join(root,'astra'),COPILOT_HOME:path.join(root,'copilot'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_UPLOAD_DIR:path.join(root,'uploads'),NEXUS_NO_ACCOUNT_POLL:'1',LOCALAPPDATA:path.join(root,'local'),DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_API_KEY:'nexus-local-check',ANTHROPIC_BASE_URL:base+'/local-provider',COPILOT_PROVIDER_BASE_URL:base+'/local-provider/v1',COPILOT_PROVIDER_WIRE_API:'responses',COPILOT_MODEL:'gpt-6-luna',USE_TGREP:'false'});
  const log=fs.openSync(path.join(root,'server.log'),'a'),p=spawn(process.execPath,['--require',path.resolve('tools/slash-live-preload.cjs'),'server.js'],{cwd:process.cwd(),env,detached:true,windowsHide:true,stdio:['ignore',log,log]});p.unref();fs.closeSync(log);
  const record={root,work,pid:p.pid,terms:{}};fs.writeFileSync(pointer,JSON.stringify(record));
  for(let i=0;i<80;i++){try{await request('/api/sessions');break;}catch{await sleep(150);}}
  for(const kind of ['claude','astra','copilot']){record.terms[kind]=(await request('/api/action',{action:kind==='claude'?'term-new':'term-new-'+kind,cwd:work})).result.term;fs.writeFileSync(pointer,JSON.stringify(record));}
  await sleep(8000);for(const [kind,id]of Object.entries(record.terms)){const text=await terminal(id);fs.writeFileSync(path.join(root,kind+'-startup.txt'),text);console.log(kind+'\n'+text);}
  return;
 }
 const record=JSON.parse(fs.readFileSync(pointer));assert(record.root.startsWith(path.resolve('.local')+path.sep));
 const kind=process.argv[3],id=record.terms[kind];
 if(stage==='inspect'){console.log(await request('/api/term-state?term='+id));console.log(await terminal(id));}
 else if(stage==='restart-onboarding'){await request('/api/action',{action:'term-close',term:id});record.terms[kind]=(await request('/api/action',{action:kind==='claude'?'term-new':'term-new-'+kind,cwd:record.work})).result.term;fs.writeFileSync(pointer,JSON.stringify(record));await sleep(4000);console.log(await terminal(record.terms[kind]));}
 else if(stage==='onboard'){
  // Every interaction is gated on the actual screen of this owned, isolated PTY.
  for(let i=0;i<7;i++){
   const visible=await terminal(id);let input;
   if(/Make auto mode your default permission mode/.test(visible))input='\x1b[B\r';
   else if(/Detected a custom API key/.test(visible))input='\x1b[A\r';
   else if(/Accessing workspace:/.test(visible)&&visible.includes(record.work)&&/Yes, I trust this folder/.test(visible))input='\x1b[B\r';
   else if(/Do you trust the contents of this directory/.test(visible)&&visible.includes(record.work)&&!visible.includes('Trusting will apply to the repository root'))input='\r';
   else if(/Set up the Codex agent sandbox/.test(visible))input='\x1b';
   else if(/Confirm folder trust/.test(visible)&&visible.includes(record.work))input='\r';
   else {console.log(visible);break;}
   await terminal(id,input);
  }
  console.log(await request('/api/term-state?term='+id));
 }
 else if(stage==='send'){
  const text=process.argv[4];assert(['/status','/version','/help','/context','/env','/','/permissions'].includes(text),'Read-only local commands only');
  console.log(await request('/api/action',{action:'term-send',term:id,text,commandId:require('crypto').randomUUID()}));await sleep(1800);const screen=await terminal(id);fs.writeFileSync(path.join(record.root,kind+'-'+text.slice(1)+'.txt'),screen);console.log(await request('/api/term-state?term='+id));console.log(screen);
 }else if(stage==='key'){
  const input={esc:'\x1b',enter:'\r',down:'\x1b[B',up:'\x1b[A',tab:'\t',one:'1',two:'2'}[process.argv[4]];assert(input);console.log(await terminal(id,input));
 }else if(stage==='close'){
  for(const id of Object.values(record.terms))await request('/api/action',{action:'term-close',term:id});await request('/api/action',{action:'quit'});record.closed=true;fs.writeFileSync(pointer,JSON.stringify(record));console.log('Closed only the owned slash-check terminals and server.');
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
