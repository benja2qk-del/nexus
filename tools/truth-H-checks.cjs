'use strict';
// The queue shows what happened to each message: delivered stays delivered, a failure can be retried or removed,
// and the chat never calls a message the terminal took "Not delivered" while the agent is still on its step.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const repo=path.join(__dirname,'..'),{MessageQueue}=require('../message-queue'),receipts=require('../slash-receipts');
const K='claude:fixture',iso=ms=>new Date(ms).toISOString();
function server(){
  const env={now:100000,terminal:{id:'t1',ready:true,input:true,busy:false},events:[],writes:[],send:null};
  env.q=new MessageQueue({now:()=>env.now,save:async()=>{},inspect:()=>({kind:'claude',terminal:env.terminal,events:env.events}),
    send:async(id,text,o)=>{if(env.send)return env.send(text,o);env.writes.push(text);Object.assign(env.terminal,{busy:true,ready:false,input:false});return {submittedAt:env.now};}});
  env.idle=()=>Object.assign(env.terminal,{busy:false,ready:true,input:true});return env;
}
async function serverChecks(){
  // A received message stays delivered when its terminal ends mid-turn, is closed, or NEXUS quits.
  for(const gone of [e=>{e.terminal.exited={code:0};},e=>{e.terminal=null;}]){
    const e=server();await e.q.add(K,{id:'m1',text:'Please refactor the parser'});await e.q.add(K,{id:'m2',text:'Then add tests'});await e.q.tick();
    e.events=[{t:'user',text:'Please refactor the parser',ts:iso(e.now)}];e.now+=1000;await e.q.tick();assert(e.q.view(K).active.received);
    gone(e);e.now+=1000;await e.q.tick();let v=e.q.view(K);
    assert.equal(v.history.at(-1).status,'confirmed');assert(!v.hold,'a received message does not pause the queue');assert.deepEqual(v.items.map(i=>[i.id,i.status]),[['m2','queued']]);
    e.terminal={id:'t2',ready:true,input:true,busy:false};await e.q.tick();assert.deepEqual(e.writes,['Please refactor the parser','Then add tests'],'the next message goes in the resumed terminal, the first is not typed again');
  }
  {const e=server();await e.q.add(K,{id:'m1',text:'Never seen'});await e.q.tick();e.terminal.exited={code:1};e.now+=1000;await e.q.tick();
   assert.equal(e.q.view(K).items[0].status,'failed','a message the session never showed is still in doubt when its terminal ends');}
  console.log('PASS a received message stays delivered when its terminal ends or NEXUS quits; an unseen one still asks to be checked');
  // A failed delivery: removing its row releases the queue.
  {const e=server();e.send=async()=>{throw Error('Wait for the model change to finish.');};await e.q.add(K,{id:'f',text:'Fail me'});await e.q.tick();
   let v=e.q.view(K);assert.equal(v.items[0].status,'failed');assert.equal(v.hold,v.items[0].error,'row and pause say the same thing');
   await e.q.change(K,'remove',{id:'f'});assert(!e.q.view(K).hold,'removing the failed row releases the queue');
   e.send=null;await e.q.add(K,{id:'n',text:'Second try'});await e.q.tick();assert.deepEqual(e.writes,['Second try']);}
  console.log('PASS removing a failed delivery releases the queue');
  // Send now that fails after the paste is held, never pasted again by itself; nothing typed goes back as queued.
  {const e=server();Object.assign(e.terminal,{busy:true,ready:false,input:false});await e.q.add(K,{id:'p',text:'Also update the changelog'});await e.q.add(K,{id:'p2',text:'And the readme'});
   e.send=async()=>{e.writes.push('paste only');throw Error('The question or screen changed before Enter. Your message was not delivered; check Terminal.');};
   await assert.rejects(e.q.change(K,'push',{id:'p'}),/before Enter/);let v=e.q.view(K);
   assert.equal(v.items[0].status,'failed');assert.match(v.hold,/before Enter/);e.send=null;e.idle();await e.q.tick();await e.q.tick();
   assert.deepEqual(e.writes,['paste only'],'the queue does not paste it again by itself');
   // Whether the next one may be typed is the terminal's to say (boxChecks: real terms.js, a box that keeps typed text).
   await e.q.change(K,'remove',{id:'p'});assert(!e.q.view(K).hold,'removing it releases the queue');}
  {const e=server();Object.assign(e.terminal,{busy:true,ready:false,input:false});await e.q.add(K,{id:'p',text:'Typed nothing'});
   e.send=async()=>{throw Object.assign(Error('Answer the question in Chat before sending a message.'),{notSent:true});};
   await assert.rejects(e.q.change(K,'push',{id:'p'}),/Answer/);assert.equal(e.q.view(K).items[0].status,'queued');assert(!e.q.view(K).hold,'nothing typed: it waits in order as before');}
  console.log('PASS a Send now that reached the terminal and failed is held, not pasted twice');
  // A message longer than the chat's clip is matched by its clipped record.
  for(const n of [8000,12000,40000]){const e=server(),long='Long brief. '+'x'.repeat(n+900);e.send=async()=>({submittedAt:e.now});await e.q.add(K,{id:'L',text:long});await e.q.tick();
   e.events=[{t:'user',text:long.slice(0,n)+'…',ts:iso(e.now+10)},{t:'ai',text:'Done',ts:iso(e.now+20)}];for(let i=0;i<62;i++){e.now+=750;await e.q.tick();}
   const v=e.q.view(K);assert.equal(v.history.at(-1).status,'confirmed');assert(!v.items.length&&!v.hold,'a clipped long message is delivered, not failed');}
  {const e=server();e.send=async()=>({submittedAt:e.now});await e.q.add(K,{id:'S',text:'Short and different'});await e.q.tick();
   e.events=[{t:'user',text:'Short…',ts:iso(e.now+10)}];for(let i=0;i<62;i++){e.now+=750;await e.q.tick();}assert.equal(e.q.view(K).items[0].status,'failed','a short record ending in an ellipsis is not a clipped match');}
  // Copilot's own record of a long message, as the Copilot reader builds it.
  {const e=server(),CK='copilot:fixture',long='Long brief for Copilot. '+'y'.repeat(13000);e.send=async()=>({submittedAt:e.now});await e.q.add(CK,{id:'C',text:long});await e.q.tick();
   e.events=require('../copilot').events({type:'user.message',timestamp:iso(e.now+10),data:{content:long}});for(let i=0;i<62;i++){e.now+=750;await e.q.tick();}
   const v=e.q.view(CK);assert.equal(v.history.at(-1)?.status,'confirmed','a long Copilot message is delivered, not failed');assert(!v.items.length&&!v.hold);}
  console.log('PASS long messages match their clipped chat record');
}
async function slashChecks(){
  const realNow=Date.now;let clock=1e9;Date.now=()=>clock;
  try{
    const idle='────────────────\n❯\n────────────────\n? for shortcuts',working='✻ Compacting conversation… (esc to interrupt)\n'+idle;
    const t={kind:'claude',display:{},lastOut:0,outputRevision:0,seenInput:true},start=clock;receipts.begin(t,'/compact','c1',{kind:'instant'},idle);t.outputRevision=1;
    let screen=working,events=[];const terminal={id:'t1',ready:false,input:true,busy:true,commands:[]},writes=[];
    const q=new MessageQueue({now:()=>clock,save:async()=>{},inspect:()=>{terminal.commands=receipts.update(t,screen,events);return {kind:'claude',terminal,events};},send:async(id,text)=>{writes.push(text);return {submittedAt:clock};}});
    q.data[K]={items:[{id:'next',text:'Now run the tests',status:'queued',at:start}],history:[],active:{id:'c1',text:'/compact',status:'pending',submittedAt:start,sawBusy:false},hold:''};
    for(const at of [40000,46000,120000]){clock=start+at;t.lastOut=clock-1000;await q.tick();const v=q.view(K);
      assert.equal(terminal.commands[0].status,'submitted','a command still working is not in doubt');assert.equal(v.active?.id,'c1');assert(!v.hold&&v.items[0].status==='queued');}
    screen=idle;Object.assign(terminal,{busy:false,ready:true});events=[{t:'cmd',text:'/compact',ts:iso(clock-500)},{t:'cmd-output',text:'Compacted',ts:iso(clock-400)}];clock+=1000;t.lastOut=clock-1000;
    await q.tick();assert.equal(terminal.commands[0].status,'acknowledged');assert.equal(q.view(K).history.at(-1).status,'confirmed');await q.tick();assert.deepEqual(writes,['Now run the tests'],'the message behind it goes next');
    const quiet={kind:'claude',display:{},lastOut:0,outputRevision:0,seenInput:true};receipts.begin(quiet,'/compact','c2',{kind:'instant'},idle);clock+=46000;
    assert.equal(receipts.update(quiet,idle)[0].status,'uncertain','an idle screen with no result after 45 s is still unconfirmed');
    // The agent reports work only through its own state (no marker on screen): the queue still waits for it.
    const t2={kind:'claude',display:{},lastOut:0,outputRevision:0,seenInput:true},s2=clock;receipts.begin(t2,'/compact','c3',{kind:'instant'},idle);let ev2=[];
    const term2={id:'t2',ready:false,input:false,busy:true,commands:[]},q2=new MessageQueue({now:()=>clock,save:async()=>{},inspect:()=>{term2.commands=receipts.update(t2,idle,ev2);return {kind:'claude',terminal:term2,events:ev2};},send:async()=>({submittedAt:clock})});
    q2.data[K]={items:[],history:[],active:{id:'c3',text:'/compact',status:'pending',submittedAt:s2,sawBusy:false},hold:''};clock=s2+60000;await q2.tick();
    assert.equal(term2.commands[0].status,'uncertain');assert.equal(q2.view(K).active?.id,'c3','not failed while the agent is busy');
    Object.assign(term2,{busy:false,ready:true,input:true});ev2.push({t:'cmd',text:'/compact',ts:iso(clock-100)});clock+=1000;await q2.tick();assert.equal(q2.view(K).history.at(-1).status,'confirmed');
    q2.data[K].active={id:'c4',text:'/compact',status:'pending',submittedAt:clock,sawBusy:true};receipts.begin(t2,'/compact','c4',{kind:'instant'},idle);ev2=[];clock+=46000;await q2.tick();
    assert.equal(q2.view(K).items[0]?.status,'failed','idle and unconfirmed: it asks to be checked');
  }finally{Date.now=realNow;}
  console.log('PASS a slash command that works past 45 s stays running and the queue behind it continues');
}
// Real terms.js and the real queue over a stub PTY whose box keeps typed text until Enter, as an agent CLI does:
// a permission question appears right after the paste of a Send now, so Enter is refused and the text stays typed.
async function boxChecks(){
  const os=require('os'),{createRequire}=require('module'),file=path.join(repo,'terms.js'),mod={exports:{}},ptys=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const stub={spawn(){const p={pid:7242,write(d){p.onWrite?.(d);},onData:fn=>p.data=fn,onExit:fn=>p.exit=fn,kill(){},resize(){}};ptys.push(p);return p;}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:mod,exports:mod.exports,require:n=>n==='@lydell/node-pty'?stub:n==='./agents'?{launch:(k,a)=>({file:k,args:a})}:createRequire(file)(n),
    process:{env:{NEXUS_CLAUDE_DIR:path.join(os.tmpdir(),'nexus-truth-h-none')}},setTimeout,clearTimeout,Buffer,console},{filename:file});
  const terms=mod.exports,R='─'.repeat(60),question=[R,' Bash command','','   npm test','',' Do you want to proceed?',' ❯ 1. Yes','   2. No','',' Esc to cancel · Tab to amend'].join('\n');
  const run=async after=>{
    const t=terms.open({kind:'claude',title:'Box',cwd:os.tmpdir(),sessionKey:'claude:box-'+ptys.length}),p=ptys.at(-1),box={typed:'',received:[],ask:true,working:true};
    const paint=s=>p.data('\x1b[2J\x1b[H'+s.replace(/\r?\n/g,'\r\n'));
    box.draw=()=>paint((box.working?'✻ Working… (esc to interrupt)\n\n':'● Done.\n\n')+R+'\n❯ '+box.typed+'\n'+R+'\n  ⏵⏵ auto mode on (shift+tab to cycle)');
    p.onWrite=d=>{if(d.startsWith('\x1b[200~')){box.typed+=d.slice(6,-6);if(box.ask){box.ask=false;paint(question);}else box.draw();}else if(d==='\r'){box.received.push(box.typed);box.typed='';box.working=true;box.draw();}};
    box.draw();await sleep(700);
    const BK='claude:box',q=new MessageQueue({save:async()=>{},inspect:()=>({kind:'claude',terminal:terms.state(t.id,[]),events:[]}),send:terms.send});
    try{
      await q.add(BK,{id:'a',text:'Also update the changelog'});await q.add(BK,{id:'b',text:'And the readme'});
      await assert.rejects(q.change(BK,'push',{id:'a'}),/before Enter/);
      assert.match(q.view(BK).hold,/still typed in the session's box/,'the paused row says the text is still in the box');
      box.working=false;box.draw();await sleep(700); // the owner answers the question; the step ends
      await after(q,BK,box);
    }finally{terms.close(t.id);}
  };
  await run(async(q,BK,box)=>{
    await q.change(BK,'retry',{id:'a',confirmed:true,expectedText:'Also update the changelog'});await q.tick();
    assert.deepEqual(box.received,['Also update the changelog'],'Retry presses Enter on the typed text: delivered once, not twice');});
  await run(async(q,BK,box)=>{
    await q.change(BK,'remove',{id:'a'});await q.tick();
    assert.deepEqual(box.received,[],'the next message is not typed onto the text still in the box');assert.equal(box.typed,'Also update the changelog');
    box.typed='';box.draw();await sleep(1700);await q.tick(); // cleared in Terminal
    assert.deepEqual(box.received,['And the readme'],'once the box is clear the next message goes alone');});
  console.log('PASS Retry or Remove after a refused Enter never types a message onto the one still in the box');
}
function client(){
  let clock=Date.parse('2026-11-10T12:00:00Z'),data=null;const posts=[],html={},RealDate=Date;
  class FakeDate extends RealDate{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
  const host={dataset:{},querySelectorAll:()=>[],querySelector:()=>null,replaceChildren(){},after(){},remove(){},setAttribute(){}};
  const ctx={console,Map,Set,JSON,Promise,Error,Object,Array,String,Number,Boolean,RegExp,Math,Symbol,Date:FakeDate,crypto:require('crypto').webcrypto,setInterval(){},setTimeout,clearTimeout,
    document:{addEventListener(){},hidden:false,activeElement:null,createElement:()=>host,body:{append(){}}},matchMedia:()=>({matches:true}),
    state:{byKey:new Map(),sel:'other',terms:[],view:'focus',tab:'chat'},keyOf:s=>s.kind+':'+s.id,$:sel=>['#nxQueue','#chatConnection'].includes(sel)?host:null,steerDrafts:new Map(),attachments:{clear(){},expand:(k,t)=>String(t??''),contract:(k,t)=>t},
    api:async()=>JSON.parse(JSON.stringify(data)),postNexus:async(url,body)=>{posts.push(body);return {result:data.queue};},toast(){},slashUsed(){},slashClose(){},slashUI:{},statusLabel:()=>['idle'],
    agentName:()=>'Claude',esc:s=>String(s),updateHTML:(el,v)=>{html.v=v;},renderReadableChat(){}};
  ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of ['public/slash-core.js','public/onechat.js','public/message-queue.js'])vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
  const chatFor=vm.runInContext('chatFor',ctx),loadChat=vm.runInContext('loadChat',ctx);
  return {ctx,posts,html,host,set data(v){data=v;},get now(){return clock;},tick(ms){clock+=ms;},chatFor,async load(key){await loadChat(key,true);return chatFor(key);},
    view:key=>[...chatFor(key).pending].map(p=>[p.id,p.status]),composer:key=>ctx.steerDrafts.get(key)||''};
}
async function clientChecks(){
  // Send now into a working session: the terminal took it, so it waits for the agent's next step, however long the tool call runs.
  {const h=client(),t0=h.now,terminal={id:'t1',busy:true,ready:false,input:false},events=[{t:'user',text:'Build it',ts:iso(t0-60000)}];
   h.data={events,terminal,queue:{items:[],history:[{id:'p1',text:'also bump the version',status:'pushed',at:t0-1000,submittedAt:t0,finishedAt:t0}],active:null,hold:'',hosted:true}};
   await h.load(K);h.tick(46000);await h.load(K);h.tick(200000);await h.load(K);
   assert.deepEqual(h.view(K),[['p1','queued']],'a long tool call is not a failed delivery');assert.equal(h.composer(K),'','the composer is not refilled');
   events.push({t:'user',text:'also bump the version',ts:iso(h.now)});h.tick(1000);await h.load(K);assert.deepEqual(h.view(K),[['p1','confirmed']]);}
  // A permission question or a menu holds the agent with busy false; the pushed message waits behind it however long they take.
  for(const held of [{busy:false,prompt:{question:'Do you want to proceed?',options:[{key:'1',label:'Yes'}]}},{busy:false,menu:true}]){
   const h=client(),t0=h.now,terminal={id:'t1',busy:true,ready:false,input:false,prompt:null,menu:false};
   h.data={events:[{t:'user',text:'Build it',ts:iso(t0-60000)}],terminal,queue:{items:[],history:[{id:'p1',text:'also bump the version',status:'pushed',at:t0-1000,submittedAt:t0,finishedAt:t0}],active:null,hold:'',hosted:true}};
   await h.load(K);h.tick(5000);Object.assign(terminal,held);await h.load(K);h.tick(46000);await h.load(K);h.tick(120000);await h.load(K);
   assert.deepEqual(h.view(K),[['p1','queued']],'a question or menu is not a failed delivery');assert.equal(h.composer(K),'','the composer is not refilled');
   Object.assign(terminal,{prompt:null,menu:false,ready:true,input:true});await h.load(K);h.tick(46000);await h.load(K);
   assert.deepEqual(h.view(K),[['p1','failed']],'idle 45 s after the question closes, a missing message is still said');}
  // Once the agent has been idle 45 s and the message never showed, that is real news and still said.
  {const h=client(),t0=h.now;h.data={events:[{t:'user',text:'Build it',ts:iso(t0-60000)}],terminal:{id:'t1',busy:false,ready:true,input:true},queue:{items:[],history:[{id:'p1',text:'Dropped by an interrupt',status:'pushed',at:t0,submittedAt:t0,finishedAt:t0}],active:null,hold:'',hosted:true}};
   await h.load(K);h.tick(46000);await h.load(K);assert.deepEqual(h.view(K),[['p1','failed']]);}
  // The server judges its active row: the chat does not fail it on its own while the agent works on it with no transcript to show.
  {const h=client(),TK='term:t9',t0=h.now;h.data={id:'t9',busy:true,ready:false,input:false,queue:{items:[],history:[],active:{id:'a1',text:'Fix the build',status:'pending',submittedAt:t0,sawBusy:true},hold:'',hosted:true}};
   await h.load(TK);h.tick(90000);await h.load(TK);assert.deepEqual(h.view(TK),[['a1','pending']]);assert.equal(h.composer(TK),'');
   h.data={id:'t9',busy:false,ready:true,input:true,queue:{items:[{id:'a1',text:'Fix the build',status:'failed',error:'Delivery was not confirmed. Check the conversation before retrying.'}],history:[],active:null,hold:'x',hosted:true}};
   await h.load(TK);assert.deepEqual(h.view(TK),[],'a server failure shows as its row with Retry, not a second bubble');}
  // A terminal-only chat has no transcript: a row from before this page stays quiet, a new Send now is not called a failure.
  {const h=client(),TK='term:t8',t0=h.now,terminal={id:'t8',busy:true,ready:false,input:false,queue:{items:[],history:[{id:'before',text:'From an earlier visit',status:'pushed',at:t0-9e5,submittedAt:t0-9e5,finishedAt:t0-9e5}],active:null,hold:'',hosted:true}};
   h.data=terminal;await h.load(TK);h.tick(1000);terminal.queue.history.push({id:'now',text:'Also check the logs',status:'pushed',at:h.now,submittedAt:h.now,finishedAt:h.now});
   await h.load(TK);Object.assign(terminal,{busy:false,ready:true,input:true});h.tick(46000);await h.load(TK);h.tick(46000);await h.load(TK);
   assert.deepEqual(h.view(TK),[['now','queued']]);assert.equal(h.composer(TK),'');}
  // An old pushed row whose record left the loaded window does not come back as "Not delivered".
  {const h=client(),t0=h.now,old=t0-3*864e5,events=[];for(let i=0;i<600;i++)events.push({t:'tool',text:'Read',ts:iso(t0-3600000+i*1000)});events.push({t:'user',text:'Recent message',ts:iso(t0-1000)});
   h.data={events,truncated:true,terminal:{id:'t2',busy:false,ready:true,input:true},queue:{items:[],history:[{id:'oc',text:'Recent message',status:'confirmed',received:true,submittedAt:t0-1500,finishedAt:t0-900},{id:'op',text:'Old pushed message from Monday',status:'pushed',at:old,submittedAt:old,finishedAt:old}],active:null,hold:'',hosted:true}};
   await h.load(K);h.tick(46000);await h.load(K);assert(!h.view(K).some(([id])=>id==='op'),'no bubble for a row outside the window');assert.equal(h.composer(K),'');}
  console.log('PASS chat bubbles from the server queue follow the server: Send now waits for the next step, old rows stay quiet, real drops still show');
  // Retry on a failed row sends the retry; the row says it is paused, not queued.
  {const h=client(),item={id:'m1',text:'Please refactor the parser',status:'failed',error:'Delivery was not confirmed. Check the conversation before retrying.'};
   const q={items:[item],history:[],active:null,hold:item.error,hosted:true,reason:item.error};h.data={queue:q};const chat=h.chatFor(K);chat.queue=q;vm.runInContext('queueRender',h.ctx)(chat,K);
   assert.match(h.html.v,/<span>Paused<\/span>/);assert.match(h.html.v,/data-queue-action="retry"/);
   await h.host.onclick({target:{closest:sel=>sel==='[data-queue-action]'?{dataset:{queueAction:'retry'},closest:()=>({dataset:{queueId:'m1'}})}:null}});
   assert.deepEqual(h.posts.map(p=>[p.operation,p.id,p.confirmed,p.expectedText]),[['retry','m1',true,item.text]]);}
  console.log('PASS Retry on a failed queued message sends it again, and the row reads Paused');
}
(async()=>{await serverChecks();await slashChecks();await boxChecks();await clientChecks();})().catch(error=>{console.error(error);process.exitCode=1;});
