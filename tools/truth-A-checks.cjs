// What NEXUS reads from Claude Code records must be what happened: the owner's own words (typed, pasted, queued, with
// pictures) count as theirs everywhere; interruptions, other sessions, task endings and API errors are notes; Claude
// Code's placeholder is no reply. Chat, row, preview, recap and telemetry must agree, for Codex too, and the recap
// quotes the request and the reply as written. Synthetic data only.
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process'),{EventEmitter}=require('events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-truth-a-'));
// The in-process summary check must not create folders in the real app data; the server keeps the real one (agent CLIs live there).
const realLocal=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=path.join(root,'local');process.env.NEXUS_UPLOAD_DIR=path.join(root,'uploads');fs.mkdirSync(process.env.NEXUS_UPLOAD_DIR,{recursive:true});
const repo=path.join(__dirname,'..'),cr=require('../claude-records'),recap=require('../recap'),telemetry=require('../telemetry'),preview=require('../session-preview'),chatImages=require('../chat-images');
const cwd='C:\\work\\demo',base=Date.now()-3600e3;let n=0;const at=()=>new Date(base+(n++)*1000).toISOString();
const png=seed=>({type:'base64',media_type:'image/png',data:Buffer.from('synthetic picture '+seed).toString('base64')}),IMG=seed=>({type:'image',source:png(seed)});
const U=(content,extra={})=>({type:'user',cwd,timestamp:at(),uuid:'u'+n,message:{role:'user',content},...extra});
const H=(content,extra={})=>U(content,{origin:{kind:'human'},promptSource:'typed',...extra});
const A=text=>({type:'assistant',cwd,timestamp:at(),uuid:'a'+n,message:{role:'assistant',model:'claude-opus-5-5',content:[{type:'text',text}],usage:{input_tokens:10,output_tokens:5}}});
const T=(id,name,input)=>({type:'assistant',cwd,timestamp:at(),message:{role:'assistant',model:'claude-opus-5-5',content:[{type:'tool_use',id,name,input}]}});
const R=(id,content,is_error)=>U([{type:'tool_result',tool_use_id:id,content,...(is_error?{is_error:true}:{})}]);
const Q=(prompt,origin={kind:'human'})=>({type:'attachment',cwd,timestamp:at(),attachment:{type:'queued_command',prompt,commandMode:'prompt',origin,timestamp:at(),humanTurn:true}});
const SYN=(text,extra={})=>({type:'assistant',cwd,timestamp:at(),message:{role:'assistant',model:'<synthetic>',content:[{type:'text',text}],stop_reason:'stop_sequence'},isApiErrorMessage:false,...extra});
const PASTE='\n\n<pasted_content id="1a2b">\nPasted brief, line one.\nLine two.\n</pasted_content id="1a2b">\n',PASTED='Pasted brief, line one.\nLine two.';
const INTERRUPT=U([{type:'text',text:'[Request interrupted by user for tool use]'}],{interruptedMessageId:'m1'});
const PEER=U('Another Claude session sent you a message:\n<cross-session-message from="x">Bump the version.</cross-session-message>',{isMeta:true,origin:{kind:'peer',from:'uds:x',name:'Release helper',body:'Bump the version.'},promptSource:'system'});
const LIMIT=SYN('Session limit reached, resets 5pm',{isApiErrorMessage:true,error:'rate_limit',apiErrorStatus:429});
const TASK={type:'attachment',cwd,timestamp:at(),attachment:{type:'queued_command',prompt:'<task-notification><task-id>t1</task-id><status>completed</status><summary>Job one finished</summary></task-notification>',commandMode:'task-notification',origin:{kind:'task-notification'}}};
const jsonl=rows=>rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n';
let failed=false;const group=(name,fn)=>{try{fn();console.log('PASS '+name);}catch(e){failed=true;console.error('FAIL '+name+'\n',e);}};

group('records: pasted, "<"-led and queued messages are the owner\'s; machine text is not',()=>{
  assert.equal(cr.ownerPrompt(H(PASTE)).text,PASTED,'a <pasted_content> message is the owner\'s text without the tags');
  assert.equal(cr.ownerPrompt(H('See this: '+PASTE)).text,'See this: \n\n'+PASTED.replace(/\n$/,''),'typed text around a paste loses only the tags');
  for(const own of ['<div class="card">Why is this not centered?</div>','<3 thanks, now the footer'])assert.equal(cr.ownerPrompt(H(own))?.text,own,own);
  assert.equal(cr.ownerPrompt(H('<system-reminder>context</system-reminder>')),null,'a Claude Code tag is not the owner\'s');
  assert.equal(cr.ownerPrompt(U('<local-command-stdout>x</local-command-stdout>')),null);
  assert.equal(cr.ownerPrompt(H([{type:'text',text:'<system-reminder>desktop</system-reminder>'},{type:'text',text:'Rename the button.'}])).text,'Rename the button.','parts are read one by one');
  const q=cr.ownerPrompt(Q([IMG(1),{type:'text',text:'Look at this too.'}]));
  assert.equal(q.text,'Look at this too.');assert.equal(q.images.length,1,'a queued picture comes with its message');
  assert.equal(cr.promptText(cr.ownerPrompt(Q([IMG(2)]))),'[Image attached]');
  assert.equal(cr.ownerPrompt(Q('<cross-session-message>x</cross-session-message>',{kind:'peer',name:'Other',body:'x'})),null,'another session\'s message is not the owner\'s');
  assert.equal(cr.ownerPrompt(INTERRUPT),null,'the interrupt marker is not a prompt');
  assert.equal(cr.ownerPrompt(PEER),null);
});
group('records: interruptions, other sessions, task endings, schedules and API errors are notes',()=>{
  assert.deepEqual(cr.note(INTERRUPT),{text:'You interrupted'});
  assert.equal(cr.note(PEER).text,'Message from Release helper: Bump the version.');
  assert.equal(cr.note({...PEER,origin:{...PEER.origin,handback:true}}).text,'Report from Release helper: Bump the version.');
  assert.equal(cr.note(Q('<cross-session-message>Also the changelog.</cross-session-message>',{kind:'peer',name:'Release helper',body:'Also the changelog.'})).text,'Message from Release helper: Also the changelog.');
  assert.equal(cr.note(TASK).text,'Job one finished');
  assert.equal(cr.note({type:'system',subtype:'scheduled_task_fire',content:'Resuming /loop wakeup (Nov 1 9:00am)'}).text,'Resuming /loop wakeup (Nov 1 9:00am)');
  assert.deepEqual(cr.note(LIMIT),{text:'Session limit reached, resets 5pm',err:true});
  assert.ok(cr.machineReply(SYN('No response requested.'))&&cr.note(SYN('No response requested.'))===null,'the placeholder is skipped, not a note');
  assert.ok(!cr.machineReply(A('Real reply.')));
});
group('clip: never splits an emoji, marks the cut',()=>{
  const s='a'.repeat(9)+'\u{1F600}tail';assert.equal(cr.clip(s,10),'a'.repeat(9)+'…');assert.equal(cr.clip(s,11),'a'.repeat(9)+'\u{1F600}…');assert.equal(cr.clip('short',10),'short');
});
const file=(name,rows)=>{const f=path.join(root,name+'.jsonl');fs.writeFileSync(f,jsonl(rows));return f;};
const span=(rows,kind='claude')=>recap.build({kind,id:'x'},recap.readSpan(file('recap-'+(n++),rows)));
group('recap: anchored on the owner\'s real latest message, placeholder and errors read truly',()=>{
  assert.equal(span([H('First ask.'),A('One.'),H(PASTE),A('Two.')]).user.text,PASTED,'a pasted message is the anchor');
  const r=span([H('Run the build.'),T('b','Bash',{command:'npm run build'}),R('b','built'),T('e','Edit',{file_path:'C:\\work\\a.js',old_string:'a',new_string:'b'}),R('e','ok'),INTERRUPT]);
  assert.equal(r.user.text,'Run the build.','an interruption is not the owner\'s message');assert.deepEqual([r.counts.files,r.counts.commands],[1,1],'the work before it is covered');
  const q=span([H('Start.'),T('c','Bash',{command:'ls'}),R('c','x'),Q('Also the export.'),A('Done both.')]);
  assert.equal(q.user.text,'Also the export.','a queued message is the anchor');assert.equal(q.counts.commands,0,'work before it is not counted under it');
  assert.equal(span([H('Q.'),T('i','Bash',{command:'x'}),R('i',[IMG(3)]),Q([IMG(4),{type:'text',text:'This one.'}])]).user.text,'This one.');
  const s=span([H('Tag it.'),A('Tagging now.'),T('g','Bash',{command:'git tag v1'}),R('g',"The user doesn't want to proceed with this tool use.",true),SYN('No response requested.')]);
  assert.equal(s.finalAssistant,'Tagging now.','the placeholder is not the latest reply');assert.equal(s.counts.errors,0,'declining a tool is not an error');
  const e=span([H('Go.'),A('Working.'),LIMIT]);assert.equal(e.finalAssistant,'Working.');assert.equal(e.counts.errors,1,'an API error is counted');assert.match(e.digest,/Agent error: Session limit reached/);
  assert.equal(span([H('Grep.'),T('l','Bash',{command:'grep x log'}),R('l','Error: found in the log')]).counts.errors,0,'a successful command whose output mentions an error is not a failure');
});
group('recap: Codex command outcomes come from item_completed, counted once; its request is not the owner\'s message',()=>{
  const rec=(type,payload)=>({type,timestamp:at(),payload});
  const call=(id,out,item)=>[rec('response_item',{type:'custom_tool_call',name:'exec_command',call_id:id,input:'{"cmd":"npm test"}'}),rec('response_item',{type:'custom_tool_call_output',call_id:id,output:out}),rec('event_msg',{type:'item_completed',item:{type:'CommandExecution',id:'item-'+id,command:['npm test'],...item}})];
  const brief=rec('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'Brief written by another agent.'}]});
  const failedRun=span([brief,...call('c1',[{type:'input_text',text:'Script completed\nWall time 1s'}],{status:'failed',exit_code:1})],'codex');
  assert.equal(failedRun.counts.errors,1,'a failed command is an error');assert.match(failedRun.digest,/^Request to Codex: Brief written by another agent\./);
  assert.equal(span([brief,...call('c2','Error: printed by a passing test',{status:'completed',exit_code:0})],'codex').counts.errors,0,'its output text is not a second verdict');
});
// Codex records as the chat reads them (server.js codexPrompt, codexEvents, codexFinish).
const X=(type,payload,ms)=>({type,timestamp:ms?new Date(ms).toISOString():at(),payload}),ASK=(...parts)=>X('response_item',{type:'message',role:'user',content:parts.map(p=>typeof p==='string'?{type:'input_text',text:p}:p)});
const SAID=text=>X('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text}]}),EXEC=(id,input)=>X('response_item',{type:'custom_tool_call',name:'exec',call_id:id,input});
const PATCH=(id,file,more='')=>EXEC(id,'await tools.apply_patch("*** Begin Patch\\n*** Update File: '+file+'\\n@@\\n-a\\n+b\\n*** End Patch\\n");'+more);
const OUT=(id,...parts)=>X('response_item',{type:'custom_tool_call_output',call_id:id,output:parts.map(text=>typeof text==='string'?{type:'input_text',text}:text)}),CMD_FAILED=X('event_msg',{type:'item_completed',item:{type:'CommandExecution',command:'npm test',status:'failed',exit_code:1}});
const SHOT={type:'input_image',image_url:'data:image/png;base64,'+'A'.repeat(50000)},MARKUP='<button class="go">Go</button> does nothing when I click it',WRAPPED=['<image name=[Image #1]>',{type:'input_image',image_url:'data:image/png;base64,AA'},'</image>'];
const QUOTA=X('event_msg',{type:'task_complete',last_agent_message:null,error:{message:'You have hit your usage limit.',codex_error_info:'usage_limit_exceeded'}});
const QUESTION=X('response_item',{type:'function_call',call_id:'q1',name:'request_user_input_async',arguments:JSON.stringify({questions:[{title:'Keep the old name working?',options:[{label:'Yes'},{label:'No'}]}]})});
group('recap: Codex\'s request, question, usage-limit stop and failed steps are read as the chat reads them',()=>{
  assert.equal(recap.realUser(ASK(MARKUP)).text,MARKUP,'pasted markup is the request');
  assert.equal(recap.realUser(ASK(...WRAPPED,'Codex could not read the local image at `-`: not found','# Brief: fix the form')).text,'# Brief: fix the form','Codex\'s wrappers and the CLI\'s notice are not the request');
  assert.equal(recap.realUser(ASK(...WRAPPED)).text,'[Image attached]');
  const quota=span([ASK('Refactor the module'),X('event_msg',{type:'task_started'}),QUOTA],'codex');
  assert.equal(quota.counts.errors,1,'a usage-limit stop is an error');assert.match(quota.digest,/Agent error: You have hit your usage limit\./);
  const steps=span([ASK('Check it'),EXEC('s1','await tools.view_image({path:"a.png"})'),OUT('s1','Screenshot taken',SHOT),EXEC('s2','throw new Error("x")'),OUT('s2','Script failed\nError: x'),EXEC('s3','text(await tools.exec_command({cmd:"npm test"}))'),CMD_FAILED,OUT('s3','Script failed\nError: exit 1')],'codex');
  assert.equal(steps.counts.errors,2,'a stopped script is an error; a failed command and the script it stopped are one');
  const py=X('response_item',{type:'function_call',name:'shell',call_id:'p1',arguments:'{"command":["python","a.py"]}'});
  assert.equal(span([ASK('Run the script'),py,X('response_item',{type:'function_call_output',call_id:'p1',output:[{type:'input_text',text:'Traceback (most recent call last):\n  File "a.py"'}]})],'codex').counts.errors,1,'with no outcome recorded, the output parts are read as text');
  const patched=span([ASK('Fix it'),PATCH('e1','src/a.js'),OUT('e1','Script completed\nWall time 1.7 seconds\nOutput:\n','ERROR: Failed to read the root certificate store.\nSuccess. Updated the following files:\nM src/a.js')],'codex');
  assert.deepEqual([patched.counts.errors,patched.files],[0,['a.js']],'a completed script is not failed by a warning in its output, and its edit counts');
  assert.equal(span([ASK('Rename the command'),QUESTION,X('response_item',{type:'function_call_output',call_id:'q1',output:'{"accepted":true}'})],'codex').finalAssistant,'Keep the old name working?\n- Yes\n- No','Codex\'s question is its latest reply');
  // A helper thread opens with a copy of its parent's history, stamped with the fork time.
  const fork=Date.now()-600e3,helper=file('helper-'+(n++),[X('session_meta',{id:'h',subagent_history_start_ordinal:5},fork),X('session_meta',{id:'p'},fork),X('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'PARENT: plan the release'}]},fork),
    X('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'Parent note.'}]},fork),X('event_msg',{type:'task_complete'},fork),X('event_msg',{type:'task_started'},fork+1000),X('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'Helper: checks pass.'}]},fork+2000)]);
  const h=recap.instant({kind:'codex',id:'h',file:helper,forkedUntil:fork});
  assert.deepEqual([h.user,h.finalAssistant,h.partial],[null,'Helper: checks pass.',false],'a helper\'s recap does not quote its parent\'s request');
});
group('recap: the request, the reply and file names are quoted as written',()=>{
  const r=span([H('Use {"retries":3} in C:\\work\\demo\\config.json please'),T('e','Edit',{file_path:'C:\\work\\routes\\${name}.tsx',old_string:'a',new_string:'b'}),R('e','ok'),A('Set it:\n\n```json\n{"retries":3}\n```\n\nSee [the docs](https://example.com) and **config.json**.')]);
  assert.equal(r.user.text,'Use {"retries":3} in C:\\work\\demo\\config.json please');assert.match(r.digest,/^Owner message: Use \{"retries":3\} in C:\\work\\demo\\config\.json please\n/);
  assert.equal(r.finalAssistant,'Set it:\n\n```json\n{"retries":3}\n```\n\nSee [the docs](https://example.com) and **config.json**.','the full reply is drawn as Markdown, so it stays Markdown');
  assert.deepEqual(r.files,['${name}.tsx']);
  const long=span([H('x'.repeat(2500)+'\u{1F600}'),A('y'.repeat(12500))]);assert.equal(long.user.text.length,2401);assert.ok(long.user.shortened&&long.finalShortened&&long.finalAssistant.endsWith('…'));
});
group('telemetry: same prompts, no placeholder, API and Codex command errors',()=>{
  const s=telemetry.fresh('x','claude');
  for(const r of [H('First ask.'),A('One.'),H(PASTE),T('b','Bash',{command:'x'}),R('b','ok'),Q([IMG(5),{type:'text',text:'Queued with a picture.'}]),INTERRUPT,A('Reply.'),SYN('No response requested.'),LIMIT])telemetry.consume(s,r);
  const snap=telemetry.snapshot(s);
  assert.equal(snap.lastRequest,'Queued with a picture.');assert.equal(snap.digest.turns,3,'three owner messages, no turn for the interruption');
  assert.equal(snap.lastAssistant,'Reply.');assert.equal(snap.digest.errors,1,'the API error is recorded');
  const x=telemetry.fresh('y','codex');
  for(const r of [{type:'event_msg',timestamp:at(),payload:{type:'item_completed',item:{type:'CommandExecution',command:['npm test'],status:'failed',exit_code:2}}}])telemetry.consume(x,r);
  assert.equal(telemetry.snapshot(x).digest.errors,1);
  const y=telemetry.fresh('z','codex');
  for(const r of [X('event_msg',{type:'task_started'}),ASK('<environment_context>x</environment_context>'),ASK(...WRAPPED,'Codex could not read the local image at `-`: not found',MARKUP),EXEC('v','await tools.view_image({path:"a.png"})'),OUT('v','Screenshot taken',SHOT),
    EXEC('g','text(await tools.exec_command({cmd:"git commit -m fix"}))'),OUT('g','Script completed\nOutput:\n','[main abc1234] Fix the footer\n 1 file changed'),EXEC('f','throw 1'),OUT('f','Script failed\nError: 1'),EXEC('t','text(await tools.exec_command({cmd:"npm test"}))'),CMD_FAILED,OUT('t','Script failed\nError: exit 1'),
    PATCH('p','src/b.js','text(await tools.exec_command({cmd:"npm test"}))'),CMD_FAILED,OUT('p','Script completed\nOutput:\n','Exit code: 1\n1 failing')])telemetry.consume(y,r);
  const ys=telemetry.snapshot(y);
  assert.equal(ys.lastRequest,MARKUP,'Codex\'s request is read as the chat reads it');assert.deepEqual(ys.waste,[],'a screenshot is not a large text output');
  assert.deepEqual(ys.digest.commits.map(c=>[c.confirmed,c.result]),[[true,'Script completed\nOutput:\n[main abc1234] Fix the footer\n 1 file changed']],'tool output is read as text');
  assert.equal(ys.digest.errors,3,'a stopped script is an error; a failed command and the script it stopped are one; so is a failed command in a script that completed');
  assert.deepEqual(ys.digest.files,['src/b.js'],'the patch in a completed script counts');
});
group('preview: the card line is never the placeholder; an API error is shown as news',()=>{
  const p=preview.createPreview();for(const r of [H('Q.'),A('Tagging the release now.'),SYN('No response requested.')])preview.observePreview(p,r);
  assert.equal(preview.previewSummary(p).latestContext,'Tagging the release now.');
  preview.observePreview(p,LIMIT);assert.match(preview.previewSummary(p).latestContext,/Session limit reached/);
});
group('pictures: a bare uploads path in a message is shown as the picture',()=>{
  const pic=path.join(process.env.NEXUS_UPLOAD_DIR,'Pasted image 1.png');fs.writeFileSync(pic,'png');
  assert.equal(chatImages.fromText('I am looking at this through my glasses: '+pic).length,1);
  assert.equal(chatImages.fromText('@"'+pic+'" and again '+pic).length,1,'one picture, however it is named');
  assert.equal(chatImages.fromText('C:\\elsewhere\\secret.png').length,0,'only files sent through NEXUS');
});

// The real server: chat, row and recap read the same records the same way.
(async()=>{
  try{
    // Copilot saves every prompt-mode run; a summary started from the labels folder stays out of the session list.
    const fake=new EventEmitter();let cwdSeen='';fake.stdin=new EventEmitter();fake.stdin.end=()=>setImmediate(()=>fake.emit('close',1));fake.stdout=new EventEmitter();fake.stderr=new EventEmitter();fake.kill=()=>{};
    await recap.createSummarizer((f,a,o)=>{cwdSeen=o.cwd;return fake;},()=>({kind:'copilot',model:'m'}),(k,a)=>({file:'copilot',args:a}),()=>({size:1,mtime:1,digest:'d'}),()=>false)({kind:'claude',id:'s'}).catch(()=>{});
    assert.equal(cwdSeen,require('../session-labels').WORKDIR);console.log('PASS recap: a Copilot summary runs from the labels folder');
  }catch(e){failed=true;console.error('FAIL recap: Copilot summary folder\n',e);}
  const claude=path.join(root,'claude'),proj=path.join(claude,'projects','C--work-demo'),id=k=>'aaaaaaaa-0000-4000-8000-'+String(k).padStart(12,'0');fs.mkdirSync(proj,{recursive:true});
  const write=(k,rows)=>fs.writeFileSync(path.join(proj,id(k)+'.jsonl'),jsonl(rows));
  write(1,[H('First short ask.'),A('Reply one.'),H(PASTE),A('Reply to the brief.')]);
  write(2,[H('Run the build please.'),T('b1','Bash',{command:'npm run build'}),R('b1','built'),INTERRUPT]);
  write(3,[H('Start the importer.'),{type:'last-prompt',lastPrompt:'Start the importer.'},T('b2','Bash',{command:'ls'}),R('b2','x'),Q([IMG(6),{type:'text',text:'Look at this screenshot too.'}]),A('Reply to the screenshot.'),{type:'last-prompt',lastPrompt:'Start the importer.'}]);
  write(4,[H('Tag the release.'),A('Tagging the release now.'),T('g1','Bash',{command:'git tag v1'}),R('g1','ok'),SYN('No response requested.')]);
  write(5,[H('Tidy the headings.'),A('Tidied.'),PEER,A('Version bumped.'),TASK,{type:'system',subtype:'scheduled_task_fire',cwd,timestamp:at(),content:'Resuming /loop wakeup (Nov 1 9:00am)',isMeta:true},U('scheduled prompt',{isMeta:true,promptSource:'system'}),A('Checked.'),LIMIT]);
  write(6,[H('hello'),A('hi'),U('<bash-input>ls</bash-input>'),U('<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>'),A('I see a.txt.')]);
  write(7,[H([{type:'text',text:'<system-reminder>desktop</system-reminder>'},{type:'text',text:'Rename the export button.'}],{entrypoint:'claude-desktop'}),A('Renamed.')]);
  write(8,[H([{type:'text',text:'Fix this layout.'},{type:'image',source:{type:'base64',media_type:'image/png',data:'A'.repeat(260*1024)}}]),A('Layout fixed.')]);
  write(9,[H([png(7),png(8),png(9),{type:'text',text:'Three screenshots.'}].map(p=>p.type==='base64'?{type:'image',source:p}:p)),A('I see three.')]);
  write(10,[H('First question.'),A('Answer.'),H('<3 thanks, now the footer'),A('Footer fixed.')]);
  const old=new Date(Date.now()-3*864e5).toISOString();
  write(13,[{...H('Old question.'),timestamp:old},{...A('Old answer.'),timestamp:old},{type:'cost-state',cost:1},{type:'bridge-session',id:'b'}]);
  write(14,[U('Summarize the nightly log.',{entrypoint:'sdk-cli',promptSource:'sdk'}),A('Summarized.')]);
  const upload=path.join(process.env.NEXUS_UPLOAD_DIR,'Queued shot.png');fs.writeFileSync(upload,'png');
  write(15,[H('Start.'),T('q1','Bash',{command:'ls'}),R('q1','x'),Q('Check this @"'+upload+'"'),A('Seen.')]);
  const big=k=>[T('big'+k,'Read',{file_path:'C:\\work\\big'+k+'.txt'}),R('big'+k,'x'.repeat(150*1024))];
  write(11,[H('Earlier request.'),{type:'ai-title',aiTitle:'Auto title'},'{"type":"filler","pad":"'+'p'.repeat(200*1024)+'"}',{type:'custom-title',customTitle:'Named by the owner'},H('Real latest question.'),A('Real latest answer.')]);
  // A message sent while Claude was busy, then more than the 384 KB tail of work, with Claude Code's last-prompt copy
  // still naming the earlier one: written before the server starts (a restart), and appended while nothing polled.
  const queuedThenWork=k=>[Q('Also check the export.'),A('Checking both.'),T('x'+k,'Bash',{command:'npm run import'}),R('x'+k,'x'.repeat(400*1024)),{type:'last-prompt',lastPrompt:'Start the importer.'},A('Both done.'),{type:'last-prompt',lastPrompt:'Start the importer.'}];
  const importer=[H('Start the importer.'),{type:'last-prompt',lastPrompt:'Start the importer.'},A('Starting.')];
  write(16,[...importer,...queuedThenWork(16)]);write(17,importer);
  // Codex: the recap must quote what its chat shows.
  const codexDir=path.join(root,'codex','sessions','2026','11','10'),cid=k=>'0a000000-0000-4000-8000-'+String(k).padStart(12,'0'),now=Date.now(),fork=now-200e3;
  const rollout=(k,rows)=>{fs.mkdirSync(codexDir,{recursive:true});fs.writeFileSync(path.join(codexDir,'rollout-2026-11-10T10-00-00-'+cid(k)+'.jsonl'),jsonl(rows));};
  const META=(k,ms,extra={})=>X('session_meta',{id:cid(k),timestamp:new Date(ms).toISOString(),cwd,originator:'codex_exec',cli_version:'0.153.4',source:'exec',...extra},ms);
  const WORD=(role,text,ms)=>X('response_item',{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]},ms);
  rollout(1,[META(1,now-300e3),ASK(...WRAPPED,'Codex could not read the local image at `-`: not found',MARKUP),SAID('Fixed the handler.'),X('event_msg',{type:'task_complete'})]);
  rollout(3,[META(3,fork,{source:{subagent:{thread_spawn:{parent_thread_id:cid(2),depth:1,agent_path:'/root/check_task',agent_nickname:'Vega'}}},parent_thread_id:cid(2),agent_nickname:'Vega',agent_path:'/root/check_task',forked_from_id:cid(2),subagent_history_start_ordinal:5}),
    META(2,fork),WORD('user','PARENT: plan the release',fork),WORD('assistant','Parent note.',fork),X('event_msg',{type:'task_complete'},fork),X('event_msg',{type:'task_started'},fork+1000),WORD('assistant','Helper: checks pass.',fork+2000),X('event_msg',{type:'task_complete',last_agent_message:'Helper: checks pass.'},fork+2000)]);
  rollout(4,[META(4,now-120e3),ASK('Refactor the module'),X('event_msg',{type:'task_started'}),QUOTA]);
  rollout(5,[META(5,now-100e3),ASK('Rename the command and test it'),X('event_msg',{type:'task_started'}),EXEC('s3','text(await tools.exec_command({cmd:"npm test"}))'),CMD_FAILED,OUT('s3','Script failed\nError: exit 1'),QUESTION,X('response_item',{type:'function_call_output',call_id:'q1',output:'{"accepted":true}'})]);
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({recentDays:400,sessionLabels:false,themeSorting:false}));
  const port='4821',env={...process.env,LOCALAPPDATA:realLocal,NEXUS_PORT:port,NEXUS_READ_ONLY:'1',NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_LABELS:'off',NEXUS_ASR_DISABLED:'1',NEXUS_CLAUDE_DIR:claude,NEXUS_CODEX_DIR:path.join(root,'codex'),NEXUS_COPILOT_DIR:path.join(root,'copilot'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_CONFIG_FILE:path.join(root,'config.json'),NEXUS_THEMES_FILE:path.join(root,'themes.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json')};
  const server=spawn(process.execPath,['server.js'],{cwd:repo,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const get=async p=>(await fetch('http://127.0.0.1:'+port+p,{headers:{'X-Nexus':'1'}})).json();
  try{
    await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('Server start timed out')),20000);server.stdout.on('data',d=>{if(String(d).includes(':'+port+'/')){clearTimeout(t);r();}});server.once('exit',c=>j(Error('Server exited '+c)));});
    const rows=async()=>new Map((await get('/api/sessions')).sessions.filter(s=>s.kind==='claude').map(s=>[s.id.slice(-2),s]));
    const chat=async k=>(await get('/api/chat?key=claude:'+id(k))).events,said=e=>e.t+(e.images?'['+e.images.length+']':'')+(e.text?':'+e.text:''),recapOf=async k=>get('/api/recap?key=claude:'+id(k));
    let list=await rows();
    assert.deepEqual((await chat(1)).map(said),['user:First short ask.','ai:Reply one.','user:'+PASTED,'ai:Reply to the brief.'],'a pasted message is drawn as theirs');
    assert.equal(list.get('01').lastPrompt,PASTED);assert.equal((await recapOf(1)).user.text,PASTED);
    assert.deepEqual((await chat(2)).filter(e=>['user','note'].includes(e.t)).map(said),['user:Run the build please.','note:You interrupted']);
    assert.equal(list.get('02').lastPrompt,'Run the build please.');assert.equal((await recapOf(2)).user.text,'Run the build please.');
    assert.deepEqual((await chat(3)).filter(e=>e.t==='user').map(said),['user:Start the importer.','user[1]:Look at this screenshot too.'],'a queued picture message is drawn with its picture');
    assert.equal(list.get('03').lastPrompt,'Look at this screenshot too.','a stale last-prompt record does not undo a newer message');assert.equal((await recapOf(3)).user.text,'Look at this screenshot too.');
    assert.ok(!(await chat(4)).some(e=>/No response requested/.test(e.text)),'no placeholder in chat');
    assert.equal(list.get('04').lastText,'Tagging the release now.');assert.equal(list.get('04').latestContext,'Ran 1 shell command');assert.equal((await recapOf(4)).finalAssistant,'Tagging the release now.');
    assert.deepEqual((await chat(5)).map(said),['user:Tidy the headings.','ai:Tidied.','note:Message from Release helper: Bump the version.','ai:Version bumped.','note:Job one finished','note:Resuming /loop wakeup (Nov 1 9:00am)','ai:Checked.','note:Session limit reached, resets 5pm']);
    assert.ok((await chat(5)).at(-1).err,'an API error is an error note');assert.equal(list.get('05').lastText,'Checked.');assert.equal(list.get('05').lastPrompt,'Tidy the headings.');
    assert.deepEqual((await chat(6)).map(said),['user:hello','ai:hi','cmd:!ls','cmd-output:a.txt','ai:I see a.txt.'],'a "!" command and its output are shown');
    assert.equal(list.get('07').firstPrompt,'Rename the export button.');assert.equal(list.get('07').title,'Rename the export button.');
    assert.equal(list.get('08').firstPrompt,'Fix this layout.','a first message larger than the head window is found');
    assert.deepEqual((await chat(9)).map(said),['user[3]:Three screenshots.','ai:I see three.'],'every picture rides on its message');
    assert.equal(list.get('10').lastPrompt,'<3 thanks, now the footer');assert.equal((await chat(10)).filter(e=>e.t==='user').length,2);
    assert.ok(Date.now()-list.get('13').updated>2.9*864e5,'bookkeeping records do not make an old session look new');
    assert.equal(list.get('14').headless,true);assert.equal(list.get('01').headless,false);
    assert.equal((await chat(15)).filter(e=>e.t==='user').at(-1).images?.length,1,'a picture sent while Claude was busy is shown as a picture');
    const named=['Named by the owner','Real latest question.','Real latest answer.'];
    assert.deepEqual([list.get('11').title,list.get('11').lastPrompt,list.get('11').lastText],named);
    // Screenshots push the owner's name, prompt and reply out of the 384 KB tail; the row keeps them.
    fs.appendFileSync(path.join(proj,id(11)+'.jsonl'),jsonl([...big(1),...big(2),...big(3)]));
    list=await rows();
    assert.deepEqual([list.get('11').title,list.get('11').lastPrompt,list.get('11').lastText],named,'values the tail no longer reaches are kept');
    fs.appendFileSync(path.join(proj,id(11)+'.jsonl'),jsonl([{type:'last-prompt',lastPrompt:'Earlier request.'},...big(4),...big(5),...big(6)]));
    list=await rows();
    assert.deepEqual([list.get('11').title,list.get('11').lastPrompt,list.get('11').lastText],named,'and a lagging last-prompt record does not take the prompt back');
    assert.equal(list.get('16').lastPrompt,'Also check the export.','after a restart the row reads back past the tail instead of trusting the lagging last-prompt copy');
    assert.equal((await recapOf(16)).user.text,'Also check the export.');assert.equal((await chat(16)).filter(e=>e.t==='user').at(-1).text,'Also check the export.');
    fs.appendFileSync(path.join(proj,id(17)+'.jsonl'),jsonl(queuedThenWork(17)));list=await rows();
    assert.equal(list.get('17').lastPrompt,'Also check the export.','so does a stretch no page polled');
    console.log('PASS server: chat, row and recap agree on owner messages, notes and replies');
  }catch(e){failed=true;console.error('FAIL server\n',e);}
  try{
    const codex=async k=>[await get('/api/recap?key=codex:'+cid(k)),(await get('/api/chat?key=codex:'+cid(k))).events];
    let [r,c]=await codex(1);
    assert.equal(r.user.text,MARKUP);assert.equal(c.filter(e=>e.t==='user').at(-1).text,r.user.text,'the recap quotes the request the chat shows');
    [r,c]=await codex(3);
    assert.deepEqual([r.user,r.finalAssistant],[null,'Helper: checks pass.'],'a helper\'s recap does not quote its parent\'s request');assert.ok(!c.some(e=>/PARENT/.test(e.text||'')),'nor does its chat');
    [r,c]=await codex(4);
    assert.deepEqual([r.status.label,r.counts.errors],['Quota exceeded',1],'a usage-limit stop is an error');
    [r,c]=await codex(5);
    assert.equal(r.finalAssistant,c.filter(e=>e.t==='ai').at(-1).text,'Codex\'s question is the latest reply in both');assert.equal(r.finalAssistant,'Keep the old name working?\n- Yes\n- No');
    assert.deepEqual([r.counts.errors,c.filter(e=>e.t==='result'&&e.err).length],[1,1],'the failed step counts once, as the chat marks it');
    console.log('PASS server: Codex\'s recap quotes what its chat shows (request, helper, usage limit, question, failed step)');
  }catch(e){failed=true;console.error('FAIL server: Codex recap\n',e);}
  finally{
    const gone=new Promise(r=>{server.once('exit',r);setTimeout(r,3000);});server.kill();await gone;
    try{fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}catch{}
    process.exitCode=failed?1:0;
  }
})();
