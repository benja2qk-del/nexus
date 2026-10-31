'use strict';
const assert=require('assert/strict'),http=require('http'),{parser,guard,confirmation,context}=require('../live-protocol');
const {vad,barge,updateGate,selectVoice}=require('../public/live-core'),{smallModel}=require('../live-brain'),voice=require('../public/voice-core');
const question={signature:'current',question:'Which change?',options:[{key:'1',label:'First'},{key:'2',label:'Second'},{key:'3',label:'Third'}]};
const stream='<say>Hola. Te escucho.</say><action>{"type":"relay","text":"Check the tests."}</action>';
for(let cut=1;cut<stream.length;cut++){
  const spoken=[],p=parser(t=>spoken.push(t));p.push(stream.slice(0,cut));p.push(stream.slice(cut));assert.deepEqual(spoken,['Hola.','Te escucho.']);assert.equal(p.finish().action.type,'relay');
}
const chars=[],p=parser(t=>chars.push(t));for(const c of stream)p.push(c);assert.equal(p.finish().action.text,'Check the tests.');assert.deepEqual(chars,['Hola.','Te escucho.']);
assert.throws(()=>{const p=parser();p.push('<action>{"type":"relay"}');p.finish();});
assert.throws(()=>{const p=parser();p.push('<action>not json</action>');});
assert.throws(()=>guard({type:'relay',text:'Check tests'},{owner:'status',event:true}));
assert.throws(()=>guard({type:'relay',text:'/model opus'},{owner:'send it'}));
assert.throws(()=>guard({type:'relay',text:'x\x1b'},{owner:'send it'}));
assert.throws(()=>guard({type:'relay',text:'Check tests'},{owner:'status'}));
assert.equal(guard({type:'relay',text:'Delete the folder'},{owner:'Tell the agent to delete the folder'}).type,'confirm');
assert.equal(guard({type:'relay',text:'Borra los archivos'},{owner:'Dile que borre los archivos'}).type,'confirm');
assert.equal(guard({type:'relay',text:'Check tests'},{owner:'Tell the agent to check tests'}).type,'relay');
assert.throws(()=>guard({type:'relay',text:'Check tests'},{owner:'Tell the agent',question}));
assert.equal(confirmation('confirmo',{text:'delete'}).text,'delete');assert.equal(confirmation('yes',{text:'delete'}),null);
for(const [text,key] of [['uno','1'],['opción dos','2'],['tres','3'],['option two','2'],['la segunda','2'],['numero dos por favor','2']]){
  assert.equal(voice.spokenAnswer(text,question),key);assert.equal(guard({type:'answer',option:key},{owner:text,question,signature:'current'}).option,key);
}
assert.throws(()=>guard({type:'answer',option:'1'},{owner:'dos',question,signature:'current'}));
assert.throws(()=>guard({type:'answer',option:'2'},{owner:'dos',question,signature:'old'}));
assert.throws(()=>guard({type:'interrupt'},{owner:'what is happening'}));assert.equal(guard({type:'interrupt'},{owner:'interrumpe'}).type,'interrupt');
let now=0;const v=vad({silenceMs:650});let start,end;for(;now<300;now+=20){const r=v.push(.08,now);if(r.start)start=now;}for(;now<1000;now+=20){const r=v.push(0,now);if(r.end)end=now;}assert.ok(start<=100);assert.ok(end-280>=650&&end-280<=670);
const noise=vad();for(let t=0;t<2000;t+=20)assert.equal(noise.push(t%200===0?.05:0,t).start,false);
const b=barge(),token=b.startSpeech();b.ownerStart();assert.equal(b.valid(token),false);assert.equal(b.startSpeech(),null);b.ownerEnd();assert.ok(b.startSpeech()!==null);
now=0;const gate=updateGate(()=>now,12000);assert.equal(gate.take('a',{owner:true}),false);assert.equal(gate.take('a'),true);now=11000;assert.equal(gate.take('b'),false);now=12000;assert.equal(gate.take('b',{speaking:true}),false);assert.equal(gate.take('b'),true);now=30000;assert.equal(gate.take('b'),false);
assert.equal(selectVoice([{name:'Basic',lang:'es-ES'},{name:'Paulina',lang:'es-MX'}],'es').name,'Paulina');
assert.equal(smallModel([{model:'gpt-6-astra'},{model:'gpt-5.6-luna'}]).model,'gpt-5.6-luna');
assert.ok(!JSON.stringify(context({title:'Test',kind:'claude'},{events:[{t:'ai',text:'```secret code``` hello C:\\private\\file.txt'}]})).includes('secret code'));
console.log('PASS live protocol at every split and character; malformed/partial refusal; relay and destructive confirmation; fresh explicit choices; VAD 650 ms; barge epochs; update throttle; voices and small model');
async function serviceChecks(){
  const {createLiveService}=require('../live-service');let starts=0,stops=0,asks=0,actions=[],output='<say>Te escucho.</say>',hold=null;
  const state={session:{title:'Synthetic',kind:'claude'},chat:{terminal:{ready:true},events:[]}};
  const service=createLiveService({snapshot:()=>state,send:async(key,action)=>actions.push({key,...action}),brainFactory:async()=>{starts++;return {kind:'stub',model:'stub',close:async()=>{stops++;},ask:async(input,delta)=>{asks++;if(hold)await hold;for(const c of output)delta(c);return {ttftMs:10,totalMs:20};}};}});
  const server=http.createServer((req,res)=>service.handle(req,res,req.url,req.headers['x-device']||'local',()=>true));await new Promise((r,j)=>{server.once('error',j);server.listen(Number(process.env.NEXUS_TEST_PORT)||4786,'127.0.0.1',r);});const url='http://127.0.0.1:'+server.address().port;
  const post=async(route,body,device='local')=>{const r=await fetch(url+'/api/live/'+route,{method:'POST',headers:{'x-device':device},body:JSON.stringify(body)});return {status:r.status,text:await r.text()};};
  try{
    assert.equal(starts,0);const opened=JSON.parse((await post('start',{key:'claude:fixture'})).text),id=opened.id;assert.equal(starts,1);
    assert.equal((await post('turn',{id,text:'Hola'},'other')).status,400);assert.equal(asks,0);
    await post('turn',{id,text:'Hola'});assert.equal(asks,1);assert.equal(actions.length,0);
    await post('turn',{id,event:true});assert.equal(asks,1,'unchanged context has no automatic spend');
    output='<say>Voy a transmitirlo.</say><action>{"type":"relay","text":"Check the tests."}</action>';
    await post('turn',{id,text:'Tell the agent to check the tests.'});assert.equal(actions[0].key,'claude:fixture');
    output='<say>Confirma primero.</say><action>{"type":"relay","text":"Delete the folder."}</action>';
    await post('turn',{id,text:'Tell the agent to delete the folder.'});assert.equal(actions.length,1);
    await post('turn',{id,text:'confirmo'});assert.equal(actions.length,2);
    let release;hold=new Promise(r=>release=r);output='<say>Sending.</say><action>{"type":"relay","text":"Check again."}</action>';
    const pending=post('turn',{id,text:'Tell the agent to check again.'});await new Promise(r=>setTimeout(r,40));await post('cancel',{id});release();await pending;assert.equal(actions.length,2,'barge cancellation prevents late relay');hold=null;
    await post('stop',{id});assert.equal(stops,1);assert.equal(service.size,0);assert.equal((await post('turn',{id,text:'hello'})).status,400);
    console.log('PASS call-bound HTTP lifecycle; device ownership; context dedupe; confirmed delivery; cancelled-turn action suppression; no model process outside a call');
  }finally{await service.close();await new Promise(r=>server.close(r));}
}
async function backendChecks(){
  const {Brain,isolated}=require('../live-brain'),{EventEmitter}=require('events'),{PassThrough,Writable}=require('stream'),fs=require('fs'),path=require('path'),os=require('os');
  for(const kind of ['codex','claude']){
    let spawned=0,cleaned=0,args,turns=0;
    const brain=new Brain(kind,{isolate:()=>({work:'.',env:{},cleanup(){cleaned++;}}),launch:(k,a)=>(args=a,{file:'fixture',args:a}),spawn(file,a,opts){
      assert.equal(opts.windowsHide,true);spawned++;const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();
      const emit=m=>{const bytes=Buffer.from(JSON.stringify(m)+'\n');for(let i=0;i<bytes.length;i+=3)p.stdout.write(bytes.subarray(i,i+3));};
      p.stdin=new Writable({write(bytes,encoding,done){for(const line of String(bytes).trim().split('\n')){const m=JSON.parse(line);
        if(m.method==='initialize')queueMicrotask(()=>emit({id:m.id,result:{}}));
        if(m.method==='model/list')queueMicrotask(()=>emit({id:m.id,result:{data:[{model:'gpt-5.6-luna',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]}}));
        if(m.method==='thread/start'){assert.equal(m.params.ephemeral,true);assert.equal(m.params.config['tools.disable_defaults'],true);queueMicrotask(()=>emit({id:m.id,result:{thread:{id:'fixture'}}}));}
        if(m.method==='turn/start'||m.type==='user'){turns++;queueMicrotask(()=>{const reply='<say>Hola, ¿qué tal?</say>';if(kind==='codex'){emit({id:m.id,result:{turn:{id:'turn'}}});emit({method:'item/agentMessage/delta',params:{delta:reply}});emit({method:'turn/completed',params:{turn:{status:'completed'}}});}else{emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:reply}}});emit({type:'result',result:reply});}});}
      }done();}});p.kill=()=>{p.emit('close',0);};queueMicrotask(()=>p.emit('spawn'));return p;
    }});
    await brain.start('Fixture');for(let i=0;i<2;i++){let text='';await brain.ask('Hello',s=>text+=s);assert.equal(text,'<say>Hola, ¿qué tal?</say>');}
    assert.equal(spawned,1);assert.equal(turns,2);if(kind==='claude')for(const flag of ['--safe-mode','--no-session-persistence','--strict-mcp-config','--include-partial-messages','claude-haiku-5-5'])assert.ok(args.includes(flag));await brain.close();assert.equal(cleaned,1);
  }
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-live-unit-')),source=path.join(root,'source');fs.mkdirSync(source);const saved={CODEX_HOME:process.env.CODEX_HOME,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR};
  process.env.CODEX_HOME=source;process.env.CLAUDE_CONFIG_DIR=source;
  try{
    fs.writeFileSync(path.join(source,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'synthetic'}}));fs.writeFileSync(path.join(source,'.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'synthetic'}}));
    for(const kind of ['codex','claude']){const isolatedHome=isolated(kind,path.join(root,'calls'));assert.ok(isolatedHome.home.startsWith(root));assert.equal(isolatedHome.env.OPENAI_API_KEY,undefined);assert.equal(isolatedHome.env.ANTHROPIC_API_KEY,undefined);assert.ok(!fs.existsSync(path.join(isolatedHome.home,'sessions')));isolatedHome.cleanup();}
    fs.unlinkSync(path.join(source,'auth.json'));assert.throws(()=>isolated('codex',path.join(root,'calls')));assert.deepEqual(fs.readdirSync(path.join(root,'calls')),[],'failed startup removes private directory');
  }finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('nexus-live-unit-'));fs.rmSync(resolved,{recursive:true,force:true});}
  console.log('PASS both persistent backend adapters with fragmented UTF-8; isolated subscription-only auth; disabled tools; ephemeral Codex; exact Haiku flags; one process per call; failed-start cleanup');
}
(async()=>{await serviceChecks();await backendChecks();await require('./voice-language-checks.cjs').run();})().catch(e=>{console.error(e);process.exitCode=1;});
