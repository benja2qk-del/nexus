'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const FILES={'CLAUDE.md':['claude','copilot'],'.claude/CLAUDE.md':['claude','copilot'],'AGENTS.md':['astra','copilot'],'.github/copilot-instructions.md':['copilot']};
const key=p=>path.resolve(p).toLowerCase(),hash=s=>crypto.createHash('sha256').update(s).digest('hex'),MAX=64*1024;
function folders(theme,sessions=[]){return [...new Map([theme.mainFolder,...(theme.workFolders||[]).map(f=>typeof f==='string'?f:f.path),...sessions.filter(s=>s.theme?.id===theme.id).flatMap(s=>(s.workFolders||[]).map(f=>f.path))].filter(p=>typeof p==='string'&&path.isAbsolute(p)).map(p=>[key(p),path.resolve(p)])).values()];}
function confined(root,relative,{missing=false}={}){
 if(!Object.hasOwn(FILES,relative))throw Error('Choose a supported instruction file.');
 const resolved=path.resolve(root),target=path.resolve(resolved,relative);
 if(!target.toLowerCase().startsWith(resolved.toLowerCase()+path.sep))throw Error('File is outside this theme folder.');
 // Reject junctions/symlinks along the entire path, including a redirected root.
 const parsed=path.parse(target);let cursor=parsed.root;
 for(const part of target.slice(parsed.root.length).split(path.sep)){
  cursor=path.join(cursor,part);let st;try{st=fs.lstatSync(cursor);}catch(e){if(missing&&e.code==='ENOENT')continue;throw e;}
  if(st.isSymbolicLink())throw Error('Linked folders and files cannot be edited here.');
  if(st.isFile()&&st.nlink>1)throw Error('Hard-linked files cannot be edited here.');
 }
 if(!fs.statSync(resolved).isDirectory())throw Error('Theme folder is unavailable.');
 return target;
}
function read(root,relative){
 const file=confined(root,relative),st=fs.statSync(file);if(!st.isFile()||st.size>MAX)throw Error('Instruction preview is limited to 64 KB.');
 const bytes=fs.readFileSync(file);if(bytes.includes(0))throw Error('Use a UTF-8 text instruction file.');
 try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Use a UTF-8 text instruction file.');}
 const content=bytes.toString('utf8');return {relative,agents:FILES[relative],modified:st.mtimeMs,content,revision:hash(content)};
}
function discover(theme,sessions){return {id:theme.id,purpose:theme.purpose||'',note:theme.note||'',folders:folders(theme,sessions).map(folder=>{
 const files=[],errors=[];for(const relative of Object.keys(FILES))try{files.push(read(folder,relative));}catch(e){if(e.code!=='ENOENT')errors.push(relative+': '+e.message);}
 return {folder,main:key(folder)===key(theme.mainFolder||'.'),files,errors,choices:Object.entries(FILES).filter(([relative])=>!files.some(f=>f.relative===relative)).map(([relative,agents])=>({relative,agents}))};})};}
function save(theme,sessions,request){
 if(request.confirm!==true)throw Error('Confirm writing the instruction file and its backup.');
 const folder=folders(theme,sessions).find(f=>key(f)===key(request.folder||'.'));if(!folder)throw Error('Choose a folder belonging to this theme.');
 if(typeof request.content!=='string'||Buffer.byteLength(request.content)>MAX||request.content.includes('\0'))throw Error('Use text up to 64 KB.');
 const file=confined(folder,request.relative,{missing:true});let previous=null;
 try{previous=read(folder,request.relative);}catch(e){if(e.code!=='ENOENT')throw e;}
 if((previous?.revision||null)!==request.revision)throw Error('This file changed. Reopen it before saving.');
 const backup=file+'.bak';try{const st=fs.lstatSync(backup);if(st.isSymbolicLink()||!st.isFile()||st.nlink>1)throw Error('The backup path is linked or unavailable.');}catch(e){if(e.code!=='ENOENT')throw e;}
 fs.mkdirSync(path.dirname(file),{recursive:true});confined(folder,request.relative,{missing:true});
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';
 try{
  fs.writeFileSync(temporary,request.content,{flag:'wx',mode:0o600});
  // Backup is an atomic replacement, never a write through a link.
  if(previous){const tempBackup=temporary+'.bak';try{fs.writeFileSync(tempBackup,previous.content,{flag:'wx',mode:0o600});fs.renameSync(tempBackup,backup);}finally{if(fs.existsSync(tempBackup))fs.unlinkSync(tempBackup);}}
  // Refuse an externally modified file rather than overwriting it.
  confined(folder,request.relative,{missing:true});
  if(previous&&read(folder,request.relative).revision!==previous.revision)throw Error('This file changed while saving. Reopen it.');
  if(!previous&&fs.existsSync(file))throw Error('This file was just created. Reopen it.');
  fs.renameSync(temporary,file);
 }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 return {...read(folder,request.relative),backup:previous?path.basename(backup):null,created:!previous};
}
function launch(spec,theme,sessions=[]){
 if(!theme)return {spec,method:''};
 if(!theme.mainFolder||!path.isAbsolute(theme.mainFolder)||!fs.statSync(theme.mainFolder).isDirectory())throw Error('This theme needs an available main folder before starting a session.');
 const dirs=folders(theme,sessions).filter(p=>{try{return fs.statSync(p).isDirectory();}catch{return false;}}),cwd=spec.cwd||theme.mainFolder;
 if(spec.kind==='astra')return {spec:{...spec,cwd:theme.mainFolder},method:'Started in the theme main folder; Codex reads AGENTS.md natively.'};
 const extra=dirs.filter(p=>key(p)!==key(cwd)),field=spec.kind==='claude'?'claudeArgs':'copilotArgs',args=[...(spec[field]||[]),...extra.flatMap(p=>['--add-dir',p])];
 let method=extra.length?'Theme folders added with --add-dir.':'Started in the theme main folder.';
 if(spec.kind==='claude'){
  const note=[theme.purpose,theme.note].filter(Boolean).join('\n');if(note){args.push('--append-system-prompt','NEXUS theme '+theme.name+'\n'+note);method+=' Theme purpose and note appended to the system prompt.';}
  // Claude requires this opt-in to load CLAUDE.md in additional directories.
  return {spec:{...spec,cwd,[field]:args,env:{...spec.env,CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD:'1'}},method};
 }
 const env={...spec.env},instructionDirs=extra.filter(p=>!p.includes(','));
 if(instructionDirs.length){env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS=[env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS||process.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS,...instructionDirs].filter(Boolean).join(',');method+=' Additional AGENTS.md and scoped instructions loaded through Copilot instruction directories.';}
 if(instructionDirs.length<extra.length)method+=' Folders with commas use native discovery when Copilot works in them.';
 return {spec:{...spec,cwd,[field]:args,env},method:method+' Repository-wide instructions follow native discovery.'};
}
module.exports={FILES,folders,confined,discover,read,save,launch};
