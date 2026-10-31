import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve('docs/shots/redesign/ref');fs.mkdirSync(out,{recursive:true});
for(const [width,height] of [[1568,773],[1920,1080],[390,844]]){
 const phone=width===390, steps=[{viewport:[width,height]},{navigate:'/'},{until:`!!document.querySelector('[aria-label="NEXUS is starting"]')`},{wait:1400},{shot:`${width}-boot`},{until:`!document.querySelector('[aria-label="NEXUS is starting"]')`},{wait:300}];
 if(phone){steps.push({text:'Phone'},{wait:300});}
 const clip=phone?'.h-\\[844px\\]':undefined;
 const shot=name=>steps.push({shot:`${width}-${name}`,clip});
 const text=t=>steps.push({text:t},{wait:120});
 if(!phone){
  shot('session');steps.push({click:'[aria-label="Model: Opus 5.5. Change model"]'});shot('model');steps.push({js:'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'},{wait:100});
  text('Catch me up3');shot('catchup');
  steps.push({click:'[aria-label="More actions"]'});shot('more');steps.push({js:'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'},{wait:100});
  for(const [name,label] of [['home','Home'],['wall','Wall'],['spend','Spend'],['settings','Settings']]){steps.push({js:`Array.from(document.querySelectorAll('nav[aria-label="Projects and sessions"] ul[aria-label="Main"] button')).find(b=>b.textContent.startsWith(${JSON.stringify(label)})).click()`},{wait:150});shot(name);}
  text('New');shot('new');steps.push({js:'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'});
  steps.push({js:'window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}))'},{wait:150});shot('palette');steps.push({js:'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'});
  steps.push({js:`Array.from(document.querySelectorAll('nav[aria-label="Projects and sessions"] ul[aria-label="Main"] button')).find(b=>b.textContent.startsWith('Home')).click()`});
 }else{
  shot('home');text('Sessions');shot('sessions');steps.push({js:'Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")?.startsWith("Session dashboard redesign.")).click()'},{wait:300});shot('session');
  steps.push({click:'[aria-label="Model: Opus 5.5. Change model"]'});shot('model');steps.push({js:'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'},{wait:100});text('Catch me up');shot('catchup');steps.push({click:'[aria-label="Back to sessions"]'});
  for(const [name,label] of [['new','New'],['spend','Spend'],['settings','Settings']]){text(label);shot(name);}
  steps.push({js:`Array.from(document.querySelectorAll('nav[aria-label="Main"] button')).find(b=>b.textContent.startsWith('Home')).click()`});
 }
 for(const [name,label] of [['quiet','Quiet'],['loading','Load'],['empty','Empty'],['error','Error']]){text(label);shot(name);}
 const file=path.join(out,`${width}-steps.json`);fs.writeFileSync(file,JSON.stringify(steps,null,2));
 const p=spawn(process.execPath,['tools/redesign-browser.mjs','4793',out,file],{windowsHide:true,stdio:'inherit'});await new Promise((r,j)=>p.on('exit',c=>c?j(Error('Reference tour failed '+width)):r()));
}
