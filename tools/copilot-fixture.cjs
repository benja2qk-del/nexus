'use strict';
const fs=require('fs'),path=require('path');
const IDs={done:'11111111-1111-4111-8111-111111111111',quota:'22222222-2222-4222-8222-222222222222',working:'33333333-3333-4333-8333-333333333333'};
function records(id,cwd){let n=0;const record=(type,data)=>({id:'fixture-event-'+(++n),type,data,timestamp:new Date(Date.now()-60000+n*1000).toISOString()});return [
 record('session.start',{sessionId:id,selectedModel:'gpt-5-mini',startTime:new Date().toISOString(),context:{cwd,gitRoot:cwd,branch:'feature/copilot'}}),
 record('user.message',{content:'Add a clear release checklist and validate the preview.'}),
 record('assistant.turn_start',{turnId:'turn-1'}),
 record('assistant.message',{model:'gpt-5-mini',content:'I will check the release settings and update the checklist.',reasoningText:'The preview should have a small, repeatable release check.',toolRequests:[{toolCallId:'edit-1',name:'edit',arguments:{path:'src/checklist.js',old_str:'draft',new_str:'ready'},intentionSummary:'Update the release checklist',toolTitle:'Edit checklist'}]}),
 record('tool.execution_start',{toolCallId:'edit-1',toolName:'edit',arguments:{path:'src/checklist.js',old_str:'draft',new_str:'ready'},toolTitle:'Edit checklist'}),
 record('tool.execution_complete',{toolCallId:'edit-1',success:true,result:{content:'Updated checklist'}}),
 record('tool.execution_start',{toolCallId:'cmd-1',toolName:'powershell',arguments:{command:'npm test'},toolTitle:'Validate the preview'}),
 record('tool.execution_complete',{toolCallId:'cmd-1',success:true,result:{content:'All fixture checks passed'}}),
 record('session.binary_asset',{assetId:'image-1',data:'PRIVATE_BASE64_DO_NOT_RENDER',mimeType:'image/png'}),
 record('assistant.message',{model:'gpt-5-mini',content:'**The preview is ready.**\n\n- Updated the release checklist.\n- Validation passed.\n- The release is waiting for your review.'}),
 record('assistant.turn_end',{turnId:'turn-1'}),
 record('session.usage_checkpoint',{totalPremiumRequests:0,totalNanoAiu:125000000,modelCacheState:[]}),
 record('session.shutdown',{currentModel:'gpt-5-mini',totalPremiumRequests:0,totalNanoAiu:125000000,tokenDetails:{input:{tokenCount:1000},cache_read:{tokenCount:500},output:{tokenCount:200}},codeChanges:{filesModified:['src/checklist.js'],linesAdded:1,linesRemoved:1}})
 ];}
function setup(root,{reportedCwd}={}){fs.mkdirSync(root,{recursive:true});const work=path.join(root,'Release preview');fs.mkdirSync(work,{recursive:true});const cwd=reportedCwd||work;for(const [kind,id]of Object.entries(IDs)){const dir=path.join(root,'copilot','session-state',id);fs.mkdirSync(dir,{recursive:true});const rows=records(id,cwd);if(kind==='quota')rows.push({type:'user.message',timestamp:new Date().toISOString(),data:{content:'Review the final checklist.'}},{type:'session.error',timestamp:new Date().toISOString(),data:{errorType:'quota',message:'You have exceeded your monthly quota. Check your Copilot account before trying again.'}});if(kind==='working')rows.splice(4);
 fs.writeFileSync(path.join(dir,'events.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');fs.writeFileSync(path.join(dir,'workspace.yaml'),`id: ${id}\ncwd: ${JSON.stringify(cwd)}\ngit_root: ${JSON.stringify(cwd)}\nbranch: feature/copilot\nname: ${JSON.stringify({done:'Release preview checklist',quota:'Quota needs attention',working:'Preparing the next preview'}[kind])}\ncreated_at: ${new Date().toISOString()}\nupdated_at: ${new Date().toISOString()}\n`);
 }return {root,cwd,IDs};}
module.exports={setup,records,IDs};
