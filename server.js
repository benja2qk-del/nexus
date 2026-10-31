// NEXUS — local session deck for Claude Code + Astra (Codex).
// Zero dependencies. Run: node server.js [--open]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const terms = require('./terms');
// Started from a Claude Code shell, every window, terminal and model call NEXUS launches would inherit that session.
for (const k of terms.NESTED_VARS) delete process.env[k];
const auth = require('./auth');
const voice = require('./voice').createVoiceService();
const uploads = require('./uploads');
const chatImages = require('./chat-images');
const fileLocate = require('./file-locate');
const insights = require('./insights');
const recap = require('./recap');
const { TailReader, continuation } = require('./transcript-tail');
const slashCommands = require('./slash-commands');
const messageQueue = new (require('./message-queue').MessageQueue)({load:insights.messageQueues,save:insights.saveMessageQueues,inspect:queueSnapshot,send:terms.send});
function queueKey(key){const t=terms.list().find(t=>key==='term:'+t.id||t.sessionKey===key);return t&&messageQueue.data['term:'+t.id]?'term:'+t.id:t?.sessionKey||key;}
function queueSnapshot(key){
  const s=sessionFor(key),matching=terms.list().filter(t=>t.sessionKey===key||'term:'+t.id===key||s?.aliases?.includes(t.sessionKey)),t=matching.find(t=>!t.exited)||matching.at(-1);
  if(!t)return {kind:s?.kind,terminal:null,events:[]};
  const snapshot=s?chatSnapshot(s):{terminal:terms.state(t.id),events:[]};
  return {...snapshot,kind:t.kind};
}
const queueTimer=setInterval(async()=>{if(process.env.NEXUS_READ_ONLY==='1')return;try{for(const t of terms.list())if(t.sessionKey)await messageQueue.rekey('term:'+t.id,t.sessionKey);await messageQueue.tick();}catch(error){console.error('Queue persistence:',error.message);}},750);
queueTimer.unref();
const activityLanguage = require('./public/activity-language');
const subagentActivity = new (require('./subagents').ActivityIndex)({background:true});
const themeBrief = require('./theme-brief');
const { createPreview, observePreview, previewSummary } = require('./session-preview');
const { toolDetail } = require('./session-details');
const models = require('./models');
models.discover(); // Copilot prints its model list in local help text; read it once at start.
const agents = require('./agents');
const copilot = require('./copilot');
const copilotSessions = copilot.createDiscovery();
const pendingThemeTerms = new Map();

const ROOT = __dirname;
const HOME = os.homedir();
const CLAUDE_DIR = process.env.NEXUS_CLAUDE_DIR || path.join(HOME, '.claude');
const CODEX_DIR = process.env.NEXUS_CODEX_DIR || path.join(HOME, '.codex');
const COPILOT_DIR = process.env.NEXUS_COPILOT_DIR || process.env.COPILOT_HOME || path.join(HOME, '.copilot');
const CONFIG = loadConfig();
const themeRoots = require('./work-folders').createRoots({home:HOME,groupOf,aliases:CONFIG.aliases});
const themes = new (require('./themes').Themes)({config:CONFIG,roots:themeRoots,readOnly:process.env.NEXUS_READ_ONLY==='1',background:true});
const themeMutations = new (require('./theme-mutations').ThemeMutations)(themes);
const copilotOptions = require('./copilot-options'), copilotPreferences = new copilotOptions.Preferences();
const recycleQueue = new (require('./session-recycle').Queue)({lookup:key=>{scan(CONFIG.recentDays||10);return sessionFor(key);},terms:()=>terms.list(),roots:{claude:CLAUDE_DIR,astra:CODEX_DIR,copilot:COPILOT_DIR}});
const neural = require('./neural-tts').createNeuralTTS({config:CONFIG,getSelection:insights.voiceSelection,saveSelection:insights.setVoices});
const live = require('./live-service').createLiveService({config:CONFIG,
  tts:neural,onStart:()=>{neural.startCall();return voice.startCall();},onStop:()=>{neural.stopCall();return voice.stopCall();},
  snapshot(key){const session=sessionFor(key);return session?{session,chat:chatSnapshot(session)}:null;},
  async send(key,action){const term=terms.list().find(t=>t.sessionKey===key&&!t.exited);if(!term)throw Error('Resume the session before relaying.');
    return terms.send(term.id,action.text,{...(action.type==='answer'?{answer:action.option,signature:action.signature}:action.type==='interrupt'?{answer:'esc'}:{})});}
});
agents.configure(CONFIG);
// Test servers read fixture transcripts (NEXUS_*_DIR) or run read-only; they must never spend a model call on labels.
const processLoad=require('./process-load').createLoad();
// Off unless the owner turns it on (Settings > Agents, /handoff, or Commands).
const handoff=require('./handoff').createHandoff({installed:()=>agents.publicStatus()});terms.setLaunchDecorator(spec=>handoff.apply(spec));
// Light model work (labels, theme sorting) never runs for read-only or test servers.
const lightWork=process.env.NEXUS_READ_ONLY!=='1'&&!process.env.NEXUS_CLAUDE_DIR&&!process.env.NEXUS_CODEX_DIR&&!process.env.NEXUS_COPILOT_DIR;
const sessionLabels=require('./session-labels'),lightModels=()=>sessionLabels.providers(agents.publicStatus(),{...models.catalog(CONFIG),astra:models.codexModels()});
const labels=sessionLabels.createLabeler({enabled:lightWork&&CONFIG.sessionLabels!==false&&process.env.NEXUS_LABELS!=='off',available:lightModels});
const themeSorter=require('./theme-sorter').createSorter({enabled:lightWork&&CONFIG.themeSorting!==false,available:lightModels,themes:()=>themes.choices(),general:p=>themeRoots.generic(p),place:picks=>{try{themes.place(picks);}catch{}}});
const PORT = Number(process.env.NEXUS_PORT) || CONFIG.port || 4777;
const OPEN = process.argv.includes('--open');
auth.configure(CONFIG);

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(process.env.NEXUS_CONFIG_FILE || path.join(ROOT, 'config.json'), 'utf8')); }
  catch { return {}; }
}

// ---------- file helpers ----------

function readSlice(file, start, len) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    return buf.subarray(0, n).toString('utf8');
  } finally { fs.closeSync(fd); }
}

// Whole JSON lines from the first `bytes` of a file.
function headLines(file, size, bytes) {
  const text = readSlice(file, 0, Math.min(size, bytes));
  const lines = text.split('\n');
  if (size > bytes) lines.pop();
  return lines;
}

// Whole JSON lines from the last `bytes` of a file (a partial first line is dropped).
function tailLines(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  const lines = readSlice(file, start, size - start).split('\n');
  if (start > 0) lines.shift();
  return lines;
}

function parse(line) {
  if (!line || line[0] !== '{') return null;
  try { return JSON.parse(line); } catch { return null; }
}

function clip(s, n) {
  if (typeof s !== 'string') s = s == null ? '' : JSON.stringify(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// ---------- project grouping ----------

function groupOf(cwd) {
  return require('./work-folders').nexusGroup(cwd,HOME);
}

function alias(group) {
  const a = CONFIG.aliases || {};
  return a[group] || group;
}

// Folders aliased to the same name (e.g. Lumen and Atlas Lens) share one project.
function projectOf(cwd) { return alias(groupOf(cwd)); }

// ---------- Claude sessions ----------

const claudeCache = new Map(); // file -> { key, meta }

function liveRegistry() {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(path.join(CLAUDE_DIR, 'sessions')).filter(f => f.endsWith('.json')); } catch { }
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'sessions', f), 'utf8'));
      if (r.sessionId && alive(r.pid)) out.set(r.sessionId, r);
    } catch { }
  }
  return out;
}

function userText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  return '';
}

// A message typed while Claude is busy reaches the model as a queued_command attachment, not as a user record.
function queuedPrompt(r) { const a = r?.type === 'attachment' && r.attachment; return a && a.type === 'queued_command' && a.commandMode === 'prompt' && (!a.origin || a.origin.kind === 'human') && typeof a.prompt === 'string' ? a.prompt.trim() : ''; }
function isHumanPrompt(rec) {
  if (rec.type !== 'user' || rec.isMeta || rec.isSidechain) return false;
  const t = userText(rec.message && rec.message.content).trim();
  return t && !t.startsWith('<') && !(Array.isArray(rec.message.content) && rec.message.content.some(c => c.type === 'tool_result'));
}

function claudeMeta(file, st) {
  const key = st.size + ':' + st.mtimeMs;
  const hit = claudeCache.get(file);
  if (hit && hit.key === key) return hit.meta;
  const m = { cwd: '', firstPrompt: '', lastPrompt: '', title: '', aiTitle: '', lastText: '', branch: '', started: '', model: '' };
  for (const line of headLines(file, st.size, 192 * 1024)) {
    const r = parse(line); if (!r) continue;
    if (!m.cwd && r.cwd) m.cwd = r.cwd;
    if (!m.started && r.timestamp) m.started = r.timestamp;
    if (!m.firstPrompt && isHumanPrompt(r)) m.firstPrompt = clip(userText(r.message.content).trim(), 300);
    if (r.type === 'ai-title') m.aiTitle = r.aiTitle;
    if (r.type === 'custom-title') m.title = r.customTitle;
    if (r.type === 'agent-name' && r.agentName) m.agentName = r.agentName;
  }
  const preview = createPreview();
  for (const line of tailLines(file, st.size, 384 * 1024)) {
    const r = parse(line); if (!r) continue;
    observePreview(preview, r);
    if (r.cwd) m.cwd = r.cwd;
    if (r.gitBranch) m.branch = r.gitBranch;
    if (r.type === 'ai-title') m.aiTitle = r.aiTitle;
    if (r.type === 'custom-title') m.title = r.customTitle;
    if (r.type === 'agent-name' && r.agentName) m.agentName = r.agentName;
    if (r.type === 'last-prompt' && r.lastPrompt) m.lastPrompt = clip(r.lastPrompt, 300);
    if (isHumanPrompt(r)) m.lastPrompt = clip(userText(r.message.content).trim(), 300);
    if (queuedPrompt(r)) m.lastPrompt = clip(queuedPrompt(r), 300);
    if (r.type === 'assistant' && !r.isSidechain && r.message) {
      if (models.observed('claude',r)) {m.model = models.observed('claude',r);m.modelAt=Date.parse(r.timestamp)||0;}
      const u = r.message.usage;
      if (u && r.message.model !== '<synthetic>') m.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      const t = userText(r.message.content).trim();
      if (t) m.lastText = clip(t, 400);
    }
  }
  Object.assign(m, previewSummary(preview));
  claudeCache.set(file, { key, meta: m });
  return m;
}

function claudeSessions(days) {
  const cutoff = Date.now() - days * 864e5;
  const live = liveRegistry();
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(path.join(CLAUDE_DIR, 'projects')); } catch { }
  for (const d of dirs) {
    const dir = path.join(CLAUDE_DIR, 'projects', d);
    let files;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    const stats = [];
    for (const f of files) { try { stats.push([f, fs.statSync(path.join(dir, f))]); } catch { } }
    stats.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
    // Every project keeps its newest few sessions however old, so quiet projects stay on the rail.
    const keepOld = /ibagent-runs/i.test(d) ? 0 : (CONFIG.keepPerProject ?? 3);
    let kept = 0;
    for (const [f, st] of stats) {
      const id = f.slice(0, -6);
      const file = path.join(dir, f);
      const reg = live.get(id);
      if (st.mtimeMs < cutoff && !reg && kept >= keepOld) continue;
      kept++;
      if (st.size < 400) continue;
      let m; try { m = claudeMeta(file, st); } catch { continue; }
      // Empty / aborted sessions. Big ones stay: attachments can push every prompt out of the sampled head and tail.
      if (!m.firstPrompt && !m.lastText && !reg && st.size < 64 * 1024) continue;
      const cwd = (reg && reg.cwd) || m.cwd;
      const group = projectOf(cwd);
      out.push({
        kind: 'claude', id, file, cwd, group, groupLabel: group,
        title: m.title || m.agentName || m.aiTitle || (reg && reg.name) || clip(m.firstPrompt, 70) || id.slice(0, 8),
        customTitle: m.title, aiTitle: m.aiTitle, firstPrompt: m.firstPrompt, lastPrompt: m.lastPrompt, lastText: m.lastText,
        latestContext: m.latestContext, recentTools: m.recentTools,
        branch: m.branch, model: m.model, modelAt:m.modelAt||0, started: m.started, ctx: m.ctx || 0,
        updated: Math.max(st.mtimeMs, reg ? reg.statusUpdatedAt || 0 : 0), size: st.size,
        live: !!reg, status: reg ? reg.status : 'offline', pid: reg ? reg.pid : null,
        remote: !!(reg && reg.bridgeSessionId),
      });
    }
  }
  return out;
}

// ---------- Codex (Astra) sessions ----------

const codexCache = new Map();

function codexNames() {
  const names = new Map();
  try {
    for (const line of fs.readFileSync(path.join(CODEX_DIR, 'session_index.jsonl'), 'utf8').split('\n')) {
      const r = parse(line); if (r && r.id && r.thread_name) names.set(r.id, r.thread_name);
    }
  } catch { }
  return names;
}

function codexPromptText(payload) {
  if (!payload || payload.type !== 'message' || payload.role !== 'user') return '';
  const parts = (payload.content || []).filter(c => c.type === 'input_text').map(c => c.text || '');
  return parts.filter(t => { const s = t.trim(); return s && !s.startsWith('<') && !s.startsWith('# AGENTS.md'); }).join('\n').trim();
}

// Astra prompts often just point at a brief on disk ("Your complete instructions are in the file X").
function briefFile(prompt) {
  const hit = (prompt || '').match(/[A-Za-z]:\\[^\r\n"'<>|?*]+?\.(txt|md)\b/);
  if (!hit) return '';
  try { return fs.statSync(hit[0]).isFile() ? hit[0] : ''; } catch { return ''; }
}

// Name + summary of a brief: its COMMISSION "NAME" line when present, else its first line.
const briefCache = new Map();
function briefInfo(file) {
  let st; try { st = fs.statSync(file); } catch { return { name: '', summary: '' }; }
  const hit = briefCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.info;
  const lines = readSlice(file, 0, Math.min(st.size, 60000)).split('\n').map(l => l.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const com = lines.find(l => /^COMMISSION\b/.test(l));
  let info;
  if (com) {
    const m = com.match(/^COMMISSION\s+"([^"]+)"\s*(\([^)]*\))?[.:]?\s*(.*)/);
    const name = m ? m[1].toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : clip(com, 80);
    info = { name, summary: clip(m ? m[3] || lines[lines.indexOf(com) + 1] || '' : com, 300) };
  } else info = activityLanguage.briefTitle(lines.join('\n'));
  briefCache.set(file, { mtime: st.mtimeMs, info });
  return info;
}

function codexMeta(file, st) {
  const key = st.size + ':' + st.mtimeMs;
  const hit = codexCache.get(file);
  if (hit && hit.key === key) return hit.meta;
  const m = { id: '', cwd: '', originator: '', started: '', firstPrompt: '', lastPrompt: '', lastText: '', running: false, model: '' };
  for (const line of headLines(file, st.size, 768 * 1024)) {
    const r = parse(line); if (!r) continue;
    if (r.type === 'session_meta' && r.payload) {
      m.id = r.payload.id || r.payload.session_id; m.cwd = r.payload.cwd; m.originator = r.payload.originator || r.payload.source || '';
      m.started = r.payload.timestamp || r.timestamp;
    }
    if (models.observed('astra',r)) m.model = models.observed('astra',r);
    if (!m.firstPrompt && r.type === 'response_item') { const t = codexPromptText(r.payload); if (t) m.firstPrompt = clip(t, 600); }
  }
  m.turnState = 'unknown';
  m.lastEventAt = 0;
  const preview = createPreview();
  for (const line of tailLines(file, st.size, 256 * 1024)) {
    const r = parse(line); if (!r || !r.payload) continue;
    observePreview(preview, r);
    m.lastEventAt = Math.max(m.lastEventAt, Date.parse(r.timestamp) || 0);
    if (r.type === 'event_msg' && r.payload.type === 'task_started') m.turnState = 'running';
    if (r.type === 'event_msg' && (r.payload.type === 'task_complete' || r.payload.type === 'turn_aborted')) m.turnState = r.payload.type === 'task_complete' ? 'complete' : 'aborted';
    if (r.type === 'event_msg' && r.payload.type === 'agent_message' && r.payload.message) m.lastText = clip(r.payload.message, 400);
    if (r.type === 'event_msg' && r.payload.type === 'token_count' && r.payload.info) {
      const info = r.payload.info;
      m.ctx = info.last_token_usage ? info.last_token_usage.input_tokens : 0;
      m.ctxMax = info.model_context_window || 0;
    }
    if (r.type === 'response_item') { const t = codexPromptText(r.payload); if (t) m.lastPrompt = clip(t, 300); }
    if (models.observed('astra',r)) m.model = models.observed('astra',r);
  }
  Object.assign(m, previewSummary(preview));
  m.brief = briefFile(m.firstPrompt);
  // Freshness is evaluated at scan time, not cached with unchanged file metadata.
  codexCache.set(file, { key, meta: m });
  return m;
}

function walkCodex(dir, cutoff, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkCodex(p, cutoff, out);
    else if (e.name.endsWith('.jsonl')) {
      try { const st = fs.statSync(p); if (st.mtimeMs >= cutoff) out.push([p, st]); } catch { }
    }
  }
}

function codexSessions(days) {
  const cutoff = Date.now() - days * 864e5;
  const files = [];
  walkCodex(path.join(CODEX_DIR, 'sessions'), cutoff, files);
  const names = codexNames();
  const out = [];
  for (const [file, st] of files) {
    let m; try { m = codexMeta(file, st); } catch { continue; }
    const id = m.id || path.basename(file, '.jsonl').slice(-36);
    const group = projectOf(m.cwd);
    // A brief can also arrive as the prompt text itself (piped in), not as a file path.
    const bi = m.brief ? briefInfo(m.brief) : /^\s*you are\b/i.test(m.firstPrompt || '') ? activityLanguage.briefTitle(m.firstPrompt) : { name: '', summary: '' };
    const briefName = m.brief ? path.basename(m.brief).replace(/\.(txt|md)$/, '').replace(/^prompt[_-]?/, '').replace(/[_-]+/g, ' ') : '';
    // Windows may leave mtime unchanged while a long-running writer holds the log open.
    const updated = Math.max(st.mtimeMs, m.lastEventAt || 0);
    const running = !['complete', 'aborted'].includes(m.turnState) && Date.now() - updated < 10 * 60e3;
    const runState = running ? 'active' : m.turnState === 'complete' ? 'complete' : m.turnState === 'aborted' ? 'interrupted' : 'unknown';
    out.push({
      kind: 'astra', id, file, cwd: m.cwd, group, groupLabel: group,
      title: names.get(id) || bi.name || briefName || clip(m.firstPrompt.split('\n')[0], 80) || 'Astra run',
      brief: m.brief, briefTitle: [bi.name && briefName, bi.summary].filter(Boolean).join(' · '),
      commission: bi.name, briefSummary: bi.summary,
      firstPrompt: m.firstPrompt, lastPrompt: m.lastPrompt, lastText: m.lastText, model: m.model, ctx: m.ctx || 0, ctxMax: m.ctxMax || 0,
      latestContext: m.latestContext, recentTools: m.recentTools,
      originator: m.originator, started: m.started, updated, size: st.size,
      // Keep the original status values for API consumers; runState adds evidence for the UI.
      live: running, status: running ? 'busy' : 'done', runState,
      statusDetail: running ? 'Recent log activity; process state is not reported by Codex.' : runState === 'complete' ? 'A turn-complete event was recorded.' : runState === 'interrupted' ? 'The turn was interrupted.' : 'No recent log activity; completion is not confirmed.',
    });
  }
  return out;
}

// ---------- usage limits ----------

function copilotUsage(list){
  const sessions=list.filter(s=>s.kind==='copilot'),reported=sessions.filter(s=>s.copilotUsage?.premiumRequests!=null);
  const monthly=copilotSessions(COPILOT_DIR,40,projectOf),known=monthly.filter(s=>Number.isFinite(s.copilotUsage?.monthPremiumRequests)),quota=monthly.map(s=>s.copilotQuota).filter(Boolean).sort((a,b)=>(b.at||0)-(a.at||0))[0];
  return {premiumRequests:reported.length?reported.reduce((n,s)=>n+s.copilotUsage.premiumRequests,0):null,reportedSessions:reported.length,monthPremiumRequests:known.length?known.reduce((n,s)=>n+s.copilotUsage.monthPremiumRequests,0):null,monthReportedSessions:known.length,quota:quota||null,label:'Recorded local sessions; account usage may include other devices'};
}

// Claude: the NEXUS status line (statusline.js) saves what Claude Code passes it, rate limits included.
function claudeUsage() {
  try {
    const u = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'nexus-usage.json'), 'utf8'));
    const rl = (u.data && u.data.rate_limits) || {};
    const win = w => w && w.used_percentage != null ? { pct: w.used_percentage, resetsAt: w.resets_at * 1000 } : null;
    return { at: u.at, fiveHour: win(rl.five_hour), week: win(rl.seven_day) };
  } catch { return null; }
}

// Astra, live: `codex app-server` answers account/rateLimits/read without spending quota.
// Polled every few minutes; the rollout logs below are only the fallback.
let astraLive = null, astraLiveBusy = false;
function pollAstraLive() {
  if (astraLiveBusy || !agents.publicStatus().astra.installed) return;
  astraLiveBusy = true;
  let p;
  try { p = spawn('cmd.exe', ['/c', 'codex', 'app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); }
  catch { astraLiveBusy = false; return; }
  let buf = '', done = false;
  const finish = () => {
    if (done) return; done = true; astraLiveBusy = false;
    try { p.stdin.end(); } catch { }
    // cmd.exe wraps node; kill the whole tree so no app-server lingers.
    setTimeout(() => { try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { } }, 500);
  };
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg && msg.id === 1) {
        const rl = msg.result && msg.result.rateLimits;
        if (rl) {
          const win = w => w ? { pct: w.usedPercent, resetsAt: w.resetsAt * 1000, minutes: w.windowDurationMins } : null;
          astraLive = { at: Date.now(), live: true, plan: rl.planType, primary: win(rl.primary), secondary: win(rl.secondary) };
        }
        finish();
      }
    }
  });
  p.on('error', finish);
  p.on('exit', finish);
  const send = o => { try { p.stdin.write(JSON.stringify(o) + '\n'); } catch { } };
  send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'nexus', title: 'NEXUS', version: '1.0.0' } } });
  setTimeout(() => { send({ method: 'initialized' }); send({ id: 1, method: 'account/rateLimits/read' }); }, 800);
  setTimeout(finish, 20000);
}

// Astra, fallback: every Codex rollout logs token_count events carrying the account's rate limits.
let astraUsageCache = { key: '', value: null };
function astraUsage() {
  const logged = astraLogUsage();
  return astraLive && (!logged || astraLive.at >= logged.at) ? astraLive : logged;
}

function astraLogUsage() {
  const files = [];
  walkCodex(path.join(CODEX_DIR, 'sessions'), Date.now() - 30 * 864e5, files);
  files.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
  const key = files.slice(0, 1).map(([f, st]) => f + st.size).join();
  if (key === astraUsageCache.key) return astraUsageCache.value;
  let value = null;
  for (const [file, st] of files.slice(0, 40)) {
    const lines = tailLines(file, st.size, 1024 * 1024);
    for (let i = lines.length - 1; i >= 0 && !value; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      const r = parse(lines[i]);
      const rl = r && r.payload && r.payload.rate_limits;
      if (!rl || (!rl.primary && !rl.secondary)) continue;
      const win = w => w ? { pct: w.used_percent, resetsAt: w.resets_at * 1000, minutes: w.window_minutes } : null;
      value = { at: Date.parse(r.timestamp), plan: rl.plan_type, primary: win(rl.primary), secondary: win(rl.secondary) };
    }
    if (value) break;
  }
  astraUsageCache = { key, value };
  return value;
}

// ---------- index ----------

let index = new Map();
let lastScan = null;

function scan(days) {
  const found = claudeSessions(days).concat(codexSessions(days), copilotSessions(COPILOT_DIR, days, projectOf));
  const canonical = new Map(), aliases = new Map();
  for (const source of found) {
    const s = resolveSession(source), key = s.kind + ':' + s.id;
    if(s.kind==='copilot')s.title=insights.titleFor(key)||s.title;
    const previous = canonical.get(key);
    const chain = s.chainFiles || [s.file], prior = previous?.chainFiles || [];
    const ordered = chain.length >= prior.length ? [...chain, ...prior] : [...prior, ...chain];
    s.chainFiles = [...new Set(ordered)].filter(file => file !== s.file).concat(s.file);
    s.aliases = [...new Set([...(previous?.aliases || []), source.kind + ':' + source.id])];
    canonical.set(key, s); aliases.set(source.kind + ':' + source.id, key);
  }
  const all = [...canonical.values()];
  terms.linkSessions(liveRegistry());
  for(const t of terms.list())if(pendingThemeTerms.has(t.id)){
    const pending=pendingThemeTerms.get(t.id);let key=t.sessionKey;
    // Codex does not expose a chosen UUID. Bind only one newly created rollout
    // in the requested folder; leave simultaneous launches unresolved.
    if(!key&&t.kind==='astra'&&!t.exited){const peers=terms.list().filter(x=>!x.exited&&x.kind==='astra'&&path.resolve(x.cwd).toLowerCase()===path.resolve(t.cwd).toLowerCase()&&pendingThemeTerms.has(x.id));const candidates=all.filter(s=>s.kind==='astra'&&!pending.before.has(s.id)&&path.resolve(s.cwd).toLowerCase()===path.resolve(t.cwd).toLowerCase()&&Date.parse(s.started)>=t.started-2000);if(peers.length===1&&candidates.length===1){key='astra:'+candidates[0].id;terms.linkSession(t.id,key);}}
    if(key){if(themes.find(pending.themeId)){const next=structuredClone(themes.state);next.assignments[key]={themeId:pending.themeId,by:'owner',at:Date.now()};themes.save(next);}pendingThemeTerms.delete(t.id);}else if(t.exited)pendingThemeTerms.delete(t.id);
  }
  for (const t of terms.list()) {
    if (t.exited) continue;
    const s = all.find(x => (x.kind + ':' + x.id) === (aliases.get(t.sessionKey) || t.sessionKey));
    if (!s) continue;
    s.term = t.id;
    // Claude Code does not always register a session it was resumed into; the terminal itself proves it is alive.
    if (!s.live) { s.live = true; s.pid = t.pid; s.status = Date.now() - t.lastOut < 4000 ? 'busy' : 'idle'; }
    s.inNexus = true;
    if (t.waiting) s.status = 'waiting';
    if (t.remote) s.remote = true;
  }
  subagentActivity.decorate(all);
  themes.decorate(all, found);
  themeSorter.forget(themes.forgotten);themeSorter.offer(themes.unplaced);
  // Live terminal evidence can refine a delegated run's state after discovery.
  for(const parent of all)for(const row of parent.subagents||[])if(row.sessionKey){const child=all.find(s=>s.kind+':'+s.id===row.sessionKey);if(child)row.state=require('./public/subagent-core').session(child);}
  all.sort((a, b) => (b.live - a.live) || (b.updated - a.updated));
  index = new Map(all.map(s => [s.kind + ':' + s.id, s]));
  for (const [alias, key] of aliases) index.set(alias, index.get(key));
  insights.sync(all);
  lastScan = Date.now();
  return all;
}

function resolveSession(source) {
  if (!source || source.kind !== 'claude') return source;
  const chain = continuation(source.file);
  if (chain.file === source.file) return { ...source, chainFiles: source.chainFiles || chain.files };
  const st = fs.statSync(chain.file), m = claudeMeta(chain.file, st);
  // A session the owner named himself stays its own card, even when Claude Code continued it elsewhere.
  if (source.customTitle && source.customTitle !== m.title) return { ...source, chainFiles: [source.file], continuesIn: path.basename(chain.file, '.jsonl') };
  return { ...source, ...m, file: chain.file, id: path.basename(chain.file, '.jsonl'),
    title: m.title || m.agentName || m.aiTitle || source.title,
    cwd: m.cwd || source.cwd, firstPrompt: m.firstPrompt || source.firstPrompt, lastPrompt: m.lastPrompt || source.lastPrompt,
    aiTitle: m.aiTitle || source.aiTitle, size: st.size, updated: st.mtimeMs,
    chainFiles: [...new Set([...(source.chainFiles || []), ...chain.files])] };
}
function sessionFor(key) {
  let s = index.get(key);
  if (!s) { scan(CONFIG.recentDays || 10); s = index.get(key); }
  return resolveSession(s);
}

// ---------- transcripts ----------

function toolSummary(name, input) {
  input = input || {};
  switch (name) {
    case 'Bash': case 'PowerShell': return input.command || '';
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return input.file_path || input.notebook_path || '';
    case 'Grep': return (input.pattern || '') + (input.path ? '  in ' + input.path : '');
    case 'Glob': return input.pattern || '';
    case 'Agent': case 'Task': return (input.description ? input.description + ' — ' : '') + (input.prompt || '');
    case 'Skill': return input.skill + (input.args ? ' ' + input.args : '');
    case 'SendMessage': return '→ ' + (input.to || '') + ': ' + (input.message || '');
    case 'WebSearch': return input.query || '';
    case 'WebFetch': return input.url || '';
    case 'TodoWrite': return (input.todos || []).map(t => (t.status === 'completed' ? '✓ ' : '• ') + t.content).join('\n');
    default: return JSON.stringify(input);
  }
}

function isAstraCall(name, text) {
  return /\bcodex(\.cmd)?\s+(exec|resume|e)\b/i.test(text) || /\bastra\b/i.test(name);
}

function resultText(c) {
  if (typeof c.content === 'string') return c.content;
  if (Array.isArray(c.content)) return c.content.map(x => x.type === 'text' ? x.text : '[' + x.type + ']').join('\n');
  return '';
}

function resultImages(c) {
  return Array.isArray(c.content) ? c.content.filter(x => x.type === 'image').map(x => chatImages.fromBlock(x.source)).filter(Boolean) : [];
}
function userEvent(ts, text) {
  const images = chatImages.fromText(text);
  return { t: 'user', ts, text: clip(text, 8000), ...(images.length ? { images } : {}) };
}

function claudeEvents(lines) {
  const ev = [];
  for (const line of lines) {
    const r = parse(line); if (!r || r.isSidechain) continue;
    const commands=slashCommands.core.claudeRecord(r);
    if(commands.length){ev.push(...commands);continue;}
    const ts = r.timestamp;
    if (r.type === 'user' && r.message) {
      const c = r.message.content;
      if (typeof c === 'string') {
        const s = c.trim(); if (!s) continue;
        if (s.startsWith('<command-name>')) {
          const name = (s.match(/<command-name>([^<]*)/) || [])[1] || '';
          const args = (s.match(/<command-args>([^<]*)/) || [])[1] || '';
          ev.push({ t: 'cmd', ts, text: (name + ' ' + args).trim() });
        } else if (s.startsWith('<task-notification>')) {
          const sum = (s.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || 'background task update';
          ev.push({ t: 'note', ts, text: clip(sum, 400) });
        } else if (!s.startsWith('<') && !r.isMeta) ev.push(userEvent(ts, s));
      } else if (Array.isArray(c)) {
        for (const p of c) {
          if (p.type === 'tool_result') { const images = resultImages(p); ev.push({ t: 'result', ts, id: p.tool_use_id, err: !!p.is_error, text: clip(resultText(p), 1600), ...(images.length ? { images } : {}) }); }
          else if (p.type === 'text' && !r.isMeta && p.text && !p.text.trim().startsWith('<')) ev.push(userEvent(ts, p.text));
          else if (p.type === 'image') { const name = chatImages.fromBlock(p.source); ev.push({ t: 'note', ts, text: '🖼 image attached', ...(name ? { images: [name] } : {}) }); }
        }
      }
    } else if (queuedPrompt(r)) {
      ev.push({ t: 'user', ts: r.attachment.timestamp || ts, text: clip(queuedPrompt(r), 8000) });
    } else if (r.type === 'assistant' && r.message && Array.isArray(r.message.content)) {
      for (const p of r.message.content) {
        if (p.type === 'text' && p.text && p.text.trim()) ev.push({ t: 'ai', ts, text: clip(p.text, 12000) });
        else if (p.type === 'thinking' && p.thinking && p.thinking.trim()) ev.push({ t: 'think', ts, ...(Number.isFinite(p.duration_seconds)?{durationSeconds:p.duration_seconds}:{}), text: clip(p.thinking.trim(), 12000) });
        else if (p.type === 'tool_use') {
          const sum = toolSummary(p.name, p.input);
          const e = { t: 'tool', ts, id: p.id, name: p.name, text: clip(sum, 6000), human: activityLanguage.tool(p.name, p.input), astra: isAstraCall(p.name, sum) };
          e.detail = toolDetail(p.name, p.input);
          if (TASK_TOOLS.has(p.name)) e.input = p.input;
          ev.push(e);
        }
      }
    } else if (r.type === 'system' && r.subtype === 'compact_boundary') {
      ev.push({ t: 'note', ts, text: 'context compacted' });
    }
  }
  return ev;
}

function codexEvents(lines) {
  const ev = [];
  for (const line of lines) {
    const r = parse(line); if (!r || !r.payload) continue;
    const p = r.payload, ts = r.timestamp;
    if (r.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user') { const t = codexPromptText(p); if (t) ev.push({ t: 'user', ts, text: clip(t, 12000) }); }
      else if (p.type === 'message' && p.role === 'assistant') {
        const t = (p.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n').trim();
        if (t) ev.push({ t: 'ai', ts, text: clip(t, 12000) });
      } else if (p.type === 'reasoning') {
        const text = (p.summary || []).map(x => x.text || '').join('\n');
        if (text) ev.push({ t: 'think', ts, ...(Number.isFinite(p.duration_seconds)?{durationSeconds:p.duration_seconds}:{}), text: clip(text, 12000) });
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
        let text = p.arguments || p.input || (p.action && p.action.command && p.action.command.join(' ')) || '';
        let input = null;
        try { const a = JSON.parse(text); input = a; text = a.cmd || a.command || a.code || text; if (Array.isArray(text)) text = text.join(' '); } catch { }
        const e = { t: 'tool', ts, id: p.call_id, name: p.name || 'shell', text: clip(typeof text === 'string' ? text : JSON.stringify(text), 6000), human: activityLanguage.tool(p.name || 'shell', input || p.input || text) };
        e.detail = toolDetail(e.name, input || p.input || text);
        if (TASK_TOOLS.has(e.name)) e.input = input;
        ev.push(e);
      } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        let o = p.output; if (o && typeof o === 'object') o = o.content || JSON.stringify(o);
        ev.push({ t: 'result', ts, id: p.call_id, text: clip(String(o || ''), 1600) });
      }
    } else if (r.type === 'event_msg') {
      if (p.type === 'user_message' && p.message) ev.push({ t: 'user', ts, text: clip(p.message, 12000), mirror: true });
      if (p.type === 'agent_message' && p.message) ev.push({ t: 'ai', ts, text: clip(p.message, 12000), mirror: true });
      if (p.type === 'task_started') ev.push({ t: 'note', ts, text: 'turn started' });
      else if (p.type === 'task_complete') ev.push({ t: 'note', ts, text: 'turn complete' });
      else if (p.type === 'turn_aborted') ev.push({ t: 'note', ts, text: 'turn aborted' });
    }
  }
  return ev;
}

// ---------- activity: what the agent is doing right now ----------

const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'update_plan']);
const DONE = new Set(['completed', 'complete', 'done', 'resolved']);

// Task list as the agent itself keeps it (Claude TodoWrite / TaskCreate+TaskUpdate, Codex update_plan).
function taskList(ev) {
  let tasks = [];
  const byId = new Map();
  for (const e of ev) {
    if (e.t !== 'tool' || !e.input) continue;
    const i = e.input;
    if (e.name === 'TodoWrite' && Array.isArray(i.todos)) {
      tasks = i.todos.map(t => ({ text: t.content || t.subject || '', status: t.status || 'pending' }));
      byId.clear();
    } else if (e.name === 'update_plan' && Array.isArray(i.plan)) {
      tasks = i.plan.map(t => ({ text: t.step || t.content || '', status: t.status || 'pending' }));
    } else if (e.name === 'TaskCreate') {
      const res = ev.find(x => x.t === 'result' && x.id === e.id);
      const id = res && (res.text.match(/#(\d+)/) || [])[1];
      const task = { text: i.subject || i.title || i.content || i.description || 'task', status: i.status || 'pending' };
      tasks.push(task);
      if (id) byId.set(String(id), task);
    } else if (e.name === 'TaskUpdate') {
      const task = byId.get(String(i.taskId ?? i.id ?? ''));
      if (task) { if (i.status) task.status = i.status; if (i.subject) task.text = i.subject; }
    }
  }
  return tasks.filter(t => t.status !== 'deleted').map(t => ({ text: clip(t.text, 200), status: DONE.has(t.status) ? 'done' : t.status === 'in_progress' ? 'active' : 'todo' }));
}

function activity(ev, kind) {
  let start = -1;
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i].t === 'user') { start = i; break; }
  const turn = ev.slice(start + 1);
  const results = new Set(ev.filter(e => e.t === 'result').map(e => e.id));
  const tools = turn.filter(e => e.t === 'tool');
  const last = tools[tools.length - 1];
  // Claude: its thinking. Astra's reasoning is encrypted, so its progress notes stand in.
  const thoughts = turn.filter(e => e.t === (kind === 'claude' ? 'think' : 'ai'));
  const thought = thoughts[thoughts.length - 1];
  const said = turn.filter(e => e.t === 'ai');
  return {
    goal: start >= 0 ? clip(ev[start].text, 1500) : '',
    turnStart: start >= 0 ? ev[start].ts : null,
    steps: tools.length,
    current: last ? { name: last.name, text: clip(last.text, 400), human: last.human, ts: last.ts, running: !results.has(last.id) } : null,
    thought: thought ? { text: clip(thought.text, 3000), ts: thought.ts } : null,
    said: said.length ? { text: clip(said[said.length - 1].text, 600), ts: said[said.length - 1].ts } : null,
    tasks: taskList(ev),
  };
}

function transcript(key, bytes, limit) {
  const s = sessionFor(key);
  if (!s) return null;
  const st = fs.statSync(s.file);
  bytes = Math.min(Math.max(bytes || 3e6, 64e3), 64e6);
  // Pasted images and screenshots make some lines huge: widen the window until enough events are in view.
  const want = Math.min(limit || 400, 60);
  let ev;
  for (;;) {
    const lines = tailLines(s.file, st.size, bytes);
    ev = s.kind === 'copilot' ? copilot.dedupe(lines.flatMap(line => copilot.events(parse(line)))) : s.kind === 'claude' ? claudeEvents(lines) : codexEvents(lines);
    if (ev.length >= want || bytes >= st.size || bytes >= 32e6) break;
    bytes *= 4;
  }
  if (s.kind === 'astra' && s.brief) {
    let text = '';
    try { text = readSlice(s.brief, 0, 40000); } catch { }
    const at = ev.findIndex(e => e.t === 'user');
    ev.splice(at + 1, 0, { t: 'brief', ts: s.started, path: s.brief, text: clip(text, 39000) });
  }
  const events = subagentActivity.attach(s,ev.slice(-(limit || 400)));
  const brief = ev.find(e => e.t === 'brief');
  if (brief && !events.includes(brief)) events.unshift(brief);
  return { size: st.size, truncated: st.size > bytes || ev.length > (limit || 400), activity: activity(ev, s.kind), events };
}

const chatReaders = {
  copilot: new TailReader({ parse: copilot.events }),
  claude: new TailReader({ parse: r => claudeEvents([JSON.stringify(r)]) }),
  astra: new TailReader({ parse: r => codexEvents([JSON.stringify(r)]) })
};
function chatSnapshot(s, previous) {
  if(s.kind==='claude'){const fresh=subagentActivity.read(s);s.subagents=[...fresh.rows,...(s.subagents||[]).filter(n=>n.kind==='astra')];s.subagentsPartial=fresh.partial;}
  const reader = chatReaders[s.kind];
  const files = [...new Set([...(s.chainFiles || []), s.file])];
  const reads = files.map(file => reader.read(file));
  const cursor = files.map((f, i) => path.basename(f) + ':' + reads[i].cursor).join('|')+':'+subagentActivity.revision(s);
  const seen = new Set(), all = s.kind === 'copilot' ? copilot.dedupe(reads.flatMap(r => r.items)) : reads.flatMap(r => r.items);
  const events = subagentActivity.attach(s,require('./public/redesign-core').dedupeMirrors(all).filter(e => {
    const key = JSON.stringify([e.t, e.id, e.ts, e.text]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(-600));
  const terminal = terms.list().find(t => !t.exited && [s.kind + ':' + s.id, ...(s.aliases || [])].includes(t.sessionKey))
    || terms.list().findLast(t => [s.kind + ':' + s.id, ...(s.aliases || [])].includes(t.sessionKey));
  const live = terminal ? terms.state(terminal.id, events) : null;
  const last = events.at(-1), current = activity(events, s.kind);
  let status = 'Done';
  if (live?.prompt || live?.ready && !live.busy || !live && s.live && s.status !== 'busy') status = 'Waiting for you';
  else if (!live?.exited && (live || s.status === 'busy')) {
    status = current.current?.running ? current.current.name === 'Bash' || /command|shell/i.test(current.current.name) ? 'Running a command...' : 'Using a tool...' : (s.kind === 'copilot' ? 'Copilot' : s.kind === 'astra' ? 'Astra' : 'Claude') + ' is thinking...';
  }
  if (!live?.prompt && !live?.busy && (last?.text === 'turn complete' || last?.text === 'turn aborted')) status = 'Done';
  if(s.error&&!live?.busy)status=s.errorType==='quota'?'Quota exceeded':'Error';
  return { key: s.kind + ':' + s.id, aliases: s.aliases || [], cursor, events: previous === cursor ? null : events,
    truncated: reads.some(r => r.partial), more: reads.some(r => r.more), bytesRead: reads.reduce((n, r) => n + r.bytesRead, 0),
    capturedAt: Date.now(), terminal: live, status, activity: current, size: reads.at(-1).size };
}

// ---------- actions ----------

const WT = path.join(HOME, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe');

function terminal(cwd, title, cmd) {
  // Windows Terminal re-splits its command line, so a title with spaces or symbols becomes a command
  // ("Windows cannot find '⑂'"). Keep titles to one plain ASCII word.
  const safeTitle = String(title || 'session').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'session';
  if (!cwd || !fs.existsSync(cwd)) cwd = HOME;
  if (fs.existsSync(WT)) {
    spawn(WT, ['-w', 'nexus', 'nt', '-d', cwd, '--title', safeTitle, ...cmd], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd.exe', ['/c', 'start', '"' + safeTitle + '"', 'cmd', '/k', ...cmd], { cwd, detached: true, stdio: 'ignore', shell: false }).unref();
  }
}

// claude --resume only finds a conversation from the folder its transcript is filed under
// (~/.claude/projects/<folder with non-alphanumerics as ->). A session can record a subfolder it cd'ed into:
// walk up from its cwd to the folder that matches.
function resumeDir(s) {
  const want = path.basename(path.dirname(s.file || ''));
  for (let d = s.cwd; d; d = path.dirname(d)) {
    if (d.replace(/[^A-Za-z0-9]/g, '-') === want) return d;
    if (path.dirname(d) === d) break;
  }
  return s.cwd;
}

function modelPreference(s){return insights.modelFor(s.kind+':'+s.id)||(s.aliases||[]).map(k=>insights.modelFor(k)).filter(Boolean).sort((a,b)=>b.at-a.at)[0]||null;}
function startInTheme(spec,themeId){
 if(themeId&&!themes.find(themeId))throw Error('Theme no longer exists.');
 if(!themeId)return {term:terms.open(spec).id};
 const sessions=scan(CONFIG.recentDays||10),before=new Set(sessions.filter(s=>s.kind===spec.kind).map(s=>s.id));
 if(!themes.find(themeId).mainFolder&&spec.cwd&&fs.statSync(spec.cwd).isDirectory()){const next=structuredClone(themes.state);themes.find(themeId,next).mainFolder=path.resolve(spec.cwd);themes.save(next);}
 const launched=themeBrief.launch(spec,themes.find(themeId),sessions);spec=launched.spec;
 if(spec.kind==='claude'){const id=require('crypto').randomUUID();spec={...spec,sessionKey:'claude:'+id,claudeArgs:[...(spec.claudeArgs||[]),'--session-id',id]};}
 const term=terms.open(spec);term.themeMethod=launched.method;pendingThemeTerms.set(term.id,{themeId,before});return {term:term.id,themeMethod:launched.method,cwd:spec.cwd};
}
async function act(body,signal) {
  if (process.env.NEXUS_READ_ONLY === '1') throw Error('This verification server is read-only.');
  if (process.env.NEXUS_TEST_TERMINALS === '1' && ['check-focus', 'resume', 'fork', 'term-resume', 'term-fork', 'new', 'new-astra', 'folder', 'vscode', 'open-brief'].includes(body.action)) throw new Error('External launches and existing-session writes are disabled in test mode');
  const s = body.key ? sessionFor(body.key) : null;
  const cwd = body.cwd || (s && (s.kind === 'claude' ? resumeDir(s) : s.cwd));
  switch (body.action) {
    case 'queue-add': return messageQueue.add(queueKey(body.key),body);
    case 'queue-change': return messageQueue.change(queueKey(body.key),body.operation,body);
    case 'session-delete': return recycleQueue.schedule(body.key);
    case 'session-delete-undo': return recycleQueue.cancel(body.id);
    case 'session-delete-status': return recycleQueue.status(body.id);
    case 'copilot-options': {
      if(!s||s.kind!=='copilot')throw Error('Choose a Copilot session.');
      return {options:copilotPreferences.set('copilot:'+s.id,body.options),deferred:true};
    }
    case 'summarize-theme': {
      scan(CONFIG.recentDays||10);
      const theme=themes.find(body.themeId),sessions=themes.last.filter(s=>s.theme?.id===body.themeId);
      if(!theme||!sessions.length)throw Error('This theme has no conversations to summarize.');
      return recap.summarizeTheme(theme,sessions,{signal});
    }
    case 'summarize-recent': {
      const sessions=(Array.isArray(body.keys)?body.keys:[]).slice(0,12).map(sessionFor).filter(Boolean);
      if(!sessions.length)throw Error('There are no conversations to summarize.');
      return recap.summarizeRecent(sessions);
    }
    case 'session-rename': {
      if (!s) throw Error('Unknown session.');
      if(s.kind==='copilot')return insights.setTitle('copilot:'+s.id,body.title);
      return require('./session-title').rename(s, body.title, path.join(CODEX_DIR,'session_index.jsonl'));
    }
    case 'viewed':
      if (!s) throw new Error('unknown session');
      return insights.viewed(body.key, body.at);
    case 'check-focus':
      if (!s) throw new Error('unknown session');
      return insights.checkFocus(s);
    case 'summarize-recap':
      if (!s) throw new Error('unknown session');
      return recap.summarize(s);
    case 'resume':
      if (!s) throw new Error('unknown session');
      if (s.kind === 'copilot') return act({...body, action:'term-resume'});
      if (s.kind === 'claude') terminal(cwd, s.title, ['claude', '--resume', s.id, ...handoff.resumeArgs('claude')]);
      else terminal(cwd, 'Astra · ' + s.title, ['codex', 'resume', s.id]);
      return 'opened';
    case 'fork': {
      if (!s || s.kind !== 'claude') throw new Error('fork needs a Claude session');
      const id=require('crypto').randomUUID();
      themes.recordParent('claude:'+id,'claude:'+s.id);
      terminal(cwd, s.title + ' (fork)', ['claude', '--resume', s.id, '--fork-session', '--session-id', id, ...handoff.resumeArgs('claude')]);
      return 'opened';
    }
    case 'new':
      terminal(cwd, 'Claude · ' + path.basename(cwd || HOME), ['claude']);
      return 'opened';
    case 'new-astra':
      terminal(cwd, 'Astra · ' + path.basename(cwd || HOME), ['codex']);
      return 'opened';
    case 'vscode': {
      if (!cwd || !fs.existsSync(cwd)) throw new Error('Project folder no longer exists');
      // Pass paths directly to an executable: shell metacharacters in folder names stay literal.
      const bases = [path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Programs', 'Microsoft VS Code'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code'),
        ...(process.env.PATH || '').split(path.delimiter).map(p => path.resolve(p, '..'))];
      const code = bases.map(p => path.join(p, 'Code.exe')).find(p => fs.existsSync(p));
      if (!code) throw new Error('VS Code was not found in its install locations or PATH. Use Open folder instead.');
      spawn(code, ['--reuse-window', cwd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return 'opened';
    }
    case 'open-brief':
      if (!s || !s.brief) throw new Error('no brief for this run');
      spawn('explorer.exe', [s.brief], { detached: true, stdio: 'ignore' }).unref();
      return 'opened';
    case 'folder':
      spawn('explorer.exe', [cwd], { detached: true, stdio: 'ignore' }).unref();
      return 'opened';
    // A file path in an answer: documents and media open in their usual app; anything that could run (scripts,
    // programs, shortcuts) is only shown in its folder.
    case 'open-path': {
      const raw = String(body.path || '');
      if (!path.isAbsolute(raw) || /["\r\n]/.test(raw)) throw new Error('Not a file path.');
      const target = path.resolve(raw);
      let st; try { st = fs.statSync(target); } catch { throw new Error('That file is no longer there.'); }
      if (st.isDirectory()) { spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref(); return 'opened'; }
      if (body.mode === 'folder' || !OPENABLE.test(target)) { spawn('explorer.exe', ['/select,"' + target + '"'], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref(); return 'revealed'; }
      spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
      return 'opened';
    }
    // In-app terminals (shown in the page via xterm.js).
    case 'term-resume': {
      if (!s) throw new Error('unknown session');
      const modelArgs=models.args(CONFIG,s.kind,body.model||modelPreference(s)?.model);
      const t = s.kind === 'claude'
        ? terms.open({ kind: 'claude', title: s.title, cwd, sessionKey: s.kind + ':' + s.id, claudeArgs: ['--resume', s.id, ...modelArgs, ...(body.remote ? ['--remote-control'] : [])] })
        : s.kind === 'copilot' ? terms.open({ kind:'copilot', title:s.title, cwd, sessionKey:'copilot:'+s.id, copilotArgs:['--resume',s.id,...modelArgs,...copilotOptions.args(copilotPreferences.get('copilot:'+s.id))] })
        : terms.open({ kind: 'astra', title: s.title, cwd, sessionKey: s.kind + ':' + s.id, codexArgs: ['resume', s.id, ...modelArgs] });
      return { term: t.id };
    }
    case 'term-fork': {
      if (!s || s.kind !== 'claude') throw new Error('fork needs a Claude session');
      const id=require('crypto').randomUUID(),key='claude:'+id;
      themes.recordParent(key,'claude:'+s.id);
      const t = terms.open({ kind: 'claude', title: s.title + ' (fork)', cwd, fresh: true, sessionKey:key, claudeArgs: ['--resume', s.id, '--fork-session', '--session-id', id, ...(body.remote ? ['--remote-control'] : [])] });
      return { term: t.id };
    }
    case 'term-new':
      return startInTheme({ kind: 'claude', title: 'New · ' + path.basename(cwd || HOME), cwd, fresh: true,claudeArgs:models.args(CONFIG,'claude',body.model) },body.themeId);
    case 'term-new-astra':
      return startInTheme({ kind: 'astra', title: 'Astra · ' + path.basename(cwd || HOME), cwd, fresh: true,codexArgs:models.args(CONFIG,'astra',body.model) },body.themeId);
    case 'term-new-copilot':
      return startInTheme({kind:'copilot',title:'Copilot · '+path.basename(cwd||HOME),cwd,fresh:true,copilotArgs:[...models.args(CONFIG,'copilot',body.model),...copilotOptions.args(body.copilotOptions||{})]},body.themeId);
    case 'term-new-antigravity':
      return startInTheme({kind:'antigravity',title:'Antigravity · '+path.basename(cwd||HOME),cwd,fresh:true,antigravityArgs:models.args(CONFIG,'antigravity',body.model)},body.themeId);
    case 'term-fork-copilot': {
      if (!s || s.kind !== 'copilot') throw Error('Choose a Copilot conversation.');
      const t=terms.list().find(t=>t.sessionKey==='copilot:'+s.id&&!t.exited);
      if (!t) throw Error('Resume the Copilot session in NEXUS, then fork from its ready input.');
      const result=await terms.forkCopilot(t.id);
      themes.recordParent(result.key,'copilot:'+s.id);
      return result;
    }
    case 'term-model': {
      const term=terms.list().find(t=>t.id===body.term&&!t.exited);
      if(!term)throw Error('Terminal is not running.');
      models.validate(CONFIG,term.kind,body.model);
      if(term.kind==='astra'||term.kind==='copilot'){
        if(!term.sessionKey)throw Error('Wait until this new session appears before choosing its next model.');
        await insights.setModel(term.sessionKey,body.model);return {model:body.model,deferred:true};
      }
      const result=await terms.changeModel(term.id,body.model);
      if(term.sessionKey)await insights.setModel(term.sessionKey,body.model);
      return result;
    }
    case 'session-model': {
      if(!s)throw Error('Unknown session.');
      models.validate(CONFIG,s.kind,body.model);
      if(s.kind==='claude'&&s.live)throw Error('This session is running outside NEXUS. Change its model in its terminal.');
      await insights.setModel(s.kind+':'+s.id,body.model);return {model:body.model,deferred:true};
    }
    case 'term-send': {
      const t=terms.list().find(t=>t.id===body.term),key=t?.sessionKey||'term:'+body.term;
      if(body.answer===undefined&&t){
        return messageQueue.submit(queueKey(key),{id:body.commandId,text:body.text,commandConfirmation:body.commandConfirmation});
      }
      return terms.send(body.term, body.text, { answer: body.answer, signature: body.signature, commandId:body.commandId, commandConfirmation:body.commandConfirmation });
    }
    case 'term-rc':
      terms.remoteOn(body.term);
      return 'on';
    case 'handoff': return {handoff:handoff.set(body.on===undefined?!handoff.enabled():body.on===true)};
    case 'full-access': return {fullAccess:handoff.setFullAccess(body.on===true)};
    case 'term-close':
      terms.close(body.term);
      return 'closed';
    case 'quit':
      await live.close();
      await neural.close();
      terms.closeAll();
      setTimeout(() => process.exit(0), 300);
      return 'bye';
    default: throw new Error('unknown action');
  }
}

// ---------- http ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let lastHit = Date.now();
const VENDOR = {
  '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': '@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  '/vendor/addon-web-links.js': '@xterm/addon-web-links/lib/addon-web-links.js',
};

// Reachable remotely before pairing: the pairing page and what Safari needs to add NEXUS to the home screen.
const PUBLIC_REMOTE = new Set(['/pair.html', '/pair.js', '/manifest.webmanifest', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-256.png', '/icon-32.png', '/icon-maskable-512.png', '/icon.svg', '/core.svg', '/favicon.svg', '/favicon.ico']);
const OPENABLE = /\.(html?|md|markdown|txt|log|json|csv|tsv|xml|ya?ml|toml|ini|css|svg|png|jpe?g|gif|webp|bmp|ico|pdf|mp3|wav|ogg|flac|mp4|webm|mov|mkv)$/i;
// Files a session's answer links to, served from inside its folder only, as sandboxed documents with no NEXUS access.
const PREVIEW_TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function servePreview(res, pathname) {
  const [, , rawKey, ...rest] = pathname.split('/');
  let key, parts; try { key = decodeURIComponent(rawKey || ''); parts = rest.map(decodeURIComponent); } catch { return send(res, 400, { error: 'Bad preview path.' }); }
  const s = key && sessionFor(key), type = PREVIEW_TYPES[path.extname(parts.at(-1) || '').toLowerCase()];
  if (!s?.cwd || !type || parts.some(p => !p || p === '..' || /[\\/:]/.test(p))) return send(res, 404, { error: 'Nothing to preview here.' });
  let base, file; try { base = fs.realpathSync(s.cwd); file = fs.realpathSync(path.join(base, ...parts)); } catch { return send(res, 404, { error: 'That file is no longer there.' }); }
  if (!file.toLowerCase().startsWith(base.toLowerCase() + path.sep)) return send(res, 403, { error: 'Only files in the session folder can be previewed.' });
  const st = fs.statSync(file); if (!st.isFile() || st.size > 20 * 1024 * 1024) return send(res, 404, { error: 'Nothing to preview here.' });
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-modals allow-popups', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}
const REMOTE_BLOCKED = new Set(['quit', 'popout', 'resume', 'fork', 'new', 'new-astra', 'vscode', 'folder', 'open-brief', 'open-path']);

function redeemPairing(req, res) {
  if (req.headers['x-nexus'] !== '1') return send(res, 403, { error: 'forbidden' });
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e3) req.destroy(); });
  req.on('end', () => {
    try {
      const b = JSON.parse(body || '{}');
      const token = auth.redeem(b.code, b.name);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': auth.cookieHeader(token) });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { send(res, 400, { error: e.message }); }
  });
}

// The session list is polled every two seconds. Send only the sessions whose JSON changed since
// the snapshot the client already has, and gzip large bodies (the phone polls through Tailscale).
const sessionSnapshots = new Map(), bootId = require('crypto').randomBytes(4).toString('hex');
let sessionSerial = 0;
function sendSessions(req, res, url, payload) {
  const sigs = new Map(payload.sessions.map(s => [s.kind + ':' + s.id, require('crypto').createHash('sha1').update(JSON.stringify(s)).digest('base64')]));
  const rev = bootId + '-' + (++sessionSerial).toString(36);
  sessionSnapshots.set(rev, sigs); if (sessionSnapshots.size > 32) sessionSnapshots.delete(sessionSnapshots.keys().next().value);
  const base = sessionSnapshots.get(url.searchParams.get('since') || '');
  const body = base ? { ...payload, rev, delta: true, order: [...sigs.keys()], sessions: payload.sessions.filter(s => base.get(s.kind + ':' + s.id) !== sigs.get(s.kind + ':' + s.id)) } : { ...payload, rev };
  sendJSON(req, res, 200, body);
}
function sendJSON(req, res, code, obj) {
  const text = JSON.stringify(obj);
  if (text.length > 16384 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return res.end(require('zlib').gzipSync(text, { level: 1 }));
  }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  lastHit = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const remote = auth.isRemote(req);
  if (remote) {
    // Phone / other devices through `tailscale serve`: the owner's tailnet identity, then a paired device.
    if (!auth.tailnetOk(req)) { res.writeHead(403); return res.end(); }
    if (url.pathname === '/api/pair' && req.method === 'POST') return redeemPairing(req, res);
    if (!PUBLIC_REMOTE.has(url.pathname) && !auth.deviceFor(req)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'pair this device first' });
      res.writeHead(302, { Location: '/pair.html', 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  try {
    if (url.pathname === '/api/voices' && req.method === 'GET') return send(res,200,neural.list());
    if (url.pathname === '/api/chat-image') {
      const image = chatImages.file(url.searchParams.get('name'));
      if (!image) return send(res, 404, { error: 'Image unavailable.' });
      res.writeHead(200, { 'Content-Type': image.type, 'Cache-Control': 'private, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(image.path).pipe(res);
    }
    if (url.pathname.startsWith('/api/voices/sample/') && req.method === 'GET') {
      const match=/^\/api\/voices\/sample\/([a-z0-9-]+)\/([0-2])$/.exec(url.pathname);
      if(!match)return send(res,404,{error:'Unknown voice sample.'});
      try{const file=neural.sample(match[1],Number(match[2]));res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':fs.statSync(file).size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}catch(e){send(res,404,{error:e.message});}return;
    }
    if(url.pathname === '/api/voices/select'){
      if(req.method!=='POST')return send(res,405,{error:'Use POST.'});
      const origin=req.headers.origin,expected=remote?`https://${CONFIG.remoteHost}`:`http://${req.headers.host}`;
      if(req.headers['x-nexus']!=='1'||origin&&origin!==expected)return send(res,403,{error:'Forbidden'});
      let body='';req.on('data',c=>{body+=c;if(body.length>1000)req.destroy();});req.on('end',async()=>{try{if(remote&&(!auth.tailnetOk(req)||!auth.deviceFor(req)))return send(res,401,{error:'Pair this device again.'});const data=JSON.parse(body);send(res,200,{selected:await neural.choose(data.lang,data.voice)});}catch(e){send(res,400,{error:e.message});}});return;
    }
    if (['/api/upload', '/api/voice/transcribe', '/api/voice/tts'].includes(url.pathname) || url.pathname.startsWith('/api/live/')) {
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST to attach a file.' });
      if (req.headers['x-nexus'] !== '1') return send(res, 403, { error: 'forbidden' });
      const origin = req.headers.origin;
      const expected = remote ? `https://${CONFIG.remoteHost}` : `http://${req.headers.host}`;
      if (origin && origin !== expected) return send(res, 403, { error: 'forbidden origin' });
      const device = remote ? auth.deviceFor(req)?.id : 'local';
      if (!device) return send(res, 401, { error: 'pair this device first' });
      if (url.pathname.startsWith('/api/live/')) return live.handle(req,res,url.pathname,device,()=>!remote||(auth.tailnetOk(req)&&auth.deviceFor(req)?.id===device));
      if (url.pathname.startsWith('/api/voice/')) return voice.handle(req, res, url.pathname, () => !remote || (auth.tailnetOk(req) && !!auth.deviceFor(req)));
      return uploads.upload(req, res, device, () => !remote || (auth.tailnetOk(req) && !!auth.deviceFor(req)));
    }
    if (url.pathname === '/api/pair/new' && req.method === 'POST') {
      // One-time pairing codes are issued only on the PC itself.
      if (remote || req.headers['x-nexus'] !== '1') return send(res, 403, { error: 'forbidden' });
      return send(res, 200, auth.newCode());
    }
    if (url.pathname === '/api/locate-file') {
      // A file dropped on the composer becomes its path on this PC; only the PC itself may ask.
      const origin = req.headers.origin;
      if (remote || req.method !== 'POST' || req.headers['x-nexus'] !== '1' || origin && origin !== `http://${req.headers.host}`) return send(res, 403, { error: 'Dropping a file inserts its path only on the PC. Use the clip to upload from this device.' });
      let body = '';
      req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
      req.on('end', async () => { try { send(res, 200, await fileLocate.locate(JSON.parse(body || '{}'))); } catch (e) { send(res, 400, { error: e.message }); } });
      return;
    }
    if (url.pathname === '/api/pair/status') {
      if (remote || req.method !== 'GET') return send(res, 403, { error:'PC only' });
      return send(res, 200, auth.pairingStatus(url.searchParams.get('id')));
    }
    if (url.pathname === '/api/devices') {
      if (remote || req.method !== 'GET') return send(res, 403, { error: 'PC only' });
      return send(res, 200, { devices: auth.list() });
    }
    if (url.pathname === '/api/devices/revoke') {
      if (remote || req.method !== 'POST' || req.headers['x-nexus'] !== '1') return send(res, 403, { error: 'PC only' });
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body || '{}');
          if (!auth.revoke(id)) return send(res, 404, { error: 'Device not found' });
          terms.revalidateClients();
          send(res, 200, { ok: true });
        } catch (e) { send(res, 400, { error: e.message }); }
      });
      return;
    }
    if (['/api/themes','/api/themes/assign','/api/themes/accept','/api/themes/undo','/api/themes/brief'].includes(url.pathname)) {
      if(req.method==='GET'&&url.pathname==='/api/themes'){scan(Number(url.searchParams.get('days'))||CONFIG.recentDays||10);return send(res,200,themes.catalog());}
      if(req.method==='GET'&&url.pathname==='/api/themes/brief'){scan(CONFIG.recentDays||10);const t=themes.find(url.searchParams.get('id'));if(!t)return send(res,404,{error:'Theme no longer exists.'});return send(res,200,themeBrief.discover(t,themes.last));}
      if(req.method!=='POST')return send(res,405,{error:'Use POST.'});
      const expected=remote?`https://${CONFIG.remoteHost}`:`http://${req.headers.host}`;
      if(req.headers['x-nexus']!=='1'||req.headers.origin&&req.headers.origin!==expected)return send(res,403,{error:'forbidden'});
      if(process.env.NEXUS_READ_ONLY==='1')return send(res,403,{error:'This verification server is read-only.'});
      let body='';req.on('data',c=>{body+=c;if(body.length>1e5)req.destroy();});
      req.on('end',()=>{try{
        if(remote&&(!auth.tailnetOk(req)||!auth.deviceFor(req)))return send(res,401,{error:'Pair this device again.'});
        const b=JSON.parse(body||'{}');scan(Number(url.searchParams.get('days'))||CONFIG.recentDays||10);
        if(url.pathname==='/api/themes/brief'){const t=themes.find(b.id);if(!t)throw Error('Theme no longer exists.');return send(res,200,{ok:true,result:themeBrief.save(t,themes.last,b)});}
        const changed=url.pathname==='/api/themes/undo'?{result:themeMutations.restore(b.token)}:themeMutations.run(()=>url.pathname==='/api/themes'?themes.change(b):themes.assign(b.keys,b.themeId,url.pathname==='/api/themes/accept'));
        scan(Number(url.searchParams.get('days'))||CONFIG.recentDays||10);send(res,200,{ok:true,...changed,...themes.catalog()});
      }catch(e){send(res,400,{error:e.message});}});return;
    }
    if (url.pathname === '/api/sessions') {
      const installed = agents.refresh();
      const days = Number(url.searchParams.get('days')) || CONFIG.recentDays || 10;
      const running=terms.list();
      // Sub-agent rows reach the client with the chat (attach); the list only needs the counts.
      const list = scan(days).map(s => { const { file, chainFiles, subagents, ...rest } = s; const t=running.find(t=>t.sessionKey===s.kind+':'+s.id&&!t.exited);return { ...rest, ...(s.kind==='copilot'?{copilotNextOptions:copilotPreferences.get('copilot:'+s.id)}:{}), model:t?.model&&t.modelAt>(s.modelAt||0)?t.model:s.model, nextModel:modelPreference(s)?.model||'', label:labels.get(s), insights: insights.forSession(s) }; });
      return sendSessions(req, res, url, { now: Date.now(), build: BUILD, remote, remoteUrl: CONFIG.remoteHost ? `https://${CONFIG.remoteHost}` : '', home: HOME, agents:installed, summarizer:agents.summaryProvider(installed), settings:handoff.view(), sessions: list, terms: terms.list(), briefing: insights.briefing(list), usage: { ...(installed.claude.installed?{claude:claudeUsage()}:{}), ...(installed.astra.installed?{astra:astraUsage()}:{}), ...(installed.copilot.installed?{copilot:copilotUsage(list)}:{}) } });
    }
    // CPU and memory per running session (NEXUS terminals and live agents), sampled only while Spend asks for it.
    if(url.pathname==='/api/load'){
      const roots=[],seen=new Set(),add=(key,pid)=>{if(Number.isInteger(pid)&&pid>0&&!seen.has(pid)){seen.add(pid);roots.push({key,pid});}};
      for(const t of terms.list())if(!t.exited)add(t.sessionKey||'term:'+t.id,t.pid);
      for(const s of scan(CONFIG.recentDays||10))if(s.live)add(s.kind+':'+s.id,s.pid);
      return processLoad.sample(roots).then(v=>send(res,200,v),e=>send(res,500,{error:e.message}));
    }
    if(url.pathname==='/api/models'){models.discover();return send(res,200,models.catalog(CONFIG));}
    if (VENDOR[url.pathname]) {
      return fs.readFile(path.join(ROOT, 'node_modules', VENDOR[url.pathname]), (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(url.pathname)], 'Cache-Control': 'max-age=86400' });
        res.end(data);
      });
    }
    if (url.pathname === '/api/commands') {
      const key=url.searchParams.get('key'),s=key?.startsWith('term:')?terms.list().find(t=>t.id===key.slice(5)):sessionFor(key);
      if(!s)return send(res,404,{error:'Session unavailable. Refresh sessions.'});
      slashCommands.discover(s.kind,s.cwd).then(data=>send(res,200,data),error=>send(res,400,{error:error.message}));return;
    }
    if (url.pathname === '/api/queue') return send(res,200,messageQueue.view(queueKey(url.searchParams.get('key'))));
    if (url.pathname === '/api/chat') {
      const s = sessionFor(url.searchParams.get('key'));
      if (!s) return send(res, 404, { error: 'Session unavailable. Refresh sessions.' });
      return send(res, 200, {...chatSnapshot(s, url.searchParams.get('cursor')),queue:messageQueue.view(queueKey(s.kind+':'+s.id))});
    }
    if (url.pathname === '/api/term-state') return send(res, 200, {...terms.state(url.searchParams.get('term')),queue:messageQueue.view(queueKey('term:'+url.searchParams.get('term')))});
    if (url.pathname === '/api/transcript') {
      const t = transcript(url.searchParams.get('key'), Number(url.searchParams.get('bytes')), Number(url.searchParams.get('limit')));
      return t ? send(res, 200, { ...t, capturedAt: Date.now() }) : send(res, 404, { error: 'not found' });
    }
    if (url.pathname === '/api/recap' && req.method === 'GET') {
      const s = sessionFor(url.searchParams.get('key'));
      const since=url.searchParams.has('since')?Number(url.searchParams.get('since')):null;
      if(since!==null&&(!Number.isSafeInteger(since)||since<0||since>Date.now()))return send(res,400,{error:'Invalid call start time.'});
      return s ? send(res, 200, {...recap.instant(s,{since}),summarizer:agents.summaryProvider()}) : send(res, 404, { error: 'Session unavailable. Refresh the session list.' });
    }
    if (url.pathname.startsWith('/preview/') && req.method === 'GET') return servePreview(res, url.pathname);
    if (url.pathname === '/api/action' && req.method === 'POST') {
      // The custom header forces a CORS preflight, which this server never answers: web pages cannot trigger actions.
      if (req.headers['x-nexus'] !== '1') return send(res, 403, { error: 'forbidden' });
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', async () => {
        try {
          const b = JSON.parse(body || '{}');
          // From a phone, never shut NEXUS down (nothing could start it again) or pop windows on the PC.
          if (remote && REMOTE_BLOCKED.has(b.action)) return send(res, 403, { error: 'That action only works on the PC.' });
          const controller=b.action==='summarize-theme'?new AbortController():null;
          if(controller)res.once('close',()=>{if(!res.writableEnded)controller.abort();});
          const result=await act(b,controller?.signal);if(!res.destroyed)send(res, 200, { ok: true, result });
        }
        catch (e) { send(res, 400, { error: e.message }); }
      });
      return;
    }
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(path.join(ROOT, 'public', file));
    if (!file.startsWith(path.join(ROOT, 'public') + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } catch (e) { send(res, 500, { error: e.message }); }
});

function openWindow() {
  const url = `http://127.0.0.1:${PORT}/`;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const exe = candidates.find(p => fs.existsSync(p));
  const profile = path.join(HOME, 'AppData', 'Local', 'NexusDeck', 'browser');
  // Maximized, not --start-fullscreen: browser fullscreen can't be left from the page, page fullscreen can.
  if (exe) spawn(exe, ['--app=' + url, '--start-maximized', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}

// The phone reaches terminals through the same tailnet + paired-device checks as every other request.
terms.attach(server, PORT, {
  origins: CONFIG.remoteHost ? [`https://${CONFIG.remoteHost}`] : [],
  authorize: req => !auth.isRemote(req) || (auth.tailnetOk(req) && !!auth.deviceFor(req)),
});

// ---------- updates ----------
// An update written while NEXUS runs (git pull, a fresh download) would otherwise keep serving the old code until
// the next restart. Once the files have stopped changing and no session or call runs inside NEXUS, a fresh NEXUS
// takes the port over and open windows reload (BUILD changes).
const TAKEOVER = process.argv.includes('--takeover');
function codeStamp() {
  const parts = [];
  for (const dir of [ROOT, path.join(ROOT, 'public'), path.join(ROOT, 'slash')]) try { for (const f of fs.readdirSync(dir).sort()) if (/\.(c?js|css|html)$/.test(f)) { const st = fs.statSync(path.join(dir, f)); parts.push(f, st.size, st.mtimeMs); } } catch {}
  return require('crypto').createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}
const BUILD = codeStamp();
let seenStamp = BUILD, failedStamp = '', handingOver = false;
function handOver() {
  const stamp = codeStamp(), settled = stamp === seenStamp; seenStamp = stamp;
  if (handingOver || stamp === BUILD || stamp === failedStamp || !settled || terms.anyRunning() || live.size) return;
  handingOver = true;
  const flags = [...process.argv.slice(2).filter(a => a !== '--open' && a !== '--takeover' && a !== '--idle-exit'), ...(OPEN || process.argv.includes('--idle-exit') ? ['--idle-exit'] : [])];
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--takeover', ...flags], { cwd: ROOT, env: process.env, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const fail = () => { handingOver = false; failedStamp = stamp; };
  child.once('error', fail); child.once('exit', fail);
  // The new NEXUS says ready once its code has loaded; a copy that cannot start leaves this one serving.
  child.once('message', m => { if (m !== 'ready') return; child.removeListener('exit', fail); child.disconnect(); child.unref(); server.close(); setTimeout(() => process.exit(0), 300); });
}

let takeoverTries = 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && TAKEOVER && ++takeoverTries < 60) return setTimeout(() => server.listen(PORT, '127.0.0.1'), 300);
  if (e.code === 'EADDRINUSE') { if (OPEN) openWindow(); setTimeout(() => process.exit(0), 500); }
  else { console.error(e); process.exit(1); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`NEXUS deck on http://127.0.0.1:${PORT}/`);
  if (process.env.NEXUS_NO_ACCOUNT_POLL !== '1') {
    pollAstraLive();
    setInterval(pollAstraLive, 5 * 60e3);
  }
  if (OPEN || process.argv.includes('--idle-exit')) {
    if (OPEN) openWindow();
    // Launched from the shortcut: shut down once the window has been closed for a while,
    // unless in-app terminals are still running (reopening NEXUS reattaches to them).
    // With remote access configured the phone may connect at any time, so NEXUS stays up.
    if (!CONFIG.remoteHost) setInterval(() => { if (Date.now() - lastHit > 90e3 && !terms.anyRunning()) process.exit(0); }, 15e3);
    setInterval(handOver, 15e3).unref();
  }
});
if (TAKEOVER && process.send) process.send('ready');
