'use strict';
// Refresh only the confirmation parser inside the already-owned throwaway server.
// Keeps the one permitted Claude process alive; no extra CLI or paid turn is started.
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
async function main(){
 const record=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'nexus-redesign-model-pointer.json'),'utf8'));
 if(record.closed||!record.root.startsWith(path.join(os.tmpdir(),'nexus-redesign-live-model-')))throw Error('Not an active owned test');
 if(process.argv[2]!=='resume'){await new Promise((r,j)=>{const probe=net.createServer();probe.once('error',j);probe.listen(9229,'127.0.0.1',()=>probe.close(r));});process._debugProcess(record.server);}
 let tabs;for(let i=0;i<30;i++){try{tabs=await(await fetch('http://127.0.0.1:9229/json')).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
 if(tabs?.[0]?.title!=='server.js')throw Error('Unexpected debug target');
 const socket=new WebSocket(tabs[0].webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 const result=await new Promise(resolve=>{socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1)resolve(m)};socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:`(()=>{if(process.pid!==${record.server}||process.env.NEXUS_TEST_TERMINALS!=='1')throw Error('Wrong process');const req=process.mainModule.require.bind(process.mainModule),file=req('path').join(process.cwd(),'models.js'),cache=req('module')._cache,old=cache[file].exports;delete cache[file];Object.assign(old,req(file));return 'Owned test parser refreshed';})()`,returnByValue:true}}));});
 if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));console.log(result.result.result.value);
 socket.send(JSON.stringify({id:2,method:'Runtime.evaluate',params:{expression:`setTimeout(()=>process.mainModule.require('inspector').close(),100)`}}));socket.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
