'use strict';
// Copilot list rows and chat notes say what the session files say. Synthetic sessions only, no network, no window.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-truth-C-')),home=path.join(root,'copilot'),state=path.join(home,'session-state'),cwd=path.join(root,'Release notes');
process.env.NEXUS_UPLOAD_DIR=path.join(root,'uploads');
const cp=require('../copilot');
const month=Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1),base=Math.max(Date.now()-30*60e3,month+60e3);
const at=n=>new Date(base+n*1000).toISOString(),rec=(type,data,n=0)=>({type,data,timestamp:at(n)});
let serial=0;const newId=()=>'00000000-0000-4000-8000-'+String(++serial).padStart(12,'0');
const yaml=(id,extra='')=>`id: ${id}\ncwd: ${JSON.stringify(cwd)}\n${extra}created_at: ${at(0)}\n`;
function session(rows,{id=newId(),ws=yaml(id),age=0}={}){
  const dir=path.join(state,id),file=path.join(dir,'events.jsonl');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(file,rows.map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync(path.join(dir,'workspace.yaml'),ws);
  if(age){const t=new Date(Date.now()-age);for(const f of [file,path.join(dir,'workspace.yaml')])fs.utimesSync(f,t,t);}
  return {id,dir,file};
}
const start=(n=0)=>rec('session.start',{selectedModel:'gpt-5-mini',startTime:at(n),reasoningEffort:'high',contextTier:'long_context',context:{cwd,branch:'main'}},n);
const tool=(i,n,size=600)=>rec('tool.execution_complete',{toolCallId:'c'+i,success:true,result:{content:'x'.repeat(size)}},n);
const find=(discover,id)=>discover(home,10).find(s=>s.id===id);
let failed=0;const group=(name,fn)=>{try{fn();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name,e);}};
try{
  // A multi-line first prompt makes Copilot write the name as a YAML block scalar.
  group("a block-scalar workspace name becomes the title, other keys unchanged",()=>{
    const s=session([start(),rec('user.message',{content:'Fix the release notes\n\nThen check the preview'},1)],{ws:''}),id=s.id;
    fs.writeFileSync(path.join(s.dir,'workspace.yaml'),`id: ${id}\ncwd: ${JSON.stringify(cwd)}\nclient_name: cli\nname: |-\n  Fix the release notes\n\n  Then check the preview\nuser_named: false\nbranch: main\ncreated_at: ${at(0)}\n`);
    const w=cp.workspace(path.join(s.dir,'workspace.yaml'));
    assert.equal(w.name,'Fix the release notes\n\nThen check the preview','the block is the name');
    assert.equal(w.branch,'main');assert.equal(w.created_at,at(0),'keys after the block still parse');
    assert.equal(find(cp.createDiscovery(),id).title,'Fix the release notes','the title is the first line, never "|-"');
    const folded=path.join(root,'folded.yaml');fs.writeFileSync(folded,'name: >-\n  A long single line that Copilot\n  folded at the line width\ncwd: "C:\\\\work"\n');
    assert.deepEqual(cp.workspace(folded),{name:'A long single line that Copilot folded at the line width',cwd:'C:\\work'},'a folded block joins with spaces');
    const plain=path.join(root,'plain.yaml');fs.writeFileSync(plain,"name: 'It''s ready: ship it'\ncwd: C:\\work\n");
    assert.deepEqual(cp.workspace(plain),{name:"It's ready: ship it",cwd:'C:\\work'},'one-line names are unchanged');
  });
  // A long session: the newest prompt and the spend sit before the 512 KB tail of tool output.
  group("a long Copilot session keeps its latest prompt, spend and options past the tail window and the row limit",()=>{
    const filler=(from,count,n)=>Array.from({length:count},(_,i)=>tool(from+i,n));
    const rows=[{...start(),data:{...start().data,reasoningEffort:'low',contextTier:'default'}},rec('user.message',{content:'FIRST REQUEST'},1),...filler(0,300,2),
      rec('session.resume',{resumeTime:at(3),reasoningEffort:'high',contextTier:'long_context',context:{cwd}},3),rec('user.message',{content:'LATEST REQUEST'},3),rec('assistant.message',{model:'gpt-5-mini',content:'On it.'},4),
      rec('session.usage_checkpoint',{totalPremiumRequests:2,totalNanoAiu:263e9},5),...filler(300,1000,6)];
    const s=session(rows),discover=cp.createDiscovery(),r=find(discover,s.id);
    assert(fs.statSync(s.file).size>800*1024,'the fixture is longer than the tail window');
    assert.equal(r.firstPrompt,'FIRST REQUEST');
    assert.equal(r.lastPrompt,'LATEST REQUEST','the latest prompt, not the first one');
    assert.equal(r.copilotUsage.premiumRequests,2,'the spend recorded before the tail');assert.equal(r.copilotUsage.aiCredits,263);assert.equal(r.copilotUsage.monthPremiumRequests,2);
    assert.deepEqual(r.copilotOptions,{effort:'high',context:'long_context'},'options recorded by the resume next to that prompt');
    fs.appendFileSync(s.file,[rec('user.message',{content:'NEWER REQUEST'},7),...Array.from({length:1100},(_,i)=>rec('assistant.message',{content:'',toolRequests:[{toolCallId:'v'+i,name:'view',arguments:{path:'notes.md'}}]},8))].map(x=>JSON.stringify(x)).join('\n')+'\n');
    assert.equal(find(discover,s.id).lastPrompt,'NEWER REQUEST','a prompt followed by more than the row limit is still the latest');
    assert.equal(find(discover,s.id).copilotUsage.premiumRequests,2);
    fs.appendFileSync(s.file,JSON.stringify(rec('session.shutdown',{totalPremiumRequests:3,totalNanoAiu:300e9},9))+'\n');
    assert.equal(find(discover,s.id).copilotUsage.premiumRequests,3,'a newer usage record replaces the remembered one');
    // A pasted prompt longer than one read chunk, with characters split across chunks, and a record whose keys come in another order.
    const pasted='ÉTAPE '+'é'.repeat(100000),big=session([start(),rec('user.message',{content:'short first'},1),rec('user.message',{content:pasted},2),{data:{totalPremiumRequests:5},type:'session.usage_checkpoint',timestamp:at(3)},...filler(0,1000,4)]);
    const b=find(cp.createDiscovery(),big.id);assert.equal(b.lastPrompt,pasted.slice(0,600));assert.equal(b.copilotUsage.premiumRequests,5);
  });
  // Busy only while a Copilot process can still finish the turn.
  group("a turn left open by a killed process or ended by a resume is not shown as working",()=>{
    const midTurn=[start(),rec('user.message',{content:'Build the preview'},1),rec('assistant.turn_start',{turnId:'t1'},2),rec('assistant.message',{content:'',toolRequests:[{toolCallId:'b1',name:'powershell',arguments:{command:'npm run build'}}]},3)];
    const dead=spawnSync(process.execPath,['-e','']).pid;
    const killed=session(midTurn);fs.writeFileSync(path.join(killed.dir,`inuse.${dead}.lock`),dead+'\n');fs.writeFileSync(path.join(killed.dir,`inuse.${dead}.hold`),'');
    const held=session(midTurn);fs.writeFileSync(path.join(held.dir,`inuse.${process.pid}.lock`),process.pid+'\n');
    const unlocked=session(midTurn);
    const resumed=session([...midTurn,rec('session.resume',{resumeTime:at(4),selectedModel:'gpt-5-mini',context:{cwd}},4)]);
    const discover=cp.createDiscovery();
    const k=find(discover,killed.id);assert.equal(k.status,'done','the process that held the session is gone');assert.equal(k.live,false);assert.equal(k.runState,'saved');
    assert.equal(find(discover,held.id).status,'busy','a live process holds the session');
    assert.equal(find(discover,unlocked.id).status,'busy','no lock files: the transcript decides, as before');
    const r=find(discover,resumed.id);assert.equal(r.status,'done','a resume ends the earlier unfinished turn');assert.equal(r.live,false);
  });
  // A background shell's notice reads as a note, without the model-facing wrapper.
  group("Copilot notifications drop their <system_notification> wrapper",()=>{
    const notice=rec('system.notification',{content:'<system_notification>\nShell command "npm test" (shellId: 2) has exited with exit code 1.\n</system_notification>',kind:{type:'shell_completed',shellId:'2',exitCode:1,description:'npm test'}});
    assert.deepEqual(cp.events(notice).map(e=>[e.t,e.text]),[['note','Shell command "npm test" (shellId: 2) has exited with exit code 1.']]);
    assert.deepEqual(cp.events(rec('system.notification',{content:'Plain notice'})).map(e=>e.text),['Plain notice'],'an unwrapped notice is kept as it is');
  });
  // Copilot can write events.jsonl before the first prompt; a poll in that gap must not freeze an empty first prompt.
  group("a session first seen before its first prompt gets its first prompt and title",()=>{
    const s=session([start(),rec('session.info',{infoType:'model',message:'Model ready'},1)]),discover=cp.createDiscovery();
    assert.equal(find(discover,s.id).firstPrompt,'');
    fs.appendFileSync(s.file,[rec('user.message',{content:'Draft the changelog'},2),rec('assistant.message',{content:'Drafted.'},3)].map(x=>JSON.stringify(x)).join('\n')+'\n');
    const r=find(discover,s.id);assert.equal(r.firstPrompt,'Draft the changelog');assert.equal(r.title,'Draft the changelog');assert.equal(r.lastPrompt,'Draft the changelog');
  });
  // An error is current only until Copilot answers again.
  group("a Copilot error stops being the status once Copilot answers after it",()=>{
    const errorRow=rec('session.error',{errorType:'rate_limit',message:'Rate limited, retrying.'},2);
    const recovered=session([start(),rec('user.message',{content:'Summarize the build'},1),errorRow,rec('assistant.message',{content:'The build passed.'},3),rec('assistant.turn_end',{turnId:'t1'},4)],{age:3600e3});
    const failed=session([start(),rec('user.message',{content:'Summarize the build'},1),rec('assistant.turn_start',{turnId:'t1'},2),rec('assistant.message',{content:'Partial answer.'},3),rec('assistant.turn_end',{turnId:'t1'},4),{...errorRow,data:{errorType:'quota',message:'You have exceeded your monthly quota.'}}],{age:3600e3});
    const discover=cp.createDiscovery(),r=find(discover,recovered.id),f=find(discover,failed.id);
    assert.equal(r.status,'done');assert.equal(r.error,'');assert.equal(r.latestContext,'The build passed.','the reply, not the old error');
    assert.equal(f.status,'error','an error after the last reply stays');assert.equal(f.errorType,'quota');
  });
  // The chat cuts long text at 12,000 characters; the cut shows, so the queue and Chat still match what NEXUS sent.
  group("a long Copilot message or reply is marked where it was cut, never on half an emoji",()=>{
    const long='Long brief. '+'x'.repeat(13000),u=cp.events(rec('user.message',{content:long}))[0];
    assert.equal(u.text,long.slice(0,12000)+'…');
    const emoji='y'.repeat(11999)+'\u{1F600}tail',e=cp.events(rec('user.message',{content:emoji}))[0].text;assert.equal(e,'y'.repeat(11999)+'…','the cut keeps the emoji whole or drops it');
    assert.equal(cp.events(rec('assistant.message',{content:long}))[0].text,long.slice(0,12000)+'…');
    assert.equal(cp.events(rec('user.message',{content:'Short request'}))[0].text,'Short request','short text is unchanged');
  });
  group("a picture NEXUS uploaded shows on the Copilot message",()=>{
    const uploads=process.env.NEXUS_UPLOAD_DIR,shot=path.join(uploads,'abc','shot.png'),other=path.join(root,'elsewhere.png');
    fs.mkdirSync(path.dirname(shot),{recursive:true});fs.writeFileSync(shot,'png');fs.writeFileSync(other,'png');
    const bare=cp.events(rec('user.message',{content:'What is wrong here? '+shot}))[0];assert.equal(bare.images?.length,1,'a bare uploads path');assert.match(bare.images[0],/^[0-9a-f]{32}\.png$/);
    assert.equal(cp.events(rec('user.message',{content:`Look @"${shot}"`}))[0].images?.length,1,'an @"..." reference');
    assert.equal(cp.events(rec('user.message',{content:'Compare '+other}))[0].images,undefined,'a file outside the uploads folder is not shown');
  });
  group("the Copilot quota meter names premium requests, the unit its numbers count",()=>{
    const q=cp.metadata(rec('model.model_call_success',{copilotUsage:{total_nano_aiu:0},quotaSnapshots:{premium_interactions:{entitlementRequests:1500,usedRequests:20,remainingPercentage:98.7,resetDate:at(0)}}}))[0].quota;
    assert.equal(q.unit,'premium requests');assert.equal(q.allowance,1500);assert.equal(q.used,20);
  });
}finally{fs.rmSync(root,{recursive:true,force:true});}
if(failed)process.exitCode=1;
