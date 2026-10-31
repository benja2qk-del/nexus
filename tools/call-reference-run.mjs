// Creates a disposable reference copy, installs there, captures it headlessly,
// and stops only the child process tree this script owns. No NEXUS install.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
const port=process.env.NEXUS_REFERENCE_PORT||'4793';
if(!['4783','4793'].includes(port))throw Error('Private reference ports only.');
await new Promise((r,j)=>{const probe=net.createServer();probe.once('error',j);probe.listen(Number(port),'127.0.0.1',()=>probe.close(r));});
const root=process.env.NEXUS_REFERENCE_ROOT?fs.realpathSync(process.env.NEXUS_REFERENCE_ROOT):fs.mkdtempSync(path.join(os.tmpdir(),'nexus-call-reference-'));
if(!root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep)||!path.basename(root).startsWith('nexus-call-reference-'))throw Error('Reference must be a disposable TEMP copy.');
// The v0 design source lives outside this repo: NEXUS_V0_SRC=<folder> node tools/call-reference-run.mjs
if(!process.env.NEXUS_V0_SRC)throw new Error('Set NEXUS_V0_SRC to the v0 design source folder.');
if(!process.env.NEXUS_REFERENCE_ROOT)fs.cpSync(process.env.NEXUS_V0_SRC,root,{recursive:true,filter:file=>!['node_modules','.next','.git'].includes(path.basename(file))});
const run=(exe,args,cwd=root)=>new Promise((r,j)=>{const child=spawn(exe,args,{cwd,windowsHide:true,stdio:'inherit'});child.once('error',j);child.once('exit',code=>code?j(Error('Reference command failed: '+code)):r());});
if(!process.env.NEXUS_REFERENCE_ROOT)await run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm install --no-audit --no-fund']);
const popover=path.join(root,'components/ui/popover.tsx');
if(!fs.existsSync(popover))fs.writeFileSync(popover,`"use client"
import { Popover as Base } from "@base-ui/react/popover"
export const Popover = Base.Root
export const PopoverTrigger = Base.Trigger
export function PopoverContent({align="center", sideOffset=6, className, children, ...props}: any) { return <Base.Portal><Base.Positioner align={align} sideOffset={sideOffset} className="z-50"><Base.Popup className={className} {...props}>{children}</Base.Popup></Base.Positioner></Base.Portal> }
`);
// The exported mock recreates logEvent every timer tick, which resets its
// scripted step timeout. Keep that callback stable in this TEMP copy only.
const context=path.join(root,'components/nexus/call/call-context.tsx');
let source=fs.readFileSync(context,'utf8');
if(source.includes('logEvent: (line) => setCall')){
 source=source.replace('  const value = useMemo<CallContextValue>', '  const logEvent = useCallback((line: string) => setCall((c) => (c && !c.log.includes(line) ? { ...c, log: [...c.log, line] } : c)), [])\n\n  const value = useMemo<CallContextValue>');
 source=source.replace('logEvent: (line) => setCall((c) => (c && !c.log.includes(line) ? { ...c, log: [...c.log, line] } : c)),','logEvent,');fs.writeFileSync(context,source);
}
const server=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p',port,'--hostname','127.0.0.1'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
try{
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Reference server timeout')),30000);server.stdout.on('data',d=>{if(String(d).includes('Ready')){clearTimeout(timer);r();}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',code=>j(Error('Reference server exited '+code)));});
 await run(process.execPath,[path.resolve(process.env.NEXUS_REFERENCE_TOUR||'tools/call-reference.mjs')],process.cwd());
}finally{
 if(server.exitCode===null)await new Promise(r=>{const stop=spawn('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});stop.once('exit',r);});
}
console.log('Reference captured from '+root);
