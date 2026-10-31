// Creates repeatable screenshot steps; only term-new in the supplied scratch directory may write.
// NEXUS_PORT=4790 NEXUS_WIDTH=1920 NEXUS_HEIGHT=1080 node tools/design-tour.mjs before <scratch>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const [phase, scratch] = process.argv.slice(2);
if (!['before', 'after', 'build'].includes(phase) || !scratch) throw new Error('Expected before|after|build and a scratch directory');
if (process.env.NEXUS_PORT !== '4790') throw new Error('Design tours require the private server on NEXUS_PORT=4790');
if (!path.resolve(scratch).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep)) throw new Error('Terminal scratch directory must be inside TEMP');
const width = Number(process.env.NEXUS_WIDTH) || 1920;
if (phase === 'build') { const { prepare } = await import('./build-tour.mjs'); prepare(scratch, width); process.exit(0); }
const out = path.resolve(`docs/shots/tmp/${phase}-${width}`);
fs.mkdirSync(out, { recursive: true });
const shot = name => ({ shot: `../../${phase}/${width}-${name}` });
const steps = [
  { wait: 1000 }, shot('boot'), { wait: 5000 }, shot('focus'),
  { js: "select(keyOf(state.sessions.find(s => s.kind === 'claude' && s.live) || state.sessions.find(s => s.kind === 'claude')))" },
  { wait: 1000 }, shot('claude'),
  { js: "runAction('resume', {...state.byKey.get(state.sel),kind:'claude',live:true,inNexus:false,term:null})" }, { wait: 400 }, shot('already-running'),
  { js: "closeModal(); select(keyOf(state.sessions.find(s => s.kind === 'astra' && s.brief)))" },
  { wait: 1000 },
  { js: "document.querySelector('#feed .brief')?.scrollIntoView({block:'start'})" }, shot('astra-brief'),
  { js: "setView('wall')" }, { wait: 1800 }, shot('wall'),
  { js: "newSessionModal()" }, { wait: 350 }, shot('new-session'),
  { js: "closeModal(); setView('focus'); window.realUsage = state.usage; state.usage = {claude:{at:Date.now(),fiveHour:{pct:94,resetsAt:Date.now()+90*60000},week:{pct:62,resetsAt:Date.now()+2*86400000}},astra:{at:Date.now()-7200000,primary:{pct:78,resetsAt:Date.now()-60000,minutes:300},secondary:{pct:86,resetsAt:Date.now()+86400000,minutes:10080}}}; renderLimits()" },
  shot('usage-limits'),
  { js: `(async () => { state.usage = window.realUsage; await openInApp('term-new', {cwd:${JSON.stringify(scratch)}}); window.testTerm = selTerm(); console.log('TEST_TERMINAL', JSON.stringify(window.testTerm)); })()` },
  { wait: 5000 }, shot('terminal'),
  { js: "(async () => { await closeTerm(window.testTerm); console.log('remaining terminals', JSON.stringify(state.terms)); })()" },
  { js: "console.log('layout', JSON.stringify({viewport:[innerWidth,innerHeight],app:document.querySelector('#app').getBoundingClientRect().toJSON(),feed:document.querySelector('#feed').getBoundingClientRect().toJSON()}))" }
];
fs.writeFileSync(path.join(out, 'steps.json'), JSON.stringify(steps, null, 2));
console.log(out);
