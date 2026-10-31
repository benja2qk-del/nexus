import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { WebSocket } = require('ws');
if (process.env.NEXUS_PORT !== '4790') throw Error('API checks require port 4790');
const base = 'http://127.0.0.1:4790', times = [];
for (let n = 0; n < 5; n++) {
  const start = performance.now(), response = await fetch(base + '/api/sessions');
  assert.equal(response.status, 200); const data = await response.json(); times.push(Math.round(performance.now() - start));
  assert(data.sessions.length > 0 && data.usage && Array.isArray(data.terms));
  assert(data.sessions.every(s => s.insights && !('file' in s)), 'API retains legacy fields and does not expose transcript paths');
}
assert.equal((await fetch(base + '/api/action', { method: 'POST', body: '{"action":"term-new"}' })).status, 403, 'actions require X-Nexus header');
const protectedAction = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexus': '1' }, body: '{"action":"term-resume","key":"test-only-nonexistent"}' });
assert.equal(protectedAction.status, 400); assert.match((await protectedAction.json()).error, /disabled in test mode/, 'test server refuses existing-session actions before lookup');
const hostStatus = await new Promise((resolve, reject) => {
  const req = http.get(base + '/api/sessions', { headers: { Host: 'foreign.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
});
assert.equal(hostStatus, 403, 'DNS-rebinding host rejected');
assert.notEqual((await fetch(base + '/..%2fserver.js')).status, 200, 'static traversal rejected');
assert.equal((await fetch(base + '/api/action', { method: 'OPTIONS', headers: { Origin: 'https://foreign.example', 'Access-Control-Request-Headers': 'X-Nexus' } })).headers.get('access-control-allow-origin'), null, 'no cross-origin action permission');
const action = async (name, extra) => { const r = await fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexus': '1' }, body: JSON.stringify({ action: name, ...extra }) }); assert.equal(r.status, 200); return (await r.json()).result; };
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ws-'));
let terminal;
try {
  terminal = await action('term-new', { cwd: scratch });
  const opened = origin => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:4790/pty?id=${terminal.term}`, { origin });
    const timeout = setTimeout(() => { ws.terminate(); resolve(false); }, 3000);
    ws.on('open', () => { clearTimeout(timeout); ws.close(); resolve(true); });
    ws.on('error', () => { clearTimeout(timeout); resolve(false); });
  });
  assert.equal(await opened('https://foreign.example'), false, 'foreign WebSocket origin rejected');
  assert.equal(await opened(base), true, 'same-origin scratch terminal attaches');
} finally { if (terminal) await action('term-close', { term: terminal.term }); }
const final = await (await fetch(base + '/api/sessions')).json(); assert(!final.terms.some(t => t.id === terminal?.term));
console.log(JSON.stringify({ result: 'PASS legacy API fields, host/header/path/CORS checks, WebSocket Origin, scratch attach and cleanup', requestMs: times, realSessionActions: 0 }, null, 2));
