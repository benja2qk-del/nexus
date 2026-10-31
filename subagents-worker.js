'use strict';
const {parentPort}=require('worker_threads'),{ActivityIndex}=require('./subagents');
const index=new ActivityIndex({complete:true}),pending=new Map(),registered=new Map(),published=new Map();let scheduled=false;
function drain(){
 scheduled=false;const item=pending.entries().next().value;if(!item)return;const[key,s]=item;pending.delete(key);
 try{const result=index.read(s),signature=JSON.stringify(result);if(signature!==published.get(key)){published.set(key,signature);parentPort.postMessage({key,result});}if(result.more)pending.set(key,s);}catch(e){parentPort.postMessage({key,result:{rows:[],launches:[],partial:true,error:e.message}});}
 if(pending.size){scheduled=true;setImmediate(drain);}
}
parentPort.on('message',s=>{const key=s.kind+':'+s.id;registered.delete(key);registered.set(key,s);if(registered.size>64)registered.delete(registered.keys().next().value);pending.set(key,s);if(!scheduled){scheduled=true;setImmediate(drain);}});
// Child-only writes have no effect on the parent's mtime. Refresh active chains
// between browser polls so their next snapshot already contains the new steps.
setInterval(()=>{for(const [key,s]of registered)if(s.live)pending.set(key,s);if(pending.size&&!scheduled){scheduled=true;setImmediate(drain);}},2000).unref();
