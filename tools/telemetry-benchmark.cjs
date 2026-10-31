'use strict';
// Read-only benchmark; does not start the app or write to either agent's directories.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { fresh, scanFile, snapshot } = require('../telemetry');
async function main() {
  let largest = null;
  async function walk(dir, kind) {
    let entries; try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) await walk(file, kind);
      else if (e.isFile() && e.name.endsWith('.jsonl')) { const st = await fs.promises.stat(file); if (!largest || st.size > largest.size) largest = { file, kind, size: st.size }; }
    }
  }
  await walk(path.join(os.homedir(), '.claude', 'projects'), 'claude');
  await walk(path.join(os.homedir(), '.codex', 'sessions'), 'astra');
  if (!largest) throw new Error('No transcripts found');
  const s = fresh(largest.file, largest.kind), baseline = process.memoryUsage();
  let peak = baseline.rss, heap = baseline.heapUsed;
  const memory = () => { const m = process.memoryUsage(); peak = Math.max(peak, m.rss); heap = Math.max(heap, m.heapUsed); };
  const timer = setInterval(memory, 10), start = performance.now();
  await scanFile(s, memory); const firstMs = performance.now() - start; memory();
  const bytesBefore = s.bytesRead, next = performance.now(); await scanFile(s); const repeatMs = performance.now() - next;
  clearInterval(timer);
  const v = snapshot(s);
  console.log(JSON.stringify({ transcript: path.basename(largest.file), kind: largest.kind, bytes: largest.size, firstMs: Math.round(firstMs), repeatMs: Math.round(repeatMs * 100) / 100, repeatBytes: s.bytesRead - bytesBefore, baselineRSS: baseline.rss, peakRSS: peak, peakHeap: heap, totalTokens: v.spend.total, scan: v.scan, turnsRetained: s.turns.length, eventsRetained: s.events.length }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
