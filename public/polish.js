'use strict';
// Device navigation, connection recovery and PC pairing controls.
const deviceUI = { saved: null, restored: false, offline: false, refreshing: null };
async function nexusRequest(path, options = {}, timeout = 10000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  const cancel=()=>controller.abort();if(options.signal?.aborted)cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
  try {
    const response = await fetch(path, { cache: 'no-store', ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error || response.statusText); error.status = response.status; throw error; }
    return body;
  } catch (e) { if (e.name === 'AbortError'&&!options.signal?.aborted) throw new Error(options.method === 'POST' ? 'The request timed out. Check the current state before retrying.' : 'The connection timed out. Retrying automatically.'); throw e; }
  finally { clearTimeout(timer);options.signal?.removeEventListener('abort',cancel); }
}
const postNexus = (path, body = {}, signal) => nexusRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexus': '1' }, body: JSON.stringify(body),signal }, ['check-focus', 'summarize-recap','summarize-theme','summarize-recent'].includes(body.action) ? 65000 : body.action === 'term-model' ? 45000 : body.action === 'term-send' ? 35000 : 10000);
function savePlace() {
  if (!deviceUI.restored) return;
  pref.set('place', JSON.stringify({ view: state.view, key: state.sel, tab: state.tab, group: state.group, project: projectUI.key }));
  // The redesigned navigation knows every phone tab (Wall included); this older marking only knew two.
  if (typeof nxNavigation === 'function') return nxNavigation();
  $$('#mobileDock [data-nav]').forEach(b => b.setAttribute('aria-current', (b.dataset.nav === 'home' && ['overview', 'project'].includes(state.view)) || (b.dataset.nav === 'sessions' && state.view === 'focus') ? 'page' : 'false'));
}
function restorePlace() {
  if (deviceUI.restored || !state.booted || !state.lastUpdate) return;
  deviceUI.restored = true;
  const saved = deviceUI.saved;
  if (!saved) { savePlace(); return; }
  if (state.sessions.some(s => s.group === saved.group)) state.group = saved.group;
  if (state.sessions.some(s => s.group === saved.project)) projectUI.key = saved.project;
  const valid = state.byKey.has(saved.key) || state.terms.some(t => 'term:' + t.id === saved.key);
  if (valid) state.sel = saved.key;
  if (saved.view === 'focus' && valid) select(saved.key, { tab: ['feed','thinking','chat','term'].includes(saved.tab) ? saved.tab : 'feed' });
  else if (saved.view === 'project' && projectUI.key) setView('project');
  else if (saved.view === 'wall') setView('wall');
  else setView('overview');
}
function connectionLost(error) {
  deviceUI.offline = true;
  const needsPair = error?.status === 401;
  $('#connection').classList.remove('hidden');
  $('#connection').innerHTML = `<span><b>${needsPair ? 'Pair this device again' : 'Reconnecting…'}</b><small>${needsPair ? 'This device’s pairing has expired or was revoked.' : state.lastUpdate ? 'Showing your last update from ' + clockTime(state.lastUpdate) + '. Your draft is kept.' : 'Waiting for NEXUS. We’ll reconnect automatically.'}</small></span>${needsPair ? '<a class="btn" href="/pair.html">Pair device</a>' : '<button class="chip-btn" id="retryConnection">Retry now</button>'}`;
  if ($('#retryConnection')) $('#retryConnection').onclick = refresh;
  document.body.classList.add('connection-offline');
}
function connectionRestored() {
  const recovered = deviceUI.offline;
  deviceUI.offline = false; document.body.classList.remove('connection-offline');
  $('#connection').classList.add('hidden');
  if (recovered) { toast('Connected again', 'Your sessions are up to date.'); reconnectTerminals(); }
}
function reconnectTerminals() {
  for (const v of termViews.values()) if (!v.closed && !v.ended && state.terms.some(t => t.id === v.id && !t.exited) && (!v.ws || v.ws.readyState > 1)) connect(v);
}
async function refreshNow() {
  const b = $('#refreshBtn'); b.classList.add('refreshing');
  await refresh(); if (state.view === 'focus') await loadFeed(true);
  b.classList.remove('refreshing');
}
function initializePolish() {
  try { deviceUI.saved = JSON.parse(pref.get('place', 'null')); } catch { }
  state.remote = !['127.0.0.1','localhost'].includes(location.hostname);
  document.body.classList.toggle('remote-device', state.remote);
  $('#devicesBtn').onclick = pairPhone;
  $('#refreshBtn').onclick = refreshNow;
  const icons = {home:'M3 11 12 3l9 8v10h-6v-7H9v7H3Z',sessions:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',new:'M12 4v16M4 12h16',spend:'M4 20V10m8 10V4m8 16V8',more:'M4 6h16M4 12h16M4 18h16'};
  const dock = document.createElement('nav'); dock.id = 'mobileDock'; dock.setAttribute('aria-label','App navigation');
  dock.innerHTML = Object.entries({home:'Home',sessions:'Sessions',new:'New',spend:'Spend',more:'More'}).map(([key,label]) => `<button data-nav="${key}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[key]}"/></svg><span>${label}</span></button>`).join('');
  $('#app').appendChild(dock);
  dock.onclick = e => { const key=e.target.closest('[data-nav]')?.dataset.nav; ({home:()=>setView('overview'),sessions:()=>finder(),new:newSessionModal,spend:spendOverview,more:appMenu})[key]?.(); };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { refreshNow(); reconnectTerminals(); }
    else rememberViewed(state.byKey.get(state.sel), true);
  });
  addEventListener('online', () => { refreshNow(); reconnectTerminals(); });
  addEventListener('offline', () => connectionLost());
  addEventListener('pageshow', e => { if(e.persisted) {refreshNow(); reconnectTerminals();} });
  initializePhoneViewport();
  setInterval(() => {
    const el=$('#pairExpiry'); if(!el)return;
    const seconds=Math.max(0,Math.ceil((Number(el.dataset.expires)-Date.now())/1000));
    el.textContent=seconds ? `Expires in ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · one use` : 'Expired. Generate a fresh code below.';
    if(!seconds) $('#pairCode')?.classList.add('expired');
  },1000);
}
function appMenu() {
  modal(`<div class="sheet-kicker">MAKE IT YOURS</div><h2>Your NEXUS.</h2><p>Connected to your PC. Pick up wherever you left off.</p><label class="picker-label" for="menuTheme">Color theme</label><select class="picker-search" id="menuTheme"><option value="apsis">Apsis · ice</option><option value="parallax">Parallax · green</option><option value="stratum">Stratum · violet</option></select><div class="menu-grid"><button class="btn" data-menu="voice">Voice check</button><button class="btn" data-menu="refresh">Refresh sessions</button><button class="btn" data-menu="wall">Session wall</button><button class="btn" data-menu="help">App tips</button>${state.remote ? '' : '<button class="btn" data-menu="pair">Pair a phone</button><button class="btn" data-menu="devices">Paired devices</button>'}</div><p class="geo-line" >${screenGeometry()}</p><div class="modal-actions"><button class="btn primary" data-menu="close">Done</button></div>`);
  $('#menuTheme').value=apsis.theme; $('#menuTheme').onchange=e=>setTheme(e.target.value);
  $('#modalCard').onclick=e=>{const key=e.target.closest('[data-menu]')?.dataset.menu;if(!key)return;
    if(key==='voice'){closeModal();NexusVoice.check();return;}
    closeModal();({refresh:refreshNow,wall:()=>setView('wall'),help:()=>$('#overviewHelp').click(),pair:pairPhone,devices:pairedDevices})[key]?.();
  };
}
async function pairPhone() {
  if(state.remote)return;
  modal('<div class="sheet-kicker">TAKE YOUR WORK WITH YOU</div><h2>Pair a phone.</h2><p>Open NEXUS on your phone, then enter this one-time code.</p><div id="pairDetails" role="status"><p>Creating a secure code…</p></div><div class="modal-actions"><button class="btn" data-pair="devices">Paired devices</button><button class="btn" data-pair="close">Close</button></div>');
  const version=modalVersion;
  $('#modalCard').onclick=e=>{ const action=e.target.closest('[data-pair]')?.dataset.pair;
    if(action==='close')closeModal(); if(action==='devices')pairedDevices(); if(action==='new')pairPhone();
    if(action==='copy')copyText($('#pairCode').textContent,'Pairing code copied');
    if(action==='url')copyText(state.remoteUrl,'Phone address copied');
  };
  try {
    const data=await postNexus('/api/pair/new');
    if(modalVersion!==version || !$('#modal').classList.contains('on'))return;
    $('#pairDetails').innerHTML=`<div class="pair-code" id="pairCode">${esc(data.code)}</div><p id="pairExpiry" data-expires="${data.expiresAt}">Expires in 10:00 · one use</p><div class="pair-actions"><button class="btn primary" data-pair="copy">Copy code</button><button class="btn" data-pair="new">Fresh code</button></div>${state.remoteUrl ? `<p class="pair-address">${esc(state.remoteUrl)}</p><button class="text-action" data-pair="url">Copy phone address</button>` : '<p>Remote access is not configured on this PC.</p>'}<p class="muted">For a home-screen app, add NEXUS first and enter this code from the new icon. Only your tailnet identity can pair.</p>`;
  } catch(e) {if(version===modalVersion && $('#pairDetails'))$('#pairDetails').innerHTML=`<p class="insight-error">${esc(e.message)}</p><button class="btn" data-pair="new">Try again</button>`;}
}
async function pairedDevices() {
  if(state.remote)return;
  modal('<div class="sheet-kicker">YOUR PRIVATE CONNECTIONS</div><h2>Paired devices.</h2><p>Revoking a device disconnects it immediately. It will need a new code to return.</p><div id="deviceList" role="status">Loading devices…</div><div class="modal-actions"><button class="btn" data-device-close>Close</button><button class="btn primary" data-device-pair>Pair a phone</button></div>');
  const version=modalVersion;
  $('#modalCard').onclick=async e=>{
    if(e.target.closest('[data-device-close]'))return closeModal();
    if(e.target.closest('[data-device-pair]'))return pairPhone();
    const b=e.target.closest('[data-revoke]');if(!b)return;
    if(b.dataset.confirm!=='yes'){b.dataset.confirm='yes';b.textContent='Confirm revoke';return;}
    b.disabled=true;
    try{await postNexus('/api/devices/revoke',{id:b.dataset.revoke});if(version===modalVersion)pairedDevices();}
    catch(error){b.disabled=false;toast('Could not revoke device',error.message,'bad');}
  };
  try{
    const data=await api('/api/devices'); if(version!==modalVersion || !$('#deviceList'))return;
    $('#deviceList').innerHTML=data.devices.length ? data.devices.map(d=>`<article class="device-row"><div><strong>${esc(d.name)}</strong><small>Last connected ${ago(d.lastSeen)} · paired ${new Date(d.created).toLocaleDateString()}</small></div><button class="btn danger" data-revoke="${esc(d.id)}">Revoke</button></article>`).join('') : '<div class="device-empty">No paired devices yet.<small>Pair your phone to carry NEXUS with you.</small></div>';
  }catch(e){if(version===modalVersion && $('#deviceList'))$('#deviceList').textContent='Could not load devices. '+e.message;}
}
async function copyText(text, title = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(title); }
  catch { toast('Copy unavailable', 'Select and copy the text manually.', 'bad'); }
}

// Screen numbers for diagnosing iPhone layout gaps (the owner screenshots this line).
function screenGeometry() {
  const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden'; document.body.append(probe);
  const safe = probe.offsetHeight; probe.remove();
  const dock = document.getElementById('mobileDock')?.getBoundingClientRect();
  return ['scr ' + screen.width + 'x' + screen.height, 'win ' + innerWidth + 'x' + innerHeight, 'doc ' + document.documentElement.clientHeight, 'vv ' + Math.round(visualViewport?.height || 0) + '+' + Math.round(visualViewport?.offsetTop || 0), 'safe ' + safe, 'dock ' + (dock ? Math.round(dock.top) + '-' + Math.round(dock.bottom) : '-'), 'sa ' + navigator.standalone, 'gap ' + Math.max(0, screen.height - innerHeight)].join(' · ');
}
