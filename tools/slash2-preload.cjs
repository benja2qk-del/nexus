'use strict';
// Isolated in-process PTYs: no CLI, shell, model, owner history, or paid API.
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module');
const root=fs.realpathSync(process.env.NEXUS_REDESIGN_FIXTURE||'');
if(!['4785','4786'].includes(process.env.NEXUS_PORT)||!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep)||!path.basename(root).startsWith('nexus-redesign-'))throw Error('Unsafe slash fixture');
const sessions=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),native=Module._load,log=row=>fs.appendFileSync(path.join(root,'writes.jsonl'),JSON.stringify(row)+'\n');
const agents=require('../agents');agents.publicStatus=agents.refresh=()=>({claude:{installed:process.env.NEXUS_SLASH_SINGLE!=='1'},astra:{installed:process.env.NEXUS_SLASH_SINGLE!=='1'},copilot:{installed:true}});agents.launch=(kind,args)=>({file:'fixture-'+kind,args});
const controls=new Map();
Module._load=function(name){if(name!=='@lydell/node-pty')return native.apply(this,arguments);return {spawn(file,args,options){
 if(!options.cwd.startsWith(root+path.sep))throw Error('Only fixture folders may launch');
 const s=sessions.find(s=>args.includes(s.id)),kind=file.slice(8);let onData=()=>{},onExit=()=>{},paste='',timer;
 const idle='\u276f \n? for shortcuts',paint=value=>onData('\x1b[2J\x1b[H'+value.replace(/\n/g,'\r\n'));
 const record=text=>{if(!s)return;const timestamp=new Date().toISOString(),row=kind==='claude'?{type:'user',timestamp,message:{content:text}}:kind==='astra'?{type:'response_item',timestamp,payload:{type:'message',role:'user',content:[{type:'input_text',text}]}}:{type:'user.message',timestamp,data:{content:text}};fs.appendFileSync(s.file,JSON.stringify(row)+'\n');};
 if(s)controls.set(s.kind+':'+s.id,{paint,exit:()=>onExit({exitCode:0}),idle});
 setTimeout(()=>paint(idle),25);
 return {pid:999999,onData:f=>onData=f,onExit:f=>onExit=f,resize(){},kill(){clearTimeout(timer);onExit({exitCode:0});},write(value){
  log({kind,key:s?.kind+':'+s?.id,value});
  if(value==='\x1b'){clearTimeout(timer);paint(idle);return;}
  if(value.startsWith('\x1b[200~')){paste=value.slice(6,-6);return;}
  if(value==='\r'){
   const text=paste;paste='';record(text);
   if(text==='/compact'){paint('Compacted conversation - freed 42K tokens\n'+idle);return;}
   if(text==='/help'||text==='/plan'){paint('Choose a mode\n1. Default\n2. Plan\nEnter to select · Esc to cancel');return;}
   if(text.startsWith('/')){paint('Command completed\n'+idle);return;}
   paint('Working...\nEsc to interrupt');timer=setTimeout(()=>paint('Finished fixture response\n'+idle),1800);
  }
 }};
 }};};
const terms=require('../terms');terms.linkSessions=()=>{};
for(const s of sessions)terms.open({kind:s.kind,cwd:s.cwd,sessionKey:s.kind+':'+s.id,title:s.title,claudeArgs:['--resume',s.id],codexArgs:['resume',s.id],copilotArgs:['--resume',s.id]});
const http=require('http'),create=http.createServer;
http.createServer=function(listener){return create.call(this,(req,res)=>{
 if(req.url.startsWith('/fixture/')){const u=new URL(req.url,'http://fixture'),target=controls.get(u.searchParams.get('key'));if(!target){res.writeHead(404);res.end();return;}
  const mode=u.searchParams.get('mode');if(mode==='closed')target.exit();else target.paint(mode==='busy'?'Working...\nEsc to interrupt':mode==='question'?'Do you want to proceed?\n1. Yes\n2. No\nEnter to confirm':mode==='menu'?'Select model\n1. Default\n2. Other\nEnter to select · Esc to cancel':target.idle);
  res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');return;
 }listener(req,res);
});};
const child=require('child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync'])child[key]=()=>{throw Error('Real processes and model calls are blocked in slash fixtures');};
