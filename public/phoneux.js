'use strict';
// iOS Safari applies :active (the pressed look) only when the page listens for touches.
if (typeof document !== 'undefined') document.addEventListener('touchstart', () => {}, { passive: true });

function sessionPreview(s) {
  // A finished exchange shows its label ("Playtester kit update"); a working session shows what it is doing.
  if (s.label && statusLabel(s)[0] !== 'busy') return s.label;
  return [s.latestContext,s.lastText,s.kind==='codex'&&(s.commission||s.briefSummary),s.lastPrompt,s.firstPrompt].filter(Boolean).map(text=>NexusDesign.plainSummary(/^you are\b/i.test(text)?NexusActivity.briefTitle(text).summary:text)).find(Boolean)||'';
}
function sessionTags(s) {
  return [...new Set([...(s.recentTools || []), ...(s.kind === 'codex' ? ['Codex'] : []), ...(s.live && s.remote ? ['Remote'] : []), ...(s.term || s.inNexus ? ['IN NEXUS'] : [])])];
}
function sessionTagsHTML(s) {
  return '<span class="session-tags">' + sessionTags(s).map(tag => `<span title="${tag === 'Chrome' || tag === 'Codex' ? 'Recently used in this conversation' : esc(tag)}">${esc(tag)}</span>`).join('') + '</span>';
}
function sessionSearchText(s) {
  return [s.title,s.firstPrompt,s.lastPrompt,s.lastText,s.latestContext,s.cwd,s.groupLabel,s.briefTitle,s.id,s.theme?.name,s.searchText,...(s.workFolders||[]).map(f=>f.path),...(s.touchedFiles||[]),...sessionTags(s)].join(' ').toLowerCase();
}
function compactSessionCard(s) {
  const [cls,status] = statusLabel(s);
  const label = status;
  return `<button class="session-preview ${cls === 'ready' ? 'needs-you' : ''}" data-open="${esc(keyOf(s))}"><span class="preview-title">${esc(s.title)}</span><span class="preview-meta"><span class="status ${cls}"><i></i>${esc(label)}</span><span>${agentName(s.kind)} · ${esc(s.groupLabel)}</span><time>${ago(s.updated)}</time></span><span class="preview-context">${esc(sessionPreview(s))}</span>${sessionTagsHTML(s)}</button>`;
}

// The app is a fixed viewport shell; only the transcript / sheets scroll.
// Write geometry synchronously on BOTH visualViewport events, with no animation.
function initializePhoneViewport() {
  let baseline = innerHeight, lastWidth = innerWidth, wasKeyboard = false;
  const viewport = () => {
    if (!matchMedia('(max-width: 700px)').matches) { document.body.classList.remove('keyboard-open'); return; }
    const chat = $('#chatView');
    const follow = chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
    const vv = window.visualViewport, height = vv?.height || innerHeight;
    if (innerWidth !== lastWidth) { baseline = innerHeight; lastWidth = innerWidth; }
    const editing = document.activeElement?.matches('input,textarea,[contenteditable=true]');
    if (!editing && !wasKeyboard) baseline = innerHeight;
    baseline = Math.max(baseline, innerHeight);
    const keyboard = Math.max(innerHeight, editing ? baseline : innerHeight) - height > 120;
    const top = vv?.offsetTop || 0;
    document.documentElement.style.setProperty('--visible-height', height + 'px');
    document.documentElement.style.setProperty('--viewport-top', top + 'px');
    document.body.classList.toggle('keyboard-open', keyboard);
    // Remember the reading position BEFORE shrinking the shell for the keyboard.
    if ((keyboard || wasKeyboard) && state.tab === 'chat' && follow) chat.scrollTop = chat.scrollHeight;
    wasKeyboard = keyboard;
  };
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  addEventListener('resize', viewport);
  document.addEventListener('focusin', viewport);
  document.addEventListener('focusout', () => requestAnimationFrame(viewport));
  viewport();
}

function currentTerminalPrompt(v) {
  const buffer = v.xt.buffer.active, lines = [];
  // Never inspect scrollback: an old permission must not become actionable again.
  for (let n = buffer.baseY; n < buffer.baseY + v.xt.rows; n++) {
    const line = buffer.getLine(n); if (!line) continue;
    const text = line.translateToString(false);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return NexusConversation.pendingPrompt(lines.map(l => l.trimEnd()).join('\n'));
}
function chatHelp() {
  modal('<h2>Conversation help</h2><p>Send delivers your message. A saved session is resumed first, and your message says Sending until it appears in the conversation. While the agent works, new messages wait in the queue; Send now delivers one at once.</p><p>Tap Thinking or a step to see its details. Answer the agent\'s questions with their buttons. Stop ends the current turn. Raw terminal, in the ⋯ menu, shows the session\'s own screen.</p><p>Attach files or photos up to 50 MB each. On a phone, Return adds a new line.</p><p>Call starts a spoken conversation with the agent.</p>');
}
