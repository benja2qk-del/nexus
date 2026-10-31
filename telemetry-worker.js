'use strict';
const { parentPort } = require('worker_threads');
const { fresh, scanFile, snapshot } = require('./telemetry');
const files = new Map();
let pending = null, busy = false;
parentPort.on('message', message => { pending = message; drain(); });
async function drain() {
  if (busy) return;
  busy = true;
  while (pending) {
    const batch = pending; pending = null;
    for (const session of batch.sessions) {
      let record = files.get(session.file);
      if (!record) { record = fresh(session.file, session.kind); files.set(session.file, record); }
      const publish = () => parentPort.postMessage({ key: session.key, ...snapshot(record, batch.viewed[session.key] || 0) });
      try { await scanFile(record, publish); publish(); }
      catch (e) { parentPort.postMessage({ key: session.key, error: e.message }); }
    }
  }
  busy = false;
}
