'use strict';
// Loaded only by the private fixture server. No CLI process is launched.
const { EventEmitter } = require('events');
const fs = require('fs');
const recap = require('../recap');
recap.summarize = recap.createSummarizer((exe, args) => {
  if (args[args.indexOf('--model') + 1] !== 'haiku') throw Error('Unexpected model');
  fs.appendFileSync(process.env.NEXUS_WALL_STUB_LOG, 'stub call\n');
  const p = new EventEmitter(); p.stdin = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {};
  p.stdin.end = digest => {
    if (digest.length > 12000 || digest.includes('FILE_CONTENT_NOT_FOR_SUMMARY')) throw Error('Unsafe recap digest');
    setTimeout(() => {
      p.stdout.emit('data', JSON.stringify({ result: JSON.stringify({ bullets: ['Saved the public Steam Cloud configuration.', 'Updated the release notes and checked the build.', 'Completed the recorded validation steps.'], next: 'Approve publishing when you are ready.' }), total_cost_usd: .0012 }));
      p.emit('close', 0);
    }, 350);
  };
  return p;
});
