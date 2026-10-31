'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFile}=require('child_process');
const {running}=require('./public/themes-core');
function assertClosed(session,terms=[]){if(!session)throw Error('Conversation unavailable. Refresh the list.');if(running(session,terms))throw Error('Close it first. This conversation is running.');}
function inside(file,root){const rel=path.relative(root,file);return !!rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function targets(session,roots){
 const root=fs.realpathSync(roots[session.kind]);
 const check=file=>{const absolute=path.resolve(file);if(!inside(absolute,root))throw Error('Conversation is outside its agent history folder.');let at=absolute;while(at!==root){if(fs.lstatSync(at).isSymbolicLink())throw Error('Linked conversation files cannot be recycled.');at=path.dirname(at);}const real=fs.realpathSync(absolute);if(!inside(real,root))throw Error('Conversation is outside its agent history folder.');return real;};
 check(session.file);
 const files=session.kind==='copilot'?[path.dirname(session.file)]:session.kind==='claude'?[...new Set([session.file,...(session.chainFiles||[]),...require('./transcript-tail').continuation(session.file).files])]:[session.file];
 const all=[];
 for(const file of files){const real=check(file),stat=fs.statSync(real);
  if(session.kind==='copilot'){if(path.basename(session.file)!=='events.jsonl'||path.dirname(real)!==path.join(root,'session-state'))throw Error('Invalid saved conversation folder.');}
  else if(!stat.isFile()||path.extname(real)!=='.jsonl'||!(session.kind==='claude'?inside(real,path.join(root,'projects')):['sessions','archived_sessions'].some(dir=>inside(real,path.join(root,dir)))))throw Error('Invalid saved conversation file.');
  all.push({path:real,directory:stat.isDirectory()});
  if(session.kind==='claude'){const sidecar=real.slice(0,-6);if(fs.existsSync(sidecar)){const folder=check(sidecar);if(!fs.statSync(folder).isDirectory())throw Error('Invalid conversation sidecar.');all.push({path:folder,directory:true});}}
 }return all;
}
function command(items){
 if(!Array.isArray(items)||!items.length)throw Error('No saved conversation files.');
 const encoded=Buffer.from(JSON.stringify(items),'utf8').toString('base64');
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; $items=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))); foreach($item in $items){ if($item.directory){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($item.path,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)}else{[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($item.path,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)}}`;
 return {file:'powershell.exe',args:['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],options:{windowsHide:true,timeout:60000,maxBuffer:8192}};
}
function recycle(items,execute=execFile){if(process.platform!=='win32')return Promise.reject(Error('Recycle Bin requires Windows.'));const c=command(items);return new Promise((resolve,reject)=>execute(c.file,c.args,c.options,error=>error?reject(Error('Could not move all conversation files. Check the Recycle Bin before retrying.')):resolve({recycled:items.length})));}
function fingerprint(session,items){const files=new Set([...items.map(i=>i.path),session.file]);if(session.kind==='copilot'){const workspace=path.join(path.dirname(session.file),'workspace.yaml');if(fs.existsSync(workspace))files.add(workspace);}return [...files].map(file=>{const st=fs.statSync(file);return [file,st.size,st.mtimeMs];});}
class Queue{
 constructor({lookup,terms,roots,perform=recycle,delay=6000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){Object.assign(this,{lookup,terms,roots,perform,delay,now,setTimer,clearTimer});this.jobs=new Map();}
 schedule(key){const s=this.lookup(key);assertClosed(s,this.terms());const items=targets(s,this.roots),existing=[...this.jobs.values()].find(j=>j.key===key&&['pending','recycling'].includes(j.state));if(existing)return this.public(existing);
  const job={id:crypto.randomUUID(),key,state:'pending',dueAt:this.now()+this.delay,fingerprint:fingerprint(s,items)};this.jobs.set(job.id,job);
  job.timer=this.setTimer(()=>this.execute(job),this.delay);job.timer?.unref?.();
  for(const[id,j]of this.jobs)if(this.now()-(j.finishedAt||this.now())>3600000)this.jobs.delete(id);
  return this.public(job);
 }
 public(j){return {id:j.id,key:j.key,state:j.state,dueAt:j.dueAt,error:j.error};}
 status(id){const j=this.jobs.get(id);if(!j)throw Error('Delete request expired.');return this.public(j);}
 cancel(id){const j=this.jobs.get(id);if(!j||j.state!=='pending')throw Error('The Undo window has ended. Restore the conversation from the Recycle Bin.');this.clearTimer(j.timer);j.state='cancelled';j.finishedAt=this.now();return this.public(j);}
 async execute(j){if(j.state!=='pending')return;try{const s=this.lookup(j.key);assertClosed(s,this.terms());const items=targets(s,this.roots);if(JSON.stringify(fingerprint(s,items))!==JSON.stringify(j.fingerprint))throw Error('Conversation changed. Delete cancelled; review it again.');j.state='recycling';await this.perform(items);j.state='recycled';}catch(e){j.state='failed';j.error=e.message;}finally{j.finishedAt=this.now();}}
}
module.exports={assertClosed,inside,targets,command,recycle,Queue};
