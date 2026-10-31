'use strict';
// Defense in depth for the real-data probe, including its telemetry worker.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(process.env.NEXUS_THEME_PROBE_ROOT||'');
if(!root.startsWith(path.resolve('.local')+path.sep)||process.env.NEXUS_READ_ONLY!=='1'||!['4790','4791'].includes(process.env.NEXUS_PORT))throw Error('Unsafe real-data probe');
for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync'])cp[method]=()=>{throw Error('Read-only probe blocks process/model launches');};
const inside=file=>{if(typeof file==='number')return;const p=path.resolve(String(file));if(p!==root&&!p.startsWith(root+path.sep))throw Error('Read-only probe blocks writes outside scratch state');};
for(const api of [fs,fs.promises])for(const name of ['writeFile','appendFile','mkdir','unlink','rm','rmdir','rename','truncate','copyFile','chmod','utimes'])for(const suffix of api===fs?['','Sync']:['']){
  const key=name+suffix,original=api[key];if(!original)continue;
  api[key]=function(file,...args){inside(name==='copyFile'?args[0]:file);if(name==='rename')inside(args[0]);return original.call(this,file,...args);};
}
// Opening a transcript is always read-only. No content is opened in the main
// checkout; the parent process copies only its config before starting us.
const main=path.resolve('..','Nexus Deck').toLowerCase()+path.sep;
for(const api of [fs,fs.promises])for(const key of api===fs?['open','openSync','readFile','readFileSync']:['open','readFile']){
  const original=api[key];api[key]=function(file,...args){
    if(typeof file!=='number'&&path.resolve(String(file)).toLowerCase().startsWith(main))throw Error('Read-only probe blocks main checkout content');
    if(key.startsWith('open')&&args[0]!=='r'&&args[0]!==fs.constants.O_RDONLY)inside(file);
    return original.call(this,file,...args);
  };
}
