'use strict';
// The approved v0 presentation, connected to the existing delivery, voice and auth paths.
const nx = { panel: true, panelMode:'details', collapsed:new Set(), models:[], seen:new Map(), project:null };
function nxIcon(name) {
  const paths={pin:'m8 3 8 0-1 6 4 4v2H5v-2l4-4-1-6M12 15v6',home:'m3 10 9-7 9 7v10h-6v-7H9v7H3Z',wall:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',spend:'M3 6h18v14H3zM3 6V3h15v3M15 11h6v5h-6z',settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',plus:'M12 4v16M4 12h16',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',panel:'M3 3h18v18H3zM15 3v18',back:'m14 5-7 7 7 7',close:'m6 6 12 12M6 18 18 6',more:'M4 12h1m6 0h1m6 0h1',folder:'M3 7V4h6l3 3h9v13H3Z',branch:'M6 3v12a5 5 0 0 0 10 0V9M6 6h0M16 5h0',terminal:'m5 7 5 5-5 5M13 17h6',catchup:'M4 5h16M4 10h12M4 15h9m3 3 3 3 3-3M19 12v9',arrow:'M12 19V5m-6 6 6-6 6 6',voice:'M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4',sessions:'M8 5h13M8 12h13M8 19h13M3 5h0M3 12h0M3 19h0',refresh:'M20 7v5h-5M4 17v-5h5M5 8a7 7 0 0 1 12-3l3 7M4 12l3 7a7 7 0 0 0 12-3'};
  return `<svg class="nx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.sessions}"/></svg>`;
}
function nxStatus(s) { const [cls,label]=statusLabel(s); return `<span class="status ${cls}"><i class="${cls==='busy'?'animate-breathe':''}"></i>${esc(label)}</span>`; }
function nxModel(s) { return `<span class="nx-model-badge" title="${esc(s.model || '')}">${s.model ? esc(NexusDesign.modelLabel(s.model)) : ''}</span>`; }
// Which agent runs the session: a colored dot + name (Claude warm, Astra cyan). A Claude session that
// also started Astra runs gets a second "+ Astra" chip. 'dot' keeps only the dot where the name is already written.
function nxAgent(s, mode) {
  const astra = s.kind === 'astra', title = agentName(s.kind)+' session';
  if(['copilot','antigravity'].includes(s.kind))return mode==='dot'?`<span class="nx-agent-dot ${s.kind}" title="${title}"></span>`:`<span class="nx-agent ${s.kind}" title="${title}"><i></i>${agentName(s.kind)}</span>`;
  if (mode === 'dot') return `<span class="nx-agent-dot ${astra ? 'astra' : 'claude'}" title="${title}"></span>`;
  const both = !astra && (s.recentTools || []).includes('Astra') ? `<span class="nx-agent astra plus" title="This Claude session also ran Astra">+ Astra</span>` : '';
  return `<span class="nx-agent ${astra ? 'astra' : 'claude'}" title="${title}"><i></i>${astra ? 'Astra' : 'Claude'}</span>${both}`;
}
function nxPurpose(s) { return NexusDesign.plainSummary(NexusActivity.subtitle(s) || s.firstPrompt || 'Waiting for your first message'); }
function nxSpend(s) { return NexusDesign.usageText(s); }
function nxThoughtLabel(event){
 // Transcript gaps include tool/network time and are not measured thinking duration.
 const seconds=event.durationSeconds;
 const prefix=`Thought${Number.isFinite(seconds)?' for '+seconds+'s':''}`,summary=NexusDesign.plainSummary(event.text),host=$('#chatView');
 if(!summary)return prefix;
 const style=host&&getComputedStyle(host),width=host?host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-48:600;
 const context=document.createElement('canvas').getContext('2d');context.font='13px Sora';
 let short=summary;while(short.length>1&&context.measureText(prefix+' - '+short).width>width)short=NexusDesign.wordLimit(short,short.length-1);
 return prefix+' - '+short;
}
function nxLiveBar(s,chat,prompt){
 const busy=!prompt&&!chat.terminal?.exited&&(chat.terminal?.busy||s&&statusLabel(s)[0]==='busy');
 if(!busy)return '';
 const current=state.activity?.current,step=current?.running?NexusActivity.step(current):'',seconds=current?.ts?Math.floor((Date.now()-Date.parse(current.ts))/1000):0,elapsed=seconds>=5?' · '+(seconds>=60?Math.floor(seconds/60)+'m '+seconds%60+'s':seconds+'s'):'';
 return `<div class="chat-live-state" role="status"><span class="nx-agent-name nx-live-agent-label ${s?.kind||'claude'}">${nxAgent(s||{kind:'claude'},'dot')}${agentName(s?.kind)}</span><span class="nx-live-step">${esc(NexusDesign.plainSummary(step||chat.status?.replace(/^.*? is /,'')||'Working')+elapsed)}</span><button class="btn" data-chat-answer="esc" ${chat.terminal&&!chat.terminal.exited?'':'disabled'} title="${chat.terminal?'Interrupt this turn':'Open this session in NEXUS to stop it'}">Stop</button></div>`;
}
function nxGroups(list=state.sessions) {
  const groups=new Map();for(const s of list){if(!groups.has(s.group))groups.set(s.group,{id:s.group,name:s.groupLabel||s.group,sessions:[]});groups.get(s.group).sessions.push(s);}
  for(const g of groups.values())g.sessions.sort((a,b)=>nxRank(a)-nxRank(b)||b.updated-a.updated);
  return [...groups.values()];
}
function nxRank(s) {return {ready:0,busy:1,done:2,off:3}[statusLabel(s)[0]] ?? 3;}
function initializeRedesign() {
  document.body.classList.add('redesign');document.title='NEXUS';
  const legacy=document.createElement('div');legacy.id='nxLegacy';legacy.hidden=true;$('#app').append(legacy);
  const sidebar=document.createElement('nav');sidebar.id='nxSidebar';sidebar.setAttribute('aria-label','Projects and sessions');
  sidebar.innerHTML=`<div class="nx-brand"><span class="nx-core" id="nxFleet">${Prism.markup()}</span><span>NEXUS</span><button class="btn primary" data-nx="new">${nxIcon('plus')}New</button></div><div class="nx-sidebar-tools"><nav class="nx-main-nav" aria-label="Main">${[['overview','Home','home'],['wall','Wall','wall'],['spend','Spend','spend'],['settings','Settings','settings']].map(([v,label,icon])=>`<button data-nx-view="${v}">${nxIcon(icon)}<span>${label}</span><small data-count="${v}"></small></button>`).join('')}</nav><div class="nx-quick"><button data-nx="palette" title="Commands (Ctrl K)">${nxIcon('terminal')}<span>Commands</span></button></div><div class="nx-search-slot"></div><div id="nxFilters" role="group" aria-label="Filter by status"></div></div><div id="nxSessionList"></div><div class="nx-sidebar-foot"><button data-nx="refresh" aria-label="Refresh sessions" title="Refresh sessions">${nxIcon('refresh')}</button></div>`;
  $('#app').prepend(sidebar);$('.nx-search-slot').append($('.search'));$('#nxSessionList').append($('#cards'));
  for(const el of [$('.top'),$('.rail'),$('.list')])legacy.append(el);
  const oldHome=document.createElement('div');while($('#overview').firstChild)oldHome.append($('#overview').firstChild);legacy.append(oldHome);
  $('#overview').innerHTML='<div id="nxHome"></div>';
  const focus=$('#focus'), column=document.createElement('div');column.id='nxConversation';
  for(const id of ['focusHead','chatView','termHost','steer'])column.append($('#'+id));
  focus.append(column);const details=document.createElement('aside');details.id='nxDetails';details.setAttribute('aria-label','Session details');focus.append(details);
  const page=document.createElement('section');page.id='nxPage';$('#app').append(page);
  $('#cards').ondblclick=null;
  $('#cards').onclick=e=>{const group=e.target.closest('[data-collapse]');if(group){const k=group.dataset.collapse;nx.collapsed.has(k)?nx.collapsed.delete(k):nx.collapsed.add(k);renderCards();return;}const card=e.target.closest('[data-k]');if(card)select(card.dataset.k);if(e.target.closest('[data-clear]'))nxClearFilters();};
  $('#mobileDock').innerHTML=[['home','Home','home'],['sessions','Sessions','sessions'],['wall','Wall','wall'],['spend','Spend','spend'],['more','Settings','settings']].map(([key,label,icon])=>`<button data-nav="${key}">${nxIcon(icon)}<span>${label}</span></button>`).join('');
  $('#mobileDock').onclick=e=>{const key=e.target.closest('[data-nav]')?.dataset.nav;({home:()=>setView('overview'),sessions:()=>setView('sessions'),wall:()=>setView('wall'),new:()=>newSessionModal(),spend:()=>setView('spend'),more:()=>setView('settings')})[key]?.();};
  document.addEventListener('click',nxClick);
  $('#steer').addEventListener('input',nxComposerState);
  if(deviceUI.saved && ['feed','thinking'].includes(deviceUI.saved.tab))deviceUI.saved.tab='chat';
  render();
}
function nxClearFilters(){state.query='';state.group='*';state.filter='all';$('#search').value='';render();}
visible = function() {
  return nxGroups(state.sessions.filter(s=>(state.group==='*'||s.group===state.group)&&(state.filter==='all'||state.filter===statusLabel(s)[0]||state.filter==='live'&&s.live||state.filter===s.kind)&&(!state.query||sessionSearchText(s).includes(state.query.toLowerCase())))).flatMap(g=>g.sessions);
};
cardHTML = function(s) {
  const key=keyOf(s),active=key===state.sel && state.view==='focus';
  return `<button class="card nx-row ${active?'sel':''}" data-k="${esc(key)}" aria-current="${active?'page':'false'}"><span class="nx-row-title"><strong>${esc(s.title)}</strong><time>${ago(s.updated)}</time></span><span class="nx-row-context">${esc(NexusDesign.plainSummary(s.error)||sessionPreview(s))}</span><span class="nx-row-meta">${nxAgent(s)}${nxStatus(s)}${nxModel(s)}</span></button>`;
};
renderCards = function() {
  if(!$('#nxFilters'))return;
  updateHTML($('#nxFilters'),[['all','All'],['ready','Needs you'],['busy','Working'],['done','Done'],['off','Saved']].map(([id,label])=>`<button data-nx-filter="${id}" aria-pressed="${state.filter===id}">${id==='all'?'':`<i class="nx-dot ${id}"></i>`}${label}${id==='all'?'':` <span>${state.sessions.filter(s=>statusLabel(s)[0]===id).length}</span>`}</button>`).join(''));
  const list=visible();
  const html=nxGroups(list).map(g=>`<section class="nx-project-group"><button class="nx-group-title" data-collapse="${esc(g.id)}" aria-expanded="${!nx.collapsed.has(g.id)}"><span>${nx.collapsed.has(g.id)?'›':'⌄'}</span>${esc(g.name)}<small>${g.sessions.length}</small></button>${nx.collapsed.has(g.id)?'':g.sessions.map(cardHTML).join('')}</section>`).join('');
  const unlinked=state.terms.filter(t=>(!t.sessionKey||!state.byKey.has(t.sessionKey))&&!t.exited&&(!state.query||(t.title+' '+t.cwd).toLowerCase().includes(state.query.toLowerCase())));
  const newRows=unlinked.length?`<section class="nx-project-group"><div class="nx-group-title">New sessions</div>${unlinked.map(t=>`<button class="card nx-row ${state.sel==='term:'+t.id?'sel':''}" data-k="term:${esc(t.id)}"><span class="nx-row-title"><strong>${esc(t.title)}</strong></span><span class="nx-row-context">Waiting for the first message</span><span class="nx-row-meta"><span class="status"><i></i>Open</span>${nxModel(t)}</span></button>`).join('')}</section>`:'';
  updateHTML($('#cards'),html+newRows || nxEmpty(state.sessions.length?'No sessions match':'No sessions yet',state.sessions.length?'Try another search or clear the filters.':'Start a session with an installed agent to see it here.',state.sessions.length?'clear':'new'));
  document.title=(state.sessions.filter(s=>statusLabel(s)[0]==='ready').length?'('+state.sessions.filter(s=>statusLabel(s)[0]==='ready').length+') ':'')+'NEXUS';
};
function nxEmpty(title,body,action='refresh'){return `<div class="nx-empty">${nxIcon(action==='new'?'plus':'sessions')}<strong>${title}</strong><p>${body}</p><button class="btn" data-nx="${action}">${action==='new'?'New session':action==='clear'?'Clear filters':'Try again'}</button></div>`;}
render = function(){if(!$('#nxSidebar'))return;renderCards();renderHead();renderApsis();if(state.view==='wall')renderWall();nxNavigation();};
function nxNavigation(){
  $$('[data-nx-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.nxView===state.view?'page':'false'));
  const needs=state.sessions.filter(s=>statusLabel(s)[0]==='ready').length,working=state.sessions.filter(s=>statusLabel(s)[0]==='busy').length;
  $('[data-count="overview"]').textContent=needs||'';$('[data-count="wall"]').textContent=working||'';
  $('#nxFleet').dataset.state=needs?'needs':working?'working':'idle';$('#nxFleet').title=`${working} working · ${needs} need you`;
  $$('#mobileDock [data-nav]').forEach(b=>b.setAttribute('aria-current',({overview:'home',sessions:'sessions',focus:'sessions',wall:'wall',spend:'spend',settings:'more'})[state.view]===b.dataset.nav?'page':'false'));
}
setView = function(view){
  if(state.view==='focus'&&view!=='focus'){rememberViewed(state.byKey.get(state.sel),true);NexusVoice.navigation();}
  if(view==='project'){state.group=projectUI.key||'*';view='overview';}
  state.view=view;$('#app').dataset.view=view;$('#app').classList.toggle('wall-mode',view==='wall');
  $('#focus').classList.toggle('hidden',view!=='focus');$('#wall').classList.toggle('hidden',view!=='wall');
  if(view!=='focus')hideTerms();
  if(view==='theme')nxRenderThemePage();
  if(view==='focus'){if(!state.sel&&state.sessions.length)return select(keyOf(visible()[0]||state.sessions[0]));renderHead();loadChat();}
  if(view==='wall')renderWall();if(view==='overview')renderApsis();
  if(view==='spend')spendOverview();if(view==='settings')appMenu();
  nxNavigation();savePlace();
};
renderHead = function(){
  if(!$('#nxSidebar'))return;
  const s=state.byKey.get(state.sel)||selTerm(),t=selTerm();$('#focus').classList.toggle('has',!!s);
  if(!s){updateHTML($('#focusHead'),'');return;}
  if(!['chat','term'].includes(state.tab))state.tab='chat';
  const remote=s.kind==='claude'?`<button class="rc-switch ${s.remote&&s.live?'on':''}" data-a="rc" role="switch" aria-checked="${!!(s.remote&&s.live)}"><span class="rc-track"><i></i></span>Remote</button>`:'';
  updateHTML($('#focusHead'),`<button class="nx-phone-back" data-nx-view="sessions" aria-label="Back to sessions">${nxIcon('back')}</button><div class="nx-heading"><div class="nx-header-meta">${nxThemeLabel(s)}${nxSpend(s)?` <span>/</span> <span>${nxSpend(s)}</span>`:''}</div><div class="fh-row"><h1 class="fh-title" title="${esc(s.title)}">${esc(s.title)}</h1><span class="nx-header-status">${nxStatus(s)}<span class="nx-phone-agent"> · ${nxAgent(s)}</span></span></div><p class="nx-subtitle">${esc(nxPurpose(s))}</p></div><div class="nx-header-actions"><button class="btn nx-catchup" id="sessionRecap" data-a="recap">${nxIcon('catchup')}Catch me up</button><button class="btn nx-model-select" data-nx="model" aria-label="Change model">${nxAgent(s,innerWidth<=700?'dot':undefined)}<span><small>Model</small><b>${esc(NexusDesign.modelLabel(s.model)||'Choose model')}</b></span><span>⌃</span></button>${remote}<button class="btn nx-panel-toggle" data-nx="details" aria-label="${nx.panel?'Hide':'Show'} details panel">${nxIcon('panel')}</button><details class="session-more" data-disclosure="more"><summary aria-label="More actions">${nxIcon('more')}</summary><div class="more-menu">${state.tab === 'term' ? '<button data-nx="conversation">Back to conversation</button>' : ''}<button data-nx="session-rename">Rename session</button><button data-nx="session-settings">${nxIcon('settings')}Session settings…</button><button data-nx="raw">${nxIcon('terminal')}Raw terminal</button><button data-a="recap" id="sessionRecapMore">Catch me up</button><button data-nx="details">Session details</button>${s.kind==='claude'?'<button data-a="rc">Remote access</button><button data-a="fork">Fork session</button>':s.kind==='copilot'?'<button data-nx="copilot-fork">Fork session</button>':''}${state.remote?'':'<button data-a="folder">Open project folder</button><button data-a="vscode">Open in VS Code</button>'}${s.brief?'<button data-a="read-brief">Read brief</button>':''}<button data-copy="${esc(s.id)}">Copy session ID</button><button data-a="chat-help">Conversation help</button>${t?'<button class="danger" data-a="term-close">Close session</button>':''}</div></details></div>${statusLabel(s)[0]==='busy'?'<span class="data-stream nx-header-stream"></span>':''}`);
  if(innerWidth<=700)$('#focusHead').style.setProperty('--nx-model-width',$('#focusHead .nx-model-select').offsetWidth+'px');
  applyTab();nxDetails(s);
};
applyTab = function(){
  const t=selTerm();if(state.tab==='term'&&!t)state.tab='chat';$('#focus').dataset.tab=state.tab;$('#focus').classList.toggle('tab-term',state.tab==='term');
  if(state.view==='focus'&&state.tab==='term'&&t)showTerm(t.id);else hideTerms();
  if(state.view==='focus'&&state.tab==='chat')renderReadableChat();savePlace();
};
renderFocusInsights = function() {const s=state.byKey.get(state.sel);if(s)nxDetails(s);};
function nxSummary(s){
 const rows=[['Folder',s.cwd],['Started',s.started?new Date(s.started).toLocaleString():''],['Model',NexusDesign.modelLabel(s.model)],['Agent',nxMultiAgent()?agentName(s.kind):''],['Spend',NexusDesign.spendText(s)],['Branch',s.branch]].filter(([,value])=>value);
 return `<section class="nx-session-summary glass"><div class="nx-purpose">${nxAgent(s)}<div><small>Purpose</small><p>${esc(nxPurpose(s))}</p></div></div><dl>${rows.map(([label,value])=>`<div><dt>${label}</dt><dd class="${label==='Agent'?'nx-agent-name '+s.kind:''}" title="${esc(value)}">${esc(value)}</dd></div>`).join('')}</dl></section>`;
}
function nxDetails(s){
  const host=$('#nxDetails');if(!host)return;host.hidden=!nx.panel;$('#focus').classList.toggle('nx-panel-open',nx.panel);
  if(!nx.panel)return;
  if(nx.panelMode==='catchup'&&nx.recapKey===keyOf(s))return;
  nx.panelMode='details';host.onclick=null;
  const events=chats.get(state.sel)?.events||[], results=new Map(events.filter(e=>e.t==='result').map(e=>[e.id,e])), edits=events.filter(e=>e.detail?.files?.length&&(e.t!=='tool'||results.get(e.id)&&!results.get(e.id).err)), files=new Map();
  for(const e of edits)for(const f of e.detail.files){const entry=files.get(f.path)||{path:f.path,diff:[],add:0,del:0};entry.diff.push(...(f.diff||[]));entry.add+=f.add||0;entry.del+=f.del||0;files.set(f.path,entry);}
  nx.files=[...files.values()];
  const commands=events.filter(e=>e.detail?.command).slice(-6).reverse();
  const pct=Number.isFinite(s.ctx)&&s.ctxMax>0?Math.min(100,Math.round(s.ctx/s.ctxMax*100)):null,spend=NexusDesign.spendText(s);
  updateHTML(host,`<div class="nx-panel-head"><button data-nx-panel="catchup">${nxIcon('catchup')}Catch up</button><b>${nxIcon('panel')}Details</b><button data-nx="details" aria-label="Close panel">${nxIcon('close')}</button></div><div class="nx-panel-body">${s.cwd||s.branch?`<section><h3>Workspace</h3><dl>${s.cwd?`<div><dt>${nxIcon('folder')}Folder</dt><dd title="${esc(s.cwd)}">${esc(s.cwd)}</dd></div>`:''}${s.branch?`<div><dt>${nxIcon('branch')}Branch</dt><dd>${esc(s.branch)}</dd></div>`:''}</dl></section>`:''}${spend||pct!==null?`<section>${spend?`<h3>Spend this session</h3><p class="nx-spend-detail">${esc(spend)}</p>`:''}${pct!==null?`<div class="nx-context"><span>Context window</span><b>${pct}%</b></div><div class="nx-meter"><i style="width:${pct}%"></i></div>`:''}</section>`:''}${nx.files.length?`<section><h3>Files <span>${files.size}</span></h3>${nx.files.map((f,i)=>`<button class="nx-file" data-nx-diff="${i}"><span title="${esc(f.path)}">${esc(f.path.replace(/.*[\\/]/,''))}</span><b>+${f.add}</b><em>−${f.del}</em></button>`).join('')}</section>`:'<p class="nx-empty-detail">Files · No edits</p>'}${commands.length?`<section><h3>Recent commands</h3>${commands.map(e=>`<div class="nx-command"><code title="${esc(e.detail.command)}">${esc(e.detail.command)}</code><small>${e.ts?clockTime(e.ts):''}</small></div>`).join('')}</section>`:'<p class="nx-empty-detail">Commands · No commands</p>'}</div>`);
}
const nxBaseBlock=blockHTML;
blockHTML=function(b,s,compact){
  if(b.t==='ai'&&!compact){const long=b.text.length>1100,key='reply-'+(b.ts||'')+'-'+b.text.length;return `<div class="ev ai"><div class="ev-label"><span class="nx-agent-name nx-live-agent-label ${s?.kind||'claude'}">${nxAgent(s||{kind:'claude'},'dot')}${agentName(s?.kind)}</span> <time>${b.ts?clockTime(b.ts):''}</time></div>${long?`<details class="nx-long-reply" open data-default-open data-disclosure="${esc(key)}"><summary><span>Collapse</span><span>Show full reply</span></summary><div class="md">${md(b.text)}</div></details><div class="md nx-reply-preview">${esc(NexusDesign.plainSummary(b.text))}</div>`:`<div class="md">${md(b.text)}</div>`}</div>`;}
  return nxBaseBlock(b,s,compact);
};
const nxBaseMarkdown=md;
md=function(src){return nxBaseMarkdown(src).replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g,(_,code)=>`<figure class="nx-code"><figcaption>Code<button data-nx-copy-code>Copy</button></figcaption><pre><code>${code}</code></pre></figure>`);};
const nxBaseComposer=renderSteer;
renderSteer=function(s){nxBaseComposer(s);const input=$('#steerIn');if(!input)return;input.placeholder=`Message ${agentName(s?.kind)}…`;const send=$('[data-steer="send"]'),talk=$('[data-steer="talk"]');if(send&&!send.dataset.nx){send.innerHTML=nxIcon('arrow')+'<span>Send</span>';send.dataset.nx='send-icon';talk.innerHTML=nxIcon('voice')+'Talk';const hint=document.createElement('span');hint.className='nx-compose-hint';hint.textContent='Enter to send · Shift+Enter for new line';$('.steer-buttons').prepend(hint);}nxComposerState();};
function nxComposerState(){const input=$('#steerIn'),send=$('[data-steer="send"]');if(!input||!send)return;const queued=typeof queueShouldQueue==='function'&&queueShouldQueue(chatFor(),state.sel);send.disabled=!input.value.trim()||chatSending(state.sel)||attachments.blocked(state.sel);send.title=queued?'Queue this message until the session is ready':!input.value.trim()?'Write a message to send':'';const label=send.querySelector('span');if(label)label.textContent=queued?'Queue':'Send';input.style.height='auto';input.style.height=Math.min(120,Math.max(44,input.scrollHeight))+'px';}
function nxClick(e){
  const panelTab=e.target.closest('[data-nx-panel]');if(panelTab){const s=state.byKey.get(state.sel);if(!s)return;if(panelTab.dataset.nxPanel==='catchup')recapDialog(s);else{nx.panelMode='details';nxDetails(s);}return;}
  if(e.target.closest('[data-nx-earlier]')){nxEarlier();return;}
  const view=e.target.closest('[data-nx-view]');if(view){setView(view.dataset.nxView);return;}
  const filter=e.target.closest('[data-nx-filter]');if(filter){state.filter=filter.dataset.nxFilter;renderCards();return;}
  const copy=e.target.closest('[data-nx-copy-code]');if(copy){copyText(copy.closest('figure').querySelector('code').textContent);return;}
  const diff=e.target.closest('[data-nx-diff]');if(diff){const f=nx.files[Number(diff.dataset.nxDiff)];modal(`<h2>${esc(f.path)}</h2>${nxDiff(f.diff)}`);return;}
  const button=e.target.closest('[data-nx]');if(!button)return;
  switch(button.dataset.nx){case 'copilot-fork':postNexus('/api/action',{action:'term-fork-copilot',key:state.sel}).then(async r=>{await refresh();select(r.result.key);}).catch(e=>toast('Fork unavailable',e.message,'bad'));break;case 'new':newSessionModal();break;case 'refresh':refreshNow();break;case 'clear':nxClearFilters();break;case 'details':nx.panel=!nx.panel;renderHead();break;case 'raw':nxOpenRaw();break;case 'session-settings':nxSessionSettings();break;case 'session-rename':nxSessionSettings().then(()=>$('#nxSessionName')?.focus());break;case 'conversation':nxCloseRaw();state.tab='chat';renderHead();break;case 'palette':if(typeof nxPalette==='function')nxPalette();break;case 'model':if(typeof nxModelMenu==='function')nxModelMenu();break;}
}
async function nxEarlier(){
  const key=state.sel,chat=chatFor(key),host=$('#chatView'),height=host.scrollHeight,top=host.scrollTop;
  try{const response=await api('/api/transcript?key='+encodeURIComponent(key)+'&bytes=12000000&limit=2400');if(state.sel!==key)return;
    chat.earlierEvents=response.events;const merged=[...chat.earlierEvents,...chat.events],seen=new Set();chat.events=merged.filter(e=>{const id=JSON.stringify([e.t,e.id,e.ts,e.text]);if(seen.has(id))return false;seen.add(id);return true;});chat.earlier=true;renderReadableChat();host.scrollTop=top+host.scrollHeight-height;
  }catch(error){toast('Could not load earlier messages',error.message,'bad');}
}
function nxDiff(lines){return `<figure class="nx-code"><figcaption>Diff<button data-nx-copy-code>Copy</button></figcaption><pre><code>${lines.map(l=>`<span class="${l.startsWith('+')?'nx-add':l.startsWith('-')?'nx-del':''}">${esc(l)}\n</span>`).join('')}</code></pre></figure>`;}
// Phase two replaces these with the approved overview and Wall composition.
renderApsis=function(){if(!$('#nxHome'))return;updateHTML($('#nxHome'),`<header class="nx-page-head"><h1>Home</h1><span>${state.sessions.length} sessions</span></header><div class="nx-home-initial">${visible().map(s=>compactSessionCard(s)).join('')}</div>`);};

// A header menu closes once one of its actions is chosen, so it does not stay open behind that action's dialog.
document.addEventListener('click',e=>{const item=e.target.closest('.session-more button');if(item)item.closest('details').open=false;});
