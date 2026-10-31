'use strict';
const assert=require('assert/strict'), fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const core=require('../public/voice-core'), {createVoiceService,validateWav,MAX_AUDIO}=require('../voice');
const {fixture,cleanup}=require('./voice-fixture.cjs');
async function main(){
  const one=core.encodeWav([Float32Array.from([-2,-1,0,.5,1,2])],16000), view=new DataView(one);
  assert.equal(view.getUint32(24,true),16000);assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(54,true),32767);
  assert.equal(validateWav(Buffer.from(one)),6/16000);
  const tone=(hz,rate)=>Float32Array.from({length:rate},(_,i)=>Math.sin(2*Math.PI*hz*i/rate));
  const rms=a=>Math.sqrt(a.reduce((n,x)=>n+x*x,0)/a.length);
  for(const rate of [44100,48000,16000]){
    const output=core.resample([tone(440,rate),tone(440,rate)],rate);assert.equal(output.length,16000);assert(rms(output)>.69 && rms(output)<.72);
  }
  assert(rms(core.resample([tone(12000,48000)],48000).slice(100,-100))<.01,'low-pass rejects aliasing');
  assert(rms(core.resample([tone(440,48000),tone(440,48000).map(n=>-n)],48000))<1e-6,'stereo averages to mono');
  assert.throws(()=>core.resample([],48000));assert.throws(()=>core.resample([new Float32Array(1)],0));
  assert.equal(core.gist('Ready. The tests passed.'),'Ready. The tests passed.');
  const gist=core.gist('**Ready.** Tests passed. Third sentence.\n\n```js\nsecret()\n```\n| a | b |\nSee https://example.com/a and C:\\private\\thing.md or public/app.js');
  assert.equal(gist,'Ready. Tests passed. Full reply is in the chat.');
  assert(!core.clean('Open `/private/a`.\n~~~js\nsecret\n~~~\nRead ./notes.txt or [the report](https://example.com).').includes('secret'));
  assert(!core.clean('The file is at C:\\Users\\Owner\\secret.txt and /private/secret.').includes('secret'));
  assert(core.gist('Listo. La respuesta está preparada.\n\nMás detalles.').includes('respuesta completa'));
  const prompt={question:'Do you want to publish?',options:[{key:'5',label:'Yes, publish'},{key:'7',label:'No, keep draft'},{key:'9',label:'Cancel'}]};
  for(const word of ['one','uno','una','1','Option one.'])assert.equal(core.spokenAnswer(word,prompt),'5');
  for(const word of ['two','dos','2','opción dos'])assert.equal(core.spokenAnswer(word,prompt),'7');
  for(const word of ['yes','sí','si'])assert.equal(core.spokenAnswer(word,prompt),'5');
  assert.equal(core.spokenAnswer('no',prompt),'7');assert.equal(core.spokenAnswer('tres',prompt),'9');assert.equal(core.spokenAnswer('cancelar',prompt),'esc');
  for(const word of ['yes please publish everything','not one','one or two','four'])assert.equal(core.spokenAnswer(word,prompt),null);
  assert.equal(core.spokenAnswer('yes',{...prompt,options:[...prompt.options,{key:'4',label:'Yes, always'}].reverse()}),null);
  assert(!core.questionSpeech({...prompt,options:[...prompt.options,{key:'4',label:'NEVER_SPOKEN'}]}).includes('NEVER_SPOKEN'));
  console.log('PASS WAV PCM/clipping, mono, 44.1/48 kHz resampling and anti-aliasing; gist/paths/markdown; English/Spanish safe choices');
  const port=process.env.NEXUS_TEST_PORT||'4786',f=fixture(port);let server;
  const wav=Buffer.from(core.encodeWav([tone(440,16000)],16000));
  const config={exe:process.execPath,prefix:[path.resolve('tools/voice-whisper-stub.cjs'),f.root],model:path.join(f.root,'stub-model'),tempRoot:path.join(f.root,'unit-audio')};
  try{
    const service=createVoiceService(config),pending=service.transcribe(wav);
    await assert.rejects(service.transcribe(wav),e=>e.status===429);
    assert.equal((await pending).text,'Reply with the word okay.');
    assert.equal(fs.readdirSync(config.tempRoot).length,0,'success removes temporary audio');
    fs.writeFileSync(path.join(f.root,'utterance.txt'),'fail');await assert.rejects(service.transcribe(wav),e=>e.status===502);
    fs.writeFileSync(path.join(f.root,'utterance.txt'),'slow');await assert.rejects(createVoiceService({...config,timeout:120}).transcribe(wav),e=>e.status===504);
    const controller=new AbortController();const aborting=service.transcribe(wav,controller.signal);setTimeout(()=>controller.abort(),100);await assert.rejects(aborting,e=>e.status===499);
    assert.equal(fs.readdirSync(config.tempRoot).length,0,'failure/timeout/cancellation remove temporary audio');
    fs.writeFileSync(path.join(f.root,'utterance.txt'),'Reply with the word okay.');
    const invalid=Buffer.from(wav);invalid.writeUInt32LE(48000,24);assert.throws(()=>validateWav(invalid),e=>e.status===415);
    assert.throws(()=>validateWav(wav.subarray(0,50)),e=>e.status===415);
    assert.throws(()=>validateWav(Buffer.from(core.encodeWav([new Float32Array(16000*121)],16000))),e=>e.status===413);
    console.log('PASS runner executable, one-job gate, failures, timeout, abort and private-audio cleanup');
    server=spawn(process.execPath,['--require','./tools/voice-test-preload.cjs','server.js'],{env:{...f.env,NEXUS_REAL_WHISPER:process.argv.includes('--real')?'1':''},windowsHide:true,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server start timed out')),15000);server.stdout.on('data',d=>{if(String(d).includes('http://127.0.0.1:'+port+'/')){clearTimeout(timer);resolve();}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
    const base='http://127.0.0.1:'+port,local={'X-Nexus':'1','Content-Type':'audio/wav'};
    const configJson=JSON.parse(fs.readFileSync(f.env.NEXUS_CONFIG_FILE,'utf8'));
    const remote={...local,'X-Forwarded-Host':configJson.remoteHost,'Tailscale-User-Login':configJson.remoteUser};
    const post=(headers,body=wav,route='/api/voice/transcribe')=>fetch(base+route,{method:'POST',headers,body});
    assert.equal((await post({'Content-Type':'audio/wav'})).status,403);
    assert.equal((await post(remote)).status,401);
    assert.equal((await post({...remote,'Tailscale-User-Login':'wrong'})).status,403);
    assert.equal((await post({...local,Origin:'https://evil.example'})).status,403);
    assert.equal((await post({...local,'Content-Type':'audio/mp4'})).status,415);
    assert.equal((await post(local,Buffer.from('not audio'))).status,415);
    assert.equal((await post(local,Buffer.alloc(MAX_AUDIO+1))).status,413);
    const streamed=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/voice/transcribe',{method:'POST',headers:local},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(Buffer.alloc(5*1024*1024));req.end(Buffer.alloc(6*1024*1024));});assert.equal(streamed,413);
    assert.equal((await fetch(base+'/api/voice/transcribe')).status,405);
    assert.equal((await post({...remote,Cookie:'nexus_device='+f.token,Origin:'https://'+configJson.remoteHost},wav)).status,200);
    console.log('PASS endpoint local/paired access, unpaired/wrong identity/origin rejection, methods, MIME, malformed WAV, declared and streamed 10 MB cap');
    if(process.argv.includes('--real')){
      const started=Date.now();const tts=await post({...local,'Content-Type':'application/json'},JSON.stringify({text:'Reply with the word okay. The microphone is ready.',lang:'en'}),'/api/voice/tts');
      assert.equal(tts.status,200,await tts.clone().text());const synthesized=Buffer.from(await tts.arrayBuffer());validateWav(synthesized);
      const response=await post(local,synthesized);assert.equal(response.status,200);const result=await response.json();
      assert(/reply/i.test(result.text)&&/microphone/i.test(result.text)&&/ready/i.test(result.text),result.text);
      const report={...result,ttsAndTranscriptionMs:Date.now()-started,bytes:synthesized.length,date:new Date().toISOString()};
      fs.mkdirSync('docs/shots/voice',{recursive:true});fs.writeFileSync('docs/shots/voice/real-whisper.json',JSON.stringify(report,null,2));console.log('PASS REAL SAPI -> authenticated HTTP -> whisper CPU:',JSON.stringify(report));
    }
  }finally{if(server)await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);server.kill();});cleanup(f.root);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
