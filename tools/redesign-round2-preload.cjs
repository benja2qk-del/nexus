'use strict';
require('./redesign-preload.cjs');
const fs=require('fs'),path=require('path'),root=process.env.NEXUS_REDESIGN_FIXTURE;
// Factual post-message activity exercises every recap tile, chip and error state.
const dashboard=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).find(s=>s.id==='s-dashboard');
const records=fs.readFileSync(dashboard.file,'utf8').trim().split('\n').map(JSON.parse),at=records.findLastIndex(r=>r.type==='user'&&typeof r.message?.content==='string');
const activity=[];let sequence=0;
const call=(name,input,error=false)=>{const id='round2-activity-'+(++sequence),timestamp=new Date(Date.parse(records[at].timestamp)+sequence*1000).toISOString();activity.push({type:'assistant',timestamp,message:{content:[{type:'tool_use',id,name,input}]}},{type:'user',timestamp,message:{content:[{type:'tool_result',tool_use_id:id,content:error?'Exit code: 1. Old home snapshot needs updating.':'Completed',is_error:error}]}});};
for(const file of ['HomeView.tsx','SessionCard.tsx','Orbit.tsx'])call('Edit',{file_path:file,old_string:'return previous;',new_string:'return updated;'});
call('Bash',{command:'npm run typecheck'});call('Bash',{command:'npm test -- home'},true);call('WebFetch',{url:'https://developer.apple.com/design/human-interface-guidelines'});call('Astra',{task:'Review the layout'});
records.splice(at+1,0,...activity);fs.writeFileSync(dashboard.file,records.map(JSON.stringify).join('\n')+'\n');
const recap=require('../recap');let calls=0;
recap.summarize=async s=>{calls++;fs.appendFileSync(path.join(root,'summary-calls.jsonl'),JSON.stringify({id:s.id})+'\n');await new Promise(r=>setTimeout(r,1200));if(fs.existsSync(path.join(root,'summary-fail')))throw Error('Could not reach Haiku. Check the PC connection, then try again.');const data=recap.instant(s);return{bullets:['The home layout and session cards were updated.','The test run found one outdated home snapshot.','The session store still sorts by creation time.'],next:'Needs you: Choose whether to fix the store order or only the view.',size:data.size,mtime:data.mtime,costUSD:.0012,costNote:'One fixture Haiku request.',cached:false};};
const voice=require('../voice'),core=require('../public/voice-core');
voice.createVoiceService=()=>({handle(req,res,route){const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{if(route.endsWith('transcribe')){setTimeout(()=>{const fail=fs.existsSync(path.join(root,'voice-fail'));res.writeHead(fail?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(fail?{error:'Local transcription is unavailable.'}:{text:'Testing one two three',elapsedMs:800}));},1200);}else{const samples=Float32Array.from({length:8000},(_,i)=>.1*Math.sin(i*2*Math.PI*440/16000));res.writeHead(200,{'Content-Type':'audio/wav'});res.end(Buffer.from(core.encodeWav([samples],16000)));}});}});
