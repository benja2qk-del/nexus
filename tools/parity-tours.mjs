// Run the existing tours with only their port/output paths relocated.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve(process.argv[2],'tours');fs.mkdirSync(out,{recursive:true});
const suites=[['redesign-tour.mjs','phase4'],['redesign-round2-tour.mjs','1568'],['redesign-round2-tour.mjs','390'],['review-tour.mjs','after'],['call-tour.mjs','1568'],['call-tour.mjs','440'],['live-tour.mjs','1568'],['live-tour.mjs','440'],['live-tour.mjs','440','--edges']];
for(const [file,...args] of suites.slice(Number(process.argv[3]||0))){
  const temporary=path.resolve('tools','.parity-'+file);
  let source=fs.readFileSync(path.join('tools',file),'utf8').replaceAll('4791','4786').replace(/(['"])docs\/shots\/([^'"\n]+)\1/g,(_,q,suffix)=>JSON.stringify(path.join(out,suffix)));
  source=source.replace("require('../config.json')",JSON.stringify({remoteHost:'nexus.fixture.test',remoteUser:'owner@example.test'}));
  source=source.replace("path.resolve('.local','live-shots'",'path.resolve('+JSON.stringify(path.join(out,'live-shots')));
  fs.writeFileSync(temporary,source);
  let log='';
  try{
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[temporary,...args],{env:{...process.env,NEXUS_FIXTURE_PORT:'4786'},windowsHide:true,stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',d=>{log+=d;process.stdout.write(d);});child.stderr.on('data',d=>{log+=d;process.stderr.write(d);});child.once('error',reject);child.once('exit',resolve);
    });
    fs.writeFileSync(path.join(out,file+'-'+args.join('-')+'.log'),log);
    if(code)throw Error('Existing tour failed: '+file+' '+args.join(' '));
  }finally{fs.unlinkSync(temporary);}
}
