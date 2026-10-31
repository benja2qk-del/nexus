// Pointer navigation, transient surfaces and reduced motion on private fixtures.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const [phase, kind, widthArg, root] = process.argv.slice(2);
const width = Number(widthArg), phone = width === 440, reference = kind === 'reference';
const out = path.resolve(root, 'motion', phase, kind, String(width));
fs.mkdirSync(out, {recursive: true});
const steps = [{viewport: [width, phone ? 956 : 773], dpr: phone ? 3 : 1}, {navigate: '/'}];
const js = source => steps.push({js: source});
const until = source => steps.push({until: 'Boolean(' + source + ')'});
const save = name => steps.push({save: {name: name + '.json', expression: 'parityMeasure()'}});

if (reference) {
  until("document.querySelector('nav[aria-label=\"Projects and sessions\"]') && !document.querySelector('[aria-label=\"NEXUS is starting\"]')");
  if (phone) {
    steps.push({text: 'Phone'});
    js("const frame=document.getElementsByClassName('h-[844px]')[0];frame.style.cssText='position:fixed;inset:0;width:440px;height:956px;border:0;border-radius:0;box-shadow:none';frame.children[0].style.display='none';frame.children[1].style.display='none';frame.lastElementChild.style.display='none';");
  }
  js("[...document.querySelectorAll('button')].find(b=>b.getAttribute('title')?.startsWith('Session dashboard redesign (')||b.getAttribute('aria-label')?.startsWith('Session dashboard redesign.')).click()");
  until("document.querySelector('[aria-label=\"More actions\"]')");
} else {
  until("typeof state !== 'undefined' && state.booted && state.sessions.length === 11");
  if (phase === 'after') {
    js("if(![...document.querySelectorAll('.nx-home-card,.nx-phone-row')].some(el=>el.getAnimations().some(a=>!a.animationName&&!a.transitionProperty)))throw Error('Home entrance finished behind boot');");
    js("setView('wall');if([...document.querySelectorAll('.nx-wall-tile')].some(el=>el.getAnimations().filter(a=>!a.animationName&&!a.transitionProperty).length!==1))throw Error('Wall entrance duplicated');state.sessions[0].title+=' refreshed';renderWall();if([...document.querySelectorAll('.nx-wall-tile')].some(el=>el.getAnimations().some(a=>!a.animationName&&!a.transitionProperty)))throw Error('Polling restarted item entrance');setView('overview');");
  }
  js("document.querySelector('[data-open=\"claude:s-dashboard\"]').click()");
  until("state.view === 'focus' && chatFor().loaded");
  js("if(typeof nxViewTransition!=='undefined')await nxViewTransition?.finished; if(state.sel!=='claude:s-dashboard')throw Error('Pointer selection failed');");
  if (!phone) {
    steps.push({click: '[data-nx-view=wall]'});
    until("state.view === 'wall'");
    js("if(typeof nxViewTransition!=='undefined')await nxViewTransition?.finished; if(document.querySelector('#focusHead').style.viewTransitionName)throw Error('Stale shared hero');");
    steps.push({click: '.nx-wall-tile [data-nx-open]'});
    until("state.view === 'focus'");
    js("if(typeof nxViewTransition!=='undefined')await nxViewTransition?.finished;");
  }
}
js(fs.readFileSync('tools/parity-measure.js', 'utf8'));
js('window.parityRegions = {}');
if (reference) {
  js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))");
} else js('nxPalette()');
save('palette-enter');
if (reference) js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
else js('closeModal()');
save('palette-exit');
steps.push({wait: 300});
if (reference) {
  steps.push({click: '[aria-label="More actions"]'});
  until("document.querySelector('[role=menuitem]')");
  if (phone) {
    js("[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('Session settings')).click()");
    until("document.querySelector('[aria-label=\"Session settings\"]')");
    js("[...document.querySelectorAll('[aria-label=\"Session settings\"] button')].find(b=>b.textContent.includes('Open folder')).click()");
  } else js("[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('Open project folder')).click()");
  until("document.querySelector('[data-sonner-toast]')");
  js("window.parityRegions = {toast: '[data-sonner-toast]'}");
} else {
  js("toast('Opening folder', 'Nexus Deck');window.parityRegions = {toast: '#toasts .toast'};");
}
save('toast-enter');
steps.push({wait: 500}, {shot: 'toast'}, {save: {name: 'toast.json', expression: 'parityMeasure()'}});
if (!reference) {
  steps.push({click: '#toasts .toast'});
  save('toast-exit');
  steps.push({wait: 450});
  js("if(document.querySelector('#toasts .toast'))throw Error('Toast exit did not clean up');");
  if (!phone && phase === 'after') {
    js("document.querySelector('#cards .nx-row').classList.add('pulse-once');if(getComputedStyle(document.querySelector('#cards .nx-row')).animationName!=='nx-pulse-once')throw Error('Legacy row reset masks attention pulse');");
    save('attention-pulse');
  }
  steps.push({media: {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]}});
  js("setView('overview');document.querySelector('[data-open=\"claude:s-dashboard\"]').click();if(state.view!=='focus')throw Error('Reduced-motion pointer route');nxPalette();closeModal();");
  steps.push({wait: 100});
  js("if(document.querySelector('body > [inert][aria-hidden=true]'))throw Error('Orphan exit surface');if(document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations===Infinity))throw Error('Reduced-motion infinite animation');");
}
const file = path.join(out, 'steps.json');
fs.writeFileSync(file, JSON.stringify(steps, null, 2));
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['tools/redesign-browser.mjs', reference ? '4793' : '4785', out, file], {windowsHide: true, stdio: 'inherit'});
  child.once('error', reject);
  child.once('exit', code => code ? reject(Error('Motion check failed')) : resolve());
});
console.log('PASS motion ' + phase + ' ' + kind + ' ' + width);
