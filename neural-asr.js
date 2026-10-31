'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
// No listener, credentials or auto-downloads. Killing only our child releases CUDA.
function createRecognizer({launch=spawn,python=process.env.NEXUS_ASR_PYTHON||path.join(process.env.LOCALAPPDATA||'','NexusDeck','tts','neural','Scripts','python.exe'),root=process.env.NEXUS_ASR_ROOT||path.join(process.env.LOCALAPPDATA||'','NexusDeck','asr','whisper-large-v3-turbo'),timeout=30000}={}){
 let worker=null,serial=0;
 function stop(){const w=worker;worker=null;if(!w)return Promise.resolve();for(const job of w.jobs.values())job.reject(Error('Recognizer stopped'));w.jobs.clear();w.child.stdin.destroy();
  // Windows venv python.exe is a launcher with a native Python child. End the
  // exact tree we created, including CUDA work still running during an abort.
  if(process.platform==='win32'&&w.child.pid){const killer=spawn('taskkill.exe',['/PID',String(w.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>w.child.kill());}else w.child.kill();return w.closed;}
 async function start(){
  if(worker)return worker.ready;
  if(process.env.NEXUS_ASR_DISABLED==='1'||!fs.existsSync(python)||!fs.existsSync(path.join(root,'model.safetensors')))throw Error('GPU recognizer is not installed');
  const child=launch(python,['-u',path.join(__dirname,'tools','voice-asr-worker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NEXUS_ASR_ROOT:root,PYTHONIOENCODING:'utf-8'}});
  const w={child,jobs:new Map()};worker=w;
  w.closed=new Promise(resolve=>{child.once('close',()=>{if(worker===w)worker=null;for(const job of w.jobs.values())job.reject(Error('GPU recognizer stopped'));w.jobs.clear();resolve();});});
  w.ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(Error('GPU recognizer warmup timeout'));if(worker===w)stop();},60000);let buffer='';
   const failed=()=>{clearTimeout(timer);reject(Error('GPU recognizer unavailable'));};child.once('error',failed);child.once('close',failed);child.stdin.on('error',failed);child.stderr.on('data',()=>{});
   child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>2e6){failed();stop();return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let value;try{value=JSON.parse(line);}catch{failed();stop();return;}if(value.ready){clearTimeout(timer);resolve(value);}else if(value.id){const job=w.jobs.get(value.id);w.jobs.delete(value.id);if(job)value.error?job.reject(Error('GPU recognition failed')):job.resolve(value);}else if(value.error){failed();stop();}}});
  });
  return w.ready;
 }
 async function transcribe(wav,signal,context={}){
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');await start();const w=worker;if(!w)throw Error('Recognizer unavailable');
  let timer,abort;try{return await new Promise((resolve,reject)=>{
   const id=++serial;w.jobs.set(id,{resolve,reject});abort=()=>{reject(new DOMException('Cancelled','AbortError'));stop();};signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>{reject(Error('GPU recognition timeout'));stop();},timeout);
   w.child.stdin.write(JSON.stringify({id,wav:wav.toString('base64'),prior:context.prior,forced:context.forced})+'\n');if(signal?.aborted)abort();
  });}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 return {start,stop,transcribe,get running(){return !!worker;}};
}
module.exports={createRecognizer};
