'use strict';
// Read-only real discovery. Never reuse an existing listener or write owner state.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),net=require('net'),crypto=require('crypto'),{spawn}=require('child_process');
const port=4791,base='http://127.0.0.1:'+port;
function duplicateCheck(group){
  return {count:group.length,distinctSessionKeys:new Set(group.map(s=>s.kind+':'+s.id)).size,members:group.map(s=>({kind:s.kind,theme:s.theme.name,source:s.theme.source,aliasCount:s.aliases?.length||0}))};
}
async function main(){
  await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
  fs.mkdirSync('.local',{recursive:true});const root=fs.mkdtempSync(path.resolve('.local/themes-real-'));
  const configFile=path.resolve('config.json');
  // Refuse to replace a local config. The only main-checkout file read is this copy.
  fs.copyFileSync(path.resolve('..','Nexus Deck','config.json'),configFile,fs.constants.COPYFILE_EXCL);
  const child=spawn(process.execPath,['--require','./tools/themes-readonly-preload.cjs','server.js'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NEXUS_PORT:String(port),NEXUS_READ_ONLY:'1',NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_THEME_PROBE_ROOT:root,NEXUS_CONFIG_FILE:configFile,NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_THEMES_FILE:path.join(root,'themes.json'),NEXUS_UPLOAD_DIR:path.join(root,'uploads')}});
  let error='';child.stderr.on('data',d=>error+=d);
  try{
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Startup timeout '+error)),15000);child.once('error',reject);child.once('exit',c=>{clearTimeout(t);reject(Error('Server exited '+c+' '+error));});child.stdout.on('data',d=>{if(String(d).includes(port+'/')){clearTimeout(t);resolve();}});});
    const samples=[],duringScan=[];let sessions,firstScan,firstScanMs;
    const request=async()=>{const start=performance.now(),r=await fetch(base+'/api/sessions');assert.equal(r.status,200);sessions=(await r.json()).sessions;return Number((performance.now()-start).toFixed(2));};
    const scanStart=performance.now();samples.push(await request());
    for(let i=0;i<1200;i++){
      const response=await fetch(base+'/api/themes');assert.equal(response.status,200);const c=await response.json();
      if(!c.workScan.pending){firstScan=c.workScan;firstScanMs=Number((performance.now()-scanStart).toFixed(2));break;}
      await new Promise(r=>setTimeout(r,50));duringScan.push(await request());
    }
    assert.ok(firstScan,'the complete first scan must finish');
    for(let i=0;i<12;i++){samples.push(await request());await new Promise(r=>setTimeout(r,150));}
    const r=await fetch(base+'/api/themes');assert.equal(r.status,200);const catalog=await r.json();
    const keys=sessions.map(s=>s.kind+':'+s.id),unsorted=new Set(catalog.unsorted.map(s=>s.key));assert.equal(new Set(keys).size,keys.length,'one row per session');assert.equal(unsorted.size,catalog.unsorted.length);
    for(const s of sessions)assert.equal(unsorted.has(s.kind+':'+s.id),!s.theme.id,'a session belongs to exactly one bucket');
    assert.equal(catalog.counts.total,keys.length);assert.equal(catalog.themes.reduce((n,t)=>n+t.count,0)+unsorted.size,keys.length);
    const titleGroups=new Map();for(const s of sessions){const hash=crypto.createHash('sha256').update(s.title||'').digest('hex').slice(0,12);if(!titleGroups.has(hash))titleGroups.set(hash,[]);titleGroups.get(hash).push(s);}
    const sorted=samples.slice(3).sort((a,b)=>a-b),report={counts:catalog.counts,themes:catalog.themes.map(t=>({name:t.name,count:t.count,color:t.color})),coldMs:samples[0],warmMedianMs:sorted[5],warmP90Ms:sorted[8],warmMaxMs:sorted.at(-1),samples,firstScan,firstScanMs,duringScan,
      duplicateTitles:[...titleGroups.values()].filter(g=>g.length>1).map(duplicateCheck),
      assignments:sessions.map(s=>({kind:s.kind,title:s.title,theme:s.theme.name,source:s.theme.source,launch:s.cwd,main:s.mainFolder,workFolders:s.workFolders}))};
    fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({counts:report.counts,themes:report.themes,coldMs:report.coldMs,warmMedianMs:report.warmMedianMs,warmP90Ms:report.warmP90Ms,warmMaxMs:report.warmMaxMs,firstScan,firstScanMs,duplicateTitles:report.duplicateTitles},null,2));
    assert.equal(fs.existsSync(path.join(root,'work-folders-cache.json')),false,'read-only scanning stays in memory');
    if(process.argv.includes('--check')){
      assert.ok(report.warmMaxMs<60,'warm /api/sessions must stay below 60 ms');
      const roots=require('../work-folders').createRoots({aliases:JSON.parse(fs.readFileSync(configFile)).aliases});
      assert.ok(sessions.every(s=>s.workFolders.every(f=>f.weight>0&&!roots.generic(f.path))),'no generic or zero-weight work folders');
      assert.ok(sessions.filter(s=>!s.theme.id).every(s=>roots.generic(s.cwd)),'only generic launch folders remain unsorted');
      for(const [folder,theme] of [['Steam One Shot','BEACON'],['Lumen','Atlas Lens']]){
        const rows=sessions.filter(s=>path.basename(s.cwd||'').toLowerCase()===folder.toLowerCase());
        assert.ok(rows.filter(s=>s.theme.name===theme).length>=(folder==='Steam One Shot'?3:2),'the regression sessions use their project aliases');
        assert.ok(rows.filter(s=>s.theme.source==='launch-folder').every(s=>s.theme.name===theme),'launch aliases must survive absent/generic evidence');
      }
      assert.ok(catalog.themes.every(t=>!/^([a-z]:?|\.(claude|codex|copilot|local)|appdata|temp|tmp|node_modules|\.git)$/i.test(t.name)),'no drive, letter, or tooling themes');
    }
  }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.unlinkSync(configFile);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
