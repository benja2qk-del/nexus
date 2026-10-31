'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { TailReader, continuation } = require('../transcript-tail');
const { TerminalScreen } = require('../terminal-screen');
const { pendingPrompt, inputReady } = require('../public/conversation');
require('./terminal-screen-checks.cjs');
const recap = require('../recap');
async function main() {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(),'nexus-onechat-check-'));
 try {
  const file = path.join(temp,'first.jsonl'), line = value => JSON.stringify(value)+'\n';
  fs.writeFileSync(file,line({text:'First'}));
  const reader = new TailReader({chunk:7,window:512});
  let result = reader.read(file); assert.equal(result.items[0].text,'First');
  assert.equal(reader.read(file).bytesRead,0,'unchanged polls read zero bytes');
  const append = Buffer.from(line({text:'A Unicode boundary: 雪 ☃ 🙂'}));
  for(let i=0;i<append.length;i++) {
    fs.appendFileSync(file,append.subarray(i,i+1)); result=reader.read(file);
    assert.equal(result.bytesRead,1,'only the appended byte is read');
    assert.equal(result.items.length,i===append.length-1?2:1,'partial JSON stays invisible');
  }
  assert.equal(result.items[1].text,'A Unicode boundary: 雪 ☃ 🙂');
  fs.appendFileSync(file,line({type:'continued-in',continuedInSessionId:'second'}));
  fs.writeFileSync(path.join(temp,'second.jsonl'),line({text:'New live file'}));
  assert.equal(reader.chain(file).reads.at(-1).items[0].text,'New live file');
  fs.appendFileSync(path.join(temp,'second.jsonl'),line({type:'continued-in',continuedInSessionId:'first'}));
  assert.equal(reader.chain(file).capped,true,'cycles terminate');
  assert.equal(reader.chain(file,0).files.length,1,'hop ceiling is enforced');
  fs.writeFileSync(file,line({text:'Replaced'}));
  assert.equal(reader.read(file).items[0].text,'Replaced','truncation resets the reader');
  const huge = path.join(temp,'huge.jsonl'), fd = fs.openSync(huge,'w');fs.ftruncateSync(fd,800*1024*1024);
  const end = Buffer.from('\n'+line({text:'Only the tail'}));fs.writeSync(fd,end,0,end.length,800*1024*1024-end.length);fs.closeSync(fd);
  const big = new TailReader();result=big.read(huge);assert.equal(result.bytesRead,512*1024);assert.equal(result.items.at(-1).text,'Only the tail');assert.equal(big.read(huge).bytesRead,0);
  fs.appendFileSync(huge,line({text:'Append'}));assert.equal(big.read(huge).bytesRead,Buffer.byteLength(line({text:'Append'})));
  const capped = new TailReader({maxRecord:128,chunk:32,window:2048});const long=path.join(temp,'long.jsonl');fs.writeFileSync(long,line({text:'x'.repeat(1024)})+line({text:'After oversized record'}));assert.equal(capped.read(long).items.at(-1).text,'After oversized record');
  const old=path.join(temp,'old.jsonl'), live=path.join(temp,'live.jsonl');
  fs.writeFileSync(old,line({type:'user',message:{content:'Latest owner request'}})+line({type:'continued-in',continuedInSessionId:'live'}));
  fs.writeFileSync(live,line({type:'assistant',message:{content:[{type:'text',text:'Reply in continued file'}]}}));
  const data=recap.instant({kind:'claude',id:'old',file:old});assert.equal(data.user.text,'Latest owner request');assert.equal(data.finalAssistant,'Reply in continued file');
  assert.equal(continuation(old).file,live);
  console.log('PASS incremental offsets, every UTF-8/JSON byte boundary, incomplete lines, truncation, 800 MB bounds, oversize records, continued hops/cycles and recap predecessors');

  const screens = [
    ['❯ \n? for shortcuts',true,false],['› Explain this codebase\n100% context left',true,false],
    ['Thinking...\nEsc to interrupt\n❯ ',false,false],['Loading session...',false,false],
    ['Do you want to proceed?\n❯ 1. Yes\n  2. No\nEnter to confirm · Esc to cancel',false,true],
    ['Which release should I prepare?\n❯ 1. Preview\n  2. Stable\nEnter to select · Esc to cancel',false,true],
    ['Here is the plan:\n1. Yes, test\n2. No changes',false,false],
    ['❯ \nNew assistant output',false,false],['> \n',false,false],
    ['Do you trust the files in this folder?\n❯ 1. Yes, trust this folder\n  2. No, exit\nEnter to confirm · Esc to cancel',false,true]
  ];
  for(const [text,ready,question] of screens) {assert.equal(inputReady(text),ready,text);assert.equal(!!pendingPrompt(text),question,text);}
  assert.notEqual(pendingPrompt('Bash: npm test\n'+screens[4][0]).signature,pendingPrompt('Bash: npm publish\n'+screens[4][0]).signature,'the command context is part of permission identity');
  const display = new TerminalScreen();display.write(screens[4][0].replace(/\n/g,'\r\n'));assert(pendingPrompt(display.text()));
  display.write('\x1b[2');display.write('J\x1b[HWorking...\r\nEsc to interrupt');assert.equal(pendingPrompt(display.text()),null,'erased menus never come back');
  display.write('\x1b[2J\x1b[H❯ \r\n? for shortcuts');assert(inputReady(display.text()));
  const writes=[], ptys=[], environments=[];
  const stub = {spawn(file,args,options){environments.push(options.env);const p={pid:123456,write:d=>writes.push(d),onData:fn=>p.data=fn,onExit:fn=>p.exit=fn,kill(){},resize(){}};ptys.push(p);return p;}};
  const module={exports:{}}, requireFromTerms=createRequire(path.resolve('terms.js'));
  const parentEnv={CLAUDE_CODE_CHILD_SESSION:'parent',CLAUDE_CODE_SESSION_ID:'parent',CLAUDECODE:'1',CLAUDE_PID:'1',CLAUDE_EFFORT:'high',CLAUDE_CONFIG_DIR:'unchanged-config'};
  vm.runInNewContext(fs.readFileSync('terms.js','utf8'),{module,require:name=>name==='@lydell/node-pty'?stub:name==='./agents'?{launch:(kind,args)=>({file:kind,args})}:requireFromTerms(name),process:{env:parentEnv},setTimeout,clearTimeout,Buffer,console});
  const terms=module.exports,t=terms.open({kind:'claude',title:'Fixture',cwd:temp,sessionKey:'claude:fixture'}),p=ptys[0];
  for(const key of terms.NESTED_VARS)assert.equal(environments[0][key],undefined,'inherited Claude session markers stay stripped');
  assert.equal(environments[0].CLAUDE_CONFIG_DIR,'unchanged-config');
  assert(fs.readFileSync('server.js','utf8').includes('for (const k of terms.NESTED_VARS) delete process.env[k]'),'server startup retains master cleanup');
  const sending=terms.send(t.id,'line one\nline two');await new Promise(r=>setTimeout(r,250));assert.equal(writes.length,0,'resume waits for actual input readiness');
  const fixtures=require('./fixtures/onechat/screens.json');
  const paint=s=>p.data('\x1b[2J\x1b[H'+s.replace(/\r?\n/g,'\r\n'));
  paint(fixtures.B);await new Promise(r=>setTimeout(r,350));assert.equal(writes.length,0,'at least 600 ms quiet before paste');await sending;
  assert.deepEqual(writes,['\x1b[200~line one\nline two\x1b[201~','\r']);
  paint(screens[4][0]);await assert.rejects(terms.send(t.id,'ordinary message'),/Answer the question/);
  await assert.rejects(terms.send(t.id,'',{answer:'1',signature:'stale'}),/question changed/);
  await terms.send(t.id,'',{answer:'2',signature:terms.state(t.id).prompt.signature});assert.deepEqual(writes.slice(-2),['2','\r']);
  p.write=d=>{writes.push(d);if(d==='1')p.data('\x1b[2J\x1b[H❯ \r\n? for shortcuts');};
  await terms.send(t.id,'',{answer:'1',signature:terms.state(t.id).prompt.signature});assert.equal(writes.at(-1),'1','a menu that accepts a number immediately does not get an extra Enter');
  p.write=d=>writes.push(d);
  paint('Working...\nEsc to interrupt');assert(t.seenInput,'input box remains observed across redraws');
  const beforeBusy=writes.length;await assert.rejects(terms.send(t.id,'Queued while Claude works'),/working.*Queue/);assert.equal(writes.length,beforeBusy,'busy messages belong to the durable NEXUS queue, never the PTY');assert.equal(terms.state(t.id).busy,true);
  paint(fixtures.A);assert.equal(terms.state(t.id).ready,false,'trust overrides previously observed input');
  const beforeTrust=writes.length;await assert.rejects(terms.send(t.id,'Never auto trust'),/Answer the question/);assert.equal(writes.length,beforeTrust);
  const trust=terms.state(t.id).prompt, second=fixtures.A.replace(' ❯ No, exit','   No, exit').replace('   Yes, I trust',' ❯ Yes, I trust');
  assert.equal(pendingPrompt(second).signature,trust.signature,'selection changes do not change question identity');
  p.write=d=>{writes.push(d);if(d==='\x1b[B')paint(second);if(d==='\x1b[A')paint(fixtures.A);};
  await terms.send(t.id,'',{answer:'2',signature:trust.signature});assert.deepEqual(writes.slice(-2),['\x1b[B','\r'],'unnumbered trust requires an explicit choice and arrow navigation');
  await terms.send(t.id,'',{answer:'1',signature:trust.signature});assert.deepEqual(writes.slice(-2),['\x1b[A','\r'],'navigate up from current selection');
  paint(second);const same=writes.length;await terms.send(t.id,'',{answer:'2',signature:trust.signature});assert.deepEqual(writes.slice(same),['\r'],'current option needs only Enter');
  paint(fixtures.A);p.write=d=>{writes.push(d);if(d==='\x1b[B')paint(second.replace('Security guide','Changed security guide'));};
  const stale=writes.length;await assert.rejects(terms.send(t.id,'',{answer:'2',signature:trust.signature}),/question changed/);assert.deepEqual(writes.slice(stale),['\x1b[B'],'never Enter a changed question after navigation');
  paint(fixtures.A);p.write=d=>writes.push(d);const noAck=writes.length;
  await assert.rejects(terms.send(t.id,'',{answer:'2',signature:trust.signature}),/selection did not update/);assert.deepEqual(writes.slice(noAck),['\x1b[B'],'never Enter if the marker did not move');
  paint(fixtures.B);p.data('\x1b[?2026h');await new Promise(r=>setTimeout(r,650));assert.equal(terms.state(t.id).ready,false,'partial synchronized frames cannot be sent into');p.data('\x1b[?2026l');
  p.write=d=>{writes.push(d);if(d.startsWith('\x1b[200~'))paint(fixtures.A);};const duringPaste=writes.length;
  await assert.rejects(terms.send(t.id,'Question arrives during paste'),/changed before Enter/);assert.equal(writes.length,duringPaste+1,'no Enter after a question arrives during paste');
  // Copilot's status line can animate forever (an MCP or IDE link still loading). The screen is never quiet,
  // but its input box is up: messages must still be typed, after a short settle, never refused.
  const copilotScreen=require('./fixtures/copilot/screens.json').input,t2=terms.open({kind:'copilot',title:'Animated',cwd:temp,sessionKey:'copilot:animated'}),p2=ptys.at(-1),typed=[];p2.write=d=>typed.push(d);
  let frame=0;const spin=setInterval(()=>p2.data('\x1b[2J\x1b[H'+copilotScreen.replace('◎',frame++%2?'◉':'◎').replace(/\r?\n/g,'\r\n')),150);
  try{
    await new Promise(r=>setTimeout(r,700));const animated=terms.state(t2.id);assert.equal(animated.ready,false,'an animated screen is never quiet');assert.equal(animated.input,true,'its input box is still recognised');
    const began=Date.now();await terms.send(t2.id,'where are the files?');assert(Date.now()-began<4000,'delivery settles within seconds');assert.deepEqual(typed,['\x1b[200~where are the files?\x1b[201~','\r'],'pasted once, then Enter');
  }finally{clearInterval(spin);}
  p.exit({exitCode:1});await assert.rejects(terms.send(t.id,'kept draft'),/not delivered/);
  console.log('PASS real readiness, 600 ms quiet, busy queue, explicit trust, arrow/current selection, stale and missing-ack guards, synchronized frames, multiline send, environment cleanup and exits (stub PTYs only)');
 } finally {
  const target=fs.realpathSync(temp), parent=fs.realpathSync(os.tmpdir());if(!target.toLowerCase().startsWith(parent.toLowerCase()+path.sep)||!path.basename(target).startsWith('nexus-onechat-check-'))throw Error('Unsafe cleanup');fs.rmSync(target,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
