'use strict';
const queueUI={key:null,editing:null,confirm:null,busy:false,seen:new Set(),sent:new Set(),since:Date.now()};
function queueShouldQueue(chat,key){const s=state.byKey.get(key);return !!(chat.queue?.items.length||chat.queue?.active||chat.queue?.hold||chat.terminal?.busy||chat.terminal?.prompt||chat.terminal?.menu||chat.terminal&&!chat.terminal.exited&&!(chat.terminal.input??chat.terminal.ready)||!chat.terminal&&s&&statusLabel(s)[0]==='busy');}
async function queueEnqueue(text,key,id=crypto.randomUUID()){
  if(nxUnhosted(key))return nxRejectUnhosted(text,key);
  if(queueUI.busy)return;queueUI.busy=true;
  try{const response=await postNexus('/api/action',{action:'queue-add',key,id,text});const chat=chatFor(key);chat.queue=response.result;chat.pending=chat.pending.filter(p=>p.id!==id);
    if($('#steerIn')&&attachments.expand(key,$('#steerIn').value).trim()===text.trim()&&state.sel===key)$('#steerIn').value='';steerDrafts.delete(key);attachments.clear(key);slashUI.dismissed=text;slashClose();
    if(state.sel===key)renderReadableChat();return {ok:true,message:{id,text,status:'queued'}};
  }catch(error){
    nxKeepUnsent(text,key);
    // A terminal may have closed since the last poll. Refresh its state before
    // explaining the rejection, and leave the reason beside the kept draft.
    await loadChat(key,true);
    chatFor(key).composerError=nxUnhosted(key)?'':'Message not queued. Your text is kept. '+error.message;
    if(state.sel===key)renderSteer(state.byKey.get(key));
    return {ok:false,message:{text,error:nxComposerNotice(key)}};
  }finally{queueUI.busy=false;}
}
function queueSync(chat,key){
  const q=chat.queue;if(!q)return;
  const oldest=chat.events.length?Date.parse(chat.events[0].ts):queueUI.since;
  for(const item of [q.active,...q.history].filter(Boolean)){
    const command=NexusSlash.parse(item.text);if(command&&item.submittedAt)slashUsed({name:command.name},key,item.id);
    if(['cancelled','opened'].includes(item.status)||NexusSlash.parse(item.text)&&item.status==='confirmed')continue;
    if(!chat.pending.some(p=>p.id===item.id)){
      // A row finished before the loaded conversation (or this page) cannot be checked here, and is not news.
      if(item.finishedAt<oldest)continue;
      const previousRecords=chat.events.filter(e=>messageMatches(e,item.text)&&Date.parse(e.ts)<item.submittedAt).map(e=>JSON.stringify(e));
      // The server judges its active row (a failure comes back as a row with Retry), and a terminal-only chat has no
      // transcript to judge by, so neither runs the chat's own timer. A pushed row waits for the agent's next step.
      const pushed=item.status==='pushed',timed=item!==q.active&&!key.startsWith('term:');
      chat.pending.push({id:item.id,text:item.text,at:item.submittedAt||item.at,submittedAt:timed?item.submittedAt:undefined,server:true,command:!!NexusSlash.parse(item.text),receipt:item.command,status:item.received?'confirmed':pushed?'queued':'pending',previousRecords,previousMatches:previousRecords.length});
    }
    const message=chat.pending.find(p=>p.id===item.id);if(item.received||item.status==='confirmed'){message.status='confirmed';message.record=JSON.stringify(chat.events.find(e=>messageMatches(e,item.text)&&Date.parse(e.ts)>=item.submittedAt));}
  }
  // A failed queue attempt stays in its editable server row, not a second retry UI.
  chat.pending=chat.pending.filter(p=>!q.items.some(item=>item.id===p.id));
}
async function queueChange(operation,item,extra={},key=state.sel){
  if(queueUI.busy)return;queueUI.busy=true;
  try{const r=await postNexus('/api/action',{action:'queue-change',key,operation,id:item?.id,...extra});chatFor(key).queue=r.result;queueUI.editing=null;queueUI.confirm=null;if(key===state.sel)renderReadableChat();}
  catch(error){toast('Queue unchanged',error.message,'bad');}
  finally{queueUI.busy=false;}
}
function queueRender(chat,key){
  if(queueUI.key!==key){$('#nxQueue')?.remove();queueUI.key=key;queueUI.editing=null;queueUI.confirm=null;queueUI.seen=new Set();}
  let host=$('#nxQueue');if(!host){host=document.createElement('section');host.id='nxQueue';host.className='nx-queue';host.setAttribute('aria-label','Message queue');$('#chatConnection').after(host);}
  const q=chat.queue;if(!q){host.replaceChildren();return;}
  const old=new Map([...host.querySelectorAll('[data-queue-id]')].map(el=>[el.dataset.queueId,el.getBoundingClientRect()]));
  const note=!nxUnhosted(key)&&(q.hold||q.items.length&&q.reason||!q.hosted&&queueShouldQueue(chat,key))?`<div class="nx-queue-note" role="status">${esc(q.reason||'Messages send in order when ready.')}${q.hold&&!q.items.some(i=>i.status==='failed')?'<button data-queue-action="resume">Resume queue</button>':''}</div>`:'';
  const html=note+q.items.map((item,i)=>{
    const busyInput=!q.hosted||chat.terminal?.prompt||chat.terminal?.menu;
    const action=item.status==='failed'?`<button data-queue-action="retry" title="${esc(item.error||'Not delivered')}">Retry</button>`:item.status==='confirm'?'<button data-queue-action="confirm">Run</button>':item.status==='control'?'<button data-queue-action="control">Open</button>':NexusSlash.parse(item.text)?'':`<button data-queue-action="push" ${busyInput?'disabled':''} title="Send it to the session now, without waiting">Send now</button>`;
    return `<div data-queue-id="${esc(item.id)}"><div class="nx-queue-row ${queueUI.seen.has(item.id)?'':'enter'}"><span>${item.status==='failed'?'Paused':'Queued'}</span><p title="${esc(item.text)}">${esc(nxShort(item.text))}</p><div class="nx-queue-actions">${action}<button class="nx-queue-x" data-queue-action="remove" aria-label="Remove queued message ${i+1}" title="Remove">×</button></div></div></div>`;
  }).join('');
  // Keep unsaved edits stable across the one-second chat poll.
  const draft=host.querySelector('textarea'),value=draft?.value,start=draft?.selectionStart,end=draft?.selectionEnd,focused=document.activeElement===draft;
  updateHTML(host,html);if(value!==undefined&&host.querySelector('textarea')){const input=host.querySelector('textarea');input.value=value;if(focused){input.focus();input.setSelectionRange(start,end);}}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  for(const el of host.querySelectorAll('[data-queue-id]')){const prior=old.get(el.dataset.queueId);if(prior&&!reduced){const dy=prior.top-el.getBoundingClientRect().top;if(dy)el.animate([{transform:`translateY(${dy}px)`},{transform:'none'}],{duration:240,easing:'cubic-bezier(.22,1,.36,1)'});}}
  if(!reduced)for(const [id,rect]of old)if(!q.items.some(i=>i.id===id)&&q.active?.id===id){const ghost=document.createElement('div');ghost.className='nx-queue-row';ghost.textContent='Sending '+nxShort(q.active.text);Object.assign(ghost.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',zIndex:40,pointerEvents:'none'});document.body.append(ghost);ghost.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-12px)'}],{duration:240,easing:'cubic-bezier(.22,1,.36,1)'}).finished.finally(()=>ghost.remove());}
  queueUI.seen=new Set(q.items.map(i=>i.id));
  host.onclick=async e=>{
    if(queueUI.busy)return;
    const b=e.target.closest('[data-queue-action]');if(!b)return;const id=b.closest('[data-queue-id]')?.dataset.queueId,item=q.items.find(i=>i.id===id),action=b.dataset.queueAction;
    if(action==='edit'){queueUI.editing=id;queueRender(chat,key);host.querySelector('textarea')?.focus();return;}
    if(action==='discard-edit'){queueUI.editing=null;queueRender(chat,key);return;}
    if(action==='send-now'){queueUI.confirm={id,action};queueRender(chat,key);return;}
    if(action==='dismiss-confirm'){queueUI.confirm=null;queueRender(chat,key);return;}
    if(action==='accept-confirm'){await queueChange(queueUI.confirm.action,item,{confirmed:true,expectedText:item.text},key);return;}
    if(action==='save'){await queueChange('edit',item,{text:b.parentElement.querySelector('textarea').value},key);return;}
    if(action==='up'||action==='down'){await queueChange('move',item,{index:q.items.indexOf(item)+(action==='up'?-1:1)},key);return;}
    if(action==='control'){
      queueUI.busy=true;let token;
      try{
        const claimed=await postNexus('/api/action',{action:'queue-change',key,operation:'control-claim',id});chat.queue=claimed.result;token=claimed.result.items.find(i=>i.id===id)?.controlToken;
        const entries=await slashCatalog(key),command=NexusSlash.parse(item.text),entry=entries.find(e=>e.name===command?.name);
        if(!entry||!await slashNative(entry,command,key,true))throw Error('The native control is unavailable.');
        const done=await postNexus('/api/action',{action:'queue-change',key,operation:'control-done',id,controlToken:token});chat.queue=done.result;slashUsed(entry,key,id);
      }catch(error){
        if(token)try{const failed=await postNexus('/api/action',{action:'queue-change',key,operation:'control-failed',id,controlToken:token,error:error.message});chat.queue=failed.result;}catch{}
        toast('Control not opened',error.message,'bad');
      }finally{queueUI.busy=false;if(state.sel===key)renderReadableChat();}return;
    }
    await queueChange(action,item,['confirm','retry'].includes(action)?{confirmed:true,expectedText:item.text}:{},key);
  };
}
