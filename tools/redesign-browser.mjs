// Headless, owned-browser CDP harness. 4793 is exclusively the throwaway v0 reference.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const [port, output, script] = process.argv.slice(2);
if (!['4783','4785','4786','4787','4788','4790','4791','4793'].includes(port)) throw Error('Private test ports only');
const out = path.resolve(output); fs.mkdirSync(out,{recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'nexus-redesign-browser-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',...(process.env.NEXUS_ROUND2_AUDIO==='1'?['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']:[]),...(process.env.NEXUS_FAKE_AUDIO?['--use-file-for-fake-audio-capture='+process.env.NEXUS_FAKE_AUDIO]:[]),'--mute-audio','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'], {windowsHide:true,stdio:'ignore'});
process.on('exit',()=>browser.kill());
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const logs=[]; let socket;
try {
  for(let i=0;!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++){if(i>100)throw Error('Browser did not start');await sleep(100);}
  const debug=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const targets=await(await fetch(`http://127.0.0.1:${debug}/json`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
  let id=0;const pending=new Map();
  const events=new Map();
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method))},30000);pending.set(key,d=>{clearTimeout(timer);d.error?reject(Error(JSON.stringify(d.error))):resolve(d.result)});socket.send(JSON.stringify({id:key,method,params}))});
  socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){pending.get(d.id)?.(d);pending.delete(d.id)}events.get(d.method)?.(d.params);if(d.method==='Runtime.exceptionThrown')logs.push(d.params.exceptionDetails);if(d.method==='Runtime.consoleAPICalled'&&process.env.NEXUS_CALL_TOUR==='1'){const line=d.params.args.map(a=>a.value||'').join(' ');if(line.startsWith('PASS '))console.log(line);}};
  const js=async expression=>{const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  await cmd('Runtime.enable');await cmd('Page.enable');await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});
  if(process.env.NEXUS_PARITY_BASELINE){
    if(!['4785','4786','4791'].includes(port))throw Error('Baseline assets require a private fixture');
    const assets=JSON.parse(fs.readFileSync(process.env.NEXUS_PARITY_BASELINE,'utf8'));
    events.set('Fetch.requestPaused',async event=>{
      const url=new URL(event.request.url),key=url.pathname==='/'?'index.html':url.pathname.slice(1);
      const asset=assets[key];
      if(!asset)return cmd('Fetch.continueRequest',{requestId:event.requestId});
      await cmd('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:asset.type}],body:asset.body});
    });
    await cmd('Fetch.enable',{patterns:[{urlPattern:`http://127.0.0.1:${port}/*`,requestStage:'Request'}]});
  }
  if(process.env.NEXUS_TOUR_SOURCE)await cmd('Page.addScriptToEvaluateOnNewDocument',{source:fs.readFileSync(process.env.NEXUS_TOUR_SOURCE,'utf8')});
  const steps=JSON.parse(fs.readFileSync(script,'utf8').replace(/^\uFEFF/,''));
  for(const step of steps){
    if(step.fixtureText!==undefined){const root=fs.realpathSync(process.env.NEXUS_REDESIGN_FIXTURE||'');if(!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep)||!path.basename(root).startsWith('nexus-redesign-'))throw Error('Invalid fixture path');fs.writeFileSync(path.join(root,'utterance.txt'),step.fixtureText);}
    if(step.viewport){const [width,height]=step.viewport;await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:step.dpr||1,mobile:width<=700});await cmd('Emulation.setTouchEmulationEnabled',{enabled:width<=700});}
    if(step.navigate!==undefined)await cmd('Page.navigate',{url:`http://${port==='4793'?'localhost':'127.0.0.1'}:${port}${step.navigate||'/'}`});
    if(step.until){const start=Date.now();while(!await js(step.until)){if(Date.now()-start>60000)throw Error('Timed out: '+step.until+' '+await js('document.body.innerText.slice(0,1000)'));await sleep(150)}}
    if(step.wait)await sleep(step.wait);
    if(step.js){const result=await js(/\bawait\b/.test(step.js)?`(async()=>{${step.js}})()`:step.js);if(result!==undefined)console.log(JSON.stringify(result));}
    if(step.icon){const result=await js(`(async()=>{const img=new Image();img.src=${JSON.stringify(step.icon.source||'/icon.svg')};await img.decode();const c=document.createElement('canvas');c.width=c.height=${step.icon.size};c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1]})()`);fs.writeFileSync(path.join(out,step.icon.name),Buffer.from(result,'base64'));}
    if(step.click)await js(`document.querySelector(${JSON.stringify(step.click)}).click()`);
    if(step.text)await js(`Array.from(document.querySelectorAll('button,a,[role=radio]')).find(e=>e.textContent.trim()===${JSON.stringify(step.text)}).click()`);
    if(step.media)await cmd('Emulation.setEmulatedMedia',step.media);
    if(step.safeArea)await cmd('Emulation.setSafeAreaInsetsOverride',{insets:step.safeArea});
    if(step.save)fs.writeFileSync(path.join(out,step.save.name),JSON.stringify(await js(step.save.expression),null,2));
    if(step.trace){
      await cmd('Tracing.start',{categories:'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,blink,cc',transferMode:'ReturnAsStream'});
      const frames=await js(`new Promise(resolve=>{const times=[];let last;const start=performance.now();function tick(now){if(last)times.push(now-last);last=now;if(now-start<${step.trace.ms||5000})requestAnimationFrame(tick);else resolve(times);}requestAnimationFrame(tick);})`);
      const complete=new Promise(resolve=>events.set('Tracing.tracingComplete',resolve));
      await cmd('Tracing.end');const {stream}=await complete;let trace='';
      for(;;){const chunk=await cmd('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}
      await cmd('IO.close',{handle:stream});
      fs.writeFileSync(path.join(out,step.trace.name+'.json'),trace);
      fs.writeFileSync(path.join(out,step.trace.name+'-frames.json'),JSON.stringify(frames));
    }
    if(step.shot){await sleep(step.settle??180);let clip;if(step.clip)clip=await js(`(()=>{const r=document.querySelector(${JSON.stringify(step.clip)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`);const r=await cmd('Page.captureScreenshot',{format:step.jpg?'jpeg':'png',...(step.jpg?{quality:88}:{}),...(clip?{clip,captureBeyondViewport:true}:{})});fs.writeFileSync(path.join(out,step.shot+(step.jpg?'.jpg':'.png')),Buffer.from(r.data,'base64'));}
  }
  fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(logs,null,2));
  if(logs.length)throw Error('Browser exceptions: '+JSON.stringify(logs));
  await cmd('Browser.close');socket.close();
} finally {socket?.close();browser.kill();}
