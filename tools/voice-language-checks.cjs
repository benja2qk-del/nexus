'use strict';
const assert=require('assert/strict'),http=require('http'),fs=require('fs'),path=require('path');
const v=require('../public/voice-core'),{createLiveService}=require('../live-service'),{createVoiceService}=require('../voice');
for(const text of ['oye, cachai si los tests pasaron?','dale, al tiro','bacán po, avanzamos harto','está fome, weón','abre la sesión de beacon y run the tests'])assert.equal(v.language(text),'es',text);
assert.equal(v.language('Run the tests for beacon and then dime si pasaron'),'en');
assert.equal(v.replyLanguage('Okay.','es'),'es');assert.equal(v.replyLanguage('The tests passed.','es'),'en');
const prior=v.sessionPrior();assert.equal(prior([{t:'user',text:'Hola, revisa las pruebas'},{t:'user',text:'Dime si todo está bien'},{t:'ai',text:'The tests passed'}]),'es');
assert.equal(prior([{t:'user',text:'Please check the tests'}]),'en');
assert.equal(v.turnLanguage('hmm',{language:'en',confidence:.51},'es'),'es');
assert.equal(v.turnLanguage('okay',{},'es'),'es');
assert.equal(v.turnLanguage('Hello',{language:'en',confidence:.99},'es'),'en');
assert.equal(v.turnLanguage('Hola',{language:'es',confidence:.99},'en','en'),'en');
assert.equal(v.turnLanguage('Oye, got chai si los tests pasaron?',{language:'en',confidence:.98},'es'),'es');
assert.equal(v.sessionLanguage([{t:'user',text:'Hola'},{t:'user',text:'Dale, al tiro'},{t:'ai',text:'English answer.'}]),'es');
assert.match(require('../live-protocol').prompt('Fixture'),/neutral Latin American Spanish/);
assert.ok(!require('../live-protocol').prompt('Fixture').includes('use natural Argentine'));
async function integration(){
 let output=null,inputs=[],spoken=[];const state={session:{title:'Fixture'},chat:{events:[{t:'user',text:'Revisa las pruebas y dime si todo funciona'}],terminal:{ready:true}}};
 const service=createLiveService({snapshot:()=>state,send:async()=>assert.fail('No actions'),brainFactory:async()=>({kind:'stub',close:async()=>{},async ask(s,delta){const data=JSON.parse(s);inputs.push(data);delta(output||'<say>'+(data.language==='es'?'Las pruebas están listas.':'The tests are ready.')+'</say>');return {};}}),tts:{async synthesize(text,lang){spoken.push(lang);}}});
 const server=http.createServer((req,res)=>service.handle(req,res,req.url,req.headers['x-device']||'local',()=>true));await new Promise((r,j)=>{server.once('error',j);server.listen(4788,'127.0.0.1',r);});
 const post=async(route,body)=>{const res=await fetch('http://127.0.0.1:4788/api/live/'+route,{method:'POST',body:JSON.stringify(body)});assert.equal(res.status,200);return res;};
 try{const opened=await(await post('start',{key:'fixture'})).json(),id=opened.id;assert.equal(opened.language,'es');
  await(await post('turn',{id,text:'hmm',recognition:{language:'en',confidence:.51}})).text();assert.equal(inputs.at(-1).language,'es');
  await(await post('turn',{id,text:'Hello',recognition:{language:'en',confidence:.99}})).text();assert.equal(inputs.at(-1).language,'en');
  await post('language',{id,language:'es'});await(await post('turn',{id,text:'Please check the tests',recognition:{language:'en',confidence:.99}})).text();assert.equal(inputs.at(-1).language,'es');
  await(await post('turn',{id,text:'Hello again'})).text();assert.equal(inputs.at(-1).language,'es','force lasts all call');
  output='<say>Las pruebas están listas. The tests are ready.</say>';spoken=[];await(await post('turn',{id,text:'Hola'})).text();assert.deepEqual(spoken,['es','en'],'each sentence chooses its own voice');
  await post('stop',{id});const fresh=await(await post('start',{key:'fixture'})).json();assert.equal(fresh.language,'es');await post('stop',{id:fresh.id});
 }finally{await service.close();await new Promise(r=>server.close(r));}
}
async function fallback(){
 const root=path.resolve('.local/voice-language-unit');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'stub-model'),'fixture');fs.writeFileSync(path.join(root,'utterance.txt'),'Dale, al tiro.');
 let starts=0,stops=0;const recognizer={async start(){starts++;throw Error('CUDA unavailable');},async transcribe(){starts++;throw Error('CUDA unavailable');},async stop(){stops++;}};
 // Injected recognizer tests real CPU fallback without relying on GPU availability.
 const service=createVoiceService({gpu:true,recognizer,exe:process.execPath,prefix:[path.resolve('tools/voice-whisper-stub.cjs'),root],model:path.join(root,'stub-model'),tempRoot:path.join(root,'audio')});
 const wav=Buffer.from(v.encodeWav([new Float32Array(16000)],16000));const result=await service.transcribe(wav);assert.equal(result.text,'Dale, al tiro.');assert.equal(result.language,'es');assert.equal(result.backend,'whisper.cpp base');assert.ok(stops>0);if(process.env.NEXUS_ASR_DISABLED!=='1')assert.ok(starts>0);await service.stopCall();
}
async function lifecycle(){
 const {EventEmitter}=require('events'),{PassThrough,Writable}=require('stream'),{createRecognizer}=require('../neural-asr');
 const root=path.resolve('.local/voice-asr-unit');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'model.safetensors'),'fixture');fs.writeFileSync(path.join(root,'python.exe'),'fixture');
 const saved=process.env.NEXUS_ASR_DISABLED;delete process.env.NEXUS_ASR_DISABLED;
 let launches=0,kills=0,hold=false;
 const recognizer=createRecognizer({root,python:path.join(root,'python.exe'),launch(exe,args,options){
  assert.equal(options.windowsHide,true);launches++;const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();
  p.stdin=new Writable({write(data,_,done){const q=JSON.parse(String(data));if(!hold)queueMicrotask(()=>p.stdout.write(JSON.stringify({id:q.id,text:'Hola',language:'es',confidence:.98})+'\n'));done();}});
  p.kill=()=>{kills++;queueMicrotask(()=>p.emit('close',0));};queueMicrotask(()=>{p.stdout.write('{"rea');p.stdout.write('dy":true}\n');});return p;
 }});
 try{await recognizer.start();await recognizer.start();assert.equal(launches,1);assert.equal((await recognizer.transcribe(Buffer.alloc(44))).language,'es');
  hold=true;const controller=new AbortController(),pending=recognizer.transcribe(Buffer.alloc(44),controller.signal);await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(recognizer.running,false);assert.equal(kills,1);await recognizer.stop();
 }finally{await recognizer.stop();if(saved===undefined)delete process.env.NEXUS_ASR_DISABLED;else process.env.NEXUS_ASR_DISABLED=saved;}
}
async function run(){await integration();await fallback();await lifecycle();console.log('PASS bilingual routing, cached owner prior, force lifetime, mixed sentences, CPU fallback, warm worker reuse and abort cleanup');}
module.exports={run};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
