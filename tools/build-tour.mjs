import fs from 'node:fs';
import path from 'node:path';
// Loaded only after design-tour validates port 4790 and the TEMP scratch directory.
export function prepare(scratch, width) {
  const out = path.resolve(`docs/shots/tmp/build-${width}`);
  fs.mkdirSync(out, { recursive: true }); fs.mkdirSync('docs/shots/build', { recursive: true });
  const shot = name => ({ shot: `../../build/${width}-${name}` });
  const check = String.raw`(() => {
    const assert = (v,m) => { if(!v) throw Error(m); console.log('PASS',m); };
    assert(document.documentElement.scrollWidth<=innerWidth,'no horizontal page overflow');
    assert(state.sessions.length>0 && state.briefing.measured>0,'real sessions and measured usage');
    assert(!apsis.voice && window.__spoken===0,'voice defaults off and tests remain silent');
    assert(state.view==='overview','overview is the startup destination');
    assert(!!document.querySelector('link[rel=manifest]'),'install manifest linked');
    const cards = [...document.querySelectorAll(innerWidth<701?'#phoneSessions .mission-card':'.mission-channel .mission-card')];
    assert(cards.length>0,'session briefing cards exist');
    for(const label of ['OBJECTIVE','WHILE YOU WERE AWAY','NOW','ON TRACK?','SPEND']) assert(cards[0].textContent.includes(label),'card answers '+label);
    assert(cards[0].querySelector('[data-open]'),'card has a direct focus action');
    if(innerWidth>1100)assert(Math.max(...cards.map(c=>c.getBoundingClientRect().bottom))<=$('.overview-tray').getBoundingClientRect().top,'cards never overlap limits');
    console.log('LAYOUT',JSON.stringify({size:[innerWidth,innerHeight],overview:$('#overview').getBoundingClientRect().toJSON(),card:cards[0].getBoundingClientRect().toJSON(),tray:$('.overview-tray').getBoundingClientRect().toJSON()}));
  })()`;
  const interaction = String.raw`(async()=>{
    const assert=(v,m)=>{if(!v)throw Error(m);console.log('PASS',m)};
    const s=state.byKey.get(state.sel);
    assert(state.view==='focus' && !!state.transcript,'focus reads the real transcript');
    assert($('#feed').clientHeight>180,'feed keeps a useful reading height');
    const more=$('.session-more'); more.open=true; more.querySelector('summary').focus();
    const title=s.title;s.title+=' updated';renderHead();assert($('.session-more').open && document.activeElement.tagName==='SUMMARY','polling preserves open menu and focus');s.title=title;$('.session-more').open=false;
    const original=act;let writes=0;act=async()=>{writes++;return false};
    try{
      focusCheckDialog(s);assert(writes===0,'opening focus check never invokes a model');closeModal();
      newSessionModal();assert($('#app').inert && document.activeElement.id==='folderSearch','modal isolates background and focuses search');
      $('#folderSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(!$('#app').inert,'Escape dismisses modal');
      const realApi=api;api=async()=>{throw Error('offline fixture')};await refresh();assert(!$('#connection').classList.contains('hidden'),'connection failure is visible');api=realApi;$('#connection').classList.add('hidden');
      assert(writes===0,'read-only interaction checks send no session actions');
    }finally{act=original;closeModal()}
  })()`;
  const scratchCheck = `(async()=>{
    const originalAct=act;
    act=async(action,extra)=>{if(action.startsWith('term-') && !(action==='term-new' && extra.cwd===${JSON.stringify(scratch)}) && !(action==='term-close'&&extra.term===window.scratchTerminal?.id))throw Error('Test refused non-scratch terminal action');return originalAct(action,extra)};
    await openInApp('term-new',{cwd:${JSON.stringify(scratch)}});window.scratchTerminal=selTerm();
    if(!window.scratchTerminal || window.scratchTerminal.cwd!==${JSON.stringify(scratch)})throw Error('Scratch terminal not created');
    console.log('SCRATCH_TERMINAL',JSON.stringify(window.scratchTerminal));state.tab='term';renderHead();
  })()`;
  const phoneControls = String.raw`(async()=>{
    const assert=(v,m)=>{if(!v)throw Error(m);console.log('PASS',m)};
    state.tab='chat';renderHead();
    assert(!!$('#steerIn') && !!$('#chatOutput'),'chat has a composer and terminal response');
    const v=termViews.get(window.scratchTerminal.id),old=termSend,sent=[];
    termSend=(target,data)=>{assert(target.id===window.scratchTerminal.id,'only scratch terminal selected');sent.push(data);return true};
    try{
      $('#steerIn').value='A test direction';steer('send');await new Promise(r=>setTimeout(r,200));
      steer('esc');steer('approve');steer('1');steer('2');steer('3');
      assert(JSON.stringify(sent)===JSON.stringify(['A test direction','\r','\x1b','\r','1','2','3']),'Send, Interrupt, Approve and numbered keys encode correctly');
      const ws=v.ws;v.ws={readyState:0};$('#steerIn').value='Keep this draft';steer('send');assert($('#steerIn').value==='Keep this draft','disconnected send retains draft');v.ws=ws;
    }finally{termSend=old;$('#steerIn').value='';$('#toasts').innerHTML='';}
    const controls=[...$$('.steer-buttons button')];if(innerWidth<701)for(const b of controls)assert(b.getBoundingClientRect().height>=44,'phone touch target '+b.textContent);
  })()`;
  const steps = [
    { wait: 800 }, shot('boot'), { wait: 3500 }, { js: check }, shot('overview'),
    { js: "setTheme('parallax')" }, shot('parallax'), { js: "setTheme('stratum')" }, shot('stratum'), { js: "setTheme('apsis'); finder('Nexus Deck astra')" }, shot('finder'),
    { js: "closeModal(); select(keyOf(state.sessions.find(s=>s.kind==='astra'&&s.brief)||state.sessions[0]))" }, { wait: 800 }, shot('focus'), { js: interaction },
    { js: "state.tab='thinking';renderHead()" }, shot('thinking'),
    { js: "state.tab='feed';renderHead();insightAction('digest',state.byKey.get(state.sel))" }, shot('away'),
    { js: "closeModal();insightAction('spend',state.byKey.get(state.sel))" }, shot('spend'),
    { js: "closeModal();readBrief(state.byKey.get(state.sel))" }, { wait: 300 }, shot('brief'),
    { js: "closeModal();focusCheckDialog(state.byKey.get(state.sel))" }, shot('check-focus'),
    { js: "closeModal();setView('wall')" }, { wait: 900 }, shot('wall'),
    { js: scratchCheck }, { wait: 3000 }, shot('terminal'),
    { js: "state.tab='chat';renderHead()" }, { wait: 500 }, shot('chat'), { js: phoneControls },
    { js: "(async()=>{await closeTerm(window.scratchTerminal);if(state.terms.some(t=>t.id===window.scratchTerminal.id))throw Error('Scratch terminal leaked');console.log('PASS scratch terminal closed');setView('overview')})()" },
    { js: "JSON.stringify({localResources:performance.getEntriesByType('resource').every(r=>r.name.startsWith(location.origin)),theme:pref.get('theme'),voice:pref.get('voice','off'),terms:state.terms.length,overflow:document.documentElement.scrollWidth>innerWidth})" }
  ];
  fs.writeFileSync(path.join(out, 'steps.json'), JSON.stringify(steps, null, 2)); console.log(out);
}
