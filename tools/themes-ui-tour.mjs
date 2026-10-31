import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./themes-ui-fixture.cjs');
const only=process.argv[2];
const run=(file,args,env)=>new Promise((r,j)=>{const p=spawn(process.execPath,[file,...args],{env,windowsHide:true,stdio:'inherit'});p.once('exit',c=>c?j(Error('Tour failed '+c)):r());});
for(const single of [false,true]){
 if(only&&only!==(single?'single':'mixed'))continue;
 await new Promise((r,j)=>{const p=net.createServer();p.once('error',j);p.listen(4791,'127.0.0.1',()=>p.close(r));});
 const f=fixture(single),env=f.env,out=path.resolve('docs/shots/themes',single?'single':'mixed');fs.mkdirSync(out,{recursive:true});
 const server=spawn(process.execPath,['--require','./tools/themes-ui-preload.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Fixture startup timeout')),20000);server.stdout.on('data',d=>{if(String(d).includes('4791/')){clearTimeout(timer);r();}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>{clearTimeout(timer);j(Error('Fixture exited '+c));});});
  const base='http://127.0.0.1:4791',headers={'X-Nexus':'1','Content-Type':'application/json'},request=async(route,body,h=headers)=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});return {status:response.status,...await response.json()};};
  const cp='copilot:11111111-1111-4111-8111-111111111111',working='copilot:33333333-3333-4333-8333-333333333333';
  let data=await request('/api/sessions');assert(data.sessions.length>=3);assert.equal((await request('/api/action',{action:'session-delete',key:cp},{})).status,403);assert.equal((await request('/api/action',{action:'session-delete',key:working})).status,400);
  const remote={...headers,'X-Forwarded-Host':'nexus.fixture.test','Tailscale-User-Login':'owner@example.test'};assert.equal((await request('/api/action',{action:'session-delete',key:cp},remote)).status,401);
  const pair=await request('/api/pair/new',{}),paired=await fetch(base+'/api/pair',{method:'POST',headers:remote,body:JSON.stringify({code:pair.code,name:'Theme test phone'})}),phone={...remote,Cookie:paired.headers.get('set-cookie').split(';')[0],Origin:'https://nexus.fixture.test'};
  const pending=await request('/api/action',{action:'session-delete',key:cp},phone);assert.equal(pending.result.state,'pending');assert.equal((await request('/api/action',{action:'session-delete-undo',id:pending.result.id},phone)).result.state,'cancelled');assert(!fs.existsSync(path.join(f.root,'recycle-stub.jsonl')));
  const options=await request('/api/action',{action:'copilot-options',key:cp,options:{mode:'plan',effort:'high',context:'long_context',maxAiCredits:3}},phone);assert(options.result.deferred);assert.equal((await request('/api/sessions')).sessions.find(s=>s.kind+':'+s.id===cp).copilotNextOptions.effort,'high');
  assert(!fs.existsSync(path.join(f.root,'summary-calls.jsonl')),'no automatic summary');
  for(const [width,height]of [[1568,773],[440,956]]){
   const phoneView=width===440,steps=[{viewport:[width,height]},{navigate:'/'},{until:`!!document.querySelector('.nx-boot-crystal')`},{wait:1500},{shot:width+'-boot'},{until:`typeof state!=='undefined'&&state.booted&&nxThemes.loaded&&state.sessions.length>0`},{wait:900}];
   const check=code=>steps.push({js:code}),shot=name=>steps.push({wait:250},{js:`(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())if(node.nodeValue.includes(${JSON.stringify(f.root)}))node.nodeValue=node.nodeValue.replaceAll(${JSON.stringify(f.root)},'Fixture');})()`},{shot:width+'-'+name});
   check(`window.assert=(v,m)=>{if(!v)throw Error(m)};window.nxTourVisible=e=>!!e&&!!e.getClientRects().length;setView('overview');`);shot('home');
   check(`assert(!document.querySelector('.nx-project-map'),'old projects map');assert(!document.body.innerText.includes('Home PC'),'demo edition');assert(!document.body.innerText.includes('Work PC'),'demo edition');assert(document.querySelectorAll('${phoneView?'.nx-theme-tile':'.nx-orbit-node'}').length>0,'theme strip on a phone, orbit on a PC');`);
   check(`setView('sessions');nxThemes.phoneAt=null;renderCards();`);shot('themes');
   if(!phoneView)check(`assert(Math.round(document.querySelector('#nxSidebar').getBoundingClientRect().width)===520,'two-column sidebar');assert(Math.round(document.querySelector('.nx-theme-rail').getBoundingClientRect().width)===220,'220 theme rail');`);
   check(`document.querySelector('[data-theme-pick=release]').click()`);steps.push({until:`nxThemes.selected==='release'`});shot('sessions');
   check(`assert(document.querySelector('.nx-session-row.child'),'nested fork');document.querySelector('#search').value='release';document.querySelector('#search').dispatchEvent(new Event('input'));assert(nxThemes.hits[0].kind==='theme','themes first');`);shot('finder');
   check(`document.querySelector('#search').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));assert(nxThemes.scope==='release','Tab drill');document.querySelector('#search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));nxOpenTheme('release');`);shot('theme');
   steps.push({click:'[data-theme-catchup=release]'},{until:`!!nxThemes.summaries?.release`});shot('summary');
   steps.push({click:'[data-theme-new=release]'},{until:`!!document.querySelector('#pickedPath')`});check(`assert(document.querySelector('#pickedPath').textContent.endsWith('release'),'theme main folder');document.querySelectorAll('#pickedPath,.folder-option small').forEach(e=>e.textContent='Fixture project folder');`);shot('new');check(`closeModal();select('${cp}');`);steps.push({until:`!!document.querySelector('#nxCopilotBar')&&chatFor().loaded`});shot('copilot');
   check(`assert(!document.querySelector('#focusHead [data-call-start]'),'duplicate header Call');assert(nxTourVisible(document.querySelector('[data-steer=talk]')),'composer Call');assert(document.querySelector('[data-copilot-mode=plan]').getAttribute('aria-pressed')==='true','saved mode');`);
   steps.push({click:'[data-copilot-options]'},{until:`!!document.querySelector('#nxCP-effort')`});shot('copilot-options');check(`closeModal();select('${working}');`);steps.push({until:`!!document.querySelector('#nxCopilotFleet')`});check(`document.querySelector('#nxCopilotFleet details').open=true;assert(document.querySelector('#nxCopilotFleet').textContent.includes('1/2'),'fleet completion');`);shot('fleet');
   if(single)check(`assert(![...document.querySelectorAll('.nx-agent,.nx-phone-agent,.nx-live-agent-label,.nx-agent-choice')].some(nxTourVisible),'single-agent labels hidden');assert(!document.querySelector('#steerIn').placeholder.includes('Copilot'),'single-agent composer label');`);
   else {check(`select('claude:s-dashboard');`);steps.push({until:`!document.querySelector('#nxCopilotBar')`});check(`assert(!document.querySelector('#nxCopilotFleet'),'Copilot fleet leaked');`);shot('claude');}
   check(`setView('sessions');nxThemes.phoneAt=nxThemes.selected='release';renderCards();`);
   check(`window.row=document.querySelector('[data-session-key="${cp}"]');row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert(document.querySelector('#nxRowMenu'),'right-click menu');`);shot('context-menu');
   check(`nxCloseContext();window.row=document.querySelector('[data-session-key="${cp}"]');row.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',button:0,pointerId:7,clientX:80,clientY:200,bubbles:true}));row.dispatchEvent(new PointerEvent('pointermove',{pointerType:'touch',pointerId:7,clientX:80,clientY:212,bubbles:true}));`);steps.push({wait:500});check(`assert(!document.querySelector('#nxRowMenu'),'scroll fired hold');row.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',pointerId:7,bubbles:true}));row.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',button:0,pointerId:8,clientX:80,clientY:200,bubbles:true}));`);steps.push({wait:500});check(`assert(document.querySelector('#nxRowMenu'),'450ms hold');row.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',pointerId:8,bubbles:true}));`);shot('long-press');
   steps.push({js:`[...document.querySelectorAll('#nxRowMenu [role=menuitem]')].find(b=>b.textContent.trim()==='DeleteRecycle Bin').click()`},{until:`!!document.querySelector('[data-delete-confirm]')`});shot('delete');steps.push({click:'[data-delete-confirm]'},{until:`!!document.querySelector('.nx-undo-toast')`});shot('delete-undo');steps.push({click:'.nx-undo-toast button'},{until:`!document.querySelector('.nx-undo-toast')`});
   check(`await nxMoveSessions(['${cp}'],'research');assert(state.byKey.get('${cp}').theme.id==='research','move');select('${cp}');assert(document.querySelector('.nx-undo-toast'),'Undo survives navigation');`);steps.push({click:'.nx-undo-toast button'},{until:`state.byKey.get('${cp}').theme.id==='release'`});
   check(`setView('sessions');nxThemes.selected=nxThemes.phoneAt='release';renderCards();window.drag=new DataTransfer();document.querySelector('[data-session-key="${cp}"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:drag}));document.querySelector('[data-theme-drop=research]')?.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:drag}));`);
   if(!phoneView){steps.push({until:`state.byKey.get('${cp}').theme.id==='research'`},{click:'.nx-undo-toast button'},{until:`state.byKey.get('${cp}').theme.id==='release'`});}
   check(`document.querySelector('[data-session-key="${cp}"] [data-k]').dispatchEvent(new MouseEvent('click',{ctrlKey:true,bubbles:true}));assert(nxThemes.selection.has('${cp}'),'modifier selection');nxThemes.selection.clear();renderCards();document.querySelector('[data-session-key="${cp}"] [data-k]').click();assert(state.view==='focus','normal tap opens');setView('sessions');`);
   if(phoneView){steps.push({click:'#mobileDock [data-nav=sessions]'});check(`assert(nxThemes.phoneAt===null,'Sessions tab must start at themes');`);}
   check(`setView('spend');`);shot('spend');check(`assert(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');`);
   steps.push({media:{features:[{name:'prefers-reduced-motion',value:'reduce'}]}});check(`setView('sessions');assert(!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity),'reduced motion loops');`);shot('reduced-motion');
   const file=path.join(out,width+'-steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));await run('tools/redesign-browser.mjs',['4791',out,file],env);
  }
  const summary=fs.readFileSync(path.join(f.root,'summary-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(summary.every(r=>r.keys.length>=2),'one summary combines sessions');assert(!fs.existsSync(path.join(f.root,'recycle-stub.jsonl')),'all tour deletions undone');
  const deletion=await request('/api/action',{action:'session-delete',key:cp},phone);await new Promise(r=>setTimeout(r,6200));assert.equal((await request('/api/action',{action:'session-delete-status',id:deletion.result.id},phone)).result.state,'recycled');assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'recycle-stub.jsonl'),'utf8').trim())[0].directory,true);assert(fs.existsSync(path.join(f.root,'copilot/session-state',cp.split(':')[1],'events.jsonl')),'stub never deletes fixture files');
  // New-in-theme uses real action/assignment code, while every PTY is a stub.
  const cwd=path.join(f.root,'work','release');
  assert.equal((await request('/api/action',{action:'term-new-copilot',cwd,themeId:'missing'})).status,400);
  for(const kind of single?['copilot']:['claude','astra','copilot']){
   const action={claude:'term-new',astra:'term-new-astra',copilot:'term-new-copilot'}[kind],created=await request('/api/action',{action,cwd,themeId:'release',copilotOptions:{mode:'autopilot',effort:'high',context:'long_context',maxAiCredits:3}});assert.equal(created.status,200,JSON.stringify(created));
   if(kind==='astra')fs.writeFileSync(path.join(f.root,'codex','sessions','rollout-theme-created.jsonl'),JSON.stringify({type:'session_meta',timestamp:new Date().toISOString(),payload:{id:'theme-created',cwd}})+'\n');
   const fresh=await request('/api/sessions'),term=fresh.terms.find(t=>t.id===created.result.term);assert(term.sessionKey,'new session has identity');const saved=JSON.parse(fs.readFileSync(env.NEXUS_THEMES_FILE));assert.equal(saved.assignments[term.sessionKey].themeId,'release');
   if(kind==='copilot'){const launch=JSON.parse(fs.readFileSync(path.join(f.root,'spawns.jsonl'),'utf8').trim().split('\n').at(-1));assert(launch.args.includes('--mode')&&launch.args.includes('autopilot')&&launch.args.includes('--max-ai-credits'));}
   await request('/api/action',{action:'term-close',term:term.id});
  }
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({install:single?'copilot-only':'mixed',viewports:[[1568,773],[440,956]],pairedPhone:true,realModelCalls:0,recycleStubOnly:true,checks:'finder, theme page, summary, new session, Copilot controls/fleet, single labels, context/hold/scroll, six-second deletion/undo, move/undo, responsive/reduced motion'},null,2));
  console.log('PASS '+(single?'single':'mixed')+' fixture HTTP and desktop/phone tours');
 }finally{server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}
}
