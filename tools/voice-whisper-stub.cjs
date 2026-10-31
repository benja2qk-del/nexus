'use strict';
// A real executable boundary (node), without loading a model.
const fs = require('fs'), path = require('path');
const root = process.argv[2], args = process.argv.slice(3);
const output = args[args.indexOf('-of') + 1];
const mode = fs.readFileSync(path.join(root, 'utterance.txt'), 'utf8');
if (mode === 'fail') process.exit(1);
setTimeout(() => { fs.writeFileSync(output + '.txt', mode === 'slow' ? 'Late reply' : mode); }, mode === 'slow' ? 10000 : 800);
