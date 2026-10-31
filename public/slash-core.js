// Shared command parsing and receipt rules. No CLI execution or filesystem access.
(function (root) {
  'use strict';
  const ending = new Set(['exit','quit','logout','restart','update','background','bg','archive','delete']);
  const destructive = new Set(['clear','reset','new','rewind','undo','checkpoint','reset-allowed-tools']);
  function parse(text) {
    if (typeof text !== 'string') return null;
    const match = /^\/([\w][\w:.-]*)(?=\s|$)([\s\S]*)$/.exec(text);
    return match ? { name:match[1], args:match[2].trim(), text } : null;
  }
  function risk(command) {
    if (!command) return '';
    command={...command,name:command.name.toLowerCase()};
    if (ending.has(command.name)) return 'session-ending';
    if (destructive.has(command.name) || /^(?:delete|remove|uninstall|clear|reset|rewind|undo|kill|stop|off)\b/i.test(command.args) && /^(?:session|sessions|goal|memory|memories|tasks|plugin|plugins|skills|mcp|remote)$/.test(command.name)) return 'destructive';
    if (command.name === 'stop') return 'destructive';
    return '';
  }
  function handling(entry, command) {
    if (!command) return 'prompt';
    if (entry?.native && (!command.args || entry.source === 'NEXUS')) return 'native:' + entry.native;
    return entry?.kind === 'menu' && !command.args ? 'terminal-menu' : 'terminal';
  }
  function filter(entries, text) {
    if (!/^\/[\w:.-]*$/.test(text)) return [];
    const query=text.slice(1).toLowerCase();
    return entries.filter(e => e.name.toLowerCase().startsWith(query));
  }
  const categories=[['session','Session','sessions'],['model','Model & mode','model'],['context','Context & memory','brain'],['code','Code & review','branch'],['tools','Tools & MCP','terminal'],['account','Account','user'],['custom','Custom & skills','sparkles']];
  const categoryNames={
    session:'help clear reset new resume fork branch rename title exit quit archive delete background bg remote-control remote tasks bashes status pwd cwd cd export copy raw rewind undo checkpoint',
    model:'model plan effort fast auto autopilot interactive mode permissions approvals approve allowed-tools reset-allowed-tools sandbox setup-default-sandbox sandbox-add-read-dir advisor auto-mode-setup',
    context:'compact autocompact context memory memories add-dir mention init recap forget remember',
    code:'review code-review diff pr-review security-review autofix-pr simplify batch',
    tools:'mcp plugin plugins hooks agent agents tools skills import ide terminal-setup keymap vim experimental',
    account:'login logout usage cost stats account status doctor feedback bug upgrade update settings config theme color statusline'
  };
  function category(entry){
    if(entry.category&&categories.some(c=>c[0]===entry.category))return entry.category;
    if(entry.source&&entry.source!=='built-in')return 'custom';
    return Object.keys(categoryNames).find(k=>categoryNames[k].split(' ').includes(entry.name))||'custom';
  }
  const behaviorLabels={run:'runs now',control:'opens NEXUS control',text:'needs text',confirm:'asks to confirm'};
  function decorate(entry,agent){
    const native=entry.native||(entry.name==='plan'?'plan':'');
    const behavior=risk(parse('/'+entry.name))?'confirm':native==='handoff'?'run':native?'control':entry.kind==='args'&&entry.argsHint&&!/optional/i.test(entry.argsHint)?'text':'run';
    const invocation=entry.invocation||'/'+entry.name;
    const sample=(entry.argsHint||'').replace(/<([^>]+)>|\[([^\]]+)\]/g,(_,required,optional)=>required||optional).replace(/\bpath\b/g,'src/app.js').replace(/instructions|prompt|question/g,'Review the recent changes');
    return {...entry,native,agent,category:category(entry),behavior,detail:entry.description,example:invocation+(behavior==='text'&&sample?' '+sample:''),nexus:behavior==='confirm'?'Asks you to confirm before sending this command to the session. Cancel changes nothing.':native==='plan'?(agent==='copilot'?'Opens the Copilot mode control. The saved mode applies on next start or resume.':'Hands planning mode to the terminal drawer. Finish or cancel it to return to Chat.'):native==='handoff'?'NEXUS turns the setting on or off (no word switches it). Nothing is sent to the session.':native?'Opens the existing NEXUS '+native+' control.':entry.invocation?.startsWith('$')?'Adds the discovered skill invocation to your message. The agent reads the skill when you send.':entry.kind==='menu'?'Opens this CLI command in the terminal drawer. Finish or cancel it to return to Chat.':behavior==='text'?'Completes the command in your composer so you can supply its text before sending.':'Sends the command when the session is ready, and shows the result when the agent reports it.'};
  }
  function score(entry,query){
    const q=query.toLowerCase().replace(/^\//,''),name=entry.name.toLowerCase();if(!q)return 0;
    if(name===q)return 1000;if(name.startsWith(q))return 800-q.length/100;
    if(name.includes(q))return 600-name.indexOf(q);
    let at=-1,gaps=0;for(const char of q){const next=name.indexOf(char,at+1);if(next<0){gaps=-1;break;}gaps+=next-at-1;at=next;}
    if(gaps>=0)return 400-gaps;
    return (entry.description+' '+entry.argsHint).toLowerCase().includes(q)?100:-1;
  }
  function rank(entries,query='',usage={},agent=''){
    const stats=usage[agent]||{},latest=Math.max(0,...Object.values(stats).map(s=>s.at||0));
    const usageScore=s=>s.count?Math.log2(s.count+1)*10+30/(1+Math.max(0,latest-(s.at||0))/86400000):0;
    return entries.map((entry,index)=>({entry,index,match:score(entry,query),used:stats[entry.invocation||entry.name]||{}})).filter(r=>r.match>=0).sort((a,b)=>b.match-a.match||usageScore(b.used)-usageScore(a.used)||(b.used.at||0)-(a.used.at||0)||a.index-b.index).map(r=>r.entry);
  }
  function groups(entries,query='',usage={},agent='',selected='all'){
    const ranked=rank(entries.filter(e=>selected==='all'||category(e)===selected),query,usage,agent),out=[],seen=new Set();
    if(!query&&selected==='all'){
      const recent=ranked.filter(e=>usage[agent]?.[e.invocation||e.name]?.count).slice(0,5);
      if(recent.length){out.push({id:'recent',label:'Recent & most used',icon:'history',items:recent});recent.forEach(e=>seen.add(e));}
    }
    const order=query?[...new Set(ranked.map(category))]:categories.map(c=>c[0]);
    for(const id of order){const items=ranked.filter(e=>category(e)===id&&!seen.has(e));if(items.length){const c=categories.find(c=>c[0]===id);out.push({id,label:c[1],icon:c[2],items});}}
    return out;
  }
  function recordUsage(usage,agent,entry,at=Date.now()){
    const key=entry.invocation||entry.name,stats={...usage[agent]},old=stats[key]||{};stats[key]={count:(old.count||0)+1,at};
    return {...usage,[agent]:Object.fromEntries(Object.entries(stats).sort((a,b)=>b[1].at-a[1].at).slice(0,100))};
  }
  function claudeRecord(record) {
    if (record?.isSidechain || !(record?.type==='user'||record?.type==='system'&&record?.subtype==='local_command')) return [];
    const content=record.type==='system'?record.content:record.message?.content;
    const texts=typeof content==='string'?[content]:Array.isArray(content)?content.filter(p=>p.type==='text').map(p=>p.text||''):[];
    return texts.flatMap(text=>{
      const command=/<command-name>([^<]+)<\/command-name>/.exec(text);
      const output=/<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/.exec(text);
      if(command){const args=/<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]||'';return [{t:'cmd',id:record.uuid,ts:record.timestamp,text:(command[1]+' '+args).trim()}];}
      if(output)return [{t:'cmd-output',id:record.uuid,ts:record.timestamp,text:output[2].slice(0,12000),err:output[1]==='stderr'}];
      return [];
    });
  }
  function transcriptReceipt(receipt, events) {
    // Match only records created for this attempt. Earlier identical commands do not count.
    const fresh=events.filter(e=>Date.parse(e.ts)>=receipt.submittedAt&&(!receipt.supersededAt||Date.parse(e.ts)<receipt.supersededAt));
    const index=fresh.findIndex(e=>(e.t==='cmd'||e.t==='user')&&e.text?.trim()===receipt.text.trim());
    if(index<0)return null;
    const output=[];
    for(const event of fresh.slice(index+1)){if(['cmd','user','ai'].includes(event.t))break;if(event.t==='cmd-output')output.push(event);}
    return {status:output.some(e=>e.err)?'rejected':'acknowledged',evidence:'transcript',output:output.map(e=>e.text).join('\n').slice(0,12000)};
  }
  const clean = text => String(text||'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
  function screenReceipt(receipt, {screen, ready, menu, busy, exited, settled, changed}) {
    if(!receipt.submittedAt)return null;
    const command=parse(receipt.text), current=clean(screen);
    const before=new Map();for(const line of clean(receipt.before).split('\n').map(l=>l.trim()).filter(Boolean))before.set(line,(before.get(line)||0)+1);
    const echo=new RegExp('^[\\u276f\\u203a>❯]\\s*'+receipt.text.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$');
    const delta=current.split('\n').map(l=>l.trim()).filter(l=>{if(before.get(l)){before.set(l,before.get(l)-1);return false;}return l&&!echo.test(l)&&l!==receipt.text.trim()&&!/^[\s\u2500-\u259f]+$/.test(l);});
    const output=delta.filter(l=>!/[?] for shortcuts|context left|esc to interrupt|^[\u276f\u203a>]\s*(?:Ask Codex to do anything)?$|[◐◑◒◓].*\/effort|^← open sidebar|^\s*\S+\s+(?:default|low|medium|high|xhigh)\s+·|^\s*\d+\s+tokens?\b/i.test(l)).join('\n').slice(0,12000);
    if(exited && command && (ending.has(command.name)||receipt.kind==='session-ending') && exited.code===0)return {status:'acknowledged',output,evidence:'terminal-exit'};
    if (!changed) return null;
    if(settled && /(?:unknown|unrecognized|invalid|not found|not supported) (?:slash )?command|command .{0,80}(?:not found|not supported)|Unrecognized command/i.test(output))return {status:'rejected',output,evidence:'terminal'};
    if(settled && menu)return {status:'menu',output:'',evidence:'terminal'};
    // Input echo and a redraw alone are not evidence that a command ran.
    const lastPrompt=current.split('\n').findLast(l=>/^\s*[\u276f\u203a>]\s*/.test(l))?.trim()||'';
    if(settled && ready && !busy && output && !echo.test(lastPrompt))return {status:'acknowledged',output,evidence:'terminal'};
    return null;
  }
  const api={parse,risk,handling,filter,categories,category,behaviorLabels,decorate,rank,groups,recordUsage,claudeRecord,transcriptReceipt,screenReceipt};
  if(typeof module==='object')module.exports=api;else root.NexusSlash=api;
})(typeof window==='object'?window:globalThis);
