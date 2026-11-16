'use strict';
// Piggybacks on the cached metadata tail scan. No additional file reads.
// A tag means recently USED in the sampled tail, not an active connection.
const language = require('./public/activity-language');
const claudeRecords = require('./claude-records');
function createPreview() { return {tools: [], latestContext: '', run: []}; }
function text(value) { return typeof value === 'string' ? value : ''; }
// A Codex result line opens with commit ids; the preview keeps what changed.
function shorten(value) { return require('./public/redesign-core').plainSummary(value); }
function recordText(preview, value) { preview.latestContext = shorten(value); preview.run = []; }
function recordTool(preview, name, input) {
  const command = typeof input === 'string' ? input : input?.command || input?.cmd || input?.code || '';
  const tags = [];
  if (/claude.in.chrome|mcp.*chrome|chrome.*mcp/i.test(name)) tags.push('Chrome');
  if (/astra|codex/i.test(name) || /\bcodex(?:\.cmd|\.exe)?\s+(?:exec|resume|e)\b/i.test(String(command))) tags.push('Codex');
  preview.tools.push(tags);
  if (preview.tools.length > 20) preview.tools.shift();
  const item = language.tool(name, input);
  if (preview.run[0]?.kind !== item.kind) preview.run = [];
  preview.run.push(item);
  if (preview.run.length > 100) preview.run.shift();
  preview.latestContext = language.describe(preview.run);
}
function observePreview(preview, record) {
  if (!record || record.isSidechain || record.isCompactSummary) return;
  if (claudeRecords.ownerPrompt(record)) preview.run = [];
  // Claude Code's "No response requested." is not Claude's; an API error it writes is news for the card.
  if (claudeRecords.machineReply(record)) { if (record.isApiErrorMessage) recordText(preview, claudeRecords.note(record).text); return; }
  if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
    for (const item of record.message.content) {
      if (item.type === 'text' && text(item.text).trim()) recordText(preview, item.text);
      if (item.type === 'tool_use') recordTool(preview, text(item.name), item.input);
    }
  }
  const p = record.payload;
  if (record.type === 'event_msg' && p?.type === 'agent_message') recordText(preview, p.message);
  if (record.type !== 'response_item' || !p) return;
  if (p.type === 'message' && p.role === 'user') preview.run = [];
  if (p.type === 'message' && p.role === 'assistant') {
    const value = (p.content || []).filter(c => c.type === 'output_text').map(c => c.text).join(' ');
    if (value.trim()) recordText(preview, value);
  }
  if (['function_call','custom_tool_call','local_shell_call'].includes(p.type)) {
    let input = p.arguments || p.input || p.action?.command?.join(' ') || '';
    try { input = JSON.parse(input); } catch {}
    recordTool(preview, text(p.name) || 'shell', input);
  }
}
function previewSummary(preview) { return {latestContext:preview.latestContext, recentTools:[...new Set(preview.tools.flat())]}; }
module.exports = {createPreview, observePreview, previewSummary};
