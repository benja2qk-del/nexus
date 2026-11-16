'use strict';
// Voice and call truth: what the call says and shows must be what happened in the session.
// Synthetic data only. Runs the real modules in node with a virtual clock; no browser, network, microphone or model.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{Readable}=require('node:stream');
const root=path.resolve(__dirname,'..'),source=f=>fs.readFileSync(path.join(root,f),'utf8');
const voice=require('../public/voice-core'),{parser,context}=require('../live-protocol'),{createLiveService}=require('../live-service');
const flush=async()=>{for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));};
function clock(){
  let now=Date.parse('2026-11-10T10:00:00Z'),timers=[],serial=0;
  const c={now:()=>now,setTimeout(fn,ms=0){const id=++serial;timers.push({id,at:now+Math.max(0,Number(ms)||0),fn});return id;},clearTimeout(id){timers=timers.filter(t=>t.id!==id);},
    async run(ms){const end=now+ms;for(;;){await flush();timers.sort((a,b)=>a.at-b.at||a.id-b.id);const next=timers[0];if(!next||next.at>end){now=end;await flush();return;}timers.shift();now=next.at;next.fn();}}};
  c.Date=class extends Date{constructor(...a){a.length?super(...a):super(now);}static now(){return now;}};
  return c;
}
function absorber(){
  const target=function(){};
  const p=new Proxy(target,{get(t,k){if(k===Symbol.toPrimitive)return()=>'';if(k==='then')return undefined;if(['hidden','isConnected','checked','inert'].includes(k))return t[k]??false;if(['dataset','style','classList'].includes(k))return t[k]||=absorber();if(['textContent','innerHTML','value'].includes(k))return t[k]??'';if(k==='querySelectorAll')return()=>[];return t[k]??p;},set(t,k,v){t[k]=v;return true;},apply(){return p;}});
  return p;
}
// public/call.js against a scripted session. tick(chat,ms since the sentence was sent) plays the agent.
function callWorld(script){
  const clk=clock(),spoken=[],els=new Map(),el=sel=>els.get(sel)||els.set(sel,absorber()).get(sel);
  const chat={events:[],pending:[],terminal:{id:'t1',ready:true,input:true,busy:false,prompt:null,exited:false},more:false,error:'',queue:null};
  let sentAt=null;const prefs=new Map([['callMode','turns'],['callNarration','off']]);
  const sandbox={console,Promise,JSON,Set,Map,Math,String,Number,Array,Object,Error,Date:clk.Date,setTimeout:clk.setTimeout,clearTimeout:clk.clearTimeout,setInterval:()=>0,clearInterval(){},
    navigator:{},document:{hidden:false,addEventListener(){},createElement:()=>absorber(),body:absorber(),activeElement:null},window:{addEventListener(){}},
    NexusCallCore:require('../public/call-core'),NexusVoiceCore:voice,NexusDesign:require('../public/redesign-core'),NexusActivity:require('../public/activity-language'),
    Prism:{markup:()=>''},$:el,esc:s=>String(s),updateHTML(target,html){target.html=html;},nxAgent:()=>'',nxModel:()=>'',agentName:()=>'Claude',
    pref:{get:(k,d)=>prefs.has(k)?prefs.get(k):d,set:(k,v)=>prefs.set(k,v)},
    state:{byKey:new Map([['claude:demo',{kind:'claude',id:'demo',title:'Demo'}]]),terms:[],sel:'claude:demo',view:'focus',lastUpdate:0,receivedAt:0},
    keyOf:s=>s.kind+':'+s.id,statusLabel:()=>['ready','Ready'],sessionPreview:()=>'',toast(){},api:async()=>({counts:{}}),setView(){},select(){},nxPhoneRow:()=>'',
    chatFor:()=>chat,loadChat:async()=>{if(sentAt!==null)script.tick?.(chat,clk.now()-sentAt);},ensureChatTerminal:async()=>chat.terminal,
    sendChat:async(retry,text)=>{sentAt=clk.now();return script.send(chat,text);},answerChat:async choice=>{script.answered=choice;return script.answer?script.answer(chat,choice):true;},NexusLiveCall:{},
    NexusVoice:{callAudio(key,callbacks){let recorded=0;return {unlock:async()=>{},close(){},stopSpeech(){},sendNow(){},signal:new AbortController().signal,
      record:()=>{callbacks.state('listening');return recorded++?new Promise(()=>{}):Promise.resolve({voiced:true,manual:false,wav:new ArrayBuffer(8)});},
      transcribe:async()=>({text:script.heard||'What is the status?',language:'en',confidence:1}),
      speak:async(text,lang)=>{callbacks.state('speaking');spoken.push({text,lang});},earcon:async()=>{callbacks.state('your-turn');}};}}};
  sandbox.globalThis=sandbox;vm.createContext(sandbox);
  vm.runInContext(source('public/call.js')+'\n;globalThis.NexusCall=NexusCall;',sandbox,{filename:'public/call.js'});
  return {chat,clk,el,said:()=>spoken.map(s=>s.text),status:()=>sandbox.NexusCall.status,start:()=>sandbox.NexusCall.start('claude:demo')};
}
const at=ms=>new Date(Date.parse('2026-11-10T10:00:00Z')+ms).toISOString();
const ev=(t,text,ms,extra={})=>({t,text,ts:at(ms),...extra});
const history=()=>[ev('user','Earlier question',-60000),ev('ai','Earlier answer.',-55000)];
const sentence=(chat,text)=>{chat.events.push(ev('user',text,1000));chat.terminal={...chat.terminal,busy:true,ready:false,input:false};return {ok:true,message:{id:'m1',text,status:'pending'}};};
const idle=chat=>{chat.terminal={...chat.terminal,busy:false,ready:true,input:true};};

async function closingAnswer(){
  assert.equal(voice.closingReply([ev('ai','I will look first.',0),ev('tool','grep',1,{name:'Bash'}),ev('result','ok',2),ev('ai','The hold was stale. I cleared it.',3)]),'The hold was stale. I cleared it.');
  assert.equal(voice.closingReply([ev('ai','One.',0),ev('ai','Two.',1)]),'One.\n\nTwo.','text with no tool call is all answer');
  assert.equal(voice.closingReply([ev('ai','Started.',0),ev('tool','npm test',1)]),'Started.','a turn that ends on a tool still has its last text');
  const w=callWorld({send:sentence,tick(chat,ms){
    if(ms>300&&!chat.events.some(e=>e.t==='tool'))chat.events.push(ev('ai',"I'll look at the queue code first.",2000),ev('tool','grep hold',3000,{id:'tool1',name:'Bash'}));
    if(ms>900&&!chat.events.some(e=>e.text?.startsWith('The queue'))){chat.events.push(ev('result','ok',4000,{id:'tool1'}),ev('ai','The queue was paused by a stale hold. I cleared it.',5000));idle(chat);}}});
  w.chat.events.push(...history());w.start();await w.clk.run(6000);
  assert.deepEqual(w.said(),['The queue was paused by a stale hold. I cleared it.'],'the call reads the answer, not the narration before the tool call');
  assert.equal(w.el('[data-caption="agent"] small').textContent,'Claude');
  // Load earlier messages prepends older events while the agent works; they are not this sentence's reply.
  const b=callWorld({send:sentence,tick(chat,ms){
    if(ms>300&&!chat.earlier){chat.earlier=true;chat.events=[ev('user','Old question from yesterday',-86400000),ev('ai','OLD ANSWER from yesterday.',-86300000),...chat.events];}
    if(ms>900&&!chat.events.some(e=>e.text==='NEW ANSWER. The build is green.')){chat.events.push(ev('ai','NEW ANSWER. The build is green.',5000));idle(chat);}}});
  b.chat.events.push(...history());b.start();await b.clk.run(6000);
  assert.deepEqual(b.said(),['NEW ANSWER. The build is green.'],'earlier messages loaded during the call are not read as the reply');
  console.log('PASS call reads the closing answer after tool calls, and never an earlier message loaded during the call');
}
async function stuckWaits(){
  // The server queue holds the sentence: nothing was typed into the session.
  const q=callWorld({send(chat,text){chat.queue={hold:'Queue paused for the NEXUS control. Resume when you are ready.',items:[{id:'m1',text,status:'queued'}],history:[],active:null,reason:''};return {ok:true,message:{id:'m1',text,status:'queued'}};},tick(){}});
  q.chat.events.push(...history());q.start();await q.clk.run(6000);
  assert.equal(q.said().length,1);assert.match(q.said()[0],/waiting in the queue/);assert.match(q.said()[0],/Queue paused for the NEXUS control/);
  assert.notEqual(q.status(),'thinking','a held sentence does not show Thinking for good');
  assert.equal(q.el('[data-caption="agent"] small').textContent,'NEXUS','a NEXUS note is not captioned as the agent');
  // The turn ends with no text (interrupted elsewhere).
  const e=callWorld({send:sentence,tick(chat,ms){if(ms>600&&chat.terminal.busy){chat.events.push(ev('tool','npm test',2000,{id:'tool1',name:'Bash'}),ev('note','turn aborted',3000));idle(chat);}}});
  e.chat.events.push(...history());e.start();await e.clk.run(8000);
  assert.deepEqual(e.said(),['The turn ended without a reply. Your sentence is in the conversation.']);assert.notEqual(e.status(),'working');
  // A slow start is not a turn without a reply: the sentence lands, the agent goes busy later, then answers.
  const s=callWorld({send:(chat,text)=>({ok:true,message:{id:'m1',text,status:'pending'}}),tick(chat,ms){
    if(ms>1500&&!chat.events.some(x=>x.t==='user'&&x.text==='What is the status?'))chat.events.push(ev('user','What is the status?',1500));
    if(ms>2500&&ms<6000)chat.terminal={...chat.terminal,busy:true,ready:false,input:false};
    if(ms>=6000&&!chat.events.some(x=>x.text==='All green.')){chat.events.push(ev('ai','All green.',6000));idle(chat);}}});
  s.chat.events.push(...history());s.start();await s.clk.run(9000);
  assert.deepEqual(s.said(),['All green.']);
  // The call starts while a turn runs at the PC, and that turn ends with no text: it says so and listens again.
  for(const end of [ev('note','[Request interrupted by user]',3000),ev('note','API Error: 529 overloaded',3000,{err:true})]){
    const sent=[],w=callWorld({send:(chat,text)=>{sent.push(text);return sentence(chat,text);},tick(){}});
    w.chat.events.push(...history(),ev('user','Run the suite',-2000));w.chat.terminal={...w.chat.terminal,busy:true,ready:false,input:false};
    w.clk.setTimeout(()=>{w.chat.events.push(end);idle(w.chat);},3000);w.start();await w.clk.run(12000);
    assert.deepEqual(w.said(),[end.err?'Claude Code reports: API Error: 529 overloaded':'The turn ended without a reply.'],'a turn the call saw end without text is not Thinking for good');
    assert.deepEqual(sent,['What is the status?'],'the call listened again');
  }
  // A busy screen when the call starts, with nothing recorded after it, may be a turn that already answered: the call
  // says nothing about it and listens.
  {const sent=[],w=callWorld({send:(chat,text)=>{sent.push(text);return sentence(chat,text);},tick(){}});
    w.chat.events.push(...history(),ev('user','Run the suite',-2000),ev('ai','The suite passed.',-500));w.chat.terminal={...w.chat.terminal,busy:true,ready:false,input:false};
    w.clk.setTimeout(()=>idle(w.chat),1000);w.start();await w.clk.run(12000);
    assert.deepEqual(w.said(),[],'no "ended without a reply" for a turn that answered before the call');assert.deepEqual(sent,['What is the status?']);}
  // The sentence meets a busy agent and is refused; that turn then ends with no text. The refused sentence was never
  // sent, so the call does not say it is in the conversation, even when a message typed at the PC is recorded.
  for(const typed of [null,0,1500]){
    let w;const script={send(){throw Error('no send expected');},tick(){}};
    Object.defineProperty(script,'heard',{get(){w.chat.terminal={...w.chat.terminal,busy:true,ready:false,input:false};
      if(typed!==null)w.clk.setTimeout(()=>w.chat.events.push(ev('user','Typed at the PC',500)),typed);
      w.clk.setTimeout(()=>{w.chat.events.push(ev('note','[Request interrupted by user]',8000));idle(w.chat);},8000);return 'Also check the lint';}});
    w=callWorld(script);w.chat.events.push(...history());w.start();await w.clk.run(30000);
    assert.deepEqual(w.said(),['The agent is still working, so your sentence was not sent. Use Interrupt to stop it, then speak.','The turn ended without a reply.'],'typed at the PC: '+typed);
    assert.equal(w.status(),'listening','the call listens again instead of showing Thinking');
  }
  console.log('PASS call says when its sentence is held in the queue or the turn ends without a reply, and still waits for a slow start');
}
async function errorNews(){
  // An API error ends the turn with no reply: the call says what the agent's program reported, from NEXUS.
  const run=async(text,earlier=[])=>{const w=callWorld({send:sentence,tick(chat,ms){if(ms>600&&chat.terminal.busy){chat.events.push(ev('note',text,2000,{err:true}));idle(chat);}}});
    w.chat.events.push(...history(),...earlier);w.start();await w.clk.run(8000);return w;};
  let w=await run('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
  assert.deepEqual(w.said(),['Claude Code reports: API Error: 529'],'the error, without its JSON body');assert.equal(w.el('[data-caption="agent"] small').textContent,'NEXUS');assert.notEqual(w.status(),'thinking');
  w=await run('Usage limit reached. Run /usage for details.');assert.deepEqual(w.said(),['Claude Code reports: Usage limit reached.']);
  w=await run('{"error":"overloaded"}');assert.deepEqual(w.said(),['Claude Code reported an error. It is in the conversation.']);
  // An error from before the sentence is not this turn's news.
  const old=callWorld({send:sentence,tick(chat,ms){if(ms>600&&chat.terminal.busy){chat.events.push(ev('note','turn aborted',3000));idle(chat);}}});
  old.chat.events.push(...history(),ev('note','Usage limit reached.',-50000,{err:true}));old.start();await old.clk.run(8000);
  assert.deepEqual(old.said(),['The turn ended without a reply. Your sentence is in the conversation.']);
  console.log('PASS a turn ended by an API error says the error, not only that no reply came');
}
async function voiceRefusal(){
  // The voice service refuses over 700 characters with a 400: that is not "warming up", so the say route does not retry it for 90 s.
  const {readChunks}=require('../neural-tts'),fail=status=>readChunks({ok:false,status},()=>assert.fail('no audio'));
  for(const status of [400,413])await assert.rejects(fail(status),e=>e.status===status&&!/warming|busy/i.test(e.message)&&/refused/.test(e.message));
  await assert.rejects(fail(503),e=>e.status===503&&/warming up or busy/.test(e.message));
  await assert.rejects(fail(500),e=>e.status===500&&!/warming|busy/i.test(e.message));
  console.log('PASS the neural voice reports a refused text as refused and only a 503 as warming up');
}
function activityWords(){
  // The call's "Working: ..." and Chat's step lines name what the agent really started.
  const A=require('../public/activity-language'),{toolDetail}=require('../session-details');
  assert.equal(A.tool('Workflow',{scriptPath:'flows/review.js'}).kind,'delegate');assert.deepEqual(A.groups([{name:'Workflow',input:{script:'export default 1'}}]),['Assigned work to an agent']);
  assert.equal(A.current({t:'tool',name:'Workflow',human:A.tool('Workflow',{})}),'checking with another agent');
  const source='text(await tools.exec_command({cmd:"npm test -- --run"}))',exec={t:'tool',name:'exec',text:source,human:A.tool('exec',source),detail:toolDetail('exec',source)};
  assert.equal(A.step(exec),'npm test -- --run','a Codex step shows the command, not the wrapper source');
  assert.equal(A.step({t:'tool',name:'Bash',text:'git status',human:A.tool('Bash',{command:'git status'})}),'git status');
  console.log('PASS a Workflow call reads as assigned work and a Codex exec step shows its command');
}
const permission={question:'Do you want to proceed?',context:'● I will run the tests.\n\n Bash command\n\n   npm test\n   Run the unit tests',signature:'sig-1',
  options:[{key:'1',label:'Yes'},{key:'2',label:"Yes, and don't ask again for npm test commands"},{key:'3',label:'No, and tell Claude what to do differently'}]};
async function questions(){
  const speech=voice.questionSpeech(permission);
  assert.match(speech,/npm test\. Run the unit tests\. Do you want to proceed\?/,'the approved command is spoken before the question');
  assert.match(voice.questionSpeech({...permission,context:'C:\\private\\x'}),/^The details are on screen\. Do you want/);
  assert.equal(voice.questionSpeech({...permission,context:''}).startsWith('Do you want to proceed?'),true);
  // Codex prints its command under the question; the lines above it are the conversation behind the dialog.
  const codexScreen=['› Fix the failing queue test','','• Ran rg -n "hold" src','  └ src/queue.js:12: const hold = paused && !resumed','','  Would you like to run the following command?','','  $ npm test','',
    '› 1. Yes, proceed (y)','  2. No, and tell Codex what to do differently (esc)','','  Press enter to confirm or esc to cancel'].join('\n'),codexAsk=require('../public/conversation').pendingPrompt(codexScreen);
  assert.match(codexAsk.context,/Ran rg/,'the fixture has history above the dialog');
  assert.match(voice.questionSpeech(codexAsk),/^Would you like to run the following command\? \$ npm test 1\. Yes, proceed/,'the earlier command is not spoken as the one being approved');
  const w=callWorld({heard:'Yes',send(){throw Error('not a sentence');},tick(){}});
  w.chat.events.push(...history());w.chat.terminal={id:'t1',ready:false,input:false,busy:false,exited:false,prompt:permission};w.start();await w.clk.run(3000);
  assert.match(w.el('#nxCallQuestion').html,/class="permission-context"[^>]*>[^<]*npm test\s+Run the unit tests/,'the call card shows what is being approved, not only the option labels');
  assert.equal(w.said()[0],speech);assert.equal(w.said().length,2);assert.match(w.said()[1],/unclear, so nothing was sent/);
  assert.equal(w.status(),'listening','an unclear answer is said aloud and the call listens again');assert.equal(w.el('[data-caption="agent"] small').textContent,'NEXUS');
  const x=callWorld({send(){throw Error('not a sentence');},tick(){}});x.chat.terminal={...x.chat.terminal,exited:true};x.start();await x.clk.run(3000);
  assert.equal(x.status(),'error');assert.deepEqual(x.said(),['This session ended. Open the conversation to resume it.'],'a paused call says why');
  console.log('PASS call speaks and shows the subject of a permission question, retries an unclear answer aloud, and says why it paused');
  // A spoken answer, then a turn that ends with no reply and no step: the call listens again (thinking -> your-turn is
  // not a valid move, and the call used to stop on it with 'Invalid call transition').
  const quiet={...permission,context:'',signature:'sig-quiet'};
  const a=callWorld({heard:'two',send(){throw Error('not a sentence');},tick(){},answer(chat){chat.terminal={...chat.terminal,prompt:null,busy:false,ready:true,input:true};return true;}});
  a.chat.events.push(...history());a.chat.terminal={id:'t1',ready:false,input:false,busy:false,exited:false,prompt:quiet};a.start();await a.clk.run(10000);
  assert.equal(a.status(),'listening','after an answered question and a silent turn the call listens');
  assert.equal(a.said().some(s=>/Invalid call transition/.test(s)),false,'the call never speaks an internal error');
  console.log('PASS a question answered by voice, followed by a silent turn, hands the call back');
}
function text(){
  const g=voice.gist;
  assert.equal(g('I renamed `fooBar` to `bazQux` in `server.js`. Run `npm test` to check.'),'I renamed fooBar to bazQux in server.js. Run npm test to check.');
  assert.equal(g('You can use and/or logic for the read/write split, 24/7.'),'You can use and/or logic for the read/write split, 24/7.');
  assert.equal(g('It was released on 11/11/2026 and costs 3/4 less.'),'It was released on 11/11/2026 and costs 3/4 less.');
  assert.equal(g('## Summary\n\nThe build passes now. Two tests were flaky.'),'The build passes now. Two tests were flaky.');
  assert.equal(g('**Result**\n\nThe build passes now.'),'The build passes now.');
  assert.equal(g('**The build is green.**\n\nDetails follow.'),'The build is green. Full reply is in the chat.','a bold sentence is the answer, not a title');
  assert.equal(g('The session_id field was missing.'),'The session id field was missing.');
  assert.equal(g('Version 2.5 is out. Server.js changed. Third.'),'Version 2.5 is out. Server.js changed. Full reply is in the chat.');
  assert(!voice.clean('Edit public/app.js, C:\\Users\\Owner\\secret.txt, /private/secret and `src/secret` now.').includes('secret'),'paths stay unspoken');
  assert(!voice.clean('Run `const value = compute(a, b)` first.').includes('compute'),'long code stays unspoken');
  for(const reply of ['No hay errores.','No, eso no funciona.','Ya terminé. No quedan pendientes.','No me aparece ese archivo.','No sé todavía; sigo revisando.'])assert.equal(voice.replyLanguage(reply,'es'),'es',reply);
  assert.equal(voice.replyLanguage('No.','es'),'es');assert.equal(voice.replyLanguage('Tell me if it passed.','es'),'en');assert.equal(voice.replyLanguage('Okay.','en'),'en');
  assert.equal(voice.replyLanguage('Done. I updated la casa config.','en'),'en','one or two stray words do not flip the voice');
  // A short reply with one listed word and none of the other language is in that language.
  for(const reply of ['Fixed the typo.','Pushed it.','Committed it.'])assert.equal(voice.replyLanguage(voice.gist(reply,'es'),'es'),'en',reply);
  assert.equal(voice.replyLanguage(voice.gist('Listo.','en'),'en'),'es');assert.equal(voice.replyLanguage('Okay.','es'),'es','no listed word keeps the owner voice');
  assert.equal(voice.gist('No hay errores en el servidor.\n\nDetalles.'),'No hay errores en el servidor. La respuesta completa está en el chat.');
  console.log('PASS spoken summary keeps short code words, a/b words and dates, skips a heading, and Spanish replies keep the Spanish voice');
}
function live(){
  const speak=(chunks)=>{const out=[],p=parser(t=>out.push(t));for(const c of chunks)p.push(c);p.finish();return out;};
  const stream='<say>Version 2.5 is ready. I changed server.js and app.js. Done.</say>';
  for(let cut=1;cut<stream.length;cut++)assert.deepEqual(speak([stream.slice(0,cut),stream.slice(cut)]),['Version 2.5 is ready.','I changed server.js and app.js.'],'cut at '+cut);
  assert.deepEqual(speak([...stream]),['Version 2.5 is ready.','I changed server.js and app.js.']);
  const tool={t:'tool',name:'Bash',input:{command:'npm test'}};
  assert.equal(context({title:'T',kind:'claude'},{events:[tool,{t:'ai',text:'All tests pass.'}],terminal:{busy:false,ready:true}}).step,'','a finished turn has no current step');
  assert.equal(context({title:'T',kind:'claude'},{events:[tool],terminal:{busy:true}}).step,'running the tests');
  console.log('PASS live sentences do not break inside 2.5 or server.js at any split, and an idle session has no current step');
}
async function liveRefusal(){
  const call=(service,route,body)=>new Promise(resolve=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.headers={};const lines=[];let status=0;
    const res={destroyed:false,writableEnded:false,writeHead(s){status=s;},flushHeaders(){},write(x){lines.push(...String(x).split('\n').filter(Boolean).map(l=>JSON.parse(l)));},end(x){if(x)lines.push(JSON.parse(x));this.writableEnded=true;resolve({status,lines});},on(){},once(){},removeListener(){}};
    service.handle(req,res,'/api/live/'+route,'local',()=>true);});
  const state={session:{title:'Synthetic',kind:'claude'},chat:{terminal:{busy:true,ready:false},events:[{t:'user',text:'Please check the tests'}]}},sent=[];
  const service=createLiveService({snapshot:()=>state,send:async(k,a)=>sent.push(a),brainFactory:async()=>({kind:'stub',model:'stub',close:async()=>{},ask:async(i,delta)=>{delta('<say>Okay, I will tell the agent to check the tests.</say><action>{"type":"relay","text":"Check the tests."}</action>');return {};}})});
  try{
    const id=(await call(service,'start',{key:'claude:fixture'})).lines[0].id;
    const r=await call(service,'turn',{id,text:'Tell the agent to check the tests.'});
    assert.equal(sent.length,0);
    assert.deepEqual(r.lines.filter(l=>l.type==='sentence').map(l=>l.text),['Okay, I will tell the agent to check the tests.','The agent is busy. You can ask me to interrupt it.'],'a refused relay is heard, not only shown');
    assert(r.lines.some(l=>l.type==='error'));
  }finally{await service.close();}
  console.log('PASS live call speaks the refusal after announcing a relay');
}
async function deviceVoice(){
  // public/voice.js with a device voice reading at 13 characters per second.
  const clk=clock(),posts=[];let current=null,finished=false;
  const sandbox={console,Promise,JSON,Math,Object,Error,String,Number,Array,Map,DOMException,AbortController,Date:clk.Date,setTimeout:clk.setTimeout,clearTimeout:clk.clearTimeout,setInterval:()=>0,
    NexusVoiceCore:voice,CustomEvent:class{},document:{hidden:false,addEventListener(){},dispatchEvent(){},getElementById:()=>null,querySelector:()=>null,body:{classList:{add(){},remove(){}}},activeElement:null},
    state:{sel:'claude:demo',view:'focus',tab:'chat',byKey:new Map(),terms:[]},pref:{get:(k,d)=>d,set(){}},$:()=>null,chatFor:()=>({}),attachments:{blocked:()=>false,failed:()=>false},
    SpeechSynthesisUtterance:class{constructor(t){this.text=t;}},
    speechSynthesis:{getVoices:()=>[{lang:'en-US',name:'Device'}],speak(u){current=u;u.onstart?.();u.timer=clk.setTimeout(()=>{finished=true;u.onend?.();},u.text.length/13*1000);},cancel(){if(current)clk.clearTimeout(current.timer);}},
    addEventListener(){},fetch:async(route)=>{posts.push(route);throw Error('no PC voice in this check');}};
  sandbox.window=sandbox;sandbox.globalThis=sandbox;vm.createContext(sandbox);
  vm.runInContext(source('public/voice.js')+'\n;globalThis.NexusVoice=NexusVoice;',sandbox,{filename:'public/voice.js'});
  const long=voice.questionSpeech({question:'Which approach should I take for the session list refresh, given the constraints we discussed about responsiveness and payload size?',options:[1,2,3].map(n=>({key:String(n),label:'Option '+n+' keeps the session list stable while it refreshes, sends a much smaller payload on slow mobile links, and stays cheap for the browser to parse, sort and paint'}))});
  assert(long.length/13>45,'the question needs more than 45 s');
  const adapter=sandbox.NexusVoice.callAudio('claude:demo',{state(){}});let done=false;adapter.speak(long,'en').catch(()=>{}).finally(()=>done=true);
  await clk.run(120000);assert(done);assert(finished,'the device voice read to the end');assert.deepEqual(posts,[],'a long question is not cut and read again by the PC voice');
  console.log('PASS a long spoken question is read once, to the end, by the device voice');
}
async function attachmentChips(){
  class El{constructor(){this.kids=[];this.cache=new Map();this.dataset={};this.className='';this.textContent='';this.hidden=false;this.style={};this.isConnected=true;this.parent=null;this.classList={add(){},remove(){},contains:()=>false};}
    set innerHTML(v){this.cache.clear();}get innerHTML(){return '';}get children(){return this.kids;}appendChild(c){c.parent=this;this.kids.push(c);return c;}remove(){if(this.parent)this.parent.kids=this.parent.kids.filter(k=>k!==this);}
    querySelector(sel){const m=/^\[data-file="(.+)"\]$/.exec(sel);if(m)return this.kids.find(k=>k.dataset.file===m[1])||null;if(!this.cache.has(sel))this.cache.set(sel,new El());return this.cache.get(sel);}querySelectorAll(){return [];}setAttribute(k,v){this[k]=v;}getBoundingClientRect(){return {top:0,bottom:0};}click(){}}
  const send=new El(),input=new El();input.value='Look at this';
  const sandbox={console,setTimeout,clearTimeout,setInterval:()=>0,JSON,Math,Array,Map,String,Number,Object,Date,Promise,Error,encodeURIComponent,decodeURIComponent,URL,Event:class{},File:class{},CustomEvent:class{},
    window:{addEventListener(){}},document:{createElement:()=>new El(),activeElement:null,addEventListener(){},dispatchEvent(){},querySelector:s=>s==='[data-steer=send]'?send:null,getElementById:()=>null,body:{classList:{add(){},remove(){}}}},getComputedStyle:()=>({position:'relative'}),
    toast(){},postNexus:async()=>({}),NexusVoiceCore:voice,state:{sel:'claude:demo',view:'focus',tab:'chat',byKey:new Map(),terms:[]},pref:{get:(k,d)=>d,set(){}},$:s=>s==='#steerIn'?input:null,chatFor:()=>({}),
    XMLHttpRequest:class{constructor(){this.upload={};}open(){}setRequestHeader(k,v){if(k==='X-Nexus-Filename')this.name=decodeURIComponent(v);}send(){setTimeout(()=>{this.status=200;this.responseText=JSON.stringify({path:'D:\\uploads\\'+this.name,name:this.name,size:2048});this.onload();},5);}abort(){}}};
  sandbox.globalThis=sandbox;vm.createContext(sandbox);
  vm.runInContext(source('public/uploads.js')+'\n;globalThis.attachments=attachments;',sandbox,{filename:'public/uploads.js'});
  vm.runInContext(source('public/voice.js')+'\n;globalThis.NexusVoice=NexusVoice;',sandbox,{filename:'public/voice.js'});
  const {attachments}=sandbox,key='claude:demo',host=new El(),zone=new El();let text='',sending=false;
  attachments.mount(host,{key,kind:'claude',dropZone:zone,read:()=>text,write:t=>{text=t;},canEdit:()=>!sending});
  host.onchange({target:{matches:()=>true,files:[{name:'shot.png',size:2048,type:'image/png'}],value:''}});
  await new Promise(r=>setTimeout(r,30));
  const chip=host.querySelector('.attachment-list').children[0],small=()=>chip.querySelector('small').textContent;
  assert.match(small(),/Ready$/);assert.equal(text,'[shot.png]','the box shows the file name, not its path');
  assert.equal(attachments.expand(key,text),'@"D:\\uploads\\shot.png"','the sent text carries the full reference, as before');
  sending=true;text='';zone.oninput();assert.match(small(),/Ready$/,'a send in flight clears the composer without flipping the chip');
  sending=false;text='What is wrong here?';zone.oninput();
  assert.match(small(),/Not in your message/,'a chip whose name left the message does not say Ready');assert.equal(chip.querySelector('.attachment-symbol').textContent,'!');
  assert.equal(host.querySelector('.attachment-status').textContent,'1 need attention');assert.equal(attachments.blocked(key),false);
  assert.equal(attachments.expand(key,text),'What is wrong here?','a file whose name left the message is not sent');
  text+=' [shot.png]';zone.oninput();assert.match(small(),/Ready$/);
  host.onchange({target:{matches:()=>true,files:[{name:'clip.mp4',size:60*1024*1024,type:'video/mp4'}],value:''}});
  assert.equal(attachments.failed(key),true);assert.equal(attachments.blocked(key),true);
  input.value='Look at this';sandbox.NexusVoice.updateControls();
  assert.equal(send.title,'Remove the attachment that failed, then send.','Send does not claim an upload is still running');
  console.log('PASS attachment chip says when its path left the message, and Send names a failed upload');
  // The box shows [file name] for each attached or dropped file; the sent text is the one the full paths gave before.
  const key2='claude:names',host2=new El(),zone2=new El();zone2.querySelector=()=>null;let text2='Compare these';
  attachments.mount(host2,{key:key2,kind:'claude',dropZone:zone2,read:()=>text2,write:t=>{text2=t;},canEdit:()=>true});
  const drop=uris=>{zone2.ondrop({dataTransfer:{types:['Files'],getData:t=>t==='text/uri-list'?uris.join('\r\n'):'',items:[]},preventDefault(){},stopPropagation(){}});return new Promise(r=>setTimeout(r,10));};
  await drop(['file:///C:/a/notes.txt','file:///C:/b/notes.txt']);
  assert.equal(text2,'Compare these [notes.txt] [notes.txt (2)]','two dropped files with one name stay apart');
  assert.equal(attachments.expand(key2,text2),'Compare these C:\\a\\notes.txt C:\\b\\notes.txt','a drop sends the paths it inserted before');
  const chips2=()=>host2.querySelector('.attachment-list').children,note=c=>c.querySelector('small').textContent;
  assert.equal(chips2().length,2);assert.equal(note(chips2()[0]),'On this PC · Ready','a dropped file shows as a chip');assert.equal(chips2()[1].querySelector('strong').title,'C:\\b\\notes.txt','the chip keeps the full path in its tooltip');
  host2.onchange({target:{matches:()=>true,files:[{name:'notes.txt',size:2048,type:'text/plain'}],value:''}});await new Promise(r=>setTimeout(r,30));
  assert.equal(text2,'Compare these [notes.txt] [notes.txt (2)]\n[notes.txt (3)]','an upload goes on its own line, under its own name');
  assert.equal(attachments.expand(key2,text2),'Compare these C:\\a\\notes.txt C:\\b\\notes.txt\n@"D:\\uploads\\notes.txt"');
  assert.equal(attachments.contract(key2,attachments.expand(key2,text2)),text2,'a sent text comes back to the box in its short form');
  host2.onclick({target:{closest:s=>s==='[data-remove-file]'?{dataset:{removeFile:chips2()[0].dataset.file}}:null}});
  assert.equal(chips2().length,2);assert.ok(!text2.includes('[notes.txt]')&&text2.includes('[notes.txt (2)]')&&text2.includes('[notes.txt (3)]'),'removing a chip takes out only its own name: '+text2);
  text2=text2.replace('[notes.txt (2)]','');zone2.oninput();
  assert.match(note(chips2()[0]),/Not in your message/,'a name deleted by hand leaves its chip asking');assert.ok(!attachments.expand(key2,text2).includes('C:\\b\\notes.txt'));
  await drop(['file:///C:/b/notes.txt']);assert.equal(chips2().length,2,'dropping the same file again reuses its chip');assert.match(note(chips2()[0]),/Ready$/);assert.ok(text2.includes('[notes.txt (2)]'));
  attachments.setKind(key2,'codex');assert.ok(attachments.expand(key2,text2).includes('\nD:\\uploads\\notes.txt')&&!attachments.expand(key2,text2).includes('@"')&&text2.includes('[notes.txt (3)]'),'another agent gets its own reference form while the box is unchanged');
  attachments.clear(key2);assert.equal(attachments.expand(key2,'[notes.txt (3)]'),'[notes.txt (3)]','after the send the names mean nothing');
  console.log('PASS the message box shows [file name] for attached and dropped files, and the sent text keeps their full paths');
}
(async()=>{await closingAnswer();await stuckWaits();await errorNews();await voiceRefusal();activityWords();await questions();text();live();await liveRefusal();await deviceVoice();await attachmentChips();})().catch(e=>{console.error(e);process.exitCode=1;});
