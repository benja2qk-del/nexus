'use strict';
async function nxModels(){if(!nx.catalog||Date.now()-(nx.catalogAt||0)>60000){nx.catalog=await api('/api/models');nx.catalogAt=Date.now();}return nx.catalog;}
function nxCloseModel(){const menu=$('#nxModelMenu');if(!menu)return;const focus=menu._returnFocus;menu.remove();if(focus?.isConnected)focus.focus();}
// Long catalogs (Copilot lists about 30 models) get small provider headings.
function nxModelProvider(id){return /^auto$/i.test(id)?'Auto':/claude|opus|sonnet|haiku|fable/i.test(id)?'Claude':/^gpt|^o\d/i.test(id)?'GPT':/^gemini/i.test(id)?'Gemini':/^grok/i.test(id)?'Grok':'Other';}
async function nxModelMenu(){
 nxCloseModel();const key=state.sel,s=state.byKey.get(key)||selTerm();if(!s)return;
 let catalog;try{catalog=await nxModels();}catch(error){toast('Models unavailable',error.message,'bad');return;}if(state.sel!==key)return;
 const t=selTerm(),choices=catalog[s.kind]||[],phone=matchMedia('(max-width:700px)').matches;
 const menu=document.createElement('div');menu.id='nxModelMenu';menu.className=phone?'nx-model-sheet':'nx-model-popover';menu.setAttribute('role','dialog');menu.setAttribute('aria-label','Choose model');menu._returnFocus=document.activeElement;
 const deferred=s.kind!=='claude'||!t,question=chatFor().terminal?.prompt,external=s.kind==='claude'&&s.live&&!t;
 menu.innerHTML=`<div class="nx-model-menu-head"><b>Choose model</b><button data-model-close aria-label="Close model picker">${nxIcon('close')}</button></div><p>${external?'This session runs outside NEXUS. Use /model in its terminal.':question?'Answer the current question before changing models.':deferred?'Applied the next time this session resumes.':'Changes this session when Claude is ready. Your saved default model is preserved.'}</p><div role="group" aria-label="Models">${choices.map((m,i)=>`${choices.length>8&&nxModelProvider(m.id)!==nxModelProvider(choices[i-1]?.id||'')?`<div class="nx-model-group">${nxModelProvider(m.id)}</div>`:''}<button data-model-id="${esc(m.id)}" ${question||external?'disabled':''} aria-pressed="${m.id===(s.nextModel||s.model)}"><span><strong>${esc(m.label)}</strong><small>${esc(m.description||'')}</small></span><i>${m.id===(s.nextModel||s.model)?'✓':''}</i></button>`).join('')}</div><footer>Current: ${esc(NexusDesign.modelLabel(s.model))}${s.nextModel&&s.nextModel!==s.model?`<br>Next resume: ${esc(NexusDesign.modelLabel(s.nextModel))}`:''}</footer><div class="nx-model-result" role="status"></div>`;
 document.body.append(menu);const rect=$('[data-nx=model]')?.getBoundingClientRect();if(!phone&&rect){menu.style.top=Math.min(innerHeight-menu.offsetHeight-12,rect.bottom+8)+'px';menu.style.left=Math.max(12,Math.min(innerWidth-menu.offsetWidth-12,rect.right-menu.offsetWidth))+'px';}
 menu.querySelector('[data-model-close]').onclick=nxCloseModel;menu.querySelector('[aria-pressed=true]')?.focus();if(!menu.contains(document.activeElement))menu.querySelector('button').focus();
 menu.onclick=async e=>{const b=e.target.closest('[data-model-id]');if(!b)return;menu.querySelectorAll('[data-model-id]').forEach(x=>x.disabled=true);menu.querySelector('[role=status]').textContent=deferred?'Saving choice…':'Waiting for CLI confirmation…';
  try{const response=await postNexus('/api/action',{action:t?'term-model':'session-model',term:t?.id,key,model:b.dataset.modelId}),result=response.result;nxCloseModel();toast(result.deferred?'Model saved':`Switched to ${NexusDesign.modelLabel(result.model)} for this session`,result.deferred?`${NexusDesign.modelLabel(result.model)} will apply on the next resume.`:'Confirmed by the CLI.','good');await refresh();}
  catch(error){menu.querySelector('[role=status]').textContent=error.message;menu.querySelectorAll('[data-model-id]').forEach(x=>x.disabled=false);}
 };
}
document.addEventListener('pointerdown',e=>{if($('#nxModelMenu')&&!e.target.closest('#nxModelMenu,[data-nx=model]'))nxCloseModel();});
function nxCommands(){
 const actions=[['Home','overview','home'],['Wall','wall','wall'],['Spend','spend','spend'],['Settings','settings','settings']].map(([label,v,icon])=>({label:'Go to '+label,group:'Navigate',hint:label,icon,run:()=>setView(v)}));
 actions.push({label:'New session',group:'Actions',hint:'N',icon:'plus',run:newSessionModal},{label:'Refresh sessions',group:'Actions',icon:'refresh',run:refreshNow});
 if(state.sel)actions.push({label:'Catch me up',group:'This session',icon:'catchup',run:()=>$('#sessionRecap')?.click()},{label:'Change model',group:'This session',icon:'sessions',run:nxModelMenu},{label:'Session details',group:'This session',icon:'panel',run:()=>{nx.panel=true;setView('focus');renderHead();}});
 if(selTerm())actions.push({label:'Raw terminal',group:'This session',icon:'terminal',run:()=>{state.tab='term';setView('focus');}});
 actions.push({label:state.settings?.handoff?'Turn off hand-off between agents':'Turn on hand-off between agents',group:'Actions',icon:'sessions',search:'handoff hand off delegate agents astra codex copilot claude',run:()=>nxSetHandoff()});
 actions.push({label:'Voice check',group:'Actions',icon:'voice',run:()=>NexusVoice.check()},{label:'Pair a phone',group:'Actions',icon:'settings',run:pairPhone});
 return [actions.find(a=>a.label==='New session'),...actions.filter(a=>a.group==='Navigate'),...state.sessions.map(s=>({label:s.title,hint:s.theme?.name||'Unsorted',group:'Sessions',icon:'sessions',search:[sessionSearchText(s),s.kind,s.model,s.cwd,nxPurpose(s),sessionPreview(s),statusLabel(s)[1]].join(' '),session:s,run:()=>select(keyOf(s))})),...actions.filter(a=>a.group!=='Navigate'&&a.label!=='New session')];
}
function nxPalette(){
 nxCloseModel();let commands=nxCommands(),filtered=[],index=0;
 modal(`<div class="nx-palette"><div class="nx-palette-search">${nxIcon('search')}<input id="nxCommandQuery" role="combobox" aria-label="Search sessions and commands" aria-controls="nxCommandResults" aria-expanded="true" autocomplete="off" placeholder="Search sessions, themes, commands…"><kbd>Esc</kbd></div><div id="nxCommandResults" role="listbox"></div><footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer></div>`);
 const input=$('#nxCommandQuery'),host=$('#nxCommandResults');
 const render=()=>{filtered=NexusDesign.filterCommands(commands,input.value);index=Math.max(0,Math.min(index,filtered.length-1));let group='';host.innerHTML=filtered.slice(0,60).map((c,i)=>{const header=c.group!==group?`<div class="nx-command-group">${esc(c.group)}</div>`:'';group=c.group;return header+`<button id="nxCommand-${i}" role="option" aria-selected="${i===index}" data-command-index="${i}">${c.session?`<i class="nx-dot ${statusLabel(c.session)[0]}"></i>`:nxIcon(c.icon)}<span><strong>${esc(c.label)}</strong><small>${esc(c.hint||'')}</small></span>${c.session?nxModel(c.session):''}${i===index?'<kbd>↵</kbd>':''}</button>`;}).join('')||'<div class="nx-empty">No matching sessions or commands.</div>';input.setAttribute('aria-activedescendant',filtered.length?'nxCommand-'+index:'');};
 const run=i=>{const action=filtered[i];if(action){closeModal();action.run();}};
 input.oninput=()=>{index=0;render();};input.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();index=Math.max(0,Math.min(Math.min(filtered.length,60)-1,index+(e.key==='ArrowDown'?1:-1)));render();$('#nxCommand-'+index)?.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'){e.preventDefault();run(index);}};
 host.onclick=e=>{const b=e.target.closest('[data-command-index]');if(b)run(+b.dataset.commandIndex);};render();input.focus();
}
document.addEventListener('keydown',e=>{
 const model=$('#nxModelMenu'),typing=e.target.closest('input,textarea,select,[contenteditable=true]');
 if($('#nxSessionSettings')||$('#nxRaw'))return;
 if(model){if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();nxCloseModel();}else if(e.key==='Tab'){const buttons=[...model.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement),next=(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length;e.preventDefault();buttons[next]?.focus();}return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();e.stopImmediatePropagation();nxPalette();return;}
 if(typing||$('#modal').classList.contains('on')||NexusVoice.status!=='off'||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('.xterm'))return;
 if(['j','k','ArrowDown','ArrowUp'].includes(e.key)&&state.booted){e.preventDefault();e.stopImmediatePropagation();const rows=visible(),at=Math.max(0,rows.findIndex(s=>keyOf(s)===(nx.keyboardKey||state.sel))),i=Math.max(0,Math.min(rows.length-1,at+(['j','ArrowDown'].includes(e.key)?1:-1)));nx.keyboardKey=rows[i]&&keyOf(rows[i]);const row=$$('#cards [data-k]').find(b=>b.dataset.k===nx.keyboardKey);row?.focus();row?.scrollIntoView({block:'nearest'});}
 else if(e.key==='Enter'&&nx.keyboardKey){e.preventDefault();e.stopImmediatePropagation();select(nx.keyboardKey);}
 else if(e.key==='/'){e.preventDefault();e.stopImmediatePropagation();if(innerWidth<=700)setView('sessions');$('#search').focus();}
 else if(e.key==='Escape'&&state.view==='focus'){e.preventDefault();e.stopImmediatePropagation();setView(innerWidth<=700?'sessions':'overview');}
},true);
const nxAttentionRender=renderCards;
renderCards=function(){
 nxAttentionRender();const next=new Map(state.sessions.map(s=>[keyOf(s),statusLabel(s)[0]]));
 if(nx.attentionReady&&pref.get('attention')!=='off')for(const s of state.sessions){const key=keyOf(s);if(next.get(key)!=='ready'||nx.seen.get(key)==='ready')continue;NexusCall.incoming(s);if(innerWidth>700){const row=$$('#cards [data-k]').find(b=>b.dataset.k===key);row?.classList.add('pulse-once');setTimeout(()=>row?.classList.remove('pulse-once'),1850);}}
 nx.attentionReady=!!state.lastUpdate;nx.seen=next;
};
