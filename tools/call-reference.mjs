// Run against the TEMP copy on 4793. No changes to the owner's reference source.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve('docs/shots/call/reference');fs.mkdirSync(out,{recursive:true});
for(const [width,height] of [[1568,773],[1920,1080],[440,956]]){
 if(process.argv[2]&&+process.argv[2]!==width)continue;
 const phone=width===440,steps=[{viewport:[width,height]},{navigate:'/'},{until:`!!document.querySelector('[aria-label="NEXUS is starting"]')`},{until:`!document.querySelector('[aria-label="NEXUS is starting"]')`}];
 const shot=name=>steps.push({js:`document.querySelectorAll('button').forEach(b=>{if(b.textContent.trim()==='Dismiss')b.click()});document.querySelector('nextjs-portal')?.remove();`},{shot:`${width}-${name}`,...(phone?{clip:'.h-\\[844px\\]'}:{})});
 if(phone){steps.push({text:'Phone'},{wait:200},{text:'Sessions'},{js:`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')?.startsWith('Session dashboard redesign.')).click()`},{wait:100},{js:`const frame=document.getElementsByClassName('h-[844px]')[0];frame.style.width='440px';frame.style.height='956px';`});}
 steps.push({js:`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Call Session dashboard redesign').click()`},{wait:80});shot('connecting');
 steps.push({until:`[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Listening'))`});shot('listening');
 steps.push({until:`[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Speaking'))`});shot('speaking');
 steps.push({until:`[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Working:'))`});shot('working');
 steps.push({until:`[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Needs your answer'))`});shot('question');
 steps.push({click:'[aria-label="Minimise call"]'});shot('pill');steps.push({click:'[aria-label="Return to call with Session dashboard redesign"]'},{click:'[aria-label="End call"]'});shot('ended');
 const file=path.join(out,`${width}-steps.json`);fs.writeFileSync(file,JSON.stringify(steps,null,2));
 const p=spawn(process.execPath,['tools/redesign-browser.mjs','4793',out,file],{windowsHide:true,stdio:'inherit'});await new Promise((r,j)=>p.once('exit',code=>code?j(Error('Reference failed '+width)):r()));
}
