// Finds where a file dropped onto the composer lives on this PC. Browsers hide dropped paths, so this
// matches the name, size and modified time the browser does report: the usual folders first, then the
// Windows Search index, then a short bounded walk. It only reads metadata and never opens a file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SKIP = new Set(['node_modules', '.git', 'AppData', '$Recycle.Bin', 'System Volume Information', '__pycache__', '.venv', 'venv', '.cache', '.npm', '.gradle', '.nuget']);
const SCAN_DIRS = 40000, SCAN_MS = 2500, INDEX_MS = 4000;

function validRequest(b) {
  if (!b || typeof b.name !== 'string' || !b.name || b.name.length > 260 || /[\\/:*?"<>|\0]/.test(b.name) || b.name === '.' || b.name === '..') throw Error('Unknown file name.');
  const size = Number(b.size), modified = Number(b.lastModified);
  return { name: b.name, dir: b.dir === true, size: Number.isFinite(size) && size >= 0 ? size : null, modified: Number.isFinite(modified) && modified > 0 ? modified : null, cwd: typeof b.cwd === 'string' && path.isAbsolute(b.cwd) ? b.cwd : '' };
}

function roots(cwd, home = os.homedir()) {
  const list = [];
  const add = dir => { if (dir && !list.some(x => x.toLowerCase() === dir.toLowerCase())) list.push(dir); };
  add(cwd);
  for (const name of ['Downloads', 'Desktop', 'Documents']) add(path.join(home, name));
  let entries = [];
  try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch {}
  for (const e of entries) if (e.isDirectory() && /^OneDrive/i.test(e.name)) for (const sub of ['', 'Desktop', 'Documents', 'Downloads']) add(path.join(home, e.name, sub));
  for (const name of ['Pictures', 'Videos', 'Music']) add(path.join(home, name));
  add(home);
  return list;
}

// A candidate matches on kind and size; the modified time breaks ties between copies with the same size.
function score(file, want) {
  let st; try { st = fs.statSync(file); } catch { return -1; }
  if (want.dir ? !st.isDirectory() : !st.isFile()) return -1;
  if (path.basename(file).toLowerCase() !== want.name.toLowerCase()) return -1;
  if (!want.dir && want.size !== null && st.size !== want.size) return -1;
  return want.modified !== null && Math.abs(st.mtimeMs - want.modified) < 2000 ? 2 : 1;
}

function best(candidates, want) {
  let top = null, topScore = 0;
  for (const file of candidates) { const s = score(file, want); if (s > topScore) { top = file; topScore = s; if (s === 2) break; } }
  return top;
}

function searchIndex(name, size) {
  if (process.platform !== 'win32' || process.env.NEXUS_LOCATE_NO_INDEX === '1') return Promise.resolve([]);
  const script = "$n=$env:NEXUS_LOCATE_NAME -replace \"'\",\"''\";$c=New-Object -ComObject ADODB.Connection;$c.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows';\");$r=$c.Execute(\"SELECT TOP 20 System.ItemPathDisplay FROM SYSTEMINDEX WHERE System.FileName = '$n'$(if($env:NEXUS_LOCATE_SIZE){' AND System.Size = '+[int64]$env:NEXUS_LOCATE_SIZE}) ORDER BY System.DateModified DESC\");while(-not $r.EOF){$r.Fields.Item(0).Value;$r.MoveNext()}";
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: INDEX_MS, env: { ...process.env, NEXUS_LOCATE_NAME: name, NEXUS_LOCATE_SIZE: Number.isInteger(size) ? String(size) : '' } },
      (error, stdout) => resolve(error && !stdout ? [] : String(stdout || '').split(/\r?\n/).map(x => x.trim()).filter(x => path.isAbsolute(x))));
  });
}

async function walk(start, want, deadline, budget) {
  const queue = [[start, 0]];
  while (queue.length && budget.dirs > 0 && Date.now() < deadline) {
    const [dir, depth] = queue.shift(); budget.dirs--;
    let entries; try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.toLowerCase() === want.name.toLowerCase() && score(path.join(dir, e.name), want) > 0) return path.join(dir, e.name);
      if (e.isDirectory() && depth < 6 && !SKIP.has(e.name) && !e.name.startsWith('.')) queue.push([path.join(dir, e.name), depth + 1]);
    }
  }
  return null;
}

async function locate(body, options = {}) {
  const want = validRequest(body), home = options.home || os.homedir();
  const places = roots(want.cwd, home);
  const quick = best(places.map(dir => path.join(dir, want.name)), want);
  if (quick) return { path: quick, how: 'folder' };
  const indexed = best(await (options.index || searchIndex)(want.name, want.dir ? null : want.size), want);
  if (indexed) return { path: indexed, how: 'index' };
  const deadline = Date.now() + (options.scanMs ?? SCAN_MS), budget = { dirs: options.scanDirs ?? SCAN_DIRS };
  for (const start of [want.cwd, home].filter(Boolean)) {
    const found = await walk(start, want, deadline, budget);
    if (found) return { path: found, how: 'scan' };
  }
  return { path: null };
}

module.exports = { locate, roots, validRequest };
