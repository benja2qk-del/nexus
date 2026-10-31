'use strict';
const fs=require('fs'),path=require('path'),Module=require('module');
const root=fs.realpathSync(process.env.NEXUS_THEMES_FIXTURE||'');
if(!['4791','4785','4786'].includes(process.env.NEXUS_PORT)||!root.startsWith(path.resolve('.local')+path.sep))throw Error('Unsafe themes fixture');
const native=Module._load;
Module._load=function(name,parent){
  if(name==='./agents'&&parent?.filename===path.resolve('terms.js'))return {...native.apply(this,arguments),launch:()=>({file:'fixture',args:[]})};
  if(name==='@lydell/node-pty')return {spawn(file,args,options){
    if(!options.cwd.startsWith(root+path.sep))throw Error('Only fixture terminals are allowed');
    let data=()=>{},exit=()=>{},text='';const screen='\u276f \n? for shortcuts';
    setTimeout(()=>data('\x1b[2J\x1b[H'+screen),20);
    return {pid:999999,onData:f=>data=f,onExit:f=>exit=f,kill:()=>exit({exitCode:0}),resize(){},write(v){text+=v;if(v==='\r'&&text.includes('/fork')){data('Forked from 11111111-1111-4111-8111-111111111111 as "nexus-fork" (44444444-4444-4444-8444-444444444444).\n'+screen);text='';}}};
  }};
  return native.apply(this,arguments);
};
const child=require('child_process');for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync'])child[method]=()=>{throw Error('Real processes and model calls are blocked in themes fixtures');};
