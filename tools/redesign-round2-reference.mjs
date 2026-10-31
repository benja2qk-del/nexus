import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const out=path.resolve('docs/shots/redesign/ref-round2');fs.mkdirSync(out,{recursive:true});
for(const [width,height] of [[1568,773],[1920,1080],[390,844]]){
 const phone=width===390,steps=[{viewport:[width,height]},{navigate:'/'},{until:`!!document.querySelector('[aria-label="NEXUS is starting"]')`},{until:`!document.querySelector('[aria-label="NEXUS is starting"]')`},{wait:300}];
 const click=text=>steps.push({js:`Array.from(document.querySelectorAll('button,a,[role=menuitem],[role=radio]')).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`},{wait:100});
 const shot=(name,settle=260)=>steps.push({shot:`${width}-${name}`,settle,...(phone?{clip:'.h-\\[844px\\]'}:{})});
 const escape=()=>steps.push({js:`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`},{wait:100});
 const more=()=>steps.push({click:'[aria-label="More actions"]'},{wait:100});
 if(phone){click('Phone');click('Sessions');steps.push({js:`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')?.startsWith('Session dashboard redesign.')).click()`},{wait:200});}
 shot('session');
 steps.push({js:`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Catch me up')).click()`},{wait:200});shot('catchup');
 click('Summarize');shot('summary-loading',0);steps.push({wait:1500});shot('summary-error');click('Retry');steps.push({wait:1500});shot('summary-done');
 if(phone)steps.push({js:`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Catch me up')).click()`});
 more();click('Session settings…');shot('session-settings');click('Close session…');shot('close-confirm');click('Keep running');
 if(phone)click('Done');else steps.push({click:'[aria-label="Close session settings"]'});
 more();click('Raw terminal');shot('raw');steps.push({click:'[aria-label="Close raw terminal"]'});
 // The copied reference is only a mock: use its actual provider to stage delivery states.
 steps.push({js:`window.refStore=()=>{const el=document.querySelector('textarea'),key=Object.keys(el).find(k=>k.startsWith('__reactFiber'));let f=el[key];while(f){if(f.memoizedProps?.value?.send)return f.memoizedProps.value;f=f.return;}throw Error('Reference provider missing');};`});
 steps.push({js:`refStore().resume('s-dashboard');`},{wait:50});shot('starting',0);steps.push({wait:1800});
 steps.push({js:`refStore().send('s-dashboard','Please check the updated layout.');`},{wait:50});shot('sending',0);steps.push({wait:900},{js:`refStore().send('s-dashboard','Round two queued message');`},{wait:50});shot('queued',0);steps.push({wait:4500});
 shot('delivered');steps.push({js:`refStore().endSession('s-dashboard')`},{wait:100});shot('ended');steps.push({js:`refStore().send('s-dashboard','Keep this message for retry.');`},{wait:850});shot('failed');
 if(phone){steps.push({click:'[aria-label="Back to sessions"]'});click('Settings');}else steps.push({js:`Array.from(document.querySelectorAll('nav[aria-label="Projects and sessions"] ul[aria-label="Main"] button')).find(b=>b.textContent.startsWith('Settings')).click()`},{wait:100});
 shot(phone?'pair-entry':'pair-waiting');
 if(phone){steps.push({js:`const inputs=[...document.querySelectorAll('input[aria-label^="Digit"]')];const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(inputs[0],'000000');inputs[0].dispatchEvent(new Event('input',{bubbles:true}));`},{wait:1500});shot('pair-wrong');}
 else{click('paired');shot('pair-paired');click('expired');shot('pair-expired');}
 steps.push({js:`document.querySelector('#voice').scrollIntoView()`});shot('voice-idle');click('Run voice check');shot('voice-testing',0);steps.push({wait:4000});shot('voice-result');click('Run again');steps.push({wait:4000});shot('voice-pass');
 const file=path.join(out,`${width}-steps.json`);fs.writeFileSync(file,JSON.stringify(steps,null,2));
 const p=spawn(process.execPath,['tools/redesign-browser.mjs','4793',out,file],{windowsHide:true,stdio:'inherit'});await new Promise((r,j)=>p.once('exit',c=>c?j(Error('Reference failed '+width)):r()));
}
