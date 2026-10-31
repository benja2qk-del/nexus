// Private HTTP + headless CDP integration. Never starts or writes a terminal.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fixtures from './wall-fixtures.cjs';
const real = process.argv.includes('--real'), width = Number(process.argv.find(a => /^\d+$/.test(a))) || 390;
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(4791, '127.0.0.1', () => probe.close(resolve)); });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wall-tour-'));
const fixture = real ? { codex: path.join(temp, 'empty-codex') } : fixtures(temp);
const out = real ? path.join(temp, 'real-wall-' + width) : path.resolve('docs/shots/wall', String(width)); fs.mkdirSync(out, { recursive: true });
const stubLog = path.join(temp, 'stub-calls.txt'); fs.writeFileSync(stubLog, '');
const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const token = 'wall-fixture-token-never-real-00001', devices = path.join(temp, 'devices.json');
fs.writeFileSync(devices, JSON.stringify({ [crypto.createHash('sha256').update(token).digest('hex')]: { name: 'Fixture phone', created: Date.now(), lastSeen: Date.now() } }));
const source = path.join(temp, 'browser-guard.js');
fs.writeFileSync(source, `(() => {
  const original = fetch.bind(window); window.wallCalls = { summary: 0, transcript: 0, recap: 0 };
  window.wallCheck = (ok, name) => { if (!ok) throw Error(name); console.log('PASS ' + name); };
  window.fetch = async (url, options = {}) => {
    const route = new URL(typeof url === 'string' ? url : url.url, location.href).pathname;
    const action = options.body && typeof options.body === 'string' ? JSON.parse(options.body).action : '';
    if (route === '/api/action') {
      if (action === 'summarize-recap' && ${!real}) wallCalls.summary++;
      else if (action === 'viewed' && ${!real}) return new Response('{"ok":true,"result":true}', {headers:{'Content-Type':'application/json'}});
      else throw Error('Tour blocked action: ' + action);
    }
    if (route === '/api/transcript') { wallCalls.transcript++; if (${real}) throw Error('Real tour is Wall only'); }
    if (route === '/api/recap') { wallCalls.recap++; if (${real}) throw Error('Real tour is Wall only'); }
    if (route.startsWith('/api/') && !['/api/sessions','/api/transcript','/api/recap','/api/action'].includes(route)) throw Error('Tour blocked route');
    if (${width < 701 && !real} && route.startsWith('/api/')) options = {...options, headers: {...options.headers, 'X-Forwarded-Host': ${JSON.stringify(cfg.remoteHost)}, 'Tailscale-User-Login': ${JSON.stringify(cfg.remoteUser)}}};
    if (${!real} && route.startsWith('/api/')) options = {...options, headers: {...options.headers, 'X-Wall-Fixture': '1'}};
    const response = await original(url, options);
    if (route === '/api/sessions' && ${!real}) { const data = await response.json(); data.sessions.find(s => s.id === 'wall-steam').inNexus = true; return new Response(JSON.stringify(data), {status:response.status,headers:{'Content-Type':'application/json'}}); }
    return response;
  };
  document.cookie = 'nexus_device=${token}; Path=/; SameSite=Strict';
  window.WebSocket = class { constructor() { throw Error('Tour blocked terminal connection'); } };
})();`);
const env = { ...process.env, NEXUS_PORT: '4791', NEXUS_DEVICES_FILE: devices, NEXUS_STATE_FILE: path.join(temp, 'state.json'), NEXUS_UPLOAD_DIR: path.join(temp, 'uploads'), LOCALAPPDATA: temp, NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_TEST_TERMINALS: '1', NEXUS_CODEX_DIR: fixture.codex, NEXUS_WIDTH: String(width), NEXUS_HEIGHT: width < 701 ? '844' : '1080', NEXUS_TOUR_SOURCE: source, NEXUS_TOUR_BASELINE: '', NEXUS_WALL_STUB_LOG: stubLog };
if (!real) env.NEXUS_CLAUDE_DIR = fixture.claude;
const server = spawn(process.execPath, [...(real ? [] : ['--require', './tools/wall-summary-stub.cjs']), 'server.js'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => server.kill());
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Server start timeout')), 20000); server.stdout.on('data', d => { if (String(d).includes('http://127.0.0.1:4791/')) { clearTimeout(timer); resolve(); } }); server.once('error', reject); server.once('exit', code => { clearTimeout(timer); reject(Error('Server exited ' + code)); }); });
  const steps = [], add = (js, shot) => steps.push({ js, wait: 250, ...(shot ? { shot } : {}) });
  const check = (js, label) => add(`wallCheck(${js},${JSON.stringify(label)})`);
  steps.push({ until: 'typeof state !== "undefined" && state.booted && state.sessions.length > 0 && $("#app").classList.contains("settled")', wait: 250 });
  add("setView('wall')", 'wall');
  check("getComputedStyle($('#stage')).opacity==='1' && $('.tile').getBoundingClientRect().height>190", 'Wall cards are visible and retain their content height');
  check("document.documentElement.scrollWidth <= innerWidth && !$('#wall .tile-feed')", 'Wall fits the viewport and has no transcript blocks');
  check("wallCalls.transcript === 0 && wallCalls.recap === 0 && wallCalls.summary === 0", 'Wall requires no transcript, recap or model requests');
  add("setView('overview');setView('wall')");
  check("$$('#wall .tile').length>0", 'returning to an unchanged Wall keeps its cards');
  check("!/[A-Z]:\\\\|mcp__|\"tabId\"|\"file_path\"/.test($('#wall').innerText)", 'Wall has no raw tool names, JSON or Windows paths');
  if (!real) {
    check("$('#wall').textContent.includes('Edited 2 files in public/') && $('#wall').textContent.includes('Ran 3 shell commands')", 'latest tool groups use human sentences');
    check("$('#wall').textContent.includes('Needs you') && $('#wall').textContent.includes('Chrome') && $('#wall').textContent.includes('Remote') && $('#wall').textContent.includes('IN NEXUS')", 'status and recent tool tags are retained');
    check("getComputedStyle($('#wall')).gridTemplateColumns.split(' ').length === " + (width < 701 ? 1 : 2), 'requested Wall column count');
    add("$('[data-k=\"claude:wall-steam\"] [data-wall-recap]').scrollIntoView({block:'center'})", 'wall-steam');
    add("$('[data-k=\"claude:wall-steam\"] [data-wall-recap]').focus();state.byKey.get('claude:wall-steam').updated-=60000;renderWall()");
    check("document.activeElement.id==='wall-recap-claude:wall-steam'", 'Wall refresh preserves focus on the same session button');
    steps.push({ click: '[data-k="claude:wall-steam"] [data-wall-recap]' });
    steps.push({ until: "!!$('.recap-counts')", shot: 'recap-instant' });
    check("wallCalls.summary === 0 && $('.recap-request').textContent.includes('needs my approval') && $('.recap-answer').textContent.includes('Steam Cloud is ready')", 'instant recap appears before any model request');
    check("$('.recap-counts').textContent.includes('1 file edited') && $('.recap-counts').textContent.includes('release-notes.md')", 'real HTTP recap returns the edited file');
    check("getComputedStyle($('.recap-answer .md')).fontSize === '" + (width < 701 ? '14px' : '15px') + "' && $('#modalCard').getBoundingClientRect().right <= innerWidth", 'recap text and sheet fit the viewport');
    add("$('[data-recap-summary]').scrollIntoView({block:'center'})", 'recap-actions');
    steps.push({ click: '[data-recap-summary]' });
    steps.push({ until: "!!$('#recapSummary ul')", shot: 'recap-summary' });
    check("wallCalls.summary === 1 && $$('#recapSummary li').length === 3 && $('#recapSummary').textContent.includes('Next / needs you')", 'explicit summary renders three bullets and next action');
    add("closeModal();recapDialog(state.byKey.get('claude:wall-steam'))");
    steps.push({ until: "!!$('#recapSummary ul')" });
    check("wallCalls.summary === 1 && $('[data-recap-summary]').disabled", 'reopening reuses the current summary without another request');
    add("closeModal();select('claude:wall-steam',{tab:'feed'})", 'focus');
    steps.push({ until: "!!$('#feed .ev')" });
    if (width < 701) {
      add("$('.session-more').open=true", 'focus-more');
      steps.push({ click: '.session-more [data-a=recap]' });
    } else steps.push({ click: '.recap-head-button' });
    steps.push({ until: "!!$('.recap-counts')" });
    check("$('.recap-request').textContent.includes('needs my approval')", 'focus header or phone More opens the same recap');
    add("closeModal();$('.session-more').open=false;select('claude:wall-edits',{tab:'chat'})", 'chat');
    if (width < 701) {
      steps.push({ until: "!!$('.chat-tools')" });
      check("$('.chat-tools summary').textContent.includes('Edited 2 files in public/')", 'collapsed phone Chat shares the humanizer');
    }
    add("recapDialog(state.byKey.get('claude:wall-long'))");
    steps.push({ until: "!!$('.recap-counts')", shot: 'recap-long' });
    check("$('.recap-counts').textContent.includes('1 error reported') && !$('.recap-coverage')", '800 MB transcript yields the current complete span');
    add("closeModal();recapDialog(state.byKey.get('claude:wall-cap'))");
    steps.push({ until: "!!$('.recap-coverage')", shot: 'recap-capped' });
    check("$('.recap-coverage').textContent.includes('Showing the last part')", 'cap is explicit when the latest request is outside the excerpt');
    add("closeModal();recapDialog(state.byKey.get('astra:wall-astra'))");
    steps.push({ until: "!!$('.recap-counts')", shot: 'recap-astra' });
    check("$('.recap-counts').textContent.includes('phoneux.css') && $('.recap-state').textContent.includes('complete')", 'Astra recap reads rollout edits and completion');
    add("closeModal();setView('wall');state.byKey.get('claude:wall-steam').title='Steam Cloud publishing and cross-platform release validation with a very long session name that should remain readable on the phone';renderWall()", 'wall-long-title');
    check("document.documentElement.scrollWidth <= innerWidth", 'long session title stays within the viewport');
    // Exercise the same remote guard over loopback with TEMP paired-device state.
    const headers = { 'X-Forwarded-Host': cfg.remoteHost, 'Tailscale-User-Login': cfg.remoteUser, Cookie: 'nexus_device=' + token, 'X-Nexus': '1', 'Content-Type': 'application/json' };
    await fetch('http://127.0.0.1:4791/api/sessions');
    assert.equal((await fetch('http://127.0.0.1:4791/api/recap?key=claude:wall-steam', { headers: { ...headers, Cookie: '' } })).status, 401);
    const remote = await fetch('http://127.0.0.1:4791/api/recap?key=claude:wall-steam', { headers }); assert.equal(remote.status, 200); assert.equal((await remote.json()).counts.files, 1);
    console.log('PASS paired phone instant endpoint and unpaired rejection');
  }
  fs.writeFileSync(path.join(out, 'steps.json'), JSON.stringify(steps, null, 2));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/cdp-tour.mjs', out], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    child.once('exit', code => { fs.writeFileSync(path.join(out, 'checks.txt'), log); code ? reject(Error(log)) : resolve(); });
  });
  assert.equal(fs.readFileSync(stubLog, 'utf8').trim().split('\n').filter(Boolean).length, real ? 0 : 1, 'one explicit stub request across the whole tour');
  console.log('PASS tour complete: ' + out);
} finally {
  await new Promise(resolve => { if (server.exitCode != null) return resolve(); server.once('exit', resolve); server.kill(); });
  if (!real) {
    const target = fs.realpathSync(temp), parent = fs.realpathSync(os.tmpdir());
    if (!target.toLowerCase().startsWith(parent.toLowerCase() + path.sep) || !path.basename(target).startsWith('nexus-wall-tour-')) throw Error('Unsafe fixture cleanup');
    fs.rmSync(target, { recursive: true, force: true });
  }
}
