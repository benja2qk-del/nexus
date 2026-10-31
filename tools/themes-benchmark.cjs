'use strict';
// Real transcripts are read-only. Only an isolated local NEXUS state is writable.
const fs=require('fs'),path=require('path'),{spawn,execFileSync}=require('child_process');
async function main(){
  const label=process.argv[2]||'after',days=Number(process.argv[3])||30,root=fs.mkdtempSync(path.resolve('.local/themes-benchmark-'));
  fs.writeFileSync(path.join(root,'config.json'),'{}');
  let args=['server.js'];
  if(label.startsWith('before')){const source=path.join(root,'baseline.cjs');fs.writeFileSync(source,execFileSync('git',['show','e953864:server.js'],{windowsHide:true,maxBuffer:1024*1024}));args=['-e',`const M=require('module'),p=require('path'),m=new M(p.resolve('server.js'));m.filename=p.resolve('server.js');m.paths=M._nodeModulePaths(process.cwd());m._compile(require('fs').readFileSync(process.argv[1],'utf8'),m.filename);`,source];}
  const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NEXUS_PORT:'4790',NEXUS_READ_ONLY:'1',NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_CONFIG_FILE:path.join(root,'config.json'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json')}});
  let error='';child.stderr.on('data',d=>error+=d);
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout '+error)),15000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+' '+error));});child.stdout.on('data',d=>{if(String(d).includes('4790/')){clearTimeout(timer);resolve();}});});
    const samples=[];let counts={},bytes=0;
    for(let i=0;i<13;i++){const start=performance.now(),res=await fetch('http://127.0.0.1:4790/api/sessions?days='+days),body=await res.text();if(!res.ok)throw Error(body);const data=JSON.parse(body);samples.push(Math.round((performance.now()-start)*100)/100);counts={};for(const s of data.sessions)counts[s.kind]=(counts[s.kind]||0)+1;bytes=Buffer.byteLength(body);await new Promise(r=>setTimeout(r,150));}
    const sorted=samples.slice(3).sort((a,b)=>a-b),report={label,days,counts,coldMs:samples[0],warmMedianMs:sorted[Math.floor(sorted.length/2)],warmP90Ms:sorted[Math.ceil(sorted.length*.9)-1],responseBytes:bytes,samples};
    fs.writeFileSync(path.resolve('.local/themes-'+label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
