// Headless tour: delta session polls merge in place, Send clears the box at once (and restores it on failure),
// and a queued message has only Send now and remove. All session data and actions are in-page fixtures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const width = Number(process.argv[2]) || 1568, height = Number(process.argv[3]) || 773;
const server = await privateServer(); process.env.NEXUS_PORT = '4790';
const b = await browser(width, height), report = [], out = 'docs/shots/responsive';
fs.mkdirSync(out, { recursive: true });
const check = async (expression, label) => { assert(await b.js(expression), label); report.push('PASS ' + label); console.log(report.at(-1)); };
try {
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
    const session = (id, title, extra = {}) => ({kind:'claude',id,title,cwd:'C:\\\\Work',group:'Work',groupLabel:'Work',status:'idle',updated:Date.now()-60000,size:10,...extra});
    window.polls = []; window.actions = []; window.sendDelay = 1200; window.sendFails = false;
    window.pollReplies = [
      {now:Date.now(),rev:'r1',home:'C:\\\\Users\\\\fixture',sessions:[session('a','First session'),session('b','Second session')],terms:[],usage:{},briefing:null},
      {now:Date.now(),rev:'r2',delta:true,order:['claude:b','claude:a'],home:'C:\\\\Users\\\\fixture',sessions:[session('b','Second session renamed',{marker:'delta',updated:Date.now()})],terms:[],usage:{},briefing:null}
    ];
    const nativeFetch = window.fetch;
    window.fetch = async (url, options) => {
      url = String(url);
      if (url.startsWith('/api/sessions')) { polls.push(url); const last = pollReplies.at(-1), reply = pollReplies[polls.length - 1] || {...last, rev:'r' + polls.length, delta:true, order:last.order, sessions:[]}; return new Response(JSON.stringify(reply)); }
      if (url.startsWith('/api/chat') || url.startsWith('/api/transcript')) return new Response(JSON.stringify({events:[],status:'Waiting for you',queue:null}));
      if (url.startsWith('/api/term-state')) return new Response(JSON.stringify({id:'fixture',ready:true,busy:false}));
      if (url === '/api/action') {
        const body = JSON.parse(options.body); actions.push(body);
        if (body.action === 'viewed') return new Response(JSON.stringify({result:true}));
        if (body.action === 'term-send') { await new Promise(r => setTimeout(r, sendDelay)); if (sendFails) return new Response(JSON.stringify({error:'Terminal ended. Your message was not delivered.'}), {status:400}); return new Response(JSON.stringify({result:{submittedAt:Date.now(),queued:false}})); }
        if (body.action === 'queue-change') return new Response(JSON.stringify({result:{items:[],history:[],hosted:true,reason:''}}));
        return new Response(JSON.stringify({error:'Fixture refuses ' + body.action}), {status:400});
      }
      return nativeFetch(url, options);
    };
  ` });
  await b.navigate(); await b.until('state.booted'); await sleep(300);

  // 1. Delta polls merge into the list the page already has.
  await b.js('window.firstA = state.byKey.get("claude:a"); await refreshData();');
  await check("polls.some(u => u.includes('since=r1')) && state.sessions.map(s=>s.id).join()==='b,a' && state.byKey.get('claude:b').title==='Second session renamed' && state.byKey.get('claude:a')===firstA", 'a delta poll updates only the changed session, keeps the others and follows the new order');
  await b.js('for (let i = 0; i < 16; i++) await refreshData();');
  await check("polls.filter(u => !u.includes('since=')).length >= 2", 'every 16th poll asks for the full list again');

  // 2. Send clears the box at once; the composer is not rebuilt or disabled while sending.
  await b.js(`
    refresh = async () => {};
    window.fixtureTerm = {id:'fixture',kind:'claude',title:'Fixture',cwd:'C:\\\\Work',exited:null,sessionKey:'claude:a'};
    state.terms = [fixtureTerm]; state.byKey.get('claude:a').term = 'fixture';
    pollReplies.at(-1).terms = [fixtureTerm];
    termViews.set('fixture', {id:'fixture',el:document.createElement('div'),ws:{readyState:1,close(){}},xt:{dispose(){},buffer:{active:{length:1,getLine:()=>({translateToString:()=>'fixture'})}}}});
    select('claude:a',{tab:'chat'});
  `);
  await b.until("!!$('#steerIn')");
  await b.js("window.box=$('#steerIn');box.value='Rank the stores by sell-out';box.dispatchEvent(new Event('input',{bubbles:true}));steer('send')");
  await sleep(250);
  await check("$('#steerIn')===box && box.value==='' && !box.disabled && chatFor('claude:a').sending", 'right after Send the box is empty, still the same box, and still typeable');
  await b.shot(`${out}/${width}-sending.png`);
  await b.until("!chatFor('claude:a').sending", 6000);
  await check("$('#steerIn').value==='' && actions.some(a=>a.action==='term-send'&&a.text==='Rank the stores by sell-out')", 'after delivery the box stays empty and the text was sent once');
  await b.js("sendFails=true;$('#steerIn').value='This one fails';$('#steerIn').dispatchEvent(new Event('input',{bubbles:true}));steer('send')");
  await b.until("!chatFor('claude:a').sending", 6000);
  await check("$('#steerIn').value==='This one fails'", 'a failed delivery puts the text back in the box');
  await b.js("sendFails=false;$('#steerIn').value=''");

  // 3. A queued message: the text, one small Send now, and x. Slash commands just wait.
  await b.js(`
    const chat = chatFor('claude:a');
    chat.queue = {items:[{id:'q1',text:'Also check Medellin',status:'queued',at:Date.now()},{id:'q2',text:'/compact',status:'queued',at:Date.now()}],history:[],active:null,hold:'',hosted:true,reason:'Agent is working. Messages will send when ready.'};
    chat.terminal = {id:'fixture',ready:false,busy:true};
    queueRender(chat,'claude:a');
  `);
  await check("[...$$('#nxQueue [data-queue-id=q1] button')].map(b=>b.dataset.queueAction).join()==='push,remove' && [...$$('#nxQueue [data-queue-id=q2] button')].map(b=>b.dataset.queueAction).join()==='remove'", 'a queued row offers only Send now and remove (commands only remove)');
  await check("!$('#nxQueue .nx-queue-note') && !$('#nxQueue').textContent.includes('Edit')", 'no paused note or edit controls while the queue simply waits');
  await b.shot(`${out}/${width}-queue.png`);
  await b.js("$('#nxQueue [data-queue-id=q1] [data-queue-action=push]').click()");
  await b.until("actions.some(a=>a.action==='queue-change')", 4000);
  await check("actions.find(a=>a.action==='queue-change').operation==='push' && !document.querySelector('.nx-queue-confirm')", 'Send now sends at once, without a confirm step');
  assert.equal(b.exceptions.length, 0, JSON.stringify(b.exceptions));
  report.push('PASS no uncaught browser exceptions; every session and action was an in-page fixture.');
} finally {
  await b.close(); await server.close(); fs.writeFileSync(`${out}/${width}-tour.txt`, report.join('\n') + '\n');
}
