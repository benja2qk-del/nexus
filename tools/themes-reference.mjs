import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve('docs/shots/themes/reference');fs.mkdirSync(out,{recursive:true});
for(const [width,height]of [[1568,773],[440,956]]){
 const phone=width===440,steps=[{viewport:[width,height]},{navigate:'/'},{wait:8000},{until:`!document.querySelector('[aria-label="NEXUS is starting"]')`},{js:`document.querySelector('nextjs-portal')?.remove()`},{text:'Home PC'},{wait:500}];
 const shot=name=>steps.push({wait:350},{shot:width+'-'+name,...(phone?{clip:'.h-\\[956px\\]'}:{})});
 if(phone){steps.push({text:'Phone'},{wait:300},{js:`const f=document.getElementsByClassName('h-[956px]')[0];f.style.border='0';f.style.borderRadius='0';`});shot('home');steps.push({text:'Sessions'});shot('themes');steps.push({js:`[...document.getElementsByClassName('h-[956px]')[0].querySelectorAll('button')].find(b=>b.textContent.includes('NEXUS')&&b.textContent.includes('sessions')).click()`});shot('sessions');}
 else {shot('session');steps.push({js:`document.querySelector('[title="Home (G H)"]').click()`});shot('home');steps.push({js:`document.querySelector('[aria-labelledby=themes-strip] li button').click()`});shot('theme');steps.push({text:'Work PC (Copilot only)'},{wait:500});shot('single-theme');steps.push({js:`[...document.querySelectorAll('[data-session-row]')].find(b=>b.textContent.includes('Invoice schema v2')).click()`});shot('copilot');steps.push({js:`document.querySelector('[title="Home (G H)"]').click()`});shot('single-home');}
 const file=path.join(out,width+'-steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));
 const child=spawn(process.execPath,['tools/redesign-browser.mjs','4793',out,file],{windowsHide:true,stdio:'inherit'});await new Promise((r,j)=>child.once('exit',c=>c?j(Error('Reference capture failed')):r()));
}
