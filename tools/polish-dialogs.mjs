import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {browser,sleep} from './polish-browser.mjs';
const report=[];
for(const [width,height] of [[390,844],[430,932],[1366,768],[1920,1080]]){
  const b=await browser(width,height);let terminal;
  try{
    await b.navigate();await b.until('state.booted && state.sessions.length');
    const cases=[
      ['brief-reader',"readBrief(state.sessions.find(s=>s.brief&&s.size<500000)||state.sessions.find(s=>s.brief))"],
      ['session-spend',"insightAction('spend',state.sessions.find(s=>s.insights?.spend?.measured)||state.sessions[0])"],
      ['help',"$('#overviewHelp').click()"],
      ['already-running',"runAction('resume',{...state.sessions[0],kind:'claude',live:true,term:null,inNexus:false,pid:1234})"],
      ['remote-control',"toggleRemote({...state.sessions[0],kind:'claude',live:true,term:null,remote:false,pid:1234})"],
    ];
    for(const [name,expr] of cases){
      await b.js(expr);await sleep(200);await b.shot(`docs/shots/polish/${width}-${name}.png`);
      assert(await b.js("$('#modal').classList.contains('on') && $('#app').inert && document.documentElement.scrollWidth<=innerWidth"));
      await b.js('closeModal()');report.push(`PASS ${width} ${name} is readable, modal and contained; no launch confirmed`);
    }
    if(width<701){
      const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-polish-raw-'));
      await b.js(`await openInApp('term-new',{cwd:${JSON.stringify(scratch)}})`);terminal=await b.js('selTerm().id');
      await b.js("state.tab='term';renderHead()");await b.until('termViews.get(selTerm().id).ws.readyState===1');await sleep(600);
      assert(await b.js("$('#focusHead [data-tab=term]').getBoundingClientRect().width>=44"));await b.shot(`docs/shots/polish/${width}-terminal.png`);
      await b.js('await closeTerm(selTerm())');terminal=null;report.push(`PASS ${width} raw terminal identifies its active tab`);
    }
    assert.equal(b.exceptions.length,0,JSON.stringify(b.exceptions));
  }finally{if(terminal)await b.js(`await act('term-close',{term:${JSON.stringify(terminal)}})`);await b.close();}
}
fs.writeFileSync('docs/shots/polish/dialog-checks.txt',report.join('\n')+'\n');console.log(report.join('\n'));
