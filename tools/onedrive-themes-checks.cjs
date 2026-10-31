'use strict';
// A project inside OneDrive or a synced company library is its own theme: a work OneDrive ("OneDrive - Acme"), the
// Spanish Desktop and Documents OneDrive backs up, and the organizing folders of a SharePoint library hold projects.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {createRoots,nexusGroup,WorkScanner}=require('../work-folders');
const {Themes,prettify}=require('../themes');
assert.equal(nexusGroup('C:\\Users\\me\\OneDrive - Acme Corp\\Escritorio\\gps project\\src','C:\\Users\\me'),'gps project');
assert.equal(nexusGroup('C:\\Users\\me\\OneDrive\\Documentos\\gps project','C:\\Users\\me'),'gps project');
assert.equal(prettify('OneDrive - Acme Corp'),'OneDrive Acme Corp','a dash between words leaves one space');
fs.mkdirSync('.local',{recursive:true});const fixture=fs.mkdtempSync(path.resolve('.local/onedrive-themes-')),home=path.join(fixture,'me');
fs.mkdirSync(path.join(home,'.git'),{recursive:true});
const roots=createRoots({home,temp:path.join(fixture,'tmp'),groupOf:p=>nexusGroup(p,home)});
let n=0;
function session(cwd,files){
  const id='s'+(++n),file=path.join(fixture,id+'.jsonl');
  for(const f of files){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'x');}
  const edits=files.map((f,i)=>({type:'tool_use',id:id+'t'+i,name:'Write',input:{file_path:f}}));
  fs.writeFileSync(file,[{type:'user',cwd,message:{content:'build it'}},{type:'assistant',cwd,message:{content:edits}}].map(r=>JSON.stringify(r)).join('\n')+'\n');
  return {kind:'claude',id,file,cwd,title:id};
}
const bo=path.join(home,'Acme','Media Team - Documents','General','02. Projects','10. Agents','Agents Hub');
const work=path.join(home,'OneDrive - Acme Corp'),gps=path.join(work,'Escritorio','gps project'),notes=path.join(home,'OneDrive','Documentos','notas');
const rows=[
  session(gps,['index.html','src\\app.js','src\\map.js'].map(f=>path.join(gps,f))),
  session(work,[path.join(gps,'README.md'),path.join(gps,'data\\route.json')]),
  session(notes,[path.join(notes,'todo.md')]),
  session(bo,[['Survey Chile','analysis.py'],['Store Visits','deck.md'],['Store Visits','data','sales.csv']].map(f=>path.join(bo,...f))),
  session(bo,[])
];
// A theme saved before NEXUS knew these folder names: the whole work OneDrive as one project.
const file=path.join(fixture,'themes.json');
fs.writeFileSync(file,JSON.stringify({version:1,themes:[{id:'auto-old-onedrive',name:'OneDrive   Acme Corp',color:'#7aa2f7',pinned:false,archived:false,mainFolder:work},{id:'auto-old-kept',name:'Acme work',color:'#7aa2f7',pinned:false,archived:false,mainFolder:work},{id:'auto-old-company',name:'Acme',color:'#7aa2f7',pinned:false,archived:false,mainFolder:path.join(home,'Acme')}],assignments:{},parents:{},folders:{['folder:'+work.toLowerCase()]:'auto-old-onedrive'}}));
const themes=new Themes({file,roots,scanner:new WorkScanner({roots})});themes.decorate(rows);
assert.deepEqual(rows.map(s=>s.theme.name),['Gps Project','Gps Project','Notas','Agents Hub','Agents Hub'],'each project in OneDrive is its own theme, also when started from the OneDrive folder; a library project is the folder the agent started in');
const catalog=themes.catalog().themes;
assert.equal(catalog.find(t=>t.name==='Gps Project').count,2);
assert.ok(!catalog.some(t=>t.id==='auto-old-onedrive'),'the old, now empty OneDrive theme is left out');
assert.ok(catalog.some(t=>t.id==='auto-old-kept'),'a theme the owner renamed stays');
assert.ok(!catalog.some(t=>t.id==='auto-old-company'),'an old empty theme for the folder that holds a project is left out');
fs.rmSync(fixture,{recursive:true,force:true});
console.log('PASS OneDrive and company library projects: work OneDrive, Spanish Escritorio/Documentos and library folders hold projects; old empty holder themes hidden');
