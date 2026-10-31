// Claude Code status line: saves the usage data Claude Code passes in (for NEXUS) and prints a short line.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

let raw = '';
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let d = {};
  try { d = JSON.parse(raw); } catch { }
  const out = path.join(os.homedir(), '.claude', 'nexus-usage.json');
  try {
    const tmp = out + '.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), data: d }));
    fs.renameSync(tmp, out);
  } catch { }
  const parts = [];
  if (d.model && d.model.display_name) parts.push(d.model.display_name);
  const rl = d.rate_limits || {};
  const pct = w => w && (w.used_percentage ?? w.utilization ?? w.used_percent);
  if (pct(rl.five_hour) != null) parts.push('5h ' + Math.round(pct(rl.five_hour)) + '%');
  if (pct(rl.seven_day) != null) parts.push('week ' + Math.round(pct(rl.seven_day)) + '%');
  const cw = d.context_window;
  if (cw && cw.used_percentage != null) parts.push('ctx ' + Math.round(cw.used_percentage) + '%');
  process.stdout.write(parts.join(' · '));
});
