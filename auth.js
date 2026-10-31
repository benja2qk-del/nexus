// Remote access guard. The PC itself (a direct request to 127.0.0.1 / localhost) is trusted as before.
// Anything that arrives through `tailscale serve` must (1) come from the owner's tailnet login, which
// Tailscale asserts in its identity headers, and (2) carry a paired-device token, issued once in exchange
// for a short one-time code generated on the PC.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NexusDeck');
const FILE = process.env.NEXUS_DEVICES_FILE || path.join(DIR, 'devices.json');
const COOKIE = 'nexus_device';
const CODE_TTL = 10 * 60e3;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: read off a phone screen

let cfg = { remoteHost: '', remoteUser: '' };
let devices = load();
const codes = new Map(); // sha256(code) -> expiry
const pairings = new Map(); // opaque PC-only receipt -> code hash / result
const failures = [];     // timestamps of failed redemptions (global limit)

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(devices, null, 2));
  fs.renameSync(tmp, FILE);
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function configure(c) { cfg = { remoteHost: (c.remoteHost || '').toLowerCase(), remoteUser: (c.remoteUser || '').toLowerCase() }; }

// A request counts as remote if anything about it says it was proxied, whatever its Host says.
function isRemote(req) {
  const h = req.headers;
  const host = (h.host || '').split(':')[0].toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') return true;
  return !!(h['x-forwarded-for'] || h['x-forwarded-host'] || h['x-forwarded-proto'] || h['tailscale-user-login'] || h['tailscale-headers-info'] || h.forwarded);
}

// Remote requests must name our tailnet host and carry our tailnet identity.
function tailnetOk(req) {
  if (!cfg.remoteHost || !cfg.remoteUser) return false;
  const h = req.headers;
  const host = (h['x-forwarded-host'] || h.host || '').split(':')[0].toLowerCase();
  return host === cfg.remoteHost && (h['tailscale-user-login'] || '').toLowerCase() === cfg.remoteUser;
}

function cookieToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{20,})'));
  return m ? m[1] : null;
}

function deviceFor(req) {
  const t = cookieToken(req);
  if (!t) return null;
  const id = sha(t);
  const d = devices[id];
  if (!d) return null;
  if (Date.now() - (d.lastSeen || 0) > 60e3) { d.lastSeen = Date.now(); try { save(); } catch { } }
  return { id, ...d };
}

function newCode() {
  let code = '';
  for (const b of crypto.randomBytes(8)) code += ALPHABET[b % ALPHABET.length];
  const now = Date.now();
  for (const [k, exp] of codes) if (exp < now) codes.delete(k);
  for (const [id, p] of pairings) if (p.expiresAt + CODE_TTL < now) pairings.delete(id);
  codes.set(sha(code), now + CODE_TTL);
  const pairingId = crypto.randomBytes(24).toString('hex');
  pairings.set(pairingId, { hash:sha(code), expiresAt:now + CODE_TTL });
  return { code: code.slice(0, 4) + '-' + code.slice(4), expiresAt: now + CODE_TTL, pairingId };
}

// Returns a device token for a valid unused code, or throws. At most 8 failures per 15 minutes overall.
function redeem(code, name) {
  const now = Date.now();
  while (failures.length && now - failures[0] > 15 * 60e3) failures.shift();
  if (failures.length >= 8) throw new Error('Too many attempts. Wait 15 minutes and ask for a new code.');
  const key = sha(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const exp = codes.get(key);
  if (!exp || exp < now) { failures.push(now); throw new Error('That code is wrong or has expired.'); }
  const token = crypto.randomBytes(32).toString('base64url');
  devices[sha(token)] = { name: String(name || 'Device').slice(0, 60), created: now, lastSeen: now };
  try { save(); } catch (e) { delete devices[sha(token)]; throw e; }
  codes.delete(key);
  for (const p of pairings.values()) if (p.hash === key) p.device = {name:devices[sha(token)].name,created:now};
  return token;
}

function pairingStatus(id) {
  const p = pairings.get(id);
  if (!p) return {state:'expired'};
  return p.device ? {state:'paired',device:p.device} : {state:Date.now()>=p.expiresAt?'expired':'waiting',expiresAt:p.expiresAt};
}

function cookieHeader(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`;
}

function list() { return Object.entries(devices).map(([id, d]) => ({ id: id.slice(0, 12), ...d })); }
function revoke(idPrefix) {
  if (typeof idPrefix !== 'string' || !/^[a-f0-9]{12,64}$/.test(idPrefix)) return false;
  const ids = Object.keys(devices).filter(k => k.startsWith(idPrefix));
  if (ids.length !== 1) return false;
  const id = ids[0], previous = devices[id];
  delete devices[id];
  try { save(); } catch (e) { devices[id] = previous; throw e; }
  return true;
}

module.exports = { configure, isRemote, tailnetOk, deviceFor, newCode, redeem, cookieHeader, list, revoke, pairingStatus };
