'use strict';
function agentName(kind) { return ({claude:'Claude',astra:'Astra',copilot:'Copilot',antigravity:'Antigravity'})[kind] || 'Agent'; }
// NEXUS session deck — client.

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  sessions: [], byKey: new Map(), filter: 'all', group: '*', query: '', sel: null, view: 'overview',
  bytes: 3e6, limit: 600, feedSize: -1, feedKey: null, feedBlocks: 0, expanded: new Set(),
  prev: new Map(), ready: new Set(), booted: false, home: '',
  terms: [], tab: 'feed', activity: null, thinkOpen: false,
};
const keyOf = s => s.kind + ':' + s.id;

async function api(path) {
  return nexusRequest(path);
}
async function act(action, extra) {
  try {
    const j = await postNexus('/api/action', { action, ...extra });
    return j.result || true;
  } catch (e) { toast('Action failed', e.message, 'bad'); return false; }
}

// ---------------- formatting ----------------

function ago(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 45) return 'now';
  if (d < 3600) return Math.round(d / 60) + 'm';
  if (d < 86400) return Math.round(d / 3600) + 'h';
  return Math.round(d / 86400) + 'd';
}
function clockTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function bytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(0) + ' MB';
  return Math.max(1, Math.round(n / 1e3)) + ' KB';
}
function shortPath(p) {
  if (!p) return '';
  if (state.home && p.toLowerCase().startsWith(state.home.toLowerCase())) p = '~' + p.slice(state.home.length);
  const parts = p.split('\\');
  return parts.length > 4 ? '…\\' + parts.slice(-2).join('\\') : p;
}
function highlight(text, q) {
  const t = esc(text);
  if (!q) return t;
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return t.replace(re, '<mark>$1</mark>');
}

// Small, safe markdown: escape first, then format.
function md(src) {
  const blocks = [];
  let s = String(src || '').replace(/```[^\n]*\n([\s\S]*?)(```|$)/g, (_, code) => { blocks.push(code.replace(/\n$/, '')); return '\u0000' + (blocks.length - 1) + '\u0000'; });
  s = esc(s);
  const inline = t => t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push('<' + list.tag + '>' + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + '</' + list.tag + '>'); list = null; } };
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) { flushPara(); flushList(); out.push(line.trim()); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^&gt;\s?(.*)/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    if (/^\|.*\|\s*$/.test(line)) {
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      const cells = r => r.trim().slice(1, -1).split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\|[\s:|-]+\|\s*$/.test(r));
      out.push('<table>' + body.map((r, ri) => '<tr>' + cells(r).map(c => ri === 0 ? '<th>' + inline(c) + '</th>' : '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</table>');
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list) flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, n) => '<pre><code>' + esc(blocks[+n]) + '</code></pre>');
}

// ---------------- toasts + modal ----------------

function toast(title, body, kind, onClick) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = '<b>' + esc(title) + '</b>' + esc(body || '');
  el.onclick = () => { if (onClick) onClick(); dismiss(); };
  const dismiss = () => { el.classList.add('bye'); setTimeout(() => el.remove(), document.body.classList.contains('redesign') ? 400 : 300); };
  let host = $('#toasts');
  if ($('#modal').classList.contains('on')) {
    host = $('#modalNotices');
    if (!host) {
      host = document.createElement('div'); host.id = 'modalNotices'; host.setAttribute('role', 'status');
      ($('#modalCard h2') || $('#modalCard').firstElementChild).after(host);
    }
  }
  const maximum = matchMedia('(max-width: 700px)').matches ? 1 : 3;
  while (host.children.length >= maximum) host.firstElementChild.remove();
  host.appendChild(el);
  setTimeout(dismiss, kind === 'good' ? 9000 : 5000);
}

let modalReturn = null, modalReturnSelector = null, modalVersion = 0;
function modal(html) {
  $('#toasts').replaceChildren();
  attachments.discardNew();
  modalVersion++;
  if (!$('#modal').classList.contains('on')) {
    modalReturn = document.activeElement;
    const attr = ['id', 'data-a', 'data-k', 'data-g', 'data-tab'].find(a => modalReturn.hasAttribute(a));
    modalReturnSelector = attr ? `[${attr}="${CSS.escape(modalReturn.getAttribute(attr))}"]` : null;
  }
  $('#modalCard').innerHTML = '<button class="modal-dismiss" data-modal-dismiss aria-label="Close dialog">×</button>' + html;
  const heading = $('#modalCard h2');
  if (heading) heading.id = 'modalTitle';
  $('#modalCard').onclick = null;
  $('#modal').classList.add('on');
  $('#app').inert = true;
  const initialFocus = matchMedia('(max-width: 700px)').matches ? $('#modalCard [data-modal-dismiss]') : ($('#modalCard [autofocus]') || $('#modalCard button:not([data-modal-dismiss])') || $('#modalCard'));
  initialFocus.focus({ preventScroll: true });
}
function closeModal() {
  attachments.discardNew();
  modalVersion++;
  $('#modal').classList.remove('on');
  $('#app').inert = false;
  const target = modalReturn?.isConnected ? modalReturn : (modalReturnSelector && $(modalReturnSelector)) || $('#newBtn');
  target.focus({ preventScroll: true });
}
document.addEventListener('keydown', e => {
  if (!$('#modal').classList.contains('on')) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeModal(); return; }
  if (e.key !== 'Tab') return;
  const items = [...$('#modalCard').querySelectorAll('button:not(:disabled), input:not(:disabled), select, textarea, a[href], summary, [tabindex="0"]')].filter(x => x.getClientRects().length);
  const first = items[0], last = items[items.length - 1];
  if (!first) { e.preventDefault(); $('#modalCard').focus(); return; }
  if (e.shiftKey && (document.activeElement === first || document.activeElement === $('#modalCard'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !$('#modalCard').contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}, true);

$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
$('#modal').addEventListener('click', e => { if (e.target.closest('[data-modal-dismiss]')) closeModal(); });

// ---------------- data ----------------

async function refresh() {
  if (deviceUI.refreshing) return deviceUI.refreshing;
  deviceUI.refreshing = refreshData();
  try { return await deviceUI.refreshing; } finally { deviceUI.refreshing = null; }
}
async function refreshData() {
  let data;
  // Every 16th poll asks for the full list, so a stale local copy can never last.
  state.sessionPolls = (state.sessionPolls || 0) + 1;
  const since = state.sessionsRev && state.sessionPolls % 16 ? '?since=' + encodeURIComponent(state.sessionsRev) : '';
  try { data = await api('/api/sessions' + since); }
  catch (error) {
    connectionLost(error);
    return null;
  }
  if (data.delta) {
    const known = new Map((state.sessions || []).map(s => [keyOf(s), s]));
    for (const s of data.sessions) known.set(keyOf(s), s);
    const full = data.order.map(k => known.get(k));
    if (full.some(s => !s)) { state.sessionsRev = ''; return refreshData(); }
    data.sessions = full;
  }
  state.sessionsRev = data.rev || '';
  // An updated NEXUS took over (server.js handOver): load its page, unless a message or dialog is in progress.
  if (data.build && state.build && data.build !== state.build) {
    const writing = $('#modal').classList.contains('on') || [...steerDrafts.values()].some(t => String(t || '').trim()) || !!$('#steerIn')?.value.trim();
    if (!writing) { location.reload(); return null; }
    if (state.reloadOffered !== data.build) { state.reloadOffered = data.build; toast('NEXUS was updated', 'Click here to load the new version.', '', () => location.reload()); }
  }
  state.build ||= data.build;
  state.lastUpdate = data.now;
  state.receivedAt = Date.now();
  state.remote = !!data.remote; state.remoteUrl = data.remoteUrl;
  document.body.classList.toggle('remote-device', state.remote);
  state.home = data.home; state.agents = data.agents; state.summarizer = data.summarizer; state.settings = data.settings || {};
  const next = data.sessions;
  const voiceActive = typeof NexusVoice !== 'undefined' && NexusVoice.status !== 'off';
  for (const s of next) {
    const k = keyOf(s), was = state.prev.get(k);
    const selected = k === state.sel || s.aliases?.includes(state.sel);
    if (was && state.booted) {
      if (s.kind === 'claude' && was === 'busy' && s.status === 'idle') {
        if (!selected || document.hidden) state.ready.add(k);
        if (!document.body.classList.contains('redesign') && !voiceActive && (!selected || state.tab !== 'chat')) toast('Waiting for you', s.title, 'good', () => select(k));
      }
      if (pref.get('completion','on')!=='off' && !voiceActive && s.kind === 'astra' && was === 'busy' && s.runState === 'complete' && (!selected || state.tab !== 'chat')) toast('Astra turn complete', s.title, 'good', () => select(k));
      if (!voiceActive && was === 'offline' && s.live && (!selected || state.tab !== 'chat')) toast('Session online', s.title, '', () => select(k));
    }
    state.prev.set(k, s.status);
    if (s.status === 'busy') state.ready.delete(k);
  }
  state.sessions = next;
  state.byKey = new Map(next.map(s => [keyOf(s), s]));
  for (const s of next) for (const alias of s.aliases || []) {
    state.byKey.set(alias, s);
    if (chats.has(alias) && !chats.has(keyOf(s))) chats.set(keyOf(s), chats.get(alias));
  }
  state.usage = data.usage;
  state.briefing = data.briefing;
  state.terms = data.terms || [];
  for (const [id, v] of termViews) {
    if (!state.terms.some(t => t.id === id)) {
      v.closed = true; clearTimeout(v.retryTimer); v.ws?.close(); v.xt.dispose(); v.el.remove(); termViews.delete(id);
      if (shownTerm === id) shownTerm = null;
    }
  }
  if (state.sel && !state.byKey.has(state.sel) && !state.terms.some(t => 'term:' + t.id === state.sel)) {
    state.sel = null; state.transcript = null; state.activity = null; state.transcriptKey = null;
    $('#feed').innerHTML = ''; $('#focusInsights').innerHTML = ''; $('#thinkingView').innerHTML = ''; $('#chatView').innerHTML = ''; $('#chatView').dataset.sig = '';
    toast('Session unavailable', 'It may have ended or moved outside the recent-session window.');
    setView('overview');
  }
  connectionRestored();
  // Follow a new terminal's draft when it learns its session id, even while another
  // session is selected. Migrate once so later polls cannot restore an old draft.
  for (const id of termDraftKeys) if (!state.terms.some(t => t.id === id)) termDraftKeys.delete(id);
  for (const t of state.terms) {
    if (t.sessionKey && state.byKey.has(t.sessionKey) && !termDraftKeys.has(t.id)) {
      const previous = 'term:' + t.id;
      if (chats.has(previous) && !chats.has(t.sessionKey)) chats.set(t.sessionKey, chats.get(previous));
      const input = $('#steer').dataset.key === previous ? $('#steerIn') : null;
      const draft = input?.value ?? steerDrafts.get(previous);
      if (draft !== undefined) steerDrafts.set(t.sessionKey, draft);
      const newInput = () => $('#steer').dataset.key === t.sessionKey ? $('#steerIn') : null;
      attachments.move(previous, t.sessionKey, {
        read: () => newInput()?.value ?? steerDrafts.get(t.sessionKey) ?? '',
        write: text => { steerDrafts.set(t.sessionKey, text); const current = newInput(); if (current) current.value = text; }
      });
      const view = termViews.get(t.id); if (view?.sendingKey === previous) view.sendingKey = t.sessionKey;
      termDraftKeys.add(t.id);
      if (state.sel === previous) { state.sel = t.sessionKey; state.feedSize = -1; state.feedBlocks = 0; }
    }
  }
  render();
  renderLimits();
  renderTerms();
  restorePlace();
  if (state.booted && state.view === 'focus' && !state.sel && next.length) select(keyOf(next.find(s => s.live) || next[0]));
  return data;
}

function visible() {
  const q = state.query.toLowerCase();
  return state.sessions.filter(s => {
    if (state.group !== '*' && s.group !== state.group) return false;
    if (state.filter === 'live' && !s.live) return false;
    if (state.filter === 'claude' && s.kind !== 'claude') return false;
    if (state.filter === 'astra' && s.kind !== 'astra') return false;
    if (q) {
      const hay = sessionSearchText(s);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------------- render: chrome ----------------

function render() {
  renderStats();
  renderGroups();
  renderCards();
  renderHead();
  renderApsis();
  if (state.view === 'wall') renderWall();
}

function renderStats() {
  const live = state.sessions.filter(s => s.live).length;
  const busy = state.sessions.filter(s => s.status === 'busy').length;
  const astra = state.sessions.filter(s => s.kind === 'astra' && s.live).length;
  const today = state.sessions.filter(s => Date.now() - s.updated < 864e5).length;
  updateHTML($('#stats'), `<div class="stat live"><b>${live}</b><span>live</span></div><div class="stat busy"><b>${busy}</b><span>working</span></div>` +
    `<div class="stat astra"><b>${astra}</b><span>Astra active</span></div><div class="stat"><b>${today}</b><span>updated 24h</span></div>`);
}

function renderGroups() {
  const g = new Map();
  for (const s of state.sessions) {
    const e = g.get(s.group) || { key: s.group, label: s.groupLabel, n: 0, live: 0, t: 0 };
    e.n++; if (s.live) e.live++; e.t = Math.max(e.t, s.updated);
    g.set(s.group, e);
  }
  const list = [...g.values()].sort((a, b) => (b.live > 0) - (a.live > 0) || b.t - a.t);
  const item = (key, label, n, live) =>
    `<div class="group ${state.group === key ? 'on' : ''}" data-g="${esc(key)}" role="button" tabindex="0" aria-pressed="${state.group === key}" title="${esc(label)}">` +
    `<span class="gicon">${esc(key === '*' ? '◆' : label[0].toUpperCase())}</span>` +
    `<span class="gname">${esc(label)}</span>${live ? '<span class="glive"></span>' : ''}<span class="gcount">${n}</span></div>`;
  updateHTML($('#groups'), item('*', 'All projects', state.sessions.length, state.sessions.some(s => s.live)) +
    list.map(e => item(e.key, e.label, e.n, e.live)).join(''));
}

function bucketOf(s) {
  if (s.live) return 'Live now';
  const d = new Date(s.updated), now = new Date();
  const day = 864e5, start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (s.updated >= start) return 'Today';
  if (s.updated >= start - day) return 'Yesterday';
  if (s.updated >= start - 6 * day) return 'This week';
  return 'Earlier';
}

function statusLabel(s) {
  if(s.error)return ['error',s.errorType==='quota'?'Quota exceeded':'Error'];
  const liveChat = typeof chats !== 'undefined' ? chats.get(keyOf(s))?.terminal : null;
  // Session discovery keeps polling after we leave a chat. Its fresh question
  // must win over that chat's cached ready/busy screen for call invitations.
  if (s.needsInput || (s.term && termViews.get(s.term)?.pendingPrompt) || (s.live && ['waiting', 'waiting_permission', 'needs_input'].includes(s.status))) return ['ready', 'Needs you'];
  if (liveChat?.prompt) return ['ready', 'Needs you'];
  if (liveChat?.busy) return ['busy', 'Working'];
  if (liveChat?.ready || liveChat?.exited) return ['done', 'Done'];
  if (state.ready.has(keyOf(s))) return ['done', 'New reply'];
  if (state.terms?.includes(s)) return s.exited ? ['off', 'Ended'] : ['done', 'Ready'];
  if (s.kind === 'claude') return s.status === 'busy' ? ['busy', 'Working'] : s.live ? ['done', 'Done'] : ['off', 'Saved'];
  return s.status === 'busy' ? ['busy', 'Working'] : s.runState === 'complete' ? ['done', 'Done'] : ['off', 'Saved'];
}

function cardHTML(s, firstFocusable = false) {
  const k = keyOf(s), q = state.query;
  const [cls, label] = statusLabel(s);
  const snip = sessionPreview(s);
  return `<div class="card ${s.kind} ${s.status === 'busy' ? 'busy' : ''} ${cls === 'ready' ? 'ready' : ''} ${state.sel === k ? 'sel' : ''}" data-k="${esc(k)}" role="button" tabindex="${state.sel === k || firstFocusable ? 0 : -1}" aria-label="${esc(s.title)}" aria-pressed="${state.sel === k}">` +
    `<div class="c-top"><span class="agent">${agentName(s.kind)}</span>` +
    `<span class="status ${cls}"><i></i>${label}</span><span class="c-time">${ago(s.updated)}</span></div>` +
    `<div class="c-title" title="${esc(s.title)}">${highlight(s.title, q)}</div>` +
    (snip ? `<div class="c-snip">${highlight(snip, q)}</div>` : '') +
    sessionTagsHTML(s) + `<div class="c-meta"><span class="path">${esc(shortPath(s.cwd))}</span><span>${esc(s.groupLabel)}</span></div></div>`;
}

let animateCards = true;
function renderCards() {
  const list = visible();
  const label = state.group === '*' ? 'All sessions' : (state.sessions.find(s => s.group === state.group) || {}).groupLabel || state.group;
  $('#listTitle').textContent = label;
  $('#listCount').textContent = list.length;
  const box = $('#cards');
  if (!list.length) { updateHTML(box, '<div class="nores">' + (state.sessions.length ? 'No sessions match these filters.<br><button class="btn" id="clearFilters">Clear filters</button>' : 'No sessions found yet.<br>Start a new session to see it here.') + '</div>'); return; }
  let html = '', last = '';
  const hasSelection = list.some(s => keyOf(s) === state.sel);
  for (const s of list) {
    const b = bucketOf(s);
    if (b !== last) { html += `<div class="bucket">${b}</div>`; last = b; }
    html += cardHTML(s, !hasSelection && s === list[0]);
  }
  box.classList.toggle('anim', animateCards);
  updateHTML(box, html);
  if (animateCards) setTimeout(() => box.classList.remove('anim'), 700);
  animateCards = false;
}

// ---------------- usage limits ----------------

function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

function limitHTML(who, label, w, seenAt) {
  const now = Date.now(), reset = w.resetsAt && w.resetsAt <= now;
  const valid = Number.isFinite(w.pct), pct = valid ? Math.max(0, Math.min(100, Math.round(w.pct))) : 0;
  const stale = reset || (seenAt && now - seenAt > 3600e3);
  const cls = !reset && valid ? pct >= 85 ? 'hot' : pct >= 60 ? 'warn' : '' : '';
  const foot = reset ? `Reset passed · last read ${seenAt ? ago(seenAt) + ' ago' : 'unknown'}`
    : `${w.resetsAt ? 'Resets in ' + span(w.resetsAt - now) : 'Reset time unavailable'}${stale ? ' · read ' + ago(seenAt) + ' ago' : ''}`;
  return `<div class="lim ${cls} ${stale ? 'stale' : ''}" title="${reset ? 'Usage has not been reported since the reset. This is the previous reading, not available quota.' : 'Percentage of the account limit used'}"><div class="lim-top"><span class="lim-who ${who}">${who}</span><span class="lim-win">${label}</span><b>${valid ? pct + '%' : '—'}${reset ? '*' : ''}</b></div>` +
    `<div class="lim-bar" role="meter" aria-label="${who} ${label}${reset ? ' previous reading' : ' used'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><div class="lim-foot">${esc(foot)}${reset ? ' · stale' : ''}</div></div>`;
}

function windowLabel(min) {
  if (!min) return '';
  if (min >= 10000) return 'weekly';
  if (min >= 1440) return Math.round(min / 1440) + '-day';
  return Math.round(min / 60) + '-hour';
}

function renderLimits() {
  const u = state.usage || {};
  let html = '';
  const c = u.claude;
  if (c && (c.fiveHour || c.week)) {
    if (c.fiveHour) html += limitHTML('claude', '5-hour', c.fiveHour, c.at);
    if (c.week) html += limitHTML('claude', 'weekly', c.week, c.at);
  } else html += '<div class="lim-none">Claude limits appear after any Claude session refreshes its status line.</div>';
  const a = u.astra;
  if (a && (a.primary || a.secondary)) {
    for (const w of [a.primary, a.secondary]) if (w) html += limitHTML('astra', windowLabel(w.minutes), w, a.at);
  } else html += '<div class="lim-none">Astra limits appear after the next Astra run.</div>';
  $('#limits').innerHTML = html;
  $('#overviewLimits').innerHTML = html;
}

function tokens(n) { return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1e3) + 'k' : String(Math.round(n || 0)); }

// ---------------- focus: header ----------------

// The terminal running for the selection: a session's in-app terminal, or a terminal not yet tied to one.
function selTerm() {
  if (!state.sel) return null;
  if (state.sel.startsWith('term:')) return state.terms.find(t => 'term:' + t.id === state.sel) || null;
  const s = state.byKey.get(state.sel);
  return (s && s.term ? state.terms.find(t => t.id === s.term) : [...state.terms].reverse().find(t => t.sessionKey === state.sel)) || null;
}

function tabsHTML(term, feed) {
  return `<div class="fh-tabs" role="group" aria-label="Session view"><button data-tab="feed" aria-pressed="${state.tab === 'feed'}" class="${state.tab === 'feed' ? 'on' : ''}" ${feed ? '' : 'disabled'}>Feed</button>` +
    `<button data-tab="thinking" aria-pressed="${state.tab === 'thinking'}" class="${state.tab === 'thinking' ? 'on' : ''}" ${feed ? '' : 'disabled'}>Thinking</button><button data-tab="chat" aria-pressed="${state.tab === 'chat'}" class="${state.tab === 'chat' ? 'on' : ''}">Chat</button>` +
    `<button data-tab="term" aria-label="Terminal: advanced raw view" aria-pressed="${state.tab === 'term'}" class="${state.tab === 'term' ? 'on' : ''}" ${term ? '' : 'disabled title="Open this session here to use its terminal"'}>${term && !term.exited ? '<span class="tdot"></span>' : ''}Terminal</button></div>`;
}

function applyTab() {
  const t = selTerm();
  if (state.tab === 'term' && !t) state.tab = 'feed';
  $('#focus').classList.toggle('tab-term', state.tab === 'term');
  $('#focus').dataset.tab = state.tab;
  savePlace();
  if (state.view !== 'focus') { hideTerms(); return; }
  if (state.tab === 'term' && t) showTerm(t.id); else hideTerms();
  if (state.tab === 'thinking') renderThinking();
  if (state.tab === 'chat') renderChat();
}

// Refreshes should not close disclosures or strand keyboard focus.
function updateHTML(el, html) {
  if (el._html === html) return;
  el._html = html;
  const active = el.contains(document.activeElement) ? document.activeElement : null;
  const summaryOf = active?.tagName === 'SUMMARY' ? active.parentElement.dataset.disclosure : null;
  const attrs = ['data-theme-pick', 'data-theme-open', 'data-brief-edit', 'data-brief-create', 'data-brief-note', 'data-brief-refresh', 'data-brief-main', 'id', 'data-k', 'data-g', 'data-a', 'data-tab', 'data-x', 'data-copy', 'data-t', 'data-tx', 'data-disclosure', 'data-open', 'data-resume', 'data-project', 'data-project-filter', 'data-project-new', 'data-project-more', 'data-project-spend', 'data-project-jump', 'data-project-away-more', 'data-project-back', 'data-insight'];
  const attr = active && attrs.find(a => active.hasAttribute(a));
  const sessionScope = attr === 'data-insight' && active.closest('[data-session]')?.dataset.session;
  const selector = attr && (sessionScope ? `[data-session="${CSS.escape(sessionScope)}"] ` : '') + `[${attr}="${CSS.escape(active.getAttribute(attr))}"]`;
  const open = [...el.querySelectorAll('details[open][data-disclosure]')].map(d => d.dataset.disclosure);
  const closed = [...el.querySelectorAll('details[data-default-open]:not([open])')].map(d => d.dataset.disclosure);
  el.innerHTML = html;
  for (const name of open) { const d = el.querySelector(`details[data-disclosure="${CSS.escape(name)}"]`); if (d) d.open = true; }
  for (const name of closed) { const d = el.querySelector(`details[data-disclosure="${CSS.escape(name)}"]`); if (d) d.open = false; }
  if (selector) el.querySelector(selector)?.focus({ preventScroll: true });
  else if (summaryOf) el.querySelector(`details[data-disclosure="${CSS.escape(summaryOf)}"] > summary`)?.focus({preventScroll:true});
}

function renderHead() {
  $('#backOverview').textContent = projectUI.key && state.byKey.get(state.sel)?.group === projectUI.key ? '← Project' : '← Home';
  const f = $('#focus'), t = selTerm(), s = state.byKey.get(state.sel);
  f.classList.toggle('has', !!(s || t));
  f.classList.toggle('astra-view', (s || t)?.kind === 'astra');
  if (!s && !t) { updateHTML($('#focusHead'), ''); applyTab(); renderPulse(); return; }
  if (!s) {
    if (!['term', 'chat'].includes(state.tab)) state.tab = 'chat';
    updateHTML($('#focusHead'), `<div class="fh-row"><h1 class="fh-title" title="${esc(t.title)}">${esc(t.title)}</h1><span class="chip k-${t.kind}">${agentName(t.kind)}</span></div>` +
      `<div class="fh-context" title="${esc(t.cwd)}">${esc(shortPath(t.cwd))} <span>· ${t.exited ? 'Terminal ended' : 'Running in NEXUS'}</span></div>` +
      `<div class="fh-actions">${tabsHTML(t, false)}<button class="btn danger" data-a="term-close">Close terminal</button></div>`);
    applyTab(); renderPulse(); return;
  }
  const [cls, label] = statusLabel(s);
  const term = t && !t.exited;
  const primary = term ? '' : `<button class="btn primary" data-a="resume">Open</button>`;
  let utilities = (s.kind === 'claude' ? '<button data-a="rc">Remote Control</button>' : '') + (s.brief ? '<button data-a="read-brief">Read brief</button>' : '') + (s.kind === 'claude' ? '<button data-a="fork">Fork conversation</button><button data-a="new">New Claude here</button><button data-a="vscode">Open in VS Code</button>' : '<button data-a="new-astra">New Astra here</button>') +
    '<button data-a="popout">Open in Windows Terminal</button><button data-a="folder">Open folder</button>' +
    (s.brief ? '<button data-a="open-brief">Open brief in default app</button>' : '') +
    (s.kind === 'astra' ? '<button data-a="vscode">Open in VS Code</button>' : '') +
    (t ? '<button class="danger" data-a="term-close">Close terminal</button>' : '');
  if (state.remote) utilities = utilities.replace(/<button data-a="(?:popout|folder|vscode|open-brief)"[^>]*>.*?<\/button>/g, '');
  const details = `<details class="session-more" data-disclosure="more"><summary>More <span aria-hidden="true">⌄</span></summary><div class="more-menu"><button id="sessionRecapMore" data-a="recap">Since my last message</button><button data-a="chat-help">Chat controls</button>${utilities}<div class="session-details">` +
    `<span>${esc(s.model || 'Model not reported')}${s.branch && s.branch !== 'HEAD' ? ' · ' + esc(s.branch) : ''}</span>` +
    (s.ctx ? `<span>Context: ${tokens(s.ctx)}${s.ctxMax ? ' / ' + tokens(s.ctxMax) : ''} tokens · last reading</span>` : '') +
    `<button data-copy="${esc(s.cwd)}" title="Copy folder path">${esc(s.cwd)} ⧉</button><button data-copy="${esc(s.id)}" title="Copy session ID">Session ${esc(s.id)} ⧉</button>` +
    `<span>${bytes(s.size)} transcript${s.pid ? ' · PID ' + s.pid : ''}${s.remote ? ' · Remote linked' : ''}</span></div></div></details>`;
  // Remote Control: Claude Code records the link in its live-session file; read only while the session runs.
  const rcOn = s.kind === 'claude' && s.live && s.remote;
  const rc = s.kind !== 'claude' ? '' :
    `<button class="rc-switch ${rcOn ? 'on' : ''}" data-a="rc" role="switch" aria-checked="${rcOn}" title="${rcOn ? 'Remote Control is on: this session can be driven from claude.ai or the Claude app. Click to open its panel and disconnect.' : 'Turn on Remote Control (/rc) so this session can be driven from claude.ai or the Claude app on your phone.'}"><span class="rc-track"><i></i></span>Remote</button>`;
  updateHTML($('#focusHead'), `<div class="fh-row"><h1 class="fh-title" title="${esc(s.title)}">${esc(s.title)}</h1>${(matchMedia('(max-width: 700px)').matches ? '' : rc) + `<span class="status ${cls}" title="${esc(s.statusDetail || '')}"><i></i>${label}</span>`}</div>` +
    `<div class="fh-context"><span class="agent ${s.kind}">${agentName(s.kind)}</span><span title="${esc(s.cwd)}">${esc(s.groupLabel)}</span>${s.model ? `<span class="model">${esc(s.model)}</span>` : ''}${matchMedia('(max-width: 700px)').matches ? `<span class="status ${cls}"><i></i>${label}</span>` + rc : ''}</div>` +
    `<div class="fh-subtitle" title="${esc(NexusActivity.subtitle(s))}">${esc(NexusActivity.subtitle(s))}</div><div class="fh-latest"><b>Latest</b> ${esc(sessionPreview(s))}</div>` +
    `<div class="fh-actions">${tabsHTML(t, true)}<button id="sessionRecap" class="btn recap-head-button" data-a="recap">Since my last message</button>${s.brief ? '<button class="btn" data-a="read-brief">Read brief</button>' : ''}${primary}${details}</div>`);
  applyTab(); renderPulse();
}

$('#focusHead').addEventListener('click', async e => {
  const c = e.target.closest('[data-copy]');
  if (c) { copyText(c.dataset.copy); return; }
  const tab = e.target.closest('button[data-tab]');
  if (tab && !tab.disabled) { state.tab = tab.dataset.tab; renderHead(); if (state.tab !== 'term') loadFeed(true); return; }
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a === 'term-close') return closeTerm(selTerm());
  const s = state.byKey.get(state.sel); if (!s) return;
  runAction(b.dataset.a, s);
});

// Opens the session in a terminal inside NEXUS and switches to it.
async function openInApp(action, extra, label) {
  const r = await act(action, extra);
  if (!r || !r.term) return false;
  await refresh();
  const t = state.terms.find(x => x.id === r.term);
  const k = t && t.sessionKey && state.byKey.has(t.sessionKey) ? t.sessionKey : 'term:' + r.term;
  state.tab = 'chat';
  if (state.view !== 'focus') setView('focus');
  select(k, { tab: state.tab });
  if (label) toast(label, t ? t.title : '');
  savePlace();
  return true;
}

// Remote Control switch. Claude Code has no external on/off API, so NEXUS drives it the documented ways:
// /remote-control typed into a session running in NEXUS, or --remote-control when NEXUS starts it.
async function toggleRemote(s) {
  const key = keyOf(s);
  const on = s.live && s.remote;
  const t = s.term ? state.terms.find(x => x.id === s.term && !x.exited) : null;
  if (t) {
    if (on) return toast('Remote Control is on', 'To turn it off, send /rc in Chat and choose disconnect.');
    // The server types /remote-control into the pty, so this works with no terminal attached here (phone Chat).
    if (!await act('term-rc', { term: t.id })) return;
    toast('Turning on Remote Control', 'If Claude asks, choose Enable with 1 / Approve.', 'good');
    setTimeout(refresh, 1500);
    return;
  }
  if (s.live) {
    modal(`<h2>${on ? 'Remote Control is on' : 'Turn on Remote Control'}</h2>
      <p>“${esc(s.title)}” is running in another terminal (pid ${s.pid}), which NEXUS can't type into. In that terminal, type <code>/rc</code>${on ? ' and choose disconnect' : ''}. Or fork the conversation into NEXUS with Remote Control on.</p>
      <div class="modal-actions"><button class="btn" data-m="cancel">Cancel</button>${on ? '' : '<button class="btn primary" data-m="fork">Fork here with Remote Control</button>'}</div>`);
    $('#modalCard').onclick = e => {
      const m = e.target.closest('[data-m]'); if (!m) return;
      closeModal();
      if (m.dataset.m === 'fork') openInApp('term-fork', { key, remote: true }, 'Forked with Remote Control');
    };
    return;
  }
  return openInApp('term-resume', { key, remote: true }, 'Opened with Remote Control');
}

async function runAction(a, s) {
  const key = keyOf(s);
  if (a === 'recap') { if(innerWidth<=700 && nx.phoneRecapKey===key)return nxClosePhoneRecap(); return recapDialog(s); }
  if (a === 'chat-help') return chatHelp();
  if (a === 'rc') return toggleRemote(s);
  if (a === 'read-brief') return readBrief(s);
  if (a === 'show-term') { state.tab = 'term'; renderHead(); return; }
  if (a === 'resume' && s.kind === 'claude' && s.live && !s.inNexus && !s.term) {
    modal(`<h2>This session is already running</h2>
      <p>“${esc(s.title)}” is open in another terminal (pid ${s.pid}). Opening it here too makes two windows write to the same conversation. A fork copies the conversation into a new session you can chat with here.</p>
      <div class="modal-actions"><button class="btn" data-m="cancel">Cancel</button><button class="btn" data-m="anyway">Open here anyway</button><button class="btn primary" data-m="fork">⑂ Fork it here</button></div>`);
    $('#modalCard').onclick = async e => {
      const m = e.target.closest('[data-m]'); if (!m) return;
      closeModal();
      if (m.dataset.m === 'fork') runAction('fork', s);
      if (m.dataset.m === 'anyway') openInApp('term-resume', { key }, 'Opened in NEXUS');
    };
    return;
  }
  if (a === 'resume') return openInApp('term-resume', { key }, 'Opened in NEXUS');
  if (a === 'fork') return openInApp('term-fork', { key }, 'Forked into NEXUS');
  if (a === 'new') return openInApp('term-new', { cwd: s.cwd }, 'New Claude session');
  if (a === 'new-astra') return openInApp('term-new-astra', { cwd: s.cwd }, 'New Astra session');
  if (a === 'popout') { if (await act('resume', { key })) toast('Opening', s.title + ' in Windows Terminal'); return; }
  const label = { vscode: 'Opening VS Code', folder: 'Opening folder', 'open-brief': 'Opening brief' }[a] || a;
  if (await act(a, { key, cwd: s.cwd })) toast(label, s.title);
}

// ---------------- focus: feed ----------------

function select(k, opts) {
  if (!state.byKey.has(k) && !k.startsWith('term:')) return;
  const changed = state.sel !== k;
  if (changed) rememberViewed(state.byKey.get(state.sel), true);
  state.sel = k;
  state.ready.delete(k);
  if (changed) {
    $('#toasts').replaceChildren();
    const draft = $('#steerIn'); if (draft) steerDrafts.set($('#steer').dataset.key, draft.value);
    state.bytes = 3e6; state.limit = 600; state.feedSize = -1; state.feedBlocks = 0; state.activity = null; state.transcript = null; state.transcriptKey = null; state.thinkOpen = false; state.transcriptError = '';
    $('#pulse')._html = null;
    updateHTML($('#feed'), '<div class="note" role="status">Loading conversation…</div>');
    const s = state.byKey.get(k);
    state.tab = (opts && opts.tab) || 'chat';
  }
  if (opts?.tab) state.tab = opts.tab;
  if (state.view !== 'focus' && !(opts && opts.stayWall)) setView('focus');
  renderCards(); renderHead(); renderTerms();
  loadFeed(true);
  renderFocusInsights();
  const card = $(`.card[data-k="${CSS.escape(k)}"]`);
  if (card && !matchMedia('(max-width: 700px)').matches) card.scrollIntoView({ block: 'nearest' });
}

let feedBusy = null, feedRequest = 0;
async function loadFeed(force) {
  if (state.tab === 'chat') return loadChat();
  const k = state.sel;
  if (!k || (!force && feedBusy === k) || !state.byKey.has(k)) return;
  const s = state.byKey.get(k);
  if (!force && (s.size === state.feedSize || feedHeld)) return;
  const request = ++feedRequest;
  feedBusy = k;
  try {
    const t = await api(`/api/transcript?key=${encodeURIComponent(k)}&bytes=${state.bytes}&limit=${state.limit}`);
    if (state.sel !== k || request !== feedRequest) return;
    state.feedSize = t.size; state.activity = t.activity; state.transcript = t;
    state.transcriptError = '';
    state.transcriptKey = k; state.transcriptAt = t.capturedAt || state.lastUpdate;
    renderFeed(t, s); renderPulse();
    renderFocusInsights(); if (state.tab === 'thinking') renderThinking();
    if (state.tab === 'chat') renderChat();
  } catch (e) {
    if (state.sel !== k || request !== feedRequest) return;
    state.transcriptError = e.message;
    if (state.tab === 'chat') renderChat();
    updateHTML($('#feed'), `<div class="nores">Could not read this transcript.<br>${esc(e.message)}<br><button class="btn" id="retryFeed">Retry</button></div>`);
  } finally { if (request === feedRequest) feedBusy = null; }
}

async function readBrief(s) {
  const k = keyOf(s);
  modal('<h2>Run brief</h2><p>Loading the instructions…</p><div class="modal-actions"><button data-m="close" class="btn">Close</button></div>');
  const card = $('#modalCard'), version = modalVersion;
  card.onclick = e => { if (e.target.closest('[data-m="close"]')) closeModal(); };
  try {
    const t = state.sel === k && state.transcript ? state.transcript : await api(`/api/transcript?key=${encodeURIComponent(k)}&limit=600`);
    if (!$('#modal').classList.contains('on') || version !== modalVersion) return;
    const b = t.events.find(e => e.t === 'brief');
    card.innerHTML = `<h2 id="modalTitle">Run brief</h2><p class="brief-path">${esc(s.brief)}</p><pre class="brief-reader">${esc(b?.text || 'This brief is no longer available on disk.')}</pre><div class="modal-actions"><button data-m="close" class="btn">Close</button></div>`;
    card.querySelector('button').focus({ preventScroll: true });
  } catch (e) {
    if (!$('#modal').classList.contains('on') || version !== modalVersion) return;
    card.querySelector('p').textContent = 'Could not read the brief: ' + e.message;
  }
}

const DISPATCH_TOOLS = new Set(['Agent', 'Task', 'SendMessage']);

function buildBlocks(events) {
  const results = new Map();
  for (const e of events) if (e.t === 'result' && e.id) results.set(e.id, e);
  const blocks = [];
  let run = null;
  for (const e of events) {
    if (e.t === 'result') continue;
    if (e.t === 'tool' && !e.astra && !DISPATCH_TOOLS.has(e.name)) {
      e.res = results.get(e.id);
      if (!run) { run = { t: 'tools', items: [] }; blocks.push(run); }
      run.items.push(e);
      continue;
    }
    run = null;
    if (e.t === 'tool') e.res = results.get(e.id);
    blocks.push(e);
  }
  return blocks;
}

function toolHTML(e) {
  const k = 'tool:' + e.id;
  const open = state.expanded.has(k);
  const err = e.res && e.res.err;
  return `<div class="tool ${open ? 'open' : ''}"><div class="tool-head" data-x="${esc(k)}" role="button" tabindex="0" aria-expanded="${open}"><span class="tname">${esc(e.name)}</span>` +
    `<span class="tsum">${esc((e.text || '').split('\n')[0])}</span>${err ? '<span class="terr">error</span>' : ''}</div>` +
    (open ? `<div class="tool-body"><pre>${esc(e.text)}</pre>${e.res ? `<pre class="res ${err ? 'err' : ''}">${esc(e.res.text || '(no output)')}</pre>` : ''}</div>` : '') + '</div>';
}

function blockHTML(b, s, compact) {
  const time = b.ts ? `<time>${clockTime(b.ts)}</time>` : '';
  const astraView = s && s.kind === 'astra';
  switch (b.t) {
    case 'user':
      return `<div class="ev user"><div class="ev-label">${astraView ? 'Request to <span class="nx-agent-name astra">Astra</span>' : 'You'} ${time}</div><div class="bubble">${esc(compact ? b.text.slice(0, 500) : b.text)}</div></div>`;
    case 'ai':
      return `<div class="ev ai"><div class="ev-label">${astraView ? 'Astra' : 'Claude'} ${time}</div><div class="md">${md(compact ? b.text.slice(0, 700) : b.text)}</div></div>`;
    case 'tools': {
      if (compact) return b.items.slice(-3).map(toolHTML).join('');
      const k = 'run:' + b.items[0].id;
      const counts = {};
      for (const i of b.items) counts[i.name] = (counts[i.name] || 0) + 1;
      const sum = Object.entries(counts).map(([n, c]) => `<span class="tn">${esc(n)}${c > 1 ? ' ×' + c : ''}</span>`).join('');
      const open = state.expanded.has(k) || b.items.length <= 2;
      return `<div class="tools"><div class="tools-sum" data-x="${esc(k)}" role="button" tabindex="0" aria-expanded="${open}">${open ? '▾' : '▸'} ${b.items.length} tool call${b.items.length > 1 ? 's' : ''} ${b.items.some(i => i.res?.err) ? '<span class="terr">' + b.items.filter(i => i.res?.err).length + ' failed</span>' : ''} ${sum}</div>` +
        (open ? b.items.map(toolHTML).join('') : '') + '</div>';
    }
    case 'tool': {
      const toAstra = b.astra;
      const head = toAstra ? '⟶ Dispatch to Astra' : b.name === 'SendMessage' ? '⟶ Message to session' : '⟶ Subagent';
      return `<div class="dispatch ${toAstra ? '' : 'sub'}"><div class="d-head">${head} ${time}</div><pre>${esc(compact ? b.text.slice(0, 400) : b.text)}</pre>` +
        (b.res && !compact ? `<div class="d-res">${esc(b.res.text.slice(0, 1200))}</div>` : '') + '</div>';
    }
    case 'brief': {
      if (compact) return '';
      const k = 'brief:' + b.path, open = state.expanded.has(k);
      return `<div class="brief ${open ? 'open' : ''}"><div class="brief-head">Run brief <span class="bpath">${esc(b.path)}</span></div>` +
        `<pre>${esc(b.text)}</pre><button class="chip-btn" data-x="${esc(k)}">${open ? 'Collapse' : 'Read the full brief'}</button></div>`;
    }
    case 'think': {
      if (compact) return '';
      const k = 'think:' + b.ts + ':' + b.text.length, open = state.expanded.has(k);
      return `<div class="ev think ${open ? 'open' : ''}" data-x="${esc(k)}" role="button" tabindex="0" aria-expanded="${open}"><div class="ev-label">Thinking ${time}</div><div class="ttext">${esc(b.text)}</div></div>`;
    }
    case 'note': return `<div class="note ${b.err?'agent-error':''}" ${b.err?'role="alert"':''}>${esc(b.text)} ${b.ts ? '· ' + clockTime(b.ts) : ''}</div>`;
    case 'cmd': return `<div class="cmdev">❯ ${esc(b.text)}</div>`;
  }
  return '';
}

function renderFeed(t, s, preserve = false) {
  const feed = $('#feed');
  const previousTop = feed.scrollTop;
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  const fromBottom = feed.scrollHeight - feed.scrollTop;
  const blocks = buildBlocks(t.events);
  const prev = state.feedBlocks;
  let html = '';
  blocks.forEach((b, i) => {
    let h = blockHTML(b, s, false);
    if (prev && i >= prev) h = h.replace(/^<div class="/, '<div class="fresh ');
    html += h;
  });
  if (!blocks.length) html = '<div class="note">no messages yet</div>';
  updateHTML(feed, html);
  state.feedBlocks = blocks.length;
  if (preserve) feed.scrollTop = previousTop;
  else if ($('#followBox').checked && (nearBottom || prev === 0)) feed.scrollTop = feed.scrollHeight;
  else feed.scrollTop = feed.scrollHeight - fromBottom;
  $('#tailInfo').textContent = `${blocks.length} entries · ${s && s.live ? 'Updating live' : 'Saved conversation'}`;
  $('#tailInfo').title = `Showing up to ${bytes(state.bytes)} of ${bytes(t.size)}`;
  $('#earlierBtn').style.display = t.truncated && (state.bytes < 64e6 || state.limit < 10000) ? '' : 'none';
}

$('#feed').addEventListener('click', e => {
  if (e.target.closest('#retryFeed')) return loadFeed(true);
  const x = e.target.closest('[data-x]'); if (!x) return;
  if (e.target.closest('.tool-body')) return;
  const k = x.dataset.x;
  state.expanded.has(k) ? state.expanded.delete(k) : state.expanded.add(k);
  if (state.transcript) renderFeed(state.transcript, state.byKey.get(state.sel), true);
});
$('#feed').addEventListener('scroll', () => {
  const f = $('#feed');
  const atBottom = f.scrollHeight - f.scrollTop - f.clientHeight < 80;
  if (!atBottom && $('#followBox').checked && f.dataset.user === '1') $('#followBox').checked = false;
  if (atBottom) $('#followBox').checked = true;
});
$('#feed').addEventListener('wheel', () => { $('#feed').dataset.user = '1'; });
let feedHeld = false;
$('#feed').addEventListener('mousedown', () => { $('#feed').dataset.user = '1'; feedHeld = true; });
addEventListener('mouseup', () => { feedHeld = false; });
$('#feed').addEventListener('touchstart', () => { $('#feed').dataset.user = '1'; feedHeld = true; }, { passive: true });
addEventListener('touchend', () => { feedHeld = false; }, { passive: true });
addEventListener('touchcancel', () => { feedHeld = false; }, { passive: true });
addEventListener('blur', () => { feedHeld = false; });
$('#earlierBtn').onclick = () => { state.bytes = Math.min(state.bytes * 3, 64e6); state.limit = Math.min(state.limit * 2, 10000); loadFeed(true); };
$('#followBox').onchange = () => { if ($('#followBox').checked) { const f = $('#feed'); f.scrollTop = f.scrollHeight; } };

// ---------------- pulse: what the agent is doing ----------------

function sinceHTML(ts) { return ts ? `<span data-since="${Date.parse(ts)}">${span(Date.now() - Date.parse(ts))}</span>` : ''; }

function renderPulse() {
  const p = $('#pulse'), s = state.byKey.get(state.sel), a = state.activity;
  if (!s || !a) { p.classList.remove('on'); if (s || selTerm()) renderSteer(s || selTerm()); else { $('#steer').innerHTML = ''; $('#steer').dataset.sig = ''; } return; }
  p.classList.add('on');
  const busy = s.status === 'busy', claude = s.kind === 'claude';
  const stateLine = busy ? `<span class="pu-state busy"><span class="spin"></span>Working ${sinceHTML(a.turnStart)}</span>`
    : `<span class="pu-state ${s.live ? 'idle' : 'off'}">${s.live ? 'Waiting for you' : statusLabel(s)[1]}</span>`;
  const cur = a.current;
  const current = cur ? `<div class="pu-now" title="${esc(cur.text)}"><span class="tname">${esc(cur.name)}</span><span class="tsum">${esc(cur.text.split('\n')[0])}</span></div>` : '<div class="pu-muted">No tool activity reported.</div>';
  const now = `<div class="pu-box pu-current"><div class="pu-label">${busy ? 'Now' : 'Last activity'}<b>${a.steps} tool call${a.steps === 1 ? '' : 's'}</b></div>${stateLine}${current}</div>`;
  const goalText = a.goal || s.lastPrompt || s.firstPrompt || 'No request in this transcript excerpt.';
  const goalLabel = a.goal || !(s.lastPrompt || s.firstPrompt) ? 'Request' : 'Earlier request';
  const goal = `<details class="pu-box pu-request" data-disclosure="request"><summary class="pu-summary"><span class="pu-label">${goalLabel}</span><span class="pu-goal pu-preview">${esc(goalText)}</span></summary><div class="pu-full">${esc(goalText)}</div></details>`;
  const tasks = a.tasks || [], done = tasks.filter(t => t.status === 'done').length;
  const active = tasks.find(t => t.status === 'active') || tasks.find(t => t.status === 'todo');
  const progress = tasks.length ? `<details class="pu-box pu-progress" data-disclosure="tasks"><summary class="pu-summary"><span class="pu-label">Task list <b>${done} / ${tasks.length} done</b></span>` +
    `<div class="pu-bar" role="progressbar" aria-label="Agent reported tasks completed" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${tasks.length}"><i style="width:${100 * done / tasks.length}%"></i></div>` +
    `<div class="pu-task">${esc(active ? active.text : 'All reported tasks done')}</div></summary><ul class="pu-task-list">${tasks.map(t => `<li>${t.status === 'done' ? '✓' : t.status === 'active' ? '▸' : '○'} ${esc(t.text)}</li>`).join('')}</ul><div class="pu-muted task-note">Agent reported · no reliable ETA</div></details>`
    : '<div class="pu-box pu-progress"><div class="pu-label">Progress</div><div class="pu-muted">No task list reported.<br>Completion time unavailable.</div></div>';
  const thought = a.thought ? `<details class="pu-think pu-box" data-disclosure="thought"><summary class="pu-summary"><span class="pu-label">${claude ? 'Latest thinking' : 'Latest progress note'}<b>${clockTime(a.thought.ts)}</b></span><span class="pu-thought pu-preview">${esc(a.thought.text)}</span></summary><div class="pu-full">${esc(a.thought.text)}</div></details>` : '';
  updateHTML(p, now + goal + progress + thought);
  renderSteer(s);
}

function renderSteer(s) {
  const box = $('#steer'), t = selTerm();
  const sig = state.sel + ':composer';
  if (box.dataset.sig === sig) return;
  const old = $('#steerIn');
  if (old && box.dataset.key) steerDrafts.set(box.dataset.key, old.value);
  box.dataset.sig = sig; box.dataset.key = state.sel;
  if (s) {
    box.innerHTML = `<div class="attachment-area" id="steerAttachments"></div><label class="sr-only" for="steerIn">Message ${agentName(s.kind)}</label><textarea id="steerIn" rows="2" placeholder="Message ${agentName(s.kind)}…" autocomplete="off"></textarea>` +
      '<div class="steer-buttons"><button class="btn" data-steer="talk" aria-pressed="false">Talk</button><button class="btn" data-steer="esc" title="Interrupt the current turn">Interrupt</button><button class="chip-btn" data-steer="help" aria-label="Chat help">?</button><button class="btn primary" data-steer="send">Send</button></div>';
    $('#steerIn').value = steerDrafts.get(state.sel) || '';
    const key = state.sel;
    const currentInput = () => box.dataset.key === key ? $('#steerIn') : null;
    attachments.mount($('#steerAttachments'), {
      key, kind: s.kind, dropZone: box, cwd: () => state.byKey.get(key)?.cwd || s.cwd || '',
      read: () => currentInput()?.value ?? steerDrafts.get(key) ?? '',
      write: text => { steerDrafts.set(key, text); const input = currentInput(); if (input) input.value = text; },
      canEdit: () => !chatSending(key),
      change: () => { if (box.dataset.key === key) { const send = box.querySelector('[data-steer="send"]'); if (send) send.disabled = attachments.blocked(key) || chatSending(key); } }
    });
  } else box.innerHTML = `<span class="pu-muted">${t?.exited ? 'Terminal ended. Close it to return to your sessions.' : 'Open this session here to send a direction.'}</span>`;
}
const steerDrafts = new Map();
const termDraftKeys = new Set();
$('#steer').addEventListener('click', e => { const b = e.target.closest('[data-steer]'); if (b) steer(b.dataset.steer); });
$('#steer').addEventListener('keydown', e => { if (e.target.id === 'steerIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !matchMedia('(max-width: 700px)').matches) { e.preventDefault(); steer('send'); } });
$('#steer').addEventListener('input', e => { if (e.target.id === 'steerIn') steerDrafts.set(state.sel, e.target.value); });

function steer(kind) {
  if (kind === 'talk') return NexusVoice.toggle();
  if (kind === 'send' && (typeof NexusCall !== 'undefined' && NexusCall.key === state.sel || typeof NexusVoice !== 'undefined' && NexusVoice.status !== 'off' && (typeof NexusCall === 'undefined' || !NexusCall.active))) return;
  if (kind === 'help') return chatHelp();
  if (kind === 'esc') return answerChat('esc');
  return sendChat();
}

setInterval(() => { for (const el of $$('[data-since]')) el.textContent = span(Date.now() - Number(el.dataset.since)); }, 1000);

// ---------------- terminals ----------------

const termViews = new Map();
let shownTerm = null;
const TERM_THEME = {
  background: '#05080f', foreground: '#dce6ff', cursor: '#4ff0ff', cursorAccent: '#05080f',
  selectionBackground: 'rgba(79,240,255,0.28)',
  black: '#0b1020', brightBlack: '#4b5878', red: '#ff5c7a', brightRed: '#ff8099', green: '#3dff9e', brightGreen: '#7dffc0',
  yellow: '#ffc24a', brightYellow: '#ffd77a', blue: '#6aa8ff', brightBlue: '#9cc5ff', magenta: '#a07bff', brightMagenta: '#c3a8ff',
  cyan: '#4ff0ff', brightCyan: '#9ff6ff', white: '#cfd8ee', brightWhite: '#ffffff',
};

function termSend(v, d) { if (!v.ws || v.ws.readyState !== 1) return false; try { v.ws.send(JSON.stringify({ t: 'i', d })); return true; } catch { return false; } }

function termView(id) {
  let v = termViews.get(id);
  if (v) return v;
  const el = document.createElement('div');
  el.className = 'term-pane';
  $('#termHost').appendChild(el);
  const xt = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace', fontSize: 13.5, lineHeight: 1.12,
    cursorBlink: true, scrollback: 10000, theme: TERM_THEME, allowProposedApi: true,
  });
  const fit = new FitAddon.FitAddon();
  xt.loadAddon(fit);
  try { xt.loadAddon(new WebLinksAddon.WebLinksAddon((ev, uri) => window.open(uri, '_blank'))); } catch { }
  xt.open(el);
  v = { id, el, xt, fit, ws: null, cols: 0, rows: 0, closed: false };
  termViews.set(id, v);
  xt.onData(d => termSend(v, d));
  xt.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && xt.hasSelection()) { navigator.clipboard.writeText(xt.getSelection()); xt.clearSelection(); return false; }
    if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) return false; // the browser's paste event delivers it
    if (e.shiftKey && e.key === 'Enter') { termSend(v, '\x1b\r'); return false; } // newline without sending
    return true;
  });
  connect(v);
  return v;
}

function connect(v) {
  if (v.closed || v.ended || (v.ws && v.ws.readyState < 2)) return;
  clearTimeout(v.retryTimer);
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/pty?id=${encodeURIComponent(v.id)}`);
  v.ws = ws;
  ws.onopen = () => { if(v.ws !== ws)return; v.retryCount = 0; v.el.querySelector('.term-over')?.remove(); v.xt.reset(); fitTerm(v, true); renderChatOutput(v); };
  ws.onmessage = m => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.t === 'o') v.xt.write(msg.d, () => renderChatOutput(v));
    else if (msg.t === 'x') { v.ended = true; clearTimeout(v.retryTimer); termOverlay(v, `Session ended (exit code ${msg.code}).`, true); renderChatOutput(v); refresh(); }
  };
  ws.onerror = () => { /* onclose owns retries, including a rejected upgrade. */ };
  ws.onclose = () => {
    if(v.ws !== ws || v.closed || v.ended)return;
    termOverlay(v, 'Connection lost. Reconnecting automatically…'); renderChatOutput(v);
    v.retryTimer = setTimeout(() => { if (!document.hidden) connect(v); }, Math.min(15000, 750 * 2 ** Math.min(v.retryCount = (v.retryCount || 0) + 1, 5)));
  };
}

function termOverlay(v, text, ended = false) {
  v.el.querySelector('.term-over')?.remove();
  const t = state.terms.find(x => x.id === v.id);
  const o = document.createElement('div');
  o.className = 'term-over';
  o.innerHTML = `<div>${esc(text)}</div><div class="row">` +
    (t && !t.exited && !ended ? '<button class="btn primary" data-o="reconnect">Reconnect</button>' : t && t.sessionKey ? '<button class="btn primary" data-o="again">Resume session</button>' : '') +
    '<button class="btn" data-o="close">Close terminal</button></div>';
  o.onclick = async e => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    if (b.dataset.o === 'reconnect') { o.remove(); connect(v); return; }
    const key = t && t.sessionKey;
    if (!await closeTerm(t || { id: v.id })) return;
    if (b.dataset.o === 'again' && key) { const session = state.byKey.get(key); if (session) runAction('resume', session); }
  };
  v.el.appendChild(o);
}

function fitTerm(v, force) {
  if (!v.el.classList.contains('on')) return;
  try { v.fit.fit(); } catch { }
  const { cols, rows } = v.xt;
  if (force || cols !== v.cols || rows !== v.rows) {
    v.cols = cols; v.rows = rows;
    if (v.ws && v.ws.readyState === 1) v.ws.send(JSON.stringify({ t: 'r', c: cols, r: rows }));
  }
}

// Chat reads questions from the terminal screen. The Raw drawer is about 12 rows tall: left that small, a permission
// question scrolls off the top and Chat cannot see it, so the session goes back to full height when the drawer closes.
function restoreTermHeight(v) {
  if (!(v?.rows < 36)) return;
  v.rows = 36; v.xt.resize(v.cols, 36);
  if (v.ws && v.ws.readyState === 1) v.ws.send(JSON.stringify({ t: 'r', c: v.cols, r: 36 }));
}

function showTerm(id) {
  const v = termView(id);
  const changed = shownTerm !== id;
  shownTerm = id;
  for (const o of termViews.values()) o.el.classList.toggle('on', o === v);
  requestAnimationFrame(() => { fitTerm(v); if (changed && !matchMedia('(max-width: 700px)').matches) v.xt.focus(); });
}

function hideTerms() {
  shownTerm = null;
  for (const o of termViews.values()) o.el.classList.remove('on');
}

async function closeTerm(t) {
  if (!t) return;
  if (!await act('term-close', { term: t.id })) return;
  const key=t.sessionKey||'term:'+t.id,chat=chats.get(key);
  if(chat){chat.closedTerm=t.id;chat.terminal=null;chat.ended=true;for(const message of chat.pending)if(!['failed','confirmed'].includes(message.status))deliveryFailure(chat,message,'The session ended. Your text is kept.',key);}
  const v = termViews.get(t.id);
  if (v) { v.closed = true; clearTimeout(v.retryTimer); try { v.ws.close(); } catch { } v.xt.dispose(); v.el.remove(); termViews.delete(t.id); }
  if (shownTerm === t.id) shownTerm = null;
  if (state.sel === 'term:' + t.id) state.sel = null;
  if (state.tab === 'term') state.tab = 'feed';
  await refresh();
  return true;
}

new ResizeObserver(() => { const v = shownTerm && termViews.get(shownTerm); if (v) fitTerm(v); }).observe($('#termHost'));

function renderTerms() {
  const box = $('#termsBox');
  box.classList.toggle('hidden', !state.terms.length);
  const cur = selTerm();
  updateHTML($('#terms'), state.terms.map(t => {
    const s = t.sessionKey && state.byKey.get(t.sessionKey);
    return `<div class="trow ${t.kind} ${t.exited ? 'dead' : ''} ${cur && cur.id === t.id ? 'on' : ''}" data-t="${esc(t.id)}" role="button" tabindex="0" aria-label="Open ${esc(t.title)} terminal">` +
      `<span class="tdot"></span><span class="tk">${t.kind === 'claude' ? 'CL' : 'AS'}</span><span class="tt">${esc(s ? s.title : t.title)}</span>` +
      `<button class="tx" data-tx="${esc(t.id)}" title="Close terminal">✕</button></div>`;
  }).join(''));
}

$('#terms').addEventListener('click', e => {
  const x = e.target.closest('[data-tx]');
  if (x) { e.stopPropagation(); return closeTerm(state.terms.find(t => t.id === x.dataset.tx)); }
  const r = e.target.closest('[data-t]'); if (!r) return;
  const t = state.terms.find(z => z.id === r.dataset.t); if (!t) return;
  const k = t.sessionKey && state.byKey.has(t.sessionKey) ? t.sessionKey : 'term:' + t.id;
  select(k, { tab: 'term' });
  state.tab = 'term'; renderHead();
});

// ---------------- wall ----------------

function wallSessions() {
  const list = visible();
  const recent = list.filter(s => s.live || Date.now() - s.updated < 6 * 3600e3);
  return (recent.length ? recent : list).slice(0, 12);
}

function renderWall() {
  const wall = $('#wall');
  const list = wallSessions();
  if (!list.length) { updateHTML(wall, '<div class="wall-empty">Nothing active in this view.</div>'); return; }
  updateHTML(wall, list.map(s => {
    const k = keyOf(s), [cls] = statusLabel(s);
    const label = cls === 'ready' ? 'Needs you' : s.status === 'busy' ? 'Working' : s.live ? 'Live' : 'Saved';
    const title = NexusActivity.readable(s.title, 180), subtitle = NexusActivity.subtitle(s);
    const latest = NexusActivity.sentence(s.latestContext || s.lastText, 300) || 'No assistant activity recorded yet.';
    return `<article class="tile ${s.kind} ${cls}" data-k="${esc(k)}" aria-label="${esc(title)}">` +
      `<div class="tile-head"><div class="c-top"><span class="agent">${agentName(s.kind)}</span><span class="status ${cls}"><i></i>${label}</span><time class="c-time">${ago(s.updated) === 'now' ? 'Just now' : ago(s.updated) + ' ago'}</time></div>` +
      `<h2 class="tile-title"><button id="wall-title-${esc(k)}" data-wall-feed title="${esc(title)}">${esc(title)}</button></h2><p class="tile-subtitle" title="${esc(subtitle)}">${esc(subtitle)}</p>` +
      `<div class="tile-project">${esc(NexusActivity.readable(s.groupLabel, 80))}${sessionTagsHTML(s)}</div></div>` +
      `<div class="tile-latest"><span>Latest</span><p>${esc(latest)}</p></div>` +
      `<div class="tile-actions"><button id="wall-recap-${esc(k)}" class="btn" data-wall-recap>What happened</button><button id="wall-feed-${esc(k)}" class="text-action" data-wall-feed>Open Feed <span aria-hidden="true">↗</span></button></div></article>`;
  }).join(''));
}
$('#wall').addEventListener('click', e => {
  const tile = e.target.closest('.tile'); if (!tile) return;
  const s = state.byKey.get(tile.dataset.k); if (!s) return;
  if (e.target.closest('[data-wall-recap]')) recapDialog(s);
  else if (e.target.closest('[data-wall-feed]')) select(tile.dataset.k, { tab: 'feed' });
});

function setView(v) {
  if (state.view === 'focus' && v !== 'focus') rememberViewed(state.byKey.get(state.sel), true);
  state.view = v;
  $('#app').dataset.view = v;
  if (v === 'overview') { apsis.away.clear(); hideTerms(); renderApsis(); }
  if (v === 'project') { apsis.away.clear(); hideTerms(); renderProjectPage(); }
  $('#app').classList.toggle('wall-mode', v === 'wall');
  const navView = v === 'project' ? 'overview' : v;
  $$('#viewSeg button').forEach(b => (b.classList.toggle('on', b.dataset.view === navView), b.setAttribute('aria-pressed', b.dataset.view === navView)));
  $('#focus').classList.toggle('hidden', v !== 'focus');
  $('#wall').classList.toggle('hidden', v !== 'wall');
  if (v === 'wall') renderWall();
  else if (v === 'focus') { if (!state.sel && state.sessions.length) select(keyOf(visible()[0] || state.sessions[0])); else loadFeed(true); renderHead(); renderFocusInsights(); }
  savePlace();
}
$('#viewSeg').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); };

// ---------------- new session ----------------

function newSessionModal(options = {}) {
  const group = typeof options.group === 'string' ? options.group : state.view === 'project' ? projectUI.key : null;
  const seen = new Map();
  for (const s of [...state.sessions].sort((a, b) => b.updated - a.updated)) if (s.cwd && !seen.has(s.cwd.toLowerCase()) && (group ? s.group === group : s.group !== 'ibagent runs' && s.group !== 'Scratch')) seen.set(s.cwd.toLowerCase(), s);
  const folders = [...seen.values()];
  if (!folders.length && state.home && !group) folders.push({ cwd: state.home, groupLabel: 'Home' });
  let picked = (group ? folders[0]?.cwd : state.byKey.get(state.sel)?.cwd) || folders[0]?.cwd || '', kind = options.kind === 'astra' ? 'astra' : 'claude';
  let starting = false;
  if (!folders.some(s => s.cwd === picked)) picked = folders[0]?.cwd || '';
  modal(`${group ? '<div class="sheet-kicker">NEW SESSION HERE · ' + esc(folders[0]?.groupLabel || group) + '</div>' : ''}<h2>Start a session</h2><p>${group ? 'Choose a folder in this project.' : 'Choose an agent and a folder.'} Your conversation opens here in NEXUS.</p>
    <fieldset class="agent-choice"><legend>Agent</legend><label><input type="radio" name="agent" value="claude" ${kind === 'claude' ? 'checked' : ''}> Claude</label><label><input type="radio" name="agent" value="astra" ${kind === 'astra' ? 'checked' : ''}> Astra <small>· Codex</small></label></fieldset>
    <label class="picker-label" for="folderSearch">Project folder</label><input class="picker-search" id="folderSearch" placeholder="Find a project or folder…" autocomplete="off" autofocus>
    <div class="folder-options" id="folderOptions"></div><div class="picker-path" id="pickedPath"></div>
    <div class="new-message-area" id="newMessageArea"><label class="picker-label" for="newMessage">First message <small>· optional</small></label><textarea id="newMessage" class="new-message" placeholder="What would you like to work on?"></textarea><div class="attachment-area" id="newAttachments"></div><p class="new-attachment-note">Your message and files will be ready in Chat. Review them there, then Send.</p></div>
    <div class="modal-actions"><button class="btn" data-n="cancel">Cancel</button><button class="btn primary" data-n="start" id="startSession">Start Claude session</button></div>`);
  const attachmentKey = 'new:' + modalVersion;
  attachments.newDraft(attachmentKey);
  const paint = () => {
    const query = $('#folderSearch').value.toLowerCase();
    const matches = folders.filter(s => (s.groupLabel + ' ' + s.cwd).toLowerCase().includes(query));
    $('#folderOptions').innerHTML = matches.map(s => `<button class="folder-option" data-cwd="${esc(s.cwd)}" aria-pressed="${picked === s.cwd}"><strong>${esc(s.groupLabel)}</strong><span>${esc(s.cwd)}</span></button>`).join('') || '<div class="nores">No matching folders. Try a project name.</div>';
    $('#pickedPath').textContent = picked ? 'Selected: ' + picked : 'Choose a folder above.';
    $('#startSession').disabled = !picked || starting || attachments.blocked(attachmentKey);
    $('#startSession').textContent = 'Start ' + (kind === 'claude' ? 'Claude' : 'Astra') + ' session';
  };
  $('#folderSearch').oninput = paint;
  for (const radio of $$('#modalCard [name="agent"]')) radio.onchange = () => { kind = radio.value; attachments.setKind(attachmentKey, kind); paint(); };
  const version = modalVersion;
  let message = '';
  const messageInput = $('#newMessage');
  messageInput.oninput = () => { message = messageInput.value; };
  attachments.mount($('#newAttachments'), { key: attachmentKey, kind, dropZone: $('#newMessageArea'), cwd: () => picked || '',
    read: () => messageInput.value, write: text => { message = text; messageInput.value = text; },
    canEdit: () => !starting && version === modalVersion,
    change: () => { if (version === modalVersion) $('#startSession').disabled = !picked || starting || attachments.blocked(attachmentKey); }
  });
  $('#modalCard').onclick = async e => {
    const folder = e.target.closest('[data-cwd]');
    if (folder) { picked = folder.dataset.cwd; paint(); $('#folderOptions').querySelector(`[data-cwd="${CSS.escape(picked)}"]`)?.focus({preventScroll:true}); return; }
    const button = e.target.closest('[data-n]'); if (!button) return;
    if (button.dataset.n === 'cancel') return closeModal();
    if (!picked || starting || attachments.blocked(attachmentKey)) return;
    if(button.disabled)return;
    starting = true;
    messageInput.disabled = true;
    $$('#modalCard [name="agent"]').forEach(r => r.disabled = true);
    attachments.refresh(attachmentKey);
    button.disabled=true; button.textContent='Opening session…';
    const opened=await openInApp(kind === 'claude' ? 'term-new' : 'term-new-astra', {cwd:picked}, 'New session');
    if(version!==modalVersion)return;
    if(opened){
      if(message.trim()){
        steerDrafts.set(state.sel,message); attachments.move(attachmentKey,state.sel);
        state.tab='chat'; $('#steer').dataset.sig=''; $('#steer').innerHTML=''; renderHead();
      }
      closeModal();
    }
    else{starting=false;messageInput.disabled=false;$$('#modalCard [name="agent"]').forEach(r=>r.disabled=false);attachments.refresh(attachmentKey);button.disabled=false;button.textContent='Try again';$('#pickedPath').textContent='Could not start the session. Your folder selection is kept.';$('#pickedPath').classList.add('new-error');}
  };
  paint();
}

$('#newBtn').onclick = newSessionModal;

// ---------------- controls ----------------

$('#groups').onclick = e => { const g = e.target.closest('.group'); if (!g) return; state.group = g.dataset.g; animateCards = true; render(); };
$('#pills').onclick = e => { const b = e.target.closest('button'); if (!b) return; state.filter = b.dataset.f; $$('#pills button').forEach(x => (x.classList.toggle('on', x === b), x.setAttribute('aria-pressed', x === b))); animateCards = true; render(); };
$('#cards').onclick = e => { if (e.target.closest('#clearFilters')) { state.group = '*'; state.filter = 'all'; state.query = ''; $('#search').value = ''; $$('#pills button').forEach(b => { b.classList.toggle('on', b.dataset.f === 'all'); b.setAttribute('aria-pressed', b.dataset.f === 'all'); }); render(); return; } const c = e.target.closest('.card'); if (c) select(c.dataset.k); };
$('#cards').ondblclick = e => { const c = e.target.closest('.card'); if (c) { const s = state.byKey.get(c.dataset.k); if (s) runAction('resume', s); } };
let searchT;
$('#search').oninput = e => { clearTimeout(searchT); searchT = setTimeout(() => { state.query = e.target.value.trim(); animateCards = true; render(); }, 120); };
$('#fsBtn').onclick = () => {
  if (document.fullscreenElement) return document.exitFullscreen();
  // A window started in browser fullscreen (F11) can only be left with F11.
  if (innerHeight >= screen.height && innerWidth >= screen.width) return toast('Browser fullscreen', 'Press F11 to leave it.');
  document.documentElement.requestFullscreen().catch(() => toast('Fullscreen blocked', 'Press F11 instead.', 'bad'));
};
document.addEventListener('fullscreenchange', () => {
  const fs = !!document.fullscreenElement;
  $('#fsBtn').classList.toggle('on', fs);
  $('#fsBtn').title = fs ? 'Leave fullscreen (F11)' : 'Enter fullscreen (F11)';
  $('#fsBtn').setAttribute('aria-label', fs ? 'Leave fullscreen' : 'Enter fullscreen');
  if (!fs && navigator.keyboard?.unlock) navigator.keyboard.unlock();
  // Esc interrupts Claude in the terminal; in fullscreen the browser would take it. Locked, a long press still exits.
  if (fs && navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(() => { });
  if (fs) toast('Fullscreen', 'Hold Esc to leave fullscreen.');
});

async function shutdown() {
  const el = document.createElement('div');
  el.id = 'shutdown';
  el.innerHTML = '<div class="core-line"></div><div>NEXUS OFFLINE</div>';
  document.body.appendChild(el);
  fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexus': '1' }, body: JSON.stringify({ action: 'quit' }) }).catch(() => { });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  await new Promise(r => setTimeout(r, 1000));
  window.close();
  // Only reached when the browser refuses to close the window.
  el.lastChild.textContent = 'NEXUS OFFLINE — CLOSE WITH ALT+F4';
}
$('#exitBtn').onclick = () => {
  const running = state.terms.filter(t => !t.exited);
  if (!running.length) return shutdown();
  modal(`<h2>${running.length} terminal${running.length > 1 ? 's are' : ' is'} still running</h2>
    <p>Exiting stops ${running.length > 1 ? 'them' : 'it'}; the conversation${running.length > 1 ? 's are' : ' is'} saved and can be resumed later. Or close only the window: the terminals keep working and reopening NEXUS reconnects to them.</p>
    <div class="modal-actions"><button class="btn" data-m="cancel">Cancel</button><button class="btn" data-m="window">Close window only</button><button class="btn danger" data-m="all">Exit and stop all</button></div>`);
  $('#modalCard').onclick = e => {
    const m = e.target.closest('[data-m]'); if (!m) return;
    closeModal();
    if (m.dataset.m === 'all') shutdown();
    if (m.dataset.m === 'window') window.close();
  };
};

document.addEventListener('keydown', e => {
  if (!state.booted || $('#modal').classList.contains('on')) return;
  if (e.target.closest && e.target.closest('.xterm')) return; // keys typed into a terminal belong to it
  const typing = e.target.matches('input, textarea, select, [contenteditable=true]');
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if ($('#modal').classList.contains('on')) return closeModal();
    const more = $('.session-more[open]');
    if (more) { more.open = false; more.querySelector('summary').focus(); return; }
    if (typing && e.target.id === 'search') { e.target.value = ''; state.query = ''; e.target.blur(); render(); }
    else if (typing) e.target.blur();
    else if (state.view !== 'overview') { setView('overview'); $('#finderBtn').focus(); }
    return;
  }
  if (typing) { if (e.target.id === 'search' && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.target.blur(); move(0); } return; }
  if (e.target.closest('button, summary, a, [role=button]') && (e.key === 'Enter' || e.key === ' ')) return;
  if (e.key === '/') { e.preventDefault(); if (matchMedia('(max-width: 700px)').matches || state.view === 'overview') finder(); else $('#search').focus(); }
  else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') { const card = $(`.card[data-k="${CSS.escape(state.sel || '')}"]`); card?.focus({preventScroll:true}); }
  else if (e.key === 'w' || e.key === 'W') setView(state.view === 'wall' ? 'focus' : 'wall');
  else if (e.key === 'f' || e.key === 'F') { const b = $('#followBox'); b.checked = !b.checked; b.onchange(); }
  else if (e.key === 'n' || e.key === 'N') newSessionModal();
});

function move(d) {
  const list = visible(); if (!list.length) return;
  let i = list.findIndex(s => keyOf(s) === state.sel);
  i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + d));
  select(keyOf(list[i]));
  $(`.card[data-k="${CSS.escape(keyOf(list[i]))}"]`)?.focus({preventScroll:true});
}

document.addEventListener('keydown', e => {
  const control = e.target.closest('[role=button]');
  if (control && e.target === control && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); control.click(); }
});

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }, 1000);

// ---------------- boot sequence ----------------

function scramble(el, text, ms) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = text; return; }
  const chars = '01<>/\\#%&@$*+=ΣΔΛΞΨ';
  const t0 = performance.now();
  (function step(now) {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = [...text].map((c, i) => i / text.length < p ? c : chars[Math.floor(Math.random() * chars.length)]).join('');
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

async function boot() {
  const bootEl = $('#boot'), log = $('#bootLog'), bar = $('#bootBar');
  let skip = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onSkip = () => { skip = true; };
  addEventListener('keydown', onSkip, { once: true });
  bootEl.addEventListener('click', onSkip, { once: true });
  const wait = ms => new Promise(r => { const t0 = Date.now(); (function tick() { if (skip || Date.now() - t0 >= ms) r(); else setTimeout(tick, 30); })(); });
  const line = (text, ok) => { const d = document.createElement('div'); d.innerHTML = '› ' + text + (ok ? `<span class="ok">${ok}</span>` : ''); log.appendChild(d); };

  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(() => scramble($('.boot-title'), 'NEXUS', 900), 250);
  const dataP = refresh();
  await wait(700);
  line('assembling the attention field', 'OK'); bar.style.width = '18%';
  await wait(260);
  const data = await Promise.race([dataP, wait(1000).then(() => null)]);
  const S = (data && data.sessions) || [];
  const live = S.filter(s => s.kind === 'claude' && s.live).length;
  line('linking Claude', data ? live + ' live' : 'pending'); bar.style.width = '40%';
  await wait(240);
  line('indexing transcripts', data ? S.filter(s => s.kind === 'claude').length + ' sessions' : 'pending'); bar.style.width = '62%';
  await wait(240);
  line('linking Astra', data ? S.filter(s => s.kind === 'astra').length + ' runs' : 'pending'); bar.style.width = '82%';
  await wait(240);
  line('mapping projects', data ? new Set(S.map(s => s.group)).size + ' found' : 'pending'); bar.style.width = '100%';
  await wait(380);
  line(data ? 'deck online' : 'connecting in the background', data ? '◆' : '…');
  await wait(320);

  removeEventListener('keydown', onSkip);
  bootEl.classList.add('out');
  state.booted = true;
  $('#app').classList.add('in');
  $('#app').inert = false;
  setTimeout(() => $('#app').classList.add('settled'), 1500);
  setTimeout(() => bootEl.remove(), 900);
  // xterm measures the font when a terminal opens: make sure it has loaded.
  await Promise.race([document.fonts.load('13px "JetBrains Mono"').catch(() => { }), new Promise(r => setTimeout(r, 1500))]);
  renderApsis();
  restorePlace();
  if (apsis.voice) speakBriefing();
}

addEventListener('DOMContentLoaded', () => { initializeApsis(); initializeRedesign(); boot(); });
setInterval(refresh, 1800);
setInterval(() => { if (state.view === 'focus') loadFeed(false); }, 2000);
