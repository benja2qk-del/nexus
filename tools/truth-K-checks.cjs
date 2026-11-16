'use strict';
// Status and question recognition tells the owner what the terminal really shows: reply text, past messages and a
// pending model change are never read as a busy agent, an open menu, a question or a failed delivery.
// Synthetic screens and stub PTYs only; no CLI, browser or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const C = require('../public/conversation');
const { MessageQueue } = require('../message-queue');
const R = '─'.repeat(60), sleep = ms => new Promise(r => setTimeout(r, ms));
const claude = (above = '', typed = '') => (above ? above + '\n\n' : '') + R + '\n❯ ' + typed + '\n' + R + '\n  Opus 5.5 · ctx 41%\n  ⏵⏵ auto mode on (shift+tab to cycle)';
const codex = (above = '', typed = 'Ask Codex to do anything') => (above ? above + '\n\n' : '') + '› ' + typed + '\n\n  gpt-5.4 default · ~/work';

function loadTerms() {
  const ptys = [], file = path.resolve(__dirname, '../terms.js'), module = { exports: {} }, real = createRequire(file);
  const stub = { spawn() { const p = { pid: 4242 + ptys.length, writes: [], write(d) { p.writes.push(d); p.onWrite?.(d); }, onData: fn => p.data = fn, onExit: fn => p.exit = fn, kill() {}, resize() {} }; ptys.push(p); return p; } };
  const env = { NEXUS_CLAUDE_DIR: path.join(os.tmpdir(), 'nexus-truth-K-no-claude-dir') };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, require: n => n === '@lydell/node-pty' ? stub : n === './agents' ? { launch: (kind, args) => ({ file: kind, args }) } : real(n), process: { env }, setTimeout, clearTimeout, Buffer, console }, { filename: file });
  const terms = module.exports, open = (kind, key) => { const t = terms.open({ kind, title: 'Fixture', cwd: os.tmpdir(), sessionKey: key }), p = ptys.at(-1); return { t, p, paint: s => p.data('\x1b[2J\x1b[H' + s.replace(/\r?\n/g, '\r\n')) }; };
  return { terms, open };
}

async function main() {
  // F108: a message sent while a model change is being confirmed is put back and delivered once it ends.
  {
    const { terms, open } = loadTerms(), { t, p, paint } = open('claude', 'claude:fixture');
    paint(claude('● Ready.')); await sleep(700);
    t.switching = true;
    await assert.rejects(terms.send(t.id, 'Summarise the diff'), e => e.notSent === true && /model change/.test(e.message), 'nothing was typed, so the refusal is retryable');
    t.switching = false; t.sending = true;
    await assert.rejects(terms.send(t.id, 'Summarise the diff'), e => e.notSent === true, 'a send already in progress is retryable too');
    t.sending = false; t.switching = true;
    let now = 1e6;
    const q = new MessageQueue({ now: () => now, load: () => ({}), save: async () => {}, inspect: () => ({ kind: 'claude', terminal: terms.state(t.id, []), events: [] }), send: terms.send });
    await q.submit('claude:fixture', { id: 'm1', text: 'Summarise the diff' });
    let view = q.view('claude:fixture');
    assert.deepEqual([view.items.map(i => i.status), view.hold, p.writes], [['queued'], '', []], 'the message waits as Queued, not as a failed delivery');
    t.switching = false; now += 2000; await q.tick();
    view = q.view('claude:fixture');
    assert.equal(view.active?.text, 'Summarise the diff'); assert.deepEqual(p.writes, ['\x1b[200~Summarise the diff\x1b[201~', '\r'], 'typed once after the model change');
    terms.closeAll();
    console.log('PASS a message sent during a model change waits and goes once the change ends');
  }

  // F112: reply text above an idle input box is conversation, not the agent's busy or menu hint.
  {
    const quoted = '● The status row shows "esc to interrupt" while a turn runs; NEXUS reads that text.';
    for (const screen of [claude(quoted), codex('• The status row shows "esc to interrupt" while a turn runs.')]) {
      assert.equal(C.inputBusy(screen), false, screen); assert.equal(C.inputReady(screen, { seenInput: true }), true, screen);
    }
    for (const above of ['● Added the hint to the pause panel: "Press Esc to close".', '⎿  Image was too large. Double press esc to go back and try again with a smaller image.', '● In Copilot, run /model, use Select model and press enter to select it.']) {
      assert.equal(C.inputMenu(claude(above)), false, above); assert.equal(C.inputReady(claude(above), { seenInput: true }), true, above);
    }
    assert.equal(C.inputMenu(claude('', 'Press Esc to close the panel')), false, 'text typed in the box is the owner\'s');
    assert.equal(C.inputBusy(claude('', 'add an "esc to interrupt" hint')), false);
    // Real hints still count: status lines above the box, footers below it, and screens without a box.
    assert.equal(C.inputBusy(codex('• Working (12s • esc to interrupt)')), true, 'Codex status line');
    assert.equal(C.inputBusy(claude('✻ Retrying… · next try in 5s · attempt 2 · esc to interrupt')), true, 'Claude retry line');
    assert.equal(C.inputBusy('Working...\nEsc to interrupt'), true);
    assert.equal(C.inputMenu(claude('◉ Thinking (Esc to cancel)')), true, 'a status-shaped hint above the box is unchanged');
    assert.equal(C.inputMenu(require('./fixtures/copilot/screens.json').modelMenu), true, 'footer below a box-shaped search field');
    assert.equal(C.inputMenu('Help\n↑/↓ scroll · esc close'), true);
    assert.equal(C.inputMenu(claude().replace('(shift+tab to cycle)', '(shift+tab to cycle) · Enter to select · Esc to cancel')), true, 'a hint in the footer row');
    // A message whose text holds menu words is still entered after the paste.
    const { terms, open } = loadTerms(), { t, p, paint } = open('claude', 'claude:menu-words');
    paint(claude('● Ready.')); await sleep(700);
    p.onWrite = d => { if (d.startsWith('\x1b[200~')) paint(claude('● Ready.', d.slice(6, -6))); };
    await terms.send(t.id, 'Press Esc to close the panel');
    assert.deepEqual(p.writes, ['\x1b[200~Press Esc to close the panel\x1b[201~', '\r']);
    terms.closeAll();
    console.log('PASS reply and typed text never read as a busy agent or an open menu; status lines and footers still do');
  }

  // F112: punctuation in a reply ('·', ';', Codex's own '•' bullet), quoted footers and status lines, and a Codex
  // message whose second line holds a hint word are not hints; a status row with lines under it still is.
  {
    const replies = [claude('● Wired up the panel; press Esc to close it.'), claude('● The footer reads "↑/↓ to navigate · enter to select · esc to cancel".'),
      claude('● Codex shows "• Working (12s • esc to interrupt)" above its box.'), claude('● The footer reads "↑/↓ to navigate · enter to\n  select · esc to cancel" in the picker.'),
      claude('● Done.\n\n  The second paragraph says "(Esc to cancel)" and; press Esc.'),
      codex('• Added a close button.\n\n• Press Esc to close it.'), codex('• Ready.', 'Fix the dialog\n  Press Esc to close it should still work'), codex('• Ready.', 'Note: (esc to interrupt) stays\n  · esc to cancel too')];
    for (const screen of replies) {
      assert.equal(C.inputBusy(screen), false, screen); assert.equal(C.inputMenu(screen), false, screen); assert.equal(C.inputReady(screen, { seenInput: true }), true, screen);
    }
    const effort = s => s.replace(R + '\n❯', ' '.repeat(80) + '◐ medium · /effort\n' + R + '\n❯');
    for (const screen of [claude('● Bash(npm test)\n  ⎿  Running…\n\n✻ Working… (12s · ↓ 1.2k tokens · esc to interrupt)'), effort(claude('● Reading the queue.\n\n✻ Working… (esc to interrupt · ctrl+t to hide todos)\n  ⎿  ☐ Fix the dialog\n     ☐ Run the tests')),
      claude('✶ Thinking… (esc to interrupt)\n  ⎿  Tip: Use /memory to edit what Claude remembers'), codex('• Explored\n  └ Read queue.js\n\n• Working (12s • esc to interrupt)\n  ↳ also check the logs')]) assert.equal(C.inputBusy(screen), true, screen);
    const { terms, open } = loadTerms(), { t, p, paint } = open('codex', 'codex:typed-lines');
    paint(codex('• Ready.')); await sleep(700);
    p.onWrite = d => { if (d.startsWith('\x1b[200~')) paint(codex('• Ready.', d.slice(6, -6).replace(/\n/g, '\n  '))); };
    await terms.send(t.id, 'Fix the dialog\nPress Esc to close it should still work');
    assert.deepEqual(p.writes, ['\x1b[200~Fix the dialog\nPress Esc to close it should still work\x1b[201~', '\r'], 'a two-line Codex message is entered after the paste');
    terms.closeAll();
    console.log('PASS separators, quotes and bullets in a reply, and hint words typed in a Codex box, are not hints; status rows with lines under them are');
  }

  // A numbered message the owner sent earlier stays on screen above the box: it is not a question, and the box is ready.
  {
    const sent = '1. Add the export button\n  2. Update the tests';
    for (const screen of [claude('❯ ' + sent + '\n\n● Both done.'), codex('› ' + sent + '\n\n• Both done.')]) {
      assert.equal(C.pendingPrompt(screen), null, screen); assert.equal(C.inputMenu(screen), false, screen); assert.equal(C.inputReady(screen, { seenInput: true }), true, screen);
    }
    const approval = ['  Would you like to run the following command?', '', '  $ npm test', '', '› 1. Yes, proceed (y)', '  2. No, and tell Codex what to do differently (esc)', '', '  Press enter to confirm or esc to cancel'].join('\n');
    assert.deepEqual(C.pendingPrompt(approval).options.map(o => o.key), ['1', '2'], 'a real Codex approval is still a question');
    // The same message while NEXUS types it: a question with numbered lines in the box is the owner's, so Enter follows.
    const asked = 'Which is better for the release?\n1. Ship on Friday\n2. Ship on Monday';
    assert.equal(C.pendingPrompt(claude('● Ready.', asked.replace(/\n/g, '\n  '))), null);
    const { terms, open } = loadTerms(), { t, p, paint } = open('claude', 'claude:typed-question');
    paint(claude('● Ready.')); await sleep(700);
    p.onWrite = d => { if (d.startsWith('\x1b[200~')) paint(claude('● Ready.', d.slice(6, -6).replace(/\n/g, '\n  '))); };
    await terms.send(t.id, asked);
    assert.deepEqual(p.writes, ['\x1b[200~' + asked + '\x1b[201~', '\r'], 'delivered, not refused as a changed question');
    terms.closeAll();
    console.log('PASS a numbered message sent earlier, or being typed, is neither a question nor a busy input box');
  }

  // A question keeps all its options and its own wording.
  {
    const footer = 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel';
    const described = pendingPrompt([R, ' ☐ Layout', '', 'Which layout should we use?', '', '❯ 1. Keep the toolbar', '     Nothing moves.', '  2. Move the toolbar', '     Should the search box move too? It can.', '  3. Type something.', '  4. Chat about this', '', footer]);
    assert.deepEqual([described.question, described.options.map(o => o.key), described.selected], ['Which layout should we use?', ['1', '2', '3', '4'], '1'], 'a question mark in a description');
    const labelled = pendingPrompt([R, 'Which part should I do first?', '', '❯ 1. The export', '  2. Should I update the docs?', '  3. Type something.', '', footer]);
    assert.deepEqual([labelled.question, labelled.options.map(o => o.key)], ['Which part should I do first?', ['1', '2', '3']], 'a question mark in a label');
    const menu = pendingPrompt(['● Which file should I edit next?', '', R, ' Select model', ' Switch between Claude models.', '', ' ❯ 1. Default (recommended)', '   2. Sonnet', '', ' Enter to confirm · Esc to exit']);
    assert.equal(menu.question, 'Select model Switch between Claude models.', 'the reply behind the dialog is not its question');
    const permission = pendingPrompt(['● Should I run the tests now?', '', R, ' Bash command', '', '   npm test', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend']);
    assert.equal(permission.question, 'Do you want to proceed?');
    console.log('PASS a question keeps every option and its own wording, not a description or the reply behind it');
  }

  // F151: a terminal whose Claude process moved to another conversation (/clear, /resume) is titled after the one it
  // serves now, by the server, so a page loaded after the move (the phone, a reload) does not show the old title.
  {
    const { terms } = loadTerms(), folder = path.basename(os.tmpdir());
    const moved = terms.open({ kind: 'claude', title: 'Fix the login', cwd: os.tmpdir(), sessionKey: 'claude:A' });
    const fresh = terms.open({ kind: 'claude', title: 'New Claude session', cwd: os.tmpdir(), sessionKey: null });
    const title = id => terms.list().find(t => t.id === id).title;
    const rowA = { title: 'Fix the login' }, rowB = { title: 'Write the changelog' };
    terms.linkSessions(new Map([['B', { pid: moved.pid, sessionId: 'B' }], ['N', { pid: fresh.pid, sessionId: 'N' }]]));
    terms.retitle(key => ({ 'claude:A': rowA, 'claude:B': rowB })[key] || null);
    assert.equal(title(moved.id), 'Write the changelog', 'the moved terminal names the conversation it serves now');
    assert.equal(title(fresh.id), 'New Claude session', 'a new session linked for the first time did not move');
    terms.retitle(key => ({ 'claude:A': rowA })[key] || null);
    assert.equal(title(moved.id), 'New conversation · ' + folder, 'a conversation not listed yet is a new one in that folder');
    terms.retitle(key => ({ 'claude:A': rowA, 'claude:B': rowA })[key] || null);
    assert.equal(title(moved.id), 'Fix the login', 'Claude continuing the same conversation under a new id keeps the title');
    terms.closeAll();
    console.log('PASS a terminal that moved to another conversation is titled after it on every page');
  }
}
const pendingPrompt = lines => C.pendingPrompt(lines.join('\n'));
main().catch(e => { console.error(e); process.exitCode = 1; });
