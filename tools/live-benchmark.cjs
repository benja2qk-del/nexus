'use strict';
// Explicit manual benchmark only. Eight short subscription turns maximum.
const fs=require('fs'),path=require('path'),{Brain}=require('../live-brain');
async function main(){
  if(!process.argv.includes('--run-subscription-benchmark'))throw Error('Pass --run-subscription-benchmark explicitly.');
  const root=path.resolve('.local','live-benchmark');fs.mkdirSync(root,{recursive:true});const report={date:new Date().toISOString(),backends:[]};
  for(const kind of ['codex','claude']){
    const b=new Brain(kind,{root});const result={kind,turns:[]};report.backends.push(result);
    try{await b.start('Synthetic voice benchmark');result.model=b.model;result.catalog=b.catalog?.map(m=>({model:m.model,efforts:m.supportedReasoningEfforts}));
      for(const text of ['Say hello in one short sentence.','Responde en una frase: estoy escuchando.','Say: the tests are running.','Di: listo, te escucho.']){
        const turn=await b.ask(JSON.stringify({owner:text,context:{title:'Synthetic benchmark',status:'ready'}}));result.turns.push(turn);console.log(kind,JSON.stringify(turn));
      }
      if(kind==='codex'){const list=await b.rpc('thread/list',{limit:100});result.hiddenFromThreadList=!list.data.some(t=>t.id===b.thread);}
      result.persistedConversations=[];
      function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.jsonl$/.test(entry.name)&&!/log/i.test(file))result.persistedConversations.push(path.relative(b.isolation.home,file));}}
      walk(b.isolation.home);
    }catch(e){result.error=e.message;console.log(kind,result.error);}finally{await b.close();fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(report,null,2));}
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
