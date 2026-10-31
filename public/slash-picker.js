'use strict';
Object.assign(slashUI,{category:'all',sheet:false,usage:{},usageIds:[]});
try{const prefs=JSON.parse(localStorage.getItem('nexus.prefs')||'{}');slashUI.usage=prefs.slashUsage||{};slashUI.usageIds=prefs.slashUsageIds||[];}catch{}
function slashAgent(key=state.sel){return (state.byKey.get(key)||state.terms.find(t=>'term:'+t.id===key||t.sessionKey===key)||{}).kind||'claude';}
function slashUsed(entry,key=state.sel,id){
  if(id&&slashUI.usageIds.includes(id))return;if(id)slashUI.usageIds=[...slashUI.usageIds,id].slice(-300);
  slashUI.usage=NexusSlash.recordUsage(slashUI.usage,slashAgent(key),entry);
  try{const prefs=JSON.parse(localStorage.getItem('nexus.prefs')||'{}');localStorage.setItem('nexus.prefs',JSON.stringify({...prefs,slashUsage:slashUI.usage,slashUsageIds:slashUI.usageIds}));}catch{}
}
slashCatalog=async function(key=state.sel){
  if(slashUI.key===key&&Date.now()-slashUI.loadedAt<10000)return slashUI.entries;
  if(slashUI.loading?.key===key)return slashUI.loading.promise;
  const promise=api('/api/commands?key='+encodeURIComponent(key)).then(data=>{
    const entries=[...data.commands,...data.agents.map(a=>({...a,name:'agent',argsHint:a.name,kind:'args',source:'custom'})),...data.skills.map(a=>({...a,argsHint:'[instructions]',kind:'args'}))].map(e=>NexusSlash.decorate(e,data.kind));
    if(state.sel===key){slashUI.key=key;slashUI.entries=entries;slashUI.loadedAt=Date.now();}return entries;
  }).finally(()=>{if(slashUI.loading?.promise===promise)slashUI.loading=null;});
  slashUI.loading={key,promise};return promise;
};
slashClose=function(){
  const picker=$('#nxSlashPicker'),input=$('#steerIn');
  if(picker){picker.id='';if(slashUI.sheet){$('#app').inert=!!picker._wasInert;picker.classList.add('closing');picker.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));setTimeout(()=>picker.remove(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:200);}else picker.remove();}
  slashUI.sheet=false;input?.setAttribute('aria-expanded','false');input?.removeAttribute('aria-activedescendant');
};
slashPick=function(entry,complete=false){
  const input=$('#steerIn');if(!input||!entry)return;
  input.value=entry.invocation||'/'+entry.name;const needsText=entry.behavior==='text'||entry.invocation?.startsWith('$');
  if(complete||needsText)input.value+=entry.argsHint?' ':'';
  steerDrafts.set(state.sel,input.value);slashUI.dismissed=input.value;slashClose();input.focus();input.setSelectionRange(input.value.length,input.value.length);nxComposerState();
  if(!complete&&!needsText)sendChat();
};
function slashTag(entry){return `<span class="nx-slash-tag ${entry.behavior}">${NexusSlash.behaviorLabels[entry.behavior]}</span>`;}
function slashGlyph(entry){return esc(entry.invocation?.startsWith('$')?'$':'/');}
function slashExplain(entry){return `<div class="slash-card"><div class="nx-slash-card-title"><b><i>${slashGlyph(entry)}</i>${esc(entry.name)}</b>${slashTag(entry)}</div><p>${esc(entry.detail)}</p><small>Example</small><code>${esc(entry.example)}</code><small>What NEXUS does</small><p class="nx-muted">${esc(entry.nexus)}</p>${entry.source!=='built-in'?`<small class="nx-slash-source">from ${esc(entry.source)}</small>`:''}${slashUI.sheet?`<button class="btn primary nx-slash-run" data-slash-run>${entry.behavior==='text'?'Type':'Run'} ${slashGlyph(entry)}${esc(entry.name)}</button>`:''}</div>`;}
function slashHighlight(index,scroll=false){
  const picker=$('#nxSlashPicker'),entries=picker?._entries||[];if(!entries.length)return;
  slashUI.index=Math.max(0,Math.min(index,entries.length-1));picker.querySelectorAll('[data-slash-index]').forEach(row=>row.setAttribute('aria-selected',Number(row.dataset.slashIndex)===slashUI.index));
  const input=slashUI.sheet?$('#nxSlashSearch'):$('#steerIn');input?.setAttribute('aria-activedescendant','nxSlash-'+slashUI.index);
  const card=$('#nxSlashExplain'),entry=entries[slashUI.index],cardKey=entry.invocation||entry.name;
  if(card&&card.dataset.command!==cardKey){card.dataset.command=cardKey;card.innerHTML=slashExplain(entry);}
  if(scroll)$('#nxSlash-'+slashUI.index)?.scrollIntoView({block:'nearest'});
}
function slashPaint(entries,query){
  let picker=$('#nxSlashPicker');const agent=slashAgent(),groups=NexusSlash.groups(entries,query,slashUI.usage,agent,slashUI.category),flat=groups.flatMap(g=>g.items);
  if(!picker){
    picker=document.createElement('div');picker.id='nxSlashPicker';picker.dataset.agent=agent;picker.className=slashUI.sheet?'nx-slash-overlay':'slash-pop';
    const title=nxMultiAgent()?agentName(agent)+' commands':'Commands';
    picker.innerHTML=`<section class="nx-slash-surface" ${slashUI.sheet?'role="dialog" aria-modal="true" aria-label="Commands"':''}><span class="nx-slash-handle" aria-hidden="true"></span><header><b>${esc(title)} <span id="nxSlashCount"></span></b>${slashUI.sheet?'<button data-slash-close>Cancel</button>':'<span class="nx-slash-keys"><kbd>↑↓</kbd> move <kbd>Enter</kbd> run <kbd>Tab</kbd> complete <kbd>Esc</kbd> close</span>'}</header>${slashUI.sheet?'<label class="nx-slash-search"><span aria-hidden="true">⌕</span><input id="nxSlashSearch" type="search" placeholder="Search commands" aria-label="Search commands" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="nxSlashList" aria-expanded="true"></label><div class="nx-slash-chips" role="tablist" aria-label="Categories"></div>':''}<div class="nx-slash-body"><div id="nxSlashList" role="listbox" aria-label="Slash commands"></div><aside id="nxSlashExplain" aria-live="polite" aria-atomic="true"></aside></div></section>`;
    if(slashUI.sheet){picker._wasInert=$('#app').inert;$('#app').inert=true;document.body.append(picker);$('#nxSlashSearch').value=query;$('#nxSlashSearch').addEventListener('input',()=>{slashUI.index=0;slashPaint(slashUI.entries,$('#nxSlashSearch').value.replace(/^\//,''));});queueMicrotask(()=>$('#nxSlashSearch')?.focus());}
    else $('#steer').prepend(picker);
    picker.addEventListener('pointerdown',e=>{if(!slashUI.sheet&&e.target.closest('[role=option]'))e.preventDefault();});
    picker.addEventListener('pointermove',e=>{const row=e.target.closest('[data-slash-index]');if(row&&!slashUI.sheet&&Number(row.dataset.slashIndex)!==slashUI.index)slashHighlight(Number(row.dataset.slashIndex));});
    picker.addEventListener('click',e=>{
      if(e.target===picker||e.target.closest('[data-slash-close]')){slashUI.dismissed=$('#steerIn')?.value;slashClose();$('#steerIn')?.focus();return;}
      const chip=e.target.closest('[data-slash-category]');if(chip){slashUI.category=chip.dataset.slashCategory;slashUI.index=0;slashPaint(slashUI.entries,$('#nxSlashSearch').value);return;}
      const row=e.target.closest('[data-slash-index]');if(row){const i=Number(row.dataset.slashIndex);if(slashUI.sheet&&slashUI.index!==i)slashHighlight(i);else slashPick(picker._entries[i]);}
      if(e.target.closest('[data-slash-run]'))slashPick(picker._entries[slashUI.index]);
    });
  }
  picker._entries=flat;$('#nxSlashCount').textContent=flat.length;
  if(slashUI.sheet){const present=new Set(entries.map(e=>e.category));updateHTML($('.nx-slash-chips'),[['all','All'],...NexusSlash.categories.filter(c=>present.has(c[0]))].map(([id,label,icon])=>`<button role="tab" aria-selected="${slashUI.category===id}" data-slash-category="${id}">${icon?slashCategoryIcon(id):''}${esc(label)}</button>`).join(''));}
  let i=0;const html=groups.map(g=>`<div role="group" aria-label="${esc(g.label)}"><div class="nx-slash-group" role="presentation">${slashCategoryIcon(g.id)}${esc(g.label)}</div>${g.items.map(e=>{const index=i++;return `<div class="slash-row" id="nxSlash-${index}" role="option" aria-selected="${index===slashUI.index}" data-slash-index="${index}"><div class="nx-slash-line"><b><i>${slashGlyph(e)}</i>${esc(e.name)}</b>${e.argsHint?`<small>${esc(e.argsHint)}</small>`:''}<span class="nx-slash-description">${esc(e.description)}</span></div>${e.source!=='built-in'?`<em>${esc(e.source)}</em>`:''}${slashTag(e)}</div>`;}).join('')}</div>`).join('')||`<p class="nx-slash-empty" role="status">No command matches <code>/${esc(query)}</code>.${slashUI.sheet?'':' Press Enter to send it as a message.'}</p>`;
  updateHTML($('#nxSlashList'),html);$('#nxSlashExplain').hidden=!flat.length;
  if(flat.length)slashHighlight(slashUI.index);else (slashUI.sheet?$('#nxSlashSearch'):$('#steerIn'))?.removeAttribute('aria-activedescendant');
  $('#steerIn')?.setAttribute('aria-expanded','true');
}
function slashCategoryIcon(id){const paths={recent:'M12 8v4l3 2M3 11a9 9 0 1 1 2 7M3 4v7h7',session:'M4 4h16v12H9l-5 4V4',model:'M7 7h10v10H7zM9 2v5m6-5v5m-6 10v5m6-5v5M2 9h5m-5 6h5m10-6h5m-5 6h5',context:'M12 5c-5-6-11 4-6 7-5 6 5 12 6 5m0-12c5-6 11 4 6 7 5 6-5 12-6 5V5',code:'M6 3v12a5 5 0 0 0 5 5h7M18 3v9a6 6 0 0 1-6 6M3 3h6m6 0h6',tools:'M8 3v6m8-6v6M5 9h14v3a7 7 0 0 1-14 0V9m7 10v3',account:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 22v-3a8 8 0 0 1 16 0v3',custom:'M4 4h6c-2-5 6-5 4 0h6v6c-5-2-5 6 0 4v6h-6c2-5-6-5-4 0H4v-6c5 2 5-6 0-4V4'};return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[id]||paths.custom}"/></svg>`;}
slashSuggest=async function(forceSheet=false){
  const input=$('#steerIn'),key=state.sel,value=input?.value;
  if(slashUI.sheet){if(slashUI.key!==key||!slashTextMode())slashClose();else return;}
  if(!input||!slashTextMode()||input.disabled||!forceSheet&&(value===slashUI.dismissed||!/^\/[\w:.-]*$/.test(value)||document.activeElement!==input)){slashClose();return;}
  if(slashUI.query!==key+':'+value){slashUI.query=key+':'+value;slashUI.index=0;slashUI.category='all';}
  let entries;try{entries=await slashCatalog(key);}catch{input.setAttribute('aria-description','Commands could not be loaded. You can still type a command.');return;}
  if(state.sel!==key||$('#steerIn')!==input||!forceSheet&&(input.value!==value||document.activeElement!==input||value===slashUI.dismissed))return;
  if(forceSheet&&!slashUI.sheet)slashClose();
  // Typing keeps the keyboard in the composer; only the / button opens the full sheet.
  slashUI.sheet=forceSheet&&innerWidth<=700;slashPaint(entries,forceSheet?'':value.slice(1));
};
renderSteer=function(s){
  slashRenderSteer(s);const input=$('#steerIn');if(!input)return;
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-controls','nxSlashList');
  if(!input.hasAttribute('aria-expanded'))input.setAttribute('aria-expanded','false');
  input.setAttribute('aria-description','Type slash for commands. Arrow keys choose, Enter runs, Tab completes, Escape closes.');
  if(!input.dataset.slash){input.dataset.slash='1';input.addEventListener('input',()=>{slashUI.dismissed=null;slashSuggest();});input.addEventListener('focus',()=>slashSuggest());input.addEventListener('blur',()=>{setTimeout(()=>{if(!slashUI.sheet&&!$('#nxSlashPicker')?.contains(document.activeElement)&&document.activeElement!==$('#steerIn'))slashClose();},0);});}
  if(!$('#nxSlashButton')){const b=document.createElement('button');b.id='nxSlashButton';b.type='button';b.className='btn';b.textContent='/';b.setAttribute('aria-label','Open slash commands');b.onclick=()=>{slashUI.dismissed=null;if(innerWidth>700){input.value='/';input.focus();}slashSuggest(true);};$('.steer-buttons')?.prepend(b);}
  if(slashUI.key!==state.sel){slashClose();slashUI.dismissed=null;slashUI.query=null;}
  slashSuggest();if(chatFor().pending.at(-1)?.command)$('#nxComposeStatus')?.setAttribute('hidden','');
};
document.addEventListener('keydown',e=>{
  const picker=$('#nxSlashPicker');if(!picker||e.isComposing||e.keyCode===229||!slashTextMode())return;
  if(slashUI.sheet&&e.key==='Tab'&&(e.shiftKey||e.target.id!=='nxSlashSearch')){
    const focusable=[...picker.querySelectorAll('button:not([disabled]),input')],first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}return;
  }
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();slashUI.dismissed=$('#steerIn')?.value;slashClose();$('#steerIn')?.focus();return;}
  if(!['steerIn','nxSlashSearch'].includes(e.target.id)||e.shiftKey)return;
  if(['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key)){
    if(e.key==='Enter'&&!picker._entries.length&&!slashUI.sheet){slashUI.dismissed=e.target.value;slashClose();return;}
    e.preventDefault();e.stopImmediatePropagation();
    if(e.key==='Enter'||e.key==='Tab'){slashPick(picker._entries[slashUI.index],e.key==='Tab');return;}
    slashHighlight((slashUI.index+(e.key==='ArrowDown'?1:-1)+picker._entries.length)%Math.max(1,picker._entries.length),true);
  }
},true);
const slashConfirmActions=new Map();
slashConfirm=function(text,key,run){
  const chat=chatFor(key);chat.localCommands||=[];if(chat.localCommands.some(r=>r.status==='confirm'&&r.text===text))return;
  const id=crypto.randomUUID();chat.localCommands.push({id,text,status:'confirm',submittedAt:Date.now()});slashConfirmActions.set(id,{key,run});if(state.sel===key)renderReadableChat();
};
const slashNativeBase=slashNative;
slashNative=async function(entry,command,key,fromQueue=false){
  if(entry.native==='plan'&&slashAgent(key)!=='copilot'){nxOpenRaw();return false;}
  if(entry.native==='plan'&&slashAgent(key)==='copilot'&&state.sel===key){
    const id=chatFor(key).terminal?.id,t=id?await api('/api/term-state?term='+encodeURIComponent(id)):null;
    if(t&&(t.busy||t.prompt||t.menu)){if(fromQueue)throw Error('Session became busy before the control opened.');await queueEnqueue(command.text,key);return true;}
    nxCopilotOptionsSheet();const mode=$('#nxCP-mode');if(mode){mode.value='plan';mode.focus();}if(!fromQueue)slashUsed(entry,key);$('#steerIn').value='';steerDrafts.delete(key);return true;
  }
  const handled=await slashNativeBase(entry,command,key,fromQueue);if(handled&&!chatFor(key).queue?.items.some(i=>i.text===command.text))slashUsed(entry,key);return handled;
};
slashRow=function(receipt){
  if(receipt.status==='confirm')return `<section class="slash-confirm" role="alertdialog" aria-label="Confirm ${esc(receipt.text)}"><div><b>Run ${esc(receipt.text)}?</b><p>This command can change saved state or end the session. Confirm before it reaches the terminal.</p></div><div><button class="btn" data-slash-cancel="${esc(receipt.id)}">Cancel</button><button class="btn danger" data-slash-confirm="${esc(receipt.id)}">Run command</button></div></section>`;
  const status=receipt.status,label=status==='menu'||status==='opened'?'Opened':status==='closed'?'Closed':status==='cancelled'?'Cancelled':status==='acknowledged'||status==='confirmed'?'Ran':status==='rejected'?'Command rejected':status==='failed'?'Command not sent':status==='uncertain'?'Command sent; result unconfirmed':'Running';
  const warning=status==='uncertain'?'Check the terminal before sending again.':receipt.error||'';
  const summary=status==='cancelled'?'nothing changed':/\bfreed\s+[\d,.]+\s*[kKmM]?\s*tokens\b/i.exec(receipt.output||'')?.[0]||receipt.summary||'';
  const heading=`<i class="nx-slash-result-glyph ${label==='Running'?'running':''}" aria-hidden="true">/</i><span>${label} <b>${esc(receipt.text)}</b>${summary?' - '+esc(summary):''}</span><time>${receipt.submittedAt?clockTime(receipt.submittedAt):''}</time>`;
  return `<div class="nx-slash-row" data-command-id="${esc(receipt.id||'')}">${receipt.output?`<details data-disclosure="slash-${esc(receipt.id||receipt.ts)}"><summary>${heading}<i class="nx-slash-chevron" aria-hidden="true">›</i></summary><pre class="slash-card">${esc(receipt.output)}</pre></details>`:`<div class="nx-slash-result" role="status">${heading}</div>`}${warning?`<span>${esc(warning)}</span>`:''}${['menu','uncertain','rejected'].includes(status)?'<button class="text-action" data-slash-terminal>Open terminal</button>':''}</div>`;
};
const slashEventsBase=slashChatEvents;
slashChatEvents=function(chat){
  const events=slashEventsBase(chat),ids=new Set(events.map(e=>e.id));
  for(const receipt of [...chat.localCommands||[],...chat.queue?.history||[]])if((NexusSlash.parse(receipt.text)||receipt.status==='confirm')&&!ids.has(receipt.id))events.push({...receipt,...receipt.command,t:'command',ts:new Date(receipt.submittedAt||receipt.at).toISOString()});
  return events.sort((a,b)=>(Date.parse(a.ts)||0)-(Date.parse(b.ts)||0));
};
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-slash-confirm],[data-slash-cancel]');if(!b)return;
  const id=b.dataset.slashConfirm||b.dataset.slashCancel,action=slashConfirmActions.get(id);if(!action)return;
  const chat=chatFor(action.key),receipt=chat.localCommands.find(r=>r.id===id);if(!receipt||receipt.status!=='confirm')return;slashConfirmActions.delete(id);
  if(b.hasAttribute('data-slash-cancel')){receipt.status='cancelled';if($('#steerIn')?.value===receipt.text){$('#steerIn').value='';steerDrafts.delete(action.key);}renderReadableChat();}
  else {chat.localCommands=chat.localCommands.filter(r=>r.id!==id);action.run();}
});
