'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os'),{createRequire}=require('node:module');
const models=require('../models'),design=require('../public/redesign-core'),config={models:{claude:['claude-haiku-5-5'],astra:['gpt-6-astra']}};
async function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-model-check-'));
 const fixtures={claude:[{type:'assistant',message:{model:'claude-opus-5-5'}},{type:'user',message:{model:'wrong'}},{type:'assistant',message:{model:'claude-haiku-5-5'}},{type:'assistant',message:{model:'<synthetic>'}}],astra:[{type:'turn_context',payload:{model:'gpt-6-astra'}},{type:'event_msg',payload:{model:'wrong'}},{type:'turn_context',payload:{model:'gpt-6-luna'}}]};
 for(const [kind,records]of Object.entries(fixtures)){const file=path.join(temp,kind+'.jsonl');fs.writeFileSync(file,records.map(JSON.stringify).join('\n'));assert.equal(models.latest(kind,fs.readFileSync(file,'utf8').split('\n').map(JSON.parse)),kind==='claude'?'claude-haiku-5-5':'gpt-6-luna');}
 assert.deepEqual(models.args(config,'claude','claude-haiku-5-5'),['--model','claude-haiku-5-5']);assert.deepEqual(models.args(config,'astra','gpt-6-astra'),['-m','gpt-6-astra']);assert.throws(()=>models.validate(config,'claude','bogus'));assert.throws(()=>models.command('haiku\r/model opus'));assert.equal(design.modelLabel('claude-haiku-5-5'),'Haiku 5.5');
 assert.equal(models.confirmed('\x1b[2J\x1b[HSet\x1b[1Cmodel\x1b[1Cto\x1b[1CHaiku\x1b[1C5.5','claude-haiku-5-5'),true);
 assert.equal(models.confirmed('Set model to Haiku 5.5\n/model claude-haiku-5-5\nThinking...','claude-haiku-5-5'),false,'old acknowledgements must not confirm a new command');
 assert.equal(models.latest('claude',[...fixtures.claude,{type:'assistant',isSidechain:true,message:{model:'claude-opus-5-5'}}]),'claude-haiku-5-5','sidechain assistants must not replace the session model');
 const commands=[{label:'Deploy dashboard',hint:'BEACON',group:'Sessions'},{label:'New session',group:'Actions'}];assert.deepEqual(design.filterCommands(commands,'  BEA deploy '),[commands[0]]);assert.equal(design.filterCommands(commands,'missing').length,0);assert.equal(design.filterCommands(commands,'').length,2);
 const writes=[],ptys=[],mod={exports:{}},requireLocal=createRequire(path.resolve('terms.js'));
 const onboarding='Make auto mode your default permission mode?\n\n   ❯ Yes, set auto mode as my default permission mode\n     No, keep manual mode';const conversation=require('../public/conversation');assert.equal(conversation.pendingPrompt(onboarding).options.length,2);assert.equal(conversation.inputReady(onboarding,{seenInput:true}),false);
 const stub={spawn(){const p={pid:123,write(d){writes.push(d);if(d==='\r'&&p.confirm)p.paint('Set model to Haiku 5.5 (claude-haiku-5-5)\n❯ \n? for shortcuts');},onData(fn){p.data=fn},onExit(fn){p.exit=fn},kill(){},resize(){},paint(s){p.data('\x1b[2J\x1b[H'+s.replace(/\n/g,'\r\n'));}};ptys.push(p);return p;}};
 vm.runInNewContext(fs.readFileSync('terms.js','utf8'),{module:mod,require:name=>name==='@lydell/node-pty'?stub:name==='./agents'?{launch:(kind,args)=>({file:kind,args})}:requireLocal(name),process:{env:{}},setTimeout,clearTimeout,Buffer,console});
 const terms=mod.exports,t=terms.open({kind:'claude',title:'Model fixture',cwd:temp}),p=ptys[0];
 p.paint('Do you want to proceed?\n❯ 1. Yes\n  2. No\nEnter to confirm · Esc to cancel');await assert.rejects(terms.changeModel(t.id,'claude-haiku-5-5'),/question/);assert.equal(writes.length,0);
 p.paint('Thinking...\nEsc to interrupt');await assert.rejects(terms.changeModel(t.id,'claude-haiku-5-5'),/working/);assert.equal(writes.length,0);
 p.paint('❯ \n? for shortcuts');p.confirm=true;const result=await terms.changeModel(t.id,'claude-haiku-5-5');assert.equal(result.confirmed,true);assert.deepEqual(writes,['\x1b[200~/model claude-haiku-5-5\x1b[201~','\r']);assert.equal(terms.list()[0].model,'claude-haiku-5-5');
 p.confirm=false;p.paint('❯ \n? for shortcuts');await assert.rejects(terms.changeModel(t.id,'claude-sonnet-5-5',{timeout:100}),/did not confirm/);assert.equal(terms.list()[0].model,'claude-haiku-5-5');
 const c=terms.open({kind:'astra',title:'Codex fixture',cwd:temp});await assert.rejects(terms.changeModel(c.id,'gpt-6-astra'),/next resume/);
 p.paint('❯ \n? for shortcuts');const original=p.write;p.write=d=>{writes.push(d);if(d.startsWith('\x1b[200~'))p.paint('Do you want to proceed?\n❯ 1. Yes\n  2. No\nEnter to confirm · Esc to cancel');};const before=writes.length;await assert.rejects(terms.changeModel(t.id,'claude-haiku-5-5'),/changed before Enter/);assert.equal(writes.length,before+1);p.write=original;
 console.log('PASS latest Claude/Codex model fixtures, configured arguments, injection refusal, palette words, model readiness/question/race guards, acknowledged change and no false confirmation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
