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
const nxEventKey = e => JSON.stringify([e.t, e.id, e.ts, e.text]);
// A delegation still active from before the server's window comes as a stand-in at its top, stamped with its start;
// a longer read holds the real step instead. Only real events place one list against another.
const nxReal = e => !e.earlierDelegation;
// The events of `older` that come before `shown` starts: by place when `older` holds its first event, else by time
// (an event without one keeps the time before it). Earlier messages then always go above, never below the newest.
function nxBefore(older, shown) {
  older = older.filter(nxReal); shown = shown.filter(nxReal);
  if (!shown.length) return older;
  const keys = new Set(shown.map(nxEventKey)), at = older.findIndex(e => nxEventKey(e) === nxEventKey(shown[0])), limit = Date.parse(shown.find(e => e.ts)?.ts);
  let last = -Infinity;
  const head = at >= 0 ? older.slice(0, at) : !Number.isFinite(limit) ? older : older.filter(e => { const t = Date.parse(e.ts); if (Number.isFinite(t)) last = t; return last < limit; });
  return head.filter(e => !keys.has(nxEventKey(e)));
}
// The earlier part above the window. A stand-in goes once its real step is loaded above, which takes its fresh rows;
// until then it stays on top of everything loaded.
function nxJoin(older, shown) {
  const stand = new Map(shown.filter(e => !nxReal(e)).map(e => [e.id, e]));
  const head = nxBefore(older, shown).map(e => { const s = e.t === 'tool' && stand.get(e.id); if (!s) return e; stand.delete(e.id); return { ...e, subagents: s.subagents }; });
  return [...stand.values(), ...head, ...shown.filter(nxReal)];
}
// The server sends only its newest window; loaded earlier messages stay above it, and the window's copies are the fresh
// ones. A window that no longer touches what is shown leaves unknown messages between: show it alone and offer
// Load earlier again instead of a silent hole.
function nxWithEarlier(chat, fresh) {
  const known = new Set(chat.events.filter(nxReal).map(nxEventKey));
  if (fresh.length && known.size && !fresh.some(e => nxReal(e) && known.has(nxEventKey(e)))) { chat.earlier = null; return fresh; }
  return nxJoin(chat.events, fresh);
}
// Claude has the conversation open in another terminal: starting it here too makes two processes write to one transcript.
function nxOpenElsewhere(s) { return s?.kind === 'claude' && s.live && !s.inNexus && !s.term; }
const NX_UNHOSTED_NOTICE = "Running in another terminal. NEXUS can't type into it. Your text stays here.";
function nxUnhosted(key = state.sel) {
  const s = state.byKey.get(key), chat = chatFor(key);
  if (!s?.live) return false;
  // The queue snapshot knows whether this server can write to the session, even
  // when the session list still names a terminal that has just closed.
  if (typeof chat.queue?.hosted === 'boolean') return !chat.queue.hosted;
  return !(chat.terminal && !chat.terminal.exited) && !s.inNexus && !s.term;
}
function nxComposerNotice(key = state.sel) { return nxUnhosted(key) ? NX_UNHOSTED_NOTICE : chatFor(key).composerError || ''; }
function nxRenderComposerNotice() {
  const note = $('#steerNotice'), text = nxComposerNotice();
  if (!note) return;
  if (note.textContent !== text) note.textContent = text;
  note.hidden = !text;
  for (const el of [$('#steerIn'), $('[data-steer="send"]')]) {
    if (text) el?.setAttribute('aria-describedby', 'steerNotice');
    else el?.removeAttribute('aria-describedby');
  }
}
// A rejected spoken turn may arrive while another draft is in the box, or while
// its session is off screen. Keep both, under the session the words belonged to.
function nxKeepUnsent(text, key) {
  const input = state.sel === key ? $('#steerIn') : null;
  const current = input?.value ?? steerDrafts.get(key) ?? '', draft = attachments.contract(key, text);
  const value = !current.trim() ? draft : attachments.expand(key, current).trim() === text.trim() ? current : current + '\n\n' + draft;
  steerDrafts.set(key, value);
  if (input) { input.value = value; input.dispatchEvent(new Event('input', {bubbles:true})); }
}
function nxRejectUnhosted(text, key) {
  nxKeepUnsent(text, key);
  if (state.sel === key) renderSteer(state.byKey.get(key));
  return {ok:false,message:{text,status:'failed',error:NX_UNHOSTED_NOTICE}};
}
// 'more': earlier messages exist and Load earlier can fetch them; 'cut': they exist beyond what NEXUS reads at once.
function nxEarlierState(chat) {
  const e = chat.earlier;
  if (!e) return chat.truncated ? 'more' : '';
  return !e.truncated ? '' : e.bytes < 64e6 || e.limit < 10000 ? 'more' : 'cut';
}
function nxEmptyText(chat, key, earlier) {
  const parent = typeof nxForks !== 'undefined' && state.byKey.get(nxForks.get(key));
  if (!chat.loaded) return 'Loading conversation…';
  // A fork's transcript is written with its first message; the conversation it copies is not empty.
  if (parent) return `Forked from “${esc(parent.title)}”. Its earlier messages appear here after your first message.`;
  return earlier ? 'No messages in the latest part of this conversation.' : 'Your messages will appear here.';
}
// The server clips a long message (Claude at 40,000 with '…', Codex at 12,000 with '…', Copilot at 12,000 without),
// so a long record the sent text starts with is that message.
function messageMatches(event, text) {
  const recorded = String(event.text || '').trim(), typed = text.trim(), head = recorded.endsWith('…') ? recorded.slice(0, -1) : recorded;
  // A '!' line Claude Code runs in its shell is recorded as that command, not as a message.
  if (event.t === 'cmd') return typed.startsWith('!') && recorded === typed;
  return event.t === 'user' && (recorded === typed || recorded.length > 8000 && typed.length > head.length && typed.startsWith(head));
}
// The server judges its own active row when the terminal ends: it confirms a message the agent received, or returns
// it as a failed queue row with Retry. Failing it here too would put its text back in the composer a second time.
const nxServerHolds = (chat, message) => !!message.server && chat.queue?.active?.id === message.id;
// The pictures a message carries are drawn under it, so the paths that sent them go: @"…" and a bare uploads path.
const NX_SENT_PICTURES = /@"[^"\r\n]+\.(?:png|jpe?g|gif|webp)"\s*|"?(?:\b[A-Za-z]:[\\/]|\\\\)(?:[^\r\n"<>|?*:]*?[\\/])?uploads[\\/]\d{4}-\d{2}-\d{2}[\\/][^\r\n"<>|?*:\\/]+?\.(?:png|jpe?g|gif|webp)\b"?\s*/gi;
function deliveryFailure(chat, message, reason, key) {
  message.status = 'failed'; message.error = reason;
  // The text comes back to the box in its short form: a file still attached shows as its [name] again.
  const draft = attachments.contract(key, message.text);
  if (!steerDrafts.get(key)?.trim()) steerDrafts.set(key, draft);
  if (state.sel === key && $('#steerIn') && !$('#steerIn').value.trim()) $('#steerIn').value = draft;
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
    if (data.events) chat.events = chat.earlier ? nxWithEarlier(chat, data.events) : data.events;
    if(data.terminal?.id===chat.closedTerm)data.terminal=null;
    Object.assign(chat, { cursor: data.cursor || '', terminal: data.terminal, status: data.status, truncated: data.truncated, loaded: true, error: '', more: data.more, queue:data.queue||data.terminal?.queue });
    if(typeof queueSync==='function')queueSync(chat,key);
    if(typeof slashSync==='function')slashSync(chat,key);
    // Match only a new occurrence after this attempt, never an identical older request.
    for (const message of chat.pending) {
      if(message.command)continue;
      if (message.status === 'confirmed' || message.status === 'retried') continue;
      if (message.status === 'queued') {
        // A question or menu holds the agent too (terms report busy false then), and the pushed message waits behind it.
        if (chat.terminal?.busy || chat.terminal?.prompt || chat.terminal?.menu) message.receiptWaitAt = null;
        else message.receiptWaitAt ||= Date.now();
      }
      const matches = chat.events.filter(e => messageMatches(e, message.text));
      if (matches.length > message.previousMatches || matches.some(e => Date.parse(e.ts) >= message.at && !message.previousRecords.includes(JSON.stringify(e)))) {
        message.status = 'confirmed';
        message.record = JSON.stringify(matches.find(e => !message.previousRecords.includes(JSON.stringify(e))) || matches.at(-1));
        if (!message.voice && attachments.expand(key, steerDrafts.get(key)) === message.text) steerDrafts.delete(key);
        if (!message.voice && state.sel === key && $('#steerIn') && attachments.expand(key, $('#steerIn').value) === message.text) $('#steerIn').value = '';
      } else if (message.status !== 'failed' && !nxServerHolds(chat, message) && (chat.terminal?.exited || message.submittedAt &&
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
// The message under the reader's eyes before a re-render, and its place in the view. The chat is
// rebuilt as HTML every couple of seconds while a session works, and the summary above it changes
// height, so a pixel offset alone lets the text drift; the anchor keeps the same message still.
function nxChatAnchor(host) {
  const list = $('#chatMessages'); if (!list) return null;
  const hostTop = host.getBoundingClientRect().top;
  const children = [...list.children];
  const index = children.findIndex(c => c.getBoundingClientRect().bottom - hostTop > 0);
  if (index < 0) return null;
  const el = children[index];
  return { index, sig: nxChatSig(el), offset: el.getBoundingClientRect().top - hostTop };
}
function nxChatSig(el) { return el.tagName + '|' + el.className + '|' + (el.textContent || '').slice(0, 160); }
function nxChatRestore(host, anchor) {
  if (!anchor) return;
  const list = $('#chatMessages'); if (!list) return;
  const children = [...list.children];
  let el = children[anchor.index] && nxChatSig(children[anchor.index]) === anchor.sig ? children[anchor.index] : null;
  if (!el) { for (let d = 1; d < children.length && !el; d++) for (const i of [anchor.index + d, anchor.index - d]) { const c = children[i]; if (c && nxChatSig(c) === anchor.sig) { el = c; break; } } }
  if (!el) return;
  host.scrollTop += (el.getBoundingClientRect().top - host.getBoundingClientRect().top) - anchor.offset;
}
function renderReadableChat() {
  const host = $('#chatView'), key = state.sel, s = state.byKey.get(key) || selTerm(), chat = chatFor(key);
  if (host.dataset.sig !== key + ':onechat') {
    // The away divider marks what is new since this visit began: forget the checkpoint of the session left, so its
    // next visit takes a new one, and fix the divider's length when the chat opens so it does not tick while they read.
    const left = state.byKey.get(host.dataset.sig?.replace(/:onechat$/, ''));
    if (left && keyOf(left) !== keyOf(s || {})) apsis.away.delete(keyOf(left));
    chat.openedAt = Date.now();
    $('#chatConnection')?.remove();
    host.dataset.sig = key + ':onechat'; host.dataset.first = '1';
    host.innerHTML = '<div id="chatMessages"></div><div id="chatPending"></div><div id="chatConnection" role="status"></div>';
    if (!$('#chatNew')) {
      const pill = document.createElement('button'); pill.id = 'chatNew'; pill.className = 'chat-new hidden'; pill.textContent = 'New messages ↓';
      pill.onclick = () => { host.scrollTop = host.scrollHeight; pill.classList.add('hidden'); };
      host.after(pill);
      host.addEventListener('scroll', () => { if (host.scrollHeight - host.scrollTop - host.clientHeight < 80) { pill.classList.add('hidden'); host._reading = false; } });
      // A scroll up is the reader's word: stop following until they come back to the bottom.
      host.addEventListener('wheel', e => { if (e.deltaY < 0) host._reading = true; }, { passive: true });
      host.addEventListener('touchstart', e => { host._touchY = e.touches[0]?.clientY; }, { passive: true });
      host.addEventListener('touchmove', e => { const y = e.touches[0]?.clientY; if (y != null && host._touchY != null && y > host._touchY + 4) host._reading = true; host._touchY = y; }, { passive: true });
      host.addEventListener('keydown', e => { if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) host._reading = true; });
    }
    $('#chatNew').classList.add('hidden');
  }
  const follow = host.dataset.first === '1' || (!host._reading && host.scrollHeight - host.scrollTop - host.clientHeight < 80), top = host.scrollTop;
  const anchor = follow ? null : nxChatAnchor(host);
  const events=typeof slashChatEvents==='function'?slashChatEvents(chat):chat.events;
  const blocks = buildBlocks(NexusDesign.dedupeUsers(events)).filter(b => ['user','ai','think','tools','tool','note','command'].includes(b.t)&&!(b.t==='note'&&/^turn (?:started|complete)$/i.test(b.text)));
  for (const pending of chat.pending.filter(p => !p.command && p.status !== 'confirmed' && p.status !== 'retried')) {
    const next = blocks.findIndex(b => (b.t === 'pending' ? b.at : Date.parse(b.ts || b.items?.[0]?.ts)) > pending.at);
    blocks.splice(next < 0 ? blocks.length : next, 0, { ...pending, t: 'pending' });
  }
  let lastDay = '', awayShown = false;
  const checkpoint = s && (apsis.away.get(keyOf(s)) || s.insights?.digest)?.since;
  const awayMinutes = checkpoint ? Math.floor(((chat.openedAt || Date.now()) - checkpoint) / 60000) : 0;
  let html = blocks.map((b, index) => {
    const at = b.ts || b.items?.[0]?.ts;
    const day = at && new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    let prefix = '';
    if (day && day !== lastDay) { lastDay = day; prefix += `<div class="nx-day" role="separator"><span>${esc(day)}</span></div>`; }
    if(b.t==='command')return prefix+slashRow(b);
    if (!awayShown && awayMinutes > 0 && Date.parse(at) >= checkpoint) { awayShown = true; prefix += `<div class="nx-away" role="separator"><span>You were away for ${awayMinutes < 90 ? awayMinutes + " minutes" : awayMinutes < 2880 ? Math.round(awayMinutes / 60) + " hours" : Math.round(awayMinutes / 1440) + " days"}</span></div>`; }
    if (b.t === 'pending') return prefix + `<div class="ev user delivery-${b.status}"><div class="ev-label">You <time>${clockTime(b.at)}</time></div><div class="bubble"${nxShortTitle(b.text)}>${esc(nxShort(b.text))}</div>${nxDeliveryHTML(b,agentName(s?.kind))}</div>`;
    if (b.t === 'think') return prefix + `<details class="chat-thinking" open data-default-open data-disclosure="thinking-${esc(b.ts || index)}"><summary>${esc(nxThoughtLabel(b))}</summary><div>${esc(b.text)}</div></details>`;
    if (b.t === 'user') { const receipt = chat.pending.find(p=>p.status==='confirmed'&&p.record===JSON.stringify(b)),text=b.images?b.text.replace(NX_SENT_PICTURES,'').trim():b.text; return prefix + (text?blockHTML({...b,text},s,false):'') + nxImages(b.images) + (receipt?nxDeliveryHTML(receipt):''); }
    if (b.t === 'note' && b.images) return prefix + nxImages(b.images);
    if (!['tool','tools'].includes(b.t)) return prefix + blockHTML(b, s, false);
    const items = b.t === 'tools' ? b.items : [b];
    if(items.some(i=>i.subagents?.length))return prefix+nxDelegatedTools(items);
    const labels = NexusActivity.groups(items.map(i => i.human || NexusActivity.tool(i.name, i.input || i.text)));
    return prefix + `<details class="chat-tools" data-disclosure="chat-tools-${esc(items[0].id || index)}"><summary class="nx-steps">${items.length>1?`<b>${esc(labels.join(' · '))}</b>`:''}${items.map(i=>`<span class="${i.res?.err?'nx-step-error':''}">${esc(NexusActivity.step(i))}${i.res?.err?' · error':''}</span>`).join('')}</summary>${items.map(i => `<div><strong>${esc((i.human ? NexusActivity.describe([i.human]) : i.name))}</strong><pre>${esc(i.text)}</pre>${i.detail?.files?.map(f => nxDiff(f.diff || [])).join('') || ''}${i.res ? `<pre>${esc(i.res.text)}</pre>` : ''}</div>`).join('')}</details>${nxImages(items.flatMap(i=>i.res?.images||[]))}`;
  }).join('');
  const earlier = nxEarlierState(chat), button = earlier === 'more' ? '<button class="text-action" data-nx-earlier>Load earlier messages ↑</button>' : '';
  html = (button || (earlier === 'cut' ? '<div class="nx-day" role="separator"><span>Older messages are not shown here</span></div>' : '')) + html;
  if (s && typeof nxSummary === 'function') html = nxSummary(s) + html;
  if (!blocks.length) html = button + `<p class="chat-empty">${nxEmptyText(chat, key, earlier)}</p>`;
  if (chat.error) { const offline = /failed to fetch|networkerror|load failed|network request failed/i.test(chat.error); html += `<p class="chat-read-error" title="${esc(chat.error)}">${offline ? 'Could not reach NEXUS on your PC. Showing the last copy.' : 'Could not refresh. ' + esc(chat.error)} <button class="btn" data-chat="retry">Retry</button></p>`; }
  const changed = $('#chatMessages')._html !== html;
  updateHTML($('#chatMessages'), html);
  const prompt = chat.terminal?.prompt;
  updateHTML($('#chatPending'), prompt ? `<section class="permission-card" aria-label="Pending question"><strong>Waiting for you</strong><p>${esc(prompt.question)}</p>${prompt.context ? nxPromptContext(prompt.context) : ''}<div>${prompt.options.map(o => `<button class="permission-option" data-chat-answer="${o.key}">${prompt.mode === 'arrows' ? '' : `<b>${o.key}</b>`}<span>${esc(o.label)}</span></button>`).join('')}<button class="permission-option permission-cancel" data-chat-answer="esc" title="Esc">Cancel</button></div></section>` : '');
  const starting = chat.resuming || chat.pending.some(p => p.status === 'starting');
  host.after($('#chatConnection'));
  if(chat.terminal?.exited)chat.ended=true;
  // A session live in another process is not ended, whatever an earlier NEXUS terminal of it did; the process of a
  // terminal just closed here can still be listed for a poll.
  else if(chat.terminal||s?.live&&s.pid&&s.pid!==chat.closedPid)chat.ended=false;
  updateHTML($('#chatConnection'), starting ? `<div class="nx-session-starting" role="status"><i class="nx-spinner"></i><b>Starting the session…</b><span>${chat.resuming?'Resuming the saved conversation.':'Resuming the saved conversation, then sending your message.'}</span></div>` : chat.ended ? `<div class="nx-session-ended"><span>◯</span><div>${nxEndedNote(chat.terminal)}</div>${nxEndedGone(chat.terminal)?'<button class="btn" data-nx="new">New session</button>':`<button class="btn" data-chat-resume ${s&&!key.startsWith('term:')?'':'disabled'}>▷ Resume</button>`}</div>` : nxLiveBar(s,chat,prompt));
  if(typeof queueRender==='function')queueRender(chat,key);
  if (follow) { host.scrollTop = host.scrollHeight; $('#chatNew').classList.add('hidden'); }
  else { host.scrollTop = top; if (changed) { nxChatRestore(host, anchor); $('#chatNew').classList.remove('hidden'); } }
  nxPlaceChatNew();
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
  if(nxUnhosted(key)||nxOpenElsewhere(session))throw Object.assign(Error(NX_UNHOSTED_NOTICE),{elsewhere:true});
  const r=await postNexus('/api/action',{action:'term-resume',key});
  return chat.terminal={id:r.result.term};
}
// A session that stopped before its input box ever showed did not run: what its CLI printed last says why (no such
// session for that CLI, a missing folder, a CLI that is not installed in WSL), so Resume is not tried blindly again.
// A conversation its CLI no longer has cannot be resumed: say so plainly and offer a new session; the CLI's own words
// stay in the title for diagnosis.
function nxEndedGone(terminal){const x=terminal?.exited;return !!(x?.early&&/No conversation found/i.test(String(x.last||'')));}
function nxEndedNote(terminal){const x=terminal?.exited,why=String(x?.last||'').split('\n').map(l=>l.trim()).filter(Boolean).join(' · ');
  if(x?.early&&/No conversation found/i.test(String(x.last||'')))return `<b>This conversation is no longer on the PC</b><p title="${esc(why)}">Start a new session in this folder to keep going.</p>`;
  return x?.early&&why?`<b>The session stopped as it started</b><p>${esc(why)}</p>`:'<b>Session ended</b><p>Your conversation is saved. Resume to keep going.</p>';}
// The question's context: a short first line naming the tool (such as "Bash command") is a label; the rest is the
// command itself and stays in the code font.
function nxPromptContext(text){const m=String(text).match(/^([A-Za-z][A-Za-z ]{0,30})\n\s*\n([\s\S]+)$/);return m?`<small class="permission-context-label">${esc(m[1].trim())}</small><pre class="permission-context">${esc(m[2].replace(/^\n+/,''))}</pre>`:`<pre class="permission-context">${esc(text)}</pre>`;}
// The "New messages" pill sits just above the bottom of the message list, whatever the composer, queue and working row
// below it measure.
function nxPlaceChatNew(){const pill=$('#chatNew'),view=$('#chatView');if(!pill||!view||pill.classList.contains('hidden')||!pill.offsetParent)return;const gap=pill.offsetParent.getBoundingClientRect().bottom-view.getBoundingClientRect().bottom;pill.style.bottom=Math.max(8,Math.round(gap+12))+'px';}
// An agent error reads as a plain sentence; the CLI's own line (API Error: 529 ...) stays in the note's title.
function nxPlainAgentError(text){const t=String(text||''),m=t.match(/^API Error:\s*(\d{3})\b\s*([\s\S]*)$/i);if(!m)return t;const rest=m[2].trim();
  if(m[1]==='529'||/overloaded/i.test(rest))return 'The model service is busy. Try again in a moment.';
  if(m[1]==='429')return 'The model service is rate limited right now. Try again in a moment.';
  return rest&&!/^[{[]/.test(rest)?rest:'The model service returned an error. Try again in a moment.';}
function nxImages(names){return names?.length?`<div class="nx-chat-images">${names.map(n=>`<button class="nx-chat-image" data-chat-image="${esc(n)}" aria-label="Open image"><img loading="lazy" alt="" src="/api/chat-image?name=${encodeURIComponent(n)}"></button>`).join('')}</div>`:'';}
const NX_OWN_COMMANDS=new Set(['handoff']),NX_RENAME_COMMANDS=new Set(['rename','name']);
async function sendChat(retryId, voiceText, signal, key = state.sel, commandConfirmation, overrideText) {
  const chat = chatFor(key), input = key===state.sel?$('#steerIn'):null;
  if(signal?.aborted)return;
  if (chat.sending || chat.commandPreparing) return;
  // Enter must not be ignored without a word while a failed chip blocks the send.
  if (attachments.blocked(key)) { if (!attachments.failed(key)) return; const error = 'Remove the attachment that failed, then send.'; if (!voiceText) toast('Message not sent', error, 'bad'); return {ok:false,message:{error}}; }
  let message = retryId && chat.pending.find(p => p.id === retryId);
  // The server keeps a queue row's id as handled, so a Retry of one of its bubbles sends the text as a new message.
  const retired = message?.server ? message : null; if (retired) message = null;
  // The box holds each attached file as a short [name]; the agent gets the full path in its place, as before.
  const rawText=overrideText||retired?.text||message?.text||voiceText||(input?attachments.expand(key,input.value):undefined);
  const text=typeof NexusSlash!=='undefined'&&NexusSlash.parse(rawText)?rawText:rawText?.trim();if(!text)return;
  if(text==='/'&&!voiceText){slashUI.dismissed=null;input?.focus();slashSuggest();return;}
  const command=typeof NexusSlash!=='undefined'?NexusSlash.parse(text):null;
  // NEXUS's own commands change NEXUS, not the session, so they never wait in the queue.
  if(command&&!voiceText&&NX_OWN_COMMANDS.has(command.name.toLowerCase())){await slashNative({name:command.name.toLowerCase(),native:command.name.toLowerCase(),source:'NEXUS'},command,key);return;}
  // A new name is saved straight to the conversation, so it never waits for the session either. Copilot renames itself.
  if(command?.args&&!voiceText&&NX_RENAME_COMMANDS.has(command.name.toLowerCase())&&['claude','codex'].includes(state.byKey.get(key)?.kind)){await slashNative({name:'rename',native:'rename',source:'NEXUS'},command,key);return;}
  if(nxUnhosted(key))return nxRejectUnhosted(text,key);
  chat.composerError = '';
  if(typeof queueShouldQueue==='function'&&queueShouldQueue(chat,key)&&!voiceText){const queued=await queueEnqueue(text,key,message?.id);if(queued?.ok&&retired)retired.status='retried';return queued;}
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
  if (message || retired) {
    chat.sending = true;
    await loadChat(key, true);
    if ((message || retired).status === 'confirmed') { chat.sending = false; if (state.sel === key) renderReadableChat(); return; }
  }
  if (!message) {
    const previousRecords = chat.events.filter(e => messageMatches(e, text)).map(e => JSON.stringify(e));
    message = {id: crypto.randomUUID(),text,voice:!!voiceText,command:!!command,at:Date.now(),previousMatches:previousRecords.length,previousRecords}; chat.pending.push(message);
    // Its bubble stays in the list, hidden, so the server's row does not come back as a second one.
    if (retired) retired.status = 'retried';
  }
  const session = state.byKey.get(key);
  const existing = state.terms.find(t => !t.exited && (t.id === session?.term || 'term:' + t.id === key || t.sessionKey === key));
  message.status = chat.terminal && !chat.terminal.exited || existing ? 'pending' : 'starting'; message.submittedAt = null; message.receiptWaitAt = null; chat.sending = true;
  if (!message.voice) { steerDrafts.delete(key); const box = state.sel === key ? $('#steerIn') : null; if (box && attachments.expand(key, box.value).trim() === text.trim()) { box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); } }
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
    if (!message.voice && attachments.expand(key, steerDrafts.get(key)) === text) steerDrafts.delete(key);
    if (!message.voice && state.sel === key && $('#steerIn') && attachments.expand(key, $('#steerIn').value).trim() === text.trim()) $('#steerIn').value = '';
    if (!message.voice) attachments.clear(key);
    await refresh();
  } catch (error) {
    nxKeepUnsent(text,key);
    deliveryFailure(chat,message,error.message,key);
    chat.composerError = error.elsewhere ? '' : 'Message not sent. Your text is kept. ' + error.message;
  }
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
