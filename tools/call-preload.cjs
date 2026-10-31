'use strict';
// Only fixture PTYs, local Whisper stub and hidden SAPI may launch.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module');
const root=fs.realpathSync(process.env.NEXUS_REDESIGN_FIXTURE||'');
if(!['4785','4786','4787','4788','4791'].includes(process.env.NEXUS_PORT)||!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep)||!path.basename(root).startsWith('nexus-redesign-')||process.env.CLAUDE_CONFIG_DIR!==path.join(root,'claude'))throw Error('Unsafe call fixture');
const sessions=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const load=Module._load;
const log=entry=>fs.appendFileSync(path.join(root,'call-log.jsonl'),JSON.stringify(entry)+'\n');
const idle='────────────────────────────────────\n❯ \n────────────────────────────────────\n? for shortcuts';
Module._load=function(name,parent){
 if(name==='./voice'&&parent?.filename===path.resolve('server.js')){const voice=load.apply(this,arguments);return {...voice,createVoiceService:()=>voice.createVoiceService({exe:process.execPath,prefix:[path.resolve('tools/voice-whisper-stub.cjs'),root],model:path.join(root,'stub-model'),tempRoot:path.join(root,'voice')})};}
 if(name!=='@lydell/node-pty')return load.apply(this,arguments);
 return {spawn(file,args){
  const s=sessions.find(s=>args.includes(s.id));if(!s)throw Error('Only known fixture sessions may open');
  log({type:'spawn',id:s.id,file,args});let onData=()=>{},onExit=()=>{},pasted='',question=false,ended=false,serial=0;
  const paint=text=>onData('\x1b[2J\x1b[H'+text.replace(/\n/g,'\r\n'));
  const append=record=>fs.appendFileSync(s.file,JSON.stringify({timestamp:new Date().toISOString(),...record})+'\n');
  const message=(role,text)=>append(s.kind==='claude'?{type:role,message:{content:role==='user'?text:[{type:'text',text}],model:s.model}}:{type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
  const tool=(name,input)=>{const id='call-'+Date.now()+Math.random();append(s.kind==='claude'?{type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}}:{type:'response_item',payload:{type:'function_call',call_id:id,name,arguments:JSON.stringify(input)}});append(s.kind==='claude'?{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:'Completed'}]}}:{type:'response_item',payload:{type:'function_call_output',call_id:id,output:'Completed'}});};
  setTimeout(()=>paint(idle),300);
  return {pid:process.pid,onData(f){onData=f;},onExit(f){onExit=f;},resize(){},kill(){ended=true;serial++;onExit({exitCode:0});},write(value){
    if(ended)throw Error('Fixture ended');log({type:'write',id:s.id,value});
    if(value==='\x1b'){serial++;question=false;paint(idle);return;}
    if(question){if(value==='\r'){question=false;message('assistant','Done. The sort order is fixed and the tests passed.\n\nFull details and code are saved in the conversation.');tool('Edit',{file_path:'SessionList.tsx',old_string:'previous',new_string:'updated'});tool('Edit',{file_path:'HomeView.tsx',old_string:'previous',new_string:'updated'});paint(idle);}return;}
    if(value.startsWith('\x1b[200~')){pasted=value.slice(6,-6);return;}
    if(value!=='\r'||!pasted)return;
    const text=pasted;pasted='';message('user',text);const ticket=++serial;paint('Running tests...\nEsc to interrupt');tool('Bash',{command:'npm test'});
    setTimeout(()=>{if(ended||ticket!==serial)return;if(/quick/i.test(text)&&!/question/i.test(text)){message('assistant','Ready. Your voice message arrived.');paint(idle);return;}question=true;paint('Should I update the snapshot, or fix the sort order first?\n❯ 1. Update the snapshot\n  2. Fix the sort order\n  3. Do both\nEnter to confirm · Esc to cancel');},/quick/i.test(text)?1800:28000);
  }};
 }};
};
require('../terms').linkSessions=()=>{};
const child=require('child_process'),spawn=child.spawn;
child.spawn=function(exe,args,options){const whisper=exe===process.execPath&&args[0]===path.resolve('tools/voice-whisper-stub.cjs'),sapi=exe==='powershell.exe'&&args.includes(path.resolve('tools/voice-tts.ps1'));if((!whisper&&!sapi)||!options?.windowsHide)throw Error('External launch refused by call fixture');return spawn.apply(this,arguments);};
for(const method of ['exec','execFile','spawnSync','execFileSync'])child[method]=()=>{throw Error('External launch refused by call fixture');};
