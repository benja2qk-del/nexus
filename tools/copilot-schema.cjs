'use strict';
// Schema only: never prints message bodies, paths, IDs, auth values or binary data.
const fs=require('fs'),path=require('path'),os=require('os'),readline=require('readline');
(async()=>{
 const root=path.join(os.homedir(),'.copilot');const seen=new Map();
 for(const name of fs.readdirSync(path.join(root,'session-state'))){const file=path.join(root,'session-state',name,'events.jsonl');if(!fs.existsSync(file))continue;
 for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})){let r;try{r=JSON.parse(line)}catch{continue}if(seen.has(r.type))continue;
 const shape=(x,depth=0)=>x===null?'null':Array.isArray(x)?['array',x.length&&depth<3?shape(x[0],depth+1):null]:typeof x==='object'&&depth<4?Object.fromEntries(Object.entries(x).filter(([k])=>!['base64','data','content','message','text'].includes(k)).map(([k,v])=>[k,shape(v,depth+1)])):typeof x;
 seen.set(r.type,{record:Object.keys(r),data:shape(r.data)});
 }}console.log(JSON.stringify(Object.fromEntries(seen),null,2));
 const c=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').split('\n').filter(l=>!l.trim().startsWith('//')).join('\n'));console.log(JSON.stringify({recentModelIds:c.recentModelIds,userFieldNames:(c.loggedInUsers||[]).map(x=>Object.keys(x))}));
})();
