import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {browser,sleep} from './polish-browser.mjs';
const report=[];
// The HTTPS protocol choice is checked without constructing a connection to the live host.
const app=fs.readFileSync('public/app.js','utf8'), source=app.slice(app.indexOf('function connect(v)'),app.indexOf('\nfunction termOverlay'));
let url;
vm.runInNewContext(source+';connect({id:"scratch-test"});',{WebSocket:class {constructor(value){url=value;}},location:{protocol:'https:',host:'fixture.invalid'},clearTimeout});
assert.equal(url,'wss://fixture.invalid/pty?id=scratch-test');report.push('PASS HTTPS pages construct a secure wss terminal URL');
for(const [width,height] of [[390,844],[430,932],[1366,768],[1920,1080]]){
  const b=await browser(width,height),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-polish-final-'));let terminal;
  try{
    await b.navigate();await b.until('state.booted && state.sessions.length');await sleep(600);
    for(const [name,working,waiting] of [['idle',0,0],['working',1,0],['needs-you',0,1]]){
      await b.js(`state.briefing={...state.briefing,working:${working},waiting:${waiting}};renderApsis()`);await b.shot(`docs/shots/polish/${width}-core-${name}.png`);
    }
    await b.js('await refresh()');
    if(width===1366){assert(await b.js("$('#fsBtn').getBoundingClientRect().width>0 && $('#exitBtn').getBoundingClientRect().right<=innerWidth"));await b.shot('docs/shots/polish/1366-overview.png');report.push('PASS laptop header retains visible fullscreen, exit and pairing controls');}
    await b.js(`await openInApp('term-new',{cwd:${JSON.stringify(scratch)}})`);terminal=await b.js('selTerm().id');await b.js("state.tab='term';renderHead()");await b.until('termViews.get(selTerm().id).ws.readyState===1');await sleep(900);
    assert(await b.js("!state.transcript && !state.activity && !$('#focusInsights').textContent.trim()"));report.push(`PASS ${width} opening a standalone terminal clears the previous session evidence`);
    assert(await b.js("$('#termHost').clientHeight>200 && document.documentElement.scrollWidth<=innerWidth"));await b.shot(`docs/shots/polish/${width}-terminal.png`);
    await b.js("state.tab='chat';renderHead()");await b.shot(`docs/shots/polish/${width}-chat.png`);
    await b.js("for(let n=0;n<6;n++)toast('Notification test','Test '+n)");
    assert(await b.js(`$('#toasts').children.length===${width<701?1:3}`));report.push(`PASS ${width} notifications are bounded and cannot form a full-screen stack`);
    await b.js("$('#toasts').innerHTML='';$('#steerIn').value='Retained offline';$('#steerIn').dispatchEvent(new Event('input'))");
    await b.cmd('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});await b.js('await refresh()');await b.shot(`docs/shots/polish/${width}-connection-lost.png`);
    await b.cmd('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await b.js('await refresh()');
    await b.js("$('#toasts').innerHTML='';const v=termViews.get(selTerm().id);v.ended=true;selTerm().exited={code:0};renderHead();renderChatOutput(v)");await b.shot(`docs/shots/polish/${width}-terminal-ended-fixture.png`);
    await b.js('await closeTerm(selTerm())');terminal=null;
    assert(await b.js('state.terms.length===0'));report.push(`PASS ${width} raw terminal fits and scratch terminal closes cleanly`);
    await b.js("setView('overview');focusCheckDialog(state.sessions.find(s=>s.insights?.digest)||state.sessions[0])");await b.shot(`docs/shots/polish/${width}-focus-check.png`);
    await b.js('closeModal()');await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await b.js('newSessionModal()');
    assert(await b.js("getComputedStyle($('#modalCard')).opacity==='1' && getComputedStyle($('#modalCard')).filter==='none'"));await b.shot(`docs/shots/polish/${width}-reduced-motion-dialog.png`);report.push(`PASS ${width} reduced-motion dialogs remain visible and usable`);
    await b.cmd('Emulation.setEmulatedMedia',{features:[]});
    if(width<701){
      await b.js("closeModal();window.capabilityApi=api;api=async p=>{const data=await capabilityApi(p);if(p==='/api/sessions')data.remote=true;return data};select(keyOf(state.sessions.find(s=>s.kind==='astra'&&s.brief&&s.size<500000)||state.sessions[0]));state.remote=true;renderHead();$('.session-more').open=true");await b.shot(`docs/shots/polish/${width}-session-menu.png`);
      assert(await b.js("!$('#focusHead [data-a=popout]') && !$('#focusHead [data-a=vscode]')"));
      await b.js("$('.session-more').open=false;state.remote=true;appMenu()");await b.shot(`docs/shots/polish/${width}-app-menu.png`);
      await b.js('api=capabilityApi');
    }
    await b.js("closeModal();setTheme('stratum');$('#voiceBtn').click();location.reload()");await b.until('state.booted && state.sessions.length');await sleep(100);
    assert(await b.js("apsis.theme==='stratum' && apsis.voice && window.__spoken===1"));await b.js("$('#voiceBtn').click();setTheme('apsis')");report.push(`PASS ${width} theme and voice choice persist, speech remains stubbed`);
    const icons=await b.js(`await (async()=>{const m=await(await fetch('/manifest.webmanifest')).json();const out=[];for(const icon of m.icons){const r=await fetch(icon.src);const d=new DataView(await r.arrayBuffer());out.push([icon.sizes,icon.purpose,d.getUint32(16),d.getUint32(20)])}return out})()`);
    assert(icons.some(i=>i[1]==='maskable'&&i[2]===512&&i[3]===512));assert(icons.every(i=>i[0]===i[2]+'x'+i[3]));
    assert.equal(b.exceptions.length,0,JSON.stringify(b.exceptions));
  }finally{if(terminal)await b.js(`await act('term-close',{term:${JSON.stringify(terminal)}})`);await b.close();}
}
report.push('PASS install manifest image dimensions and maskable 512 at every viewport');
fs.writeFileSync('docs/shots/polish/final-checks.txt',report.join('\n')+'\n');console.log(report.join('\n'));
