// Private, disposable fixtures only. Stop by creating <output>/stop.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const out=path.resolve(process.argv[2]);
fs.mkdirSync(out,{recursive:true});
for(const port of [4785,4786,4793])await new Promise((resolve,reject)=>{
  const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));
});
const children=[];
function launch(exe,args,options={}){
  const child=spawn(exe,args,{windowsHide:true,stdio:'inherit',...options});
  children.push(child);return child;
}
const run=(exe,args,options)=>new Promise((resolve,reject)=>{
  const child=launch(exe,args,options);child.once('error',reject);child.once('exit',code=>code?reject(Error('Command failed: '+code)):resolve());
});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-parity-reference-'));
if(!process.env.NEXUS_V0_SRC)throw Error('Set NEXUS_V0_SRC');
fs.cpSync(process.env.NEXUS_V0_SRC,root,{recursive:true,filter:file=>!['node_modules','.next','.git'].includes(path.basename(file))});
try{
  await run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm install --no-audit --no-fund'],{cwd:root});
  const popover=path.join(root,'components/ui/popover.tsx');
  if(!fs.existsSync(popover))fs.writeFileSync(popover,`"use client"
import { Popover as Base } from "@base-ui/react/popover"
export const Popover = Base.Root
export const PopoverTrigger = Base.Trigger
export function PopoverContent({align="center", sideOffset=6, className, children, ...props}: any) { return <Base.Portal><Base.Positioner align={align} sideOffset={sideOffset} className="z-50"><Base.Popup className={className} {...props}>{children}</Base.Popup></Base.Positioner></Base.Portal> }
`);
  const context=path.join(root,'components/nexus/call/call-context.tsx');
  let source=fs.readFileSync(context,'utf8');
  if(source.includes('logEvent: (line) => setCall')){
    source=source.replace('  const value = useMemo<CallContextValue>', '  const logEvent = useCallback((line: string) => setCall((c) => (c && !c.log.includes(line) ? { ...c, log: [...c.log, line] } : c)), [])\n\n  const value = useMemo<CallContextValue>');
    source=source.replace('logEvent: (line) => setCall((c) => (c && !c.log.includes(line) ? { ...c, log: [...c.log, line] } : c)),','logEvent,');
    fs.writeFileSync(context,source);
  }
  launch(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p','4793','--hostname','127.0.0.1'],{cwd:root});
  const fixtures=[];
  for(const port of [4785,4786]){
    const fixture=require('./redesign-fixture.cjs').fixture();fixture.env.NEXUS_PORT=String(port);
    launch(process.execPath,['--require','./tools/redesign-round2-preload.cjs','server.js'],{env:fixture.env});
    fixtures.push({port,root:fixture.root});
  }
  fs.writeFileSync(path.join(out,'servers.json'),JSON.stringify({reference:root,fixtures},null,2));
  console.log('PARITY SERVERS READY');
  while(!fs.existsSync(path.join(out,'stop')))await new Promise(r=>setTimeout(r,1000));
}finally{
  for(const child of children.reverse())if(child.exitCode===null)await new Promise(resolve=>{
    const stop=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});stop.once('exit',resolve);
  });
}
