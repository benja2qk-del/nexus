// Headless tour: the Spend page stays still while polls arrive. It is built once, the theme block is never doubled,
// a picked day survives refreshes, and themes without dollars, premium requests or AI credits add no block. In-page fixtures only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const out = 'docs/shots/spend';
fs.mkdirSync(out, { recursive: true });
const server = await privateServer(); process.env.NEXUS_PORT = '4790';
const fixture = `
  const H = 3600e3, now = Date.now(), day = n => new Date(now - n * 86400e3).toISOString().slice(0, 10);
  window.themeCatalog = [{id:'web',name:'Web app',color:'#87b9cf'},{id:'data',name:'Data pipeline',color:'#c5a5df'}];
  const spend = (total, extra = {}) => ({insights:{spend:{measured:true,total,daily:{[day(0)]:total*.6,[day(1)]:total*.4},byModel:{'claude-opus-5-5':total}}},...extra});
  window.fixtureSessions = [
    {kind:'claude',id:'a',title:'Fix login form',cwd:'C:\\\\Work',status:'busy',live:true,updated:now-30000,size:10,theme:{id:'web',name:'Web app',color:'#87b9cf',source:'owner'},...spend(5e6)},
    {kind:'copilot',id:'b',title:'Nightly export',cwd:'C:\\\\Work',status:'idle',runState:'complete',updated:now-2*H,size:10,theme:{id:'data',name:'Data pipeline',color:'#c5a5df',source:'owner'},copilotUsage:{premiumRequests:3},...spend(2e6)}
  ];
  window.polls = 0;
  const json = body => new Response(JSON.stringify(body)), nativeFetch = window.fetch;
  window.fetch = async (url, options) => {
    url = String(url);
    if (url.startsWith('/api/sessions')) { polls++; return json({now:Date.now(),rev:'r' + polls,home:'C:\\\\Users\\\\fixture',sessions:fixtureSessions,terms:[],usage:{claude:{fiveHour:{pct:10+polls,resetsAt:now+H}}},agents:{claude:{installed:true},copilot:{installed:true}},briefing:null}); }
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
    await b.navigate(); await b.until('state.booted&&nxThemes.loaded&&state.sessions.length===2'); await sleep(600);
    await b.js(`setView('spend');true`); await sleep(500);
    await b.js(`window.frame={stats:document.querySelector('#nxSpendStats'),chart:document.querySelector('#nxSpendChart'),block:document.querySelector('.nx-theme-spend-page')};document.querySelector('[data-nx-day="12"]').click();window.before=polls;true`);
    await check(`document.querySelectorAll('.nx-theme-spend-page').length===1&&document.querySelector('.nx-theme-spend-page').textContent.includes('3 premium requests')&&!document.querySelector('.nx-theme-spend-page').textContent.includes('Spend not reported')`, 'one theme spend block, listing only themes that report spend');
    await b.until('polls>=before+3', 12000);
    await b.js(`render();render();true`);
    await check(`document.querySelectorAll('.nx-theme-spend-page').length===1`, 'repeated polls and renders never double the block');
    await check(`document.querySelector('#nxSpendStats')===frame.stats&&document.querySelector('#nxSpendChart')===frame.chart&&document.querySelector('.nx-theme-spend-page')===frame.block`, 'the page frame stays in place across polls');
    await check(`document.querySelector('[data-nx-day][aria-pressed=true]').dataset.nxDay==='12'&&document.querySelector('#nxChartReadout').textContent.includes(nx.spendDays[12].day)`, 'a picked day stays picked through refreshes');
    await b.shot(`${out}/${width}-spend.png`);
    await b.js(`fixtureSessions[1].copilotUsage={};refreshNow();true`); await sleep(1500);
    await check(`!document.querySelector('.nx-theme-spend-page')`, 'no block when no theme reports dollars, premium requests or AI credits');
    await b.js(`setView('settings');true`); await sleep(400);
    await check(`!document.querySelector('#nxSpendStats')&&!!document.querySelector('.nx-settings-page')`, 'leaving Spend hands the page back to Settings');
    await b.js(`setView('spend');true`); await sleep(400);
    await check(`!!document.querySelector('#nxSpendStats .glass')&&document.querySelectorAll('#nxPage .nx-page-head').length===1`, 'coming back rebuilds the Spend frame once');
    assert.deepEqual(b.exceptions, [], 'page exceptions');
    return report;
  } finally { await b.close(); }
}
try {
  const report = [];
  for (const [w, h] of [[1568, 773], [440, 956]]) report.push(...await tour(w, h));
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log('spend tour passed');
} finally { await server.close(); }
