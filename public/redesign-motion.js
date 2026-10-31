'use strict';
// v0 timings, applied once when a view, item or surface actually enters.
// Session polling must not restart a list's entrance animation.
const NexusMotion = (() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const seen = new Set();
  const running = new Set();
  function enter(el, duration = 240, delay = 0, transform = 'translateY(6px)', easing = ease) {
    if (!el || reduced.matches || !el.getClientRects().length) return;
    const animation = el.animate([{ opacity: 0, transform }, { opacity: 1, transform: 'none' }], { duration, delay, easing, fill: 'backwards' });
    running.add(animation);
    animation.finished.catch(() => {}).finally(() => running.delete(animation));
  }
  // A detached, inert visual copy lets focus and app state close immediately.
  function exit(el, duration = 100, transform = 'scale(.95)') {
    if (!el || reduced.matches || !el.getClientRects().length) return;
    const rect = el.getBoundingClientRect(), copy = el.cloneNode(true);
    const originals = [el, ...el.querySelectorAll('*')], clones = [copy, ...copy.querySelectorAll('*')];
    for (let i = 0; i < originals.length; i++) {
      const style = getComputedStyle(originals[i]);
      clones[i].style.cssText = Array.from(style, p => p + ':' + style.getPropertyValue(p)).join(';');
      clones[i].removeAttribute('id');
      clones[i].removeAttribute('autofocus');
    }
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    copy.style.cssText += `;position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;margin:0;z-index:2000;pointer-events:none;`;
    document.body.append(copy);
    const animation = copy.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform }], { duration, easing: 'ease', fill: 'forwards' });
    running.add(animation);
    animation.finished.catch(() => {}).finally(() => { copy.remove(); running.delete(animation); });
  }
  function scan() {
    if (!state.booted) return;
    const view = state.view;
    document.querySelectorAll('.nx-home-card,.nx-wall-tile,.nx-phone-row,.nx-spend-stats>div,.nx-theme-tile,.nx-theme-timeline>.nx-session-row,#cards .nx-session-row').forEach((el, i) => {
      const button = el.matches('button') ? el : el.querySelector('[data-open],[data-nx-open]');
      const key = view + ':' + (el.closest('#cards')?'sidebar:':'') + (el.dataset.sessionKey||button?.dataset.open || button?.dataset.nxOpen || el.className + ':' + i);
      if (!seen.has(key) && el.getClientRects().length) {
        seen.add(key);
        enter(el, 240, el.matches('.nx-theme-tile,.nx-session-row')?Math.min([...el.parentElement.children].indexOf(el)*40,280):Math.min(i, view === 'wall' ? 12 : 8) * (view === 'wall' ? 35 : 30));
      }
    });
  }
  reduced.addEventListener('change', () => { if (reduced.matches) for (const animation of running) animation.cancel(); });
  return { enter, exit, scan, reset() { seen.clear(); } };
})();

const nxMotionView = setView;
setView = function(view) {
  const changed = state.view !== view;
  if (changed) NexusMotion.reset();
  nxMotionView(view);
  if (changed) {
    NexusMotion.enter(document.querySelector(view === 'overview' ? '#nxHome' : view === 'wall' ? '#wall' : view === 'focus' ? '#nxConversation' : '#nxPage'), 200, 0, 'translateY(4px)');
  }
  NexusMotion.scan();
};
const nxMotionBoot = boot;
boot = async function() { await nxMotionBoot(); NexusMotion.scan(); };
const nxMotionUpdate = updateHTML;
updateHTML = function(el, html) {
  const changed = el._html !== html;
  nxMotionUpdate(el, html);
  if (changed && ['nxHome', 'wall', 'nxPage','cards'].includes(el.id)) NexusMotion.scan();
};
const nxMotionModal = modal, nxMotionClose = closeModal;
modal = function(html) { nxMotionModal(html);const theme=/data-(?:theme|rename|delete)|data-copilot-field/.test(html),bottom=theme&&html.includes('nxThemePickerList'),phone=innerWidth<=700;$('#modal').classList.toggle('nx-theme-dialog',theme);$('#modalCard').classList.toggle('nx-theme-bottom',bottom);NexusMotion.enter($('#modalCard'),theme?(phone?(bottom?260:220):150):100,0,theme&&phone?(bottom?'translateY(100%)':'translateY(16px)'):'scale(.95)',theme&&phone&&!bottom?'cubic-bezier(.2,.8,.2,1)':theme?'cubic-bezier(.22,1,.36,1)':'ease'); };
closeModal = function() { if ($('#modal.on')){const theme=$('#modal').classList.contains('nx-theme-dialog');NexusMotion.exit($('#modalCard'),theme?(innerWidth<=700?200:150):100,theme&&innerWidth<=700?'translateY(100%)':'scale(.95)');}nxMotionClose(); };
const nxMotionCloseModel = nxCloseModel;
nxCloseModel = function() { NexusMotion.exit($('#nxModelMenu'), 160, 'translateY(-4px) scale(.98)'); nxMotionCloseModel(); };

// Use the reference's native shared-card transition for pointer navigation.
// Programmatic updates and older browsers retain the synchronous entry fallback.
let nxViewTransition;
document.addEventListener('click', event => {
  const target = event.target.closest('[data-nx-view],[data-open],[data-nx-open],#cards [data-k]');
  if (target?.closest('[data-session-key]')) return;
  if (!target || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const view = target.dataset.nxView;
  const key = target.dataset.open || target.dataset.nxOpen || target.dataset.k;
  if (!view && !key) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  nxViewTransition?.skipTransition();
  const source = key && target.closest('.nx-home-card,.nx-wall-tile');
  if (source && state.view !== 'focus') source.style.viewTransitionName = 'nx-hero';
  nxViewTransition = document.startViewTransition(() => {
    if (key) select(key); else setView(view);
    const header = $('#focusHead');
    if (header) header.style.viewTransitionName = state.view === 'focus' ? 'nx-hero' : '';
  });
  nxViewTransition.finished.catch(() => {}).finally(() => { if (source) source.style.viewTransitionName = ''; });
}, true);
