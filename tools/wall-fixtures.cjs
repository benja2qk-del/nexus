'use strict';
const fs = require('fs'), path = require('path');
module.exports = function fixtures(root) {
  const claude = path.join(root, 'claude'), codex = path.join(root, 'codex');
  const projects = path.join(claude, 'projects', 'wall-fixture'), live = path.join(claude, 'sessions'), rollouts = path.join(codex, 'sessions');
  for (const d of [projects, live, rollouts]) fs.mkdirSync(d, { recursive: true });
  const now = Date.now(), timestamp = new Date(now - 9 * 60000).toISOString(), cwd = 'C:\\Projects\\BEACON';
  const user = text => ({ type: 'user', cwd, timestamp, message: { role: 'user', content: text } });
  const ai = content => ({ type: 'assistant', timestamp: new Date(now - 60000).toISOString(), message: { role: 'assistant', content } });
  const tool = (name, input, id) => ai([{ type: 'tool_use', name, input, id }]);
  const result = (id, content = 'Success', is_error = false) => user([{ type: 'tool_result', tool_use_id: id, content, is_error }]);
  const text = value => ai([{ type: 'text', text: value }]);
  const write = (id, title, objective, activity, status, sparse = false) => {
    const first = [user(objective), { type: 'custom-title', customTitle: title }].map(JSON.stringify).join('\n') + '\n';
    const tail = activity.map(JSON.stringify).join('\n') + '\n', file = path.join(projects, id + '.jsonl');
    if (sparse) {
      const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 800 * 1024 * 1024); fs.writeSync(fd, first, 0);
      fs.writeSync(fd, '\n' + tail, 800 * 1024 * 1024 - Buffer.byteLength('\n' + tail)); fs.closeSync(fd);
    } else fs.writeFileSync(file, first + tail);
    if (status) fs.writeFileSync(path.join(live, id + '.json'), JSON.stringify({ sessionId: id, pid: process.pid, cwd, name: title, nameSource: 'user', status, statusUpdatedAt: now - (status === 'waiting' ? 0 : 30000), ...(id === 'wall-steam' ? { bridgeSessionId: 'fixture-only' } : {}) }));
    return file;
  };
  const steam = write('wall-steam', 'Steam Cloud publishing', 'Prepare the Steam store page and Cloud publishing for BEACON.', [
    user('Check Steam Cloud and the release notes, then tell me what needs my approval.'),
    text('I will check the public configuration and release notes.'),
    tool('mcp__claude-in-chrome__navigate', { url: 'https://partner.steamgames.com/apps/cloud' }, 'chrome'), result('chrome'),
    tool('Edit', { file_path: 'C:\\fixture\\BEACON\\release-notes.md', new_string: 'FILE_CONTENT_NOT_FOR_SUMMARY' }, 'edit'), result('edit'),
    tool('Bash', { command: 'npm test' }, 'test'), result('test', 'All checks passed.'),
    tool('Bash', { command: 'codex exec "Review the release notes"' }, 'astra'), result('astra'),
    text('**Steam Cloud is ready.**\n\n- Saved the public configuration.\n- Verified Windows and macOS paths.\n- Updated the release notes.\n\nPublishing needs your approval.')
  ], 'waiting');
  write('wall-edits', 'Phone layout polish', 'Make the Wall and recap easier to read on phones.', [user('Make the cards compact and show the latest work.'), text('I found the spacing rules.'), tool('Edit', { file_path: 'C:\\fixture\\public\\app.js' }, 'e1'), result('e1'), tool('Write', { file_path: 'C:\\fixture\\public\\wall.css' }, 'e2'), result('e2')], 'busy');
  write('wall-shell', 'Release validation', 'Check the BEACON release build and installation flow.', [user('Run the release checks.'), ...[1, 2, 3].flatMap(n => [tool('Bash', { command: 'npm test' }, 's' + n), result('s' + n)])], 'busy');
  write('wall-browser', 'Store page review', 'Review the Steam store page and publishing settings.', [user('Check the public store page.'), tool('mcp__claude-in-chrome__navigate', { tabId: 42, url: 'https://partner.steamgames.com/apps/' }, 'b1')]);
  write('wall-long', 'Long release history', 'Audit a long publishing session and its latest checks.', [user('Summarize the latest release validation after the long history.'), tool('Bash', { command: 'npm test' }, 'l1'), result('l1', 'Error: fixture test failure', true), text('The release checks found one failing test. The configuration is saved; the test needs review.')], null, true);
  write('wall-cap', 'Extended background work', 'Review a long operation whose latest request is outside the excerpt.', [text('The background verification is still progressing. The available excerpt covers only recent work.')], null, true);
  const rollout = [
    { type: 'session_meta', timestamp, payload: { id: 'wall-astra', cwd, timestamp } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Improve phone readability for the BEACON release dashboard.' }] } },
    { type: 'event_msg', timestamp, payload: { type: 'task_started' } },
    { type: 'response_item', timestamp, payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'a1', input: '*** Begin Patch\n*** Update File: public/phoneux.css\n+FILE_CONTENT_NOT_FOR_SUMMARY\n*** End Patch' } },
    { type: 'response_item', timestamp, payload: { type: 'custom_tool_call_output', call_id: 'a1', output: 'Success' } },
    { type: 'response_item', timestamp, payload: { type: 'function_call', name: 'exec_command', call_id: 'a2', arguments: JSON.stringify({ cmd: 'node --check public/app.js' }) } },
    { type: 'response_item', timestamp, payload: { type: 'function_call_output', call_id: 'a2', output: 'Process exited with code 0' } },
    { type: 'event_msg', timestamp, payload: { type: 'agent_message', message: 'Improved the phone layout and verified syntax. Ready for visual review.' } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Improved the phone layout and verified syntax. Ready for visual review.' }] } },
    { type: 'event_msg', timestamp, payload: { type: 'task_complete' } }
  ];
  fs.writeFileSync(path.join(rollouts, 'wall-astra.jsonl'), rollout.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(codex, 'session_index.jsonl'), JSON.stringify({ id: 'wall-astra', thread_name: 'Astra phone usability' }) + '\n');
  return { claude, codex, steam };
};
