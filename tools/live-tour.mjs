import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./redesign-fixture.cjs'),core=require('../public/voice-core');
const run=(file,args,options={})=>new Promise((r,j)=>{const p=spawn(file,args,{windowsHide:true,stdio:'inherit',...options});p.once('error',j);p.once('exit',c=>c?j(Error('Helper exited '+c)):r());});
if(!process.argv[2]){for(const width of [1568,440,1920,390])await run(process.execPath,['tools/live-tour.mjs',String(width)]);process.exit(0);}
await new Promise((r,j)=>{const s=net.createServer();s.once('error',j);s.listen(4785,'127.0.0.1',()=>s.close(r));});
const {root,env}=fixture();console.log('Live fixture: '+root);env.NEXUS_PORT='4785';env.NEXUS_COPILOT_DIR=path.join(root,'copilot');env.COPILOT_HOME=env.NEXUS_COPILOT_DIR;env.CODEX_HOME=path.join(root,'codex');
fs.writeFileSync(path.join(root,'stub-model'),'fixture');fs.writeFileSync(path.join(root,'utterance.txt'),'Hello, what is the status?');
// Real SAPI PCM with both language texts. No Spanish SAPI voice is installed on
// the commissioning PC; this tests capture/endpointing, not Spanish STT accuracy.
let pieces=[];for(const [i,lang,text] of (process.argv.includes('--latency')?[[0,'en','Hello, what is the current status?']]:[[0,'en','Hello, what is the status?'],[1,'es','Dile al agente que revise las pruebas.']])){
 const input=path.join(root,'sapi-'+i+'.json'),output=path.join(root,'sapi-'+i+'.wav');fs.writeFileSync(input,JSON.stringify({lang,text}));await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('tools/voice-tts.ps1'),'-InputFile',input,'-OutputFile',output],{stdio:'ignore'});
 const wav=fs.readFileSync(output);let pcm;for(let at=12;at+8<=wav.length;){const n=wav.readUInt32LE(at+4);if(wav.toString('ascii',at,at+4)==='data')pcm=wav.subarray(at+8,at+8+n);at+=8+n+(n%2);}const floats=new Float32Array(pcm.length/2);for(let j=0;j<floats.length;j++)floats[j]=pcm.readInt16LE(j*2)/32768;pieces.push(floats,new Float32Array(16000*5));
}
const all=new Float32Array(pieces.reduce((n,x)=>n+x.length,0));let offset=0;for(const p of pieces){all.set(p,offset);offset+=p.length;}const fake=path.join(root,'capture.wav');fs.writeFileSync(fake,Buffer.from(core.encodeWav([all],16000)));
const source=path.join(root,'browser.js');fs.writeFileSync(source,`
window.liveTour={streams:[],sentences:[],turns:[],starts:0,stops:0,cancels:0,tts:[],first:0};window.check=(ok,why)=>{if(!ok)throw Error(why);console.log('PASS '+why);};
const realMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async opts=>{check(opts.audio.echoCancellation&&opts.audio.noiseSuppression,'echo and noise controls requested');const stream=await realMedia(opts);liveTour.streams.push(stream);return stream;};
const realFetch=window.fetch.bind(window);window.fetch=async(url,opts={})=>{const route=new URL(url,location.href).pathname;
if(route==='/api/live/start')liveTour.starts++;if(route==='/api/live/stop')liveTour.stops++;if(route==='/api/live/cancel')liveTour.cancels++;
if(route==='/api/live/turn'){const body=JSON.parse(opts.body);liveTour.turns.push(body);}
if(route==='/api/voice/tts'){liveTour.tts.push(JSON.parse(opts.body));check(liveTour.streams.some(s=>s.getTracks().some(t=>t.readyState==='live')),'capture stays live during speech');}
if(route==='/api/action'&&!['viewed','term-resume','term-send'].includes(JSON.parse(opts.body).action))throw Error('Fixture action refused');return realFetch(url,opts);};
localStorage.setItem('nexus.voiceServerSpeech','on');localStorage.setItem('nexus.callMode','live');
`);
const width=+process.argv[2],height=width===440?956:width===390?844:width===1920?1080:773,out=path.resolve('.local','live-shots',process.argv.includes('--edges')?'edges':process.argv.includes('--latency')?'latency':'',String(width));fs.mkdirSync(out,{recursive:true});
if(process.argv.includes('--latency'))env.NEXUS_LIVE_WHISPER=fs.readFileSync(path.join(process.env.LOCALAPPDATA,'NexusDeck/whisper/install.json'),'utf8').replace(/^\uFEFF/,'');
const server=spawn(process.execPath,['--require',process.argv.includes('--latency')?'./tools/live-latency-preload.cjs':'./tools/live-preload.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
try{
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Server timeout')),15000);server.stdout.on('data',d=>{if(String(d).includes('4785/')){clearTimeout(timer);r();}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>j(Error('Server exited '+c)));});
 const steps=[{viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{js:`select('claude:s-dashboard');window.sessionKeys=state.sessions.map(keyOf).sort().join(',');const realAdapter=NexusVoice.callAudio;NexusVoice.callAudio=(...args)=>{const a=realAdapter(...args),stop=a.stopSpeech,speak=a.speak;a.speak=async (...speechArgs)=>{liveTour.speaking=true;try{return await speak(...speechArgs);}finally{liveTour.speaking=false;}};a.stopSpeech=()=>{if(liveTour.speaking)liveTour.bargeStop=performance.now()-liveTour.ownerOnset;return stop();};return a;};const realCapture=NexusLiveAudio.open;NexusLiveAudio.open=opts=>{const start=opts.onStart;opts.onStart=()=>{liveTour.ownerOnset=performance.now();start();};return realCapture(opts);};`},{until:`chatFor().loaded`},{shot:'before'},
 {click:'[data-steer="talk"]'},{until:`NexusCall.status==='listening'`},{shot:'listening'},
 {until:`liveTour.tts.length>=1`},{shot:'speaking'},
 {js:`check(liveTour.starts===1,'one brain process starts with the call');check(document.querySelector('#nxCallMeta').textContent.includes('Live'),'Live is the default');`},
 {fixtureText:'Tell the agent to review the call.'},{until:`liveTour.turns.some(t=>t.text==='Tell the agent to review the call.')`},
 {until:`liveTour.tts.some(s=>s.text.startsWith('I relayed:'))`},{shot:'relay'},{js:`liveTour.streams.forEach(s=>s.getTracks().forEach(t=>t.enabled=false));`},
 {until:`liveTour.tts.some(s=>s.text==='The agent is running the tests.')`},{shot:'progress'},
 {fixtureText:'Hello, what is the status?'},{js:`liveTour.streams.forEach(s=>s.getTracks().forEach(t=>t.enabled=true));`},{until:`liveTour.tts.some(s=>s.text.includes('interrupt me'))`},
 {js:`window.bargeBefore=liveTour.cancels;`},{until:`liveTour.cancels>bargeBefore`},{shot:'barge-in'},
 {until:`!!document.querySelector('#nxCallQuestion:not([hidden])')`},{fixtureText:'dos'},{shot:'question'},
 {until:`liveTour.tts.some(s=>s.text.includes('opcion 2')||s.text.includes('option 2'))`},{shot:'answered'},{js:`check(liveTour.tts.some(s=>s.lang==='es'&&s.text.includes('opcion 2')),'Spanish choice keeps Spanish playback language');`},
 {click:'.nx-call-debug summary'},{js:`document.querySelector('.nx-call-debug').scrollIntoView({block:'end'});`},{shot:'timing'},
 {js:`check(document.querySelector('#nxCallLatency').textContent.includes('ms'),'latency drawer has measured stages');check(liveTour.starts===1,'warm brain survives all turns and barge-in');check(Number.isFinite(liveTour.bargeStop)&&liveTour.bargeStop<150,'speech interruption is under 150 ms after detected onset');check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');console.log('PASS timing '+document.querySelector('#nxCallLatency').textContent);`},
 {click:'[data-call="end"]'},{until:`NexusCall.status==='ended'`},{wait:600},{js:`check(liveTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),'End releases microphone');check(liveTour.stops===1,'End stops brain');check(state.sessions.map(keyOf).sort().join(',')===sessionKeys,'voice brain never appears in session lists');`},{shot:'ended'}];
 if(process.argv.includes('--edges'))steps.splice(0,steps.length,
 {viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{js:`select('claude:s-dashboard')`},{until:`chatFor().loaded`},
 {click:'[data-steer="talk"]'},{until:`NexusCall.status==='listening'`},{click:'[data-call="mute"]'},{until:`NexusCall.status==='muted'`},{js:`check(liveTour.starts===1,'Mute keeps the brain warm');check(liveTour.streams.every(s=>s.getTracks().every(t=>!t.enabled)),'Mute disables live capture');`},
 {click:'[data-call="minimize"]'},{js:`select('astra:s-voice');check(NexusCall.key==='claude:s-dashboard','minimized call remains bound to original session');`},{click:'#nxCallPill button'},
 {js:`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));`},{until:`NexusCall.status==='paused'`},{wait:500},{js:`check(liveTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),'hidden page releases microphone');check(liveTour.stops===1,'hidden page ends brain lease immediately');Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));`},
 {click:'[data-call="resume"]'},{until:`liveTour.starts===2&&liveTour.streams.length===2`},{click:'[data-call="end"]'},{wait:600},{js:`NexusCall.dismiss();window.oldMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));`},
 {js:`NexusCall.start('claude:s-dashboard')`},{until:`NexusCall.status==='error'`},{js:`check(document.querySelector('#nxCallHint').textContent.includes('Allow microphone'),'permission failure has recovery');`},{click:'[data-call="end"]'},{wait:500},{js:`NexusCall.dismiss();navigator.mediaDevices.getUserMedia=opts=>oldMedia(opts).then(s=>new Promise(r=>setTimeout(()=>r(s),1200)));`},
 {js:`NexusCall.start('claude:s-dashboard')`},{until:`liveTour.streams.length===3`},{click:'[data-call="end"]'},{wait:1600},{js:`check(liveTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),'late microphone permission cannot survive End');NexusCall.dismiss();navigator.mediaDevices.getUserMedia=oldMedia;`},
 {fixtureText:'live-unavailable'},{js:`NexusCall.start('claude:s-dashboard')`},{until:`document.querySelector('#nxCallMeta').textContent.includes('Turn-by-turn')`},{until:`NexusCall.status==='listening'`},{shot:'fallback'},{js:`check(document.querySelector('#nxCallMeta').textContent.includes('Turn-by-turn'),'brain unavailable falls back to original Call');`},{click:'[data-call="end"]'},{wait:500},{js:`check(liveTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),'fallback End releases microphone');`}
 );
 if(process.argv.includes('--latency'))steps.splice(0,steps.length,
 {viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{js:`select('claude:s-dashboard');liveTour.timings=[];const originalLive=NexusLiveCall.open;NexusLiveCall.open=(key,hooks)=>{const report=hooks.latency;hooks.latency=value=>{report(value);if(value.measured&&!liveTour.timings.some(t=>t.speechEnd===value.speechEnd))liveTour.timings.push(value);};return originalLive(key,hooks);};`},{until:`chatFor().loaded`},
 {click:'[data-steer="talk"]'},{until:`liveTour.timings.length>=4`},{click:'.nx-call-debug summary'},{js:`document.querySelector('.nx-call-debug').scrollIntoView({block:'end'});console.log('PASS replay latencies '+JSON.stringify(liveTour.timings));`},{shot:'timing'},
 {click:'[data-call="end"]'},{wait:500},{js:`check(liveTour.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),'replay End releases microphone');`}
 );
 if(process.argv.includes('--layout'))steps.splice(0,steps.length,
 {viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{js:`select('claude:s-dashboard')`},{until:`chatFor().loaded`},{fixtureText:'Tell the agent to review a quick question.'},
 {click:'[data-steer="talk"]'},{until:`!!document.querySelector('#nxCallQuestion:not([hidden])')`},{shot:'question'},
 {js:`const footer=document.querySelector('.nx-call-controls').getBoundingClientRect();check([...document.querySelectorAll('#nxCallQuestion>div button')].every(b=>b.getBoundingClientRect().bottom<=footer.top&&b.getBoundingClientRect().height>=44),'all question choices visible above controls');`},{click:'[data-call="end"]'},{wait:500}
 );
 const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));
 await run(process.execPath,['tools/redesign-browser.mjs','4785',out,file],{env:{...env,NEXUS_TOUR_SOURCE:source,NEXUS_CALL_TOUR:'1',NEXUS_ROUND2_AUDIO:'1',NEXUS_FAKE_AUDIO:fake}});
 if(fs.existsSync(path.join(root,'live-log.jsonl')))fs.copyFileSync(path.join(root,'live-log.jsonl'),path.join(out,'live-log.jsonl'));fs.copyFileSync(path.join(root,'call-log.jsonl'),path.join(out,'terminal-log.jsonl'));console.log('PASS live tour '+width+' fixture '+root);
}finally{for(const name of ['live-log.jsonl','call-log.jsonl'])if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(out,name));server.kill();}
