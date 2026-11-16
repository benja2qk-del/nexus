'use strict';
// Copilot CLI 1.0.93. Ignore internal model logs, system prompts and binary assets.
const fs = require('fs'), path = require('path');
const { TailReader } = require('./transcript-tail');
const LABEL_DIR = path.resolve(require('./session-labels').WORKDIR).toLowerCase();
const language = require('./public/activity-language');
const { toolDetail } = require('./session-details');
const OPTIONS = require('./copilot-options');
const chatImages = require('./chat-images');
const clip = (x, n = 12000) => typeof x === 'string' ? x.slice(0, n) : '';
// Chat text marks its cut the way Claude and Codex do, so a long message still matches what NEXUS sent.
const said = (x, n = 12000) => { const s = clip(x, n + 1); return s.length > n ? s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1]) ? n - 1 : n) + '…' : s; };
const text = x => typeof x === 'string' ? x : Array.isArray(x) ? x.filter(p => p.type === 'text').map(p => p.text || '').join('\n') : '';
function input(value) { if (typeof value !== 'string') return value || {}; try { return JSON.parse(value); } catch { return { command: value }; } }
function toolName(name) { return ({ view:'Read', edit:'Edit', create:'Write', powershell:'PowerShell', bash:'Bash', shell:'Bash', grep:'Grep', glob:'Glob' })[name] || name || 'Tool'; }
// In autopilot Copilot ends a task by calling task_complete with its answer: that answer is the reply, not tool output.
const FINAL = /^task_complete$/i;
const finalText = a => [a.summary, a.message, a.result, a.command].find(v => typeof v === 'string' && v.trim()) || '';
function toolEvent(d, ts) {
  const a = input(d.arguments), name = toolName(d.toolName || d.name);
  if (FINAL.test(name)) return { t:'ai', ts, id:d.toolCallId, final:true, text:said(finalText(a)) };
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
    // A picture NEXUS uploaded is named by its path in the message.
    case 'user.message': { const s = text(d.content), images = s.trim() ? chatImages.fromText(s) : []; if (s.trim()) out.push({t:'user',ts,text:said(s),...(images.length ? {images} : {})}); break; }
    case 'assistant.message':
      if (d.reasoningText) out.push({t:'think',ts,text:said(d.reasoningText)});
      if (text(d.content).trim()) out.push({t:'ai',ts,text:said(text(d.content))});
      for (const t of d.toolRequests || []) out.push(toolEvent(t, ts)); break;
    case 'tool.execution_start': out.push(toolEvent(d, ts)); break;
    case 'tool.execution_complete': out.push({t:'result',ts,id:d.toolCallId,err:d.success === false,text:clip(text(d.result?.content) || text(d.error?.message),1600)}); break;
    case 'session.error': out.push({t:'note',ts,err:true,errorType:d.errorType,text:clip(d.message || 'Copilot reported an error.',4000)}); break;
    // The model-facing wrapper is not part of the notice ("Shell command ... has completed successfully.").
    case 'system.notification': { const notice = typeof d.content === 'string' ? d.content.replace(/^\s*<system_notification>\s*|\s*<\/system_notification>\s*$/g, '') : ''; if (notice) out.push({t:'note',ts,text:clip(notice,2000)}); break; }
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
  const out = {}, lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m=/^(id|cwd|git_root|branch|name|created_at|updated_at):\s*(.*)$/.exec(lines[i]); if(!m)continue;
    let v=m[2]; if(v.startsWith('"')){try{v=JSON.parse(v)}catch{}}else if(v.startsWith("'"))v=v.slice(1,-1).replace(/''/g,"'");
    // A multi-line or long name is a block scalar: "name: |-" (or ">-"), then indented lines.
    else if(/^[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(v)){const body=[];while(i+1<lines.length&&(/^\s/.test(lines[i+1])||!lines[i+1]))body.push(lines[++i]);
      const indent=Math.min(...body.filter(l=>l.trim()).map(l=>/^\s*/.exec(l)[0].length)),text=body.map(l=>l.slice(indent)).join('\n').replace(/\s+$/,'');
      v=v[0]==='>'?text.replace(/\n(\n*)/g,(_,more)=>more||' '):text;}
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
    // Only retain the public billing scalars, never model prompts or response bodies. The numbers count premium
    // requests (premium_interactions); AI credits are a separate total, kept by usage().
    case 'model.model_call_success': {const q=d.quotaSnapshots?.premium_interactions;if(!q||q.isUnlimitedEntitlement||!Number.isFinite(q.entitlementRequests)||q.entitlementRequests<=0||!Number.isFinite(q.remainingPercentage))return [];return [{...base,quota:{allowance:q.entitlementRequests,pct:Math.max(0,Math.min(100,100-q.remainingPercentage)),used:Number.isFinite(q.usedRequests)?Math.max(0,q.usedRequests):q.entitlementRequests*Math.max(0,Math.min(100,100-q.remainingPercentage))/100,unit:'premium requests',resetsAt:Date.parse(q.resetDate)||null,at:Date.parse(r.timestamp)||null}}];}
    case 'user.message': return [{...base,prompt:clip(text(d.content),600),mode:d.agentMode}];
    case 'assistant.message': {const final=(d.toolRequests||[]).find(x=>FINAL.test(x.name||x.toolName||''));return [{...base,model:d.model,reply:clip(text(d.content).trim()||(final?finalText(input(final.arguments)):''),600),tools:(d.toolRequests||[]).filter(x=>x!==final).map(x=>toolName(x.name))}];}
    case 'session.error': return [{...base,error:clip(d.message,600),errorType:d.errorType}];
    case 'session.usage_checkpoint': case 'session.shutdown': return [{...base,usage:usage(d)}];
    case 'assistant.turn_start': case 'assistant.turn_end': case 'abort': return [base];
    default:return [];
  }
}
// The newest prompt, spend and recorded options, kept as records stream past: the reader keeps only the last rows.
function remember(m,r){if(r.prompt)m.prompt=r.prompt;if(r.usage)m.usage=r;for(const[k,list]of[['mode',OPTIONS.MODES],['effort',OPTIONS.EFFORTS],['context',OPTIONS.CONTEXTS]])if(list.includes(r[k]))m.options[k]=r[k];return m;}
// One prompt can be followed by megabytes of tool output, so a session first seen late may hold its newest prompt and
// spend before the tail. Look back once from the end, bounded, until both are found; options met on the way count too.
const WANTED=/^\{"type":"(?:user\.message|session\.(?:start|resume|model_change|mode_changed?|usage_checkpoint|shutdown))"/;
function lookBack(file,end,max=8*1024*1024){
  const found=[];let fd=null,pos=end,pieces=[];
  const take=parts=>{const head=Buffer.concat(parts,Math.min(80,parts.reduce((n,p)=>n+p.length,0))).toString('latin1');if(!head||head.startsWith('{"type":"')&&!WANTED.test(head))return;try{found.push(...metadata(JSON.parse(Buffer.concat(parts).toString('utf8'))))}catch{}};
  try{fd=fs.openSync(file,'r');
    while(pos>0&&end-pos<max&&!(found.some(r=>r.prompt)&&found.some(r=>r.usage))){
      const n=Math.min(64*1024,pos),b=Buffer.alloc(n);pos-=n;if(fs.readSync(fd,b,0,n,pos)!==n)break;
      let stop=n;for(let i=b.lastIndexOf(10,n-1);i>=0;i=i?b.lastIndexOf(10,i-1):-1){take([b.subarray(i+1,stop),...pieces]);pieces=[];stop=i;}
      pieces.unshift(b.subarray(0,stop));
    }
    if(!pos)take(pieces);
  }catch{/* An unreadable file keeps what the tail found. */}finally{if(fd!==null)fs.closeSync(fd);}
  return found.reverse().reduce(remember,{options:{}});
}
// Copilot holds inuse.<pid>.lock while a process has the session open. When every lock names a dead process the turn it
// was running will never finish; no lock at all decides nothing.
function abandoned(dir){let pids;try{pids=fs.readdirSync(dir).map(n=>/^inuse\.([1-9]\d*)\.lock$/.exec(n)?.[1]).filter(Boolean)}catch{return false}return pids.length>0&&!pids.some(pid=>{try{process.kill(+pid,0);return true}catch(e){return e.code==='EPERM'}});}
// Discovery runs on every list poll. A session whose files have not changed since the last poll reuses what was read
// from it, and one older than the requested days is skipped by its file dates alone, so a PC with hundreds of Copilot
// sessions reads only the ones that are being written.
// foreignPids: the session folders belong to another system (WSL), whose lock files name Linux processes that
// Windows cannot look up; recent turn activity alone tells whether such a session is working.
function createDiscovery({ foreignPids = false } = {}) {
  let noting=null;const reader=new TailReader({parse:r=>{const rows=metadata(r);if(noting)rows.reduce(remember,noting);return rows;},limit:1000}), heads=new Map(), known=new Map(), seen=new Map();
  return function discover(root, days, projectOf=x=>path.basename(x||'')||'Unknown', names=null) {
    const dir=path.join(root,'session-state'),out=[],present=new Set();let entries;try{entries=names?names.map(name=>({name,isDirectory:()=>true})):fs.readdirSync(dir,{withFileTypes:true})}catch{return out}
    const month=Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1);
    for(const e of entries){if(!e.isDirectory())continue;const file=path.join(dir,e.name,'events.jsonl');present.add(file);try{
      const st=fs.statSync(file),yaml=path.join(dir,e.name,'workspace.yaml');let wst=null;try{wst=fs.statSync(yaml);}catch{}
      // The newest file date is never earlier than the session's own last update.
      if(Math.max(st.mtimeMs,wst?.mtimeMs||0)<Date.now()-days*864e5)continue;
      const stamp=[st.size,st.mtimeMs,wst?.size,wst?.mtimeMs,month].join(':');let f=known.get(file);
      if(f?.stamp!==stamp){f=facts(file,st,yaml,month,e.name);f.stamp=stamp;known.set(file,f);}
      if(f.updated<Date.now()-days*864e5)continue;
      if(path.resolve(f.cwd||'.').toLowerCase()===LABEL_DIR)continue; // NEXUS's own label requests
      const group=projectOf(f.cwd),recent=Date.now()-f.updated<10*60e3,busy=recent&&['user.message','assistant.turn_start'].includes(f.state)&&(foreignPids||!abandoned(path.dirname(file)));
      const {stamp:_,state:__,completed,...row}=f;
      out.push({...row,group,groupLabel:group,live:busy,status:busy?'busy':f.error?'error':'done',runState:busy?'active':completed?'complete':'saved',
        statusDetail:f.error||(busy?'Recent Copilot turn activity; external process state is not reported.':'Saved Copilot conversation.')});
    }catch{/* A missing or rotating session must not break discovery. */}}
    for(const file of known.keys())if(!present.has(file)){known.delete(file);heads.delete(file);seen.delete(file);}
    return out;
  };
  // Everything a list row needs from one session's files, except what depends on the current time.
  function facts(file,st,yaml,month,name){
    const w=workspace(yaml);
    // Copilot can write events.jsonl before the first prompt: read the head again until it holds one.
    let first=heads.get(file);if(!first||st.size<first.size||!first.prompt&&first.size<192*1024&&st.size>first.size){const fd=fs.openSync(file,'r'),b=Buffer.alloc(Math.min(st.size,192*1024));try{fs.readSync(fd,b,0,b.length,0)}finally{fs.closeSync(fd)}const rows=b.toString('utf8').split('\n').flatMap(l=>{try{return metadata(JSON.parse(l))}catch{return []}});first={size:st.size,start:rows.find(r=>r.type==='session.start')||{},prompt:rows.find(r=>r.prompt)?.prompt||''};heads.set(file,first);}
    let m=seen.get(file);const fresh=!m||st.size<m.size||st.ino!==m.ino;if(fresh)seen.set(file,m={ino:st.ino,tail:{options:{}}});
    noting=m.tail;let read;try{read=reader.read(file)}finally{noting=null}m.size=st.size;
    if(fresh&&!(m.tail.prompt&&m.tail.usage)&&(read.partial||read.bytesRead<read.size))m.back=lookBack(file,read.size);
    const pick=k=>m.tail[k]||m.back?.[k];
    const rows=read.items,last=rows.at(-1)||{},updated=Math.max(st.mtimeMs,Date.parse(w.updated_at)||0,Date.parse(last.ts)||0);
    const cwd=w.cwd||rows.findLast(r=>r.cwd)?.cwd||first.start.cwd||'';
    const state=rows.findLast(r=>['session.start','session.resume','assistant.turn_start','assistant.turn_end','session.shutdown','session.error','abort','user.message'].includes(r.type))?.type;
    const completed=rows.findLast(r=>['assistant.turn_start','assistant.turn_end','user.message','abort','session.error'].includes(r.type))?.type==='assistant.turn_end';
    // An error is current until the owner asks again or Copilot answers after it.
    const lastError=rows.findLast(r=>r.error),after=Math.max(rows.findLastIndex(r=>r.prompt),rows.findLastIndex(r=>r.type==='assistant.message')),error=lastError&&rows.indexOf(lastError)>after?lastError.error:'';
    const latest=pick('usage'),spend=latest?.usage||{};
    const checkpoints=rows.filter(r=>r.usage),baseline=checkpoints.findLast(r=>Date.parse(r.ts)<month),started=Date.parse(w.created_at||first.start.started||first.start.ts),thisMonth=latest&&Date.parse(latest.ts)>=month;
    const monthPremiumRequests=thisMonth&&Number.isFinite(latest.usage.premiumRequests)&&(started>=month||Number.isFinite(baseline?.usage.premiumRequests))?Math.max(0,latest.usage.premiumRequests-(baseline?.usage.premiumRequests||0)):null;
    const fleet=new Map();for(const r of rows)if(r.fleet?.id)fleet.set(r.fleet.id,{...fleet.get(r.fleet.id),...r.fleet,label:r.fleet.label||fleet.get(r.fleet.id)?.label||'Subagent'});
    const options={...m.back?.options,...m.tail.options};
    return {kind:'copilot',id:w.id||name,file,cwd,title:w.name?.split('\n').find(l=>l.trim())?.trim()||first.prompt.slice(0,80)||'Copilot session',
      firstPrompt:first.prompt,lastPrompt:pick('prompt')||first.prompt,lastText:rows.findLast(r=>r.reply)?.reply||'',latestContext:error||rows.findLast(r=>r.reply)?.reply||'',
      recentTools:[...new Set(rows.flatMap(r=>r.tools||[]))].slice(-8),branch:w.branch||first.start.branch||'',model:rows.findLast(r=>r.model)?.model||first.start.model||'',modelAt:Date.parse(rows.findLast(r=>r.model)?.ts)||0,
      started:w.created_at||first.start.started||first.start.ts,updated,size:st.size,state,completed,
      error,errorType:error?lastError.errorType:'',copilotUsage:{...spend,monthPremiumRequests},copilotOptions:options,copilotQuota:rows.findLast(r=>r.quota)?.quota||null,copilotFleet:[...fleet.values()]};
  }
}
module.exports={events,dedupe,toolEvent,toolName,input,text,usage,modifiedFiles,workspace,metadata,createDiscovery};
