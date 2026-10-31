'use strict';
// Apsis presentation layer. All session facts arrive from the existing local API.
const apsis = { page: 0, phoneCount: 8, away: new Map(), viewedAt: new Map(), checkBusy: new Set(), voice: false, theme: 'apsis' };
const pref = { get(k, fallback) { try { return localStorage.getItem('nexus.' + k) ?? fallback; } catch { return fallback; } }, set(k, v) { try { localStorage.setItem('nexus.' + k, v); } catch { } } };
function coreMarkup() { return '<div class="nexus-core" data-state="working">' + Prism.markup() + '</div>'; }
function initializeApsis() {
  document.body.classList.add('apsis');
  $('#app').dataset.view = 'overview';
  document.body.appendChild($('#connection'));
  $('.brand-mark').outerHTML = '<span class="brand-mark">' + Prism.markup() + '</span>';
  $$('.nexus-core').forEach(core => core.innerHTML = Prism.markup());
  $('.brand-sub').textContent = 'YOUR LOCAL INTELLIGENCE';
  $('.boot-core').innerHTML = coreMarkup();
  $('.boot-sub').textContent = 'ASSEMBLING YOUR ATTENTION FIELD';
  $('.boot-skip').innerHTML = '<button class="btn" id="skipBoot">Skip sequence ↗</button>';
  $('#app').inert = true;
  apsis.theme = pref.get('theme', 'apsis');
  if (!['apsis', 'parallax', 'stratum'].includes(apsis.theme)) apsis.theme = 'apsis';
  setTheme(apsis.theme);
  apsis.voice = false;
  $('#themeSelect').onchange = e => setTheme(e.target.value);
  $('#appMenuBtn').onclick = appMenu;
  $('.briefing-copy').insertAdjacentHTML('beforeend', '<button class="text-action" id="readBriefing">Read briefing aloud</button>');
  $('#readBriefing').onclick = speakBriefing;
  $('#finderBtn').onclick = () => finder();
  $('#backOverview').onclick = returnToOverview;
  $('#wallBack').onclick = () => setView('overview');
  $('#overviewHelp').onclick = () => {
    modal('<h2>Make yourself at home.</h2><p><b>/</b> finds a session. <b>W</b> opens the wall. <b>Escape</b> returns to the overview. Use Tab to move through projects and session actions.</p><p>On iPhone, use Safari’s Share menu → Add to Home Screen. Chat starts saved sessions when you send. Question buttons submit your answer; Terminal exposes the advanced raw screen.</p><p>Pair your phone from the PC using Pair a phone. Your last session, view, and theme are remembered on this device. Your reading position is remembered across paired devices. Tap Talk in Chat for a voice conversation.</p><button class="btn" data-close>Close</button>');
    $('#modalCard').onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
  };
  $('#spendTotal').onclick = spendOverview;
  $('#overview').addEventListener('click', overviewAction);
  $('#focusInsights').addEventListener('click', e => {
    const b = e.target.closest('[data-insight]'); if (!b) return;
    const s = state.byKey.get(state.sel); if (s) insightAction(b.dataset.insight, s);
  });
  $('#chatView').addEventListener('click', e => { const b = e.target.closest('[data-chat]'); if (!b) return; if (b.dataset.chat === 'help') return chatHelp(); if (b.dataset.chat === 'retry') return loadChat(); if (b.dataset.chat === 'feed') { state.tab = 'feed'; renderHead(); loadFeed(true); return; } if (b.dataset.chat === 'reconnect') { const t = selTerm(); if(t) connect(termView(t.id)); } else if (b.dataset.chat === 'close') { closeTerm(selTerm()); } else if (b.dataset.chat === 'raw') { state.tab = 'term'; renderHead(); } else { const s = state.byKey.get(state.sel); if (s) runAction('resume', s); } });
  initializePolish();
  initializeProjects();
  setInterval(() => { if (state.view === 'focus' && !document.hidden && state.byKey.has(state.sel)) rememberViewed(state.byKey.get(state.sel)); }, 15000);
}
function setTheme(theme) {
  apsis.theme = theme; document.documentElement.dataset.theme = theme; $('#themeSelect').value = theme; pref.set('theme', theme);
}
function speakBriefing() {
  if (!('speechSynthesis' in window)) return toast('Read aloud unavailable', 'Try Voice check in More.');
  NexusVoice.end();
  speechSynthesis.cancel(); const message = new SpeechSynthesisUtterance($('#briefingText').textContent); message.rate = .95; speechSynthesis.speak(message);
}
function compact(s, n = 155) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function digestLine(d) {
  if (!d) return 'Reading transcript evidence…';
  const commits = d.commits.filter(c => c.confirmed).reduce((n, c) => n + c.hashes.length, 0);
  const parts = [`${d.turns} turn${d.turns === 1 ? '' : 's'}`, `${d.tools} tool calls`];
  if (d.files.length) parts.push(`${d.files.length} file${d.files.length === 1 ? '' : 's'} changed`);
  if (commits) parts.push(`${commits} commit${commits === 1 ? '' : 's'}`);
  if (d.errors) parts.push(`${d.errors} errors`);
  return parts.join(' · ') + (d.partial ? ' · partial' : '');
}
function sessionCard(s) {
  if (matchMedia('(max-width: 700px)').matches) return compactSessionCard(s);
  const i = s.insights || {}, d = i.digest, u = i.spend, [cls, status] = statusLabel(s), k = keyOf(s);
  const now = sessionPreview(s);
  return `<article class="mission-card ${s.kind}" data-session="${esc(k)}"><div class="mission-id"><span class="agent-mark">${s.kind === 'claude' ? '○ CLAUDE' : '◇ ASTRA'}</span><span class="status ${cls}" title="${esc(s.statusDetail || '')}"><i></i>${esc(status)}</span></div>` +
    `<p class="mission-project">${esc(s.groupLabel)} <span>· ${ago(s.updated)}</span></p><div class="mission-objective"><span class="eyebrow">OBJECTIVE</span><h2 title="${esc(i.objective?.title || s.title)}">${esc(compact(i.objective?.title || s.title, 84))}</h2><p title="${esc(i.objective?.request || '')}">${esc(compact(i.objective?.request || s.firstPrompt || 'Original request unavailable.', 150))}</p></div>` +
    `${sessionTagsHTML(s)}<div class="mission-facts"><div><span class="eyebrow">WHILE YOU WERE AWAY <small>${d?.since ? 'SINCE ' + clockTime(d.since) : 'FIRST VISIT'}</small></span><button class="fact-link" data-insight="digest">${esc(digestLine(d))}<span class="fact-preview">${esc(compact(d?.opening || (d?.firstVisit ? 'Session history until your first view.' : 'No new assistant message.'), 110))}</span></button></div>` +
    `<div><span class="eyebrow">NOW</span><p class="mission-now" title="${esc(now)}">${esc(compact(now, 130))}</p></div>` +
    `<div class="alignment ${i.alignment?.verdict === 'Review' ? 'review' : ''}"><span class="eyebrow">ON TRACK? <small>HEURISTIC</small></span><p><b>${esc(i.alignment?.verdict || 'Indexing')}</b> · ${esc(compact(i.alignment?.reason || 'Reading transcript evidence.', 105))}</p><button class="text-action" data-insight="check">Check focus ↗</button></div>` +
    `<div class="mission-spend"><span class="eyebrow">SPEND</span><button class="fact-link" data-insight="spend"><strong>${u?.measured ? tokens(u.total) : '—'}</strong><span> tokens / session${u?.partial ? ' · indexing' : ''}<small>${u?.measured ? tokens(u.turns.at(-1)?.total || 0) + ' latest turn' : 'Waiting for usage records'}</small></span></button></div></div>` +
    (i.error ? `<p class="insight-error">${esc(i.error)}</p>` : '') +
    `<div class="mission-actions"><button class="btn primary" data-open="${esc(k)}">Open session <span>↗</span></button></div></article>`;
}
function renderApsis() {
  if (!$('#overview')) return;
  renderProjectStrip();
  renderProjectPage();
  const b = state.briefing || {}, sessions = visible();
  $('#briefingTitle').textContent = b.waiting ? `${b.waiting} session${b.waiting === 1 ? ' is' : 's are'} waiting for you.` : b.working ? 'Your work is moving.' : 'Your next move starts here.';
  $('#briefingText').textContent = b.text || 'Reading your sessions. Preparing the briefing.';
  $('#briefingRange').textContent = b.since ? 'SINCE ' + clockTime(b.since) + ' · PER-SESSION CHECKPOINTS' : 'YOUR WORK, IN VIEW';
  $('#projectCount').textContent = String(new Set(state.sessions.map(s => s.group)).size).padStart(2, '0') + ' PROJECTS';
  const core = $('#nexusCore'); core.dataset.state = b.waiting ? 'needs-you' : b.working ? 'working' : 'idle';
  $('#coreState').textContent = b.waiting ? 'YOUR ATTENTION, PLEASE' : b.working ? 'WORK IN MOTION' : 'READY WHEN YOU ARE';
  const ranked = [...sessions].sort(projectSessionRank);
  const first = ranked[0], second = ranked.find(s => s.kind !== first?.kind) || ranked[1];
  updateHTML($('#missionLeft'), first ? sessionCard(first) : '<div class="empty-card"><h2>A little room to begin.</h2><p>No sessions match these filters. Search another project or start a session.</p><button class="btn" data-clear>Clear filters</button></div>');
  updateHTML($('#missionRight'), second ? sessionCard(second) : '<div class="empty-card"><span class="eyebrow">SPACE TO THINK</span><h2>One objective.<br>Your full attention.</h2><p>New sessions will join your orbit.</p></div>');
  const groups = [...new Set(state.sessions.map(s => s.group))].sort((a, z) => a.localeCompare(z));
  const pages = Math.max(1, Math.ceil(groups.length / 8)); apsis.page %= pages;
  const subset = groups.slice(apsis.page * 8, apsis.page * 8 + 8);
  const positions = [[24,15],[70,10],[87,37],[78,72],[49,87],[18,78],[12,48],[46,5]];
  updateHTML($('#orbitProjects'), subset.map((g, n) => {
    const set = state.sessions.filter(s => s.group === g), working = set.filter(s => s.status === 'busy').length, waiting = set.filter(s => s.live && s.kind === 'claude' && s.status !== 'busy').length;
    return `<button class="project-node ${working ? 'working' : ''} ${waiting ? 'waiting' : ''}" style="--x:${positions[n][0]}%;--y:${positions[n][1]}%" data-project="${esc(g)}"><span class="project-point"></span><strong>${esc(g)}</strong><small>${set.length} sessions${working ? ' · ' + working + ' working' : waiting ? ' · ' + waiting + ' waiting' : ' · saved'}</small></button>`;
  }).join(''));
  updateHTML($('#orbitPages'), pages > 1 ? `<button class="text-action" data-orbit-page>Projects ${apsis.page + 1} / ${pages} →</button>` : '');
  updateHTML($('#phoneSessions'), (ranked.length ? ranked.slice(0, apsis.phoneCount).map(sessionCard).join('') : '<div class="empty-card"><h2>A little room to begin.</h2><p>No sessions match this view.</p><button class="btn" data-clear>Show all sessions</button></div>') + (ranked.length > apsis.phoneCount ? `<button class="btn more-sessions" data-phone-more>Show more (${ranked.length - apsis.phoneCount})</button>` : ''));
  $('[data-phone-live]').setAttribute('aria-pressed', String(state.filter === 'live'));
  $('[data-phone-live]').textContent = state.filter === 'live' ? 'All sessions' : 'Live only';
  updateHTML($('#overviewCounts'), `<div><b>${b.working || 0}</b><span>working</span></div><div><b>${b.waiting || 0}</b><span>waiting</span></div><div><b>${state.sessions.length}</b><span>sessions</span></div>`);
  updateHTML($('#spendTotal'), `<span class="eyebrow">MEASURED SPEND</span><b>${b.measured ? tokens(b.tokens) : '—'} <small>tokens</small></b><span>${b.measured || 0} / ${state.sessions.length} sessions with usage ↗</span>`);
  $('#overviewUpdated').textContent = state.lastUpdate ? '· ' + clockTime(state.lastUpdate) : '· connecting';
  renderFocusInsights();
}
function overviewAction(e) {
  const filter = e.target.closest('[data-project-filter]'); if (filter) return filterProject(filter.dataset.projectFilter);
  const open = e.target.closest('[data-open]'); if (open) return select(open.dataset.open);
  const resume = e.target.closest('[data-resume]'); if (resume) { const s = state.byKey.get(resume.dataset.resume); select(keyOf(s), { tab: 'chat' }); if (!s.term) runAction('resume', s); return; }
  const project = e.target.closest('[data-project]'); if (project) return openProject(project.dataset.project);
  const insight = e.target.closest('[data-insight]'); if (insight) { const s = state.byKey.get(insight.closest('[data-session]').dataset.session); return insightAction(insight.dataset.insight, s); }
  if (e.target.closest('[data-orbit-page]')) { apsis.page++; renderApsis(); }
  if (e.target.closest('[data-phone-more]')) { apsis.phoneCount += 8; renderApsis(); }
  if (e.target.closest('[data-phone-live]')) { state.filter = state.filter === 'live' ? 'all' : 'live'; renderApsis(); }
  if (e.target.closest('[data-phone-wall]')) setView('wall');
  if (e.target.closest('[data-phone-spend]')) spendOverview();
  if (e.target.closest('[data-clear]')) { state.group = '*'; state.filter = 'all'; state.query = ''; $('#search').value = ''; render(); }
}
function finder(group) {
  modal(`<h2>${esc(group || 'Find your session')}</h2><label class="sr-only" for="finderSearch">Search sessions</label><input id="finderSearch" class="picker-search" placeholder="Search conversations…" autofocus><div id="finderResults" class="finder-results"></div><div class="modal-actions"><button class="btn" data-close>Close</button><button class="btn primary" data-new>New session</button></div>`);
  const paint = () => {
    const q = $('#finderSearch').value.toLowerCase();
    const matches = state.sessions.filter(s => (!group || s.group === group) && sessionSearchText(s).includes(q));
    const terminals = state.terms.filter(t => !group && !t.sessionKey && (t.title + ' ' + t.cwd).toLowerCase().includes(q));
    $('#finderResults').innerHTML = terminals.map(t => `<button class="finder-result" data-find="term:${esc(t.id)}"><span>TERMINAL IN NEXUS <small>${t.exited ? 'Ended' : 'Running'}</small></span><strong>${esc(t.title)}</strong><p>${esc(t.cwd)}</p></button>`).join('') + matches.map(s => compactSessionCard(s).replace('data-open=', 'data-find=')).join('') || '<p class="nores">No matching sessions.</p>';
  };
  $('#finderSearch').oninput = paint; paint();
  $('#modalCard').onclick = e => {
    if (e.target.closest('[data-close]')) return closeModal();
    const found = e.target.closest('[data-find]'); if (found) { closeModal(); select(found.dataset.find); return; }
    if (e.target.closest('[data-new]')) { closeModal(); newSessionModal(group ? { group } : {}); }
  };
}
function insightAction(action, s) {
  if (action === 'check') return focusCheckDialog(s);
  const i = s.insights || {}, d = apsis.away.get(keyOf(s)) || i.digest, u = i.spend;
  if (action === 'digest') {
    modal(`<h2>While you were away.</h2><p>${esc(s.title)}</p><p>${d?.since ? 'Since ' + new Date(d.since).toLocaleString() : 'First visit · available session history'}${d?.partial ? ' · partial evidence' : ''}</p><div class="digest-summary">${esc(digestLine(d))}</div>` +
      `<p>${esc(d?.opening || 'No assistant message in this interval.')}</p><h3>Files changed</h3><ul class="evidence-list">${d?.files.length ? d.files.map(f => `<li>${esc(f)}</li>`).join('') : '<li>No successful edit/write tool recorded.</li>'}</ul><h3>Commit commands &amp; results</h3><div class="commit-evidence">${d?.commits.length ? d.commits.map(c => `<details><summary>${c.confirmed ? 'Recorded commit · ' + esc(c.hashes.join(', ')) : c.failed ? 'Failed attempt' : 'Result unconfirmed'}</summary><pre>${esc(c.command)}\n${esc(c.result)}</pre></details>`).join('') : '<p>No git commit command recorded in this interval.</p>'}</div><p class="muted">${d?.partial ? 'Evidence is still indexing or exceeds the retained history window. Counts may be incomplete.' : 'Counts come from transcript events. File paths are successful edit/write/patch tool results; external filesystem changes are not inferred.'}</p><button class="btn" data-close>Close</button>`);
  } else {
    modal(`<h2>Measured tokens.</h2><p>${esc(s.title)}</p>${u?.measured ? `<div class="token-hero">${u.total.toLocaleString()}<small>session tokens${u.partial ? ' · partial scan' : ''}</small></div><div class="token-grid"><span>Input<b>${u.input.toLocaleString()}</b></span><span>Output<b>${u.output.toLocaleString()}</b></span><span>Cache reads<b>${u.cacheRead.toLocaleString()}</b></span><span>Cache writes<b>${u.cacheWrite.toLocaleString()}</b></span></div><p class="muted">${u.cacheIncludedInInput ? 'Codex cache reads are already included in input. Reasoning tokens are already included in output.' : 'Claude totals include input, output, cache reads, and cache writes; each message ID is counted once.'} Tokens are not dollars or subscription quota. Billed cost is not recorded.</p><h3>Recent turns</h3><ol class="turn-ledger">${u.turns.slice().reverse().map(t => `<li><span>${esc(compact(t.request || 'Recorded turn', 120))}<small>${t.at ? new Date(t.at).toLocaleString() : 'Time unavailable'}</small></span><b>${tokens(t.total)}</b></li>`).join('')}</ol>` : '<p>Usage has not been reported yet. Unknown is not zero.</p>'}<h3>Waste signals <small>· heuristic</small></h3><ul class="evidence-list">${i.waste?.length ? i.waste.map(w => `<li>${esc(w.reason)}</li>`).join('') : '<li>No current signal. This does not prove efficient work.</li>'}</ul><button class="btn" data-close>Close</button>`);
  }
  $('#modalCard').onclick = e => { if (e.target.closest('[data-close]')) closeModal(); };
}
function spendOverview() {
  const b = state.briefing || {};
  modal(`<h2>Spend, with coverage.</h2><div class="token-hero">${Number(b.tokens || 0).toLocaleString()}<small>measured session tokens</small></div><p>${b.measured || 0} of ${state.sessions.length} sessions have usage records. Scans run in the background. Unknown sessions do not count as zero; partial scans are labeled.</p><p>These are session totals, not just tokens spent while you were away. Cache reads and writes are included according to each agent’s transcript format. Dollar billing is unavailable.</p><div class="spend-sessions">${state.sessions.filter(s => s.insights?.spend?.measured).sort((a, b) => b.insights.spend.total - a.insights.spend.total).map(s => `<button data-spend="${esc(keyOf(s))}"><span>${esc(compact(s.title, 65))}</span><b>${tokens(s.insights.spend.total)}${s.insights.spend.partial ? '*' : ''}</b></button>`).join('')}</div><button class="btn" data-close>Close</button>`);
  $('#modalCard h2').insertAdjacentHTML('afterend', '<div class="modal-limits">' + $('#limits').innerHTML + '</div>');
  $('#modalCard .spend-sessions').insertAdjacentHTML('beforebegin', '<p class="muted">Forked transcripts may contain shared history. This sum is recorded session usage, not unique account billing.</p>');
  if (matchMedia('(max-width: 700px)').matches) {
    const paragraphs = [...$('#modalCard').querySelectorAll(':scope > p')];
    const explanation = document.createElement('details'); explanation.className = 'spend-explainer';
    explanation.innerHTML = '<summary>How these tokens are counted</summary>';
    paragraphs[0]?.after(explanation);
    paragraphs.slice(1).forEach(p => explanation.appendChild(p));
  }
  $('#modalCard').onclick = e => { if (e.target.closest('[data-close]')) closeModal(); const b = e.target.closest('[data-spend]'); if (b) insightAction('spend', state.byKey.get(b.dataset.spend)); };
}
function focusCheckDialog(s) {
  const key = keyOf(s), previous = s.insights?.check;
  modal(`<h2>Check this session’s focus.</h2><p>${esc(s.insights?.objective?.title || s.title)}</p><p>One on-demand Haiku request uses your Claude account. It receives the objective, latest request, and up to 20 summarized events. No tools. The verdict is cached until this transcript changes.</p><div id="focusVerdict" class="focus-verdict">${previous ? '<b>' + esc(previous.verdict) + '</b><p>' + esc(previous.reason) + '</p>' : 'A model assessment can miss context. It is a review aid.'}</div><div class="modal-actions"><button class="btn" data-close>Close</button><button class="btn primary" id="runFocusCheck" ${apsis.checkBusy.has(key) ? 'disabled' : ''}>${apsis.checkBusy.has(key) ? 'Checking…' : previous ? 'Show cached verdict' : 'Run check · uses Haiku'}</button></div>`);
  const version = modalVersion;
  $('#modalCard').onclick = async e => {
    if (e.target.closest('[data-close]')) return closeModal();
    const b = e.target.closest('#runFocusCheck'); if (!b || b.disabled) return;
    b.disabled = true; b.textContent = 'Checking…'; apsis.checkBusy.add(key);
    const result = await act('check-focus', { key }); apsis.checkBusy.delete(key);
    if (result) { s.insights.check = result; const latest = state.byKey.get(key); if (latest?.insights) latest.insights.check = result; }
    if (version !== modalVersion || !$('#modal').classList.contains('on')) return;
    b.disabled = false; b.textContent = result ? 'Show cached verdict' : 'Try again · uses Haiku';
    $('#focusVerdict').innerHTML = result ? `<b>${esc(result.verdict)}</b><p>${esc(result.reason)}</p><small>${result.cached ? 'Cached · ' : ''}${result.costUSD != null ? '$' + result.costUSD.toFixed(4) + ' reported cost · ' : ''}${clockTime(result.at)}</small>` : 'Check unavailable. Your session was not changed.';
  };
}
async function rememberViewed(s, force = false) {
  if (!s?.insights?.digest || (document.hidden && !force) || state.view !== 'focus' || state.transcriptKey !== keyOf(s)) return;
  const key = keyOf(s);
  if (!apsis.away.has(key)) apsis.away.set(key, s.insights.digest);
  const now = state.transcriptAt || state.lastUpdate;
  if (!force && apsis.viewedAt.has(key) && now - apsis.viewedAt.get(key) < 12000) return;
  apsis.viewedAt.set(key, now);
  const result = await act('viewed', { key, at: now });
  if (!result) apsis.viewedAt.delete(key);
}
function renderFocusInsights() {
  const s = state.byKey.get(state.sel), i = s?.insights;
  if (!s || !i) { updateHTML($('#focusInsights'), ''); return; }
  const d = apsis.away.get(keyOf(s)) || i.digest;
  if (matchMedia('(max-width: 700px)').matches) {
    updateHTML($('#focusInsights'), `<div class="focus-evidence"><button data-insight="digest" aria-label="Away: ${d?.turns || 0} turns, ${d?.files.length || 0} files">Away <b>${d ? d.turns + 't · ' + d.files.length + 'f' : 'Indexing'}</b></button><button data-insight="spend" title="Measured session tokens">Spend <b>${i.spend?.measured ? tokens(i.spend.total) : 'Unknown'}</b></button><button data-insight="check" title="${esc(i.alignment?.verdict || 'Indexing')} · heuristic">On track? ↗</button></div>`);
    if (state.view === 'focus') rememberViewed(s);
    return;
  }
  updateHTML($('#focusInsights'), `<details class="focus-objective" data-disclosure="focus-objective"><summary><span class="eyebrow">OBJECTIVE</span><span>${esc(compact(i.objective?.title || s.title, 150))}</span></summary><p>${esc(i.objective?.request)}</p></details><div class="focus-evidence"><button data-insight="digest">Away <b>${d ? d.turns + ' turns · ' + d.files.length + ' files' : 'Indexing'}</b></button><button data-insight="spend">Spend <b>${i.spend?.measured ? tokens(i.spend.total) + ' tokens' : 'Unknown'}</b></button><button data-insight="check" title="${esc(i.alignment?.reason || '')}">On track? <b>${esc(i.alignment?.verdict || 'Indexing')} · heuristic ↗</b></button></div>`);
  if (state.view === 'focus') rememberViewed(s);
}
function renderThinking() {
  const s = state.byKey.get(state.sel), a = state.activity, latest = a?.thought;
  const previous = !latest && state.transcript?.events.filter(e => e.t === (s?.kind === 'claude' ? 'think' : 'ai')).at(-1);
  const thought = latest || previous;
  updateHTML($('#thinkingView'), `<div class="thinking-label"><span class="eyebrow">${s?.kind === 'claude' ? 'LATEST RECORDED THINKING' : 'LATEST PUBLIC PROGRESS NOTE'}</span><span>${thought?.ts ? clockTime(thought.ts) : ''}</span></div>${previous ? '<p class="muted">From an earlier request; no thinking was recorded for this request.</p>' : ''}<div class="thinking-copy">${esc(thought?.text || 'No thinking or progress note in this excerpt.')}</div><div class="thinking-request"><span class="eyebrow">CURRENT REQUEST</span><p>${esc(a?.goal || s?.lastPrompt || 'No request reported.')}</p></div>`);
}
function renderChat() { renderReadableChat(); }
function renderChatOutput() { /* Raw Terminal does not own Chat rendering. */ }
