// NEXUS_PORT=4790 node tools/cdp-tour.mjs outdir; steps: wait, js, click, key, drag, viewport, shot.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const out = path.resolve(process.argv[2]);
if (!['4790', '4791', '4785', '4786'].includes(process.env.NEXUS_PORT)) throw new Error('Tours only run on private ports 4790 / 4791 / 4785 / 4786');
const E = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const width = Number(process.env.NEXUS_WIDTH) || 1920;
const height = Number(process.env.NEXUS_HEIGHT) || 1080;
const mobile = width <= 700, deviceScaleFactor = mobile ? 3 : 1;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-phoneux-browser-'));
const fakeAudio = process.env.NEXUS_FAKE_AUDIO;
if (fakeAudio && (!path.resolve(fakeAudio).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep) || !fs.existsSync(fakeAudio))) throw Error('Fake capture must be a TEMP WAV');
const p = spawn(E, ['--headless=new', '--mute-audio', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', ...(fakeAudio ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + fakeAudio] : []), `--window-size=${width},${height}`, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
process.on('exit', () => p.kill());
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let attempt = 0; !fs.existsSync(path.join(profile, 'DevToolsActivePort')); attempt++) {
  if (attempt > 60) throw new Error('Headless Edge did not expose its debugging port');
  await sleep(250);
}
const debugPort = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const logs = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.method === 'Fetch.requestPaused') {
    const request = d.params, pathname = new URL(request.request.url).pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (/^[a-z-]+\.(?:html|js|css)$/.test(file)) {
      try {
        const body = execFileSync('git', ['show', process.env.NEXUS_TOUR_BASELINE + ':public/' + file], { windowsHide:true, stdio:['ignore','pipe','ignore'] });
        const mime = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
        cmd('Fetch.fulfillRequest', {requestId:request.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:mime+'; charset=utf-8'}],body:body.toString('base64')}).catch(console.error);
        return;
      } catch {}
    }
    cmd('Fetch.continueRequest', {requestId:request.requestId}).catch(console.error);
    return;
  }
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails).slice(0, 500));
  if (d.method === 'Runtime.consoleAPICalled') logs.push('LOG ' + d.params.args.map(a => a.value).join(' '));
};
const cmd = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id, timeout = setTimeout(() => { pend.delete(i); reject(new Error('CDP timed out: ' + method)); }, 20000);
  pend.set(i, value => { clearTimeout(timeout); value.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const shot = async (name, settle = 350) => { if (settle) await sleep(settle); const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.result.data, 'base64')); };
const js = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, replMode: true })).result;
await cmd('Runtime.enable'); await cmd('Page.enable');
if (process.env.NEXUS_TOUR_BASELINE) {
  if (!/^[a-f0-9]{7,40}$/.test(process.env.NEXUS_TOUR_BASELINE)) throw Error('Baseline must be a commit id');
  await cmd('Fetch.enable', {patterns:[{urlPattern:'http://127.0.0.1:'+process.env.NEXUS_PORT+'/*'}]});
}
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
if (mobile) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
if (process.env.NEXUS_TOUR_SOURCE) await cmd('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(process.env.NEXUS_TOUR_SOURCE, 'utf8') });
if (!process.env.NEXUS_VOICE_TOUR) await cmd('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__spoken = 0; if(window.speechSynthesis) speechSynthesis.speak = () => { window.__spoken++; };' });
await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile,
  screenWidth: Number(process.env.NEXUS_SCREEN_WIDTH) || width, screenHeight: Number(process.env.NEXUS_SCREEN_HEIGHT) || height });
await cmd('Page.navigate', { url: 'http://127.0.0.1:' + (process.env.NEXUS_PORT || 4790) + '/' });
for (const step of JSON.parse(fs.readFileSync(path.join(out, 'steps.json'), 'utf8').replace(/^\uFEFF/, ''))) {
  if (step.voiceText !== undefined) {
    const root = fs.realpathSync(process.env.NEXUS_VOICE_FIXTURE || '');
    if (!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep) || !path.basename(root).startsWith('nexus-voice-')) throw Error('Unsafe voice fixture');
    fs.writeFileSync(path.join(root, 'utterance.txt'), String(step.voiceText));
  }
  if (step.fixtureAppend) {
    const root = fs.realpathSync(process.env.NEXUS_ONECHAT_FIXTURE || '');
    const target = fs.realpathSync(path.resolve(root, step.fixtureAppend.file));
    if (!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep) || !path.basename(root).startsWith('nexus-onechat-') || !target.toLowerCase().startsWith(root.toLowerCase() + path.sep) || !target.endsWith('.jsonl')) throw Error('Fixture append outside owned TEMP directory');
    fs.appendFileSync(target, step.fixtureAppend.records.map(r => JSON.stringify({...r,timestamp:new Date().toISOString()})).join('\n')+'\n');
  }
  if (step.wait) await sleep(step.wait);
  if (step.navigate) { await cmd('Page.navigate', { url: 'http://127.0.0.1:' + process.env.NEXUS_PORT + step.navigate }); await sleep(500); }
  if (step.until) { const start = Date.now(); while (!(await js(step.until)).result?.value) { if (Date.now() - start > 20000) { console.log(logs.join('\n')); console.log(await js('document.body.innerText.slice(0,1500)')); throw Error('Timed out: ' + step.until); } await sleep(100); } }
  if (step.js) { const r = await js(step.js); if (r.exceptionDetails) { console.log(logs.join('\n')); throw new Error(JSON.stringify(r.exceptionDetails)); } console.log('JS', String(JSON.stringify(r.result ? r.result.value : r)).slice(0, 1600)); }
  if (step.viewport) await cmd('Emulation.setDeviceMetricsOverride', { width: step.viewport[0], height: step.viewport[1], deviceScaleFactor, mobile });
  if (step.media) await cmd('Emulation.setEmulatedMedia', step.media);
  if (step.network) { await cmd('Network.enable'); await cmd('Network.emulateNetworkConditions', step.network); }
  if (step.key) {
    const [key, code, vk] = step.key;
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key === 'Enter' ? '\r' : key.length === 1 ? key : undefined });
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  }
  if (step.click) {
    await js(`document.querySelector(${JSON.stringify(step.click)}).scrollIntoView({block:'center',inline:'nearest'})`);
    await sleep(100);
    const r = await js(`(() => { const b = document.querySelector(${JSON.stringify(step.click)}).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
    const [x, y] = r.result.value;
    if (mobile) {
      await cmd('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
      await cmd('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    } else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  if (step.drag) {
    const [x, y1, y2] = step.drag;
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y1 });
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: y1, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) { await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y1 + (y2 - y1) * i / 10, button: 'left', buttons: 1 }); await sleep(30); }
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y2, button: 'left', clickCount: 1 });
  }
  if (step.shot) await shot(step.shot, step.shotDelay);
  if (step.icon) {
    const r = await js(`(async()=>{const im=new Image();im.src='/icon.svg';await im.decode();const c=document.createElement('canvas');c.width=c.height=${Number(step.icon.size)};c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1]})()`);
    fs.writeFileSync(path.resolve('public', step.icon.file), Buffer.from(r.result.value, 'base64'));
  }
}
console.log(logs.join('\n'));
await cmd('Browser.close'); ws.close(); p.kill();
if (logs.some(line => line.startsWith('EXC '))) throw new Error('Browser raised an uncaught exception; see tour log');
