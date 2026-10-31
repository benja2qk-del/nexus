'use strict';
const slashUI={key:null,entries:[],loadedAt:0,index:0,query:null,dismissed:null,loading:null,handoff:null};
function slashTextMode(){return !(typeof NexusCall!=='undefined'&&NexusCall.active)&&!(typeof NexusVoice!=='undefined'&&NexusVoice.status!=='off');}
async function slashCatalog(key=state.sel){
  if(slashUI.key===key&&Date.now()-slashUI.loadedAt<10000)return slashUI.entries;
  if(slashUI.loading?.key===key)return slashUI.loading.promise;
  const promise=api('/api/commands?key='+encodeURIComponent(key)).then(data=>{
    const entries=[...data.commands,...data.agents.map(a=>({name:'agent',argsHint:a.name,description:a.description,source:'custom',kind:'args',invocation:a.invocation}))];
    if(state.sel===key){slashUI.key=key;slashUI.entries=entries;slashUI.loadedAt=Date.now();}
    return entries;
  }).finally(()=>{if(slashUI.loading?.promise===promise)slashUI.loading=null;});
  slashUI.loading={key,promise};return promise;
}
function slashClose(){const input=$('#steerIn');$('#nxSlashList')?.remove();input?.setAttribute('aria-expanded','false');input?.removeAttribute('aria-activedescendant');}
function slashPick(entry){
  const input=$('#steerIn');if(!input||!entry)return;
  input.value=entry.invocation||'/'+entry.name+(entry.argsHint?' ':'');steerDrafts.set(state.sel,input.value);
  slashUI.dismissed=input.value;slashClose();input.focus();input.setSelectionRange(input.value.length,input.value.length);nxComposerState();
}
async function slashSuggest(){
  const input=$('#steerIn'),key=state.sel,value=input?.value;
  if(!input||!slashTextMode()||input.disabled||value===slashUI.dismissed||!/^\/[\w:.-]*$/.test(value)||document.activeElement!==input){slashClose();return;}
  if(slashUI.query!==key+':'+value){slashUI.query=key+':'+value;slashUI.index=0;}
  let entries;try{entries=await slashCatalog(key);}catch(error){if(state.sel===key&&input.value===value){slashClose();input.setAttribute('aria-description','Commands could not be loaded. You can still type a command.');}return;}
  if(state.sel!==key||$('#steerIn')!==input||input.value!==value||document.activeElement!==input||value===slashUI.dismissed)return;
  const matches=NexusSlash.filter(entries,value);
  let list=$('#nxSlashList');if(!list){list=document.createElement('div');list.id='nxSlashList';list.setAttribute('role','listbox');list.setAttribute('aria-label','Slash commands');$('#steer').prepend(list);}
  slashUI.index=Math.max(0,Math.min(slashUI.index,matches.length-1));list._entries=matches;
  list.innerHTML=matches.length?matches.map((e,i)=>`<div id="nxSlash-${i}" role="option" tabindex="-1" aria-selected="${i===slashUI.index}" data-slash-index="${i}"><span><b>/${esc(e.name)}</b> <small>${esc(e.argsHint)}</small>${e.source!=='built-in'?` <em>${esc(e.source)}</em>`:''}</span><span class="nx-slash-description">${esc(e.description)}</span></div>`).join(''):'<p role="status">No matching command. You can still send what you typed.</p>';
  input.setAttribute('aria-expanded','true');if(matches.length)input.setAttribute('aria-activedescendant','nxSlash-'+slashUI.index);else input.removeAttribute('aria-activedescendant');
  list.onpointerdown=e=>{if(e.pointerType==='mouse')e.preventDefault();};
  list.onclick=e=>{const row=e.target.closest('[data-slash-index]');if(row)slashPick(matches[Number(row.dataset.slashIndex)]);};
  $('#nxSlash-'+slashUI.index)?.scrollIntoView({block:'nearest'});
}
const slashRenderSteer=renderSteer;
renderSteer=function(s){
  slashRenderSteer(s);const input=$('#steerIn');if(!input)return;
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-controls','nxSlashList');
  if(!input.hasAttribute('aria-expanded'))input.setAttribute('aria-expanded','false');
  input.setAttribute('aria-description','Type slash at the start for commands. Arrow keys choose, Enter or Tab inserts, Escape closes.');
  if(!input.dataset.slash){input.dataset.slash='1';input.addEventListener('input',()=>{slashUI.dismissed=null;slashSuggest();});input.addEventListener('focus',slashSuggest);input.addEventListener('blur',e=>{if(!e.relatedTarget?.closest('#nxSlashList'))setTimeout(slashClose,0);});}
  if(slashUI.key!==state.sel){slashClose();slashUI.dismissed=null;slashUI.query=null;}
  slashSuggest();
  if(chatFor().pending.at(-1)?.command)$('#nxComposeStatus')?.setAttribute('hidden','');
};
document.addEventListener('keydown',e=>{
  if(typeof slashPaint==='function')return;
  if(e.target.id!=='steerIn'||e.isComposing||e.keyCode===229||e.shiftKey||!slashTextMode())return;
  const list=$('#nxSlashList');if(!list)return;
  if(['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(e.key)){
    e.preventDefault();e.stopImmediatePropagation();
    if(e.key==='Escape'){slashUI.dismissed=e.target.value;slashClose();return;}
    if(e.key==='Enter'||e.key==='Tab'){if(list._entries.length)slashPick(list._entries[slashUI.index]);else slashClose();return;}
    slashUI.index=(slashUI.index+(e.key==='ArrowDown'?1:-1)+list._entries.length)%Math.max(1,list._entries.length);slashSuggest();
  }
},true);
function slashConfirm(text,key,run){
  modal(`<h2>Run ${esc('/'+NexusSlash.parse(text).name)}?</h2><p>This command can clear history, change saved state, sign out, or end the session. Confirm before it reaches the terminal.</p><pre class="nx-slash-confirm-text">${esc(text)}</pre><div class="modal-actions"><button class="btn" data-slash-cancel autofocus>Cancel</button><button class="btn danger" data-slash-confirm>Run command</button></div>`);
  $('#modalCard').onclick=e=>{if(e.target.closest('[data-slash-cancel]'))closeModal();if(e.target.closest('[data-slash-confirm]')){closeModal();if(state.sel===key)run();}};
}
async function slashNative(entry,command,key,fromQueue=false){
  // NEXUS's own setting: no terminal involved, so it never waits for the session.
  if(entry.native==='handoff'){
    const word=String(command.args||'').trim().toLowerCase();
    await nxSetHandoff(word==='on'?true:word==='off'?false:undefined);
    if(steerDrafts.get(key)===command.text)steerDrafts.delete(key);
    if(state.sel===key&&$('#steerIn')?.value.trim()===command.text.trim())$('#steerIn').value='';
    slashClose();return true;
  }
  if(entry.native==='rename'&&command.args&&!fromQueue){
    try{await postNexus('/api/action',{action:'session-rename',key,title:command.args});await refresh();}
    catch(error){toast('Could not rename',error.message,'bad');return true;}
    if(steerDrafts.get(key)===command.text)steerDrafts.delete(key);
    if(state.sel===key&&$('#steerIn')?.value.trim()===command.text.trim())$('#steerIn').value='';
    slashClose();return true;
  }
  if(state.sel!==key){if(fromQueue)throw Error('Session changed before the control opened.');return;}
  const chat=chatFor(key);let terminal=chat.terminal;
  if(terminal&&!terminal.exited){try{terminal=await api('/api/term-state?term='+encodeURIComponent(terminal.id));}catch(error){if(fromQueue)throw error;toast('Command not opened',error.message,'bad');return true;}}
  if(state.sel!==key){if(fromQueue)throw Error('Session changed before the control opened.');return true;}
  if(terminal&&!terminal.exited&&(terminal.prompt||terminal.menu||terminal.busy)){if(fromQueue)throw Error('Session became busy before the control opened.');await queueEnqueue(command.text,key);return true;}
  const s=state.byKey.get(key)||selTerm();
  if(entry.native==='model')await nxModelMenu();
  else if(entry.native==='settings'||entry.native==='rename'){await nxSessionSettings();if(entry.native==='rename')$('#nxSessionName')?.focus();}
  else if(entry.native==='resume')setView('sessions');
  else if(entry.native==='usage'){
    // Reuse the session details view, including the phone sheet.
    nx.panel=true;nx.panelMode='details';renderHead();
    if(innerWidth<=700){const details=$('#nxDetails');modal('<h2>Session usage</h2><div class="nx-slash-usage">'+(details?.innerHTML||'Usage is not recorded yet.')+'</div>');}
  }else if(entry.native==='fork'){
    if(!state.byKey.has(key))return false;
    if(s.kind==='claude')await runAction('fork',s);
    else if(s.kind==='copilot')await openInApp('term-fork-copilot',{key},'Forked into NEXUS');
    else return false;
  }else return false;
  if(steerDrafts.get(key)===command.text)steerDrafts.delete(key);
  if(state.sel===key&&$('#steerIn')?.value.trim()===command.text.trim())$('#steerIn').value='';
  slashClose();return true;
}
function slashRow(receipt){
  const status=receipt.status,label=status==='menu'?'Opened':status==='closed'?'Closed':status==='acknowledged'||status==='confirmed'?'Ran':status==='rejected'?'Command rejected':status==='failed'?'Command not sent':status==='uncertain'?'Command sent; result unconfirmed':'Running';
  const warning=status==='uncertain'?'Check the terminal before sending again.':receipt.error||'';
  return `<div class="nx-slash-row" data-command-id="${esc(receipt.id||'')}" role="status"><b>${label} ${esc(receipt.text)}</b>${receipt.output?`<pre>${esc(receipt.output)}</pre>`:''}${warning?`<span>${esc(warning)}</span>`:''}${['menu','uncertain','rejected'].includes(status)?'<button class="text-action" data-slash-terminal>Open terminal</button>':''}</div>`;
}
function slashChatEvents(chat){
  const receipts=chat.terminal?.commands||[],used=new Set(),events=[];
  let lastCommand=null;
  for(const event of chat.events){
    if(event.t==='cmd'||event.t==='user'&&receipts.some(r=>r.text.trim()===event.text.trim()&&Date.parse(event.ts)>=r.submittedAt&&(!r.supersededAt||Date.parse(event.ts)<r.supersededAt))){
      const receipt=receipts.find(r=>r.text.trim()===event.text.trim()&&Date.parse(event.ts)>=r.submittedAt&&(!r.supersededAt||Date.parse(event.ts)<r.supersededAt)&&!used.has(r.id));
      if(receipt)used.add(receipt.id);
      lastCommand={...event,...receipt,t:'command',ts:event.ts,status:receipt?.status||'acknowledged'};events.push(lastCommand);
    }else if(event.t==='cmd-output'){
      if(lastCommand){lastCommand.output=lastCommand.output?lastCommand.output.includes(event.text)?lastCommand.output:lastCommand.output+'\n'+event.text:event.text;if(event.err)lastCommand.status='rejected';}
      else events.push({...event,t:'command',text:'Local command',output:event.text,status:event.err?'rejected':'acknowledged'});
    }else{events.push(event);if(event.t==='user'||event.t==='ai')lastCommand=null;}
  }
  for(const receipt of receipts)if(!used.has(receipt.id))events.push({...receipt,t:'command',ts:new Date(receipt.submittedAt).toISOString()});
  for(const pending of chat.pending.filter(p=>p.command&&!receipts.some(r=>r.id===p.id)))events.push({...pending,...pending.receipt,t:'command',ts:new Date(pending.at).toISOString()});
  return events.sort((a,b)=>(Date.parse(a.ts)||0)-(Date.parse(b.ts)||0));
}
function slashSync(chat,key){
  const receipts=chat.terminal?.commands||[];
  for(const message of chat.pending.filter(m=>m.command)){
    const receipt=receipts.find(r=>r.id===message.id);
    if(receipt){message.receipt=receipt;if(['acknowledged','menu','closed','rejected','uncertain'].includes(receipt.status))message.status='confirmed';}
  }
  if(state.sel!==key||state.view!=='focus')return;
  const menu=receipts.findLast(r=>r.status==='menu');
  if(menu&&slashUI.handoff?.id!==menu.id){
    slashUI.handoff={id:menu.id,key};nxOpenRaw();
    const note=$('#nxRaw .nx-raw-note');if(note)note.textContent='/'+menu.name+' is open in the terminal. Finish or cancel it to return to Chat.';
    const t=selTerm();if(t)setTimeout(()=>{if(slashUI.handoff?.id===menu.id&&$('#nxRaw'))termViews.get(t.id)?.xt.focus();},100);
  }
  if(slashUI.handoff?.key===key&&receipts.some(r=>r.id===slashUI.handoff.id&&r.status==='closed')){nxCloseRaw(false);slashUI.handoff=null;$('#steerIn')?.focus();}
}
document.addEventListener('click',e=>{if(e.target.closest('[data-slash-terminal]'))nxOpenRaw();});
