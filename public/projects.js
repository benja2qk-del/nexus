'use strict';
// Project navigation uses the same groups and transcript evidence as the session deck.
const projectUI = { key: null, count: 8, awayCount: 3 };
function projectGroups() {
  const groups = new Map();
  for (const s of state.sessions) {
    if (!groups.has(s.group)) groups.set(s.group, { key: s.group, label: s.groupLabel || s.group, sessions: [] });
    groups.get(s.group).sessions.push(s);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
function projectActivity(sessions) {
  const working = sessions.filter(s => s.status === 'busy').length;
  const waiting = sessions.filter(s => s.kind === 'claude' && s.live && s.status !== 'busy').length;
  const live = sessions.filter(s => s.live).length;
  return { working, waiting, live, mode: waiting ? 'waiting' : working ? 'working' : live ? 'live' : 'saved',
    text: [working && `${working} working`, waiting && `${waiting} waiting`, !working && !waiting && live && `${live} live`].filter(Boolean).join(' · ') || 'Saved sessions' };
}
function projectMarks(sessions) {
  return ['claude', 'astra'].filter(kind => sessions.some(s => s.kind === kind)).map(kind => `<span class="project-agent ${kind}">${kind === 'claude' ? '○ Claude' : '◇ Astra'}</span>`).join('');
}
function renderProjectStrip() {
  const groups = projectGroups();
  $('#projectShelfCount').textContent = `${groups.length} project${groups.length === 1 ? '' : 's'}`;
  const tile = g => {
    const a = projectActivity(g.sessions);
    return `<button class="project-tile ${a.mode}" data-project-filter="${esc(g.key)}" aria-pressed="${state.group === g.key}" title="${esc(g.label)}"><span class="project-tile-top"><i aria-hidden="true"></i><span>${g.sessions.length} session${g.sessions.length === 1 ? '' : 's'}</span></span><strong>${esc(g.label)}</strong><span class="project-tile-status">${esc(a.text)}</span><span class="project-agents">${projectMarks(g.sessions)}</span></button>`;
  };
  updateHTML($('#projectStrip'), `<button class="project-tile project-all" data-project-filter="*" aria-pressed="${state.group === '*'}"><span class="project-tile-top">${String(groups.length).padStart(2, '0')} PLACES</span><strong>All projects</strong><span class="project-tile-status">${state.sessions.length} sessions</span><span class="project-agents">Your whole workspace</span></button>` + groups.map(tile).join(''));
  const chosen = groups.find(g => g.key === state.group);
  updateHTML($('#projectSelection'), chosen ? `<span><b>${esc(chosen.label)}</b><small>${visible().length} of ${chosen.sessions.length} sessions in view</small></span><button class="btn" data-project="${esc(chosen.key)}">Open project <span aria-hidden="true">↗</span></button>` : '<span class="project-hint">Choose a project to filter your sessions.</span>');
}
function filterProject(key) {
  state.group = state.group === key ? '*' : key;
  // A project tap always reveals its sessions, including saved work.
  state.filter = 'all'; state.query = ''; $('#search').value = ''; apsis.phoneCount = 8;
  $$('#pills button').forEach(b => { b.classList.toggle('on', b.dataset.f === 'all'); b.setAttribute('aria-pressed', String(b.dataset.f === 'all')); });
  render(); savePlace();
}
function openProject(key) {
  projectUI.key = key; projectUI.count = 8; projectUI.awayCount = 3; state.group = key;
  state.filter = 'all'; state.query = ''; $('#search').value = '';
  $$('#pills button').forEach(b => { b.classList.toggle('on', b.dataset.f === 'all'); b.setAttribute('aria-pressed', String(b.dataset.f === 'all')); });
  setView('project'); $('#projectPage').scrollTop = 0;
  $('#projectTitle')?.focus({ preventScroll: true });
}
function returnToOverview() {
  if (state.view === 'focus' && projectUI.key && state.byKey.get(state.sel)?.group === projectUI.key) {
    setView('project'); $('#projectTitle')?.focus({ preventScroll: true });
  } else setView('overview');
}
function projectSessionRank(a, b) {
  const rank = s => statusLabel(s)[0] === 'ready' ? 2 : s.status === 'busy' ? 1 : 0;
  return rank(b) - rank(a) || b.updated - a.updated;
}
function renderProjectPage() {
  if (state.view !== 'project') return;
  const group = projectGroups().find(g => g.key === projectUI.key);
  if (!group) {
    updateHTML($('#projectPage'), '<button class="text-action project-back" data-project-back>← Projects</button><div class="empty-card"><h1>No sessions here right now.</h1><p>This project may have moved outside the recent-session window. Refresh or choose another project.</p></div>');
    return;
  }
  const sessions = [...group.sessions].sort(projectSessionRank), activity = projectActivity(sessions);
  const query = state.query.toLowerCase();
  const matches = sessions.filter(s => !query || sessionSearchText(s).includes(query));
  const folders = [...new Set(sessions.map(s => s.cwd).filter(Boolean))];
  const known = sessions.filter(s => s.insights?.spend?.measured);
  const total = known.reduce((n, s) => n + s.insights.spend.total, 0);
  const partial = known.some(s => s.insights.spend.partial);
  const changed = sessions.filter(s => { const d = s.insights?.digest; return d?.since && (d.turns || d.tools || d.commits?.length || d.errors); });
  const firstVisits = sessions.filter(s => s.insights?.digest && !s.insights.digest.since).length;
  const pending = sessions.filter(s => !s.insights?.digest).length;
  const partialAway = sessions.some(s => s.insights?.digest?.partial);
  const turns = changed.reduce((n, s) => n + (s.insights.digest.turns || 0), 0);
  const tools = changed.reduce((n, s) => n + (s.insights.digest.tools || 0), 0);
  updateHTML($('#projectPage'), `<div class="project-page-top"><button class="text-action project-back" data-project-back>← Projects</button><span class="project-agents">${projectMarks(sessions)}</span></div>` +
    `<header class="project-hero ${activity.mode}"><span class="eyebrow">YOUR PROJECT SPACE</span><h1 id="projectTitle" tabindex="-1">${esc(group.label)}</h1><p class="project-location">${folders.length > 1 ? `${folders.length} folders · choose one when starting a session` : esc(folders[0] || 'Folder unavailable')}</p><div class="project-vitals"><span><i aria-hidden="true"></i>${esc(activity.text)}</span><button class="project-jump" data-project-jump>${sessions.length} sessions ↓</button></div><div class="project-launch"><span>＋ New session here</span><div><button class="btn primary" data-project-new="claude" ${folders.length ? '' : 'disabled'}>○ Claude</button><button class="btn" data-project-new="astra" ${folders.length ? '' : 'disabled'}>◇ Astra</button></div></div></header>` +
    `<div class="project-columns"><aside class="project-evidence"><section class="project-away"><span class="eyebrow">WHILE YOU WERE AWAY</span><h2>${changed.length ? `${changed.length} session${changed.length === 1 ? '' : 's'} moved ahead.` : pending ? 'Reading the latest.' : firstVisits === sessions.length ? 'Your first look here.' : 'You’re caught up.'}</h2><p>${changed.length ? `${turns} turns · ${tools} tool calls since your per-session checkpoints.` : firstVisits === sessions.length ? 'Open a session to establish its away checkpoint.' : pending ? 'Available changes will appear as transcripts are indexed.' : 'No new recorded activity in sessions you’ve opened.'}</p>${firstVisits || pending || partialAway ? `<p class="project-coverage">${[firstVisits && `${firstVisits} first-visit session${firstVisits === 1 ? '' : 's'}; history is on each card.`, pending && `${pending} still indexing.`, partialAway && 'Some evidence is partial.'].filter(Boolean).join(' ')}</p>` : ''}` +
    changed.slice(0, projectUI.awayCount).map(s => `<button class="project-change" data-session="${esc(keyOf(s))}" data-insight="digest"><strong>${esc(compact(s.title, 72))}</strong><span>${esc(digestLine(s.insights.digest))}</span><small>${esc(compact(s.insights.digest.opening || 'View the recorded changes.', 110))} ↗</small></button>`).join('') + (changed.length > projectUI.awayCount ? `<button class="text-action project-away-more" data-project-away-more>Show all ${changed.length} updated sessions ↓</button>` : '') + '</section>' +
    `<section class="project-spend"><span class="eyebrow">MEASURED SPEND</span><h2>${known.length ? tokens(total) : '—'} <small>tokens</small></h2><p>${known.length} / ${sessions.length} sessions with usage${partial ? ' · partial scans' : ''}</p><p class="project-coverage">Recorded session totals, including shared fork history. Not dollar billing. Unreported usage is unknown.</p><button class="text-action" data-project-spend>See session usage ↗</button></section></aside>` +
    `<section class="project-work"><div class="project-sessions-heading"><h2 id="projectSessionsTitle" tabindex="-1">Sessions</h2><span>${query ? `${matches.length} / ${sessions.length} matches` : `${sessions.length} in this place`}</span></div><div class="project-session-grid">${matches.length ? matches.slice(0, projectUI.count).map(sessionCard).join('') : '<div class="empty-card"><p>No sessions match this search.</p><button class="btn" data-project-clear-search>Clear search</button></div>'}</div>${matches.length > projectUI.count ? `<button class="btn more-sessions" data-project-more>Show more (${matches.length - projectUI.count})</button>` : ''}</section></div>`);
}
function projectSpend() {
  const group = projectGroups().find(g => g.key === projectUI.key); if (!group) return;
  modal(`<div class="sheet-kicker">PROJECT SPEND</div><h2>${esc(group.label)}</h2><p>Measured session tokens. Partial scans are labeled; unreported usage is unknown. Shared fork history can appear in more than one session.</p><div class="spend-sessions">${[...group.sessions].sort((a, b) => (b.insights?.spend?.total || 0) - (a.insights?.spend?.total || 0)).map(s => `<button data-project-usage="${esc(keyOf(s))}"><span>${esc(s.title)}</span><b>${s.insights?.spend?.measured ? tokens(s.insights.spend.total) + (s.insights.spend.partial ? ' · partial' : '') : 'Unknown'}</b></button>`).join('')}</div>`);
  $('#modalCard').onclick = e => { const b = e.target.closest('[data-project-usage]'); if (b) { const s = state.byKey.get(b.dataset.projectUsage); if (s) insightAction('spend', s); } };
}
function initializeProjects() {
  $('#projectPage').addEventListener('click', e => {
    if (e.target.closest('[data-project-back]')) { setView('overview'); $('#projectStrip [aria-pressed=true]')?.focus({ preventScroll: true }); return; }
    const launch = e.target.closest('[data-project-new]'); if (launch) return newSessionModal({ group: projectUI.key, kind: launch.dataset.projectNew });
    if (e.target.closest('[data-project-clear-search]')) { state.query = ''; $('#search').value = ''; render(); return; }
    if (e.target.closest('[data-project-jump]')) { $('#projectSessionsTitle').scrollIntoView({ block: 'start' }); $('#projectSessionsTitle').focus({ preventScroll: true }); return; }
    if (e.target.closest('[data-project-away-more]')) { projectUI.awayCount = Infinity; renderProjectPage(); return; }
    if (e.target.closest('[data-project-more]')) { projectUI.count += 8; renderProjectPage(); return; }
    if (e.target.closest('[data-project-spend]')) return projectSpend();
    overviewAction(e);
  });
}
