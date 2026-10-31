'use strict';
// Exercise state persistence and the model boundary without using an account or a real session.
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const assert = require('assert/strict');
const { EventEmitter } = require('events');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-insights-')), stateFile = path.join(dir, 'state.json');
  let fakeWorker, calls = 0, argsSeen, promptSeen, invalid = false;
  class Worker extends EventEmitter { constructor() { super(); fakeWorker = this; } unref() {} postMessage() {} }
  const spawn = (file, args, options) => {
    calls++; argsSeen = args;
    assert.equal(options.windowsHide, true);
    assert(!args.includes('--resume') && !args.includes('--continue'));
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = new EventEmitter(); p.kill = () => {};
    p.stdin.end = text => {
      promptSeen = text;
      setTimeout(() => { p.stdout.emit('data', JSON.stringify({ result: invalid ? 'not JSON' : '{"verdict":"on-track","reason":"The recent edits implement the stated objective."}', total_cost_usd: .001 })); p.emit('close', 0); }, 8);
    };
    return p;
  };
  const load = () => {
    const module = { exports: {} };
    const context = vm.createContext({ require: name => name === 'worker_threads' ? { Worker } : name === 'child_process' ? { spawn } : require(name), module, __dirname: path.resolve('.'), process: { env: { NEXUS_STATE_FILE: stateFile }, platform: process.platform, pid: process.pid }, console, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync('insights.js', 'utf8'), context); return module.exports;
  };
  const i = load();
  const s = { kind: 'claude', id: 'snapshot-only', size: 123, title: 'Session objective', firstPrompt: 'Build a clear overview', status: 'offline', groupLabel: 'Fixture' };
  fakeWorker.emit('message', { key: 'claude:snapshot-only', scan: { scanned: true, complete: true }, recent: Array.from({ length: 20 }, () => ({ type: 'tool', text: 'event '.repeat(500) })), lastRequest: 'Implement the overview', waste: [] });
  assert.equal(calls, 0, 'indexing never calls a model');
  const [a, b] = await Promise.all([i.checkFocus(s), i.checkFocus(s)]);
  assert.equal(a.verdict, 'on-track'); assert.equal(b.verdict, 'on-track'); assert.equal(calls, 1, 'concurrent identical checks share one call');
  assert(argsSeen.includes('--safe-mode')); assert(argsSeen.includes('--no-session-persistence'));
  assert.equal(argsSeen[argsSeen.indexOf('--tools') + 1], ''); assert.equal(argsSeen[argsSeen.indexOf('--allowedTools') + 1], '');
  assert.equal(argsSeen[argsSeen.indexOf('--model') + 1], 'haiku'); assert(promptSeen.length < 16100, 'input excerpt is capped');
  assert.equal((await i.checkFocus(s)).cached, true); assert.equal(calls, 1, 'cached reads cost no request');
  s.size++; invalid = true; await assert.rejects(i.checkFocus(s), /valid verdict/); assert.equal(calls, 2);
  invalid = false; await i.checkFocus(s); assert.equal(calls, 3, 'malformed verdict does not poison the cache');
  await Promise.all([i.viewed('claude:snapshot-only', 2000), i.viewed('claude:snapshot-only', 1000)]);
  assert.equal(JSON.parse(fs.readFileSync(stateFile)).viewed['claude:snapshot-only'], 2000, 'out-of-order checkpoints cannot move backward');
  const reloaded = load(); assert.equal(reloaded.forSession(s).lastViewed, 2000, 'checkpoint survives process reload');
  const app = fs.readFileSync('public/app.js', 'utf8');
  const steerSource = app.slice(app.indexOf('function steer(kind)'), app.indexOf('\nsetInterval(', app.indexOf('function steer(kind)')));
  const sent = [];
  const steerContext = vm.createContext({ sendChat: () => sent.push('send'), answerChat: value => sent.push(value), chatHelp: () => sent.push('help') });
  vm.runInContext(steerSource + '\nsteer("send");steer("esc");steer("help");', steerContext);
  assert.deepEqual(sent, ['send', 'esc', 'help'], 'composer routes to HTTP Chat, including interruption');
  const client = fs.readFileSync('public/polish.js', 'utf8'), deadlines = [];
  const requestContext = vm.createContext({ AbortController, setTimeout: (_, ms) => (deadlines.push(ms), 1), clearTimeout() {}, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  vm.runInContext(client.slice(client.indexOf('async function nexusRequest'), client.indexOf('function savePlace')), requestContext);
  await vm.runInContext("nexusRequest('/api/sessions')", requestContext);
  await vm.runInContext("postNexus('/api/action', {action:'check-focus'})", requestContext);
  assert.deepEqual(deadlines, [10000, 65000], 'read deadlines do not truncate the server\'s sixty-second model check');
  requestContext.fetch = async () => { const e = new Error(); e.name = 'AbortError'; throw e; };
  await assert.rejects(vm.runInContext("postNexus('/api/action', {action:'term-new'})", requestContext), /Check the current state/, 'mutations never promise an automatic replay');
  fs.unlinkSync(stateFile); fs.rmdirSync(dir);
  console.log('PASS: no automatic model use; Haiku/no-tools/nonpersistent flags; capped snapshot; concurrent deduplication; size cache; invalid-output retry; atomic monotonic checkpoints survive reload; HTTP Chat routing. No real model calls.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
