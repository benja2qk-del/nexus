'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { TerminalScreen } = require('../terminal-screen');
const { pendingPrompt, inputReady } = require('../public/conversation');
const fixtures = require('./fixtures/onechat/screens.json');
assert(!/Benjamin|BEACON|BOILERPLATE|Steam-One-Shot|2ada5b10/i.test(JSON.stringify(fixtures)),'fixtures exclude original owner paths, IDs and chat text');
assert.equal(inputReady(fixtures.A),false);
assert.equal(pendingPrompt(fixtures.A).mode,'arrows');
assert.deepEqual(pendingPrompt(fixtures.A).options,[{key:'1',label:'No, exit'},{key:'2',label:'Yes, I trust this folder'}]);
for (const id of ['B','C','D']) { assert(inputReady(fixtures[id]),id+' is ready'); assert.equal(pendingPrompt(fixtures[id]),null); }
assert(inputReady('── session name ──\n❯ /previous command\n────\nArbitrary custom footer'));
assert(inputReady('Working...\nEsc to interrupt', {seenInput:true}));
assert(!inputReady('Starting...\nEsc to interrupt'));
assert(!inputReady('A quoted ❯ without an input box'));
assert.equal(pendingPrompt('Here are choices:\n  No, exit\n  Yes, trust this folder'),null);
assert.equal(pendingPrompt(fixtures.A+'\nNew output'),null);
const menu='Choose an environment\n\n  Preview\n❯ Stable\n  Local\nEnter to select · Esc to cancel';
assert.equal(pendingPrompt(menu).selected,'2');
assert.deepEqual(pendingPrompt(menu).options.map(o=>o.label),['Preview','Stable','Local']);
const wrapped='Choose an environment\n\n  Preview with a long\n    wrapped description\n\n❯ Stable\nEnter to select · Esc to cancel';
assert.equal(pendingPrompt(wrapped).selected,'2');assert.equal(pendingPrompt(wrapped).options[0].label,'Preview with a long wrapped description');

const raw = fs.readFileSync(path.join(__dirname,'fixtures/onechat/fresh-session.raw'),'utf8');
assert(!/Benjamin|BEACON|BOILERPLATE|Steam-One-Shot|2ada5b10/i.test(raw),'raw paths are sanitized');
const display = new TerminalScreen();display.write(raw);
assert(inputReady(display.text()));assert.equal(pendingPrompt(display.text()),null);
assert.equal(display.lines[31].slice(0,24).join('').trim(),'❯ Try "fix lint errors"');
assert.equal(display.lines[34].slice(2).join('').trim(),'Opus 5.5');
// Every split includes split CSI/OSC strings, surrogate pairs and private modes.
for(let i=0;i<raw.length;i++) { const d=new TerminalScreen();d.write(raw.slice(0,i));d.write(raw.slice(i));assert.equal(d.text(),display.text(),'raw split '+i); }
const trustEnd=raw.indexOf('\x1b[15;2H ');const trust=new TerminalScreen();trust.write(raw.slice(0,trustEnd));
assert.equal(pendingPrompt(trust.text()).selected,'1');assert(!inputReady(trust.text()));
const trustMoved=raw.indexOf('\x1b[>4m');trust.write(raw.slice(trustEnd,trustMoved));assert.equal(pendingPrompt(trust.text()).selected,'2');

const render = (raw,cols=12,rows=5) => { const d=new TerminalScreen(cols,rows);d.write(raw);return d; };
assert.equal(render('abcdef\r\x1b[2C\x1b[2X').text(),'ab  ef','erase chars retains columns');
assert.equal(render('abcdef\r\x1b[2C\x1b[2@').text(),'ab  cdef','insert chars');
assert.equal(render('abcdef\r\x1b[2C\x1b[2P').text(),'abef','delete chars');
assert.equal(render('abcdef\r\x1b[2C\x1b7\x1b[3;1Hother\x1b8!').text(),'ab!def\n\nother','DEC cursor save/restore');
assert.equal(render('abc\x1b[?uD').text(),'abcD','private keyboard query is not cursor restore');
assert.equal(render('normal\x1b[?1049hother\x1b[?1049l!').text(),'normal!','alternate buffer restores primary cursor and text');
assert.equal(render('abc\x1b[3J').text(),'abc','scrollback erase preserves current screen');
assert.equal(render('123456789012\x1b[1D!').text(),'1234567890!2','movement cancels pending wrap');
const region='A\r\nB\r\nC\r\nD\r\nE\x1b[2;4r';
assert.equal(render(region+'\x1b[4;1H\n').text(),'A\nC\nD\n\nE','LF scrolls only region');
assert.equal(render(region+'\x1b[S').text(),'A\nC\nD\n\nE','scroll up');
assert.equal(render(region+'\x1b[T').text(),'A\n\nB\nC\nE','scroll down');
assert.equal(render(region+'\x1b[3;1H\x1b[L').text(),'A\nB\n\nC\nE','insert line inside region');
assert.equal(render(region+'\x1b[3;1H\x1b[M').text(),'A\nB\nD\n\nE','delete line inside region');
assert.equal(render(region+'\x1b[2;1H\x1bM').text(),'A\n\nB\nC\nE','reverse index');
const wide=render('雪🙂e\u0301👩‍💻⚠️!\x1b[2;1H❯',20);
assert.equal(wide.lines[0][2],'🙂');assert.equal(wide.lines[0][4],'é');assert.equal(wide.lines[0][5],'👩‍💻');assert.equal(wide.lines[0][7],'⚠️');assert.equal(wide.lines[0][9],'!');
assert.equal(render('雪a\r!').text(),'! a','overwriting wide glyph clears continuation');
const split=render('');for(const unit of '雪🙂é👩‍💻⚠️!'.split(''))split.write(unit);assert.equal(split.text(),'雪🙂é👩‍💻⚠️!');
const narrow=new TerminalScreen();narrow.write('old wide column '.repeat(8));narrow.resize(48,12);
assert(narrow.lines.every(l=>l.length<=48),'resize clips stale columns');
narrow.write('\x1b[2J\x1b[H'+('─'.repeat(33)+' fixture dev ─')+'\r\n❯ Try "fix lint errors"\r\n'+'─'.repeat(48)+'\r\n  Opus 5.5 · ctx 41%');
assert(inputReady(narrow.text()));assert.equal(narrow.text().split('\n')[1],'❯ Try "fix lint errors"');
console.log('PASS sanitized real screens A-D, raw capture at every chunk boundary, narrow redraw, VT erase/edit/scroll/alternate modes and Unicode cell widths');
