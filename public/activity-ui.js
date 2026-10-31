'use strict';
function nxSubagentState(n){const state=NexusSubagents.state(n.state);return `<span class="nx-delegation-state" data-state="${state}"><i></i>${state}</span>`;}
function nxSubagentRows(rows){return `<div class="nx-subagents">${rows.map(n=>{
 const state=NexusSubagents.state(n.state),active=NexusSubagents.active(n),duration=active&&n.startedAt?Math.max(0,Date.now()-n.startedAt):n.durationMs,meta=[Number.isFinite(duration)?(duration<60000?Math.round(duration/1000)+'s':span(duration)):'',n.kind!=='background'&&Number.isFinite(n.toolCount)?n.toolCount+' tool'+(n.toolCount===1?'':'s'):'',Number.isFinite(n.tokens)?n.tokens.toLocaleString()+' tokens':''].filter(Boolean).join(' · ');
 return `<details class="nx-subagent ${n.kind==='background'?'nx-background':''}" data-disclosure="subagent-${esc(n.id)}" data-subagent-id="${esc(n.id)}" data-state="${state}" ${active?'open':''}><summary><span class="nx-subagent-type">${esc(n.agentType||'Agent')}${n.kind==='astra'?'<small>delegated</small>':''}</span><strong>${esc(n.task||n.label||'Delegated task')}</strong>${nxSubagentState(n)}<small>${esc(meta)}</small></summary><div class="nx-subagent-steps">${n.lastStep&&!n.steps?.length?`<p class="nx-subagent-last">${esc(n.lastStep)}</p>`:''}${n.sessionKey?`<button class="text-action" data-open="${esc(n.sessionKey)}">Open Astra activity →</button>`:''}${n.steps?.length?`<ol>${n.steps.map(step=>`<li data-step-id="${esc(step.id)}"><span>${esc(step.text)}</span>${step.ts?`<time>${clockTime(step.ts)}</time>`:''}</li>`).join('')}</ol>`:!n.sessionKey&&active&&!n.lastStep?'<p class="nx-coverage">Waiting for recorded steps.</p>':''}</div></details>`;
 }).join('')}</div>`;}
function nxDelegatedTools(items){return items.map(i=>`<section class="nx-delegated-step" data-activity-step="${esc(i.id)}"><div class="nx-parent-step">${nxIcon('branch')}<span>${i.earlierDelegation?'Earlier: ':''}${esc(NexusActivity.describe([i.human||NexusActivity.tool(i.name,i.input||i.text)]))}</span><time>${clockTime(i.ts)}</time></div>${i.subagents?.length?nxSubagentRows(i.subagents):`<p class="nx-coverage">${esc(NexusActivity.sentence(i.res?.text||i.text,180))}</p>`}</section>`).join('');}
const nxActivityStatus=nxStatus;
nxStatus=function(s){const badge=nxActivityStatus(s);return badge+(s.activeSubagents&&statusLabel(s)[0]==='busy'?`<span class="nx-subagent-count">${s.activeSubagents} sub-agent${s.activeSubagents===1?'':'s'}</span>`:'');};
const nxActivityFleet=nxRenderFleet;
nxRenderFleet=function(s){
 if(!s.copilotFleet?.length){$('#nxCopilotFleet')?.remove();return;}
 if(!$('#nxCopilotFleet'))nxActivityFleet(s);const host=$('#nxCopilotFleet');if(!host)return;
 const list=s.copilotFleet||[],done=list.filter(n=>NexusSubagents.state(n.state)==='done').length;
 updateHTML(host,`<details data-disclosure="copilot-fleet"><summary>${nxCopilotMark()}Fleet · ${done}/${list.length} done</summary><ul>${list.map(n=>`<li>${nxIcon('branch')}<span>${esc(n.label||'Agent')}</span>${nxSubagentState(n)}</li>`).join('')}</ul><div class="nx-meter"><i style="width:${list.length?done/list.length*100:0}%"></i></div></details>`);
};
// Animate only measured changes. Polling the same state never repeats a pulse.
const NexusActivityMotion=(()=>{
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),running=new Set(),ease='cubic-bezier(.22,1,.36,1)';
 const animated=(el,frames,duration=200)=>{if(!el||reduced.matches||!el.getClientRects().length)return;const a=el.animate(frames,{duration,easing:ease});running.add(a);a.finished.catch(()=>{}).finally(()=>running.delete(a));return a;};
 const identity=el=>el.dataset.sessionKey||el.querySelector('[data-open],[data-nx-open]')?.dataset.open||el.querySelector('[data-nx-open]')?.dataset.nxOpen;
 const selector='.nx-home-card,.nx-wall-tile,.nx-board-tile,.nx-session-row,.nx-phone-row,.nx-recent';
 function snapshot(host){
  const rows=new Map();for(const el of host.querySelectorAll(selector)){if(!el.getClientRects().length)continue;const key=identity(el);if(key)rows.set(key,{rect:el.getBoundingClientRect(),status:el.querySelector('.status')?.className,badge:el.querySelector('.status')?.cloneNode(true)});}
  const selected=host.querySelector('.nx-theme-rail-row.selected');
  return {rows,rail:selected?.getBoundingClientRect(),railId:selected?.dataset.themeDrop,children:new Map([...host.querySelectorAll('[data-subagent-id]')].map(el=>[el.dataset.subagentId,{state:el.dataset.state,open:el.open}]))};
 }
 function pulse(el){
  if(!el||reduced.matches||!el.getClientRects().length)return;
  const ring=document.createElement('i');ring.className='nx-completion-pulse';ring.setAttribute('aria-hidden','true');el.append(ring);
  const a=animated(ring,[{opacity:0,transform:'scale(.985)'},{opacity:.85,transform:'scale(1)',offset:.25},{opacity:0,transform:'scale(1.035)'}],650);if(a)a.finished.catch(()=>{}).finally(()=>ring.remove());else ring.remove();
 }
 function apply(host,before){
  let completed=false;const moves=[];
  for(const el of host.querySelectorAll(selector)){
   const old=before.rows.get(identity(el));if(!old||!el.getClientRects().length)continue;
   const rect=el.getBoundingClientRect(),status=el.querySelector('.status');
   if(host.id==='wall'&&(Math.abs(old.rect.x-rect.x)>1||Math.abs(old.rect.y-rect.y)>1))moves.push([el,old.rect.x-rect.x,old.rect.y-rect.y]);
   if(status&&old.status!==status.className){
    animated(status,[{opacity:.25,transform:'translateY(3px) scale(.96)'},{opacity:1,transform:'none'}]);
    if(old.badge&&!reduced.matches){const copy=old.badge,r=status.getBoundingClientRect();copy.classList.add('nx-status-previous');copy.style.cssText=`position:fixed;left:${r.x}px;top:${r.y}px`;copy.setAttribute('aria-hidden','true');document.body.append(copy);const a=animated(copy,[{opacity:.7,transform:'translateY(0)'},{opacity:0,transform:'translateY(-5px)'}]);a?.finished.catch(()=>{}).finally(()=>copy.remove());}
    if(status.classList.contains('done')&&/\b(busy|ready)\b/.test(old.status||'')){pulse(el);completed=true;}
   }
  }
  for(const [el,x,y]of moves)animated(el,[{transform:`translate(${x}px,${y}px)`},{transform:'none'}]);
  const selected=host.querySelector('.nx-theme-rail-row.selected');
  if(selected&&before.rail&&before.railId!==selected.dataset.themeDrop&&!reduced.matches){const rect=selected.getBoundingClientRect(),glide=document.createElement('i');glide.className='nx-rail-glide';glide.setAttribute('aria-hidden','true');selected.append(glide);const a=animated(glide,[{transform:`translateY(${before.rail.y-rect.y}px)`,opacity:.65},{transform:'none',opacity:1}]);a?.finished.catch(()=>{}).finally(()=>glide.remove());}
  for(const el of host.querySelectorAll('[data-subagent-id]')){
   const old=before.children.get(el.dataset.subagentId);
   if(old)el.open=old.open;
   if(!old)animated(el,[{opacity:0,transform:'translateX(-10px)'},{opacity:1,transform:'none'}]);
   else if(old.state!==el.dataset.state){
    if(el.dataset.state==='done'&&old.open&&!el.contains(document.activeElement)){
     const body=el.querySelector('.nx-subagent-steps'),a=animated(body,[{opacity:1,transform:'none'},{opacity:0,transform:'translateX(-8px)'}]);if(a)a.finished.catch(()=>{}).finally(()=>{if(el.isConnected)el.open=false;});else el.open=false;pulse(el);
    }else animated(el.querySelector('.nx-delegation-state'),[{opacity:.2,transform:'translateY(3px)'},{opacity:1,transform:'none'}]);
   }
  }
  if(completed)document.querySelectorAll('#nxFleet,.nx-phone-home-head .nx-core').forEach(pulse);
 }
 reduced.addEventListener('change',()=>{if(reduced.matches){for(const a of running)a.cancel();document.querySelectorAll('.nx-completion-pulse,.nx-status-previous,.nx-rail-glide').forEach(e=>e.remove());}});
 return {snapshot,apply,pulse,animated};
})();
const nxActivityUpdate=updateHTML;
updateHTML=function(host,html){
 if(host._html===html)return;
 const tracked=['cards','wall','nxHome','nxPage','chatMessages'].includes(host.id),before=tracked?NexusActivityMotion.snapshot(host):null;
 const messages=host.id==='chatMessages'?new Set([...host.children].map(e=>e.dataset.disclosure||e.dataset.activityStep||e.textContent)):null;
 nxActivityUpdate(host,html);
 if(before)NexusActivityMotion.apply(host,before);
 if(messages?.size)for(const el of host.children)if(!messages.has(el.dataset.disclosure||el.dataset.activityStep||el.textContent)&&!el.matches('.nx-delegated-step'))NexusMotion.enter(el,200,0,'translateY(5px)');
};

const nxActivitySummary=nxSummary;
nxSummary=function(s){return nxActivitySummary(s)+(s.subagentsIndexing?'<div class="nx-loading-lines" role="status" aria-label="Reading sub-agent activity"><i></i><i></i></div>':s.subagentsPartial?'<p class="nx-coverage">Showing the available sub-agent activity. Older records may be outside this view.</p>':'');};
