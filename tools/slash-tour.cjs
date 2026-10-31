'use strict';
// Headless only. Operates exclusively on the fresh terminals from slash-live.cjs.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process');
const record=JSON.parse(fs.readFileSync('.local/slash-live-pointer.json'));
assert(!record.closed&&record.root.startsWith(path.resolve('.local')+path.sep));
const base='http://127.0.0.1:4786';
const run=(out,env)=>new Promise((r,j)=>{const p=spawn(process.execPath,['tools/cdp-tour.mjs',out],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';p.stdout.on('data',d=>text+=d);p.stderr.on('data',d=>text+=d);p.on('error',j);p.on('exit',code=>{fs.writeFileSync(path.join(out,'tour.log'),text);code?j(Error(text)):r(text);});});
const type=text=>({js:`(()=>{const input=document.querySelector('#steerIn');input.focus();input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`});
async function main(){
 const all=await(await fetch(base+'/api/sessions')).json();assert(all.terms.every(t=>Object.values(record.terms).includes(t.id)));assert(all.sessions.every(s=>s.cwd===record.work));
 for(const [width,height]of [[1568,773],[440,956]]){
  const out=path.join(record.root,'tour',String(width));fs.mkdirSync(out,{recursive:true});const steps=[{until:"typeof state!=='undefined'&&state.booted"},{js:"NexusCall.incoming=()=>{};document.querySelector('#nxIncomingCall .dismiss')?.click()"}];
  for(const kind of ['claude','astra','copilot']){
   const id=record.terms[kind],instant=kind==='astra'?'/status':kind==='copilot'&&width<=700?'/env':'/context',menu=kind==='astra'?'/permissions':'/help';
   steps.push({js:`(()=>{const t=state.terms.find(t=>t.id===${JSON.stringify(id)});if(!t)throw Error('Owned terminal missing');select(state.byKey.has(t.sessionKey)?t.sessionKey:'term:'+t.id);})()`},{until:'chatFor().loaded && !!document.querySelector("#steerIn")'},type('/'),{until:'document.querySelectorAll("#nxSlashList [role=option]").length>10'},{shot:kind+'-autocomplete'},type('/mod'),{until:'document.querySelectorAll("#nxSlashList [role=option]").length===1'},{shot:kind+'-filtered'});
   if(width>700)steps.push({key:['ArrowDown','ArrowDown',40]},{key:['Tab','Tab',9]});else steps.push({click:'#nxSlash-0'});
   steps.push({js:"if(!document.querySelector('#steerIn').value.startsWith('/model'))throw Error('Picker did not insert');document.querySelector('#steerIn').value='/model';document.querySelector('[data-steer=send]').click()"},{until:'!!document.querySelector("#nxModelMenu")'},{shot:kind+'-native-model'},{click:'[data-model-close]'},type('/logout'),{click:'[data-steer=send]'},{until:'!!document.querySelector("#modal.on [data-slash-cancel]")'},{shot:kind+'-confirmation'},{js:"for(const el of document.querySelectorAll('#modalCard,#modalCard [data-slash-confirm],#modalCard [data-slash-cancel]')){const r=el.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1)throw Error('Clipped confirmation control')}"},{click:'[data-slash-cancel]'},{js:"if(document.querySelector('#steerIn').value!=='/logout')throw Error('Cancel lost the draft')"});
   // Existing real CLI output is sufficient; repeat only the local command for a sent row.
   steps.push(type(instant),{key:['Escape','Escape',27]},{click:'[data-steer=send]'},{until:'!chatFor().sending && chatFor().pending.at(-1)?.receipt?.status==="acknowledged" && [...document.querySelectorAll(".nx-slash-row")].some(e=>e.innerText.startsWith("Ran '+instant+'"))'},{shot:kind+'-sent-command'},type(menu),{key:['Escape','Escape',27]},{click:'[data-steer=send]'},{until:'!!document.querySelector("#nxRaw")'},{shot:kind+'-terminal-handoff'},{click:'[data-raw-key=esc]'},{until:'!document.querySelector("#nxRaw")'},{js:"if(document.documentElement.scrollWidth>innerWidth+2)throw Error('Horizontal overflow');if(document.querySelector('#steerIn').getAttribute('aria-expanded')!=='false')throw Error('Stale combobox')"});
  }
  fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(steps,null,2));await run(out,{...process.env,NEXUS_PORT:'4786',NEXUS_WIDTH:String(width),NEXUS_HEIGHT:String(height)});console.log('PASS real isolated CLI tour '+width+'x'+height);
 }
 const writes=fs.readFileSync(path.join(record.root,'writes.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));assert(!writes.some(r=>r.data.includes('/logout')),'Cancel must send nothing to any PTY');
 const requests=fs.existsSync(path.join(record.root,'provider-requests.jsonl'))?fs.readFileSync(path.join(record.root,'provider-requests.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];assert(requests.every(r=>r.url.includes('/count_tokens')),'No inference requests permitted');
 fs.writeFileSync(path.join(record.root,'verification.json'),JSON.stringify({viewports:[[1568,773],[440,956]],agents:['claude','astra','copilot'],logoutWrites:0,inferenceRequests:0,localTokenCountRequests:requests.length},null,2));
 console.log('PASS live Cancel has zero PTY writes; no inference requests; token counting stayed on the local denied endpoint.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
