'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const data=require('./fixtures/redesign/reference-data.json');
function fixture({review=false}={}){
 const port=process.env.NEXUS_FIXTURE_PORT||'4791';
 if(!['4785','4786','4787','4788','4791'].includes(port))throw Error('Private fixture ports only');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-redesign-'));
 const claude=path.join(root,'claude'),codex=path.join(root,'codex');
 for(const folder of [path.join(claude,'projects'),path.join(claude,'sessions'),path.join(codex,'sessions'),path.join(root,'work')])fs.mkdirSync(folder,{recursive:true});
 const manifest=[];
 for(const s of data.sessions){
  const cwd=data.projects.find(p=>p.id===s.projectId).path,kind=s.agent==='codex'?'astra':'claude';
  const model=kind==='claude'?'claude-'+s.modelId.replaceAll('.','-'):s.modelId;
  const folder=kind==='claude'?path.join(claude,'projects',cwd.replace(/[^A-Za-z0-9]/g,'-')):path.join(codex,'sessions');fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,(kind==='claude'?'':'rollout-')+s.id+'.jsonl');
  let records=kind==='claude'?[{type:'user',cwd,gitBranch:s.details.branch,message:{content:s.purpose}},{type:'custom-title',customTitle:s.title}]:[{type:'session_meta',payload:{id:s.id,cwd,git:{branch:s.details.branch}}},{type:'turn_context',payload:{model}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:s.purpose}]}}];
  const push=(role,content)=>records.push(kind==='claude'?{type:role,cwd,gitBranch:s.details.branch,message:{model,content,usage:role==='assistant'?{input_tokens:1200,output_tokens:700,cache_read_input_tokens:8000}:undefined}}:{type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text:typeof content==='string'?content:content.filter(x=>x.type==='text').map(x=>x.text).join('\n')}]}});
  for(const item of s.stream){
   if(item.kind==='user')push('user',item.text);
   if(item.kind==='reply')push('assistant',[{type:'text',text:item.markdown}]);
   if(item.kind==='thinking')records.push(kind==='claude'?{type:'assistant',message:{model,content:[{type:'thinking',thinking:item.text,duration_seconds:item.seconds}]}}:{type:'response_item',payload:{type:'reasoning',summary:[{text:item.text}],duration_seconds:item.seconds}});
   if(item.kind==='tools')for(const [i,t] of item.items.entries()){
    const id=item.id+'-'+i,name={edit:'Edit',run:'Bash',browse:'WebFetch',read:'Read'}[item.icon];
    const input=item.icon==='edit'?{file_path:t.target,old_string:'  return legacy();',new_string:'  const result = await run(opts);\n  return result;'}:item.icon==='run'?{command:t.target}:{file_path:t.target,url:t.target};
    records.push(kind==='claude'?{type:'assistant',message:{model,content:[{type:'tool_use',name,id,input}]}}:{type:'response_item',payload:{type:'function_call',name:item.icon==='run'?'functions.exec_command':'Read',call_id:id,arguments:JSON.stringify(input)}});
    records.push(kind==='claude'?{type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:t.detail||'Completed'}]}}:{type:'response_item',payload:{type:'function_call_output',call_id:id,output:t.detail||'Completed'}});
   }
  }
  if(!s.stream.some(i=>i.kind==='reply'))push('assistant',[{type:'text',text:s.sinceLast}]);
  if(kind==='astra')records.push({type:'event_msg',payload:{type:s.status==='working'?'task_started':'task_complete'}});
  const now=Date.now();records=records.map((r,i)=>({timestamp:new Date(now-Math.max(0,records.length-i)*60000).toISOString(),...r}));
  fs.writeFileSync(file,records.map(JSON.stringify).join('\n')+'\n');
  const stamp=new Date(Date.now()-s.updatedMinutes*60000);fs.utimesSync(file,stamp,stamp);
  manifest.push({...s,kind,model,cwd,file});
 }
 fs.writeFileSync(path.join(codex,'session_index.jsonl'),manifest.filter(s=>s.kind==='astra').map(s=>JSON.stringify({id:s.id,thread_name:s.title,updated_at:new Date().toISOString()})).join('\n'));
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(root,'devices.json'),JSON.stringify(Object.fromEntries(['iPhone 17 Pro','iPad Air','Work laptop'].map((name,i)=>[String(i+1).repeat(64),{name,created:Date.now()-(i+1)*86400000,lastSeen:Date.now()-i*86400000}]))));
 fs.writeFileSync(path.join(claude,'nexus-usage.json'),JSON.stringify({at:Date.now(),data:{rate_limits:{five_hour:{used_percentage:34,resets_at:Date.now()/1000+3*3600},seven_day:{used_percentage:55,resets_at:Date.now()/1000+5*86400}}}}));
 if(review){
  require('./copilot-fixture.cjs').setup(root,{reportedCwd:'D:\\dev\\release-preview'});
  const astra=manifest.find(s=>s.kind==='astra');fs.appendFileSync(astra.file,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'token_count',rate_limits:{secondary:{used_percent:27,window_minutes:10080,resets_at:Date.now()/1000+3*86400}}}})+'\n');
 }
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({remoteHost:'nexus.fixture.test',remoteUser:'owner@example.test',models:{claude:['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'],astra:['gpt-6-astra','gpt-5.5','gpt-5.4-mini'],copilot:['gpt-6-luna','gpt-5-mini']}}));
 const env={...process.env,NEXUS_PORT:port,NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_CLAUDE_DIR:claude,CLAUDE_CONFIG_DIR:claude,NEXUS_CODEX_DIR:codex,NEXUS_COPILOT_DIR:path.join(root,'copilot'),NEXUS_CONFIG_FILE:path.join(root,'config.json'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_UPLOAD_DIR:path.join(root,'uploads'),NEXUS_REDESIGN_FIXTURE:root,LOCALAPPDATA:root};
 return{root,env};
}
module.exports={fixture};
