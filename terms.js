// In-app terminals: Claude / Codex run in pseudo-terminals owned by the NEXUS server and are shown in the
// page with xterm.js over a WebSocket. A terminal outlives the window: closing NEXUS and reopening it
// reattaches, with the scrollback replayed.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('@lydell/node-pty');
const { TerminalScreen } = require('./terminal-screen');
const { pendingPrompt, inputReady, inputBusy, inputMenu } = require('./public/conversation');
const slash = require('./slash-commands');
const commandReceipts = require('./slash-receipts');
const { WebSocketServer } = require('ws');
const { randomBytes } = require('crypto');
const models = require('./models');
const agents = require('./agents');

const MAX_SCROLLBACK = 2e6; // characters kept for replay on reattach
const terms = new Map();
let seq = 0;
const instance = randomBytes(6).toString('hex');
let revalidateClients = () => {};

// Variables a parent Claude Code session sets; a child claude would think it is nested inside one
// (CLAUDE_CODE_CHILD_SESSION even turns its transcript saving off) when NEXUS was started from Claude Code.
const NESTED_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT'];

function cleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  if(process.env.NEXUS_COPILOT_DIR)env.COPILOT_HOME=process.env.NEXUS_COPILOT_DIR;
  for (const k of NESTED_VARS) delete env[k];
  return env;
}

function create({ kind, title, cwd, sessionKey, file, args, env: overrides }) {
  if (!cwd || !fs.existsSync(cwd)) cwd = os.homedir();
  const env = { ...cleanEnv(), ...overrides };
  // Headless verification owns only new terminals in TEMP and isolates all CLI state.
  if (process.env.NEXUS_TEST_TERMINALS === '1') {
    if ((sessionKey && kind!=='copilot') || !path.resolve(cwd).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep)) throw new Error('Test terminals require a new session in TEMP');
    env.CLAUDE_CONFIG_DIR = path.join(cwd, 'claude-config');
    env.CODEX_HOME = path.join(cwd, 'codex-config');
    env.COPILOT_HOME = path.join(cwd, 'copilot-config');
    fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true }); fs.mkdirSync(env.CODEX_HOME, { recursive: true });
  }
  const p = pty.spawn(file, args, { name: 'xterm-256color', cols: 120, rows: 36, cwd, env, useConptyDll: false });
  const t = { id: 't' + instance + '-' + (++seq), kind, title, cwd, sessionKey: sessionKey || null, pid: p.pid, started: Date.now(), exited: null, buf: '', clients: new Set(), display: new TerminalScreen(), pty: p, lastOut: Date.now(), remote: (args || []).includes('--remote-control') };
  p.onData(d => {
    t.outputRevision=(t.outputRevision||0)+1;
    t.display.write(d);
    if (!t.display.synchronized && !t.display.pending && inputReady(screen(t))) t.seenInput = true;
    t.buf += d;
    if (t.buf.length > MAX_SCROLLBACK) t.buf = t.buf.slice(t.buf.length - MAX_SCROLLBACK * 0.75);
    t.lastOut = Date.now();
    const msg = JSON.stringify({ t: 'o', d });
    for (const ws of t.clients) if (ws.readyState === 1) ws.send(msg);
  });
  p.onExit(e => {
    t.exited = { code: e.exitCode, at: Date.now() };
    const msg = JSON.stringify({ t: 'x', code: e.exitCode });
    for (const ws of t.clients) if (ws.readyState === 1) ws.send(msg);
  });
  terms.set(t.id, t);
  return t;
}

// The server can add launch instructions (such as the hand-off guide) to every new process.
let decorate = spec => spec;
function setLaunchDecorator(fn) { decorate = fn; }

// Spawns (or returns the running terminal of) a Claude / Codex session.
function open(spec) {
  if (spec.sessionKey && !spec.fresh) {
    for (const t of terms.values()) if (t.sessionKey === spec.sessionKey && !t.exited) return t;
  }
  spec = decorate(spec);
  let cliArgs = spec.kind === 'copilot' ? [...(spec.copilotArgs||[])] : spec.kind === 'astra' ? spec.codexArgs||[] : spec.kind === 'antigravity' ? spec.antigravityArgs||[] : spec.claudeArgs||[];
  if(spec.kind==='copilot'&&spec.fresh){const id=require('crypto').randomUUID();cliArgs.push('--session-id',id);spec={...spec,sessionKey:'copilot:'+id};}
  const {file,args}=agents.launch(spec.kind,cliArgs);
  const t = create({ kind: spec.kind, title: spec.title, cwd: spec.cwd, sessionKey: spec.sessionKey, file, args, env:spec.env });
  const at = cliArgs.findIndex(a => a === '--model' || a === '-m');
  if (at >= 0 && cliArgs[at + 1] && !cliArgs.includes('--resume') && !cliArgs.includes('resume')) { t.model = cliArgs[at + 1]; t.modelAt = Date.now(); }
  return t;
}

function close(id) {
  const t = terms.get(id);
  if (!t) return;
  if (!t.exited) { try { t.pty.kill(); } catch { } }
  for (const ws of t.clients) { try { ws.close(); } catch { } }
  terms.delete(id);
}

function closeAll() { for (const id of [...terms.keys()]) close(id); }

async function forkCopilot(id) {
  const t=terms.get(id);if(!t||t.kind!=='copilot'||t.exited)throw Error('Copilot terminal is not running.');
  if(t.switching||t.sending)throw Error('Wait for the current message or fork.');
  t.switching=true;
  try {
  const offset=t.buf.length;
  await send(id,'/fork nexus-fork',{modelCommand:true});
  const deadline=Date.now()+12000;
  while(Date.now()<deadline){
    const match=/Forked from [0-9a-f-]{36} as [^\r\n]*?\(([0-9a-f-]{36})\)/i.exec(t.buf.slice(offset).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''));
    if(match){t.sessionKey='copilot:'+match[1];t.title+=' (fork)';return {term:id,key:t.sessionKey};}
    if(t.exited)break;await pause(100);
  }
  throw Error('Copilot did not confirm the fork. Check Raw terminal before trying again.');
  }finally{t.switching=false;}
}

function list() {
  return [...terms.values()].map(t => ({ id: t.id, kind: t.kind, title: t.title, cwd: t.cwd, sessionKey: t.sessionKey, pid: t.pid, started: t.started, exited: t.exited, lastOut: t.lastOut, remote: t.remote, themeMethod:t.themeMethod, model:t.model||'', modelAt:t.modelAt||0, waiting: !t.exited && waitingFor(t) }));
}

// Plain text of the last screenful, without escape sequences.
function screen(t) { return t.display ? t.display.text() : t.buf; }
function waitingFor(t) { return !!pendingPrompt(screen(t)); }
function readyFor(t) {
  return inputShown(t) && Date.now() - t.lastOut >= 600;
}
// The input box is on screen and idle. Unlike readyFor it does not need a quiet screen: Copilot's
// status line can animate for as long as an MCP or IDE connection is pending.
function inputShown(t) {
  return !t.exited && !inputBusy(screen(t)) && !t.display.synchronized && !t.display.pending && inputReady(screen(t), {seenInput:t.kind==='copilot'?false:t.seenInput});
}
const notSent = message => Object.assign(Error(message), { notSent: true });
function state(id, events) {
  const t = terms.get(id);
  if (!t) throw Error('Terminal unavailable');
  const prompt = !t.exited && !t.display.synchronized && !t.display.pending ? pendingPrompt(screen(t)) : null;
  const commands=commandReceipts.update(t,screen(t),events);
  const busy = !t.exited && !prompt && (inputBusy(screen(t)) || agentBusy(t));
  return { id, exited: t.exited, prompt, menu:!t.exited&&(inputMenu(screen(t))||commands.some(r=>r.status==='menu')), ready: !t.sending && !busy && readyFor(t), input: !t.sending && !busy && inputShown(t), busy, lastOut: t.lastOut, commands };
}
// Claude Code records its own state beside the session; its screen no longer says when it is working.
function agentBusy(t) {
  if (t.kind !== 'claude') return false;
  try { return JSON.parse(fs.readFileSync(path.join(process.env.NEXUS_CLAUDE_DIR || path.join(os.homedir(), '.claude'), 'sessions', t.pid + '.json'), 'utf8')).status === 'busy'; }
  catch { return false; }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function send(id, text, { answer, signature, modelCommand=false, commandId, commandConfirmation, queueDelivery=false, midTurn=false } = {}) {
  const t = terms.get(id);
  const command=answer===undefined?slash.core.parse(text):null;
  if(commandId!==undefined&&!/^[a-zA-Z0-9-]{1,80}$/.test(commandId))throw Error('Invalid command receipt ID.');
  const previous=commandId&&t?.commandReceipts?.find(r=>r.id===commandId);
  if(previous){if(previous.text!==text)throw Error('Command receipt ID already used.');return {term:id,submittedAt:previous.submittedAt,command:state(id).commands.find(r=>r.id===commandId)};}
  const commandRisk=slash.core.risk(command);
  if(commandRisk&&commandConfirmation!==text)throw Error('Confirm '+('/'+command.name)+' in NEXUS before sending it.');
  if (!t || t.exited) throw Error('Terminal ended. Your message was not delivered.');
  if (t.sending) throw Error('A message is already being sent.');
  if(t.switching&&!modelCommand)throw Error('Wait for the model change to finish.');
  if (answer !== undefined) {
    t.sending = true;
    try {
    const prompt = state(id).prompt;
    if (answer !== 'esc' && (!prompt || prompt.signature !== signature || !prompt.options.some(o => o.key === answer))) throw Error('The question changed. Review it before answering.');
    if (answer === 'esc' && signature && prompt?.signature !== signature) throw Error('The question changed. Review it before answering.');
    if (answer === 'esc') t.pty.write('\x1b');
    else if (prompt.mode === 'arrows') {
      let current = prompt.options.findIndex(o => o.key === prompt.selected);
      const target = prompt.options.findIndex(o => o.key === answer);
      if (current < 0) throw Error('The selected option is unclear. Check Terminal.');
      while (current !== target) {
        const step = target > current ? 1 : -1;
        if (state(id).prompt?.signature !== signature) throw Error('The question changed. Review it before answering.');
        t.pty.write(step > 0 ? '\x1b[B' : '\x1b[A');
        const expected = prompt.options[current + step].key, deadline = Date.now() + 1500;
        for (;;) {
          if (t.exited) throw Error('Terminal ended before the answer was confirmed.');
          const next = state(id).prompt;
          if (!t.display.synchronized && !t.display.pending && next?.signature !== signature) throw Error('The question changed. Review it before answering.');
          if (next?.selected === expected && Date.now() - t.lastOut >= 120) break;
          if (Date.now() >= deadline) throw Error('The selection did not update. Review the question before answering.');
          await pause(40);
        }
        current += step;
      }
      await pause(120);
      const final = state(id).prompt;
      if (t.exited || final?.signature !== signature || final.selected !== answer) throw Error('The question changed. Review it before answering.');
      t.pty.write('\r');
    }
    else {
      t.pty.write(answer); await pause(120);
      if (t.exited) throw Error('Terminal ended before the answer was confirmed.');
      // Some menus accept the number immediately. Never send Enter into the
      // next question or a newly opened input after that transition.
      if (state(id).prompt?.signature === signature) t.pty.write('\r');
    }
    return { term: id, answered: true };
    } finally { t.sending = false; }
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 90000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(text.replace(/\r\n/g, '\n'))) throw Error('Enter a message without terminal control characters.');
  t.sending = true;
  try {
    // Every failure before the paste is marked notSent: nothing was typed, so the queue may simply try again.
    const deadline = Date.now() + 25000, settle = Date.now() + 2000;
    for (;;) {
      if (t.exited) throw notSent('Terminal ended. Your message was not delivered.');
      if (waitingFor(t)) throw notSent('Answer the question in Chat before sending a message.');
      if(inputMenu(screen(t)))throw notSent('Close the terminal menu before sending. Your text is kept.');
      if(command&&!modelCommand&&inputBusy(screen(t)))throw notSent('Wait until the session is ready before running a slash command.');
      if(modelCommand&&inputBusy(screen(t)))throw notSent('The session is working. Wait until it is ready before changing models.');
      if(!midTurn&&inputBusy(screen(t)))throw notSent('The session is working. Queue this message in NEXUS instead.');
      if (readyFor(t)||midTurn&&inputBusy(screen(t))) break;
      // A screen that never goes quiet (an animated status line) is ready once the input box shows.
      if (Date.now() >= settle && inputShown(t)) break;
      if (Date.now() >= deadline) throw notSent('The session is not ready for input. Your message was not delivered; check Terminal.');
      await pause(100);
    }
    const queued = t.kind === 'claude' && inputBusy(screen(t));
    t.pty.write('\x1b[200~' + text.replace(/\r\n/g, '\n') + '\x1b[201~');
    await pause(120);
    // Let a redraw that is mid-frame finish before judging the screen.
    for (const until = Date.now() + 1500; (t.display.synchronized || t.display.pending) && !t.exited && Date.now() < until;) await pause(40);
    if (t.exited) throw Error('Terminal ended. Your message was not delivered.');
    if (waitingFor(t) || inputMenu(screen(t))) throw Error('The question or screen changed before Enter. Your message was not delivered; check Terminal.');
    if(modelCommand&&inputBusy(screen(t)))throw Error('The session started working before Enter. Model change not confirmed.');
    if(!midTurn&&inputBusy(screen(t)))throw Error('The session started working before Enter. Check Terminal before retrying.');
    const receipt=command&&!modelCommand?commandReceipts.begin(t,text,commandId||randomBytes(12).toString('hex'),slash.builtin(t.kind,text),screen(t)):null;
    const submittedAt=receipt?.submittedAt||Date.now();
    t.pty.write('\r');
    return { term: id, submittedAt, queued, ...(receipt?{command:state(id).commands.find(r=>r.id===receipt.id)}:{}) };
  } finally { t.sending = false; }
}

// Claude's /model also saves the choice as the owner's default for every new session.
// A switch from NEXUS is for one session only: put the saved default back afterwards.
function claudeSettingsFile(){ return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json'); }
function readDefaultModel(){ try { return { ok:true, model: JSON.parse(fs.readFileSync(claudeSettingsFile(), 'utf8')).model }; } catch { return { ok:false }; } }
function restoreDefaultModel(before){
  if (!before.ok) return;
  const file = claudeSettingsFile();
  for (const wait of [300, 1500, 4000]) setTimeout(() => {
    try {
      const text = fs.readFileSync(file, 'utf8'), json = JSON.parse(text);
      if (json.model === before.model) return;
      if (before.model === undefined) delete json.model; else json.model = before.model;
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + (text.endsWith('\n') ? '\n' : ''));
    } catch { }
  }, wait);
}
async function changeModel(id, model, { timeout=12000 }={}){
  const t=terms.get(id),command=models.command(model);
  if(!t||t.exited)throw Error('Terminal is not running.');
  if(t.kind!=='claude')throw Error('Codex model choices apply on the next resume.');
  if(t.switching||t.sending)throw Error('Wait for the current message or model change.');
  if(waitingFor(t))throw Error('Answer the question before changing models.');
  if(inputBusy(screen(t)))throw Error('The session is working. Wait until it is ready before changing models.');
  t.switching=true;
  const savedDefault=readDefaultModel();
  try{
    const offset=t.buf.length;
    await send(id,command,{modelCommand:true});
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      if(t.exited)throw Error('Terminal ended before the model change was confirmed.');
      const output=t.buf.slice(offset);
      if(/(?:invalid|unknown|unavailable|not available|not supported|not found).{0,40}model|model.{0,60}(?:not available|not supported|not found)/i.test(output))throw Error('The CLI rejected this model. Review config.json models.');
      if(models.confirmed(output,model)&&!t.display.synchronized&&!t.display.pending){t.model=model;t.modelAt=Date.now();return{term:id,model,confirmed:true};}
      if(waitingFor(t))throw Error('The CLI is asking a question. Model change is not confirmed.');
      await pause(100);
    }
    throw Error('The CLI did not confirm the model change. Check Raw terminal before retrying.');
  }finally{t.switching=false;restoreDefaultModel(savedDefault);}
}

// Turns on Remote Control the documented way: /remote-control typed into the session. Refused while a
// prompt is open, because the Enter would answer that prompt instead.
function remoteOn(id) {
  const t = terms.get(id);
  if (!t || t.exited) throw new Error('terminal is not running');
  if (t.sending) throw new Error('Wait for the current message to finish sending');
  if (waitingFor(t)) throw new Error('Claude is waiting for an answer in this session; answer it first');
  t.pty.write('/remote-control');
  setTimeout(() => { try { t.pty.write('\r'); } catch { } }, 200);
  t.remote = true;
}

function anyRunning() { for (const t of terms.values()) if (!t.exited) return true; return false; }

// A brand-new claude learns its session id after it starts: match it through the live registry by pid.
function linkSessions(registry) {
  for (const t of terms.values()) {
    if (t.kind !== 'claude' || t.exited) continue;
    for (const r of registry.values()) if (r.pid === t.pid) t.sessionKey = 'claude:' + r.sessionId;
  }
}

function byPid(pid) { for (const t of terms.values()) if (t.pid === pid && !t.exited) return t; return null; }
function linkSession(id,key){const t=terms.get(id);if(!t||t.exited||t.sessionKey||!key.startsWith(t.kind+':'))return false;t.sessionKey=key;return true;}

function attach(server, port, opts = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const okOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(opts.origins || [])]);
  const authorize = opts.authorize || (() => true);
  const requests = new WeakMap();
  revalidateClients = () => { for (const ws of wss.clients) if (!authorize(requests.get(ws))) ws.close(1008, 'Device revoked'); };
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    // Browsers always send Origin on WebSockets: only the NEXUS page itself may drive a terminal.
    if (url.pathname !== '/pty' || !okOrigins.has(req.headers.origin) || !authorize(req)) { socket.destroy(); return; }
    const t = terms.get(url.searchParams.get('id'));
    if (!t) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      requests.set(ws, req);
      t.clients.add(ws);
      ws.send(JSON.stringify({ t: 'o', d: t.buf }));
      if (t.exited) ws.send(JSON.stringify({ t: 'x', code: t.exited.code }));
      ws.on('message', raw => {
        if (!authorize(req)) { ws.close(1008, 'Device revoked'); return; }
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (t.exited) return;
        if (m.t === 'i' && typeof m.d === 'string') t.pty.write(m.d);
        else if (m.t === 'r' && m.c > 0 && m.r > 0) { try { t.pty.resize(Math.min(m.c, 500), Math.min(m.r, 200)); t.display.resize(Math.min(m.c, 500), Math.min(m.r, 200)); } catch { } }
      });
      ws.on('close', () => t.clients.delete(ws));
    });
  });
}

module.exports = { agentBusy, setLaunchDecorator, NESTED_VARS, send, forkCopilot, changeModel, state, screen, waitingFor, remoteOn, open, close, closeAll, list, anyRunning, linkSessions, linkSession, byPid, attach, revalidateClients: () => revalidateClients() };
