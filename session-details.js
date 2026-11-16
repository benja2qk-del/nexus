'use strict';
// Preserve bounded, recorded edit evidence; never invent a working-tree diff.
// Codex runs its tools through one 'exec' call whose input is JavaScript source: read the string arguments it
// passes to tools.apply_patch and tools.exec_command, never run it.
function literal(text) {
  if (text[0] === '"') { const m = /^"(?:[^"\\\n]|\\.)*"/.exec(text); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }
  if (text[0] === '`') { const m = /^`((?:[^`\\$]|\\.|\$(?!\{))*)`/.exec(text); return m ? m[1].replace(/\\([\s\S])/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] || c) : null; }
  return null;
}
function unwrapExec(source) {
  const patches = [], commands = [];
  for (const m of source.matchAll(/tools\.apply_patch\s*\(\s*/g)) { const v = literal(source.slice(m.index + m[0].length)); if (v) patches.push(v); }
  for (const m of source.matchAll(/tools\.exec_command\s*\(\s*\{\s*cmd\s*:\s*/g)) { const v = literal(source.slice(m.index + m[0].length)); if (v) commands.push(v); }
  return { patch: patches.join('\n'), command: commands.join('\n') };
}
function toolDetail(name, input) {
  if (/(?:^|\.)exec$/.test(name) && typeof input === 'string') {
    const { patch, command } = unwrapExec(input), edits = patch ? toolDetail('apply_patch', patch) : undefined;
    return edits || command ? { files: edits ? edits.files : [], command: command ? command.slice(0, 4000) : undefined } : undefined;
  }
  const value = input || {}, files = [];
  if (/^(Edit|Write|MultiEdit)$/.test(name) && value.file_path) {
    for (const edit of (name === 'MultiEdit' ? value.edits || [] : [value])) {
      const before = String(edit.old_string || ''), after = String(edit.new_string ?? edit.content ?? '');
      const removed = before ? before.split('\n') : [], added = after ? after.split('\n') : [];
      files.push({path:String(value.file_path),add:added.length,del:removed.length,diff:[`@@ ${value.file_path}`,...removed.map(l=>'-'+l),...added.map(l=>'+'+l)].slice(0,400),partial:removed.length+added.length>399});
    }
  }
  const patch = typeof input === 'string' ? input : value.patch || value.input || '';
  if (/apply_patch/.test(name) && typeof patch === 'string') {
    let file;
    for(const line of patch.split('\n')) {
      const match=/^\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(line);
      if(match){file={path:match[1],add:0,del:0,diff:['@@ '+match[1]]};files.push(file);continue;}
      if(!file || line.startsWith('***'))continue;
      if(line.startsWith('+'))file.add++;if(line.startsWith('-'))file.del++;
      if(file.diff.length<400)file.diff.push(line);else file.partial=true;
    }
  }
  const command = /bash|shell|exec_command|run_command/i.test(name) ? value.command || value.cmd || (typeof input==='string'?input:'') : '';
  return files.length || command ? {files,command:command?String(command).slice(0,4000):undefined} : undefined;
}
module.exports={toolDetail};
