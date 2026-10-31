'use strict';
// A work PC: a work OneDrive ("OneDrive - Acme Corp") beside the company folder ("Acme Corp") that holds synced
// SharePoint and Teams libraries, with a projects folder of numbered projects, one of them a category of agents.
// Neither OneDrive nor the company folder, a library or a folder that sorts projects is ever a theme, also after
// updating from a NEXUS that made such themes; a numbered project is one.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {createRoots,nexusGroup,WorkScanner}=require('../work-folders');
const {Themes}=require('../themes');
const {rundown,createSorter}=require('../theme-sorter');
fs.mkdirSync('.local',{recursive:true});const fixture=fs.mkdtempSync(path.resolve('.local/company-folder-')),home=path.join(fixture,'me');
fs.mkdirSync(path.join(home,'.git'),{recursive:true});
const OD=path.join(home,'OneDrive - Acme Corp'),company=path.join(home,'Acme Corp'),library=path.join(company,'Media Team - Documents');
const projects=path.join(library,'00. General','02. Projects'),agents=path.join(projects,'10. Agents'),hub=path.join(agents,'Agents Hub'),pricing=path.join(agents,'Pricing Agent');
const region=path.join(projects,'21. Region Review'),study=path.join(projects,'06_Store Study'),work=path.join(home,'Work');
const files={[path.join(pricing,'AGENTS.md')]:'',[path.join(region,'summary.xlsx')]:'',[path.join(work,'Clients','Client A','package.json')]:'{}',[path.join(work,'Clients','Client B','CLAUDE.md')]:'',
  [path.join(work,'Tools','readme.txt')]:'',[path.join(work,'Tools','Exporter','.vscode','settings.json')]:'{}',[path.join(work,'Tools','Importer','pyproject.toml')]:''};
for(const d of [OD,path.join(hub,'.github'),study,path.join(home,'Other Corp'),path.join(work,'02. Survey'),path.join(home,'Side Projects')])fs.mkdirSync(d,{recursive:true});
for(const [f,text] of Object.entries(files)){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text);}
const roots=createRoots({home,temp:path.join(fixture,'tmp'),groupOf:p=>nexusGroup(p,home)});
try{
  for(const p of [OD,company,library,path.join(library,'00. General'),projects,agents,path.join(work,'Clients'),path.join(home,'Side Projects')])assert.ok(roots.generic(p),'holds projects: '+path.relative(home,p));
  for(const p of [hub,pricing,region,study,path.join(hub,'Survey Chile'),path.join(home,'Other Corp'),path.join(work,'02. Survey'),path.join(work,'Tools'),work])assert.ok(!roots.generic(p),'a project: '+path.relative(home,p));

  let n=0;
  const session=(cwd,files,prompt)=>{
    const id='s'+(++n),file=path.join(fixture,id+'.jsonl');for(const f of files){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'x');}
    fs.writeFileSync(file,[{type:'user',cwd,message:{content:prompt}},{type:'assistant',cwd,message:{content:files.map((f,i)=>({type:'tool_use',id:id+i,name:'Write',input:{file_path:f}}))}}].map(r=>JSON.stringify(r)).join('\n')+'\n');
    return {kind:'claude',id,file,cwd,title:prompt,firstPrompt:prompt,touchedFiles:[]};
  };
  const rows=()=>{n=0;return [
    session(home,[path.join(hub,'Survey Chile','analysis.py')],'Analyze the Chile survey'),
    session(projects,[path.join(pricing,'rules.md')],'Tighten the pricing rules'),
    session(hub,[],'Explain DAX measures'),
    session(OD,[],'Summarize this workbook'),
    session(hub,[],'Plan the library cleanup'),
    session(path.join(hub,'Survey Chile'),[path.join(hub,'Survey Chile','charts.py')],'Chart the survey'),
    session(region,[path.join(region,'summary.xlsx')],'Update the region summary'),
    session(study,[],'Outline the store study'),
  ];};
  // Saved by an older NEXUS: themes for the whole OneDrive, the company folder and the agents category, kept alive
  // by sessions now outside the list, a session the first light-model sorter filed into the OneDrive theme, and one
  // company theme the owner renamed.
  const file=path.join(fixture,'themes.json'),old=(id,name,folder)=>({id,name,color:'#7aa2f7',pinned:false,archived:false,mainFolder:folder});
  fs.writeFileSync(file,JSON.stringify({version:1,themes:[old('auto-onedrive','OneDrive - Acme Corp',OD),old('auto-company','Acme Corp',company),old('auto-renamed','Acme work',company),old('auto-library','Media Team - Documents',library),old('auto-agents','10. Agents',agents)],
    assignments:{'claude:s4':{themeId:'auto-onedrive',by:'nexus',at:1},'claude:s5':{themeId:'auto-library',by:'owner',at:1}},parents:{},folders:{},
    inherited:{'claude:old1':{id:'auto-onedrive',name:'OneDrive - Acme Corp',source:'work-folder'},'claude:old2':{id:'auto-company',name:'Acme Corp',source:'work-folder'},'claude:old3':{id:'auto-agents',name:'10. Agents',source:'work-folder'}}}));
  const themes=new Themes({file,roots,scanner:new WorkScanner({roots})});
  let list=rows();themes.decorate(list);
  assert.deepEqual(list.map(s=>s.theme.name),['Agents Hub','Pricing Agent','Agents Hub','Unsorted','Media Team - Documents','Agents Hub','21. Region Review','06 Store Study'],
    'each project in the projects folder is a theme, numbered or not; an agent keeps the work started in its subfolders');
  assert.deepEqual(themes.forgotten,['claude:s4'],'a session the sorter had put in the OneDrive theme is read again');
  assert.ok(!JSON.parse(fs.readFileSync(file,'utf8')).assignments['claude:s4'],'and its old pick is dropped');
  const names=themes.catalog().themes.map(t=>t.name).sort();
  assert.deepEqual(names,['06 Store Study','21. Region Review','Acme work','Agents Hub','Media Team - Documents','Pricing Agent'],'old OneDrive, company and category themes are gone; renamed or owner-used ones stay');
  assert.ok(!themes.choices().some(t=>/onedrive|^acme corp$|agents$/i.test(t.name)),'the light model is never offered them');
  assert.equal(themes.place([{key:'claude:s4',name:'OneDrive - Acme Corp'}]),0,'nor can it bring one back by name');
  const text=rundown(themes.choices(),themes.unplaced,home,roots.generic);
  assert.ok(/1\. started in ~ \(holds many projects\) \| worked in ~\\Acme Corp\\.*\\Agents Hub \|/.test(text),'the rundown marks general start folders and names the real project folder');
  assert.ok(/2\. started in ~\\Acme Corp\\.*\\02\. Projects \(holds many projects\) \| worked in ~\\Acme Corp\\.*\\Pricing Agent \|/.test(text),'the projects folder is marked');
  assert.ok(/3\. started in ~\\Acme Corp\\.*\\Agents Hub \| title/.test(text),'a project start folder is not marked');
  assert.ok(/\d\. started in ~\\Acme Corp\\.*\\21\. Region Review \| title/.test(text),'nor is a numbered project');

  // The sorter asks a forgotten session again.
  const calls=[];const sorter=createSorter({file:path.join(fixture,'picks.json'),available:()=>[{kind:'claude',model:'haiku'}],themes:()=>[],place:()=>{},wait:0,
    spawnProcess:(f,a)=>{const {EventEmitter}=require('events'),{PassThrough}=require('stream'),p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{};
      p.stdin.on('finish',()=>{calls.push(1);setImmediate(()=>{p.stdout.end(JSON.stringify({result:'{"1":"Weekly Sales"}'}));p.emit('close',0);});});p.stdin.resume();return p;},launch:(k,a)=>({file:k,args:a})});
  const s4=list[3];sorter.offer([s4]);await_(()=>calls.length===1,()=>{sorter.offer([s4]);setTimeout(()=>{assert.equal(calls.length,1,'answered once');sorter.forget(['claude:s4']);sorter.offer([s4]);
    await_(()=>calls.length===2,()=>{finish();console.log('PASS company folder themes: each project in a projects folder is a theme, numbered or not; OneDrive, company, library and folders that sort projects never are; old ones retire and their sessions are read again');});},50);});
}catch(e){finish();throw e;}
function await_(test,then,started=Date.now()){if(test())return then();if(Date.now()-started>3000){finish();throw Error('timed out');}setTimeout(()=>await_(test,then,started),10);}
function finish(){fs.rmSync(fixture,{recursive:true,force:true});}
