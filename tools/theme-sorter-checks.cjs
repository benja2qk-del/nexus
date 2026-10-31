'use strict';
// Theme sorting: sessions outside a repository are filed by a light model reading a rundown of each; repositories keep
// their folder's theme and the owner's moves win. Stub agents only.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),{EventEmitter}=require('events'),{PassThrough}=require('stream');
const {createRoots,nexusGroup,WorkScanner}=require('../work-folders');
const {Themes}=require('../themes');
const {createSorter,rundown,parse}=require('../theme-sorter');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function stubs(behaviour){
  const calls=[];
  const spawnProcess=(file,args,options)=>{
    const p=new EventEmitter(),kind=file;p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{};
    let input='';p.stdin.on('data',b=>input+=b);
    p.stdin.on('finish',()=>{calls.push({kind,args,input});const out=behaviour[kind]?.(input);setImmediate(()=>{if(out==null){p.emit('close',1);return;}p.stdout.write(out);p.stdout.end();p.emit('close',0);});});
    return p;
  };
  return {calls,spawnProcess,launch:(kind,args)=>({file:kind,args})};
}
fs.mkdirSync('.local',{recursive:true});const fixture=fs.mkdtempSync(path.resolve('.local/theme-sorter-')),home=path.join(fixture,'me');
fs.mkdirSync(path.join(home,'.git'),{recursive:true});
(async()=>{try{
  assert.deepEqual(parse('Sure: {"1":"Survey Chile","2":"","3":"Unsorted"}',3),['Survey Chile','',''],'names, blanks and "Unsorted" as none');
  assert.equal(parse('no idea',2),null);

  // A company library: two projects started from the same agent folder, and one repository.
  const bo=path.join(home,'Acme','Media - Documents','General','10. Agents','Agents Hub'),repo=path.join(home,'Desktop','tool');
  fs.mkdirSync(path.join(repo,'.git'),{recursive:true});
  let n=0;const session=(cwd,files,prompt)=>{
    const id='s'+(++n),file=path.join(fixture,id+'.jsonl');for(const f of files){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'x');}
    fs.writeFileSync(file,[{type:'user',cwd,message:{content:prompt}},{type:'assistant',cwd,message:{content:files.map((f,i)=>({type:'tool_use',id:id+i,name:'Write',input:{file_path:f}}))}}].map(r=>JSON.stringify(r)).join('\n')+'\n');
    return {kind:'claude',id,file,cwd,title:prompt,firstPrompt:prompt,touchedFiles:[]};
  };
  const rows=()=>[session(bo,[path.join(bo,'Survey Chile','analysis.py')],'Analyze the Chile survey results'),session(bo,[],'Fix the route planner export'),session(repo,[path.join(repo,'main.js')],'Add a CLI flag')];
  const roots=createRoots({home,temp:path.join(fixture,'tmp'),groupOf:p=>nexusGroup(p,home)});
  const themes=new Themes({file:path.join(fixture,'themes.json'),roots,scanner:new WorkScanner({roots})});
  let list=rows();themes.decorate(list);
  assert.deepEqual(list.map(s=>s.theme.name),['Agents Hub','Agents Hub','Tool'],'until it is read, a session sits in the folder it was started in');
  assert.deepEqual(themes.unplaced.map(s=>s.id),['s1','s2'],'only sessions outside a repository are offered to the model');
  assert.deepEqual(themes.choices().map(t=>t.name).sort(),['Agents Hub','Tool'],'the model may keep a session in the folder theme it was started in');
  const text=rundown(themes.choices(),themes.unplaced,home);
  assert.ok(text.includes('- Agents Hub (folder ~')&&text.includes('1. started in ~')&&text.includes('first ask Analyze the Chile survey results'),'the rundown names themes, folders and asks');

  assert.equal(themes.place([{key:'claude:s1',name:'Survey Chile'},{key:'claude:s2',name:'Route Planner'},{key:'claude:s3',name:'Survey Chile'}]),3);
  n=0;list=rows();themes.decorate(list);
  assert.deepEqual(list.map(s=>[s.theme.name,s.theme.source]),[['Survey Chile','nexus'],['Route Planner','nexus'],['Tool','work-folder']],'picks apply outside repositories only');
  assert.equal(themes.unplaced.length,0);
  assert.deepEqual(themes.choices().map(t=>t.name).sort(),['Route Planner','Survey Chile','Tool'],'themes the model named are offered next time; the emptied folder theme is not');
  let catalog=themes.catalog().themes;
  assert.ok(!catalog.some(t=>t.name==='Agents Hub'),'the folder guess no session holds any more is left out');
  assert.equal(catalog.find(t=>t.name==='Survey Chile').mainFolder,bo,'a new theme opens new sessions where its sessions were started');
  themes.place([{key:'claude:s2',name:'survey chile'}]);n=0;list=rows();themes.decorate(list);
  assert.equal(list[1].theme.name,'Survey Chile','an existing theme is matched by name, whatever the case');
  themes.assign(['claude:s1'],catalog.find(t=>t.name==='Route Planner').id);themes.place([{key:'claude:s1',name:'Survey Chile'}]);n=0;list=rows();themes.decorate(list);
  assert.deepEqual([list[0].theme.name,list[0].theme.source],['Route Planner','owner'],'the owner\'s move wins over the model');

  // The sorter: one request for a batch, cheapest agent first, each session asked once.
  const claude={kind:'claude',model:'haiku'},astra={kind:'astra',model:'gpt-6-luna'},picks=[];
  let s=stubs({claude:()=>JSON.stringify({result:'{"1":"Survey Chile","2":""}'})});
  const store=path.join(fixture,'picks.json'),offered=[{kind:'claude',id:'a',title:'Survey',firstPrompt:'Analyze the Chile survey results',updated:2},{kind:'claude',id:'b',title:'hi',firstPrompt:'hi',updated:1},{kind:'claude',id:'c',title:'New session',updated:3}];
  let sorter=createSorter({file:store,available:()=>[claude,astra],themes:()=>[{name:'Nexus Deck',mainFolder:'C:\\x'}],place:p=>picks.push(...p),...s,wait:0});
  sorter.offer(offered);await wait(50);
  assert.equal(s.calls.length,1,'one request for the batch');assert.ok(s.calls[0].args.at(-1).startsWith('You sort')&&s.calls[0].input.includes('- Nexus Deck')&&s.calls[0].input.includes('Analyze the Chile survey results'));
  assert.ok(!s.calls[0].input.includes('New session'),'a session with no ask yet waits');
  assert.deepEqual(picks,[{key:'claude:a',name:'Survey Chile'}]);
  sorter.offer(offered);await wait(50);assert.equal(s.calls.length,1,'each session is asked about once');
  sorter=createSorter({file:store,available:()=>[claude,astra],themes:()=>[],place:p=>picks.push(...p),...s,wait:0});
  sorter.offer(offered);await wait(50);assert.equal(s.calls.length,1,'answers are kept across restarts');
  s=stubs({claude:()=>null,astra:()=>JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"1":"Power BI Training"}'}})});
  sorter=createSorter({file:path.join(fixture,'other.json'),available:()=>[claude,astra],place:p=>picks.push(...p),...s,wait:0});
  sorter.offer([{kind:'copilot',id:'d',title:'PBI Training',firstPrompt:'Teach me Power BI measures',updated:1}]);await wait(50);
  assert.deepEqual(s.calls.map(c=>c.kind),['claude','astra'],'a failed agent hands over to the next one');assert.equal(picks.at(-1).name,'Power BI Training');
  console.log('PASS theme sorting: repositories keep their folder, other sessions are read in batches by the lightest agent, the owner wins, emptied folder guesses hidden');
}catch(e){console.error(e);process.exitCode=1;}finally{fs.rmSync(fixture,{recursive:true,force:true});}})();
