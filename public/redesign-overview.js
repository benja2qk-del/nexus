'use strict';
function nxUsage(compact=false){
 const usage=state.usage||{},groups=[];
 for(const kind of ['claude','astra','copilot']){
  const u=usage[kind];if(!u)continue;
  const week=u.week||[u.primary,u.secondary].find(w=>w?.minutes>=7*24*60);
  const windows=kind==='claude'?[['5h',u.fiveHour],['Week',u.week]]:kind==='astra'?[['Week',week]]:[['Month',u.month]];
  const meters=windows.filter(([,w])=>Number.isFinite(w?.pct)).map(([label,w])=>{
   const pct=Math.max(0,Math.min(100,w.pct)),stale=w.resetsAt&&w.resetsAt<Date.now();
   return `<div class="nx-usage"><div><span>${label}</span><b>${Math.round(pct)}%${stale?'*':''}</b></div><div class="nx-meter ${pct>=85?'hot':pct>=60?'warn':''}" role="meter" aria-label="${agentName(kind)} ${label} usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>${!compact&&w.resetsAt?`<small>${stale?'Previous reading · refresh pending':'Resets in '+span(w.resetsAt-Date.now())}</small>`:''}</div>`;
  });
  if(kind==='copilot'&&Number.isFinite(u.premiumRequests))meters.push(`<div class="nx-usage nx-premium"><div><span>Premium requests</span><b>${u.premiumRequests}</b></div><small>${u.month?'Month':'Recorded sessions'}</small></div>`);
  if(meters.length)groups.push(`<div class="nx-usage-group" data-usage-agent="${kind}"><span class="nx-agent-name ${kind}">${nxAgent({kind},'dot')}${agentName(kind)}</span><div class="nx-usage-windows">${meters.join('')}</div></div>`);
 }
 return groups.join('');
}
function nxHomeCard(s){
 const cls=statusLabel(s)[0],need=cls==='ready',working=cls==='busy',purpose=nxPurpose(s);
 return `<article class="nx-home-card press ${need?'needs needs-border':''} ${working?'working':''}"><button class="nx-card-open" data-open="${esc(keyOf(s))}" data-session-key="${esc(keyOf(s))}" aria-label="Open ${esc(s.title)}"><span class="nx-card-top">${nxAgent(s)}<span class="nx-card-project" title="${esc(s.theme?.name||'Unsorted')}">${nxThemeLabel(s)}</span><time>· ${ago(s.updated)}</time>${nxModel(s)}</span><span class="nx-card-title">${esc(s.title)}</span><span class="nx-card-purpose">${esc(purpose===s.title||purpose===sessionPreview(s)?'':purpose)}</span><span class="nx-card-latest">${need?'<span class="nx-question-glyph">ⓘ</span>':''}${esc(sessionPreview(s))}</span></button><footer class="nx-card-foot">${nxStatus(s)}${need?'<span>Open and answer →</span>':nxSpend(s)?`<small>${nxSpend(s)}</small>`:''}${NexusCall.button(keyOf(s))}</footer>${working?'<span class="data-stream nx-header-stream"></span>':''}</article>`;
}
function nxPhoneRow(s){return `<button class="nx-phone-row" data-open="${esc(keyOf(s))}" data-session-key="${esc(keyOf(s))}"><i class="nx-dot ${statusLabel(s)[0]}"></i><span class="nx-phone-row-content"><span class="nx-row-title"><strong>${esc(s.title)}</strong><time>${ago(s.updated)}</time></span><span class="nx-row-context">${esc(sessionPreview(s))}</span><span class="nx-row-meta">${nxStatus(s)}<span class="nx-muted">· ${nxThemeLabel(s)}</span>${nxModel(s)}</span></span></button>`;}
function nxRecent(s){const purpose=nxPurpose(s);return `<button class="nx-recent" data-open="${esc(keyOf(s))}" data-session-key="${esc(keyOf(s))}">${nxStatus(s)}<span><strong>${esc(s.title)}</strong><small>${nxThemeLabel(s)}${purpose!==s.title?`<span>${esc(purpose)}</span>`:''}</small></span><span class="nx-recent-context">${esc(sessionPreview(s))}</span><span class="nx-recent-model">${s.model?nxModel(s):''}</span><small>${nxSpend(s)||''}</small><time>${ago(s.updated)}</time></button>`;}
// Cached core markup keeps Home's HTML stable between polls, so it is rebuilt only when something changed.
const nxCores={},nxCore=slot=>nxCores[slot]||=Prism.markup();
// Home on a PC: a greeting, the latest themes circling the core, what needs you, then recent work newest first.
// The theme list itself lives in the sidebar, so Home does not repeat it.
const NX_ORBIT_SECONDS=150,NX_SAT_SECONDS=48;
function nxGreeting(){const h=new Date().getHours();return h<5?'Working late.':h<12?'Good morning.':h<19?'Good afternoon.':'Good evening.';}
function nxSince(t){const a=ago(t);return a==='now'?'just now':a+' ago';}
function nxOrbit(themes,active){
 const core=active.some(s=>statusLabel(s)[0]==='ready')?'needs':active.length?'working':'idle';
 const nodes=themes.map((t,i)=>`<div class="nx-orbit-arm" style="--i:${i};--n:${themes.length}"><button class="nx-orbit-node ${t.needs?'needs':t.working?'working':''} ${nxThemes.selected===t.id?'selected':''}" data-theme-pick="${esc(t.id)}" data-orbit-detail="${i}" aria-describedby="nxOrbitDetail${i}" aria-pressed="${nxThemes.selected===t.id}" aria-label="${esc(t.name)}: ${t.count} session${t.count===1?'':'s'}${t.needs?`, ${t.needs} need you`:''}${t.working?`, ${t.working} working`:''}">${nxThemeTick(t)}<span><b>${esc(t.name)}</b><small>${t.count}</small></span></button></div>`).join('');
 // Satellites repeat sessions already available below; keep them decorative, with status in words on the cards.
 const sats=active.slice(0,8).map((s,i,list)=>`<div class="nx-orbit-arm" style="--i:${i};--n:${list.length}"><span class="nx-orbit-sat ${statusLabel(s)[0]}"></span></div>`).join('');
 const details=themes.map((t,i)=>`<div class="nx-orbit-detail" id="nxOrbitDetail${i}" hidden><div><b>${esc(t.name)}</b><small>${[t.needs?`${t.needs} need${t.needs===1?'s':''} you`:'',t.working?`${t.working} working`:''].filter(Boolean).join(' · ')||`${t.count} session${t.count===1?'':'s'}`}</small></div><p>${esc(nxThemeContext(t))}</p></div>`).join('');
 return `<div class="nx-orbit-panel"><div class="nx-orbit" role="group" aria-label="Latest ${themes.length} themes"><svg class="nx-orbit-rings" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="50" cy="50" rx="28" ry="36"/><ellipse cx="50" cy="50" rx="15" ry="20"/></svg><span class="nx-orbit-core nx-core" data-state="${core}" aria-hidden="true">${nxCore('home')}</span><div class="nx-orbit-track nx-orbit-inner" aria-hidden="true">${sats}</div><div class="nx-orbit-track nx-orbit-outer">${nodes}</div></div><div class="nx-orbit-details"><p class="nx-orbit-hint">Your ${themes.length} latest theme${themes.length===1?'':'s'}<span>Choose a theme to see its sessions.</span></p>${details}</div></div>`;
}
// A rebuilt orbit starts where the old one was, so the nodes never jump back.
// Arms rotate inside a track squashed to the ellipse and each label turns back, so the orbit is pure transform work for the compositor.
const nxOrbitSize=new ResizeObserver(entries=>{for(const {target,contentRect:r}of entries)if(r.width&&r.height)for(const [ring,rx,ry]of [['outer',.28,.36],['inner',.15,.20]]){const k=ry*r.height/(rx*r.width);target.style.setProperty('--k-'+ring,k.toFixed(4));target.style.setProperty('--ik-'+ring,(1/k).toFixed(4));}});
function nxPhaseOrbit(){
 const orbit=$('#nxHome .nx-orbit');if(orbit===nxPhaseOrbit.last)return;
 if(nxPhaseOrbit.last)nxOrbitSize.unobserve(nxPhaseOrbit.last);nxPhaseOrbit.last=orbit;if(!orbit)return;
 const now=performance.now()/1000;orbit.style.setProperty('--phase',(now%NX_ORBIT_SECONDS).toFixed(2)+'s');orbit.style.setProperty('--sat-phase',(now%NX_SAT_SECONDS).toFixed(2)+'s');nxOrbitSize.observe(orbit);
 const panel=orbit.closest('.nx-orbit-panel');if(!panel)return;
 const show=node=>{const id=node?.dataset.orbitDetail;panel.querySelectorAll('.nx-orbit-detail').forEach((el,i)=>el.hidden=String(i)!==id);panel.querySelector('.nx-orbit-hint').hidden=id!==undefined;};
 panel.addEventListener('pointerover',e=>{const node=e.target.closest('.nx-orbit-node');if(node)show(node);});
 panel.addEventListener('pointerleave',()=>show(panel.querySelector('.nx-orbit-node:focus')));
 panel.addEventListener('focusin',e=>show(e.target.closest('.nx-orbit-node')));
 panel.addEventListener('focusout',e=>{if(!panel.contains(e.relatedTarget))show(null);});
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){show(null);e.stopPropagation();}});
}
function nxWelcome(needs,working){
 const themes=nxThemeGroups(state.sessions).filter(t=>t.count).sort((a,b)=>(b.updated||0)-(a.updated||0)).slice(0,innerWidth<1500?3:5),last=themes[0],active=[...needs,...working],any=state.sessions.length>0;
 const status=!any?'Start a session with an installed agent to bring your work into view.':active.length?[needs.length?`<b class="nx-needs-text">${needs.length} need${needs.length===1?'s':''} you</b>`:'',working.length?`<b class="nx-working-text">${working.length} working</b>`:''].filter(Boolean).join(' · '):'All quiet. Nothing needs you and no agent is working.';
 return `<section class="nx-welcome"><div class="nx-welcome-text"><p class="nx-welcome-date">${new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</p><h2>${any?nxGreeting():'Welcome to NEXUS.'}</h2><p class="nx-welcome-status">${status}</p>${last?`<p class="nx-welcome-where">Last active in <span>${nxThemeTick(last)}<b>${esc(last.name)}</b></span> <span>${nxSince(last.updated)}.</span></p>`:''}<div class="nx-welcome-actions"><button class="btn primary" data-nx="new">${nxIcon('plus')}New session</button>${any?`<button class="btn" data-recent-work aria-haspopup="dialog">${nxIcon('catchup')}Recent work<kbd>R</kbd></button><button class="btn nx-welcome-wall" data-nx-view="wall">${nxIcon('wall')}Arrange on the Wall<span aria-hidden="true"> →</span></button>`:''}</div></div>${themes.length?nxOrbit(themes,active):`<div class="nx-orbit nx-orbit-empty" aria-hidden="true"><span class="nx-orbit-core nx-core" data-state="idle">${nxCore('home')}</span></div>`}</section>`;
}
renderApsis=function(){
 if(!$('#nxHome'))return;
 const phone=matchMedia('(max-width:700px)').matches,list=nx.project?state.sessions.filter(s=>nxThemeId(s)===nx.project):state.sessions,needs=list.filter(s=>statusLabel(s)[0]==='ready'),working=list.filter(s=>statusLabel(s)[0]==='busy'),recent=list.filter(s=>!['ready','busy'].includes(statusLabel(s)[0])).sort((a,b)=>(b.updated||0)-(a.updated||0));
 const section=(title,items,hint)=>items.length?`<section class="nx-home-section"><h2>${title}<small>${items.length} <span>· ${hint}</span></small></h2><div class="${phone?'nx-phone-group glass':'nx-home-cards'}">${items.map(phone?nxPhoneRow:nxHomeCard).join('')}</div></section>`:'';
 if(phone){
  const heading=`<header class="nx-phone-home-head"><span class="nx-core" data-state="${needs.length?'needs':working.length?'working':'idle'}">${nxCore('head')}</span><h1>Home</h1><span>${working.length} live · ${needs.length} waiting</span><button class="btn primary nx-phone-home-new" data-nx="new">${nxIcon('plus')}New</button></header>${nxUsage()?`<div class="nx-phone-usage glass">${nxUsage()}</div>`:''}`;
  const quiet=!needs.length&&!working.length?`<section class="nx-quiet"><span class="nx-core">${nxCore('home')}</span><h2>${state.sessions.length?'All quiet.':'Your attention field is ready.'}</h2><p>${state.sessions.length?`${recent.length} sessions saved. Nothing needs you and no agent is working right now.`:'Start a session with an installed agent to bring your work into view.'}</p><div><button class="btn" data-nx="new">${nxIcon('plus')}New session</button><button class="btn" data-nx-view="wall">${nxIcon('wall')}Open Wall</button><button class="btn" data-nx-view="spend">${nxIcon('spend')}Review spend</button></div></section>`:'';
  const recentHTML=recent.length?`<section class="nx-home-section"><h2>Recent<small>${recent.length}<span> · newest first</span></small></h2><div class="nx-phone-group glass">${recent.slice(0,5).map(nxPhoneRow).join('')}</div></section>`:'';
  updateHTML($('#nxHome'),heading+nxThemesStrip()+`<div class="nx-home-content">${quiet}${section('Needs you',needs,'waiting on a decision')}${section('Working',working,'no action needed')}${recentHTML}</div>`);
  nxPhaseOrbit();
  return;
 }
 const heading=`<header class="nx-page-head"><h1>Home</h1><div class="nx-top-usage">${nxUsage(true)}</div></header>`;
 const active=[...needs,...working],shown=nx.recentAll?recent:recent.slice(0,12);
 const recentHTML=recent.length?`<section class="nx-home-section nx-home-recent"><h2>Recent<small>${recent.length}<span> · newest first</span></small></h2><div class="nx-recent-list">${shown.map(nxRecent).join('')}</div>${recent.length>12?`<button class="nx-show-all" data-nx-recent-all aria-expanded="${!!nx.recentAll}">${nx.recentAll?'Show the latest 12':`Show all ${recent.length}`}</button>`:''}</section>`:'';
 const focusedOrbit=document.activeElement?.closest('.nx-orbit-node')?.dataset.themePick;
 updateHTML($('#nxHome'),heading+`<div class="nx-home-content">${nxWelcome(needs,working)}${active.length?`<h2 class="nx-active-heading">Needs you & Working</h2><div class="nx-home-grid">${active.map(nxHomeCard).join('')}</div>`:''}${recentHTML}</div>`);
 nxPhaseOrbit();
 if(focusedOrbit)document.querySelector(`.nx-orbit-node[data-theme-pick="${CSS.escape(focusedOrbit)}"]`)?.focus({preventScroll:true});
};
// Rebuild only when the number of themes or phone markup changes; geometry is handled by ResizeObserver.
for(const query of ['(max-width:700px)','(max-width:1499px)'])matchMedia(query).addEventListener('change',()=>{if(state.booted)renderApsis();});
renderWall=function(){
 if(state.view!=='wall')return;
 const list=visible().sort((a,b)=>nxRank(a)-nxRank(b)||b.updated-a.updated);
 updateHTML($('#wall'),`<header class="nx-page-head"><h1>Wall</h1><span>${list.length} sessions · ${list.filter(s=>statusLabel(s)[0]==='busy').length} live</span></header><div class="nx-wall-grid">${list.map(s=>{const cls=statusLabel(s)[0];return `<article class="nx-wall-tile glass glass-hover sweep press ${cls==='busy'?'live-glow':cls==='ready'?'needs':''}"><button class="nx-card-open" data-nx-open="${esc(keyOf(s))}" aria-label="Open ${esc(s.title)}"><span class="nx-card-top">${nxAgent(s)}${nxStatus(s)}${nxModel(s)}</span><strong>${esc(s.title)}</strong><p>${esc(nxPurpose(s))}</p><span class="nx-wall-latest ${cls}"><small>${cls==='busy'?'Now':cls==='ready'?'Waiting on you':'Latest'}</small><span>${esc(sessionPreview(s))}</span></span></button><footer class="nx-card-foot"><span>${nxThemeLabel(s)} · ${ago(s.updated)}</span>${nxSpend(s)?`<small>${nxSpend(s)}</small>`:''}${NexusCall.button(keyOf(s))}</footer>${cls==='busy'?'<span class="shimmer-track nx-wall-shimmer"></span><span class="data-stream nx-header-stream"></span>':''}</article>`}).join('')||nxEmpty('No sessions yet','Start a session to see it on the Wall.','new')}</div>`);
};
document.addEventListener('click',e=>{
 const open=e.target.closest('[data-nx-open]');if(open){select(open.dataset.nxOpen);return;}
 const project=e.target.closest('[data-nx-project]');if(project){nx.project=project.dataset.nxProject===nx.project?null:project.dataset.nxProject||null;renderApsis();return;}
 if(e.target.closest('[data-nx-recent-all]')){nx.recentAll=!nx.recentAll;renderApsis();}
});
const nxInit=initializeRedesign;
initializeRedesign=function(){nxInit();nx.mapOpen=innerWidth>=1280;nx.panel=innerWidth>700;const ambient=document.createElement('div');ambient.className='nx-ambient';ambient.setAttribute('aria-hidden','true');ambient.innerHTML='<span class="ambient-layer ambient-far"></span><span class="ambient-layer ambient-near"></span>';$('#app').prepend(ambient);document.addEventListener('visibilitychange',()=>ambient.classList.toggle('ambient-paused',document.hidden));render();};
boot=async function(){
 const host=$('#boot');let skipped=false;
 host.innerHTML=`<div class="nx-boot-brand"><div class="nx-boot-crystal">${Prism.markup()}</div><h1>NEXUS</h1><p>ASSEMBLING YOUR ATTENTION FIELD</p></div><div class="nx-boot-readout"><div class="nx-boot-log glass" id="bootLog"></div><div class="nx-boot-progress"><div class="nx-meter"><i id="bootBar" style="width:0%"></i></div><span id="nxBootPercent">0%</span></div></div><button class="btn nx-skip" id="skipBoot">Skip sequence <kbd>Esc</kbd></button>`;
 const skip=e=>{if(!e||['Escape','Enter',' '].includes(e.key))skipped=true;};$('#skipBoot').onclick=()=>skip();addEventListener('keydown',skip);
 const dataPromise=refresh(),wait=ms=>new Promise(resolve=>{const start=Date.now();const tick=()=>skipped||Date.now()-start>=ms?resolve():setTimeout(tick,30);tick();});
 await wait(matchMedia('(prefers-reduced-motion:reduce)').matches?50:1250);
 const data=await Promise.race([dataPromise,new Promise(resolve=>setTimeout(()=>resolve(null),2200))]);const sessions=data?.sessions||[];
 const installed=Object.entries(data?.agents||{}).filter(([,a])=>a.installed).map(([k])=>k),single=installed.length===1;
 const rows=[['detecting agents',single?'1 installed':installed.length+' installed'],['indexing conversations',sessions.length+' found'],['placing themes',new Set(sessions.map(s=>s.theme?.id).filter(Boolean)).size+' themes'],['reading usage',data?'Ready':'Pending']];

 for(let i=0;i<rows.length;i++){const row=document.createElement('div');row.innerHTML=`<b>›</b><span>${esc(rows[i][0])}</span><i></i><em>${esc(rows[i][1])}</em>`;$('#bootLog').append(row);$('#bootBar').style.width=Math.round((i+1)/rows.length*100)+'%';$('#nxBootPercent').textContent=Math.round((i+1)/rows.length*100)+'%';await wait(240);}
 await wait(420);removeEventListener('keydown',skip);host.classList.add('out');state.booted=true;$('#app').classList.add('in','settled');$('#app').inert=false;setTimeout(()=>host.remove(),200);restorePlace();renderApsis();
};
