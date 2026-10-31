// Fixture-only visual comparisons and idle main-thread measurements. Owns only privateServer's 4790 child.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const stage = process.argv.includes('--before') ? 'before' : 'after';
if(stage==='before')assert.equal(execFileSync('git',['diff','82d101c','--','public'],{encoding:'utf8',windowsHide:true}).trim(),'','Before captures require the unmodified master 82d101c public files');
const gpu=process.argv.includes('--gpu');
const out = 'docs/shots/home-polish';
fs.mkdirSync(out, { recursive: true });
const fixture = String.raw`(()=>{
 const now=Date.now(), H=3600e3;
 window.themeCatalog=[
  {id:'hfs',name:'Guatemala HFS',color:'#91afba',purpose:'Map household survey results and prepare the next fieldwork review.'},
  {id:'nexus',name:'NEXUS',color:'#b4ad97',purpose:'A calmer place to follow work across your agents.'},
  {id:'field',name:'Fieldwork',color:'#9db6ad',purpose:'Prepare the interview guide and coordinate the next round.'},
  {id:'notes',name:'Research notes',color:'#b5a2b4',purpose:'Questions and evidence to return to.'},
  {id:'personal',name:'Personal',color:'#bba29c',purpose:'Small projects, collected in one place.'}
 ];
 const s=(id,title,theme,age,extra={})=>({kind:'claude',id,title,cwd:'C:\\Work\\'+theme,group:'Work',groupLabel:'Work',status:'done',runState:'complete',size:10,updated:now-age,theme:{...themeCatalog.find(t=>t.id===theme),source:'owner'},...extra});
 window.fixtureSessions=[
  s('map','Map household survey coverage','hfs',30000,{status:'busy',runState:'active',live:true,latestContext:'Comparing coverage across 22 departments.',lastPrompt:'Map household survey coverage'}),
  s('review','Choose the fieldwork sample','hfs',120000,{needsInput:true,lastText:'Use the balanced sample of 240 households, or keep the larger sample of 320?',lastPrompt:'Prepare the sample options'}),
  s('install','Install NEXUS and create shortcut','nexus',10*60000,{lastText:'NEXUS is installed. The shortcut is ready on your desktop.'}),
  s('guide','Draft the interview guide','field',H,{lastText:'The guide now has six sections, with prompts for follow-up questions.'}),
  s('sources','Organize research sources','notes',3*H,{lastText:'Sources grouped by topic, with three questions for the next review.'}),
  s('plan','Plan the next week','personal',4*H,{lastText:'The plan is ready for Monday.'}),
  s('clean','Clean household survey export','hfs',6*H,{lastText:'Duplicate rows removed; all department codes match.'}),
  s('archive','Review previous fieldwork','field',90*H,{lastText:'Notes saved for the next visit.'})
 ];
 const json=body=>new Response(JSON.stringify(body)),nativeFetch=window.fetch;
 window.fetch=async(url,options)=>{
  url=String(url);
  if(url.startsWith('/api/sessions'))return json({now:Date.now(),rev:'fixture',home:'C:\\Users\\fixture',sessions:fixtureSessions,terms:[],usage:{},briefing:null});
  if(url.startsWith('/api/themes'))return json({themes:themeCatalog});
  if(url.startsWith('/api/'))return json({events:[],status:'Waiting for you',queue:null});
  return nativeFetch(url,options);
 };
})();
`;
const server=await privateServer();process.env.NEXUS_PORT='4790';
const report={stage,fixtureOnly:true,gpuEnabled:gpu,logicalProcessors:os.availableParallelism(),sizes:[],performance:[]};
async function measure(b,label){
 await b.cmd('Performance.enable');
 const processes=b.processInfo;
 const read=async()=>Object.fromEntries((await b.cmd('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const p=await processes(),a=await read();await sleep(8000);const z=await read(),q=await processes(),seconds=z.Timestamp-a.Timestamp;
 const cpu=q.map(end=>({type:end.type,cpuMsPerSecond:1000*(end.cpuTime-(p.find(start=>start.id===end.id)?.cpuTime||end.cpuTime))/seconds}));
 const m={label,seconds,taskMsPerSecond:(z.TaskDuration-a.TaskDuration)*1000/seconds,scriptMsPerSecond:(z.ScriptDuration-a.ScriptDuration)*1000/seconds,layouts:z.LayoutCount-a.LayoutCount,styleRecalculations:z.RecalcStyleCount-a.RecalcStyleCount,browserProcesses:cpu,browserCpuPercentOfMachine:cpu.reduce((sum,p)=>sum+p.cpuMsPerSecond,0)/10/report.logicalProcessors};
 report.performance.push(m);console.log(m);
 if(stage==='after'){assert(m.taskMsPerSecond<20,'Home main-thread duty stays below 2% of a core');assert(m.layouts<16&&m.styleRecalculations<40,'no per-frame layout or style work');}
}
try{
 for(const [width,height] of [[1920,1080],[1366,768],[440,956],[390,844]]){
  const b=await browser(width,height,{gpu});
  try{
   await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:fixture});
   await b.navigate();try{await b.until('state.booted&&nxThemes.loaded&&state.sessions.length===8');}catch(e){console.log(b.exceptions,b.logs);throw e;}await sleep(500);
   await b.js("setView('overview');true");await sleep(500);
   // Freeze only for reproducible captures; perf runs with every production animation enabled.
   await b.js("document.getAnimations().forEach(a=>{a.pause();a.currentTime=0});true");
   await b.shot(`${out}/${stage}-${width}x${height}-home.png`);
   report.sizes.push(await b.js(`({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,hero:document.querySelector('.nx-welcome')?.getBoundingClientRect().toJSON(),cards:[...document.querySelectorAll('.nx-home-card')].map(e=>e.getBoundingClientRect().toJSON())})`));
   assert(!report.sizes.at(-1).overflow,'Home has no page overflow');
   if(width>700){
    await b.js("document.querySelector('.nx-orbit-node').focus();true");await b.shot(`${out}/${stage}-${width}x${height}-detail.png`);
    if(stage==='after'){
     assert(await b.js(`document.querySelectorAll('.nx-orbit-detail:not([hidden])').length===1`),'focus exposes one detail');
     assert(await b.js(`(()=>{const detail=document.querySelector('.nx-orbit-detail:not([hidden])').getBoundingClientRect();return detail.right<=innerWidth&&detail.left>=0})()`),'detail stays in the viewport');
     assert(await b.js(`(()=>{const row=document.querySelector('.nx-quick').getBoundingClientRect();return [...document.querySelectorAll('.nx-quick button')].every(b=>b.getBoundingClientRect().right<=row.right)})()`),'Commands and Recent fit the rail');
    }
   }
   await b.js('nxRecentWork();true');await b.shot(`${out}/${stage}-${width}x${height}-recent.png`);
   if(stage==='after'){
    assert(await b.js(`!document.querySelector('.nx-rw-path')&&[...document.querySelectorAll('.nx-rw-meta')].every(el=>parseFloat(getComputedStyle(el).fontSize)>=12)`),'Recent metadata is readable and omits folder paths');
    if(width<=700)assert(await b.js(`[...document.querySelectorAll('.nx-rw-catch')].every(el=>el.getBoundingClientRect().height>=44)`),'phone Catch up targets are at least 44px');
   }
   await b.js("closeModal();setView('wall');true");await sleep(300);await b.shot(`${out}/${stage}-${width}x${height}-wall.png`);
   if(stage==='after'&&width>700){
    assert(await b.js(`!document.querySelector('#cards .nx-theme-rail')&&!!document.querySelector('.nx-wall-purpose')`),'Wall uses context instead of a duplicate list');
    assert(await b.js(`(()=>{const r=document.querySelector('.nx-wall-context-actions').getBoundingClientRect(),f=document.querySelector('.nx-sidebar-foot').getBoundingClientRect();return r.bottom<=f.top})()`),'both Wall context actions stay above the sidebar foot');
   }
   if(width===1920){
    if(stage==='after'){
     report.contrast=await b.js(`(()=>{
      const ctx=document.createElement('canvas').getContext('2d'),root=getComputedStyle(document.documentElement),color=token=>root.getPropertyValue(token);
      const lum=fill=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=fill;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]};
      const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      return {mutedOnElevated:ratio(color('--muted-foreground'),color('--elevated')),textOnElevated:ratio(color('--foreground'),color('--elevated')),orbitEdgeOnSurface:ratio('oklch(.62 .035 235)',color('--surface'))};
     })()`);
     assert(report.contrast.mutedOnElevated>=4.5&&report.contrast.textOnElevated>=4.5&&report.contrast.orbitEdgeOnSurface>=3,'text and interactive orbit edges meet the contrast norms');
    }
    await b.js("setView('overview');document.activeElement.blur();document.getAnimations().forEach(a=>a.play());true");await sleep(6000);await measure(b,'active Home');
    await b.js("fixtureSessions.forEach(s=>{s.status='done';s.runState='complete';s.live=false;s.needsInput=false});refresh();true");await sleep(1200);await measure(b,'quiet Home');
    await b.shot(`${out}/${stage}-${width}x${height}-quiet.png`);
    await b.js("fixtureSessions=[];themeCatalog=[];refresh();true");await sleep(800);await b.shot(`${out}/${stage}-${width}x${height}-empty.png`);
    if(stage==='after')assert(await b.js(`document.querySelector('.nx-welcome h2').textContent==='Welcome to NEXUS.'&&Math.round(document.querySelector('#nxSidebar').getBoundingClientRect().width)===220`),'empty Home welcomes you without reserving an empty session column');
   }
   if(stage==='after'&&width===1366){
    await b.js(`themeCatalog.forEach(t=>t.name='A long theme name for household survey coordination');fixtureSessions.forEach(s=>s.theme.name='A long theme name for household survey coordination');nxThemes.catalog=themeCatalog;setView('overview');renderApsis();true`);await sleep(300);
    for(let t=0;t<150000;t+=12500){
     await b.js(`document.querySelector('.nx-orbit').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=${t}});true`);
     assert(await b.js(`(()=>{const o=document.querySelector('.nx-orbit').getBoundingClientRect(),nodes=[...document.querySelectorAll('.nx-orbit-node')].map(e=>e.getBoundingClientRect());return nodes.every(r=>r.left>=o.left-1&&r.right<=o.right+1)&&nodes.every((a,i)=>nodes.slice(i+1).every(b=>a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom));})()`),'long labels stay inside the orbit without colliding throughout a revolution');
    }
    await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert(await b.js(`getComputedStyle(document.querySelector('.nx-orbit-node')).animationName==='none'&&getComputedStyle(document.querySelector('.nx-orbit-core'),'::before').animationName==='none'`),'reduced motion freezes labels and state halo');
    await b.cmd('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await b.until("document.querySelectorAll('.nx-orbit-node').length===5");
    await b.cmd('Emulation.setDeviceMetricsOverride',{width:440,height:956,deviceScaleFactor:1,mobile:true});await b.until("!!document.querySelector('.nx-themes-strip')&&!document.querySelector('.nx-orbit')");
   }
   assert.deepEqual(b.exceptions,[],'no page exceptions');
   console.log(`${stage}: ${width}x${height} captured`);
  }finally{await b.close();}
 }
 fs.writeFileSync(`${out}/${stage}${gpu?'-gpu':''}-report.json`,JSON.stringify(report,null,2)+'\n');
}finally{await server.close();}
