'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawn}=require('child_process');
const {createVoiceService}=require('../voice');
const root=path.resolve('.local','live-audio');fs.mkdirSync(root,{recursive:true});
const run=(exe,args)=>new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',()=>{});p.on('error',reject);p.on('close',c=>c?reject(Error('Audio helper failed '+c)):resolve(out));});
const phrases=[{lang:'es',text:'Hola, dime como va la tarea.'},{lang:'es',text:'Dile al agente que revise las pruebas.'},{lang:'es',text:'Opcion dos.'},{lang:'en',text:'Hello, what is the current status?'},{lang:'en',text:'Tell the agent to check the tests.'},{lang:'en',text:'Option two.'}];
function words(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(Boolean);}
function wer(a,b){a=words(a);b=words(b);let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length]/a.length;}
async function main(){
  const install=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'NexusDeck','whisper','install.json'),'utf8').replace(/^\uFEFF/,''));
  const small=path.join(root,'ggml-small.bin');
  if(!fs.existsSync(small)){
    const pointer=await(await fetch('https://huggingface.co/ggerganov/whisper.cpp/raw/main/ggml-small.bin')).text();const hash=/oid sha256:([a-f0-9]{64})/.exec(pointer)?.[1];if(!hash)throw Error('Missing official small model hash');
    console.log('Downloading verified multilingual small model into worktree');const response=await fetch('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin');if(!response.ok)throw Error('Download failed');
    const fd=fs.openSync(small+'.partial','w'),sum=crypto.createHash('sha256');try{for await(const chunk of response.body){fs.writeSync(fd,chunk);sum.update(chunk);}}finally{fs.closeSync(fd);}if(sum.digest('hex')!==hash)throw Error('Small model hash mismatch');fs.renameSync(small+'.partial',small);
  }
  const voiceScript=path.join(root,'voices.ps1');fs.writeFileSync(voiceScript,'Add-Type -AssemblyName System.Speech\n$s = New-Object System.Speech.Synthesis.SpeechSynthesizer\n$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + " / " + $_.VoiceInfo.Culture.Name }\n$s.Dispose()\n');
  const voices=await run('powershell.exe',['-NoProfile','-NonInteractive','-File',voiceScript]);console.log(voices);
  const report={date:new Date().toISOString(),voices,threads:Math.min(12,os.availableParallelism()),spanishVoiceAvailable:/es-(?:ES|MX|CL)/i.test(voices),results:[]};
  for(let i=0;i<phrases.length;i++){
    const input=path.join(root,'phrase-'+i+'.json'),wav=path.join(root,'phrase-'+i+'.wav');fs.writeFileSync(input,JSON.stringify(phrases[i]));const start=performance.now();await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tools/voice-tts.ps1'),'-InputFile',input,'-OutputFile',wav]);phrases[i].ttsMs=performance.now()-start;phrases[i].wav=wav;
  }
  for(const [name,model] of [['base',install.model],['small',small]]){
    const service=createVoiceService({exe:install.exe,model,tempRoot:path.join(root,'turns')});
    for(const phrase of phrases){const result=await service.transcribe(fs.readFileSync(phrase.wav));const item={model:name,...phrase,...result,expected:phrase.text,wer:wer(phrase.text,result.text)};report.results.push(item);console.log(JSON.stringify(item));fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(report,null,2));}
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
