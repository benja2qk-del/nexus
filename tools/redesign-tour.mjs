import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{fixture}=require('./redesign-fixture.cjs');
const phase=process.argv[2]||'phase1';
await new Promise((r,j)=>{const p=net.createServer();p.once('error',j);p.listen(4791,'127.0.0.1',()=>p.close(r))});
const {root,env}=fixture();console.log('Fixture: '+root);
const guard=path.join(root,'guard.js');fs.writeFileSync(guard,`const realFetch=window.fetch.bind(window);window.fetch=(url,options={})=>{if(new URL(url,location.href).pathname==='/api/action'&&!['viewed'].includes(JSON.parse(options.body||'{}').action))throw Error('Read-only screenshot tour blocked action');return realFetch(url,options)};`);
const server=spawn(process.execPath,['--require','./tools/redesign-preload.cjs','server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
process.on('exit',()=>server.kill());
try{
 await new Promise((r,j)=>{const timeout=setTimeout(()=>j(Error('Server timeout')),15000);server.stdout.on('data',d=>{if(String(d).includes('4791/')){clearTimeout(timeout);r()}});server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>j(Error('Server exit '+c)))});
 for(const [width,height] of [[1568,773],[1920,1080],[390,844]]){
  const out=path.resolve('docs/shots/redesign',phase,String(width));fs.mkdirSync(out,{recursive:true});
  const steps=[{viewport:[width,height]},{navigate:'/'},{until:`!!document.querySelector('.nx-boot-log')`},{wait:1700},{shot:'boot'},{until:`typeof state!=='undefined' && state.booted && state.sessions.length>0`},{wait:1300},{js:`nx.panel=${width>700};select('claude:s-dashboard');`},{until:`chatFor().loaded && !!document.querySelector('#chatMessages .ev')`},{shot:'session'},{js:`document.querySelector('#chatView').scrollTop=0`},{shot:'session-top'},{js:`document.querySelector('#chatView').scrollTop=document.querySelector('#chatView').scrollHeight`},{js:`select('claude:s-deploy')`},{until:`!!document.querySelector('.permission-card')`},{shot:'question'},{js:`setView('sessions')`},{shot:'sessions'},{js:`if(document.documentElement.scrollWidth>innerWidth)throw Error('Horizontal overflow');'PASS viewport '+innerWidth`}];
  if(phase!=='phase1')steps.push({js:`setView('overview')`},{shot:'home'},{js:`setView('wall')`},{shot:'wall'});
  if(['phase3','phase4'].includes(phase))steps.push({js:`select('claude:s-dashboard');`},{until:`chatFor().loaded`},{js:`nxModelMenu()`},{until:`!!document.querySelector('#nxModelMenu')`},{shot:'model'},{js:`nxCloseModel();nxPalette();`},{shot:'palette'},{js:`document.querySelector('#nxCommandQuery').value='dashboard';document.querySelector('#nxCommandQuery').dispatchEvent(new Event('input'));if(document.querySelectorAll('#nxCommandResults [role=option]').length!==1)throw Error('Palette search failed');`},{shot:'palette-filter'},{js:`closeModal();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}));if(document.activeElement.id!=='search')throw Error('Search shortcut failed');document.activeElement.blur();`});
  if(phase==='phase4')steps.push({js:`setView('spend')`},{shot:'spend'},{js:`setView('settings');await nxCreatePair();`},{until:`!!document.querySelector('.nx-qr svg') && !!nx.devices`},{shot:'settings'},{js:`document.querySelector('#nxSetting-voice').scrollIntoView()`},{shot:'voice-settings'},{js:`document.querySelector('[data-nx-theme=oled]').click()`},{shot:'theme-oled'},{js:`document.querySelector('[data-nx-theme=ink]').click();await newSessionModal();`},{until:`!!document.querySelector('#nxNewModels [role=radio]')`},{shot:'new'},{js:`document.querySelector('#newMessage').scrollIntoView()`},{shot:'new-message'},{js:`document.querySelector('[data-new-agent=astra]').click();if(!document.querySelector('[data-new-model="gpt-6-astra"]'))throw Error('Codex models missing');closeModal();select('claude:s-dashboard');`},{until:`chatFor().loaded`},{js:`document.querySelector('#sessionRecap').click()`},{until:`!!document.querySelector('[data-recap-summary]')`},{shot:'catchup'},{js:`closeModal();state.tab='term';renderHead();`},{wait:900},{shot:'raw'},{js:`state.tab='chat';renderHead();if(document.documentElement.scrollWidth>innerWidth)throw Error('Horizontal overflow');`});
  if(width===1568&&phase==='phase2')for(const size of [32,180,192,256,512])steps.push({icon:{size,name:`../../../../../public/${size===180?'apple-touch-icon':`icon-${size}`}.png`}});
  if(width===1568&&phase==='phase2')steps.push({icon:{size:512,name:'../../../../../public/icon-maskable-512.png',source:'/icon-maskable.svg'}});
  fs.writeFileSync(path.join(out,'steps.json'),JSON.stringify(steps,null,2));
  const p=spawn(process.execPath,['tools/redesign-browser.mjs','4791',out,path.join(out,'steps.json')],{env:{...env,NEXUS_TOUR_SOURCE:guard},windowsHide:true,stdio:'inherit'});
  await new Promise((r,j)=>p.once('exit',c=>c?j(Error('Tour failed '+width)):r()));
 }
}finally{server.kill();}

