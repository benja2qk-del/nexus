'use strict';
// Local-only, no prompt or model call. Never resumes an existing session.
const fs=require('fs'),path=require('path'),os=require('os'),pty=require('@lydell/node-pty');
const {TerminalScreen}=require('../terminal-screen');
const root=path.resolve(__dirname,'../.local/copilot-probe');fs.mkdirSync(root,{recursive:true});
const home=path.join(root,'home');fs.mkdirSync(home,{recursive:true});
if(process.argv.includes('--auth-metadata')){
  const source=fs.readFileSync(path.join(os.homedir(),'.copilot','config.json'),'utf8').split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
  const config=JSON.parse(source);
  // Public account selectors only. Credentials stay in the OS credential store.
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({loggedInUsers:(config.loggedInUsers||[]).map(({host,login,kind})=>({host,login,kind}))}));
}
const screen=new TerminalScreen();screen.resize(120,42);
const env={...process.env,COPILOT_HOME:home,TERM:'xterm-256color'};
const p=pty.spawn('cmd.exe',['/d','/c','copilot','--no-auto-update','--no-custom-instructions','--disable-builtin-mcps','--no-remote','--no-remote-export'],{cwd:root,env,cols:120,rows:42,useConptyDll:false});
p.onData(d=>screen.write(d));
const save=name=>{const text=screen.text().replaceAll(root,'C:\\demo').replaceAll(os.homedir(),'C:\\Users\\demo');fs.writeFileSync(path.join(root,name+'.txt'),text);console.log(name+'\n'+text);};
setTimeout(()=>{save('startup');p.write('\r');},12000);
setTimeout(()=>{save('input');p.write('/model\r');},15000);
setTimeout(()=>{save('models');p.write('\x1b');},22000);
setTimeout(()=>{p.write('/model gpt-5-mini\r');},24000);
setTimeout(()=>{save('mini-selection');p.write('/model\r');},28000);
setTimeout(()=>{p.write('gpt-5-mini');},31000);
setTimeout(()=>{save('mini-search');p.write('\x1b');},34000);
setTimeout(()=>{p.write('/fork nexus-probe-fork\r');},36000);
setTimeout(()=>{save('fork');p.kill();},41000);
setTimeout(()=>process.exit(0),43000);
