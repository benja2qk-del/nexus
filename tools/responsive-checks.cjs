'use strict';
// Session polls send only changed sessions (gzipped when large); model lists come from the agents.
// Private port, fixture homes under .local; the real agent folders are never read.
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), zlib = require('zlib'), { spawn } = require('child_process');
const models = require('../models'), core = require('../public/redesign-core');
fs.mkdirSync('.local', { recursive: true }); const root = fs.mkdtempSync(path.resolve('.local/responsive-'));
const claude = path.join(root, 'claude', 'projects', 'fixture'), cwd = path.join(root, 'work');
for (const p of [claude, cwd, path.join(root, 'codex', 'sessions'), path.join(root, 'copilot', 'session-state')]) fs.mkdirSync(p, { recursive: true });
const ts = new Date().toISOString(), line = r => JSON.stringify({ timestamp: ts, cwd, ...r }) + '\n';
const user = text => line({ type: 'user', message: { content: text } });
fs.writeFileSync(path.join(claude, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), user('Plan the sell-out ranking. ' + 'Long brief. '.repeat(3000)) + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Planning the ranking.' }] } }));
fs.writeFileSync(path.join(claude, 'aaaaaaaa-0000-4000-8000-000000000002.jsonl'), user('Review the store list for the Bogota, Medellin and Barranquilla priority ranking, then summarize it.') + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reviewing the stores now.' }] } }));
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({}));
for (let i = 10; i < 70; i++) fs.writeFileSync(path.join(claude, 'bbbbbbbb-0000-4000-8000-0000000000' + i + '.jsonl'), user('Store cluster ' + i + ': rank the OOH opportunities near the top sell-out stores and list the evidence.') + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Cluster ' + i + ' ranked.' }] } }));
const port = process.env.NEXUS_TEST_PORT || '4791', base = 'http://127.0.0.1:' + port;
const env = { ...process.env, NEXUS_PORT: port, NEXUS_NO_ACCOUNT_POLL: '1', NEXUS_CLAUDE_DIR: path.join(root, 'claude'), NEXUS_CODEX_DIR: path.join(root, 'codex'), NEXUS_COPILOT_DIR: path.join(root, 'copilot'), NEXUS_STATE_FILE: path.join(root, 'state', 'state.json'), NEXUS_THEMES_FILE: path.join(root, 'state', 'themes.json'), NEXUS_CONFIG_FILE: path.join(root, 'config.json'), NEXUS_DEVICES_FILE: path.join(root, 'state', 'devices.json'), CODEX_HOME: path.join(root, 'codex') };
const report = [], pass = label => { report.push('PASS ' + label); console.log(report.at(-1)); };
let server;
async function start() {
  server = spawn(process.execPath, ['server.js'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let err = '';
  server.stderr.on('data', d => err += d);
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Startup timeout ' + err)), 15000); server.once('exit', c => { clearTimeout(t); reject(Error('Server exited ' + c + ' ' + err)); }); server.stdout.on('data', d => { if (String(d).includes(port + '/')) { clearTimeout(t); resolve(); } }); });
}
async function sessions(query = '', encoding = 'identity') {
  const res = await fetch(base + '/api/sessions' + query, { headers: { 'X-Nexus': '1', 'Accept-Encoding': encoding } });
  return { gzip: res.headers.get('content-encoding') === 'gzip', body: await res.json() };
}
(async () => {
  try {
    // Model lists: Copilot's help text, Codex's cache (union while running), config, and readable names.
    const help = 'Settings\n  `model`: AI model to use for Copilot CLI; can be changed with /model.\n    - "claude-opus-5.5"\n    - "gpt-6.1-sol"\n    - "grok-4.7"\n    - "bad id; rm"\n\n  `contextTier`: tier\n    - "default"\n';
    assert.deepEqual(models.parseCopilotHelp(help), ['claude-opus-5.5', 'gpt-6.1-sol', 'grok-4.7']);
    const codexHome = path.join(root, 'codex'), cache = path.join(codexHome, 'models_cache.json');
    fs.writeFileSync(cache, JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }, { slug: 'gpt-reserve', visibility: 'hide' }, { slug: 'gpt-6-luna', visibility: 'list' }] }));
    assert.deepEqual(models.codexModels(codexHome).map(m => m.id), ['gpt-6.1-sol', 'gpt-6-luna']);
    fs.writeFileSync(cache, JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list' }] })); fs.utimesSync(cache, new Date(), new Date(Date.now() + 5000));
    assert.deepEqual(models.codexModels(codexHome).map(m => m.id), ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'], 'a narrower rewrite keeps models already seen');
    assert.deepEqual(['claude-opus-4.8-fast', 'gemini-3.8-flash', 'kimi-k3', 'mai-code-1.1-flash', 'auto', 'gpt-5.4-mini', 'claude-opus-5-5'].map(core.modelLabel), ['Opus 4.8 Fast', 'Gemini 3.8 Flash', 'Kimi K3', 'MAI Code 1.1 Flash', 'Auto', 'GPT-5.4 mini', 'Opus 5.5']);
    const none = models.catalog({});
    assert(none.claude.some(m => m.id === 'claude-opus-5-5') && !none.claude.some(m => m.id === 'opus'), 'without config, Claude offers the current full model IDs');
    pass('model lists: Copilot help parsing, Codex cache union, readable names for every provider, current defaults');

    await start();
    const first = await sessions('', 'gzip');
    assert(first.body.rev && !first.body.delta && first.body.sessions.length === 62, JSON.stringify({rev:first.body.rev,delta:first.body.delta,n:first.body.sessions?.length,ids:first.body.sessions?.map(s=>s.id+":"+s.kind)})+" "+'first poll is a full list with a snapshot id');
    assert(first.gzip, 'a large list is gzipped when the client accepts it (' + JSON.stringify(first.body).length + ' bytes)');
    // Fresh fixtures are still being indexed for a moment; wait until a poll reports nothing new.
    let same = await sessions('?since=' + encodeURIComponent(first.body.rev));
    for (let i = 0; i < 60 && same.body.sessions.length; i++) { await new Promise(r => setTimeout(r, 250)); same = await sessions('?since=' + encodeURIComponent(same.body.rev)); }
    assert(same.body.delta && same.body.sessions.length === 0 && same.body.order.length === 62, 'an unchanged poll sends no sessions, only the order');
    assert(!same.gzip, 'small bodies are not compressed');
    fs.appendFileSync(path.join(claude, 'aaaaaaaa-0000-4000-8000-000000000002.jsonl'), line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done: 12 stores ranked.' }] } }));
    let changed;
    for (let i = 0; i < 30; i++) { changed = await sessions('?since=' + encodeURIComponent(same.body.rev)); if (changed.body.sessions.length) break; await new Promise(r => setTimeout(r, 200)); }
    assert.deepEqual(changed.body.sessions.map(s => s.id), ['aaaaaaaa-0000-4000-8000-000000000002'], 'only the session that changed is sent');
    const unknown = await sessions('?since=unknown-rev');
    assert(!unknown.body.delta && unknown.body.sessions.length === 62, 'an unknown snapshot gets the full list');
    pass('session polls: full list first, then only changed sessions; unknown snapshots fall back to the full list; gzip for large bodies');
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'responsive-checks.txt'), report.join('\n') + '\n');
  } finally {
    if (server) { server.kill(); await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r)); }
    const resolved = fs.realpathSync(root); if (path.basename(resolved).startsWith('responsive-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exit(1); });
