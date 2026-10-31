'use strict';
const fs=require('fs'),path=require('path'),Module=require('module');
if(process.env.NEXUS_PORT!=='4785')throw Error('Live fixtures require port 4785');
const root=process.env.NEXUS_REDESIGN_FIXTURE,load=Module._load;
const log=entry=>fs.appendFileSync(path.join(root,'live-log.jsonl'),JSON.stringify(entry)+'\n');
Module._load=function(name,parent){
  if(name==='./live-brain'&&parent?.filename===path.resolve('live-service.js'))return {async createBrain(){if(fs.readFileSync(path.join(root,'utterance.txt'),'utf8')==='live-unavailable')throw Error('Live voice is unavailable.');log({type:'start'});return {kind:'fixture',model:'fixture',async close(){log({type:'stop'});},async ask(input,delta){
    const data=JSON.parse(input);log({type:'ask',data});let text;
    if(data.event){text=data.context.question?'<say>Choose one, two or three.</say>':data.context.status==='working'?'<say>The agent is running the tests.</say>':'<say>The agent has finished the update.</say>';}
    else if(/^(?:opci[oó]n )?dos[.!]?$/i.test(data.owner))text='<say>La segunda opcion.</say><action>{"type":"answer","option":"2"}</action>';
    else if(/tell|dile/i.test(data.owner))text='<say>I can pass that along.</say><action>'+JSON.stringify({type:'relay',text:/quick/i.test(data.owner)?'Please review a quick question.':'Please review the call.'})+'</action>';
    else text='<say>I am listening while the agent works. You can interrupt me whenever you need.</say>';
    const started=Date.now();for(let i=0;i<text.length;i+=7){delta(text.slice(i,i+7));await new Promise(r=>setTimeout(r,12));}return {ttftMs:12,totalMs:Date.now()-started};
  }};}};
  return load.apply(this,arguments);
};
require('./call-preload.cjs');
