import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { privateServer } from './upload-server.mjs';
const server = await privateServer(), report = [];
const base = 'http://127.0.0.1:4790', root = server.env.NEXUS_UPLOAD_DIR;
const config = JSON.parse(fs.readFileSync('config.json'));
const remote = { Host: config.remoteHost, 'X-Forwarded-For': '100.64.0.8', 'Tailscale-User-Login': config.remoteUser };
const tiny = path.join(server.dir, 'sample.txt'); fs.writeFileSync(tiny, 'NEXUS attachment\n');
const check = (test, label) => { assert(test, label); report.push('PASS ' + label); console.log(report.at(-1)); };
function curl(route, { headers = {}, file, body, method = 'POST' } = {}) {
  const args = ['--silent', '--show-error', '--max-time', '25', '--request', method, base + route, '--write-out', '\n%{http_code}'];
  for (const [k, v] of Object.entries(headers)) args.push('--header', k + ': ' + v);
  if (file) args.push('--data-binary', '@' + file);
  if (body !== undefined) args.push('--data-binary', JSON.stringify(body));
  const text = execFileSync('curl.exe', args, { encoding: 'utf8', windowsHide: true });
  const status = Number(text.slice(text.lastIndexOf('\n') + 1));
  let data; try { data = JSON.parse(text.slice(0, text.lastIndexOf('\n'))); } catch {}
  return { status, data };
}
const post = (route, body = {}, headers = {}) => curl(route, { body, headers: { 'X-Nexus': '1', ...headers } });
function pair(name) {
  const code = post('/api/pair/new').data.code;
  const headerFile = path.join(server.dir, name + '-headers.txt');
  execFileSync('curl.exe', ['--silent', '--show-error', '--max-time', '10', '--dump-header', headerFile, '-X', 'POST', base + '/api/pair', ...Object.entries({ ...remote, 'X-Nexus': '1' }).flatMap(([k,v]) => ['-H', k + ': ' + v]), '--data-binary', JSON.stringify({ code, name })], { windowsHide: true });
  const cookie = fs.readFileSync(headerFile, 'utf8').match(/set-cookie:\s*([^;\r\n]+)/i)?.[1];
  assert(cookie, 'test device paired'); return { ...remote, Cookie: cookie };
}
const upload = (name, headers = {}, file = tiny) => curl('/api/upload', { file, headers: { 'X-Nexus': '1', 'X-Nexus-Filename': encodeURIComponent(name), ...headers } });
const datedFiles = () => fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter(f => /^\d{4}-\d{2}-\d{2}[\\/]/.test(f)) : [];
const noPartials = () => !datedFiles().some(f => path.basename(f).startsWith('.upload-'));
try {
  let r = upload('notes.txt');
  check(r.status === 200 && r.data.size === fs.statSync(tiny).size && fs.readFileSync(r.data.path, 'utf8') === fs.readFileSync(tiny, 'utf8'), 'curl normal upload stores exact bytes and returns path, name, size');
  check(path.isAbsolute(r.data.path) && r.data.path.startsWith(root + path.sep) && /\d{4}-\d{2}-\d{2}/.test(r.data.path), 'absolute destination is inside isolated dated upload folder');
  r = upload('notes.txt'); check(r.status === 200 && r.data.name === 'notes (2).txt', 'curl collision adds (2) without overwriting');
  for (const [name, expected] of [['..\\..\\x', 'x'], ['C:\\x', 'x (2)'], ['CON.txt', '_CON.txt'], ['AUX .txt', '_AUX .txt'], ['a/b/PRN', '_PRN'], ['bad\u0000<>:"|?*name. ', 'bad________name']]) {
    r = upload(name); check(r.status === 200 && r.data.name === expected && r.data.path.startsWith(root + path.sep), 'curl sanitized name: ' + JSON.stringify(name));
  }
  r = curl('/api/upload', { file: tiny, headers: { 'X-Nexus-Filename': 'missing.txt' } }); check(r.status === 403, 'curl missing X-Nexus denied');
  r = upload('foreign.txt', { Origin: 'https://foreign.example' }); check(r.status === 403, 'curl foreign Origin denied');
  r = upload('remote.txt', remote); check(r.status === 401, 'curl tailnet identity without paired device denied');
  r = upload('wrong.txt', { ...remote, 'Tailscale-User-Login': 'wrong@example.invalid' }); check(r.status === 403, 'curl wrong remote identity denied');
  r = curl('/api/upload', { method: 'OPTIONS', headers: { Origin: 'https://foreign.example', 'Access-Control-Request-Headers': 'X-Nexus' } }); check(r.status === 405, 'CORS preflight cannot authorize an upload');
  r = curl('/api/upload', { method: 'GET' }); check(r.status === 405, 'no upload listing endpoint');
  r = curl('/uploads/notes.txt', { method: 'GET' }); check(r.status === 404, 'uploaded files are not served');
  const a = pair('limits-a'), b = pair('limits-b');
  r = upload('phone.heic', a); check(r.status === 200, 'curl paired remote may upload HEIC unchanged');
  const large = path.join(server.dir, 'large.bin'); const fd = fs.openSync(large, 'w'); fs.ftruncateSync(fd, 50 * 1024 * 1024 + 1); fs.closeSync(fd);
  r = upload('large.mov', a, large); check(r.status === 413 && /50 MB/.test(r.data.error), 'curl Content-Length over 50 MB refused early with friendly error');
  r = upload('stream.mov', { ...a, 'Transfer-Encoding': 'chunked' }, large); check(r.status === 413 && noPartials(), 'curl chunked stream over 50 MB refused and partial removed');
  const beforeAbort = datedFiles().length;
  await new Promise(resolve => {
    const req = http.request(base + '/api/upload', { method: 'POST', headers: { ...a, 'X-Nexus': '1', 'X-Nexus-Filename': 'aborted.bin', 'Content-Length': 1048576 } });
    req.on('error', () => {}); req.write(Buffer.alloc(65536)); setTimeout(() => { req.destroy(); resolve(); }, 150);
  });
  await new Promise(r => setTimeout(r, 250)); check(noPartials() && datedFiles().length === beforeAbort, 'aborted upload leaves neither partial nor final file');
  const revoked = pair('revoked-in-flight');
  let revoking;
  const revokedResult = new Promise((resolve, reject) => {
    revoking = http.request(base + '/api/upload', { method: 'POST', headers: { ...revoked, 'X-Nexus': '1', 'X-Nexus-Filename': 'revoked.bin', 'Content-Length': 131072 } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    revoking.on('error', reject); revoking.write(Buffer.alloc(65536));
  });
  await new Promise(r => setTimeout(r, 100));
  const victim = curl('/api/devices', { method: 'GET' }).data.devices.find(d => d.name === 'revoked-in-flight');
  assert.equal(post('/api/devices/revoke', { id: victim.id }).status, 200);
  revoking.end(Buffer.alloc(65536));
  check(await revokedResult === 401 && noPartials() && !datedFiles().some(f => f.endsWith('revoked.bin')), 'revocation during upload prevents final publication and removes partial');
  const parallel = pair('concurrent-quota'), held = [];
  for (let i = 0; i < 4; i++) {
    const req = http.request(base + '/api/upload', { method: 'POST', headers: { ...parallel, 'X-Nexus': '1', 'X-Nexus-Filename': 'held.bin', 'Content-Length': 50 * 1024 * 1024 } });
    req.on('error', () => {}); req.write('x'); held.push(req);
  }
  await new Promise(r => setTimeout(r, 100));
  check(upload('over-concurrent.txt', parallel).status === 429, 'concurrent requests reserve the daily allowance before reading their bodies');
  held.forEach(req => req.destroy()); await new Promise(r => setTimeout(r, 150));
  check(upload('after-aborts.txt', parallel).status === 200 && noPartials(), 'aborted reservations settle to received bytes and release unused allowance');
  const concurrent = await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
    const req = http.request(base + '/api/upload', { method: 'POST', headers: { ...b, 'X-Nexus': '1', 'X-Nexus-Filename': 'same.txt' } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => { try { assert.equal(res.statusCode, 200); resolve(JSON.parse(text)); } catch (e) { reject(e); } });
    }); req.on('error', reject); req.end('concurrent');
  })));
  check(new Set(concurrent.map(x => x.path)).size === 3 && concurrent.every(x => fs.readFileSync(x.path, 'utf8') === 'concurrent'), 'concurrent same-name uploads each retain their bytes');
  for (let i = 0; i < 7; i++) assert.equal(upload('rate.txt', b).status, 200);
  check(upload('rate.txt', b).status === 429, 'eleventh file per minute per device refused');
  check(upload('independent.txt', a).status === 200, 'one device rate limit does not block another device');
  await server.stop(); await server.start();
  check(upload('rate-restart.txt', b).status === 429, 'per-device minute limit survives server restart');
  const daily = pair('daily'); fs.truncateSync(large, 50 * 1024 * 1024);
  for (let i = 0; i < 4; i++) { r = upload('fifty.bin', daily, large); assert.equal(r.status, 200); assert.equal(r.data.size, 50 * 1024 * 1024); }
  check(upload('over-daily.txt', daily).status === 429, 'exactly 200 MB allowed and next byte denied per device');
  await server.stop(); await server.start(); check(upload('over-restart.txt', daily).status === 429, 'daily allowance survives server restart');
  check(noPartials(), 'all completed and refused requests leave no partial files');
  // Fault paths exercise cleanup without touching the owner's filesystem.
  const fault = pair('fault'), day = fs.readdirSync(root).find(x => /^\d{4}-/.test(x));
  const saved = path.join(root, day + '-saved'); fs.renameSync(path.join(root, day), saved); fs.writeFileSync(path.join(root, day), 'block directory');
  check(upload('disk-error.txt', fault).status === 500, 'unavailable destination returns a friendly save failure');
  fs.unlinkSync(path.join(root, day)); fs.renameSync(saved, path.join(root, day));
  const outside = path.join(server.dir, 'outside-uploads'); fs.mkdirSync(outside); fs.renameSync(path.join(root, day), saved);
  fs.symlinkSync(outside, path.join(root, day), 'junction');
  check(upload('escape.txt', fault).status === 500 && fs.readdirSync(outside).length === 0, 'dated-folder junction cannot redirect an upload outside its root');
  fs.unlinkSync(path.join(root, day)); fs.renameSync(saved, path.join(root, day));
  r = upload('Résumé 📎.txt', fault); check(r.status === 200 && r.data.name === 'Résumé 📎.txt', 'URL-encoded Unicode filenames round-trip safely');
  await server.stop();
  const limitsFile = path.join(root, '.limits.json'), limits = fs.readFileSync(limitsFile);
  fs.writeFileSync(limitsFile, '{invalid'); await server.start();
  check(upload('bad-ledger.txt', fault).status === 503, 'unreadable quota ledger fails closed');
  await server.stop(); fs.writeFileSync(limitsFile, limits); await server.start();
  const { filename } = await import('../uploads.js');
  for (const name of ['NUL', 'LPT9.txt', 'COM1', 'con .txt', 'LPT¹.txt', 'CONIN$', 'CONOUT$']) assert(filename(encodeURIComponent(name)).startsWith('_'));
  check(filename(encodeURIComponent('x'.repeat(300) + '.png')).length <= 120, 'reserved Windows names and long filenames are bounded');
  report.push('All storage, device and state files were isolated in TEMP; no real sessions or model calls.');
} finally {
  await server.close(); fs.mkdirSync('docs/shots/upload', { recursive: true }); fs.writeFileSync('docs/shots/upload/server-checks.txt', report.join('\n') + '\n');
}
