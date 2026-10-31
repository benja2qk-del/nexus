// Owns one private server and launches the shared headless CDP tour.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
const phase = process.argv[2] || 'after', width = Number(process.argv[3]) || 390, height = width < 701 ? 844 : 1080;
await new Promise((resolve,reject)=>{const p=net.createServer();p.once('error',reject);p.listen(4791,'127.0.0.1',()=>p.close(resolve));});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-phoneux-'));
const env={...process.env,NEXUS_PORT:'4791',NEXUS_DEVICES_FILE:path.join(temp,'devices.json'),NEXUS_STATE_FILE:path.join(temp,'state.json'),NEXUS_UPLOAD_DIR:path.join(temp,'uploads'),LOCALAPPDATA:temp,NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_TEST_TERMINALS:'1',NEXUS_WIDTH:String(width),NEXUS_HEIGHT:String(height),NEXUS_TOUR_SOURCE:path.resolve('tools/phoneux-fixture.js'),NEXUS_TOUR_BASELINE:phase==='before'?'e901440':''};
const server=spawn(process.execPath,['server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
process.on('exit',()=>server.kill());
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server start timeout')),20000);server.stdout.on('data',d=>{if(String(d).includes('http://127.0.0.1:4791/')){clearTimeout(timer);resolve();}});server.once('error',reject);});
const out=path.resolve('docs/shots/phoneux',width+'-'+phase);fs.mkdirSync(out,{recursive:true});
const steps=[], add=(js,shot)=>steps.push({js,wait:450,...(shot?{shot}:{})});
const check=(expression,name)=>{if(phase!=='before')add(`phoneuxCheck(${expression},${JSON.stringify(name)})`);};
steps.push({until:'typeof state !== "undefined" && state.booted && state.sessions.length > 0',wait:1000,shot:'home'});
check('document.documentElement.scrollWidth <= innerWidth','no page overflow');
if(width<701)check("$('#phoneSessions .session-preview').getBoundingClientRect().height < 155 && $('#phoneSessions').textContent.includes('Chrome')",'compact Home previews with tool tags');
add("$('#overview').scrollTop=450",'home-cards');
add("filterProject('Beacon');$('#overview').scrollTop=0",'project-strip');
add("openProject('Beacon')",'project');
if(width<701)check("$('.project-work').getBoundingClientRect().top < $('.project-evidence').getBoundingClientRect().top",'project sessions come before evidence');
add("$('#projectSessionsTitle').scrollIntoView({block:'start'})",'project-sessions');
add("finder()",'sessions');
add("$('#finderSearch').value='Chrome';$('#finderSearch').dispatchEvent(new Event('input'))",'sessions-search');
check("$$('#finderResults [data-find]').length===1 && $('#finderResults').textContent.includes('Steam Cloud publishing')",'Chrome finds the relevant session');
add("$('#finderSearch').value='not-found-fixture';$('#finderSearch').dispatchEvent(new Event('input'))",'sessions-empty');
add("closeModal();select('claude:phoneux-fixture-0',{tab:'feed'})",'feed');
add("state.tab='thinking';renderHead()",'thinking');
add("state.tab='chat';renderHead()",'chat');
if(width<701){
  check("$('#chatMessages').textContent.includes('public configuration is saved') && !$('#chatMessages').textContent.includes('Saved.Nowpublishingit')",'Chat renders parsed messages, not terminal artifacts');
  check("$$('.chat-tools').length > 0 && $$('.chat-tools[open]').length === 0 && $$('.permission-option').length === 3",'tools start collapsed; live permission options are visible');
  check("$$('#steer [data-steer]').every(b=>b.getBoundingClientRect().height>=40 && b.getBoundingClientRect().width>=40) && new Set($$('#steer [data-steer]').map(b=>b.getBoundingClientRect().top)).size===1",'all six actions share one row with 40px targets');
  check("Math.abs($('#steerIn').getBoundingClientRect().top - $('#steer [data-pick]').getBoundingClientRect().top)<5",'attachment icons are inside the input row');
  check("parseFloat(getComputedStyle($('#steerIn')).fontSize)>=16",'input avoids iOS text zoom');
}
add("$('#steerIn').focus({preventScroll:true});$('#steerIn').value='Publish the reviewed configuration.'",'keyboard-closed');
add("Object.defineProperty(visualViewport,'height',{configurable:true,value:510});visualViewport.dispatchEvent(new Event('resize'))",'keyboard-open');
if(width<701)check("Math.abs($('#steer').getBoundingClientRect().bottom-510)<1 && getComputedStyle($('#mobileDock')).display==='none' && getComputedStyle($('#steer')).transitionDuration==='0s' && $('#chatView').scrollHeight-$('#chatView').scrollTop-$('#chatView').clientHeight<2",'keyboard pins composer and transcript without transition or dock');
add("Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:28});visualViewport.dispatchEvent(new Event('scroll'))",'keyboard-offset');
if(width<701)check("Math.abs($('#steer').getBoundingClientRect().bottom-538)<1",'viewport scroll offset tracks keyboard in the same frame');
add("delete visualViewport.height;delete visualViewport.offsetTop;$('#steerIn').blur();visualViewport.dispatchEvent(new Event('resize'))",'keyboard-restored');
if(width<701)check("!document.body.classList.contains('keyboard-open') && Math.abs($('#steer').getBoundingClientRect().bottom-$('#mobileDock').getBoundingClientRect().top)<2 && scrollY===0",'keyboard closure restores dock without gap or page jump');
if(width<701){
  add("$('#steerIn').focus({preventScroll:true})");steps.push({viewport:[390,510],wait:100,shot:'keyboard-shrunken-window'});
  check("Math.abs($('#steer').getBoundingClientRect().bottom-510)<1 && document.body.classList.contains('keyboard-open')",'shrunken window resize preserves keyboard geometry');
  steps.push({viewport:[390,844],wait:100});add("$('#steerIn').blur();visualViewport.dispatchEvent(new Event('resize'))");
}
if(phase!=='before'&&width<701){
  add("$('#chatView').scrollTop=0",'chat-history');
  add("$('.chat-tools summary').click()",'chat-tool-expanded');
  check("$('.chat-tools').open",'tool detail remains available');
  add("$('#chatView').scrollTop=$('#chatView').scrollHeight;$('.permission-option').click()");
  check("phoneuxFixture.writes.at(-1).d==='1'",'permission choice sends only its selected number to the fixture');
  add("await new Promise(r=>termView(selTerm().id).xt.write('\\x1b[2J\\x1b[HDo you want to proceed?\\r\\n1. Yes\\r\\n9. No\\r\\nEsc to cancel',r));renderChatOutput(termView(selTerm().id));window.choiceDraft=$('#steerIn').value;$('#chatPending [data-prompt-option=\"9\"]').click()");
  check("phoneuxFixture.writes.at(-1).d==='9' && $('#steerIn').value===window.choiceDraft",'numbered choices beyond 3 cannot submit the composer draft');
  add("await new Promise(r=>termView(selTerm().id).xt.write('\\x1b[2J\\x1b[HWorking...',r));renderChatOutput(termView(selTerm().id))");
  check("!$('.permission-card')",'resolved prompt disappears; scrollback cannot resurrect it');
  add("await new Promise(r=>termView(selTerm().id).xt.write('\\x1b[2J\\x1b[H'+phoneuxFixture.terminal,r));renderChatOutput(termView(selTerm().id))");
  add("chatHelp()",'chat-help');add('closeModal()');
}
add("$('.session-more').open=true",'session-more');
add("$('.session-more').open=false;state.tab='term';renderHead()",'terminal');
add("state.tab='chat';renderHead();toast('File ready','release-notes.md is ready to send.')",'toast');
steps.push({network:{offline:false,latency:80,downloadThroughput:1048576,uploadThroughput:65536}});
add("{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(262144)],'phoneux-notes.txt',{type:'text/plain'}));const input=$('#steer [data-file-picker=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}",'upload-progress');
steps.push({until:"!!$('#steer .attachment-chip.done')",shot:'upload-ready'});
check("$('#steerIn').value.includes('phoneux-notes.txt') && !$('#steer [data-steer=send]').disabled",'real TEMP upload adds reference and enables Send');
add("window.uploadDraft=$('#steerIn').value;select('claude:phoneux-fixture-1',{tab:'chat'});select('claude:phoneux-fixture-0',{tab:'chat'})");
check("$('#steerIn').value===window.uploadDraft && !!$('#steer .attachment-chip.done')",'uploaded file and draft survive session switching');
steps.push({network:{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}});
add("{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(51*1024*1024)],'too-large.mov'));const input=$('#steer [data-file-picker=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}",'upload-error');
check("$('#steer [data-steer=send]').disabled && $('#steer .attachment-chip.error').textContent.includes('50 MB')",'oversized attachment has actionable error and blocks Send');
add("$$('#steer .attachment-remove').forEach(b=>b.click())");
add("newSessionModal()",'new-session');
check("innerWidth>700 || document.activeElement.hasAttribute('data-modal-dismiss')",'phone sheet opens without forcing the keyboard');
add("$('#folderSearch').value='not-found';$('#folderSearch').dispatchEvent(new Event('input'))",'new-empty');
add("$('#folderSearch').value='';$('#folderSearch').dispatchEvent(new Event('input'));$('#newMessage').value='Review these notes.';$('#newMessage').dispatchEvent(new Event('input'));$('#startSession').click()",'new-error');
check("$('#newMessage').value==='Review these notes.' && !$('#startSession').disabled && $('#pickedPath').textContent.includes('Could not start')",'failed launch retains draft and offers retry');
check("!!$('#modalNotices .toast') && !$('#toasts .toast')",'dialog feedback is inline and cannot cover the heading');
add("{const dt=new DataTransfer();dt.items.add(new File(['notes'],'first-message.txt'));const input=$('#newAttachments [data-file-picker=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}");
steps.push({until:"!!$('#newAttachments .attachment-chip.done')",shot:'new-upload'});
check("$('#newMessage').value.includes('first-message.txt') && !$('#startSession').disabled",'new-session first message retains uploaded attachment');
add("closeModal();spendOverview()",'spend');
add("insightAction('spend',state.sessions[0])",'spend-session');
add("closeModal();insightAction('digest',state.sessions[0])",'away');
add("closeModal();focusCheckDialog(state.sessions[0])",'focus-check');
add("closeModal();appMenu()",'more-menu');
add("closeModal();$('#overviewHelp').click()",'help');
add("closeModal();setView('wall')",'wall');
if(width<701&&phase!=='before'){
  steps.push({click:'#mobileDock [data-nav=home]',wait:300});
  add("state.group='*';renderApsis();$('#overview').scrollTop=0;$('#projectStrip [data-project-filter=Beacon]').scrollIntoView({inline:'center',block:'nearest'})");
  steps.push({click:'#projectStrip [data-project-filter="Beacon"]',wait:300});
  steps.push({click:'#projectSelection [data-project]',wait:300});
  check("state.view==='project' && projectUI.key==='Beacon'",'touch project strip opens its project');
  steps.push({click:'.project-session-grid [data-open]',wait:300});
  check("state.view==='focus' && state.sel==='claude:phoneux-fixture-0'",'touch preview opens the correct session');
  steps.push({shot:'touch-session',wait:300});
  steps.push({click:'#backOverview',wait:300,shot:'touch-back'});
  add("console.log('BACK',state.view,projectUI.key,state.sel)");
  check("state.view==='project'",'back returns to the originating project');
  steps.push({click:'#mobileDock [data-nav=sessions]',wait:300});
  check("$('#modal').classList.contains('on') && !!$('#finderResults')",'Sessions dock opens search');
  add('closeModal()');
}
if(width>700){
  add('pairPhone()','pair-dialog');add('pairedDevices()','devices');add('closeModal()');
}
add("setView('overview');phoneuxFixture.offline=true;refresh()",'offline');
add("phoneuxFixture.offline=false;phoneuxFixture.empty=true;refresh()",'home-empty');
add("phoneuxFixture.empty=false;await refresh();select('claude:phoneux-fixture-1',{tab:'chat'})",'saved-chat');
add("phoneuxFixture.transcriptError=true;await loadFeed(true)",'transcript-error');
if(width<701)check("$('#chatMessages').textContent.includes('Could not refresh') && $('#chatMessages').textContent.includes('configuration')",'transcript error preserves readable history with Retry');
add("phoneuxFixture.transcriptError=false;await loadFeed(true)");
if(phase!=='before'){
  add("phoneuxFixture.sessions[0].title='Steam Cloud publishing configuration and final release validation across Windows and macOS with a long descriptive session title';select('claude:phoneux-fixture-0',{tab:'chat'})",'long-title');
  check("document.documentElement.scrollWidth<=innerWidth",'long title cannot widen the page');
  add("phoneuxFixture.events.splice(0);state.feedSize=-1;await loadFeed(true)",'conversation-empty');
  if(width<701)check("$('#chatMessages').textContent.includes('No messages')",'empty transcript is explicit');
  add("setTheme('stratum');setView('overview')",'theme-violet');
  add("setTheme('parallax')",'theme-green');
  add("setTheme('apsis');projectUI.key='Removed fixture';setView('project')",'project-empty');
  add("state.remote=true;connectionLost({status:401})",'pairing-required');
}
steps.push({navigate:'/pair.html',shot:'pair'});
add("document.querySelector('#code').value='TEST1234';document.querySelector('#code').dispatchEvent(new Event('input'));document.querySelector('#pair').requestSubmit()",'pair-error');
check("!document.querySelector('#go').disabled && document.querySelector('#msg').textContent.includes('expired')",'pairing failure is visible and retryable');
if(phase==='touch') { const start=steps.findIndex(s=>s.click?.includes('[data-nav=home]')),end=steps.findIndex(s=>s.js?.includes('phoneuxFixture.offline=true')); steps.splice(1,steps.length-1,...steps.slice(start,end)); }
if(phase==='permission') {
  const start=steps.findIndex(s=>s.js?.includes("$('.permission-option').click()")),end=steps.findIndex(s=>s.shot==='chat-help');
  steps.splice(1,steps.length-1,{js:"select('claude:phoneux-fixture-0',{tab:'chat'});$('#steerIn').value='Keep this draft';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}))",wait:300},{wait:500,shot:'permission'},...steps.slice(start,end));
}
fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(steps,null,2));
try { await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tools/cdp-tour.mjs',out],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});child.once('exit',code=>{fs.writeFileSync(path.join(out,'checks.txt'),log);code?reject(Error(log)):resolve();});});console.log('Tour complete: '+out); }
finally {await new Promise(resolve=>{server.once('exit',resolve);server.kill();});}
