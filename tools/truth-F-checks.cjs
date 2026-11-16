'use strict';
// Sub-agent and background task rows follow what Claude Code recorded. Synthetic records only.
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {parse,compact,ActivityIndex}=require('../subagents'),core=require('../public/subagent-core');
const now=Date.now(),ts=i=>new Date(now-3*86400e3+i*1000).toISOString();
const tool=(id,name,input,i)=>({type:'assistant',uuid:'u-'+id,timestamp:ts(i),message:{content:[{type:'tool_use',id,name,input}]}});
const result=(id,content,toolUseResult,i,extra={})=>({type:'user',uuid:'r-'+id,timestamp:ts(i),toolUseResult,message:{content:[{type:'tool_result',tool_use_id:id,content,...extra}]}});
const notice=(ids,status)=>`<task-notification>\n${[].concat(ids).map(id=>`<task-id>${id}</task-id>\n`).join('')}<tool-use-id>t</tool-use-id>\n<status>${status}</status>\n<summary>Task ${status}</summary>\n</task-notification>`;
const midTurn=(id,status,i,origin={kind:'task-notification'})=>({type:'attachment',uuid:'a-'+id+i,timestamp:ts(i),attachment:{type:'queued_command',commandMode:'task-notification',prompt:notice(id,status),...(origin?{origin}:{}),timestamp:ts(i)}});
const idle=(ids,status,i)=>({type:'user',uuid:'n-'+i,timestamp:ts(i),message:{content:notice(ids,status)}});
const bg=(id,i)=>[tool(id,'Bash',{command:'npm run '+id,run_in_background:true},i),result(id,'Command running in background with ID: '+id+'-task',{backgroundTaskId:id+'-task'},i+1)];
const agent=(id,i)=>[tool(id,'Agent',{description:'Review '+id,subagent_type:'general-purpose',run_in_background:true},i),result(id,'Async agent launched successfully. agentId: '+id+'-agent',{agentId:id+'-agent',isAsync:true,status:'async_launched'},i+1)];
const flow=(id,i)=>[tool(id,'Workflow',{scriptPath:'C:/flows/'+id+'.js'},i),result(id,'Workflow launched in background. Task ID: '+id+'-task',{status:'async_launched',taskId:id+'-task',runId:'wf_'+id,workflowName:id,summary:'Check the change with three agents',taskType:'local_workflow'},i+1)];
const write=(dir,name,records)=>{const file=path.join(dir,name+'.jsonl');fs.writeFileSync(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');return file;};
const read=file=>{const index=new ActivityIndex({complete:true}),s={kind:'claude',id:path.basename(file,'.jsonl'),file,live:false};let r;for(let i=0;i<20;i++){r=index.read(s);if(!r.more)break;}return {index,s,r,by:id=>r.rows.find(n=>n.toolId===id)};};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-truth-F-'));
try{
 // Mid-turn completions are queued_command attachments, never repeated as a user record.
 {const n=compact(midTurn('x','completed',1));assert.equal(n.length,1,'compact keeps a mid-turn task notification');assert.equal(core.notification(n[0]),notice('x','completed'));
  assert.equal(compact({type:'attachment',attachment:{type:'queued_command',commandMode:'prompt',prompt:'<task-notification><task-id>x</task-id><status>completed</status></task-notification>',origin:{kind:'human'}}}).length,0,'a typed prompt is not a notification');
  const {r,by,index,s}=read(write(root,'midturn',[...bg('build',1),...bg('test',3),...agent('docs',5),midTurn('build-task','completed',20),midTurn('test-task','failed',21,null),midTurn('docs-agent','completed',22)]));
  assert.equal(by('build').state,'done');assert.equal(by('test').state,'interrupted','origin may be missing; commandMode decides');assert.equal(by('docs').state,'done');
  assert.equal(by('build').endedAt,Date.parse(ts(20)));
  const sessions=[{...s}];index.decorate(sessions);assert.equal(sessions[0].activeSubagents,0,'no sub-agent is counted as running');
  assert.equal(index.attach(sessions[0],[]).filter(e=>e.earlierDelegation).length,0,'nothing finished is pinned as an earlier delegation');
  assert.equal(parse([...bg('raw',1),midTurn('raw-task','completed',9)],[],{now}).rows[0].state,'done','parse reads uncompacted attachments too');
  console.log('PASS mid-turn task notifications end their background command or agent');}
 // Every status Claude Code writes ends the row; a notification can name several tasks.
 {assert.equal(core.state('stopped','working'),'cancelled');assert.equal(core.state('killed','working'),'cancelled');assert.equal(core.state('async_launched','done'),'working');
  const {by}=read(write(root,'stopped',[...bg('a',1),...bg('b',3),...bg('c',5),...bg('d',7),idle('a-task','stopped',10),idle(['b-task','c-task','d-task'],'stopped',11)]));
  for(const id of ['a','b','c','d'])assert.equal(by(id).state,'cancelled',id+' stopped');
  console.log('PASS stopped tasks, alone or together, read as cancelled');}
 // Only a record that is a notification can change a row.
 {const quoted=[...bg('q',1),{type:'assistant',uuid:'q-ai',timestamp:ts(5),message:{content:[{type:'text',text:'It will say '+notice('q-task','completed')}]}},{type:'user',uuid:'q-me',timestamp:ts(6),message:{content:[{type:'text',text:'Look at this: '+notice('q-task','failed')}]}}];
  assert.equal(read(write(root,'quoted',quoted)).by('q').state,'waiting','quoted notification text is not news');
  assert.equal(parse(quoted,[],{now}).rows[0].state,'waiting');
  console.log('PASS a reply or message quoting a notification does not change a row');}
 // Workflow runs are delegations: named, counted, ended by their notification.
 {const file=write(root,'flows',[...flow('review',1),...flow('audit',3),...flow('broken',5).slice(0,1),result('broken','Script failed to parse',undefined,6,{is_error:true}),midTurn('review-task','completed',30)]);
  const dir=path.join(root,'flows','subagents','workflows');for(const [run,k]of [['wf_review',3],['wf_audit',2]]){fs.mkdirSync(path.join(dir,run),{recursive:true});for(let i=0;i<k;i++)fs.writeFileSync(path.join(dir,run,'agent-a'+i+'.jsonl'),'{}\n');}
  fs.writeFileSync(path.join(dir,'wf_audit','notes.txt'),'not an agent');
  const {r,by,index,s}=read(file),review=by('review'),audit=by('audit');
  assert.equal(r.rows.length,3);assert.equal(review.kind,'workflow');assert.equal(review.agentType,'Workflow');assert.equal(review.task,'Check the change with three agents');
  assert.equal(review.state,'done');assert.equal(review.agents,3);assert.equal(review.lastStep,'3 agents started');assert.equal(review.toolCount,null,'a run claims no tool calls of its own');
  assert.equal(audit.state,'working','agents still writing keep the run working');assert.equal(audit.agents,2);
  assert.equal(by('broken').state,'interrupted','a launch error is not a running run');
  const sessions=[{...s}];index.decorate(sessions);assert.equal(sessions[0].activeSubagents,1);
  assert.equal(index.attach(sessions[0],[{t:'tool',id:'review'}]).find(e=>e.id==='review').subagents[0].state,'done');
  const quiet=ms=>{const at=new Date(Date.now()-ms);for(let i=0;i<2;i++)fs.utimesSync(path.join(dir,'wf_audit','agent-a'+i+'.jsonl'),at,at);return read(file);};
  assert.equal(quiet(10*60e3).by('audit').state,'waiting','a quiet run is waiting, never done on silence');
  // Its agents silent for over an hour and no report: the run ended unseen. Not active, not done, not pinned as still running.
  const dead=quiet(3*3600e3),gone=dead.by('audit'),deadRow=[{...dead.s,subagents:dead.r.rows}];
  assert.deepEqual([gone.state,gone.lastStep],['interrupted','No report from this run; its agents stopped writing.'],'a run whose agents went silent without a report is not still active');
  assert(Math.abs(gone.endedAt-(Date.now()-3*3600e3))<60e3,'it ended when its agents last wrote');
  dead.index.decorate(deadRow);assert.equal(deadRow[0].activeSubagents,0);
  assert.equal(dead.index.attach(deadRow[0],[]).filter(e=>e.earlierDelegation).length,0,'nothing pinned as an earlier delegation still active');
  assert.equal(parse([...flow('stop',1),tool('halt','TaskStop',{task_id:'stop-task'},4),result('halt','Stopped',undefined,5)],[],{now}).rows[0].state,'cancelled','TaskStop ends a run');
  console.log('PASS workflow runs show as delegations with their agent count and real end state');}
 // A still-running row whose call scrolled away is named for what it is.
 {const {index,s,r}=read(write(root,'earlier',[...bg('watch',1),...agent('help',3),...flow('flow',5)]));const sessions=[{...s,subagents:r.rows}];
  const earlier=index.attach(sessions[0],[]),kind=id=>earlier.find(e=>e.id===id);
  assert.equal(kind('watch').name,'Bash');assert.equal(kind('watch').human.kind,'command');assert.equal(kind('help').human.kind,'delegate');assert.equal(kind('flow').name,'Workflow');
  console.log('PASS earlier still-running rows are named as a command, an agent or a workflow');}
}finally{fs.rmSync(root,{recursive:true,force:true});}
