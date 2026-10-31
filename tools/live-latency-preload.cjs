'use strict';
// Replay the three ALREADY measured warm Haiku responses. This is a measured
// audio-path integration check, not another model call or a network SLA.
const fs=require('fs'),path=require('path'),Module=require('module'),child=require('child_process'),realSpawn=child.spawn;
if(process.env.NEXUS_PORT!=='4785')throw Error('Latency replay requires port 4785');
const install=JSON.parse(process.env.NEXUS_LIVE_WHISPER),root=process.env.NEXUS_REDESIGN_FIXTURE;
if(path.basename(install.exe)!=='whisper-cli.exe'||path.basename(install.model)!=='ggml-base.bin')throw Error('Known local Whisper only');
require('./live-preload.cjs');
const guarded=child.spawn;child.spawn=function(exe,args,options){if(exe===install.exe&&options?.windowsHide&&args.includes(install.model))return realSpawn.apply(this,arguments);return guarded.apply(this,arguments);};
const realVoice=require('../voice'),recorded=JSON.parse(fs.readFileSync(path.resolve('.local/live-benchmark/results.json'),'utf8')).backends.find(b=>b.kind==='claude').turns.slice(1),load=Module._load;
if(recorded.length!==3)throw Error('Run the bounded subscription benchmark first');
Module._load=function(name,parent){
  if(name==='./voice'&&parent?.filename===path.resolve('server.js'))return {...realVoice,createVoiceService:()=>realVoice.createVoiceService({...install,tempRoot:path.join(root,'real-audio')})};
  if(name==='./live-brain'&&parent?.filename===path.resolve('live-service.js'))return {async createBrain(){let at=0;return {kind:'replay',model:'recorded-warm-haiku',close:async()=>{},async ask(input,delta){const turn=recorded[at++%recorded.length];await new Promise(r=>setTimeout(r,turn.ttftMs));delta(turn.text.slice(0,8));await new Promise(r=>setTimeout(r,Math.max(0,turn.totalMs-turn.ttftMs)));delta(turn.text.slice(8));return turn;}};}};
  return load.apply(this,arguments);
};
