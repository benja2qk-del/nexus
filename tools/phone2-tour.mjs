// Project regression tour. Browser fixtures never launch or write to owner's sessions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {browser, sleep} from './polish-browser.mjs';
const width=Number(process.argv[2])||390, height=Number(process.argv[3])||844;
const out='docs/shots/phone2'; fs.mkdirSync(out,{recursive:true});
const b=await browser(width,height), report=[];
const check=async(expr,label)=>{assert(await b.js(expr),label);report.push('PASS '+label);};
const shot=async name=>{await sleep(250);await check('document.documentElement.scrollWidth<=innerWidth',name+' has no horizontal page overflow');await b.shot(`${out}/${width}-${name}.png`);};
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-phone2-fixture-'));
try{
  await b.navigate();await b.until('state.booted && state.sessions.length>0');await sleep(600);
  await shot('project-overview');
  await check("$$('#projectStrip [data-project-filter]').length===projectGroups().length+1",'every project is reachable in the strip');
  if(width<701){
    const rect=await b.js("(()=>{const r=$('#projectStrip').getBoundingClientRect();return {x:r.right-30,y:r.top+r.height/2}})()");
    await b.cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x,y:rect.y}]});
    for(let dx=30;dx<=180;dx+=30)await b.cmd('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x-dx,y:rect.y}]});
    await b.cmd('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(350);
    await check("$('#projectStrip').scrollLeft>50",'project strip responds to a horizontal touch swipe');
  }else{
    await b.js("$('#orbitProjects [data-project]').click()");await check("state.view==='project'",'desktop orbit opens the shared project workspace');await b.js("setView('overview')");
  }
  await b.js("window.realGroup=(projectGroups().find(g=>g.sessions.some(s=>s.live))||projectGroups()[0]).key;filterProject(realGroup)");
  await shot('project-filtered');
  await check('visible().every(s=>s.group===realGroup)','project selection filters session cards');
  await b.js('openProject(realGroup)');await shot('project-live-page');
  await check("JSON.parse(pref.get('place')).view==='project'",'project navigation is saved per device');
  await b.js('location.reload()');await b.until("state.booted && deviceUI.restored && state.view==='project'");await sleep(1200);
  await check("$('#projectTitle').textContent===projectGroups().find(g=>g.key===projectUI.key).label",'reload restores the project page');
  // Fully specified project evidence makes coverage, grouping and change checks repeatable.
  await b.js(`window.savedApi=api;window.savedAct=act;window.savedOpen=openInApp;window.actionLog=[];window.launches=[];
    window.fixtureBase=${JSON.stringify(scratch)};
    window.makeFixture=(id,group,kind='claude',extra={})=>({id,kind,group,groupLabel:group,cwd:fixtureBase+'\\\\'+group,title:'Session '+id,firstPrompt:'Build a thoughtful project experience.',lastText:'Recorded progress for this session.',updated:Date.now()-Number(id.replace(/\\D/g,''))*1000,status:'offline',live:false,size:10,
      insights:{objective:{title:'Refine the project workspace',request:'Make project activity easy to catch up on.'},alignment:{verdict:'Aligned',reason:'Work follows the request.'},waste:[],
        digest:{since:Date.now()-3600000,firstVisit:false,turns:2,tools:3,files:['src/project.js'],commits:[{confirmed:true,hashes:['abc1234'],command:'git commit',result:'Recorded commit'}],errors:0,opening:'Project navigation is ready for review.',partial:false},
        spend:{measured:true,total:1200,input:700,output:300,cacheRead:200,cacheWrite:0,turns:[{total:1200,request:'Review navigation',at:Date.now()}],partial:false}},...extra});
    window.fixtures=Array.from({length:11},(_,i)=>makeFixture('a'+i,'Atlas',i%2?'astra':'claude',{cwd:fixtureBase+(i%2?'\\\\atlas-worktree':'\\\\atlas'),status:i===0?'busy':i===2?'idle':'offline',live:i===0||i===2}));
    fixtures[1].insights.digest={...fixtures[1].insights.digest,since:null,firstVisit:true};fixtures[2].insights.spend.partial=true;
    fixtures.push(makeFixture('b1','Beacon','astra',{status:'busy',live:true}));
    fixtures.push(makeFixture('q1','Quiet place','astra',{insights:{digest:{since:null,firstVisit:true,turns:5,tools:2,files:[],commits:[],errors:0,partial:false},spend:{measured:false}}}));
    fixtures.push(makeFixture('m1','Missing folder','astra',{cwd:'',insights:{}}));
    fixtures.push(makeFixture('x1','A very long project '+ 'identifier'.repeat(15)+' <&>','astra'));
    for(let i=0;i<12;i++)fixtures.push(makeFixture('p'+i,'Place '+String(i).padStart(2,'0')));
    window.fixtureData=()=>({now:Date.now(),home:fixtureBase,sessions:fixtures,terms:[],usage:{},briefing:{working:2,waiting:1,text:'Project tour fixture. Two agents, many places.'},remote:true});
    api=async p=>p==='/api/sessions'?fixtureData():p.startsWith('/api/transcript')?{size:10,capturedAt:Date.now(),events:[{t:'ai',text:'Project fixture transcript.'}],activity:{goal:'Project fixture',steps:0,tasks:[]}}:savedApi(p);
    act=async(action,extra)=>{actionLog.push({action,...extra});return true};
    openInApp=async(action,extra)=>{launches.push({action,...extra});return false};
    state.sel=null;state.transcript=null;state.transcriptKey=null;projectUI.key=null;state.group='*';setView('overview');await refresh();`);
  await check("projectGroups().length===17 && $$('#projectStrip button').length===18",'many projects and both agents remain available');
  await b.js("state.query='absent';state.filter='astra';filterProject('Atlas')");
  await check("visible().length===11 && state.query==='' && state.filter==='all'",'project tap clears conflicting filters');
  await check("$$('#phoneSessions .mission-card').every(el=>state.byKey.get(el.dataset.session).group==='Atlas')",'phone cards contain only the chosen project');
  await check("$('#projectStrip [data-project-filter=Atlas]').classList.contains('waiting') && $('#projectStrip [data-project-filter=Atlas]').textContent.includes('1 working · 1 waiting')",'working and waiting indicators coexist accurately');
  await check("$$('#projectStrip [data-project-filter=Atlas] .project-agent').length===2",'Claude and Astra marks identify mixed projects');
  await b.js("$('#projectStrip [data-project-filter=Atlas]').click()");await check("state.group==='*'",'tapping the selected tile clears the project filter');
  await b.js("filterProject('Atlas');$('#projectStrip [data-project-filter=\"*\"]').click()");await check("state.group==='*'",'All projects clears the project filter');
  await b.js("filterProject('Atlas');window.strip=$('#projectStrip');strip.scrollLeft=250;$('#projectStrip [data-project-filter=Atlas]').focus({preventScroll:true});fixtures[0].status='idle';renderApsis()");
  await check("document.activeElement.dataset.projectFilter==='Atlas' && $('#projectStrip').scrollLeft>0",'polling preserves tile focus and horizontal position');
  await b.js("fixtures[0].status='busy';filterProject('Atlas');filterProject('Atlas');$('#projectSelection [data-project]').click()");
  await check("state.view==='project' && $('#projectTitle').textContent==='Atlas'",'selected strip opens the project page');
  await check('actionLog.length===0','browsing projects does not advance seen checkpoints');
  await check("$('.project-away h2').textContent==='10 sessions moved ahead.' && $('.project-away').textContent.includes('20 turns · 30 tool calls')",'away summary excludes first-visit history');
  await check("$('.project-spend h2').textContent.includes('13k') && $('.project-spend').textContent.includes('11 / 11') && $('.project-spend').textContent.includes('partial scans')",'spend totals include coverage and partial labels');
  await check("$$('.project-change').length===3 && !!$('[data-project-away-more]')",'long change lists keep sessions reachable');
  await shot('project-evidence-fixture');
  await b.js("$('[data-project-away-more]').click()");await check("$$('.project-change').length===10",'all changed sessions can be expanded');
  await b.js("projectUI.awayCount=3;renderProjectPage();$('[data-project-jump]').click()");
  await check("document.activeElement.id==='projectSessionsTitle' && $$('.project-session-grid .mission-card').length===8",'session shortcut jumps to the project cards');
  await shot('project-sessions-fixture');
  await b.js("$('[data-project-more]').click()");await check("$$('.project-session-grid .mission-card').length===11",'all project sessions can be loaded');
  await b.js("$('#search').value='Session a10';$('#search').dispatchEvent(new Event('input'))");await sleep(200);
  await check("$$('.project-session-grid .mission-card').length===1 && $('.project-session-grid').textContent.includes('Atlas')",'desktop search narrows sessions inside the current project');
  await b.js("state.query='no matching session';renderApsis();$('[data-project-clear-search]').click()");
  await check("$$('.project-session-grid .mission-card').length===11 && state.query===''",'empty search can be cleared without leaving the project');
  await b.js("$('.project-spend').scrollIntoView({block:'start'})");await shot('project-spend-summary');
  await b.js("window.originalSel=state.sel;$('#projectPage').scrollTop=0;$('[data-project-new=astra]').click()");
  await check("$('#modalCard [name=agent]:checked').value==='astra' && $$('.folder-option').length===2 && $$('.folder-option').every(el=>el.textContent.includes('Atlas'))",'Astra launch scopes folder choices to the aliased project');
  await shot('project-new-astra');
  await b.js("window.pickedFixture=$$('.folder-option')[1].dataset.cwd;$$('.folder-option')[1].click();$('#startSession').click()");await sleep(100);
  await check("launches.at(-1).action==='term-new-astra' && launches.at(-1).cwd===pickedFixture && state.sel===originalSel",'project launch submits chosen folder without changing the selected session');
  await check("$('#modal').classList.contains('on') && $('#startSession').textContent==='Try again'",'launch failure retains project choice and retry');
  await b.js("closeModal();$('[data-project-new=claude]').click();$('#startSession').click()");await sleep(100);
  await check("launches.at(-1).action==='term-new' && launches.at(-1).cwd.startsWith(fixtureBase)",'Claude launch uses the same scoped in-app flow');
  await b.js("closeModal();$('[data-project-spend]').click()");await check("$$('.spend-sessions button').length===11",'project spend lists only its own sessions');await shot('project-spend');
  await b.js("closeModal();$('.project-change').click()");await check("$('#modalCard').textContent.includes('abc1234') && $('#modalCard').textContent.includes('src/project.js')",'project catch-up opens recorded change evidence');await shot('project-away');
  await b.js("closeModal();$('.project-session-grid [data-open]').click()");await b.until('!!state.transcript');
  await check("state.view==='focus' && $('#backOverview').textContent==='← Project'",'project sessions open the normal focus view with project return');
  await b.js("$('#backOverview').click()");await check("state.view==='project' && projectUI.key==='Atlas'",'back from a session returns to its project');
  for(const theme of ['stratum','parallax']){await b.js(`setTheme('${theme}');$('#projectPage').scrollTop=0`);await shot('project-'+theme);}
  await b.js("setTheme('apsis');openProject('Quiet place')");await check("$('.project-spend h2').textContent.includes('—') && $('.project-away h2').textContent.includes('first look')",'unreported usage and first visits do not pretend to be zero or caught up');await shot('project-first-visit');
  await b.js("openProject('Missing folder')");await check("$$('[data-project-new]').every(b=>b.disabled)",'missing project folders cannot fall back to another project');
  await b.js("openProject(fixtures.find(s=>s.id==='x1').group)");await shot('project-long-title');
  await check("$('#projectTitle').textContent.includes('<&>') && !$('#projectTitle').querySelector('*')",'project names are escaped safely');
  await b.js("fixtures=fixtures.filter(s=>s.group!==projectUI.key);await refresh()");await shot('project-unavailable');
  await check("$('#projectPage').textContent.includes('No sessions here right now') && !$('[data-project-new]')",'disappearing project has an honest empty state');
  await b.js("state.sel=null;fixtures=[];await refresh();setView('overview');filterProject('*')");await shot('projects-empty');
  await check("$$('#projectStrip button').length===1",'empty collection retains a usable All projects tile');
  await b.js('api=savedApi;act=savedAct;openInApp=savedOpen;state.group="*";projectUI.key=null;await refresh();openProject(projectGroups()[0].key)');
  await b.cmd('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});await b.js('await refresh()');
  await check("state.view==='project' && !$('#connection').classList.contains('hidden') && !!$('#projectTitle')",'offline project retains its last evidence');await shot('project-offline');
  await b.cmd('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await b.js('await refresh()');await check("$('#connection').classList.contains('hidden') && state.view==='project'",'reconnection preserves the project');
  if(width<701){await check("$$('[data-project-new],.project-tile,.project-back,.project-jump').filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)",'project touch controls meet 44px');await check("$('#mobileDock').getBoundingClientRect().height>=60 && $('#mobileDock').getBoundingClientRect().bottom<=innerHeight",'project view retains the phone navigation dock');}
  assert.equal(b.exceptions.length,0,JSON.stringify(b.exceptions));report.push('PASS no uncaught browser errors; project launch checks use stubs only');
} finally {await b.close();fs.writeFileSync(`${out}/${width}-project-checks.txt`,report.join('\n')+'\n');}
console.log(`${width}x${height}: ${report.length} project checks passed.`);
