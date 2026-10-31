'use strict';
// Copilot CLI 1.0.93. Ignore internal model logs, system prompts and binary assets.
const fs = require('fs'), path = require('path');
const { TailReader } = require('./transcript-tail');
const LABEL_DIR = path.resolve(require('./session-labels').WORKDIR).toLowerCase();
const language = require('./public/activity-language');
const { toolDetail } = require('./session-details');
const OPTIONS = require('./copilot-options');
const clip = (x, n = 12000) => typeof x === 'string' ? x.slice(0, n) : '';
const text = x => typeof x === 'string' ? x : Array.isArray(x) ? x.filter(p => p.type === 'text').map(p => p.text || '').join('\n') : '';
function input(value) { if (typeof value !== 'string') return value || {}; try { return JSON.parse(value); } catch { return { command: value }; } }
function toolName(name) { return ({ view:'Read', edit:'Edit', create:'Write', powershell:'PowerShell', bash:'Bash', shell:'Bash', grep:'Grep', glob:'Glob' })[name] || name || 'Tool'; }
// In autopilot Copilot ends a task by calling task_complete with its answer: that answer is the reply, not tool output.
const FINAL = /^task_complete$/i;
const finalText = a => [a.summary, a.message, a.result, a.command].find(v => typeof v === 'string' && v.trim()) || '';
function toolEvent(d, ts) {
  const a = input(d.arguments), name = toolName(d.toolName || d.name);
  if (FINAL.test(name)) return { t:'ai', ts, id:d.toolCallId, final:true, text:clip(finalText(a)) };
  if (a.path && !a.file_path) a.file_path = a.path;
  if(a.old_str!==undefined)a.old_string=a.old_str;
  if(a.new_str!==undefined)a.new_string=a.new_str;
  const human = language.tool(name, a);
  human.summary = clip(d.intentionSummary || d.toolTitle, 250);
  return { t:'tool', ts, id:d.toolCallId, name, text:clip(d.intentionSummary || d.toolTitle || a.command || a.file_path || name, 6000), human, detail:toolDetail(name, a) };
}
function events(r) {
  if (!r || r.type === 'session.binary_asset') return [];
  const d = r.data || {}, ts = r.timestamp, out = [];
  switch (r.type) {
    case 'user.message': if (text(d.content).trim()) out.push({t:'user',ts,text:clip(text(d.content))}); break;
    case 'assistant.message':
      if (d.reasoningText) out.push({t:'think',ts,text:clip(d.reasoningText)});
      if (text(d.content).trim()) out.push({t:'ai',ts,text:clip(text(d.content))});
      for (const t of d.toolRequests || []) out.push(toolEvent(t, ts)); break;
    case 'tool.execution_start': out.push(toolEvent(d, ts)); break;
    case 'tool.execution_complete': out.push({t:'result',ts,id:d.toolCallId,err:d.success === false,text:clip(text(d.result?.content) || text(d.error?.message),1600)}); break;
    case 'session.error': out.push({t:'note',ts,err:true,errorType:d.errorType,text:clip(d.message || 'Copilot reported an error.',4000)}); break;
    case 'system.notification': if (typeof d.content === 'string') out.push({t:'note',ts,text:clip(d.content,2000)}); break;
    case 'assistant.turn_start': out.push({t:'note',ts,text:'turn started'}); break;
    case 'assistant.turn_end': out.push({t:'note',ts,text:'turn complete'}); break;
    case 'abort': out.push({t:'note',ts,text:'turn aborted'}); break;
    case 'session.shutdown': {
      const files = modifiedFiles(d);
      if (files.length) out.push({t:'note',ts,text:'Files reported at shutdown',detail:{files:files.map(path => ({path,diff:[],reported:true}))}});
      break;
    }
  }
  return out;
}
function dedupe(events) {
  const seen = new Set(), finals = new Map(events.filter(e => e.final && e.id).map(e => [e.id, e]));
  // A final answer recorded only in the tool result takes its text from there.
  for (const e of events) if (e.t === 'result' && finals.has(e.id) && !finals.get(e.id).text) finals.get(e.id).text = e.text;
  return events.filter(e => {
    if (e.t === 'result' && finals.has(e.id)) return false;
    if (e.final && !e.text.trim()) return false;
    if (!(e.t === 'tool' || e.final) || !e.id) return true; if (seen.has(e.id)) return false; seen.add(e.id); return true;
  });
}
function modifiedFiles(d) { return (Array.isArray(d.codeChanges?.filesModified) ? d.codeChanges.filesModified : []).map(f => typeof f === 'string' ? f : f.path).filter(f => typeof f === 'string'); }
function usage(d) {
  const count = type => { const v=d.tokenDetails?.[type]; return Math.max(0, Number(typeof v === 'number' ? v : v?.tokenCount) || 0); };
  const u = {input:count('input'),output:count('output'),cacheRead:count('cache_read'),cacheWrite:count('cache_write')};
  return {...u,total:u.input+u.output+u.cacheRead+u.cacheWrite,measured:!!d.tokenDetails,
    premiumRequests:Number.isFinite(d.totalPremiumRequests)?d.totalPremiumRequests:null,
    aiCredits:Number.isFinite(d.totalNanoAiu)?d.totalNanoAiu/1e9:null};
}
function workspace(file) {
  let source; try { source=fs.readFileSync(file,'utf8'); } catch { return {}; }
  const out = {};
  for (const line of source.split(/\r?\n/)) {
    const m=/^(id|cwd|git_root|branch|name|created_at|updated_at):\s*(.*)$/.exec(line); if(!m)continue;
    let v=m[2]; if(v.startsWith('"')){try{v=JSON.parse(v)}catch{}}else if(v.startsWith("'"))v=v.slice(1,-1).replace(/''/g,"'");
    out[m[1]]=v;
  }
  return out;
}
// Store only bounded card metadata, never binary data or system prompts.
function metadata(r) {
  const d=r.data||{}, base={type:r.type,ts:r.timestamp};
  switch(r.type){
    case 'session.start': case 'session.resume': return [{...base,cwd:d.context?.cwd,branch:d.context?.branch,model:d.selectedModel,started:d.startTime,mode:d.agentMode||d.mode,effort:d.reasoningEffort,context:d.contextTier}];
    case 'session.model_change': return [{...base,model:d.newModel,effort:d.reasoningEffort,context:d.contextTier}];
    case 'session.mode_changed': case 'session.mode_change': return [{...base,mode:d.newMode||d.mode}];
    case 'subagent.started': case 'subagent.completed': case 'subagent.failed': return [{...base,fleet:{id:d.toolCallId,label:clip(d.agentDisplayName||d.agentName,120),state:r.type.split('.')[1],detail:clip(d.error,200)}}];
    // Only retain the public billing scalars, never model prompts or response bodies.
    case 'model.model_call_success': {const q=d.quotaSnapshots?.premium_interactions;if(!q||q.isUnlimitedEntitlement||!Number.isFinite(q.entitlementRequests)||q.entitlementRequests<=0||!Number.isFinite(q.remainingPercentage))return [];return [{...base,quota:{allowance:q.entitlementRequests,pct:Math.max(0,Math.min(100,100-q.remainingPercentage)),used:Number.isFinite(q.usedRequests)?Math.max(0,q.usedRequests):q.entitlementRequests*Math.max(0,Math.min(100,100-q.remainingPercentage))/100,unit:Number.isFinite(d.copilotUsage?.total_nano_aiu)?'AI credits':'premium requests',resetsAt:Date.parse(q.resetDate)||null,at:Date.parse(r.timestamp)||null}}];}
    case 'user.message': return [{...base,prompt:clip(text(d.content),600),mode:d.agentMode}];
    case 'assistant.message': {const final=(d.toolRequests||[]).find(x=>FINAL.test(x.name||x.toolName||''));return [{...base,model:d.model,reply:clip(text(d.content).trim()||(final?finalText(input(final.arguments)):''),600),tools:(d.toolRequests||[]).filter(x=>x!==final).map(x=>toolName(x.name))}];}
    case 'session.error': return [{...base,error:clip(d.message,600),errorType:d.errorType}];
    case 'session.usage_checkpoint': case 'session.shutdown': return [{...base,usage:usage(d)}];
    case 'assistant.turn_start': case 'assistant.turn_end': case 'abort': return [base];
    default:return [];
  }
}
// Discovery runs on every list poll. A session whose files have not changed since the last poll reuses what was read
// from it, and one older than the requested days is skipped by its file dates alone, so a PC with hundreds of Copilot
// sessions reads only the ones that are being written.
function createDiscovery() {
  const reader=new TailReader({parse:metadata,limit:1000}), heads=new Map(), known=new Map();
  return function discover(root, days, projectOf=x=>path.basename(x||'')||'Unknown') {
    const dir=path.join(root,'session-state'),out=[],present=new Set();let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{return out}
    const month=Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1);
    for(const e of entries){if(!e.isDirectory())continue;const file=path.join(dir,e.name,'events.jsonl');present.add(file);try{
      const st=fs.statSync(file),yaml=path.join(dir,e.name,'workspace.yaml');let wst=null;try{wst=fs.statSync(yaml);}catch{}
      // The newest file date is never earlier than the session's own last update.
      if(Math.max(st.mtimeMs,wst?.mtimeMs||0)<Date.now()-days*864e5)continue;
      const stamp=[st.size,st.mtimeMs,wst?.size,wst?.mtimeMs,month].join(':');let f=known.get(file);
      if(f?.stamp!==stamp){f=facts(file,st,yaml,month,e.name);f.stamp=stamp;known.set(file,f);}
      if(f.updated<Date.now()-days*864e5)continue;
      if(path.resolve(f.cwd||'.').toLowerCase()===LABEL_DIR)continue; // NEXUS's own label requests
      const group=projectOf(f.cwd),recent=Date.now()-f.updated<10*60e3,busy=recent&&['user.message','assistant.turn_start'].includes(f.state);
      const {stamp:_,state:__,completed,...row}=f;
      out.push({...row,group,groupLabel:group,live:busy,status:busy?'busy':f.error?'error':'done',runState:busy?'active':completed?'complete':'saved',
        statusDetail:f.error||(busy?'Recent Copilot turn activity; external process state is not reported.':'Saved Copilot conversation.')});
    }catch{/* A missing or rotating session must not break discovery. */}}
    for(const file of known.keys())if(!present.has(file)){known.delete(file);heads.delete(file);}
    return out;
  };
  // Everything a list row needs from one session's files, except what depends on the current time.
  function facts(file,st,yaml,month,name){
    const w=workspace(yaml);
    let first=heads.get(file);if(!first||st.size<first.size){const fd=fs.openSync(file,'r'),b=Buffer.alloc(Math.min(st.size,192*1024));try{fs.readSync(fd,b,0,b.length,0)}finally{fs.closeSync(fd)}const rows=b.toString('utf8').split('\n').flatMap(l=>{try{return metadata(JSON.parse(l))}catch{return []}});first={size:st.size,start:rows.find(r=>r.type==='session.start')||{},prompt:rows.find(r=>r.prompt)?.prompt||''};heads.set(file,first);}
    const read=reader.read(file),rows=read.items,last=rows.at(-1)||{},updated=Math.max(st.mtimeMs,Date.parse(w.updated_at)||0,Date.parse(last.ts)||0);
    const cwd=w.cwd||rows.findLast(r=>r.cwd)?.cwd||first.start.cwd||'';
    const state=rows.findLast(r=>['assistant.turn_start','assistant.turn_end','session.shutdown','session.error','abort','user.message'].includes(r.type))?.type;
    const completed=rows.findLast(r=>['assistant.turn_start','assistant.turn_end','user.message','abort','session.error'].includes(r.type))?.type==='assistant.turn_end';
    const lastError=rows.findLast(r=>r.error),lastUser=rows.findLastIndex(r=>r.prompt),error=lastError&&rows.indexOf(lastError)>lastUser?lastError.error:'';
    const spend=rows.findLast(r=>r.usage)?.usage||{};
    const checkpoints=rows.filter(r=>r.usage),latest=checkpoints.at(-1),baseline=checkpoints.findLast(r=>Date.parse(r.ts)<month),started=Date.parse(w.created_at||first.start.started||first.start.ts),thisMonth=latest&&Date.parse(latest.ts)>=month;
    const monthPremiumRequests=thisMonth&&Number.isFinite(latest.usage.premiumRequests)&&(started>=month||Number.isFinite(baseline?.usage.premiumRequests))?Math.max(0,latest.usage.premiumRequests-(baseline?.usage.premiumRequests||0)):null;
    const fleet=new Map();for(const r of rows)if(r.fleet?.id)fleet.set(r.fleet.id,{...fleet.get(r.fleet.id),...r.fleet,label:r.fleet.label||fleet.get(r.fleet.id)?.label||'Subagent'});
    const options={};for(const r of rows){if(OPTIONS.MODES.includes(r.mode))options.mode=r.mode;if(OPTIONS.EFFORTS.includes(r.effort))options.effort=r.effort;if(OPTIONS.CONTEXTS.includes(r.context))options.context=r.context;}
    return {kind:'copilot',id:w.id||name,file,cwd,title:w.name||first.prompt.slice(0,80)||'Copilot session',
      firstPrompt:first.prompt,lastPrompt:rows.findLast(r=>r.prompt)?.prompt||first.prompt,lastText:rows.findLast(r=>r.reply)?.reply||'',latestContext:error||rows.findLast(r=>r.reply)?.reply||'',
      recentTools:[...new Set(rows.flatMap(r=>r.tools||[]))].slice(-8),branch:w.branch||first.start.branch||'',model:rows.findLast(r=>r.model)?.model||first.start.model||'',modelAt:Date.parse(rows.findLast(r=>r.model)?.ts)||0,
      started:w.created_at||first.start.started||first.start.ts,updated,size:st.size,state,completed,
      error,errorType:error?lastError.errorType:'',copilotUsage:{...spend,monthPremiumRequests},copilotOptions:options,copilotQuota:rows.findLast(r=>r.quota)?.quota||null,copilotFleet:[...fleet.values()]};
  }
}
module.exports={events,dedupe,toolEvent,toolName,input,text,usage,modifiedFiles,workspace,metadata,createDiscovery};
