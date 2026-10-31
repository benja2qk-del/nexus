'use strict';
// Scan files that would be published, not ignored local configuration/captures.
const fs=require('fs'),path=require('path'),os=require('os'),{execFileSync}=require('child_process');
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))];
const owner=path.basename(os.homedir());const emails=[...new Set(git(['log','--all','--format=%ae%n%ce']).split(/\r?\n/).filter(x=>x.includes('@')&&!/noreply|example\.|anthropic|openai/i.test(x)))];
const wordFile=path.join(process.env.LOCALAPPDATA||os.homedir(),'NexusDeck','private-words.txt');
const words=fs.existsSync(wordFile)?fs.readFileSync(wordFile,'utf8').split(/\r?\n/).map(w=>w.trim().toLowerCase()).filter(Boolean):[];
const findings=[];let binary=0;
for(const file of files){if(!fs.existsSync(file))continue;const b=fs.readFileSync(file);if(b.includes(0)){binary++;continue;}const s=b.toString('utf8'),kinds=[];
 if(emails.some(e=>s.includes(e)))kinds.push('personal email');
 if(/\bdesktop-[a-z0-9]{7}\b|\btail[a-f0-9]{6}\b/i.test(s))kinds.push('personal hostname');
 if(s.replaceAll('\\\\','\\').toLowerCase().includes(('Users\\'+owner+'\\').toLowerCase())||s.toLowerCase().includes(('/Users/'+owner+'/').toLowerCase()))kinds.push('personal path');
 if(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,})\b/.test(s))kinds.push('credential-shaped value');
 if(/"(?:token|secret|deviceSecret)"\s*:\s*"[A-Za-z0-9_+\/-]{28,}"/.test(s))kinds.push('device/token-shaped value');
 if(words.some(w=>s.toLowerCase().includes(w)))kinds.push('private word');
 if(kinds.length)findings.push({file,categories:kinds});
}
console.log(JSON.stringify({files:files.length,binary,findings},null,2));if(findings.length)process.exitCode=1;
