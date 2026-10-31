'use strict';
// Only the isolated acceptance runner opts into this preload.
const fs=require('fs'),path=require('path');
const root=fs.realpathSync(process.env.NEXUS_SLASH_LIVE||'');
if(process.env.NEXUS_PORT!=='4786'||!root.startsWith(path.resolve('.local')+path.sep))throw Error('Unsafe slash live root');
const agents=require('../agents'),launch=agents.launch;
agents.launch=(kind,args)=>launch(kind,[...args,...(kind==='claude'?['--strict-mcp-config','--mcp-config','{"mcpServers":{}}']:kind==='copilot'?['--no-auto-update','--no-custom-instructions','--disable-builtin-mcps','--no-remote','--no-remote-export']:[])]);
const pty=require('@lydell/node-pty'),spawn=pty.spawn;
pty.spawn=(file,args,options)=>{if(path.resolve(options.cwd)!==path.join(root,'work'))throw Error('Only the isolated work folder may launch');const p=spawn(file,args,options),write=p.write.bind(p);p.write=data=>{fs.appendFileSync(path.join(root,'writes.jsonl'),JSON.stringify({pid:p.pid,data})+'\n');return write(data);};return p;};
const http=require('http'),create=http.createServer;
http.createServer=function(listener){return create.call(this,(req,res)=>{if(req.url.startsWith('/local-provider')){fs.appendFileSync(path.join(root,'provider-requests.jsonl'),JSON.stringify({method:req.method,url:req.url})+'\n');res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Inference is disabled in the slash acceptance check.'}}));return;}listener(req,res);});};
