// Headless tour: Recent work lists the latest sessions on this PC, newest first, labels Windows and WSL,
// tells each session as a sentence grouped by theme, and opens from the sidebar foot, Home, the phone Home, the R key and the command palette. In-page fixtures only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const out = 'docs/shots/recent-work';
fs.mkdirSync(out, { recursive: true });
const server = await privateServer(); process.env.NEXUS_PORT = '4790';
const fixture = `
  const M = 60000, now = Date.now();
  const s = (id, title, cwd, minutes, extra = {}) => ({kind:'copilot',id,title,cwd,group:'Work',groupLabel:'Work',status:'done',runState:'complete',updated:now-minutes*M,size:10,theme:{id:null,name:'Unsorted',source:'unsorted'},...extra});
  window.fixtureSessions = [
    s('w1','Fix login form','C:\\\\Work\\\\web',2,{status:'busy',runState:'active',live:true,lastPrompt:'Make the login button work on mobile',latestContext:'Edited 2 files in src/',touchedFiles:['C:\\\\Work\\\\web\\\\login.tsx','console.log','server.js','d.sessions.slice']}),
    s('n1','Install Nexus and Create Shortcut','C:\\\\Work\\\\nexus',3,{lastPrompt:'and add a shortcut please',lastText:'The NEXUS shortcut is on your desktop.'}),
    s('c1','THEMES UI + COPILOT POLISH','C:\\\\Work\\\\deck',4,{lastText:'Themes UI and Copilot polish committed.'}),
    s('e1','Copilot session','C:\\\\Work\\\\empty',6),
    s('l1','Deploy script','/home/ana/deploy',5,{lastPrompt:'Why does the deploy fail?',lastText:'The SSH key path was wrong; fixed in deploy.sh.',touchedFiles:['deploy.sh']}),
    s('l2','API tests','\\\\\\\\wsl.localhost\\\\Ubuntu-22.04\\\\home\\\\ana\\\\api',9,{lastPrompt:'Run the API tests',lastText:'All 42 tests pass.'}),
    s('l3','Windows files from WSL','/mnt/c/Work/data',15,{firstPrompt:'Clean the CSV export'}),
    s('g1','Git Bash session','/c/Work/tools',20,{needsInput:true,lastPrompt:'Can I delete the old build folder?'}),
    s('child','Delegated helper','C:\\\\Work\\\\web',1,{parent:{key:'copilot:w1',relation:'delegated'}}),
    ...Array.from({length:6},(_,i)=>s('o'+i,'Older session '+(i+1),'C:\\\\Work\\\\old'+i,60*(i+2)))
  ];
  const json = body => new Response(JSON.stringify(body)), nativeFetch = window.fetch;
  window.fetch = async (url, options) => {
    url = String(url);
    if (url.startsWith('/api/sessions')) return json({now:Date.now(),rev:'r1',home:'C:\\\\Users\\\\fixture',sessions:fixtureSessions,terms:[],usage:{},briefing:null});
    if (url.startsWith('/api/themes')) return json({themes:[]});
    if (url.startsWith('/api/chat') || url.startsWith('/api/transcript')) return json({events:[],status:'Waiting for you',queue:null});
    return nativeFetch(url, options);
  };
`;
async function tour(width, height) {
  const b = await browser(width, height), report = [];
  const check = async (expression, label) => { assert(await b.js(expression), label); report.push('PASS ' + label + ' @' + width); console.log(report.at(-1)); };
  try {
    await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: fixture });
    await b.navigate(); await b.until('state.booted&&state.sessions.length===15'); await sleep(600);
    await b.js(`window.rows=()=>[...document.querySelectorAll('#modal .nx-recent-work li')];window.row=id=>document.querySelector('#modal [data-recent-open="copilot:'+id+'"]')?.closest('li');window.said=id=>row(id).querySelector('.nx-rw-sentence strong').textContent;true`);
    if (width <= 700) {
      await b.js(`setView('overview');true`); await sleep(300);
      await b.js(`document.querySelector('.nx-phone-home-head [data-recent-work]').click()`);
      await check(`rows().length===10&&document.documentElement.scrollWidth<=innerWidth`, 'phone Home opens Recent work without sideways scroll');
      await b.shot(`${out}/${width}-recent.png`);
      return report;
    }
    await check(`!document.querySelector('.nx-main-nav [data-recent-work]')&&!!document.querySelector('#nxSidebar .nx-quick [data-nx=palette]+[data-recent-work]')`, 'Recent sits beside Commands under the views, as a button');
    await check(`[...document.querySelectorAll('.nx-quick>button>span')].every(s=>s.scrollWidth<=s.clientWidth)`, 'Commands and Recent labels are not clipped');
    await b.js(`document.querySelector('#nxSidebar .nx-quick [data-recent-work]').click()`);
    await check(`rows().length===10&&rows()[0]===row('w1')&&rows()[9]===row('o2')`, 'the sidebar button lists the latest 10 with something to tell, newest first');
    await check(`!row('child')&&!row('e1')&&document.querySelector('.nx-rw-note').textContent==='1 empty session left out.'`, 'delegated helpers stay with their parent and empty sessions are left out, with a note');
    await check(`said('n1')==='You installed Nexus and created shortcut'&&said('l1')==='You deployed script'`, 'task titles read as what you did, keeping names capitalised');
    await check(`said('w1')==='Now fixing login form'&&said('g1')==='Waiting for you in “Git Bash session”'`, 'working and waiting sessions say so');
    await check(`said('c1')==='You worked on “Themes UI + Copilot polish”'&&said('l3')==='You worked on “Windows files from WSL”'`, 'other titles are quoted, and all-caps titles are calmed down');
    await check(`JSON.stringify(['w1','l1','l2','l3','g1'].map(id=>row(id).querySelector('.nx-rw-env').textContent))==='["Windows","WSL","WSL · Ubuntu-22.04","WSL","Windows"]'`, 'Windows, WSL paths, \\\\wsl.localhost and Git Bash are labelled correctly');
    await check(`(()=>{const t=document.querySelector('.nx-rw-summary').textContent;return t.startsWith('In the last 24 hours you worked in Unsorted.')&&t.includes('1 needs you')&&t.includes('1 working')&&t.includes('7 on Windows, 3 in WSL');})()`, 'summary says where you worked, what needs you, what works, and Windows vs WSL');
    await check(`(()=>{const r=row('w1');return r.querySelector('.nx-rw-result').textContent==='Edited 2 files in src/'&&r.querySelector('.nx-rw-files').textContent==='login.tsx, server.js'&&!r.textContent.includes('Make the login button work on mobile');})()`, 'a row shows the result and real file names, not your raw message');
    await check(`row('l1').querySelector('.nx-rw-result').textContent.includes('The SSH key path was wrong')&&!row('g1').querySelector('.nx-rw-result')`, 'the agent reply is the result; your own message never poses as one');
    await check(`document.querySelectorAll('#modal .nx-rw-theme').length===1&&document.querySelector('#modal .nx-rw-theme h3').textContent.startsWith('Unsorted')`, 'rows are grouped under their theme');
    await b.shot(`${out}/${width}-recent.png`);
    await b.js(`document.querySelector('[data-recent-more]').click()`);
    await check(`rows().length===13&&!document.querySelector('[data-recent-more]')`, 'Show 10 more lists the rest');
    await b.js(`row('l1').querySelector('[data-recent-open]').click()`);
    await check(`!document.querySelector('#modal').classList.contains('on')&&state.sel==='copilot:l1'`, 'a row opens its session');
    await b.js(`setView('overview');true`); await sleep(300);
    await b.js(`document.querySelector('.nx-welcome [data-recent-work]').click()`);
    await check(`rows().length===10`, 'Home offers Recent work next to New session');
    await b.js(`closeModal();document.activeElement.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true}));true`);
    await check(`rows().length===10`, 'R opens Recent work');
    await b.js(`closeModal();document.querySelector('#search').focus();document.querySelector('#search').dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true}));true`);
    await check(`!document.querySelector('#modal').classList.contains('on')`, 'typing r in a field does not open it');
    await b.js(`document.querySelector('#search').blur();nxPalette();true`); await sleep(200);
    await check(`nxCommands().some(c=>c.label==='Recent work')`, 'the command palette offers Recent work');
    await b.js(`closeModal();nxRecentWork();row('l2').querySelector('[data-recent-catchup]').click();true`); await sleep(400);
    await check(`!document.querySelector('#modal').classList.contains('on')&&state.sel==='copilot:l2'&&state.view==='focus'&&nx.panelMode==='catchup'`, 'Catch up opens the session with its catch-up');
    assert.deepEqual(b.exceptions, [], 'page exceptions');
    return report;
  } finally { await b.close(); }
}
try {
  const report = [];
  for (const [w, h] of [[1568, 773], [1100, 800], [440, 956]]) report.push(...await tour(w, h));
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log('recent work tour passed');
} finally { await server.close(); }
