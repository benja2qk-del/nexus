'use strict';
const fs=require('fs'),path=require('path');
function fixture(single=false){
 const f=require('./redesign-fixture.cjs').fixture({review:true}),manifest=JSON.parse(fs.readFileSync(path.join(f.root,'manifest.json')));
 const themes=[{id:'nexus',name:'NEXUS',color:'#87b9cf',purpose:'A calm place to pick up every conversation.',pinned:true},{id:'release',name:'Release readiness',color:'#c5a5df',purpose:'Make each preview ready to share.'},{id:'research',name:'Research and experiments',color:'#dca0bb',purpose:'Test ideas and keep the useful findings.'}];
 const assignments={};
 for(const [i,s]of manifest.entries()){
  const t=themes[i%3],cwd=path.join(f.root,'work',t.id);fs.mkdirSync(path.join(cwd,'.git'),{recursive:true});t.mainFolder=cwd;
  let text=fs.readFileSync(s.file,'utf8').replaceAll(JSON.stringify(s.cwd).slice(1,-1),JSON.stringify(cwd).slice(1,-1));s.cwd=cwd;fs.writeFileSync(s.file,text);
  assignments[s.kind+':'+s.id]={by:'owner',themeId:t.id,at:Date.now()};
 }
 const {IDs}=require('./copilot-fixture.cjs');
 for(const [name,id]of Object.entries(IDs)){
  const file=path.join(f.root,'copilot','session-state',id,'events.jsonl'),cwd=path.join(f.root,'work','release');
  let rows=require('./copilot-fixture.cjs').records(id,cwd);rows[0].data.agentMode='interactive';rows[0].data.reasoningEffort='medium';
  rows.push({type:'model.model_call_success',timestamp:new Date().toISOString(),data:{copilotUsage:{total_nano_aiu:125000000},quotaSnapshots:{premium_interactions:{isUnlimitedEntitlement:false,entitlementRequests:1000,remainingPercentage:73,resetDate:new Date(Date.now()+864000000).toISOString()}}}});
  if(name==='working')rows.push({type:'subagent.started',data:{toolCallId:'review',agentName:'reviewer',agentDisplayName:'Review release checks'}},{type:'subagent.started',data:{toolCallId:'docs',agentName:'docs',agentDisplayName:'Check documentation'}},{type:'subagent.completed',data:{toolCallId:'docs'}},{type:'assistant.turn_start',data:{turnId:'fleet'}});
  fs.writeFileSync(file,rows.map(r=>JSON.stringify({timestamp:new Date().toISOString(),...r})).join('\n')+'\n');
  const title={done:'Release preview checklist',quota:'Release notes and changelog',working:'Preparing the next preview'}[name];
  fs.writeFileSync(path.join(path.dirname(file),'workspace.yaml'),`id: ${id}\ncwd: ${JSON.stringify(cwd)}\nname: ${JSON.stringify(title)}\n`);
  manifest.push({id,kind:'copilot',title,cwd,file,status:name==='working'?'working':'saved',stream:[],model:'gpt-5-mini'});
  assignments['copilot:'+id]={by:'owner',themeId:name==='quota'?'research':'release',at:Date.now()};
 }
 // A standalone inbox example; parent evidence is separate from membership.
 const last=manifest.find(s=>s.kind==='claude'&&s.status==='saved');if(last)assignments['claude:'+last.id].themeId=null;
 if(single){for(const s of manifest.filter(s=>s.kind!=='copilot'))fs.renameSync(s.file,s.file+'.fixture-hidden');}
 const visible=manifest.filter(s=>!single||s.kind==='copilot');if(single)for(const key of Object.keys(assignments))if(!key.startsWith('copilot:'))delete assignments[key];fs.writeFileSync(path.join(f.root,'manifest.json'),JSON.stringify(visible));
 const parents={};const cpDone='copilot:'+IDs.done,cpWork='copilot:'+IDs.working;parents[cpWork]={key:cpDone,relation:'fork'};
 fs.writeFileSync(path.join(f.root,'themes.json'),JSON.stringify({version:1,themes:single?themes.filter(t=>t.id!=='nexus'):themes,assignments,parents,folders:{}}));
 f.env.NEXUS_THEMES_FILE=path.join(f.root,'themes.json');f.env.NEXUS_THEMES_UI_SINGLE=single?'1':'0';f.env.NEXUS_READ_ONLY='0';f.env.NEXUS_TEST_TERMINALS='0';
 return f;
}
module.exports={fixture};
