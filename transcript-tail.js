'use strict';
const fs = require('fs');
const path = require('path');

// Bounded, byte-addressed JSONL reads. Keep an unfinished record as bytes so a
// UTF-8 character (or JSON record) split across writes is never lost.
class TailReader {
  constructor({ parse = record => [record], window = 512 * 1024, chunk = 64 * 1024, maxRecord = 4 * 1024 * 1024, limit = 600, fromStart = false, files = 64 } = {}) {
    Object.assign(this, { parse, window, chunk, maxRecord, limit, fromStart, files });
    this.cache = new Map(); this.generation = 0;
  }
  read(file) {
    const st = fs.statSync(file);
    let s = this.cache.get(file);
    if (!s || st.size < s.offset || s.ino !== st.ino || (st.size === s.offset && st.mtimeMs !== s.mtime)) {
      const offset = this.fromStart ? 0 : Math.max(0, st.size - this.window);
      s = { offset, ino: st.ino, carry: Buffer.alloc(0), dropping: offset > 0, items: [], continued: null, generation: ++this.generation, partial: offset > 0 };
      this.cache.set(file, s);
    }
    let bytesRead = 0;
    const end = Math.min(st.size, s.offset + this.window);
    const fd = s.offset < end ? fs.openSync(file, 'r') : null;
    try {
      while (s.offset < end) {
        const buffer = Buffer.alloc(Math.min(this.chunk, end - s.offset));
        const n = fs.readSync(fd, buffer, 0, buffer.length, s.offset);
        if (!n) break;
        s.offset += n; bytesRead += n;
        const block = Buffer.concat([s.carry, buffer.subarray(0, n)]);
        let start = 0, newline;
        while ((newline = block.indexOf(10, start)) >= 0) {
          if (!s.dropping) {
            try {
              const r = JSON.parse(block.subarray(start, newline).toString('utf8'));
              if (r.type === 'continued-in' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.continuedInSessionId || '')) s.continued = r.continuedInSessionId;
              s.items.push(...this.parse(r));
            } catch { /* A corrupt line does not discard adjacent records. */ }
          }
          s.dropping = false; start = newline + 1;
        }
        s.carry = Buffer.from(block.subarray(start));
        if (s.carry.length > this.maxRecord) { s.carry = Buffer.alloc(0); s.dropping = true; s.partial = true; }
        if (s.items.length > this.limit) { s.items = s.items.slice(-this.limit); s.partial = true; }
      }
    } finally { if (fd !== null) fs.closeSync(fd); }
    s.mtime = st.mtimeMs;
    // LRU bound: idle sessions should not retain unbounded conversation memory.
    this.cache.delete(file); this.cache.set(file, s);
    if (this.cache.size > this.files) this.cache.delete(this.cache.keys().next().value);
    return { ...s, size: st.size, bytesRead, more: s.offset < st.size, cursor: s.generation + ':' + s.offset };
  }
  chain(file, maxHops = 8) {
    const files = [], reads = [], seen = new Set(); let capped = false;
    for (let hop = 0; ; hop++) {
      if (seen.has(file)) { capped = true; break; }
      seen.add(file); files.push(file);
      const read = this.read(file); reads.push(read);
      if (!read.continued) break;
      const next = path.join(path.dirname(file), read.continued + '.jsonl');
      if (!fs.existsSync(next)) break;
      if (hop >= maxHops) { capped = true; break; }
      file = next;
    }
    return { file: files.at(-1), files, reads, capped };
  }
}

// Continuation discovery uses only a small cached tail, shared by cards, Feed,
// recap and resume. A growing Chat has its own event reader and byte offset.
const pointers = new TailReader({ parse: () => [], window: 64 * 1024 });
function continuation(file) { return pointers.chain(file, Infinity); }
module.exports = { TailReader, continuation };
