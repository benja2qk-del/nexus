'use strict';
const fs=require('fs'),path=require('path'),{createVoiceService,validateWav}=require('../voice');
(async()=>{const root=path.resolve('.local','live-audio'),service=createVoiceService({tempRoot:path.join(root,'tts-turns')}),rows=[];try{const startup=performance.now();await service.startCall();const startupMs=performance.now()-startup;
  for(const text of ['I am listening.','The tests are running.','I relayed your request.']){const at=performance.now(),wav=await service.tts(text,'en');validateWav(wav);rows.push({text,ms:performance.now()-at,bytes:wav.length});}
  fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'warm-tts.json'),JSON.stringify({startupMs,rows},null,2));console.log({startupMs,rows});
}finally{await service.stopCall();}})().catch(e=>{console.error(e);process.exitCode=1;});
