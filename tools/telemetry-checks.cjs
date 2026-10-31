'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { fresh, scanFile, snapshot } = require('../telemetry');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-accounting-'));
  const file = path.join(dir, 'fixture.jsonl');
  const ts = n => new Date(1700000000000 + n * 1000).toISOString();
  const records = [
    { type: 'user', timestamp: ts(1), message: { content: 'Build a clear session overview.' } },
    { type: 'assistant', timestamp: ts(2), message: { id: 'a', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 50, cache_creation_input_tokens: 5 }, content: [{ type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: 'café.js' } }] } },
    { type: 'assistant', timestamp: ts(3), message: { id: 'a', usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 50, cache_creation_input_tokens: 5 }, content: [] } },
    { type: 'user', timestamp: ts(4), message: { content: [{ type: 'tool_result', tool_use_id: 'edit', content: 'Edited.' }] } },
    { type: 'assistant', timestamp: ts(5), message: { id: 'b', content: [{ type: 'tool_use', id: 'commit', name: 'Bash', input: { command: 'git commit -m "Test"' } }] } },
    { type: 'user', timestamp: ts(6), message: { content: [{ type: 'tool_result', tool_use_id: 'commit', content: '[astra-build abc1234] Test\n 1 file changed' }] } },
    { type: 'assistant', timestamp: ts(7), message: { id: 'c', content: [{ type: 'text', text: 'Finished the overview. More follows.' }] } }
  ];
  fs.writeFileSync(file, records.map(JSON.stringify).join('\n') + '\n');
  const s = fresh(file, 'claude'); await scanFile(s);
  let v = snapshot(s);
  assert.equal(v.spend.total, 69); assert.equal(v.spend.turns.length, 1); assert.equal(v.spend.turns[0].total, 69);
  assert.equal(Object.values(v.spend.daily).reduce((a,b)=>a+b,0),69,'daily usage deduplicates repeated assistant records');
  assert.equal(Object.values(v.spend.byModel).reduce((a,b)=>a+b,0),69,'model attribution uses the same deltas as session totals');
  assert.deepEqual(v.digest.files, ['café.js']); assert.equal(v.digest.tools, 2); assert.equal(v.digest.commits[0].confirmed, true);
  assert.equal(v.digest.opening, 'Finished the overview.');
  const read = s.bytesRead; await scanFile(s); assert.equal(s.bytesRead, read, 'unchanged file must read zero additional bytes');
  const next = JSON.stringify({ type: 'user', timestamp: ts(8), message: { content: 'Next request 🎛' } });
  const buf = Buffer.from(next + '\n'), split = buf.indexOf(Buffer.from('🎛')) + 1;
  fs.appendFileSync(file, buf.subarray(0, split)); await scanFile(s); assert.equal(snapshot(s).digest.turns, 1, 'unfinished UTF-8 line must wait');
  const partialBytes = s.bytesRead; await scanFile(s); assert.equal(s.bytesRead, partialBytes, 'unchanged partial lines must not be reread');
  fs.appendFileSync(file, buf.subarray(split)); await scanFile(s); v = snapshot(s, Date.parse(ts(7)));
  assert.equal(s.bytesRead - partialBytes, buf.length - split, 'read only the appended bytes, including a split UTF-8 character');
  assert.equal(v.digest.turns, 1); assert.match(v.lastRequest, /🎛/); assert.equal(v.spend.total, 69);
  fs.writeFileSync(file, JSON.stringify(records[0]) + '\n'); await scanFile(s); assert.equal(snapshot(s).spend.total, 0, 'truncation resets totals');
  const codex = fresh(file, 'astra');
  const count = (input, output, cached) => ({ type: 'event_msg', timestamp: ts(3), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached, total_tokens: input + output } } } });
  const event = type => ({ type: 'event_msg', timestamp: ts(1), payload: { type } });
  fs.writeFileSync(file, [event('task_started'), count(100, 20, 80), count(100, 20, 80), event('task_started'), count(130, 25, 95), count(10, 2, 5)].map(JSON.stringify).join('\n') + '\n');
  await scanFile(codex); const c = snapshot(codex);
  assert.equal(c.spend.total, 167); assert.equal(c.spend.cacheRead, 100); assert.equal(c.spend.turns[1].total, 47);
  assert.equal(Object.values(c.spend.daily).reduce((a,b)=>a+b,0),167,'daily Codex usage respects resets and cache inclusion');
  assert.equal(c.spend.turns.reduce((n, t) => n + t.total, 0), c.spend.total);
  // Never recursively delete computed paths: remove only our exact fixture and empty directory.
  fs.unlinkSync(file); fs.rmdirSync(dir);
  console.log('PASS: deduplicated Claude usage, per-turn totals, Unicode append, partial lines, zero-byte refresh, truncation, commit/edit evidence, Codex cumulative/reset/cache accounting.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
