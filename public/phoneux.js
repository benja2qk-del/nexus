'use strict';

function sessionPreview(s) {
  // A finished exchange shows its label ("Playtester kit update"); a working session shows what it is doing.
  if (s.label && statusLabel(s)[0] !== 'busy') return s.label;
  return [s.latestContext,s.lastText,s.kind==='astra'&&(s.commission||s.briefSummary),s.lastPrompt,s.firstPrompt].filter(Boolean).map(text=>NexusDesign.plainSummary(/^you are\b/i.test(text)?NexusActivity.briefTitle(text).summary:text)).find(Boolean)||'';
}
function sessionTags(s) {
  return [...new Set([...(s.recentTools || []), ...(s.kind === 'astra' ? ['Astra'] : []), ...(s.live && s.remote ? ['Remote'] : []), ...(s.term || s.inNexus ? ['IN NEXUS'] : [])])];
}
function sessionTagsHTML(s) {
  return '<span class="session-tags">' + sessionTags(s).map(tag => `<span title="${tag === 'Chrome' || tag === 'Astra' ? 'Recently used in this conversation' : esc(tag)}">${esc(tag)}</span>`).join('') + '</span>';
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
  modal('<h2>One conversation</h2><p>Send starts a saved session and delivers your message when it is ready. Your message stays marked Sending until it appears in the conversation.</p><p>Expand Thinking or an activity row for details. Answer questions using their buttons. Interrupt stops the current turn. Terminal is the advanced, raw screen.</p><p>Attach files or photos up to 50 MB each. On a phone, Return adds a new line.</p><p>Tap Talk for a hands-free conversation. Pause to send, or use Send now. Tap the Talk panel during speech to interrupt. End stops voice. Voice check in More tests the microphone and playback.</p>');
}
