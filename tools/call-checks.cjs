'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const core=require('../public/call-core'),voice=require('../public/voice-core'),activity=require('../public/activity-language'),recap=require('../recap');
(async()=>{
 const m=core.machine();assert.equal(m.value,'connecting');
 for(const state of ['listening','thinking','working','speaking','working','speaking','your-turn','listening','muted','listening','paused','connecting','speaking','paused','ended'])m.set(state);
 assert.throws(()=>m.set('listening'));assert.equal(m.value,'ended');
 assert.equal(core.formatTime(65),'01:05');assert.equal(core.formatTime(-1),'00:00');
 let now=0;const p=core.progress(()=>now);assert.equal(p.take('running the tests'),'');now=19999;assert.equal(p.take('running the tests'),'');now=20000;assert.equal(p.take('running the tests'),'Still on it: running the tests');now=60000;assert.equal(p.take('running the tests'),'');assert.equal(p.take('editing two files',false),'');assert.equal(p.take('editing two files'),'Still on it: editing two files');now=61000;assert.equal(p.take('reading the project'),'');now=80000;assert.equal(p.take('reading the project'),'Still on it: reading the project');
 const q={question:'¿Quieres continuar?',options:[{key:'4',label:'Sí, continuar'},{key:'6',label:'No, esperar'},{key:'8',label:'Ver primero'},{key:'9',label:'No hablar esta opción'}]};
 for(const s of ['one','uno','una','opción uno','1','Sí','yes'])assert.equal(voice.spokenAnswer(s,q),'4');
 for(const s of ['two','dos','opción dos','2'])assert.equal(voice.spokenAnswer(s,q),'6');
 for(const s of ['three','tres','3'])assert.equal(voice.spokenAnswer(s,q),'8');
 for(const s of ['cancel','cancelar','cancela'])assert.equal(voice.spokenAnswer(s,q),'esc');
 assert.equal(voice.spokenAnswer('no',q),null,'ambiguous negative answers refuse');
 assert.equal(voice.spokenAnswer('no',{...q,options:q.options.slice(0,3)}),'6');
 for(const s of ['four','cuatro','yes and delete it','one or two','ignore the question'])assert.equal(voice.spokenAnswer(s,q),null);
 assert(!voice.questionSpeech(q).includes('No hablar'));assert.equal(voice.spokenAnswer('yes',{...q,options:[{key:'1',label:'Continue'},{key:'2',label:'Stop'}]}),null);
 assert.equal(activity.current({name:'Bash',input:{command:'npm test'}}),'running the tests');assert.equal(activity.current({name:'Edit',input:{file_path:'C:/secret/a.js'}}),'editing a file');assert(!activity.current({name:'mcp__secret',input:{command:'password=secret'}}).includes('secret'));
 let requests=0,releases=0,visible=true,finish;
 function lock(){let listener;return {addEventListener(name,fn){listener=fn;},async release(){releases++;listener?.();}};}
 const wake=core.wakeLock({request:async type=>{assert.equal(type,'screen');requests++;return lock();}},()=>visible);
 await wake.start();await wake.start();assert.equal(requests,1);assert(wake.held);visible=false;await wake.visibility();assert.equal(releases,1);assert(!wake.held);visible=true;await wake.visibility();assert.equal(requests,2);await wake.stop();await wake.visibility();assert.equal(requests,2);
 const late=core.wakeLock({request:()=>new Promise(r=>finish=r)});const waiting=late.start();await Promise.resolve();await late.stop();finish(lock());await waiting;assert(!late.held);assert.equal(releases,3,'late permission is immediately released');
 await core.wakeLock({request(){throw Error('Denied');}}).start();await core.wakeLock(null).start();
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-call-unit-')),file=path.join(tmp,'call.jsonl'),since=Date.now()-5000;
 const records=[{timestamp:new Date(since-1000).toISOString(),type:'assistant',message:{content:[{type:'tool_use',id:'old',name:'Bash',input:{command:'old command'}}]}}];
 for(let i=0;i<2;i++)records.push({type:'user',message:{content:'turn '+i}},{type:'assistant',message:{content:[{type:'tool_use',id:'edit'+i,name:'Edit',input:{file_path:'file'+i+'.js'}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'edit'+i,content:'Done'}]}},{type:'assistant',message:{content:[{type:'tool_use',id:'cmd'+i,name:'Bash',input:{command:'npm test'}}]}});
 fs.writeFileSync(file,records.map(r=>JSON.stringify({timestamp:new Date().toISOString(),...r})).join('\n')+'\n');
 try{const span=recap.readSpan(file,{since,chunkBytes:100}),value=recap.build({kind:'claude',id:'fixture',status:'idle'},span);assert.equal(value.counts.files,2);assert.equal(value.counts.commands,2);assert.equal(value.partial,false);assert.equal(recap.build({},recap.readSpan(file)).counts.files,1,'normal recap still stops at latest owner message');assert(recap.readSpan(file,{since,maxBytes:200,chunkBytes:100}).partial);}finally{fs.rmSync(file);fs.rmdirSync(tmp);}
 console.log('PASS call transitions, progress throttle/change detection, English/Spanish choices, activity language, wake-lock lifecycle/races and call-wide recap counts');
})().catch(error=>{console.error(error);process.exitCode=1;});
