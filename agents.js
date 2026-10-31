'use strict';
const fs = require('fs'), path = require('path');
const names = { claude: 'claude', astra: 'codex', copilot: 'copilot', antigravity: 'agy' };
function detect({ env = process.env, platform = process.platform, exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } } } = {}) {
  const windows = platform === 'win32', entries = String(env.PATH || env.Path || '').split(windows ? ';' : ':').filter(Boolean);
  const extensions = windows ? ['.exe', '.cmd', '.bat'] : [''];
  // Its installer edits the user PATH, which a running NEXUS does not see until it restarts.
  if (windows && env.LOCALAPPDATA) entries.push(path.join(env.LOCALAPPDATA, 'agy', 'bin'));
  return Object.fromEntries(Object.entries(names).map(([kind, name]) => {
    let executable = '';
    for (const dir of entries) { for (const ext of extensions) { const candidate = path.join(dir.replace(/^"|"$/g, ''), name + ext); if (exists(candidate)) { executable = candidate; break; } } if (executable) break; }
    return [kind, { installed: !!executable, executable }];
  }));
}
let available = detect();
let summaryModel='gpt-6-luna';
function configure(config){if(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(config.copilotSummaryModel||''))summaryModel=config.copilotSummaryModel;}
// The list poll asks every 1.8 s. PATH is looked through at most every 30 s: a work PC's PATH can hold network folders,
// and an agent that is not installed is looked for in every one of them.
let detectedAt = Date.now();
function refresh() { if (Date.now() - detectedAt >= 30000) { available = detect(); detectedAt = Date.now(); } return publicStatus(); }
function publicStatus() { return Object.fromEntries(Object.entries(available).map(([kind, value]) => [kind, { installed: value.installed }])); }
// An off switch a newer CLI no longer knows ("--no-remote was removed") is left out of later launches instead of
// failing every run. Only --no-… and --disable-… flags: dropping one never adds tools or permissions.
const unknownFlags = new Set();
function unsupported(kind, stderr) {
  const m = /(?:unexpected argument|unknown option)\s+['"]?(--(?:no|disable)-[\w-]+)|(--(?:no|disable)-[\w-]+) was removed/i.exec(String(stderr || '')), flag = m && (m[1] || m[2]);
  if (!flag || unknownFlags.has(kind + ' ' + flag)) return false;
  unknownFlags.add(kind + ' ' + flag); return true;
}
function launch(kind, args = []) {
  args = args.filter(arg => !unknownFlags.has(kind + ' ' + arg));
  const agent = available[kind];
  if (!agent?.installed) throw Error(`${names[kind] || kind} is not installed on PATH. Install it, then refresh NEXUS.`);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(agent.executable)) {
    // npm shims quote through cmd.exe poorly when flags contain JSON. Launch
    // their existing JS entry with Node directly; do not invoke a shell.
    const shim=fs.readFileSync(agent.executable,'utf8');
    const script=/%dp0%[\\/]([^"\r\n]+\.(?:cjs|mjs|js))"/i.exec(shim);
    if(script){const entry=path.resolve(path.dirname(agent.executable),script[1]);if(fs.existsSync(entry))return {file:process.execPath,args:[entry,...args]};}
    // Only fixed CLI flags, UUIDs and allowlisted model IDs reach this wrapper.
    if (args.some(arg => /[\r\n"%&|<>^]/.test(arg))) throw Error('Unsupported character in CLI argument.');
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', names[kind], ...args] };
  }
  return { file: agent.executable, args };
}
function summaryProvider(status = publicStatus()) {
  if (status.claude?.installed) return { kind: 'claude', model: 'haiku', note: 'One Haiku request using your Claude account. Runs only when you press Summarize.' };
  if (status.copilot?.installed) return { kind: 'copilot', model: summaryModel, note: 'One Copilot '+summaryModel+' request. Your plan determines credits or premium requests. Runs only when you press Summarize; Copilot saves the summary session.' };
  if (status.astra?.installed) return {kind:'astra',model:'gpt-5.6-terra',note:'One Astra request using your Codex account. Runs only when you press Summarize.'};
  return { kind: null, note: 'Summarize requires Claude, Codex or Copilot on PATH. The instant recap is available without a model.' };
}
module.exports = { detect, refresh, publicStatus, launch, unsupported, summaryProvider, configure };
