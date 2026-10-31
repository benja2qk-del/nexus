// Synthetic review evidence only. No CLI/model, microphone or owner-state access.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./redesign-fixture.cjs');
const phase=process.argv[2]||'after';
if(!['before','after'].includes(phase))throw Error('Choose before or after');
await new Promise((r,j)=>{const p=net.createServer();p.once('error',j);p.listen(4791,'127.0.0.1',()=>p.close(r));});
const {root,env}=fixture({review:true}),guard=path.join(root,'guard.js');
fs.writeFileSync(guard,`const originalFetch=window.fetch.bind(window);window.fetch=(url,opts={})=>{if(opts.method&&opts.method!=='GET'){const p=new URL(url,location.href).pathname;if(p==='/api/action'&&JSON.parse(opts.body||'{}').action==='viewed')return originalFetch(url,opts);throw Error('Review tour blocked a write');}return originalFetch(url,opts)};`);
let serverRoot=process.cwd();
if(phase==='before'){
 serverRoot=path.join(root,'baseline');fs.mkdirSync(serverRoot);
 const archive=path.join(root,'baseline.tar');execFileSync('git',['archive','--format=tar','--output='+archive,'c58d170'],{windowsHide:true});
 execFileSync('tar',['-xf',archive,'-C',serverRoot],{windowsHide:true});
 fs.symlinkSync(path.resolve('node_modules'),path.join(serverRoot,'node_modules'),'junction');
}
const server=spawn(process.execPath,['--require','./tools/redesign-preload.cjs','server.js'],{cwd:serverRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
process.on('exit',()=>server.kill());
try{
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Server timeout')),15000);server.stdout.on('data',d=>{if(String(d).includes('4791/')){clearTimeout(timer);r();}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>j(Error('Server exited '+c)));});
 for(const [width,height]of [[1568,773],[1920,1080],[440,956]]){
  const out=path.resolve('docs/shots/review',phase,String(width));fs.mkdirSync(out,{recursive:true});
  const steps=[{viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.some(s=>s.kind==='copilot')`},{wait:800},{js:`setView('overview')`},{shot:'home'},
   {js:`nx.project=state.sessions.find(s=>s.kind==='copilot').group;renderApsis()`},{shot:'home-one-working'},{js:`nx.project=null;renderApsis();document.querySelector('#overview').scrollTop=document.querySelector('#overview').scrollHeight`},{shot:'recent'},
   {js:`document.querySelector('#overview').scrollTop=0;setView('wall')`},{shot:'wall'},
   {js:`nx.panel=${width>700};select('claude:s-dashboard')`},{until:`chatFor().loaded&&!!document.querySelector('#chatMessages .ev')`},{shot:'session'},
   {js:`document.querySelector('#chatView').scrollTop=0`},{shot:'session-top'},
   {js:`select('astra:s-voice')`},{until:`chatFor().loaded`},{shot:'astra'},
   {js:`select('copilot:11111111-1111-4111-8111-111111111111')`},{until:`chatFor().loaded`},{shot:'copilot'},
   {js:`await recapDialog(state.byKey.get(state.sel))`},{shot:'catchup'},
   {js:`nxClosePhoneRecap();nx.panelMode='details';select('claude:s-deploy')`},{until:`!!document.querySelector('.permission-card')`},{shot:'question'},
   {js:`nxPalette()`},{shot:'palette'},{js:`closeModal();setView('spend')`},{shot:'spend'},
   {js:`setView('overview');window.reviewAudio=NexusVoice.callAudio;NexusVoice.callAudio=()=>({unlock:()=>new Promise(()=>{}),close(){}});await NexusCall.start('copilot:11111111-1111-4111-8111-111111111111')`},{until:`!!document.querySelector('#nxCall')`},{shot:'call'},
   {js:`await NexusCall.end();NexusCall.dismiss();NexusVoice.callAudio=window.reviewAudio;setView('overview');if(document.documentElement.scrollWidth>innerWidth)throw Error('Horizontal overflow');`}
  ];
  if(phase==='after')steps.push({js:fs.readFileSync('tools/review-browser-checks.js','utf8')},{shot:'home-checked'},
   {js:`select('claude:s-lobby');await loadChat(state.sel,true);window.reviewSpendSession=state.byKey.get(state.sel);window.reviewSpend=reviewSpendSession.insights;reviewSpendSession.insights={spend:{costUSD:4.82,total:1840000,measured:true}};nx.panel=true;renderHead();if(!document.querySelector('#nxDetails').textContent.includes('$4.82 cost / 1.84M tokens'))throw Error('Known cost/token display');`},{shot:'details-known'},
   {js:`reviewSpendSession.insights=reviewSpend;setView('overview')`});
  const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));
  const browser=spawn(process.execPath,['tools/redesign-browser.mjs','4791',out,file],{env:{...env,NEXUS_CALL_TOUR:'1',NEXUS_TOUR_SOURCE:guard},windowsHide:true,stdio:'inherit'});
  await new Promise((r,j)=>browser.once('exit',c=>c?j(Error('Review tour failed '+width)):r()));
 }
}finally{server.kill();}
