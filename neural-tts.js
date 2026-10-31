'use strict';
const fs=require('fs'),path=require('path'),net=require('net'),{spawn}=require('child_process'),{randomBytes}=require('crypto');
const catalog=require('./tools/tts/catalog.json');
const voiceById=new Map(catalog.voices.map(v=>[v.id,v]));
function selection(saved={}){return Object.fromEntries(['en','es'].map(lang=>[lang,voiceById.get(saved[lang])?.lang===lang?saved[lang]:catalog.defaults[lang]]));}
function validateChoice(lang,id){if(!['en','es'].includes(lang)||voiceById.get(id)?.lang!==lang)throw Error('Choose a voice from this language.');return id;}
// Bounded NDJSON parser handles arbitrary UTF-8/network boundaries and rejects a
// truncated success. Audio is always a complete WAV chunk, never an arbitrary byte slice.
async function readChunks(response,onChunk,{signal}={}){
  if(!response.ok)throw Error('Neural voice is warming up or busy.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',finished=false,audio=false;
  try{for(;;){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});if(buffer.length>8*1024*1024)throw Error('Voice chunk is too large.');let at;
    while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;if(finished)throw Error('Unexpected voice data after completion.');const msg=JSON.parse(line);
      if(msg.type==='error')throw Error('Neural voice failed. Device speech is available.');
      if(msg.type==='audio'){if(msg.mime!=='audio/wav'||typeof msg.audio!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(msg.audio))throw Error('Invalid voice audio.');const bytes=Buffer.from(msg.audio,'base64');if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Invalid voice WAV.');audio=true;await onChunk(msg);}
      else if(msg.type==='done'){if(!audio)throw Error('Voice returned no audio.');finished=true;}
      else throw Error('Unknown voice response.');
    }if(done)break;}
    if(buffer.trim()||!finished)throw Error('Voice response was interrupted.');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function createNeuralTTS({root=process.env.NEXUS_TTS_ROOT||path.join(process.env.LOCALAPPDATA||'','NexusDeck','tts'),config={},getSelection=()=>({}),saveSelection=async()=>{},launch=spawn,fetcher=fetch}={}){
  let child=null,starting=null,ready=new Set(),active=0,timer=null,closed=false,notice='',warmKey='',warming=null;
  const port=Number(process.env.NEXUS_TTS_PORT)||4786;if(![4786,4788].includes(port))throw Error('Invalid local voice port');
  const token=randomBytes(32).toString('hex'),url='http://127.0.0.1:'+port;
  const request=(route,data,signal)=>fetcher(url+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:signal||AbortSignal.timeout(3000)});
  function voices(){return selection(getSelection());}
  function sampleFile(v,index){return path.join(root,'samples',...(v.lang==='es'?[catalog.spanishSampleSet]:[]),v.id+'-'+index+'.wav');}
  function installed(v){const runtime=['kokoro','qwen'].includes(v.engine)?'neural':v.engine;return fs.existsSync(path.join(root,runtime,'Scripts','python.exe'))&&fs.existsSync(path.join(root,'models',v.engine,v.engine==='piper'?v.speaker+'.onnx':v.engine==='kokoro'?'kokoro-v1_0.pth':v.engine==='qwen'?'model.safetensors':'t3_mtl23ls_v3.safetensors'));}
  async function health(){if(!child)return;try{const res=await request('/health');if(!res.ok)throw Error();const data=await res.json();if(data.protocol!==1)throw Error();ready=new Set(data.ready);}catch{ready.clear();}}
  async function start(){
    if(closed)throw Error('Voice service closed.');if(child)return;if(starting)return starting;
    starting=(async()=>{
      const python=path.join(root,'neural','Scripts','python.exe');if(!fs.existsSync(python))throw Error('Install the local voices on the PC first.');
      await new Promise((resolve,reject)=>{const check=net.createServer();check.once('error',()=>reject(Error('Voice port '+port+' is already in use.')));check.listen(port,'127.0.0.1',()=>check.close(resolve));});
      if(closed)return;
      const p=launch(python,['-u',path.join(__dirname,'tools','tts','service.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NEXUS_TTS_ROOT:root,PYTHONIOENCODING:'utf-8'}});child=p;
      p.stdin.on('error',()=>{});p.stderr.on('data',()=>{}); // no owner text in application logs
      p.once('exit',()=>{if(child===p){child=null;ready.clear();warmKey='';clearInterval(timer);timer=null;}});
      p.stdin.write(JSON.stringify({token,port,idleSeconds:Math.max(60,Math.min(1800,(Number(config.ttsIdleMinutes)||5)*60))})+'\n');
      await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Local voice service did not start.')),10000);const finish=e=>{clearTimeout(timeout);p.stdout.off('data',data);p.off('error',failed);p.off('exit',exited);e?reject(e):resolve();};const data=bytes=>{output+=bytes;if(output.includes('NEXUS_TTS_READY'))finish();};const failed=e=>finish(e),exited=()=>finish(Error('Local voice service stopped.'));p.stdout.on('data',data);p.once('error',failed);p.once('exit',exited);});
      p.stdout.resume();
      timer=setInterval(()=>{health();if(active)request('/lease',{active:true}).catch(()=>{});},2000);timer.unref();
      notice='';
    })().catch(error=>{notice=error.message;const p=child;child=null;p?.stdin.end();ready.clear();throw error;}).finally(()=>{starting=null;});return starting;
  }
  async function warm(ids=Object.values(voices())){
    ids=[...new Set(ids)].filter(id=>voiceById.has(id)&&installed(voiceById.get(id)));if(!ids.length)return;
    const key=ids.join(',');if(warming)return warming;
    warming=(async()=>{await start();if(!child||closed)return;if(warmKey!==key||ids.some(id=>!ready.has(id))){await request('/warm',{voices:ids});warmKey=key;}if(active)await request('/lease',{active:true});await health();})().catch(e=>{notice=e.message;}).finally(()=>{warming=null;});return warming;
  }
  function list(){return {selected:voices(),status:notice||(!child?'Starts with a call or sample':ready.size?'Ready':'Warming up'),voices:catalog.voices.map(v=>{let measurement;const gpu=v.engine==='piper'&&fs.existsSync(path.join(root,'piper-gpu','Scripts','python.exe'));try{measurement=JSON.parse(fs.readFileSync(path.join(root,(gpu?'piper-gpu':v.engine)+'-benchmarks.json'),'utf8'))[v.id];}catch{}return {id:v.id,lang:v.lang,name:v.name,engine:v.engine,description:gpu?v.description.replace('runs on the CPU','GPU with a light CPU fallback'):v.description,license:v.license,source:v.source,installed:installed(v),ready:ready.has(v.id),ttfaMs:measurement?.ttfaMs??null,rtf:measurement?.rtf??null,samples:catalog.phrases[v.lang].map((text,i)=>({text,index:i,available:fs.existsSync(sampleFile(v,i)),url:'/api/voices/sample/'+v.id+'/'+i}))};})};}
  async function choose(lang,id){validateChoice(lang,id);if(!installed(voiceById.get(id)))throw Error('Install this voice on the PC before choosing it.');const next={...voices(),[lang]:id};await saveSelection(next);if(active)warm(Object.values(next));return next;}
  async function synthesize(text,lang,onChunk,{signal}={}){
    const id=voices()[lang==='es'?'es':'en'];if(!ready.has(id)){warm();throw Error('Neural voice is warming up.');}
    const timeout=AbortSignal.timeout(45000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const response=await request('/synthesize',{voice:id,text},combined);
    await readChunks(response,chunk=>onChunk({...chunk,voice:id}),{signal:combined});
    return id;
  }
  function sample(id,index){if(!voiceById.has(id)||!Number.isInteger(index)||index<0||index>2)throw Error('Unknown voice sample.');const file=sampleFile(voiceById.get(id),index);if(!fs.existsSync(file))throw Error('Generate the voice samples on the PC first.');warm();return file;}
  return {list,choose,synthesize,sample,warm,health,voices,startCall(){active++;warm();},stopCall(){active=Math.max(0,active-1);if(child)request('/lease',{active:!!active}).catch(()=>{});},async close(){closed=true;active=0;clearInterval(timer);const p=child;child=null;ready.clear();if(p){p.stdin.end();await new Promise(r=>{const t=setTimeout(r,15000);t.unref();p.once('exit',()=>{clearTimeout(t);r();});});}},get running(){return !!child;}};
}
module.exports={createNeuralTTS,selection,validateChoice,readChunks};
