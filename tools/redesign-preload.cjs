'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module');
const root=fs.realpathSync(process.env.NEXUS_REDESIGN_FIXTURE||'');
if(!['4785','4786','4791'].includes(process.env.NEXUS_PORT)||!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep)||!path.basename(root).startsWith('nexus-redesign-'))throw Error('Unsafe fixture');
const sessions=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const load=Module._load;let created=0;
Module._load=function(name){if(name!=='@lydell/node-pty')return load.apply(this,arguments);return{spawn(file,args){
 let id=args.find(a=>sessions.some(s=>s.id===a)),s=sessions.find(s=>s.id===id);
 if(!s){if(args.includes('--resume')||args.includes('resume'))throw Error('Only fixture sessions may resume');id='fixture-new-'+(++created);s={id,kind:file==='claude.exe'?'claude':'astra',status:'saved',stream:[],model:args[args.indexOf(file==='claude.exe'?'--model':'-m')+1]};}
 fs.appendFileSync(path.join(root,'spawns.jsonl'),JSON.stringify({id,file,args})+'\n');
 let onData=()=>{},onExit=()=>{},pending='',ended=false;
 const idle='────────────────────────────────────\n❯ \n────────────────────────────────────\n? for shortcuts';
 const question=s.stream.findLast(i=>i.kind==='question');
 const paint=text=>onData('\x1b[2J\x1b[H'+text.replace(/\n/g,'\r\n'));
 setTimeout(()=>paint(s.status==='needs-you'&&question?'Do you want to proceed?\n'+question.question+'\n'+question.options.map((o,i)=>`${i===0?'❯':' '} ${i+1}. ${o.label}`).join('\n')+'\nEnter to confirm · Esc to cancel':s.status==='working'?(process.env.NEXUS_ROUND2==='1'?idle+'\nRunning tests...\nEsc to interrupt':'Running tests...\nEsc to interrupt'):idle),300);
 return{pid:process.pid,onData(f){onData=f},onExit(f){onExit=f},resize(){},kill(){ended=true;if(process.env.NEXUS_ROUND2==='1'&&s.kind==='claude'){try{fs.unlinkSync(path.join(root,'claude','sessions',s.id+'.json'));}catch{}}onExit({exitCode:0})},write(value){
  if(ended)throw Error('Ended fixture');
  fs.appendFileSync(path.join(root,'writes.jsonl'),JSON.stringify({id,value})+'\n');
  if(value.startsWith('\x1b[200~'))pending=value.slice(6,-6);
  if(value==='\r'){if(pending.startsWith('/model ')){s.model=pending.slice(7);pending='';paint('Set model to '+s.model+'\n'+idle);return;}if(pending&&s.file){const ts=new Date().toISOString(),records=s.kind==='claude'?[{type:'user',timestamp:ts,message:{content:pending}},{type:'assistant',timestamp:ts,message:{id:'fixture-reply-'+Date.now(),model:s.model,content:[{type:'text',text:'Fixture received: '+pending}],usage:{input_tokens:10,output_tokens:5}}}]:[{type:'response_item',timestamp:ts,payload:{type:'message',role:'user',content:[{type:'input_text',text:pending}]}}];const body=records.map(JSON.stringify).join('\n')+'\n';if(process.env.NEXUS_ROUND2==='1'&&pending==='Round two queued message')setTimeout(()=>fs.appendFileSync(s.file,body),3500);else fs.appendFileSync(s.file,body);pending='';}paint(idle);}
 }};
}};};
const terms=require('../terms');
// All stub children share this process PID; their explicit fixture keys are authoritative.
terms.linkSessions=()=>{};
for(const s of sessions.filter(s=>['working','needs-you'].includes(s.status))){
 terms.open({kind:s.kind,cwd:path.join(root,'work'),sessionKey:s.kind+':'+s.id,title:s.title,claudeArgs:['--resume',s.id],codexArgs:['resume',s.id]});
 if(s.kind==='claude')fs.writeFileSync(path.join(root,'claude','sessions',s.id+'.json'),JSON.stringify({sessionId:s.id,pid:process.pid,cwd:s.cwd,status:s.status==='working'?'busy':'waiting',statusUpdatedAt:Date.now(),bridgeSessionId:s.remote?'fixture':undefined}));
}
const child=require('child_process');child.spawn=child.exec=child.execFile=child.spawnSync=child.execFileSync=()=>{throw Error('External launches disabled by redesign fixture')};
