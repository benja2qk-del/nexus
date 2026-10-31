import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./redesign-fixture.cjs'),config=require('../config.json');
const sizes=[[1568,773],[1920,1080],[390,844]].filter(([w])=>!process.argv[2]||w===Number(process.argv[2]));
for(const [width,height] of sizes){
await new Promise((r,j)=>{const p=net.createServer();p.once('error',j);p.listen(4791,'127.0.0.1',()=>p.close(r));});
const {root,env}=fixture();env.NEXUS_ROUND2='1';env.NEXUS_ROUND2_AUDIO='1';
const guard=path.join(root,'browser.js');fs.writeFileSync(guard,`window.tourActions=[];const realFetch=fetch.bind(window);window.fetch=(url,options={})=>{const route=new URL(url,location.href).pathname;if(route==='/api/action'){const b=JSON.parse(options.body);tourActions.push(b);if(b.key&&!/^(claude|astra):s-/.test(b.key))throw Error('Nonfixture action');}return realFetch(url,options);};speechSynthesis.cancel=()=>{};speechSynthesis.speak=u=>{if(u.text){setTimeout(()=>u.onstart?.(),10);setTimeout(()=>u.onend?.(),1200);}};`);
const server=spawn(process.execPath,['--require','./tools/redesign-round2-preload.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});process.on('exit',()=>server.kill());
try{
 await new Promise((r,j)=>{server.stdout.on('data',d=>{if(String(d).includes('4791/'))r();});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>j(Error('Server exited '+c)));});
 const base='http://127.0.0.1:4791',identity={'X-Forwarded-Host':config.remoteHost,'Tailscale-User-Login':config.remoteUser};
 assert.equal((await fetch(base+'/api/pair/status?id=unknown',{headers:identity})).status,401);
 const pair=await(await fetch(base+'/api/pair/new',{method:'POST',headers:{'X-Nexus':'1'}})).json();
 const paired=await fetch(base+'/api/pair',{method:'POST',headers:{...identity,'X-Nexus':'1','Content-Type':'application/json'},body:JSON.stringify({code:pair.code,name:'Guard fixture'})});assert.equal(paired.status,200);
 const cookie=paired.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/api/pair/status?id='+pair.pairingId,{headers:{...identity,Cookie:cookie}})).status,403);
 assert.equal((await fetch(base+'/api/pair/new',{method:'POST',headers:{...identity,Cookie:cookie,'X-Nexus':'1'}})).status,403);
  const out=path.resolve('docs/shots/redesign/round2',String(width));fs.mkdirSync(out,{recursive:true});
  const steps=[{viewport:[width,height]},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length===11`},{js:`nx.panel=${width>700};select('claude:s-dashboard');`},{until:`chatFor().loaded`},{shot:'session'},
   {click:'#sessionRecap'},{until:`!!document.querySelector('[data-recap-summary]')`},{shot:'catchup'},
   {js:`document.querySelector('[data-recap-summary]').click();document.querySelector('[data-recap-summary]')?.click();`},{until:`!!document.querySelector('.nx-summary-loading')`},{shot:'summary-loading',settle:0},{until:`!!document.querySelector('.nx-summary-bullets')`},{shot:'summary-done'},
   {js:`const h=document.querySelector('.nx-recap-body');h.scrollTop=h.scrollHeight;`},{shot:'summary-footer'},
   {js:`if(!document.querySelector('.recap-cost').textContent)throw Error('Missing summary cost');renderHead();if(!document.querySelector('.nx-summary-bullets'))throw Error('Live refresh erased recap');recapUI.results.delete(state.sel);await recapDialog(state.byKey.get(state.sel));window.summaryFetch=window.fetch;window.fetch=(url,opts={})=>JSON.parse(opts.body||'{}').action==='summarize-recap'?Promise.reject(Error('Could not reach Haiku. Check the connection and try again.')):summaryFetch(url,opts);document.querySelector('[data-recap-summary]').click();`},{until:`!!document.querySelector('.nx-summary-error')`},{shot:'summary-error'},
   {js:`window.fetch=summaryFetch;document.querySelector('[data-recap-summary]').click();`},{until:`!!document.querySelector('.nx-summary-bullets')`},
   {js:`if(innerWidth<=700)nxClosePhoneRecap();await nxSessionSettings();`},{until:`!!document.querySelector('#nxSessionSettings')`},{shot:'session-settings'},
   {click:'[data-session-confirm]'},{shot:'close-confirm'},{click:'[data-session-keep]'},
   {js:`const name=document.querySelector('#nxSessionName');name.value='Session dashboard redesign';name.dispatchEvent(new Event('blur'));nxCloseSessionSettings();nxOpenRaw();`},{until:`!!document.querySelector('#nxRaw .xterm')`},{wait:500},{shot:'raw'},
   {js:`if(!document.querySelector('#chatView').getClientRects().length)throw Error('Raw drawer replaced conversation');document.querySelector('[data-raw-key="1"]').click();document.querySelector('[data-raw-key=enter]').click();document.querySelector('[data-raw-key=esc]').click();nxCloseRaw();`},
   {js:`for(const t of state.terms.filter(t=>t.sessionKey==='claude:s-lobby'&&!t.exited))await postNexus('/api/action',{action:'term-close',term:t.id});await refresh();select('claude:s-lobby');`},{until:`chatFor().loaded`},
   {js:`document.querySelector('#steerIn').value='Round two saved message';document.querySelector('#steerIn').dispatchEvent(new Event('input',{bubbles:true}));window.sendTask=sendChat();void 0;`},{until:`chatFor().pending.some(p=>p.status==='starting')`},{shot:'starting',settle:0},
   {until:`chatFor().pending.some(p=>p.status==='confirmed')`},{shot:'delivered'},
   {js:`document.querySelector('#steerIn').value='Round two sending message';window.sendingTask=sendChat();void 0;`},{until:`chatFor().pending.at(-1).status==='pending'`},{shot:'sending',settle:0},{until:`chatFor().pending.at(-1).status==='confirmed'`},
   {js:`await nxSessionSettings();const name=document.querySelector('#nxSessionName');name.value='Round two renamed ${width}';name.dispatchEvent(new Event('blur'));`},{until:`state.byKey.get('claude:s-lobby').title==='Round two renamed ${width}'`},
   {js:`if(!document.querySelector('#nxSessionName'))throw Error('Rename closed settings');document.querySelector('[data-session-model="claude-haiku-5-5"]').click();`},{until:`document.querySelector('.nx-settings-result')?.textContent.includes('confirmed')`},
   {js:`nxCloseSessionSettings();select('claude:s-physics');`},{until:`chatFor().loaded`},
   {js:`document.querySelector('#steerIn').value='Round two queued message';document.querySelector('#steerIn').dispatchEvent(new Event('input',{bubbles:true}));window.queueTask=sendChat();void 0;`},{until:`chatFor().pending.some(p=>p.status==='queued')`},{shot:'queued'},
   {until:`chatFor().pending.at(-1).status==='confirmed'`},
   {js:`window.fetchBeforeFailure=window.fetch;window.fetch=(url,opts={})=>JSON.parse(opts.body||'{}').action==='term-send'?Promise.resolve(new Response(JSON.stringify({error:'The connection dropped. Your text is kept.'}),{status:503,headers:{'Content-Type':'application/json'}})):fetchBeforeFailure(url,opts);document.querySelector('#steerIn').value='Keep this message for retry.';await sendChat();`},{shot:'failed'},
   {js:`if(!document.querySelector('#steerIn').value.includes('Keep this'))throw Error('Failed draft lost');window.fetch=fetchBeforeFailure;await sendChat(chatFor().pending.at(-1).id);if(chatFor().pending.at(-1).status!=='confirmed')throw Error('Retry not delivered');await nxSessionSettings();`},{click:'[data-session-confirm]'},{click:'[data-session-close]'},
   {until:`!document.querySelector('#nxSessionSettings') && !!document.querySelector('.nx-session-ended')`},{shot:'ended'},
   {click:'[data-chat-resume]'},{until:`!!selTerm()&&!selTerm().exited&&!chatFor().resuming`},{js:`if(document.querySelector('.nx-session-ended'))throw Error('Resume banner did not clear');setView('settings');await nxCreatePair();`},{until:`!!document.querySelector('.nx-qr svg')`},{shot:'pair-waiting'},
   {js:`nx.pair.expiresAt=Date.now()-1;nxPairExpiry();`},{shot:'pair-expired'},
   {js:`await nxCreatePair();await nexusRequest('/api/pair',{method:'POST',headers:{'Content-Type':'application/json','X-Nexus':'1','X-Forwarded-Host':${JSON.stringify(config.remoteHost)},'Tailscale-User-Login':${JSON.stringify(config.remoteUser)}},body:JSON.stringify({code:nx.pair.code,name:'Fixture phone ${width}'})});await nxPollPair();if(nx.pair.state!=='paired')throw Error('Pair receipt missing');`},{shot:'pair-paired'},
   {js:`document.querySelector('#nxSetting-voice').scrollIntoView();`},{shot:'voice-idle'},
   {click:'[data-nx-setting=voice]'},{until:`NexusVoice.checks.mic?.phase==='running'`},{js:`const panel=document.querySelector('#talkPanel');nxRenderSettings();if(document.querySelector('#talkPanel')!==panel)throw Error('Settings refresh lost the active voice check');`},{shot:'voice-testing'},
   {until:`NexusVoice.status==='checked'`},{shot:'voice-pass'},
   {js:`if(!Object.values(NexusVoice.checks).every(c=>c.phase==='pass'&&c.ms>0))throw Error('Voice timing or pass missing');NexusVoice.end();window.originalMedia=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Blocked','NotAllowedError'));NexusVoice.check(true);`},{until:`NexusVoice.checks.mic?.phase==='fail'`},{shot:'voice-result'},
   {js:`NexusVoice.end();navigator.mediaDevices.getUserMedia=originalMedia;if(!document.querySelector('.nx-voice-failure')?.textContent.includes('Fix:'))throw Error('Missing voice fix');if(document.documentElement.scrollWidth>innerWidth)throw Error('Horizontal overflow');'PASS round two interactions ${width}';`},
   {js:`select('astra:s-voice');`},{until:`chatFor().loaded`},{js:`await nxSessionSettings();document.querySelector('#nxSessionName').value='Astra renamed ${width}';document.querySelector('#nxSessionName').dispatchEvent(new Event('blur'));`},{until:`state.byKey.get('astra:s-voice').title==='Astra renamed ${width}'`},{js:`nxCloseSessionSettings();`}
  ];
  if(width===390)steps.push(
   {js:`setView('settings');await nxCreatePair();sessionStorage.setItem('fixturePairCode',nx.pair.code);location.href='/pair.html';void 0;`},{until:`!!document.querySelector('#code')`},{shot:'pair-entry'},
   {js:`window.pairFetch=window.fetch;window.fetch=(url,opts={})=>{if(url==='/api/pair')opts.headers={...opts.headers,'X-Forwarded-Host':${JSON.stringify(config.remoteHost)},'Tailscale-User-Login':${JSON.stringify(config.remoteUser)}};return pairFetch(url,opts);};document.querySelector('#code').value='ZZZZ-ZZZZ';document.querySelector('#pair').requestSubmit();`},{until:`document.querySelector('#code').getAttribute('aria-invalid')==='true'`},{shot:'pair-wrong'},
   {js:`document.querySelector('#code').value=sessionStorage.getItem('fixturePairCode');document.querySelector('#pair').requestSubmit();`},{until:`!document.querySelector('#pairSuccess').hidden`},{shot:'pair-success'},
   {viewport:[320,700]},{js:`if(document.documentElement.scrollWidth>innerWidth)throw Error('320px pairing overflow');`},{navigate:'/'},{until:`typeof state!=='undefined'&&state.booted&&state.sessions.length>0`},{js:`select('claude:s-dashboard');`},{until:`chatFor().loaded`},{js:`await recapDialog(state.byKey.get(state.sel));await nxSessionSettings();if(document.querySelector('#nxSessionSettings').scrollWidth>innerWidth)throw Error('320px settings overflow');nxCloseSessionSettings();nxOpenRaw();if(document.querySelector('#nxRaw').scrollWidth>innerWidth)throw Error('320px terminal overflow');nxCloseRaw();`},
   {viewport:[430,932]},{js:`setView('settings');if(document.documentElement.scrollWidth>innerWidth)throw Error('430px settings overflow');`},
   {media:{features:[{name:'prefers-reduced-motion',value:'reduce'}]}},{js:`if(getComputedStyle(document.querySelector('.nx-spinner')||document.body).animationName==='nx-turn')throw Error('Reduced motion spinner');`}
  );
  const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));
  const browser=spawn(process.execPath,['tools/redesign-browser.mjs','4791',out,file],{env:{...env,NEXUS_TOUR_SOURCE:guard},windowsHide:true,stdio:'inherit'});await new Promise((r,j)=>browser.once('exit',c=>c?j(Error('Round two tour failed '+width)):r()));
 assert.equal(fs.readFileSync(path.join(root,'summary-calls.jsonl'),'utf8').trim().split('\n').length,2,'summary requires one request per click, including Retry');
 const records=fs.readFileSync(path.join(root,'codex','session_index.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(records.some(r=>r.thread_name==='Astra renamed '+width));
 console.log('PASS PC-only pairing receipts and issuance; single summary requests; persisted native titles. Fixture root: '+root);
}finally{await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r);server.kill();});}
}
