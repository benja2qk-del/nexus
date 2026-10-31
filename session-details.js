'use strict';
// Preserve bounded, recorded edit evidence; never invent a working-tree diff.
function toolDetail(name, input) {
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
