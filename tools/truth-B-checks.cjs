// What NEXUS lists and draws for a Codex session, and the lifecycle around it, must be what the rollout and
// the terminals recorded. Synthetic fixtures only: a read-only server on 4825, then a server on 4826 whose terminals,
// agent launches and neural voice are stubbed (this file is its -r preload), so nothing is ever started.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict'), zlib = require('zlib'), Module = require('module');

// ---------- preload mode (inside the 4826 server) ----------
if (process.env.TRUTH_B_PRELOAD === '1') {
  const root = path.resolve(process.env.TRUTH_B_ROOT || '');
  if (process.env.NEXUS_PORT !== '4826' || !root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep) || !path.basename(root).startsWith('nexus-truth-b-')) throw Error('Unsafe preload');
  const log = entry => fs.appendFileSync(path.join(root, 'stub-log.jsonl'), JSON.stringify(entry) + '\n');
  const wav = () => { const b = Buffer.alloc(48); b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(40, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(4, 40); return b; };
  const neural = { list: () => ({ voices: [] }), sample() { throw Error('No samples in the stub.'); }, async choose() { return {}; }, async warm() { }, startCall() { }, stopCall() { }, async close() { },
    async synthesize(text, lang, onChunk) { log({ type: 'say', length: text.length, text }); if (text.length > 700) throw Error('Neural voice is warming up or busy.'); await onChunk({ audio: wav().toString('base64'), mime: 'audio/wav' }); } };
  let pid = 900000;
  const load = Module._load;
  Module._load = function (name) {
    if (name === '@lydell/node-pty') return { spawn(file, args, options) {
      log({ type: 'spawn', file, args, cwd: options.cwd });
      if (!path.resolve(options.cwd).toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw Error('Fixture cwd required');
      let exit = () => {}, ended = false;
      const end = () => { if (!ended) { ended = true; setTimeout(() => exit({ exitCode: 0 }), 0); } };
      // A fresh Codex terminal writes its rollout; a codex exec run started elsewhere in that folder writes one too.
      if (file === 'stub-codex' && !args.includes('resume')) { const at = new Date().toISOString(); for (const [id, originator] of [['0b000000-0000-4000-8000-00000000a1a1', 'codex-tui'], ['0b000000-0000-4000-8000-00000000a2a2', 'codex_exec']]) writeRollout(path.join(process.env.NEXUS_CODEX_DIR, 'sessions', '2026', '11', '11'), id, [{ timestamp: at, type: 'session_meta', payload: { id, timestamp: at, cwd: options.cwd, originator, cli_version: '0.153.4', source: originator === 'codex_exec' ? 'exec' : 'cli' } }, { timestamp: at, type: 'event_msg', payload: { type: 'task_started' } }]); }
      if (args.some(a => /c1500000/.test(a))) setTimeout(end, 300);
      return { pid: ++pid, onData() { }, onExit(fn) { exit = fn; }, resize() { }, kill: end, write(value) { log({ type: 'write', value }); } };
    } };
    const m = load.apply(this, arguments);
    if (name === './agents' && !m.__truthStub) { const all = () => ({ claude: { installed: true }, codex: { installed: true }, copilot: { installed: true }, antigravity: { installed: false } });
      Object.assign(m, { __truthStub: true, launch: (kind, args = []) => ({ file: 'stub-' + kind, args }), publicStatus: all, refresh: all, detect: () => ({}) }); }
    if (name === './neural-tts') return { ...m, createNeuralTTS: () => neural };
    return m;
  };
  return;
}

// ---------- fixtures ----------
const ID = n => '0b000000-0000-4000-8000-' + String(n).padStart(12, '0');
function writeRollout(dir, id, rows, mtime) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-2026-11-10T10-00-00-' + id + '.jsonl');
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000);
  return file;
}
const iso = ms => new Date(ms).toISOString();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const IDS = { parent: ID(1), childA: ID(2), childB: ID(3), quota: ID(4), notice: ID(5), big: ID(6), tag: ID(7), ask: ID(8), legacy: ID(9), archive: ID(10), archiveBig: ID(11), dup: ID(12), out: ID(13), run: ID(14), upload: ID(15), bgfail: ID(16) };
const C = { live: 'c1150000-0000-4000-8000-000000000002', old: 'c1150000-0000-4000-8000-000000000001', chainOld: 'c1800000-0000-4000-8000-000000000001', chainNew: 'c1800000-0000-4000-8000-000000000002',
  linkA: 'c1530000-0000-4000-8000-000000000001', linkB: 'c1530000-0000-4000-8000-000000000002', overA: 'c1530000-0000-4000-8000-000000000003', overB: 'c1530000-0000-4000-8000-000000000004',
  sibling: 'c1480000-0000-4000-8000-000000000001', gone: 'c1480000-0000-4000-8000-000000000002', sub: 'c1480000-0000-4000-8000-000000000003', ended: 'c1500000-0000-4000-8000-000000000001',
  tinyA: 'c1210000-0000-4000-8000-000000000001', tinyB: 'c1210000-0000-4000-8000-000000000002', stale: 'c1230000-0000-4000-8000-000000000001', wide: 'c1740000-0000-4000-8000-000000000001',
  notes: 'c1580000-0000-4000-8000-000000000001', flow: 'c1590000-0000-4000-8000-000000000001' };

function fixtures(root) {
  const now = Date.now(), cwd = path.join(root, 'project'), codex = path.join(root, 'codex', 'sessions', '2026', '11', '10');
  fs.mkdirSync(cwd, { recursive: true });
  const meta = (id, at, extra = {}) => ({ timestamp: iso(at), type: 'session_meta', payload: { id, timestamp: iso(at), cwd, originator: 'codex_exec', cli_version: '0.153.4', source: 'exec', ...extra } });
  const item = (at, payload) => ({ timestamp: iso(at), type: 'response_item', payload });
  const ev = (at, type, extra = {}) => ({ timestamp: iso(at), type: 'event_msg', payload: { type, ...extra } });
  const user = (at, ...parts) => item(at, { type: 'message', role: 'user', content: parts.map(p => typeof p === 'string' ? { type: 'input_text', text: p } : p) });
  const ai = (at, text) => item(at, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  const t = s => now - s * 1000;
  // A parent still working, with two helper threads that finished (one forked from its history, one not).
  writeRollout(codex, IDS.parent, [meta(IDS.parent, t(300)), user(t(299), 'PARENT: build the parser'), ev(t(299), 'task_started'), ai(t(200), 'PARENT progress note'),
    item(t(100), { type: 'agent_message', author: '/root/alpha_task', recipient: '/root', content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/alpha_task\nPayload:\nCHILD-A report: tests fail in one case' }] })]);
  const fork = t(250), spawned = parent => ({ source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: '/root/alpha_task', agent_nickname: 'Hubble', agent_role: null } } }, parent_thread_id: parent, agent_nickname: 'Hubble', agent_path: '/root/alpha_task' });
  writeRollout(codex, IDS.childA, [meta(IDS.childA, fork, { ...spawned(IDS.parent), forked_from_id: IDS.parent, subagent_history_start_ordinal: 5 }), meta(IDS.parent, fork), user(fork, 'PARENT: build the parser'), ai(fork, 'PARENT progress note'), ev(fork, 'task_complete'),
    ev(t(249), 'thread_settings_applied'), ev(t(249), 'task_started'),
    item(t(248), { type: 'agent_message', author: '/root', recipient: '/root/alpha_task', content: [{ type: 'input_text', text: 'Message Type: NEW_TASK\nTask name: /root/alpha_task\nSender: /root\nPayload:\n' }, { type: 'encrypted_content', encrypted_content: 'x' }] }),
    item(t(247), { type: 'custom_tool_call', call_id: 'ca1', name: 'exec', input: 'text(await tools.exec_command({cmd:"npm test"}))' }),
    ev(t(246), 'item_completed', { item: { type: 'CommandExecution', id: 'x1', command: 'npm test', status: 'failed', exit_code: 1 } }),
    item(t(246), { type: 'custom_tool_call_output', call_id: 'ca1', output: [{ type: 'input_text', text: 'Script completed\nWall time 1.2 seconds\nOutput:\n' }, { type: 'input_text', text: '1 failing\n"quoted" line' }] }),
    ai(t(245), 'CHILD-A: one test fails'), ev(t(245), 'task_complete', { last_agent_message: 'CHILD-A: one test fails' })]);
  writeRollout(codex, IDS.childB, [meta(IDS.childB, t(240), { source: { subagent: { thread_spawn: { parent_thread_id: IDS.parent, depth: 1, agent_path: '/root/beta_task', agent_nickname: 'Kepler', agent_role: null } } } }), ev(t(240), 'task_started'),
    user(t(239), '<recommended_plugins>\n- a\n</recommended_plugins>', '<environment_context>\n<cwd>x</cwd>\n</environment_context>'),
    item(t(238), { type: 'agent_message', author: '/root', recipient: '/root/beta_task', content: [{ type: 'input_text', text: 'Message Type: NEW_TASK\nTask name: /root/beta_task\nSender: /root\nPayload:\n' }, { type: 'encrypted_content', encrypted_content: 'x' }] }),
    ai(t(230), 'CHILD-B: done'), ev(t(230), 'task_complete', { last_agent_message: 'CHILD-B: done' })]);
  // A turn that died on the usage limit.
  writeRollout(codex, IDS.quota, [meta(IDS.quota, t(120)), user(t(119), 'Refactor the module'), ev(t(119), 'task_started'),
    ev(t(118), 'task_complete', { last_agent_message: null, error: { message: "You've hit your usage limit. Try again later.", codex_error_info: 'usage_limit_exceeded' } })]);
  // An image prompt with the CLI's own notice, and a brief that opens with a Markdown heading.
  writeRollout(codex, IDS.notice, [meta(IDS.notice, t(110)), user(t(109), '<image name=[Image #1]>', { type: 'input_image', image_url: 'data:image/png;base64,' + PNG }, '</image>',
    'Codex could not read the local image at `-`: The system cannot find the file specified. (os error 2)', '# Brief: repair the login form\nThe form fails on submit.'), ai(t(100), 'Repaired.'), ev(t(100), 'task_complete')]);
  // A first prompt whose line ends past the 768 KB head (a large inline picture).
  writeRollout(codex, IDS.big, [meta(IDS.big, t(105)), user(t(104), 'Look at this picture and fix the layout', { type: 'input_image', image_url: 'data:image/png;base64,' + 'A'.repeat(900 * 1024) }), ai(t(100), 'Fixed the layout.'), ev(t(100), 'task_complete')]);
  // An interactive message that starts with pasted markup.
  writeRollout(codex, IDS.tag, [meta(IDS.tag, t(95), { originator: 'codex-tui', source: 'cli' }), user(t(94), '<button class="go">Go</button> does nothing when I click it'), ai(t(90), 'Fixed the handler.'), ev(t(90), 'task_complete')]);
  // A question Codex puts to the owner.
  writeRollout(codex, IDS.ask, [meta(IDS.ask, t(85)), user(t(84), 'Rename the command'), ev(t(84), 'task_started'),
    item(t(83), { type: 'function_call', call_id: 'q1', name: 'request_user_input_async', arguments: JSON.stringify({ questions: [{ title: 'Should the old command name keep working?' }] }) }),
    item(t(83), { type: 'function_call_output', call_id: 'q1', output: '{"accepted":true}' }), item(t(82), { type: 'function_call', call_id: 'q2', name: 'sleep', arguments: '{"seconds":60}' })]);
  // An older Codex that mirrors every message as event_msg and response_item.
  writeRollout(codex, IDS.legacy, [meta(IDS.legacy, t(80)), ev(t(79), 'user_message', { message: 'Legacy request' }), user(t(78), 'Legacy request'), ev(t(70), 'agent_message', { message: 'Legacy reply' }), ai(t(69), 'Legacy reply'), ev(t(69), 'task_complete')]);
  // Tool output as a list of parts, a screenshot among them, and a script that failed.
  writeRollout(codex, IDS.out, [meta(IDS.out, t(65)), user(t(64), 'Take a screenshot'), ev(t(64), 'task_started'),
    item(t(63), { type: 'custom_tool_call', call_id: 'o1', name: 'exec', input: 'await tools.view_image({path:"shot.png"})' }),
    item(t(62), { type: 'custom_tool_call_output', call_id: 'o1', output: [{ type: 'input_text', text: 'Screenshot taken, 1280x720' }, { type: 'input_image', image_url: 'data:image/png;base64,' + PNG }] }),
    item(t(61), { type: 'custom_tool_call', call_id: 'o2', name: 'exec', input: 'throw new Error("x")' }),
    item(t(60), { type: 'custom_tool_call_output', call_id: 'o2', output: [{ type: 'input_text', text: 'Script failed\nError: x' }] }), ai(t(59), 'Done.'), ev(t(59), 'task_complete')]);
  // A command left running by its step (yield_time_ms) fails later, while no step is open; the next step succeeds.
  writeRollout(codex, IDS.bgfail, [meta(IDS.bgfail, t(58)), user(t(57), 'Run the tests and read the readme'), ev(t(57), 'task_started'),
    item(t(56), { type: 'custom_tool_call', call_id: 'bA', name: 'exec', input: 'text(await tools.exec_command({cmd:"npm test",yield_time_ms:1000}))' }),
    item(t(55), { type: 'custom_tool_call_output', call_id: 'bA', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n{"running":true}' }] }),
    ev(t(54), 'item_completed', { item: { type: 'CommandExecution', id: 'xb1', command: 'npm test', status: 'failed', exit_code: 1 } }),
    item(t(53), { type: 'custom_tool_call', call_id: 'bB', name: 'exec', input: 'text(await tools.exec_command({cmd:"Get-Content README.md"}))' }),
    ev(t(52), 'item_completed', { item: { type: 'CommandExecution', id: 'xb2', command: 'Get-Content README.md', status: 'completed', exit_code: 0 } }),
    item(t(52), { type: 'custom_tool_call_output', call_id: 'bB', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n# readme' }] }), ai(t(51), 'Read it.'), ev(t(51), 'task_complete')]);
  // Archived by Codex (.jsonl.zst, 8 days old): a small one, a large one, and one whose plain copy still exists.
  const old = now - 8 * 864e5, zst = (id, rows) => { const plain = writeRollout(codex, id, rows); fs.writeFileSync(plain + '.zst', zlib.zstdCompressSync(fs.readFileSync(plain))); fs.utimesSync(plain + '.zst', old / 1000, old / 1000); return plain; };
  fs.rmSync(zst(IDS.archive, [meta(IDS.archive, old - 60e3), user(old - 59e3, 'Archived request'), ai(old - 50e3, 'Archived reply'), ev(old - 50e3, 'task_complete')]));
  const filler = Array.from({ length: 70 }, (_, i) => item(old - 40e3 + i * 10, { type: 'custom_tool_call_output', call_id: 'f' + i, output: 'x'.repeat(100 * 1024) + i }));
  fs.rmSync(zst(IDS.archiveBig, [meta(IDS.archiveBig, old - 60e3), user(old - 59e3, 'Big archived request'), ...filler, ai(old - 1e3, 'Big archived final'), ev(old - 1e3, 'task_complete')]));
  zst(IDS.dup, [meta(IDS.dup, t(40)), user(t(39), 'Duplicate request'), ai(t(38), 'Duplicate reply'), ev(t(38), 'task_complete')]);
  // A turn still running, for the terminal-close check.
  writeRollout(codex, IDS.run, [meta(IDS.run, t(90), { originator: 'codex-tui', source: 'cli' }), user(t(89), 'Keep working'), ev(t(89), 'task_started'), ai(t(30), 'Working on it')]);
  // A picture sent through NEXUS reaches Codex as its path in the text.
  const shot = path.join(root, 'uploads', '2026-11-11', 'Pasted image 1.png'); fs.mkdirSync(path.dirname(shot), { recursive: true }); fs.writeFileSync(shot, Buffer.from(PNG, 'base64'));
  writeRollout(codex, IDS.upload, [meta(IDS.upload, t(50), { originator: 'codex-tui', source: 'cli' }), user(t(49), 'What is wrong in this screenshot? ' + shot), ai(t(45), 'The button is cut off.'), ev(t(45), 'task_complete')]);

  // Claude: continuations and resume folders.
  const claude = path.join(root, 'claude'), folder = dir => path.join(claude, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
  const crow = (at, type, text, dir = cwd, extra = {}) => ({ type, cwd: dir, timestamp: iso(at), message: { role: type, ...(type === 'assistant' ? { model: 'claude-haiku-5-5' } : {}), content: type === 'assistant' ? [{ type: 'text', text }] : text }, ...extra });
  // Listing skips transcripts under 400 bytes; a record NEXUS ignores keeps small fixtures listed.
  const transcript = (dir, id, rows, mtime) => { const f = folder(dir); fs.mkdirSync(f, { recursive: true }); const file = path.join(f, id + '.jsonl'); fs.writeFileSync(file, [{ type: 'fixture-padding', pad: 'x'.repeat(400) }, ...rows].map(r => JSON.stringify(r)).join('\n') + '\n'); if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000); return file; };
  const contDir = path.join(root, 'cont'); fs.mkdirSync(contDir, { recursive: true });
  transcript(contDir, C.old, [crow(t(600), 'user', 'Start the long job', contDir), crow(t(590), 'assistant', 'Backgrounding after the current tool finishes', contDir), { type: 'continued-in', continuedInSessionId: C.live, timestamp: iso(t(589)) }], t(589));
  transcript(contDir, C.live, [crow(t(580), 'user', 'Continue the long job', contDir), crow(t(5), 'assistant', 'Still going', contDir)], t(5));
  fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'sessions', process.pid + '.json'), JSON.stringify({ pid: process.pid, sessionId: C.live, cwd: contDir, status: 'busy', startedAt: t(600), statusUpdatedAt: t(5) }));
  const chainDir = path.join(root, 'chain'); fs.mkdirSync(chainDir, { recursive: true });
  const pairs = (word, from) => Array.from({ length: 175 }, (_, i) => [crow(from + i * 2000, 'user', word + ' question ' + i, chainDir), crow(from + i * 2000 + 1000, 'assistant', word + ' answer ' + i, chainDir)]).flat();
  // Claude Code opens a continued file with a copy of the old file's last records: same uuid, time and text.
  const oldPairs = pairs('old', t(3000)).map((r, i) => ({ ...r, uuid: 'chain-' + i }));
  transcript(chainDir, C.chainOld, [...oldPairs, { type: 'continued-in', continuedInSessionId: C.chainNew, timestamp: iso(t(2000)) }], t(2000));
  transcript(chainDir, C.chainNew, [...oldPairs.slice(-4), ...pairs('new', t(1500))], t(1000));
  const linkDir = path.join(root, 'link'); fs.mkdirSync(linkDir, { recursive: true });
  transcript(linkDir, C.linkA, [crow(now - 20 * 864e5, 'user', 'A before the link', linkDir), { type: 'continued-in', continuedInSessionId: C.linkB, timestamp: iso(now - 20 * 864e5 + 1000) }, crow(now - 10 * 864e5, 'user', 'A after the link', linkDir)], now - 10 * 864e5);
  transcript(linkDir, C.linkB, [crow(now - 19 * 864e5, 'user', 'B early', linkDir), crow(now - 9 * 864e5, 'user', 'B late', linkDir)], now - 9 * 864e5);
  // A true hand-off whose old file still records the tool that was running when it moved: the two files overlap in time.
  const overDir = path.join(root, 'over'); fs.mkdirSync(overDir, { recursive: true });
  const handed = [crow(t(700), 'user', 'Start the job', overDir, { uuid: 'over-1' }), crow(t(699), 'assistant', 'Moving the job to the background', overDir, { uuid: 'over-2' })];
  transcript(overDir, C.overA, [...handed, { type: 'continued-in', continuedInSessionId: C.overB, timestamp: iso(t(698)) }, crow(t(694), 'assistant', 'The running tool finished in the old file', overDir)], t(694));
  transcript(overDir, C.overB, [...handed, crow(t(696), 'user', 'Next step in the new file', overDir), crow(t(650), 'assistant', 'Done in the new file', overDir)], t(650));
  // A continuation too small to be listed itself, written to later by bookkeeping: its row comes from the old file.
  const tinyDir = path.join(root, 'tiny'); fs.mkdirSync(tinyDir);
  transcript(tinyDir, C.tinyA, [crow(t(600), 'user', 'Start in the old file', tinyDir), { type: 'continued-in', continuedInSessionId: C.tinyB, timestamp: iso(t(590)) }], t(590));
  const tinyB = path.join(folder(tinyDir), C.tinyB + '.jsonl'); fs.writeFileSync(tinyB, JSON.stringify(crow(t(300), 'user', 'Short', tinyDir)) + '\n' + JSON.stringify({ type: 'cost-state' }) + '\n'); fs.utimesSync(tinyB, t(10) / 1000, t(10) / 1000);
  // A registry file left from before the last boot, whose pid now belongs to a running process.
  const staleDir = path.join(root, 'stale'); fs.mkdirSync(staleDir);
  transcript(staleDir, C.stale, [crow(t(200), 'user', 'Work before the reboot', staleDir), crow(t(190), 'assistant', 'Done before the reboot', staleDir)]);
  fs.writeFileSync(path.join(claude, 'sessions', 'stale.json'), JSON.stringify({ pid: process.pid, sessionId: C.stale, cwd: staleDir, status: 'busy', startedAt: now - os.uptime() * 1000 - 864e5, statusUpdatedAt: t(190) }));
  const alpha = path.join(root, 'proj-alpha'), beta = path.join(root, 'proj-beta'), gone = path.join(root, 'proj-gone'), gamma = path.join(root, 'proj-gamma'), gammaSrc = path.join(gamma, 'src');
  fs.mkdirSync(alpha); fs.mkdirSync(beta); fs.mkdirSync(gammaSrc, { recursive: true });
  transcript(alpha, C.sibling, [crow(t(500), 'user', 'Work in alpha', alpha), crow(t(490), 'assistant', 'Done in alpha', alpha), { type: 'user', cwd: beta, timestamp: iso(t(480)), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ran in beta' }] } }]);
  transcript(gone, C.gone, [crow(t(470), 'user', 'Work in a removed worktree', gone), crow(t(460), 'assistant', 'Done there', gone)]);
  transcript(gamma, C.sub, [crow(t(450), 'user', 'Work in gamma', gamma), crow(t(440), 'assistant', 'Moved into src', gammaSrc)]);
  // The owner's request sits before a tool output larger than a chat's first window.
  const wideDir = path.join(root, 'wide'); fs.mkdirSync(wideDir);
  transcript(wideDir, C.wide, [crow(t(250), 'user', 'Request before a long output', wideDir), { type: 'assistant', cwd: wideDir, timestamp: iso(t(249)), message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: 'w1', name: 'Read', input: { file_path: 'big.log' } }] } },
    { type: 'user', cwd: wideDir, timestamp: iso(t(248)), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'x'.repeat(700 * 1024) }] } }, crow(t(247), 'assistant', 'Read the long output', wideDir)]);
  // Task notifications: one that arrived mid-turn (an attachment), and two events of one task that share a summary.
  const noteDir = path.join(root, 'notes'); fs.mkdirSync(noteDir);
  const told = (id, summary, extra) => '<task-notification>\n<task-id>' + id + '</task-id>\n' + extra + '\n<summary>' + summary + '</summary>\n</task-notification>';
  const toldUser = (at, text) => ({ type: 'user', cwd: noteDir, timestamp: iso(at), origin: { kind: 'task-notification' }, message: { role: 'user', content: text } });
  transcript(noteDir, C.notes, [crow(t(240), 'user', 'Run the tests in the background', noteDir),
    { type: 'attachment', cwd: noteDir, timestamp: iso(t(230)), attachment: { type: 'queued_command', commandMode: 'task-notification', origin: { kind: 'task-notification' }, timestamp: iso(t(230)), prompt: told('bt1', 'Background command "npm test" failed with exit code 1', '<status>failed</status>') } },
    crow(t(229), 'assistant', 'The tests failed; looking at why', noteDir), toldUser(t(220), told('mon1', 'Monitor "build log" event', '<event>build started</event>')), toldUser(t(219), told('mon1', 'Monitor "build log" event', '<event>build finished</event>'))]);
  const step = (at, content) => ({ type: 'assistant', cwd: noteDir, timestamp: iso(at), message: { role: 'assistant', model: 'claude-haiku-5-5', content } });
  transcript(noteDir, C.flow, [crow(t(210), 'user', 'Run the review workflow', noteDir), step(t(209), [{ type: 'tool_use', id: 'wf1', name: 'Workflow', input: { script: "export const meta = { name: 'review-loop', description: 'Review the change' };\nawait agent('Review it');" } },
    { type: 'tool_use', id: 'wf2', name: 'Workflow', input: { scriptPath: 'C:\\work\\flows\\nightly.js', resumeFromRunId: 'r7' } }])]);
  const endedDir = path.join(root, 'ended'); fs.mkdirSync(endedDir);
  transcript(endedDir, C.ended, [crow(t(400), 'user', 'Run elsewhere', endedDir), crow(t(3), 'assistant', 'Working elsewhere', endedDir)], t(3));
  fs.writeFileSync(path.join(claude, 'sessions', (process.pid + 1) + '.json'), JSON.stringify({ pid: process.pid, sessionId: C.ended, cwd: endedDir, status: 'busy', startedAt: t(400), statusUpdatedAt: t(3) }));

  // Copilot: a quota snapshot recorded weeks before the account started refusing with quota errors.
  const cp = path.join(root, 'copilot', 'session-state', 'c0f10000-0000-4000-8000-000000000001'); fs.mkdirSync(cp, { recursive: true });
  const crec = (at, type, data) => ({ id: 'e' + at, type, data, timestamp: iso(at) }), weeks = now - 35 * 864e5;
  fs.writeFileSync(path.join(cp, 'events.jsonl'), [crec(weeks, 'session.start', { sessionId: 'c0f10000-0000-4000-8000-000000000001', selectedModel: 'gpt-5-mini', context: { cwd } }), crec(weeks + 1000, 'user.message', { content: 'Old question' }),
    crec(weeks + 2000, 'model.model_call_success', { quotaSnapshots: { premium_interactions: { entitlementRequests: 1500, remainingPercentage: 100, usedRequests: 0, isUnlimitedEntitlement: false, resetDate: iso(now + 20 * 864e5) } }, copilotUsage: { total_nano_aiu: 0 } }),
    crec(weeks + 3000, 'assistant.turn_end', { turnId: 't1' }), crec(t(120), 'user.message', { content: 'New question' }), crec(t(119), 'session.error', { errorType: 'quota', message: 'You have exceeded your monthly quota.' })].map(r => JSON.stringify(r)).join('\n') + '\n');
  return { cwd, alpha, beta, gone, gammaSrc, tinyAt: t(300) };
}

// ---------- servers ----------
const { spawn } = require('child_process');
function start(root, port, extra) {
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: Number(port), recentDays: 40, sessionLabels: false, themeSorting: false }));
  const env = { ...process.env, NEXUS_PORT: port, NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_LABELS: 'off', NEXUS_ASR_DISABLED: '1', NEXUS_CLAUDE_DIR: path.join(root, 'claude'), NEXUS_CODEX_DIR: path.join(root, 'codex'), NEXUS_COPILOT_DIR: path.join(root, 'copilot'),
    NEXUS_STATE_FILE: path.join(root, 'state.json'), NEXUS_THEMES_FILE: path.join(root, 'themes.json'), NEXUS_CONFIG_FILE: path.join(root, 'config.json'), NEXUS_DEVICES_FILE: path.join(root, 'devices.json'), NEXUS_UPLOAD_DIR: path.join(root, 'uploads'), ...extra };
  const server = spawn(process.execPath, [...(extra.TRUTH_B_PRELOAD ? ['-r', __filename] : []), 'server.js'], { cwd: path.join(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; server.stderr.on('data', d => { errors += d; });
  const ready = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Server start timed out ' + errors)), 20000); server.stdout.on('data', d => { if (String(d).includes(':' + port + '/')) { clearTimeout(timer); resolve(); } }); server.once('exit', c => reject(Error('Server exited ' + c + ' ' + errors))); });
  const get = async p => (await fetch('http://127.0.0.1:' + port + p, { headers: { 'X-Nexus': '1' } })).json();
  const post = async (p, body, timeout = 15000) => { const r = await fetch('http://127.0.0.1:' + port + p, { method: 'POST', headers: { 'X-Nexus': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
  return { server, ready, get, post };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
async function group(fn, label) { try { await fn(); console.log('PASS ' + label); } catch (e) { failures++; console.log('FAIL ' + label + ': ' + (e.message || e)); } }
async function until(fn, label, ms = 15000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw Error('Timed out waiting for ' + label); await wait(250); } }

// ---------- pure modules ----------
async function modules(root) {
  await group(async () => {
    const { toolDetail } = require('../session-details');
    const patch = '*** Begin Patch\n*** Update File: C:\\work\\app.js\n@@\n-old\n+new\n*** End Patch';
    const wrapped = 'const r = await tools.apply_patch(' + JSON.stringify(patch) + ');\nawait tools.exec_command({ cmd: `npm test -- --grep \\`x\\``, yield_time_ms: 5 });\ntext(await tools.exec_command({cmd:"git status --short"}))';
    const d = toolDetail('exec', wrapped);
    assert.deepEqual(d.files.map(f => [f.path, f.add, f.del]), [['C:\\work\\app.js', 1, 1]], 'a Codex exec call that patches a file lists the file');
    assert.equal(d.command, 'npm test -- --grep `x`\ngit status --short', 'a Codex exec call lists the commands it ran');
    assert.equal(toolDetail('exec', 'console.log(1)'), undefined, 'a wrapper with no command or patch claims none');
  }, 'details: a Codex exec wrapper lists its patched files and its commands');
  await group(async () => {
    const { targets } = require('../session-recycle');
    const codex = path.join(root, 'codex'), zst = fs.readdirSync(path.join(codex, 'sessions', '2026', '11', '10')).find(f => f.includes(IDS.archive) && f.endsWith('.zst'));
    const archive = path.join(codex, 'sessions', '2026', '11', '10', zst), copy = path.join(root, 'copy', zst.slice(0, -4)); fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.writeFileSync(copy, '{}\n');
    const items = targets({ kind: 'codex', file: copy, archive }, { claude: path.join(root, 'claude'), codex: codex, copilot: path.join(root, 'copilot') });
    assert.deepEqual(items.map(i => i.path), [fs.realpathSync(archive)], 'deleting an archived Codex session recycles its archive, not NEXUS\'s copy');
  }, 'recycle: an archived Codex session is deleted through its compressed rollout');
}

// ---------- read-only server ----------
async function readOnly(root, dirs) {
  const { server, ready, get } = start(root, '4825', { NEXUS_READ_ONLY: '1' });
  try {
    await ready;
    const sessions = async () => (await get('/api/sessions')).sessions;
    let all = await sessions();
    const row = id => all.find(s => s.id === id), chat = async key => get('/api/chat?key=' + encodeURIComponent(key)), texts = (events, t) => events.filter(e => e.t === t).map(e => e.text);

    // F11: helper threads.
    await group(async () => {
      assert.equal(all.filter(s => s.kind === 'codex' && s.id === IDS.parent).length, 1, 'the parent is listed once');
      assert.equal(row(IDS.parent).status, 'busy', 'the parent stays working while its helpers have finished');
      assert.ok(row(IDS.childA) && row(IDS.childB), 'each helper thread has its own row');
      assert.equal(row(IDS.childA).title, 'Helper Hubble · alpha task'); assert.equal(row(IDS.childB).title, 'Helper Kepler · beta task');
      assert.equal(row(IDS.childA).firstPrompt, '', 'a helper is not titled with its parent\'s request');
      assert.equal(row(IDS.childA).helperOf, 'codex:' + IDS.parent);
      // Telemetry leaves out the copy too: a helper's card does not carry its parent's request as its own.
      const [helper, parent] = await until(async () => { const list = await sessions(), h = list.find(s => s.id === IDS.childA), p = list.find(s => s.id === IDS.parent); return h?.insights?.scan?.scanned && p?.insights?.scan?.scanned && [h, p]; }, 'helper telemetry');
      assert.equal(parent.insights.firstRequest, 'PARENT: build the parser');
      assert.deepEqual([helper.insights.firstRequest, helper.insights.lastRequest], ['', ''], 'a helper\'s requests are its own');
      assert.notEqual(helper.insights.objective.request, 'PARENT: build the parser', 'its objective is not its parent\'s request');
      assert.ok(!helper.insights.spend.turns.some(t => /PARENT/.test(t.request)), 'nor are its turns');
      const parentChat = await chat('codex:' + IDS.parent);
      assert.deepEqual(texts(parentChat.events, 'user'), ['PARENT: build the parser'], 'the parent\'s request is shown once');
      assert.ok(!parentChat.events.some(e => /CHILD-A: one test fails|CHILD-B/.test(e.text || '')), 'the parent chat holds no helper events');
      assert.ok(parentChat.events.some(e => e.t === 'note' && /^Final answer from helper alpha task: CHILD-A report/.test(e.text)), 'a helper\'s final answer reaching the parent is shown');
      const childChat = await chat('codex:' + IDS.childA);
      assert.ok(!childChat.events.some(e => /PARENT/.test(e.text || '')), 'a helper chat leaves out the copy of its parent\'s history');
      assert.ok(childChat.events.some(e => e.t === 'note' && /^Task from the main Codex session/.test(e.text)), 'the task a helper got is shown as a note');
      assert.equal(childChat.status, 'Done');
    }, 'helpers: each Codex helper thread is its own session; the parent keeps its own state and chat');

    // F12: the usage limit.
    await group(async () => {
      const q = row(IDS.quota);
      assert.equal(q.errorType, 'quota'); assert.match(q.error, /usage limit/); assert.equal(q.runState, 'error'); assert.notEqual(q.runState, 'complete');
      const qChat = await chat('codex:' + IDS.quota);
      assert.equal(qChat.status, 'Quota exceeded');
      assert.ok(qChat.events.some(e => e.t === 'note' && e.err && /usage limit/.test(e.text)), 'the usage-limit message is shown');
      assert.ok(!qChat.events.some(e => e.text === 'turn complete'), 'a turn that hit the limit is not called complete');
      assert.equal((await get('/api/recap?key=codex:' + IDS.quota)).status.label, 'Quota exceeded');
    }, 'usage limit: a Codex turn that stopped on the usage limit reads as Quota exceeded, with its message');

    // F13: archives.
    await group(async () => {
      all = await until(async () => { const list = await sessions(); return [IDS.archive, IDS.archiveBig, IDS.dup].every(id => list.some(s => s.id === id)) && list; }, 'archived rollouts to be listed');
      const arcChat = await chat('codex:' + IDS.archive);
      assert.deepEqual(texts(arcChat.events, 'user'), ['Archived request']); assert.deepEqual(texts(arcChat.events, 'ai'), ['Archived reply']);
      assert.equal(row(IDS.archive).archived, true, 'the row says it was archived');
      assert.equal(row(IDS.archiveBig).firstPrompt, 'Big archived request');
      const bigFeed = await get('/api/transcript?key=codex:' + IDS.archiveBig + '&bytes=12000000&limit=2400');
      assert.ok(bigFeed.events.some(e => e.t === 'note' && /middle of this archived conversation/.test(e.text)), 'a shortened archive says what is left out');
      assert.equal(texts(bigFeed.events, 'ai').at(-1), 'Big archived final');
      assert.equal(all.filter(s => s.id === IDS.dup).length, 1); assert.deepEqual(texts((await chat('codex:' + IDS.dup)).events, 'user'), ['Duplicate request'], 'a rollout and its fresh archive are one session, read once');
    }, 'archives: rollouts Codex compressed stay listed and readable');

    // F14/F86/F128/F165: tool output parts; failed commands.
    await group(async () => {
      const childChat = await chat('codex:' + IDS.childA), outChat = await chat('codex:' + IDS.out), results = outChat.events.filter(e => e.t === 'result');
      assert.ok(results.every(r => !r.text.startsWith('[{') && !r.text.includes('base64')), 'tool output is its text, not raw JSON');
      assert.equal(results[0].text, 'Screenshot taken, 1280x720\n[image]'); assert.equal(results[0].images?.length, 1, 'a screenshot is a picture');
      assert.equal(results[1].err, true, 'a failed script is marked');
      const childResults = childChat.events.filter(e => e.t === 'result');
      assert.equal(childResults[0].text, 'Script completed\nWall time 1.2 seconds\nOutput:\n1 failing\n"quoted" line'); assert.equal(childResults[0].err, true, 'a step whose command failed is marked');
      assert.ok((await get('/api/transcript?key=codex:' + IDS.childA)).events.some(e => e.t === 'result' && e.err), 'the Feed marks it too');
      const marks = events => events.filter(e => e.t === 'result').map(e => [e.id, !!e.err]);
      assert.deepEqual(marks((await chat('codex:' + IDS.bgfail)).events), [['bA', false], ['bB', false]], 'a background command failing while no step is open does not fail the next step');
      assert.deepEqual(marks((await get('/api/transcript?key=codex:' + IDS.bgfail)).events), [['bA', false], ['bB', false]], 'nor in the Feed');
    }, 'tool output: Codex results read as text and pictures, failed commands are marked');

    // F15/F163: a question to the owner.
    await group(async () => {
      const askChat = await chat('codex:' + IDS.ask);
      assert.ok(askChat.events.some(e => e.t === 'ai' && e.ask && e.text === 'Should the old command name keep working?'), 'Codex\'s question is its message');
    }, 'questions: a question Codex asks is drawn as Codex\'s message');

    // F16/F93/F19/F99: the CLI's notice, image prompts, heading titles.
    await group(async () => {
      const n = row(IDS.notice);
      assert.equal(n.title, 'Brief: repair the login form'); assert.match(n.firstPrompt, /^# Brief: repair the login form/);
      const nChat = await chat('codex:' + IDS.notice), nUser = nChat.events.find(e => e.t === 'user');
      assert.match(nUser.text, /^# Brief: repair the login form/); assert.ok(!/Codex could not read/.test(nUser.text), 'the CLI\'s notice is not part of the request');
      assert.equal(nUser.images?.length, 1, 'the attached picture is shown');
      assert.ok(nChat.events.some(e => e.t === 'note' && /^Codex could not read the local image/.test(e.text)), 'the notice is a note');
    }, 'prompts: the CLI\'s notice is a note, the picture shows, and titles drop the heading marker');

    // F17: a first prompt past the head.
    await group(async () => {
      assert.equal(row(IDS.big).title, 'Look at this picture and fix the layout'); assert.equal(row(IDS.big).firstPrompt, 'Look at this picture and fix the layout');
    }, 'large prompt: a request with a large picture still titles its session');

    // F22: pasted markup.
    await group(async () => {
      assert.match(row(IDS.tag).firstPrompt, /^<button class="go">/); assert.deepEqual(texts((await chat('codex:' + IDS.tag)).events, 'user'), ['<button class="go">Go</button> does nothing when I click it']);
    }, 'markup: a typed message that starts with markup is kept');

    // F21/F81: mirrored messages in the Feed.
    await group(async () => {
      const feed = await get('/api/transcript?key=codex:' + IDS.legacy);
      assert.deepEqual(texts(feed.events, 'user'), ['Legacy request']); assert.deepEqual(texts(feed.events, 'ai'), ['Legacy reply']);
    }, 'mirrors: the Feed shows a mirrored Codex message once');

    // F115: a continued session live in its new file.
    await group(async () => {
      const live = all.find(s => s.id === C.live);
      assert.equal(live.live, true); assert.equal(live.status, 'busy'); assert.ok(live.aliases.includes('claude:' + C.old));
    }, 'continuation: a continued session live in its new file is listed as live');

    // F80: a chain longer than the chat window.
    await group(async () => {
      const chainChat = await chat('claude:' + C.chainNew);
      assert.equal(chainChat.events.length, 600); assert.equal(chainChat.truncated, true, 'a chat that drops its oldest events says so');
      const earlier = await get('/api/transcript?key=claude:' + C.chainNew + '&bytes=12000000&limit=2400');
      assert.equal(earlier.events.filter(e => e.t === 'user')[0].text, 'old question 0', 'Load earlier reads the older file too');
      const said = events => events.filter(e => e.t === 'user' || e.t === 'ai').map(e => e.text), once = list => list.filter((x, i) => list.indexOf(x) !== i);
      assert.deepEqual(once(said(earlier.events)), [], 'the copy a continued file opens with is shown once in Load earlier');
      assert.deepEqual(once(said((await get('/api/transcript?key=claude:' + C.chainNew)).events)), [], 'and in the Feed');
      assert.deepEqual(once(said(chainChat.events)), [], 'and in the chat');
    }, 'chains: a continued chat says when it is cut, and Load earlier reaches the older file');

    // F116/F153: an old session the owner typed in again after its link is its own conversation (transcript-tail drops the link).
    await group(async () => {
      assert.ok(row(C.linkA) && row(C.linkB), 'each keeps its own row');
      assert.deepEqual(texts((await chat('claude:' + C.linkA)).events, 'user'), ['A before the link', 'A after the link']);
      assert.deepEqual(texts((await chat('claude:' + C.linkB)).events, 'user'), ['B early', 'B late']);
    }, 'resumed after a link: a session typed in again after its continued-in link is its own conversation');

    // F153: files joined by a link are shown in time order.
    await group(async () => {
      const said = events => events.filter(e => e.t === 'user' || e.t === 'ai').map(e => e.text);
      const want = ['Start the job', 'Moving the job to the background', 'Next step in the new file', 'The running tool finished in the old file', 'Done in the new file'];
      assert.ok(!row(C.overA), 'the old file of a hand-off is not a row of its own');
      assert.deepEqual(said((await chat('claude:' + C.overB)).events), want, 'Chat');
      assert.deepEqual(said((await get('/api/transcript?key=claude:' + C.overB)).events), want, 'Feed');
    }, 'link order: files joined by a continued-in link read in time order');

    // F121/F123/F148: a Claude row's time, liveness and folder.
    await group(async () => {
      assert.equal(row(C.tinyB)?.updated, dirs.tinyAt, 'a continued row is dated by its last message, not by a later bookkeeping write');
      assert.equal(row(C.stale).live, false, 'a registry file from before the last boot does not make a session live'); assert.equal(row(C.stale).status, 'offline');
      assert.equal(row(C.sibling).cwd, dirs.alpha, 'a folder the agent only visited is not the session\'s folder');
      assert.equal(row(C.sub).cwd, dirs.gammaSrc, 'a subfolder of the session\'s own folder still counts');
    }, 'Claude rows: dated by the conversation, live only since the last boot, shown in their own folder');

    // F74/F92: the chat's first read reaches back to the owner's request.
    await group(async () => {
      const wide = await chat('claude:' + C.wide);
      assert.deepEqual(texts(wide.events, 'user'), ['Request before a long output']); assert.equal(wide.activity.goal, 'Request before a long output');
    }, 'chat window: a request before a large tool output is in the first view');

    // F58: notifications.
    await group(async () => {
      const notes = texts((await chat('claude:' + C.notes)).events, 'note');
      assert.equal(notes.filter(n => n === 'Background command "npm test" failed with exit code 1').length, 1, 'a failure reported mid-turn is one note: ' + JSON.stringify(notes));
      assert.equal(notes.filter(n => n === 'Monitor "build log" event').length, 2, 'two events of one task are two notes');
    }, 'notifications: one that arrived mid-turn is a note, and each event of a task is shown');

    // F59: Workflow steps.
    await group(async () => {
      assert.deepEqual(texts((await chat('claude:' + C.flow)).events, 'tool'), ['Workflow review-loop', 'C:\\work\\flows\\nightly.js (resuming run r7)']);
    }, 'workflow: a Workflow step reads as the workflow it runs, not its raw input');

    // F133: an upload named in a Codex message.
    await group(async () => {
      const said = (await chat('codex:' + IDS.upload)).events.find(e => e.t === 'user');
      assert.equal(said?.images?.length, 1, 'the picture is shown');
    }, 'uploads: a picture sent to Codex by its path is shown as a picture');
  } finally { server.kill(); }
}

// ---------- stubbed terminals ----------
async function stubbed(root, dirs) {
  const { server, ready, get, post } = start(root, '4826', { TRUTH_B_PRELOAD: '1', TRUTH_B_ROOT: root });
  const spawns = () => { try { return fs.readFileSync(path.join(root, 'stub-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  try {
    await ready;
    const act = async body => (await post('/api/action', body)).body;
    // F148: resume in the transcript's own folder; refuse a folder that is gone.
    await group(async () => {
      const r1 = await act({ action: 'term-resume', key: 'claude:' + C.sibling });
      assert.ok(r1.ok, JSON.stringify(r1));
      assert.equal(path.resolve(spawns().filter(e => e.type === 'spawn').at(-1).cwd), path.resolve(dirs.alpha), 'a resume starts in the folder the transcript is filed under');
      const r2 = await act({ action: 'term-resume', key: 'claude:' + C.gone });
      assert.match(r2.error || '', /no longer exists/, 'a resume whose folder is gone says so');
    }, 'resume folder: Claude resumes where its transcript is filed, or says the folder is gone');

    // F146: the phone and the glasses call term-resume directly.
    await group(async () => {
      const refused = await act({ action: 'term-resume', key: 'claude:' + C.ended });
      assert.match(refused.error || '', /open in another terminal/, JSON.stringify(refused));
      assert.ok(!spawns().some(e => e.type === 'spawn' && e.args.includes(C.ended)), 'no second Claude was started');
    }, 'open elsewhere: a Claude session open in another terminal is not started again unless asked');

    // F150: an ended NEXUS terminal does not speak for a session that runs elsewhere.
    await group(async () => {
      assert.ok((await act({ action: 'term-resume', key: 'claude:' + C.ended, force: true })).ok, 'Open here (anyway) still opens it');
      await until(async () => (await get('/api/sessions')).terms.some(t => t.sessionKey === 'claude:' + C.ended && t.exited), 'the stub terminal to end');
      const endedChat = await get('/api/chat?key=claude:' + C.ended);
      assert.equal(endedChat.terminal, null); assert.notEqual(endedChat.status, 'Done', 'a session working elsewhere is not shown as Done');
    }, 'ended terminal: a session live elsewhere is not shown as ended');

    // F152: closing a NEXUS terminal mid-turn stops the Working state.
    await group(async () => {
      const r3 = await act({ action: 'term-resume', key: 'codex:' + IDS.run });
      let row = (await get('/api/sessions')).sessions.find(s => s.id === IDS.run);
      assert.equal(row.live, true);
      await act({ action: 'term-close', term: r3.result.term });
      row = (await get('/api/sessions')).sessions.find(s => s.id === IDS.run);
      assert.equal(row.live, false); assert.equal(row.runState, 'interrupted'); assert.equal((await get('/api/chat?key=codex:' + IDS.run)).status, 'Done');
    }, 'closed terminal: a Codex turn stopped by closing its NEXUS terminal no longer reads as working');

    // F149/F110: a new Codex terminal without a theme is tied to its own rollout, not to an exec run in the folder.
    await group(async () => {
      const r4 = await act({ action: 'term-new-codex', cwd: dirs.cwd });
      assert.ok(r4.ok, JSON.stringify(r4));
      const linked = await until(async () => (await get('/api/sessions')).terms.find(t => t.id === r4.result.term && t.sessionKey), 'the new terminal to be tied to its session');
      assert.equal(linked.sessionKey, 'codex:0b000000-0000-4000-8000-00000000a1a1');
    }, 'new terminal: a Codex session started without a theme is tied to its terminal');

    // F38: a quota snapshot older than a later quota error is not shown as the account's usage.
    await group(async () => {
      assert.equal((await get('/api/sessions')).usage.copilot.quota, null);
    }, 'Copilot quota: an old snapshot does not outlive a later quota error');

    // F129: a long reply is read in groups the neural voice accepts, without markup.
    await group(async () => {
      const long = Array.from({ length: 12 }, (_, i) => 'Sentence number ' + i + ' explains **one** step of the change in plain words.').join(' ') + ' See `server.js` at https://example.com/x.';
      const said = await post('/api/voice/say', { text: long, lang: 'en' }, 20000);
      assert.equal(said.status, 200, 'a reply over 700 characters is spoken');
      const parts = spawns().filter(e => e.type === 'say');
      assert.ok(parts.length > 1 && parts.every(p => p.length <= 700), 'each request fits the voice');
      assert.ok(parts.every(p => !/[*`]|https?:/.test(p.text)), 'markup and links are not read out');
      const spoken = parts.map(p => p.text).join(' ').replace(/\s+/g, ' ');
      assert.equal(spoken, require('../public/voice-core').clean(long).replace(/\s+/g, ' ').trim(), 'the groups together are the whole reply');
      assert.deepEqual(spoken.match(/Sentence number \d+/g), Array.from({ length: 12 }, (_, i) => 'Sentence number ' + i), 'every sentence is spoken once, in order');
    }, 'voice: a long reply is read in full, in groups the neural voice accepts');
  } finally { server.kill(); }
}

(async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nexus-truth-b-'));
  try {
    const dirs = fixtures(root);
    await modules(root);
    await readOnly(root, dirs);
    await stubbed(root, dirs);
    if (failures) throw Error(failures + ' group(s) failed');
  } catch (e) { console.error(e.message || e); process.exitCode = 1; }
  finally { await wait(400); fs.rmSync(root, { recursive: true, force: true }); }
})();
