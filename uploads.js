// Write-only attachment storage. Requests reach here only after the normal API guard.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Transform, pipeline } = require('stream');

const MAX_FILE = 50 * 1024 * 1024;
const MAX_DAY = 200 * 1024 * 1024;
const ROOT = path.resolve(process.env.NEXUS_UPLOAD_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NexusDeck', 'uploads'));
const fail = (status, message) => Object.assign(new Error(message), { status });
const dayOf = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let ledger;

function filename(raw) {
  if (typeof raw !== 'string' || !raw) throw fail(400, 'Choose a file with a name.');
  let name;
  try { name = decodeURIComponent(raw); } catch { throw fail(400, 'The file name could not be read. Choose the file again.'); }
  name = path.win32.basename(name.replace(/\//g, '\\')).replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/[. ]+$/g, '');
  if (!name || /^\.+$/.test(name)) name = 'attachment';
  if (/^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:[. ]|$)/i.test(name)) name = '_' + name;
  const ext = path.extname(name).slice(0, 20);
  const stem = name.slice(0, name.length - path.extname(name).length);
  name = Array.from(stem).slice(0, 100 - ext.length).join('') + ext;
  return name.replace(/[. ]+$/g, '') || 'attachment';
}

function within(root, file) {
  const relative = path.relative(root, path.resolve(file));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw fail(400, 'Invalid upload destination.');
  return file;
}

function directory(day) {
  fs.mkdirSync(ROOT, { recursive: true });
  const root = fs.realpathSync(ROOT);
  const dir = within(root, path.join(root, day));
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink()) throw fail(500, 'The upload folder is unavailable.');
  within(root, fs.realpathSync(dir));
  return dir;
}

// Reserve bytes before reading, including concurrent uploads. Persist reservations so
// restarting the server cannot reset either limit. Interrupted process reservations
// remain charged until tomorrow; completed/aborted requests settle to bytes received.
function saveLedger() {
  const file = path.join(ROOT, '.limits.json');
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(ledger), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}

function reserve(device, day, length) {
  if (!ledger) {
    try {
      const file = path.join(ROOT, '.limits.json');
      if (fs.lstatSync(file).isSymbolicLink()) throw Error('Invalid limits file');
      ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) throw Error('Invalid limits');
    } catch (e) { if (e.code === 'ENOENT') ledger = {}; else { ledger = undefined; throw fail(503, 'Upload limits could not be checked. Try again later.'); } }
  }
  const now = Date.now();
  for (const [key, entry] of Object.entries(ledger)) if (entry.day !== day && (entry.starts.at(-1) || 0) < now - 60000) delete ledger[key];
  const key = day + ':' + device;
  const entry = ledger[key] ||= { day, bytes: 0, starts: [] };
  const starts = Object.entries(ledger).filter(([k]) => k.endsWith(':' + device)).flatMap(([, e]) => e.starts).filter(t => t > now - 60000);
  if (starts.length >= 10) throw fail(429, 'Ten files in a minute is the limit. Wait a minute, then attach again.');
  const available = MAX_DAY - entry.bytes;
  const budget = length === null ? Math.min(MAX_FILE, available) : length;
  if (available <= 0 || budget > available) throw fail(429, 'This device has reached its 200 MB upload allowance for today. Try tomorrow.');
  entry.starts = entry.starts.filter(t => t > now - 60000);
  entry.starts.push(now); entry.bytes += budget;
  try { saveLedger(); } catch { entry.bytes -= budget; entry.starts.pop(); throw fail(503, 'Upload limits could not be saved. Try again later.'); }
  let settled = false;
  return { budget, settle(received) {
    if (settled) return;
    const previous = entry.bytes;
    entry.bytes -= budget - Math.min(received, budget);
    try { saveLedger(); settled = true; } catch (e) { entry.bytes = previous; throw e; }
  } };
}

function store(req, temporary, quota) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_FILE) return callback(fail(413, 'That file is too large. Choose a file or shorter video under 50 MB.'));
      if (received > quota.budget) return callback(fail(429, 'This device has reached its 200 MB upload allowance for today. Try tomorrow.'));
      callback(null, chunk);
    } });
    const output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    const abort = () => meter.destroy(fail(400, 'Upload interrupted. Choose the file again.'));
    req.once('aborted', abort); req.once('error', abort);
    // Exclude the request from pipeline: a size failure can still return useful JSON.
    pipeline(meter, output, error => {
      req.unpipe(meter); req.removeListener('aborted', abort); req.removeListener('error', abort);
      if (error) { req.pause(); error.received = received; reject(error); }
      else resolve(received);
    });
    if (req.aborted || req.destroyed) abort(); else req.pipe(meter);
  });
}

async function upload(req, res, device, stillAuthorized) {
  let temporary, quota, received = 0;
  const reply = (status, body) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status >= 400 ? { Connection: 'close' } : {}) });
    res.end(JSON.stringify(body));
  };
  try {
    const name = filename(req.headers['x-nexus-filename']);
    const header = req.headers['content-length'];
    const length = header === undefined ? null : Number(header);
    if (length !== null && (!Number.isSafeInteger(length) || length < 0)) throw fail(400, 'Invalid file size.');
    if (length > MAX_FILE) throw fail(413, 'That file is too large. Choose a file or shorter video under 50 MB.');
    const day = dayOf(), dir = directory(day);
    quota = reserve(device, day, length);
    temporary = within(dir, path.join(dir, '.upload-' + crypto.randomUUID() + '.tmp'));
    received = await store(req, temporary, quota);
    if (req.aborted || !stillAuthorized()) throw fail(401, 'Pair this device again before uploading.');
    directory(day); // Recheck containment before the atomic rename.
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    let final = within(dir, path.join(dir, name)), n = 2;
    // Synchronous selection + rename cannot interleave with another upload completion.
    while (fs.existsSync(final)) final = within(dir, path.join(dir, `${stem} (${n++})${ext}`));
    quota.settle(received); quota = null;
    fs.renameSync(temporary, final); temporary = null;
    reply(200, { path: final, name: path.basename(final), size: received });
  } catch (error) {
    if (temporary) { try { await fs.promises.unlink(temporary); } catch {} }
    if (quota) { try { quota.settle(error.received ?? received); } catch {} }
    reply(error.status || 500, { error: error.status ? error.message : 'The PC could not save this file. Check free space and try again.' });
  }
}

module.exports = { upload, filename, MAX_FILE, MAX_DAY };
