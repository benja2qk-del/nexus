import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve(process.argv[2]);
function inventory(root){
  const records=[],keyframes=[];
  function walk(dir){
    for(const file of fs.readdirSync(dir,{withFileTypes:true})){
      const full=path.join(dir,file.name);
      if(file.isDirectory()){if(!['node_modules','.next','.git'].includes(file.name))walk(full);continue;}
      if(!/\.(css|tsx?|jsx?)$/.test(file.name))continue;
      const source=fs.readFileSync(full,'utf8'),relative=path.relative(root,full).replaceAll('\\','/');
      for(const match of source.matchAll(/@keyframes\s+([\w-]+)/g)){
        const start=source.indexOf('{',match.index);let end=start+1,depth=1;
        for(;end<source.length&&depth;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
        keyframes.push({file:relative,name:match[1],line:source.slice(0,match.index).split('\n').length,definition:source.slice(match.index,end)});
      }
      source.split('\n').forEach((text,index)=>{if(/animation|transition|animate-|duration-|ease-|\.animate\(|requestAnimationFrame/i.test(text))records.push({file:relative,line:index+1,text:text.trim()});});
    }
  }
  walk(root);return{keyframes,records};
}
function transient(dir){
  if(!fs.existsSync(dir))return;
  for(const file of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,file.name);
    if(file.isDirectory())transient(full);
    else if(file.name.endsWith('.json')){
      const record=JSON.parse(fs.readFileSync(full,'utf8'));
      if(record.animations)runtime[path.relative(out,full).replaceAll('\\','/')]=record.animations;
    }
  }
}
const reference=inventory(process.env.NEXUS_V0_SRC),nexus=inventory(path.resolve('public'));
const runtime={};
for(const phase of ['before','after'])for(const kind of ['reference','nexus'])for(const width of ['1568','440']){
  const dir=path.join(out,phase,kind,width);if(!fs.existsSync(dir))continue;
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){
    const record=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
    if(record.animations)runtime[[phase,kind,width,file].join('/')]=record.animations;
  }
}
transient(path.join(out,'motion'));
fs.writeFileSync(path.join(out,'motion-inventory.json'),JSON.stringify({reference,nexus,runtime},null,2));
console.log(JSON.stringify({referenceKeyframes:reference.keyframes.length,nexusKeyframes:nexus.keyframes.length,referenceMotionLines:reference.records.length,nexusMotionLines:nexus.records.length,runtimeStates:Object.keys(runtime).length}));
