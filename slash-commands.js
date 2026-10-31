'use strict';
// Read metadata only: never evaluate skill bodies, hooks, shell substitutions or plugins.
const fs=require('fs/promises'),path=require('path'),os=require('os');
const core=require('./public/slash-core');
const catalogs={claude:require('./slash/claude'),astra:require('./slash/astra'),copilot:require('./slash/copilot'),antigravity:{version:'',commands:[]}};
const cache=new Map(),TTL=10000,MAX_FILES=600;
async function read(file) { try {const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>256*1024)return '';return await fs.readFile(file,'utf8');}catch{return ''; } }
function metadata(text) {
  const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text),out={};
  if(!match)return out;
  const lines=match[1].split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    const m=/^([\w-]+):\s*(.*)$/.exec(lines[i]);if(!m)continue;
    let value=m[2];
    if(/^[>|][-+]?\s*$/.test(value)){value='';while(i+1<lines.length&&/^\s+/.test(lines[i+1]))value+=' '+lines[++i].trim();}
    out[m[1]]=value.trim().replace(/^(['"])([\s\S]*)\1$/,'$2').replace(/\s+/g,' ').slice(0,240);
  }
  return out;
}
async function walk(dir, predicate, depth=5, budget={left:MAX_FILES}) {
  if(depth<0||budget.left<=0)return [];
  let entries;try{if((await fs.lstat(dir)).isSymbolicLink())return [];entries=await fs.readdir(dir,{withFileTypes:true});}catch{return [];}
  const files=[];
  for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(--budget.left<0)break;if(e.isSymbolicLink())continue;const file=path.join(dir,e.name);if(e.isDirectory())files.push(...await walk(file,predicate,depth-1,budget));else if(e.isFile()&&predicate(e.name))files.push(file);}
  return files;
}
async function scopeFolders(cwd) {
  const folders=[];let dir=path.resolve(cwd||os.homedir());
  for(let i=0;i<20;i++){folders.push(dir);try{await fs.lstat(path.join(dir,'.git'));break;}catch{}const parent=path.dirname(dir);if(parent===dir)break;dir=parent;}
  return folders.reverse();
}
function homes(env=process.env,home=os.homedir()) {return {claude:env.NEXUS_CLAUDE_DIR||env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),astra:env.NEXUS_CODEX_DIR||env.CODEX_HOME||path.join(home,'.codex'),copilot:env.NEXUS_COPILOT_DIR||env.COPILOT_HOME||path.join(home,'.copilot'),home};}
async function discover(kind,cwd,{roots=homes(),now=Date.now(),ttl=TTL}={}) {
  if(!catalogs[kind])throw Error('Unknown agent.');
  const key=JSON.stringify([kind,path.resolve(cwd||roots.home),roots]);
  const cached=cache.get(key);if(cached&&now-cached.at<ttl)return cached.promise;
  const promise=(async()=>{
    const commands=new Map(catalogs[kind].commands.map(c=>[c.name,{...c}])),skills=[],agents=[];
    // NEXUS's own command: it changes a NEXUS setting and never reaches the session.
    commands.set('handoff',{name:'handoff',argsHint:'[on|off]',description:'Let sessions started in NEXUS hand work to other agents',kind:'args',source:'NEXUS',native:'handoff',category:'tools',model:false,handling:'NEXUS changes the setting; nothing reaches the session'});
    const folders=await scopeFolders(cwd||roots.home),budget={left:MAX_FILES};
    async function add(dir,source,format,namespace=''){
      for(const file of await walk(dir,n=>format==='skill'?n==='SKILL.md':/\.md$/i.test(n),format==='prompt'?0:5,budget)){
        const text=await read(file);if(!text)continue;const meta=metadata(text);
        if(meta['user-invocable']==='false'||meta['user-invocable']==='False')continue;
        let name=format==='skill'?meta.name||path.basename(path.dirname(file)):format==='agent'?meta.name||path.basename(file).replace(/(?:\.agent)?\.md$/i,''):path.relative(dir,file).replace(/\.md$/i,'').split(path.sep).join(':');
        if(format==='prompt')name='prompts:'+name;
        if(!/^[\w][\w:.-]{0,140}$/.test(name))continue;
        const description=meta.description||('Run '+name.replace(/[-_:]/g,' ')+'.');
        if(kind==='astra'&&format==='skill'){skills.push({name,description,source,invocation:'$'+name});continue;}
        if(format==='agent'){agents.push({name,description,source,invocation:'/agent '+name});continue;}
        name=namespace+name;
        // Built-ins retain their real meaning; project metadata overrides personal metadata.
        if(['built-in','NEXUS'].includes(commands.get(name)?.source))continue;
        commands.set(name,{name,argsHint:meta['argument-hint']||'[arguments]',description,source,kind:'args',model:true,handling:'Terminal; agent expands the '+source+' command',scope:folders.some(f=>file.startsWith(f+path.sep))&&!file.startsWith(roots[kind]+path.sep)?'project':'user'});
      }
    }
    if(kind==='claude'){
      await add(path.join(roots.claude,'commands'),'custom','command');await add(path.join(roots.claude,'skills'),'skill','skill');
      for(const folder of folders){await add(path.join(folder,'.claude','commands'),'custom','command');await add(path.join(folder,'.claude','skills'),'skill','skill');}
      let registry={};try{registry=JSON.parse(await read(path.join(roots.claude,'plugins','installed_plugins.json')));}catch{}
      for(const [id,installs] of Object.entries(registry.plugins||{}).slice(0,100))for(const install of Array.isArray(installs)?installs:[]){
        if(!install.installPath||install.enabled===false||install.projectPath&&!folders.includes(path.resolve(install.projectPath)))continue;
        const name=id.split('@')[0];if(!/^[\w.-]+$/.test(name))continue;
        await add(path.join(install.installPath,'commands'),'plugin','command',name+':');await add(path.join(install.installPath,'skills'),'plugin','skill',name+':');
      }
    }else if(kind==='astra'){
      await add(path.join(roots.astra,'prompts'),'custom','prompt');
      await add(path.join(roots.astra,'skills'),'skill','skill');await add(path.join(roots.home,'.agents','skills'),'skill','skill');
      for(const folder of folders)await add(path.join(folder,'.agents','skills'),'skill','skill');
    }else{
      await add(path.join(roots.copilot,'skills'),'skill','skill');await add(path.join(roots.copilot,'agents'),'custom','agent');
      for(const folder of folders){
        await add(path.join(folder,'.claude','commands'),'custom','command');
        for(const config of ['.claude','.agents','.github'])await add(path.join(folder,config,'skills'),'skill','skill');
        await add(path.join(folder,'.github','agents'),'custom','agent');
      }
    }
    return {kind,version:catalogs[kind].version,commands:[...commands.values()].sort((a,b)=>a.name.localeCompare(b.name)),skills,agents,cachedForMs:TTL,limited:budget.left<=0};
  })();
  cache.set(key,{at:now,promise});if(cache.size>128)cache.delete(cache.keys().next().value);
  try{return await promise;}catch(error){cache.delete(key);throw error;}
}
function builtin(kind,text){const parsed=core.parse(text);return parsed&&catalogs[kind]?.commands.find(c=>c.name===parsed.name);}
module.exports={catalogs,discover,builtin,metadata,homes,scopeFolders,core};
