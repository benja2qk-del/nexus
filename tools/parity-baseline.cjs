'use strict';
// Baseline assets are served by CDP over the same isolated synthetic backend.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const git=args=>execFileSync('git',args,{windowsHide:true,maxBuffer:32*1024*1024});
const files=git(['ls-tree','-r','--name-only','e953864','public']).toString().trim().split('\n');
const assets={};
for(const file of files){
  const ext=path.extname(file);
  const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'}[ext];
  if(type)assets[file.slice(7)]={type,body:git(['show','e953864:'+file]).toString('base64')};
}
fs.writeFileSync(process.argv[2],JSON.stringify(assets));
