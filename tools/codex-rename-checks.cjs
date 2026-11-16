// NEXUS used to call the Codex CLI agent "Astra" (kind 'astra', keys 'astra:<id>'). This proves the rename:
//   A  the old word is nowhere in the repository outside the allowlist (the keep list of tools/rename-astra-to-codex.cjs)
//   B  legacy-names.js maps exactly the old key prefix, the two old action names and the old config key
//   C  each store written in the old shape migrates in memory: keys renamed, merges right, content untouched
//   D  on disk: once, with a backup, nothing on a second start; read-only and fixture servers leave the owner's files alone
//   E  a fixture server (port 4791, stubbed agents and terminals) answers old keys and action names like new ones
//      and sends only new names; the page migrates old browser storage (headless Chrome through tools/cdp-tour.mjs)
//   F  public/legacy-names.js migrates the three browser storage items, once
//   G  transcripts that name the old or the new word still count as Codex runs
// Synthetic data only, in TEMP. Run through the shared lock like every check.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict'), http = require('http'), Module = require('module');
const { spawn, spawnSync } = require('child_process');
const OLD = 'astra', PORT = '4791', TMP = fs.realpathSync(os.tmpdir());

// ---------- preload mode (inside the 4791 server): no real CLI, terminal or voice is ever started ----------
if (process.env.CODEX_RENAME_PRELOAD === '1') {
  const root = path.resolve(process.env.CODEX_RENAME_ROOT || '');
  if (process.env.NEXUS_PORT !== PORT || !root.toLowerCase().startsWith(TMP.toLowerCase() + path.sep) || !path.basename(root).startsWith('nexus-codex-rename-')) throw Error('Unsafe preload');
  const log = entry => fs.appendFileSync(path.join(root, 'stub-log.jsonl'), JSON.stringify(entry) + '\n');
  let pid = 910000;
  const load = Module._load;
  Module._load = function (name) {
    if (name === '@lydell/node-pty') return { spawn(file, args, options) {
      log({ type: 'spawn', file, args });
      if (!path.resolve(options.cwd).toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw Error('Fixture cwd required');
      let exit = () => {}; const end = () => setTimeout(() => exit({ exitCode: 0 }), 0);
      return { pid: ++pid, onData() { }, onExit(fn) { exit = fn; }, resize() { }, kill: end, write() { } };
    } };
    const m = load.apply(this, arguments);
    if (name === './agents' && !m.__renameStub) { const all = () => ({ claude: { installed: true }, codex: { installed: true }, copilot: { installed: false }, antigravity: { installed: false } });
      Object.assign(m, { __renameStub: true, launch: (kind, args = []) => ({ file: 'stub-' + kind, args }), publicStatus: all, refresh: all, detect: () => ({}) }); }
    if (name === './neural-tts') return { ...m, createNeuralTTS: () => ({ list: () => ({ voices: [] }), sample() { throw Error('stub'); }, async choose() { return {}; }, async warm() { }, startCall() { }, stopCall() { }, async close() { }, async synthesize() { throw Error('stub'); } }) };
    return m;
  };
  return;
}

const repo = path.join(__dirname, '..');
const legacy = require('../legacy-names');
let failures = 0;
async function group(label, fn) { try { await fn(); console.log('PASS ' + label); } catch (e) { failures++; console.log('FAIL ' + label + ': ' + (e && e.stack || e)); } }
const temp = () => fs.mkdtempSync(path.join(TMP, 'nexus-codex-rename-'));
const roots = [];

// ---------- A. leftover guard ----------
// Caps keep a narrow exception narrow: a copy of one needs a deliberate change here.
const CAPS = { 'tool-name-heuristic': 5, 'result-prefix': 3, 'brief-opener-regex': 1, 'generic-title-regex': 1, 'proper-name-list': 1, 'model-suffix-list': 1, 'tool-call-fixture': 1, 'worktree-fixture': 1, 'branch-in-commit-output': 1 };
const { KEEP, BINARY_EXT } = require('./rename-astra-to-codex.cjs');
// Every occurrence of the word in one text (a file's content or its path): kept by a rule, or a leftover.
function classify(file, text) {
  const rules = KEEP.filter(r => !r.files || r.files.test(file)), kept = [], left = [];
  const spans = []; for (const r of rules) { if (r.wholeFile) spans.push([0, text.length, r.id]); else for (const m of text.matchAll(r.re)) spans.push([m.index, m.index + m[0].length, r.id]); }
  for (const m of text.matchAll(/astra/gi)) { const s = spans.find(([a, b]) => m.index >= a && m.index + 5 <= b); (s ? kept : left).push({ at: m.index, rule: s && s[2] }); }
  return { kept, left };
}
function guard() {
  const r = spawnSync('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw Error('git ls-files failed');
  const files = [...new Set(r.stdout.split('\0').filter(Boolean))].filter(f => !/(^|\/)node_modules\//.test(f));
  const counts = {}, bad = [];
  const lc = (text, at) => { const before = text.slice(0, at), line = before.split('\n').length; return line + ':' + (at - before.lastIndexOf('\n')); };
  for (const file of files) {
    const p = classify(file, file);
    for (const o of p.left) bad.push(file + ' (file name)');
    for (const o of p.kept) counts[o.rule] = (counts[o.rule] || 0) + 1;
    const abs = path.join(repo, file); let buf; try { if (BINARY_EXT.test(file) || !fs.statSync(abs).isFile()) continue; buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.includes(0)) continue;
    const text = buf.toString('utf8'); if (!/astra/i.test(text)) continue;
    const c = classify(file, text);
    for (const o of c.kept) counts[o.rule] = (counts[o.rule] || 0) + 1;
    for (const o of c.left) bad.push(file + ':' + lc(text, o.at) + ' (no keep rule covers it)');
  }
  return { counts, bad, files: files.length };
}

// ---------- fixtures ----------
const ID = n => '0c000000-0000-4000-8000-' + String(n).padStart(12, '0');
const O = id => OLD + ':' + id, N = id => 'codex:' + id;
function oldState() {
  return { version: 1, viewed: { [O(ID(1))]: 500, [O(ID(2))]: 900, [N(ID(2))]: 700, 'claude:x': 3 },
    models: { [O(ID(1))]: { model: 'gpt-6-' + OLD, at: 5 }, [O(ID(2))]: { model: 'old', at: 9 }, [N(ID(2))]: { model: 'new', at: 4 } },
    titles: { [O(ID(1))]: 'A title', [O(ID(2))]: 'old title', [N(ID(2))]: 'new title' }, voices: { en: OLD + ' voice' },
    messageQueues: {
      [O(ID(1))]: { items: [{ id: 'q1', text: 'Ask ' + OLD + ' to retry', status: 'queued' }], history: [], active: null, hold: '' },
      [O(ID(2))]: { items: [{ id: 'q2', text: 'two', status: 'queued' }, { id: 'q3', text: 'dup', status: 'queued' }], history: [{ id: 'h1', text: 'done' }], active: { id: 'a-old', text: 'sending', status: 'sending' }, hold: '' },
      [N(ID(2))]: { items: [{ id: 'q3', text: 'dup', status: 'queued' }], history: [], active: { id: 'a-new', text: 'sending too', status: 'sending' }, hold: '' },
      'term:t1-1': { items: [], history: [], active: null, hold: '' } } };
}
function oldThemes() {
  return { version: 1, themes: [{ id: 'ship', name: 'Ship ' + OLD, color: '#c5a5df', mainFolder: 'C:\\work\\nexus-' + OLD }],
    assignments: { [O(ID(1))]: { themeId: 'ship', by: 'owner', at: 1 }, [O(ID(2))]: { themeId: 'ship', by: 'owner', at: 1 }, [N(ID(2))]: { themeId: null, by: 'nexus', at: 50 },
      [O(ID(3))]: { themeId: 'ship', by: 'nexus', at: 80 }, [N(ID(3))]: { themeId: null, by: 'nexus', at: 20 } },
    parents: { [O(ID(4))]: { key: O(ID(1)), relation: 'fork' }, 'claude:p': { key: O(ID(2)), relation: 'helper' } },
    folders: { ['folder:C:\\work\\' + OLD]: { themeId: 'ship' }, ['alias:' + OLD]: { themeId: 'ship' } },
    inherited: { [O(ID(5))]: { id: 'ship', name: OLD + ' work', color: '#c5a5df', source: 'folder' }, [N(ID(5))]: { id: 'ship', name: 'new wins', color: '#c5a5df', source: 'folder' } } };
}
const oldKeyed = () => ({ [O(ID(1))]: { sig: 's1', text: 'Label about ' + OLD, model: 'gpt-6-' + OLD, at: 10 }, [O(ID(2))]: { sig: 's2', text: 'old', at: 30 }, [N(ID(2))]: { sig: 's2', text: 'new', at: 20 }, 'claude:c': { sig: 'c', text: 'x', at: 1 } });
const oldCache = () => ({ version: 2, rootsKey: 'rk', files: [
  ['C:\\x\\' + OLD + '\\rollout.jsonl', { kind: OLD, launch: 'C:\\work\\' + OLD, cwd: 'C:\\work\\' + OLD, roots: [{ path: 'C:\\work\\' + OLD }], basenames: [OLD], ids: ['i1'], parent: { key: O(ID(1)), relation: 'fork' } }],
  ['C:\\x\\c.jsonl', { kind: 'claude', launch: '', cwd: '', roots: [], basenames: [], ids: [] }]] });

(async () => {
  // ---------- A ----------
  await group('A. the old word appears only where the allowlist keeps it', () => {
    const g = guard();
    console.log('  allowlisted occurrences: ' + Object.values(g.counts).reduce((a, b) => a + b, 0) + ' ' + JSON.stringify(g.counts));
    assert.equal(g.bad.length, 0, 'leftovers outside the allowlist:\n  ' + g.bad.slice(0, 40).join('\n  '));
    for (const [rule, cap] of Object.entries(CAPS)) assert.ok((g.counts[rule] || 0) <= cap, rule + ' keeps ' + g.counts[rule] + ' occurrences, more than its cap ' + cap);
    // Self-test: a new kind literal beside a kept regex is still a leftover; a renamed model id would be a loss.
    const sample = classify('server.js', "const k = /" + OLD + "/i.test(n) ? '" + OLD + "' : 'claude';");
    assert.equal(sample.kept.length, 1); assert.equal(sample.left.length, 1);
    assert.equal(classify('public/app.js', "s.kind==='" + OLD + "'").left.length, 1);
    for (const f of ['models.js', 'config.example.json', 'public/redesign-core.js']) assert.ok(fs.readFileSync(path.join(repo, f), 'utf8').includes('gpt-6-' + OLD), f + ' lost the real model id');
  });

  // ---------- A2 ----------
  await group('A2. a re-run of the codemod changes nothing, and recorded tours still match their screenshots', () => {
    const dir = temp(); roots.push(dir); const out = path.join(dir, 'codemod.json');
    const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'rename-astra-to-codex.cjs'), repo, '--report', out, '--no-context'], { cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    assert.ok(fs.existsSync(out), 'the codemod wrote no report: ' + (r.stderr || '').slice(-400));
    const rep = JSON.parse(fs.readFileSync(out, 'utf8')), where = l => l.map(x => x.file || x.from || JSON.stringify(x)).slice(0, 20).join(', ');
    assert.equal(rep.replacements.length, 0, 'the codemod would still rewrite: ' + where(rep.replacements));
    assert.equal(rep.renames.length, 0, 'the codemod would still rename: ' + where(rep.renames));
    // A recorded tour names each screenshot it took; the picture of that name lies beside the record.
    const listed = spawnSync('git', ['-C', repo, 'ls-files', '-z', 'docs/shots'], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout.split('\0').filter(Boolean), have = new Set(listed);
    const missing = [];
    for (const f of listed.filter(f => /\/steps\.json$/.test(f))) {
      let steps; try { steps = JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8')); } catch { continue; }
      for (const s of Array.isArray(steps) ? steps : []) if (s && typeof s.shot === 'string' && !have.has(path.posix.join(path.posix.dirname(f), s.shot + '.png'))) missing.push(f + ' -> ' + s.shot);
    }
    assert.deepEqual(missing.filter(m => /astra|codex/i.test(m)), [], 'a recorded tour names a screenshot that is not beside it');
  });

  // ---------- B ----------
  await group('B. legacy-names.js maps exactly the old key prefix, action names and config key', () => {
    assert.equal(legacy.key(O('abc')), 'codex:abc');
    for (const k of ['claude:abc', 'copilot:abc', 'term:t1-2', 'codex:abc', 'claude:' + OLD + ':x', 'x' + OLD + ':y', '', undefined, null, 5]) assert.equal(legacy.key(k), k);
    assert.equal(legacy.action('new-' + OLD), 'new-codex'); assert.equal(legacy.action('term-new-' + OLD), 'term-new-codex');
    for (const a of ['new', 'term-new', 'new-codex', 'term-new-codex', 'term-new-' + OLD + '-x', 'viewed', undefined]) assert.equal(legacy.action(a), a);
    const body = legacy.request({ action: 'term-new-' + OLD, key: O('a'), keys: [O('b'), 'claude:c', 7], model: 'gpt-6-' + OLD, text: OLD });
    assert.deepEqual(body, { action: 'term-new-codex', key: 'codex:a', keys: ['codex:b', 'claude:c', 7], model: 'gpt-6-' + OLD, text: OLD });
    assert.deepEqual(legacy.request({ action: 'viewed' }), { action: 'viewed' });
    const url = new URL('http://localhost/api/chat?key=' + encodeURIComponent(O('z')) + '&since=1'); legacy.query(url);
    assert.equal(url.searchParams.get('key'), 'codex:z'); assert.equal(url.searchParams.get('since'), '1');
    const u2 = new URL('http://localhost/api/chat?key=claude:z'); legacy.query(u2); assert.equal(u2.search, '?key=claude:z');
    const dir = temp(); roots.push(dir); const file = path.join(dir, 'config.json'), raw = JSON.stringify({ models: { [OLD]: [{ id: 'gpt-6-' + OLD, label: 'GPT-6' }] } });
    fs.writeFileSync(file, raw);
    const cfg = legacy.config(JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(Object.keys(cfg.models), ['codex']); assert.equal(cfg.models.codex[0].id, 'gpt-6-' + OLD);
    assert.deepEqual(require('../models').args(cfg, 'codex', 'gpt-6-' + OLD), ['-m', 'gpt-6-' + OLD]);
    assert.equal(fs.readFileSync(file, 'utf8'), raw, 'the config file is never written');
    assert.deepEqual(legacy.config({ models: { codex: ['new'], [OLD]: ['old'] } }).models, { codex: ['new'] });
    assert.deepEqual(legacy.config({ port: 1 }), { port: 1 }); assert.equal(legacy.config(undefined), undefined);
  });

  // ---------- C ----------
  await group('C. each store migrates in memory: keys renamed, merges right, content untouched', () => {
    const s = oldState(); assert.equal(legacy.state(s), true);
    assert.deepEqual(s.viewed, { 'claude:x': 3, [N(ID(1))]: 500, [N(ID(2))]: 900 });
    assert.deepEqual(s.models[N(ID(1))], { model: 'gpt-6-' + OLD, at: 5 }); assert.equal(s.models[N(ID(2))].model, 'old');
    assert.equal(s.titles[N(ID(1))], 'A title'); assert.equal(s.titles[N(ID(2))], 'new title');
    assert.deepEqual(s.voices, { en: OLD + ' voice' });
    assert.equal(s.messageQueues[N(ID(1))].items[0].text, 'Ask ' + OLD + ' to retry');
    const q = s.messageQueues[N(ID(2))];
    assert.deepEqual(q.items.map(i => i.id), ['a-old', 'q3', 'q2']); assert.equal(q.items[0].status, 'failed'); assert.equal(q.active.id, 'a-new'); assert.ok(q.hold);
    assert.deepEqual(q.history.map(i => i.id), ['h1']); assert.ok(s.messageQueues['term:t1-1']);
    assert.ok(!JSON.stringify(Object.keys(s.viewed).concat(Object.keys(s.models), Object.keys(s.titles), Object.keys(s.messageQueues))).includes(OLD));
    assert.equal(legacy.state(s), false, 'a second pass changes nothing');

    const t = oldThemes(); assert.equal(legacy.themes(t), true);
    assert.deepEqual(t.assignments[N(ID(1))], { themeId: 'ship', by: 'owner', at: 1 });
    assert.equal(t.assignments[N(ID(2))].by, 'owner', 'owner beats nexus'); assert.equal(t.assignments[N(ID(3))].at, 80, 'then the later at');
    assert.deepEqual(t.parents[N(ID(4))], { key: N(ID(1)), relation: 'fork' }); assert.equal(t.parents['claude:p'].key, N(ID(2)));
    assert.equal(t.inherited[N(ID(5))].name, 'new wins');
    assert.deepEqual(t.folders, oldThemes().folders); assert.deepEqual(t.themes, oldThemes().themes); assert.equal(t.version, 1);
    assert.ok(!Object.keys({ ...t.assignments, ...t.parents, ...t.inherited }).some(k => k.includes(OLD)));
    assert.equal(legacy.themes(t), false);
    const dir = temp(); roots.push(dir); const tf = path.join(dir, 'themes.json'); fs.writeFileSync(tf, JSON.stringify(t));
    const loaded = new (require('../themes').Themes)({ file: tf, readOnly: true }); assert.equal(loaded.loadError, undefined, 'the migrated themes file still loads');

    const l = oldKeyed(); assert.equal(legacy.keyed(l), true);
    assert.deepEqual(l[N(ID(1))], oldKeyed()[O(ID(1))]); assert.equal(l[N(ID(2))].text, 'old', 'the later at wins'); assert.ok(l['claude:c']);
    assert.equal(Object.keys(l).length, 3); assert.equal(legacy.keyed(l), false);

    const c = oldCache(); assert.equal(legacy.cache(c), true);
    assert.equal(c.files[0][1].kind, 'codex'); assert.equal(c.files[0][1].parent.key, N(ID(1)));
    assert.equal(c.files[0][0], oldCache().files[0][0]); assert.deepEqual(c.files[0][1].basenames, [OLD]); assert.equal(c.files[0][1].cwd, oldCache().files[0][1].cwd);
    assert.deepEqual(c.files[1], oldCache().files[1]); assert.equal(c.version, 2); assert.equal(c.rootsKey, 'rk');
    assert.equal(legacy.cache(c), false);
  });

  // ---------- D ----------
  await group('D. on disk: once, with a backup, nothing on a second start', () => {
    const dir = temp(); roots.push(dir);
    const home = path.join(dir, 'NexusDeck'), data = path.join(dir, 'data'); fs.mkdirSync(home); fs.mkdirSync(data);
    const files = { state: path.join(data, 'state.json'), themes: path.join(data, 'themes.json'), cache: path.join(data, 'work-folders-cache.json'), labels: path.join(home, 'labels.json'), picks: path.join(home, 'theme-picks.json') };
    const write = () => { fs.writeFileSync(files.state, JSON.stringify(oldState())); fs.writeFileSync(files.themes, JSON.stringify(oldThemes())); fs.writeFileSync(files.cache, JSON.stringify(oldCache())); fs.writeFileSync(files.labels, JSON.stringify(oldKeyed())); fs.writeFileSync(files.picks, JSON.stringify(oldKeyed())); };
    write();
    const original = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));
    const env = { LOCALAPPDATA: dir, NEXUS_STATE_FILE: files.state, NEXUS_THEMES_FILE: files.themes };
    const logs = [], log = m => logs.push(m);
    // A read-only server writes nothing; a fixture server (agent folders set) leaves labels and picks alone.
    assert.deepEqual(legacy.migrateStores({ env: { ...env, NEXUS_READ_ONLY: '1' }, log }), []);
    for (const [k, f] of Object.entries(files)) assert.ok(fs.readFileSync(f).equals(original[k]), k + ' written by a read-only server');
    const fixture = legacy.migrateStores({ env: { ...env, NEXUS_CODEX_DIR: path.join(dir, 'codex') }, log });
    assert.deepEqual(fixture.sort(), [files.cache, files.state, files.themes].sort());
    assert.ok(fs.readFileSync(files.labels).equals(original.labels) && fs.readFileSync(files.picks).equals(original.picks), 'a fixture server touched labels or picks');
    assert.ok(!fs.existsSync(files.labels + legacy.BACKUP) && !fs.existsSync(files.picks + legacy.BACKUP));
    // The real server (no agent folder variables): the two remaining stores.
    assert.deepEqual(legacy.migrateStores({ env, log }).sort(), [files.labels, files.picks].sort());
    for (const k of ['state', 'themes', 'labels', 'picks']) {
      assert.ok(fs.readFileSync(files[k] + legacy.BACKUP).equals(original[k]), k + ' backup holds the old bytes');
      const now = JSON.parse(fs.readFileSync(files[k], 'utf8')); assert.ok(!JSON.stringify(Object.keys(k === 'labels' || k === 'picks' ? now : { ...now.viewed, ...now.assignments, ...now.messageQueues })).includes(OLD), k + ' still holds old keys');
    }
    assert.ok(!fs.existsSync(files.cache + legacy.BACKUP), 'the cache needs no backup');
    assert.equal(JSON.parse(fs.readFileSync(files.cache, 'utf8')).files[0][1].kind, 'codex');
    assert.equal(JSON.parse(fs.readFileSync(files.labels, 'utf8'))[N(ID(1))].text, 'Label about ' + OLD);
    // Second start: no bytes, no mtime, no new file.
    const snap = () => [data, home].flatMap(d => fs.readdirSync(d).sort().map(n => { const f = path.join(d, n), st = fs.statSync(f); return n + ':' + st.mtimeMs + ':' + fs.readFileSync(f).toString('base64'); }));
    const before = snap(); assert.deepEqual(legacy.migrateStores({ env, log }), []); assert.deepEqual(snap(), before, 'a second start changed something');
    // Old code ran again and wrote old keys: they are merged, the first backup stays.
    const firstBackup = fs.readFileSync(files.state + legacy.BACKUP);
    const again = JSON.parse(fs.readFileSync(files.state, 'utf8')); again.viewed[O(ID(9))] = 77; fs.writeFileSync(files.state, JSON.stringify(again));
    assert.deepEqual(legacy.migrateStores({ env, log }), [files.state]);
    assert.ok(fs.readFileSync(files.state + legacy.BACKUP).equals(firstBackup), 'the first backup was overwritten');
    assert.equal(JSON.parse(fs.readFileSync(files.state, 'utf8')).viewed[N(ID(9))], 77);
    // Unparsable JSON is left for its own loader, and nothing throws.
    fs.writeFileSync(files.themes, '{"version":1,"assignments":{"' + O('x') + '":');
    const broken = fs.readFileSync(files.themes); assert.deepEqual(legacy.migrateStores({ env, log }), []); assert.ok(fs.readFileSync(files.themes).equals(broken));
    assert.deepEqual(logs, []);
  });

  // ---------- F ----------
  await group('F. the page migrates the three browser storage items, once', () => {
    const { migrateStorage } = require('../public/legacy-names.js');
    const fake = init => { const m = new Map(Object.entries(init)); return { m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
    const st = fake({ 'nexus.place': JSON.stringify({ view: 'chat', key: O('p1'), tab: 'chat', group: OLD + ' work', project: 'nexus-' + OLD }),
      ['nexus.new-model-' + OLD]: 'gpt-6-' + OLD,
      'nexus.prefs': JSON.stringify({ slashUsage: { [OLD]: { '/review': { count: 2, at: 10 }, '/plan': { count: 1, at: 3 } }, codex: { '/review': { count: 1, at: 50 } }, claude: { '/x': { count: 1, at: 1 } } }, slashUsageIds: ['u-' + OLD] }),
      'nexus.theme': 'dark' });
    migrateStorage(st);
    assert.deepEqual(JSON.parse(st.m.get('nexus.place')), { view: 'chat', key: 'codex:p1', tab: 'chat', group: OLD + ' work', project: 'nexus-' + OLD });
    assert.equal(st.m.get('nexus.new-model-codex'), 'gpt-6-' + OLD); assert.ok(!st.m.has('nexus.new-model-' + OLD));
    assert.deepEqual(JSON.parse(st.m.get('nexus.prefs')), { slashUsage: { codex: { '/review': { count: 3, at: 50 }, '/plan': { count: 1, at: 3 } }, claude: { '/x': { count: 1, at: 1 } } }, slashUsageIds: ['u-' + OLD] });
    const once = JSON.stringify([...st.m]); migrateStorage(st); assert.equal(JSON.stringify([...st.m]), once, 'a second load changed something');
    const kept = fake({ ['nexus.new-model-' + OLD]: 'old-id', 'nexus.new-model-codex': 'new-id' }); migrateStorage(kept);
    assert.equal(kept.m.get('nexus.new-model-codex'), 'new-id'); assert.ok(!kept.m.has('nexus.new-model-' + OLD));
    migrateStorage(fake({ 'nexus.place': '{broken', 'nexus.prefs': '[' }));
    migrateStorage({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } });
    migrateStorage(null);
    const html = fs.readFileSync(path.join(repo, 'public', 'index.html'), 'utf8'), at = n => html.indexOf('<script src="' + n + '"');
    assert.ok(at('legacy-names.js') >= 0 && at('legacy-names.js') < at('polish.js') && at('legacy-names.js') < at('slash-picker.js') && at('legacy-names.js') < at('prism.js'), 'index.html loads legacy-names.js first');
  });

  // ---------- G ----------
  await group('G. transcripts that name the old or the new word still count as Codex runs', () => {
    const core = require('../public/redesign-core'), language = require('../public/activity-language'), preview = require('../session-preview');
    for (const w of ['ASTRA', 'CODEX']) assert.equal(core.plainSummary(w + ' RESULT: abc1234 | Fixed the preview. | none'), 'Fixed the preview.');
    assert.equal(language.readable('CODEX RESULT: abc1234 | Fixed it'), language.readable('ASTRA RESULT: abc1234 | Fixed it'));
    for (const name of ['Astra', 'Codex']) assert.equal(language.tool(name, {}).kind, 'codex', name);
    for (const name of ['Astra', 'Codex']) {
      const p = preview.createPreview();
      preview.observePreview(p, { type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } });
      assert.deepEqual(preview.previewSummary(p).recentTools, ['Codex'], name);
    }
    assert.equal(language.briefTitle('You are GPT Codex. NEXUS commission "ACTIVITY POLISH".').summary, language.briefTitle('You are GPT Astra. NEXUS commission "ACTIVITY POLISH".').summary);
  });

  // ---------- H ----------
  // A hand-over starts the new server while the old one still serves: the old one can write its stores, in the old
  // shape, after the new one migrated them at start-up. Every loader reads them under the new keys all the same.
  await group('H. stores written in the old shape after the start-up migration load under the new keys', () => {
    const dir = temp(); roots.push(dir); const home = path.join(dir, 'NexusDeck'); fs.mkdirSync(home);
    const files = { state: path.join(home, 'state.json'), themes: path.join(home, 'themes.json'), labels: path.join(home, 'labels.json'), picks: path.join(home, 'theme-picks.json'), cache: path.join(home, 'work-folders-cache.json') };
    fs.writeFileSync(files.state, JSON.stringify(oldState())); fs.writeFileSync(files.themes, JSON.stringify(oldThemes()));
    fs.writeFileSync(files.labels, JSON.stringify(oldKeyed())); fs.writeFileSync(files.picks, JSON.stringify(oldKeyed()));
    const cache = oldCache(); cache.files[0][1] = { ...cache.files[0][1], size: 10, offset: 10 }; fs.writeFileSync(files.cache, JSON.stringify(cache));
    const script = `
      const fs = require('fs'), crypto = require('crypto'), r = ${JSON.stringify(repo)}, f = ${JSON.stringify(files)}, id = ${JSON.stringify(ID(1))}, id2 = ${JSON.stringify(ID(2))};
      const out = {};
      const ins = require(r + '/insights');
      out.title = ins.titleFor('codex:' + id2); out.model = ins.modelFor('codex:' + id); out.queues = Object.keys(ins.messageQueues()).sort();
      const { Themes } = require(r + '/themes'); const t = new Themes({ file: f.themes, scanner: { on() {}, start() {}, stop() {} } });
      out.themeError = t.loadError || ''; out.assignments = Object.keys(t.state.assignments).sort();
      const { WorkScanner } = require(r + '/work-folders'); const w = new WorkScanner({ roots: { cacheKey: 'rk' }, cacheFile: f.cache });
      out.cacheKinds = [...w.cache.values()].map(v => v.kind + '|' + (v.parent ? v.parent.key : '')).sort();
      const labels = require(r + '/session-labels'); const s = { kind: 'codex', id: id2, title: 't', lastText: 'x', updated: 1 }, x = labels.exchange(s);
      const sig = crypto.createHash('sha1').update(x.ask + '\\0' + x.said).digest('hex'), store = JSON.parse(fs.readFileSync(f.labels, 'utf8'));
      store['astra:' + id2] = { sig, text: 'old label', at: 30 }; delete store['codex:' + id2]; fs.writeFileSync(f.labels, JSON.stringify(store));
      out.label = labels.createLabeler({ file: f.labels, enabled: false }).get(s);
      const picks = require(r + '/theme-sorter').createSorter({ file: f.picks, enabled: false }); picks.forget(['codex:' + id2]);
      out.picks = Object.keys(JSON.parse(fs.readFileSync(f.picks, 'utf8'))).sort();
      process.stdout.write(JSON.stringify(out)); process.exit(0);
    `;
    const env = { ...process.env, LOCALAPPDATA: dir, USERPROFILE: dir, HOME: dir, NEXUS_STATE_FILE: files.state, NEXUS_THEMES_FILE: files.themes, NEXUS_CLAUDE_DIR: path.join(dir, 'c'), NEXUS_CODEX_DIR: path.join(dir, 'x'), NEXUS_COPILOT_DIR: path.join(dir, 'p') };
    delete env.NEXUS_READ_ONLY;
    const r = spawnSync(process.execPath, ['-e', script], { cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 60e3 });
    let out; try { out = JSON.parse(r.stdout); } catch { throw Error('loader probe failed: ' + (r.stderr || r.stdout || '').slice(-800)); }
    assert.equal(out.title, 'new title'); assert.equal(out.model && out.model.model, 'gpt-6-' + OLD);
    assert.deepEqual(out.queues, [N(ID(1)), N(ID(2)), 'term:t1-1']);
    assert.equal(out.themeError, ''); assert.ok(out.assignments.length && out.assignments.every(k => !k.startsWith(OLD)), 'themes kept old keys: ' + out.assignments);
    assert.deepEqual(out.cacheKinds, ['codex|' + N(ID(1))]);
    assert.equal(out.label, 'old label', 'a label saved under the old key was not found');
    assert.deepEqual(out.picks, ['claude:c', N(ID(1))], 'theme picks kept an old key');
    for (const f of Object.values(files)) assert.ok(!fs.existsSync(f + legacy.BACKUP), 'a loader wrote a backup: ' + f);
  });

  // ---------- E ----------
  await group('E. a server answers old keys and action names like new ones, sends new names only; the page migrates its storage', async () => {
    const root = temp(); roots.push(root);
    const cwd = path.join(root, 'project'), id = ID(42), oldKey = O(id), newKey = N(id);
    const rolloutDir = path.join(root, 'codex', 'sessions', '2026', '11', '11');
    for (const d of [cwd, rolloutDir, path.join(root, 'claude', 'projects'), path.join(root, 'copilot', 'session-state'), path.join(root, 'NexusDeck')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(cwd, 'page.html'), '<p>preview</p>');
    const t0 = Date.now() - 600e3, iso = ms => new Date(ms).toISOString();
    const rows = [{ timestamp: iso(t0), type: 'session_meta', payload: { id, timestamp: iso(t0), cwd, originator: 'codex_exec', cli_version: '0.153.4', source: 'exec' } },
      { timestamp: iso(t0 + 1000), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the release notes' }] } },
      { timestamp: iso(t0 + 1500), type: 'event_msg', payload: { type: 'task_started' } },
      { timestamp: iso(t0 + 2000), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The release notes are fixed.' }] } },
      { timestamp: iso(t0 + 2500), type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'The release notes are fixed.' } }];
    fs.writeFileSync(path.join(rolloutDir, 'rollout-2026-11-11T10-00-00-' + id + '.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const files = { state: path.join(root, 'state.json'), themes: path.join(root, 'themes.json'), labels: path.join(root, 'NexusDeck', 'labels.json') };
    fs.writeFileSync(files.state, JSON.stringify({ version: 1, viewed: { [oldKey]: t0 }, models: {}, titles: {}, voices: {}, messageQueues: {} }));
    fs.writeFileSync(files.themes, JSON.stringify({ version: 1, themes: [{ id: 'ship', name: 'Ship it', color: '#c5a5df', purpose: 'Release work.' }], assignments: { [oldKey]: { themeId: 'ship', by: 'owner', at: t0 } }, parents: {}, folders: {} }));
    fs.writeFileSync(files.labels, JSON.stringify({ [oldKey]: { sig: 's', text: 'x', at: 1 } }));
    const remoteHost = 'nexus-test.example.ts.net', remoteUser = 'owner@example.com';
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: Number(PORT), recentDays: 40, sessionLabels: false, themeSorting: false, remoteHost, remoteUser, models: { [OLD]: [{ id: 'gpt-6-' + OLD, label: 'Six' }] } }));
    const original = { state: fs.readFileSync(files.state), themes: fs.readFileSync(files.themes), labels: fs.readFileSync(files.labels) };
    const env = { ...process.env, NEXUS_PORT: PORT, NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_LABELS: 'off', NEXUS_ASR_DISABLED: '1', NEXUS_TEST_TERMINALS: '1', LOCALAPPDATA: root,
      NEXUS_CLAUDE_DIR: path.join(root, 'claude'), NEXUS_CODEX_DIR: path.join(root, 'codex'), NEXUS_COPILOT_DIR: path.join(root, 'copilot'),
      NEXUS_CONFIG_FILE: path.join(root, 'config.json'), NEXUS_STATE_FILE: files.state, NEXUS_THEMES_FILE: files.themes,
      NEXUS_DEVICES_FILE: path.join(root, 'devices.json'), NEXUS_UPLOAD_DIR: path.join(root, 'uploads'), CODEX_RENAME_PRELOAD: '1', CODEX_RENAME_ROOT: root };
    delete env.NEXUS_READ_ONLY;
    const request = (route, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const r = http.request({ host: '127.0.0.1', port: Number(PORT), path: route, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers }, timeout: 20000 }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', c => text += c); res.on('end', () => { let json; try { json = JSON.parse(text); } catch { } resolve({ status: res.statusCode, text, json, headers: res.headers }); });
      });
      r.on('error', reject); r.on('timeout', () => r.destroy(Error('timeout ' + route))); if (data) r.write(data); r.end();
    });
    const local = { 'X-Nexus': '1' }, post = (route, body, headers = local) => request(route, { method: 'POST', headers, body });
    const sent = [];
    const track = r => { sent.push(r); return r; };
    // The configured model id holds the old word on purpose; every other old word in an answer is a leftover.
    const oldWordOutsideModelIds = t => t.replace(/\bgpt-[\w.]+(?:-[\w.]+)*-astra\b/gi, '').replace(/\bGPT-[\w.]+ Astra\b/g, '').match(/astra/i);
    let server;
    const startServer = async () => {
      let out = '';
      server = spawn(process.execPath, ['-r', __filename, 'server.js'], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      server.stdout.on('data', d => out += d); server.stderr.on('data', d => out += d);
      for (let i = 0; !out.includes(':' + PORT + '/'); i++) { if (i > 120 || server.exitCode !== null) throw Error('server did not start: ' + out.slice(-600)); await new Promise(r => setTimeout(r, 250)); }
    };
    const stopServer = async () => { if (server && server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; } server = null; };
    try {
      await startServer();
      for (const k of ['state', 'themes']) assert.ok(fs.readFileSync(files[k] + legacy.BACKUP).equals(original[k]), k + ' was not migrated with a backup');
      assert.ok(fs.readFileSync(files.labels).equals(original.labels) && !fs.existsSync(files.labels + legacy.BACKUP), 'a fixture server touched labels.json');
      let list; for (let i = 0; i < 40; i++) { list = track(await request('/api/sessions', { headers: local })); if (list.json?.sessions?.some(s => s.id === id)) break; await new Promise(r => setTimeout(r, 250)); }
      const s = list.json.sessions.find(x => x.id === id); assert.ok(s, 'the Codex session is listed');
      assert.equal(s.kind, 'codex'); assert.ok(list.json.agents?.codex && !(OLD in list.json.agents), 'agents keyed by codex');
      if (list.json.usage) assert.ok(!(OLD in list.json.usage), 'usage keyed by the old kind');
      const modelsAnswer = track(await request('/api/models', { headers: local }));
      assert.ok(modelsAnswer.json.codex.some(m => m.id === 'gpt-6-' + OLD), 'the configured Codex model comes from the old config key'); assert.ok(!(OLD in modelsAnswer.json));
      for (const route of ['/api/chat?key=', '/api/transcript?key=', '/api/recap?key=', '/api/commands?key=', '/api/queue?key=']) {
        const a = track(await request(route + encodeURIComponent(oldKey), { headers: local })), b = track(await request(route + encodeURIComponent(newKey), { headers: local }));
        assert.equal(a.status, 200, route + ' with the old key: ' + a.text.slice(0, 200)); assert.equal(a.status, b.status, route);
        // Read times and cache counters differ between two reads; everything else must be the same.
        const strip = t => JSON.stringify(JSON.parse(t), (k, v) => ['capturedAt', 'bytesRead', 'now', 'at', 'generatedAt', 'took', 'ms'].includes(k) ? undefined : v);
        assert.equal(strip(a.text), strip(b.text), route + ' answers differently for the old key');
      }
      const pv = await request('/preview/' + encodeURIComponent(oldKey) + '/page.html'), pn = await request('/preview/' + encodeURIComponent(newKey) + '/page.html');
      assert.equal(pv.status, 200); assert.equal(pv.text, pn.text);
      const viewed = track(await post('/api/action', { action: 'viewed', key: oldKey, at: Date.now() }));
      assert.equal(viewed.status, 200, viewed.text);
      const st = JSON.parse(fs.readFileSync(files.state, 'utf8')); assert.ok(st.viewed[newKey] && !(oldKey in st.viewed), 'viewed is stored under the new key');
      const assigned = track(await post('/api/themes/assign', { keys: [oldKey], themeId: 'ship' })); assert.equal(assigned.status, 200, assigned.text);
      const th = JSON.parse(fs.readFileSync(files.themes, 'utf8')); assert.ok(th.assignments[newKey] && !(oldKey in th.assignments));
      // The glasses app's call: the old action name opens a (stub) Codex terminal.
      const opened = track(await post('/api/action', { action: 'term-new-' + OLD, cwd }));
      assert.equal(opened.status, 200, opened.text);
      const terms = track(await request('/api/sessions', { headers: local })).json.terms || [];
      assert.ok(terms.some(t => t.kind === 'codex'), 'a Codex terminal was opened: ' + JSON.stringify(terms.map(t => t.kind)));
      const log = fs.readFileSync(path.join(root, 'stub-log.jsonl'), 'utf8'); assert.ok(log.includes('"stub-codex"'));
      // new-<old> is refused in test mode exactly like new-codex.
      const refusedOld = track(await post('/api/action', { action: 'new-' + OLD, key: oldKey })), refusedNew = track(await post('/api/action', { action: 'new-codex', key: newKey }));
      assert.equal(refusedOld.status, 400); assert.equal(refusedOld.text, refusedNew.text); assert.match(refusedOld.text, /disabled in test mode/);
      // From a paired phone both names are PC-only.
      const remote = { Host: remoteHost, 'X-Forwarded-For': '100.64.0.7', 'Tailscale-User-Login': remoteUser };
      const code = (await post('/api/pair/new', {})).json;
      const paired = await post('/api/pair', { code: code.code, name: 'Rename test phone' }, { ...remote, 'X-Nexus': '1' }); assert.equal(paired.status, 200, paired.text);
      const cookie = String(paired.headers['set-cookie']).split(';')[0];
      for (const action of ['new-' + OLD, 'new-codex']) assert.equal((await post('/api/action', { action, key: oldKey }, { ...remote, Cookie: cookie, 'X-Nexus': '1' })).status, 403, action + ' from a phone');
      for (const r of sent) assert.ok(!oldWordOutsideModelIds(r.text), 'an answer holds the old word: ' + r.text.slice(Math.max(0, r.text.search(/astra/i) - 80), r.text.search(/astra/i) + 40));
      // The page: old browser storage is migrated when the new page loads (headless Chrome, its own temp profile).
      const out = path.join(root, 'tour'); fs.mkdirSync(out);
      const seed = { 'nexus.place': JSON.stringify({ view: 'overview', key: oldKey, tab: 'chat', group: OLD + ' group' }), ['nexus.new-model-' + OLD]: 'gpt-6-' + OLD, 'nexus.prefs': JSON.stringify({ slashUsage: { [OLD]: { '/review': { count: 2, at: 5 } } }, slashUsageIds: [] }) };
      const read = `JSON.stringify({place:localStorage.getItem('nexus.place'),oldModel:localStorage.getItem('nexus.new-model-${OLD}'),model:localStorage.getItem('nexus.new-model-codex'),prefs:localStorage.getItem('nexus.prefs'),color:getComputedStyle(document.documentElement).getPropertyValue('--agent-codex').trim()})`;
      fs.writeFileSync(path.join(out, 'steps.json'), JSON.stringify([
        { until: `typeof state!=='undefined'&&state.byKey&&state.byKey.size>0` },
        { js: `localStorage.clear();const seed=${JSON.stringify(seed)};for(const k in seed)localStorage.setItem(k,seed[k]);'seeded'` },
        { navigate: '/' }, { until: `typeof state!=='undefined'&&state.byKey&&state.byKey.size>0` }, { js: read }]));
      const tour = spawnSync(process.execPath, [path.join(repo, 'tools', 'cdp-tour.mjs'), out], { cwd: repo, env: { ...process.env, NEXUS_PORT: PORT, NEXUS_WIDTH: '1920', NEXUS_HEIGHT: '1080' }, encoding: 'utf8', windowsHide: true, timeout: 120000 });
      const line = (tour.stdout || '').split('\n').filter(l => l.startsWith('JS "')).at(-1);
      if (!line) throw Error('the browser run gave no result: ' + (tour.stdout || '').slice(-600) + (tour.stderr || '').slice(-400));
      const page = JSON.parse(JSON.parse(line.slice(3)));
      assert.equal(JSON.parse(page.place).key, newKey); assert.equal(JSON.parse(page.place).group, OLD + ' group');
      assert.equal(page.oldModel, null); assert.equal(page.model, 'gpt-6-' + OLD);
      assert.deepEqual(JSON.parse(page.prefs).slashUsage, { codex: { '/review': { count: 2, at: 5 } } });
      assert.ok(page.color, 'the page defines --agent-codex');
      // A second start changes no store.
      await stopServer();
      const snap = () => ['state.json', 'themes.json', 'state.json' + legacy.BACKUP, 'themes.json' + legacy.BACKUP].map(n => { const f = path.join(root, n); return n + ':' + fs.statSync(f).mtimeMs + ':' + fs.readFileSync(f).toString('base64'); }).concat(fs.readdirSync(root).filter(n => n.endsWith(legacy.BACKUP)).sort());
      const before = snap(); await startServer(); await request('/api/sessions', { headers: local }); assert.deepEqual(snap(), before, 'a second start changed a store');
    } finally { await stopServer(); }
  });

  for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { }
  console.log(failures ? failures + ' group(s) failed' : 'codex rename checks: all groups pass');
  process.exitCode = failures ? 1 : 0;
})();
