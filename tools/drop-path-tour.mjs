// Headless tour: dropping a file writes its path (never uploads), the clip still uploads, and the remove button is visible.
// The private server sees a TEMP home only; sessions and terminals are in-page fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const width = Number(process.argv[2]) || 1568, height = Number(process.argv[3]) || 773;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-drop-home-'));
const project = path.join(home, 'Work', 'Store placement'), downloads = path.join(home, 'Downloads');
fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(downloads, { recursive: true });
const zip = path.join(downloads, '2003222837_Sell_Out_Colombia_L24M_Venus.csv.zip');
fs.writeFileSync(zip, Buffer.alloc(4096, 7));
const zipStat = fs.statSync(zip);
const realProfile = process.env.USERPROFILE;
Object.assign(process.env, { USERPROFILE: home, NEXUS_LOCATE_NO_INDEX: '1' });
const server = await privateServer();
process.env.USERPROFILE = realProfile; process.env.NEXUS_PORT = '4790';
const b = await browser(width, height), report = [], out = 'docs/shots/drop-path';
fs.mkdirSync(out, { recursive: true });
const check = async (expression, label) => { assert(await b.js(expression), label); report.push('PASS ' + label); console.log(report.at(-1)); };
const shot = async name => { await b.shot(`${out}/${width}-${name}.png`); };
const dropFile = (target, file, extra = '') => b.js(`(() => { window.dt = new DataTransfer(); const f = new File([new Uint8Array(${file.size})], ${JSON.stringify(file.name)}, {lastModified:${file.lastModified}}); dt.items.add(f); ${extra}
  const el = document.querySelector(${JSON.stringify(target)}); el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt})); el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); })()`);
try {
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.dropFixture = {now:Date.now(),home:${JSON.stringify(home)},sessions:[],terms:[],usage:{},briefing:null};
    window.uploadRequests = 0; const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) { if (String(url).includes('/api/upload')) uploadRequests++; return nativeOpen.call(this, method, url, ...rest); };
    const nativeFetch = window.fetch;
    window.fetch = (url, options) => String(url).startsWith('/api/sessions') ? Promise.resolve(new Response(JSON.stringify(dropFixture))) : String(url).startsWith('/api/transcript') || String(url).startsWith('/api/chat') ? Promise.resolve(new Response(JSON.stringify({size:0,events:[],capturedAt:Date.now(),queue:{items:[],hosted:false,reason:'Open this session in NEXUS to queue messages'}}))) : String(url)==='/api/action' ? Promise.reject(Error('Fixture refuses session actions')) : nativeFetch(url,options);
  ` });
  await b.navigate(); await b.until('state.booted'); await sleep(400);
  await b.js(`
    refresh = async () => {}; act = async action => {if(action==='viewed')return true;throw Error('No session mutation allowed')};
    window.fixtureTerms = [{id:'drop-copilot',kind:'copilot',title:'Store placement · browser fixture',cwd:${JSON.stringify(project)},exited:null}];
    state.terms = fixtureTerms; dropFixture.terms = fixtureTerms;
    window.sent = []; termSend = (v,text) => {sent.push(text);return true};
    for (const t of fixtureTerms) termViews.set(t.id, {id:t.id,el:document.createElement('div'),ws:{readyState:1},xt:{buffer:{active:{length:1,getLine:()=>({translateToString:()=>'Drop path tour'})}}}});
    state.sel='term:drop-copilot';state.tab='chat';setView('focus');renderHead();
  `);
  await b.until("!!$('#steerIn')");

  // 1. The remove button of a refused file is visible and frees Send.
  await b.js("$('#steerIn').value='Sell-out data';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}));window.big=new File(['tiny'],'too big.csv.zip');Object.defineProperty(big,'size',{value:58*1024*1024});const bigDT=new DataTransfer();bigDT.items.add(big);const input=$('#steer [data-file-picker=file]');input.files=bigDT.files;input.dispatchEvent(new Event('change',{bubbles:true}))");
  await check("!!$('#steer .attachment-chip.error') && $('#steer [data-steer=send]').disabled", 'a refused file shows its chip and holds Send');
  await check("(() => { const b = $('#steer .attachment-chip.error .attachment-remove'), r = b.getBoundingClientRect(), L = parseFloat((getComputedStyle(b).color.match(/oklch\\(([\\d.]+)/) || [])[1]); return r.width >= 28 && r.height >= 28 && L >= 0.6 && document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)?.closest('.attachment-remove') === b; })()", 'the remove button is visible (light on dark), sized and on top');
  if (width < 701) await check("$('#steer .attachment-chip.error .attachment-remove').getBoundingClientRect().height>=44", 'phone remove button keeps a 44px target');
  await shot('error-chip-remove');
  await b.js("$('#steer .attachment-chip.error .attachment-remove').click()");
  await check("!$('#steer .attachment-chip') && !$('#steer [data-steer=send]').disabled && $('#steerIn').value==='Sell-out data'", 'remove clears the chip, keeps the text and frees Send');

  // 2. Dropping inserts the path where the caret is, without uploading.
  await b.js(`window.dt=new DataTransfer();dt.items.add(new File([new Uint8Array(${zipStat.size})],${JSON.stringify(path.basename(zip))},{lastModified:${Math.round(zipStat.mtimeMs)}}));$('#steerIn').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}))`);
  await check("$('#steer').classList.contains('attachment-drag') && getComputedStyle($('#steer'),'::after').content.includes('Drop to insert the file path')", 'dragging a file over the composer says it will insert the path');
  await shot('drag-over');
  await b.js("$('#steer').dispatchEvent(new DragEvent('dragleave',{bubbles:true,relatedTarget:document.body}))");
  await b.js("$('#steerIn').value='Here is the sell-out: please unzip it';$('#steerIn').focus();$('#steerIn').setSelectionRange(22,22)");
  await dropFile('#steerIn', { name: path.basename(zip), size: zipStat.size, lastModified: Math.round(zipStat.mtimeMs) });
  await b.until(`$('#steerIn').value.includes(${JSON.stringify(zip)})`, 8000);
  await check(`$('#steerIn').value===${JSON.stringify('Here is the sell-out: ' + zip + ' please unzip it')}`, 'the dropped file path lands at the caret with spacing');
  await check("uploadRequests===0 && !$('#steer .attachment-chip') && !$('#steer').classList.contains('attachment-drag')", 'dropping never uploads and leaves no chip');
  await check("document.activeElement===$('#steerIn') && !$('#steer [data-steer=send]').disabled", 'focus returns to the message and Send is ready');
  await shot('path-inserted');

  // 3. Paths with spaces are quoted; file:// links (editors) skip the lookup.
  await b.js("$('#steerIn').value='';$('#steerIn').blur()");
  await b.js("window.uriDT=new DataTransfer();uriDT.setData('text/uri-list','file:///C:/Reports/Q3%20sell%20out.xlsx');$('#steerIn').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:uriDT}))");
  await b.until("!!$('#steerIn').value", 4000);
  await check(`$('#steerIn').value===${JSON.stringify('"C:\\Reports\\Q3 sell out.xlsx"')}`, 'a file:// link becomes a quoted Windows path');

  // 4. A file that is not on this PC is reported, not guessed.
  await b.js("$('#steerIn').value='keep me';$('#toasts').innerHTML=''");
  await dropFile('#steerIn', { name: 'not-on-this-pc.zip', size: 10, lastModified: 1 });
  await b.until("$('#toasts').textContent.includes('Path not found')", 10000);
  await check("$('#steerIn').value==='keep me' && uploadRequests===0", 'an unknown file leaves the message alone and uploads nothing');
  await b.js("$('#toasts').innerHTML=''");

  // 5. Stray drops elsewhere never navigate away from NEXUS; the clip still uploads.
  await check("(() => { const d=new DataTransfer(); d.items.add(new File(['x'],'stray.txt')); const e=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}); document.body.dispatchEvent(e); return e.defaultPrevented; })()", 'a file dropped outside the composer is ignored instead of opening it');
  await b.js("$('#steerIn').value='';const d=new DataTransfer();d.items.add(new File(['clip upload'],'clip.txt'));const input=$('#steer [data-file-picker=file]');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))");
  await b.until("!!$('#steer .attachment-chip.done')", 15000);
  await check("uploadRequests===1 && /clip\\.txt$/.test($('#steerIn').value)", 'the clip button still uploads and inserts the uploaded copy');
  await shot('clip-upload');
  await b.js("$('#steer .attachment-remove').click()");

  // 6. A pasted screenshot uploads like the clip and gets a dated name; text copied with a picture of it stays text.
  const paste = (items, target = '#steerIn') => `(() => { const d = new DataTransfer(); ${items} const e = new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:d}); document.querySelector(${JSON.stringify(target)}).dispatchEvent(e); return e.defaultPrevented; })()`;
  const png = "d.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])],'image.png',{type:'image/png'}));";
  await b.js("$('#steerIn').value='What is wrong here?';$('#steerIn').focus()");
  await check(paste(png), 'pasting a screenshot is taken over by NEXUS');
  await b.until("!!$('#steer .attachment-chip.done')", 15000);
  await check("uploadRequests===2 && /^What is wrong here\\?\\n.*[\\\\/]Pasted image \\d{4}-\\d\\d-\\d\\d \\d{6}\\.png$/.test($('#steerIn').value) && $('#steer .attachment-chip.done small').textContent.startsWith('Photo')", 'the pasted image is uploaded with a dated name and its path follows the message');
  const saved = await b.js("$('#steerIn').value.split('\\n')[1]");
  assert(fs.readFileSync(saved).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])), 'pasted bytes'); report.push('PASS the PC holds the exact pasted bytes'); console.log(report.at(-1));
  await shot('pasted-image');
  await b.js("$('#steer .attachment-remove').click()");
  await check(`!${paste("d.setData('text/plain','Region\\tSales'); " + png)} && uploadRequests===2 && !$('#steer .attachment-chip')`, 'cells copied with a picture of them paste as text, uploading nothing');

  // 7. An idle session that NEXUS does not host shows no queue note.
  await b.js("window.idle={kind:'copilot',id:'idle-fixture',title:'Store placement',cwd:" + JSON.stringify(project) + ",group:'Work',groupLabel:'Work',status:'idle',updated:Date.now()-3600000,size:0};dropFixture.sessions=[idle];await refreshData();select(keyOf(idle),{tab:'chat'})");
  await sleep(1200);
  await check("chatFor(state.sel).queue?.hosted===false && !!$('#nxQueue') && !$('#nxQueue .nx-queue-note')", 'an idle session not open in NEXUS shows no queue note');
  assert.equal(b.exceptions.length, 0, JSON.stringify(b.exceptions));
  report.push('PASS no uncaught browser exceptions; the server only saw a TEMP home.');
} finally {
  await b.close(); await server.close(); fs.writeFileSync(`${out}/${width}-tour.txt`, report.join('\n') + '\n');
  const resolved = fs.realpathSync(home); if (path.basename(resolved).startsWith('nexus-drop-home-')) fs.rmSync(resolved, { recursive: true, force: true });
}
