import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./redesign-fixture.cjs'),core=require('../public/voice-core');
if(!process.argv[2]){for(const width of [1568,1920,440])await new Promise((r,j)=>{const p=spawn(process.execPath,['tools/call-tour.mjs',String(width)],{windowsHide:true,stdio:'inherit'});p.once('exit',c=>c?j(Error('Call tour failed '+width)):r());});process.exit(0);}
await new Promise((r,j)=>{const probe=net.createServer();probe.once('error',j);probe.listen(4791,'127.0.0.1',()=>probe.close(r));});
const {root,env}=fixture();console.log('Call fixture: '+root);
fs.writeFileSync(path.join(root,'stub-model'),'fixture');fs.writeFileSync(path.join(root,'utterance.txt'),'Please review the call.');
const sapiRequest=path.join(root,'sapi.json'),sapiWav=path.join(root,'speech.wav');fs.writeFileSync(sapiRequest,JSON.stringify({text:'Please review the call.',lang:'en'}));
await new Promise((r,j)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tools/voice-tts.ps1'),'-InputFile',sapiRequest,'-OutputFile',sapiWav],{windowsHide:true,stdio:'pipe'});p.once('exit',c=>c?j(Error('SAPI failed')):r());});
const wav=fs.readFileSync(sapiWav);let pcm;for(let at=12;at+8<=wav.length;){const n=wav.readUInt32LE(at+4);if(wav.toString('ascii',at,at+4)==='data')pcm=wav.subarray(at+8,at+8+n);at+=8+n+(n%2);}
const samples=new Float32Array(pcm.length/2+16000*8);for(let i=0;i<pcm.length/2;i++)samples[i]=pcm.readInt16LE(i*2)/32768;const fake=path.join(root,'capture.wav');fs.writeFileSync(fake,Buffer.from(core.encodeWav([samples],16000)));
const source=path.join(root,'browser-source.js');fs.writeFileSync(source,`
window.callTour={streams:[],actions:[],spoken:[],wakeRequests:0,wakeReleases:0};
window.check=(ok,why)=>{if(!ok)throw Error(why);console.log('PASS '+why);};
const realMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async options=>{const stream=await realMedia(options);callTour.streams.push(stream);return stream;};
Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{async request(){callTour.wakeRequests++;return {addEventListener(){},async release(){callTour.wakeReleases++;}};}}});
window.allStopped=()=>callTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'));
const realFetch=window.fetch.bind(window);window.fetch=(url,options={})=>{const route=new URL(url,location.href).pathname;
 if(route==='/api/action'){const data=JSON.parse(options.body);callTour.actions.push(data);if(!['viewed','term-resume','term-send'].includes(data.action))throw Error('Nonfixture action refused: '+data.action);}
 if(route==='/api/voice/tts'){check(allStopped(),'microphone stopped before speech');callTour.spoken.push({text:JSON.parse(options.body).text,at:Date.now()});}
 return realFetch(url,options);};
localStorage.setItem('nexus.voiceSilence','1300');localStorage.setItem('nexus.voiceServerSpeech','on');
`);
const server=spawn(process.execPath,['--require','./tools/call-preload.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});process.on('exit',()=>server.kill());
try{
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Server timeout')),15000);server.stdout.on('data',d=>{if(String(d).includes('4791/')){clearTimeout(timer);r();}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>j(Error('Server exited '+c)));});
 const sizes=[[+process.argv[2],+process.argv[2]===440?956:+process.argv[2]===1920?1080:773]];
 for(const [width,height] of sizes){
  fs.writeFileSync(path.join(root,'utterance.txt'),'Please review the call.');
  const out=path.resolve(process.argv.includes('--edges')?'docs/shots/call/edges':'docs/shots/call/live',String(width));fs.mkdirSync(out,{recursive:true});
  const steps=[{viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{js:`select('claude:s-dashboard')`},{until:`chatFor().loaded`},{shot:'entry-session'},
   {click:'[data-steer="talk"]'},{until:`NexusCall.status==='listening'`},{shot:'listening'},{js:`check(callTour.actions.some(a=>a.action==='term-resume'&&a.key==='claude:s-dashboard'),'saved session resumes on Call');`},
   {until:`callTour.actions.some(a=>a.action==='term-send'&&a.text==='Please review the call.')`},{shot:'thinking'},
   {until:`NexusCall.status==='working'`},{shot:'working'},
   {until:`callTour.spoken.some(s=>s.text.startsWith('Still on it:'))`},{shot:'progress'},
   {until:`!!document.querySelector('#nxCallQuestion:not([hidden])')`},{shot:'question'},{fixtureText:'dos'},
   {until:`NexusCall.status==='listening'`},{until:`callTour.actions.some(a=>a.answer==='2')`},
   {until:`callTour.spoken.some(s=>s.text.startsWith('Done.'))`},{shot:'speaking'},
   {until:`NexusCall.status==='listening'`},{js:`check(!callTour.actions.some(a=>a.text==='dos'),'Spanish answer uses guarded option path');check(callTour.spoken.filter(s=>s.text.startsWith('Still on it:')).length===1,'one progress update for unchanged activity');`},
   {click:'[data-call="mute"]'},{until:`NexusCall.status==='muted'`},{js:`check(allStopped(),'Mute releases every microphone track');`},{shot:'muted'},
   {click:'[data-call="captions"]'},{js:`check(document.querySelector('#nxCallCaptions').hidden,'captions toggle');`},{click:'[data-call="captions"]'},
   {click:'[data-call="minimize"]'},{js:`setView('overview');check(NexusCall.active&&!document.querySelector('#app').inert,'call survives navigation');`},{shot:'pill'},
   {js:`select('astra:s-voice')`},{click:'#nxCallPill button'},{js:`check(NexusCall.key==='claude:s-dashboard','call stays bound while another session is selected');`},{shot:'reopened'},
   {click:'[data-call="interrupt"]'},{until:`callTour.actions.some(a=>a.answer==='esc')`},{js:`check(callTour.actions.filter(a=>a.answer==='esc').at(-1).term===callTour.actions.find(a=>a.text==='Please review the call.').term,'Interrupt targets original session');`},
   {click:'[data-call="end"]'},{until:`document.querySelector('#nxCallEnded').textContent.includes('2 files updated')`},{shot:'ended'},{js:`check(allStopped(),'End releases microphone');check(callTour.wakeReleases>0,'End releases wake lock');`},
   {click:'[data-call="conversation"]'},{js:`check(state.sel==='claude:s-dashboard'&&NexusCall.status==='off','Open conversation returns to called session');`},
   {js:`setView('overview');`},{shot:'entry-home'},{js:`setView('wall');`},{shot:'entry-wall'},
   {js:`const s=state.byKey.get('claude:s-deploy');nx.seen.set(keyOf(s),'busy');nx.attentionReady=true;s.needsInput=true;s.status='waiting';renderCards();`},{until:`!!document.querySelector('#nxIncomingCall')`},{shot:'incoming'},{click:'#nxIncomingCall .dismiss'},
   {js:`renderCards();check(!document.querySelector('#nxIncomingCall'),'dismissed prompt does not repeat');pref.set('attention','off');NexusCall.incoming(state.byKey.get('claude:s-dashboard'));check(!document.querySelector('#nxIncomingCall'),'notification preference respected');pref.set('attention','on');`},
   {fixtureText:'Quick reply please.'},{js:`select('astra:s-voice');`},{until:`chatFor().loaded`},{click:'[data-steer="talk"]'},{until:`NexusCall.status==='listening'`},{shot:'astra-listening'},
   {until:`callTour.spoken.some(s=>s.text.startsWith('Ready.'))`},{shot:'astra-speaking'},{click:'[data-call="core"]'},{until:`NexusCall.status==='listening'`},{js:`check(NexusCall.key==='astra:s-voice','barge-in listens on same Astra call');`},
   {js:`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));check(allStopped(),'page hiding releases microphone');Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));`},{until:`NexusCall.status==='paused'`},{shot:'paused'},{js:`check(allStopped(),'returning page waits for Resume before capture');check(callTour.wakeRequests>=3,'visible call reacquires wake lock');`},
   {click:'[data-call="resume"]'},{until:`NexusCall.status==='listening'`},{click:'[data-call="end"]'},{js:`NexusCall.dismiss();window.oldMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));`},
   {click:'[data-steer="talk"]'},{until:`NexusCall.status==='error'`},{shot:'permission-error'},{js:`check(document.querySelector('#nxCallHint').textContent.includes('Allow microphone'),'permission error has recovery');`},{click:'[data-call="end"]'},{js:`NexusCall.dismiss();navigator.mediaDevices.getUserMedia=opts=>oldMedia(opts).then(s=>new Promise(r=>setTimeout(()=>r(s),1000)));`},
   {click:'[data-steer="talk"]'},{wait:200},{click:'[data-call="end"]'},{wait:1300},{js:`check(allStopped(),'late permission after End cannot retain microphone');NexusCall.dismiss();navigator.mediaDevices.getUserMedia=oldMedia;`},
   {click:'[data-steer="talk"]'},{until:`NexusCall.status==='listening'`},{js:`window.beforeEnd=callTour.actions.filter(a=>a.text).length;`},{wait:1100},{click:'[data-call="core"]'},{until:`NexusCall.status==='thinking'`},{click:'[data-call="end"]'},{wait:1800},{js:`check(callTour.actions.filter(a=>a.text).length===beforeEnd,'End during transcription cannot send');NexusCall.dismiss();check(document.documentElement.scrollWidth<=innerWidth,'call screens fit viewport');'PASS call tour ${width}';`}
  ];
  if(process.argv.includes('--edges'))steps.splice(0,steps.length,
   {viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{fixtureText:'Quick question please.'},
   {js:`select('astra:s-voice');NexusCall.incoming(state.byKey.get('claude:s-deploy'));`},{click:'#nxIncomingCall .answer'},{until:`NexusCall.status==='listening'`},
   {js:`check(NexusCall.key==='claude:s-deploy','incoming Answer opens the intended call');check(state.sel==='astra:s-voice','call entry does not change the selected session');`},
   {click:'[data-call="minimize"]'},{until:`callTour.actions.some(a=>a.text==='Quick question please.')`},{js:`check(callTour.actions.find(a=>a.action==='term-resume').key==='claude:s-deploy','minimized voice stays bound to called session');`},
   {click:'#nxCallPill button'},{until:`!!document.querySelector('#nxCallQuestion:not([hidden])')`},
   {js:`window.beforeChoice=callTour.actions.length;window.option=document.querySelector('[data-call-answer="1"]');window.signature=option.dataset.signature;option.dataset.signature='stale';option.click();check(callTour.actions.length===beforeChoice,'stale option card cannot answer');option.dataset.signature=signature;`},
   {click:'[data-call-answer="1"]'},{until:`callTour.actions.some(a=>a.answer==='1')`},{js:`check(allStopped(),'tap answer cancels recording and speech');`},
   {until:`callTour.spoken.some(s=>s.text.startsWith('Done.'))`},{click:'[data-call="speaker"]'},{until:`NexusCall.status==='listening'`},
   {js:`check(document.querySelector('[data-call="speaker"]').getAttribute('aria-pressed')==='false','Speaker turns output off');`},
   {click:'[data-call="mute"]'},{until:`NexusCall.status==='muted'`},{js:`document.querySelector('[data-call-progress]').click();check(pref.get('callNarration')==='off','progress switch persists preference');`},{shot:'controls'},
   {js:`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(!!document.querySelector('#nxCallPill'),'Escape minimizes');`},{click:'#nxCallPill button'},
   {click:'[data-call="mute"]'},{until:`NexusCall.status==='listening'`},{js:`window.dispatchEvent(new PageTransitionEvent('pagehide'));check(allStopped()&&!NexusCall.active,'navigation away releases microphone and ends call');`},
   {js:`const s=state.byKey.get('claude:s-deploy');chatFor(keyOf(s)).terminal={ready:true};s.needsInput=true;nx.seen.set(keyOf(s),'done');renderCards();check(!!document.querySelector('#nxIncomingCall'),'fresh question overrides an old cached ready screen');document.querySelector('#nxIncomingCall .dismiss').click();`},
   {js:`const bad=await fetch('/api/recap?key=claude:s-deploy&since=-1');check(bad.status===400,'invalid call recap boundary rejected');select('claude:s-dashboard');`},
   {click:'[data-steer="talk"]'},{click:'[data-call="mute"]'},{until:`NexusCall.status==='muted'`},{js:`check(allStopped(),'Mute during connection does not capture');`},{click:'[data-call="end"]'},{js:`NexusCall.dismiss();setView('settings');NexusVoice.check(true);`},{until:`NexusVoice.status==='checked'`},{shot:'voice-check'},
   {js:`check(Object.values(NexusVoice.checks).every(c=>c.phase==='pass'),'Voice check still completes all four local steps');NexusVoice.end();check(allStopped(),'Voice check cleanup');'PASS call edge tour';`}
  );
  else if(width===440)steps.push({viewport:[320,700]},{js:`select('claude:s-dashboard');NexusCall.start(state.sel);`},{until:`NexusCall.status==='listening'`},{shot:'320'},{js:`check(document.documentElement.scrollWidth<=innerWidth,'320px no page overflow');NexusCall.end();`});
  const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));
  await new Promise((r,j)=>{const p=spawn(process.execPath,['tools/redesign-browser.mjs','4791',out,file],{env:{...env,NEXUS_TOUR_SOURCE:source,NEXUS_CALL_TOUR:'1',NEXUS_ROUND2_AUDIO:'1',NEXUS_FAKE_AUDIO:fake},windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',d=>{log+=d;process.stdout.write(d);});p.stderr.on('data',d=>{log+=d;process.stderr.write(d);});p.once('exit',code=>{fs.writeFileSync(path.join(out,'checks.txt'),log);code?j(Error('Call tour failed '+width)):r();});});
 }
}finally{server.kill();}
