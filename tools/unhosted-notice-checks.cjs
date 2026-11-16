'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const key='claude:outside',other='claude:other',input={value:'',dispatchEvent(){}};
const state={sel:key,byKey:new Map([[key,{kind:'claude',live:true}],[other,{kind:'claude',live:true}]]),terms:[]};
const drafts=new Map(),posts=[];
const ctx=vm.createContext({state,steerDrafts:drafts,crypto:require('node:crypto').webcrypto,Event,
  keyOf:session=>[...state.byKey].find(([,value])=>value===session)[0],
  $:selector=>selector==='#steerIn'?input:null,document:{addEventListener(){}},setInterval(){},renderSteer(){},renderReadableChat(){},
  attachments:{blocked:()=>false,expand:(_key,text)=>text,contract:(_key,text)=>text},
  postNexus:async(_url,body)=>{posts.push(body);throw Error('Queue is full (100 messages).');}});
for(const file of ['public/onechat.js','public/message-queue.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
vm.runInContext('loadChat=async()=>{}',ctx);
const run=code=>vm.runInContext(code,ctx),chat=run('chatFor()');
(async()=>{
  for(const kind of ['claude','codex','copilot']){
    state.byKey.set(key,{kind,live:true});assert(run('nxUnhosted()'),kind+' live before first chat poll');
    chat.queue={hosted:true};assert(!run('nxUnhosted()'),kind+' hosted');
    Object.assign(state.byKey.get(key),{inNexus:true,term:'stale'});chat.queue.hosted=false;
    assert(run('nxUnhosted()'),kind+' queue overrides stale terminal list');
    state.byKey.get(key).live=false;assert(!run('nxUnhosted()'),kind+' saved can resume');
    chat.queue=undefined;
  }
  state.byKey.set(key,{kind:'claude',live:true});chat.queue={hosted:false};
  input.value='Keep my typed draft.';
  assert.equal((await run('sendChat()')).ok,false);assert.equal(input.value,'Keep my typed draft.');
  assert.equal((await run("sendChat(null,'Keep my spoken sentence.')")).ok,false);
  assert.equal(input.value,'Keep my typed draft.\n\nKeep my spoken sentence.');
  assert.equal(drafts.get(key),input.value);
  assert.equal((await run("queueEnqueue('Keep my queued attempt.',state.sel)")).ok,false);
  assert(input.value.endsWith('Keep my queued attempt.'));assert.equal(posts.length,0,'No queue or resume request for known unhosted session');
  state.sel=other;input.value='Another session draft.';
  await run("sendChat(null,'Late words for the original session.',undefined,'claude:outside')");
  assert.equal(input.value,'Another session draft.');assert(drafts.get(key).endsWith('Late words for the original session.'));
  // Generic server rejection must also leave a durable inline explanation and text.
  state.sel=key;input.value='New words while sending.';chat.queue={hosted:true};
  const rejected=await run("queueEnqueue('Rejected words.',state.sel)");
  assert.equal(rejected.ok,false);assert.equal(posts.length,1);
  assert.equal(input.value,'New words while sending.\n\nRejected words.');
  assert.match(run('nxComposerNotice()'),/Message not queued.*Your text is kept.*Queue is full/);
  assert.equal(chat.pending.length,0,'Rejected sends create no delivered-looking bubble');
  console.log('PASS all-agent live/hosted/saved detection, stale hosting flags, typed/voice/queue guards, draft append and session ownership, persistent server-rejection reason');
})().catch(error=>{console.error(error);process.exitCode=1;});
