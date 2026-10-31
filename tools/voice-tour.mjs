import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture,cleanup}=require('./voice-fixture.cjs'),core=require('../public/voice-core');
const width=Number(process.argv.find(x=>/^\d+$/.test(x)))||390,baseline=process.argv.includes('--baseline'),uxOnly=process.argv.includes('--ux-only');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(4791,'127.0.0.1',()=>probe.close(resolve));});
const f=fixture(),out=path.resolve('docs/shots',baseline||uxOnly?'ux':'voice',(baseline?'before-':uxOnly?'after-':'')+width);fs.mkdirSync(out,{recursive:true});
const source=path.join(f.root,'browser-fixture.js');
fs.writeFileSync(source,`window.voiceCheck=(ok,label)=>{if(!ok)throw Error(label);console.log('PASS '+label)};
window.voiceTour={spoken:[],streams:[],actions:[],tts:0};
const realMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async options=>{const stream=await realMedia(options);voiceTour.streams.push(stream);return stream;};
let speechTimer;
speechSynthesis.cancel=()=>{clearTimeout(speechTimer)};
speechSynthesis.speak=u=>{if(!u.text)return;voiceCheck(voiceTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),'microphone stopped before speech');voiceTour.spoken.push(u.text);setTimeout(()=>u.onstart?.(),10);speechTimer=setTimeout(()=>u.onend?.(),2300);};
const originalFetch=window.fetch.bind(window);
window.fetch=(url,options={})=>{const route=new URL(url,location.href).pathname;
if(route==='/api/action'){const data=JSON.parse(options.body);voiceTour.actions.push(data);if(!['viewed','term-resume','term-send','term-close'].includes(data.action))throw Error('Blocked fixture action');if(data.key&&!['claude:voice-claude','astra:voice-astra'].includes(data.key))throw Error('Blocked nonfixture key');}
if(route==='/api/voice/tts')voiceTour.tts++;
if(route.startsWith('/api/')&&!['/api/action','/api/sessions','/api/chat','/api/transcript','/api/term-state','/api/voice/transcribe','/api/voice/tts','/api/recap'].includes(route))throw Error('Blocked fixture route '+route);
if(${baseline} && route==='/api/sessions')return originalFetch(url,options).then(async r=>{const data=await r.json();data.briefing.text='0 sessions working. No live Claude session waiting. Open a session to establish its away checkpoint.';return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})});
return originalFetch(url,options);};
window.WebSocket=class{constructor(){throw Error('Voice Chat must not open a terminal WebSocket')}};
localStorage.setItem('nexus.voiceSilence','1300');localStorage.setItem('nexus.voiceServerSpeech','off');
`);
const env={...f.env,NEXUS_WIDTH:String(width),NEXUS_HEIGHT:width<=700?'844':'1080',NEXUS_TOUR_SOURCE:source,NEXUS_TOUR_BASELINE:baseline?'01b1d8e':'',NEXUS_VOICE_TOUR:'1',NEXUS_FAKE_AUDIO:path.join(f.root,'capture.wav')};
const server=spawn(process.execPath,['--require','./tools/voice-test-preload.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
process.on('exit',()=>server.kill());
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Start timeout')),20000);server.stdout.on('data',d=>{if(String(d).includes('http://127.0.0.1:4791/')){clearTimeout(timer);resolve();}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});});
  const speech=await fetch('http://127.0.0.1:4791/api/voice/tts',{method:'POST',headers:{'X-Nexus':'1','Content-Type':'application/json'},body:JSON.stringify({text:'Reply with the word okay.',lang:'en'})});
  if(!speech.ok)throw Error(await speech.text());
  const wav=Buffer.from(await speech.arrayBuffer());let offset=12,pcm;
  while(offset+8<=wav.length){const n=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data')pcm=wav.subarray(offset+8,offset+8+n);offset+=8+n+(n%2);}
  const samples=new Float32Array(pcm.length/2+32000);for(let i=0;i<pcm.length/2;i++)samples[i]=pcm.readInt16LE(i*2)/32768;
  fs.writeFileSync(env.NEXUS_FAKE_AUDIO,Buffer.from(core.encodeWav([samples],16000)));
  const steps=[{until:'typeof state!=="undefined" && state.booted && state.sessions.length===2 && $("#app").classList.contains("settled")'}];
  const js=code=>steps.push({js:code}),until=code=>steps.push({until:code}),shot=name=>steps.push({shot:name}),click=selector=>steps.push({click:selector}),check=(test,label)=>js(`voiceCheck(${test},${JSON.stringify(label)})`);
  js("select('claude:voice-claude',{tab:'chat'})");until("chatFor().loaded && !!$('#steerIn')");shot('chat');
  if(baseline||uxOnly){
    if(!baseline){check("document.documentElement.scrollWidth<=innerWidth",'chat fits viewport');check("$('[data-steer=talk]').getBoundingClientRect().height>=44 && $('[data-steer=send]').getBoundingClientRect().height>=44",'composer targets are 44px');check("Math.abs($('[data-steer=send]').getBoundingClientRect().right-$('.steer-buttons').getBoundingClientRect().right)<2",'Send is at the right edge of the composer');}
    js('finder()');until("!!$('.session-preview')");shot('sessions');js('closeModal();setView("overview")');steps.push({wait:500});shot('home');
    if(!baseline){
      check("document.documentElement.scrollWidth<=innerWidth",'Home fits viewport');
      js("window.uxMetrics={muted:getComputedStyle(document.documentElement).getPropertyValue('--muted'),dim:getComputedStyle(document.documentElement).getPropertyValue('--dim'),smallText:[...document.querySelectorAll('#overview *')].filter(e=>e.getBoundingClientRect().height&&getComputedStyle(e).fontSize.replace('px','')<12&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,50),size:getComputedStyle(e).fontSize}))};console.log('METRICS',JSON.stringify(uxMetrics));");
      js("select('claude:voice-claude');$('#steerIn').value='';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}))");
      check("$('[data-steer=send]').disabled && $('[data-steer=send]').title.includes('Write')",'empty Send has a reason');
      steps.push({viewport:[320,844]});shot('chat-320');check("document.documentElement.scrollWidth<=innerWidth",'320px no page overflow');
      steps.push({viewport:[430,932]});shot('chat-430');check("document.documentElement.scrollWidth<=innerWidth",'430px no page overflow');
      steps.push({media:{features:[{name:'prefers-reduced-motion',value:'reduce'}]}});shot('reduced-motion');
    }
  }else{
    js("$('#steerIn').value='Reply with the word okay.';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}))");
    click('[data-steer=talk]');until("NexusVoice.status==='listening'");shot('listening');
    until("NexusVoice.status==='transcribing'");shot('transcribing');
    until("$('#talkState')?.textContent.includes('Sent')");shot('sent-working');
    check("$('#talkHeard').textContent.includes('Reply with the word okay')",'heard text is shown');
    until("NexusVoice.status==='speaking'");shot('speaking');
    check("voiceTour.spoken.at(-1)==='Okay. The voice message arrived. Full reply is in the chat.'",'gist strips code and limits spoken reply');
    until("NexusVoice.status==='your-turn'");steps.push({shot:'your-turn',shotDelay:0});until("NexusVoice.status==='listening'");shot('listening-again');
    click('[data-talk=end]');
    check("$('#steerIn').value==='Reply with the word okay.'",'voice preserves even an identical typed draft');
    check("voiceTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))",'End releases microphone');
    steps.push({voiceText:'Show a question'});click('[data-steer=talk]');until("NexusVoice.status==='listening'");steps.push({wait:1100});click('[data-talk=send]');
    until("NexusVoice.status==='speaking' && !!$('.permission-card')");shot('question-spoken');
    check("voiceTour.spoken.at(-1).includes('Say one, two or three')",'question and options spoken');
    steps.push({voiceText:'dos'});click('#talkState');until("NexusVoice.status==='listening'");shot('barge-in');steps.push({wait:1000});click('[data-talk=send]');
    until("voiceTour.actions.some(a=>a.answer==='2')");until("$('#chatMessages').textContent.includes('Your answer was received')");shot('question-answered');
    check("!voiceTour.actions.some(a=>a.text==='dos')",'spoken Spanish answer uses guarded question path');click('[data-talk=end]');
    js("select('astra:voice-astra',{tab:'chat'})");until('chatFor().loaded');steps.push({voiceText:'Reply with the word okay.'});click('[data-steer=talk]');until("NexusVoice.status==='listening'");steps.push({wait:1000});click('[data-talk=send]');until("$('#talkState')?.textContent==='Sent · Astra is working'");shot('astra-working');until("NexusVoice.status==='speaking'");shot('astra-speaking');until("NexusVoice.status==='listening'");click('[data-talk=end]');
    check("voiceTour.actions.some(a=>a.action==='term-resume'&&a.key==='astra:voice-astra')",'Astra uses same saved-session conversation path');
    if(width<=700)click('[data-nav=more]');else click('#appMenuBtn');until("!!$('[data-menu=voice]')");shot('more');click('[data-menu=voice]');until("NexusVoice.status==='listening'");shot('voice-check-recording');until("NexusVoice.status==='checked'");shot('voice-check');
    check("$('#voiceResults').textContent.includes('PC ') && $('#talkHeard').textContent.includes('Reply')",'Voice check completes recording, playback, round trip, TTS');
    js("window.nativeSpeak=speechSynthesis.speak;speechSynthesis.speak=()=>{}");click('[data-talk=retry]');until("NexusVoice.status==='checked' && voiceTour.tts>0");shot('voice-check-pc-playback');check("voiceTour.tts>0",'native speech failure falls back to hidden SAPI and Web Audio playback');click('[data-talk=end]');js('speechSynthesis.speak=nativeSpeak');
    js("pref.set('voiceServerSpeech','off');select('claude:voice-claude')");until('chatFor().loaded');
    click('[data-steer=talk]');until("NexusVoice.status==='listening'");js("select('astra:voice-astra')");until("NexusVoice.status==='off'");check("voiceTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))",'switching sessions cancels voice capture');
    js("window.previousMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'))");
    click('[data-steer=talk]');until("NexusVoice.status==='error'");shot('permission-error');check("$('#talkHint').textContent.includes('Allow the microphone')",'permission error explains the fix');click('[data-talk=end]');js('navigator.mediaDevices.getUserMedia=previousMedia');
    js("window.beforeCancel=voiceTour.actions.filter(a=>a.action==='term-send').length");click('[data-steer=talk]');until("NexusVoice.status==='listening'");steps.push({wait:1000});click('[data-talk=send]');until("NexusVoice.status==='transcribing'");click('[data-talk=end]');steps.push({wait:1500});
    check("voiceTour.actions.filter(a=>a.action==='term-send').length===beforeCancel",'End during transcription prevents sending');
    js("navigator.mediaDevices.getUserMedia=options=>previousMedia(options).then(stream=>new Promise(resolve=>setTimeout(()=>resolve(stream),1000)))");click('[data-steer=talk]');click('[data-talk=end]');steps.push({wait:1500});
    check("voiceTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')) && NexusVoice.status==='off'",'late microphone permission is released after End');js('navigator.mediaDevices.getUserMedia=previousMedia');
    js("window.savedResume=AudioContext.prototype.resume;window.resumeCount=0;AudioContext.prototype.resume=function(){return ++resumeCount===2?Promise.reject(Error('Audio playback is blocked. Try again.')):savedResume.apply(this,arguments)}");
    click('[data-steer=talk]');until("NexusVoice.status==='error'");check("voiceTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))",'audio setup failure releases an already acquired microphone');click('[data-talk=end]');js('AudioContext.prototype.resume=savedResume');
    check("document.documentElement.scrollWidth<=innerWidth",'whole voice tour fits viewport');
  }
  fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(steps,null,2));
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tools/cdp-tour.mjs',out],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);child.once('exit',code=>{fs.writeFileSync(path.join(out,'checks.txt'),log);code?reject(Error(log)):resolve();});});
  console.log('PASS tour '+out);
}finally{await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);server.kill();});cleanup(f.root);}
