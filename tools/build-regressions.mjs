import fs from 'node:fs';
const out = 'docs/shots/tmp/build-regressions';
fs.mkdirSync(out, { recursive: true });
const steps = [
  { wait: 250 }, { click: '#skipBoot' }, { wait: 1000 },
  { js: "if(!state.booted||$('#app').inert)throw Error('Boot skip failed');console.log('PASS skippable boot');setTheme('parallax');$('#voiceBtn').click();if(!apsis.voice||window.__spoken!==1)throw Error('Explicit voice choice failed');location.reload()" },
  { wait: 4000 }, { js: "if(apsis.theme!=='parallax'||!apsis.voice||window.__spoken!==1)throw Error('Preferences not restored');console.log('PASS remembered theme and optional voice via silent speech stub');$('#voiceBtn').click();setTheme('apsis');select(keyOf(state.sessions.find(s=>s.kind==='claude'&&s.live)||state.sessions[0]));" },
  { wait: 500 }, { js: "if(!$('.rc-switch'))throw Error('Remote Control switch missing');if($('.rc-switch').getAttribute('aria-checked')!==String(!!state.byKey.get(state.sel).remote))throw Error('Remote status mismatch');console.log('PASS Remote Control reflects registry evidence');setView('overview')" },
  { js: "const b=$('#missionLeft [data-insight=spend]');b.focus();state.sessions.find(s=>keyOf(s)===b.closest('[data-session]').dataset.session).insights.spend.total++;renderApsis();if(document.activeElement.dataset.insight!=='spend')throw Error('Overview polling lost focus');console.log('PASS overview preserves action focus');" },
  { viewport: [390, 844] }, { wait: 100 }, { click: '[data-phone-wall]' }, { wait: 700 },
  { click: '#wallBack' }, { js: "if(state.view!=='overview')throw Error('Phone wall back failed');console.log('PASS phone wall round trip');" },
  { click: '[data-phone-spend]' }, { js: "if(!$('.modal-limits .lim'))throw Error('Phone limits missing');console.log('PASS phone spend and limits are one tap away');closeModal();" },
  { js: "setTheme('stratum');document.documentElement.setAttribute('data-test','reduced-motion');" },
  { media: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] } },
  { js: "$('#nexusCore').dataset.state='working';if(getComputedStyle($('#nexusCore img')).animationName!=='none')throw Error('Reduced motion failed');console.log('PASS reduced motion stops core animation');setTimeout(()=>location.reload(),100)" },
  { wait: 1500 }, { js: "if(!state.booted||apsis.theme!=='stratum'||apsis.voice)throw Error('Reduced-motion startup/preferences failed');setTheme('apsis');console.log('PASS fast reduced-motion startup and mute persistence');" },
  { js: "(async()=>{const m=await(await fetch('/manifest.webmanifest')).json();if(m.name!=='NEXUS'||m.display!=='standalone')throw Error('Manifest invalid');for(const icon of m.icons){const response=await fetch(icon.src);if(!response.ok||!response.headers.get('content-type').includes('image/png'))throw Error('Icon not served as PNG');const bytes=new DataView(await response.arrayBuffer());if(bytes.getUint32(16)!==Number(icon.sizes.split('x')[0])||bytes.getUint32(20)!==Number(icon.sizes.split('x')[1]))throw Error('Icon dimensions wrong')}console.log('PASS manifest and 192/512 PNG dimensions')})()" },
];
fs.writeFileSync(out + '/steps.json', JSON.stringify(steps, null, 2));
console.log(out);
