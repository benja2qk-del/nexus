'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {WorkScanner,BackgroundWorkScanner,createRoots,identity,basename}=require('./work-folders');
const themeAbout=require('./theme-about');
const sessionKey=s=>s.kind+':'+s.id;
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const blank=()=>({version:1,themes:[],assignments:{},parents:{},folders:{}});
const prettify=s=>String(s).replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\S+/g,word=>/[A-Z]/.test(word.slice(1))?word:word[0].toUpperCase()+word.slice(1));
// Fixed OKLCH hues match redesign tokens; status amber/green/red are not picks.
// Store sRGB hex so the existing color API and all consumers keep their contract.
const PALETTE_OKLCH=[214,270,325,190,245,295,350,110,48,130].map((h,i)=>[[.78,.8,.82,.84][i%4],[.09,.11,.13][i%3],h]);
function oklchHex([L,C,h]){
  const a=C*Math.cos(h*Math.PI/180),b=C*Math.sin(h*Math.PI/180),l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
  return '#'+[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].map(v=>Math.round(Math.max(0,Math.min(1,v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055))*255).toString(16).padStart(2,'0')).join('');
}
const PALETTE=PALETTE_OKLCH.map(oklchHex);
const stopWords=new Set(['the','and','for','with','this','that','from','session','project','users','desktop','documents','please','work','folder','code','file','files','read','update','help']);
const words=s=>new Set((String(s||'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(w=>!stopWords.has(w)).slice(0,200));
const unsorted=()=>({id:null,name:'Unsorted',color:null,source:'unsorted'});
class Themes {
  constructor({file,config={},roots,readOnly=false,scanner,background=false}={}) {
    const stateFile=process.env.NEXUS_STATE_FILE||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NexusDeck','state.json');
    this.file=file||process.env.NEXUS_THEMES_FILE||path.join(path.dirname(stateFile),'themes.json');
    this.config=config;this.readOnly=readOnly;this.roots=roots||createRoots({aliases:config.aliases});
    this.scanner=scanner||new (background?BackgroundWorkScanner:WorkScanner)({roots:this.roots,rootOptions:{home:this.roots.home,aliases:config.aliases},readOnly,cacheFile:path.join(path.dirname(file||stateFile),'work-folders-cache.json')});this.state=blank();this.error='';this.last=[];
    try{const s=JSON.parse(fs.readFileSync(this.file,'utf8'));if(s.version!==1||!Array.isArray(s.themes)||!s.assignments||!s.parents||!s.folders)throw Error('Unsupported themes state');this.state=s;}catch(e){if(e.code!=='ENOENT')this.loadError=this.error='Themes could not be read: '+e.message;}
  }
  save(next) {
    if(this.loadError)throw Error(this.loadError);
    if(!this.readOnly){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(next));fs.renameSync(tmp,this.file);}finally{try{fs.unlinkSync(tmp);}catch{}}}
    this.state=next;this.error='';
  }
  find(id,state=this.state){return state.themes.find(t=>t.id===id);}
  colors(state){
    const pending=state.themes.filter(t=>!t.color||t.id.startsWith('auto-')&&!t.colorSource&&t.color==='#60a5fa').sort((a,b)=>a.id.localeCompare(b.id));
    const used=new Set(state.themes.filter(t=>!pending.includes(t)).map(t=>t.color));
    for(const t of pending){const start=parseInt(crypto.createHash('sha256').update(t.id).digest('hex').slice(0,8),16)%7;let at=start;for(let n=0;n<PALETTE.length&&used.has(PALETTE[at]);n++)at=(at+1)%PALETTE.length;t.color=PALETTE[at];t.colorSource='automatic';used.add(t.color);}
  }
  automatic(s,e,state) {
    if(this.roots.generic(e.mainFolder)||this.roots.generic(e.projectRoot))return unsorted();
    const root=e.projectRoot,aliases=this.config.aliases||{},names=this.roots.folderNames(root);
    const entries=Object.entries(aliases);let name;
    for(const folderName of names){const key=folderName.toLowerCase();name=entries.find(([from])=>from.toLowerCase()===key)?.[1]||entries.find(([,to])=>typeof to==='string'&&to.toLowerCase()===key)?.[1];if(name)break;}
    const folder=name?'alias:'+name.toLowerCase():'folder:'+identity(root);
    let id=own(state.folders,folder)?state.folders[folder]:undefined;
    if(id===null)return unsorted();
    if(id===undefined){id='auto-'+crypto.createHash('sha256').update(folder).digest('hex').slice(0,20);state.folders[folder]=id;}
    let theme=this.find(id,state);
    if(!theme){theme={id,name:name||prettify(basename(root)),color:null,pinned:false,archived:false,mainFolder:root,created:new Date().toISOString()};state.themes.push(theme);}
    return {id:theme.id,name:theme.name,color:theme.color,source:e.source};
  }
  decorate(sessions,ancestors=[]) {
    // Identity, never title, is the deduplication key. Equal titles can be different runs.
    const unique=new Map();for(const s of sessions)unique.set(sessionKey(s),s);sessions.splice(0,sessions.length,...unique.values());
    const state=structuredClone(this.state),all=new Map([...ancestors,...sessions].map(s=>[sessionKey(s),s])),evidence=new Map();
    for(const [key,s] of all){
      const e=this.scanner.session(s);evidence.set(key,e);
      const chain=s.chainFiles||[],previous=chain.length>1?chain.at(-2):null;
      const parent=state.parents[key]||s.parent||(previous?{key:s.kind+':'+path.basename(previous,'.jsonl'),relation:'continuation'}:e.parent);
      s.mainFolder=e.mainFolder;s.workFolders=e.workFolders;s.touchedFiles=e.touchedFiles;s.workFoldersPartial=e.workFoldersPartial;s.parent=parent&&parent.key!==key?parent:null;
      if(s.parent)state.parents[key]=s.parent;
    }
    const resolved=new Map(),visiting=new Set(),unplaced=new Set(),forgotten=[];
    const resolve=key=>{
      if(resolved.has(key))return resolved.get(key);
      const s=all.get(key);if(visiting.has(key))return unsorted();visiting.add(key);
      const keys=[key,...(s?.aliases||[]).filter(k=>k!==key)],latest=by=>keys.map(k=>state.assignments[k]).filter(a=>a?.by===by).sort((a,b)=>(b.at||0)-(a.at||0))[0];
      // The owner's move wins; then the parent of a fork or continuation; then, outside a repository, the theme the
      // light model chose after reading the session (theme-sorter.js); then the session's folder.
      const override=latest('owner'),sorted=!evidence.get(key)?.repository&&latest('nexus');let picked=sorted&&this.find(sorted.themeId,state);
      // A pick of a theme since retired (a whole OneDrive) is dropped, and the session is read again.
      if(picked&&this.retired(picked,state)){picked=null;for(const k of keys)if(state.assignments[k]?.by==='nexus')delete state.assignments[k];forgotten.push(key);}
      let theme;
      if(override){const t=this.find(override.themeId,state);theme=t?{id:t.id,name:t.name,color:t.color,source:'owner'}:unsorted();}
      else if((s?.parent||state.parents[key])?.key)theme=resolve((s?.parent||state.parents[key]).key);
      else if(picked)theme={id:picked.id,name:picked.name,color:picked.color,source:'nexus'};
      else if(s){theme=this.automatic(s,evidence.get(key),state);if(!evidence.get(key)?.repository)unplaced.add(key);}
      // Parent absent from the discovery window: retain its last computed theme.
      else {const last=state.inherited?.[key],t=last&&this.find(last.id,state);theme=t&&!this.retired(t,state)?{id:t.id,name:t.name,color:t.color,source:last.source}:unsorted();}
      visiting.delete(key);resolved.set(key,theme);return theme;
    };
    state.inherited||={};
    for(const [key,s] of all)s.theme=resolve(key);
    this.colors(state);
    for(const [key,s] of all){if(s.theme.id)s.theme.color=this.find(s.theme.id,state)?.color||s.theme.color;state.inherited[key]=s.theme;}
    // Keep history bounded; explicit owner assignments and parents remain durable.
    const saved=Object.keys(state.inherited);for(const key of saved.slice(0,Math.max(0,saved.length-10000)))delete state.inherited[key];
    if(JSON.stringify(state)!==JSON.stringify(this.state)){try{this.save(state);}catch(e){this.error=e.message;}}
    this.last=sessions;this.unplaced=sessions.filter(s=>unplaced.has(sessionKey(s)));this.forgotten=forgotten;
    const profiles=this.profiles(sessions);
    for(const s of sessions){s.suggestions=s.theme.id?[]:this.suggest(s,profiles);s.searchText=[s.theme.name,...s.workFolders.map(f=>f.path),...s.touchedFiles].join(' ').slice(0,8192);}
    return sessions;
  }
  profiles(sessions){return this.state.themes.filter(t=>!t.archived).map(t=>({theme:t,names:words(t.name+' '+basename(t.mainFolder)),titles:words(sessions.filter(s=>s.theme?.id===t.id).slice(0,50).map(s=>s.title).join(' '))}));}
  suggest(s,profiles){
    const input=words([s.title,s.firstPrompt,s.mainFolder,...(s.workFolders||[]).map(f=>f.path),...(s.touchedFiles||[])].join(' '));
    return profiles.map(p=>{const names=[...input].filter(w=>p.names.has(w)),titles=[...input].filter(w=>p.titles.has(w)&&!names.includes(w)),score=names.length*3+titles.length;return {themeId:p.theme.id,name:p.theme.name,score,reason:names.length?'Matches theme or repository words: '+names.slice(0,3).join(', '):'Matches session title words: '+titles.slice(0,3).join(', ')};}).filter(s=>s.score>=2).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,2);
  }
  // Themes the owner made, and those NEXUS made that the owner has given something: a pin, purpose, note, color or name.
  owned(t){return !/^(auto|ai)-/.test(t.id)||!!(t.pinned||t.purpose||t.note||t.renamed||t.colorSource==='owner')||t.id.startsWith('auto-')&&!!t.mainFolder&&prettify(t.name)!==prettify(basename(t.mainFolder));}
  // Themes some listed session belongs to, or some earlier session was last seen in.
  held(){return new Set([...this.last.map(s=>s.theme?.id),...Object.values(this.state.inherited||{}).map(h=>h?.id)].filter(Boolean));}
  // A theme NEXUS made that no session belongs to any more, such as a folder guess the model has since sorted better,
  // is left out unless the owner has given it something.
  stale(t,held){return !held.has(t.id)&&!this.owned(t)||this.retired(t);}
  // A folder theme NEXUS made for a place now known to hold many projects, such as a whole OneDrive or company folder
  // made by an older NEXUS. The owner's themes and the ones the owner has used are kept.
  retired(t,state=this.state){return t.id.startsWith('auto-')&&!!t.mainFolder&&this.roots.generic(t.mainFolder)&&!this.owned(t)&&!Object.values(state.assignments).some(a=>a.by==='owner'&&a.themeId===t.id);}
  // The themes the light model may reuse: the ones the theme list shows.
  choices(){
    const held=this.held();
    return this.state.themes.filter(t=>!t.archived&&!this.stale(t,held));
  }
  // Themes the light model chose (theme-sorter.js): an existing theme of that name, else a new one in the session's folder.
  place(picks){
    const next=structuredClone(this.state),norm=n=>String(n).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');let placed=0;
    for(const {key,name} of picks){
      const s=this.last.find(x=>sessionKey(x)===key||(x.aliases||[]).includes(key));if(!s||!norm(name))continue;
      if([sessionKey(s),...(s.aliases||[])].some(k=>next.assignments[k]?.by==='owner'))continue;
      const id='ai-'+crypto.createHash('sha256').update(norm(name)).digest('hex').slice(0,20),same=next.themes.filter(t=>norm(t.name)===norm(name));
      if(same.some(t=>this.retired(t,next)))continue;
      let t=same[0]||this.find(id,next);
      if(!t){t={id,name:name.trim().slice(0,120),color:null,pinned:false,archived:false,mainFolder:s.mainFolder||'',created:new Date().toISOString()};next.themes.push(t);}
      for(const k of [sessionKey(s),...(s.aliases||[])])next.assignments[k]={themeId:t.id,by:'nexus',at:Date.now()};placed++;
    }
    if(placed){this.colors(next);this.save(next);}
    return placed;
  }
  catalog(){const counts=new Map();for(const s of this.last)if(s.theme?.id)counts.set(s.theme.id,(counts.get(s.theme.id)||0)+1);const held=this.held();const unsortedRows=this.last.filter(s=>!s.theme?.id).map(s=>({key:sessionKey(s),title:s.title,suggestions:s.suggestions}));return {themes:this.state.themes.filter(t=>!this.stale(t,held)).map(t=>({...t,count:counts.get(t.id)||0,about:t.purpose?'':themeAbout.about(t,this.last)})).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.name.localeCompare(b.name)),counts:{total:this.last.length,sorted:this.last.length-unsortedRows.length,unsorted:unsortedRows.length},unsorted:unsortedRows,workScan:this.scanner.status(),...(this.error?{error:this.error}:{})};}
  change(b){
    const next=structuredClone(this.state),name=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>120||/[\x00-\x1f\x7f]/.test(value))throw Error('Use a theme name of 1 to 120 characters.');return value.trim();},color=value=>{if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw Error('Use a six-digit hex color.');return value.toLowerCase();};
    if(b.op==='create'){const theme={id:crypto.randomUUID(),name:name(b.name),color:b.color?color(b.color):null,colorSource:b.color?'owner':'automatic',pinned:false,archived:false,mainFolder:typeof b.mainFolder==='string'?b.mainFolder.slice(0,2048):'',created:new Date().toISOString()};next.themes.push(theme);this.colors(next);this.save(next);return theme;}
    const t=this.find(b.id,next);if(!t)throw Error('Unknown theme.');
    switch(b.op){
      case 'mainFolder':{const known=require('./theme-brief').folders(t,this.last);if(typeof b.mainFolder!=='string'||!known.some(f=>path.resolve(f).toLowerCase()===path.resolve(b.mainFolder).toLowerCase())||!fs.statSync(b.mainFolder).isDirectory())throw Error('Choose an available folder already in this theme.');t.mainFolder=path.resolve(b.mainFolder);break;}
      case 'note':if(typeof b.note!=='string'||b.note.length>2000||/[\x00-\x08\x0b-\x1f\x7f]/.test(b.note))throw Error('Use a short theme note of up to 2000 characters.');t.note=b.note.trim();break;
      case 'purpose':if(typeof b.purpose!=='string'||b.purpose.length>500||/[\x00-\x1f\x7f]/.test(b.purpose))throw Error('Use a one-line purpose of up to 500 characters.');t.purpose=b.purpose.trim();break;
      case 'rename':t.name=name(b.name);t.renamed=true;break;
      case 'color':t.color=color(b.color);t.colorSource='owner';break;
      case 'pin':case 'archive':{const field=b.op==='pin'?'pinned':'archived';if(typeof b[field]!=='boolean')throw Error('Provide '+field+' as true or false.');t[field]=b[field];break;}
      case 'merge':case 'delete':{
        const target=b.op==='merge'?this.find(b.into,next):null;if(b.op==='merge'&&(!target||target.id===t.id))throw Error('Choose a different destination theme.');
        next.themes=next.themes.filter(x=>x.id!==t.id);
        for(const a of Object.values(next.assignments))if(a.themeId===t.id)a.themeId=target?.id||null;
        for(const k of Object.keys(next.folders))if(next.folders[k]===t.id)next.folders[k]=target?.id||null;
        for(const h of Object.values(next.inherited||{}))if(h.id===t.id)h.id=target?.id||null;
        break;
      }
      default:throw Error('Unknown theme operation.');
    }
    this.save(next);return {ok:true};
  }
  assign(keys,themeId,accept=false){
    if(!Array.isArray(keys)||!keys.length||keys.length>500||keys.some(k=>typeof k!=='string'))throw Error('Choose 1 to 500 sessions.');
    if(!accept&&themeId!==null&&!this.find(themeId))throw Error('Unknown theme.');
    const byKey=new Map();for(const s of this.last)for(const key of [sessionKey(s),...(s.aliases||[])])byKey.set(key,s);
    const selected=keys.map(k=>{const s=byKey.get(k);if(!s)throw Error('Unknown session. Refresh the session list.');return s;});
    const next=structuredClone(this.state);let assigned=0;
    for(const s of new Set(selected)){const id=accept?s.suggestions?.[0]?.themeId:themeId;if(id===undefined)continue;for(const key of [sessionKey(s),...(s.aliases||[])])next.assignments[key]={themeId:id,by:'owner',at:Date.now()};assigned++;}
    this.save(next);return {assigned,skipped:new Set(selected).size-assigned};
  }
  recordParent(key,parent,relation='fork') {if(key===parent||!/^\w+:[\w-]{1,128}$/.test(key)||!/^\w+:[\w-]{1,128}$/.test(parent)||!['fork','continuation'].includes(relation))throw Error('Invalid parent session.');const next=structuredClone(this.state);next.parents[key]={key:parent,relation};this.save(next);}
}
module.exports={Themes,prettify,words,PALETTE,PALETTE_OKLCH};
