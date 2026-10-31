'use strict';
// File paths in answers become links. A click opens the file on the PC (documents and media in their usual app;
// scripts and programs are only shown in their folder); right-click offers Open folder, Copy path and, for an HTML file
// inside the session folder, a preview right in the chat. On a phone a link previews HTML or copies the path.
const NX_PATH_IN_TEXT=/(^|[\s(\[>"'])((?:[A-Za-z]:[\\/]|\/[a-z]\/)[^\s<>"'|*?`]+)/g;
// An absolute Windows path from what an answer shows; a bare file name inside code or bold means the session folder.
function nxPathFrom(text,cwd){
  if(/[\r\n]/.test(text)||String(text).length>400)return '';
  let t=String(text).replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim().replace(/[.,;:)\]]+$/,'');
  if(/^\/[a-z]\//i.test(t))t=t[1].toUpperCase()+':\\'+t.slice(3);
  if(/^[A-Za-z]:[\\/]/.test(t))return t.replace(/\//g,'\\');
  if(cwd&&/^[\w.-]+(?:[\\/][\w.-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(t))return cwd.replace(/[\\/]+$/,'')+'\\'+t.replace(/\//g,'\\');
  return '';
}
function nxPreviewable(abs,s){const base=String(s?.cwd||'').replace(/[\\/]+$/,'');return !!base&&/\.html?$/i.test(abs)&&abs.toLowerCase().startsWith(base.toLowerCase()+'\\');}
function nxLinkPaths(html,s){
  const cwd=s?.cwd||'';
  const link=(abs,inner)=>`<a class="nx-path" href="#" data-path="${esc(abs)}" title="${esc(abs)}">${inner}</a>`+(nxPreviewable(abs,s)?`<button class="nx-path-preview" data-preview="${esc(abs)}">Preview</button>`:'');
  // A whole code or bold span that is a path may contain spaces.
  html=html.replace(/<(code|strong)>([^<]+)<\/\1>/g,(m,tag,inner)=>{const abs=nxPathFrom(inner,cwd);return abs?link(abs,m):m;});
  // In running text a path ends at the first space; links, code and code blocks are left alone.
  let depth=0;
  return html.split(/(<[^>]+>)/).map(part=>{
    if(part.startsWith('<')){if(/^<(a|pre|code)\b/i.test(part))depth++;else if(/^<\/(a|pre|code)>/i.test(part))depth=Math.max(0,depth-1);return part;}
    if(depth)return part;
    return part.replace(NX_PATH_IN_TEXT,(m,pre,p)=>{const abs=nxPathFrom(p,'');if(!abs)return m;const shown=p.replace(/[.,;:)\]]+$/,'');return pre+link(abs,shown)+p.slice(shown.length);});
  }).join('');
}
const nxPathsBlockHTML=blockHTML;
blockHTML=function(b,s){const html=nxPathsBlockHTML.apply(this,arguments);return b?.t==='ai'?nxLinkPaths(html,s):html;};

async function nxOpenPath(p,mode){
  const result=await act('open-path',{path:p,mode,key:state.sel});
  if(result==='revealed'&&mode!=='folder')toast('Shown in its folder','Documents and media open directly; other files are shown in Explorer instead of being run.');
}
function nxPathMenu(p,x,y){
  $('#nxPathMenu')?.remove();
  const items=[...(state.remote?[]:[['open','Open'],['folder','Open folder']]),...(nxPreviewable(p,state.byKey.get(state.sel))?[['preview','Preview here']]:[]),['copy','Copy path']];
  const menu=document.createElement('div');menu.id='nxPathMenu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',p);
  menu.innerHTML=items.map(([id,label])=>`<button role="menuitem" data-path-menu="${id}">${label}</button>`).join('');
  document.body.append(menu);const r=menu.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';
  menu.onclick=e=>{const id=e.target.closest('[data-path-menu]')?.dataset.pathMenu;if(!id)return;menu.remove();if(id==='open'||id==='folder')nxOpenPath(p,id);else if(id==='preview')nxPreviewOpen(state.sel,p);else copyText(p,'Path copied');};
  menu.querySelector('button')?.focus();
}

// One preview per conversation, under its messages. It lives outside the re-rendered message list, so a running
// session's updates do not reload it.
const nxPreviews=new Map();
function nxPreviewURL(key,abs){const base=String(state.byKey.get(key)?.cwd||'').replace(/[\\/]+$/,'');return '/preview/'+encodeURIComponent(key)+'/'+abs.slice(base.length+1).split(/[\\/]/).map(encodeURIComponent).join('/');}
function nxPreviewOpen(key,abs){if(!nxPreviewable(abs,state.byKey.get(key)))return;nxPreviews.set(key,abs);nxPaintPreview(true);}
function nxPaintPreview(scroll){
  const key=state.sel,abs=nxPreviews.get(key),messages=$('#chatMessages');let box=$('#chatPreview');
  if(!abs||!messages||!state.byKey.has(key)){box?.remove();return;}
  if(!box||box.previousElementSibling!==messages){box?.remove();box=document.createElement('section');box.id='chatPreview';box.className='nx-preview-card';box.setAttribute('aria-label','Preview');messages.after(box);}
  const src=nxPreviewURL(key,abs),name=abs.split(/[\\/]/).pop();
  if(box.dataset.src!==src){box.dataset.src=src;box.innerHTML=`<header><b title="${esc(abs)}">${esc(name)}</b><button data-preview-reload>Reload</button>${state.remote?'':'<button data-preview-open>Open</button>'}<button data-preview-close aria-label="Close preview">${nxIcon('close')}</button></header><iframe src="${esc(src)}" sandbox="allow-scripts allow-forms allow-modals allow-popups" title="Preview of ${esc(name)}"></iframe>`;}
  if(scroll)box.scrollIntoView({block:'nearest',behavior:'smooth'});
}
const nxPathsRender=renderReadableChat;
renderReadableChat=function(){nxPathsRender.apply(this,arguments);nxPaintPreview(false);};

document.addEventListener('click',e=>{
  const preview=e.target.closest('[data-preview]');if(preview){e.preventDefault();nxPreviewOpen(state.sel,preview.dataset.preview);return;}
  const box=e.target.closest('#chatPreview');
  if(box&&e.target.closest('[data-preview-close]')){nxPreviews.delete(state.sel);box.remove();return;}
  if(box&&e.target.closest('[data-preview-reload]')){const frame=box.querySelector('iframe');frame.src=box.dataset.src;return;}
  if(box&&e.target.closest('[data-preview-open]')){nxOpenPath(nxPreviews.get(state.sel),'open');return;}
  const a=e.target.closest('a.nx-path');if(!a)return;e.preventDefault();
  if(!state.remote)return nxOpenPath(a.dataset.path,'open');
  if(nxPreviewable(a.dataset.path,state.byKey.get(state.sel)))nxPreviewOpen(state.sel,a.dataset.path);else copyText(a.dataset.path,'Path copied');
});
document.addEventListener('contextmenu',e=>{const a=e.target.closest('a.nx-path');if(!a)return;e.preventDefault();nxPathMenu(a.dataset.path,e.clientX,e.clientY);});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#nxPathMenu'))$('#nxPathMenu')?.remove();},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#nxPathMenu')?.remove();});
