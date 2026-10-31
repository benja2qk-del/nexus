import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve(process.argv[2],'trace');fs.mkdirSync(out,{recursive:true});
const steps=[{viewport:[1568,773]},{navigate:'/'},{until:"typeof state!=='undefined'&&state.booted&&state.sessions.length===11"},
  {js:"window.paritySessions=Array.from({length:20},(_,i)=>({...state.sessions[i%state.sessions.length],id:'parity-'+i,title:'Wall session '+(i+1)}));visible=()=>paritySessions;setView('wall');renderWall();"},
  {wait:1200},{trace:{name:'wall-20',ms:5000}},
  {save:{name:'wall-animations.json',expression:"document.getAnimations().map(a=>({name:a.animationName||'WAAPI',timing:a.effect.getTiming(),frames:a.effect.getKeyframes()}))"}},
  {media:{features:[{name:'prefers-reduced-motion',value:'reduce'}]}},{wait:150},
  {js:"if(document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations===Infinity))throw Error('Reduced motion still has infinite animations');setView('overview');if(document.getAnimations().some(a=>a.playState==='running'))throw Error('Reduced motion entrance');'PASS reduced motion';"},
  {viewport:[440,956],dpr:3},{js:"setView('overview');"},{wait:100},
  {save:{name:'phone-band.json',expression:"({theme:document.querySelector('meta[name=theme-color]').content,root:getComputedStyle(document.documentElement).backgroundColor,dock:getComputedStyle(document.querySelector('#mobileDock')).backgroundColor})"}}];
const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps));
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tools/redesign-browser.mjs','4785',out,file],{windowsHide:true,stdio:'inherit'});child.once('exit',c=>c?reject(Error('Trace failed')):resolve());});
const frames=JSON.parse(fs.readFileSync(path.join(out,'wall-20-frames.json'))).sort((a,b)=>a-b);
const trace=JSON.parse(fs.readFileSync(path.join(out,'wall-20.json')));
const tasks=trace.traceEvents.filter(e=>e.name==='RunTask'&&e.ph==='X').map(e=>e.dur/1000);
const report={frames:frames.length,medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],p99Ms:frames[Math.floor(frames.length*.99)],over33ms:frames.filter(x=>x>33.4).length,longTasks:tasks.filter(x=>x>50).length,maxTaskMs:Math.max(0,...tasks)};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(report);
