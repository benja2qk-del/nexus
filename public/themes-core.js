(function(root){
 'use strict';
 const key=s=>s.kind+':'+s.id, themeId=s=>s.theme?.id||'unsorted';
 const rank=s=>s.needsInput||['waiting','waiting_permission','needs_input'].includes(s.status)?0:s.status==='busy'?1:s.runState==='complete'?2:3;
 function groups(themes,sessions,{archived=false,rankOf=rank}={}){
  const map=new Map(themes.map(t=>[t.id,{...t,sessions:[]}]));
  map.set('unsorted',{id:'unsorted',name:'Unsorted',color:null,sessions:[]});
  for(const s of sessions)(map.get(themeId(s))||map.get('unsorted')).sessions.push(s);
  for(const t of map.values()){
   t.sessions.sort((a,b)=>rankOf(a)-rankOf(b)||b.updated-a.updated);
   t.needs=t.sessions.filter(s=>rankOf(s)===0).length;t.working=t.sessions.filter(s=>rankOf(s)===1).length;
   t.updated=Math.max(0,...t.sessions.map(s=>s.updated||0));t.count=t.sessions.length;
  }
  return [...map.values()].filter(t=>(archived||!t.archived)&&(t.id!=='unsorted'||t.count)).sort((a,b)=>Number(b.id==='unsorted')-Number(a.id==='unsorted')||Number(!!b.pinned)-Number(!!a.pinned)||b.updated-a.updated||a.name.localeCompare(b.name));
 }
 // Every key occurs once, including missing parents, arbitrary depth and cycles.
 function tree(sessions){
  const map=new Map(sessions.map(s=>[key(s),s])),done=new Set(),out=[];
  const visit=(s,depth)=>{const k=key(s);if(done.has(k))return;done.add(k);out.push({session:s,depth});for(const c of sessions)if(c.parent?.key===k)visit(c,depth+1);};
  sessions.filter(s=>!map.has(s.parent?.key)||s.parent?.key===key(s)).forEach(s=>visit(s,0));
  sessions.forEach(s=>visit(s,0));return out;
 }
 function finder(query,themes,sessions,scope=null){
  const words=String(query).toLowerCase().trim().split(/\s+/).filter(Boolean),q=words.join(' ');
  const score=fields=>words.every(w=>fields.some(([v])=>String(v||'').toLowerCase().includes(w)))?fields.reduce((n,[v,weight])=>n+words.reduce((m,w)=>m+(String(v||'').toLowerCase().includes(w)?weight:0),0),0):0;
  const ts=themes.filter(t=>!t.archived).map(t=>({kind:'theme',id:t.id,label:t.name,score:score([[t.name,10],[t.purpose,4],[t.mainFolder,1]])+(t.name.toLowerCase()===q?20:0)})).filter(t=>!q||t.score>0).sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label));
  const ss=sessions.filter(s=>!scope||themeId(s)===scope).map(s=>({kind:'session',id:key(s),label:s.title,session:s,score:score([[s.title,8],[s.purpose||s.firstPrompt,4],[s.touchedFiles?.join(' '),3],[s.workFolders?.map(f=>f.path).join(' '),2],[s.cwd,1],[s.theme?.name,2],[s.searchText,1]])})).filter(s=>!q||s.score>0).sort((a,b)=>b.score-a.score||b.session.updated-a.session.updated);
  return [...(scope?[]:ts),...ss];
 }
 function toggle(selected,id){const next=new Set(selected);next.has(id)?next.delete(id):next.add(id);return next;}
 function dragKeys(raw,known){try{const a=JSON.parse(raw);return Array.isArray(a)&&a.length<=500?[...new Set(a.filter(k=>typeof k==='string'&&known.has(k)))]:[];}catch{return [];}}
 function running(s,terms=[]){const keys=new Set([key(s),...(s.aliases||[])]);return !!s.live||s.status==='busy'||terms.some(t=>!t.exited&&keys.has(t.sessionKey));}
 class HoldGesture{
  constructor({delay=450,threshold=10}={}){this.delay=delay;this.threshold=threshold;}
  start(x,y,at,id=1){this.point={x,y,at,id};this.fired=false;}
  move(x,y,id=1){if(this.point&&(this.point.id!==id||Math.hypot(x-this.point.x,y-this.point.y)>this.threshold))this.cancel();}
  ready(at){return !!this.point&&!this.fired&&at-this.point.at>=this.delay;}
  fire(at){if(!this.ready(at))return false;this.fired=true;return true;}
  cancel(){this.point=null;}
 }
 function spend(sessions){let dollars=0,priced=0,premium=0,reported=0,credits=0,creditReported=0;
  for(const s of sessions){if(s.kind==='copilot'){const u=s.copilotUsage||{};if(Number.isFinite(u.premiumRequests)){premium+=u.premiumRequests;reported++;}if(Number.isFinite(u.aiCredits)){credits+=u.aiCredits;creditReported++;}}
   else{const c=s.insights?.spend?.costUSD??s.costUSD;if(Number.isFinite(c)){dollars+=c;priced++;}}}
  return {dollars,priced,premium,reported,credits,creditReported};
 }
 const api={key,themeId,rank,groups,tree,finder,toggle,dragKeys,running,HoldGesture,spend};
 if(typeof module==='object')module.exports=api;else root.NexusThemes=api;
})(typeof window==='object'?window:globalThis);
