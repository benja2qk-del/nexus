'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {WorkScanner,BackgroundWorkScanner,createRoots,absolute,toolPaths}=require('../work-folders');
const {Themes}=require('../themes');
fs.mkdirSync('.local',{recursive:true});
const fixture=fs.mkdtempSync(path.resolve('.local/themes-full-')),home=path.join(fixture,'owner');
const launch=path.join(home,'Projects','Launch'),work=path.join(home,'Projects','Work');
for(const p of [home,launch,work])fs.mkdirSync(path.join(p,'.git'),{recursive:true});
const groupOf=p=>path.relative(home,p).split(path.sep).filter(n=>n!=='Projects')[0]||'Home';
const roots=createRoots({home,groupOf,temp:path.join(fixture,'temp')});
const edit=(id,file=path.join(work,'code.js'),extra={})=>({type:'assistant',cwd:launch,message:{content:[{type:'tool_use',id,name:'Edit',input:{file_path:file,...extra}}]}});
const row=r=>JSON.stringify(r)+'\n';
const write=(id,rows,cwd=launch)=>{const file=path.join(fixture,id+'.jsonl');fs.writeFileSync(file,rows.map(row).join(''));return {id,kind:'claude',file,cwd};};

async function main(){
  const winHome='C:\\Users\\fixture',repo=winHome+'\\Desktop\\Project';
  for(const p of ['C:\\=== STARTED','C:\\bad"name.txt','C:\\a:b','C:\\a|b','C:\\a<b','C:\\a>b','C:\\a?b','C:\\a*b','https://example.test/a','ftp://example.test/a','file:///C:/repo','C:\\'+ 'a'.repeat(260)]){
    assert.equal(absolute(p,repo,winHome),'',p);
    assert.deepEqual(toolPaths('Read',{file_path:p},repo,winHome),[],p);
  }
  assert.deepEqual(toolPaths('Read',{file_path:'C:\\'},repo,winHome),[]);
  assert.equal(absolute('C:\\Project With Spaces\\ok.js',repo,winHome),'C:\\Project With Spaces\\ok.js');
  const wr=createRoots({home:winHome});
  for(const p of ['C:\\',winHome,...['Desktop','Documents','Downloads','OneDrive','Projects','dev','repos','source','AppData\\Roaming\\Claude\\scratch-workspaces\\task'].map(n=>winHome+'\\'+n)])assert.ok(wr.generic(p),p);
  const ar=createRoots({home:winHome,aliases:{Projects:'Owned Project'}});assert.equal(ar.generic(winHome+'\\Projects'),false);assert.ok(ar.generic(winHome));
  const containerRoots=createRoots({home:winHome,groupOf:p=>require('../work-folders').nexusGroup(p,winHome),aliases:{Projects:'Owned Project'}});
  assert.equal(containerRoots.root(winHome+'\\Projects',winHome,true),winHome+'\\Projects','an aliased container remains a launch root even without .git');
  const containerTheme=new Themes({file:path.join(fixture,'container.json'),roots:containerRoots,config:{aliases:{Projects:'Owned Project'}},readOnly:true});
  const containerSession={id:'container',kind:'claude',cwd:winHome+'\\Projects'};containerTheme.decorate([containerSession]);assert.equal(containerSession.theme.name,'Owned Project');assert.equal(containerSession.theme.source,'launch-folder');
  const named=createRoots({home,groupOf,aliases:{Projects:'Owned Project'}});
  assert.equal(named.generic(path.join(home,'Projects')),false,'an explicit container alias overrides generic grouping');

  const service=new Themes({file:path.join(fixture,'themes.json'),roots,readOnly:true});
  const noWork=write('no-work',[]),zeroWork=write('zero-work',[edit('home',path.join(home,'note.txt')),edit('download',path.join(home,'Downloads','note.txt'))]);
  const generic=write('generic',[edit('home',path.join(home,'note.txt'))],home);
  service.decorate([noWork,zeroWork,generic]);
  for(const s of [noWork,zeroWork]){assert.equal(s.theme.source,'launch-folder');assert.equal(s.theme.name,'Launch');assert.deepEqual(s.workFolders,[]);}
  assert.equal(generic.theme.source,'unsorted');assert.deepEqual(generic.workFolders,[]);
  const aliasedRoots=createRoots({home,groupOf,aliases:{Launch:'BEACON'}}),aliased=new Themes({file:path.join(fixture,'alias.json'),roots:aliasedRoots,config:{aliases:{Launch:'BEACON'}},readOnly:true});
  aliased.decorate([noWork]);assert.equal(noWork.theme.name,'BEACON');
  const zero=new WorkScanner({roots});zero.session(noWork);zero.cache.get(noWork.file).roots.set(work,{path:work,projectRoot:work,weight:0,explicitWeight:0});assert.deepEqual(zero.session(noWork).workFolders,[]);

  // Generate >30 MB at runtime: edits live in the middle, beyond both old windows.
  const large=write('large',[]),fd=fs.openSync(large.file,'w'),padding=row({type:'user',message:{content:'x'.repeat(16*1024)}});
  try{
    for(let i=0;i<1000;i++)fs.writeSync(fd,padding);
    for(let i=0;i<6000;i++)fs.writeSync(fd,row(edit('edit-'+i)));
    fs.writeSync(fd,row(edit('edit-0'))); // An old ID still deduplicates past 4096 calls.
    fs.writeSync(fd,row(edit('large-record',path.join(work,'large.js'),{new_string:'z'.repeat(1024*1024)})));
    fs.writeSync(fd,row({type:'assistant',message:{content:Array.from({length:150},(_,i)=>({type:'tool_use',id:'batch-'+i,name:'Edit',input:{file_path:path.join(work,'batch.js')}}))}}));
    for(let i=0;i<1000;i++)fs.writeSync(fd,padding);
  }finally{fs.closeSync(fd);}
  const size=fs.statSync(large.file).size;assert.ok(size>30*1024*1024);
  const cacheFile=path.join(fixture,'state','work-folders-cache.json');let updates=0;
  const scanner=new WorkScanner({roots,initialBytes:0,chunkBytes:2*1024*1024,cacheFile,onUpdate:()=>updates++});
  const initial=scanner.session(large);assert.equal(initial.mainFolder,launch);assert.equal(initial.workFoldersPartial,true);assert.equal(scanner.bytesRead,0);
  // Checkpoint during a partial scan, and restart without rescanning its prefix.
  while(scanner.bytesRead<2*1024*1024)await new Promise(r=>setTimeout(r,5));
  clearTimeout(scanner.timer);scanner.timer=null;scanner.pending.clear();await scanner.idle();
  const checkpoint=JSON.parse(fs.readFileSync(cacheFile));const saved=checkpoint.files[0][1];assert.ok(saved.offset>0&&saved.offset<size);
  const resumed=new WorkScanner({roots,initialBytes:0,cacheFile,onUpdate:()=>updates++});resumed.session(large);
  let heartbeats=0;const heartbeat=setInterval(()=>heartbeats++,1);await resumed.idle();clearInterval(heartbeat);
  const final=resumed.session(large);assert.equal(final.mainFolder,work);assert.equal(final.workFoldersPartial,false);assert.equal(final.workFolders[0].weight,(6000+1+150)*3);
  assert.equal(resumed.bytesRead,size-saved.offset,'restart reads only uncommitted bytes');assert.ok(heartbeats>2&&updates>2,'the event loop runs between chunks');
  assert.ok(fs.statSync(cacheFile).size<512*1024,'cache stores aggregates and hashed IDs, never transcript bodies');
  const warm=new WorkScanner({roots,cacheFile,initialBytes:0});assert.deepEqual(warm.session(large),final);assert.equal(warm.bytesRead,0);

  // Persist an incomplete multibyte record at its preceding newline boundary.
  const append=Buffer.from(row(edit('utf8',path.join(work,'caf\u00e9.js')))),split=append.indexOf(Buffer.from('\u00e9'))+1;
  fs.appendFileSync(large.file,append.subarray(0,split));warm.session(large);await warm.idle();assert.equal(warm.session(large).workFoldersPartial,true);
  const splitRestart=new WorkScanner({roots,cacheFile,initialBytes:0});fs.appendFileSync(large.file,append.subarray(split));splitRestart.session(large);await splitRestart.idle();
  assert.ok(splitRestart.session(large).touchedFiles.includes('caf\u00e9.js'));assert.equal(splitRestart.session(large).workFolders[0].weight,(6000+1+150+1)*3);assert.equal(splitRestart.bytesRead,append.length);
  const before=fs.readFileSync(cacheFile),readOnly=new WorkScanner({roots,cacheFile,readOnly:true,initialBytes:0});readOnly.session(noWork);await readOnly.idle();assert.deepEqual(fs.readFileSync(cacheFile),before);
  const absent=path.join(fixture,'readonly','work-folders-cache.json'),ro=new WorkScanner({roots,cacheFile:absent,readOnly:true});ro.session(zeroWork);await ro.idle();assert.equal(fs.existsSync(absent),false);

  // All continuation files contribute; discovery no longer stops after 8 hops.
  const chain=Array.from({length:12},(_,i)=>write('chain-'+i,[edit('chain-'+i),...(i<11?[{type:'continued-in',continuedInSessionId:'chain-'+(i+1)}]:[])]));
  const discovered=require('../transcript-tail').continuation(chain[0].file);assert.equal(discovered.files.length,12);assert.equal(discovered.file,chain.at(-1).file);
  const chainScanner=new WorkScanner({roots,initialBytes:0}),session={...chain.at(-1),chainFiles:discovered.files};chainScanner.session(session);await chainScanner.idle();assert.equal(chainScanner.session(session).workFolders[0].weight,36);
  const chainBytes=chainScanner.bytesRead;assert.equal(chainScanner.session({...session,cwd:work}).workFolders[0].weight,36);assert.equal(chainScanner.bytesRead,chainBytes,'shared ancestors use their recorded cwd without restarting the scan for each child launch');
  const background=new BackgroundWorkScanner({roots,rootOptions:{home},readOnly:true});
  try{
    assert.equal(background.session(large).mainFolder,launch);let beats=0;
    for(let i=0;i<2000;i++){
      await new Promise(r=>setTimeout(r,5));beats++;
      if(background.results.get(large.file)?.partial===false)break;
      assert.equal(background.status().error,undefined);
    }
    const refined=background.session(large);assert.equal(refined.workFoldersPartial,false);assert.equal(refined.mainFolder,work);assert.equal(refined.workFolders[0].weight,(6000+1+150+1)*3);
    assert.ok(beats>2);assert.equal(background.status().bytesRead,fs.statSync(large.file).size);
  }finally{await background.close();}
  console.log('PASS full work scans: generic/alias fallback, invalid paths, 30 MB middle evidence, large records, uncapped calls/IDs, yielding, checkpoints/restart/UTF-8, read-only cache, 12-file continuation, worker refinement');
  // Only remove the generated large fixture; preserve compact diagnostics locally.
  fs.unlinkSync(large.file);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
