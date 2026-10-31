'use strict';
// Read-only, incremental JSONL accounting. Runs in a worker, never on the HTTP thread.
const fs = require('fs');
const { StringDecoder } = require('string_decoder');
const clip = (s, n = 500) => String(s || '').slice(0, n);
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p.type === 'text' || p.type === 'input_text' || p.type === 'output_text').map(p => p.text || '').join('\n') : '';
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const number = x => Number.isFinite(x) && x > 0 ? x : 0;
const MAX_LINE = 32 * 1024 * 1024;
const MAX_EVENTS = 24000;

function fresh(file, kind) {
  return { file, kind, offset: 0, size: 0, identity: '', complete: false, scanned: false, skipped: 0, malformed: 0, records: 0,
    pendingLine: '', lineBytes: 0, skipping: false, decoder: new StringDecoder('utf8'),
    usage: emptyUsage(), daily:{}, byModel:{}, currentModel:'', measured: false, messages: new Map(), calls: new Set(), pending: new Map(), turns: [], turn: null,
    codexTotal: emptyUsage(), events: [], droppedBefore: 0, recent: [], firstRequest: '', lastRequest: '', lastAssistant: '',
    toolsSinceEdit: 0, reads: new Map(), failures: new Map(), waste: new Map(), current: null, scanMs: 0, bytesRead: 0 };
}
function event(s, type, ts, extra = {}) {
  const e = { type, at: Date.parse(ts) || 0, ...extra };
  s.events.push(e);
  if (s.events.length > MAX_EVENTS) { const removed = s.events.splice(0, 2000); s.droppedBefore = removed.at(-1).at; }
  s.recent.push({ type, text: clip(extra.text || extra.path || extra.command || '', 450) });
  if (s.recent.length > 20) s.recent.shift();
}
function turn(s, ts, request = '') {
  s.turn = { at: ts || null, request: clip(request, 220), ...emptyUsage(), tools: 0, edits: 0 };
  s.turns.push(s.turn);
  if (s.turns.length > 100) s.turns.shift();
  event(s, 'turn', ts);
}
function request(s, t, ts) {
  if (!t || t.trim().startsWith('<') || t.startsWith('# AGENTS.md')) return;
  if (!s.firstRequest) s.firstRequest = clip(t, 2400);
  s.lastRequest = clip(t, 2400);
  if (s.kind === 'claude' || !s.turn || s.turn.request) turn(s, ts, t);
  else s.turn.request = clip(t, 220);
  event(s, 'request', ts, { text: clip(t) });
}
function addUsage(s, delta, target, ts, model) {
  for (const k of Object.keys(s.usage)) { s.usage[k] += delta[k] || 0; if (target) target[k] += delta[k] || 0; }
  s.measured = true;
  const at=Date.parse(ts);if(Number.isFinite(at)){const day=new Date(at).toISOString().slice(0,10);s.daily[day]=(s.daily[day]||0)+(delta.total||0);}
  const id=model||'Not reported';s.byModel[id]=(s.byModel[id]||0)+(delta.total||0);
}
function flag(s, id, reason) { s.waste.set(id, { reason, heuristic: true }); if (s.waste.size > 12) s.waste.delete(s.waste.keys().next().value); }
function tool(s, id, name, input, ts) {
  if (id && s.calls.has(id)) return;
  if (id) s.calls.add(id);
  let a = input;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = { code: a }; } }
  a = a || {};
  let command = a.command || a.cmd || a.code || a.input || '';
  if (Array.isArray(command)) command = command.join(' ');
  command = String(command);
  const file = a.file_path || a.path || a.notebook_path;
  const paths = /^(Write|Edit|NotebookEdit)$/.test(name) && file ? [file] : [];
  if (/apply_patch|\*\*\* (Update|Add) File:/.test(command + name)) {
    for (const m of command.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\r\n]+?)(?=\\n|\r?\n|$)/g)) paths.push(m[1]);
  }
  const normalized = clip(command.replace(/\s+/g, ' ').trim(), 500);
  const commit = /\bgit\s+(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+)?commit\b/.test(command);
  const call = { name, command: clip(command, 800), normalized, paths: paths.slice(0, 80), commit };
  if (id) { s.pending.set(id, call); if (s.pending.size > 2000) s.pending.delete(s.pending.keys().next().value); }
  s.current = { name, text: clip(command || file || JSON.stringify(a), 400), ts, running: true };
  if (s.turn) s.turn.tools++;
  s.toolsSinceEdit++;
  event(s, 'tool', ts, { text: name + ': ' + clip(command || file, 320) });
  const readPath = name === 'Read' && file || (command.match(/(?:Get-Content\s+(?:(?:-LiteralPath|-Path)\s+)?|\bcat\s+)["']?([^\r\n;|"']+)/i) || [])[1];
  if (readPath) {
    const n = (s.reads.get(readPath) || 0) + 1; s.reads.set(readPath, n);
    if (n >= 6) flag(s, 'read:' + readPath, `Same file read ${n} times in this turn: ${clip(readPath, 140)}`);
  }
  if (s.toolsSinceEdit >= 40) flag(s, 'loop', `${s.toolsSinceEdit} tool calls since the last recorded edit; research may be intentional.`);
}
function result(s, id, raw, error, ts) {
  const output = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
  const failed = error || /(?:Process exited with code|exit_code["']?\s*[:=]|Exit code:)\s*[1-9]\d*/i.test(output);
  const call = s.pending.get(id); s.pending.delete(id);
  if (s.current && call) s.current.running = false;
  if (output.length > 40000) flag(s, 'large-output', `A tool returned ${Math.round(output.length / 1000)}k characters; large outputs can consume context.`);
  if (failed) {
    event(s, 'error', ts, { text: clip(output, 300) });
    if (call?.normalized) {
      const n = (s.failures.get(call.normalized) || 0) + 1; s.failures.set(call.normalized, n);
      if (n >= 2) flag(s, 'failure:' + call.normalized, `Same command failed ${n} times: ${clip(call.normalized, 140)}`);
    }
  }
  if (!call) return;
  if (!failed) {
    for (const file of call.paths) { event(s, 'file', ts, { path: clip(file, 600) }); if (s.turn) s.turn.edits++; }
    if (call.paths.length) { s.toolsSinceEdit = 0; s.waste.delete('loop'); }
  }
  if (call.commit) {
    const hashes = [...output.matchAll(/\[[^\]\r\n]*?\b([a-f0-9]{7,40})\]\s*([^\r\n]*)/g)];
    event(s, 'commit', ts, { command: call.command, result: clip(output, 700), confirmed: !failed && hashes.length > 0,
      hashes: hashes.map(m => m[1]).slice(0, 20), failed: !!failed });
  }
}
function consume(s, r) {
  s.records++;
  if (!r || r.isSidechain) return;
  const ts = r.timestamp;
  if (s.kind === 'copilot') {
    const cp=require('./copilot'),d=r.data||{};
    if(r.type==='session.binary_asset')return;
    if(r.type==='user.message'){s.reads.clear();s.failures.clear();s.waste.clear();request(s,cp.text(d.content),ts);}
    if(r.type==='assistant.message'){
      s.currentModel=d.model||s.currentModel;
      if(cp.text(d.content).trim()){s.lastAssistant=clip(cp.text(d.content),800);event(s,'assistant',ts,{text:s.lastAssistant});}
      for(const t of d.toolRequests||[])tool(s,t.toolCallId,cp.toolName(t.name),cp.input(t.arguments),ts);
    }
    if(r.type==='tool.execution_start')tool(s,d.toolCallId,cp.toolName(d.toolName),cp.input(d.arguments),ts);
    if(r.type==='tool.execution_complete')result(s,d.toolCallId,cp.text(d.result?.content),d.success===false,ts);
    if(r.type==='session.error')event(s,'error',ts,{text:clip(d.message,600)});
    if(r.type==='assistant.turn_end')event(s,'complete',ts);
    if(r.type==='session.model_change')s.currentModel=d.newModel||s.currentModel;
    if(['session.start','session.resume'].includes(r.type))s.currentModel=d.selectedModel||s.currentModel;
    if(['session.usage_checkpoint','session.shutdown'].includes(r.type)){
      const u=cp.usage(d);s.premiumRequests=u.premiumRequests??s.premiumRequests;s.aiCredits=u.aiCredits??s.aiCredits;
      if(u.measured){const delta={};for(const k of Object.keys(s.usage))delta[k]=Math.max(0,u[k]-s.usage[k]);addUsage(s,delta,s.turn,ts,d.currentModel||s.currentModel);}
      for(const file of cp.modifiedFiles(d))event(s,'file',ts,{path:clip(file,600)});
    }
    return;
  }
  if (s.kind === 'claude') {
    if (r.type === 'system' && r.subtype === 'api_error') event(s, 'error', ts, { text: clip(r.error?.message || r.message || JSON.stringify(r.error || 'API error'), 300) });
    const m = r.message;
    if (r.type === 'user' && m) {
      const parts = m.content;
      if (!r.isMeta && !(Array.isArray(parts) && parts.some(p => p.type === 'tool_result'))) {
        const t = textOf(parts).trim(); if (t && !t.startsWith('<')) { s.reads.clear(); s.failures.clear(); s.waste.clear(); request(s, t, ts); }
      }
      if (Array.isArray(parts)) for (const p of parts) if (p.type === 'tool_result') result(s, p.tool_use_id, typeof p.content === 'string' ? p.content : textOf(p.content), p.is_error, ts);
    }
    if (r.type !== 'assistant' || !m || m.model === '<synthetic>') return;
    if (m.usage) {
      const u = m.usage, key = m.id || r.uuid || 'record:' + s.records;
      if (!s.turn) turn(s, ts);
      const prev = s.messages.get(key), old = prev?.usage || emptyUsage();
      const next = { input: number(u.input_tokens), output: number(u.output_tokens), cacheRead: number(u.cache_read_input_tokens), cacheWrite: number(u.cache_creation_input_tokens), total: 0 };
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) next[k] = Math.max(next[k], old[k]);
      next.total = next.input + next.output + next.cacheRead + next.cacheWrite;
      const delta = {}; for (const k of Object.keys(next)) delta[k] = next[k] - old[k];
      addUsage(s, delta, prev?.turn || s.turn, prev?.at||ts, m.model);
      s.messages.set(key, { usage: next, turn: prev?.turn || s.turn, at:prev?.at||ts });
    }
    for (const p of Array.isArray(m.content) ? m.content : []) {
      if (p.type === 'tool_use') tool(s, p.id, p.name, p.input, ts);
      else if (p.type === 'text' && p.text?.trim()) { s.lastAssistant = clip(p.text.trim(), 800); event(s, 'assistant', ts, { text: s.lastAssistant }); }
    }
  } else {
    const p = r.payload; if (!p) return;
    if(r.type==='turn_context'&&p.model)s.currentModel=p.model;
    if (r.type === 'event_msg') {
      if (p.type === 'error') event(s, 'error', ts, { text: clip(p.message || p.error || 'Agent error', 300) });
      if (p.type === 'task_started') { turn(s, ts); s.reads.clear(); s.failures.clear(); s.waste.clear(); }
      if (p.type === 'task_complete') event(s, 'complete', ts);
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        const u = p.info.total_token_usage;
        const next = { input: number(u.input_tokens), output: number(u.output_tokens), cacheRead: number(u.cached_input_tokens), cacheWrite: 0, total: number(u.total_tokens) || number(u.input_tokens) + number(u.output_tokens) };
        // Codex input includes cache reads; total includes reasoning output. Never add either twice.
        const reset = next.total < s.codexTotal.total;
        const delta = {}; for (const k of Object.keys(next)) delta[k] = Math.max(0, next[k] - (reset ? 0 : s.codexTotal[k]));
        if (!s.turn) turn(s, ts);
        addUsage(s, delta, s.turn, ts, s.currentModel); s.codexTotal = next;
      }
    }
    if (r.type !== 'response_item') return;
    if (p.type === 'message' && p.role === 'user') request(s, textOf(p.content).trim(), ts);
    if (p.type === 'message' && p.role === 'assistant') {
      const t = textOf(p.content).trim(); if (t) { s.lastAssistant = clip(t, 800); event(s, 'assistant', ts, { text: s.lastAssistant }); }
    }
    if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(p.type)) tool(s, p.call_id, p.name || 'shell', p.arguments || p.input || p.action, ts);
    if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) result(s, p.call_id, p.output, false, ts);
  }
}

async function scanFile(s, onProgress) {
  const started = performance.now();
  const st = await fs.promises.stat(s.file);
  const identity = `${st.dev}:${st.ino}:${st.birthtimeMs}`;
  if ((s.identity && s.identity !== identity) || st.size < s.offset) Object.assign(s, fresh(s.file, s.kind));
  s.identity = identity; s.size = st.size;
  if (s.scanned && s.offset === st.size) return s;
  if (!st.size) { s.scanned = s.complete = true; return s; }
  const start = s.offset;
  let pending = s.pendingLine, lineBytes = s.lineBytes, skipping = s.skipping, decoder = s.decoder, lastProgress = performance.now();
  s.complete = false;
  // Retain an unfinished line and its UTF-8 decoder; even partial appends read only new bytes.
  const stream = fs.createReadStream(s.file, { start, end: st.size - 1, highWaterMark: 256 * 1024 });
  for await (const buffer of stream) {
    s.bytesRead += buffer.length;
    let at = 0, end;
    while ((end = buffer.indexOf(10, at)) !== -1) {
      const piece = buffer.subarray(at, end); lineBytes += piece.length + 1;
      if (!skipping && lineBytes <= MAX_LINE) {
        const line = pending + decoder.end(piece);
        if (line.trim()) { try { consume(s, JSON.parse(line)); } catch { s.malformed++; } }
      } else s.skipped++;
      pending = ''; lineBytes = 0; skipping = false; decoder = new StringDecoder('utf8'); at = end + 1;
    }
    const rest = buffer.subarray(at); lineBytes += rest.length;
    if (!skipping && lineBytes <= MAX_LINE) pending += decoder.write(rest);
    else { skipping = true; pending = ''; }
    s.offset += buffer.length;
    if (performance.now() - lastProgress > 400) { lastProgress = performance.now(); onProgress?.(s); }
    await new Promise(resolve => setImmediate(resolve));
  }
  s.pendingLine = pending; s.lineBytes = lineBytes; s.skipping = skipping; s.decoder = decoder;
  s.scanned = true; s.complete = s.offset === st.size && !lineBytes; s.scanMs += performance.now() - started;
  return s;
}
function snapshot(s, since = 0) {
  const ev = s.events.filter(e => e.at > since);
  const commits = ev.filter(e => e.type === 'commit');
  const assistant = ev.filter(e => e.type === 'assistant').at(-1)?.text || '';
  const digest = { since: since || null, firstVisit: !since, turns: ev.filter(e => e.type === 'turn').length,
    tools: ev.filter(e => e.type === 'tool').length, files: [...new Set(ev.filter(e => e.type === 'file').map(e => e.path))],
    commits, errors: ev.filter(e => e.type === 'error').length,
    opening: clip((assistant.match(/^[\s\S]*?[.!?](?:\s|$)/) || [assistant])[0].trim(), 280),
    partial: !s.complete || s.skipped > 0 || s.malformed > 0 || s.droppedBefore > since };
  return { scan: { complete: s.complete, scanned: s.scanned, offset: s.offset, size: s.size, skipped: s.skipped, malformed: s.malformed, ms: Math.round(s.scanMs), bytesRead: s.bytesRead },
    spend: { ...s.usage, premiumRequests:s.premiumRequests??null,aiCredits:s.aiCredits??null, daily:Object.fromEntries(Object.entries(s.daily).sort(([a],[b])=>a.localeCompare(b)).slice(-90)), byModel:s.byModel, measured: s.measured, partial: !s.complete || s.skipped > 0 || s.malformed > 0, turns: s.turns.slice(-12), cacheIncludedInInput: s.kind === 'astra' },
    digest, firstRequest: s.firstRequest, lastRequest: s.lastRequest, lastAssistant: s.lastAssistant, current: s.current, recent: s.recent,
    waste: [...s.waste.values()], turn: s.turn ? { at: s.turn.at, tools: s.turn.tools, edits: s.turn.edits } : null };
}
module.exports = { fresh, scanFile, snapshot, consume };
