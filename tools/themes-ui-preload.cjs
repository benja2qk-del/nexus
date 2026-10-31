'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),Module=require('module');
const root=fs.realpathSync(process.env.NEXUS_REDESIGN_FIXTURE||'');
if(!['4790','4791'].includes(process.env.NEXUS_PORT)||!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep)||!path.basename(root).startsWith('nexus-redesign-'))throw Error('Unsafe themes UI fixture');
const sessions=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),single=process.env.NEXUS_THEMES_UI_SINGLE==='1',native=Module._load;
const log=(name,row)=>fs.appendFileSync(path.join(root,name+'.jsonl'),JSON.stringify(row)+'\n');
const agents=require('../agents');agents.publicStatus=agents.refresh=()=>({claude:{installed:!single},astra:{installed:!single},copilot:{installed:true}});agents.launch=(kind,args)=>({file:'fixture-'+kind,args});agents.summaryProvider=()=>({kind:single?'copilot':'claude',model:'fixture',note:'One explicit fixture summary; no model call.'});
Module._load=function(name){if(name!=='@lydell/node-pty')return native.apply(this,arguments);return {spawn(file,args,options){
 if(!options.cwd.startsWith(root+path.sep))throw Error('Only fixture folders may launch');log('spawns',{file,args});
 const s=sessions.find(s=>args.includes(s.id));let onData=()=>{},onExit=()=>{},paste='';const idle='\u276f \n? for shortcuts';
 const paint=value=>onData('\x1b[2J\x1b[H'+value.replace(/\n/g,'\r\n'));
 setTimeout(()=>paint(s?.status==='needs-you'?'Do you want to proceed?\n1. Yes\n2. No\nEnter to confirm':s?.status==='working'?'Working...\nEsc to interrupt':idle),25);
 return {pid:999999,onData:f=>onData=f,onExit:f=>onExit=f,resize(){},kill(){onExit({exitCode:0});},write(value){log('writes',{value});paste+=value;if(value==='\r'){if(paste.includes('/fork'))paint('Forked from 11111111-1111-4111-8111-111111111111 as "fixture" (44444444-4444-4444-8444-444444444444).\n'+idle);else paint(idle);paste='';}}};
 }};};
const terms=require('../terms');terms.linkSessions=()=>{};
for(const s of sessions.filter(s=>['working','needs-you'].includes(s.status)))terms.open({kind:s.kind,cwd:s.cwd,sessionKey:s.kind+':'+s.id,title:s.title,claudeArgs:['--resume',s.id],codexArgs:['resume',s.id],copilotArgs:['--resume',s.id]});
const recycle=require('../session-recycle'),Base=recycle.Queue;
recycle.Queue=class extends Base{constructor(options){super({...options,perform:async items=>{log('recycle-stub',items);return {recycled:items.length};}});}};
// Display-only evidence for TEMP histories (production deliberately ignores TEMP roots).
const {Themes}=require('../themes'),decorate=Themes.prototype.decorate;
Themes.prototype.decorate=function(list,...args){const result=decorate.call(this,list,...args);for(const s of list){s.workFolders=[{path:'D:\\fixture-projects\\'+(s.theme.id||'inbox'),weight:5}];if(s.kind!=='copilot')s.costUSD=2.4;}return result;};
require('../recap').summarizeTheme=async(theme,sessions)=>{log('summary-calls',{theme:theme.id,keys:sessions.map(s=>s.kind+':'+s.id)});return {bullets:['The conversations share a release checklist.','The documentation check finished.','The review is still running.'],next:'Next: review the remaining checks.',partial:true};};
const child=require('child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync'])child[key]=()=>{throw Error('Real processes, models and recycling are blocked in this fixture');};
