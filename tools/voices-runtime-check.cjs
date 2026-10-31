'use strict';
// Explicit real-runtime lifecycle check. No brain, account, or coding session.
const assert=require('assert/strict'),{createNeuralTTS}=require('../neural-tts');
const client=createNeuralTTS({config:{ttsIdleMinutes:1}}),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  assert.equal(client.running,false);client.list();assert.equal(client.running,false);
  client.startCall();const deadline=Date.now()+120000;
  while(!client.list().voices.filter(v=>['kokoro-heart','piper-daniela'].includes(v.id)).every(v=>v.ready)){if(Date.now()>deadline)throw Error('Voice warmup timed out');await sleep(1000);await client.health();}
  const result=[];for(const [lang,text] of [['en','The 3 checks passed.'],['es','Dale, vos podés seguir.']]){let chunks=0;const started=performance.now();const selected=await client.synthesize(text,lang,()=>chunks++);assert.ok(chunks);result.push({lang,voice:selected,elapsedMs:Math.round(performance.now()-started),chunks});}
  assert.equal((await fetch('http://127.0.0.1:4786/health')).status,403,'private service refuses unauthenticated requests');
  console.log('PASS real CUDA voices and private service authentication '+JSON.stringify(result));
  client.stopCall();const idleAt=Date.now();while(client.running){if(Date.now()-idleAt>80000)throw Error('Idle service did not exit');await sleep(1000);}
  console.log('PASS one-minute idle shutdown released service and workers in '+Math.round((Date.now()-idleAt)/1000)+' seconds');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>client.close());
