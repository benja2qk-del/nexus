// Headless tour: Home on a PC greets you, circles the latest themes around the core, lists what needs you, and shows recent
// work newest first; the theme list lives only in the sidebar, whose rows say what each theme holds. Phones keep their strip.
// In-page fixtures only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const out = 'docs/shots/home';
fs.mkdirSync(out, { recursive: true });
const server = await privateServer(); process.env.NEXUS_PORT = '4790';
const fixture = `
  const H = 3600e3, now = Date.now();
  window.themeCatalog = [{id:'web',name:'Web app',color:'#87b9cf'},{id:'data',name:'Data pipeline',color:'#c5a5df',purpose:'Nightly exports for the finance team'},{id:'old',name:'Old notes',color:'#a0c4a0',about:'Archive of planning notes for the shop.'}];
  const at = id => themeCatalog.find(t => t.id === id);
  const session = (id, title, theme, extra = {}) => ({kind:'claude',id,title,cwd:'C:\\\\Work',group:'Work',groupLabel:'Work',status:'idle',runState:'complete',updated:now-60000,size:10,theme:theme?{id:theme,name:at(theme).name,color:at(theme).color,source:'owner'}:{id:null,name:'Unsorted',source:'unsorted'},...extra});
  window.fixtureSessions = [
    session('a','Fix login form','web',{status:'busy',runState:'active',live:true,updated:now-30000}),
    session('b','Refactor API client','web',{updated:now-H,lastPrompt:'Hey, can you refactor the API client so retries back off? Thanks',lastText:'Done. Retries now back off exponentially.'}),
    session('c','Old spike','web',{updated:now-72*H}),
    session('d','Nightly export','data',{updated:now-2*H}),
    session('e','Where are the files?',null,{updated:now-600000}),
    ...Array.from({length:12},(_,i)=>session('o'+i,'Archived plan '+(i+1),'old',{updated:now-(100+i)*H}))
  ];
  const json = body => new Response(JSON.stringify(body)), nativeFetch = window.fetch;
  window.fetch = async (url, options) => {
    url = String(url);
    if (url.startsWith('/api/sessions')) return json({now:Date.now(),rev:'r1',home:'C:\\\\Users\\\\fixture',sessions:fixtureSessions,terms:[],usage:{},briefing:null});
    if (url.startsWith('/api/themes')) return json({themes:themeCatalog});
    if (url.startsWith('/api/chat') || url.startsWith('/api/transcript')) return json({events:[],status:'Waiting for you',queue:null});
    return nativeFetch(url, options);
  };
`;
async function tour(width, height) {
  const b = await browser(width, height), report = [];
  const check = async (expression, label) => { assert(await b.js(expression), label); report.push('PASS ' + label + ' @' + width); console.log(report.at(-1)); };
  try {
    await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: fixture });
    await b.navigate(); await b.until('state.booted&&nxThemes.loaded&&state.sessions.length===17'); await sleep(600);
    await b.js(`setView('overview');true`); await sleep(400);
    if (width <= 700) {
      await check(`!!document.querySelector('#nxHome .nx-themes-strip .nx-theme-tile')&&!document.querySelector('.nx-orbit')&&!document.querySelector('.nx-welcome')`, 'phones keep the theme strip and no orbit');
      await check(`document.documentElement.scrollWidth<=innerWidth`, 'no sideways scroll on the phone');
      await b.shot(`${out}/${width}-home.png`);
      return report;
    }
    await check(`!document.querySelector('#nxHome .nx-themes-strip')`, 'Home does not repeat the sidebar theme list');
    await check(`/^(Good (morning|afternoon|evening)|Working late)\\.$/.test(document.querySelector('.nx-welcome h2').textContent)&&document.querySelector('.nx-welcome-status').textContent==='1 working'&&document.querySelector('.nx-welcome-where').textContent==='Last active in Web app just now.'`, 'a greeting, what is going on, and where you were last');
    await check(`JSON.stringify([...document.querySelectorAll('.nx-orbit-node b')].map(e=>e.textContent))===JSON.stringify(['Web app','Unsorted','Data pipeline','Old notes'].slice(0,innerWidth<1500?3:5))`, 'the latest themes circle the core, most recent first');
    await check(`document.querySelectorAll('.nx-orbit-sat.busy').length===1&&document.querySelector('.nx-orbit-core').dataset.state==='working'`, 'a working session circles the core on the inner ring');
    await check(`(()=>{const d=[...document.querySelectorAll('.nx-orbit-detail p')].map(n=>n.textContent);return d[0].startsWith('Fix login form · Refactor API client')&&d[2].startsWith('Nightly exports for the finance team');})()`, 'each node can tell what its theme holds');
    await check(`(()=>{const arm=getComputedStyle(document.querySelector('.nx-orbit-outer .nx-orbit-arm')),label=getComputedStyle(document.querySelector('.nx-orbit-node'));return arm.animationName==='nx-orbit-arm'&&label.animationName==='nx-orbit-label';})()`, 'the orbit is transform-only animation');
    await check(`(()=>{const o=document.querySelector('.nx-orbit').getBoundingClientRect(),cx=o.left+o.width/2,cy=o.top+o.height/2;return [...document.querySelectorAll('.nx-orbit-node')].every(n=>{const r=n.getBoundingClientRect(),dx=(r.left+r.width/2-cx)/(.28*o.width),dy=(r.top+r.height/2-cy)/(.36*o.height),d=dx*dx+dy*dy;return d>.8&&d<1.2&&Math.abs(r.width-n.offsetWidth)<1;});})()`, 'labels ride the ellipse upright and unscaled');
    await check(`(()=>{const o=document.querySelector('#nxHome .nx-orbit');renderApsis();renderApsis();return document.querySelector('#nxHome .nx-orbit')===o&&!!o.style.getPropertyValue('--phase');})()`, 'an unchanged poll does not rebuild Home');
    await b.js(`document.querySelector('.nx-orbit-node').focus();true`);
    await check(`document.querySelectorAll('.nx-orbit-detail:not([hidden])').length===1&&getComputedStyle(document.querySelector('.nx-orbit-arm')).animationPlayState==='paused'`, 'keyboard focus reveals a stationary detail and pauses the orbit');
    await b.js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
    await check(`!document.querySelector('.nx-orbit-detail:not([hidden])')`, 'Escape dismisses the detail without moving focus');
    await b.js(`document.activeElement.blur();true`);
    await check(`[...document.querySelectorAll('.nx-orbit-node')].every(n=>{const r=n.getBoundingClientRect(),o=document.querySelector('.nx-orbit').getBoundingClientRect();return r.left>=o.left&&r.right<=o.right;})`, 'orbit labels stay inside their available width');
    await check(`!document.querySelector('.nx-theme-pick .nx-theme-counts')`, 'sidebar title has room beside the single session counter');
    await check(`(()=>{const rows=[...document.querySelectorAll('.nx-recent-list .nx-recent')].map(r=>r.dataset.open),want=state.sessions.filter(s=>!['ready','busy'].includes(statusLabel(s)[0])).sort((a,b)=>b.updated-a.updated).map(keyOf);return rows.length===12&&JSON.stringify(rows)===JSON.stringify(want.slice(0,12));})()`, 'recent work is one list, newest first');
    await check(`[...document.querySelectorAll('.nx-recent-list .nx-recent')].every(r=>r.querySelector('.nx-theme-label'))`, 'each recent row names its theme');
    await b.js(`document.querySelector('[data-nx-recent-all]').click()`);
    await check(`document.querySelectorAll('.nx-recent-list .nx-recent').length===16&&document.querySelector('[data-nx-recent-all]').textContent==='Show the latest 12'`, 'Show all lists the rest');
    await check(`(()=>{const row=document.querySelector('.nx-theme-rail-row[data-theme-drop=web]');return row.querySelector('.nx-theme-count').textContent==='3'&&row.querySelector('.nx-theme-context').textContent==='Fix login form · Refactor API client'&&!row.querySelector('time');})()`, 'sidebar rows show what a theme holds and a small counter');
    await check(`document.querySelector('.nx-theme-rail-row[data-theme-drop=data] .nx-theme-context').textContent==='Nightly exports for the finance team'`, 'a theme purpose wins over session titles');
    await check(`document.querySelector('.nx-theme-rail-row[data-theme-drop=old] .nx-theme-context').textContent==='Archive of planning notes for the shop.'`, 'without a purpose, the project description says what a theme is');
    if (width >= 1200) await check(`document.querySelector('.nx-theme-column [data-session-key="claude:b"] .nx-row-context').textContent==='You: Refactor the API client so retries back off? · Claude: Done.'`, 'a session card says what the latest exchange was about');
    await check(`document.documentElement.scrollWidth<=innerWidth`, 'no sideways scroll');
    if (width < 1200) await check(`document.querySelector('.nx-orbit').getBoundingClientRect().left>=document.querySelector('.nx-welcome-text').getBoundingClientRect().right`, 'the orbit stays beside the greeting on a narrower screen');
    await b.shot(`${out}/${width}-home.png`);
    await b.js(`document.querySelector('.nx-orbit-node[data-theme-pick=data]').click()`); await sleep(200);
    await check(`nxThemes.selected==='data'&&document.querySelector('.nx-orbit-node[data-theme-pick=data]').classList.contains('selected')`, 'clicking a theme in the orbit selects it');
    await b.js(`document.querySelector('.nx-orbit-node[data-theme-pick=data]').focus();renderApsis();true`);
    await check(`document.activeElement.dataset.themePick==='data'&&document.activeElement.getAttribute('aria-pressed')==='true'`, 'the selected orbit node retains keyboard focus');
    if (width >= 1200) await check(`document.querySelector('.nx-theme-column-head b').textContent==='Data pipeline'`, 'the session column shows the theme picked in the orbit');
    await b.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await check(`getComputedStyle(document.querySelector('.nx-orbit-node')).animationName==='none'`, 'reduced motion holds the orbit still');
    assert.deepEqual(b.exceptions, [], 'page exceptions');
    return report;
  } finally { await b.close(); }
}
try {
  const report = [];
  for (const [w, h] of [[1920, 1080], [1366, 768], [1100, 800], [440, 956]]) report.push(...await tour(w, h));
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log('home tour passed');
} finally { await server.close(); }
