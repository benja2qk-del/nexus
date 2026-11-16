// Sessions that live inside WSL (Ubuntu or another distro). NEXUS runs on Windows, but a CLI started in a WSL shell
// records a Linux folder and keeps its files in the distro's home. Resuming it with the Windows CLI finds no session and
// exits at once ("Session ended" again after every Resume), so a WSL session runs in its distro, with that distro's CLI.
'use strict';
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');

const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');

// Where a folder is: \\wsl.localhost\<distro>\... or \\wsl$\<distro>\..., or a Linux path (Git Bash's /c/... is Windows).
// distro '' is the default distro. Anything else is a Windows folder: null.
function locate(folder, distro = '') {
  const p = String(folder || '');
  const unc = /^\\\\wsl(?:\$|\.localhost)\\([^\\/]+)([\\/].*)?$/i.exec(p);
  if (unc) return { distro: unc[1], cwd: (unc[2] || '/').replace(/\\/g, '/') };
  if (p.startsWith('/') && !/^\/[a-z](?:\/|$)/i.test(p)) return { distro: distro || '', cwd: p };
  return null;
}

// One word for a POSIX shell: single-quoted. A Windows path becomes its WSL path ($(wslpath -u ...)), so folders NEXUS
// adds (--add-dir, the hand-off instructions) are the same folders inside WSL.
const quote = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
function word(s) {
  const v = String(s), inside = locate(v);
  if (inside && /^\\\\/.test(v)) return quote(inside.cwd);
  if (/^[a-z]:[\\/]/i.test(v)) return '"$(wslpath -u ' + quote(v) + ')"';
  return quote(v);
}
// The command that runs a CLI in WSL. The owner's login shell (bash or zsh, interactive) gives the PATH their own
// terminal has (nvm, ~/.local/bin). A folder that is missing in the distro is said on screen, and the home folder is used.
// exec replaces the shell, so the terminal ends when the CLI ends, and its last line says why.
function launch(name, args, where, env = {}, { exe = WSL_EXE, exists = fs.existsSync } = {}) {
  if (!exists(exe)) throw Error('WSL is not installed on this PC, so a WSL session cannot be opened here.');
  // A comma list of folders (COPILOT_CUSTOM_INSTRUCTIONS_DIRS) is translated folder by folder; the quoted parts and
  // the commas between them make one shell word.
  const exports = Object.entries(env).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
    .map(([k, v]) => 'export ' + k + '=' + String(v).split(',').map(word).join(',') + '; ');
  const place = where.distro || 'WSL';
  const cd = where.cwd ? 'cd -- ' + quote(where.cwd) + " 2>/dev/null || { printf '%s\\n' " + quote('NEXUS: ' + where.cwd + ' is not a folder in ' + place + '; starting in your home folder.') + '; cd; }; ' : 'cd; ';
  const script = cd + exports.join('') + 'exec ' + [name, ...args].map(word).join(' ');
  const runner = 'case "${SHELL##*/}" in bash|zsh) s="$SHELL";; *) s=bash;; esac; exec "$s" -lic "$1"';
  return { file: exe, args: [...(where.distro ? ['-d', where.distro] : []), '-e', 'sh', '-c', runner, 'nexus', script] };
}

// wsl.exe writes UTF-16 unless WSL_UTF8 is set.
function names(out) {
  const b = Buffer.isBuffer(out) ? out : Buffer.from(String(out || ''));
  const text = b.includes(0) ? b.toString('utf16le') : b.toString('utf8');
  return text.replace(/\uFEFF/g, '').split(/\r?\n/).map(l => l.replace(/\0/g, '').trim()).filter(Boolean).filter(d => !/^docker-desktop/i.test(d));
}

// The Copilot folders of the distros that are running. Found in the background (wsl.exe and the \\wsl.localhost
// reads never block a list poll); a distro that is not running is not started by NEXUS.
// A PC with no distro registered (wsl.exe is on every Windows 11, WSL or not) is asked again only every ten minutes, and
// wsl.exe is never run there.
function createHomes({ exe = WSL_EXE, every = 60e3, idle = 10 * 60e3, run = execFile, fsp = fs.promises, now = Date.now } = {}) {
  let homes = [], busy = false, at = 0, wait = every;
  const ask = (file, args, encoding) => new Promise(done => run(file, args, { windowsHide: true, encoding, timeout: 8000 }, (e, stdout) => done(e ? null : stdout)));
  async function refresh() {
    busy = true;
    try {
      const registry = fs.existsSync(exe) && await ask('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'], 'utf8');
      wait = registry && /\\Lxss\\\{/i.test(registry) ? every : idle;
      if (wait === idle) { homes = []; return; }
      const out = await ask(exe, ['-l', '-q', '--running'], 'buffer');
      if (!out) { homes = []; return; }
      const found = [];
      for (const distro of names(out)) {
        for (const host of ['\\\\wsl.localhost\\', '\\\\wsl$\\']) {
          const base = host + distro;let users;
          try { users = (await fsp.readdir(base + '\\home', { withFileTypes: true })).filter(e => e.isDirectory()).map(e => base + '\\home\\' + e.name); } catch { continue; }
          for (const home of [...users, base + '\\root']) { const root = home + '\\.copilot'; try { await fsp.access(path.join(root, 'session-state')); found.push({ distro, root }); } catch {} }
          break;
        }
      }
      homes = found;
    } catch { homes = []; } finally { busy = false; at = now(); }
  }
  return { get() { if (!busy && now() - at >= wait) refresh(); return homes; }, refresh };
}

// Copilot sessions in WSL. Which session folders are recent is found in the background, so a list poll reads only
// those, over the \\wsl.localhost share, and at most every few seconds.
function createSessions({ homes = 'auto', discover, recentEvery = 15e3, rowsEvery = 3e3, fsp = fs.promises, now = Date.now, ...options } = {}) {
  const finder = homes === 'auto' ? createHomes({ now, fsp, ...options }) : { get: () => homes || [] };
  const roots = new Map();
  async function recent(root, entry, days) {
    entry.busy = true;
    try {
      const dir = path.join(root, 'session-state'), cutoff = now() - days * 864e5, keep = [];
      for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        let newest = 0;
        for (const f of ['events.jsonl', 'workspace.yaml']) { try { newest = Math.max(newest, (await fsp.stat(path.join(dir, e.name, f))).mtimeMs); } catch {} }
        if (newest >= cutoff) keep.push(e.name);
      }
      entry.names = keep;
    } catch { entry.names = []; } finally { entry.busy = false; entry.at = now(); entry.rowsAt = 0; }
  }
  function copilot(days, projectOf) {
    const out = [];
    for (const h of finder.get()) {
      let entry = roots.get(h.root);
      if (!entry) roots.set(h.root, entry = { discover: discover(), names: null, at: 0, days: 0, rows: [], rowsAt: 0, busy: false });
      if (!entry.busy && (now() - entry.at >= recentEvery || days > entry.days)) { entry.days = days; recent(h.root, entry, days); }
      if (!entry.names) continue;
      if (now() - entry.rowsAt >= rowsEvery) { entry.rows = entry.discover(h.root, days, projectOf, entry.names).map(s => ({ ...s, wsl: h.distro })); entry.rowsAt = now(); }
      out.push(...entry.rows);
    }
    return out;
  }
  // A session just started in WSL: look for its folder at the next poll.
  function soon() { for (const entry of roots.values()) { entry.at = 0; entry.rowsAt = 0; } }
  return { copilot, soon };
}

module.exports = { WSL_EXE, locate, launch, quote, word, names, createHomes, createSessions };
