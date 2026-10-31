'use strict';
function nxCloseRaw(restore = true) {
  const drawer = $('#nxRaw'); if (!drawer) return;
  const view = termViews.get(shownTerm);
  $('#nxConversation').append($('#termHost')); drawer.remove(); hideTerms(); restoreTermHeight(view);
  nx.rawKey = null; $('#nxConversation').classList.remove('nx-raw-open');
  for(const id of ['focusHead','chatView','steer','nxPhoneRecap'])if($('#'+id))$('#'+id).inert=false;
  if(restore)$('#focusHead [aria-label="More actions"]')?.focus({preventScroll:true});
}
function nxOpenRaw() {
  const t=selTerm(),s=state.byKey.get(state.sel)||t;
  if(!s)return;
  if($('#nxRaw'))return;
  NexusVoice.navigation(); nx.rawKey=state.sel;
  const drawer=document.createElement('section');drawer.id='nxRaw';drawer.setAttribute('role','dialog');drawer.setAttribute('aria-label','Raw terminal');
  drawer.innerHTML=`<header>${nxIcon('terminal')}<b>Raw terminal</b><span>· ${esc(s.title)}</span><button aria-label="Close raw terminal" data-raw-close>${nxIcon('close')}</button></header><p class="nx-raw-note">ⓘ For rare cases, Chat is the normal way.</p><div class="nx-raw-empty" ${t?'hidden':''}>${t?'':'This session has no terminal open in NEXUS. Resume it from Chat to use the terminal.'}</div><footer role="toolbar" aria-label="Terminal keys">${[['esc','Esc'],['enter','Enter'],['1','1'],['2','2'],['3','3']].map(([id,label])=>`<button data-raw-key="${id}" ${!t||t.exited?'disabled':''}>${label}</button>`).join('')}<span></span><button data-raw-copy ${t?'':'disabled'}>Copy</button><button data-raw-close>Close</button></footer>`;
  $('#nxConversation').append(drawer);drawer.querySelector('footer').before($('#termHost'));$('#nxConversation').classList.add('nx-raw-open');
  $('#focusHead details[open]')?.removeAttribute('open');
  if(innerWidth<=700)for(const id of ['focusHead','chatView','steer','nxPhoneRecap'])if($('#'+id))$('#'+id).inert=true;
  if(t)showTerm(t.id);
  // Keep virtual terminal keys from blurring xterm. Some CLI escape decoders
  // combine a lone Escape with an immediately following focus-report sequence.
  drawer.onpointerdown=e=>{if(e.target.closest('[data-raw-key]'))e.preventDefault();};
  drawer.onclick=e=>{
    if(e.target.closest('[data-raw-close]'))return nxCloseRaw();
    const view=t&&termViews.get(t.id),key=e.target.closest('[data-raw-key]');
    if(key&&view){const value={esc:'\x1b',enter:'\r','1':'1','2':'2','3':'3'}[key.dataset.rawKey];if(!termSend(view,value))toast('Terminal disconnected','Wait for it to reconnect, then try again.','bad');}
    if(e.target.closest('[data-raw-copy]')&&view){let text=view.xt.getSelection();if(!text){const b=view.xt.buffer.active,lines=[];for(let i=0;i<b.length;i++)lines.push(b.getLine(i)?.translateToString(true)||'');text=lines.join('\n').trimEnd();}copyText(text);}
  };
  drawer.querySelector('[data-raw-close]').focus({preventScroll:true});
}
const nxRound2ApplyTab=applyTab;
applyTab=function(){const raw=state.tab==='term';if(raw)state.tab='chat';if(nx.rawKey&&(nx.rawKey!==state.sel||state.view!=='focus'))nxCloseRaw(false);nxRound2ApplyTab();if(raw)nxOpenRaw();if(nx.rawKey&&selTerm())showTerm(selTerm().id);};
const nxRound2Head=renderHead;
renderHead=function(){
  if(nx.phoneRecapKey&&(nx.phoneRecapKey!==state.sel||innerWidth>700))nxClosePhoneRecap();
  if(nx.settingsKey&&nx.settingsKey!==state.sel)nxCloseSessionSettings(false);
  nxRound2Head();
  if($('#nxPhoneRecap'))$('#sessionRecap')?.setAttribute('aria-expanded','true');
};
const nxRound2View=setView;
setView=function(view){if(view!=='focus'){nxCloseRaw(false);nxClosePhoneRecap();nxCloseSessionSettings(false);}if(view!=='settings'&&$('#nxVoiceLive #talkPanel'))NexusVoice.end();nxRound2View(view);};

function nxCloseSessionSettings(restore=true){$('#nxSessionSettingsLayer')?.remove();nx.settingsKey=null;$('#app').inert=false;if(restore)$('#focusHead [aria-label="More actions"]')?.focus({preventScroll:true});}
async function nxSessionSettings(){
  const key=state.sel,s=state.byKey.get(key)||selTerm();if(!s)return;
  let catalog;try{catalog=await nxModels();}catch(error){toast('Settings unavailable',error.message,'bad');return;}if(key!==state.sel)return;
  nxCloseRaw(false);nxCloseModel();nxCloseSessionSettings(false);nx.settingsKey=key;
  const t=selTerm(),liveTerm=t&&!t.exited?t:null,phone=innerWidth<=700;
  const external=s.kind==='claude'&&s.live&&!liveTerm,question=chatFor().terminal?.prompt;
  const layer=document.createElement('div');layer.id='nxSessionSettingsLayer';layer.className=phone?'phone':'';
  layer.innerHTML=`<div class="nx-settings-scrim" data-session-dismiss></div><section id="nxSessionSettings" role="dialog" aria-modal="true" aria-label="Session settings"><header><b>Session settings</b><button data-session-dismiss aria-label="Close session settings">${phone?'Done':nxIcon('close')}</button></header><label class="nx-setting-name">Name<input id="nxSessionName" value="${esc(s.title)}" maxlength="200" ${key.startsWith('term:')?'disabled':''}></label><div class="nx-settings-label">Model</div><div role="radiogroup" aria-label="Model">${(catalog[s.kind]||[]).map(m=>`<button data-session-model="${esc(m.id)}" role="radio" aria-checked="${m.id===(s.nextModel||s.model)}" ${external||question?'disabled':''}><span><b>${esc(m.label)}</b> <small>${esc(m.description||'')}</small></span><i>${m.id===(s.nextModel||s.model)?'✓':''}</i></button>`).join('')}</div><p class="nx-settings-hint">${external?'Use /model in the terminal running this session.':question?'Answer the current question before changing models.':s.kind!=='claude'||!liveTerm?'Model applies on the next resume.':'Changes this session when Claude is ready.'}</p>${s.kind==='claude'?`<button class="nx-setting-remote" data-session-action="rc" role="switch" aria-checked="${!!(s.remote&&s.live)}"><span><b>Remote access</b><small>Claude Remote Control on your phone</small></span><span class="rc-track"><i></i></span></button>`:''}<div class="nx-session-utilities">${s.kind==='claude'?`<button data-session-action="fork" ${key.startsWith('term:')?'disabled':''}>${nxIcon('branch')}Fork from here</button>`:''}${state.remote?'':`<button data-session-action="folder">${nxIcon('folder')}<span>Open folder</span><small title="${esc(s.cwd||'')}">${esc((s.cwd||'').split(/[\\/]/).at(-1)||'Not recorded')}</small></button>`}</div><div class="nx-session-close">${liveTerm?'<button class="danger" data-session-confirm>Close session…</button>':`<p class="nx-settings-hint">${s.live?'This session runs outside NEXUS. Close it in its terminal.':'This session is saved. Resume it any time from Chat.'}</p>`}</div><p class="nx-settings-result" role="status"></p></section>`;
  document.body.append(layer);$('#app').inert=true;$('#focusHead details[open]')?.removeAttribute('open');
  const dialog=$('#nxSessionSettings'),name=$('#nxSessionName'),status=dialog.querySelector('[role=status]');
  if(!phone){const rect=$('#focusHead').getBoundingClientRect();dialog.style.top=Math.min(rect.bottom+8,Math.max(12,innerHeight-dialog.offsetHeight-12))+'px';dialog.style.right=Math.max(12,innerWidth-rect.right+24)+'px';}
  let saving=null;
  const save=async()=>{
    const title=name.value.trim();if(name.disabled||title===s.title)return true;if(saving)return saving;
    if(!title){name.value=s.title;return true;}
    status.textContent='Saving name…';
    saving=(async()=>{try{const r=await postNexus('/api/action',{action:'session-rename',key,title});s.title=r.result.title;status.textContent='Name saved';await refresh();return true;}catch(error){status.textContent=error.message;return false;}finally{saving=null;}})();return saving;
  };
  name.onblur=save;name.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save();name.blur();}};
  layer.onclick=async e=>{
    if(e.target.closest('[data-session-dismiss]')){if(await save())nxCloseSessionSettings();return;}
    const choice=e.target.closest('[data-session-model]');
    if(choice){dialog.querySelectorAll('[data-session-model]').forEach(b=>b.disabled=true);status.textContent=liveTerm&&s.kind==='claude'?'Waiting for confirmation…':'Saving model…';try{const r=await postNexus('/api/action',{action:liveTerm?'term-model':'session-model',key,term:liveTerm?.id,model:choice.dataset.sessionModel});status.textContent=r.result.deferred?'Model saved for next resume.':'Model confirmed for this session.';dialog.querySelectorAll('[data-session-model]').forEach(b=>{const on=b===choice;b.setAttribute('aria-checked',on);b.querySelector('i').textContent=on?'✓':'';});await refresh();}catch(error){status.textContent=error.message;}finally{dialog.querySelectorAll('[data-session-model]').forEach(b=>b.disabled=false);}return;}
    const action=e.target.closest('[data-session-action]');if(action){if(!await save())return;nxCloseSessionSettings(false);runAction(action.dataset.sessionAction,s);return;}
    if(e.target.closest('[data-session-confirm]')){dialog.querySelector('.nx-session-close').innerHTML=`<div class="nx-close-confirm" role="alertdialog" aria-label="Confirm close session"><p>Close <b>${esc(s.title)}</b>? The agent stops now. History stays saved and you can resume later.</p><div><button data-session-keep>Keep running</button><button class="btn danger" data-session-close>Close session</button></div></div>`;return;}
    if(e.target.closest('[data-session-keep]')){dialog.querySelector('.nx-session-close').innerHTML='<button class="danger" data-session-confirm>Close session…</button>';return;}
    const close=e.target.closest('[data-session-close]');if(close&&liveTerm){if(!await save())return;close.disabled=true;const closed=await nxCloseTerminal(liveTerm);if(closed){chatFor(key).ended=true;nxCloseSessionSettings(false);state.tab='chat';render();await loadChat(key,true);}else{close.disabled=false;status.textContent='Could not close. Try again.';}}
  };
  dialog.querySelector('[data-session-dismiss]').focus();
}

async function nxResumeChat(){const key=state.sel,chat=chatFor();if(chat.resuming)return;chat.resuming=true;renderReadableChat();try{const s=state.byKey.get(key);if(s)await runAction('resume',s);chat.ended=false;await loadChat(key,true);}finally{chat.resuming=false;if(state.sel===key)renderReadableChat();}}
function nxDeliveryHTML(p,agent='Claude'){
  if(p.status==='confirmed')return '<span class="nx-delivery delivered">✓✓ Delivered</span>';
  if(p.status==='queued')return `<span class="nx-delivery queued" role="status">◷ Queued · <span class="nx-agent-name ${agent.toLowerCase()}">${esc(agent)}</span> will read this after its current step</span>`;
  if(p.status==='failed')return `<span class="nx-delivery failed" role="alert">ⓘ Not delivered · ${esc(p.error||'Your text is kept.')} <button data-chat-retry="${esc(p.id)}">${nxIcon('refresh')}Retry</button></span>`;
  return '<span class="nx-delivery sending" role="status"><i class="nx-spinner"></i> Sending…</span>';
}
const nxRound2Composer=renderSteer;
renderSteer=function(s){nxRound2Composer(s);if(!$('#steerIn'))return;let el=$('#nxComposeStatus');if(!el){el=document.createElement('div');el.id='nxComposeStatus';el.setAttribute('role','status');$('#steer').append(el);}const chat=chatFor(),p=chat.pending.at(-1);const starting=chat.resuming||p?.status==='starting';el.innerHTML=starting?'<i class="nx-spinner"></i> Starting the session…':'';/* Delivery status shows once, under the message in the chat. */el.hidden=!el.innerHTML;const send=$('[data-steer=send] span');if(send)send.textContent=chat.sending?'Sending…':'Send';};
document.addEventListener('click',e=>{if(e.target.closest('[data-chat-resume]'))nxResumeChat();});
document.addEventListener('keydown',e=>{
  const dialog=$('#nxSessionSettings')||$('#nxRaw');if(!dialog||$('#modal.on'))return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(!$('#nxSessionSettings')&&typeof slashUI!=='undefined'&&slashUI.handoff?.key===state.sel&&chatFor().terminal?.menu){const t=selTerm(),view=t&&termViews.get(t.id);if(view)termSend(view,'\x1b');return;}$('#nxSessionSettings')?nxCloseSessionSettings():nxCloseRaw();return;}
  if(e.key==='Tab'){const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea')].filter(el=>el.getClientRects().length),i=items.indexOf(document.activeElement),n=i+(e.shiftKey?-1:1);if(n<0||n>=items.length){e.preventDefault();items[(n+items.length)%items.length]?.focus();}}
},true);

nxPairContent=function(){
  if(state.remote)return `<div class="glass nx-pair-success"><span class="nx-pair-check">✓</span><div><b>This device is paired</b><p>Your sessions are available on this device. Manage access from the PC.</p></div></div>`;
  const p=nx.pair;if(!p)return '<div class="glass nx-pair-empty"><p>Generate a one-time code to connect your phone.</p><button class="btn primary" data-nx-setting="pair">Generate pairing code</button></div>';
  if(p.state==='paired')return `<div class="glass nx-pair-success" role="status"><span class="nx-pair-check">✓</span><div><b>Phone paired</b><p><strong>${esc(p.device.name)}</strong> can now see and control your sessions through your private connection. You can revoke it below.</p></div><button class="btn" data-nx-setting="pair">Pair another</button></div>`;
  const expired=p.state==='expired'||p.expiresAt<=Date.now(),url=state.remoteUrl?state.remoteUrl+'/pair.html#code='+encodeURIComponent(p.code):'';
  return `<div class="glass nx-pair-card ${expired?'expired':''}">${url?`<div class="nx-qr">${NexusQR.svg(url)}${expired?'<button class="btn primary" data-nx-setting="pair">↻ New code</button>':''}</div>`:''}<div><b class="nx-pair-state">${expired?'⚠ Code expired. Get a new code to connect.':'<i class="nx-dot busy"></i> Waiting for your phone…'}</b><p>Scan with your iPhone camera, or open NEXUS on the phone and type the code.</p><div class="nx-pair-digits" aria-label="Pairing code ${esc(p.code)}">${p.code.split('').map(c=>c==='-'?'<span class="nx-pair-gap"></span>':`<b>${esc(c)}</b>`).join('')}</div><div class="nx-pair-actions"><span data-nx-pair-expiry="${p.expiresAt}">${expired?'Expired':''}</span><button class="text-action" data-nx-setting="pair">↻ New code</button>${expired?'':'<button class="text-action" data-nx-setting="copy-code">Copy</button>'}</div>${!url?'<p>Remote access is not configured on this PC.</p>':''}</div>${expired?'':'<span class="nx-pair-progress"><i></i></span>'}</div><p class="nx-coverage">Codes last 10 minutes and work once. Use the owner’s Tailscale identity.</p>`;
};
nxCreatePair=async function(){if(state.remote||nx.pairCreating)return;nx.pairCreating=true;try{nx.pair={...await postNexus('/api/pair/new'),state:'waiting'};if($('#nxPairContent'))updateHTML($('#nxPairContent'),nxPairContent());nxPairExpiry();}catch(error){toast('Could not create a code',error.message,'bad');}finally{nx.pairCreating=false;}};
nxPairExpiry=function(){const p=nx.pair;if(!p||p.state==='paired')return;const left=Math.max(0,p.expiresAt-Date.now());if(!left&&p.state!=='expired'){p.state='expired';if($('#nxPairContent'))updateHTML($('#nxPairContent'),nxPairContent());}$$('[data-nx-pair-expiry]').forEach(el=>el.textContent=left?`Expires in ${Math.floor(left/60000)}:${String(Math.floor(left/1000)%60).padStart(2,'0')}`:'Expired');const bar=$('.nx-pair-progress i');if(bar)bar.style.width=(left/600000*100)+'%';};
async function nxPollPair(){const p=nx.pair;if(state.view!=='settings'||state.remote||!p?.pairingId||p.state==='paired'||nx.pairPolling)return;nx.pairPolling=true;try{const result=await api('/api/pair/status?id='+encodeURIComponent(p.pairingId));if(nx.pair!==p)return;if(result.state!==p.state){Object.assign(p,result);if($('#nxPairContent'))updateHTML($('#nxPairContent'),nxPairContent());if(result.state==='paired')await nxLoadDevices();}}catch{}finally{nx.pairPolling=false;}}
setInterval(()=>{nxPairExpiry();nxPollPair();},1000);

function nxVoiceRows(){
  const checks=NexusVoice.checks,rows=[['mic','voice','Microphone'],['stt','sessions','Speech to text'],['playback','spend','Recording playback'],['tts','voice','Read aloud']];
  return rows.map(([id,icon,label])=>{const c=checks[id]||{phase:'idle'},st=c.phase,tag={idle:'Not run',running:'Testing',pass:'Pass',fail:'Fail'}[st];return `<div class="nx-voice-row ${st}">${nxIcon(icon)}<div><strong>${label}${st==='pass'&&c.ms!=null?` <time>${(c.ms/1000).toFixed(1)} s</time>`:''}</strong>${st==='fail'?`<div class="nx-voice-failure"><p>${esc(c.detail)}</p><p><b>Fix: </b>${esc(c.fix)}</p></div>`:`<small>${esc(st==='idle'?'Not run':c.detail)}</small>`}</div><span class="nx-test-label ${st}">${st==='running'?'<i class="nx-spinner"></i>':st==='pass'?'✓ ':st==='fail'?'× ':'− '}${tag}</span></div>`;}).join('');
}
function nxPaintVoice(){
  const rows=$('#nxVoiceRows');if(!rows)return;updateHTML(rows,nxVoiceRows());
  const checks=Object.values(NexusVoice.checks),running=checks.some(c=>c.phase==='running'),ran=checks.some(c=>['pass','fail'].includes(c.phase)),passes=checks.filter(c=>c.phase==='pass').length;
  const label=$('#nxVoiceFootnote');if(label)label.textContent=running?'Testing… keep NEXUS open.':ran?`${passes} of 4 checks passed. Confirm playback was audible.`:'Speak when asked. Runs locally; no agent message.';
  const button=$('[data-nx-setting=voice]');if(button){button.disabled=running;button.textContent=ran?'Run again':'Run voice check';}
}
document.addEventListener('nexus:voice-check',nxPaintVoice);
