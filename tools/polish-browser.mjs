// A headless-only, silent browser owned by the private port-4790 test harness.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function browser(width = 390, height = 844, { gpu = false } = {}) {
  if (process.env.NEXUS_PORT !== '4790') throw Error('Private port 4790 required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-polish-browser-'));
  const executable = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const child = spawn(executable, ['--headless=new','--mute-audio',...(gpu?[]:['--disable-gpu']),'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir=' + profile,'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const kill = () => child.kill(); process.on('exit', kill);
  for (let n = 0; !fs.existsSync(path.join(profile,'DevToolsActivePort')); n++) { if(n > 100) throw Error('Headless browser unavailable'); await sleep(100); }
  const port = fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), logs = [], exceptions = [];
  ws.onmessage = e => { const d = JSON.parse(e.data); if(d.id) { pending.get(d.id)?.(d); pending.delete(d.id); }
    if(d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails);
    if(d.method === 'Runtime.consoleAPICalled') logs.push(d.params.args.map(a => a.value || a.description).join(' '));
  };
  const cmd = (method, params = {}) => new Promise((resolve,reject) => { const n = ++id, timer = setTimeout(() => {pending.delete(n); reject(Error(method + ' timed out'));},25000); pending.set(n,d => {clearTimeout(timer); d.error ? reject(Error(JSON.stringify(d.error))) : resolve(d.result);}); ws.send(JSON.stringify({id:n,method,params})); });
  const js = async expression => { const r = await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,replMode:true}); if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; };
  const navigate = async (route = '/') => { await cmd('Page.navigate',{url:'http://127.0.0.1:4790'+route}); };
  const until = async (expr, timeout = 20000) => { const start=Date.now(); while(Date.now()-start<timeout) { try {if(await js(expr))return;} catch{} await sleep(100); } throw Error('Timed out waiting for '+expr); };
  const shot = async file => { await sleep(350); const r = await cmd('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(file,Buffer.from(r.data,'base64')); };
  await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Network.enable');
  await cmd('Emulation.setFocusEmulationEnabled',{enabled:true});
  await cmd('Page.addScriptToEvaluateOnNewDocument',{source:"window.__spoken=0;if(window.speechSynthesis)speechSynthesis.speak=()=>window.__spoken++;"});
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<701,screenWidth:width,screenHeight:height});
  if(width<701) await cmd('Emulation.setTouchEmulationEnabled',{enabled:true});
  const close = async () => { try{await cmd('Browser.close');}catch{} ws.close(); kill(); process.removeListener('exit',kill); };
  // CPU time for this owned headless browser only, including its renderer and compositor processes.
  const processInfo = async () => {
    const endpoint = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const socket = new WebSocket(endpoint.webSocketDebuggerUrl);
    try {
      await new Promise((resolve,reject) => { socket.onopen=resolve;socket.onerror=reject; });
      return await new Promise((resolve,reject) => {
        const timer=setTimeout(()=>reject(Error('Browser CPU metrics timed out')),5000);
        socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.id===1){clearTimeout(timer);d.error?reject(Error(d.error.message)):resolve(d.result.processInfo);}};
        socket.send(JSON.stringify({id:1,method:'SystemInfo.getProcessInfo'}));
      });
    } finally { socket.close(); }
  };
  return { cmd, js, navigate, until, shot, close, logs, exceptions, processInfo };
}
