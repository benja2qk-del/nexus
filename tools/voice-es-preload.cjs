'use strict';
const fs=require('fs'),path=require('path'),Module=require('module'),load=Module._load;
if(process.env.NEXUS_PORT!=='4787'||!process.env.NEXUS_REDESIGN_FIXTURE)throw Error('Isolated bilingual fixture only');
const core=require('../public/voice-core'),{createNeuralTTS}=require('../neural-tts');
const audio=Buffer.from(core.encodeWav([Float32Array.from({length:1600},(_,i)=>.02*Math.sin(i/20))],16000)).toString('base64');
Module._load=function(name,parent){
 if(name==='./live-brain'&&parent?.filename===path.resolve('live-service.js'))return {async createBrain(){return {kind:'fixture',model:'stub',close:async()=>{},async ask(input,delta){const data=JSON.parse(input);delta('<say>'+(data.language==='es'?'Las pruebas están listas.':'The tests are ready.')+'</say>');return {ttftMs:1,totalMs:1};}};}};
 if(name==='./neural-tts'&&parent?.filename===path.resolve('server.js'))return {createNeuralTTS(options){const real=createNeuralTTS(options);return {...real,startCall(){},stopCall(){},sample(id,index){const v=real.list().voices.find(v=>v.id===id);if(!v||!Number.isInteger(index)||index<0||index>2)throw Error('Invalid sample');return path.join(process.env.NEXUS_TTS_ROOT,'samples',...(v.lang==='es'?['neutral-es-v1']:[]),id+'-'+index+'.wav');},async synthesize(text,lang,emit){emit({audio,mime:'audio/wav',voice:real.voices()[lang],ttsMs:1});}};}};
 return load.apply(this,arguments);
};
require('./call-preload.cjs');
