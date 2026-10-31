// Read-only owner discovery; every capture/log stays in the ignored .local tree.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn,execFileSync} from 'node:child_process';
await new Promise((r,j)=>{const p=net.createServer();p.once('error',j);p.listen(4790,'127.0.0.1',()=>p.close(r));});
fs.mkdirSync('.local',{recursive:true});
const root=fs.mkdtempSync(path.resolve('.local/review-real-'));
execFileSync('git',['check-ignore',root],{stdio:'ignore',windowsHide:true});
const guard=path.join(root,'browser-guard.js'),preload=path.join(root,'readonly.cjs');
fs.writeFileSync(guard,`const original=window.fetch.bind(window);window.fetch=(url,opts={})=>{if(opts.method&&opts.method!=='GET'){if(new URL(url,location.href).pathname==='/api/action'&&JSON.parse(opts.body||'{}').action==='viewed')return Promise.resolve(new Response(JSON.stringify({ok:true,result:{at:Date.now()}}),{headers:{'Content-Type':'application/json'}}));throw Error('Read-only tour blocked write');}return original(url,opts)};`);
fs.writeFileSync(preload,`const cp=require('node:child_process');for(const k of ['spawn','exec','execFile','spawnSync','execSync','execFileSync'])cp[k]=()=>{throw Error('Read-only tour blocked process launch')};const fs=require('node:fs'),path=require('node:path'),root=path.resolve(process.env.NEXUS_REVIEW_READONLY);for(const key of ['writeFileSync','appendFileSync','mkdirSync','unlinkSync','rmSync','renameSync']){const original=fs[key];fs[key]=function(file,...args){const target=path.resolve(file);if(target!==root&&!target.startsWith(root+path.sep))throw Error('Read-only tour blocked filesystem write');if(key==='renameSync'&&!path.resolve(args[0]).startsWith(root+path.sep))throw Error('Read-only tour blocked rename');return original.call(this,file,...args);};}`);
const env={...process.env,NEXUS_REVIEW_READONLY:root,NEXUS_PORT:'4790',NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_TEST_TERMINALS:'1',NEXUS_CLAUDE_DIR:path.join(os.homedir(),'.claude'),NEXUS_CODEX_DIR:path.join(os.homedir(),'.codex'),NEXUS_COPILOT_DIR:path.join(os.homedir(),'.copilot'),CLAUDE_CONFIG_DIR:path.join(root,'claude-config'),NEXUS_CONFIG_FILE:path.join(root,'config.json'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_UPLOAD_DIR:path.join(root,'uploads'),LOCALAPPDATA:path.join(root,'local')};
const server=spawn(process.execPath,['--require',preload,'server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});process.on('exit',()=>server.kill());
try{
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Read-only server timeout')),20000);server.stdout.on('data',d=>{if(String(d).includes('4790/')){clearTimeout(timer);r();}});server.once('exit',c=>j(Error('Read-only server exited '+c)));server.stderr.on('data',d=>fs.appendFileSync(path.join(root,'server.log'),d));});
 for(const [width,height]of [[1568,773],[1920,1080],[440,956]]){
  const out=path.join(root,String(width));fs.mkdirSync(out);
  const steps=[{viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{js:`setView('overview')`},{shot:'home'}];
  for(const kind of ['claude','astra','copilot'])steps.push({js:`window.reviewSession=state.sessions.find(s=>s.kind==='${kind}');if(reviewSession)select(keyOf(reviewSession));`},{until:`!reviewSession||chatFor().loaded`},{shot:kind});
  steps.push({js:`if(state.sel)await recapDialog(state.byKey.get(state.sel));`},{shot:'catchup'},{js:`nxClosePhoneRecap();setView('spend')`},{shot:'spend'},{js:`if(document.documentElement.scrollWidth>innerWidth)throw Error('Read-only layout overflow');`});
  const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps));
  const browser=spawn(process.execPath,['tools/redesign-browser.mjs','4790',out,file],{env:{...env,NEXUS_TOUR_SOURCE:guard},windowsHide:true,stdio:['ignore','pipe','pipe']});
  browser.stdout.on('data',d=>fs.appendFileSync(path.join(root,'browser.log'),d));browser.stderr.on('data',d=>fs.appendFileSync(path.join(root,'browser.log'),d));
  await new Promise((r,j)=>browser.once('exit',c=>c?j(Error('Read-only tour failed; see ignored logs')):r()));
 }
 fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,viewports:[1568,1920,440],readOnly:true}));
 console.log('PASS read-only real-data tour; captures remain in ignored .local');
}finally{server.kill();}
