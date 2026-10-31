'use strict';
// A PC with hundreds of Copilot sessions: the list poll reads only sessions whose files changed, and sessions older
// than the requested days are never opened. An autopilot answer given through task_complete is the reply, not tool output.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const cp=require('../copilot'),{records}=require('./copilot-fixture.cjs');
fs.mkdirSync('.local',{recursive:true});
const root=fs.mkdtempSync(path.resolve('.local/copilot-scale-')),state=path.join(root,'copilot','session-state'),cwd=path.join(root,'Weekly report');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),dirOf=n=>path.join(state,id(n));
try{
  // The final answer: recorded as the task_complete call, its start and its result; shown once, as the reply.
  const answer='The dashboard is ready.\n\n| Brand | Comments | Status |\n|---|---|---|\n| North | 1,407 | Needs action |\n| South | 316 | Keep an eye |';
  const at=n=>new Date(Date.UTC(2026,9,28,16,n)).toISOString(),rec=(type,data,n)=>({type,data,timestamp:at(n)});
  const call={toolCallId:'done-1',name:'task_complete',arguments:{summary:answer}};
  const rows=[rec('user.message',{content:'Add the new market'},0),rec('assistant.message',{content:'',toolRequests:[call]},1),
    rec('tool.execution_start',{toolCallId:'done-1',toolName:'task_complete',arguments:{summary:answer},intentionSummary:'The dashboard is ready...'},2),
    rec('tool.execution_complete',{toolCallId:'done-1',success:true,result:{content:answer}},3)];
  const ev=cp.dedupe(rows.flatMap(cp.events));
  assert.deepEqual(ev.map(e=>e.t),['user','ai'],'one reply, no tool card and no tool output');
  assert.equal(ev[1].text,answer,'the reply keeps its Markdown table');
  const onlyResult=cp.dedupe([rec('tool.execution_start',{toolCallId:'done-2',toolName:'task_complete',arguments:{}},4),rec('tool.execution_complete',{toolCallId:'done-2',success:true,result:{content:answer}},5)].flatMap(cp.events));
  assert.deepEqual(onlyResult.map(e=>[e.t,e.text]),[['ai',answer]],'an answer recorded only in the result is the reply too');
  assert.equal(cp.metadata(rows[1])[0].reply,answer.slice(0,600),'the card line shows the answer');
  assert.deepEqual(cp.metadata(rows[1])[0].tools,[],'and does not count it as a tool');

  // 300 sessions, 200 of them older than ten days, each with a few hundred KB of history.
  const filler=Array.from({length:400},(_,i)=>JSON.stringify({type:'tool.execution_complete',data:{toolCallId:'c'+i,success:true,result:{content:'x'.repeat(600)}},timestamp:at(1)})).join('\n')+'\n';
  for(let n=1;n<=300;n++){
    const dir=dirOf(n);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'events.jsonl'),records(id(n),cwd).map(JSON.stringify).join('\n')+'\n'+filler);
    fs.writeFileSync(path.join(dir,'workspace.yaml'),`id: ${id(n)}\ncwd: ${JSON.stringify(cwd)}\nname: "Session ${n}"\n`);
    if(n>100){const old=new Date(Date.now()-20*864e5);for(const f of ['events.jsonl','workspace.yaml'])fs.utimesSync(path.join(dir,f),old,old);}
  }
  const opened=[],open=fs.openSync,read=fs.readFileSync;
  fs.openSync=function(file){opened.push(String(file));return open.apply(this,arguments);};
  fs.readFileSync=function(file){if(/workspace\.yaml$/.test(String(file)))opened.push(String(file));return read.apply(this,arguments);};
  const discover=cp.createDiscovery(),copilot=path.join(root,'copilot');
  let t=Date.now(),list=discover(copilot,10);const cold=Date.now()-t;
  assert.equal(list.length,100,'the 100 recent sessions are listed');
  assert.ok(!opened.some(f=>list.every(s=>!f.startsWith(path.dirname(s.file)))),'sessions older than the requested days are never opened');
  opened.length=0;t=Date.now();list=discover(copilot,10);const warm=Date.now()-t;
  assert.equal(list.length,100);assert.deepEqual(opened,[],'an unchanged session is not read again on the next poll');
  assert.equal(new Set(list.map(s=>s.id)).size,100);
  fs.appendFileSync(path.join(dirOf(7),'events.jsonl'),JSON.stringify(rec('user.message',{content:'One more check'},9))+'\n');
  opened.length=0;list=discover(copilot,10);
  assert.ok(opened.length>0&&opened.every(f=>f.startsWith(dirOf(7))),'only the session that changed is read');
  assert.equal(list.find(s=>s.id===id(7)).lastPrompt,'One more check');
  opened.length=0;discover(copilot,40);assert.equal(discover(copilot,40).length,300,'a longer range lists the older sessions as well');
  fs.openSync=open;fs.readFileSync=read;
  console.log(`PASS Copilot at scale: task_complete answers are replies; 300 sessions, unchanged ones not re-read (first poll ${cold} ms, next ${warm} ms), old ones skipped by date`);
}finally{fs.rmSync(root,{recursive:true,force:true});}
