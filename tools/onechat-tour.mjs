import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const real = process.argv.includes('--real'), baseline = process.argv.includes('--baseline');
const width = Number(process.argv.find(x => /^\d+$/.test(x))) || 390;
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(4791, '127.0.0.1', () => probe.close(resolve)); });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-onechat-'));
const claude = path.join(temp, 'claude'), codex = path.join(temp, 'codex');
const cwd = path.join(temp, 'project'); fs.mkdirSync(cwd);
const project = path.join(claude, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(path.join(codex, 'sessions'), { recursive: true });
fs.mkdirSync(path.join(cwd,'nested'));
const user = text => ({type:'user', cwd:path.join(cwd,'nested'), timestamp:new Date().toISOString(), message:{content:text}});
const ai = text => ({type:'assistant', timestamp:new Date().toISOString(), message:{content:[{type:'text',text}]}});
const file = path.join(project, 'onechat-live.jsonl');
const initial = [user('Prepare the release notes and validate the phone conversation.'),{type:'custom-title',customTitle:'Release notes and phone chat'},{type:'ai-title',aiTitle:'Polish the phone conversation and release checks'},ai('The release notes are ready for review.\n\n- **Chat** brings the conversation together.\n- Validation is next.'),{type:'assistant',timestamp:new Date().toISOString(),message:{content:[{type:'thinking',thinking:'I will check the conversation layout, then the release checks.'}]}},...[1,2,3].flatMap(n => [{type:'assistant',message:{content:[{type:'tool_use',name:'Bash',id:'shell-'+n,input:{command:'npm test'}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'shell-'+n,content:'Checks passed.'}]}}]),ai('All three checks passed. Send the next direction whenever you are ready.')];
fs.writeFileSync(file, initial.map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(path.join(project, 'onechat-old.jsonl'), [user('Continue the release conversation.'),ai('The conversation will continue in the live file.'),{type:'continued-in',continuedInSessionId:'onechat-live'}].map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(path.join(project,'onechat-root.jsonl'),[user('First request in the continuation chain.'),ai('Start the release conversation with the phone interface.'),{type:'continued-in',continuedInSessionId:'onechat-old'}].map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(path.join(project,'onechat-exit.jsonl'),[user('Check recovery after a stopped terminal.'),{type:'custom-title',customTitle:'Delivery recovery'},ai('This fixture checks that a stopped terminal keeps the message available for Retry.')].map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(path.join(project,'onechat-trust.jsonl'),[user('Check explicit folder trust.'),{type:'custom-title',customTitle:'Folder trust fixture'},ai('A new folder needs your choice before any message is sent.')].map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(path.join(project,'onechat-next.jsonl'),JSON.stringify({type:'custom-title',customTitle:'Continued release conversation'})+'\n');
const rollout=path.join(codex,'sessions','rollout-onechat-astra.jsonl');
fs.writeFileSync(rollout,[{type:'session_meta',payload:{id:'onechat-astra',cwd}},
 {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Review the release checks and explain the result.'}]}},
 {type:'response_item',payload:{type:'reasoning',summary:[{text:'I will inspect the recorded validation.'}]}},
 {type:'response_item',payload:{type:'function_call',name:'functions.exec_command',call_id:'astra-command',arguments:'{"cmd":"npm test"}'}},
 {type:'response_item',payload:{type:'function_call_output',call_id:'astra-command',output:'All checks passed.'}},
 {type:'event_msg',payload:{type:'agent_message',message:'**Astra validation passed.** The release is ready for review.'}},
 {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'**Astra validation passed.** The release is ready for review.'}]}},
 {type:'event_msg',payload:{type:'task_complete'}}].map(r=>JSON.stringify({timestamp:new Date().toISOString(),...r})).join('\n')+'\n');
const out = real ? path.join(temp,'real-'+width) : path.resolve('docs/shots/onechat', baseline ? 'baseline-'+width : 'round2/'+width); fs.mkdirSync(out,{recursive:true});
const config=JSON.parse(fs.readFileSync('config.json','utf8')),token='onechat-fixture-token-never-real-00001';
fs.writeFileSync(path.join(temp,'devices.json'),JSON.stringify({[crypto.createHash('sha256').update(token).digest('hex')]:{name:'Fixture phone',created:Date.now(),lastSeen:Date.now()}}));
const guard = path.join(temp,'guard.js');
fs.writeFileSync(guard, `window.oneCheck=(ok,name)=>{if(!ok)throw Error(name);console.log('PASS '+name)}; window.oneCalls={ws:0,actions:[]};
document.cookie='nexus_device=${token}; Path=/; SameSite=Strict';
window.WebSocket=class{constructor(){oneCalls.ws++;throw Error('Chat must not open a WebSocket')}};
const originalFetch=window.fetch.bind(window);window.fetch=(url,options={})=>{const route=new URL(url,location.href).pathname;
if(route==='/api/action'){const action=JSON.parse(options.body).action;oneCalls.actions.push(action);if(action==='viewed')return Promise.resolve(new Response('{"ok":true,"result":true}'));if(${real || baseline} || !['term-resume','term-send','term-close'].includes(action))throw Error('Blocked action '+action)}
if(route.startsWith('/api/')&&!['/api/action','/api/sessions','/api/transcript','/api/chat','/api/term-state','/api/recap','/api/upload'].includes(route))throw Error('Blocked route '+route);
if(${width<=700 && !real && !baseline} && route.startsWith('/api/'))options={...options,headers:{...options.headers,'X-Forwarded-Host':${JSON.stringify(config.remoteHost)},'Tailscale-User-Login':${JSON.stringify(config.remoteUser)}}};
return originalFetch(url,options)};`);
const env = {...process.env, NEXUS_PORT:'4791', NEXUS_NO_ACCOUNT_POLL:'1', NEXUS_TEST_TERMINALS:real || baseline ? '1' : '', NEXUS_DEVICES_FILE:path.join(temp,'devices.json'), NEXUS_STATE_FILE:path.join(temp,'state.json'), NEXUS_UPLOAD_DIR:path.join(temp,'uploads'), LOCALAPPDATA:temp, NEXUS_CODEX_DIR:codex, NEXUS_CLAUDE_DIR:real ? path.join(os.homedir(),'.claude') : claude, NEXUS_WIDTH:String(width),NEXUS_HEIGHT:width<=700?'844':'1080',NEXUS_TOUR_SOURCE:guard,NEXUS_TOUR_BASELINE:baseline?'74deb39':'', NEXUS_ONECHAT_FIXTURE:temp};
const server=spawn(process.execPath,[...(!real && !baseline?['--require','./tools/onechat-pty-stub.cjs']:[]),'server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
process.on('exit',()=>server.kill());
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Start timeout')),20000);server.stdout.on('data',d=>{if(String(d).includes('http://127.0.0.1:4791/')){clearTimeout(timer);resolve()}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>{clearTimeout(timer);reject(Error('Server exited '+c))})});
 const steps=[{until:'typeof state!=="undefined" && state.booted && state.sessions.length>0 && $("#app").classList.contains("settled")'}];
 if (baseline) {
  steps.push({js:"select('claude:onechat-live',{tab:'chat'})"},{until:"!!$('#chatMessages .ev')"},{click:'.session-more > summary'},{shot:'more-open'},{js:"for(const event of ['touchstart','touchend','pointerdown','pointerup','mousedown','mouseup','click'])document.addEventListener(event,e=>console.log('EVENT',event,e.target.tagName,e.target.id,e.target.dataset.a),true);console.log('RECT',JSON.stringify($('#sessionRecapMore').getBoundingClientRect()));"},{click:'#sessionRecapMore'},{wait:800},{js:"console.log('RECAP_VISIBLE',!!$('.recap-counts'));console.log('HIT',document.elementFromPoint(100,250)?.outerHTML.slice(0,200))"},{shot:'more-tapped'});
 } else if (real) {
  steps.push({js:"window.realKeys=state.sessions.filter(s=>s.kind==='claude').slice(0,3).map(keyOf)"});
  for(let i=0;i<3;i++) steps.push({js:`select(realKeys[${i}],{tab:'chat'})`},{until:"!!$('#chatMessages .ev')"},{wait:1500},{js:"oneCheck(oneCalls.ws===0,'real Chat uses no terminal connection');oneCheck(document.documentElement.scrollWidth<=innerWidth,'real Chat fits')"},{shot:'real-chat-'+i});
 } else {
  const js=code=>steps.push({js:code}),check=(code,label)=>js(`oneCheck(${code},${JSON.stringify(label)})`),until=code=>steps.push({until:code}),tap=selector=>steps.push({click:selector}),shot=name=>steps.push({shot:name});
  const append=(target,records)=>steps.push({fixtureAppend:{file:path.relative(temp,target),records}});
  js("select('claude:onechat-live')");until("!!$('#chatMessages .ev')");steps.push({wait:1100});shot('saved-chat');
  check("state.tab==='chat' && !state.sessions.some(s=>s.id==='onechat-old')",'Chat is the default; continuation has one session card');
  check("chatFor().events.findIndex(e=>e.text==='First request in the continuation chain.')<chatFor().events.findIndex(e=>e.text==='Continue the release conversation.') && chatFor().events.findIndex(e=>e.text==='Continue the release conversation.')<chatFor().events.findIndex(e=>e.text==='Prepare the release notes and validate the phone conversation.')",'three-file continuation preserves chronological order regardless of file mtime');
  check("$('#steerIn') && $('.fh-title').getBoundingClientRect().top>=0 && $('#focusHead').getBoundingClientRect().bottom<300",'saved Chat has a composer and a compact visible header');
  check("oneCalls.ws===0 && getComputedStyle($('#sessionRecap')).display!=='none'",'Chat has no WebSocket and recap is visible');
  if(width<=700)check("Math.abs($('#mobileDock').getBoundingClientRect().bottom-innerHeight)<1 && document.documentElement.scrollHeight===innerHeight && $('#app').scrollTop===0",'phone dock reaches the viewport bottom; document does not scroll');
  tap('#sessionRecap');until("!!$('.recap-counts')");shot('recap-header');
  check("$('.recap-counts').textContent.includes('3 commands')",'header tap opens the real recap endpoint');tap('[data-modal-dismiss]');
  tap('.session-more > summary');shot('more-open');tap('#sessionRecapMore');until("$('#modal').classList.contains('on') && !!$('.recap-counts')");shot('recap-more');
  check("$('.recap-request').textContent.includes('Prepare the release')",'real More tap opens recap instead of being mistaken for a tab');tap('[data-modal-dismiss]');js("$('.session-more').open=false");
  js("$('.chat-thinking').scrollIntoView({block:'center'})");shot('thinking-expanded');
  check("$('.chat-thinking').open",'thinking starts open in the conversation');
  js("$('.chat-tools').scrollIntoView({block:'center'})");tap('.chat-tools summary');shot('tools-expanded');
  check("$('.chat-tools').open && $('.chat-tools summary').textContent.includes('Ran 3 shell commands')",'plain-language tool group expands');
  js("$('.chat-tools').open=false;$('.chat-thinking').open=false;$('#chatView').scrollTop=$('#chatView').scrollHeight;window.growthAt=Date.now()");
  append(file,[ai('LIVE APPEND: the open conversation picked up this new reply.')]);until("$('#chatMessages').textContent.includes('LIVE APPEND')");
  check("Date.now()-growthAt<2300 && $('#chatView').scrollHeight-$('#chatView').scrollTop-$('#chatView').clientHeight<80",'transcript growth appears within two seconds and follows the bottom');shot('live-growth');
  append(file,[ai('A longer validation report.\n\n'+Array.from({length:18},(_,i)=>'Check '+(i+1)+' passed.').join('\n\n'))]);until("$('#chatMessages').textContent.includes('Check 18 passed')");
  js("$('#chatView').scrollTop=0;window.readerTop=$('#chatView').scrollTop");
  append(file,[ai('New activity arrived while you were reading above.')]);until("!$('#chatNew').classList.contains('hidden')");
  check("$('#chatView').scrollTop===readerTop",'reading position stays fixed when new activity arrives');shot('new-messages');tap('#chatNew');
  check("$('#chatView').scrollHeight-$('#chatView').scrollTop-$('#chatView').clientHeight<80",'New messages pill returns to the bottom');
  js("$('#steerIn').value='Please validate the release.\\nInclude the phone checks.';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}))");tap('[data-steer=send]');
  until("!!$('.delivery-starting')");shot('starting-pending');
  until("$('#chatMessages').textContent.includes('Delivered through Chat.') && !$('.delivery-starting') && !$('.delivery-pending')");shot('delivered');
  check("$$('#chatMessages .ev.user').filter(e=>e.textContent.includes('Please validate the release.')).length===1 && $('#steerIn').value===''",'saved Send resumes, waits, sends multiline text and confirms once');
  check("oneCalls.ws===0 && oneCalls.actions.filter(a=>a==='term-resume').length===1",'saved Send needs no WebSocket or separate Resume click');
  js("$('#steerIn').value='Start a long step'");tap('[data-steer=send]');until("chatFor().terminal?.busy && !chatFor().sending");
  check("chatFor().status.startsWith('Claude is thinking')",'a busy session remains Working even when input is ready');
  js("$('#steerIn').value='Queue this message'");tap('[data-steer=send]');until("!!$('.delivery-queued')");shot('queued');
  check("$('.delivery-queued').textContent.includes('Claude will read this after its current step')",'busy send explains that Claude will read the queued message after its current step');
  js("chatFor().pending.at(-1).submittedAt=Date.now()-60000;await loadChat(state.sel,true)");
  check("chatFor().pending.at(-1).status==='queued' && !$('.delivery-failed')",'busy queued message does not hit the ordinary receipt timeout');
  until("$('#chatMessages').textContent.includes('The queued message was read') && !$('.delivery-queued')");shot('queue-delivered');
  js("$('#steerIn').value='Review the attached notes.';const transfer=new DataTransfer();transfer.items.add(new File(['Synthetic release notes.'],'notes.txt',{type:'text/plain'}));const picker=$('#steer [data-file-picker]');picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}))");
  until("$('#steerIn').value.includes('notes.txt') && !attachments.blocked(state.sel)");shot('attachment-ready');
  js("window.uploadDraft=$('#steerIn').value;select('claude:onechat-exit');select('claude:onechat-live')");
  check("$('#steerIn').value===uploadDraft",'uploaded attachment reference survives session switching');tap('[data-steer=send]');
  until("chatFor().pending.at(-1)?.status==='confirmed' && $('#steerIn').value===''");
  check("chatFor().events.some(e=>e.t==='user' && e.text.includes('notes.txt'))",'real TEMP upload is included in the delivered Chat message');
  js("$('#steerIn').value='Show a question'");tap('[data-steer=send]');until("!!$('.permission-card')");shot('question');
  js("await postNexus('/api/action',{action:'term-send',term:chatFor().terminal.id,text:'Do not answer a question with my draft'}).then(()=>oneCheck(false,'question guard'),e=>oneCheck(e.message.includes('Answer the question'),'server refuses text while a numbered question is open'))");
  tap('[data-chat-answer="2"]');until("!$('.permission-card') && $('#chatMessages').textContent.includes('Your answer was received')");shot('question-answered');
  js("$('#steerIn').value='Simulate missing receipt'");tap('[data-steer=send]');until("!!$('.delivery-pending') && !!chatFor().pending.at(-1).submittedAt");
  js("chatFor().pending.at(-1).submittedAt=Date.now()-46000");until("!!$('.delivery-failed')");
  check("$('#steerIn').value==='Simulate missing receipt' && !!$('[data-chat-retry]')",'receipt timeout retains the text and offers Retry');shot('receipt-timeout');
  js("select('claude:onechat-exit')");until("chatFor().loaded && $('#steerIn')");js("$('#steerIn').value='Simulate exit'");tap('[data-steer=send]');until("!!$('.delivery-failed')");shot('not-delivered');
  check("$('#steerIn').value==='Simulate exit'",'terminal exit marks Not delivered and restores the draft');tap('[data-chat-retry]');
  until("$('#chatMessages').textContent.includes('Delivered through Chat.') && !$('.delivery-failed')");shot('retry-delivered');
  js("select('claude:onechat-trust')");until("chatFor().loaded");js("$('#steerIn').value='Send after I choose to trust'");tap('[data-steer=send]');
  until("!!$('.permission-card') && !!$('.delivery-failed')");js("$('.permission-card').scrollIntoView({block:'end'})");shot('trust-question');
  check("chatFor().terminal.prompt.mode==='arrows' && $('.permission-card').textContent.includes('Yes, I trust this folder') && $('#steerIn').value==='Send after I choose to trust'",'unnumbered trust is a question card and keeps the unsent draft');
  js("await postNexus('/api/action',{action:'term-send',term:chatFor().terminal.id,text:'Never auto trust'}).then(()=>oneCheck(false,'trust guard'),e=>oneCheck(e.message.includes('Answer the question'),'ordinary send cannot answer the trust prompt'))");
  tap('[data-chat-answer="2"]');until("!$('.permission-card') && $('#chatMessages').textContent.includes('explicitly trusted')");
  js("$('[data-chat-retry]').scrollIntoView({block:'center'})");tap('[data-chat-retry]');until("$('#chatMessages').textContent.includes('Delivered through Chat.') && !$('.delivery-failed')");shot('trust-delivered');
  js("select('claude:onechat-live');$('#steerIn').value='';oneCheck(!$('#toasts').children.length,'opening a session clears older notifications from its header')");until("chatFor().loaded");
  append(file,[{type:'continued-in',continuedInSessionId:'onechat-next'}]);append(path.join(project,'onechat-next.jsonl'),[user('Continue with the final release check.'),ai('CONTINUED LIVE: this reply came from the next transcript file.')]);
  until("$('#chatMessages').textContent.includes('CONTINUED LIVE')");shot('continued-live');
  tap('#sessionRecap');until("$('#modal').classList.contains('on') && $('.recap-answer')?.textContent.includes('CONTINUED LIVE')");shot('continued-recap');tap('[data-modal-dismiss]');
  js("await refresh();oneCheck(state.sessions.filter(s=>['onechat-root','onechat-old','onechat-live','onechat-next'].includes(s.id)).length===1,'growing continuation still has one live card')");
  js("select('astra:onechat-astra')");until("$('#chatMessages').textContent.includes('Astra validation passed')");shot('astra');
  check("$$('#chatMessages .ev.ai').length===1 && !!$('.chat-thinking') && $('.chat-tools summary').textContent.includes('shell command')",'Astra rollout shares Chat, deduplicates mirrors and shows public reasoning/activity');
  if(width<=700){
    js("$('#steerIn').focus();window.originalHeight=visualViewport.height;Object.defineProperty(visualViewport,'height',{configurable:true,value:480});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:24});visualViewport.dispatchEvent(new Event('resize'))");shot('keyboard');
    check("document.body.classList.contains('keyboard-open') && getComputedStyle($('#mobileDock')).display==='none' && $('#steer').getBoundingClientRect().bottom<=505 && $('#chatView').scrollHeight-$('#chatView').scrollTop-$('#chatView').clientHeight<80",'keyboard geometry keeps composer and latest message visible and hides dock');
    js("$('#steerIn').blur();Object.defineProperty(visualViewport,'height',{configurable:true,value:originalHeight});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:0});visualViewport.dispatchEvent(new Event('resize'))");shot('keyboard-restored');
    check("!document.body.classList.contains('keyboard-open') && Math.abs($('#mobileDock').getBoundingClientRect().bottom-innerHeight)<1",'keyboard closing restores full-height shell and dock');
    tap('[data-nav=more]');until("!!$('.geo-line')");shot('geometry');check("$('.geo-line').textContent.includes('dock') && $('.geo-line').textContent.includes('gap')",'More retains screen geometry diagnostics');tap('[data-modal-dismiss]');
  }
  check("oneCalls.ws===0 && document.documentElement.scrollWidth<=innerWidth",'whole tour uses zero client WebSockets and fits the viewport');
 }
 fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(steps,null,2));
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tools/cdp-tour.mjs',out],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);child.once('exit',code=>{fs.writeFileSync(path.join(out,'checks.txt'),log);code?reject(Error(log)):resolve()})});
 if(!real && !baseline){
  const entries=fs.readFileSync(path.join(temp,'pty-log.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert(entries.filter(e=>e.type==='spawn').every(e=>e.cwd===cwd && e.args[0]==='--resume'),'resume uses the filed project directory');
  assert(entries.some(e=>e.type==='write' && e.value==='\x1b[200~Please validate the release.\nInclude the phone checks.\x1b[201~'),'bracketed multiline payload reached the stub PTY');
  assert(entries.some(e=>e.type==='write' && e.value==='\x1b[B'),'explicit unnumbered trust uses the down arrow');
  assert(entries.filter(e=>e.type==='write' && e.value==='\x1b[200~Send after I choose to trust\x1b[201~').length===1,'trust draft is pasted only after explicit confirmation');
  const headers={'X-Forwarded-Host':config.remoteHost,'Tailscale-User-Login':config.remoteUser,'X-Nexus':'1','Content-Type':'application/json'};
  assert.equal((await fetch('http://127.0.0.1:4791/api/action',{method:'POST',headers,body:JSON.stringify({action:'term-send',term:'unpaired',text:'blocked'})})).status,401);
  console.log('PASS stub PTY resumeDir/multiline capture and unpaired HTTP send rejection');
 }
 console.log('PASS tour '+out);
} finally {
 await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);server.kill()});
 if(!real){const target=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());if(!target.toLowerCase().startsWith(parent.toLowerCase()+path.sep)||!path.basename(target).startsWith('nexus-onechat-'))throw Error('Unsafe fixture cleanup');fs.rmSync(target,{recursive:true,force:true});}
}
