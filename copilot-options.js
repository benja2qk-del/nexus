'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const MODES=['interactive','plan','autopilot'],EFFORTS=['none','minimal','low','medium','high','xhigh','max'],CONTEXTS=['default','long_context'];
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Choose session options.');
 const out={};for(const k of Object.keys(value)){
  const v=value[k],choices={mode:MODES,effort:EFFORTS,context:CONTEXTS}[k];
  if(choices){if(v!==null&&!choices.includes(v))throw Error('Invalid '+k+'.');out[k]=v;}
  else if(k==='maxAiCredits'){if(v!==null&&(!Number.isFinite(v)||v<=0||v>1000000))throw Error('Use a positive AI-credit cap, or no cap.');out[k]=v;}
  else throw Error('Unknown session option.');
 }return out;
}
function args(value={}){const v=validate(value),out=[];for(const[k,flag]of [['mode','--mode'],['effort','--reasoning-effort'],['context','--context'],['maxAiCredits','--max-ai-credits']])if(v[k]!=null)out.push(flag,String(v[k]));return out;}
class Preferences{
 constructor(file){this.file=file||path.join(path.dirname(process.env.NEXUS_STATE_FILE||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NexusDeck','state.json')),'copilot-options.json');this.values={};try{this.values=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')this.error='Session options could not be read.';}}
 get(key){return this.values[key]||{};}
 set(key,patch){if(this.error)throw Error(this.error);if(!/^copilot:[\w-]{1,128}$/.test(key))throw Error('Choose a Copilot session.');const next={...this.values,[key]:{...this.get(key),...validate(patch)}};fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next));fs.renameSync(tmp,this.file);this.values=next;return this.get(key);}
}
// Read explicit footer mode only. A mention of "plan" in a reply is not an acknowledgement.
function screenMode(text){const lines=String(text||'').split(/\r?\n/).slice(-12);for(const line of lines.reverse()){const m=/\b(interactive|plan|autopilot)\s+mode\b/i.exec(line);if(m&&/shift.?tab|switch|cycle/i.test(line))return m[1].toLowerCase();}return null;}
module.exports={MODES,EFFORTS,CONTEXTS,validate,args,Preferences,screenMode};
