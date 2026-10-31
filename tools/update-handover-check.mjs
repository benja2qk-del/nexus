// An update written while NEXUS runs: a fresh NEXUS takes the port over and the open page reloads; an update that
// cannot start leaves the running NEXUS serving. Runs a private copy of NEXUS on port 4790 with empty session folders
// and a headless page; owns and stops only the processes it starts. About two minutes.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { browser, sleep } from './polish-browser.mjs';
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(4790, '127.0.0.1', () => probe.close(resolve)); });
const source = path.resolve('.'), fixture = fs.mkdtempSync(path.resolve('.local/handover-')), app = path.join(fixture, 'app');
// Top-level files are copied (one is changed below); folders the server reads are linked.
fs.mkdirSync(app);
for (const f of fs.readdirSync(source)) {
  const st = fs.statSync(path.join(source, f));
  if (st.isFile()) fs.copyFileSync(path.join(source, f), path.join(app, f));
  else if (!['.git', '.local', 'docs'].includes(f)) fs.symlinkSync(path.join(source, f), path.join(app, f), 'junction');
}
const empty = name => { const d = path.join(fixture, name); fs.mkdirSync(d, { recursive: true }); return d; };
fs.writeFileSync(path.join(fixture, 'config.json'), '{}');
const env = { ...process.env, NEXUS_PORT: '4790', NEXUS_CONFIG_FILE: path.join(fixture, 'config.json'), NEXUS_STATE_FILE: path.join(empty('state'), 'state.json'), NEXUS_DEVICES_FILE: path.join(fixture, 'devices.json'),
  NEXUS_UPLOAD_DIR: empty('uploads'), LOCALAPPDATA: empty('local'), NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_READ_ONLY: '1', NEXUS_CLAUDE_DIR: empty('claude'), NEXUS_CODEX_DIR: empty('codex'), NEXUS_COPILOT_DIR: empty('copilot') };
process.env.NEXUS_PORT = '4790';
const report = [], pass = label => { report.push('PASS ' + label); console.log(report.at(-1)); };
const build = async () => { try { const r = await fetch('http://127.0.0.1:4790/api/sessions', { headers: { 'X-Nexus': '1' } }); return (await r.json()).build; } catch { return null; } };
const listener = () => { const line = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(l => /127\.0\.0\.1:4790\s+\S+\s+LISTENING/.test(l)); return line ? Number(line.trim().split(/\s+/).at(-1)) : 0; };
const first = spawn(process.execPath, [path.join(app, 'server.js'), '--idle-exit'], { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let firstExited = false, output = ''; first.once('exit', () => { firstExited = true; });
for (const s of [first.stdout, first.stderr]) s.on('data', d => { output += d; });
const b = await browser(1280, 800);
try {
  for (let i = 0; i < 100 && !(await build()); i++) await sleep(200);
  const before = await build(); assert(before, 'the private NEXUS answers: ' + output.slice(-1500));
  await b.navigate(); await b.until('state.booted'); await b.js('window.sameDocument = true');

  // A broken update: the new copy cannot start, so the running NEXUS keeps serving the page.
  const recap = path.join(app, 'recap.js'), good = fs.readFileSync(recap, 'utf8');
  fs.writeFileSync(recap, good + '\nthis is not javascript(');
  await sleep(40000);
  assert.equal(await build(), before); assert(!firstExited && listener() === first.pid && await b.js('window.sameDocument === true'));
  pass('an update that cannot start leaves the running NEXUS and its page in place');

  // A good update: once the files settle, a fresh NEXUS takes over and the page loads its code.
  fs.writeFileSync(recap, good + '\n// updated\n');
  let after = before; for (let i = 0; i < 90 && after === before; i++) { await sleep(1000); after = await build() || before; }
  assert.notEqual(after, before, 'a new build serves the port');
  for (let i = 0; i < 50 && !firstExited; i++) await sleep(100);
  assert(firstExited && listener() && listener() !== first.pid, 'the old NEXUS left and another process listens');
  pass('a good update is taken over by a fresh NEXUS within a minute; the old one exits');
  await b.until("!window.sameDocument && state.booted && state.build === " + JSON.stringify(after), 20000);
  pass('the open page reloads into the new version');
  assert.equal(b.exceptions.length, 0, JSON.stringify(b.exceptions));
} finally {
  await b.close();
  const pid = listener(); if (pid && pid !== process.pid) try { process.kill(pid); } catch {}
  if (!firstExited) first.kill();
  await sleep(500); fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
