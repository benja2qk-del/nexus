// Fixture-only UI regression and screenshots. Never uses the owner's server or sessions.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';

const port='4796', repo=process.cwd(), scratch=path.resolve('.local/unhosted-notice');
fs.mkdirSync(scratch,{recursive:true});
const root=fs.mkdtempSync(path.join(scratch,'nexus-onechat-'));
const cwd=path.join(root,'project'),claude=path.join(root,'claude'),project=path.join(claude,'projects',cwd.replace(/[^A-Za-z0-9]/g,'-'));
for(const dir of [cwd,project,path.join(claude,'sessions'),path.join(root,'codex','sessions'),path.join(root,'copilot')])fs.mkdirSync(dir,{recursive:true});
const ids=['outside-busy','outside-idle','saved'];
for(const id of ids){
  const records=[{type:'custom-title',customTitle:id==='saved'?'Saved conversation':'Release notes '+(id.endsWith('busy')?'in progress':'ready to review')},
    {type:'user',cwd,timestamp:new Date().toISOString(),message:{content:'Prepare a short release summary and keep the phone checks visible.'}},
    {type:'assistant',timestamp:new Date().toISOString(),message:{content:[{type:'text',text:'The release summary is ready for review. The phone layout checks are included.'}]}}];
  fs.writeFileSync(path.join(project,id+'.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  if(id!=='saved')fs.writeFileSync(path.join(claude,'sessions',id+'.json'),JSON.stringify({sessionId:id,pid:process.pid,startedAt:Date.now(),status:id.endsWith('busy')?'busy':'idle',cwd}));
}
fs.writeFileSync(path.join(root,'config.json'),'{}');
const guard=path.join(root,'guard.js');
fs.writeFileSync(guard,`window.check=(ok,name)=>{if(!ok)throw Error(name);console.log('PASS '+name)};
window.actions=[];const fixtureFetch=window.fetch;window.fetch=(url,options)=>{if(String(url).includes('/api/action')){const b=JSON.parse(options.body);actions.push(b);if(['term-resume','resume','fork','term-fork','new','new-codex'].includes(b.action)&&b.key!=='claude:saved')throw Error('Unexpected session launch');}return fixtureFetch(url,options)};`);
const env={...process.env,TEMP:scratch,TMP:scratch,LOCALAPPDATA:root,NEXUS_PORT:port,NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_WSL_HOMES:'[]',NEXUS_CLAUDE_DIR:claude,NEXUS_CODEX_DIR:path.join(root,'codex'),NEXUS_COPILOT_DIR:path.join(root,'copilot'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_UPLOAD_DIR:path.join(root,'uploads'),NEXUS_CONFIG_FILE:path.join(root,'config.json'),NEXUS_ONECHAT_FIXTURE:root,NEXUS_TOUR_SOURCE:guard};
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(Number(port),'127.0.0.1',()=>probe.close(resolve));});
const server=spawn(process.execPath,['--require','./tools/onechat-pty-stub.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);
const output=path.resolve('docs/shots/unhosted-notice');fs.mkdirSync(output,{recursive:true});
async function tour(width,height,baseline=false){
  const out=path.join(output,(baseline?'before-':'')+width);fs.mkdirSync(out,{recursive:true});
  const steps=[{until:'typeof state!=="undefined" && state.booted && state.sessions.length===3 && $("#app").classList.contains("settled")'},
    {js:"select('claude:outside-busy')"},{until:"chatFor().loaded && !!$('#steerIn')"}];
  const js=code=>steps.push({js:code}),check=(code,name)=>js(`check(${code},${JSON.stringify(name)})`),shot=name=>steps.push({shot:name}),until=code=>steps.push({until:code});
  js("$('#steerIn').value='Please include the phone checks in the summary.';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}))");
  steps.push({wait:300});shot('busy-draft');
  if(!baseline){
    check("!$('#steerNotice').hidden && $('#steerNotice').textContent.includes(\"NEXUS can't type into it\") && $('[data-steer=send]').disabled",'live outside session explains disabled Send before sending');
    check("!$('#steerNotice').querySelector('button,a') && !$('#nxQueue').textContent.includes('Open this session') && !document.querySelector('[data-chat-resume]')",'composer offers no duplicate-session launch');
    check("$('#steerIn').getAttribute('aria-describedby')==='steerNotice' && $('[data-steer=send]').getAttribute('aria-describedby')==='steerNotice'",'notice describes input and Send accessibly');
    steps.push({click:'[data-steer=send]'});js("$('#steerIn').focus()");steps.push({key:['Enter','Enter',13]});
    js("window.rejected=await sendChat();await queueEnqueue($('#steerIn').value,state.sel);NexusVoice.updateControls()");
    check("rejected.ok===false && $('#steerIn').value.includes('Please include') && actions.length===0 && $('[data-steer=send]').disabled && !$('#modal').classList.contains('on')",'button, Enter, direct and queue sends retain text without actions or launch dialog');
    js("await sendChat(null,'Dictated: keep the deployment notes too.');select('claude:outside-idle')");until("chatFor().loaded");
    check("!$('#steerNotice').hidden && $('[data-steer=send]').disabled",'idle outside session also shows the notice');shot('idle-notice');
    js("await sendChat(null,'Off-screen spoken sentence.',undefined,'claude:outside-busy');select('claude:outside-busy')");
    check("$('#steerIn').value.includes('Please include') && $('#steerIn').value.includes('Dictated:') && $('#steerIn').value.includes('Off-screen spoken sentence.')",'speech appends to existing draft and stays with its original session');shot('speech-kept');
    // Force stale client hosting data: the real fixture server rejects queue-add.
    js("chatFor().queue.hosted=true;window.race=await queueEnqueue('A sentence rejected after the last poll.',state.sel)");
    check("!race.ok && $('#steerIn').value.includes('A sentence rejected') && !$('#steerNotice').hidden && !chatFor().queue.hosted",'server queue rejection refreshes the persistent reason and keeps text');shot('queue-rejected');
    // Exercise the actual Call loop with a deterministic local audio adapter.
    // Its transcript arrives just as the session becomes unhosted; no mic or API runs.
    js(`window.realLoadChat=loadChat;window.realEnsure=ensureChatTerminal;window.realAudio=NexusVoice.callAudio;
      loadChat=async()=>{};ensureChatTerminal=async()=>({id:'fixture-call'});
      chatFor().terminal={id:'fixture-call',ready:true};chatFor().queue.hosted=true;
      NexusVoice.callAudio=()=>({signal:new AbortController().signal,unlock:async()=>{},record:async()=>({voiced:true,wav:new ArrayBuffer(0)}),transcribe:async()=>{chatFor().terminal=null;chatFor().queue.hosted=false;return {text:'Talk sentence kept after the terminal changed.'}},speak:async()=>{},earcon:async()=>{},close:()=>{},stopSpeech:()=>{}});
      await NexusCall.start(state.sel);`);
    until("$('#nxCall')?.textContent.includes(\"NEXUS can't type into it\")");shot('talk-rejected');
    js("NexusCall.end(false);loadChat=realLoadChat;ensureChatTerminal=realEnsure;NexusVoice.callAudio=realAudio;renderReadableChat()");
    check("$('#steerIn').value.includes('Talk sentence kept') && $('#steerIn').value.includes('Please include')",'actual Call transcription survives ending the call alongside the typed draft');shot('talk-draft');
    // A failed queue request for a different session must not overwrite this box.
    js("window.originalDraft=$('#steerIn').value;select('claude:saved')");until("chatFor().loaded");
    check("$('#steerNotice').hidden",'saved session without a terminal retains the existing send/resume flow');
    js("$('#steerIn').value='Send this saved-session fixture.';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}));await sendChat()");
    until("chatFor().pending.some(p=>p.status==='confirmed') && !chatFor().sending");
    check("$('#steerNotice').hidden && $('#steerIn').value==='' && chatFor().queue.hosted",'saved Send starts the stub session and confirms delivery');shot('hosted-saved');
    js("$('#steerIn').value='Hosted draft stays here';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}));await queueEnqueue('Another off-screen sentence.','claude:outside-idle')");
    check("$('#steerIn').value==='Hosted draft stays here' && $('#steerNotice').hidden",'rejected text for another session never overwrites a hosted composer');
    js("select('claude:outside-busy');window.liveSession=state.byKey.get(state.sel);liveSession.live=false;liveSession.status='offline';renderSteer(liveSession)");
    check("$('#steerNotice').hidden && !nxUnhosted() && $('#steerIn').value===originalDraft",'external session ending clears notice without losing its draft');
    js("liveSession.live=true;liveSession.status='busy';renderSteer(liveSession)");
    check("!$('#steerNotice').hidden && $('[data-steer=send]').disabled",'notice returns when the outside session becomes live again');
    check("actions.filter(a=>a.action==='term-resume').every(a=>a.key==='claude:saved')",'only the saved fixture is ever resumed');
    check("document.documentElement.scrollWidth<=innerWidth && $('#steerNotice').getBoundingClientRect().top>=0 && $('#steer').getBoundingClientRect().bottom<=innerHeight",'notice and composer fit the viewport without horizontal overflow');
    if(width<=700){
      js("$('#steerIn').focus();window.fullHeight=visualViewport.height;Object.defineProperty(visualViewport,'height',{configurable:true,value:480});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:24});visualViewport.dispatchEvent(new Event('resize'))");steps.push({wait:300});shot('keyboard');
      check("$('#steerNotice').getBoundingClientRect().top>=24 && $('#steer').getBoundingClientRect().bottom<=505",'phone keyboard leaves the reason and retained text visible');
      js("$('#steerIn').blur();Object.defineProperty(visualViewport,'height',{configurable:true,value:fullHeight});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:0});visualViewport.dispatchEvent(new Event('resize'))");
    }
  }
  fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(steps,null,2));
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['tools/cdp-tour.mjs',out],{env:{...env,NEXUS_WIDTH:String(width),NEXUS_HEIGHT:String(height),NEXUS_TOUR_BASELINE:baseline?execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim():''},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);child.once('error',reject);child.once('exit',code=>{fs.writeFileSync(path.join(out,'checks.txt'),log);code?reject(Error(log)):resolve(log);});
  });
  assert(!/EXC /.test(result),'No browser exceptions');console.log('PASS '+path.relative(repo,out));
}
try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout: '+serverLog)),20000);server.stdout.on('data',d=>{if(String(d).includes(':'+port+'/')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+' '+serverLog));});});
  const response=await fetch('http://127.0.0.1:'+port+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Nexus':'1'},body:JSON.stringify({action:'queue-add',key:'claude:outside-busy',text:'Server rejection fixture'})});
  assert(!response.ok);assert.match((await response.json()).error,/Open this session in NEXUS/);
  for(const [width,height] of [[390,844],[1920,1080]])await tour(width,height,true);
  for(const [width,height] of [[390,844],[430,932],[1920,1080]])await tour(width,height);
  const entries=fs.readFileSync(path.join(root,'pty-log.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert(entries.filter(e=>e.type==='spawn').every(e=>e.args[e.args.indexOf('--resume')+1]==='saved'),'Only saved fixture terminals started');
  console.log('PASS real queue rejection; stub-only saved resume; phone and PC screenshots');
}finally{
  await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);server.kill();});
  fs.writeFileSync(path.join(output,'server.log'),serverLog);
  const target=fs.realpathSync(root),parent=fs.realpathSync(scratch);
  if(!target.toLowerCase().startsWith(parent.toLowerCase()+path.sep)||!path.basename(target).startsWith('nexus-onechat-'))throw Error('Unsafe fixture cleanup');
  fs.rmSync(target,{recursive:true,force:true});
}
