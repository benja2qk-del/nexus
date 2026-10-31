// Owns only an isolated port-4790 child; never discovers or terminates other servers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
export async function privateServer() {
  await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(4790, '127.0.0.1', () => probe.close(resolve)); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upload-test-'));
  const env = { ...process.env, NEXUS_PORT: '4790', NEXUS_DEVICES_FILE: path.join(dir, 'devices.json'), NEXUS_STATE_FILE: path.join(dir, 'state.json'), NEXUS_UPLOAD_DIR: path.join(dir, 'uploads'), LOCALAPPDATA: dir, NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_TEST_TERMINALS: '1' };
  let child;
  const kill = () => child?.kill(); process.on('exit', kill);
  const start = () => new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['server.js'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => reject(Error('Isolated server did not start')), 20000);
    child.stdout.on('data', data => { output += data; if (output.includes('http://127.0.0.1:4790/')) { clearTimeout(timer); resolve(); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (!output.includes('http://127.0.0.1:4790/')) reject(Error('Isolated server exited: ' + code)); });
  });
  const stop = () => new Promise(resolve => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
  await start();
  return { dir, env, start, stop, close: async () => {
    await stop(); process.removeListener('exit', kill);
    const resolved = fs.realpathSync(dir), temp = fs.realpathSync(os.tmpdir());
    if (!resolved.toLowerCase().startsWith(temp.toLowerCase() + path.sep) || !path.basename(resolved).startsWith('nexus-upload-test-') || fs.lstatSync(dir).isSymbolicLink()) throw Error('Refusing cleanup outside the owned TEMP fixture');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } };
}
