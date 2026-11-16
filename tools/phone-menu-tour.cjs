'use strict';
// The session menu on a phone: Catch me up finds the owner's last message after a long run of steps, Session details
// after Catch me up shows the details (it was an empty full-screen panel), and Conversation help fits the screen (it ran
// off the right edge with its close button). Synthetic session, read-only server on private port 4790, headless Chrome.
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), { spawn, spawnSync } = require('child_process');
const recap = require('../recap');
const repo = path.join(__dirname, '..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-phone-menu-')), out = path.join(root, 'shots');
const cwd = path.join(root, 'work', 'release'), proj = path.join(root, 'claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
for (const d of [proj, cwd, out, path.join(root, 'codex', 'sessions'), path.join(root, 'copilot', 'session-state')]) fs.mkdirSync(d, { recursive: true });
const id = 'aaaaaaaa-0000-4000-8000-00000000c0de', key = 'claude:' + id, t0 = Date.now() - 60 * 60e3; let n = 0;
const rec = r => JSON.stringify({ timestamp: new Date(t0 + (n++) * 1000).toISOString(), cwd, sessionId: id, uuid: 'u' + n, ...r }) + '\n';
// The owner's message, then about 6.5 MB of steps: more than the 4 MB the recap used to read back.
let body = rec({ type: 'user', message: { role: 'user', content: 'Ship the release: run the checks, fix what fails, then tag it.' } });
for (let i = 0; i < 700; i++) {
  body += rec({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'tool' + i, name: 'Bash', input: { command: 'npm test -- --shard ' + i } }] } });
  body += rec({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool' + i, content: 'ok ' + 'x'.repeat(9000) }] } });
}
body += rec({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'All shards pass. Next I tag the release.' }] } });
const file = path.join(proj, id + '.jsonl'); fs.writeFileSync(file, body);
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } };

check('the recap reaches the owner\'s last message 6.5 MB back', () => {
  const d = recap.instant({ kind: 'claude', id, file, cwd, title: 'Release' });
  assert.equal(d.user?.text, 'Ship the release: run the checks, fix what fails, then tag it.'); assert.equal(d.partial, false); assert.equal(d.counts.commands, 700);
});

fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: 4790, recentDays: 10, sessionLabels: false, themeSorting: false }));
const env = { ...process.env, NEXUS_PORT: '4790', NEXUS_READ_ONLY: '1', NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_LABELS: 'off', NEXUS_ASR_DISABLED: '1',
  NEXUS_CLAUDE_DIR: path.join(root, 'claude'), NEXUS_CODEX_DIR: path.join(root, 'codex'), NEXUS_COPILOT_DIR: path.join(root, 'copilot'),
  NEXUS_CONFIG_FILE: path.join(root, 'config.json'), NEXUS_STATE_FILE: path.join(root, 'state.json'), NEXUS_THEMES_FILE: path.join(root, 'themes.json'),
  NEXUS_DEVICES_FILE: path.join(root, 'devices.json'), NEXUS_UPLOAD_DIR: path.join(root, 'uploads') };
const measure = name => ({ js: `window.__m=window.__m||{};window.__m[${JSON.stringify(name)}]=(()=>{const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom)}};
  const d=document.querySelector('#nxDetails'),m=document.querySelector('#modalCard'),x=m&&m.querySelector('.modal-dismiss'),p=m&&m.querySelector('p');
  return {w:innerWidth,details:d&&{hidden:d.hidden,text:d.innerText.trim().slice(0,60)},modal:{on:document.querySelector('#modal').classList.contains('on'),card:r(m),dismiss:r(x),first:r(p),scroll:m&&[m.scrollWidth,m.clientWidth]},
    recap:((document.querySelector('#nxPhoneRecap')||{}).innerText||'').slice(0,120)}})();document.title='m:'+JSON.stringify(window.__m);'ok'` });
const steps = [
  { until: `typeof state!=='undefined'&&state.byKey&&state.byKey.has(${JSON.stringify(key)})` },
  { js: `select(${JSON.stringify(key)})` }, { wait: 1000 },
  { wait: 600 }, { js: `window.__m=window.__m||{};(()=>{const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]};const q=s=>document.querySelector(s);document.getAnimations().forEach(a=>{try{a.finish()}catch{}});const h={back:r(q('.nx-phone-back')),more:r(q('.session-more>summary')),catchup:r(q('#focusHead .nx-catchup')),model:r(q('#focusHead .nx-model-select'))};window.__m.head=h;q('.session-more>summary').click()})();'ok'` }, { wait: 500 },
  { js: `(()=>{const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]};const q=s=>document.querySelector(s);document.getAnimations().forEach(a=>{try{a.finish()}catch{}});const h=window.__m.head;const m=q('.session-more .more-menu');h.open=!!q('.session-more[open]');h.menu=r(m);h.fits=m.scrollHeight<=m.clientHeight+1;h.vh=innerHeight;q('#chatView').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));h.closed=!q('.session-more[open]');h.view=state.view;window.__m.head=h})();'ok'` },
  // The More menu lists only what the header does not show: on the phone Catch me up sits in the header, while the
  // details panel and Remote have no header button here, so the menu keeps them.
  // Kept short (C atch me up, D etails, R emote, N rename): the tour reads its results from one 1,600 character line.
  { js: `document.querySelector('.session-more').open=true;'ok'` }, { wait: 200 },
  { js: `window.__q={};window.__q.items=(t=>[['C','Catch me up'],['D','Session details'],['R','Remote access'],['N','Rename session']].filter(([,l])=>t.includes(l)).map(([c])=>c).join(''))([...document.querySelectorAll('.session-more .more-menu button')].filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()));document.querySelector('.session-more').open=false;'ok'` },
  // A tap outside an open popover only closes it: the back button under the finger does not also leave the conversation.
  { js: `window.__q.taps={};nxModelMenu()` }, { until: `!!document.querySelector('#nxModelMenu')` }, { click: '.nx-phone-back' }, { wait: 400 },
  { js: `window.__q.taps.model=[!!document.querySelector('#nxModelMenu'),state.view];nxPathMenu('C:\\\\Work\\\\notes.txt',40,300);'ok'` }, { click: '.nx-phone-back' }, { wait: 400 },
  { js: `window.__q.taps.path=[!!document.querySelector('#nxPathMenu'),state.view];nxContext(document.querySelector('#sessionRecap'),'Session actions',[{label:'Rename',run(){}}]);'ok'` }, { click: '.nx-phone-back' }, { wait: 400 },
  { js: `window.__q.taps.row=[!!document.querySelector('#nxRowMenu'),state.view];document.querySelector('.session-more').open=true;'ok'` }, { wait: 200 }, { click: '.nx-phone-back' }, { wait: 400 },
  { js: `window.__q.taps.more=[!!document.querySelector('.session-more[open]'),state.view];'ok'` },
  { js: `document.querySelector('[data-a="recap"]').click()` }, { until: `(document.querySelector('#nxPhoneRecap')||{}).innerText?.includes('Commands')` }, measure('catchup'),
  { js: `document.querySelector('[data-nx="details"]').click()` }, { wait: 700 }, measure('details'), { shot: 'details' },
  { js: `document.querySelector('[data-a="chat-help"]').click()` }, { wait: 900 }, measure('help'), { shot: 'help' },
  // Remote Control on a session running in another terminal: the dialog's long button label stays inside its button.
  { js: `closeModal();(()=>{const s=state.byKey.get(${JSON.stringify(key)});s.live=true;s.pid=48212;toggleRemote(s)})()` }, { wait: 900 }, { shot: 'remote' },
  { js: `window.__m.rc=[...document.querySelectorAll('#modalCard .modal-actions .btn')].map(b=>[b.innerText.replace(/\\s+/g,' '),b.scrollWidth<=b.clientWidth]);'ok'` },
  // The dialog shell on a phone: an opaque bottom sheet, the close button on the title line, stacked footer (primary on top), no process id, focus off the close button.
  { js: `window.__m.shell=(()=>{const c=document.querySelector('#modalCard'),h=c.querySelector('h2'),x=c.querySelector('.modal-dismiss'),b=[...c.querySelectorAll('.modal-actions .btn')].map(e=>e.getBoundingClientRect()),cr=c.getBoundingClientRect(),hr=h.getBoundingClientRect(),xr=x.getBoundingClientRect(),lh=parseFloat(getComputedStyle(h).lineHeight);
    return {bg:getComputedStyle(c).backgroundColor,sheet:[Math.round(cr.left),Math.round(cr.right),Math.round(innerHeight-cr.bottom)],xLine:Math.round(Math.abs((xr.top+xr.height/2)-(hr.top+lh/2))),xSize:Math.round(xr.height),
      stacked:b.length===2&&Math.round(b[0].width)===Math.round(b[1].width)&&b[1].bottom<=b[0].top,minH:Math.min(...b.map(r=>Math.round(r.height))),pid:/pid/i.test(c.innerText),focusX:document.activeElement===x}})();'ok'` },
  // Opening a dialog keeps a pending Undo; plain toasts are opaque and a bad one says so in the destructive colour.
  { js: `closeModal();document.querySelectorAll('#toasts>*').forEach(t=>t.remove());const u=document.createElement('div');u.className='nx-undo-toast';u.innerHTML='<span>Moved</span><button>Undo</button><i></i>';document.querySelector('#toasts').append(u);toast('Could not save','The request timed out.','bad');const t=document.querySelector('#toasts .toast.bad');window.__m.toast={bg:getComputedStyle(t).backgroundColor,title:getComputedStyle(t.querySelector('b')).color,undo:!!document.querySelector('#toasts .nx-undo-toast')};nxRenameSession(state.byKey.get(${JSON.stringify(key)}));window.__m.toast.undoAfterDialog=!!document.querySelector('#toasts .nx-undo-toast');{const a=document.querySelector('#toasts .nx-undo-toast').getBoundingClientRect(),c=document.querySelector('#modalCard').getBoundingClientRect();window.__m.toast.undoClear=a.bottom<=c.top||a.top>=c.bottom;}closeModal();'ok'` },
  // An outside tap closes a dialog with nothing typed, but keeps one the owner typed in (typed back to the start, it closes
  // again); Esc still closes it. The letter is typed with a real key press, the tap lands on the backdrop itself.
  { js: `closeModal();const s=state.byKey.get(${JSON.stringify(key)}),m=document.querySelector('#modal'),out=()=>m.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));window.__m.outside={};nxRenameSession(s);out();window.__m.outside.untouched=!m.classList.contains('on');nxRenameSession(s);const i=document.querySelector('#nxRenameConversation');i.focus();i.setSelectionRange(i.value.length,i.value.length);'ok'` },
  { key: ['x', 'KeyX', 88] },
  { js: `(()=>{const m=document.querySelector('#modal'),i=document.querySelector('#nxRenameConversation'),out=()=>m.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})),o=window.__m.outside;out();o.typed=m.classList.contains('on')&&i.value.endsWith('x');i.value=i.value.slice(0,-1);i.dispatchEvent(new Event('input',{bubbles:true}));out();o.typedBack=!m.classList.contains('on');nxRenameSession(state.byKey.get(${JSON.stringify(key)}));const j=document.querySelector('#nxRenameConversation');j.value='Draft name';j.dispatchEvent(new Event('input',{bubbles:true}));out();o.kept=m.classList.contains('on')})();'ok'` },
  { shot: 'rename-kept' }, { key: ['Escape', 'Escape', 27] },
  { js: `window.__m.outside.esc=!document.querySelector('#modal').classList.contains('on');'ok'` },
  // The phone Wall: tapping a theme folds its sessions in place, and tapping again unfolds them; the Wall stays open.
  { js: `closeModal();setView('wall');renderCards()` }, { wait: 900 },
  { js: `const n=()=>document.querySelectorAll('.nx-pwall .nx-board-tile').length;window.__m.wall=[n()];document.querySelector('[data-pwall-fold]').click();window.__m.wall.push(n(),state.view);document.querySelector('[data-pwall-fold]').click();window.__m.wall.push(n());'ok'` }, { shot: 'wall' },
  // The outside-tap results print on their own line: the full measurement line is cut at 1,600 characters.
  { js: `(()=>{const o=window.__m.outside;delete window.__m.outside;return o})()` },
  // The More menu at PC and narrow widths: an item leaves only while its header button shows.
  ...[[1920, 1080], [1366, 768], [360, 780]].flatMap(([w, h]) => [{ viewport: [w, h] }, { js: `select(${JSON.stringify(key)})` }, { wait: 900 },
    { js: `window.__q.widths=window.__q.widths||{};(()=>{const vis=e=>!!e&&e.getClientRects().length>0,q=s=>document.querySelector(s);q('.session-more').open=true;const t=[...document.querySelectorAll('.session-more .more-menu button')].filter(vis).map(e=>e.textContent.trim());window.__q.widths[${w}]={h:[['C','#sessionRecap'],['D','.nx-panel-toggle'],['R','.rc-switch']].filter(([,s])=>vis(q('#focusHead '+s))).map(([c])=>c).join(''),m:[['C','Catch me up'],['D','Session details'],['R','Remote access'],['N','Rename session']].filter(([,l])=>t.includes(l)).map(([c])=>c).join('')};q('.session-more').open=false})();'ok'` }]),
  { js: `window.__m` }, { js: `window.__q` },
];
fs.writeFileSync(path.join(out, 'steps.json'), JSON.stringify(steps));
const server = spawn(process.execPath, ['server.js'], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
(async () => {
  try {
    for (let i = 0; !log.includes(':4790/'); i++) { if (i > 80) throw Error('server did not start: ' + log.slice(-300)); await new Promise(r => setTimeout(r, 250)); }
    const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'cdp-tour.mjs'), out], { cwd: repo, env: { ...process.env, NEXUS_PORT: '4790', NEXUS_WIDTH: '390', NEXUS_HEIGHT: '844' }, encoding: 'utf8', windowsHide: true, timeout: 180000 });
    const lines = (r.stdout || '').split('\n').filter(l => l.startsWith('JS {')), line = lines.at(-2);
    if (!line) throw Error('the browser run gave no measurements: ' + (r.stdout || '').slice(-600) + (r.stderr || '').slice(-600));
    const m = JSON.parse(line.slice(3)), q = JSON.parse(lines.at(-1).slice(3)), outside = lines.find(l => l.startsWith('JS {"untouched"'));
    m.outside = outside ? JSON.parse(outside.slice(3)) : null;
    check('Catch me up on a phone shows the owner\'s message, in the chat column', () => assert.match(m.catchup.recap, /Ship the release: run the checks/));
    check('Session details after Catch me up draws the details, with a way back', () => {
      assert.equal(m.details.details.hidden, false); assert.match(m.details.details.text, /^Catch me up\s+Details/); assert.match(m.details.details.text, /Workspace/);
    });
    check('Phone header: back, More, Catch me up and the model button are 44 px targets that do not overlap', () => {
      const h = m.head; for (const k of ['back', 'more', 'catchup', 'model']) assert.ok(h[k] && h[k][3] >= 43, k + ' is 44 px tall: ' + JSON.stringify(h));
      assert.ok(h.back[2] >= 43 && h.more[2] >= 43, 'back and More are 44 px wide'); assert.ok(h.catchup[0] + h.catchup[2] <= h.model[0], 'Catch me up ends before the model button: ' + JSON.stringify([h.catchup, h.model]));
    });
    check('Phone More menu opens as a bottom sheet that fits, and a press outside closes it without leaving the conversation', () => {
      const h = m.head; assert.equal(h.open, true); // This browser run draws the page about 1.5% smaller than the window (the probes read 43 for 44), hence the slack.
      assert.ok(h.menu[0] <= 4 && h.menu[2] >= m.help.w - 8, 'full width: ' + JSON.stringify(h.menu)); assert.ok(Math.abs(h.menu[1] + h.menu[3] - h.vh) <= 10, 'anchored to the bottom: ' + JSON.stringify(h.menu));
      assert.ok(h.menu[1] >= 0 && h.fits, 'every item is on screen'); assert.equal(h.closed, true); assert.equal(h.view, 'focus');
    });
    check('Phone More menu leaves out Catch me up (a header button) and keeps Session details and Remote access (no header button here)', () => {
      assert.equal(q.items, 'DRN');
    });
    check('More menu at every width: an item is missing only while the same action shows in the header', () => {
      for (const w of ['1920', '1366', '360']) { const r = q.widths[w]; assert.ok(r && r.m.includes('N'), w + ': ' + JSON.stringify(r));
        for (const c of 'CDR') assert.equal(r.m.includes(c), !r.h.includes(c), w + ' ' + c + ': ' + JSON.stringify(r)); }
      assert.equal(q.widths['1920'].h, 'CDR', 'a PC header shows all three'); assert.equal(q.widths['1366'].h, 'CDR'); assert.equal(q.widths['360'].h, 'C', 'a narrow phone shows only Catch me up');
    });
    check('On a phone a tap outside an open menu or popover only closes it (model picker, path menu, row menu, More menu)', () => {
      for (const k of ['model', 'path', 'row', 'more']) assert.deepEqual(q.taps[k], [false, 'focus'], k + ': ' + JSON.stringify(q.taps));
    });
    check('Conversation help fits the phone and its close button clears the text', () => {
      const h = m.help.modal; assert.equal(h.on, true);
      assert.ok(h.card.l >= 0 && h.card.r <= m.help.w, 'the card is on screen: ' + JSON.stringify(h.card));
      assert.ok(h.scroll[0] <= h.scroll[1], 'nothing scrolls sideways');
      assert.ok(h.dismiss.r <= m.help.w && h.dismiss.b <= h.first.t, 'the close button is on screen, above the first line: ' + JSON.stringify([h.dismiss, h.first]));
    });
    check('Remote Control on a phone: the dialog\'s buttons hold their labels', () => {
      assert.deepEqual(m.rc, [['Cancel', true], ['Fork here', true]]);
    });
    check('Phone dialogs are one opaque bottom sheet with the close button on the title line and a stacked footer', () => {
      const d = m.shell; assert.doesNotMatch(d.bg, /\/ 0\.|rgba\(.*, 0\.\d+\)$/, 'the card is opaque: ' + d.bg);
      assert.deepEqual(d.sheet, [0, m.help.w, 0], 'full width, on the bottom edge'); assert.ok(d.xLine <= 2, 'the close button is centred on the title line: ' + d.xLine);
      assert.ok(d.xSize >= 44 && d.minH >= 44, '44 px targets'); assert.equal(d.stacked, true, 'buttons stack full width, primary on top'); assert.equal(d.pid, false, 'no process id in the text'); assert.equal(d.focusX, false, 'focus is not on the close button');
    });
    check('Toasts are opaque, a bad one has a destructive title, and opening a dialog keeps a pending Undo', () => {
      assert.doesNotMatch(m.toast.bg, /\/ 0\.|rgba\(.*, 0\.\d+\)$/, 'opaque: ' + m.toast.bg); assert.notEqual(m.toast.title, 'rgb(255, 255, 255)');
      assert.equal(m.toast.undo, true, 'a plain toast does not push out Undo'); assert.equal(m.toast.undoAfterDialog, true, 'Undo survives a dialog'); assert.equal(m.toast.undoClear, true, 'a kept Undo never covers the dialog sheet');
    });
    check('An outside tap closes an untouched dialog but keeps one with typed text; Esc still closes it', () => {
      assert.deepEqual(m.outside, { untouched: true, typed: true, typedBack: true, kept: true, esc: true });
    });
    check('Tapping a theme on the phone Wall folds and unfolds its sessions, without leaving the Wall', () => {
      assert.deepEqual(m.wall, [1, 0, 'wall', 1]);
    });
  } catch (e) { failed++; console.log('FAIL phone menu run: ' + e.message); }
  finally { server.kill(); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = failed ? 1 : 0; }
})();
