// Replica of test/feedback.test.js:604-622's scan (the producer-table coverage guard), run over a
// given tree, to show what it OBSERVES rather than whether it passes.
const fs = require('fs'), path = require('path');
const root = process.argv[2];
const producerFiles = ['hook.js', 'opencode-runner.js', 'dispatcher.js', 'reapers.js', 'admission.js', 'abort.js', 'followup.js', 'executors.js'];
const headRe = /[`'"](\[(?:done|complete|failed|aborted|blocked|pending)\])/gi;
const observed = [];
for (const f of producerFiles) { const p = fs.existsSync(path.join(root, f)) ? path.join(root, f) : path.join(process.argv[3], f); const t = fs.readFileSync(p, 'utf8'); if (headRe.test(t)) observed.push(f); headRe.lastIndex = 0; }
console.log(`${path.basename(root)}: guard observes ${observed.length}/8 producer files -> ${observed.join(', ') || '(none: the assertion compares an empty set and passes vacuously)'}`);
