'use strict';
// Read every reachable Git blob. Reports locations and categories, never matched values.
const fs=require('fs'),path=require('path'),os=require('os'),{execFileSync,spawn}=require('child_process');
const git=(args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
const identities=[...new Set(git(['log','--all','--format=%ae%n%ce']).split(/\r?\n/).filter(x=>x.includes('@')&&!/noreply|example\.|anthropic|openai/i.test(x)))];
const owner=path.basename(os.homedir()),personalPath=new RegExp('(?:[A-Z]:[\\\\/]+Users[\\\\/]+|/Users/)'+owner.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
const entries=git(['rev-list','--objects','--all']).trim().split(/\r?\n/).map(l=>{const i=l.indexOf(' ');return {oid:i<0?l:l.slice(0,i),name:i<0?'':l.slice(i+1)}}),names=new Map(entries.map(e=>[e.oid,e.name]));
const findings=[],categories=new Map();let blobs=0,bytes=0,binary=0;
const p=spawn('git',['cat-file','--batch'],{windowsHide:true,stdio:['pipe','pipe','inherit']});let buf=Buffer.alloc(0),header=null,remaining=0,parts=[];
function inspect(h,b){if(!['blob','commit','tag'].includes(h.type))return;if(h.type==='blob')blobs++;bytes+=h.size;const name=names.get(h.oid)||'('+h.type+' metadata)';if(b.includes(0)){binary++;return;}const text=b.toString('utf8'),hits=[];
 if(identities.some(e=>text.toLowerCase().includes(e.toLowerCase())))hits.push('personal email');
 if(/\bdesktop-[a-z0-9]{7}\b|\btail[a-f0-9]{6}\b/i.test(text))hits.push('personal tailnet host');
 if(personalPath.test(text))hits.push('personal absolute path');
 if(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/.test(text))hits.push('credential-shaped value');
 if(/"(?:token|secret|deviceSecret)"\s*:\s*"[A-Za-z0-9_+\/-]{28,}"/.test(text))hits.push('device or token-shaped value');
 if(hits.length){findings.push({oid:h.oid,file:name,categories:hits});for(const hit of hits){if(!categories.has(hit))categories.set(hit,new Set());categories.get(hit).add(name);}}
}
p.stdout.on('data',d=>{buf=Buffer.concat([buf,d]);for(;;){if(!header){const end=buf.indexOf(10);if(end<0)break;const line=buf.subarray(0,end).toString();buf=buf.subarray(end+1);const [oid,type,size]=line.split(' ');if(!size)continue;header={oid,type,size:+size};remaining=+size;parts=[];}
 if(remaining){const n=Math.min(remaining,buf.length);parts.push(buf.subarray(0,n));buf=buf.subarray(n);remaining-=n;if(remaining)break;}
 if(!buf.length)break;buf=buf.subarray(1);inspect(header,Buffer.concat(parts));header=null;
 }});
p.on('close',code=>{if(code)process.exitCode=code;fs.mkdirSync('.local',{recursive:true});const report={blobs,bytes,binary,authorIdentityCount:identities.length,findings,categories:Object.fromEntries([...categories].map(([k,v])=>[k,[...v].sort()]))};fs.writeFileSync('.local/publishing-history-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({blobs,bytes,binary,authorIdentityCount:identities.length,counts:Object.fromEntries([...categories].map(([k,v])=>[k,v.size]))}));});
p.stdin.end(entries.map(e=>e.oid).join('\n')+'\n');
