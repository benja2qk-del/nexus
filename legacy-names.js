'use strict';
// The one server module that still knows the agent's old name. NEXUS used to call the Codex CLI agent "Astra":
// kind 'astra', session keys 'astra:<id>', actions 'new-astra' and 'term-new-astra', config key models.astra.
// Everything else in NEXUS uses the new name only. This file accepts the old one at the edges:
//   - requests from older clients (the glasses app, a page left open): key(), action(), request(), query()
//   - the owner's existing config.json (models.astra): config()
//   - stores written by the old server: migrateStores(), run once at start-up before any store is read
// Model ids that contain the old word (gpt-6-astra) are model ids, never names: nothing here touches them.
const fs = require('fs'), path = require('path'), os = require('os');

const OLD = 'astra', NEW = 'codex', OLD_PREFIX = OLD + ':', NEW_PREFIX = NEW + ':';
const ACTIONS = { ['new-' + OLD]: 'new-' + NEW, ['term-new-' + OLD]: 'term-new-' + NEW };
const BACKUP = '.before-codex-rename.bak';

// ---------- the wire ----------
// 'astra:<id>' -> 'codex:<id>'; every other value as it is.
const key = k => typeof k === 'string' && k.startsWith(OLD_PREFIX) ? NEW_PREFIX + k.slice(OLD_PREFIX.length) : k;
// 'new-astra' -> 'new-codex', 'term-new-astra' -> 'term-new-codex'; exact names only.
const action = a => typeof a === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, a) ? ACTIONS[a] : a;
// A parsed request body: action, key and keys[] become canonical. Never touches model or any other field.
function request(body) {
  if (!body || typeof body !== 'object') return body;
  if ('action' in body) body.action = action(body.action);
  if ('key' in body) body.key = key(body.key);
  if (Array.isArray(body.keys)) body.keys = body.keys.map(key);
  return body;
}
// A URL object: its ?key= becomes canonical.
function query(url) {
  const k = url?.searchParams?.get('key');
  if (k != null && key(k) !== k) url.searchParams.set('key', key(k));
  return url;
}

// ---------- config.json ----------
// In memory only: models.astra supplies models.codex when that is absent; the new key wins when both exist.
function config(c) {
  const m = c && c.models;
  if (m && typeof m === 'object' && !Array.isArray(m) && OLD in m) {
    if (!(NEW in m)) m[NEW] = m[OLD];
    delete m[OLD];
  }
  return c;
}

// ---------- stores ----------
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const at = v => Number(v && v.at) || 0;
// Renames the old-prefixed keys of one map. merge(old, new) decides when both keys exist. Returns true on a change.
function rekeyMap(map, merge = (o, n) => n) {
  if (!isObj(map)) return false;
  let changed = false;
  for (const k of Object.keys(map)) {
    if (!k.startsWith(OLD_PREFIX)) continue;
    const to = key(k);
    map[to] = Object.prototype.hasOwnProperty.call(map, to) ? merge(map[k], map[to]) : map[k];
    delete map[k]; changed = true;
  }
  return changed;
}
const laterAt = (o, n) => at(o) > at(n) ? o : n;
// Same as MessageQueue.rekey (message-queue.js): append what the new queue lacks; a second active goes back as failed.
function mergeQueue(source, target) {
  if (!isObj(source) || !isObj(target)) return isObj(target) ? target : source;
  for (const f of ['items', 'history']) if (!Array.isArray(target[f])) target[f] = [];
  const ids = new Set([...target.items, ...target.history, target.active].filter(Boolean).map(i => i.id));
  target.items.push(...(source.items || []).filter(i => !ids.has(i.id)));
  target.history.push(...(source.history || []).filter(i => !ids.has(i.id)));
  if (source.active && !ids.has(source.active.id)) {
    if (target.active) { target.items.unshift({ ...source.active, status: 'failed' }); target.hold = 'Check the earlier delivery before resuming.'; }
    else target.active = source.active;
  }
  return target;
}
// state.json: keys of viewed, models, titles, messageQueues.
function state(s) {
  if (!isObj(s)) return false;
  let c = false;
  c = rekeyMap(s.viewed, (o, n) => Math.max(Number(o) || 0, Number(n) || 0)) || c;
  c = rekeyMap(s.models, laterAt) || c;
  c = rekeyMap(s.titles) || c;
  c = rekeyMap(s.messageQueues, mergeQueue) || c;
  return c;
}
// themes.json: keys of assignments, parents, inherited; the value parents[*].key. version and folders untouched.
function themes(t) {
  if (!isObj(t)) return false;
  let c = false;
  const rank = a => (a && a.by === 'owner' ? 1 : 0);
  c = rekeyMap(t.assignments, (o, n) => rank(o) !== rank(n) ? (rank(o) > rank(n) ? o : n) : laterAt(o, n)) || c;
  c = rekeyMap(t.parents) || c;
  c = rekeyMap(t.inherited) || c;
  if (isObj(t.parents)) for (const p of Object.values(t.parents)) if (isObj(p) && key(p.key) !== p.key) { p.key = key(p.key); c = true; }
  return c;
}
// labels.json and theme-picks.json: top-level keys; the later entry wins.
const keyed = o => rekeyMap(o, laterAt);
// work-folders-cache.json: files[i][1].kind and files[i][1].parent.key. version stays.
function cache(w) {
  if (!isObj(w) || !Array.isArray(w.files)) return false;
  let c = false;
  for (const e of w.files) {
    const v = Array.isArray(e) && e[1];
    if (!isObj(v)) continue;
    if (v.kind === OLD) { v.kind = NEW; c = true; }
    if (isObj(v.parent) && key(v.parent.key) !== v.parent.key) { v.parent.key = key(v.parent.key); c = true; }
  }
  return c;
}

// Migrates one file in place: backup on the first write (unless one exists), temp file and rename. Never throws.
function migrateFile(file, fn, { backup = true, log = () => {} } = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  if (!text.includes(OLD)) return false; // cheap pre-check: nothing old can be in this file
  let data;
  try { data = JSON.parse(text); } catch { return false; } // left for its own loader to report
  if (!fn(data)) return false;
  const tmp = file + '.' + process.pid + '.rename.tmp';
  try {
    if (backup && !fs.existsSync(file + BACKUP)) fs.copyFileSync(file, file + BACKUP);
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    log('NEXUS: could not migrate ' + path.basename(file) + ' to the Codex names: ' + e.message);
    return false;
  }
}
// Runs before the first store is read (server.js). Paths as insights.js, themes.js, session-labels.js and
// theme-sorter.js compute them. labels.json and theme-picks.json follow LOCALAPPDATA only, so they are migrated
// only by a server that does real light work (as lightWork in server.js): a fixture server never touches them.
function migrateStores({ env = process.env, log = m => console.error(m) } = {}) {
  const done = [];
  try {
    if (env.NEXUS_READ_ONLY === '1') return done;
    const home = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NexusDeck');
    const stateFile = env.NEXUS_STATE_FILE || path.join(home, 'state.json');
    const themesFile = env.NEXUS_THEMES_FILE || path.join(path.dirname(stateFile), 'themes.json');
    const lightWork = !env.NEXUS_CLAUDE_DIR && !env.NEXUS_CODEX_DIR && !env.NEXUS_COPILOT_DIR;
    const jobs = [[stateFile, state], [themesFile, themes], [path.join(path.dirname(stateFile), 'work-folders-cache.json'), cache, false]];
    if (lightWork) jobs.push([path.join(home, 'labels.json'), keyed], [path.join(home, 'theme-picks.json'), keyed]);
    for (const [file, fn, backup = true] of jobs) if (migrateFile(file, fn, { backup, log })) done.push(file);
  } catch (e) { log('NEXUS: store migration skipped: ' + e.message); }
  return done;
}

module.exports = { key, action, request, query, config, state, themes, keyed, cache, migrateStores, BACKUP };
