'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {parse,ActivityIndex}=require('../subagents'),core=require('../public/subagent-core'),language=require('../public/activity-language'),brief=require('../theme-brief'),themes=require('../public/themes-core');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-activity-check-')),now=Date.now(),ts=i=>new Date(now+i*1000).toISOString();
const tool=(id,name,input,i=0)=>({type:'assistant',uuid:'u-'+id,timestamp:ts(i),message:{content:[{type:'tool_use',id,name,input}]}}),result=(id,content,extra={},i=1)=>({type:'user',timestamp:ts(i),message:{content:[{type:'tool_result',tool_use_id:id,content}]},...extra});
const records=[tool('review','Task',{description:'Review the release',subagent_type:'reviewer',prompt:'Inspect the release checks'}),result('review','Agent launched async',{toolUseResult:{agentId:'a-review',isAsync:true}}),tool('docs','Agent',{description:'Check docs',subagent_type:'writer'}),result('docs','Done',{toolUseResult:{agentId:'a-docs',totalTokens:200,totalToolUseCount:2,totalDurationMs:1500}},3),tool('shell','Bash',{command:'watch tests',run_in_background:true}),result('shell','Running in background with ID: shell-1',{toolUseResult:{backgroundTaskId:'shell-1',isAsync:true}})];
const side=tool('read','Read',{file_path:'README.md'},2);side.isSidechain=true;side.agentId='a-review';side.message.id='message-1';side.message.usage={input_tokens:100,output_tokens:20};
let parsed=parse([...records,side],[],{now:now+5000,live:true});
assert.equal(parse([...records,records[0],side],[],{now,live:true}).rows.length,3,'streamed duplicate tool calls are one delegation');
assert.equal(parsed.rows.length,3);assert.equal(parsed.rows[0].state,'working');assert.equal(parsed.rows[0].tokens,120);assert.equal(parsed.rows[0].toolCount,1);assert.equal(parsed.rows[0].steps[0].text,'Read README.md');assert.equal(parsed.rows[1].state,'done');assert.equal(parsed.rows[1].tokens,200);assert.equal(parsed.rows[1].durationMs,1500);assert.equal(parsed.rows[2].kind,'background');
assert.equal(parse([...records,side,tool('message','SendMessage',{recipient:'a-review',message:'Check accessibility'},4)],[],{now:now+5000,live:true}).rows[0].state,'messaged');
assert.equal(parse([...records,{type:'user',timestamp:ts(5),message:{content:'<task-notification><task-id>shell-1</task-id><status>completed</status></task-notification>'}}],[],{now,live:true}).rows[2].state,'done');
assert.equal(parse([...records,tool('stop','TaskStop',{task_id:'a-review'},5),result('stop','Stopped',{},6)],[],{now:now+7000,live:true}).rows[0].state,'cancelled');
assert.equal(parse(records,[],{now:now+300000,live:false}).rows[0].state,'waiting');
assert.equal(parse(records,[],{now:now+5000,live:false}).rows[0].state,'working','fresh child evidence does not require a registered parent process');
assert.equal(parse([tool('auto-bg','Bash',{command:'node monitor.js'}),result('auto-bg','Running in background',{toolUseResult:{backgroundTaskId:'auto-bg-1',isAsync:true}})],[],{now,live:true}).rows[0].kind,'background');
const progress={type:'progress',parentToolUseID:'review',data:{type:'agent_progress',agentId:'a-review',message:side}};
assert.equal(parse([...records,progress],[{agentId:'a-review',records:[side,side]}],{now,live:true}).rows[0].toolCount,1,'progress and sidechain copies dedupe');
assert.equal(parse([records[0],{...side,parentUuid:'u-review'}],[],{now,live:true}).rows[0].toolCount,1,'inline parent UUID binds an agent before its result');
assert.equal(parse([records[0]],[{agentId:'file-only',records:[{...side,parentUuid:'u-review',agentId:'file-only'}]}],{now,live:true}).rows[0].agentId,'file-only','sidechain parent UUID binds without a result');
for(const [from,to]of Object.entries({completed:'done',failed:'interrupted',running:'working',queued:'delegated',idle:'waiting',canceled:'cancelled'}))assert.equal(core.state(from),to);
for(const state of core.states)assert.equal(core.state(state),state);
assert.equal(language.briefTitle('You are GPT Astra. NEXUS commission "ACTIVITY POLISH".').summary,'ACTIVITY POLISH');
assert.equal(language.briefTitle('You are GPT Astra.\nFix the theme selection.\nRAILS: safe').summary,'Fix the theme selection.');
assert.equal(language.briefTitle('You are GPT Astra, NEXUS\'s UI expert. NEXUS commission "HOME + WALL POLISH" (design critique).\nRAILS: safe').name,'HOME + WALL POLISH');
assert(!language.subtitle({firstPrompt:'You are GPT Astra.\nFix theme selection.',title:'Selection'}).includes('GPT'));
assert.equal(language.subtitle({kind:'astra',firstPrompt:'You are GPT Astra.',title:'You are GPT Astra.'}),'Astra task');
const parentFile=path.join(root,'parent.jsonl'),briefPath=path.join(root,'prompt_release.txt');fs.writeFileSync(briefPath,'Release checks');
fs.writeFileSync(parentFile,[...records,tool('astra-run','Bash',{command:'codex exec "Read '+briefPath+'"'},4)].map(JSON.stringify).join('\n')+'\n');
const sideDir=path.join(root,'parent','subagents');fs.mkdirSync(sideDir,{recursive:true});fs.writeFileSync(path.join(sideDir,'agent-a-review.jsonl'),JSON.stringify(side)+'\n');
const index=new ActivityIndex(),sessions=[{kind:'claude',id:'parent',file:parentFile,live:true},{kind:'astra',id:'child',brief:briefPath,started:ts(5),updated:now+6000,status:'busy',lastText:'Checking the release',title:'Release checks'},{kind:'astra',id:'unrelated',brief:path.join(root,'other.txt'),started:ts(5)}];index.decorate(sessions);
assert.deepEqual(sessions[1].parent,{key:'claude:parent',relation:'delegated',toolId:'astra-run'});assert.equal(sessions[2].parent,undefined);assert.equal(sessions[0].activeSubagents,2);assert.equal(sessions[0].subagents[0].toolCount,1);assert.equal(index.attach(sessions[0],[{t:'tool',id:'astra-run'}])[0].subagents[0].state,'working');
const revision=index.revision(sessions[0]);fs.appendFileSync(path.join(sideDir,'agent-a-review.jsonl'),JSON.stringify({...tool('search','Grep',{pattern:'release'},8),isSidechain:true,agentId:'a-review'})+'\n');index.decorate(sessions);assert.notEqual(index.revision(sessions[0]),revision,'child-only updates invalidate parent cursor');
const main=path.join(root,'project'),other=path.join(root,'shared'),outside=path.join(root,'outside');for(const dir of [main,other,outside])fs.mkdirSync(dir);
fs.mkdirSync(path.join(main,'.claude'));fs.mkdirSync(path.join(main,'.github'));for(const name of Object.keys(brief.FILES))fs.writeFileSync(path.join(main,name),'Instructions for '+name);
const theme={id:'release',name:'Release',mainFolder:main,purpose:'Prepare a release',note:'Keep changes focused'},list=[{theme:{id:'release'},workFolders:[{path:other}]}];
const discovery=brief.discover(theme,list);assert.equal(discovery.folders.length,2);assert.equal(discovery.folders[0].files.length,4);assert.deepEqual(discovery.folders[0].files.find(f=>f.relative==='AGENTS.md').agents,['astra','copilot']);assert.equal(discovery.folders[1].files.length,0);
const old=brief.read(main,'AGENTS.md'),request={folder:main,relative:'AGENTS.md',content:'Updated instructions',revision:old.revision,confirm:true};brief.save(theme,list,request);assert.equal(fs.readFileSync(path.join(main,'AGENTS.md.bak'),'utf8'),old.content);assert.equal(fs.readFileSync(path.join(main,'AGENTS.md'),'utf8'),request.content);
assert.throws(()=>brief.save(theme,list,request),/changed/);assert.throws(()=>brief.save(theme,list,{...request,confirm:false}),/Confirm/);assert.throws(()=>brief.save(theme,list,{...request,folder:outside}),/belonging/);assert.throws(()=>brief.save(theme,list,{...request,relative:'../outside/AGENTS.md'}),/supported/);assert.throws(()=>brief.save(theme,list,{...request,content:'a'.repeat(65537)}),/64 KB/);
assert(brief.save(theme,list,{folder:other,relative:'.github/copilot-instructions.md',content:'Use the shared tests',revision:null,confirm:true}).created);
fs.writeFileSync(path.join(other,'CLAUDE.md'),Buffer.from([0xff,0xfe,0x61,0]));assert.throws(()=>brief.read(other,'CLAUDE.md'),/UTF-8/);
// Junction/hardlink protections are exercised on Windows too, without admin rights.
fs.symlinkSync(outside,path.join(other,'.claude'),'junction');assert.throws(()=>brief.save(theme,list,{folder:other,relative:'.claude/CLAUDE.md',content:'no',revision:null,confirm:true}),/Linked/);assert(!fs.existsSync(path.join(outside,'CLAUDE.md')));
fs.writeFileSync(path.join(outside,'source'),'private');fs.linkSync(path.join(outside,'source'),path.join(other,'AGENTS.md'));assert.throws(()=>brief.save(theme,list,{folder:other,relative:'AGENTS.md',content:'no',revision:null,confirm:true}),/Hard-linked/);assert.equal(fs.readFileSync(path.join(outside,'source'),'utf8'),'private');
fs.linkSync(path.join(outside,'source'),path.join(main,'CLAUDE.md.bak'));assert.throws(()=>brief.save(theme,list,{folder:main,relative:'CLAUDE.md',content:'no',revision:brief.read(main,'CLAUDE.md').revision,confirm:true}),/backup path/);assert.equal(fs.readFileSync(path.join(outside,'source'),'utf8'),'private');
for(const kind of ['claude','astra','copilot']){
 const spec={kind,cwd:outside,claudeArgs:['--model','test'],codexArgs:[],copilotArgs:[]},launch=brief.launch(spec,theme,list);assert(launch.method);
 if(kind==='astra'){assert.equal(launch.spec.cwd,main);assert.deepEqual(launch.spec.codexArgs,[]);}else{const args=launch.spec[kind==='claude'?'claudeArgs':'copilotArgs'];assert(args.includes('--add-dir'));assert(args.includes(main));assert(args.includes(other));if(kind==='claude'){assert(args.includes('--append-system-prompt'));assert.equal(launch.spec.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD,'1');assert(args.some(v=>v.includes(theme.note)));}}
  assert.equal(brief.launch({kind},theme,list).spec.cwd,main);
  if(kind==='copilot')assert(launch.spec.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS.split(',').includes(main));
}
const groups=themes.groups([{id:'a',name:'A',pinned:true},{id:'b',name:'B'}],[{id:'u',kind:'claude',updated:1},{id:'s',kind:'astra',theme:{id:'b'},updated:3}]);assert.equal(groups[0].id,'unsorted');assert.equal(themes.groups([],[]).length,0);
console.log('PASS activity: Task/Agent, inline/progress/file sidechains, async background, states, usage, Astra linking and child refresh');
console.log('PASS theme brief: agent discovery, create, stale revision, confirmation, backup, confinement/junction/hardlink, native launch args');
async function fullHistory(){
 const file=path.join(root,'large.jsonl'),fd=fs.openSync(file,'w');fs.writeSync(fd,JSON.stringify(records[0])+'\n');
 const filler=JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'x'.repeat(10000)}]}})+'\n';for(let i=0;i<1000;i++)fs.writeSync(fd,filler);fs.writeSync(fd,JSON.stringify(records[1])+'\n');fs.closeSync(fd);
 const background=new ActivityIndex({background:true}),session={kind:'claude',id:'large',file,live:true};
 try{background.read(session);const start=Date.now();let result;while(Date.now()-start<10000){result=background.read(session);if(!result.partial)break;await new Promise(r=>setTimeout(r,20));}assert(!result.partial,'complete background scan');assert.equal(result.rows[0].agentId,'a-review','launch before the tail window is retained');assert.equal(result.rows[0].state,'working');
  fs.appendFileSync(file,JSON.stringify(resultRecord())+'\n');let updated;for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,20));updated=background.read(session);if(updated.rows[0]?.state==='done')break;}assert.equal(updated.rows[0].state,'done');
  console.log('PASS full activity worker: 10 MB history, early launch/late result, incremental completion, no UI-thread scan');
 }finally{await background.worker.terminate();}
 function resultRecord(){return result('review','Completed',{toolUseResult:{agentId:'a-review',totalToolUseCount:4}},10);}
}
fullHistory().catch(e=>{console.error(e);process.exitCode=1;});

{const a=require('assert/strict'),L=require('../public/activity-language.js');a.equal(L.step({human:L.tool('Bash',{command:'npm test',description:'Run the test suite'})}),'Run the test suite');a.equal(L.step({name:'Bash',text:'npm test\nmore'}),'npm test');a.equal(L.step({name:'Read',input:{file_path:'C:/a/b.js'}}),'Read b.js');console.log('PASS each tool call reads as its own step');}

{const a=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-images-'));process.env.NEXUS_UPLOAD_DIR=path.join(dir,'uploads');fs.mkdirSync(process.env.NEXUS_UPLOAD_DIR);delete require.cache[require.resolve('../chat-images.js')];const I=require('../chat-images.js');
const name=I.fromBlock({type:'base64',media_type:'image/png',data:Buffer.from('png').toString('base64')});a.equal(fs.readFileSync(I.file(name).path,'utf8'),'png');a.equal(I.file(name).type,'image/png');
a.equal(I.fromBlock({type:'base64',media_type:'image/svg+xml',data:'eA=='}),null,'no svg');a.equal(I.file('../secret.png'),null,'names only');
const inside=path.join(process.env.NEXUS_UPLOAD_DIR,'a.png'),outside=path.join(dir,'b.png');fs.writeFileSync(inside,'x');fs.writeFileSync(outside,'y');a.equal(I.fromText(`look @"${inside}" and @"${outside}"`).length,1,'only uploads');
fs.rmSync(dir,{recursive:true,force:true});console.log('PASS conversation pictures: stored once, safe types, names and upload folder only');}

{const a=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-busy-'));process.env.NEXUS_CLAUDE_DIR=dir;fs.mkdirSync(path.join(dir,'sessions'));const terms=require('../terms.js'),put=status=>fs.writeFileSync(path.join(dir,'sessions','7.json'),JSON.stringify({status}));
put('busy');a.equal(terms.agentBusy({kind:'claude',pid:7}),true);put('idle');a.equal(terms.agentBusy({kind:'claude',pid:7}),false);a.equal(terms.agentBusy({kind:'claude',pid:8}),false,'no record is not busy');a.equal(terms.agentBusy({kind:'copilot',pid:7}),false);
delete process.env.NEXUS_CLAUDE_DIR;fs.rmSync(dir,{recursive:true,force:true});console.log('PASS a working Claude session reads as busy from its own record');}

{const a=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),recap=require('../recap.js');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-recent-')),file=path.join(dir,'a.jsonl');fs.writeFileSync(file,JSON.stringify({type:'user',timestamp:new Date().toISOString(),message:{role:'user',content:'Add the route planner'}})+'\n');
const made=recap.recentSnapshot({sessions:[{kind:'claude',id:'a',file,title:'Route planner',theme:{name:'Atlas'}},{kind:'claude',id:'b',file,title:'Login fix'}]});a.ok(made.digest.includes('Theme: Atlas')&&made.digest.includes('Theme: Unsorted')&&made.digest.includes('Route planner'));a.ok(made.digest.length<=24000);fs.rmSync(dir,{recursive:true,force:true});console.log('PASS What was I doing groups the latest sessions by theme under a small budget');}

{const a=require('assert/strict'),agents=require('../agents.js'),models=require('../models.js'),path=require('path');const found=agents.detect({env:{PATH:'',LOCALAPPDATA:'L:\\x'},platform:'win32',exists:f=>f===path.join('L:\\x','agy','bin','agy.exe')});a.equal(found.antigravity.installed,true,'found before PATH refreshes');a.equal(found.claude.installed,false);
a.deepEqual(models.args({},'antigravity','default'),[],'default model adds no flag');a.ok(models.catalog({}).antigravity.length);console.log('PASS Antigravity is detected and starts without a forced model');}
