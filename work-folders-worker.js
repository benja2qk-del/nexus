'use strict';
const {parentPort,workerData}=require('worker_threads');
const {WorkScanner,createRoots,nexusGroup}=require('./work-folders');
const {rootOptions,cacheFile,readOnly}=workerData;
const roots=createRoots({...rootOptions,groupOf:p=>nexusGroup(p,rootOptions.home)});
let publishing=null;const requested=new Map();
const scanner=new WorkScanner({roots,cacheFile,readOnly,initialBytes:0,onUpdate:schedule});
function publish(){
  publishing=null;
  const results=[...requested].map(([file,r])=>{const s=scanner.cache.get(file);return [file,s?{kind:s.kind,launch:s.launch,hasCwd:s.hasCwd,roots:[...s.roots.values()],basenames:[...s.names],parent:s.parent,partial:s.offset<s.size||s.carryBytes>0}:{kind:r.kind,launch:r.cwd,roots:[],basenames:[],parent:null,partial:false,unavailable:true}];});
  parentPort.postMessage({results,status:scanner.status()});
}
function schedule(){if(!publishing)publishing=setTimeout(publish,25);}
parentPort.on('message',requests=>{for(const r of requests){requested.set(r.file,r);try{scanner.read(r.file,r.kind,r.cwd);}catch{}}schedule();});
