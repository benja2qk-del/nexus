'use strict';
const assert=require('assert/strict'),http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
const {readChunks,selection,validateChoice,createNeuralTTS}=require('../neural-tts'),voice=require('../public/voice-core');
const wav=Buffer.from(voice.encodeWav([new Float32Array(3200)],16000)),audio={type:'audio',audio:wav.toString('base64'),mime:'audio/wav',ttsMs:10};
const response=(text,size=1)=>new Response(new ReadableStream({start(c){const bytes=new TextEncoder().encode(text);for(let i=0;i<bytes.length;i+=size)c.enqueue(bytes.slice(i,i+size));c.close();}}));
async function protocol(){
  const text=JSON.stringify(audio)+'\n'+JSON.stringify({type:'done'})+'\n';
  for(const size of [1,7,1000]){let count=0;await readChunks(response(text,size),()=>count++);assert.equal(count,1);}
  for(const bad of ['',JSON.stringify(audio)+'\n',text+'{}',text+JSON.stringify(audio)+'\n','{"type":"error","error":"private internal"}\n','{"type":"audio","audio":"bad","mime":"audio/wav"}\n','{"type":"done"}\n'])await assert.rejects(readChunks(response(bad),()=>{}));
  const ac=new AbortController();ac.abort();await assert.rejects(readChunks(response(text),()=>assert.fail(),{signal:ac.signal}),e=>e.name==='AbortError');
  assert.deepEqual(selection({en:'piper-daniela',es:'missing'}),{en:'kokoro-heart',es:'piper-daniela'});
  for(const input of [['es','kokoro-heart'],['fr','piper-lj'],['en','../private']])assert.throws(()=>validateChoice(...input));
  assert.equal(voice.replyLanguage('Okay.','es'),'es');assert.equal(voice.replyLanguage('The checks passed.','es'),'en');assert.equal(voice.replyLanguage('Dale, vos podés seguir.','en'),'es');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-neural-unit-'));let saved={},launches=0;
  for(const p of ['neural/Scripts/python.exe','models/kokoro/kokoro-v1_0.pth']){fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),'fixture');}
  const client=createNeuralTTS({root,getSelection:()=>saved,saveSelection:async x=>{saved=x;},launch(){launches++;throw Error('fixture must stay lazy');}});
  assert.equal(client.list().voices.length,12);assert.equal(launches,0);await client.choose('en','kokoro-michael');assert.equal(saved.en,'kokoro-michael');assert.equal(launches,0);await assert.rejects(client.choose('es','piper-daniela'));assert.throws(()=>client.sample('../../etc',0));await client.close();
  // State reload retains voice choices alongside unrelated viewed/model fields.
  const vm=require('vm'),{EventEmitter}=require('events'),file=path.join(root,'state.json');fs.writeFileSync(file,JSON.stringify({viewed:{fixture:123},models:{fixture:{model:'test'}},voices:saved}));
  class Worker extends EventEmitter{unref(){}postMessage(){}}
  const load=()=>{const module={exports:{}};vm.runInNewContext(fs.readFileSync('insights.js','utf8'),{require:n=>n==='worker_threads'?{Worker}:require(n),process:{env:{NEXUS_STATE_FILE:file},pid:process.pid},__dirname:path.resolve('.'),module,console,setTimeout,clearTimeout,Buffer});return module.exports;};
  const state=load();await state.setVoices({en:'kokoro-heart',es:'piper-daniela'});assert.equal(load().voiceSelection().en,'kokoro-heart');assert.equal(JSON.parse(fs.readFileSync(file)).viewed.fixture,123);
  console.log('PASS neural protocol framing/truncation/errors/abort; language routing; lazy startup; selection validation and persistence');
}
async function playback(){
  const {create}=require('../public/neural-audio');let decodeRelease,starts=0,stops=0;const sources=[];
  const ctx={state:'running',currentTime:1,destination:{},resume:async()=>{},decodeAudioData:async()=>({duration:.5}),createBufferSource(){const s={connect(){},disconnect(){},start(at){s.at=at;starts++;},stop(){stops++;s.onended?.();}};sources.push(s);return s;},close:async()=>{}};
  const player=create({context:ctx});const a=player.push(wav),b=player.push(wav);await new Promise(r=>setImmediate(r));assert.equal(starts,2);assert.equal(sources[1].at,sources[0].at+.5,'chunks schedule without a gap');const begin=performance.now();player.cancel();await Promise.all([a,b]);assert.ok(performance.now()-begin<150);assert.equal(stops,2);assert.equal(player.playing,false);
  ctx.decodeAudioData=()=>new Promise(r=>{decodeRelease=r;});const late=player.push(wav);await new Promise(r=>setImmediate(r));player.cancel();decodeRelease({duration:1});await late;await new Promise(r=>setImmediate(r));assert.equal(starts,2,'late decoding cannot revive canceled speech');await player.close();
  console.log('PASS WebAudio contiguous chunks, immediate stop, pending decode cancellation and close');
}
async function integrated(){
  const {createLiveService}=require('../live-service');let fail=false,hold=false,signal,chunk;
  const service=createLiveService({snapshot:()=>({session:{title:'Fixture',kind:'claude'},chat:{terminal:{ready:true}}}),send:async()=>assert.fail('no action expected'),tts:{async synthesize(text,lang,emit,opts){signal=opts.signal;chunk=emit;assert.equal(lang,'es');if(fail)throw Error('warming');if(hold)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));emit(audio);}},brainFactory:async()=>({kind:'fixture',close:async()=>{},ask:async(_,delta)=>{delta('<say>Dale, vos podés seguir.</say>');return {ttftMs:1,totalMs:2};}})});
  const server=http.createServer((req,res)=>service.handle(req,res,req.url,req.headers['x-device']||'local',()=>true));await new Promise((r,j)=>{server.once('error',j);server.listen(Number(process.env.NEXUS_TEST_PORT)||4786,'127.0.0.1',r);});
  const post=(route,body)=>fetch('http://127.0.0.1:'+server.address().port+'/api/live/'+route,{method:'POST',body:JSON.stringify(body)});
  try{const {id}=await(await post('start',{key:'fixture'})).json();let events=(await(await post('turn',{id,text:'Hola'})).text()).trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.type==='audio').length,1);assert.equal(events.find(e=>e.type==='sentence').neural,true);assert.equal(events.at(-1).type,'done');
    fail=true;events=(await(await post('turn',{id,text:'Hola'})).text()).trim().split('\n').map(JSON.parse);assert.equal(events.filter(e=>e.type==='speech-fallback').length,1);assert.ok(!events.some(e=>e.type==='audio'));fail=false;hold=true;
    const pending=post('turn',{id,text:'Hola'});const res=await pending;while(!signal||signal.aborted)await new Promise(r=>setTimeout(r,5));await post('cancel',{id});const body=await res.text();assert.ok(!body.includes('"type":"audio"'));assert.ok(signal.aborted);await post('stop',{id});
  }finally{await service.close();await new Promise(r=>server.close(r));}
  console.log('PASS call-channel neural audio, language choice, warmup fallback and canceled generation suppression');
}
(async()=>{await protocol();await playback();await integrated();})().catch(e=>{console.error(e);process.exitCode=1;});
