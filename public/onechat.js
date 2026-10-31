'use strict';
// Chat owns HTTP polling and delivery receipts. Raw Terminal alone owns xterm.
const chats = new Map();
function chatFor(key = state.sel) {
  const canonical = state.byKey.get(key);
  if (canonical && chats.has(keyOf(canonical))) { chats.set(key, chats.get(keyOf(canonical))); return chats.get(key); }
  if (!chats.has(key)) chats.set(key, { events: [], pending: [], cursor: '', loaded: false, busy: false, sending: false, terminal: null });
  if (canonical) chats.set(keyOf(canonical), chats.get(key));
  return chats.get(key);
}
function chatSending(key) { return chats.get(key)?.sending || false; }
function messageMatches(event, text) {
  const recorded = String(event.text || '').trim();
  return event.t === 'user' && (recorded === text.trim() || recorded === text.trim().slice(0, 8000) + '…');
}
function deliveryFailure(chat, message, reason, key) {
  message.status = 'failed'; message.error = reason;
  if (!steerDrafts.get(key)?.trim()) steerDrafts.set(key, message.text);
  if (state.sel === key && $('#steerIn') && !$('#steerIn').value.trim()) $('#steerIn').value = message.text;
}
async function loadChat(key = state.sel, force = false) {
  if (!key || !force && (document.hidden || state.view !== 'focus' || state.tab !== 'chat')) return;
  const chat = chatFor(key); if (chat.busy) return chat.request;
  chat.busy = true;
  chat.request = (async () => {
  try {
    let data;
    if (key.startsWith('term:')) {
      const terminal = await api('/api/term-state?term=' + encodeURIComponent(key.slice(5)));
      const agent = agentName(state.terms.find(t => t.id === terminal.id)?.kind);
      data = {terminal, events:[], status:terminal.exited ? 'Done' : terminal.prompt ? 'Waiting for you' : terminal.busy ? agent + ' is thinking...' : 'Waiting for you'};
    }
    else data = await api('/api/chat?key=' + encodeURIComponent(key) + '&cursor=' + encodeURIComponent(chat.cursor));
    if (data.events) {const seen=new Set();chat.events=[...(chat.earlierEvents||[]),...data.events].filter(e=>{const id=JSON.stringify([e.t,e.id,e.ts,e.text]);if(seen.has(id))return false;seen.add(id);return true;});}
    if(data.terminal?.id===chat.closedTerm)data.terminal=null;
    Object.assign(chat, { cursor: data.cursor || '', terminal: data.terminal, status: data.status, truncated: data.truncated, loaded: true, error: '', more: data.more, queue:data.queue||data.terminal?.queue });
    if(typeof queueSync==='function')queueSync(chat,key);
    if(typeof slashSync==='function')slashSync(chat,key);
    // Match only a new occurrence after this attempt, never an identical older request.
    for (const message of chat.pending) {
      if(message.command)continue;
      if (message.status === 'confirmed') continue;
      if (message.status === 'queued') {
        if (chat.terminal?.busy) message.receiptWaitAt = null;
        else message.receiptWaitAt ||= Date.now();
      }
      const matches = chat.events.filter(e => messageMatches(e, message.text));
      if (matches.length > message.previousMatches || matches.some(e => Date.parse(e.ts) >= message.at && !message.previousRecords.includes(JSON.stringify(e)))) {
        message.status = 'confirmed';
        message.record = JSON.stringify(matches.find(e => !message.previousRecords.includes(JSON.stringify(e))) || matches.at(-1));
        if (!message.voice && steerDrafts.get(key) === message.text) steerDrafts.delete(key);
        if (!message.voice && state.sel === key && $('#steerIn')?.value === message.text) $('#steerIn').value = '';
      } else if (message.status !== 'failed' && (chat.terminal?.exited || message.submittedAt &&
        (message.status !== 'queued' || message.receiptWaitAt) && Date.now() - (message.receiptWaitAt || message.submittedAt) > 45000)) {
        deliveryFailure(chat, message, chat.terminal?.exited ? 'The session ended before the message appeared. Your text is kept.' : 'The message has not appeared in the conversation. Check it before retrying; your text is kept.', key);
      }
    }
    if (state.sel === key) {
      state.activity = data.activity || state.activity;
      state.transcriptKey = key; state.transcriptAt = data.capturedAt || Date.now();
      renderReadableChat();
    }
  } catch (error) { chat.error = error.message; if (state.sel === key) renderReadableChat(); }
  finally { chat.busy = false; }
  })();
  return chat.request;
}
function renderReadableChat() {
  const host = $('#chatView'), key = state.sel, s = state.byKey.get(key) || selTerm(), chat = chatFor(key);
  if (host.dataset.sig !== key + ':onechat') {
    $('#chatConnection')?.remove();
    host.dataset.sig = key + ':onechat'; host.dataset.first = '1';
    host.innerHTML = '<div id="chatMessages"></div><div id="chatPending"></div><div id="chatConnection" role="status"></div>';
    if (!$('#chatNew')) {
      const pill = document.createElement('button'); pill.id = 'chatNew'; pill.className = 'chat-new hidden'; pill.textContent = 'New messages ↓';
      pill.onclick = () => { host.scrollTop = host.scrollHeight; pill.classList.add('hidden'); };
      host.after(pill);
      host.addEventListener('scroll', () => { if (host.scrollHeight - host.scrollTop - host.clientHeight < 80) pill.classList.add('hidden'); });
    }
    $('#chatNew').classList.add('hidden');
  }
  const follow = host.dataset.first === '1' || host.scrollHeight - host.scrollTop - host.clientHeight < 80, top = host.scrollTop;
  const events=typeof slashChatEvents==='function'?slashChatEvents(chat):chat.events;
  const blocks = buildBlocks(NexusDesign.dedupeUsers(events)).filter(b => ['user','ai','think','tools','tool','note','command'].includes(b.t)&&!(b.t==='note'&&/^turn (?:started|complete)$/i.test(b.text)));
  for (const pending of chat.pending.filter(p => !p.command && p.status !== 'confirmed')) {
    const next = blocks.findIndex(b => (b.t === 'pending' ? b.at : Date.parse(b.ts || b.items?.[0]?.ts)) > pending.at);
    blocks.splice(next < 0 ? blocks.length : next, 0, { ...pending, t: 'pending' });
  }
  let lastDay = '', awayShown = false;
  const checkpoint = s && (apsis.away.get(keyOf(s)) || s.insights?.digest)?.since;
  const awayMinutes = checkpoint ? Math.floor((Date.now() - checkpoint) / 60000) : 0;
  let html = blocks.map((b, index) => {
    const at = b.ts || b.items?.[0]?.ts;
    const day = at && new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    let prefix = '';
    if (day && day !== lastDay) { lastDay = day; prefix += `<div class="nx-day" role="separator"><span>${esc(day)}</span></div>`; }
    if(b.t==='command')return prefix+slashRow(b);
    if (!awayShown && awayMinutes > 0 && Date.parse(at) >= checkpoint) { awayShown = true; prefix += `<div class="nx-away" role="separator"><span>You were away for ${awayMinutes < 90 ? awayMinutes + " minutes" : awayMinutes < 2880 ? Math.round(awayMinutes / 60) + " hours" : Math.round(awayMinutes / 1440) + " days"}</span></div>`; }
    if (b.t === 'pending') return prefix + `<div class="ev user delivery-${b.status}"><div class="ev-label">You <time>${clockTime(b.at)}</time></div><div class="bubble">${esc(b.text)}</div>${nxDeliveryHTML(b,agentName(s?.kind))}</div>`;
    if (b.t === 'think') return prefix + `<details class="chat-thinking" open data-default-open data-disclosure="thinking-${esc(b.ts || index)}"><summary>${esc(nxThoughtLabel(b))}</summary><div>${esc(b.text)}</div></details>`;
    if (b.t === 'user') { const receipt = chat.pending.find(p=>p.status==='confirmed'&&p.record===JSON.stringify(b)),text=b.images?b.text.replace(/@"[^"\r\n]+\.(?:png|jpe?g|gif|webp)"\s*/gi,'').trim():b.text; return prefix + (text?blockHTML({...b,text},s,false):'') + nxImages(b.images) + (receipt?nxDeliveryHTML(receipt):''); }
    if (b.t === 'note' && b.images) return prefix + nxImages(b.images);
    if (!['tool','tools'].includes(b.t)) return prefix + blockHTML(b, s, false);
    const items = b.t === 'tools' ? b.items : [b];
    if(items.some(i=>i.subagents?.length))return prefix+nxDelegatedTools(items);
    const labels = NexusActivity.groups(items.map(i => i.human || NexusActivity.tool(i.name, i.input || i.text)));
    return prefix + `<details class="chat-tools" data-disclosure="chat-tools-${esc(items[0].id || index)}"><summary class="nx-steps">${items.length>1?`<b>${esc(labels.join(' · '))}</b>`:''}${items.map(i=>`<span class="${i.res?.err?'nx-step-error':''}">${esc(NexusActivity.step(i))}${i.res?.err?' · error':''}</span>`).join('')}</summary>${items.map(i => `<div><strong>${esc((i.human ? NexusActivity.describe([i.human]) : i.name))}</strong><pre>${esc(i.text)}</pre>${i.detail?.files?.map(f => nxDiff(f.diff || [])).join('') || ''}${i.res ? `<pre>${esc(i.res.text)}</pre>` : ''}</div>`).join('')}</details>${nxImages(items.flatMap(i=>i.res?.images||[]))}`;
  }).join('');
  if (chat.truncated && !chat.earlier) html = '<button class="text-action" data-nx-earlier>Load earlier messages ↑</button>' + html;
  if (s && typeof nxSummary === 'function') html = nxSummary(s) + html;
  if (!blocks.length) html = `<p class="chat-empty">${chat.loaded ? 'Your messages will appear here.' : 'Loading conversation…'}</p>`;
  if (chat.error) html += `<p class="chat-read-error">Could not refresh. ${esc(chat.error)} <button class="btn" data-chat="retry">Retry</button></p>`;
  const changed = $('#chatMessages')._html !== html;
  updateHTML($('#chatMessages'), html);
  const prompt = chat.terminal?.prompt;
  updateHTML($('#chatPending'), prompt ? `<section class="permission-card" aria-label="Pending question"><strong>Waiting for you</strong><p>${esc(prompt.question)}</p>${prompt.context ? `<pre class="permission-context">${esc(prompt.context)}</pre>` : ''}<div>${prompt.options.map(o => `<button class="permission-option" data-chat-answer="${o.key}">${prompt.mode === 'arrows' ? '' : `<b>${o.key}</b>`}<span>${esc(o.label)}</span></button>`).join('')}<button class="permission-option" data-chat-answer="esc">Esc · Cancel</button></div></section>` : '');
  const starting = chat.resuming || chat.pending.some(p => p.status === 'starting');
  host.after($('#chatConnection'));
  if(chat.terminal?.exited)chat.ended=true;
  else if(chat.terminal)chat.ended=false;
  updateHTML($('#chatConnection'), starting ? `<div class="nx-session-starting" role="status"><i class="nx-spinner"></i><b>Starting the session…</b><span>${chat.resuming?'Resuming the saved conversation.':'Resuming the saved conversation, then sending your message.'}</span></div>` : chat.ended ? `<div class="nx-session-ended"><span>◯</span><div><b>Session ended</b><p>Your conversation is saved. Resume to keep going.</p></div><button class="btn" data-chat-resume ${s&&!key.startsWith('term:')?'':'disabled'}>▷ Resume</button></div>` : nxLiveBar(s,chat,prompt));
  if(typeof queueRender==='function')queueRender(chat,key);
  if (follow) { host.scrollTop = host.scrollHeight; $('#chatNew').classList.add('hidden'); }
  else { host.scrollTop = top; if (changed) $('#chatNew').classList.remove('hidden'); }
  if (chat.loaded) host.dataset.first = '';
  renderSteer(s || {kind:'claude'});
  if (s && typeof nxDetails === 'function') nxDetails(s);
  const badge = $('#focusHead .fh-row .status');
  if (badge && s) { const [cls, label] = statusLabel(s); badge.className = 'status ' + cls; badge.innerHTML = '<i></i>' + esc(label); }
  if (!chat.loaded && !chat.busy) loadChat();
}
async function ensureChatTerminal(key, signal) {
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const chat=chatFor(key),session=state.byKey.get(key);
  const existing=state.terms.find(t=>!t.exited&&(t.id===session?.term||'term:'+t.id===key||t.sessionKey===key));
  if(chat.terminal&&!chat.terminal.exited)return chat.terminal;
  if(existing)return chat.terminal=existing;
  const r=await postNexus('/api/action',{action:'term-resume',key});
  return chat.terminal={id:r.result.term};
}
function nxImages(names){return names?.length?`<div class="nx-chat-images">${names.map(n=>`<button class="nx-chat-image" data-chat-image="${esc(n)}" aria-label="Open image"><img loading="lazy" alt="" src="/api/chat-image?name=${encodeURIComponent(n)}"></button>`).join('')}</div>`:'';}
const NX_OWN_COMMANDS=new Set(['handoff']),NX_RENAME_COMMANDS=new Set(['rename','name']);
async function sendChat(retryId, voiceText, signal, key = state.sel, commandConfirmation, overrideText) {
  const chat = chatFor(key), input = key===state.sel?$('#steerIn'):null;
  if(signal?.aborted)return;
  if (chat.sending || chat.commandPreparing || attachments.blocked(key)) return;
  let message = retryId && chat.pending.find(p => p.id === retryId);
  const rawText=overrideText||message?.text||voiceText||input?.value;
  const text=typeof NexusSlash!=='undefined'&&NexusSlash.parse(rawText)?rawText:rawText?.trim();if(!text)return;
  if(text==='/'&&!voiceText){slashUI.dismissed=null;input?.focus();slashSuggest();return;}
  const command=typeof NexusSlash!=='undefined'?NexusSlash.parse(text):null;
  // NEXUS's own commands change NEXUS, not the session, so they never wait in the queue.
  if(command&&!voiceText&&NX_OWN_COMMANDS.has(command.name.toLowerCase())){await slashNative({name:command.name.toLowerCase(),native:command.name.toLowerCase(),source:'NEXUS'},command,key);return;}
  // A new name is saved straight to the conversation, so it never waits for the session either. Copilot renames itself.
  if(command?.args&&!voiceText&&NX_RENAME_COMMANDS.has(command.name.toLowerCase())&&['claude','astra'].includes(state.byKey.get(key)?.kind)){await slashNative({name:'rename',native:'rename',source:'NEXUS'},command,key);return;}
  if(typeof queueShouldQueue==='function'&&queueShouldQueue(chat,key)&&!voiceText)return queueEnqueue(text,key,message?.id);
  if(chat.terminal?.prompt||chat.terminal?.menu)return {ok:false,message:{error:'Answer the question or close the terminal menu first. Your text is kept.'}};
  if(command){
    if(voiceText||!slashTextMode())return {ok:false,message:{error:'Slash commands are available in the text composer only.'}};
    if(NexusSlash.risk(command)&&commandConfirmation!==text){slashClose();slashConfirm(text,key,()=>sendChat(retryId,undefined,signal,key,text,text));return;}
    // Fetch the catalog without holding up ordinary messages. Unknown commands still go to the CLI.
    chat.commandPreparing=true;
    try{
      let entries=[];try{entries=await slashCatalog(key);}catch{}
      if(state.sel!==key||signal?.aborted)return;
      const entry=entries.find(e=>e.name===command.name);
      if(NexusSlash.handling(entry,command).startsWith('native:')&&await slashNative(entry,command,key))return;
    }finally{chat.commandPreparing=false;}
  }
  // Refresh receipts before a retry so a delayed receipt cannot duplicate a turn.
  if (message) {
    chat.sending = true;
    await loadChat(key, true);
    if (message.status === 'confirmed') { chat.sending = false; if (state.sel === key) renderReadableChat(); return; }
  }
  if (!message) {
    const previousRecords = chat.events.filter(e => messageMatches(e, text)).map(e => JSON.stringify(e));
    message = {id: crypto.randomUUID(),text,voice:!!voiceText,command:!!command,at:Date.now(),previousMatches:previousRecords.length,previousRecords}; chat.pending.push(message);
  }
  const session = state.byKey.get(key);
  const existing = state.terms.find(t => !t.exited && (t.id === session?.term || 'term:' + t.id === key || t.sessionKey === key));
  message.status = chat.terminal && !chat.terminal.exited || existing ? 'pending' : 'starting'; message.submittedAt = null; message.receiptWaitAt = null; chat.sending = true;
  if (!message.voice) { steerDrafts.delete(key); const box = state.sel === key ? $('#steerIn') : null; if (box && box.value.trim() === text.trim()) { box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); } }
  if (state.sel === key) renderReadableChat();
  try {
    let terminal = chat.terminal;
    if (!terminal || terminal.exited) terminal = existing && !existing.exited ? existing : null;
    if (!terminal) {
      terminal = await ensureChatTerminal(key,signal);
    }
    message.term = terminal.id;
    if (signal?.aborted) throw Error('Talk ended before sending. Your heard text was not sent.');
    const response = await postNexus('/api/action', {action:'term-send',term:terminal.id,text,commandId:message.id,...(command?{commandConfirmation}:{})});
    if(response.result.serverQueue){chat.queue=response.result.queue;chat.pending=chat.pending.filter(p=>p!==message);message.status='queued';}
    if(command&&!response.result.queued&&typeof slashUsed==='function')slashUsed({name:command.name},key,message.id);
    if(response.result.command)message.receipt=response.result.command;
    message.submittedAt = response.result.serverQueue?null:response.result.submittedAt || Date.now();
    if (message.status !== 'confirmed') message.status = response.result.queued ? 'queued' : 'pending';
    if (!message.voice && steerDrafts.get(key) === text) steerDrafts.delete(key);
    if (!message.voice && state.sel === key && $('#steerIn')?.value.trim() === text.trim()) $('#steerIn').value = '';
    if (!message.voice) attachments.clear(key);
    await refresh();
  } catch (error) { deliveryFailure(chat,message,error.message,key); }
  finally { chat.sending = false; if (state.sel === key) { renderReadableChat(); await loadChat(); } }
  return {ok:message.status !== 'failed',message};
}
async function answerChat(answer, signature, key = state.sel, signal) {
  const chat = chatFor(key), terminal = chat.terminal;
  if(signal?.aborted)return false;
  if (!terminal || terminal.exited || chat.answering) return;
  chat.answering = true;
  try { await postNexus('/api/action',{action:'term-send',term:terminal.id,answer,signature:signature ?? terminal.prompt?.signature}); await loadChat(key,true); return true; }
  catch (error) { toast('Answer not sent',error.message,'bad'); return false; }
  finally { chat.answering = false; }
}
document.addEventListener('click', e => {
  const retry = e.target.closest('[data-chat-retry]'); if (retry) sendChat(retry.dataset.chatRetry);
  const answer = e.target.closest('[data-chat-answer]'); if (answer) answerChat(answer.dataset.chatAnswer);
  const image = e.target.closest('[data-chat-image]'); if (image) { modal(`<img class="nx-chat-image-full" alt="Conversation image" src="/api/chat-image?name=${encodeURIComponent(image.dataset.chatImage)}"><button class="btn" data-close>Close</button>`); $('#modalCard').onclick = e => { if (e.target.closest('[data-close]')) closeModal(); }; }
});
setInterval(() => loadChat(), 1000);
