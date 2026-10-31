'use strict';
// Model lists come from the agents where they publish one locally: Codex keeps its catalog in
// models_cache.json and Copilot prints every accepted model in `copilot help config`. Entries in
// config.json are merged in (descriptions, premium multipliers, extra IDs). Never interpolate model IDs into a shell.
const fs = require('fs'), os = require('os'), path = require('path');
const safe = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(id);
const defaults = {
  antigravity: [{id:'default',description:'Antigravity picks the model'}],
  claude: [{id:'claude-opus-5-5',description:'Complex reasoning and demanding code'},{id:'claude-sonnet-5-5',description:'Balanced everyday coding'},{id:'claude-fable-5-1',description:'Long tasks and careful reasoning'},{id:'claude-haiku-5-5',description:'Fast, lightweight tasks'}],
  astra: [{id:'gpt-6.1-sol'},{id:'gpt-6-astra'},{id:'gpt-6-sol'},{id:'gpt-6-luna'},{id:'gpt-5.6-terra'}],
  copilot: [{id:'claude-opus-5.5'},{id:'claude-sonnet-5.5'},{id:'gpt-6.1-sol'},{id:'gpt-6-luna'},{id:'gpt-5.6-luna'},{id:'claude-haiku-4.5'}]
};
const found = { copilot: [] };
let copilotAt = 0;
function codexModels(home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  try {
    const file = path.join(home, 'models_cache.json'), st = fs.statSync(file);
    if (codexModels.key !== file + st.mtimeMs) {
      codexModels.key = file + st.mtimeMs;
      // Codex rewrites this cache per account and version; keep every model seen while NEXUS runs.
      const seen = (JSON.parse(fs.readFileSync(file, 'utf8')).models || []).filter(m => m && m.visibility !== 'hide' && safe(m.slug)).map(m => ({ id: m.slug, description: String(m.description || '').slice(0, 140) }));
      codexModels.list = [...seen, ...(codexModels.list || []).filter(m => !seen.some(x => x.id === m.id))];
    }
  } catch {}
  return codexModels.list || [];
}
function parseCopilotHelp(text) {
  const at = String(text).indexOf('`model`:'); if (at < 0) return [];
  const ids = [];
  for (const line of String(text).slice(at).split(/\r?\n/).slice(1)) {
    const m = /^\s*-\s*"([^"]+)"\s*$/.exec(line);
    if (m) { if (safe(m[1])) ids.push(m[1]); } else if (ids.length || /^\s*`/.test(line)) break;
  }
  return ids;
}
// Runs `copilot help config` hidden, at most every six hours. It reads local help text only.
function discover(installed = require('./agents').detect()) {
  const exe = installed?.copilot?.installed && installed.copilot.executable;
  if (!exe || Date.now() - copilotAt < 6 * 3600e3) return;
  copilotAt = Date.now();
  const script = /\.(cmd|bat)$/i.test(exe), { execFile } = require('child_process');
  try { execFile(script ? process.env.ComSpec || 'cmd.exe' : exe, script ? ['/d', '/s', '/c', '"' + exe + '" help config'] : ['help', 'config'], { windowsHide: true, timeout: 20000, windowsVerbatimArguments: script }, (error, stdout) => {
    const ids = parseCopilotHelp(stdout || '');
    if (ids.length) found.copilot = ids.map(id => ({ id }));
    else copilotAt = Date.now() - 6 * 3600e3 + 5 * 60e3;
  }).on('error', () => {}); } catch {} // No Copilot list: config.json and the defaults still apply.
}
function catalog(config) {
  const sources = { claude: [], astra: codexModels(), copilot: found.copilot, antigravity: [] };
  return Object.fromEntries(['claude','astra','copilot','antigravity'].map(kind=>{
    const merged = [], add = m => { const old = merged.find(x => x.id === m.id); if (!old) merged.push({ ...m }); else for (const [k, v] of Object.entries(m)) if (old[k] === undefined || old[k] === '') old[k] = v; };
    for (const m of sources[kind]) add(m);
    for (const m of (config.models?.[kind] || []).map(m => typeof m === 'string' ? { id: m } : m).filter(m => safe(m?.id))) add(m);
    if (!merged.length) for (const m of defaults[kind]) add(m);
    if (kind === 'copilot' && sources.copilot.length && !merged.some(m => m.id === 'auto')) merged.push({ id: 'auto', description: 'Copilot picks the model for each request' });
    return [kind, merged.map(m=>({id:m.id,label:require('./public/redesign-core').modelLabel(m.id),description:String(m.description||''),...(kind==='copilot'&&Number.isFinite(m.premiumMultiplier)&&m.premiumMultiplier>=0?{premiumMultiplier:m.premiumMultiplier}:{}),...(kind==='copilot'&&typeof m.longContext==='boolean'?{longContext:m.longContext}:{})}))];}));
}
function validate(config,kind,id){if(!catalog(config)[kind]?.some(m=>m.id===id))throw Error('Choose a model from the configured list.');return id;}
function args(config,kind,id){if(kind==='antigravity'&&id==='default')return [];return id?[kind==='astra'?'-m':'--model',validate(config,kind,id)]:[];}
function observed(kind,record){
  if(kind==='copilot')return record?.type==='session.model_change'?record.data?.newModel:record?.type==='assistant.message'?record.data?.model:['session.start','session.resume'].includes(record?.type)?record.data?.selectedModel:null;
  if(kind==='claude')return record?.type==='assistant'&&!record.isSidechain&&record.message?.model&&record.message.model!=='<synthetic>'?record.message.model:null;
  return record?.type==='turn_context'&&typeof record.payload?.model==='string'?record.payload.model:null;
}
function latest(kind,records){let model='';for(const record of records)model=observed(kind,record)||model;return model;}
function command(id){if(!safe(id))throw Error('Invalid model ID');return '/model '+id;}
function confirmed(text,id){
  // Cursor-positioned redraws insert spaces with CSI moves, not literal spaces.
  // Interpret the screen before matching the CLI's explicit acknowledgement.
  let plain=String(text);
  if(plain.includes('\x1b')){const {TerminalScreen}=require('./terminal-screen'),display=new TerminalScreen();display.write(plain);if(display.pending||display.synchronized)return false;plain=display.text();}
  const echo=plain.lastIndexOf('/model '+id);if(echo>=0)plain=plain.slice(echo+('/model '+id).length);
  const label=id.replace(/^claude-/,'').replace(/-(\d+)-(\d+)$/,' $1.$2').replace(/-/g,' ');
  return plain.split(/\r?\n/).some(line=>/\b(?:set|switched|changed|using)\s+(?:the\s+)?model\b/i.test(line)&&(line.toLowerCase().includes(id.toLowerCase())||line.toLowerCase().includes(label.toLowerCase())));
}
module.exports={catalog,validate,args,observed,latest,command,confirmed,discover,parseCopilotHelp,codexModels};
