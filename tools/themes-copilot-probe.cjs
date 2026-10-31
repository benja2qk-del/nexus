'use strict';
// Headless CLI controls only, in a new TEMP home. Never sends a model prompt.
const fs=require('fs'),os=require('os'),path=require('path'),pty=require('@lydell/node-pty');
const {TerminalScreen}=require('../terminal-screen');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-theme-cli-')),home=path.join(root,'home');fs.mkdirSync(home);
if(process.argv.includes('--account-selector')){
 const raw=fs.readFileSync(path.join(os.homedir(),'.copilot','config.json'),'utf8').split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
 const config=JSON.parse(raw);fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({loggedInUsers:(config.loggedInUsers||[]).map(({host,login,kind})=>({host,login,kind}))}));
}
const launch=require('../agents').launch('copilot',['--no-auto-update','--no-custom-instructions','--disable-builtin-mcps','--no-remote','--no-remote-export']);
const env={...process.env,COPILOT_HOME:home,TERM:'xterm-256color'};
const screen=new TerminalScreen();screen.resize(120,42);
const p=pty.spawn(launch.file,launch.args,{cwd:root,env,cols:120,rows:42,useConptyDll:false});p.onData(d=>screen.write(d));
const save=name=>{fs.writeFileSync(path.join(root,name+'.txt'),screen.text());console.log(name+' captured');};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 await pause(9000);save('startup');
 if(/trust.*folder/i.test(screen.text())){p.write('\r');await pause(2000);}
 save('ready');p.write('\x1b[Z');await pause(1200);save('mode-one');
 p.write('\x1b[Z');await pause(1200);save('mode-two');
 p.write('\x1b[Z');await pause(1200);save('mode-three');
 p.write('/model\r');await pause(2500);save('models');p.write('\x1b');await pause(400);
 p.write('/usage\r');await pause(2000);save('usage');
}finally{p.kill();console.log('Probe files: '+root);}})().catch(e=>{console.error(e);process.exitCode=1;});
