import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve(process.argv[2],'phone-safe-area');fs.mkdirSync(out,{recursive:true});
const steps=[{viewport:[440,956],dpr:3},{safeArea:{top:59,bottom:34,left:0,right:0}},{navigate:'/'},{until:"typeof state!=='undefined'&&state.booted"},
  {js:`window.bandChecks=[];window.checkBand=()=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle=getComputedStyle(document.documentElement).backgroundColor;ctx.fillRect(0,0,1,1);const hex='#'+[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>x.toString(16).padStart(2,'0')).join('');const actual=document.querySelector('meta[name=theme-color]').content;if(actual!==hex)throw Error('Band does not match root: '+actual+' '+hex);bandChecks.push({theme:document.documentElement.dataset.theme||'ink',view:state.view,hex,dockPadding:getComputedStyle(document.querySelector('#mobileDock')).paddingBottom});};setView('overview');`},
  {wait:100},{js:'checkBand()'},{shot:'home-59-34'},
  {js:"select('claude:s-dashboard')"},{until:'chatFor().loaded'},{wait:100},{js:'checkBand()'},{shot:'session-59-34'}];
for(const theme of ['oled','dim','ink'])steps.push({js:`document.documentElement.dataset.theme='${theme}';`},{wait:80},{js:'checkBand()'});
steps.push({js:"NexusLiveCall.open=async(k,h)=>{h.state('listening');return{close(){},setMuted(){}}};NexusCall.start('claude:s-dashboard');"},{wait:200},{js:'checkBand()'},{shot:'call-59-34'},{save:{name:'checks.json',expression:'bandChecks'}});
const file=path.join(out,'steps.json');fs.writeFileSync(file,JSON.stringify(steps));
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tools/redesign-browser.mjs','4785',out,file],{windowsHide:true,stdio:'inherit'});child.once('exit',c=>c?reject(Error('Phone band checks failed')):resolve());});
console.log('PASS phone safe-area and theme-color checks');
