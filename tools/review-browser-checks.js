// Runs only against the synthetic review fixture, at all requested viewports.
window.reviewCheck=(value,label)=>{if(!value)throw Error(label);console.log('PASS '+label);};
setView('overview');
const oldUsage=state.usage;state.usage={claude:{},astra:{primary:{pct:null}},copilot:{premiumRequests:null}};
reviewCheck(nxUsage()==='','empty usage groups hidden');
state.usage={copilot:{month:{pct:45},premiumRequests:135}};reviewCheck(/Month/.test(nxUsage())&&/135/.test(nxUsage()),'reported monthly premium usage');state.usage=oldUsage;
reviewCheck(!/not reported/i.test(document.querySelector('#nxHome').innerText),'unknown Home fields hidden');
for(const el of document.querySelectorAll('.nx-card-latest,.nx-row-context,.nx-recent-context'))reviewCheck(!/\*\*|```|^\s*\|/m.test(el.textContent),'plain preview');
reviewCheck(document.querySelector('[data-usage-agent="copilot"]'),'Copilot usage group');
if(innerWidth>700){
 const grid=document.querySelector('.nx-home-grid'),map=grid.lastElementChild;
 reviewCheck(map.classList.contains('nx-project-map'),'map is last shared grid cell');
 reviewCheck(getComputedStyle(grid).gap==='12px','12px grid gap');
 for(const card of grid.querySelectorAll('.nx-home-card')){
  reviewCheck(card.getBoundingClientRect().width>=319,'card minimum width');
  reviewCheck(card.querySelector('.nx-card-foot .nx-call-entry')?.getBoundingClientRect().width===32,'32px footer Call');
 }
}else{
 reviewCheck(getComputedStyle(document.querySelector('.nx-phone-usage')).gridTemplateColumns.split(' ').length===2,'two-column phone usage');
 const saved=document.querySelector('[data-swipe-row]');
 reviewCheck(saved&&getComputedStyle(saved.querySelector('.nx-call-entry')).visibility==='hidden','saved Call hidden');
 saved.querySelector('.nx-phone-row').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:250,clientY:100}));
 saved.querySelector('.nx-phone-row').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:150,clientY:100}));
 reviewCheck(saved.classList.contains('revealed')&&getComputedStyle(saved.querySelector('.nx-call-entry')).visibility==='visible','swipe-left reveals saved Call');
 saved.classList.remove('revealed');
}
select('astra:s-voice');await loadChat(state.sel,true);
reviewCheck(!document.querySelector('.chat-thinking-live'),'no duplicate thinking indicator');
reviewCheck(!/turn started|turn complete/.test(document.querySelector('#chatMessages').innerText),'turn noise hidden');
reviewCheck(document.querySelectorAll('.chat-live-state').length===1,'one working indicator');
reviewCheck(document.querySelector('.chat-live-state [data-chat-answer="esc"]'),'live Stop control');
const agent=document.querySelector('.ev.ai .nx-agent-name');if(agent)reviewCheck(agent.classList.contains('astra'),'Astra stream identity');
if(innerWidth<=700){
 const head=document.querySelector('#focusHead'),call=head.querySelector('.nx-call-entry').getBoundingClientRect(),more=head.querySelector('.session-more').getBoundingClientRect(),catchup=head.querySelector('.nx-catchup').getBoundingClientRect(),model=head.querySelector('.nx-model-select').getBoundingClientRect();
 reviewCheck(call.width===40&&Math.abs(call.top-more.top)<5,'40px Call in first phone row');
 reviewCheck(catchup.top>call.bottom&&Math.abs(catchup.top-model.top)<2,'Catch me up and model in second row');
 reviewCheck(catchup.right<=model.left,'phone header controls do not overlap');
}
select('copilot:11111111-1111-4111-8111-111111111111');await loadChat(state.sel,true);
reviewCheck(document.querySelector('.ev.ai .nx-agent-name.copilot'),'Copilot reply identity');
reviewCheck(!/not reported/i.test(document.querySelector('#focus').innerText),'unknown Details values hidden');
const original=chatFor().events;
chatFor().events=[{t:'user',ts:'2026-01-01T00:00:00Z',text:'Review the release.'},{t:'note',ts:'2026-01-01T00:00:01Z',text:'turn started'},{t:'user',ts:'2026-01-01T00:01:00Z',text:'Review the release!  '},{t:'think',durationSeconds:9,ts:'2026-01-01T00:01:01Z',text:'Check the release checklist and make sure the preview remains readable. Then verify the remaining details.'},{t:'note',ts:'2026-01-01T00:01:10Z',text:'turn aborted'}];renderReadableChat();
reviewCheck(document.querySelectorAll('#chatMessages .ev.user').length===1,'duplicate user hidden across notes');
reviewCheck(document.querySelector('.chat-thinking summary').textContent.startsWith('Thought for 9s - '),'measured thinking label');
document.querySelector('.chat-thinking summary').click();reviewCheck(document.querySelector('.chat-thinking').open,'thinking expands');
reviewCheck(document.querySelector('#chatMessages .note')?.textContent.includes('turn aborted'),'aborted turn retained');
chatFor().events=original;renderReadableChat();
reviewCheck(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');
setView('overview');
'PASS review browser checks at '+innerWidth;
