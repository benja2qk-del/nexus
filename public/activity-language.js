'use strict';
// Shared by cached previews, recap parsing, Wall and collapsed Chat disclosures.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NexusActivity = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const base = value => String(value || '').replace(/\\/g, '/').replace(/\/$/, '').split('/').pop();
  function readable(value, limit = 1200) {
    return String(value || '')
      .replace(/^ASTRA RESULT:\s*[0-9a-f,\s]+\|\s*/i, '')
      .replace(/```[\s\S]*?(?:```|$)/g, '[Code in Feed]')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"<>|`]*?(?=\s+(?:and|then|to|is|was|with|for|in)\b|[,;]|[.!?](?:\s|$)|["<>|`\r\n]|$)/g, p => base(p.trim()))
      .replace(/\/(?:Users|home|tmp|var|mnt)\/[^\s"`<>]+/g, p => base(p))
      .replace(/\b(?:mcp__[\w-]+|functions\.[\w]+)\b/g, 'tool activity')
      .replace(/\{[^\n]*\}/g, '[Details in Feed]')
      .replace(/^\s*[>❯]\s*/gm, '')
      .replace(/^[ \t]*#{1,6}\s+/gm, '').replace(/[*`_]/g, '')
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
  }
  function sentence(value, limit = 240) {
    const text = readable(value, 2000).replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '').replace(/\s+/g, ' ').trim();
    const parts = text.match(/.*?[.!?](?=\s|$)|.+$/g) || [];
    return parts.slice(0, 2).map(p => p.trim()).join(' ').slice(0, limit);
  }
  function inputObject(input) {
    if (typeof input !== 'string') return input || {};
    try { return JSON.parse(input); } catch { return { command: input }; }
  }
  function tool(name, input) {
    const i = inputObject(input), n = String(name || ''), command = String(i.cmd || i.command || i.code || '');
    const files = [i.file_path || i.path || i.filename].filter(Boolean);
    if (/apply_patch/i.test(n) || /\btools\.apply_patch\s*\(/.test(command)) {
      for (const m of String(i.patch || i.input || command).matchAll(/(?:^|\n|\\n)\*\*\* (?:Add|Update|Delete) File:\s*([^\r\n]+?)(?=\\r?\\n|\\n|\r?\n|$)/g)) files.push(m[1].replace(/\\\\/g, '\\'));
    }
    const urls = [i.url, ...(command.match(/https?:\/\/[^\s"'`<>\\)]+/g) || [])].filter(Boolean);
    const sites = [...new Set(urls.map(u => { try { return new URL(u).hostname; } catch { return ''; } }).filter(Boolean))];
    const chrome = /claude.in.chrome|mcp.*chrome|chrome.*mcp/i.test(n);
    let kind = /astra/i.test(n) || /\bcodex(?:\.cmd|\.exe)?\s+(?:exec|resume|e)\b/i.test(command) ? 'astra'
      : /(?:^|[_.])(?:Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/i.test(n) ? 'edit'
      : /(?:bash|shell|exec_command|run_command|powershell)/i.test(n) ? 'command'
      : chrome || /(?:browse|navigate|web.*(?:run|search|fetch)|WebFetch|WebSearch)/i.test(n) ? 'browse'
      : /(?:^|[_.])(?:Read|read_file|view_image)$/i.test(n) ? 'read'
      : /(?:grep|glob|search|list_dir)/i.test(n) ? 'search'
      : /(?:todo|taskupdate|taskcreate|update_plan)/i.test(n) ? 'plan'
      : /(?:spawn_agent|Task$|Agent$)/i.test(n) ? 'delegate' : 'other';
    // Codex orchestration wrappers contain executable source. Inspect names only;
    // never evaluate code or retain file contents in a humanized line.
    if (kind === 'other' && /(?:functions\.)?exec$/.test(n)) {
      if (/tools\.apply_patch\s*\(/.test(command)) kind = 'edit';
      else if (/tools\.exec_command\s*\(/.test(command)) kind = 'command';
      else if (/tools\.(?:web|mcp.*chrome)/.test(command)) kind = 'browse';
    }
    return { kind, files: [...new Set(files.map(String))], sites, chrome, note: typeof i.description === 'string' ? i.description.slice(0, 160) : '' };
  }
  function describe(items) {
    if (!items.length) return '';
    const kind = items[0].kind, count = items.length;
    const files = [...new Set(items.flatMap(i => i.files || []))], sites = [...new Set(items.flatMap(i => i.sites || []))];
    if (kind === 'edit') {
      if (files.length === 1) return 'Edited ' + readable(base(files[0]), 80);
      const parents = [...new Set(files.map(f => f.replace(/\\/g, '/').split('/').slice(-2, -1)[0]).filter(Boolean))];
      return files.length ? `Edited ${files.length} files${parents.length === 1 ? ' in ' + readable(parents[0], 40) + '/' : ''}` : `Made ${count} file edit${count === 1 ? '' : 's'}`;
    }
    if (kind === 'command') return `Ran ${count} shell command${count === 1 ? '' : 's'}`;
    if (kind === 'browse') return (sites.length ? 'Browsed ' + sites.slice(0, 2).join(', ') : 'Used the browser') + (items.some(i => i.chrome) ? ' in Chrome' : '');
    if (kind === 'astra') return count === 1 ? 'Started an Astra run' : `Started ${count} Astra runs`;
    if (kind === 'read') return files.length === 1 ? 'Read ' + readable(base(files[0]), 80) : `Read ${count} file${count === 1 ? '' : 's'}`;
    if (kind === 'search') return 'Searched the project';
    if (kind === 'plan') return 'Updated the work plan';
    if (kind === 'delegate') return 'Assigned work to an agent';
    return items[0]?.summary ? readable(items[0].summary,180) : 'Continued work with a tool';
  }
  function groups(items) {
    const runs = [];
    for (const item of items) {
      const t = item.kind ? item : tool(item.name, item.input ?? item.text);
      if (runs.at(-1)?.[0].kind === t.kind) runs.at(-1).push(t); else runs.push([t]);
    }
    return runs.map(describe);
  }
  // One line saying what a single tool call does: the agent's own description, else its command.
  function step(event) {
    const item = event.human || tool(event.name, event.input || event.text);
    if (item.note) return readable(item.note, 160);
    const line = item.kind === 'command' && String(event.text || '').split(/\r?\n/).find(l => l.trim());
    return line ? readable(line, 140) || describe([item]) : describe([item]);
  }
  function briefTitle(value) {
    const lines=String(value||'').split(/\r?\n/).map(l=>l.replace(/^#+\s*/, '').trim()).filter(Boolean);
    const commission=lines.map(l=>/\bcommission\s+["\u201c]([^"\u201d]+)["\u201d]/i.exec(l)).find(Boolean);
    if(commission)return {name:commission[1],summary:commission[1]};
    const meaningful=lines.map(l=>l.replace(/^You are (?:GPT\s+)?(?:Astra|Codex|Claude)[^.\n]*\.\s*/i,'')).find(l=>l&&!/^you are\b|^(?:role|model|system|owner|rails|work in)\s*:/i.test(l));
    return {name:'',summary:sentence(meaningful||'',300)};
  }
  function subtitle(s) {
    const aiTitle = s.aiTitle && s.aiTitle !== s.title ? s.aiTitle : '';
    const source=s.commission || s.briefSummary || aiTitle || s.insights?.objective?.request || s.firstPrompt || s.insights?.objective?.title || s.title;
    const text = readable(briefTitle(source).summary || briefTitle(s.title).summary || (s.kind==='astra'?'Astra task':'Agent task'), 500)
      .replace(/^(?:(?:please|can you|could you|help me|i (?:want|wanna|would like|need)(?: you)?(?: to)?)\s+)+/i, '')
      .replace(/\s+/g, ' ').replace(/^\w/, c => c.toUpperCase());
    const words = text.split(' ');
    return words.slice(0, 12).join(' ') + (words.length > 12 ? '\u2026' : '');
  }
  function current(event) {
    if(!event)return '';
    const item=event.human||tool(event.name,event.input||event.text), command=event.detail?.command||inputObject(event.input||event.text).command||'';
    if(item.kind==='command')return /\b(test|pytest|jest|vitest|check|typecheck)\b/i.test(command)?'running the tests':'running a command';
    if(item.kind==='edit'){const count=item.files?.length||1;return count===1?'editing a file':`editing ${count} files`;}
    return {browse:'checking sources',read:'reading the project',search:'searching the project',plan:'updating the plan',delegate:'checking with another agent',astra:'working with Astra',other:'working on your request'}[item.kind]||'working on your request';
  }
  return { base, readable, sentence, tool, describe, groups, step, subtitle, current, briefTitle };
});
