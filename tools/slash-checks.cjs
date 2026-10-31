'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const commands=require('../slash-commands'),core=commands.core,receipts=require('../slash-receipts'),conversation=require('../public/conversation');
const root=fs.mkdtempSync(path.resolve('.local/slash-unit-')),sleep=ms=>new Promise(r=>setTimeout(r,ms));
function file(name,text){const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);return f;}
async function main(){
 for(const [kind,catalog]of Object.entries(commands.catalogs)){if(kind==='antigravity')continue;
  assert(catalog.commands.length>35);assert.equal(new Set(catalog.commands.map(c=>c.name)).size,catalog.commands.length,kind+' duplicates');
  for(const c of catalog.commands){assert(/^[\w][\w:.-]*$/.test(c.name));assert(c.description&&typeof c.argsHint==='string'&&c.handling);assert(['instant','menu','args','destructive','session-ending'].includes(c.kind));assert(['built-in','custom','skill','plugin'].includes(c.source));}
  assert.equal(catalog.commands.find(c=>c.name==='model').native,'model');
 }
 for(const text of ['hello /help','/',' /help','C:/file','//server/share'])assert.equal(core.parse(text),null);
 assert.deepEqual(core.parse('/prompts:fix FOCUS="a b"'),{name:'prompts:fix',args:'FOCUS="a b"',text:'/prompts:fix FOCUS="a b"'});
 assert.equal(core.parse('/plugin:skill a\nb').args,'a\nb');
 for(const name of ['clear','reset','new','logout','exit','quit','archive','delete','rewind','undo','restart','reset-allowed-tools'])assert(core.risk(core.parse('/'+name)));
 assert(core.risk(core.parse('/session delete example')));assert(!core.risk(core.parse('/help')));
 assert.equal(core.handling({native:'model'},core.parse('/model')),'native:model');assert.equal(core.handling({native:'model'},core.parse('/model opus')),'terminal');
 assert(core.filter(commands.catalogs.claude.commands,'/comp').every(c=>c.name.startsWith('comp')));assert.equal(core.filter([], '/compact hi').length,0);
 const roots={home:root,claude:path.join(root,'personal-claude'),astra:path.join(root,'personal-astra'),copilot:path.join(root,'personal-copilot')};
 const cwd=path.join(root,'project');file('project/.git','fixture');
 file('personal-claude/commands/test.md','---\ndescription: Personal test\nargument-hint: <file>\n---\n!`must-never-run`');
 file('project/.claude/commands/test.md','---\ndescription: Project test\n---\nbody');
 file('project/.claude/commands/team/deploy.md','---\ndescription: Deploy preview\n---\nbody');
 file('project/.claude/skills/hidden/SKILL.md','---\nname: hidden\nuser-invocable: false\n---\nbody');
 file('project/.claude/skills/inspect/SKILL.md','---\nname: inspect\ndescription: >\n  Inspect files\n  carefully\n---\nbody');
 file('personal-astra/prompts/fix.md','---\ndescription: Fix a file\nargument-hint: FILE=<path>\n---\nbody');
 file('project/.agents/skills/check/SKILL.md','---\nname: check\ndescription: Check files\n---\nbody');
 file('project/.github/skills/release/SKILL.md','---\nname: release\ndescription: Review release\n---\nbody');
 file('project/.github/agents/reviewer.agent.md','---\nname: reviewer\ndescription: Review changes\n---\nbody');
 const plugin=path.join(root,'plugin');file('plugin/commands/audit.md','---\ndescription: Audit code\n---\nbody');
 file('personal-claude/plugins/installed_plugins.json',JSON.stringify({plugins:{'demo@market':[{installPath:plugin,scope:'project',projectPath:cwd}]}}));
 let data=await commands.discover('claude',cwd,{roots});
 assert.equal(data.commands.find(c=>c.name==='test').description,'Project test');assert(data.commands.some(c=>c.name==='team:deploy'));assert(!data.commands.some(c=>c.name==='hidden'));assert.equal(data.commands.find(c=>c.name==='inspect').description,'Inspect files carefully');assert.equal(data.commands.find(c=>c.name==='demo:audit').source,'plugin');
 file('project/.claude/commands/later.md','---\ndescription: Added later\n---\nbody');assert.equal(await commands.discover('claude',cwd,{roots}),data,'cached by folder and agent');
 data=await commands.discover('claude',cwd,{roots,ttl:0});assert(data.commands.some(c=>c.name==='later'));
 data=await commands.discover('astra',cwd,{roots});assert(data.commands.some(c=>c.name==='prompts:fix'));assert(data.skills.some(c=>c.invocation==='$check'));assert(!data.commands.some(c=>c.name==='check'));
 data=await commands.discover('copilot',cwd,{roots});assert(data.commands.some(c=>c.name==='release'));assert(data.agents.some(c=>c.invocation==='/agent reviewer'));
 const at=Date.now(),ts=new Date(at).toISOString(),record=core.claudeRecord({type:'user',uuid:'one',timestamp:ts,message:{content:'<command-name>/compact</command-name><command-args>focus on tests</command-args>'}})[0];
 assert.equal(record.t,'cmd');assert.equal(record.text,'/compact focus on tests');
 const output=core.claudeRecord({type:'user',timestamp:ts,message:{content:[{type:'text',text:'<local-command-stdout>Compacted context</local-command-stdout>'}]}})[0];assert.equal(output.t,'cmd-output');
 assert.equal(core.claudeRecord({type:'system',subtype:'local_command',timestamp:ts,content:'<command-name>/context</command-name><command-args></command-args>'})[0].text,'/context');
 assert.equal(core.claudeRecord({type:'system',subtype:'local_command',timestamp:ts,content:'<local-command-stdout>Context usage</local-command-stdout>'})[0].text,'Context usage');
 const r={id:'one',text:'/compact focus on tests',submittedAt:at,before:'❯ \n? for shortcuts',revision:0};
 assert.equal(core.transcriptReceipt(r,[{...record,ts:new Date(at-100).toISOString()}]),null);assert.equal(core.transcriptReceipt(r,[record,output]).output,'Compacted context');
 const evidence={screen:'❯ /help\n? for shortcuts',settled:true,changed:true,ready:true};assert.equal(core.screenReceipt({...r,text:'/help'},evidence),null,'echo is not a receipt');
 assert.equal(core.screenReceipt({...r,text:'/help'},{...evidence,screen:'Unknown command: /help\n❯\n? for shortcuts'}).status,'rejected','errors containing command text survive echo filtering');
 assert.equal(core.screenReceipt({...r,text:'/context'},{...evidence,screen:'❯ /context\nContext usage: 2%\n❯\n? for shortcuts'}).status,'acknowledged','past command echoes do not hide actual output above the new input');
 assert.equal(core.screenReceipt({...r,text:'/exit'},{screen:'',exited:{code:0},changed:true}).status,'acknowledged');
 assert.equal(core.screenReceipt({...r,text:'/help'},{screen:'',exited:{code:0},changed:true}),null,'unrelated exit is not success');
 for(const screen of ['Help\n↑/↓ scroll · esc close','Theme\n❯ dark\n  light\nEnter to select · Esc to cancel','❯ Search models…\nSelect model\nEnter to select']){assert(conversation.inputMenu(screen));assert(!conversation.inputReady(screen,{seenInput:true}));}
 assert(conversation.inputMenu('Help General Commands Custom commands\nShortcuts\n! for shell mode'));
 assert(!conversation.inputReady('A clipped menu without any current input',{seenInput:true}));
 assert(conversation.inputReady('OpenAI Codex (v0.153.4)\n› Ask Codex to do anything\n gpt-5.4 default · folder'));
 const t={display:{},lastOut:0,outputRevision:1,commandReceipts:[{...r,text:'/help',kind:'menu'}]};
 assert.equal(receipts.update(t,'Help\n↑/↓ scroll · esc close')[0].status,'menu');assert.equal(receipts.update(t,'❯\n? for shortcuts')[0].status,'closed');
 const resized={kind:'astra',seenInput:true,display:{},lastOut:0,outputRevision:2,commandReceipts:[{...r,text:'/permissions',kind:'menu',status:'menu'}]};
 assert.equal(receipts.update(resized,'› Ask Codex to do anything\n gpt-6-luna default · folder')[0].status,'closed','menu closure uses the same established-input guard after resize');
 const repeated={display:{},lastOut:0,outputRevision:0};
 const earlier=receipts.begin(repeated,'/context','earlier',{kind:'instant'},'❯\n? for shortcuts');
 receipts.begin(repeated,'/env','later',{kind:'instant'},'❯\n? for shortcuts');repeated.outputRevision++;
 assert.equal(receipts.update(repeated,'Environment output\n❯\n? for shortcuts')[0].status,'uncertain','later output cannot acknowledge an unchanged earlier command');
 assert.equal(core.transcriptReceipt(earlier,[{t:'user',text:'/context',ts:new Date(earlier.supersededAt+1).toISOString()}]),null,'later identical transcript belongs to a later attempt');
 console.log('PASS per-agent catalogs, aliases, parse/filter, native routing, cached project/custom/skill/plugin discovery, transcript and terminal receipts');
 const writes=[],ptys=[],requireTerms=createRequire(path.resolve('terms.js')),mod={exports:{}};
 const stub={spawn(){const p={pid:123,write:d=>writes.push(d),onData:fn=>p.data=fn,onExit:fn=>p.exit=fn,kill(){},resize(){}};ptys.push(p);return p;}};
 vm.runInNewContext(fs.readFileSync('terms.js','utf8'),{module:mod,require:n=>n==='@lydell/node-pty'?stub:n==='./agents'?{launch:(kind,args)=>({file:kind,args})}:requireTerms(n),process:{env:{}},setTimeout,clearTimeout,Buffer,console});
 for(const kind of ['claude','astra','copilot']){
  const terms=mod.exports,term=terms.open({kind,cwd:root,title:'Command fixture'}),p=ptys.at(-1),paint=s=>p.data('\x1b[2J\x1b[H'+s.replace(/\n/g,'\r\n'));
  paint('────────────────\n❯\n────────────────\n? for shortcuts');await sleep(610);
  const count=writes.length;await assert.rejects(terms.send(term.id,'/logout',{commandId:kind+'-logout'}),/Confirm/);assert.equal(writes.length,count,'unconfirmed command writes nothing');
  paint('Help\n↑/↓ scroll · esc close');await assert.rejects(terms.send(term.id,'/help'),/menu/);assert.equal(writes.length,count);
  paint('Do you trust this folder?\n❯ 1. Yes\n  2. No\nEnter to confirm · Esc to cancel');await assert.rejects(terms.send(term.id,'/help'),/question/);assert.equal(writes.length,count);
  paint('────────────────\n❯\n────────────────\n? for shortcuts');await sleep(610);
  p.write=d=>{writes.push(d);if(d==='\r')paint('Local command output\n────────────────\n❯\n────────────────\n? for shortcuts');};
  const result=await terms.send(term.id,'/status',{commandId:kind+'-status'});assert.equal(result.command.status,'submitted');assert.deepEqual(writes.slice(-2),['\x1b[200~/status\x1b[201~','\r']);await sleep(610);assert.equal(terms.state(term.id).commands.at(-1).status,'acknowledged');
  const sent=writes.length;await terms.send(term.id,'/status',{commandId:kind+'-status'});assert.equal(writes.length,sent,'same request ID cannot run twice');
  paint('────────────────\n❯\n────────────────\n? for shortcuts');await sleep(610);p.write=d=>{writes.push(d);if(d==='\r')p.exit({exitCode:0});};
  await terms.send(term.id,'/exit',{commandId:kind+'-exit',commandConfirmation:'/exit'});assert.equal(terms.state(term.id).commands.at(-1).status,'acknowledged');
 }
 console.log('PASS exact PTY delivery for all agents, numbered/menu guards, confirmation Cancel boundary, idempotent receipts and intentional exits');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
