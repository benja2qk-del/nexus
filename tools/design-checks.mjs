// Meaningful regressions for the design pass. No real session is resumed or written.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import preview from '../session-preview.js';
import models from '../models.js';

const server = fs.readFileSync('server.js', 'utf8');
let now = Date.now(), records = [], stat = {size: 100, mtimeMs: now - 3600000};
class TestDate extends Date { static now() { return now; } }
const context = vm.createContext({
  ...preview, models,
  Date: TestDate, CODEX_DIR: 'fixture',
  fs: {readFileSync() { throw new Error('no account access in unit test'); }},
  path: {join: (...p) => p.join('/'), basename: () => 'fixture.jsonl'},
  parse: line => JSON.parse(line), clip: (s,n) => String(s).slice(0,n),
  projectOf: () => 'Fixture project',
  headLines: () => [JSON.stringify({type:'session_meta',payload:{id:'fixture',cwd:'fixture'}})],
  tailLines: () => records.map(r => JSON.stringify(r)),
  fixtureFiles: () => [['fixture', stat]],
});
vm.runInContext(server.slice(server.indexOf('const codexCache'), server.indexOf('// ---------- usage limits')), context);
vm.runInContext('walkCodex = (dir, cutoff, out) => out.push(...fixtureFiles());', context);
const sessions = () => vm.runInContext('codexSessions(10)', context);
const event = type => ({timestamp:new Date(now).toISOString(), type:'event_msg', payload:{type}});
records = [event('agent_message')];
assert.equal(sessions()[0].status, 'busy', 'recent event wins over stale Windows mtime and missing start marker');
assert.equal(sessions()[0].updated, now);
now += 11 * 60000;
assert.equal(sessions()[0].runState, 'unknown', 'cached metadata must age without inventing completion');
assert.equal(sessions()[0].status, 'done', 'legacy status field remains compatible');
records = [event('task_complete')]; stat.size++;
assert.equal(sessions()[0].status, 'done', 'explicit completion is recognized');
assert.equal(sessions()[0].runState, 'complete');
records = [event('turn_aborted')]; stat.size++;
assert.equal(sessions()[0].runState, 'interrupted');
records = [event('task_started')]; stat.size++;
assert.equal(sessions()[0].status, 'busy');
console.log('PASS: log evidence, Windows timestamps, cached freshness, completion and interruption');

// These run inside the real page. Replaced APIs are restored before finishing.
const checks = String.raw`(async () => {
  const check = (ok, name) => { if (!ok) throw new Error(name); console.log('PASS', name); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const real = {api, act, ...state, byKey: new Map(state.byKey), terms: [...state.terms]};
  let actionCount = 0;
  act = async () => { actionCount++; return false; };
  try {
    const expired = limitHTML('astra', '5-hour', {pct:78,resetsAt:Date.now()-60000}, Date.now()-7200000);
    check(expired.includes('78%*') && expired.includes('stale') && !expired.includes('<b>0%'), 'expired quota preserves the reading');
    $('#newBtn').focus(); newSessionModal();
    check(document.activeElement.id === 'folderSearch' && $('#app').inert, 'dialog starts at search and isolates the app');
    const first = $('#modalCard input'), last = $('#startSession');
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
    check(document.activeElement === first, 'Tab wraps inside dialog');
    $('#folderSearch').value = 'Nexus'; $('#folderSearch').dispatchEvent(new Event('input'));
    check([...$$('.folder-option')].every(x=>x.textContent.toLowerCase().includes('nexus')), 'picker searches folders');
    $('#folderSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    check(actionCount === 0, 'Enter in picker cannot resume a background session');
    $('#folderSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    check(!$('#modal').classList.contains('on') && !$('#app').inert && document.activeElement.id === 'newBtn', 'Escape closes and returns focus');
    const selected = state.byKey.get(state.sel);
    if (selected) {
      const more = $('.session-more'); more.open = true; more.querySelector('summary').focus();
      selected.title += ' [updated]'; renderHead();
      check($('.session-more').open && document.activeElement.tagName === 'SUMMARY', 'header polling preserves disclosure and focus');
      selected.title = selected.title.replace(' [updated]', '');
      $('.session-more').open = false;
    }
    const a = {...state.sessions[0],id:'fixture-a',title:'Fixture A',term:null};
    const b = {...state.sessions[0],id:'fixture-b',title:'Fixture B',term:null};
    state.byKey.set(keyOf(a),a); state.byKey.set(keyOf(b),b);
    const pending = new Map();
    api = url => new Promise((resolve,reject) => pending.set(new URL(url,location).searchParams.get('key'),{resolve,reject}));
    select(keyOf(a)); select(keyOf(b));
    const transcript = text => ({size:1,truncated:false,events:[{t:'ai',text}],activity:{goal:text,steps:0,tasks:[]}});
    pending.get(keyOf(b)).resolve(transcript('Correct B')); await sleep(0);
    pending.get(keyOf(a)).reject(new Error('Old A failed')); await sleep(0);
    check($('#feed').textContent.includes('Correct B') && !$('#feed').textContent.includes('Old A'), 'late failed request cannot replace newer session');
    check($('#pulse .pu-goal').getBoundingClientRect().height > 10, 'request preview is visible while collapsed');
    state.activity.goal = ''; b.firstPrompt = 'Original intent'; b.lastPrompt = ''; renderPulse();
    check($('#pulse .pu-request').textContent.includes('Earlier request') && $('#pulse .pu-goal').textContent === 'Original intent', 'earlier request is labeled when the tail loses the prompt');
    state.activity.goal = 'Correct B';
    const term = {id:'fixture-disconnected',kind:'claude',exited:null};
    b.term = term.id; state.terms = [term]; state.tab = 'feed';
    termViews.set(term.id,{id:term.id,ws:{readyState:0},el:document.createElement('div')});
    renderSteer(b); $('#steerIn').value = 'Keep this draft'; steer('send');
    check($('#steerIn').value === 'Keep this draft', 'disconnected send retains draft');
    termViews.delete(term.id);
    api = async () => { throw new Error('fixture offline'); };
    await refresh();
    check(!$('#connection').classList.contains('hidden'), 'session polling failure is visible');
    check(actionCount === 0, 'interaction checks made no mutating API calls');
  } finally {
    api = real.api; act = real.act;
    for (const key of Object.keys(state)) if (key in real) state[key] = real[key];
    $('#connection').classList.add('hidden');
    $('#toasts').innerHTML = '';
    closeModal();
    state.feedSize = -1; render(); await loadFeed(true);
  }
  const rect = $('#feed').getBoundingClientRect();
  check(rect.height >= 250, 'conversation keeps at least 250px at laptop size');
  check($('#fsBtn').getBoundingClientRect().right < innerWidth, 'header controls fit');
  setView('wall'); await renderWall();
  check(getComputedStyle($('#wall')).gridTemplateColumns.split(' ').length === 2, 'wall uses two columns at laptop size');
  setView('focus');
  return 'All interaction regressions passed';
})()`;
const out = 'docs/shots/tmp/checks';
fs.mkdirSync(out,{recursive:true});
const steps = [
  {wait:5500},{js:checks},
  {click:'#fsBtn'},{wait:250},
  {js:"window.enteredFullscreen = !!document.fullscreenElement; if (window.enteredFullscreen) { if (document.querySelector('#fsBtn').getAttribute('aria-label') !== 'Leave fullscreen') throw new Error('Fullscreen label failed'); document.querySelector('#fsBtn').click(); } else if (!document.querySelector('#toasts').textContent.includes('F11')) throw new Error('Missing fullscreen fallback');"},
  {wait:250},
  {js:"if (document.fullscreenElement) throw new Error('Fullscreen exit failed'); console.log(window.enteredFullscreen ? 'PASS fullscreen toggles both ways' : 'PASS fullscreen fallback; native fullscreen rejected by headless Edge'); document.querySelector('#newBtn').focus();"},
  {key:['Enter','Enter',13]},
  {js:"if (!document.querySelector('#modal').classList.contains('on')) throw new Error('Native Enter on New session failed'); closeModal(); console.log('PASS native Enter opens the picker');"}
];
if (process.argv.includes('--shots')) steps.push(
  {js:"document.querySelector('#toasts').innerHTML=''; select(keyOf(state.sessions.find(s => s.kind === 'astra' && s.brief)));"}, {wait:400}, {shot:'../../after/1366-focus'},
  {js:"readBrief(state.byKey.get(state.sel))"}, {wait:200}, {shot:'../../after/1366-brief-reader'},
  {js:"window.visualApi = api; api = () => new Promise(() => {});"}, {wait:250},
  {js:"closeModal(); window.visualState = {...state, byKey:new Map(state.byKey), terms:[...state.terms]}; const fixture = {kind:'claude',id:'layout-fixture',title:'Activity and steering · layout fixture',groupLabel:'Design verification',cwd:'C:/fixture',status:'busy',live:true,size:0,term:'layout-fixture',updated:Date.now()}; state.byKey.set(keyOf(fixture), fixture); state.sel=keyOf(fixture); state.terms=[{id:'layout-fixture',kind:'claude',title:'Layout fixture',exited:null}]; state.tab='feed'; state.feedSize=0; state.activity={goal:'Make it easy to watch the agent, read the request, and send a correction from the same view.',current:{name:'Read',text:'public/style.css',running:true},tasks:[{text:'Review the baseline',status:'done'},{text:'Refine the session view',status:'active'},{text:'Verify both screen sizes',status:'todo'}],thought:{text:'This is a browser-only layout fixture. No prompt is sent and no real session is attached.',ts:new Date().toISOString()},turnStart:new Date(Date.now()-180000).toISOString(),steps:4}; renderHead(); document.querySelector('.pu-progress').open=true; updateHTML(document.querySelector('#feed'),'<div class=\"note\">Layout fixture · no terminal connected</div>');"},
  {shot:'../../after/1366-activity-fixture'},
  {js:"Object.assign(state,window.visualState); render(); if(state.transcript) renderFeed(state.transcript,state.byKey.get(state.sel));"},
  {js:"document.querySelector('#connection').classList.remove('hidden'); document.querySelector('#connection').innerHTML='Connection lost. Showing the last update. <button class=\"chip-btn\">Retry</button>';"},
  {shot:'../../after/1366-connection-fixture'},
  {js:"api=window.visualApi; document.querySelector('#connection').classList.add('hidden');"},
  {viewport:[1920,1080]}, {wait:250}, {shot:'../../after/1920-focus'}
);
fs.writeFileSync(out+'/steps.json',JSON.stringify(steps,null,2));
console.log('Browser steps written to '+out+'; run with NEXUS_PORT=4790 and 1366x768.');
