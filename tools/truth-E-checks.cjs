'use strict';
// The chat window shows what happened in the session: enough of it on first open, the newest part after a backlog,
// large records, earlier messages in their place, and conversations that are really separate kept apart.
// Synthetic data only; client files run in a vm with stub DOM, no browser.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { TailReader, continuation, CHAT_READ } = require('../transcript-tail');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-truth-e-'));
const line = r => JSON.stringify(r) + '\n';
let clock = Date.parse('2026-11-10T10:00:00Z');
const ts = () => new Date(clock += 1000).toISOString();
const user = text => ({ type: 'user', message: { role: 'user', content: text }, timestamp: ts() });
const picture = (text, bytes) => ({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'A'.repeat(bytes) } }, { type: 'text', text }] }, timestamp: ts() });
const reply = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] }, timestamp: ts() });
const tool = (i, size) => [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't' + i, name: 'Bash', input: { command: 'echo ' + i } }] }, timestamp: ts() },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't' + i, content: 'x'.repeat(size) }] }, timestamp: ts() }];
// Stands in for the server's event parsers: one chat event per record, nothing for bookkeeping.
const events = r => { const c = r.message?.content; if (r.type === 'assistant') return c.map(p => p.type === 'text' ? { t: 'ai', text: p.text, ts: r.timestamp } : { t: 'tool', id: p.id, ts: r.timestamp });
  if (r.type !== 'user') return []; if (typeof c === 'string') return [{ t: 'user', text: c, ts: r.timestamp }];
  return c.some(p => p.type === 'tool_result') ? [{ t: 'result', id: c[0].tool_use_id, ts: r.timestamp }] : [{ t: 'user', text: c.find(p => p.type === 'text')?.text, ts: r.timestamp }]; };
const write = (name, records) => { const f = path.join(temp, name + '.jsonl'); fs.writeFileSync(f, records.map(line).join('')); return f; };
const append = (f, records) => fs.appendFileSync(f, records.map(line).join(''));
const texts = items => items.filter(e => e.text).map(e => e.text);
const plain = v => JSON.parse(JSON.stringify(v)); // values made inside the vm carry its prototypes

(async () => { try {
  assert(CHAT_READ, 'transcript-tail exports the chat reading preset');
  // F92/F74/F162: a long turn of tool output after the request, and a conversation that ends on a 700 KB picture.
  const turn = write('turn', [user('The request'), reply('Starting on it.'), ...Array.from({ length: 30 }, (_, i) => tool(i, 40000)).flat(), reply('Final reply')]);
  const plainRead = new TailReader({ parse: events }).read(turn), chatRead = new TailReader({ parse: events, ...CHAT_READ }).read(turn);
  assert(!plainRead.items.some(e => e.t === 'user'), 'the default reader still reads only its window');
  assert(chatRead.items.some(e => e.t === 'user' && e.text === 'The request'), 'a first chat read widens until the owner\'s request is in view');
  assert.equal(chatRead.items.at(-1).text, 'Final reply');
  const pic = write('picture', [user('Request two'), reply('Answer two'), picture('What is in this picture?', 700000)]);
  assert.deepEqual(texts(new TailReader({ parse: events, ...CHAT_READ }).read(pic).items), ['Request two', 'Answer two', 'What is in this picture?'], 'a tail holding one huge record is not an empty conversation');
  const huge = path.join(temp, 'huge.jsonl'), fd = fs.openSync(huge, 'w'); fs.ftruncateSync(fd, 100 * 1024 * 1024);
  const end = Buffer.from('\n' + line(reply('Only the tail'))); fs.writeSync(fd, end, 0, end.length, 100 * 1024 * 1024 - end.length); fs.closeSync(fd);
  const bounded = new TailReader({ parse: events, ...CHAT_READ }).read(huge);
  assert(bounded.bytesRead <= 43 * 1024 * 1024 && bounded.partial, 'widening stops at its 32 MB cap');
  assert.deepEqual(texts(bounded.items), ['Only the tail']);
  // Screenshots: the owner's message is already in view, so the read stops instead of pulling megabytes for 60 events.
  const shots = write('shots', [user('Check the screens'), ...Array.from({ length: 12 }, (_, i) => tool(500 + i, 1024 * 1024)).flat(), user('Is the last screen right?'), reply('It is.')]);
  const shotRead = new TailReader({ parse: events, ...CHAT_READ }).read(shots);
  assert(shotRead.bytesRead <= 2.5 * 1024 * 1024, 'an owner message in view ends the widening within 2 MB (read ' + shotRead.bytesRead + ' bytes)');
  assert.deepEqual(texts(shotRead.items).slice(-2), ['Is the last screen right?', 'It is.']); assert.equal(shotRead.partial, true, 'and says earlier messages exist');
  const steps = write('small-steps', [user('Early ask'), ...Array.from({ length: 40 }, (_, i) => tool(600 + i, 20000)).flat(), user('Late ask'), reply('Late answer')]);
  const filled = new TailReader({ parse: events, ...CHAT_READ }).read(steps);
  assert(filled.items.length >= 60 && filled.items[0].text === 'Early ask', 'small records still fill toward 60 events');
  console.log('PASS first chat read widens to the owner\'s request, a huge last record still shows, the widening is capped and stops once the owner\'s message is in view');

  // F70: the chat was not polled while the session wrote megabytes.
  const busy = write('busy', Array.from({ length: 10 }, (_, i) => [user('early question ' + i), reply('early answer ' + i)]).flat());
  const reader = new TailReader({ parse: events, ...CHAT_READ }); reader.read(busy);
  append(busy, [...Array.from({ length: 6 }, (_, i) => tool(i, 500000)).flat(), user('late question'), reply('late answer')]);
  let read = reader.read(busy);
  assert.equal(read.more, false, 'a 3 MB backlog is read in one poll');
  assert.equal(read.items[0].text, 'early question 0', 'and kept contiguous with what was shown');
  assert.equal(read.items.at(-1).text, 'late answer');
  append(busy, [...Array.from({ length: 200 }, (_, i) => tool(100 + i, 50000)).flat(), user('latest question'), reply('latest answer')]);
  read = reader.read(busy);
  assert.equal(read.more, false, 'a 10 MB backlog does not replay a window per poll');
  assert.equal(read.items.at(-1).text, 'latest answer', 'the newest reply shows at once');
  assert(read.partial && read.items[0].text !== 'early question 0' && read.items.some(e => e.text === 'latest question'), 'it starts again at the tail and says earlier messages exist');
  const old = new TailReader({ parse: events }); old.read(busy); append(busy, Array.from({ length: 4 }, (_, i) => tool(400 + i, 500000)).flat());
  assert.equal(old.read(busy).more, true, 'readers without the preset keep their one-window steps');
  console.log('PASS a chat reader catches up a backlog in one read, or jumps to the tail when it is far behind');

  // F76: a message with many pictures is larger than 4 MB.
  const pics = write('pics', [user('d question'), reply('d answer')]);
  const live = new TailReader({ parse: events, ...CHAT_READ }); live.read(pics);
  append(pics, [picture('Here are many screenshots', 4.5e6), reply('I see it.')]);
  for (let i = 0; i < 4 && live.read(pics).more; i++);
  assert.deepEqual(texts(live.read(pics).items).slice(-2), ['Here are many screenshots', 'I see it.'], 'a 4.5 MB message is shown, not dropped');
  const small = new TailReader({ parse: events, ...CHAT_READ, maxRecord: 64 * 1024, chunk: 4096 }), cut = write('cut', [user('before')]); small.read(cut);
  append(cut, [picture('too big', 200000), user('after')]);
  const shown = small.read(cut).items;
  assert.deepEqual(shown.map(e => e.t), ['user', 'note', 'user'], 'a record over the cap leaves a note in its place');
  assert.match(shown[1].text, /too large/);
  const big = write('big', [user('a'), picture('five megabytes in small chunks', 5e6), reply('b')]);
  assert.deepEqual(texts(new TailReader({ parse: events, ...CHAT_READ, chunk: 4096 }).read(big).items), ['a', 'five megabytes in small chunks', 'b']);
  console.log('PASS records up to 32 MB are read, larger ones leave a note, and a record split over many chunks is joined once');

  // F116: continued elsewhere, then resumed in place; F118: /resume points at a conversation that already existed.
  const nextFile = write('res-new', [user('Continuation message'), reply('Continuation reply')]);
  const oldFile = write('res-old', [user('Old first message'), reply('Old first reply'), { type: 'continued-in', timestamp: new Date().toISOString(), continuedInSessionId: 'res-new' }]);
  assert.equal(continuation(oldFile).file, nextFile, 'a hand-off is followed');
  append(oldFile, [tool(1, 10)[1], user('<command-name>/model</command-name>'), { ...user('a note'), isMeta: true }]);
  assert.equal(continuation(oldFile).file, nextFile, 'tool results, command output and meta records do not undo the hand-off');
  append(oldFile, [user('Newest prompt, resumed in place'), reply('Newest reply')]);
  assert.equal(continuation(oldFile).file, oldFile, 'a later prompt from the owner makes it its own conversation again');
  assert.equal(new TailReader({ parse: () => [], window: 64 * 1024 }).chain(oldFile).file, oldFile, 'the same after a restart');
  const picked = write('ub', [user('Beta question'), reply('Beta answer')]);
  const resumed = write('ua', [user('Alpha question'), reply('Alpha answer'), { type: 'continued-in', timestamp: new Date(Date.now() + 5 * 60e3).toISOString(), continuedInSessionId: 'ub' }]);
  assert.equal(continuation(resumed).file, resumed, 'a pointer to a file that existed minutes before it is /resume, not a hand-off');
  const handed = write('hand', [user('Before hand-off'), { type: 'continued-in', timestamp: new Date().toISOString(), continuedInSessionId: 'ub' }]);
  assert.equal(continuation(handed).file, picked, 'a target created within a minute of the pointer is followed');
  console.log('PASS a resumed-in-place conversation and a /resume target stay separate conversations; hand-offs are still followed');

  // Client: public/onechat.js, public/redesign.js and public/redesign-round2.js in a vm with stub DOM.
  const node = () => ({ dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} }, children: [], addEventListener() {}, after() {}, remove() {}, append() {},
    setAttribute() {}, querySelector: () => null, getBoundingClientRect: () => ({ top: 0, bottom: 0 }), scrollHeight: 1000, scrollTop: 0, clientHeight: 500, textContent: '', innerHTML: '' });
  const els = new Map(), $ = sel => { if (!els.has(sel)) els.set(sel, node()); return els.get(sel); };
  const posts = [], calls = [];
  const ctx = vm.createContext({ console, URL, $, $$: () => [], document: { addEventListener() {}, createElement: node, hidden: false }, setInterval: () => 0, crypto: { randomUUID: () => 'id' },
    state: { sel: 'claude:a', byKey: new Map(), terms: [], view: 'focus', tab: 'chat', sessions: [] }, apsis: { away: new Map() }, keyOf: s => s.kind + ':' + s.id, esc: s => String(s ?? ''),
    clockTime: () => '', agentName: () => 'Claude', selTerm: () => null, buildBlocks: ev => ev.map(e => ({ ...e })), NexusDesign: { dedupeUsers: e => e }, blockHTML: b => `<div>${b.text}</div>`,
    md: s => s, renderSteer() {}, applyTab() {}, renderHead() {}, setView() {}, nxLiveBar: () => '', statusLabel: () => ['done', 'Done'], updateHTML: (el, html) => { el._html = html; },
    rememberViewed: s => calls.push(['viewed', s && s.id]), NexusVoice: { navigation() {} }, hideTerms() {}, renderApsis() {}, savePlace() {}, toast: (...a) => calls.push(['toast', ...a]),
    postNexus: async (url, body) => { posts.push(body); return { result: { term: 'T1' } }; }, runAction: (a, s) => calls.push([a, s.id]), openInApp: async () => true });
  for (const f of ['onechat.js', 'redesign.js', 'redesign-round2.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'), ctx, { filename: f });
  const realLoadChat = ctx.loadChat;
  const ev = (n, extra) => ({ t: n % 2 ? 'ai' : 'user', text: 'm' + n, ts: new Date(Date.parse('2026-11-10T00:00:00Z') + n * 1000).toISOString(), ...extra });
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => ev(a + i));

  // F71: the transcript window starts after the chat's first event; earlier events must never land below newer ones.
  assert.deepEqual(plain(ctx.nxBefore(range(137, 600), range(30, 600))), [], 'nothing from a later window is put before or after the chat');
  assert.deepEqual(plain([...ctx.nxBefore(range(0, 400), range(300, 600)), ...range(300, 600)]).map(e => e.text), range(0, 600).map(e => e.text), 'earlier events go above, in order, once');
  assert.equal(ctx.nxBefore(range(0, 50), range(100, 120).map(e => ({ ...e, id: 'other-file' }))).length, 50, 'without a shared event, earlier ones are placed by time');
  // F78/F164: after Load earlier the server keeps sending only its newest 600; nothing between may vanish.
  const sliding = { earlier: { bytes: 12e6, limit: 2400, truncated: true }, events: range(0, 900) };
  for (let start = 300; start <= 1400; start += 100) sliding.events = ctx.nxWithEarlier(sliding, range(start, start + 600));
  assert.deepEqual(plain(sliding.events).map(e => e.text), range(0, 2000).map(e => e.text), 'a window that slides poll by poll leaves no hole');
  const fresh = range(1900, 2000); fresh[50] = { ...fresh[50], subagents: [{ id: 'a1', state: 'done' }] };
  sliding.events = ctx.nxWithEarlier(sliding, fresh);
  assert.equal(sliding.events.find(e => e.text === 'm1950').subagents[0].state, 'done', 'the window\'s fresh copy wins over the one kept from the click');
  sliding.events = ctx.nxWithEarlier(sliding, range(5000, 5600));
  assert.equal(sliding.earlier, null, 'a window that no longer touches what is shown resets Load earlier');
  assert.deepEqual(plain(sliding.events).map(e => e.text), range(5000, 5600).map(e => e.text), 'instead of joining across a silent hole');

  // F75: each click asks further back and the button stays while the answer says there is more.
  const chat = ctx.chatFor('claude:a'); chat.events = range(1000, 1600); chat.truncated = true; chat.loaded = true;
  const asked = [], answer = range(0, 1600);
  ctx.api = async url => { asked.push(new URL(url, 'http://x').searchParams); return { events: answer, truncated: true }; };
  const render = ctx.renderReadableChat; ctx.renderReadableChat = () => {};
  assert.equal(ctx.nxEarlierState(chat), 'more');
  for (let i = 0; i < 4; i++) await ctx.nxEarlier();
  assert.deepEqual(asked.map(p => [+p.get('bytes'), +p.get('limit')]), [[12e6, 2400], [48e6, 4800], [64e6, 9600], [64e6, 10000]]);
  assert.equal(chat.events[0].text, 'm0', 'the earlier part is above the chat');
  assert.equal(new Set(chat.events.map(e => e.text)).size, chat.events.length, 'and nothing is doubled');
  assert.equal(ctx.nxEarlierState(chat), 'cut', 'at the most NEXUS reads, the chat says older messages are not shown');
  chat.earlier = { bytes: 12e6, limit: 2400, truncated: false };
  assert.equal(ctx.nxEarlierState(chat), '', 'the button goes only when the start was reached');
  console.log('PASS Load earlier keeps earlier messages above the newest, grows each click, never leaves a silent hole');

  // A background task still active from before the window comes as a stand-in at the window's top, stamped with its
  // start; the longer read has the real step. Nothing between the start and the window may vanish.
  {
    const at = n => ev(n).ts, all = [...range(0, 10), { t: 'user', text: 'Start the dev server in the background.', ts: at(10) },
      { t: 'tool', id: 'toolu_bg1', name: 'Bash', text: 'npm run dev', ts: at(11), subagents: [{ id: 'bg', state: 'running' }] },
      { t: 'result', id: 'toolu_bg1', text: 'Command running in background with ID: bgabc', ts: at(12) }, ...range(13, 900)];
    const stand = { t: 'tool', id: 'toolu_bg1', ts: at(11), name: 'Bash', text: 'Earlier delegation; still active in the recorded activity.', earlierDelegation: true, subagents: [{ id: 'bg', state: 'running', steps: 3 }] };
    const texts = list => plain(list).map(e => e.text), stands = () => chat.events.filter(e => e.earlierDelegation).length;
    Object.assign(chat, { events: [stand, ...all.slice(-600)], earlier: null, truncated: true });
    ctx.api = async () => ({ events: all, truncated: false });
    await ctx.nxEarlier();
    assert.deepEqual(texts(chat.events), texts(all), 'Load earlier keeps every event from the task start up to the window');
    assert.equal(stands(), 0, 'the stand-in goes once the real step is shown');
    assert.equal(chat.events.find(e => e.t === 'tool' && e.id === 'toolu_bg1').subagents[0].steps, 3, 'and the real step takes its fresh rows');
    chat.events = ctx.nxWithEarlier(chat, [stand, ...all.slice(-600)]);
    assert.deepEqual(texts(chat.events), texts(all), 'the next poll keeps them');
    assert.equal(stands(), 0);
    // A read that does not reach the start keeps the stand-in once, above everything loaded.
    Object.assign(chat, { events: [stand, ...all.slice(-600)], earlier: null });
    ctx.api = async () => ({ events: [stand, ...all.slice(-700)], truncated: true });
    await ctx.nxEarlier();
    assert.equal(chat.events[0].earlierDelegation, true); assert.equal(stands(), 1);
    assert.deepEqual(texts(chat.events.slice(1)), texts(all.slice(-700)), 'the loaded part has no gap');
    chat.events = ctx.nxWithEarlier(chat, [stand, ...all.slice(-590)]);
    assert.deepEqual(texts(chat.events.slice(1)), texts(all.slice(-700)));
    // The window's stand-in alone does not count as touching what is shown.
    chat.events = ctx.nxWithEarlier(chat, [stand, ...range(5000, 5600)]);
    assert.equal(chat.earlier, null, 'a jumped window with only the stand-in in common resets Load earlier');
    // A task that finished leaves no stand-in behind from an earlier poll.
    Object.assign(chat, { events: [stand, ...all.slice(-700)], earlier: { bytes: 12e6, limit: 2400, truncated: true } });
    chat.events = ctx.nxWithEarlier(chat, all.slice(-600));
    assert.equal(stands(), 0, 'no "still active" step from a poll before it finished');
  }
  console.log('PASS Load earlier keeps the messages after a still-active background task started, and draws the task once');

  // F162/F74 client, F154: an empty view keeps its way to the conversation; a fork says where its history is.
  Object.assign(ctx, { renderReadableChat: render, loadChat() {}, nxSummary: () => '', nxDetails() {}, renderSteer() {} });
  ctx.state.byKey.set('claude:a', { kind: 'claude', id: 'a', title: 'Alpha' });
  Object.assign(chat, { events: [], earlier: null, truncated: true, loaded: true, pending: [] });
  ctx.renderReadableChat();
  assert.match($('#chatMessages')._html, /data-nx-earlier/, 'a tail with nothing to draw keeps Load earlier');
  assert.doesNotMatch($('#chatMessages')._html, /Your messages will appear here/, 'and does not call the conversation empty');
  ctx.state.sel = 'term:F'; ctx.chatFor('term:F').loaded = true; vm.runInContext('nxForks', ctx).set('term:F', 'claude:a');
  ctx.renderReadableChat();
  assert.match($('#chatMessages')._html, /Forked from “Alpha”/, 'a new fork says its history comes with the first message');
  // F166: the divider is measured to the visit's start and the next visit takes a new checkpoint.
  ctx.state.sel = 'claude:a'; Object.assign(chat, { events: [ev(1, { ts: '2026-11-10T10:05:00Z' })], truncated: false });
  vm.runInContext('Date.now = () => globalThis.__now', ctx); ctx.__now = Date.parse('2026-11-10T10:36:30Z');
  ctx.apsis.away.set('claude:a', { since: Date.parse('2026-11-10T10:00:00Z') });
  ctx.renderReadableChat(); const first = $('#chatMessages')._html;
  ctx.__now += 61000; ctx.renderReadableChat();
  assert.match(first, /You were away for 36 minutes/);
  assert.equal($('#chatMessages')._html, first, 'the divider does not tick while they read (no false New messages)');
  ctx.state.sel = 'term:F'; ctx.renderReadableChat();
  assert.equal(ctx.apsis.away.has('claude:a'), false, 'leaving a session forgets its checkpoint');
  ctx.state.view = 'focus'; ctx.state.sel = 'claude:a'; ctx.apsis.away.set('claude:a', { since: 1 });
  vm.runInContext('nxRound2View', ctx)('overview');
  assert.equal(ctx.apsis.away.has('claude:a'), false, 'so does going Home');
  console.log('PASS an empty tail keeps Load earlier, a fork says where its history is, the away divider is per visit and still');

  // F146: Send on a Claude session open in another terminal does not start a second copy.
  ctx.state.byKey.set('claude:w', { kind: 'claude', id: 'w', live: true, pid: 4242, status: 'idle' });
  await assert.rejects(ctx.ensureChatTerminal('claude:w'), e => e.elsewhere && /another terminal \(pid 4242\)/.test(e.message));
  assert.equal(posts.length, 0, 'no term-resume was posted');
  ctx.state.byKey.set('claude:s', { kind: 'claude', id: 's', live: false });
  await ctx.ensureChatTerminal('claude:s');
  assert.deepEqual(plain(posts), [{ action: 'term-resume', key: 'claude:s' }], 'a saved session still resumes on Send');
  // F146: the deliberate "Open here" (open it anyway) says so, since the server refuses a second copy by default.
  const actions = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), between = (from, to) => actions.slice(actions.indexOf(from), actions.indexOf(to, actions.indexOf(from)));
  { const card = {}, opened = [], run = vm.createContext({ keyOf: s => s.kind + ':' + s.id, esc: s => String(s ?? ''), modal() {}, closeModal() {}, $: sel => sel === '#modalCard' ? card : null, openInApp: async (...a) => opened.push(a), innerWidth: 1200 });
    vm.runInContext(between('async function runAction(a, s) {', '// ---------------- focus: feed'), run);
    await run.runAction('resume', { kind: 'claude', id: 'w', live: true, pid: 4242, title: 'Elsewhere' });
    await card.onclick({ target: { closest: () => ({ dataset: { m: 'anyway' } }) } });
    assert.deepEqual(plain(opened), [['term-resume', { key: 'claude:w', force: true }, 'Opened in NEXUS']]); }
  console.log('PASS Send refuses to start a second copy of a session open in another terminal; Open here still opens it');

  // F82, F102: a long message is matched by its clipped record (Claude 40,000, Codex and Copilot 12,000, each with '…'
  // and a whole emoji), so it is not called "Not delivered" 45 s later. Copilot's record is the one copilot.events makes.
  const long = 'Fix the parser. ' + 'x'.repeat(39980) + '😀 and the rest', matches = (recorded, sent) => ctx.messageMatches({ t: 'user', text: recorded }, sent);
  assert(matches(long.slice(0, 39996) + '…', long), 'Claude\'s clip stops before half an emoji');
  assert(matches(long.slice(0, 12000) + '…', long), 'Codex\'s clip');
  const copilot = s => require('../copilot').events({ type: 'user.message', data: { content: s } })[0].text, split = 'a'.repeat(11999) + '😀 and the rest';
  assert(matches(copilot(long), long), 'Copilot\'s clip, as copilot.events records it');
  assert(copilot(split).endsWith('a…') && matches(copilot(split), split), 'Copilot\'s clip stops before half an emoji');
  assert(!matches('wait…', 'wait… and then more'), 'a short record ending in an ellipsis is its own message');
  assert(!matches(('y' + long).slice(0, 12000) + '…', long), 'another long message is not this one');
  { const k = 'codex:long', c = ctx.chatFor(k), sent = long.slice(0, 13000), at = Date.now() - 60000;
    c.pending = [{ id: 'm1', text: sent, status: 'pending', at, submittedAt: at, previousMatches: 0, previousRecords: [] }];
    ctx.api = async () => ({ events: [{ t: 'user', text: sent.slice(0, 12000) + '…', ts: new Date(at + 2000).toISOString() }], terminal: { id: 'T9', ready: true, input: true } });
    await realLoadChat(k, true);
    assert.equal(c.pending[0].status, 'confirmed', 'a 13,000-character message sent to Codex is delivered'); }
  console.log('PASS long messages match their clipped records for every agent');

  // A '!' line sent from the composer is recorded as the shell command Claude Code ran: that record is its receipt,
  // so the bubble does not turn "Not delivered" beside the 'Ran !ls' row and offer a Retry that runs it again.
  { const k = 'claude:bang', c = ctx.chatFor(k), at = Date.now() - 60000, ts = d => new Date(at + d).toISOString();
    c.pending = [{ id: 'b1', text: '!ls', status: 'pending', at, submittedAt: at, previousMatches: 0, previousRecords: [] }];
    ctx.api = async () => ({ events: [{ t: 'user', text: 'hello', ts: ts(-9000) }, { t: 'ai', text: 'hi', ts: ts(-8000) }, { t: 'cmd', id: 'u3', text: '!ls', ts: ts(1000) }, { t: 'cmd-output', id: 'u4', text: 'a.txt', ts: ts(1500) }], terminal: { id: 'T8', ready: true, input: true } });
    await realLoadChat(k, true);
    assert.equal(c.pending[0].status, 'confirmed', 'the shell command record confirms the message');
    assert(!ctx.messageMatches({ t: 'cmd', text: '!ls' }, 'ls'), 'a message without the ! is not that command');
    assert(!ctx.messageMatches({ t: 'cmd', text: '/compact' }, '/compact'), 'a slash command record is not a typed message'); }
  console.log('PASS a ! shell command sent from NEXUS is delivered by its command record');

  // F133: the uploads path that carried a picture is not drawn as text next to the picture.
  Object.assign(ctx.state, { sel: 'claude:p', view: 'focus' }); ctx.state.byKey.set('claude:p', { kind: 'claude', id: 'p', title: 'Pictures' });
  const pc = ctx.chatFor('claude:p'), up = String.raw`C:\Users\fixture\AppData\Local\NexusDeck\uploads\2026-11-11\Pasted image 2026-11-11 004002.png`;
  Object.assign(pc, { loaded: true, pending: [], events: [{ t: 'user', ts: '2026-11-11T09:00:00Z', images: ['a1.png'], text: 'Look at this\n' + up }, { t: 'user', ts: '2026-11-11T09:01:00Z', images: ['a2.jpg'], text: String.raw`I am looking at this through my glasses: C:\Users\fixture\AppData\Local\NexusDeck\uploads\2026-11-11\photo.jpg` }, { t: 'user', ts: '2026-11-11T09:02:00Z', images: ['a3.png'], text: String.raw`Compare C:\repo\docs\shot.png with @"` + up + '"' }] });
  ctx.renderReadableChat(); const drawn = $('#chatMessages')._html;
  assert.doesNotMatch(drawn, /uploads/, 'no uploads path is drawn beside its picture');
  assert.match(drawn, /<div>Look at this<\/div>/); assert.match(drawn, /<div>I am looking at this through my glasses:<\/div>/);
  assert.match(drawn, /Compare C:\\repo\\docs\\shot\.png with/, 'a path they typed themselves stays');
  console.log('PASS a picture sent by its uploads path shows as the picture, without the path');

  // F102: a bubble from the server queue retries under a new id (the server ignores one it has handled) and its old
  // bubble does not come back; a retry the chat already replaced is not drawn.
  pc.pending = [{ id: 'gone', text: 'Hidden retry', status: 'retried', server: true, at: Date.parse('2026-11-11T09:03:00Z') }, { id: 'new', text: 'Shown retry', status: 'pending', at: Date.parse('2026-11-11T09:03:01Z') }];
  ctx.renderReadableChat(); assert.match($('#chatMessages')._html, /Shown retry/); assert.doesNotMatch($('#chatMessages')._html, /Hidden retry/);
  // F150: a session live in another process does not read "Session ended" from an earlier NEXUS terminal.
  ctx.state.byKey.set('claude:p', { kind: 'claude', id: 'p', title: 'Pictures', live: true, pid: 4321 }); Object.assign(pc, { pending: [], terminal: null, ended: true });
  ctx.renderReadableChat(); assert.doesNotMatch($('#chatConnection')._html, /Session ended/, 'live elsewhere is not ended');
  Object.assign(pc, { ended: true, closedPid: 4321 }); ctx.renderReadableChat();
  assert.match($('#chatConnection')._html, /Session ended/, 'the process of a terminal just closed here, still listed for a poll, does not undo the close');
  console.log('PASS a replaced retry is not drawn; a session live elsewhere is not shown as ended');

  // F143: a failed attachment says why Send does nothing, in the toast and in the button's title.
  ctx.attachments = { blocked: () => true, failed: () => true, clear() {}, expand: (k, t) => String(t ?? ''), contract: (k, t) => t }; calls.length = 0;
  const refused = await ctx.sendChat(null, undefined, undefined, 'claude:p'); assert.deepEqual(refused && plain(refused), { ok: false, message: { error: 'Remove the attachment that failed, then send.' } });
  assert.deepEqual(calls, [['toast', 'Message not sent', 'Remove the attachment that failed, then send.', 'bad']]);
  ctx.attachments.failed = () => false; calls.length = 0;
  assert.equal(await ctx.sendChat(null, undefined, undefined, 'claude:p'), undefined); assert.deepEqual(calls, [], 'an upload in progress just waits');
  ctx.attachments.failed = () => true; $('#steerIn').value = 'Hello'; const sendButton = $('[data-steer="send"]');
  ctx.nxComposerState(); assert.equal(sendButton.title, 'Remove the attachment that failed, then send.', 'the title matches voice.js from the first frame');
  console.log('PASS Send with a failed attachment says to remove it, instead of ignoring Enter');

  await queueChecks();
  await followChecks();
} finally { fs.rmSync(temp, { recursive: true, force: true }); } })().catch(error => { console.error(error); process.exit(1); });

// The real chat, queue and command code with a fake clock and a stand-in server that takes each Send into its queue.
function queueClient() {
  let clock = Date.parse('2026-11-10T12:00:00Z'), data = null; const posts = [], RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  const host = { dataset: {}, querySelectorAll: () => [], querySelector: () => null, replaceChildren() {}, after() {}, remove() {}, setAttribute() {} };
  const ctx = { console, Map, Set, JSON, Promise, Error, Object, Array, String, Number, Boolean, RegExp, Math, Symbol, Date: FakeDate, crypto: require('node:crypto').webcrypto, setInterval() {}, setTimeout, clearTimeout,
    document: { addEventListener() {}, hidden: false, activeElement: null, createElement: () => host, body: { append() {} } }, matchMedia: () => ({ matches: true }),
    state: { byKey: new Map(), sel: 'other', terms: [], view: 'focus', tab: 'chat' }, keyOf: s => s.kind + ':' + s.id, $: sel => ['#nxQueue', '#chatConnection'].includes(sel) ? host : null,
    steerDrafts: new Map(), attachments: { blocked: () => false, failed: () => false, clear() {}, expand: (k, t) => String(t ?? ''), contract: (k, t) => t }, api: async () => JSON.parse(JSON.stringify(data)), toast() {}, slashUsed() {}, slashClose() {}, slashUI: {},
    statusLabel: () => ['idle'], agentName: () => 'Claude', esc: s => String(s), updateHTML() {}, renderReadableChat() {}, refresh: async () => {}, termViews: new Map(), shownTerm: null, act: async () => true,
    postNexus: async (url, body) => { posts.push(body); if (body.action !== 'term-send') return { result: data.queue };
      data.queue.active = { id: body.commandId, text: body.text, status: 'pending', submittedAt: clock }; return { result: { serverQueue: true, queued: false, queue: data.queue, submittedAt: clock } }; } };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['public/slash-core.js', 'public/onechat.js', 'public/message-queue.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  const chatFor = vm.runInContext('chatFor', ctx), loadChat = vm.runInContext('loadChat', ctx);
  return { ctx, posts, set data(v) { data = v; }, get data() { return data; }, get now() { return clock; }, tick(ms) { clock += ms; }, chatFor, async load(key) { await loadChat(key, true); return chatFor(key); },
    view: key => [...chatFor(key).pending].map(p => [p.id, p.status]), composer: key => ctx.steerDrafts.get(key) || '' };
}
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), appSlice = (from, to) => appSource.slice(appSource.indexOf(from), appSource.indexOf(to, appSource.indexOf(from)));
async function queueChecks() {
  const K = 'claude:a', iso = ms => new Date(ms).toISOString();
  // F102: Retry on a pushed message that never showed sends it under a new id; the old bubble does not come back.
  for (const busy of [false, true]) {
    const h = queueClient(), t0 = h.now, queue = { items: [], history: [{ id: 'p1', text: 'Dropped by an interrupt', status: 'pushed', at: t0, submittedAt: t0, finishedAt: t0 }], active: null, hold: '', hosted: true };
    h.ctx.state.byKey.set(K, { kind: 'claude', id: 'a' }); h.ctx.state.terms = [{ id: 't1', sessionKey: K }];
    h.data = { events: [{ t: 'user', text: 'Build it', ts: iso(t0 - 60000) }], terminal: { id: 't1', busy: false, ready: true, input: true }, queue };
    await h.load(K); h.tick(46000); await h.load(K);
    assert.deepEqual(h.view(K), [['p1', 'failed']]); assert.equal(h.composer(K), 'Dropped by an interrupt');
    if (busy) { h.data.terminal.busy = true; await h.load(K); }
    const sent = await h.ctx.sendChat('p1', undefined, undefined, K), post = h.posts.find(p => ['term-send', 'queue-add'].includes(p.action)), id = post?.commandId || post?.id;
    assert(post && post.text === 'Dropped by an interrupt' && id && id !== 'p1', (busy ? 'queued' : 'sent') + ' again under a new id, which the server does not ignore');
    assert.equal(sent.ok, true); assert.equal(h.composer(K), '', 'the composer the failure refilled is cleared');
    if (busy) { assert.deepEqual(h.view(K), [['p1', 'retried']], 'the queued retry is its queue row, the old bubble is gone'); continue; }
    await h.load(K); h.tick(46000); await h.load(K);
    assert.deepEqual(h.view(K), [['p1', 'retried'], [id, 'pending']], 'the old bubble stays replaced while the server delivers the new one');
    h.data.events.push({ t: 'user', text: 'Dropped by an interrupt', ts: iso(h.now) }); h.data.queue.history.push({ ...h.data.queue.active, status: 'confirmed', received: true, finishedAt: h.now }); h.data.queue.active = null;
    await h.load(K); assert.deepEqual(h.view(K), [['p1', 'retried'], [id, 'confirmed']]);
  }
  // F101/F102: when the terminal ends, the server decides about its active message; the chat does not also refill the composer.
  { const h = queueClient(), t0 = h.now, TK = 'claude:b', active = { id: 'a1', text: 'Fix the build', status: 'pending', submittedAt: t0, sawBusy: true };
    h.ctx.state.byKey.set(TK, { kind: 'claude', id: 'b' });
    h.data = { events: [], terminal: { id: 't2', exited: { at: t0 } }, queue: { items: [], history: [], active, hold: '', hosted: false } };
    await h.load(TK); assert.deepEqual(h.view(TK), [['a1', 'pending']], 'an ended terminal does not fail the active message of the server in the chat'); assert.equal(h.composer(TK), '');
    h.data.queue = { items: [{ ...active, status: 'failed', error: 'Delivery was not confirmed. Check the conversation before retrying.' }], history: [], active: null, hold: 'x', hosted: false };
    await h.load(TK); assert.deepEqual(h.view(TK), [], 'its failure is the queue row with Retry'); assert.equal(h.composer(TK), '', 'so the text is in one place'); }
  { const h = queueClient(), t0 = h.now, CK = 'claude:c';
    h.ctx.state.byKey.set(CK, { kind: 'claude', id: 'c' });
    h.data = { events: [], terminal: { id: 't3', busy: true }, queue: { items: [], history: [{ id: 'p2', text: 'Also run the linter', status: 'pushed', at: t0, submittedAt: t0, finishedAt: t0 }], active: { id: 'a2', text: 'Fix the tests', status: 'pending', submittedAt: t0, sawBusy: true }, hold: '', hosted: true } };
    await h.load(CK); vm.runInContext(appSlice('async function closeTerm(t) {', 'new ResizeObserver('), h.ctx);
    await h.ctx.closeTerm({ id: 't3', sessionKey: CK, pid: 77 });
    assert.deepEqual(h.view(CK), [['a2', 'pending'], ['p2', 'failed']], 'Close fails what only the chat tracks, not the active message of the server');
    assert.equal(h.composer(CK), 'Also run the linter'); assert.equal(h.chatFor(CK).closedPid, 77); }
  console.log('PASS Retry of a server-queue bubble goes out under a new id; an ended terminal leaves the active message to the server');
}
// F151: the chat follows its terminal when the process moves to another conversation, and the terminal stops wearing
// the old conversation's title.
async function followChecks() {
  const client = () => {
    let data; const toasts = [], els = {}, el = () => ({ classList: { contains: () => false, toggle() {} }, dataset: {}, innerHTML: '' });
    const ctx = vm.createContext({ console, state: { sel: 'claude:old', prev: new Map(), ready: new Set(), sessions: [], byKey: new Map(), terms: [], view: 'focus', booted: true },
      deviceUI: {}, steerDrafts: new Map(), termDraftKeys: new Set(), termViews: new Map(), chats: new Map(), keyOf: s => s.kind + ':' + s.id, $: sel => els[sel] ||= el(),
      document: { body: { classList: { toggle() {}, contains: () => false } }, hidden: false }, pref: { get: (k, d) => d }, toast: (...a) => toasts.push(a), attachments: { move() {} },
      connectionLost() {}, connectionRestored() {}, render() {}, renderLimits() {}, renderTerms() {}, restorePlace() {}, select() {}, setView() {}, location: { reload() {} }, api: async () => JSON.parse(JSON.stringify(data)) });
    vm.runInContext(appSlice('// ---------------- data ----------------', 'function visible()'), ctx);
    return { ctx, toasts, async poll(sessions, terms) { data = { sessions, terms }; await ctx.refresh(); return ctx.state; } };
  };
  const row = (id, title, extra) => ({ kind: 'claude', id, title, status: 'idle', ...extra }), term = key => [{ id: 't1', kind: 'claude', sessionKey: key, title: 'Old plan', cwd: String.raw`C:\fixture\proj` }];
  const old = row('old', 'Old plan');
  { const c = client(); await c.poll([old], term('claude:old'));
    let s = await c.poll([old], term('claude:new'));
    assert.equal(s.sel, 'term:t1', 'after /clear the chat shows the terminal, not the conversation it left');
    assert.equal(s.terms[0].title, 'New conversation · proj', 'and the terminal is not titled after the old conversation');
    assert.deepEqual(c.toasts.map(t => t[0]), ['This terminal moved to another conversation']);
    s = await c.poll([old, row('new', 'Fresh start')], term('claude:new'));
    assert.equal(s.sel, 'claude:new', 'once listed, the new conversation is the chat'); assert.equal(s.terms[0].title, 'Fresh start'); assert.equal(c.toasts.length, 1); }
  { const c = client(); await c.poll([old, row('other', 'Other work')], term('claude:old'));
    const s = await c.poll([old, row('other', 'Other work')], term('claude:other'));
    assert.equal(s.sel, 'claude:other', '/resume of another conversation moves the chat to it'); assert.deepEqual(c.toasts, [['This terminal moved to another conversation', 'Other work']]); }
  { const c = client(); await c.poll([old], term('claude:old'));
    const s = await c.poll([row('new', 'Old plan', { aliases: ['claude:old'] })], term('claude:new'));
    assert.equal(s.sel, 'claude:old', 'Claude continuing the same conversation under a new id is no move'); assert.equal(c.toasts.length, 0); assert.equal(s.terms[0].title, 'Old plan'); }
  { const c = client(); c.ctx.state.sel = 'claude:x'; await c.poll([old, row('x', 'Elsewhere')], term('claude:old'));
    const s = await c.poll([old, row('x', 'Elsewhere')], term('claude:new'));
    assert.equal(s.sel, 'claude:x', 'a chat the terminal does not serve stays'); assert.equal(c.toasts.length, 0); assert.equal(s.terms[0].title, 'New conversation · proj'); }
  { const c = client(), cp = key => [{ id: 't2', kind: 'copilot', sessionKey: key, title: 'Old plan (fork)', cwd: String.raw`C:\fixture\proj` }], orig = { ...old, kind: 'copilot' };
    c.ctx.state.sel = 'copilot:old'; await c.poll([orig], cp('copilot:old'));
    const s = await c.poll([orig], cp('copilot:fork'));
    assert.equal(s.sel, 'copilot:old', 'a Copilot fork moves its terminal on purpose and selects the fork itself'); assert.equal(c.toasts.length, 0); assert.equal(s.terms[0].title, 'Old plan (fork)'); }
  console.log('PASS the chat follows its terminal to another conversation, and the terminal drops the old title');
}
