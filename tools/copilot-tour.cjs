'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),{spawn}=require('child_process'),assert=require('assert/strict');
fs.mkdirSync(path.resolve('.local/temp'),{recursive:true});
const real=process.argv.includes('--real'),root=fs.mkdtempSync(path.resolve('.local/copilot-tour-')),port=real?'4786':'4785';
const fixture=real?null:require('./copilot-fixture.cjs').setup(root),bin=path.join(root,'bin');fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin,'copilot.cmd'),'@echo Copilot fixture - no model execution\r\n');
const env={...process.env,PATH:bin+';'+path.join(process.env.SystemRoot,'System32'),NEXUS_PORT:port,NEXUS_CLAUDE_DIR:path.join(root,'missing-claude'),NEXUS_CODEX_DIR:path.join(root,'missing-codex'),NEXUS_COPILOT_DIR:real?path.join(os.homedir(),'.copilot'):path.join(root,'copilot'),NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_COPILOT_FIXTURE:root,TEMP:path.resolve('.local/temp'),TMP:path.resolve('.local/temp')};
if(real)env.NEXUS_READ_ONLY='1';
else {
 const source=path.join(root,'public-fixture-paths.js');
 fs.writeFileSync(source,`const fixtureFetch=window.fetch;window.fetch=async(...args)=>{const response=await fixtureFetch(...args);if(!String(args[0]).startsWith('/api/sessions'))return response;const data=await response.json();data.home='C:\\\\Demo';for(const s of data.sessions){s.cwd='C:\\\\Demo\\\\Release preview';s.group=s.groupLabel='Release preview';}return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});};`);
 env.NEXUS_TOUR_SOURCE=source;
}
const server=spawn(process.execPath,[...(!real?['--require',path.resolve('tools/copilot-preload.cjs')]:[]),'server.js'],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const run=(args,e)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{env:e,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('exit',code=>code?reject(Error(out)):resolve(out));});
(async()=>{try{
 let data;for(let i=0;i<100;i++){try{data=await(await fetch('http://127.0.0.1:'+port+'/api/sessions')).json();break}catch{await sleep(100)}}assert(data,'Server did not start: '+logs);assert(data.agents.copilot.installed&&!data.agents.claude.installed&&!data.agents.astra.installed);assert(data.sessions.every(s=>s.kind==='copilot'));assert(!data.usage.claude&&!data.usage.astra);assert.equal(data.summarizer.kind,'copilot');
 for(const [width,height]of [[1568,773],[440,956]]){
 if(!real){const current=await(await fetch('http://127.0.0.1:'+port+'/api/sessions')).json();for(const t of current.terms)await fetch('http://127.0.0.1:'+port+'/api/action',{method:'POST',headers:{'content-type':'application/json','x-nexus':'1'},body:JSON.stringify({action:'term-close',term:t.id})});}
 const out=path.resolve(real?path.join(root,'real-shots',String(width)):path.join('docs/shots/copilot',String(width)));fs.mkdirSync(out,{recursive:true});
 for(const name of fs.readdirSync(out))if(name.endsWith('.png'))fs.unlinkSync(path.join(out,name));
 const key='copilot:'+(real?data.sessions[0]?.id:fixture.IDs.done);assert(!key.endsWith('undefined'),'No Copilot sessions available');
 const steps=[{wait:2000},{until:"typeof state !== 'undefined' && state.booted && state.sessions.length > 0"},{js:"if(state.sessions.some(s=>s.kind!=='copilot'))throw Error('wrong profile'); setView('sessions')"},{shot:'sessions'},
 {js:'newSessionModal()'},{until:"!!document.querySelector('[data-new-agent=copilot]')"},{js:"if(document.querySelectorAll('[data-new-agent]').length!==1)throw Error('uninstalled agent offered')"},{shot:'new-copilot-only'},{js:'closeModal();select('+JSON.stringify(key)+')'},{until:'chatFor().loaded'},{wait:1000},{shot:'conversation'},
 {js:'recapDialog(state.byKey.get(state.sel))'},{until:"!!document.querySelector('[data-recap-summary]')"},{shot:'catch-up'},
 {js:"if(innerWidth<=700)nxClosePhoneRecap(); nx.panel=true; nx.panelMode='details';renderHead()"},{shot:'details'},{js:'nx.panel=false;renderHead()'},
 {js:'nxModelMenu()'},{until:"!!document.querySelector('#nxModelMenu')"},{shot:'model-next-resume'},{js:'nxCloseModel()'}];
 if(!real){steps.push({js:"select('copilot:"+fixture.IDs.quota+"')"},{until:"chatFor().loaded && document.querySelector('#chatMessages')?.innerText.includes('monthly quota')"},{shot:'quota'},
 {js:'select('+JSON.stringify(key)+')'},{until:'chatFor().loaded'},{js:"document.querySelector('#steerIn').value='Show a question';document.querySelector('#steerIn').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-steer=send]').click()"},
 {until:"!!document.querySelector('[data-chat-answer]')"},{shot:'folder-trust'},{click:'[data-chat-answer="1"]'},{wait:1000},{js:"document.querySelector('[data-chat-retry]')?.click()"},{until:"document.querySelector('#chatPending')?.innerText.includes('run this command')"},{shot:'pending-question'},{click:'[data-chat-answer="1"]'},{until:"document.querySelector('#chatMessages')?.innerText.includes('Your answer was received')"},{shot:'delivered'});}
 steps.push({js:"setView('spend')"},{wait:500},{shot:'spend'},{js:"if(document.documentElement.scrollWidth>innerWidth+2)throw Error('horizontal overflow'); ({copilotOnly:true,summaryProvider:state.summarizer.kind,sessionCount:state.sessions.length})"});
 fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(steps,null,2));const result=await run(['tools/cdp-tour.mjs',out],{...env,NEXUS_WIDTH:String(width),NEXUS_HEIGHT:String(height)});fs.writeFileSync(path.join(out,'verification.txt'),real?'PASS read-only Copilot tour; no sends or resumes. Screenshots remain local.\n':result.trimEnd()+'\n');console.log('PASS '+(real?'read-only real':'Copilot-only fixture')+' '+width+'x'+height);
 }
 if(real){const response=await fetch('http://127.0.0.1:'+port+'/api/action',{method:'POST',headers:{'content-type':'application/json','x-nexus':'1'},body:JSON.stringify({action:'term-resume',key:'copilot:'+data.sessions[0].id})});assert.equal(response.status,400);console.log('PASS read-only action refusal');}
 }finally{server.kill();fs.writeFileSync(path.join(root,'server.log'),logs);}})().catch(e=>{console.error(e);process.exitCode=1});
