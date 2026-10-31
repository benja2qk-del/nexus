'use strict';
const recapUI = { results: new Map(), running: new Map() };
async function recapDialog(s) {
  const key = keyOf(s), inPanel = innerWidth > 700;
  if(recapUI.results.has(key))recapUI.results.set(key,{...recapUI.results.get(key),cached:true});
  nx.panelMode = 'catchup'; nx.recapKey = key;
  let host;
  if (inPanel) {
    nx.panel = true; $('#nxDetails').hidden = false; $('#focus').classList.add('nx-panel-open');
    $('#nxDetails')._html = null;
    $('#nxDetails').innerHTML = `<div class="nx-panel-head"><b>${nxIcon('catchup')}Catch up</b><button data-nx-panel="details">${nxIcon('panel')}Details</button><button data-nx="details" aria-label="Close panel">${nxIcon('close')}</button></div><div class="nx-panel-body nx-recap-body" id="recapContent" aria-live="polite"></div>`;
    host = $('#recapContent');
  } else {
    $('#nxPhoneRecap')?.remove();
    host = document.createElement('div'); host.id = 'nxPhoneRecap'; host.className = 'nx-recap-body'; host.setAttribute('aria-label','Catch me up');
    $('#focusHead').after(host); nx.phoneRecapKey = key;
    $('#sessionRecap')?.setAttribute('aria-expanded','true');
  }
  const active = () => host.isConnected && state.sel === key && state.view === 'focus' && (inPanel ? nx.panel && nx.panelMode === 'catchup' && nx.recapKey === key : nx.phoneRecapKey === key);
  let data = null, summaryError = '', reading = false, replyOpen = true;
  host.innerHTML = '<p class="nx-recap-loading" role="status">Reading the latest activity…</p>';
  const paint = () => {
    if (!active() || !data) return;
    const result = recapUI.results.get(key), current = result && result.size === data.size && result.mtime === data.mtime, busy = recapUI.running.has(key);
    const count = data.counts, tone = data.status.label === 'Working' ? 'working' : data.status.label === 'Needs you' ? 'needs' : 'done';
    let summary;
    if (busy) summary = `<div class="nx-summary-loading" role="status"><p><i class="nx-spinner"></i> Reading the recorded activity…</p><i></i><i></i><i></i></div>`;
    else if (summaryError) summary = `<div class="nx-summary-error" role="alert"><p>${esc(summaryError)}</p><button class="btn" data-recap-summary>${nxIcon('refresh')}Retry</button></div><p class="recap-cost">A failed request may still incur usage. Check your agent account for billing.</p>`;
    else if (current) summary = `<ul class="nx-summary-bullets">${result.bullets.slice(0,6).map(b=>`<li>${esc(b)}</li>`).join('')}</ul><p class="recap-next"><b>Next / needs you: </b>${esc(result.next.replace(/^(?:Next\s*\/\s*)?needs you\s*:?\s*/i,''))}</p><p class="recap-cost">${result.costUSD != null ? 'Cost $'+result.costUSD.toFixed(4)+' · ' : ''}cached until the conversation changes</p>`;
    else if(data.summarizer&&!data.summarizer.kind)summary=`<p class="recap-cost">${esc(data.summarizer.note)}</p>`;
    else summary = `${result?'<p class="recap-coverage">The conversation changed. Summarize again for the latest activity.</p>':''}<button class="btn nx-summarize" data-recap-summary>${nxIcon('catchup')}Summarize</button><p class="recap-cost">${esc(data.summarizer?.note||'One Haiku request using your Claude account.')} · cached until the conversation changes${data.digestTrimmed?' · shortened activity digest':''}</p>`;
    const scroll = host.scrollTop;
    host.innerHTML = `<section class="nx-recap-request"><h3>Since your last message <time>${data.user?.at ? ago(Date.parse(data.user.at))+' ago' : ''}</time></h3>${data.user?`<blockquote>${esc(data.user.text)}</blockquote>`:`<p>You haven't written in this ${data.partial?'excerpt':'session'} yet.</p>`}${data.partial?'<p class="recap-coverage">Only the latest part is available. Counts and summary cover this excerpt.</p>':''}</section>
      <section class="nx-recap-status ${tone}"><b><i class="${tone==='working'?'nx-spinner':'nx-dot '+tone}"></i>${esc(data.status.label)}</b><p>${esc(data.status.detail)}</p></section>
      <section aria-label="Activity counts"><div class="nx-recap-counts">${[['Files',count.files],['Commands',count.commands],['Sites',count.sites],['Astra',count.astra]].map(([label,n])=>`<div><b>${n}</b><span class="${label==='Astra'?'nx-agent-name astra':''}">${label}</span></div>`).join('')}</div><div class="nx-recap-chips">${count.errors?`<span class="nx-error-chip">! ${count.errors} ${count.errors===1?'error':'errors'}</span>`:''}${data.files.slice(0,4).map(f=>`<span class="nx-file-chip">${nxIcon('file')}${esc(f)}</span>`).join('')}${data.files.length>4?`<small>+${data.files.length-4} more</small>`:''}${!data.files.length&&!count.errors?'<small>No files edited since then.</small>':''}</div>${count.pendingEdits?`<p class="recap-cost">${count.pendingEdits} edit requests have no recorded result.</p>`:''}</section>
      ${data.finalAssistant?`<section><h3>${nxAgent(s)} Latest reply</h3><div class="nx-recap-reply ${replyOpen?'expanded':''}"><div class="md">${replyOpen?md(data.finalAssistant):esc(NexusDesign.plainSummary(data.finalAssistant))}</div></div><button class="text-action nx-reply-toggle" data-recap-reply aria-expanded="${replyOpen}">${replyOpen?'⌃ Show less':'⌄ Show full reply'}</button>${data.finalShortened?'<p class="recap-cost">Reply shortened; full text is in the conversation.</p>':''}</section>`:''}
      <section class="nx-recap-summary"><h3>Summary ${current?`<span>${result.cached?'From cache':esc(NexusDesign.modelLabel(result.model)||'Summary')}</span>`:''}</h3>${summary}</section>
      <footer class="nx-recap-footer"><span>Read ${clockTime(data.capturedAt)}</span><span>·</span><button data-recap-refresh ${reading?'disabled':''}>${reading?'Refreshing…':'Refresh'}</button><span>·</span><button data-recap-feed>Open full conversation</button></footer>`;
    host.scrollTop = scroll;
  };
  const watch = async task => {
    try { const result = await task; recapUI.results.set(key,result); if(recapUI.results.size>200)recapUI.results.delete(recapUI.results.keys().next().value); }
    catch(error) { summaryError = NexusActivity.readable(error.message); }
    finally { if(recapUI.running.get(key)===task)recapUI.running.delete(key); paint(); }
  };
  const read = async () => {
    reading = true; paint();
    try { data = await api('/api/recap?key='+encodeURIComponent(key)); }
    catch(error) { if(active())host.innerHTML=`<section role="alert"><p>Could not read this recap. ${esc(NexusActivity.readable(error.message))}</p><button class="btn" data-recap-refresh>Retry</button></section>`; reading=false; return; }
    reading = false; paint();
  };
  host.onclick = async e => {
    if(e.target.closest('[data-recap-reply]')) { replyOpen=!replyOpen; paint(); return; }
    if(e.target.closest('[data-recap-feed]')) { if(!inPanel)nxClosePhoneRecap();else {nx.panel=false;nx.panelMode='details';renderHead();}$('#chatView').scrollTop=$('#chatView').scrollHeight;return; }
    if(e.target.closest('[data-recap-refresh]')&&!reading) { await read(); return; }
    if(e.target.closest('[data-recap-summary]')&&data&&!recapUI.running.has(key)) {
      summaryError='';const task=postNexus('/api/action',{action:'summarize-recap',key}).then(r=>r.result);
      recapUI.running.set(key,task);paint();await watch(task);
    }
  };
  await read();if(recapUI.running.has(key))watch(recapUI.running.get(key));
}
function nxClosePhoneRecap(){nx.phoneRecapKey=null;$('#nxPhoneRecap')?.remove();$('#sessionRecap')?.setAttribute('aria-expanded','false');}
