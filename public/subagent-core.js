(function(root){
 'use strict';
 const states=['delegated','working','waiting','messaged','interrupted','cancelled','done'];
 function state(value,fallback='delegated'){
  const v=String(value||'').toLowerCase();
  if(states.includes(v))return v;
  return ({running:'working',busy:'working',active:'working',started:'working',in_progress:'working',async_launched:'working',pending:'delegated',queued:'delegated',idle:'waiting',needs_input:'waiting',waiting_permission:'waiting',completed:'done',complete:'done',success:'done',failed:'interrupted',error:'interrupted',aborted:'interrupted',killed:'cancelled',stopped:'cancelled',canceled:'cancelled',shutdown:'cancelled'})[v]||fallback;
 }
 const active=n=>['delegated','working','waiting','messaged'].includes(state(n.state));
 function session(s){return s.runState==='complete'?'done':s.runState==='interrupted'?'interrupted':s.needsInput?'waiting':s.status==='busy'?'working':s.live?'waiting':state(s.runState,'waiting');}
 // Claude Code writes a task notification as a user record when idle, and as a queued_command attachment when it lands mid-turn.
 function notification(r){
  const a=r?.type==='attachment'&&r.attachment,c=a?(a.type==='queued_command'&&a.commandMode==='task-notification'?a.prompt:''):r?.type==='user'?r.message?.content:'';
  const s=typeof c==='string'?c:Array.isArray(c)?c.filter(p=>p.type==='text').map(p=>p.text||'').join('\n'):'';
  return s.trimStart().startsWith('<task-notification>')?s:'';
 }
 const api={states,state,active,session,notification};if(typeof module==='object'&&module.exports)module.exports=api;else root.NexusSubagents=api;
})(typeof globalThis==='object'?globalThis:this);
