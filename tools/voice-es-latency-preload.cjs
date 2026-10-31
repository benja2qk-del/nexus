'use strict';
const fs=require('fs'),path=require('path'),Module=require('module'),cp=require('child_process'),spawn=cp.spawn;
if(process.env.NEXUS_PORT!=='4787'||process.env.NEXUS_TTS_PORT!=='4788')throw Error('Bilingual private ports only');
require('./call-preload.cjs');
const guarded=cp.spawn,owned=new Set();
cp.spawn=function(exe,args,options){
 const worker=exe===process.env.NEXUS_ASR_PYTHON&&args.length===2&&[path.resolve('tools/tts/service.py'),path.resolve('tools/voice-asr-worker.py')].includes(args[1]);
 const cpu=exe===JSON.parse(process.env.NEXUS_ES_WHISPER).exe;
 if(options?.windowsHide&&(worker||cpu)){const p=spawn.apply(this,arguments);owned.add(String(p.pid));return p;}
 if(exe==='taskkill.exe'&&args[0]==='/PID'&&owned.has(args[1])&&args.join(' ').endsWith('/T /F')&&options?.windowsHide)return spawn.apply(this,arguments);
 return guarded.apply(this,arguments);
};
const load=Module._load,realVoice=require('../voice');
Module._load=function(name,parent){
 if(name==='./voice'&&parent?.filename===path.resolve('server.js'))return {...realVoice,createVoiceService:()=>realVoice.createVoiceService({...JSON.parse(process.env.NEXUS_ES_WHISPER),gpu:process.env.NEXUS_ES_CPU!=='1',tempRoot:path.join(process.env.NEXUS_REDESIGN_FIXTURE,'private-audio')})};
 if(name==='./live-brain'&&parent?.filename===path.resolve('live-service.js'))return {async createBrain(){let n=0;return {kind:'replay',model:'documented-haiku-timing',close:async()=>{},async ask(input,delta){const data=JSON.parse(input),[ttftMs,totalMs]=[[681,801],[622,728],[694,802]][n++%3];const text='<say>'+(data.language==='es'?'Las pruebas están listas.':'The tests are ready.')+'</say>';await new Promise(r=>setTimeout(r,ttftMs));delta(text.slice(0,8));await new Promise(r=>setTimeout(r,totalMs-ttftMs));delta(text.slice(8));return {ttftMs,totalMs};}};}};
 return load.apply(this,arguments);
};
