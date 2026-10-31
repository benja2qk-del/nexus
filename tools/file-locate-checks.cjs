// Unit checks for turning a dropped file into its path on this PC. Uses a TEMP home only.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { locate, roots, validRequest } = require('../file-locate');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-locate-test-'));
const put = (rel, bytes, mtime) => { const file = path.join(home, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes, 1)); if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000); return file; };
const noIndex = async () => [];
const opts = extra => ({ home, index: noIndex, ...extra });
const report = [];
const check = async (label, fn) => { await fn(); report.push('PASS ' + label); console.log(report.at(-1)); };

(async () => {
  try {
    const when = Date.parse('2026-10-27T10:36:09Z');
    const zip = put('Downloads/2003222837_Sell_Out_Colombia_L24M_Venus.csv.zip', 5000, when);
    put('Documents/2003222837_Sell_Out_Colombia_L24M_Venus.csv.zip', 4000, when);
    const project = path.join(home, 'Work', 'Store placement');
    const brief = put('Work/Store placement/brief notes.md', 300, when);
    const deep = put('Work/archive/2025/q3/deep file.txt', 77, when);
    put('node_modules/pkg/hidden.txt', 10);
    fs.mkdirSync(path.join(home, 'Work', 'Store placement', 'data'), { recursive: true });
    put('OneDrive - Company/Documents/shared deck.pptx', 900, when);

    await check('the usual folders are searched first: a Downloads zip is found by name and size', async () => {
      const r = await locate({ name: path.basename(zip), size: 5000, lastModified: when }, opts());
      assert.equal(r.path, zip); assert.equal(r.how, 'folder');
    });
    await check('a same-name file with a different size is not mistaken for the dropped one', async () => {
      const r = await locate({ name: path.basename(zip), size: 4000, lastModified: when }, opts());
      assert.equal(r.path, path.join(home, 'Documents', path.basename(zip)));
    });
    await check('the session folder is a root, before Downloads', async () => {
      assert.equal(roots(project, home)[0], project);
      const r = await locate({ name: 'brief notes.md', size: 300, lastModified: when, cwd: project }, opts());
      assert.equal(r.path, brief); assert.equal(r.how, 'folder');
    });
    await check('OneDrive folders (including company ones) are searched', async () => {
      const r = await locate({ name: 'shared deck.pptx', size: 900, lastModified: when }, opts());
      assert.equal(r.path, path.join(home, 'OneDrive - Company', 'Documents', 'shared deck.pptx'));
    });
    await check('the Windows Search index answers before the walk, and its hits are verified on disk', async () => {
      const elsewhere = put('Somewhere/else/indexed.bin', 64, when);
      const r = await locate({ name: 'indexed.bin', size: 64, lastModified: when }, opts({ index: async name => [path.join(home, 'gone', name), elsewhere] }));
      assert.equal(r.path, elsewhere); assert.equal(r.how, 'index');
    });
    await check('a bounded walk finds deeper files and skips node_modules', async () => {
      const r = await locate({ name: 'deep file.txt', size: 77, lastModified: when }, opts());
      assert.equal(r.path, deep); assert.equal(r.how, 'scan');
      assert.equal((await locate({ name: 'hidden.txt', size: 10 }, opts())).path, null);
    });
    await check('the modified time breaks ties between copies with the same size', async () => {
      const older = put('Desktop/copy.txt', 12, when - 86400000), newer = put('Downloads/copy.txt', 12, when);
      assert.equal((await locate({ name: 'copy.txt', size: 12, lastModified: when }, opts())).path, newer);
      assert.equal((await locate({ name: 'copy.txt', size: 12, lastModified: when - 86400000 }, opts())).path, older);
    });
    await check('dropped folders match directories, not files', async () => {
      const r = await locate({ name: 'data', dir: true, cwd: project }, opts());
      assert.equal(r.path, path.join(project, 'data'));
    });
    await check('an unknown file reports no path instead of guessing', async () => {
      assert.deepEqual(await locate({ name: 'never-existed.zip', size: 1 }, opts({ scanMs: 300 })), { path: null });
    });
    await check('names with separators or traversal are refused', async () => {
      for (const name of ['..', '.', '../secret.txt', 'C:\\x.txt', 'a/b', '', 'x'.repeat(300)]) assert.throws(() => validRequest({ name }));
      assert.equal(validRequest({ name: 'ok.txt', cwd: 'relative\\dir' }).cwd, '');
    });
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'file-locate-checks.txt'), report.join('\n') + '\n');
  } finally {
    const resolved = fs.realpathSync(home);
    if (path.basename(resolved).startsWith('nexus-locate-test-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
