'use strict';
const fs=require('fs'),path=require('path'),Module=require('module');
const root=fs.realpathSync(process.env.NEXUS_COPILOT_FIXTURE||'');
if(!['4785','4786'].includes(process.env.NEXUS_PORT)||!root.toLowerCase().startsWith(path.resolve('.local').toLowerCase()+path.sep))throw Error('Unsafe Copilot fixture');
const screens=require('./fixtures/copilot/screens.json'),native=Module._load;
const log=e=>fs.appendFileSync(path.join(root,'pty-log.jsonl'),JSON.stringify(e)+'\n');
require('child_process').spawn=()=>{throw Error('Real child/model calls are disabled in the Copilot tour');};
Module._load=function(name,parent,main){if(name!=='@lydell/node-pty')return native.apply(this,arguments);return {spawn(file,args,options){
 if(!path.resolve(options.cwd).toLowerCase().startsWith(root.toLowerCase()+path.sep))throw Error('Fixture cwd required');
 const at=args.indexOf('--resume')>=0?args.indexOf('--resume'):args.indexOf('--session-id');let id=args[at+1];if(!/^[0-9a-f-]{36}$/.test(id||''))throw Error('Fixture session id required');
 let dir=path.join(root,'copilot/session-state',id),filePath=path.join(dir,'events.jsonl');
 if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'workspace.yaml'),`id: ${id}\ncwd: ${JSON.stringify(options.cwd)}\nname: New Copilot fixture\n`);fs.writeFileSync(filePath,JSON.stringify({type:'session.start',timestamp:new Date().toISOString(),data:{sessionId:id,selectedModel:args[args.indexOf('--model')+1],context:{cwd:options.cwd}}})+'\n');}
 let data=()=>{},exit=()=>{},pasted='',question='trust',selected='1',ended=false;
 const append=(type,value)=>fs.appendFileSync(filePath,JSON.stringify({type,timestamp:new Date().toISOString(),data:value})+'\n');
 const paint=s=>data('\x1b[2J\x1b[H'+s.replace(/\r?\n/g,'\r\n'));
 log({type:'spawn',file,args});setTimeout(()=>paint(screens.trust),100);
 return {pid:process.pid,onData:f=>data=f,onExit:f=>exit=f,resize(){},kill(){ended=true;exit({exitCode:0});},write(v){if(ended)throw Error('Ended');log({type:'write',value:v});
  if(question){if(v==='\x1b[B'||v==='\x1b[A')throw Error('Tour explicitly accepts the current fixture option');if(v==='\r'){if(question==='trust'){question='';paint(screens.input);}else{question='';append('assistant.message',{model:'gpt-5.6-luna',content:'Your answer was received. The fixture preview is ready.'});append('assistant.turn_end',{});paint(screens.input);}return;}if(v==='\x1b'){question='';paint(screens.input);return;}throw Error('Unexpected text into a menu');}
  if(v.startsWith('\x1b[200~')){pasted=v.slice(6,-6);return;}if(v!=='\r')return;
  const text=pasted;pasted='';append('user.message',{content:text});append('assistant.turn_start',{});paint('Working...\nEsc to interrupt');
  setTimeout(()=>{if(text==='Show a question'){question='answer';paint(screens.trust.replace('Do you trust the files in this folder?','Do you want to run this command?'));}else{append('assistant.message',{model:'gpt-5.6-luna',content:'**Delivered through the shared send path.** The Copilot fixture received your message.'});append('assistant.turn_end',{});paint(screens.input);}},700);
 }};
}};};
