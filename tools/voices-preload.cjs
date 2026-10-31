'use strict';
// Fixture sessions and brain only; the exact local speech runtime is real.
const fs=require('fs'),path=require('path'),Module=require('module'),child=require('child_process'),realSpawn=child.spawn;
const root=process.env.NEXUS_REDESIGN_FIXTURE,ttsRoot=process.env.NEXUS_TTS_ROOT;
if(process.env.NEXUS_PORT!=='4785'||!ttsRoot)throw Error('Voices tour requires its isolated fixture and ports 4785/4786');
require('./live-preload.cjs');
const guarded=child.spawn;child.spawn=function(exe,args,options){
  if(exe===path.join(ttsRoot,'neural','Scripts','python.exe')&&args.length===2&&args[1]===path.resolve('tools/tts/service.py')&&options?.windowsHide)return realSpawn.apply(this,arguments);
  const install=process.env.NEXUS_LIVE_WHISPER?JSON.parse(process.env.NEXUS_LIVE_WHISPER):null;
  if(install&&exe===install.exe&&args.includes(install.model)&&options?.windowsHide)return realSpawn.apply(this,arguments);
  return guarded.apply(this,arguments);
};
const load=Module._load,realVoice=require('../voice');
const recorded=JSON.parse(fs.readFileSync('.local/live-benchmark/results.json','utf8')).backends.find(b=>b.kind==='claude').turns.slice(1);
Module._load=function(name,parent){
  if(name==='./voice'&&parent?.filename===path.resolve('server.js')&&process.env.NEXUS_LIVE_WHISPER)return {...realVoice,createVoiceService:()=>realVoice.createVoiceService({...JSON.parse(process.env.NEXUS_LIVE_WHISPER),tempRoot:path.join(root,'real-audio')})};
  if(name==='./live-brain'&&parent?.filename===path.resolve('live-service.js'))return {async createBrain(){let at=0;return {kind:'replay',model:'recorded-warm-haiku',close:async()=>{},async ask(input,delta){const turn=recorded[at++%recorded.length];await new Promise(r=>setTimeout(r,turn.ttftMs));delta(turn.text.slice(0,8));await new Promise(r=>setTimeout(r,Math.max(0,turn.totalMs-turn.ttftMs)));delta(turn.text.slice(8));return turn;}};}};
  return load.apply(this,arguments);
};
