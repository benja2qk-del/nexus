import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve('docs/shots/slash2/reference');fs.mkdirSync(out,{recursive:true});
for(const [width,height]of [[1568,773],[440,956]]){
 const phone=width===440,steps=[{viewport:[width,height]},{navigate:'/'},{until:`!!document.querySelector('[aria-label="NEXUS is starting"]')`},{until:`!document.querySelector('[aria-label="NEXUS is starting"]')`},{text:'Home PC'},{wait:300}];
 const shot=name=>steps.push({js:`document.querySelectorAll('button').forEach(b=>{if(b.textContent.trim()==='Dismiss')b.click()});document.querySelector('nextjs-portal')?.remove();`},{shot:`${width}-${name}`,...(phone?{clip:'.h-\\[956px\\]'}:{})});
 if(phone)steps.push({text:'Phone'},{wait:200},{text:'Sessions'},{js:`const frame=document.getElementsByClassName('h-[956px]')[0];frame.style.border='0';frame.style.borderRadius='0';[...frame.querySelectorAll('button')].find(b=>b.textContent.includes('NEXUS')&&b.textContent.includes('sessions')).click();`},{wait:150},{js:`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')?.startsWith('Session dashboard redesign.')).click();`});
 else steps.push({js:`const row=[...document.querySelectorAll('[data-session-row]')].find(b=>b.textContent.includes('Session dashboard redesign'));(row||document.querySelector('[data-session-row]')).click();`});
 steps.push({until:`!!document.querySelector('textarea[role=combobox]')`});
 const fill=(selector,value)=>({js:`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`});
 if(phone)steps.push({click:'[aria-label="Commands"]'});else steps.push(fill('textarea[role=combobox]','/'));
 steps.push({until:`!!document.querySelector('[role=listbox]')`});shot('picker');
 steps.push(fill(phone?'input[placeholder="Search commands"]':'textarea[role=combobox]',phone?'comp':'/comp'));shot('filtered');
 if(phone)steps.push({text:'Cancel'});else steps.push(fill('textarea[role=combobox]',''));
 steps.push(fill('textarea[role=combobox]','/clear'),{wait:100},{click:'button[aria-label="Run /clear"]'},{until:`!!document.querySelector('[role=alertdialog]')`});shot('confirm');
 steps.push({js:`document.querySelector('[role=alertdialog] button').click()`},{wait:100});shot('cancelled');
 steps.push(fill('textarea[role=combobox]','/compact'),{wait:100},{click:'button[aria-label="Run /compact"]'},{wait:900});shot('ran');
 const file=path.join(out,width+'-steps.json');fs.writeFileSync(file,JSON.stringify(steps,null,2));
 const child=spawn(process.execPath,['tools/redesign-browser.mjs','4783',out,file],{windowsHide:true,stdio:'inherit'});await new Promise((r,j)=>child.once('exit',code=>code?j(Error('Reference tour failed '+width)):r()));
}
