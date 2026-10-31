'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const language = require('../public/activity-language');
const recap = require('../recap');
const preview = require('../session-preview');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wall-checks-'));
const at = new Date().toISOString();
const user = text => ({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
const ai = content => ({ type: 'assistant', timestamp: at, message: { content } });
const write = (name, records) => { const file = path.join(dir, name); fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n'); return file; };
const s = file => ({ kind: 'claude', id: 'fixture', file, status: 'busy', live: true });
async function main() {
  assert.equal(language.groups([{ name: 'Edit', input: { file_path: 'C:\\fixture\\public\\app.js', new_string: 'SECRET' } }, { name: 'Write', input: { file_path: 'C:\\fixture\\public\\recap.js', content: 'SECRET' } }])[0], 'Edited 2 files in public/');
  assert.equal(language.groups(Array.from({ length: 3 }, () => ({ name: 'Bash', input: { command: 'echo SECRET' } })))[0], 'Ran 3 shell commands');
  assert.equal(language.describe([language.tool('mcp__claude-in-chrome__navigate', { url: 'https://partner.steamgames.com/apps/?secret=1' })]), 'Browsed partner.steamgames.com in Chrome');
  assert.equal(language.describe([language.tool('Bash', { command: 'codex exec "SECRET"' })]), 'Started an Astra run');
  assert.equal(language.describe([language.tool('functions.apply_patch', '*** Begin Patch\n*** Update File: public/app.js\n+SECRET\n*** End Patch')]), 'Edited app.js');
  assert.equal(language.tool('functions.exec', { code: 'await tools.exec_command({cmd:"secret"})' }).kind, 'command');
  assert.deepEqual(language.tool('functions.exec', 'await tools.apply_patch("*** Begin Patch\\n*** Update File: public/app.js\\n+PRIVATE_FILE_CONTENT\\n*** End Patch")').files, ['public/app.js']);
  assert.equal(language.subtitle({ title: 'Custom name', aiTitle: 'Steam store page and Cloud publishing for BEACON', firstPrompt: 'I want you to use multiple agents to do something.' }), 'Steam store page and Cloud publishing for BEACON');
  assert.equal(language.subtitle({ firstPrompt: 'I wanna make a dashboard for local sessions.' }), 'Make a dashboard for local sessions.');
  assert(!/C:|mcp__|\{|SECRET/.test(language.readable('**Done.** Edited `C:\\fixture\\My Project\\app.js`.\n```js\nSECRET\n```\nmcp__claude-in-chrome__navigate {"tabId":42}')));
  const p = preview.createPreview();
  preview.observePreview(p, ai([{ type: 'tool_use', name: 'Edit', input: { file_path: 'public/a.js' } }, { type: 'tool_use', name: 'Write', input: { file_path: 'public/b.js' } }]));
  assert.equal(p.latestContext, 'Edited 2 files in public/');
  preview.observePreview(p, ai([{ type: 'text', text: '**Finished.** Ready to review. Third sentence.' }]));
  assert.equal(p.latestContext, 'Finished.');
  console.log('PASS human language: grouped tools, short paths, sites, Astra, markdown and payload removal');

  const records = [user('Old request'), ai([{ type: 'text', text: 'Old response' }]), user('Check the release — café ' + 'a'.repeat(110)),
    { ...user('<command-name>/status</command-name>') }, { ...user('Ignore metadata'), isMeta: true }, { ...user('Sidechain request'), isSidechain: true },
    ai([{ type: 'text', text: 'First progress.' }, { type: 'tool_use', name: 'Edit', id: 'edit', input: { file_path: 'C:\\fixture\\public\\app.js', new_string: 'PRIVATE_FILE_CONTENT' } }]),
    user([{ type: 'tool_result', tool_use_id: 'edit', content: 'Success PRIVATE_FILE_CONTENT' }]),
    ai([{ type: 'tool_use', name: 'Bash', id: 'cmd', input: { command: 'npm test' } }]), user([{ type: 'tool_result', tool_use_id: 'cmd', is_error: true, content: 'Error: failed' }]),
    ai([{ type: 'tool_use', name: 'mcp__claude-in-chrome__navigate', id: 'browser', input: { url: 'https://partner.steamgames.com/apps' } }, { type: 'text', text: '**Release checked.**\n\n- Configuration saved.\n- One check needs attention.' }])];
  const file = write('claude.jsonl', records);
  const span = recap.readSpan(file, { chunkBytes: 31 });
  assert.equal(span.user.text, records[2].message.content, 'user line and UTF-8 survive many chunk boundaries');
  assert.equal(span.partial, false); assert(span.bytesRead <= fs.statSync(file).size);
  const data = recap.build(s(file), span);
  assert.deepEqual(data.files, ['app.js']); assert.equal(data.counts.commands, 1); assert.equal(data.counts.errors, 1); assert.equal(data.counts.sites, 1);
  assert.equal(data.status.label, 'Working'); assert(data.finalAssistant.startsWith('Release checked.'));
  assert(!data.digest.includes('PRIVATE_FILE_CONTENT')); assert(!data.digest.includes('Old response'));
  assert(data.digest.indexOf('First progress.') < data.digest.indexOf('Edited app.js'), 'within-record event order preserved');
  assert.equal(recap.instant(s(file)).digest, undefined, 'instant API does not send model input to browser');
  assert.equal(recap.realUser({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>meta</environment_context>' }, { type: 'input_text', text: 'Actual owner request' }] } }).text, 'Actual owner request');
  const capped = recap.readSpan(file, { chunkBytes: 37, maxBytes: 250 });
  assert.equal(capped.bytesRead, 250); assert.equal(capped.partial, true); assert.equal(capped.user, null);
  const empty = write('empty.jsonl', []); assert.equal(recap.readSpan(empty).user, null);
  const noFinalNewline = write('no-newline.jsonl', [user('First request')]); fs.truncateSync(noFinalNewline, fs.statSync(noFinalNewline).size - 1);
  assert.equal(recap.readSpan(noFinalNewline, { chunkBytes: 7 }).user.text, 'First request');
  fs.appendFileSync(file, '{"partial":'); assert.equal(recap.readSpan(file).user.text, span.user.text, 'in-progress trailing record ignored');
  const huge = path.join(dir, '800mb.jsonl'), fd = fs.openSync(huge, 'w'); fs.ftruncateSync(fd, 800 * 1024 * 1024);
  const tail = '\n' + records.slice(2).map(r => JSON.stringify(r)).join('\n') + '\n'; fs.writeSync(fd, tail, 800 * 1024 * 1024 - Buffer.byteLength(tail)); fs.closeSync(fd);
  assert.equal(recap.readSpan(huge).bytesRead, 65536, '800 MB file reads only one chunk when the latest message is nearby');
  const noUserHuge = path.join(dir, 'cap.jsonl'), capFd = fs.openSync(noUserHuge, 'w'); fs.ftruncateSync(capFd, 800 * 1024 * 1024); fs.closeSync(capFd);
  const cap = recap.readSpan(noUserHuge); assert.equal(cap.bytesRead, 4 * 1024 * 1024); assert.equal(cap.partial, true);
  console.log('PASS backwards reader: split JSON/UTF-8, real user filtering, event order, incomplete writes, 800 MB sparse files, 4 MB cap');

  const astra = write('astra.jsonl', [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md\nmeta' }] } },
    { type: 'event_msg', timestamp: at, payload: { type: 'user_message', message: 'Review the rollout' } },
    { type: 'response_item', timestamp: at, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Review the rollout' }] } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch', input: '*** Begin Patch\n*** Update File: public/app.js\n+PRIVATE_FILE_CONTENT\n*** End Patch' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'patch', output: 'Success' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Validated the layout.' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Validated the layout.' }] } },
    { type: 'event_msg', payload: { type: 'task_complete' } }
  ]);
  const ad = recap.build({ ...s(astra), kind: 'astra' }, recap.readSpan(astra, { chunkBytes: 51 }));
  assert.equal(ad.user.text, 'Review the rollout'); assert.equal(ad.counts.files, 1); assert.equal(ad.status.label, 'Saved');
  assert.equal(ad.digest.split('Validated the layout.').length, 2, 'Codex public message mirror deduplicated');
  console.log('PASS Astra rollout: last user, custom patch, result and completion events, mirrored message deduplication');

  let calls = 0, input, argsSeen, invalid = false;
  const fakeSpawn = (exe, args, opts) => {
    calls++; argsSeen = args; assert(opts.windowsHide); assert.equal(opts.cwd, os.tmpdir()); assert(!opts.env.CLAUDECODE);
    const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    child.stdin.end = text => { input = text; setTimeout(() => { child.stdout.emit('data', JSON.stringify({ result: invalid ? 'broken' : JSON.stringify({ bullets: ['Checked the release.', 'Saved the configuration.', 'One test needs attention.'], next: 'Review the failed check.' }), total_cost_usd: .001 })); child.emit('close', 0); }, 20); };
    return child;
  };
  const summarize = recap.createSummarizer(fakeSpawn,()=>({kind:'claude',model:'haiku'}),(kind,args)=>({file:'claude.exe',args}));
  const first = summarize(s(file)); fs.appendFileSync(file, '\n' + JSON.stringify(ai([{ type: 'text', text: 'Later progress' }])) + '\n');
  const second = summarize(s(file)); await Promise.all([first, second]); assert.equal(calls, 1, 'growth during an in-flight request cannot start a second model request');
  assert(argsSeen.includes('--safe-mode')); assert(argsSeen.includes('--no-session-persistence')); assert(argsSeen.includes('--strict-mcp-config'));
  assert.equal(argsSeen[argsSeen.indexOf('--model') + 1], 'haiku'); assert.equal(argsSeen[argsSeen.indexOf('--tools') + 1], ''); assert.equal(argsSeen[argsSeen.indexOf('--allowedTools') + 1], '');
  assert.equal(argsSeen[argsSeen.indexOf('--mcp-config') + 1], '{"mcpServers":{}}'); assert(input.length <= 12000); assert(!input.includes('PRIVATE_FILE_CONTENT'));
  await summarize(s(file)); assert.equal(calls, 2); assert.equal((await summarize(s(file))).cached, true); assert.equal(calls, 2);
  fs.appendFileSync(file, '\n'); invalid = true; await assert.rejects(summarize(s(file)), /valid recap/); invalid = false; await summarize(s(file)); assert.equal(calls, 4);
  const many = write('long.jsonl', [user('Summarize progress'), ...Array.from({ length: 100 }, (_, i) => ai([{ type: 'text', text: 'Progress ' + i + ' ' + 'a'.repeat(1000) }]))]);
  await summarize(s(many)); assert(input.length <= 12000); assert(input.includes('Progress 99')); assert(input.includes('Earlier activity omitted'));
  await summarize({ ...s(astra), kind: 'astra' });
  assert(input.includes('Review the rollout') && input.includes('Edited app.js') && !input.includes('PRIVATE_FILE_CONTENT'), 'Astra summary uses the same isolated model boundary with rollout evidence');
  console.log('PASS summary boundary: stub only, no tools/MCP/persistence, safe mode, 12k digest, one request per session, size cache, malformed-output retry');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  const target = fs.realpathSync(dir), temp = fs.realpathSync(os.tmpdir());
  if (!target.toLowerCase().startsWith(temp.toLowerCase() + path.sep) || !path.basename(target).startsWith('nexus-wall-checks-')) throw Error('Unsafe fixture cleanup');
  fs.rmSync(target, { recursive: true, force: true });
});
