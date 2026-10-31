'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {absolute,identity,createRoots,toolPaths,WorkScanner}=require('../work-folders');
const {Themes,prettify,PALETTE,PALETTE_OKLCH}=require('../themes');
const winHome='C:\\Users\\me',winRepo=winHome+'\\Desktop\\proj';
for(const value of ['/c/Users/me/Desktop/proj','/mnt/c/Users/me/Desktop/proj','C:/Users/me/Desktop/proj','"C:\\Users\\me\\Desktop\\proj"',"'/c/Users/me/Desktop/proj'",'~/Desktop/proj','$HOME/Desktop/proj','${HOME}/Desktop/proj','%USERPROFILE%/Desktop/proj','$env:USERPROFILE\\Desktop\\proj']){
  assert.equal(absolute(value,winHome,winHome),winRepo,value);
  assert.equal(identity(absolute(value,winHome,winHome)),identity(winRepo.toLowerCase()));
}
assert.equal(identity('/c/Users/ME/Desktop/PROJ'),identity(winRepo));
assert.equal(absolute('../proj/src/main.js',winRepo+'\\sibling',winHome),winRepo+'\\proj\\src\\main.js');
assert.equal(absolute('src/main.js','/mnt/c/Users/me/Desktop/proj',winHome),winRepo+'\\src\\main.js');
assert.equal(absolute('$UNKNOWN/file.js',winRepo,winHome),'');assert.equal(absolute('C:relative.js',winRepo,winHome),'');
for(const command of ['cd "/c/Users/me/Desktop/proj" && cat src/main.js','cd /mnt/c/Users/me/Desktop/proj && cat ./src/main.js','Set-Location "C:\\Users\\me\\Desktop\\proj"; Get-Content -Path "src/main.js"','Push-Location -LiteralPath "$env:USERPROFILE\\Desktop\\proj"; Get-Content -LiteralPath ./src/main.js']){
  const hits=toolPaths('exec_command',{cmd:command,workdir:winHome},winHome,winHome);assert.ok(hits.some(p=>p.path===winRepo+'\\src\\main.js'),command);assert.ok(hits.every(p=>!p.path.startsWith('C:\\c\\')));
}
assert.equal(toolPaths('PowerShell',{command:'Get-Content -Path "$HOME/Desktop/proj/LICENSE"'},winHome,winHome)[0].path,winRepo+'\\LICENSE');
const patch=toolPaths('apply_patch','*** Update File: /c/Users/me/Desktop/proj/src/a.js\n*** Add File: "C:/Users/me/Desktop/proj/src/b.js"\n*** Move to: ./src/c.js',winRepo,winHome);
assert.equal(patch.length,3);assert.ok(patch.every(h=>h.weight===3&&h.path.startsWith(winRepo)));
assert.equal(toolPaths('apply_patch','*** Update File: /c/Users/me/Desktop/proj/src/a.js\r\n',winRepo,winHome)[0].path,winRepo+'\\src\\a.js');
assert.deepEqual(toolPaths('exec_command',{cmd:'Get-Date',workdir:winRepo},winHome,winHome).map(h=>({weight:h.weight,explicit:h.explicit,directory:h.directory})),[{weight:.25,explicit:false,directory:true}]);
assert.equal(toolPaths('exec_command',{cmd:'pwd',workdir:'Desktop/proj'},winHome,winHome)[0].path,winRepo,'relative workdir resolved once');

fs.mkdirSync('.local',{recursive:true});const fixture=fs.mkdtempSync(path.resolve('.local/themes-fixes-')),home=path.join(fixture,'owner'),projects=path.join(home,'Projects');
fs.mkdirSync(path.join(home,'.git'),{recursive:true});
const repo=(...parts)=>{const p=path.join(projects,...parts);fs.mkdirSync(path.join(p,'.git'),{recursive:true});return p;};
const main=repo('Steam One Shot','steam-one-shot'),other=repo('Other'),ray=repo('Lumen');
const trees=['beacon-astra','beacon-claude','beacon-kimi2'].map((n,i)=>{
  const p=path.join(projects,n),admin=path.join(main,'.git','worktrees',n);fs.mkdirSync(p);fs.mkdirSync(admin,{recursive:true});fs.writeFileSync(path.join(admin,'commondir'),'../..\n');fs.writeFileSync(path.join(p,'.git'),'gitdir: '+(i===1?path.relative(p,admin):admin.replaceAll('\\','/'))+'\n');return p;
});
const groupOf=p=>{const rel=path.relative(home,p).split(path.sep).filter(Boolean);if(rel[0]==='Projects')rel.shift();return rel[0]||'Home';};
const stateDir=path.join(projects,'nexus-state'),roots=createRoots({home,groupOf,temp:path.join(fixture,'temp'),stateDir}),scanner=new WorkScanner({roots});
for(const tree of trees){assert.equal(roots.root(path.join(tree,'src','file.js')),main);assert.equal(roots.locate(path.join(tree,'src','file.js')).path,tree);}
const readFile=fs.readFileSync;try{fs.readFileSync=()=>{throw Error('Cached worktree metadata must not be reread');};assert.equal(roots.root(path.join(trees[0],'elsewhere','next.js')),main);}finally{fs.readFileSync=readFile;}
const invalidRoots=createRoots({home:winHome,groupOf:p=>path.win32.parse(p).root===p?'Home':p.split('\\')[1]});assert.equal(invalidRoots.root('C:\\c\\src\\main.js'),'');assert.equal(invalidRoots.generic('C:\\d'),true);assert.equal(invalidRoots.generic('C:\\'),true);
const ignored=['~/.claude/memory.md','~/.codex/skills/a.md','~/.copilot/state.json','~/.local/data.json','%TEMP%/file.txt','$env:TEMP/file.txt',path.join(home,'AppData','Roaming','a.json'),path.join(home,'AppData','Local','a.json'),path.join(home,'AppData','Temp','a.txt'),path.join(main,'node_modules','lib','index.js'),path.join(main,'.git','config'),path.join(stateDir,'state.json')];
for(const p of ignored){const full=absolute(p,home,home);assert.equal(roots.tooling(full),true,p);assert.equal(roots.root(p,home),'',p);}
let serial=0;
const records=(kind,rows,cwd=other)=>{const id='fix-'+(++serial),file=path.join(fixture,id+'.jsonl');fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');return {kind,id,file,cwd,title:'Repeated title',aliases:[kind+':'+id]};};
const edit=(p,id)=>({type:'assistant',cwd:home,message:{content:[{type:'tool_use',id,name:'Edit',input:{file_path:p}}]}});
const command=(cmd,workdir,id)=>({type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:id,arguments:JSON.stringify({cmd,workdir})}});
const calls=trees.map((tree,i)=>edit(path.join(tree,'file'+i+'.js'),'t'+i));calls.push(edit(path.join(other,'one.js'),'o1'),edit(path.join(other,'two.js'),'o2'));
const worked=records('claude',calls);const evidence=scanner.session(worked);assert.equal(evidence.projectRoot,main,'combined worktree weight beats the other repository');assert.equal(evidence.mainFolder,main);assert.ok(evidence.workFolders.some(f=>trees.includes(f.path)));
const toolOnly=records('claude',ignored.map((p,i)=>edit(p,'ignore'+i)));const toolEvidence=scanner.session(toolOnly);assert.deepEqual(toolEvidence.workFolders,[]);assert.deepEqual(toolEvidence.touchedFiles,[]);assert.equal(toolEvidence.hasWork,false);
const mixed=records('claude',[...ignored.map((p,i)=>edit(p,'ignore'+i)),edit(path.join(ray,'real.js'),'real')]);assert.deepEqual(scanner.session(mixed).touchedFiles,['real.js']);assert.equal(scanner.session(mixed).projectRoot,ray);
const weak=records('astra',[command('Get-Date',other,'date'),command('pwd',other,'pwd')],main),generic=records('astra',[command('pwd',main,'pwd')],home);
assert.equal(scanner.session(weak).source,'launch-folder');assert.equal(scanner.session(weak).projectRoot,main);assert.deepEqual(scanner.session(weak).workFolders,[{path:other,weight:.5}]);
const file=path.join(fixture,'themes.json'),config={aliases:{'Steam One Shot':'BEACON','ledger-agent':'Ledger Agent',Lumen:'Atlas Lens',Projects:'Wrong container alias'}};
let service=new Themes({file,config,roots,scanner});const ledger=records('claude',[edit(path.join(repo('ledger-agent'),'src','a.js'),'ledger')]);
service.decorate([worked,mixed,weak,generic,toolOnly,ledger]);assert.equal(worked.theme.name,'BEACON');assert.equal(weak.theme.name,'BEACON');assert.equal(weak.theme.source,'launch-folder');assert.equal(generic.theme.source,'unsorted');assert.equal(toolOnly.theme.source,'launch-folder');assert.equal(toolOnly.theme.name,'Other');assert.equal(mixed.theme.name,'Atlas Lens');assert.equal(ledger.theme.name,'Ledger Agent');
assert.deepEqual(['Lumen','NEXUS','ledger-agent','alpha-repo','Gods Eye'].map(prettify),['Lumen','NEXUS','Ledger Agent','Alpha Repo','Gods Eye']);
const noAlias=new Themes({file:path.join(fixture,'no-alias.json'),roots,readOnly:true});noAlias.decorate([mixed]);assert.equal(mixed.theme.name,'Lumen');
// Ten colors, deterministic collision handling, restart stability and owner precedence.
assert.equal(new Set(PALETTE).size,10);assert.ok(PALETTE_OKLCH.every(([l,c,h])=>l>=.78&&l<=.84&&c>=.09&&c<=.13&&![78,158,22].some(status=>Math.min(Math.abs(h-status),360-Math.abs(h-status))<20)));
const many=Array.from({length:10},(_,i)=>records('claude',[edit(path.join(repo('Color-'+i),'file.js'),'c'+i)]));
const make=(name,rows)=>{const t=new Themes({file:path.join(fixture,name+'.json'),roots});t.decorate(rows);return t;};
const a=make('colors',many),first=Object.fromEntries(a.catalog().themes.map(t=>[t.id,t.color])),b=make('reverse',many.slice().reverse());assert.deepEqual(Object.fromEntries(b.catalog().themes.map(t=>[t.id,t.color])),first);assert.equal(new Set(Object.values(first)).size,10);
const chosen=a.catalog().themes[0];a.change({op:'color',id:chosen.id,color:'#123456'});const restarted=new Themes({file:a.file,roots});restarted.decorate(many);assert.equal(restarted.find(chosen.id).color,'#123456');for(const t of restarted.catalog().themes)if(t.id!==chosen.id)assert.equal(t.color,first[t.id]);
const extra=records('claude',[edit(path.join(repo('Color-extra'),'file.js'),'extra')]);restarted.decorate([...many,extra]);for(const t of restarted.catalog().themes)if(first[t.id]&&t.id!==chosen.id)assert.equal(t.color,first[t.id]);
// Equal titles are not identities: the same session is deduped, distinct runs survive.
const rows=[worked,{...worked},generic];service.decorate(rows);assert.equal(rows.length,2);assert.equal(service.catalog().counts.total,2);assert.equal(service.catalog().counts.sorted,1);assert.equal(service.catalog().counts.unsorted,1);assert.equal(service.catalog().unsorted[0].key,'astra:'+generic.id);
console.log('PASS theme regressions: shell paths, worktrees/cache, tooling exclusion, weak cwd, aliases/casing, ten stable colors/owner overrides, identity-only membership');
