'use strict';
const fs = require('fs');
const path = require('path');

// Bounded, byte-addressed JSONL reads. Keep an unfinished record as bytes so a
// UTF-8 character (or JSON record) split across writes is never lost.
// want/enough/widen: a first read widens x4 (up to `widen` bytes) until it holds `want` items that satisfy `enough`;
// once `enough` holds it widens toward `want` only while the span is within `fillWithin` (each widening rereads it).
// catchUp: an existing reader reads up to this many new bytes at once; one further behind starts again at the tail.
// skipped(at): items to show in place of a record over maxRecord (starting at byte `at`), which cannot be read.
class TailReader {
  constructor({ parse = record => [record], window = 512 * 1024, chunk = 64 * 1024, maxRecord = 4 * 1024 * 1024, limit = 600, fromStart = false, files = 64,
    want = 0, enough = null, widen = 32 * 1024 * 1024, fillWithin = Infinity, catchUp = 0, skipped = null } = {}) {
    Object.assign(this, { parse, window, chunk, maxRecord, limit, fromStart, files, want, enough, widen, fillWithin, catchUp, skipped });
    this.cache = new Map(); this.generation = 0;
  }
  read(file) {
    const st = fs.statSync(file);
    let s = this.cache.get(file), bytesRead = 0;
    // Far behind (the chat was not looked at while the session wrote megabytes), replaying a window per poll would
    // show old messages as the newest for minutes: start again at the tail, as a first read does.
    const far = s && this.catchUp && !this.fromStart && st.size - s.offset > this.catchUp;
    if (!s || far || st.size < s.offset || s.ino !== st.ino || (st.size === s.offset && st.mtimeMs !== s.mtime)) {
      for (let span = this.window; ; span *= 4) {
        const offset = this.fromStart ? 0 : Math.max(0, st.size - span);
        s = { offset, ino: st.ino, carry: [], carried: 0, dropping: offset > 0, items: [], continued: null, continuedAt: 0, generation: ++this.generation, partial: offset > 0 };
        bytesRead += this.fill(file, s, Math.min(st.size, offset + Math.max(this.window, span)));
        if (!offset || span >= this.widen || s.items.length >= this.limit || (!this.enough || this.enough(s.items)) && (s.items.length >= this.want || span >= this.fillWithin)) break;
      }
      this.cache.set(file, s);
    } else bytesRead = this.fill(file, s, Math.min(st.size, s.offset + Math.max(this.window, this.catchUp)));
    s.mtime = st.mtimeMs;
    // LRU bound: idle sessions should not retain unbounded conversation memory.
    this.cache.delete(file); this.cache.set(file, s);
    if (this.cache.size > this.files) this.cache.delete(this.cache.keys().next().value);
    return { ...s, size: st.size, bytesRead, more: s.offset < st.size, cursor: s.generation + ':' + s.offset };
  }
  fill(file, s, end) {
    let bytesRead = 0;
    const fd = s.offset < end ? fs.openSync(file, 'r') : null;
    try {
      while (s.offset < end) {
        const buffer = Buffer.alloc(Math.min(this.chunk, end - s.offset));
        const n = fs.readSync(fd, buffer, 0, buffer.length, s.offset);
        if (!n) break;
        s.offset += n; bytesRead += n;
        const data = buffer.subarray(0, n);
        let start = 0, newline;
        // The unfinished record is kept as parts and joined once, so a record of many megabytes costs one copy.
        while ((newline = data.indexOf(10, start)) >= 0) {
          if (!s.dropping) {
            try {
              const r = JSON.parse((s.carried ? Buffer.concat([...s.carry, data.subarray(start, newline)]) : data.subarray(start, newline)).toString('utf8'));
              if (r.type === 'continued-in' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.continuedInSessionId || '')) { s.continued = r.continuedInSessionId; s.continuedAt = Date.parse(r.timestamp) || 0; }
              // Resumed in place after it was continued elsewhere: its newest messages are here, so it is its own again.
              else if (s.continued && r.type === 'user' && require('./recap').realUser(r)) { s.continued = null; s.continuedAt = 0; }
              s.items.push(...this.parse(r));
            } catch { /* A corrupt line does not discard adjacent records. */ }
          }
          s.carry = []; s.carried = 0; s.dropping = false; start = newline + 1;
        }
        if (!s.dropping && start < n) { s.carry.push(Buffer.from(data.subarray(start))); s.carried += n - start; }
        if (s.carried > this.maxRecord) { const at = s.offset - s.carried; s.carry = []; s.carried = 0; s.dropping = true; s.partial = true; if (this.skipped) s.items.push(...this.skipped(at)); }
        if (s.items.length > this.limit) { s.items = s.items.slice(-this.limit); s.partial = true; }
      }
    } finally { if (fd !== null) fs.closeSync(fd); }
    return bytesRead;
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
      // /resume inside a conversation also writes the pointer, to a conversation that existed long before it:
      // two conversations, not one. A hand-off creates its file within seconds of the pointer.
      const born = fs.statSync(next).birthtimeMs;
      if (read.continuedAt && born > 0 && born < read.continuedAt - 60e3) break;
      if (hop >= maxHops) { capped = true; break; }
      file = next;
    }
    return { file: files.at(-1), files, reads, capped };
  }
}

// What a Chat needs from its reader: enough conversation on first open to include a message from the owner, a
// backlog caught up in one read, and records as large as /api/transcript can show (many pasted pictures).
// The read is synchronous: once the owner's message is in view, screenshots do not pull megabytes more for 60 events.
const CHAT_READ = { want: 60, enough: items => items.some(e => e.t === 'user'), widen: 32 * 1024 * 1024, fillWithin: 2 * 1024 * 1024, catchUp: 8 * 1024 * 1024, maxRecord: 32 * 1024 * 1024,
  skipped: at => [{ t: 'note', id: 'skipped-' + at, text: 'A record over 32 MB was too large to show here and was skipped.' }] };

// Continuation discovery uses only a small cached tail, shared by cards, Feed,
// recap and resume. A growing Chat has its own event reader and byte offset.
const pointers = new TailReader({ parse: () => [], window: 64 * 1024 });
function continuation(file) { return pointers.chain(file, Infinity); }
module.exports = { TailReader, continuation, CHAT_READ };
