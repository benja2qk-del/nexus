#!/usr/bin/env node
'use strict';
// NEXUS rename codemod. NEXUS called the Codex CLI agent "Astra" (kind 'astra'); the agent is now named Codex
// everywhere (kind 'codex'). This script does the mechanical part on the tracked files of a checkout.
//
//   node tools/rename-astra-to-codex.cjs <repo> [--write] [--report <file.json>] [--list <file.txt>] [--syntax] [--no-context]
//
// Without --write nothing is changed. It prints, per file, the number of replacements, the file renames it would
// do, and every occurrence of the old word it leaves, tagged "allowlisted" (with the rule that keeps it) or
// "hand-edit" (with the reason). With --write it rewrites the files in place and renames files with `git mv`.
//
//   --report <file.json>  the same facts as JSON, plus the allowlist counts the leftover guard starts from
//   --list <file.txt>     one line per planned replacement, with the text around it (for reading the plan)
//   --syntax              also run `node --check` on every changed script, before and after, and compare
//   --no-context          leave the surrounding text out of everything this script prints or writes
//
// How one occurrence is decided, in this order (the keep list is protected first):
//   1. KEEP     a rule of the keep list covers it          -> left as is, "allowlisted"
//   2. PHRASES  it sits in a sentence that needs rewording -> the reviewed rewrite is applied
//   3. NETS     a plain rename would read wrong            -> left as is, "hand-edit"
//   4. RENAME   astra -> codex, Astra -> Codex, ASTRA -> CODEX (case kept, no word boundaries, so compounds
//               such as astraLive, pollAstraLive, new-astra, --agent-astra, ASTRA_NEXUS_* follow)
// It works per occurrence, never per line. Only text between the first and last letter of a match is touched, so
// line endings, a byte order mark and every other byte of a file stay as they are. A second run finds nothing to
// do. Binary files and anything under node_modules are never rewritten (binary files can still be renamed).
// Exit code: 0 fine, 2 a check failed (see "PROBLEMS" in the output), 64 wrong usage.

const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');

// ---------- 1. The keep list ----------
// An occurrence is kept when it lies inside a match of one of these patterns (in a file the rule applies to).
// `quiet` rules never print the text around a match (it can hold a folder or project name).
const BRANCHES = 'build|call|copilot|cores|design|home|live|onechat|parity|phoneux|polish|redesign2?|revamp|review|slash2|themes(?:-ui)?|upload|voices?|wall';
const KEEP = [
  // This script, the compatibility code and its tests hold the old names on purpose (content and file name).
  // Listing them makes a later run of this script safe.
  { id: 'compat-file', why: 'this script, compatibility code or its test: the old names are there on purpose', wholeFile: true,
    files: /^(?:legacy-names\.js|public\/legacy-names\.js|tools\/codex-rename-checks\.cjs|tools\/rename-astra-to-codex\.cjs|tools\/fixtures\/codex-rename\/.*)$/ },
  // Recorded tour runs (checks.txt, steps.json, tests.txt) and the screenshots beside them are evidence of what the
  // page showed when they were captured: the pictures still read the old label, so their text and names stay too.
  // "Before" pictures cannot be captured again; a tour run later writes new files with the new names.
  { id: 'tour-record', why: 'captured tour evidence: record files and screenshots stay as captured, so text and pictures agree', wholeFile: true, files: /^docs\/shots\// },
  { id: 'model-id', why: 'real model id', re: /\bgpt-[\w.]+(?:-[\w.]+)*-astra\b/gi },
  { id: 'model-label', why: 'label of a real model id', re: /\bGPT-[\w.]+ Astra\b/g },
  { id: 'model-suffix-list', why: 'suffixes of real model ids (codex is already in the list)', files: /^public\/redesign-core\.js$/, re: /\|codex\|astra\|terra\|/g },
  { id: 'result-prefix', why: 'result line that agent runs wrote into transcripts', re: /(?:\(\?:)?ASTRA(?:\|CODEX\))? RESULT:/g },
  { id: 'tool-name-heuristic', why: 'regex that matches a tool name recorded in transcripts', files: /^(?:server|session-preview|subagents)\.js$|^public\/activity-language\.js$/, re: /\/(?:\\b)?(?:\(\?:)?astra(?:\|codex)?\)?(?:\\b)?\/i\.test\(/g },
  { id: 'brief-opener-regex', why: 'regex for the opening line of briefs found in transcripts (Codex is already accepted)', files: /^public\/activity-language\.js$/, re: /\(\?:Astra\|Codex\|Claude\)/g },
  { id: 'generic-title-regex', why: 'regex for generic titles of stored sessions (codex is already accepted)', files: /^public\/themes-ui\.js$/, re: /\|codex\|astra\|new\)/g },
  { id: 'proper-name-list', why: 'proper names kept capitalised in stored titles (codex is already in the list)', files: /^public\/recent-work\.js$/, re: /\bclaude codex astra copilot\b/g },
  { id: 'brief-opener-input', why: 'test input: the old opening line of a brief must keep matching', files: /^tools\//, re: /\bYou are GPT Astra\b/g },
  { id: 'tool-call-fixture', why: 'fixture: a tool call named with the old word proves old transcripts still count', files: /^tools\/redesign-round2-preload\.cjs$/, re: /call\('Astra',/g },
  { id: 'worktree-fixture', why: 'fixture: a worktree folder name', quiet: true, files: /^tools\/themes-fixes-checks\.cjs$/, re: /(?<=const trees=\['[\w.-]*-)astra(?=')/g },
  { id: 'worktree-folder', why: 'name of another worktree folder', re: /\bNexus Deck astra\b|\bNEXUS DECK ASTRA\b/g },
  { id: 'astral', why: 'another word (Astral, astral-sh)', re: /\b[Aa]stral\b/g },
  { id: 'branch-name', why: 'git branch name', files: /^docs\/|\.md$/i, re: new RegExp('(?<![A-Za-z0-9_-])astra-(?:' + BRANCHES + ')(?![A-Za-z0-9_-])', 'g') },
  { id: 'branch-in-commit-output', why: 'git branch name inside fixture commit output', files: /^tools\/telemetry-checks\.cjs$/, re: /\[astra-build /g },
  { id: 'temp-folder', why: 'folder outside the repository named in a report', quiet: true, files: /^docs\//, re: /\bnexus-astra-design-test\b|\\astra\\parity_shots/g },
];

// ---------- 2. Reviewed rewrites ----------
// Each needs more than the rename (Codex already stands beside the old name, an article changes, a variable would
// shadow another). A rule only fires on text that still holds the old word, so it cannot fire twice.
// `to` may use $1..$9 for the groups of `re`.
const PHRASES = [
  { id: 'paren-after-codex', why: '"Codex (shown as / called Astra ...)" says the name twice', re: /\bCodex \((?:shown as |called )?Astra(?: in NEXUS)?\)/g, to: 'Codex' },
  { id: 'paren-before-codex', why: '"Astra (Codex)" says the name twice', re: /\bAstra \(Codex\)/g, to: 'Codex' },
  { id: 'slash-pair', why: '"Astra / Codex" says the name twice', re: /\b(?:Astra|ASTRA) ?\/ ?(Codex|CODEX)\b/g, to: '$1' },
  { id: 'word-pair', why: 'search words "astra codex" would repeat', re: /\bastra codex\b/g, to: 'codex' },
  { id: 'summarizer-note', why: 'note under Summarize named both', files: /^agents\.js$/, re: /One Astra request using your Codex account/g, to: 'One request using your Codex account' },
  { id: 'fallback-comment', why: 'comment named both', files: /^server\.js$/, re: /\/\/ Astra, fallback: every Codex rollout/g, to: '// Codex, fallback: every rollout' },
  { id: 'live-brain-kind', why: 'the live brain kind is now the agent kind; the mapping maps nothing', files: /^live-brain\.js$/, re: /this\.kind==='codex'\?'astra':'claude'/g, to: 'this.kind' },
  { id: 'agent-radio', why: 'radio label "Astra · Codex"', files: /^public\/app\.js$/, re: /> Astra <small>· Codex<\/small>/g, to: '> Codex' },
  { id: 'new-session-hint', why: 'hint under the title "Codex" would start with the same word', files: /^public\/redesign-pages\.js$/, re: /'Astra runs, batch tasks'/g, to: "'Delegated runs, batch tasks'" },
  { id: 'test-name-archives', why: 'test name named both', files: /^tools\/truth-B-checks\.cjs$/, re: /'archives: Astra rollouts Codex compressed/g, to: "'archives: rollouts Codex compressed" },
  { id: 'fixture-shadow', why: 'a variable named codex would shadow the folder path of the same name', files: /^tools\/redesign-fixture\.cjs$/, re: /const astra=manifest\.find\(s=>s\.kind==='astra'\);fs\.appendFileSync\(astra\.file,/g, to: "const rollout=manifest.find(s=>s.kind==='codex');fs.appendFileSync(rollout.file," },
  { id: 'article', why: '"an Astra" becomes "a Codex"', re: /\b([Aa])n(\s+)Astra\b/g, to: '$1$2Codex' },
];

// ---------- 3. Safety nets ----------
// In prose, an unknown name that starts with the old word and a hyphen may be a branch: never guess.
const PROSE = /^docs\/.*\.(?:md|txt|html?|json)$|\.md$/i;
const KNOWN_PROSE_NAMES = /^astra-(?:listening|speaking|working)$/; // screenshot names, renamed with the tours
// Shapes a plain rename must not produce. Checked on the planned result; an edit inside a match is dropped.
const DUPLICATES = [
  /\bCodex ?\((?:shown as |called |formerly |aka )?Codex\b/g,
  /\bCodex ?\/ ?Codex\b/gi,
  /\bcodex codex\b/gi,
  /\bcodex\|codex\b/gi,
  /\bCodex(?: <small>)? ?· ?Codex\b/g,
  /\b[Aa]n\s+Codex\b/g,
];

const CASE = { astra: 'codex', Astra: 'Codex', ASTRA: 'CODEX' };
const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|bmp|ico|icns|pdf|zip|gz|7z|woff2?|ttf|otf|eot|mp3|wav|ogg|flac|mp4|webm|mov|mkv|onnx|bin|exe|dll|node|wasm|raw)$/i;
const SCRIPT_EXT = /\.(?:js|cjs|mjs)$/i;
const PROTECTED_FOLDERS = new Set(['nexus deck', 'nexus deck w-shots']); // the live checkout and the frozen copy

// tools/codex-rename-checks.cjs requires this file for the keep list: its leftover guard uses the same patterns.
module.exports = { KEEP, BINARY_EXT };
if (require.main !== module) return;

// ---------- arguments ----------
const USAGE = 'usage: node tools/rename-astra-to-codex.cjs <repo> [--write] [--report <file.json>] [--list <file.txt>] [--syntax] [--no-context]';
const flags = new Set(), values = {}, rest = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--report' || a === '--list') values[a] = process.argv[++i];
  else if (a.startsWith('--')) flags.add(a);
  else rest.push(a);
}
for (const f of flags) if (!['--write', '--syntax', '--no-context', '--allow-protected', '--help'].includes(f)) { console.error('unknown option ' + f + '\n' + USAGE); process.exit(64); }
if (rest.length !== 1 || flags.has('--help') || values['--report'] === undefined && process.argv.includes('--report') || values['--list'] === undefined && process.argv.includes('--list')) { console.error(USAGE); process.exit(64); }
const repo = path.resolve(rest[0]), WRITE = flags.has('--write'), CONTEXT = !flags.has('--no-context');
if (WRITE && PROTECTED_FOLDERS.has(path.basename(repo).toLowerCase()) && !flags.has('--allow-protected')) {
  console.error('Refusing --write in "' + path.basename(repo) + '": that folder is the live checkout or the frozen copy. Use a work copy (or --allow-protected when landing on purpose).');
  process.exit(64);
}

const git = a => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
const listed = git(['ls-files', '-z']);
if (listed.status !== 0) { console.error('git ls-files failed in ' + repo + ': ' + (listed.stderr || listed.error?.message)); process.exit(64); }
const tracked = listed.stdout.split('\0').filter(Boolean).filter(f => !/(^|\/)node_modules\//.test(f));
const trackedLower = new Set(tracked.map(f => f.toLowerCase()));

// ---------- helpers ----------
const lineCol = (starts, at) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; } return [lo + 1, at - starts[lo] + 1]; };
const lineStarts = text => { const s = [0]; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) s.push(i + 1); return s; };
const around = (text, s, e, n = 22) => !CONTEXT ? '' : (text.slice(Math.max(0, s - n), s) + '[[' + text.slice(s, e) + ']]' + text.slice(e, e + n)).replace(/[\r\n\t]+/g, ' ').replace(/(Users[\\/]+)[^\\/"'\s]+/gi, '$1<user>');
const expand = (to, hit) => to.replace(/\$(\d)/g, (_, d) => hit[+d] ?? '');
const tokenAt = (text, at) => { let s = at, e = at + 5; while (s > 0 && /[A-Za-z0-9_-]/.test(text[s - 1])) s--; while (e < text.length && /[A-Za-z0-9_-]/.test(text[e])) e++; return { start: s, text: text.slice(s, e) }; };
const eolCounts = t => { const crlf = (t.match(/\r\n/g) || []).length; return [crlf, (t.match(/\n/g) || []).length - crlf]; };
const keepRulesFor = file => KEEP.filter(r => !r.files || r.files.test(file));

function build(text, edits) {
  edits.sort((a, b) => a.s - b.s);
  let out = '', last = 0;
  for (const ed of edits) {
    if (ed.s < last) throw Error('overlapping edits at offset ' + ed.s);
    out += text.slice(last, ed.s); ed.os = out.length; out += ed.to; ed.oe = out.length; last = ed.e;
  }
  return out + text.slice(last);
}

// Decides every occurrence in one text. Returns null when the text does not hold the word.
function plan(file, text) {
  const occ = [...text.matchAll(/astra/gi)].map(m => ({ at: m.index, word: m[0], state: '' }));
  if (!occ.length) return null;
  const inside = (o, s, e) => o.at >= s && o.at + 5 <= e;
  const mark = (o, state, rule, why, quiet) => Object.assign(o, { state, rule, why, quiet: !!quiet });
  // 1. keep list
  for (const rule of keepRulesFor(file)) {
    if (rule.wholeFile) { for (const o of occ) if (!o.state) mark(o, 'keep', rule.id, rule.why, rule.quiet); continue; }
    for (const hit of text.matchAll(rule.re)) for (const o of occ) if (!o.state && inside(o, hit.index, hit.index + hit[0].length)) mark(o, 'keep', rule.id, rule.why, rule.quiet);
  }
  // 2. reviewed rewrites
  let edits = [];
  for (const rule of PHRASES) {
    if (rule.files && !rule.files.test(file)) continue;
    for (const hit of text.matchAll(rule.re)) {
      const s = hit.index, e = s + hit[0].length, mine = occ.filter(o => inside(o, s, e));
      if (!mine.length || mine.some(o => o.state)) continue; // nothing left to rename here, or part of it is protected or taken
      edits.push({ s, e, to: expand(rule.to, hit), rule: 'phrase:' + rule.id, occ: mine });
      for (const o of mine) mark(o, 'phrase', 'phrase:' + rule.id, rule.why);
    }
  }
  // 3. safety nets, 4. plain rename
  for (const o of occ) if (!o.state) {
    if (!CASE[o.word]) { mark(o, 'hand', 'unusual-case', 'letter case is none of astra / Astra / ASTRA'); continue; }
    const tok = tokenAt(text, o.at);
    if (PROSE.test(file) && tok.start === o.at && /^astra-[a-z0-9][a-z0-9-]*$/.test(tok.text) && !KNOWN_PROSE_NAMES.test(tok.text)) { mark(o, 'hand', 'unknown-hyphen-name', '"' + tok.text + '" may be a branch name: add it to the keep list or to the known names'); continue; }
    edits.push({ s: o.at, e: o.at + 5, to: CASE[o.word], rule: 'rename', occ: [o] }); mark(o, 'rename', 'rename', '');
  }
  let out = build(text, edits);
  const dropped = new Set();
  for (const shape of DUPLICATES) for (const hit of out.matchAll(shape)) for (const ed of edits) if (ed.os >= hit.index && ed.oe <= hit.index + hit[0].length && !dropped.has(ed)) {
    dropped.add(ed); for (const o of ed.occ) mark(o, 'hand', 'would-duplicate', 'a rename would read "' + hit[0] + '": reword by hand');
  }
  if (dropped.size) { edits = edits.filter(ed => !dropped.has(ed)); out = build(text, edits); }
  return { occ, edits, out };
}

// The new path of a tracked file whose name holds the word, by the same rules; null when nothing changes.
function newPath(file) {
  const p = plan(file, file);
  return p && p.out !== file ? p.out : null;
}

// Declared names a rename would make equal to a name the file already uses (worth a look, not an error: a
// redeclaration in one scope is caught by --syntax, a shadowed outer name is not).
function collisions(file, text, edits) {
  if (!SCRIPT_EXT.test(file) && !/\.html?$/i.test(file)) return [];
  const found = new Map();
  for (const ed of edits) if (ed.rule === 'rename') {
    let s = ed.s, e = ed.e; while (s > 0 && /[\w$]/.test(text[s - 1])) s--; while (e < text.length && /[\w$]/.test(text[e])) e++;
    const name = text.slice(s, e);
    const declared = /(?:\b(?:const|let|var|function|class)\s+|,\s*)$/.test(text.slice(Math.max(0, s - 12), s)) && /^\s*(?:=(?!=)|\()/.test(text.slice(e, e + 4));
    if (!declared) continue;
    const renamed = name.replace(/astra/gi, w => CASE[w] || w);
    if (new RegExp('(?<![\\w$.\'"`\\-/#])' + renamed.replace(/\$/g, '\\$') + '(?![\\w$\'"`\\-:])').test(text)) found.set(name + ' -> ' + renamed, lineCol(lineStarts(text), s)[0]);
  }
  return [...found].map(([what, line]) => ({ file, line, what }));
}

// ---------- the run ----------
const tmp = flags.has('--syntax') ? fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-codemod-')) : null; let tmpN = 0;
function nodeCheck(code, ext) {
  const f = path.join(tmp, 'c' + (tmpN++) + ext); fs.writeFileSync(f, code);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', windowsHide: true }); fs.unlinkSync(f);
  return r.status === 0 ? 'ok' : ((r.stderr || '').split(/\r?\n/).find(l => /Error/.test(l)) || 'error').trim();
}

const NAME = path.basename(repo); // reports name the folder, never its full path
const report = { repo: NAME, mode: WRITE ? 'write' : 'dry-run', files: [], renames: [], leftovers: [], replacements: [], collisions: [], problems: [], skipped: [] };
const areaOf = f => f.startsWith('public/') ? 'public' : f.startsWith('tools/') ? 'tools' : f.startsWith('docs/') ? 'docs' : 'root';
const areas = {}; for (const a of ['root', 'public', 'tools', 'docs']) areas[a] = { files: 0, occurrences: 0, replaced: 0, kept: 0, hand: 0 };
const writes = [];

for (const file of tracked) {
  const abs = path.join(repo, file);
  let st; try { st = fs.lstatSync(abs); } catch { continue; } // tracked but not on disk (deleted in the work tree)
  if (!st.isFile()) continue;
  const to = newPath(file);
  if (to) report.renames.push({ from: file, to });
  if (BINARY_EXT.test(file)) continue;
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) continue; // binary
  const text = buf.toString('utf8');
  if (!/astra/i.test(text)) continue;
  if (!Buffer.from(text, 'utf8').equals(buf)) { // not valid UTF-8: never rewritten
    report.skipped.push(file);
    report.leftovers.push({ file, line: 0, col: 0, word: 'astra', tag: 'hand-edit', rule: 'not-utf8', why: 'the file is not valid UTF-8 and holds the word: edit by hand', context: '' });
    continue;
  }
  const p = plan(file, text), starts = lineStarts(text), area = areas[areaOf(file)];
  const n = { rename: 0, phrase: 0, keep: 0, hand: 0 };
  for (const o of p.occ) {
    n[o.state]++;
    const [line, col] = lineCol(starts, o.at);
    if (o.state === 'keep' || o.state === 'hand') report.leftovers.push({ file, line, col, word: o.word, tag: o.state === 'keep' ? 'allowlisted' : 'hand-edit', rule: o.rule, why: o.why, context: o.quiet ? '' : around(text, o.at, o.at + 5) });
  }
  for (const ed of p.edits) { const [line, col] = lineCol(starts, ed.s); report.replacements.push({ file, line, col, rule: ed.rule, from: text.slice(ed.s, ed.e), to: ed.to, context: around(text, ed.s, ed.e) }); }
  report.files.push({ file, occurrences: p.occ.length, replaced: n.rename + n.phrase, byPhrase: n.phrase, allowlisted: n.keep, handEdit: n.hand });
  area.files++; area.occurrences += p.occ.length; area.replaced += n.rename + n.phrase; area.kept += n.keep; area.hand += n.hand;
  report.collisions.push(...collisions(file, text, p.edits));
  if (p.out === text) continue;
  // checks on the planned result
  const a = eolCounts(text), b = eolCounts(p.out);
  if (a[0] !== b[0] || a[1] !== b[1]) report.problems.push(file + ': line endings would change');
  if (/\.json$/i.test(file)) { let ok = true; try { JSON.parse(text.replace(/^﻿/, '')); } catch { ok = false; } if (ok) try { JSON.parse(p.out.replace(/^﻿/, '')); } catch (e) { report.problems.push(file + ': JSON no longer parses: ' + e.message); } }
  if (tmp && SCRIPT_EXT.test(file)) { const ext = path.extname(file), was = nodeCheck(text, ext), is = nodeCheck(p.out, ext); if (was === 'ok' && is !== 'ok') report.problems.push(file + ': node --check fails after the rewrite: ' + is); }
  writes.push({ abs, out: p.out });
}
if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

// rename conflicts
const targets = new Set();
for (const r of report.renames) {
  const key = r.to.toLowerCase();
  if (trackedLower.has(key) || targets.has(key) || fs.existsSync(path.join(repo, r.to))) { r.conflict = true; report.problems.push('rename ' + r.from + ' -> ' + r.to + ': the target exists'); }
  targets.add(key);
}

if (WRITE && !report.problems.length) {
  for (const w of writes) fs.writeFileSync(w.abs, Buffer.from(w.out, 'utf8'));
  for (const r of report.renames) {
    fs.mkdirSync(path.dirname(path.join(repo, r.to)), { recursive: true });
    const mv = git(['mv', '--', r.from, r.to]);
    if (mv.status !== 0) report.problems.push('git mv ' + r.from + ' -> ' + r.to + ' failed: ' + (mv.stderr || '').trim());
  }
}

// ---------- output ----------
const total = Object.values(areas).reduce((t, a) => ({ files: t.files + a.files, occurrences: t.occurrences + a.occurrences, replaced: t.replaced + a.replaced, kept: t.kept + a.kept, hand: t.hand + a.hand }), { files: 0, occurrences: 0, replaced: 0, kept: 0, hand: 0 });
const allow = {};
for (const l of report.leftovers) if (l.tag === 'allowlisted') { const r = allow[l.rule] || (allow[l.rule] = { why: l.why, total: 0, files: {} }); r.total++; r.files[l.file] = (r.files[l.file] || 0) + 1; }
report.totals = { filesWithTheWord: total.files, filesChanged: writes.length, occurrences: total.occurrences, replacements: total.replaced, byPhraseRules: report.files.reduce((t, f) => t + f.byPhrase, 0), leftovers: total.kept + total.hand, allowlisted: total.kept, handEdit: total.hand, fileRenames: report.renames.length };
report.areas = areas; report.allowlist = allow;

const say = s => console.log(s);
say((WRITE ? 'WRITE' : 'DRY RUN') + ' in "' + NAME + '" (' + tracked.length + ' tracked files)');
say('\nFILES (replacements | allowlisted | hand-edit)');
for (const f of report.files) say('  ' + f.file + ': ' + f.replaced + (f.byPhrase ? ' (' + f.byPhrase + ' by a reviewed rewrite)' : '') + ' | ' + f.allowlisted + ' | ' + f.handEdit);
say('\nFILE RENAMES (' + report.renames.length + ')');
for (const r of report.renames) say('  ' + r.from + ' -> ' + r.to + (r.conflict ? '   CONFLICT' : ''));
say('\nLEFT AS IS (' + report.leftovers.length + ')');
for (const l of report.leftovers) say('  ' + l.file + ':' + l.line + ':' + l.col + '  ' + l.tag + ' [' + l.rule + '] ' + l.why + (l.context ? '   ' + l.context : ''));
if (report.collisions.length) { say('\nNAMES TO LOOK AT (a renamed identifier equals a name the file already uses)'); for (const c of report.collisions) say('  ' + c.file + ':' + c.line + '  ' + c.what); }
if (report.skipped.length) { say('\nNOT REWRITTEN (not valid UTF-8)'); for (const f of report.skipped) say('  ' + f); }
say('\nBY AREA (files | occurrences | replaced | allowlisted | hand-edit)');
for (const [name, a] of Object.entries(areas)) say('  ' + name + ': ' + a.files + ' | ' + a.occurrences + ' | ' + a.replaced + ' | ' + a.kept + ' | ' + a.hand);
say('\nTOTAL: ' + total.occurrences + ' occurrences in ' + total.files + ' files; ' + total.replaced + ' replacements in ' + writes.length + ' files (' + report.totals.byPhraseRules + ' by reviewed rewrites); ' + (total.kept + total.hand) + ' left (' + total.kept + ' allowlisted, ' + total.hand + ' hand-edit); ' + report.renames.length + ' file renames');
if (report.problems.length) { say('\nPROBLEMS' + (WRITE ? ' (nothing was written)' : '')); for (const p of report.problems) say('  ' + p); }
else if (WRITE) say('\nWritten: ' + writes.length + ' files, ' + report.renames.length + ' renames.');

if (values['--report']) fs.writeFileSync(values['--report'], JSON.stringify(report, null, 1));
if (values['--list']) fs.writeFileSync(values['--list'], report.replacements.map(r => r.file + ':' + r.line + ':' + r.col + '\t' + r.rule + '\t' + r.from.replace(/\s+/g, ' ') + ' => ' + r.to + (r.context ? '\t' + r.context : '')).join('\n') + '\n');
process.exitCode = report.problems.length ? 2 : 0;
