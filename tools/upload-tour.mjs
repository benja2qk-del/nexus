import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const width = Number(process.argv[2]) || 390, height = Number(process.argv[3]) || 844;
const server = await privateServer(); process.env.NEXUS_PORT = '4790';
const b = await browser(width, height), report = [], out = 'docs/shots/upload';
fs.mkdirSync(out, { recursive: true });
const check = async (expression, label) => { assert(await b.js(expression), label); report.push('PASS ' + label); console.log(report.at(-1)); };
const shot = async name => { await b.js("$('#toasts').innerHTML=''"); await check('document.documentElement.scrollWidth <= innerWidth', name + ': no horizontal overflow'); await b.shot(`${out}/${width}-${name}.png`); };
const pick = async (selector, files) => b.js(`(() => { const input = document.querySelector(${JSON.stringify(selector)}), dt = new DataTransfer(); for (const f of ${JSON.stringify(files)}) dt.items.add(new File([new Uint8Array(f.size || 24)], f.name, {type:f.type || 'application/octet-stream'})); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
try {
  // The terminal is explicitly a browser fixture. Only attachments reach the real test server.
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.uploadFixture = {now:Date.now(),home:${JSON.stringify(server.dir)},sessions:[],terms:[],usage:{},briefing:null};
    const nativeFetch = window.fetch;
    window.fetch = (url, options) => String(url).startsWith('/api/sessions') ? Promise.resolve(new Response(JSON.stringify(uploadFixture))) : String(url).startsWith('/api/transcript') ? Promise.resolve(new Response(JSON.stringify({size:0,events:[],capturedAt:Date.now()}))) : String(url)==='/api/action' ? Promise.reject(Error('Fixture refuses session actions')) : nativeFetch(url,options);
  ` });
  await b.navigate(); await b.until('state.booted'); await sleep(400);
  await b.js(`
    refresh = async () => {}; act = async action => {if(action==='viewed')return true;throw Error('No session mutation allowed')};
    window.fixtureTerms = ['claude','astra'].map(kind=>({id:'upload-'+kind,kind,title:'Attachment review · browser fixture',cwd:${JSON.stringify(server.dir)},exited:null}));
    state.terms = fixtureTerms; uploadFixture.terms = fixtureTerms;
    window.sent = []; termSend = (v,text) => {sent.push(text);return true};
    for (const t of fixtureTerms) termViews.set(t.id, {id:t.id,el:document.createElement('div'),ws:{readyState:1},xt:{buffer:{active:{length:4,getLine:n=>({translateToString:()=>['NEXUS attachment tour','Browser fixture · no agent is connected.','','Attach files, review your message, then Send.'][n]})}}}});
    window.choose = kind => {state.sel='term:upload-'+kind;state.tab='chat';setView('focus');renderHead()};
    choose('claude');
  `);
  await check("!!$('#steer [data-pick=file]') && !!$('#steer [data-pick=photo]')", 'Attach and Photo beside the chat composer');
  await check("$('#steer [data-file-picker=file]').multiple && !$('#steer [data-file-picker=file]').hasAttribute('accept') && $('#steer [data-file-picker=photo]').accept==='image/*'", 'unrestricted multiple file picker and separate photo picker');
  await b.js("$('#steerIn').value='Please review these files and the photo.';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}))");
  await b.cmd('Network.emulateNetworkConditions', {offline:false,latency:100,downloadThroughput:1024*1024,uploadThroughput:32*1024});
  await pick('#steer [data-file-picker=file]', [{name:'Project brief.txt',size:180000},{name:'Desk photo.HEIC',size:100000,type:'image/heic'},{name:'Reference notes.md',size:12000}]);
  await b.until("!!$('#steer .uploading')");
  await check("$$('#steer .attachment-chip').length===3 && $('#steer [data-steer=send]').disabled", 'multiple uploads display chips and hold Send');
  await b.js("steer('send')"); await check('sent.length===0', 'keyboard Send cannot bypass pending uploads');
  await b.js("$('#toasts').innerHTML=''"); await sleep(900); await shot('chat-uploading');
  await b.until("$$('#steer .done').length===3", 25000);
  await b.cmd('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await check("$('#steerIn').value.startsWith('Please review') && ($('#steerIn').value.match(/@\"/g)||[]).length===3", 'Claude references append without replacing typed text');
  await check("$$('#steer .done').some(x=>x.textContent.includes('Photo') && x.textContent.includes('HEIC'))", 'HEIC remains unchanged and is labeled Photo');
  const text = await b.js("$('#steerIn').value");
  for (const match of text.matchAll(/@"([^"]+)"/g)) assert(fs.existsSync(match[1]) && match[1].startsWith(server.env.NEXUS_UPLOAD_DIR));
  report.push('PASS every displayed reference points to a real file in TEMP');
  await shot('chat-done');
  await b.js("choose('astra')"); await check("!$('#steerIn').value && !$('#steer .attachment-chip')", 'session switch isolates the draft and chips');
  await b.js("choose('claude')"); await check("$$('#steer .done').length===3 && $('#steerIn').value.includes('Project brief.txt')", 'returning to session restores attachments');
  await b.js("$('#steer .attachment-remove').click()"); await check("$$('#steer .done').length===2 && !$('#steerIn').value.includes('Project brief.txt') && $('#steerIn').value.includes('Please review')", 'remove deletes only the selected reference and keeps user text');
  await b.js("window.NativeXHR = XMLHttpRequest; window.pendingXHR=[]; XMLHttpRequest=class {constructor(){this.upload={};pendingXHR.push(this)} open(){} setRequestHeader(){} send(){} abort(){this.onabort?.()}};");
  await pick('#steer [data-file-picker=file]', [{name:'Canceled upload.txt'}]);
  await b.js("window.canceled=pendingXHR.at(-1);$('#steer .uploading .attachment-remove').click();canceled.status=200;canceled.responseText=JSON.stringify({path:'C:\\never-inserted.txt',name:'never-inserted.txt',size:12});canceled.onload()");
  await check("!$('#steerIn').value.includes('never-inserted') && !$('#steer .uploading')", 'removal cancels an upload and ignores a late success');
  await pick('#steer [data-file-picker=file]', [{name:'Connection lost.pdf'}]);
  await b.js("pendingXHR.at(-1).onerror();XMLHttpRequest=NativeXHR");
  await check("!!$('#steer .error') && $('#steer [data-steer=send]').disabled", 'network failure remains visible and holds Send');
  await check("$('#steer .error').getBoundingClientRect().bottom <= $('#steer .attachment-list').getBoundingClientRect().bottom+1", 'failed chip is revealed inside a scrolling attachment list');
  await shot('chat-error');
  await b.js("$('#steer .error .attachment-remove').click();window.longFile=new File(['tiny'],'Long video.mov',{type:'video/quicktime'});Object.defineProperty(longFile,'size',{value:50*1024*1024+1});window.bigDT=new DataTransfer();bigDT.items.add(longFile);window.bigInput=$('#steer [data-file-picker=file]');bigInput.files=bigDT.files;bigInput.dispatchEvent(new Event('change',{bubbles:true}))");
  await check("$('#steer .error').textContent.includes('shorter video under 50 MB')", 'oversized video gets a friendly local refusal');
  await b.js("$('#steer .error .attachment-remove').click();window.submitted=$('#steerIn').value;steer('send');choose('astra');choose('claude')");
  await check("$('#steerIn').disabled", 'session switch while sending preserves the sending guard');
  await sleep(180);
  await check("!$('#steerIn').value && !$('#steer .attachment-chip') && sent.length===2 && sent[0].includes(submitted) && sent[1]==='\\r'", 'successful send clears matching draft and chips exactly once');
  await b.js("choose('astra')"); await pick('#steer [data-file-picker=photo]', [{name:'Astra photo.HEIC',type:'image/heic'}]);
  await b.until("!!$('#steer .done')");
  await check("!$('#steerIn').value.includes('@\"') && /^[A-Za-z]:\\\\/.test($('#steerIn').value)", 'Astra gets a plain absolute path');
  await shot('astra-reference');
  if (width > 700) {
    await b.js("window.drop=new DataTransfer();drop.items.add(new File(['desktop drop'],'Dropped diagram.svg',{type:'image/svg+xml'}));$('#steerIn').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:drop}))");
    await check("$('#steer').classList.contains('attachment-drag')", 'desktop drag shows a drop target'); await shot('desktop-drag-target');
    await b.js("$('#steerIn').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:drop}))");
    await b.until("$$('#steer .done').length===2"); await check("$('#steerIn').value.includes('Dropped diagram.svg') && !$('#steer').classList.contains('attachment-drag')", 'desktop drop uploads and inserts its path');
    await shot('desktop-drop-done');
  }
  if (width < 701) {
    await check("$$('#steer .btn, #steer .attachment-remove').every(x=>x.getBoundingClientRect().height>=44)", 'phone controls have 44px touch targets');
    await check("parseFloat(getComputedStyle($('#steerIn')).fontSize)>=16", 'phone composer avoids input zoom');
    await b.js("document.body.classList.add('keyboard-open');document.documentElement.style.setProperty('--visible-height','520px')");
    await check("$('#steer [data-steer=send]').getBoundingClientRect().bottom<=520", 'keyboard-height fixture keeps Send visible');
    await shot('keyboard-fixture'); await b.js("document.body.classList.remove('keyboard-open')");
  }
  await b.js("newSessionModal({kind:'claude'});$('#newMessage').value='Review this before we begin.';$('#newMessage').dispatchEvent(new Event('input'))");
  await pick('#newAttachments [data-file-picker=file]', [{name:'Starting brief.md'}]); await b.until("!!$('#newAttachments .done')");
  await check("$('#newMessage').value.includes('@\"')", 'new-session attachments populate the optional first message');
  await b.js("$('#modalCard [value=astra]').click()"); await check("!$('#newMessage').value.includes('@\"') && $('#newMessage').value.includes('Starting brief.md')", 'changing agent updates attachment reference format');
  await shot('new-session-attachment');
  await b.js("window.launches=0;window.originalOpen=openInApp;openInApp=async()=>{launches++;return false};$('#startSession').click()");
  await b.until("$('#startSession').textContent==='Try again'");
  await check("$('#newMessage').value.includes('Starting brief.md') && !!$('#newAttachments .done')", 'failed launch preserves message and attachment');
  await b.js("window.newText=$('#newMessage').value;openInApp=async()=>{choose('astra');return true};$('#startSession').click()");
  await b.until("!$('#modal').classList.contains('on')");
  await check("$('#steerIn').value===newText && $$('#steer .done').length===1 && state.tab==='chat' && sent.length===2", 'new-session handoff opens Chat with draft ready for review, without sending');
  await shot('new-session-handoff');
  // Exercise the real refresh migration used when a new terminal learns its session id.
  await b.js("XMLHttpRequest=class {constructor(){this.upload={};window.lateUpload=this} open(){} setRequestHeader(){} send(){} abort(){this.onabort?.()}};");
  await pick('#steer [data-file-picker=file]', [{name:'Late reference.md'}]);
  await b.js("choose('claude');window.linked={kind:'astra',id:'linked-fixture',title:'Attached draft after session discovery',cwd:state.home,group:'Scratch',groupLabel:'Scratch',status:'idle',updated:Date.now(),size:0,term:'upload-astra'};uploadFixture.sessions=[linked];uploadFixture.terms=fixtureTerms.map(t=>t.kind==='astra'?{...t,sessionKey:keyOf(linked)}:t);await refreshData();lateUpload.status=200;window.latePath=newText.split('\\n').at(-1);lateUpload.responseText=JSON.stringify({path:latePath,name:'Late reference.md',size:24});lateUpload.onload();XMLHttpRequest=NativeXHR;select(keyOf(linked),{tab:'chat'})");
  await check("state.sel==='astra:linked-fixture' && $('#steerIn').value===newText+'\\n'+latePath && $$('#steer .done').length===2", 'background upload and draft follow new terminal to its discovered session key');
  await b.js("$('#steerIn').value+='\\nKeep this edit.';$('#steerIn').dispatchEvent(new Event('input'));await refreshData()");
  await check("$('#steerIn').value.endsWith('Keep this edit.')", 'later polls cannot restore a pre-migration draft');
  await b.js("openInApp=originalOpen;newSessionModal();XMLHttpRequest=class {constructor(){this.upload={};window.modalXHR=this} open(){} setRequestHeader(){} send(){} abort(){window.modalUploadCanceled=true;this.onabort?.()}};");
  await pick('#newAttachments [data-file-picker=file]', [{name:'Pending draft.txt'}]);
  await b.js("window.focusedFolder=$('#folderOptions button');focusedFolder.focus();modalXHR.upload.onprogress({lengthComputable:true,loaded:1,total:24})");
  await check('document.activeElement===focusedFolder && focusedFolder.isConnected', 'upload progress preserves keyboard focus in the folder picker');
  await b.js('closeModal();XMLHttpRequest=NativeXHR');
  await check('modalUploadCanceled===true', 'closing new-session dialog cancels pending uploads');
  assert.equal(b.exceptions.length, 0, JSON.stringify(b.exceptions));
  report.push('PASS no uncaught browser exceptions; all terminal output and writes were in-page fixtures; actual uploads used TEMP only.');
} finally {
  await b.close(); await server.close(); fs.writeFileSync(`${out}/${width}-tour.txt`, report.join('\n') + '\n');
}
