'use strict';
// Read transcript evidence only. No command or code-mode body is ever evaluated.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const flavor = p => /^[a-z]:[\\/]|^\\\\/i.test(p || '') ? path.win32 : path.posix;
// Folders that hold projects rather than being one. OneDrive names the Desktop and Documents it backs up in the
// Windows language, and a work or school OneDrive carries the organization's name ("OneDrive - Acme").
const CONTAINERS = new Set(['desktop','onedrive','personal','documents','downloads','productivity projects','personal productivity projects','dev','source','repos','projects','users','home','escritorio','documentos','descargas','proyectos']);
const oneDrive = name => /^onedrive(?:\s+-\s+.+)?$/i.test(name);
// A number in front only orders a folder ("02. Projects", "06_Survey"); it says nothing about what the folder holds.
const unnumbered = name => name.replace(/^\d{1,3}\s*[.)_-]\s*(?=\S)/, '');
// Signs that someone set a folder up as a workspace: agent or editor settings and instructions, or a package manifest.
const WORKSPACE = ['.git','.github','.vscode','.claude','.obsidian','.idea','CLAUDE.md','AGENTS.md','package.json','pyproject.toml','requirements.txt'];
const unquote = p => p.replace(/^(["'])([\s\S]*)\1$/, '$2');
const drivePath = p => p.replace(/^\/(?:mnt\/)?([a-z])(?:\/|$)/i, (_,d) => d.toUpperCase()+':/');
const normalized = p => {if(!p)return '';p=drivePath(unquote(p.trim()));const api=flavor(p),value=api.normalize(p).replace(/^[a-z]:/,s=>s.toUpperCase());return value===api.parse(value).root?value:value.replace(/[\\/]$/, '');};
const identity = p => {const value=normalized(p);return /^[a-z]:|^\\\\/i.test(value) ? value.toLowerCase() : value;};
const basename = p => flavor(p).basename(p || '');
// Shared with discovery and the background worker; retain legacy group labels.
const GROUP_CONTAINERS=new Set(['desktop','onedrive','personal','documents','productivity projects','personal productivity projects','dev','source','repos','projects','escritorio','documentos','proyectos']);
function nexusGroup(cwd,home=os.homedir()){
  if(!cwd)return 'Unknown';const p=cwd.replace(/\//g,'\\');
  if(/\\ibagent\\runs/i.test(p))return 'ibagent runs';
  if(/\\AppData\\(Local\\Temp|Roaming\\Claude)/i.test(p))return 'Scratch';
  const rel=p.toLowerCase().startsWith(home.toLowerCase())?p.slice(home.length):p.replace(/^[a-z]:/i,'');
  const segs=rel.split('\\').filter(Boolean);while(segs.length&&(GROUP_CONTAINERS.has(segs[0].toLowerCase())||oneDrive(segs[0])))segs.shift();
  return segs[0]||'Home';
}
const directoryCache = new Map();
function isDirectory(p) {
  if (!p) return false;
  const key=identity(p);if(directoryCache.has(key))return directoryCache.get(key);
  let result=false;try{result=fs.statSync(p).isDirectory();}catch{}
  directoryCache.set(key,result);if(directoryCache.size>8192)directoryCache.delete(directoryCache.keys().next().value);
  return result;
}
function absolute(value, cwd = '', home = os.homedir()) {
  if (typeof value !== 'string' || !value.trim() || value.length > 260) return '';
  let p = unquote(value.trim());
  if (/[\x00-\x1f]/.test(p)) return '';
  p=p.replace(/^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE)(?=[\\/]|$)/i,()=>home)
    .replace(/^(?:%TEMP%|%TMP%|\$env:TEMP|\$env:TMP)(?=[\\/]|$)/i,()=>os.tmpdir());
  if (/^[a-z][a-z\d+.-]+:/i.test(p) || /[$%*?<>|"\x7f]/.test(p) || /={3,}/.test(p) || /^[a-z]:(?![\\/])/i.test(p)) return '';
  p=drivePath(p);cwd=cwd?absolute(cwd,'',home):'';
  if (p.replace(/^[a-z]:/i,'').includes(':')) return '';
  const api = flavor(/^[a-z]:[\\/]|^\\\\/i.test(p) ? p : cwd || p);
  if (!api.isAbsolute(p) && !cwd) return '';
  const result=normalized(api.resolve(cwd || api.parse(p).root, p));
  return result.length<=260?result:'';
}
function createRoots({ home = os.homedir(), groupOf = p => basename(p) || 'Unknown', temp = os.tmpdir(), stateDir, aliases = {} } = {}) {
  const cache = new Map(), markers = new Map(), workspaces = new Map(), repositories = new Map(), genericCache = new Map();
  const local=process.env.LOCALAPPDATA||flavor(home).join(home,'AppData','Local');
  const ignored=[temp,os.tmpdir(),flavor(local).join(local,'NexusDeck'),stateDir,
    process.env.NEXUS_STATE_FILE&&path.dirname(process.env.NEXUS_STATE_FILE),
    ...['.claude','.codex','.copilot','.local'].map(n=>flavor(home).join(home,n))].filter(Boolean).map(p=>identity(absolute(p,'',home))).filter(Boolean);
  function tooling(value) {
    const p=absolute(value,'',home),id=identity(p);if(!p)return false;
    return /(?:^|[\\/])(?:node_modules|\.git|AppData)(?:[\\/]|$)/i.test(p)||ignored.some(dir=>id===dir||id.startsWith(dir+flavor(p).sep));
  }
  function repository(dir) {
    const key=identity(dir);if(repositories.has(key))return repositories.get(key);
    let main=dir;
    try {
      const marker=flavor(dir).join(dir,'.git'),st=fs.statSync(marker);
      if(st.isFile()&&st.size<=4096){
        const match=/^gitdir:\s*(.+)$/im.exec(fs.readFileSync(marker,'utf8'));
        const gitdir=match&&absolute(match[1],dir,home);
        if(gitdir&&/[\\/]worktrees[\\/][^\\/]+$/i.test(gitdir)){
          // Standard worktree pointers already identify the main .git directory;
          // do not open files in the main checkout just to resolve that identity.
          const conventional=flavor(gitdir).dirname(flavor(gitdir).dirname(gitdir));
          const commonFile=flavor(gitdir).join(gitdir,'commondir');
          if(basename(conventional).toLowerCase()==='.git')main=flavor(conventional).dirname(conventional);
          else if(fs.statSync(commonFile).size<=4096){
            const common=absolute(fs.readFileSync(commonFile,'utf8').trim(),gitdir,home);
            if(basename(common).toLowerCase()==='.git')main=flavor(common).dirname(common);
          }
        }
      }
    }catch{}
    repositories.set(key,main);if(repositories.size>8192)repositories.delete(repositories.keys().next().value);return main;
  }
  // Keep the actual worktree for evidence, and its common repository for identity.
  function locate(value, cwd, directory = false) {
    const p = absolute(value, cwd, home); if (!p||tooling(p)||generic(p)) return null;
    let dir = directory ? p : flavor(p).dirname(p), key = identity(dir);
    if(generic(dir))return null;
    if (cache.has(key)) return within(cache.get(key), dir, cwd);
    let current = dir, result = '';
    while (current) {
      const id = identity(current);
      if (!markers.has(id)) { try { markers.set(id,fs.existsSync(flavor(current).join(current,'.git'))); } catch { markers.set(id,false); } }
      if (markers.get(id)) { result = current; break; }
      const parent = flavor(current).dirname(current); if (parent === current) break; current = parent;
    }
    // Outside a repository, climb to the folder below the one that holds many projects (the existing groupOf boundary
    // too), but no higher than the outermost folder set up as a workspace on the way: an agent folder, not its category.
    let marked = '';
    const climb = () => {
      if(/^[a-z]:[\\/][a-z](?:[\\/]|$)/i.test(dir))return '';
      let at = dir, set = workspace(dir) ? dir : ''; const group = groupOf(dir);
      while (at) { const parent = flavor(at).dirname(at); if (parent === at || generic(parent) || groupOf(parent) !== group) break; at = parent; if (workspace(at)) set = at; }
      marked = set; return set || at;
    };
    if (!result && !(result = climb())) return null;
    // Negative ancestor checks cannot cache another child's group fallback.
    // A home/container .git marker is not evidence for every project beneath it.
    if(generic(result)&&markers.get(identity(result)))result=climb();
    const repo=!!markers.get(identity(result)),found=!result||generic(result)?null:{path:result,projectRoot:repo?repository(result):result,repo,...(!repo&&marked?{workspace:true}:{})};
    cache.set(key, found);
    if (cache.size > 8192) cache.delete(cache.keys().next().value);
    if (markers.size > 8192) markers.delete(markers.keys().next().value);
    return within(found, dir, cwd);
  }
  // Outside a repository or workspace the project never reaches above the folder the agent was started in: a synced
  // company library keeps projects several organizing folders deep, and the top of that tree is not a project.
  function within(found, dir, cwd) {
    if (!found || found.repo || found.workspace || !cwd) return found;
    const launch = absolute(cwd, '', home), id = identity(launch), inside = (child, parent) => child.startsWith(parent + '\\') || child.startsWith(parent + '/');
    if (!launch || generic(launch) || !(identity(dir) === id || inside(identity(dir), id)) || !inside(id, identity(found.path))) return found;
    return { path: launch, projectRoot: launch, repo: false };
  }
  function root(value,cwd,directory=false){return locate(value,cwd,directory)?.projectRoot||'';}
  function generic(p) {
    if(genericCache.has(p))return genericCache.get(p);
    const result=isGeneric(p);genericCache.set(p,result);
    if(genericCache.size>8192)genericCache.delete(genericCache.keys().next().value);
    return result;
  }
  function workspace(dir) {
    const key=identity(dir);if(workspaces.has(key))return workspaces.get(key);
    let result=false;try{const names=new Set(fs.readdirSync(dir).map(n=>n.toLowerCase()));result=WORKSPACE.some(n=>names.has(n.toLowerCase()));}catch{}
    workspaces.set(key,result);if(workspaces.size>8192)workspaces.delete(workspaces.keys().next().value);
    return result;
  }
  // A folder holding nothing but folders, two or more of them workspaces, sorts projects ("Clients", "10. Agents").
  function holdsProjects(p) {
    if(!isDirectory(p)||workspace(p))return false;let found=0;
    try{for(const e of fs.readdirSync(p,{withFileTypes:true})){
      if(!e.isDirectory()){if(/^(?:desktop\.ini|thumbs\.db|\.ds_store)$|^~\$/i.test(e.name))continue;return false;}
      if(found<2&&!e.name.startsWith('.')&&workspace(flavor(p).join(p,e.name)))found++;
    }}catch{return false;}
    return found>=2;
  }
  // A work OneDrive ("OneDrive - Acme") comes with a folder named after the organization ("Acme") that holds the
  // SharePoint and Teams libraries synced to this PC. The company folder, each library and a Teams channel's "General"
  // folder hold projects; the path below the company folder.
  function synced(p) {
    const rel=flavor(p).relative(home,p);if(!rel||rel.startsWith('..')||flavor(p).isAbsolute(rel))return null;
    const segs=rel.split(/[\\/]/);return isDirectory(flavor(home).join(home,'OneDrive - '+segs[0]))?segs.slice(1):null;
  }
  function isGeneric(p) {
    p=absolute(p,'',home);
    if (!p || tooling(p) || identity(p) === identity(home) || flavor(p).dirname(p) === p || /^[a-z]:[\\/][a-z]$/i.test(p)) return true;
    const name=unnumbered(basename(p)).toLowerCase(),library=synced(p);if(library&&(library.length<2||name==='general'))return true;
    const id = identity(p), tmp = identity(temp);
    if(id === tmp || id.startsWith(tmp + flavor(p).sep) || /[\\/](?:tmp|temp|scratch-workspaces)(?:[\\/]|$)/i.test(p))return true;
    if(Object.entries(aliases).some(([from,to])=>typeof to==='string'&&to.trim()&&[from,to].some(n=>n.toLowerCase()===basename(p).toLowerCase())))return false;
    return CONTAINERS.has(name) || /\s(?:projects|proyectos)$/.test(name) || oneDrive(basename(p)) || /^(home|scratch|unknown)$/i.test(groupOf(p)) || /^(home|scratch|unknown|tmp|temp)$/i.test(basename(p)) || holdsProjects(p);
  }
  function folderNames(p){const names=[];for(let dir=p;dir&&!generic(dir);){names.push(basename(dir));const parent=flavor(dir).dirname(dir);if(parent===dir)break;dir=parent;}return names;}
  // Saved scans hold resolved project folders; a change to these rules bumps `containers` so they are redone.
  return { root, locate, generic, tooling, folderNames, groupOf, home, cacheKey:JSON.stringify({home,temp,stateDir,aliases,group:String(groupOf),containers:5}) };
}
function argument(value) { if (typeof value !== 'string') return value || {}; try { return JSON.parse(value); } catch { return { command: value }; } }
// Static JavaScript string literals, including escaped Windows paths and newlines.
function literal(source, at) {
  const quote = source[at]; if (!['"', "'", '`'].includes(quote)) return null;
  let value = '';
  for (let i = at + 1; i < source.length; i++) {
    const c = source[i]; if (c === quote) return { value, end: i + 1 };
    if (quote === '`' && c === '$' && source[i + 1] === '{') return null;
    if (c !== '\\') { value += c; continue; }
    const next = source[++i];
    if (next === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(i+1,i+5))) { value += String.fromCharCode(parseInt(source.slice(i+1,i+5),16)); i += 4; }
    else if (next === 'x' && /^[0-9a-f]{2}$/i.test(source.slice(i+1,i+3))) { value += String.fromCharCode(parseInt(source.slice(i+1,i+3),16)); i += 2; }
    else value += ({ n:'\n', r:'\r', t:'\t', '\n':'' })[next] ?? next ?? '';
  }
  return null;
}
function codeCalls(code) {
  const out = [], re = /\b(?:tools\.)?(exec_command|apply_patch|read_file|write_file)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    let at = re.lastIndex; while (/\s/.test(code[at] || '') && at < code.length) at++;
    const str = literal(code, at);
    if (str) { out.push({ name: m[1], input: str.value }); re.lastIndex = str.end; continue; }
    if (code[at] !== '{') continue;
    const input = {}; let depth = 1;
    for (at++; at < code.length && depth; at++) {
      if (depth === 1) {
        const key = /^(?:["']?)(cmd|command|workdir|cwd|path|file_path)(?:["']?)\s*:\s*/.exec(code.slice(at));
        if (key) { const v = literal(code, at + key[0].length); if (v) { input[key[1]] = v.value; at = v.end - 1; continue; } }
      }
      const s = literal(code, at);
      if (s) { at = s.end - 1; continue; }
      if (code[at] === '{') depth++; if (code[at] === '}') depth--;
    }
    out.push({ name: m[1], input }); re.lastIndex = at;
  }
  return out;
}
function toolPaths(name, raw, cwd, home) {
  if (/^(?:functions\.)?exec$/.test(name) && typeof raw === 'string') return codeCalls(raw).flatMap(t => toolPaths(t.name, t.input, cwd, home));
  const a = argument(raw), weight = /edit|write|create|patch/i.test(name) ? 3 : 1, out = new Map();
  const workdir=absolute(a.workdir || a.cwd, cwd, home);let base = workdir || absolute(cwd,'',home);
  const add = (p, w = weight, directory = false, explicit = true) => { const file = absolute(p, base, home); if (file && flavor(file).dirname(file)!==file) { const key = identity(file); const prior = out.get(key); if (!prior || prior.weight < w) out.set(key, { path: file, weight: w, directory:directory||isDirectory(file), explicit }); } };
  for (const field of ['file_path','path','notebook_path','file','filename']) if (typeof a[field] === 'string') add(a[field], weight, /glob|grep|directory/i.test(name));
  for (const p of Array.isArray(a.paths) ? a.paths : []) add(p, weight, /grep|glob/i.test(name));
  const patch = /patch/i.test(name) ? typeof raw === 'string' ? raw : a.patch || a.input || '' : '';
  for (const m of String(patch).matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)\r?$/gm)) add(m[1], 3);
  const command = /bash|shell|exec_command|run_command/i.test(name) ? String(a.command || a.cmd || '') : '';
  if (command) {
    const tokens = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s;|&(){}]+/g) || [];
    for (let i = 0; i < tokens.length; i++) {
      const token = unquote(tokens[i]);
      if (/^(?:cd|chdir|Set-Location|Push-Location)$/i.test(token)) {
        let next = i + 1; while (/^(?:\/d|-(?:LiteralPath|Path))$/i.test(tokens[next] || '')) next++;
        const dir = absolute(tokens[next], base, home); if (dir) { base = dir; add(dir, 1, true); } i = next; continue;
      }
      if (/^-(?:LiteralPath|Path|FilePath)$/i.test(token)) {if(tokens[i+1])add(unquote(tokens[++i]),1);continue;}
      if (/^[a-z]:[\\/]|^\\\\|^\/(?![a-z]$)|^~[\\/]|^(?:\$HOME|\$\{HOME\}|\$env:(?:USERPROFILE|TEMP|TMP)|%(?:USERPROFILE|TEMP|TMP)%)(?:[\\/]|$)/i.test(token) || /^[.]{1,2}[\\/]/.test(token) || /^[\w./\\-]+\.[a-z0-9]{1,10}$/i.test(token)) {
        add(token.replace(/[,)]$/, ''), 1);
      }
    }
  }
  // A command's execution context alone is weak evidence, never a file touch.
  if (command&&workdir&&!out.size) add(workdir, .25, true, false);
  return [...out.values()];
}
function parentMarker(kind, r) {
  // parentUuid is a message link, not a session relationship.
  if (kind === 'claude' && r.type === 'fork-context-ref') return r.parentSessionId;
  if (kind === 'astra' && r.type === 'session_meta') return r.payload?.forked_from;
  return null;
}
class WorkScanner {
  constructor({ roots = createRoots(), initialBytes = 64*1024, chunkBytes = 2*1024*1024, tickMs = 8, cacheFile = null, readOnly = false, onUpdate = () => {} } = {}) {
    Object.assign(this,{roots,initialBytes,chunkBytes,tickMs,cacheFile,readOnly,onUpdate});
    this.cache=new Map();this.pending=new Set();this.bytesRead=0;this.revision=0;this.started=0;this.elapsedMs=0;this.peakRss=process.memoryUsage().rss;this.dirty=false;
    // Only compact aggregates and a record-boundary checkpoint survive restart.
    // Read-only probes neither load nor write the owner's persistent cache.
    if(cacheFile&&!readOnly)try{
      const saved=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
      if(saved.version===2&&saved.rootsKey===roots.cacheKey)for(const [file,v] of saved.files){
        if(!Number.isSafeInteger(v.offset)||v.offset<0||v.offset>v.size||!Array.isArray(v.roots)||!Array.isArray(v.basenames)||!Array.isArray(v.ids))continue;
        this.cache.set(file,{...v,roots:new Map(v.roots.map(r=>[identity(r.path),r])),names:new Set(v.basenames),ids:new Set(v.ids),fragments:[],carryBytes:0});
      }
    }catch{} // A missing/old/corrupt disposable cache simply starts a fresh scan.
  }
  fresh(st,kind,cwd){return {size:st.size,mtimeMs:st.mtimeMs,ino:st.ino,birthtimeMs:st.birthtimeMs,offset:0,kind,launch:cwd,cwd,hasCwd:false,fragments:[],carryBytes:0,roots:new Map(),names:new Set(),ids:new Set(),parent:null};}
  observe(file,kind,cwd){
    const st=fs.statSync(file);let s=this.cache.get(file);
    if(!s||st.size<s.size||st.ino!==s.ino||st.birthtimeMs!==s.birthtimeMs||st.size===s.size&&st.mtimeMs!==s.mtimeMs||s.launch!==cwd&&!s.hasCwd||s.kind!==kind){
      s=this.fresh(st,kind,cwd);this.cache.set(file,s);
    }
    s.size=st.size;s.mtimeMs=st.mtimeMs;
    return s;
  }
  read(file, kind, cwd = '') {
    const s=this.observe(file,kind,cwd);
    if(s.offset<s.size){
      if(!this.started)this.started=performance.now();
      // Tiny standalone fixtures can be read immediately; server discovery uses 0.
      // Never scan more transcript bytes on a repeated request while queued.
      if(this.initialBytes&&!this.pending.has(file))this.range(file,s,Math.min(s.size,s.offset+this.initialBytes));
      if(s.offset<s.size){this.pending.add(file);this.schedule();}else this.changed();
    }
    return { roots:[...s.roots.values()], basenames:[...s.names], parent:s.parent, partial:s.offset<s.size||s.carryBytes>0 };
  }
  schedule(){if(!this.timer&&this.pending.size)this.timer=setTimeout(()=>{this.timer=null;this.tick();},0);}
  changed(){
    this.revision++;this.dirty=true;this.peakRss=Math.max(this.peakRss,process.memoryUsage().rss,process.resourceUsage().maxRSS*1024);
    if(this.started)this.elapsedMs=performance.now()-this.started;
    this.onUpdate(this.revision);
    if(this.cacheFile&&!this.readOnly){
      if(this.saveTimer&&!this.pending.size){clearTimeout(this.saveTimer);this.saveTimer=null;}
      if(!this.saveTimer)this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.flush().catch(()=>{});},this.pending.size?1000:0);
    }
  }
  tick(){
    const deadline=performance.now()+this.tickMs;let remaining=this.chunkBytes;
    while(this.pending.size&&remaining>0&&performance.now()<deadline){
      const file=this.pending.values().next().value;let s=this.cache.get(file);
      try{
        s=this.observe(file,s.kind,s.launch);const before=s.offset;
        this.range(file,s,Math.min(s.size,s.offset+remaining),deadline);remaining-=s.offset-before;
        if(s.offset>=s.size)this.pending.delete(file);
        if(s.offset===before)this.pending.delete(file);
      }catch{this.pending.delete(file);this.cache.delete(file);}
    }
    this.changed();this.schedule();
  }
  range(file,s,end,deadline=Infinity) {
    const fd=fs.openSync(file,'r');
    try { while(s.offset<end&&performance.now()<deadline) {
      const b=Buffer.alloc(Math.min(64*1024,end-s.offset)),n=fs.readSync(fd,b,0,b.length,s.offset);if(!n)break;
      s.offset+=n;this.bytesRead+=n;const block=b.subarray(0,n);let start=0,nl;
      while((nl=block.indexOf(10,start))>=0){
        const tail=block.subarray(start,nl),line=s.carryBytes?Buffer.concat([...s.fragments,tail],s.carryBytes+tail.length):tail;
        s.fragments=[];s.carryBytes=0;
        try{
          const text=line.toString('utf8');
          // Results/prose are traversed but never become evidence. No record-size,
          // tool-call, root or ID eviction cap can silently discard the middle.
          if(/"(?:tool_use|function_call|custom_tool_call|toolRequests|tool\.execution_[^"]+|session_meta|turn_context|session\.start|session\.resume|fork-context-ref)"/.test(text)||/"cwd"\s*:/.test(text))this.record(s,s.kind,JSON.parse(text));
        }catch{}
        start=nl+1;
      }
      if(start<n){const fragment=Buffer.from(block.subarray(start));s.fragments.push(fragment);s.carryBytes+=fragment.length;}
    }} finally {fs.closeSync(fd);}
  }
  async flush(){
    if(this.saving){await this.saving;if(this.dirty)return this.flush();return;}
    if(!this.dirty||this.readOnly||!this.cacheFile)return;
    this.dirty=false;
    const files=[...this.cache].map(([file,s])=>[file,{size:s.size,mtimeMs:s.mtimeMs,ino:s.ino,birthtimeMs:s.birthtimeMs,offset:s.offset-s.carryBytes,kind:s.kind,launch:s.launch,cwd:s.cwd,hasCwd:s.hasCwd,roots:[...s.roots.values()],basenames:[...s.names],ids:[...s.ids],parent:s.parent}]);
    const data=JSON.stringify({version:2,rootsKey:this.roots.cacheKey,files}),tmp=this.cacheFile+'.'+process.pid+'.tmp';
    this.saving=(async()=>{try{await fs.promises.mkdir(path.dirname(this.cacheFile),{recursive:true});await fs.promises.writeFile(tmp,data);await fs.promises.rename(tmp,this.cacheFile);}catch(e){this.dirty=true;throw e;}finally{await fs.promises.unlink(tmp).catch(()=>{});}})();
    try{await this.saving;}finally{this.saving=null;}
  }
  async idle(){while(this.pending.size||this.timer)await new Promise(resolve=>setTimeout(resolve,5));if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=null;}await this.flush();}
  status(){return {pending:this.pending.size,files:this.cache.size,bytesRead:this.bytesRead,revision:this.revision,elapsedMs:Math.round(this.elapsedMs),peakRssBytes:this.peakRss};}
  record(s,kind,r) {
    const p=r.payload||r.data||{};
    const cwd=kind==='claude'?r.cwd:kind==='astra'&&['session_meta','turn_context'].includes(r.type)?p.cwd:kind==='copilot'&&['session.start','session.resume'].includes(r.type)?p.context?.cwd:null;
    if(typeof cwd==='string'&&cwd){s.cwd=cwd;s.hasCwd=true;}
    const parent=parentMarker(kind,r);if(typeof parent==='string'&&/^[\w-]{1,128}$/.test(parent))s.parent={key:kind+':'+parent,relation:'fork'};
    const calls=kind==='claude'&&r.type==='assistant'&&!r.isSidechain?(r.message?.content||[]).filter(t=>t.type==='tool_use'):
      kind==='astra'&&r.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)?[p]:
      kind==='copilot'&&r.type==='assistant.message'?p.toolRequests||[]:
      kind==='copilot'&&/^tool\.execution_/.test(r.type)&&p.arguments?[p]:[];
    for(const t of calls){
      const rawId=t.id||t.call_id||t.toolCallId,id=rawId&&crypto.createHash('sha256').update(String(rawId)).digest('hex').slice(0,24);if(id&&s.ids.has(id))continue;
      if(id)s.ids.add(id);
      for(const hit of toolPaths(t.name||t.toolName||'',t.input??t.arguments,s.cwd,this.roots.home)){
        const found=this.roots.locate(hit.path,s.cwd,hit.directory);if(!found||this.roots.generic(found.path)||this.roots.generic(found.projectRoot)||hit.weight<=0)continue;
        const key=identity(found.path);
        const entry=s.roots.get(key)||{...found,weight:0,explicitWeight:0};entry.weight+=hit.weight;entry.explicitWeight+=hit.explicit?hit.weight:0;s.roots.set(key,entry);
        if(!hit.directory&&s.names.size<64)s.names.add(basename(hit.path).slice(0,120));
      }
    }
  }
  session(s) {
    const roots=new Map(),names=new Set();let parent=null,partial=false;
    for(const file of [...new Set(s.chainFiles||[s.file])].filter(Boolean))try{
      const result=this.read(file,s.kind,s.cwd);parent=result.parent||parent;partial ||= result.partial;
      for(const r of result.roots){const key=identity(r.path),v=roots.get(key)||{...r,weight:0,explicitWeight:0};v.weight+=r.weight;v.explicitWeight+=r.explicitWeight;roots.set(key,v);}
      for(const n of result.basenames)if(names.size<64)names.add(n);
    }catch{}
    const sorted=[...roots.values()].filter(r=>r.weight>0&&!this.roots.generic(r.path)&&!this.roots.generic(r.projectRoot)).sort((a,b)=>b.weight-a.weight||identity(a.path).localeCompare(identity(b.path))),projects=new Map();
    for(const r of sorted){const key=identity(r.projectRoot),v=projects.get(key)||{path:r.projectRoot,weight:0,explicitWeight:0,repo:!!r.repo};v.weight+=r.weight;v.explicitWeight+=r.explicitWeight;projects.set(key,v);}
    // Equal work in two related projects leaves the session with the one it was started in.
    const start=this.roots.locate(s.cwd,s.cwd,true),launch=start?.projectRoot||'',own=r=>identity(r.path)===identity(launch);
    const ranked=[...projects.values()].sort((a,b)=>b.weight-a.weight||own(b)-own(a)||identity(a.path).localeCompare(identity(b.path))),total=ranked.reduce((n,r)=>n+r.weight,0);
    const work=total>0&&ranked[0].explicitWeight>0&&ranked[0].weight/total>=.4;
    return {mainFolder:work?ranked[0].path:absolute(s.cwd,'',this.roots.home),projectRoot:work?ranked[0].path:launch,workFolders:sorted.slice(0,3).map(({path,weight})=>({path,weight})),touchedFiles:[...names],workFoldersPartial:partial,parent,source:work?'work-folder':'launch-folder',repository:work?ranked[0].repo:!!start?.repo,hasWork:total>0};
  }
}
// The HTTP thread reads only compact snapshots. Even a single very large JSON
// record or tool batch cannot block it while the worker performs its chunk scan.
class BackgroundWorkScanner extends WorkScanner {
  constructor({roots,rootOptions={},cacheFile,readOnly=false}={}){
    super({roots,initialBytes:0,readOnly:true});
    this.requests=new Map();this.registered=new Map();this.results=new Map();this.scanStatus={pending:0,files:0,bytesRead:0,revision:0,elapsedMs:0,peakRssBytes:0};
    const {Worker}=require('worker_threads');
    this.worker=new Worker(path.join(__dirname,'work-folders-worker.js'),{workerData:{rootOptions,cacheFile,readOnly}});
    this.worker.on('message',message=>{for(const [file,result] of message.results)this.results.set(file,result);this.scanStatus=message.status;});
    this.worker.on('error',error=>{this.error=error.message;});this.worker.unref();
  }
  read(file,kind,cwd=''){
    this.requests.set(file,{file,kind,cwd});
    this.registered.set(file,{kind,cwd});
    if(!this.dispatch)this.dispatch=setImmediate(()=>{this.dispatch=null;this.worker.postMessage([...this.requests.values()]);this.requests.clear();});
    const result=this.results.get(file);
    return result&&result.kind===kind&&(result.hasCwd||result.launch===cwd)?result:{roots:[],basenames:[],parent:null,partial:true};
  }
  status(){const missing=[...this.registered].filter(([file,r])=>{const s=this.results.get(file);return !s||s.kind!==r.kind||!s.hasCwd&&s.launch!==r.cwd;}).length;return {...this.scanStatus,pending:Math.max(missing,this.scanStatus.pending),...(this.error?{error:this.error}:{})};}
  async close(){if(this.dispatch){clearImmediate(this.dispatch);this.dispatch=null;}await this.worker.terminate();}
}
module.exports={WorkScanner,BackgroundWorkScanner,createRoots,nexusGroup,toolPaths,codeCalls,identity,basename,absolute};
