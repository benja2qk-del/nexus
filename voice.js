'use strict';
// Private, short-lived audio. The HTTP router applies the upload pairing guard.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { createRecognizer } = require('./neural-asr');
const voiceCore = require('./public/voice-core');
const MAX_AUDIO = 10 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });

function validateWav(data) {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE' || data.readUInt32LE(4) + 8 !== data.length) throw fail(415, 'Record again: the audio file could not be read.');
  let format, audio, offset = 12;
  while (offset + 8 <= data.length) {
    const type = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > data.length) throw fail(415, 'Record again: the audio file is incomplete.');
    if (type === 'fmt ') { if (format || size < 16) throw fail(415, 'Unsupported audio format.'); format = data.subarray(start, start + size); }
    if (type === 'data') { if (audio) throw fail(415, 'Unsupported audio format.'); audio = data.subarray(start, start + size); }
    offset = start + size + (size % 2);
  }
  if (!format || !audio || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 16000 || format.readUInt32LE(8) !== 32000 || format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16 || audio.length % 2) throw fail(415, 'Record again using 16 kHz mono WAV audio.');
  if (!audio.length || audio.length > 16000 * 2 * 120) throw fail(413, 'Keep each voice turn under two minutes.');
  return audio.length / 32000;
}

function readBody(req, cap, signal) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    const end = (error, value) => {
      clearTimeout(timer); req.removeListener('data', data); req.removeListener('end', done);
      req.removeListener('aborted', aborted); req.removeListener('error', aborted); signal?.removeEventListener('abort', aborted);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const data = chunk => { size += chunk.length; if (size > cap) end(fail(413, 'Audio is too large. Keep each turn under two minutes and 10 MB.')); else chunks.push(chunk); };
    const done = () => end(null, Buffer.concat(chunks));
    const aborted = () => end(fail(499, 'Voice request cancelled.'));
    const timer = setTimeout(() => end(fail(408, 'Audio upload took too long. Check the connection and try again.')), 30000);
    if (Number(req.headers['content-length']) > cap) return end(fail(413, 'Audio is too large. Keep each turn under two minutes and 10 MB.'));
    req.on('data', data); req.once('end', done); req.once('aborted', aborted); req.once('error', aborted);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

function run(exe, args, { signal, timeout = 90000, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(fail(499, 'Voice request cancelled.'));
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    let stdout = '', stderr = '', failure;
    const stop = error => { failure ||= error; child.kill(); };
    const abort = () => stop(fail(499, 'Voice request cancelled.'));
    const timer = setTimeout(() => stop(fail(504, 'Voice took too long. Try a shorter recording.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.stdout.on('data', d => { stdout += d; if (stdout.length > 2e6) stop(fail(502, 'Voice returned too much text. Try again.')); });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    child.once('error', () => { cleanup(); reject(fail(503, 'Voice could not start on the PC. Run tools/install-whisper.ps1, then try Voice check.')); });
    child.once('close', code => { cleanup(); failure ? reject(failure) : code ? reject(fail(502, 'The PC could not process the audio. Try Voice check.')) : resolve({ stdout, stderr }); });
  });
}

function installation() {
  const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NexusDeck', 'whisper');
  try { return JSON.parse(fs.readFileSync(path.join(root, 'install.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch { return { exe: path.join(root, 'whisper-cli.exe'), model: path.join(root, 'ggml-base.bin') }; }
}

function createVoiceService(options = {}) {
  const config = { ...installation(), ...options };
  const recognizer = options.recognizer || createRecognizer();
  const useGpu = config.gpu !== false && (!config.prefix||!!options.recognizer) && process.env.NEXUS_ASR_DISABLED !== '1';
  let inCall = false;
  let gpuRetryAt = 0;
  let transcribing = false, speaking = false;
  let warm=null;
  async function stopSapi(){const current=warm;warm=null;if(!current)return;current.process.stdin.destroy();current.process.kill();await current.closed;}
  async function stopCall(){inCall=false;await Promise.all([stopSapi(),recognizer.stop()]);}
  async function startCall(){inCall=true;await Promise.all([startSapi(),useGpu&&Date.now()>=gpuRetryAt?recognizer.start().catch(async()=>{gpuRetryAt=Date.now()+60000;await recognizer.stop();}):Promise.resolve()]);}
  async function startSapi(){
    if(warm)return;
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'tools','voice-tts.ps1'),'-Worker'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const current={process:child,jobs:new Map(),serial:0};warm=current;
    current.closed=new Promise(resolve=>{child.once('close',()=>{for(const job of current.jobs.values())job.reject(fail(503,'PC voice stopped. Try again.'));current.jobs.clear();if(warm===current)warm=null;resolve();});});
    try{await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(fail(504,'PC voice is still starting.')),5000);let buffer='';
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let value;try{value=JSON.parse(line);}catch{continue;}if(value.ready){clearTimeout(timer);resolve();}else {const job=current.jobs.get(value.id);current.jobs.delete(value.id);if(job)value.ok?job.resolve():job.reject(fail(502,'PC voice could not prepare the sentence.'));}}});
      child.stderr.on('data',()=>{});const error=()=>{clearTimeout(timer);reject(fail(503,'PC voice is unavailable.'));};child.once('error',error);child.stdin.on('error',error);child.once('close',error);
    });}catch{await stopSapi();}
  }
  async function warmTts(input,output,signal){
    const current=warm;
    if(!current)return run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'tools','voice-tts.ps1'),'-InputFile',input,'-OutputFile',output],{signal,timeout:30000});
    if(signal?.aborted)throw fail(499,'Voice request cancelled.');
    let abort,timer;
    try{await new Promise((resolve,reject)=>{
      const id=++current.serial;current.jobs.set(id,{resolve,reject});
      abort=()=>stopSapi();signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,30000);
      current.process.stdin.write(JSON.stringify({id,input,output})+'\n');
    });}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  const tempRoot = config.tempRoot || path.join(process.env.NEXUS_UPLOAD_DIR || os.tmpdir(), 'nexus-voice');
  function removePrivate(dir) {
    if (!dir) return;
    const root = fs.realpathSync(tempRoot), target = fs.realpathSync(dir);
    if (path.dirname(target).toLowerCase() !== root.toLowerCase() || !/^(turn|speech)-/.test(path.basename(target))) throw Error('Invalid private audio cleanup path');
    fs.rmSync(target, { recursive: true, force: true });
  }
  async function transcribe(wav, signal, context = {}) {
    const durationSeconds = validateWav(wav);
    if (transcribing) throw fail(429, 'The PC is transcribing another turn. Wait a moment, then retry.');
    transcribing = true;
    let dir;
    const started = Date.now();
    try {
      if(useGpu&&Date.now()>=gpuRetryAt){
        try {const result=await recognizer.transcribe(wav,signal,context);return {...result,elapsedMs:Date.now()-started,durationSeconds};}
        catch(error){if(signal?.aborted||error.name==='AbortError')throw fail(499,'Voice request cancelled.');gpuRetryAt=Date.now()+60000;await recognizer.stop();}
      }
      if (!fs.existsSync(config.exe) || !fs.existsSync(config.model)) throw fail(503, 'Voice is not installed on the PC. Run tools/install-whisper.ps1, then try Voice check.');
      fs.mkdirSync(tempRoot, { recursive: true }); dir = fs.mkdtempSync(path.join(tempRoot, 'turn-'));
      const input = path.join(dir, 'audio.wav'), output = path.join(dir, 'result');
      fs.writeFileSync(input, wav, { mode: 0o600 });
      const threads=Math.max(1,Math.min(12,Number(config.threads)||os.availableParallelism?.()||os.cpus().length));
      const forced=['es','en'].includes(context.forced)?context.forced:null;
      const result=await run(config.exe, [...(config.prefix || []), '-m', config.model, '-f', input, '-l', forced||'auto', '-t', String(threads), '-ng', '-nt', '-otxt', '-of', output], { signal, timeout: config.timeout || 90000 });
      const text = fs.readFileSync(output + '.txt', 'utf8').replace(/\[[^\]]*\]|\([^)]*(?:music|silence|applause)[^)]*\)/gi, '').replace(/\s+/g, ' ').trim().slice(0, 8000);
      const detected=/auto-detected language: (\w+) \(p = ([\d.]+)\)/.exec(result.stderr);
      const language=forced||(['es','en'].includes(detected?.[1])?detected[1]:voiceCore.language(text,context.prior));
      return { text, language, confidence:forced?1:detected&&['es','en'].includes(detected[1])?Number(detected[2]):0, detectedLanguage:detected?.[1]||null, durationSeconds, backend:'whisper.cpp base', elapsedMs: Date.now() - started };
    } finally {
      try { removePrivate(dir); } finally { transcribing = false; if(!inCall)await recognizer.stop(); }
    }
  }
  async function tts(text, lang, signal) {
    if (speaking) throw fail(429, 'The PC is preparing another spoken reply. Try again in a moment.');
    if (typeof text !== 'string' || !text.trim() || text.length > 1600) throw fail(400, 'Choose a short reply to read aloud.');
    speaking = true;
    let dir;
    try {
      fs.mkdirSync(tempRoot, { recursive: true }); dir = fs.mkdtempSync(path.join(tempRoot, 'speech-'));
      const input = path.join(dir, 'request.json'), output = path.join(dir, 'speech.wav');
      fs.writeFileSync(input, JSON.stringify({ text, lang: lang === 'es' ? 'es' : 'en' }), { mode: 0o600 });
      await warmTts(input,output,signal);
      return fs.readFileSync(output);
    } finally { try { removePrivate(dir); } finally { speaking = false; } }
  }
  async function handle(req, res, route, stillAuthorized) {
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnect);
    const json = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status >= 400 ? { Connection: 'close' } : {}) }); res.end(JSON.stringify(body)); } };
    try {
      const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
      if (route === '/api/voice/transcribe') {
        if (!['audio/wav', 'audio/x-wav'].includes(contentType)) throw fail(415, 'Record again: this endpoint needs WAV audio.');
        const body = await readBody(req, MAX_AUDIO, controller.signal);
        if (!stillAuthorized()) throw fail(401, 'Pair this device again to use voice.');
        const result = await transcribe(body, controller.signal, {prior:req.headers['x-nexus-language-prior'],forced:req.headers['x-nexus-language']});
        if (!stillAuthorized()) throw fail(401, 'Pair this device again to use voice.');
        json(200, result);
      } else {
        if (contentType !== 'application/json') throw fail(415, 'Speech needs a text request.');
        const body = await readBody(req, 12000, controller.signal);
        let data; try { data = JSON.parse(body); } catch { throw fail(400, 'The speech request could not be read.'); }
        if (!stillAuthorized()) throw fail(401, 'Pair this device again to use voice.');
        const wav = await tts(data.text, data.lang, controller.signal);
        if (!stillAuthorized()) throw fail(401, 'Pair this device again to use voice.');
        if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }); res.end(wav); }
      }
    } catch (error) { json(error.status || 500, { error: error.status ? error.message : 'The PC could not process the audio. Try Voice check.' }); }
    finally { res.removeListener('close', disconnect); }
  }
  return { transcribe, tts, handle, startCall, stopCall };
}
module.exports = { createVoiceService, validateWav, MAX_AUDIO, run };
