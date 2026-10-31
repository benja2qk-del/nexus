import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), label=process.argv[2]||'after';
if(!['before','after'].includes(label))throw Error('Choose before or after');
await new Promise((r,j)=>{const p=net.createServer();p.once('error',j);p.listen(4791,'127.0.0.1',()=>p.close(r));});
const f=require('./themes-ui-fixture.cjs').fixture(),out=path.resolve('.local/activity',label);fs.mkdirSync(out,{recursive:true});
if(label==='before'){
 const assets={},files=execFileSync('git',['ls-tree','-r','--name-only','master','public'],{encoding:'utf8',windowsHide:true}).trim().split('\n');
 for(const file of files.filter(f=>/\.(?:js|css|html)$/.test(f))){const body=execFileSync('git',['show','master:'+file],{windowsHide:true,maxBuffer:8*1024*1024});assets[file.slice(7)]={body:body.toString('base64'),type:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'};}
 const snapshot=path.join(out,'assets.json');fs.writeFileSync(snapshot,JSON.stringify(assets));f.env.NEXUS_PARITY_BASELINE=snapshot;
}
const server=spawn(process.execPath,['--require','./tools/themes-ui-preload.cjs','server.js'],{env:f.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
try{
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Startup timeout')),20000);server.stdout.on('data',d=>{if(String(d).includes('4791/')){clearTimeout(timer);r();}});server.stderr.on('data',d=>process.stderr.write(d));});
 const steps=[{viewport:[1568,773]},{navigate:'/'},{until:"typeof state!=='undefined'&&state.booted&&nxThemes.loaded"},{js:"window.traceSessions=Array.from({length:20},(_,i)=>({...state.sessions[i%state.sessions.length],id:'trace-'+i,title:'Wall session '+(i+1),status:'busy',live:true}));visible=()=>traceSessions;setView('wall');renderWall();"},{wait:1200},{trace:{name:'wall-20',ms:5000}},{shot:'wall-20'},
 {js:"window.traceTick=0;window.traceTimer=setInterval(()=>{const s=traceSessions[(traceTick++)%20];s.status=traceTick%3===0?'waiting':traceTick%3===1?'offline':'busy';s.live=s.status!=='offline';s.runState=s.status==='offline'?'complete':'active';s.updated=Date.now();renderWall();},600);"},{trace:{name:'wall-20-changing',ms:5000}},{js:"clearInterval(traceTimer)"},
 {media:{features:[{name:'prefers-reduced-motion',value:'reduce'}]}},{wait:200},{js:"if(document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity))throw Error('Reduced motion loops');"}];
 const script=path.join(out,'steps.json');fs.writeFileSync(script,JSON.stringify(steps));
 await new Promise((r,j)=>{const p=spawn(process.execPath,['tools/redesign-browser.mjs','4791',out,script],{env:f.env,windowsHide:true,stdio:'inherit'});p.once('exit',c=>c?j(Error('Trace failed')):r());});
 const report={};for(const name of ['wall-20','wall-20-changing']){const frames=JSON.parse(fs.readFileSync(path.join(out,name+'-frames.json'))).sort((a,b)=>a-b),trace=JSON.parse(fs.readFileSync(path.join(out,name+'.json'))),tasks=trace.traceEvents.filter(e=>e.name==='RunTask'&&e.ph==='X').map(e=>e.dur/1000);
 report[name]={frames:frames.length,medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],p99Ms:frames[Math.floor(frames.length*.99)],over33ms:frames.filter(x=>x>33.4).length,longTasks:tasks.filter(x=>x>50).length,maxTaskMs:Math.max(0,...tasks),browser:'Headless Chrome, software rendering',sessions:20};}
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(label,report);
}finally{server.kill();}
