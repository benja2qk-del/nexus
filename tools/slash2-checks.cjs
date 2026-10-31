'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const core=require('../public/slash-core'),{MessageQueue}=require('../message-queue'),catalogs=require('../slash-commands').catalogs;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-slash2-unit-'));
const entries=catalogs.claude.commands.map(e=>core.decorate(e,'claude'));
assert.equal(core.rank(entries,'cmpct')[0].name,'compact');assert.equal(core.rank(entries,'model')[0].name,'model');
assert.equal(core.category({name:'alien',source:'built-in'}),'custom');assert.equal(core.category({name:'model',source:'plugin'}),'custom');
for(const [name,category] of [['compact','context'],['review','code'],['mcp','tools'],['usage','account'],['clear','session'],['plan','model']])assert.equal(core.category({name,source:'built-in'}),category);
let usage=core.recordUsage({},'claude',{name:'compact'},100);usage=core.recordUsage(usage,'claude',{name:'model'},200);usage=core.recordUsage(usage,'astra',{name:'review'},300);
assert.equal(usage.claude.compact.count,1);assert.equal(core.groups(entries,'',usage,'claude')[0].items[0].name,'model');assert(!core.groups(entries,'',usage,'copilot').some(g=>g.id==='recent'));
assert.equal(new Set(core.groups(entries,'',usage,'claude').flatMap(g=>g.items.map(e=>e.name))).size,entries.length);
assert(core.groups(entries,'',usage,'claude','context').every(g=>g.id==='context'));
assert.equal(core.decorate({name:'clear'},'claude').behavior,'confirm');assert.equal(core.decorate({name:'model',native:'model'},'astra').behavior,'control');
const frequent={claude:{compact:{count:100,at:100},model:{count:1,at:200}}};assert.equal(core.rank(entries,'',frequent,'claude')[0].name,'compact','frequency participates in ranking');
console.log('PASS fuzzy ranking, per-agent persistent usage, categories, deduplicated recents and behavior mapping');
async function run(){
 for(const kind of ['claude','astra','copilot']){
  let now=100000,terminal={id:kind,ready:false,busy:true,prompt:null,menu:false},events=[],writes=[],persisted={},failSave=false,failSend=false,notSentOnce=false;
  const key=kind+':fixture',file=path.join(root,kind+'.json');
  const config={now:()=>now,load:()=>persisted,save:async data=>{if(failSave)throw Error('disk full');persisted=JSON.parse(JSON.stringify(data));fs.writeFileSync(file,JSON.stringify(data));},inspect:()=>({kind,terminal,events}),send:async(id,text,options)=>{if(notSentOnce){notSentOnce=false;throw Object.assign(Error('The screen moved before typing.'),{notSent:true});}writes.push({text,options});if(options.answer==='esc'){terminal.busy=false;terminal.ready=true;return {};}
    if(failSend)throw Error('delivery failed');await new Promise(r=>setTimeout(r,5));terminal.busy=true;terminal.ready=false;return {submittedAt:now};}};
  let q=new MessageQueue(config);
  await Promise.all([q.add(key,{id:'first',text:'First'}),q.add(key,{id:'second',text:'Second'}),q.add(key,{id:'third',text:'Third'})]);await q.tick();assert.equal(writes.length,0);
  await q.add(key,{id:'first',text:'First'});assert.equal(q.view(key).items.length,3);await assert.rejects(q.add(key,{id:'first',text:'Changed'}),/already used/);
  await q.change(key,'move',{id:'third',index:1});await q.change(key,'edit',{id:'third',text:'Third revised'});assert.deepEqual(q.view(key).items.map(i=>i.text),['First','Third revised','Second']);
  // Actual child process verifies a new process can read the complete durable queue.
  const restarted=spawnSync(process.execPath,['-e',`const fs=require('fs');const {MessageQueue}=require('./message-queue');const q=new MessageQueue({load:()=>JSON.parse(fs.readFileSync(process.argv[1])),save:async()=>{},inspect:()=>({terminal:null})});process.stdout.write(JSON.stringify(q.view(process.argv[2])));`,file,key],{cwd:path.resolve('.'),windowsHide:true,encoding:'utf8'});assert.equal(restarted.status,0,restarted.stderr);assert.equal(JSON.parse(restarted.stdout).items.length,3);
  q=new MessageQueue({...config,load:()=>JSON.parse(fs.readFileSync(file))});assert.equal(q.view(key).items[1].text,'Third revised');
  terminal={...terminal,busy:false,ready:true,prompt:{question:'Permission?'}};await q.tick();assert.match(q.view(key).reason,/answer or permission/);assert.equal(writes.length,0);
  terminal.prompt=null;terminal.menu=true;await q.tick();assert.match(q.view(key).reason,/menu/);assert.equal(writes.length,0);
  terminal.menu=false;terminal.exited={code:0};await q.tick();assert.match(q.view(key).reason,/closed/);assert.equal(writes.length,0);terminal.exited=null;
  await Promise.all([q.tick(),q.tick(),q.tick()]);assert.equal(writes.length,1,'parallel scheduler cannot double send');assert.equal(writes[0].text,'First');
  await q.tick();terminal.busy=false;terminal.ready=true;events=[{t:'user',text:'First',ts:new Date(now).toISOString()}];now+=1000;await q.tick();assert.equal(writes.length,1,'receipt completion does not send next in same tick');
  await q.change(key,'remove',{id:'third'});assert(!q.view(key).hold,'removing one message does not pause the rest');await q.tick();assert.equal(writes.length,2);assert.equal(writes[1].text,'Second');await q.tick();terminal.busy=false;terminal.ready=true;events.push({t:'user',text:'Second',ts:new Date(now).toISOString()});now+=1000;await q.tick();
  await q.add(key,{id:'clear',text:'/clear'});await q.tick();assert.equal(q.view(key).items[0].status,'confirm');assert.equal(writes.length,2);await assert.rejects(q.change(key,'confirm',{id:'clear'}),/Confirm/);
  await q.change(key,'cancel',{id:'clear'});assert.equal(q.view(key).history.at(-1).status,'cancelled');await q.change(key,'resume');
  await q.add(key,{id:'clear-yes',text:'/clear'});await q.tick();await q.change(key,'confirm',{id:'clear-yes',confirmed:true,expectedText:'/clear'});assert.equal(writes.at(-1).options.commandConfirmation,'/clear');
  // Crash after dispatch is an uncertain result, never an automatic retry.
  q=new MessageQueue({...config,load:()=>JSON.parse(fs.readFileSync(file))});terminal.busy=false;terminal.ready=true;await q.tick();assert.match(q.view(key).reason,/restart/);assert.equal(writes.length,3);
  await q.change(key,'remove',{id:'clear-yes'});await q.change(key,'resume');
  terminal.busy=true;terminal.ready=false;await q.add(key,{id:'urgent',text:'Urgent'});await assert.rejects(q.change(key,'send-now',{id:'urgent'}),/Confirm/);assert.equal(writes.length,3);
  terminal.prompt={question:'Permission?'};await assert.rejects(q.change(key,'send-now',{id:'urgent',confirmed:true,expectedText:'Urgent'}),/question/);assert.equal(writes.length,3);terminal.prompt=null;
  await q.change(key,'send-now',{id:'urgent',confirmed:true,expectedText:'Urgent'});assert.equal(writes[3].options.answer,'esc');assert.equal(writes[4].text,'Urgent');
  await q.tick();terminal.busy=false;terminal.ready=true;events.push({t:'user',text:'Urgent',ts:new Date(now).toISOString()});now+=1000;await q.tick();
  // Send now types into the working session without Esc; questions and menus still block it.
  terminal.busy=true;terminal.ready=false;await q.add(key,{id:'pushed',text:'Pushed'});terminal.prompt={question:'Permission?'};await assert.rejects(q.change(key,'push',{id:'pushed'}),/question/);terminal.prompt=null;
  const beforePush=writes.length;await q.change(key,'push',{id:'pushed'});assert.equal(writes.length,beforePush+1);assert.equal(writes.at(-1).text,'Pushed');assert.equal(writes.at(-1).options.midTurn,true);assert.notEqual(writes.at(-1).options.answer,'esc');
  assert(!q.view(key).items.some(i=>i.id==='pushed'));assert.equal(q.view(key).history.at(-1).status,'pushed');terminal.busy=false;terminal.ready=true;
  await q.add(key,{id:'pushed-command',text:'/compact'});terminal.busy=true;terminal.ready=false;await assert.rejects(q.change(key,'push',{id:'pushed-command'}),/Slash commands wait/);await q.change(key,'remove',{id:'pushed-command'});terminal.busy=false;terminal.ready=true;
  failSend=true;await q.add(key,{id:'fails',text:'Fail'});await q.tick();assert.match(q.view(key).reason,/Delivery failed/);const count=writes.length;await q.tick();assert.equal(writes.length,count);
  await q.change(key,'remove',{id:'fails'});await q.change(key,'resume');failSend=false;failSave=true;await assert.rejects(q.add(key,{id:'disk-full',text:'Never send'}),/disk full/);failSave=false;await q.tick();assert.equal(writes.length,count,'rejected persistence must not leave sendable intent');
  terminal=null;await assert.rejects(q.add(key,{id:'external',text:'Hello'}),/Open this session in NEXUS/);
  terminal={id:kind,ready:true,busy:false};await q.add(key,{id:'model',text:'/model'});await q.tick();assert.equal(q.view(key).items[0].status,'control');
  const claimed=await q.change(key,'control-claim',{id:'model'});await assert.rejects(q.change(key,'control-claim',{id:'model'}),/already opening/);await q.tick();assert.equal(q.view(key).items[0].status,'opening');
  await q.change(key,'control-done',{id:'model',controlToken:claimed.items[0].controlToken});assert.equal(writes.length,count);assert(q.view(key).hold);await q.change(key,'resume');
  const result=await q.submit(key,{id:'ordinary',text:'An ordinary ready message'});assert.equal(result.queue.active.id,'ordinary');assert(result.submittedAt);await q.submit(key,{id:'ordinary',text:'An ordinary ready message'});assert.equal(writes.length,count+1,'ready sends and HTTP retries use the same durable dispatch');
  await q.tick();terminal.busy=false;terminal.ready=true;events.push({t:'user',text:'An ordinary ready message',ts:new Date(now).toISOString()});now+=1000;await q.tick();assert(!q.view(key).active);
  // An animated screen is never quiet (ready) but shows its input box (input): the queue still delivers and confirms.
  terminal={id:kind,ready:false,input:true,busy:false};const beforeAnimated=writes.length;await q.add(key,{id:'animated',text:'Animated screen'});await q.tick();
  assert.equal(writes.length,beforeAnimated+1,'delivered without a quiet screen');assert.equal(writes.at(-1).text,'Animated screen');
  await q.tick();terminal.busy=false;terminal.ready=false;terminal.input=true;events.push({t:'user',text:'Animated screen',ts:new Date(now).toISOString()});now+=1000;await q.tick();assert(!q.view(key).active,'confirmed without a quiet screen');
  // Nothing typed (notSent): the message goes back and is retried by itself, without pausing the queue.
  notSentOnce=true;await q.add(key,{id:'retried',text:'Retried by itself'});await q.tick();
  assert(!q.view(key).hold,'a send that typed nothing does not pause the queue');assert.equal(q.view(key).items[0].status,'queued');assert.equal(writes.length,beforeAnimated+1);
  await q.tick();assert.equal(writes.length,beforeAnimated+1,'waits a moment before retrying');now+=1500;await q.tick();assert.equal(writes.at(-1).text,'Retried by itself','retried and delivered');
  await q.tick();terminal.busy=false;terminal.input=true;events.push({t:'user',text:'Retried by itself',ts:new Date(now).toISOString()});now+=1000;await q.tick();
  // Completing a confirmed session-ending command must not turn it into a failure.
  q.data[key].active={id:'exit',text:'/exit',submittedAt:now,status:'pending'};terminal={id:kind,exited:{code:0},commands:[{id:'exit',status:'acknowledged',evidence:'terminal-exit'}]};await q.tick();assert.equal(q.view(key).history.at(-1).status,'confirmed');
  terminal={id:kind,ready:true,busy:false};
  await q.add('term:fixture',{id:'unlinked',text:'Link later'});await q.rekey('term:fixture',key);assert(q.view(key).items.some(i=>i.id==='unlinked'));assert(!q.data['term:fixture']);
 }
 // Use the real state writer so queue saves retain existing NEXUS preferences.
 const stateFile=path.join(root,'state.json'),script=`(async()=>{const i=require('./insights');await i.setTitle('claude:fixture','Kept title');await i.saveMessageQueues({'claude:fixture':{items:[{id:'persist',text:'Saved'}]}});process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});`;
 const saved=spawnSync(process.execPath,['-e',script],{env:{...process.env,NEXUS_STATE_FILE:stateFile},encoding:'utf8',windowsHide:true});assert.equal(saved.status,0,saved.stderr);
 const savedState=JSON.parse(fs.readFileSync(stateFile));assert.equal(savedState.titles['claude:fixture'],'Kept title');assert.equal(savedState.messageQueues['claude:fixture'].items[0].text,'Saved');
 // The scheduler leaves sessions with nothing queued alone, and a waiting message always says what it waits for.
 let reads=0,idle={id:'idle',busy:false,ready:false,input:false,prompt:null,menu:false};
 const quiet=new MessageQueue({load:()=>({}),save:async()=>{},inspect:()=>{reads++;return {kind:'copilot',terminal:idle,events:[]};},send:async()=>{throw Error('nothing should be sent');}});
 for(let n=0;n<40;n++)quiet.view('copilot:viewed-'+n);reads=0;await quiet.tick();assert.equal(reads,0,'opened chats with nothing queued are not read every tick');
 await quiet.add('copilot:viewed-1',{id:'wait',text:'What are the next steps?'});
 assert.match(quiet.view('copilot:viewed-1').reason,/message box.*Raw terminal/,'not working and no message box: it says so');
 idle.busy=true;assert.match(quiet.view('copilot:viewed-1').reason,/working/,'a working agent is named as the reason');
 console.log('PASS all-agent queue ordering/edit/reorder, process restart persistence, prompts/menus/closed pauses, send-now confirmation, destructive send-time confirmation, no double-send, dismiss safety, failure and disk-full safety, native controls, session linking, idle sessions skipped, wait reasons');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
