'use strict';
// Sent messages and queued rows show [file name] where a file went (attachments.short); the agent's text is untouched.
// Loads public/uploads.js in a bare sandbox and checks the display form only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const store = new Map();
const sandbox = { window: { addEventListener() {} }, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, document: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'uploads.js'), 'utf8') + '\nthis.attachments = attachments;', sandbox);
const short = sandbox.attachments.short;
const up = 'C:\\Users\\someone\\AppData\\Local\\NexusDeck\\uploads\\2026-11-12\\';
const cases = [
  ['Claude reference', 'Look at @"' + up + 'notes.txt" please', 'Look at [notes.txt] please'],
  ['Codex bare path', 'Look at ' + up + 'notes.txt please', 'Look at [notes.txt] please'],
  ['name with a space', up + 'my file.txt, then answer', '[my file.txt], then answer'],
  ['name with two dots', up + 'report.final.txt', '[report.final.txt]'],
  ['numbered copy, quoted', '@"' + up + 'notes (2).txt"', '[notes (2).txt]'],
  ['two files', up + 'a.png\n' + up + 'b.png', '[a.png]\n[b.png]'],
  ['forward slashes', 'see D:/data/uploads/2026-01-02/shot.png', 'see [shot.png]'],
  ['a path outside uploads stays', 'open C:\\dev\\project\\main.js', 'open C:\\dev\\project\\main.js'],
  ['plain text stays', 'no files here [really]', 'no files here [really]'],
  ['empty', '', '']
];
let failed = 0;
for (const [name, input, want] of cases) { const got = short(input); const ok = got === want; if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want))); }
// The pages that draw sent text use the short form.
const uses = [['public/app.js', 'nxShort(b.text)'], ['public/onechat.js', 'esc(nxShort(b.text))'], ['public/message-queue.js', 'esc(nxShort(item.text))']];
for (const [file, needle] of uses) { const ok = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').includes(needle); if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + file + ' shows the short form'); }
console.log(failed ? failed + ' failed' : 'short file names: ' + (cases.length + uses.length) + '/' + (cases.length + uses.length));
process.exit(failed ? 1 : 0);
