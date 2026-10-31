'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),{spawn}=require('child_process'),{EventEmitter}=require('events');
const agents=require('./agents'),protocol=require('./live-protocol');
const unavailable=()=>Error('Live voice is unavailable. Continue with turn-by-turn Call, or check the CLI sign-in on your PC.');
function isolated(kind,root=path.join(__dirname,'.local','live-brains')){
  fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'call-')),home=path.join(dir,'home'),work=path.join(dir,'work');fs.mkdirSync(home);fs.mkdirSync(work);
  const env={...process.env};
  for(const key of Object.keys(env))if(/^(?:CLAUDE|ANTHROPIC|OPENAI|CODEX|CHATGPT|NEXUS_LIVE)/.test(key))delete env[key];
  const cleanup=()=>{if(!fs.existsSync(dir))return;const target=fs.realpathSync(dir),parent=fs.realpathSync(root);if(path.dirname(target)!==parent||!path.basename(target).startsWith('call-'))throw Error('Invalid brain cleanup');fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});};
  try{
  if(kind==='codex'){
    const source=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
    // Copy only subscription auth and catalog. Never user config or sessions.
    const auth=JSON.parse(fs.readFileSync(path.join(source,'auth.json'),'utf8'));
    if(auth.auth_mode==='apikey'||!auth.tokens?.access_token)throw unavailable();
    fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({...auth,OPENAI_API_KEY:null}),{mode:0o600});
    if(fs.existsSync(path.join(source,'models_cache.json')))fs.copyFileSync(path.join(source,'models_cache.json'),path.join(home,'models_cache.json'));
    env.CODEX_HOME=home;
    fs.writeFileSync(path.join(home,'config.toml'),'model_provider = "openai"\nforced_login_method = "chatgpt"\napproval_policy = "never"\nsandbox_mode = "read-only"\nweb_search = "disabled"\n[tools]\ndisable_defaults = true\n[features]\nshell_tool = false\napply_patch_freeform = false\nmulti_agent = false\napps = false\nplugins = false\nskills = false\n');
  }else{
    const source=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude');
    const auth=JSON.parse(fs.readFileSync(path.join(source,'.credentials.json'),'utf8'));
    if(!auth.claudeAiOauth?.accessToken)throw unavailable();
    fs.writeFileSync(path.join(home,'.credentials.json'),JSON.stringify({claudeAiOauth:auth.claudeAiOauth}),{mode:0o600});env.CLAUDE_CONFIG_DIR=home;
  }
  return {dir,home,work,env,cleanup};
  }catch(error){cleanup();throw error;}
}
function smallModel(catalog){
  const rank=s=>/luna|nano/i.test(s)?0:/mini|small|haiku/i.test(s)?1:/terra/i.test(s)?2:3;
  const available=catalog.filter(m=>!m.hidden&&(m.model||m.id));
  available.sort((a,b)=>rank(a.model||a.id)-rank(b.model||b.id)||(b.model||b.id).localeCompare(a.model||a.id,undefined,{numeric:true}));
  if(!available.length)throw unavailable();return available[0];
}
class Brain extends EventEmitter {
  constructor(kind,options={}){super();this.kind=kind;this.options=options;this.requests=new Map();this.serial=0;this.closed=false;}
  async start(title){
    if(this.closed)throw unavailable();
    try{
      this.isolation=(this.options.isolate||isolated)(this.kind,this.options.root);
      const args=this.kind==='claude'?['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--model','claude-haiku-5-5','--tools','','--allowedTools','','--no-session-persistence','--safe-mode','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--system-prompt',protocol.prompt(title)]:['app-server','--listen','stdio://'];
      const launch=(this.options.launch||agents.launch)(this.kind==='codex'?'astra':'claude',args);
      this.child=(this.options.spawn||spawn)(launch.file,launch.args,{cwd:this.isolation.work,env:this.isolation.env,windowsHide:true,stdio:['pipe','pipe','pipe']});
      this.child.stdin.on('error',()=>this.fail());this.child.on('error',()=>this.fail());
      this.child.on('close',()=>{this.closed=true;this.fail();this.dispose();});this.child.stderr.on('data',()=>{});
      let buffer='';this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',data=>{buffer+=data;if(buffer.length>2e6){this.close();return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{this.message(JSON.parse(line));}catch{this.close();return;}}});
      await new Promise((resolve,reject)=>{this.child.once('spawn',resolve);this.child.once('error',reject);});
      if(this.kind==='codex'){
        await this.rpc('initialize',{clientInfo:{name:'nexus_live_voice',title:'NEXUS live voice',version:'1.0'},capabilities:{experimentalApi:true}});this.write({method:'initialized',params:{}});
        const list=await this.rpc('model/list',{limit:100,includeHidden:false});this.catalog=list.data;const selected=smallModel(list.data);this.model=selected.model||selected.id;
        const efforts=selected.supportedReasoningEfforts?.map(e=>e.reasoningEffort)||[];this.effort=['minimal','low','none'].find(e=>efforts.includes(e))||selected.defaultReasoningEffort;
        const result=await this.rpc('thread/start',{model:this.model,ephemeral:true,cwd:this.isolation.work,approvalPolicy:'never',sandbox:'read-only',baseInstructions:protocol.prompt(title),config:{'tools.disable_defaults':true,'features.shell_tool':false,'features.multi_agent':false,web_search:'disabled'},serviceName:'nexus_live_voice'});
        this.thread=result.thread.id;
      }else this.model='claude-haiku-5-5';
      if(this.closed)throw unavailable();return this;
    }catch(e){await this.close();throw e;}
  }
  write(value){if(this.closed||!this.child?.stdin.writable)throw unavailable();this.child.stdin.write(JSON.stringify(value)+'\n');}
  rpc(method,params){return new Promise((resolve,reject)=>{const id=++this.serial,timer=setTimeout(()=>{this.requests.delete(id);reject(unavailable());},20000);this.requests.set(id,{resolve,reject,timer});try{this.write({id,method,params});}catch(e){clearTimeout(timer);this.requests.delete(id);reject(e);}});}
  message(m){
    if(m.id!==undefined&&this.requests.has(m.id)){const r=this.requests.get(m.id);this.requests.delete(m.id);clearTimeout(r.timer);return m.error?r.reject(unavailable()):r.resolve(m.result);}
    // Refuse every tool and approval request even if a future CLI enables one.
    if(m.id!==undefined&&m.method){this.write({id:m.id,error:{code:-32601,message:'Tools are disabled for live voice'}});return;}
    const turn=this.turn;if(!turn)return;
    if(this.kind==='codex'){
      if(m.method==='turn/started')turn.id=m.params.turn.id;
      if(m.method==='item/agentMessage/delta')turn.delta(m.params.delta);
      if(m.method==='turn/completed')turn.finish(m.params.turn.status==='completed'?null:unavailable());
      if(m.method==='error'&&!m.params.willRetry)turn.finish(unavailable());
    }else{
      if(m.type==='stream_event'&&m.event?.type==='content_block_delta'&&m.event.delta?.type==='text_delta')turn.delta(m.event.delta.text);
      if(m.type==='result'){if(!turn.text&&m.result)turn.delta(m.result);turn.finish(m.is_error?unavailable():null);}
    }
  }
  ask(input,onDelta=()=>{}){
    if(this.turn||this.closed)return Promise.reject(unavailable());
    return new Promise((resolve,reject)=>{
      const started=performance.now(),turn={text:'',ttftMs:null,id:null};this.turn=turn;
      const timer=setTimeout(()=>{turn.finish(unavailable());this.close();},30000);
      turn.delta=text=>{if(this.turn!==turn)return;if(turn.ttftMs===null)turn.ttftMs=performance.now()-started;turn.text+=text;try{onDelta(text);}catch(e){turn.finish(e);this.close();}};
      turn.finish=error=>{if(this.turn!==turn)return;this.turn=null;clearTimeout(timer);error?reject(error):resolve({text:turn.text,ttftMs:turn.ttftMs,totalMs:performance.now()-started});};
      try{if(this.kind==='codex')this.rpc('turn/start',{threadId:this.thread,input:[{type:'text',text:input,text_elements:[]}],effort:this.effort}).then(r=>{turn.id=r.turn.id;},e=>turn.finish(e));
        else this.write({type:'user',message:{role:'user',content:input}});
      }catch(e){turn.finish(e);}
    });
  }
  fail(){this.turn?.finish(unavailable());for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(unavailable());}this.requests.clear();}
  dispose(){try{this.isolation?.cleanup();}catch{}this.isolation=null;}
  async close(){if(this.closed)return;this.closed=true;this.fail();const p=this.child;if(!p){this.dispose();return;}p.stdin.destroy();
    // agents.launch resolves npm JS shims; the JS wrapper may own a native child.
    if(process.platform==='win32'&&p.pid){await new Promise(resolve=>{const killer=spawn('taskkill.exe',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',resolve);killer.once('close',resolve);});}else p.kill();this.dispose();}
}
async function createBrain(config,title,options={}){
  const selected=['codex','claude'].includes(config.liveBrain)?[config.liveBrain]:['claude','codex'];
  for(const kind of selected){try{return await new Brain(kind,options).start(title);}catch{}}
  throw unavailable();
}
module.exports={Brain,createBrain,isolated,smallModel};
