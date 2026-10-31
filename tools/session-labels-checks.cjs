// Session labels: the cheapest installed agent writes a few words about each finished latest exchange. Stub agents only.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{EventEmitter}=require('events'),{PassThrough}=require('stream');
const {createLabeler,providers,clean,WORKDIR}=require('../session-labels');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-labels-')),wait=ms=>new Promise(r=>setTimeout(r,ms));
// Each stub agent answers like its CLI: Claude prints a JSON wrapper, Codex JSON lines, Copilot plain text.
function stubs(behaviour){
  const calls=[];
  const spawnProcess=(file,args,options)=>{
    const p=new EventEmitter(),kind=file;p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{};
    let input='';p.stdin.on('data',b=>input+=b);
    p.stdin.on('finish',()=>{calls.push({kind,args,input,cwd:options.cwd});const out=behaviour[kind]?.(input);setImmediate(()=>{if(out==null){p.emit('close',1);return;}p.stdout.write(out);p.stdout.end();p.emit('close',0);});});
    return p;
  };
  return {calls,spawnProcess,launch:(kind,args)=>({file:kind,args})};
}
const all=[{kind:'claude',model:'haiku'},{kind:'astra',model:'gpt-6-luna'},{kind:'copilot',model:'claude-haiku-5.5'}];
const old=Date.now()-60e3,session=(id,over={})=>({kind:'claude',id,title:'beacon demo dev',lastPrompt:'i have the playtester outdated can you put latest beacon full version into the playtester all unlocked please',lastText:'You\'ve hit your weekly limit',status:'idle',updated:old,...over});
(async()=>{try{
  assert.deepEqual(providers({claude:{installed:true},astra:{installed:true},copilot:{installed:true}},{astra:[{id:'gpt-6.1-sol'},{id:'gpt-6-luna'},{id:'gpt-5.6-luna'}],copilot:[{id:'claude-sonnet-5.5'},{id:'claude-haiku-5.5'},{id:'claude-haiku-4.5'}]}),all,'Claude Haiku, then the newest Luna, then Copilot\'s newest Haiku');
  assert.deepEqual(providers({copilot:{installed:true}},{copilot:[]}),[{kind:'copilot',model:'claude-haiku-4.5'}],'a Copilot-only PC labels with Haiku through Copilot');
  assert.equal(clean('Label: "playtester kit update."\nmore'),'Playtester kit update');
  assert.equal(clean('This reply is far too long to be a label for a session card in the list at all'),'','long replies are not labels');

  let s=stubs({claude:()=>JSON.stringify({result:'"Playtester kit update."'})});
  let l=createLabeler({file:path.join(root,'a.json'),available:()=>all,...s,gap:0});
  assert.equal(l.get(session('a')),'','no label until it has been written');await wait(30);
  assert.equal(l.get(session('a')),'Playtester kit update');
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].kind,'claude');assert.ok(s.calls[0].args.includes('--no-session-persistence')&&s.calls[0].args.includes('haiku'));
  assert.ok(s.calls[0].input.includes('playtester outdated')&&s.calls[0].args.at(-1).startsWith('You label'),'the exchange goes on stdin, the instruction in the system prompt');
  assert.equal(l.get(session('a')),'Playtester kit update');await wait(30);assert.equal(s.calls.length,1,'a label is written once per exchange');
  assert.equal(l.get(session('a',{lastPrompt:'This message is to inform you that the demo has been published'})),'','a new exchange waits for its own label');await wait(30);
  assert.equal(s.calls.length,2);
  for(const over of [{status:'busy'},{updated:Date.now()-2000},{updated:Date.now()-8*864e5}]){l.get(session('b',over));}await wait(30);
  assert.equal(s.calls.length,2,'working, just-finished and week-old sessions are left alone');

  // Claude at its limit: Codex Luna writes it, and Claude rests instead of failing on every label.
  s=stubs({claude:()=>null,astra:()=>[JSON.stringify({type:'thread.started'}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Demo published on the store'}})].join('\n')});
  l=createLabeler({file:path.join(root,'b.json'),available:()=>all,...s,gap:0});
  l.get(session('c'));l.get(session('d',{lastPrompt:'what follows on the game developing steps?'}));await wait(60);
  assert.equal(l.get(session('c')),'Demo published on the store');
  assert.deepEqual(s.calls.map(c=>c.kind),['claude','astra','astra'],'one failed Claude run sets Claude aside');
  assert.ok(s.calls[1].args.includes('--ephemeral')&&s.calls[1].args.includes('gpt-6-luna')&&s.calls[1].input.startsWith('You label'),'Codex gets the instruction on stdin and keeps nothing');

  // Copilot keeps its sessions, so label runs start in the folder discovery skips.
  s=stubs({copilot:()=>'Next game development steps\n'});
  l=createLabeler({file:path.join(root,'c.json'),available:()=>[all[2]],...s,gap:0});l.get(session('e'));await wait(30);
  assert.equal(l.get(session('e')),'Next game development steps');assert.equal(s.calls[0].cwd,WORKDIR);assert.ok(s.calls[0].args.includes('claude-haiku-5.5'));
  const copilotRoot=path.join(root,'copilot');
  for(const [id,cwd] of [['label-run',WORKDIR],['owner-run',path.join(root,'project')]]){const d=path.join(copilotRoot,'session-state',id);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'workspace.yaml'),'id: '+id+'\ncwd: '+cwd+'\n');fs.writeFileSync(path.join(d,'events.jsonl'),JSON.stringify({type:'user.message',data:{content:'Label this'},timestamp:new Date().toISOString()})+'\n');}
  assert.deepEqual(require('../copilot').createDiscovery()(copilotRoot,7).map(x=>x.id),['owner-run'],'Copilot label runs stay out of the session list');
  await wait(1100);
  const reopened=createLabeler({file:path.join(root,'c.json'),enabled:false,available:()=>{throw Error('no runs');}});
  assert.equal(reopened.get(session('e')),'Next game development steps','labels survive a restart');

  s=stubs({claude:()=>{throw Error('never');}});l=createLabeler({file:path.join(root,'d.json'),enabled:false,available:()=>all,...s});l.get(session('f'));await wait(30);
  assert.equal(s.calls.length,0,'a test server never runs a model');

  // A newer CLI that dropped an off switch: the flag is left out and the request runs again, once per flag.
  const agents=require('../agents');
  assert.equal(agents.unsupported('copilot','error: --no-remote was removed. Use /remote off in a session'),true);
  assert.equal(agents.unsupported('copilot','error: --no-remote was removed.'),false,'a flag is dropped once');
  assert.equal(agents.unsupported('copilot',"error: unexpected argument '--no-foo-bar' found"),true);
  assert.equal(agents.unsupported('copilot',"error: unknown option '--disable-thing'"),true);
  assert.equal(agents.unsupported('copilot',"error: unknown option '--available-tools'"),false,'a flag that limits tools is never dropped');
  assert.equal(agents.unsupported('copilot','You have exceeded your monthly quota'),false);
  const dropped=new Set(),runs=[];
  const retrying={spawnProcess:(file,args)=>{const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};runs.push(args);
      c.stdin.on('finish',()=>setImmediate(()=>{if(args.includes('--no-remote')){c.stderr.write('error: --no-remote was removed.');c.emit('close',1);}else{c.stdout.end('Kit update');c.emit('close',0);}}));c.stdin.resume();return c;},
    launch:(kind,args)=>({file:kind,args:args.filter(a=>!dropped.has(a))}),unsupported:(kind,e)=>{const m=/(--no-[\w-]+) was removed/.exec(e);if(!m||dropped.has(m[1]))return false;dropped.add(m[1]);return true;}};
  assert.equal(await require('../session-labels').run({kind:'copilot',model:'claude-haiku-4.5'},'You label','text',retrying),'Kit update');
  assert.deepEqual(runs.map(a=>a.includes('--no-remote')),[true,false],'the second run leaves the removed flag out');
  console.log('session label checks passed');
}catch(e){console.error(e);process.exitCode=1;}finally{fs.rmSync(root,{recursive:true,force:true});}})();
