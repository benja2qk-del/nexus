'use strict';
// Only isolated TEMP fixtures, only ports commissioned for this work.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const root = fs.realpathSync(process.env.NEXUS_VOICE_FIXTURE || '');
if (!['4790','4791','4785','4786','4787','4788'].includes(process.env.NEXUS_PORT) || !root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep) || !path.basename(root).startsWith('nexus-voice-')) throw Error('Unsafe voice fixture');
const originalLoad = Module._load;
const log = entry => fs.appendFileSync(path.join(root, 'pty-log.jsonl'), JSON.stringify(entry) + '\n');
Module._load = function(name, parent, main) {
  if (name === './voice' && parent?.filename === path.resolve('server.js') && process.env.NEXUS_REAL_WHISPER !== '1') {
    const voice = originalLoad.apply(this, arguments);
    return {...voice, createVoiceService: () => voice.createVoiceService({ exe:process.execPath, prefix:[path.resolve('tools/voice-whisper-stub.cjs'),root], model:path.join(root,'stub-model'), tempRoot:path.join(root,'voice') })};
  }
  if (name !== '@lydell/node-pty') return originalLoad.apply(this, arguments);
  return {spawn(file, args, options) {
    if (options.cwd !== path.join(root,'project')) throw Error('Only the fixture project may open');
    const astra = file === 'cmd.exe', id = astra ? 'voice-astra' : args.at(-1);
    if (!['voice-claude','voice-astra'].includes(id)) throw Error('Unknown fixture session');
    log({type:'spawn',file,args,cwd:options.cwd});
    const transcript = astra ? path.join(root,'codex','sessions','rollout-voice-astra.jsonl') : path.join(root,'claude','projects',options.cwd.replace(/[^A-Za-z0-9]/g,'-'),id+'.jsonl');
    let onData = () => {}, onExit = () => {}, pasted = '', question = false, ended = false;
    const write = (role, text) => fs.appendFileSync(transcript, JSON.stringify({timestamp:new Date().toISOString(), ...(astra ? {type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}} : {type:role,cwd:options.cwd,message:{content:role==='user'?text:[{type:'text',text}]}})})+'\n');
    const paint = text => onData('\x1b[2J\x1b[H'+text.replace(/\r?\n/g,'\r\n'));
    const idle = '─────────────────────────────────────\n❯ \n─────────────────────────────────────\n? for shortcuts';
    setTimeout(() => paint(idle), 300);
    return {pid:process.pid,onData(fn){onData=fn;},onExit(fn){onExit=fn;},resize(){},kill(){ended=true;onExit({exitCode:0});},write(value){
      if (ended) throw Error('Fixture closed'); log({type:'write',value});
      if (question) {
        if (value === '\r' || value === '\x1b') {question=false;write('assistant','Your answer was received. The preview remains a draft.');paint(idle);} return;
      }
      if (value.startsWith('\x1b[200~')) {pasted=value.slice(6,-6);return;}
      if (value !== '\r') return;
      const text=pasted;pasted='';write('user',text);paint('Thinking...\nEsc to interrupt');
      setTimeout(() => {
        if (ended) return;
        if (/show a question/i.test(text)) {question=true;paint('Do you want to publish the preview?\n❯ 1. Yes, publish\n  2. No, keep the draft\n  3. Cancel\nEnter to confirm · Esc to cancel');return;}
        write('assistant','**Okay.** The voice message arrived.\n\nThe full report has more detail.\n\n```js\nsecretInternalCode();\n```');paint(idle);
      },2200);
    }};
  }};
};
const child = require('child_process'), originalSpawn = child.spawn;
child.spawn = function(exe,args,options) {
  const stub = exe === process.execPath && args[0] === path.resolve('tools/voice-whisper-stub.cjs');
  const whisper = process.env.NEXUS_REAL_WHISPER === '1' && path.basename(exe) === 'whisper-cli.exe' && exe.startsWith(path.join(process.env.LOCALAPPDATA,'NexusDeck','whisper'));
  const sapi = exe === 'powershell.exe' && args.includes(path.resolve('tools/voice-tts.ps1'));
  if ((!stub && !whisper && !sapi) || !options.windowsHide) throw Error('External process blocked by voice fixture');
  return originalSpawn.apply(this,arguments);
};
for (const method of ['exec','execFile','spawnSync','execFileSync']) child[method] = () => {throw Error('External process blocked by voice fixture');};
