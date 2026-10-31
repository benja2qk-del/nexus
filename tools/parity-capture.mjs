import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import os from 'node:os';
const [phase,kind,widthArg,output]=process.argv.slice(2);
const width=Number(widthArg),phone=width===440,height=phone?956:773,ref=kind==='reference';
const out=path.resolve(output,phase,kind,String(width));fs.mkdirSync(out,{recursive:true});
if(!ref){
  const info=JSON.parse(fs.readFileSync(path.join(output,'servers.json'),'utf8'));
  const fixture=info.fixtures.find(f=>f.port===4785),fixtureRoot=fs.realpathSync(fixture.root);
  if(!fixtureRoot.startsWith(fs.realpathSync(os.tmpdir())+path.sep)||!path.basename(fixtureRoot).startsWith('nexus-redesign-'))throw Error('Invalid synthetic fixture');
  for(const session of JSON.parse(fs.readFileSync(path.join(fixtureRoot,'manifest.json'),'utf8'))){
    const rows=fs.readFileSync(session.file,'utf8').trim().split('\n').map(JSON.parse);
    const shift=Date.now()-60000-Date.parse(rows.at(-1).timestamp);
    for(const row of rows)if(row.timestamp)row.timestamp=new Date(Date.parse(row.timestamp)+shift).toISOString();
    fs.writeFileSync(session.file,rows.map(JSON.stringify).join('\n')+'\n');
    const stamp=new Date(Date.now()-session.updatedMinutes*60000);fs.utimesSync(session.file,stamp,stamp);
  }
}
const steps=[{viewport:[width,height],dpr:phone?3:1},{navigate:'/'}];
const js=code=>steps.push({js:code});
const wait=ms=>steps.push({wait:ms});
const until=expression=>steps.push({until:expression});
const clickText=(text)=>js(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})?.click()`);
const esc=()=>js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.activeElement?.blur()`);
if(ref){
  until(`document.querySelector('[aria-label="NEXUS is starting"]')`);wait(700);
}else{until(`document.querySelector('.nx-boot-log')`);wait(700);}
js(fs.readFileSync('tools/parity-measure.js','utf8'));
const common=ref?{canvas:'.nexus-canvas',sidebar:'nav[aria-label="Projects and sessions"]'}:{canvas:'#app',sidebar:'#nxSidebar'};
function shot(name,regions={}){
  wait(450);
  js(`window.parityRegions=${JSON.stringify({...common,...regions})};document.querySelector('nextjs-portal')?.remove();`);
  if(name==='boot')js(`delete parityRegions.sidebar`);
  steps.push({save:{name:name+'.json',expression:'parityMeasure()'}});
  // Freeze at a deterministic phase only for pixel sampling; retain the live animation inventory above.
  js(`window.parityAnimations=document.getAnimations();parityAnimations.forEach(a=>{a.pause();if(a.effect?.getTiming().iterations===Infinity)a.currentTime=2000;else a.finish();})`);
  steps.push({shot:name,settle:0});
  js(`parityAnimations.forEach(a=>{if(a.effect?.getTiming().iterations===Infinity)a.play();})`);
}
shot('boot',{canvas:ref?'[aria-label="NEXUS is starting"]':'#boot'});
if(ref){until(`!document.querySelector('[aria-label="NEXUS is starting"]')`);}
else{
  until(`typeof state!=='undefined'&&state.booted&&state.sessions.length===11`);
  // Freeze the read-only snapshot so periodic refresh cannot erase empty states
  // or change sample content between the paired screenshots.
  js(`await deviceUI.refreshing;refreshData=async()=>null;`);
  const mock=JSON.parse(fs.readFileSync('tools/fixtures/redesign/reference-data.json','utf8'));
  js(`window.parityMock=${JSON.stringify(mock)};
    const preview=sessionPreview,purpose=nxPurpose;
    sessionPreview=s=>parityMock.sessions.find(m=>m.id===s.id)?.sinceLast||preview(s);
    nxPurpose=s=>parityMock.sessions.find(m=>m.id===s.id)?.purpose||purpose(s);
    for(const s of state.sessions){const m=parityMock.sessions.find(m=>m.id===s.id);if(m){s.groupLabel=parityMock.projects.find(p=>p.id===m.projectId).name;s.updated=Date.now()-m.updatedMinutes*60000;}}
    state.usage.astra={week:{pct:18,minutes:10080,resetsAt:Date.now()+598800000}};
    state.usage.copilot={month:{pct:71,resetsAt:Date.now()+432000000},premiumRequests:213};
    render();`);
}
if(ref&&phone){
  clickText('Phone');wait(250);
  // Strip only the demo phone chrome, making its app canvas match the real viewport.
  js(`const frame=document.getElementsByClassName('h-[844px]')[0];frame.style.cssText='position:fixed;inset:0;width:440px;height:956px;border:0;border-radius:0;box-shadow:none';frame.children[0].style.display='none';frame.children[1].style.display='none';frame.lastElementChild.style.display='none';document.body.style.overflow='hidden';`);
  common.canvas='.h-\\[844px\\]';common.dock='nav[aria-label="Main"]';
}
if(!ref&&phone)common.dock='#mobileDock';
function nav(name){
  if(ref){if(phone&&name!=='Wall')js(`[...document.querySelectorAll('nav[aria-label="Main"] button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(name)})).click()`);
    else js(`[...document.querySelectorAll('nav[aria-label="Projects and sessions"] ul[aria-label="Main"] button')].find(b=>b.textContent.startsWith(${JSON.stringify(name)})).click()`);
  }else js(`setView(${JSON.stringify({Home:'overview',Sessions:'sessions',Wall:'wall',Spend:'spend',Settings:'settings'}[name])})`);
  wait(250);
}
nav('Home');shot('home',ref?(phone?{needs:'.h-\\[844px\\] ul.glass',usage:'.h-\\[844px\\] .glass.p-3'}:{needs:'.needs-border',inset:'.needs-border > span:nth-child(3)',working:'[data-vt-id="s-dashboard"]',agent:'[data-vt-id="s-dashboard"] span[class*="text-agent-claude"]'}):(phone?{needs:'.nx-home-section .nx-phone-group',usage:'.nx-phone-usage'}:{needs:'.nx-home-card.needs',inset:'.needs .nx-card-latest',working:'.nx-home-card.working',agent:'.nx-home-card .nx-agent.claude'}));
if(phone)nav('Sessions');
shot('sessions',ref?{row:'[data-session-row][aria-current=page]',search:'#session-search'}:{row:'.nx-row.sel',search:'#search'});
if(ref){js(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('title')?.startsWith('Session dashboard redesign (')||b.getAttribute('aria-label')?.startsWith('Session dashboard redesign.')).click()`);}
else{js(`nx.panel=${!phone};select('claude:s-dashboard')`);until(`chatFor().loaded`);}
wait(400);
shot('session',ref?{header:'header',bubble:'div[class*="bg-elevated/80"]',tools:'div.rounded-md.border.bg-surface',composer:'form:has(textarea)'}:{header:'#focusHead',bubble:'.bubble',tools:'.chat-tools',composer:'#steer'});
if(!ref){js(`document.querySelector('.chat-thinking')?.scrollIntoView({block:'center'});`);}
else js(`[...document.querySelectorAll('button[aria-expanded]')].find(b=>b.textContent.includes('Thought for'))?.scrollIntoView({block:'center'})`);
shot('thinking-tools',ref?{tools:'div.rounded-md.border.bg-surface',thinking:'button:has(.lucide-brain)'}:{tools:'.chat-tools',thinking:'.chat-thinking summary'});
if(ref){js(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('Model: Opus'))?.click()`);}
else js(`nxModelMenu()`);
wait(300);shot('model',ref?{model:'[data-slot=dropdown-menu-content]'}:{model:'#nxModelMenu'});
if(ref)esc();else js('nxCloseModel()');
if(ref){
  js(`document.querySelector('[aria-label="More actions"]').click()`);wait(100);
  js(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('Session settings')).click()`);
}else js('await nxSessionSettings()');
shot('sheet',ref?{sheet:'[aria-label="Session settings"]'}:{sheet:'#nxSessionSettings'});
if(ref){if(phone)js(`document.querySelector('button[aria-label="Close session settings"]').click()`);else esc();}
else js('nxCloseSessionSettings()');
if(ref){js(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Call Session dashboard redesign').click()`);until(`[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Listening'))`);}
else{js(`NexusLiveCall.open=async(key,hooks)=>{hooks.state('listening');return {close(){},setMuted(){},interrupt(){}}};NexusCall.start('claude:s-dashboard');`);wait(300);}
shot('call',ref?{call:phone?'.h-\\[844px\\] div.relative.flex.h-full.flex-col':'.glass.overlay-in'}:{call:'#nxCall'});
if(ref){js(`document.querySelector('[aria-label="End call"]').click()`);wait(100);clickText('Close');wait(150);}
else js('NexusCall.dismiss()');
if(ref&&phone){js(`document.querySelector('[aria-label="Back to sessions"]')?.click()`);nav('Home');}
if(ref){
  js(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('title')?.startsWith('Production deploy checklist (')||b.getAttribute('aria-label')?.startsWith('Production deploy checklist.')).click()`);
}else{js(`select('claude:s-deploy')`);until(`!!document.querySelector('.permission-card')`);}
shot('needs-you',ref?{question:'[aria-label="Question from the agent"]'}:{question:'.permission-card'});
if(ref&&phone){js(`document.querySelector('[aria-label="Back to sessions"]').click()`);}
if(!phone){nav('Wall');shot('wall',ref?{tile:'[data-vt-id="s-deploy"]',latest:'[data-vt-id="s-deploy"] > span:nth-child(3)'}:{tile:'.nx-wall-tile.needs',latest:'.nx-wall-latest.ready'});}
else if(!ref){nav('Wall');shot('wall',{tile:'.nx-wall-tile.needs',latest:'.nx-wall-latest.ready'});}
for(const name of ['Spend','Settings']){nav(name);shot(name.toLowerCase(),ref?{panel:name==='Spend'?'.glass.fade-up':'ul.glass.divide-y'}:{panel:name==='Spend'?'.nx-spend-stats > div':'.nx-device-list'});}
if(!phone||!ref){
  if(ref)js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);else js('nxPalette()');
  shot('palette',ref?{palette:'[role=dialog]',input:'[role=combobox]'}:{palette:'#modalCard',input:'#nxCommandQuery'});
  if(ref)esc();else js('closeModal()');
}
nav('Home');
if(ref){clickText('Empty');}else js(`state.sessions=[];state.byKey=new Map();render()`);
shot('empty',ref?{empty:'section[aria-label="All quiet"]'}:{empty:'.nx-quiet'});
if(ref&&phone){
  // These views are not exposed by v0's phone tabs. Capture its responsive
  // desktop components at phone width, with the desktop-only sidebar hidden.
  clickText('Live');clickText('Desktop');wait(250);
  js(`document.querySelector('nav[aria-label="Projects and sessions"]').style.display='none'`);
  common.canvas='.nexus-canvas';delete common.dock;
  nav('Wall');shot('wall',{tile:'[data-vt-id="s-deploy"]',latest:'[data-vt-id="s-deploy"] > span:nth-child(3)'});
  js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);
  shot('palette',{palette:'[role=dialog]',input:'[role=combobox]'});
}
const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));
const child=spawn(process.execPath,['tools/redesign-browser.mjs',ref?'4793':process.env.NEXUS_PARITY_PORT||'4785',out,file],{windowsHide:true,stdio:'inherit'});
await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',c=>c?reject(Error('Capture failed '+kind+' '+width)):resolve());});
console.log('PASS capture '+phase+' '+kind+' '+width);
