'use strict';
// Slash rows tell the truth: a command row only for a command that ran, once, with a true status. Synthetic records only.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),core=require(path.join(root,'public/slash-core')),receipts=require(path.join(root,'slash-receipts'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=()=>({setAttribute(){},removeAttribute(){},addEventListener(){},remove(){},prepend(){},append(){},focus(){},dataset:{},classList:{add(){},remove(){}},querySelectorAll:()=>[],hasAttribute:()=>true,value:''});
const box={console,esc,crypto:require('crypto'),NexusSlash:core,state:{sel:'claude:x',view:'focus',byKey:new Map(),terms:[]},$:()=>null,document:{addEventListener(){},activeElement:null,createElement:el,body:el()},
  localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:true}),innerWidth:1200,steerDrafts:new Map(),renderSteer(){},chatFor:()=>({pending:[]}),clockTime:t=>new Date(t).toISOString().slice(11,19),
  renderReadableChat(){},nxComposerState(){},sendChat(){},modal(){},closeModal(){},toast(){},updateHTML(){},nxMultiAgent:()=>false,agentName:k=>k};
vm.createContext(box);for(const f of ['public/slash.js','public/slash-picker.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),box,{filename:f});
const chatEvents=vm.runInContext('slashChatEvents',box),slashRow=vm.runInContext('slashRow',box);
const strip=html=>html.replace(/<pre[^>]*>[\s\S]*?<\/pre>|<time>[\s\S]*?<\/time>|<i class="nx-slash-chevron"[^>]*>›<\/i>|<button[\s\S]*?<\/button>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
// What the chat draws: command rows by their visible heading, other events by kind.
function draw(chat){return [...chatEvents({pending:[],terminal:{commands:[]},...chat})].map(e=>e.t==='command'?{t:'command',id:e.id,status:e.status,label:strip(slashRow(e)).replace(/^\/ /,''),output:e.output||''}:{t:e.t,text:e.text});}
// Mirrors server.js claudeEvents for the record shapes used here: claudeRecord first, then plain prompts, replies and the compaction boundary.
function serverEvents(records){const ev=[];for(const r of records){const c=core.claudeRecord(r);if(c.length){ev.push(...c);continue;}const s=typeof r.message?.content==='string'?r.message.content.trim():'';
  if(r.type==='user'&&s&&!s.startsWith('<')&&!r.isMeta)ev.push({t:'user',ts:r.timestamp,text:s});else if(r.type==='assistant')ev.push({t:'ai',ts:r.timestamp,text:r.message.content[0].text});else if(r.subtype==='compact_boundary')ev.push({t:'note',ts:r.timestamp,text:'context compacted'});}return ev;}
const t0=Date.parse('2026-11-01T10:00:00.000Z'),at=ms=>new Date(t0+ms).toISOString(),user=(ms,content,extra={})=>({type:'user',uuid:'u'+ms,timestamp:at(ms),message:{content},...extra});
const local=(ms,content)=>({type:'system',subtype:'local_command',uuid:'s'+ms,timestamp:at(ms),content,isMeta:false});

{// Only a record that starts with its tag is a command record; a skill Claude Code loads by itself is a note; output is plain text.
 assert.deepEqual(core.claudeRecord(user(0,'Why does the chat show <command-name>/model</command-name> as a row?')),[],'a message quoting the tag stays a message');
 assert.deepEqual(core.claudeRecord(user(0,'The log said <local-command-stdout>Set model</local-command-stdout> twice')),[],'a message quoting output stays a message');
 assert.equal(serverEvents([user(0,'Why does the chat show <command-name>/model</command-name> as a row?')])[0].t,'user');
 assert.equal(core.claudeRecord(user(0,'<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>'))[0].text,'/compact');
 assert.equal(core.claudeRecord(user(0,'<command-message>review is running…</command-message>\n<command-name>/review</command-name>\n<command-args>a b</command-args>'))[0].text,'/review a b');
 assert.equal(core.claudeRecord(local(0,'<command-name>/context</command-name><command-args></command-args>'))[0].t,'cmd');
 assert.equal(core.claudeRecord(user(0,[{type:'text',text:'<local-command-stderr>Bad</local-command-stderr>'}]))[0].err,true);
 const skill=user(1000,'<command-message>example-skill</command-message>\n<command-name>example-skill</command-name>\n<skill-format>true</skill-format>',{isMeta:true,turnCompanion:true});
 assert.deepEqual(core.claudeRecord(skill).map(e=>[e.t,e.text]),[['note','Skill loaded: example-skill']]);
 const drawn=draw({events:serverEvents([user(0,'Please look at this carefully'),skill,{type:'assistant',timestamp:at(5000),message:{content:[{type:'text',text:'Looking.'}]}}])});
 assert(!drawn.some(e=>e.t==='command'),'no "Ran example-skill" row: '+JSON.stringify(drawn));assert(drawn.some(e=>e.t==='note'&&e.text==='Skill loaded: example-skill'));
 assert.equal(core.claudeRecord(user(0,'<local-command-stdout>\x1b[2mCompacted (ctrl+o to see full summary)\x1b[22m</local-command-stdout>'))[0].text,'Compacted (ctrl+o to see full summary)');
 console.log('PASS command records: anchored tags, skill loads as notes, output without terminal codes');
}
{// /compact: Claude Code writes the text as a plain prompt at once and the command record (stamped with the start time) plus output when it ends.
 const records=[user(0,'Earlier question'),{type:'assistant',timestamp:at(1000),message:{content:[{type:'text',text:'Earlier answer.'}]}},user(10000,'/compact',{promptId:'p'}),
  {type:'system',subtype:'compact_boundary',uuid:'b',timestamp:at(152000)},user(10006,'<local-command-caveat>Caveat</local-command-caveat>',{isMeta:true}),
  user(10006,'<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>'),user(152100,'<local-command-stdout>\x1b[2mCompacted (ctrl+o to see full summary)\x1b[22m</local-command-stdout>')];
 const running=serverEvents(records.slice(0,3)),done=serverEvents(records),commands=d=>d.filter(e=>e.t==='command'),bubbles=d=>d.filter(e=>e.t==='user'&&e.text==='/compact');
 let d=draw({events:done});assert.equal(commands(d).length,1,'typed in the terminal: one row '+JSON.stringify(d));assert.equal(bubbles(d).length,0,'and no "/compact" bubble');assert.match(commands(d)[0].label,/^Ran \/compact/);assert.equal(commands(d)[0].output,'Compacted (ctrl+o to see full summary)');
 // Sent from NEXUS: the receipt says Running while the compaction works, Ran with the output once the records arrive.
 const term={kind:'claude',seenInput:true,display:{synchronized:false,pending:false},lastOut:Date.now()-5000,outputRevision:1,exited:false},rule='─'.repeat(40);
 const idle=['● Earlier answer.','',rule,'❯ ',rule,'  ? for shortcuts'].join('\n'),busy=['● Earlier answer.','','✻ Compacting conversation… (38s · esc to interrupt)','',rule,'❯ ',rule,'  ? for shortcuts'].join('\n');
 const r=receipts.begin(term,'/compact','r-compact',{kind:'args'},idle);r.submittedAt=t0+9900;term.outputRevision=2;term.lastOut=Date.now()-100;
 assert.equal(core.transcriptReceipt(r,running).status,'submitted','the echo alone is not the end');
 let shown=receipts.update(term,busy,running)[0];assert.equal(shown.status,'submitted','compacting: still running');
 d=draw({events:running,terminal:{commands:[shown]}});assert.equal(commands(d).length,1);assert.match(commands(d)[0].label,/^Running \/compact/);assert.equal(bubbles(d).length,0);
 term.lastOut=Date.now()-5000;term.outputRevision=3;shown=receipts.update(term,['Compacted (ctrl+o to see full summary)','',rule,'❯ ',rule,'  ? for shortcuts'].join('\n'),done)[0];
 assert.equal(shown.status,'acknowledged');assert.equal(shown.evidence,'transcript');assert.equal(shown.output,'Compacted (ctrl+o to see full summary)','output follows the command record, not the echo');
 d=draw({events:done,terminal:{commands:[shown]}});assert.equal(commands(d).length,1,'sent from NEXUS: one row '+JSON.stringify(d));assert.equal(commands(d)[0].id,'r-compact');assert.match(commands(d)[0].label,/^Ran \/compact/);assert.equal(bubbles(d).length,0);
 assert.equal(core.transcriptReceipt(r,[...running,{t:'ai',ts:at(20000),text:'Reply'}]).status,'acknowledged','an echo the agent answered is a finished command');
 console.log('PASS /compact: one row, running until its records arrive, output from the command record');
}
{// A refusal is a rejection, not a run; an output with no command is not "Ran Local command".
 const refusal="/skills isn't available over Remote Control.";
 let d=draw({events:serverEvents([user(0,'/skills',{origin:{kind:'human'}}),local(0,'<local-command-stdout>'+refusal+'</local-command-stdout>')])});
 assert.deepEqual(d.map(e=>e.t),['command'],'the typed text and the refusal are one row '+JSON.stringify(d));assert.equal(d[0].status,'rejected');assert.match(d[0].label,/^Command rejected \/skills/);assert.equal(d[0].output,refusal);
 assert.equal(core.transcriptReceipt({text:'/skills',submittedAt:t0-100},serverEvents([user(0,'/skills'),local(0,'<local-command-stdout>'+refusal+'</local-command-stdout>')])).status,'rejected');
 const before='● Earlier answer.\n❯ \n? for shortcuts',screen=(line,text)=>({screen:'● Earlier answer.\n❯ '+text+'\n  ⎿  '+line+'\n❯ \n? for shortcuts',ready:true,menu:false,busy:false,exited:false,settled:true,changed:true});
 for(const [line,text] of [[refusal,'/skills'],['Unknown skill: example','/example'],['Unknown command: /example','/example']])assert.equal(core.screenReceipt({text,submittedAt:1,before,kind:'args'},screen(line,text))?.status,'rejected',line);
 assert.equal(core.screenReceipt({text:'/context',submittedAt:1,before,kind:'args'},screen('Context usage: 2%','/context'))?.status,'acknowledged','ordinary output still runs');
 const reply={type:'assistant',timestamp:at(1000),message:{content:[{type:'text',text:'Done.'}]}};
 d=draw({events:serverEvents([reply,local(2000,'<local-command-stdout></local-command-stdout>')])});assert(!d.some(e=>e.t==='command'),'an empty output with no command draws nothing');
 d=draw({events:serverEvents([reply,local(2000,'<local-command-stdout>Some output</local-command-stdout>')])});const row=d.find(e=>e.t==='command');
 assert(row&&row.output==='Some output','an orphan output is still shown');assert.equal(row.label,'Command output');
 assert(!d.some(e=>e.t==='command'&&/Local command|^Ran/.test(e.label)));
 console.log('PASS refusals are rejections, orphan outputs are labelled as output, empty ones are dropped');
}
{// After a NEXUS restart the receipts are gone but the queue history is not: each delivered command is drawn once.
 const events=serverEvents([user(5000,'<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),user(5000,'<local-command-stdout>Set model to Opus</local-command-stdout>')]);
 const receipt={id:'q-model',text:'/model opus',name:'model',kind:'menu',status:'acknowledged',evidence:'transcript',submittedAt:t0+4800,output:'Set model to Opus'};
 const history=[{id:'q-model',text:'/model opus',at:t0+3800,status:'confirmed',submittedAt:t0+4800,received:true,finishedAt:t0+7000,command:receipt}],rows=d=>d.filter(e=>e.t==='command');
 assert.equal(rows(draw({events,queue:{items:[],history,active:null}})).length,1,'after a restart');
 assert.equal(rows(draw({events,terminal:{commands:[receipt]},queue:{items:[],history,active:null}})).length,1,'while the terminal lives');
 const later=serverEvents([user(9000,'<command-name>/clear</command-name><command-args></command-args>')]),cancelled={id:'c',text:'/clear',status:'cancelled',submittedAt:t0+8000};
 assert.deepEqual(rows(draw({events:later,localCommands:[cancelled]})).map(e=>e.status),['cancelled','acknowledged'],'a cancelled request is not hidden by a later run');
 const stale=[{...history[0],id:'q-old',text:'/usage',command:{...receipt,id:'q-old',text:'/usage',status:'submitted',output:''}}];
 assert.doesNotMatch(rows(draw({events:[],queue:{items:[],history:stale,active:null}}))[0].label,/^Running/,'a finished queue entry is not still running');
 console.log('PASS queue history after a restart: one row per delivered command, nothing finished shown as running');
}
