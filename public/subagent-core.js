(function(root){
 'use strict';
 const states=['delegated','working','waiting','messaged','interrupted','cancelled','done'];
 function state(value,fallback='delegated'){
  const v=String(value||'').toLowerCase();
  if(states.includes(v))return v;
  return ({running:'working',busy:'working',active:'working',started:'working',in_progress:'working',pending:'delegated',queued:'delegated',idle:'waiting',needs_input:'waiting',waiting_permission:'waiting',completed:'done',complete:'done',success:'done',failed:'interrupted',error:'interrupted',aborted:'interrupted',killed:'cancelled',canceled:'cancelled',shutdown:'cancelled'})[v]||fallback;
 }
 const active=n=>['delegated','working','waiting','messaged'].includes(state(n.state));
 function session(s){return s.runState==='complete'?'done':s.runState==='interrupted'?'interrupted':s.needsInput?'waiting':s.status==='busy'?'working':s.live?'waiting':state(s.runState,'waiting');}
 const api={states,state,active,session};if(typeof module==='object'&&module.exports)module.exports=api;else root.NexusSubagents=api;
})(typeof globalThis==='object'?globalThis:this);
