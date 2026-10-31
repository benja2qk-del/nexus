'use strict';
// "Recent work": what you did lately on this PC, Windows and WSL alike, told as short sentences from data the list already has.
const NX_RECENT_FILES=/\.(?:[cm]?js|jsx|tsx?|css|scss|html?|md|json|ya?ml|toml|xml|py|ipynb|cs|gd|go|rs|java|kt|swift|rb|php|c|cc|cpp|h|hpp|sh|ps1|sql|vue|svelte|csv|txt)$/i;
// WSL shows up as a \\wsl$ or \\wsl.localhost path, or as a Linux path; Git Bash's /c/... is still Windows.
function nxWhere(s){
 for(const p of [s.cwd,s.mainFolder,...(s.workFolders||[]).map(f=>f.path)]){
  if(typeof p!=='string'||!p)continue;
  const unc=/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)/i.exec(p);if(unc)return {wsl:true,label:'WSL · '+unc[1]};
  if(/^\/[a-z]\//i.test(p)||/^[a-z]:[\\/]/i.test(p)||/^\\\\/.test(p))return {wsl:false,label:'Windows'};
  if(p.startsWith('/'))return {wsl:true,label:'WSL'};
 }
 return {wsl:false,label:'Windows'};
}
function nxShortPath(p){const parts=String(p||'').split(/[\\/]+/).filter(Boolean);return parts.slice(-2).join('/');}
function nxRecentFiles(s){return [...new Set((s.touchedFiles||[]).filter(f=>typeof f==='string'&&NX_RECENT_FILES.test(f)).map(f=>f.split(/[\\/]/).pop()))].slice(-3);}
function nxClip(text,n){text=NexusDesign.plainSummary(String(text||''));return text.length>n?text.slice(0,n-1)+'…':text;}
// Agent titles are usually "Verb object" ("Install Nexus and Create Shortcut"); known verbs become "installed Nexus and created shortcut".
const NX_VERBS=new Set('add adjust analyse analyze audit automate build bump calculate change check clean clear compare compile configure connect convert copy count create debug delete deploy design document download draft edit enable explain explore export extract filter find fix format generate implement import improve install integrate investigate list load locate make map merge migrate move optimize organize parse plan polish port prepare publish read rebuild recover refactor remove rename render reorganize repair replace research reset restore restructure review revert rewrite run save scan scrape search set setup ship show simplify sort split start stop summarize sync test track translate troubleshoot tune update upgrade upload validate verify write'.split(' '));
const NX_IRREGULAR={build:['built','building'],find:['found','finding'],make:['made','making'],read:['read','reading'],rebuild:['rebuilt','rebuilding'],run:['ran','running'],set:['set','setting'],setup:['set up','setting up'],write:['wrote','writing'],rewrite:['rewrote','rewriting'],split:['split','splitting'],reset:['reset','resetting']};
const NX_DOUBLE=new Set(['map','plan','ship','stop','debug','scan','commit','submit','swap','trim','zip','drop','tag','log']);
const NX_NAMES=new Set('nexus claude codex astra copilot github git windows wsl linux excel python node powershell vercel tailscale chrome edge iphone android google microsoft'.split(' '));
// form 0 = past ("mapped"), 1 = present participle ("mapping").
function nxVerbForm(verb,form){if(NX_IRREGULAR[verb])return NX_IRREGULAR[verb][form];const stem=NX_DOUBLE.has(verb)?verb+verb.at(-1):verb;if(form)return /[^e]e$/.test(verb)?verb.slice(0,-1)+'ing':stem+'ing';return /[^aeiou]y$/.test(verb)?verb.slice(0,-1)+'ied':/e$/.test(verb)?verb+'d':stem+'ed';}
function nxVerbOf(word){const w=String(word||'').toLowerCase(),ing=/^(.+?)ing$/.exec(w);if(NX_VERBS.has(w))return w;if(ing)for(const v of [ing[1],ing[1]+'e',ing[1].slice(0,-1)])if(NX_VERBS.has(v)&&nxVerbForm(v,1)===w)return v;return null;}
const nxBare=w=>w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').toLowerCase();
// A title word keeps its capital when it is a name: an acronym, a known product, or a word the conversation itself capitalises mid-sentence.
function nxProperWords(s){const out=new Set();for(const t of [s.lastText,s.latestContext,s.firstPrompt,s.lastPrompt])for(const sentence of String(t||'').split(/[.!?\n]+/))for(const w of sentence.trim().split(/\s+/).slice(1))if(/^[^\p{L}]*\p{Lu}/u.test(w))out.add(nxBare(w));return out;}
function nxTitleWord(w,proper){return /\d|^\p{Lu}{2,}|.\p{Lu}/u.test(w)||NX_NAMES.has(nxBare(w))||proper.has(nxBare(w))?w:w.toLowerCase();}
// An all-caps title ("THEMES UI + COPILOT POLISH") reads as "Themes UI + Copilot polish"; short words stay as acronyms.
function nxTitle(s){const t=String(s.title||'').trim();if(/\p{Ll}/u.test(t)||!/\p{Lu}{4}/u.test(t))return t;return t.split(/(\s+)/).map((w,i)=>/^\s+$/.test(w)||w.replace(/[^\p{L}]/gu,'').length<=3?w:NX_NAMES.has(nxBare(w))||i===0?w[0]+w.slice(1).toLowerCase():w.toLowerCase()).join('');}
// Long titles are usually the first prompt itself, not a task name, so they are quoted rather than rephrased.
function nxTaskPhrase(s,form){
 const words=nxTitle(s).split(/\s+/),verb=nxVerbOf(words[0]);if(!verb||words.length<2||words.length>8)return null;
 const proper=nxProperWords(s);
 return [nxVerbForm(verb,form),...words.slice(1).map((w,i,rest)=>{const next=i>0&&nxBare(rest[i-1])==='and'&&nxVerbOf(w);return next?nxVerbForm(next,form):nxTitleWord(w,proper);})].join(' ');
}
const nxPlain=t=>t?NexusDesign.plainSummary(String(t)):'';
// One sentence per session: what was done, what is happening, or what waits for you. Empty sessions have none.
function nxRecentSentence(s){
 const cls=statusLabel(s)[0],named=!nxGenericTitle(s.title),asked=nxPlain(s.lastPrompt||s.firstPrompt),agent=nxMultiAgent()?agentName(s.kind)+' is':'Now';
 if(cls==='ready')return named?`Waiting for you in “${nxTitle(s)}”`:'Waiting for you';
 if(cls==='busy'){const doing=nxTaskPhrase(s,1);return doing?`${agent} ${doing}`:named?`${agent} working on “${nxTitle(s)}”`:asked?`${agent} working on “${nxClip(asked,80)}”`:`${agent} working`;}
 if(cls==='error')return named?`Stopped with an error in “${nxTitle(s)}”`:'Stopped with an error';
 const done=nxTaskPhrase(s,0);
 return done?'You '+done:named?`You worked on “${nxTitle(s)}”`:asked?`You asked “${nxClip(asked,90)}”`:'';
}
function nxRecentItem(s,envs){
 const k=keyOf(s),[cls,label]=statusLabel(s),w=nxWhere(s),files=nxRecentFiles(s),latest=sessionPreview(s),mine=[nxPlain(s.lastPrompt),nxPlain(s.firstPrompt)].includes(latest);
 const result=latest&&!mine?latest:'',meta=[`<time>${esc(nxSince(s.updated))}</time>`,`<span class="nx-rw-status ${cls}">${esc(label)}</span>`,envs?`<span class="nx-rw-env ${w.wsl?'wsl':''}">${esc(w.label)}</span>`:'',files.length?`<span class="nx-rw-files">${files.map(esc).join(', ')}</span>`:''].filter(Boolean).join('<i aria-hidden="true">·</i>');
 return `<li class="nx-rw-item ${cls}"><button class="nx-rw-open" data-recent-open="${esc(k)}" title="${esc(s.title)}"><span class="nx-rw-sentence"><i class="nx-dot ${cls}" aria-hidden="true"></i><strong>${esc(nxRecentSentence(s))}</strong></span>${result?`<span class="nx-rw-result">${esc(nxClip(result,220))}</span>`:''}<span class="nx-rw-meta">${meta}</span></button><button class="nx-rw-catch" data-recent-catchup="${esc(k)}">Catch up</button></li>`;
}
const nxRecentAi={result:null,error:'',running:false};
function nxRecentAiHTML(){
 const {result,error,running}=nxRecentAi;
 if(running)return '<p class="nx-rw-ai-status" role="status"><i class="nx-spinner"></i> Reading your latest sessions…</p>';
 const told=result?`<ul class="nx-rw-ai-list">${result.bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul><p class="nx-rw-ai-next"><b>Next: </b>${esc(result.next.replace(/^(?:Next\s*\/\s*)?(?:needs you|next)\s*:?\s*/i,''))}</p>`:'';
 return `${told}${error?`<p class="nx-rw-ai-status" role="alert">${esc(error)}</p>`:''}${result?'':`<button class="btn" data-recent-summary>${nxIcon('catchup')}What was I doing?</button><p class="nx-rw-ai-note">${esc(state.summarizer?.note||'One request using your agent account.')}</p>`}`;
}
async function nxRecentSummary(keys){
 const paint=()=>{const host=$('#nxRecentAi');if(host)updateHTML(host,nxRecentAiHTML());};
 nxRecentAi.running=true;nxRecentAi.error='';paint();
 try{nxRecentAi.result=(await postNexus('/api/action',{action:'summarize-recent',keys})).result;}
 catch(error){nxRecentAi.error=error.message;}
 finally{nxRecentAi.running=false;paint();}
}
function nxRecentWork(count=10){
 const all=state.sessions.filter(s=>s.parent?.relation!=='delegated').sort((a,b)=>(b.updated||0)-(a.updated||0)),told=all.filter(s=>nxRecentSentence(s)),list=told.slice(0,count),empty=all.slice(0,all.indexOf(list.at(-1))+1).length-list.length;
 const day=told.filter(s=>Date.now()-(s.updated||0)<24*3600e3),names=[...new Set(day.map(s=>s.theme?.name||'Unsorted'))];
 const needs=list.filter(s=>statusLabel(s)[0]==='ready').length,working=list.filter(s=>statusLabel(s)[0]==='busy').length,wsl=list.filter(s=>nxWhere(s).wsl).length;
 const summary=`${day.length?`In the last 24 hours you worked ${names.length===1?`in <b>${esc(names[0])}</b>`:`across <b>${names.length} themes</b>`}.`:'Nothing in the last 24 hours. This is what you did before.'}${[needs?`<b class="needs">${needs} need${needs===1?'s':''} you</b>`:'',working?`<b class="working">${working} working</b>`:'',wsl?`${list.length-wsl} on Windows, ${wsl} in WSL`:''].filter(Boolean).map(t=>' '+t+'.').join('')}`;
 const groups=new Map();for(const s of list){const id=s.theme?.id||'unsorted';if(!groups.has(id))groups.set(id,{theme:s.theme||{name:'Unsorted'},sessions:[]});groups.get(id).sessions.push(s);}
 const body=[...groups.values()].map(g=>`<section class="nx-rw-theme"><h3>${nxThemeTick(g.theme)}<span>${esc(g.theme.name||'Unsorted')}</span><small>${esc(nxSince(g.sessions[0].updated))}</small></h3><ul>${g.sessions.map(s=>nxRecentItem(s,wsl>0)).join('')}</ul></section>`).join('');
 modal(`<div class="nx-recent-work"><h2>Recent work</h2><p class="nx-rw-summary">${summary}</p>${list.length?`<div id="nxRecentAi" class="nx-rw-ai">${nxRecentAiHTML()}</div>`:''}${list.length?'<p class="nx-rw-order">Grouped by theme &middot; latest activity first</p>':''}${list.length?body:'<p class="nx-muted">No sessions yet.</p>'}${empty>0?`<p class="nx-rw-note">${empty} empty session${empty===1?'':'s'} left out.</p>`:''}${told.length>count?`<button class="btn nx-rw-more" data-recent-more="${count+10}">Show 10 more</button>`:''}</div>`);
 $('#modalCard').onclick=e=>{
  const open=e.target.closest('[data-recent-open]'),catchup=e.target.closest('[data-recent-catchup]'),more=e.target.closest('[data-recent-more]');
  if(e.target.closest('[data-recent-summary]'))nxRecentSummary(list.map(keyOf));
  if(open){closeModal();select(open.dataset.recentOpen);}
  else if(catchup){const s=state.byKey.get(catchup.dataset.recentCatchup);if(s){closeModal();select(keyOf(s));recapDialog(s);}}
  else if(more){nxRecentWork(+more.dataset.recentMore);$$('#modalCard .nx-rw-open')[count]?.focus();}
 };
}
// It opens a dialog, so it sits with Commands in the sidebar foot and on Home, not among the views.
const nxRecentInit=initializeRedesign;
initializeRedesign=function(){nxRecentInit();$('.nx-quick [data-nx=palette]')?.insertAdjacentHTML('afterend',`<button data-recent-work aria-haspopup="dialog" title="What you did lately (R)">${nxIcon('catchup')}<span>Recent</span></button>`);};
const nxRecentHome=renderApsis;
renderApsis=function(){const r=nxRecentHome.apply(this,arguments);const head=$('.nx-phone-home-head');if(head&&!head.querySelector('[data-recent-work]'))head.insertAdjacentHTML('beforeend',`<button data-recent-work aria-haspopup="dialog" aria-label="Recent work">${nxIcon('catchup')}<span>Recent</span></button>`);return r;};
const nxRecentCommands=nxCommands;
nxCommands=function(){const list=nxRecentCommands();list.splice(1,0,{label:'Recent work',group:'Actions',hint:'R',icon:'catchup',run:()=>nxRecentWork()});return list;};
document.addEventListener('click',e=>{if(e.target.closest('[data-recent-work]'))nxRecentWork();});
document.addEventListener('keydown',e=>{
 if(e.ctrlKey||e.metaKey||e.altKey||e.repeat||e.key!=='r'&&e.key!=='R'||!state.booted)return;
 if(e.target.closest?.('input,textarea,select,[contenteditable=""],[contenteditable=true],.xterm')||$('#modal').classList.contains('on'))return;
 e.preventDefault();nxRecentWork();
});
