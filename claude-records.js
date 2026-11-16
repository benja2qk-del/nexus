'use strict';
// Whose words a Claude Code record holds. Chat, the session row, the preview, the recap and telemetry all read
// records through these, so they agree on what the owner sent and what Claude replied.
const PASTE = /<\/?pasted_content\b[^>]*>\n?/g;
const INTERRUPT = /^\[Request interrupted by user[^\]]*\]$/;
// Claude Code's own wrappers are hyphenated or underscored tags (system-reminder, local-command-stdout, ide_selection).
const MACHINE_TAG = /^<[a-z]+[-_][a-z_-]*[\s>]/i;

function clip(s, n) {
  if (typeof s !== 'string') s = s == null ? '' : JSON.stringify(s);
  if (s.length <= n) return s;
  // Never end on the first half of an emoji.
  return s.slice(0, /[\uD800-\uDBFF]/.test(s[n - 1]) ? n - 1 : n) + '…';
}
// A long paste is recorded inside <pasted_content> tags; the text is still what the owner sent.
// A typed message may open with "<" (HTML, "<3"); records without a human origin are older or machine-written.
function ownerText(text, human) {
  const s = String(text || '').replace(PASTE, '').trim();
  if (!s || INTERRUPT.test(s)) return '';
  return s.startsWith('<') && (!human || MACHINE_TAG.test(s)) ? '' : s;
}
function parts(content, human) {
  if (typeof content === 'string') return { text: ownerText(content, human), images: [] };
  if (!Array.isArray(content)) return { text: '', images: [] };
  return { text: content.filter(c => c.type === 'text').map(c => ownerText(c.text, human)).filter(Boolean).join('\n'),
    images: content.filter(c => c.type === 'image' && c.source).map(c => c.source) };
}
// A message the owner sent: a user record, or a queued_command attachment when it was typed while Claude was busy.
// Returns { text, images (block sources), at } or null.
function ownerPrompt(r) {
  if (!r || r.isSidechain || r.isMeta || r.isCompactSummary) return null;
  let p, at = r.timestamp || null;
  if (r.type === 'user' && r.message) {
    const c = r.message.content, kind = r.origin?.kind;
    if (kind && kind !== 'human' || Array.isArray(c) && c.some(x => x.type === 'tool_result')) return null;
    p = parts(c, kind === 'human');
  } else if (r.type === 'attachment' && r.attachment?.type === 'queued_command') {
    const a = r.attachment, kind = a.origin?.kind;
    if (a.commandMode !== 'prompt' || a.isMeta || kind && kind !== 'human') return null;
    p = parts(a.prompt, kind === 'human'); at = a.timestamp || at;
  } else return null;
  return p.text || p.images.length ? { ...p, at } : null;
}
// One line for a prompt that is only a picture.
const promptText = p => p ? p.text || (p.images.length ? '[Image attached]' : '') : '';
// Claude Code closes a dangling turn with its own "No response requested." and writes API errors as assistant records.
const machineReply = r => r?.type === 'assistant' && (r.message?.model === '<synthetic>' || !!r.isApiErrorMessage);
const assistantText = r => Array.isArray(r?.message?.content) ? r.message.content.filter(c => c.type === 'text' && c.text).map(c => c.text).join('\n').trim() : typeof r?.message?.content === 'string' ? r.message.content.trim() : '';
const taskSummary = text => (String(text || '').match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || 'background task update';
function peerNote(origin, text) {
  const body = String(origin.body || text || '').replace(/<\/?cross-session-message\b[^>]*>/g, '').trim();
  return (origin.handback ? 'Report from ' : 'Message from ') + (origin.name || 'another session') + (body ? ': ' + clip(body, 600) : '');
}
// News Claude Code wrote into the conversation that is no one's message: { text, err? } or null.
function note(r) {
  if (!r || r.isSidechain || r.isCompactSummary) return null;
  if (r.type === 'user' && r.message) {
    const c = r.message.content, only = typeof c === 'string' ? c : Array.isArray(c) && c.length === 1 && c[0].type === 'text' ? c[0].text : '';
    if (INTERRUPT.test(String(only || '').trim())) return { text: 'You interrupted' };
    if (r.origin?.kind === 'peer') return { text: peerNote(r.origin, typeof c === 'string' ? c : '') };
  } else if (r.type === 'attachment' && r.attachment?.type === 'queued_command') {
    const a = r.attachment;
    if (a.origin?.kind === 'peer') return { text: peerNote(a.origin, typeof a.prompt === 'string' ? a.prompt : '') };
    if (a.commandMode === 'task-notification') return { text: clip(taskSummary(a.prompt), 400) };
  } else if (r.type === 'system' && r.subtype === 'scheduled_task_fire' && r.content) return { text: clip(String(r.content), 400) };
  else if (r.type === 'assistant' && r.isApiErrorMessage) return { text: clip(assistantText(r) || 'API error', 1200), err: true };
  return null;
}
module.exports = { clip, ownerText, ownerPrompt, promptText, machineReply, assistantText, taskSummary, note };
