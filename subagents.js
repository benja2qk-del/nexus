'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const language=require('./public/activity-language'),core=require('./public/subagent-core'),{TailReader}=require('./transcript-tail');
const text=c=>typeof c==='string'?c:(c||[]).filter(x=>x.type==='text').map(x=>x.text||'').join('\n');
const stamp=r=>Date.parse(r.timestamp)||0;
const identity=p=>String(p||'').replace(/\\/g,'/').toLowerCase();
const done=n=>!core.active(n);
const background=(name,input={},result={})=>/bash|shell|powershell/i.test(name)&&(input.run_in_background||result.backgroundTaskId||result.task_id||/(?:^|[;\n])\s*(?:Start-Process|nohup)\s+/i.test(input.command||input.cmd||''));
function inputEvidence(input={}){return Object.fromEntries(['description','subagent_type','prompt','name','agent_id','run_in_background','command','cmd','recipient','to','task_id','file_path','path','filename','url','pattern'].filter(k=>input[k]!==undefined).map(k=>[k,typeof input[k]==='string'?input[k].slice(0,['command','cmd'].includes(k)?32000:2000):input[k]]));}
// Keep only activity evidence, never large attachments or thinking text.
function compact(r){
 const c=r.message?.content,parts=Array.isArray(c)?c:[],result=r.toolUseResult;
 const base={type:r.type,timestamp:r.timestamp,uuid:r.uuid,parentUuid:r.parentUuid,isSidechain:r.isSidechain,agentId:r.agentId,parentToolUseID:r.parentToolUseID,subtype:r.subtype};
 if(r.type==='progress')return [{...base,data:r.data&&{type:r.data.type,agentId:r.data.agentId,status:r.data.status,message:r.data.message&&compact(r.data.message)[0]},toolUseID:r.toolUseID}];
 if(!['assistant','user','system'].includes(r.type))return [];
 return [{...base,message:{id:r.message?.id,usage:r.message?.usage,content:typeof c==='string'?c.slice(0,3000):parts.filter(p=>['tool_use','tool_result','text'].includes(p.type)).map(p=>p.type==='tool_use'?{type:p.type,id:p.id,name:p.name,input:inputEvidence(p.input)}:p.type==='tool_result'?{type:p.type,tool_use_id:p.tool_use_id,is_error:p.is_error,content:text(p.content).slice(0,4000)}:{type:'text',text:p.text?.slice(0,1000)})},toolUseResult:result&&typeof result==='object'?{agentId:result.agentId,isAsync:result.isAsync,status:result.status,totalTokens:result.totalTokens,totalToolUseCount:result.totalToolUseCount,totalDurationMs:result.totalDurationMs,task_id:result.task_id,backgroundTaskId:result.backgroundTaskId}:undefined}];
}
function parse(records,sidechains=[],{now=Date.now(),live=false}={}){
 const rows=[],byTool=new Map(),byAgent=new Map(),byUuid=new Map(),launches=[],callsSeen=new Set();
 const main=records.filter(r=>!r.isSidechain);
 const results=new Map(main.flatMap(r=>(Array.isArray(r.message?.content)?r.message.content:[]).filter(p=>p.type==='tool_result').map(p=>[p.tool_use_id,r.toolUseResult||{}])));
 for(const r of main){
  for(const p of Array.isArray(r.message?.content)?r.message.content:[]){
   if(p.type!=='tool_use')continue;
   if(callsSeen.has(p.id)){if(r.uuid&&byTool.has(p.id))byUuid.set(r.uuid,byTool.get(p.id));continue;}callsSeen.add(p.id);
   const i=p.input||{},command=String(i.command||i.cmd||'');
   const astra=/\bcodex(?:\.cmd|\.exe)?\s+(?:exec|e|resume)\b/i.test(command)||/astra/i.test(p.name);
   if(astra)launches.push({toolId:p.id,ts:r.timestamp,command:command||JSON.stringify(i)});
   if(!/^(Task|Agent)$/.test(p.name)&&!background(p.name,i,results.get(p.id)))continue;
   const isBackground=!/^(Task|Agent)$/.test(p.name),row={id:p.id,toolId:p.id,agentId:i.agent_id||null,agentType:isBackground?'Background':i.subagent_type||i.name||'Agent',task:language.sentence(i.description||i.prompt||command,180),kind:isBackground?'background':'agent',state:'delegated',startedAt:stamp(r),updatedAt:stamp(r),toolCount:0,steps:[]};
   rows.push(row);byTool.set(p.id,row);if(r.uuid)byUuid.set(r.uuid,row);if(row.agentId)byAgent.set(row.agentId,row);if(i.name)byAgent.set(i.name,row);
  }
 }
 // Results identify the sidechain. Async launch acknowledgements are not completion.
 for(const r of main)for(const p of Array.isArray(r.message?.content)?r.message.content:[]){
  if(p.type!=='tool_result')continue;const n=byTool.get(p.tool_use_id);if(!n)continue;
  const result=r.toolUseResult||{},content=text(p.content),agentId=result.agentId||/agentId:\s*([\w-]+)/i.exec(content)?.[1],taskId=result.backgroundTaskId||result.task_id||/(?:background|task).*?\bID[: ]+([\w-]+)/i.exec(content)?.[1];
  if(agentId){n.agentId=agentId;byAgent.set(agentId,n);}if(taskId){n.backgroundId=taskId;byAgent.set(taskId,n);}
  const async=result.isAsync||/running in (?:the )?background|launched (?:successfully|async)|async agent/i.test(content);
  n.state=p.is_error?(/cancel|kill/i.test(content)?'cancelled':'interrupted'):async?'working':core.state(result.status,'done');
  n.updatedAt=stamp(r)||n.updatedAt;if(done(n))n.endedAt=n.updatedAt;
  if(Number.isFinite(result.totalTokens))n.tokens=result.totalTokens;
  if(Number.isFinite(result.totalToolUseCount))n.toolCount=result.totalToolUseCount;
  if(Number.isFinite(result.totalDurationMs))n.durationMs=result.totalDurationMs;
 }
 const streams=new Map();
 const add=(id,r)=>{if(!id||!r)return;if(!streams.has(id))streams.set(id,[]);streams.get(id).push(r);};
 for(const r of records){
  if(r.isSidechain){const parent=byUuid.get(r.parentUuid)||byTool.get(r.parentToolUseID);if(parent&&r.agentId){parent.agentId=r.agentId;byAgent.set(r.agentId,parent);}add(r.agentId||parent?.id||r.parentToolUseID,r);}
  if(r.type==='progress'&&r.data?.type==='agent_progress'){
   const n=byTool.get(r.parentToolUseID||r.toolUseID);if(n&&r.data.agentId){n.agentId=r.data.agentId;byAgent.set(n.agentId,n);}
   add(r.data.agentId||n?.id,r.data.message);
  }
 }
 for(const chain of sidechains)for(const r of chain.records)add(chain.agentId,r);
 for(const [id,rs]of streams){
  const n=byAgent.get(id)||byTool.get(id)||rs.map(r=>byUuid.get(r.parentUuid)||byTool.get(r.parentToolUseID)).find(Boolean);if(!n)continue;
  if(!n.agentId){n.agentId=id;byAgent.set(id,n);}
  const seen=new Set(),calls=new Set(),usage=new Map();let tokens=0;
  for(const r of rs.sort((a,b)=>stamp(a)-stamp(b))){
   const key=r.uuid||JSON.stringify([r.message?.id,r.timestamp,r.message?.content]);if(seen.has(key))continue;seen.add(key);
   n.updatedAt=Math.max(n.updatedAt,stamp(r));
   const u=r.message?.usage;if(u){const id=r.message.id||key,total=['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'].reduce((sum,k)=>sum+(Number(u[k])||0),0);usage.set(id,Math.max(usage.get(id)||0,total));}
   for(const p of Array.isArray(r.message?.content)?r.message.content:[]){
    if(p.type==='tool_use'&&!calls.has(p.id)){calls.add(p.id);n.steps.push({id:p.id,ts:r.timestamp,text:language.describe([language.tool(p.name,p.input)])});}
    if(p.type==='text'&&r.type==='assistant'&&p.text?.trim())n.steps.push({id:r.uuid||key,ts:r.timestamp,text:language.sentence(p.text,220)});
   }
  }
  for(const value of usage.values())tokens+=value;
  if(n.tokens===undefined&&usage.size)n.tokens=tokens;
  n.toolCount=Math.max(n.toolCount,calls.size);n.steps=n.steps.slice(-80);
  if(n.state==='delegated')n.state='working';
 }
 // Explicit updates take precedence over inferred liveness. Never complete on silence.
 for(const r of main){
  const content=text(r.message?.content),taskId=/<task-id>([^<]+)/.exec(content)?.[1],status=/<status>([^<]+)/.exec(content)?.[1];
  if(taskId&&status){const n=byAgent.get(taskId)||byTool.get(taskId);if(n){n.state=core.state(status,n.state);n.updatedAt=stamp(r);if(done(n))n.endedAt=n.updatedAt;}}
  for(const p of Array.isArray(r.message?.content)?r.message.content:[]){
   if(p.type!=='tool_use')continue;const i=p.input||{},n=byAgent.get(i.recipient||i.to||i.agent_id||i.task_id)||rows.find(n=>n.agentType===(i.recipient||i.to));
   if(n&&p.name==='SendMessage'&&core.active(n))n.state='messaged';
   if(n&&/^(TaskStop|KillShell|StopAgent)$/.test(p.name)){const result=main.flatMap(r=>Array.isArray(r.message?.content)?r.message.content:[]).find(x=>x.type==='tool_result'&&x.tool_use_id===p.id);if(result&&!result.is_error){n.state='cancelled';n.endedAt=stamp(r);}}
  }
 }
 for(const n of rows){if(core.active(n)&&now-n.updatedAt>120000)n.state=n.state==='messaged'?'messaged':'waiting';n.durationMs??=Math.max(0,(n.endedAt||n.updatedAt||n.startedAt)-n.startedAt);n.lastStep=n.steps.at(-1)?.text||'';}
 return {rows,launches};
}
class ActivityIndex{
 constructor({background=false,complete=false}={}){
  this.current=new Map();this.background=background;
  if(background){const {Worker}=require('worker_threads');this.worker=new Worker(path.join(__dirname,'subagents-worker.js'));this.worker.on('message',({key,result})=>this.current.set(key,result));this.worker.on('error',e=>{this.error=e.message;});this.worker.unref();return;}
  this.reader=new TailReader({parse:compact,window:8*1024*1024,limit:12000,fromStart:complete,files:2048});this.seen=new Map();
  const known=new Map();this.mainReader=new TailReader({window:8*1024*1024,limit:12000,fromStart:complete,files:256,parse:r=>{
   if(!known.has(this.reading))known.set(this.reading,new Set());const ids=known.get(this.reading);
   if(r.isSidechain||r.type==='progress')return compact(r);
   const parts=Array.isArray(r.message?.content)?r.message.content:[];
   const selected=parts.filter(p=>{
    if(p.type==='tool_use'){const i=p.input||{},command=String(i.command||i.cmd||'');if(/^(Task|Agent|SendMessage|TaskStop|KillShell|StopAgent)$/.test(p.name)||/bash|shell|powershell/i.test(p.name)||i.run_in_background||/\bcodex(?:\.cmd|\.exe)?\s+(?:exec|e|resume)\b/i.test(command)||/astra/i.test(p.name)){ids.add(p.id);return true;}}
    return p.type==='tool_result'&&ids.has(p.tool_use_id)||p.type==='text'&&p.text?.includes('<task-notification>');
   });
   if(selected.length)return compact({...r,message:{...r.message,content:selected}});
   return typeof r.message?.content==='string'&&r.message.content.includes('<task-notification>')?compact(r):[];
  }});
 }
 read(s){
  const key=s.kind+':'+s.id;
  if(this.background){this.worker.postMessage({kind:s.kind,id:s.id,file:s.file,chainFiles:s.chainFiles,live:s.live});return structuredClone(this.current.get(key)||{rows:[],launches:[],partial:true,more:true});}
  const records=[],chains=[],stamp=[];let partial=false,more=false;
  for(const file of s.chainFiles||[s.file]){try{this.reading=file;const r=this.mainReader.read(file);records.push(...r.items);partial||=r.partial;more||=r.more;stamp.push(r.cursor);const dir=path.join(path.dirname(file),path.basename(file,'.jsonl'),'subagents');const names=fs.readdirSync(dir).filter(n=>/^agent-[\w-]+\.jsonl$/.test(n));partial||=names.length>100;for(const name of names.slice(-100)){const read=this.reader.read(path.join(dir,name));chains.push({agentId:name.slice(6,-6),records:read.items});partial||=read.partial;more||=read.more;stamp.push(name+read.cursor);}}catch{}}
  // Nothing new on disk: keep the earlier result instead of parsing every record again.
  // While a long history is still being read, parse once at the end instead of after every window.
  if(more&&this.seen){const prior=this.current.get(key);return prior?{...prior,partial:true,more:true}:{rows:[],launches:[],partial:true,more:true};}
  const signature=stamp.join('|'),seen=this.seen?.get(key);
  if(seen&&seen.signature===signature&&seen.live===s.live&&Date.now()-seen.at<30000)return seen.result;
  const result=parse(records,chains,{live:s.live});result.partial=partial||more;result.more=more;this.current.set(key,result);
  if(this.seen){this.seen.delete(key);this.seen.set(key,{signature,live:s.live,at:Date.now(),result});if(this.seen.size>256)this.seen.delete(this.seen.keys().next().value);}
  return result;
 }
 decorate(sessions){
  const parents=sessions.filter(s=>s.kind==='claude');for(const s of parents){const activity=this.read(s);s.subagents=activity.rows;s.subagentsPartial=activity.partial;s.subagentsIndexing=!!activity.more;}
  for(const child of sessions.filter(s=>s.kind==='astra')){
   const candidates=[];for(const parent of parents)for(const launch of this.current.get('claude:'+parent.id)?.launches||[]){
    const command=identity(launch.command),brief=identity(child.brief),id=child.id;
    const prompt=identity(child.firstPrompt);
    if(brief&&!command.includes(brief)&&!command.includes(identity(JSON.stringify(child.brief).slice(1,-1)))||!brief&&!command.includes(id)&&!(prompt.length>=24&&command.includes(prompt)))continue;
    const delta=Date.parse(child.started)-Date.parse(launch.ts);if(Number.isFinite(delta)&&(delta< -2000||delta>24*3600e3))continue;
    candidates.push({parent,launch,delta:Number.isFinite(delta)?Math.abs(delta):Infinity});
   }
   candidates.sort((a,b)=>a.delta-b.delta);const found=candidates[0];if(!found||candidates[1]?.delta===found.delta)continue;
   child.parent={key:'claude:'+found.parent.id,relation:'delegated',toolId:found.launch.toolId};
   const n={id:'astra:'+child.id,toolId:found.launch.toolId,sessionKey:'astra:'+child.id,kind:'astra',agentType:'Astra',task:language.subtitle(child),state:core.session(child),startedAt:Date.parse(child.started)||0,updatedAt:child.updated,lastStep:language.sentence(child.latestContext||child.lastText,180),steps:[],toolCount:null};
   n.durationMs=Math.max(0,n.updatedAt-n.startedAt);found.parent.subagents.push(n);
  }
  for(const s of sessions){if(s.kind==='copilot')s.subagents=(s.copilotFleet||[]).map(n=>({...n,state:core.state(n.state),kind:'agent'}));s.activeSubagents=(s.subagents||[]).filter(n=>n.kind!=='background'&&core.active(n)).length;}
 }
 attach(s,events){
  const rows=s.subagents||this.current.get(s.kind+':'+s.id)?.rows||[],tools=new Set(events.filter(e=>e.t==='tool').map(e=>e.id));
  const earlier=[...new Set(rows.filter(n=>n.toolId&&core.active(n)&&!tools.has(n.toolId)).map(n=>n.toolId))].map(id=>{const children=rows.filter(n=>n.toolId===id);return {t:'tool',id,ts:new Date(children[0].startedAt||0).toISOString(),name:children[0].kind==='astra'?'Astra':'Task',human:{kind:children[0].kind==='astra'?'astra':'delegate'},text:'Earlier delegation; still active in the recorded activity.',earlierDelegation:true,subagents:children};});
  return [...earlier,...events.map(e=>e.t==='tool'?{...e,subagents:rows.filter(n=>n.toolId===e.id)}:e)];
 }
 revision(s){return crypto.createHash('sha1').update(JSON.stringify(s.subagents||[])).digest('hex').slice(0,12);}
}
module.exports={compact,parse,ActivityIndex};
