'use strict';
// One plain sentence saying what a theme's project is, read from the files a project already keeps:
// package.json or pyproject.toml descriptions, the opening of the README, CLAUDE.md, AGENTS.md or PROJECT_CONTEXT.md
// (before its first section), or a Godot project's name.
const fs=require('fs'),path=require('path');
const SOURCES=['package.json','pyproject.toml','README.md','CLAUDE.md','AGENTS.md','PROJECT_CONTEXT.md','project.godot'],TTL=5*60e3,MAX=256*1024,cache=new Map();
const META=/\b(instructions?|orientation|last updated|table of contents|getting started|this file|read me)\b/i;
function plain(s){return String(s).replace(/<[^>]+>/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim();}
function sentence(s){s=plain(s).replace(/^[^\p{L}\p{N}"'(]+/u,'');const m=s.match(/^(.{24,}?[.!?])(?=\s|$)/);s=m?m[1]:s;if(s.length>160)s=s.slice(0,157).replace(/[\s,;:—–-]+\S*$/,'')+'…';return s.charAt(0).toUpperCase()+s.slice(1);}
const good=s=>s&&s.split(/\s+/).length>=4&&!META.test(s);
function fromMarkdown(text){
 const paras=[];let fence=false,cur=[];const flush=()=>{if(cur.length)paras.push(cur.join(' '));cur=[];};
 for(const line of text.replace(/\r/g,'').split('\n')){
  if(/^\s*(```|~~~)/.test(line)){fence=!fence;flush();continue;}if(fence)continue;
  const h=line.match(/^(#{1,6})\s+(.*)/);if(h){flush();if(h[1].length>1)break;const tag=h[1].length===1&&h[2].split(/\s+[—–]\s+|\s+-\s+/).slice(1).join(' — ');if(tag)paras.push(tag);continue;}
  if(!line.trim()||/^\s*([-*+>|@<]|\d+[.)]\s|!\[|\[!\[|\[\^)/.test(line)){flush();continue;}
  cur.push(line.trim());
 }
 flush();for(const p of paras.slice(0,8)){const s=sentence(p);if(good(s))return s;}return '';
}
function fromFile(folder,name){
 const file=path.join(folder,name);let st;try{st=fs.statSync(file);}catch{return '';}if(!st.isFile()||st.size>MAX)return '';
 const text=fs.readFileSync(file,'utf8');
 if(name==='package.json'){try{const d=JSON.parse(text).description;return typeof d==='string'&&good(sentence(d))?sentence(d):'';}catch{return '';}}
 if(name==='pyproject.toml'){const m=text.match(/^description\s*=\s*"([^"\n]+)"/m);return m&&good(sentence(m[1]))?sentence(m[1]):'';}
 if(name==='project.godot'){const d=text.match(/^config\/description="([^"\n]+)"/m),n=text.match(/^config\/name="([^"\n]+)"/m);return d&&good(sentence(d[1]))?sentence(d[1]):n?'Godot project '+n[1].slice(0,60):'';}
 return fromMarkdown(text);
}
function folderAbout(folder){
 const hit=cache.get(folder);if(hit&&Date.now()-hit.at<TTL)return hit.text;
 const own=dir=>{for(const name of SOURCES){try{const text=fromFile(dir,name);if(text)return text;}catch{}}return '';};
 let text=own(folder);
 // A folder that mostly holds copies of one project (worktrees, versions) speaks for it with the most common answer;
 // a bare "Godot project NAME" gives way to a written description that names the same project.
 if(!text){const votes=new Map();try{for(const d of fs.readdirSync(folder,{withFileTypes:true}).filter(d=>d.isDirectory()&&!/^[.$]|^node_modules$/.test(d.name)).slice(0,40)){const t=own(path.join(folder,d.name));if(t)votes.set(t,(votes.get(t)||0)+1);}}catch{}
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]),total=ranked.reduce((n,[,c])=>n+c,0);
  if(ranked.length&&ranked[0][1]/total>=.6){text=ranked[0][0];const name=text.match(/^Godot project (.+)$/)?.[1];if(name)text=ranked.map(([t])=>t).find(t=>!t.startsWith('Godot project ')&&t.toLowerCase().startsWith(name.toLowerCase()))||text;}}
 cache.set(folder,{at:Date.now(),text});return text;
}
// The main folder speaks first, then the folders its sessions worked in.
function about(theme,sessions=[]){
 const folders=require('./theme-brief').folders(theme,sessions).slice(0,8);
 for(const folder of folders){const text=folderAbout(folder);if(text)return text;}
 return '';
}
module.exports={about,fromMarkdown,sentence};
