// Headless tour: a Copilot autopilot answer (given through task_complete) reads as Copilot's reply with its table
// rendered, not as tool output in monospace; a queued message says what it waits for. Events come from the real
// Copilot parser; the page gets them through in-page fixtures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const require = createRequire(import.meta.url), cp = require('../copilot.js');
const out = 'docs/shots/copilot-reply';
fs.mkdirSync(out, { recursive: true });
const answer = 'The new market is on the dashboard for the three brands, and the run finished without errors.\n\n' +
  '- **New comments:** all 15.7k comments from the backfill are classified.\n- **Every market rebuilt:** the cross-market benchmarks now include it.\n\n' +
  '**Last 30 days**\n\n| Brand | Comments | Status | Negativity vs 3 months / other markets / category |\n|---|---|---|---|\n' +
  '| North | 1,407 | Needs action | 100 / 94 / 88 / 91 |\n| East | 347 | Needs action | 102 / 147 / 124 / 128 |\n| South | 316 | Keep an eye | n/a / 65 / 108 / 79 |\n\n' +
  'In the index, 100 means as negative as the comparison; above 100 is more negative. ' + 'Every market was rebuilt from the same source and checked against the previous run. '.repeat(10);
const at = n => new Date(Date.now() - (10 - n) * 60000).toISOString(), rec = (type, data, n) => ({ type, data, timestamp: at(n) });
const call = { toolCallId: 'done-1', name: 'task_complete', arguments: { summary: answer } };
const events = cp.dedupe([
  rec('user.message', { content: 'Add the new market to the dashboard' }, 0),
  rec('assistant.message', { content: '', toolRequests: [call] }, 1),
  rec('tool.execution_start', { toolCallId: 'done-1', toolName: 'task_complete', arguments: { summary: answer }, intentionSummary: 'The new market is on the dashboard for the three...' }, 2),
  rec('tool.execution_complete', { toolCallId: 'done-1', success: true, result: { content: answer } }, 3)
].flatMap(cp.events));
const reason = "Waiting for the session's message box. If the session looks finished, check Raw terminal.";
const fixture = `
  const now = Date.now();
  window.fixtureSessions = [{kind:'copilot',id:'r1',title:'Market dashboard',cwd:'C:\\\\Work\\\\dashboard',group:'Work',groupLabel:'Work',status:'done',runState:'complete',updated:now-60000,size:10,theme:{id:null,name:'Unsorted',source:'unsorted'}}];
  const json = body => new Response(JSON.stringify(body)), nativeFetch = window.fetch;
  window.fetch = async (url, options) => {
    url = String(url);
    if (url.startsWith('/api/sessions')) return json({now:Date.now(),rev:'r1',home:'C:\\\\Users\\\\fixture',sessions:fixtureSessions,terms:[],usage:{},briefing:null});
    if (url.startsWith('/api/themes')) return json({themes:[]});
    if (url.startsWith('/api/chat') || url.startsWith('/api/transcript')) return json({events:${JSON.stringify(events)},status:'Waiting for you',cursor:'c1',
      terminal:{id:'t1',exited:null,prompt:null,menu:false,ready:false,input:false,busy:false},
      queue:{items:[{id:'q1',text:'What are the next steps?',status:'queued',at:now}],history:[],active:null,hold:'',hosted:true,reason:${JSON.stringify(reason)}}});
    return nativeFetch(url, options);
  };
`;
const server = await privateServer(); process.env.NEXUS_PORT = '4790';
async function tour(width, height) {
  const b = await browser(width, height), report = [];
  const check = async (expression, label) => { assert(await b.js(expression), label); report.push('PASS ' + label + ' @' + width); console.log(report.at(-1)); };
  try {
    await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: fixture });
    await b.navigate(); await b.until('state.booted&&state.sessions.length===1'); await sleep(400);
    await b.js(`select('copilot:r1',{tab:'chat'});true`);
    await b.until(`!!document.querySelector('#chatMessages .ev.ai')`); await sleep(600);
    await check(`document.querySelector('#chatMessages .nx-long-reply').open&&getComputedStyle(document.querySelector('#chatMessages .nx-reply-preview')).display==='none'`, 'a long reply starts open, with no preview beside it');
    await check(`(()=>{const t=document.querySelector('#chatMessages .ev.ai .md table');return !!t&&t.querySelectorAll('tr').length===4&&t.querySelector('th').textContent==='Brand';})()`, "the answer's table is a real table");
    await check(`[...document.querySelectorAll('#chatMessages .ev.ai .md strong')].some(s=>s.textContent==='New comments:')`, 'bold text is bold, not asterisks');
    await check(`document.querySelector('#chatMessages .ev.ai .ev-label').textContent.includes('Copilot')`, "it is labelled as Copilot's reply");
    await check(`!document.querySelector('#chatMessages .chat-tools')&&!document.querySelector('#chatMessages pre')`, 'no tool card and no monospace copy of the answer');
    await check(`document.querySelector('#nxQueue .nx-queue-note')?.textContent.includes('message box')`, 'the queued message says what it waits for');
    await check(`document.documentElement.scrollWidth<=innerWidth`, 'no sideways scroll');
    await b.js(`document.querySelector('#chatMessages .ev.ai').scrollIntoView({block:'start'});true`);
    await b.shot(`${out}/${width}-reply.png`);
    await check(`(()=>{const el=document.querySelector('#chatMessages'),html=el._html;el.querySelector('.nx-long-reply').open=false;updateHTML(el,html+' ');const closed=!el.querySelector('.nx-long-reply').open;el.querySelector('.nx-long-reply').open=true;updateHTML(el,html);return closed;})()`, 'a collapsed reply stays collapsed on refresh');
    await check(`(async()=>{const key=state.sel,s=state.byKey.get(key),kind=s.kind,nativeFetch=window.fetch,input=document.querySelector('#steerIn');let sent;s.kind='claude';window.fetch=async(url,options)=>{if(String(url).includes('/api/action')){sent=JSON.parse(options.body);return new Response(JSON.stringify({ok:true,result:{}}));}return nativeFetch(url,options);};input.value='/rename Tour name';await sendChat();window.fetch=nativeFetch;s.kind=kind;return sent?.action==='session-rename'&&sent.title==='Tour name'&&input.value===''&&!document.querySelector('#nxSessionName');})()`, '/rename with a name renames at once, without a dialog');
    await check(`(async()=>{const catalog=slashCatalog,input=document.querySelector('#steerIn');slashCatalog=async()=>[{name:'rename',argsHint:'[name]',description:'Rename',source:'built-in',kind:'args'}];input.value='/ren';input.focus();await slashSuggest();const picker=document.querySelector('#nxSlashPicker'),ok=picker?.classList.contains('slash-pop')&&document.activeElement===input&&!document.querySelector('#app').inert;input.value='';slashClose();slashCatalog=catalog;return ok;})()`, 'typing a command keeps the keyboard in the message box');
    await check(`(()=>{const html=nxImages(['0123456789abcdef0123456789abcdef.png']);const host=document.createElement('div');host.innerHTML=html;document.body.append(host);host.querySelector('[data-chat-image]').click();const ok=host.querySelector('img').getAttribute('src').includes('/api/chat-image?name=')&&!!document.querySelector('#modalCard .nx-chat-image-full');closeModal();host.remove();return ok;})()`, 'a picture shows in the conversation and opens large');
    await check(`(async()=>{const nativeFetch=window.fetch;let sent;window.fetch=async(url,options)=>{if(String(url).includes('/api/action')){sent=JSON.parse(options.body);return new Response(JSON.stringify({ok:true,result:{bullets:['You worked on 2 sessions of Atlas.','You fixed a login.','You shipped a release.'],next:'Next: finish the release notes.'}}));}return nativeFetch(url,options);};nxRecentWork();document.querySelector('[data-recent-summary]').click();await new Promise(r=>setTimeout(r,200));window.fetch=nativeFetch;const ok=sent?.action==='summarize-recent'&&sent.keys.length>0&&document.querySelectorAll('.nx-rw-ai-list li').length===3&&document.querySelector('.nx-rw-ai-next').textContent==='Next: finish the release notes.'&&!document.querySelector('[data-recent-summary]');closeModal();nxRecentAi.result=null;return ok;})()`, 'What was I doing retells the latest sessions in Recent work');
    await check(`agentName('antigravity')==='Antigravity'&&nxThemeAgent({kind:'antigravity'}).includes('Antigravity')&&getComputedStyle(document.body).getPropertyValue('--agent-antigravity').trim()!==''`, 'Antigravity has its own label and colour');
    await check(`(()=>{const sent=[];restoreTermHeight({rows:12,cols:120,xt:{resize(){}},ws:{readyState:1,send:x=>sent.push(x)}});restoreTermHeight({rows:40,cols:120,xt:{resize(){}},ws:{readyState:1,send:x=>sent.push(x)}});return sent.length===1&&JSON.parse(sent[0]).r===36;})()`, 'a session left short by the Raw drawer goes back to full height');
    await b.js(`setView('settings');true`); await b.until(`!!document.querySelector('[data-nx-full-access]')`);
    await check(`document.querySelector('[data-nx-full-access]').checked&&document.querySelector('#nxSetting-agents').textContent.includes('--yolo')`, 'Settings shows the resume switch, on by default');
    await check(`document.documentElement.scrollWidth<=innerWidth`, 'Settings has no sideways scroll');
    assert.deepEqual(b.exceptions, [], 'page exceptions');
    return report;
  } finally { await b.close(); }
}
try {
  const report = [];
  for (const [w, h] of [[1280, 900], [440, 956]]) report.push(...await tour(w, h));
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log('copilot reply tour passed');
} finally { await server.close(); }
