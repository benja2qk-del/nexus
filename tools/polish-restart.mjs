import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {browser,sleep} from './polish-browser.mjs';
if(process.env.NEXUS_PORT!=='4790')throw Error('Private port 4790 required');
const dir=fs.readFileSync('docs/shots/tmp/polish-temp.txt','utf8').trim();
assert(path.resolve(dir).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()+path.sep));
const env={...process.env,NEXUS_PORT:'4790',NEXUS_DEVICES_FILE:path.join(dir,'devices.json'),NEXUS_STATE_FILE:path.join(dir,'state.json'),NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_TEST_TERMINALS:'1'};
let server;
const start=()=>new Promise((resolve,reject)=>{server=spawn(process.execPath,['server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';const timer=setTimeout(()=>reject(Error('Private server did not start')),20000);server.stdout.on('data',d=>{text+=d;if(text.includes('http://127.0.0.1:4790/')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);if(!text.includes('http://127.0.0.1:4790/'))reject(Error('Server exited '+code));});});
const stop=()=>new Promise(resolve=>{server.once('exit',resolve);server.kill();});
const kill=()=>server?.kill();process.on('exit',kill);
let b;const report=[];
try{
  await start();b=await browser(430,932);await b.navigate();await b.until('state.booted && state.sessions.length>0');
  await b.js("select(keyOf(state.sessions.find(s=>s.kind==='astra')||state.sessions[0]),{tab:'thinking'})");await b.until('!!state.transcript');
  const key=await b.js('state.sel');
  await stop();await b.until("!$('#connection').classList.contains('hidden')",15000);await b.shot('docs/shots/polish/430-server-stopped.png');
  assert.equal(await b.js('state.sel'),key);report.push('PASS actual server shutdown preserves selected session and last reading');
  await start();await b.until("$('#connection').classList.contains('hidden')",15000);
  assert.equal(await b.js('state.sel'),key);assert.equal(await b.js('state.tab'),'thinking');
  report.push('PASS actual server restart reconnects automatically with the same session and tab');await sleep(600);await b.shot('docs/shots/polish/430-server-recovered.png');
  const auth=execFileSync(process.execPath,['tools/polish-auth.mjs','--after-restart'],{env,encoding:'utf8',windowsHide:true});report.push(auth.trim());
  assert.equal(b.exceptions.length,0);report.push('PASS restart has no uncaught browser exceptions');
}finally{if(b)await b.close();if(server && server.exitCode===null)await stop();process.removeListener('exit',kill);fs.writeFileSync('docs/shots/polish/restart-checks.txt',report.join('\n')+'\n');}
console.log(report.join('\n'));
