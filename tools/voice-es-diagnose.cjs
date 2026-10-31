'use strict';
// Actual WAV upload -> recognizer -> live routing -> stub brain -> voice selection.
// The brain and speech output are stubbed; no owner session or subscription is opened.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const cp=require('child_process'),spawn=cp.spawn;let diagnostics='';
cp.spawn=function(...args){const p=spawn(...args);if(String(args[0]).endsWith('whisper-cli.exe'))p.stderr.on('data',d=>diagnostics+=d);return p;};
const {createVoiceService}=require('../voice'),{createLiveService}=require('../live-service'),core=require('../public/voice-core');
const mode=process.argv[2]||'baseline',voice=createVoiceService({gpu:mode==='gpu',tempRoot:path.resolve('.local/voice-es/private')});
let input,used;
const live=createLiveService({snapshot:()=>({session:{title:'Synthetic bilingual test'},chat:{events:[{t:'user',text:'Revisa las pruebas y dime si todo funciona.'}],terminal:{ready:true}}}),send:async()=>assert.fail('No actions'),
  brainFactory:async()=>({kind:'stub',close:async()=>{},async ask(value,delta){input=JSON.parse(value);const es=input.language==='es'||core.language(input.language)==='es';delta('<say>'+(es?'Las pruebas están listas.':'The tests are ready.')+'</say>');return {ttftMs:0,totalMs:0};}}),
  tts:{async synthesize(text,lang,emit){used={text,lang,voice:lang==='es'?'piper-daniela':'chatterbox-en'};}}});
const server=http.createServer((req,res)=>req.url.startsWith('/api/voice/')?voice.handle(req,res,req.url,()=>true):live.handle(req,res,req.url,'fixture',()=>true));
const base='http://127.0.0.1:4787';
const post=async(route,data)=>{const r=await fetch(base+'/api/live/'+route,{method:'POST',body:JSON.stringify(data)});assert.equal(r.status,200);return r;};
(async()=>{
 await new Promise((r,j)=>{server.once('error',j);server.listen(4787,'127.0.0.1',r);});
 try{
  if(mode==='gpu')await voice.startCall();
  const {id}=await(await post('start',{key:'fixture'})).json(),rows=[];
  const files=fs.readdirSync('.local/voice-es').filter(f=>f.endsWith('-corpus.json'));
  for(const file of files)for(const item of JSON.parse(fs.readFileSync(path.join('.local/voice-es',file),'utf8'))){
   diagnostics='';const response=await fetch(base+'/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:fs.readFileSync(item.file)}),asr=await response.json();assert.equal(response.status,200,JSON.stringify(asr));
   await(await post('turn',{id,text:asr.text,recognition:asr})).text();
   const detected=/auto-detected language: (\w+) \(p = ([\d.]+)\)/.exec(diagnostics);
   rows.push({...item,transcript:asr.text,detected:asr.detectedLanguage||asr.language||detected?.[1]||'unreported',confidence:asr.confidence??Number(detected?.[2]||0),asrMs:asr.elapsedMs,brainLanguage:input.language,replyLanguage:used.lang,voiceUsed:used.voice,backend:asr.backend||'whisper.cpp base'});
   console.log(JSON.stringify(rows.at(-1)));
  }
  fs.writeFileSync('.local/voice-es/'+mode+'.json',JSON.stringify(rows,null,2));
  if(mode==='baseline'){
   const header='# Bilingual calls: baseline findings\n\nSynthetic audio through the real WAV endpoint and live service; stub brain and TTS selection recorder. Captures are normalized to 16 kHz PCM. This isolates ASR and routing; it does not assess a real human accent or brain latency.\n\n';
   const table='| Voice / seconds | Reference | Detected | Transcript | Brain language field | Reply / selected voice | ASR ms |\n|---|---|---|---|---|---|---|\n'+rows.map(r=>`| ${r.voice} / ${r.seconds.toFixed(2)} | ${r.reference} | ${r.detected} (${r.confidence.toFixed(2)}) | ${r.transcript} | ${r.brainLanguage} | ${r.replyLanguage} / ${r.voiceUsed} | ${r.asrMs} |`).join('\n');
   fs.writeFileSync('docs/NEXUS_VOICE_ES_FINDINGS.md',header+table+'\n\nInitial source findings: the recognizer discarded language metadata; live-service stored owner text in its language field; the brain prompt forced Rioplatense voseo. Phone inspection follows below.\n');
  }
  await post('stop',{id});
 }finally{await live.close();await voice.stopCall();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
