'use strict';
// A session started in a WSL shell (Ubuntu) is listed, resumed and started in that distro, and a session that stops as it
// starts says why. Synthetic folders and stub terminals only: no WSL, no CLI, no window. A read-only server on 4837.
const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { spawnSync, spawn } = require('child_process'), { createRequire } = require('module');
const wsl = require('../wsl'), copilot = require('../copilot');
const repo = path.join(__dirname, '..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wsl-checks-'));
let failed = 0;
async function group(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); } }
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };
const at = n => new Date(Date.now() - 5 * 60e3 + n * 1000).toISOString(), rec = (type, data, n) => ({ type, data, timestamp: at(n) });
function session(home, id, cwd, rows, { age = 0, lock = 0 } = {}) {
  const dir = path.join(home, 'session-state', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), `id: ${id}\ncwd: ${JSON.stringify(cwd)}\ncreated_at: ${at(0)}\n`);
  if (lock) fs.writeFileSync(path.join(dir, 'inuse.' + lock + '.lock'), '');
  if (age) { const t = new Date(Date.now() - age); for (const f of ['events.jsonl', 'workspace.yaml']) fs.utimesSync(path.join(dir, f), t, t); }
}
const talk = (cwd, ask, reply) => [rec('session.start', { selectedModel: 'gpt-5-mini', context: { cwd } }, 0), rec('user.message', { content: ask }, 1),
  ...(reply ? [rec('assistant.message', { content: reply }, 2), rec('assistant.turn_end', { turnId: 't1' }, 3)] : [])];

(async () => {
  await group('a folder is placed in WSL by its path: \\\\wsl.localhost, \\\\wsl$ or Linux; Windows and Git Bash paths are Windows', () => {
    assert.deepEqual(wsl.locate('\\\\wsl.localhost\\Ubuntu\\home\\dev\\app'), { distro: 'Ubuntu', cwd: '/home/dev/app' });
    assert.deepEqual(wsl.locate('\\\\wsl$\\Debian'), { distro: 'Debian', cwd: '/' });
    assert.deepEqual(wsl.locate('/home/dev/app', 'Ubuntu-24.04'), { distro: 'Ubuntu-24.04', cwd: '/home/dev/app' });
    assert.deepEqual(wsl.locate('/mnt/c/work'), { distro: '', cwd: '/mnt/c/work' }, 'a Linux path with no distro runs in the default one');
    for (const p of ['C:\\work', 'c:/work', '/c/work', '/d', '\\\\server\\share\\x', '', null]) assert.equal(wsl.locate(p), null, String(p));
  });

  await group('wsl.exe runs the CLI in the distro, in the folder, through the login shell, with Windows folders translated', () => {
    const { file, args } = wsl.launch('copilot', ['--resume', 'ID-1', '--add-dir', 'C:\\Users\\dev\\notes'], { distro: 'Ubuntu', cwd: '/home/dev/app' },
      { COPILOT_CUSTOM_INSTRUCTIONS_DIRS: 'C:\\nexus\\handoff,/home/dev/own', 'BAD-NAME': 'x' }, { exe: 'C:\\Windows\\System32\\wsl.exe', exists: () => true });
    assert.equal(file, 'C:\\Windows\\System32\\wsl.exe');
    assert.deepEqual(args.slice(0, 5), ['-d', 'Ubuntu', '-e', 'sh', '-c']);
    const script = args.at(-1);
    assert.match(script, /^cd -- '\/home\/dev\/app' 2>\/dev\/null \|\| \{/, 'it starts in the session folder');
    assert.match(script, /exec 'copilot' '--resume' 'ID-1' '--add-dir' "\$\(wslpath -u 'C:\\Users\\dev\\notes'\)"$/);
    assert.match(script, /export COPILOT_CUSTOM_INSTRUCTIONS_DIRS="\$\(wslpath -u 'C:\\nexus\\handoff'\)",'\/home\/dev\/own'; /);
    assert.doesNotMatch(script, /BAD-NAME/, 'only valid variable names are exported');
    assert.equal(wsl.launch('codex', ['resume', 'x'], { distro: '', cwd: '/srv' }, {}, { exists: () => true }).args[0], '-e', 'the default distro has no -d');
    assert.throws(() => wsl.launch('copilot', [], { distro: 'Ubuntu', cwd: '/x' }, {}, { exists: () => false }), /WSL is not installed/);
  });

  await group('the launch words reach wsl.exe as written: node-pty quoting read back by the Windows argument rules', () => {
    const { argsToCommandLine } = require(require.resolve('@lydell/node-pty/windowsPtyAgent.js', { paths: [repo] }));
    const tricky = ['--resume', `it's "quoted" $HOME \`x\` \\ end\\`, 'C:\\Program Files\\x\\', 'two\nlines'];
    const { args } = wsl.launch('copilot', tricky, { distro: 'Ubuntu', cwd: "/home/dev/o'neil app" }, {}, { exists: () => true });
    const line = argsToCommandLine(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...args]);
    const out = spawnSync(process.execPath, [line.slice(argsToCommandLine(process.execPath, []).length + 1)], { argv0: 'node', windowsVerbatimArguments: true, encoding: 'utf8', windowsHide: true });
    assert.ok(out.stdout, 'node read the line: ' + out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), args);
  });

  const sh = ['C:\\Program Files\\Git\\bin\\sh.exe', 'C:\\Program Files (x86)\\Git\\bin\\sh.exe'].find(f => fs.existsSync(f));
  await group('the shell part runs the CLI with every argument intact, in the folder, and says when the folder is missing', () => {
    assert.ok(sh, 'Git for Windows sh.exe stands in for the distro shell');
    const bin = path.join(root, 'bin'), home = path.join(root, 'home'), proj = path.join(root, "o'neil app");
    for (const d of [bin, home, proj]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\nprintf "pwd=%s\\n" "$(pwd -W 2>/dev/null || pwd)"\nfor a in "$@"; do printf "arg=[%s]\\n" "$a"; done\nprintf "dirs=%s\\n" "$COPILOT_CUSTOM_INSTRUCTIONS_DIRS"\n');
    fs.writeFileSync(path.join(bin, 'wslpath'), '#!/bin/sh\nprintf "/mnt/x/%s" "$(printf "%s" "$2" | tr "\\\\\\\\:" "/_")"\n');
    const run = (cwd, args) => {
      const { args: a } = wsl.launch('copilot', args, { distro: 'Ubuntu', cwd }, { COPILOT_CUSTOM_INSTRUCTIONS_DIRS: 'C:\\nexus\\handoff' }, { exists: () => true });
      const r = spawnSync(sh, a.slice(a.indexOf('-c')), { encoding: 'utf8', windowsHide: true, timeout: 20000,
        env: { ...process.env, HOME: home, SHELL: '/usr/bin/bash', CHERE_INVOKING: '1', PATH: bin + path.delimiter + process.env.PATH } });
      return r.stdout + r.stderr;
    };
    const weird = `it's "quoted" $HOME \`x\` \\ end`;
    const ok = run(proj.replace(/\\/g, '/'), ['--resume', weird, 'C:\\Users\\dev\\notes']);
    assert.match(ok, new RegExp('pwd=' + proj.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'started in the session folder');
    assert.ok(ok.includes('arg=[--resume]') && ok.includes('arg=[' + weird + ']'), 'quotes, $ and backticks arrive as typed: ' + ok);
    assert.match(ok, /arg=\[\/mnt\/x\/C_\/Users\/dev\/notes\]/, 'a Windows folder argument is its WSL path');
    assert.match(ok, /dirs=\/mnt\/x\/C_\/nexus\/handoff/, 'the hand-off folder is exported as its WSL path');
    const missing = run('/no/such/folder', ['--resume', 'x']);
    assert.match(missing, /NEXUS: \/no\/such\/folder is not a folder in Ubuntu; starting in your home folder\./);
    assert.match(missing, new RegExp('pwd=' + home.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'and it starts in the home folder');
  });

  // terms.js over a stub PTY: what is spawned, where, and what an early exit leaves behind.
  const ptys = [], file = path.join(repo, 'terms.js'), mod = { exports: {} }, real = createRequire(file);
  const stub = { spawn(f, a, o) { const p = { f, a, o, pid: 5100 + ptys.length, write() {}, onData: fn => p.data = fn, onExit: fn => p.exit = fn, kill() {}, resize() {} }; ptys.push(p); return p; } };
  const agentsStub = { launch: (kind, args) => ({ file: 'windows-' + kind, args }), launchIn: (where, kind, args, env) => wsl.launch(kind, args, where, env, { exe: 'C:\\Windows\\System32\\wsl.exe', exists: () => true }) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: mod, exports: mod.exports, require: n => n === '@lydell/node-pty' ? stub : n === './agents' ? agentsStub : real(n),
    process: { env: { NEXUS_CLAUDE_DIR: path.join(root, 'no-claude') } }, setTimeout, clearTimeout, Buffer, console }, { filename: file });
  const terms = mod.exports;
  await group('Resume of a WSL Copilot session opens it in its distro; a Windows folder still uses the Windows CLI', () => {
    const t = terms.open({ kind: 'copilot', title: 'Fix the parser', cwd: '/home/dev/app', distro: 'Ubuntu', sessionKey: 'copilot:ID-1', copilotArgs: ['--resume', 'ID-1'] }), p = ptys.at(-1);
    assert.equal(p.f, 'C:\\Windows\\System32\\wsl.exe');
    assert.deepEqual(p.a.slice(0, 2), ['-d', 'Ubuntu']);
    assert.match(p.a.at(-1), /exec 'copilot' '--resume' 'ID-1'$/);
    assert.equal(p.o.cwd, os.homedir(), 'the Windows process starts in the home folder');
    const row = terms.list().find(x => x.id === t.id);
    assert.equal(row.cwd, '/home/dev/app'); assert.equal(row.wsl, 'Ubuntu');
    const unc = terms.open({ kind: 'copilot', title: 'New', cwd: '\\\\wsl.localhost\\Debian\\srv\\site', fresh: true, copilotArgs: [] }), q = ptys.at(-1);
    assert.deepEqual(q.a.slice(0, 2), ['-d', 'Debian'], 'a new session in a \\\\wsl.localhost folder starts in that distro');
    assert.match(q.a.at(-1), /^cd -- '\/srv\/site'/); assert.match(q.a.at(-1), /'--session-id' '[0-9a-f-]{36}'$/);
    const win = terms.open({ kind: 'copilot', title: 'Win', cwd: os.tmpdir(), sessionKey: 'copilot:W', copilotArgs: ['--resume', 'W'] }), w = ptys.at(-1);
    assert.equal(w.f, 'windows-copilot'); assert.equal(terms.list().find(x => x.id === win.id).wsl, undefined);
    terms.closeAll();
  });
  await group('a session that stops before its input box showed keeps the CLI\'s last lines; one that ran is not "early"', () => {
    const t = terms.open({ kind: 'copilot', title: 'Gone', cwd: '/home/dev/app', distro: 'Ubuntu', sessionKey: 'copilot:G', copilotArgs: ['--resume', 'G'] }), p = ptys.at(-1);
    p.data('Loading environment...\r\nbash: line 1: exec: copilot: not found\r\n'); p.exit({ exitCode: 127 });
    const x = terms.state(t.id, []).exited;
    assert.equal(x.code, 127); assert.equal(x.early, true); assert.match(x.last, /exec: copilot: not found$/);
    terms.closeAll();
  });

  await group('running distros are found without waking any, and a PC with no distro never runs wsl.exe', async () => {
    const calls = [], fsp = { readdir: async d => { calls.push('readdir ' + d); if (d === '\\\\wsl.localhost\\Ubuntu\\home') return [{ name: 'dev', isDirectory: () => true }]; throw Error('ENOENT'); },
      access: async p => { if (!/\\Ubuntu\\home\\dev\\\.copilot\\session-state$/.test(p)) throw Error('ENOENT'); } };
    const world = registry => (file, args, o, done) => { calls.push(path.basename(file) + ' ' + args.join(' ')); assert.equal(o.windowsHide, true, 'no window');
      if (file === 'reg.exe') return registry ? done(null, registry) : done(Object.assign(Error('missing'), { code: 1 }));
      done(null, Buffer.from('Ubuntu\r\ndocker-desktop\r\n', 'utf16le')); };
    const none = wsl.createHomes({ exe: process.execPath, run: world(''), fsp });
    await none.refresh(); assert.deepEqual(none.get(), []);
    assert.deepEqual(calls.splice(0), ['reg.exe query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'], 'only the registry is read');
    const some = wsl.createHomes({ exe: process.execPath, run: world('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{0b3c-guid}\r\n'), fsp });
    await some.refresh();
    assert.deepEqual(some.get(), [{ distro: 'Ubuntu', root: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\.copilot' }]);
    assert.ok(calls.includes('node.exe -l -q --running') || calls.some(c => / -l -q --running$/.test(c)), 'only running distros are listed: ' + calls);
    assert.ok(!calls.some(c => /docker-desktop/.test(c)), 'Docker\'s own distros are not read');
  });

  await group('WSL Copilot sessions are listed from the distro\'s home, marked with the distro, busy by recent activity, recent only', async () => {
    const home = path.join(root, 'ubuntu-home', '.copilot'), cwd = '/home/dev/app';
    session(home, '11111111-0000-4000-8000-000000000001', cwd, talk(cwd, 'Fix the parser', 'Fixed.'));
    // A Linux process number. Windows ignores a PID's low bits, so the check takes one no Windows process has now.
    session(home, '11111111-0000-4000-8000-000000000002', cwd, talk(cwd, 'Run the tests', ''), { lock: spawnSync(process.execPath, ['-e', '']).pid });
    session(home, '11111111-0000-4000-8000-000000000003', cwd, talk(cwd, 'Old work', 'Done.'), { age: 40 * 864e5 });
    const finder = wsl.createSessions({ homes: [{ distro: 'Ubuntu', root: home }], discover: () => copilot.createDiscovery({ foreignPids: true }), rowsEvery: 0 });
    const projectOf = x => path.posix.basename(x || '') || 'Unknown';
    const rows = await until(() => { const r = finder.copilot(10, projectOf); return r.length ? r : null; });
    assert.deepEqual(rows.map(s => s.id).sort(), ['11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002'], 'the 40-day-old one is not read');
    for (const s of rows) { assert.equal(s.wsl, 'Ubuntu'); assert.equal(s.cwd, cwd); assert.equal(s.group, 'app'); }
    const running = rows.find(s => s.id.endsWith('2'));
    assert.equal(running.status, 'busy', 'a Linux lock is not looked up as a Windows process; recent activity says it works');
    const windowsCheck = copilot.createDiscovery()(home, 10, projectOf).find(s => s.id.endsWith('2'));
    assert.notEqual(windowsCheck.status, 'busy', 'without foreignPids the same lock (no such Windows process) reads as abandoned');
  });

  await group('the server lists the WSL session once, with its distro, and its chat reads from the distro\'s files', async () => {
    const home = path.join(root, 'srv-ubuntu', '.copilot'), win = path.join(root, 'srv-windows-copilot'), cwd = '/home/dev/site', shared = '22222222-0000-4000-8000-000000000002';
    session(home, '22222222-0000-4000-8000-000000000001', cwd, talk(cwd, 'Make the header sticky', 'The header is sticky now.'));
    session(home, shared, cwd, talk(cwd, 'Shared folder', 'Once.'));
    session(win, shared, cwd, talk(cwd, 'Shared folder', 'Once.'));
    const state = path.join(root, 'srv-state'); fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ port: 4837, recentDays: 10, sessionLabels: false, themeSorting: false }));
    const env = { ...process.env, NEXUS_PORT: '4837', NEXUS_READ_ONLY: '1', NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_LABELS: 'off', NEXUS_ASR_DISABLED: '1',
      NEXUS_CONFIG_FILE: path.join(state, 'config.json'), NEXUS_STATE_FILE: path.join(state, 'state.json'), NEXUS_THEMES_FILE: path.join(state, 'themes.json'),
      NEXUS_DEVICES_FILE: path.join(state, 'devices.json'), NEXUS_UPLOAD_DIR: path.join(state, 'uploads'), NEXUS_CLAUDE_DIR: path.join(state, 'none'), NEXUS_CODEX_DIR: path.join(state, 'none'),
      NEXUS_COPILOT_DIR: win, NEXUS_WSL_HOMES: JSON.stringify([{ distro: 'Ubuntu', root: home }]) };
    const server = spawn(process.execPath, ['server.js'], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
    try {
      await until(() => log.includes(':4837/'), 20000).catch(() => { throw Error('server did not start: ' + log.slice(-300)); });
      const get = async p => (await fetch('http://127.0.0.1:4837' + p, { headers: { 'X-Nexus': '1' } })).json();
      const list = await until(async () => { const d = await get('/api/sessions'); return d.sessions.some(s => s.wsl) ? d.sessions : null; }, 15000);
      const mine = list.filter(s => s.kind === 'copilot');
      assert.equal(mine.filter(s => s.id === shared).length, 1, 'a session in a folder both sides see is one row');
      const row = mine.find(s => s.id === '22222222-0000-4000-8000-000000000001');
      assert.equal(row.wsl, 'Ubuntu'); assert.equal(row.cwd, cwd); assert.equal(row.file, undefined, 'file paths stay on the server');
      const chat = await get('/api/chat?key=' + encodeURIComponent('copilot:' + row.id));
      assert.deepEqual(chat.events.filter(e => e.t === 'user' || e.t === 'ai').map(e => [e.t, e.text]), [['user', 'Make the header sticky'], ['ai', 'The header is sticky now.']]);
    } finally { server.kill(); }
  });

  await group('the ended card names why a session stopped as it started, and is the usual card otherwise', () => {
    const src = fs.readFileSync(path.join(repo, 'public', 'onechat.js'), 'utf8'), fn = /function nxEndedNote\(terminal\)\{[\s\S]*?\n  return [^\r\n]*\}\r?\n/.exec(src)?.[0];
    assert.ok(fn, 'nxEndedNote is in onechat.js');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const note = vm.runInNewContext(fn + ';nxEndedNote', { esc, String });
    assert.equal(note({ exited: { early: true, last: 'Loading...\nError: No session found with ID <abc>' } }),
      '<b>The session stopped as it started</b><p>Loading... · Error: No session found with ID &lt;abc&gt;</p>');
    for (const t of [null, { exited: { early: false, last: 'Bye' } }, { exited: { early: true, last: '' } }]) assert.match(note(t), /^<b>Session ended<\/b><p>Your conversation is saved\. Resume to keep going\.<\/p>$/);
  });

  fs.rmSync(root, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
})();
