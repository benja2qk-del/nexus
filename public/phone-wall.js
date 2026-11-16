'use strict';
// Phone Wall: every theme with something in play, stacked, using the PC Wall's tiles and their motion. Themes that
// need you come first, then working ones, then the most recent; quiet themes fold into one list at the end.
function nxPhoneWallRank(t){const s=t.sessions.filter(nxBoardActive);return s.some(x=>statusLabel(x)[0]==='ready')?0:s.some(x=>statusLabel(x)[0]==='busy')?1:2;}
// Themes the owner folded on the phone Wall stay folded (this phone only).
function nxPwallFolded(){try{return new Set(JSON.parse(pref.get('pwall-folded','[]')));}catch{return new Set();}}
function nxPhoneWall(){
  const folded=nxPwallFolded();
  const groups=nxThemeGroups(state.sessions,true).filter(t=>!t.archived);
  const shown=groups.filter(t=>t.sessions.some(nxBoardActive)).sort((a,b)=>nxPhoneWallRank(a)-nxPhoneWallRank(b)||b.updated-a.updated),quiet=groups.filter(t=>!shown.includes(t));
  const inPlay=state.sessions.filter(nxBoardActive).length;
  const sections=shown.map(t=>{const active=t.sessions.filter(nxBoardActive).sort((a,b)=>nxRank(a)-nxRank(b)||b.updated-a.updated);
    const open=!folded.has(t.id);
    return `<section class="nx-pwall-theme ${open?'':'folded'}" aria-label="${esc(t.name)}"><header><button data-pwall-fold="${esc(t.id)}" aria-expanded="${open}" aria-label="${open?'Collapse':'Expand'} ${esc(t.name)}"><span class="nx-pwall-chevron" aria-hidden="true">›</span>${nxThemeTick(t)}<b>${esc(t.name)}</b></button>${nxThemeCounts(t)}<small>${active.length} of ${t.sessions.length}</small></header>${open?`<div class="nx-pwall-list">${active.map(nxBoardTile).join('')}</div>`:''}</section>`;}).join('');
  const rest=quiet.length?`<details class="nx-pwall-quiet" data-disclosure="pwall-quiet"><summary><span class="nx-pwall-chevron" aria-hidden="true">›</span>Quiet themes <small>${quiet.length}</small></summary>${quiet.map(t=>`<button data-pwall-theme="${esc(t.id)}">${nxThemeTick(t)}<span>${esc(t.name)}</span><small>${t.sessions.length?`${t.sessions.length} ${t.sessions.length===1?'session':'sessions'}`:'Empty'}${t.updated?' · '+ago(t.updated):''}</small></button>`).join('')}</details>`:'';
  updateHTML($('#wall'),`<header class="nx-page-head"><h1>Wall</h1><span>${inPlay} in play · ${shown.length} ${shown.length===1?'theme':'themes'}</span></header><div class="nx-pwall">${sections||'<p class="nx-pwall-empty">Nothing in play right now.</p>'}${rest}</div>`);
}
// A theme name in play folds or unfolds its sessions in place; a quiet theme (nothing to fold) opens on Sessions.
document.addEventListener('click',e=>{const f=e.target.closest('[data-pwall-fold]');if(!f)return;const id=f.dataset.pwallFold,folded=nxPwallFolded();folded.has(id)?folded.delete(id):folded.add(id);pref.set('pwall-folded',JSON.stringify([...folded]));nxPhoneWall();});
document.addEventListener('click',e=>{const t=e.target.closest('[data-pwall-theme]');if(!t)return;nxThemes.selected=nxThemes.phoneAt=t.dataset.pwallTheme;setView('sessions');renderCards();});
