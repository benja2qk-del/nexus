// Pictures in a conversation: transcripts hold them as base64, so Chat gets a name and fetches the file once.
// Everything here can be rebuilt from the transcript, so old files are simply dropped.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

const UPLOADS = path.resolve(process.env.NEXUS_UPLOAD_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NexusDeck', 'uploads'));
const DIR = path.join(path.dirname(UPLOADS), 'chat-images');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const EXTENSIONS = Object.fromEntries(Object.entries(TYPES).map(([ext, type]) => [type, ext]));
const MAX_AGE = 30 * 864e5;
const known = new Set(), uploaded = new Map();
let pruned = false;

function prune() {
  if (pruned) return;
  pruned = true;
  try {
    for (const name of fs.readdirSync(DIR)) {
      const file = path.join(DIR, name);
      if (Date.now() - fs.statSync(file).mtimeMs > MAX_AGE) fs.rmSync(file, { force: true });
    }
  } catch { }
}
function store(name, write) {
  if (known.has(name)) return name;
  try {
    prune();
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, name);
    if (!fs.existsSync(file)) write(file);
    known.add(name);
    return name;
  } catch { return null; }
}
// source is the block's `source` from the transcript.
function fromBlock(source) {
  const ext = EXTENSIONS[source?.media_type];
  if (source?.type !== 'base64' || !ext || typeof source.data !== 'string') return null;
  const name = createHash('sha256').update(source.data).digest('hex').slice(0, 32) + ext;
  return store(name, file => fs.writeFileSync(file, Buffer.from(source.data, 'base64')));
}
function fromUpload(raw) {
  const target = path.resolve(raw), ext = path.extname(target).toLowerCase().replace('.jpeg', '.jpg');
  if (uploaded.has(target)) return uploaded.get(target);
  // Only files the owner sent through NEXUS: a transcript must not be able to expose other files.
  if (!TYPES[ext] || !target.toLowerCase().startsWith(UPLOADS.toLowerCase() + path.sep) || !fs.existsSync(target)) return null;
  const name = createHash('sha256').update(target).digest('hex').slice(0, 32) + ext;
  const saved = store(name, file => fs.copyFileSync(target, file));
  uploaded.set(target, saved);
  return saved;
}
// Images NEXUS attached to a message, written as @"path" in its text.
function fromText(text) {
  const names = [];
  for (const match of String(text || '').matchAll(/@"([^"\r\n]+)"/g)) {
    const name = fromUpload(match[1]);
    if (name) names.push(name);
  }
  return names;
}
function file(name) {
  if (!/^[0-9a-f]{32}\.(?:png|jpg|gif|webp)$/.test(name || '')) return null;
  const target = path.join(DIR, name);
  return fs.existsSync(target) ? { path: target, type: TYPES[path.extname(name)] } : null;
}
module.exports = { fromBlock, fromText, file };
