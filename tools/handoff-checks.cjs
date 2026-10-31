// Hand-off between agents: off by default, kept in NEXUS's settings file, and added to launches only when on.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {createHandoff,guide,CHAT}=require('../handoff'),core=require('../public/slash-core'),slash=require('../slash-commands'),terms=require('../terms');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-handoff-')),all={claude:{installed:true},astra:{installed:true},copilot:{installed:true}};
(async()=>{try{
  const codexHome=path.join(root,'codex');fs.mkdirSync(codexHome);
  let h=createHandoff({dir:root,installed:()=>all,codexHome});
  const spec={kind:'claude',claudeArgs:['--resume','x']};
  assert.equal(h.enabled(),false,'off for everyone by default');const quiet=h.apply(spec).claudeArgs;assert.deepEqual(quiet,['--resume','x','--dangerously-skip-permissions','--append-system-prompt',CHAT],'while off, only what the chat can show is added');assert.ok(/Markdown/.test(CHAT)&&/Preview/.test(CHAT)&&/\.html/.test(CHAT),'agents learn that tables render and pages preview in the chat');
  assert.equal(h.set(true),true);assert.equal(createHandoff({dir:root,installed:()=>all,codexHome}).enabled(),true,'the choice survives a restart');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'settings.json'),'utf8')),{handoff:true});

  const claude=h.apply(spec).claudeArgs,text=claude.at(-1);
  assert.deepEqual(claude.slice(0,4),['--resume','x','--dangerously-skip-permissions','--append-system-prompt']);
  assert.ok(text.includes('codex exec')&&text.includes('copilot -p')&&!text.includes('claude -p'),'Claude learns how to call the other two, not itself');
  assert.ok(/only when the owner asks/.test(text)&&/worktree/.test(text)&&/never as one long argument/.test(text),'the guide carries the rules that kept delegation safe');
  const themed=h.apply({kind:'claude',claudeArgs:['--append-system-prompt','NEXUS theme X\nKeep it small.']}).claudeArgs;
  assert.equal(themed.filter(a=>a==='--append-system-prompt').length,1,'one system prompt addition, merged with the theme note');assert.ok(themed[1].startsWith('NEXUS theme X')&&themed[1].includes('codex exec'));

  const astra=h.apply({kind:'astra',codexArgs:['resume','id']}).codexArgs;
  assert.deepEqual([astra[0],astra.slice(2)],['-c',['resume','id']],'config override goes before the subcommand');
  const value=astra[1].replace(/^developer_instructions=/,'');assert.ok(JSON.parse(value).includes('claude -p'),'a TOML/JSON string without raw line breaks');assert.ok(!astra[1].includes('\n'));
  fs.writeFileSync(path.join(codexHome,'config.toml'),'model = "x"\ndeveloper_instructions = "mine"\n');
  assert.deepEqual(h.apply({kind:'astra',codexArgs:['resume','id']}).codexArgs,['resume','id'],'a user\'s own Codex developer_instructions is never replaced');

  const copilot=h.apply({kind:'copilot',copilotArgs:[],env:{COPILOT_CUSTOM_INSTRUCTIONS_DIRS:'C:\\theme'}});
  const dirs=copilot.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS.split(',');assert.equal(dirs[0],'C:\\theme','theme folders stay');
  assert.ok(fs.readFileSync(path.join(dirs[1],'AGENTS.md'),'utf8').includes('codex exec'),'Copilot reads the guide from a folder NEXUS owns');

  assert.equal(guide('claude',{claude:{installed:true}}),'','nobody else installed: no guide');
  assert.ok(!guide('claude',{claude:{installed:true},astra:{installed:true}}).includes('copilot -p'),'only installed agents are listed');
  assert.equal(h.set(false),false);assert.deepEqual(h.apply(spec).claudeArgs,quiet,'off again: only the chat guide');
  const offCopilot=h.apply({kind:'copilot',copilotArgs:[]}),guideFile=path.join(offCopilot.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS.split(',').at(-1),'AGENTS.md');assert.equal(fs.readFileSync(guideFile,'utf8'),CHAT+'\n','Copilot gets the chat guide without the hand-off part');
  // Resumed Claude and Copilot sessions skip permission prompts until that is turned off; new sessions and Codex do not.
  assert.equal(h.fullAccess(),true,'on by default');
  assert.deepEqual(h.apply({kind:'copilot',copilotArgs:['--resume','x']}).copilotArgs,['--resume','x','--yolo']);
  assert.ok(!h.apply({kind:'claude',claudeArgs:['--session-id','x']}).claudeArgs.includes('--dangerously-skip-permissions'),'a new session asks as usual');
  assert.ok(!h.apply({kind:'copilot',copilotArgs:[]}).copilotArgs.includes('--yolo'));
  assert.ok(!h.apply({kind:'astra',codexArgs:['resume','x']}).codexArgs.includes('--yolo'));
  assert.equal(h.setFullAccess(false),false);assert.equal(createHandoff({dir:root,installed:()=>all,codexHome}).fullAccess(),false,'turning it off survives a restart');
  assert.ok(!h.apply(spec).claudeArgs.includes('--dangerously-skip-permissions'));assert.deepEqual(h.apply({kind:'copilot',copilotArgs:['--resume','x']}).copilotArgs,['--resume','x']);
  assert.deepEqual(h.resumeArgs('claude'),[]);
  assert.equal(h.setFullAccess(true),true);assert.deepEqual(h.view(),{handoff:false,fullAccess:true});
  assert.equal(typeof terms.setLaunchDecorator,'function');

  // /handoff is NEXUS's own: in every agent's list, and its on/off word never reaches the session.
  const roots={claude:path.join(root,'c'),astra:path.join(root,'a'),copilot:path.join(root,'p'),home:root};
  for(const kind of ['claude','astra','copilot']){const entry=(await slash.discover(kind,root,{roots})).commands.find(c=>c.name==='handoff');assert.ok(entry&&entry.native==='handoff'&&entry.source==='NEXUS',kind+' lists /handoff');}
  const entry={name:'handoff',native:'handoff',source:'NEXUS'};
  for(const text of ['/handoff','/handoff on','/handoff off'])assert.equal(core.handling(entry,core.parse(text)),'native:handoff',text+' stays in NEXUS');
  assert.equal(core.handling({name:'model',native:'model'},core.parse('/model opus')),'terminal','other native commands still pass arguments to the session');
  console.log('PASS hand-off: every launch learns what the chat shows; hand-off off by default, persisted, Claude/Codex/Copilot launch guides, user Codex setting kept, /handoff stays in NEXUS');
}catch(e){console.error(e);process.exitCode=1;}finally{fs.rmSync(root,{recursive:true,force:true});}})();
