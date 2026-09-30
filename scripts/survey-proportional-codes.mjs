// LIN-3166: assemble the paper's committed hand codes from the git-ignored coding outputs — finder-row changes (survey-check-2.md), the light group's named fixes, and what review caught on light changes it sent back.
// Usage: node scripts/survey-proportional-codes.mjs [--out docs/papers/harbour/proportional-process-backtest-codes.json]
// Inputs: data/survey-proportional/namedfix-codes.json and data/survey-proportional/catch-codes/batch-*.json, each written by an
// in-session subagent against the rubric embedded below (fixed before reading). Re-running with the same inputs gives the same file.
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'docs/papers/harbour/proportional-process-backtest-codes.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const dir = 'data/survey-proportional/catch-codes';
const catches = readdirSync(dir).filter((f) => /^batch-.*\.json$/.test(f)).sort().flatMap((f) => read(join(dir, f)));
catches.sort((a, b) => +a.id.slice(4) - +b.id.slice(4));
// Author adjustments to coder output, applied here so they stay visible: a review that found a fault AFTER the change merged
// did not keep it from shipping (the rubric's test), and the change is already counted as went-wrong through its named fix.
const ADJUST = [
  { id: 'LIN-2123', why: 'post-merge verification review; the no-op fix had shipped (counted as a blamed named fix, LIN-2268)', set: { realFault: false } },
  { id: 'LIN-2124', why: 'post-merge re-review; the stall had shipped (counted as a blamed named fix, LIN-2269)', set: { realFault: false } },
  { id: 'LIN-2252', why: 'post-merge review; the inert CSS fix had shipped (counted as an escape, LIN-2272)', set: { realFault: false } },
];
for (const a of ADJUST) for (const t of catches.filter((x) => x.id === a.id)) for (const f of t.findings) if (f.realFault) Object.assign(f, a.set, { adjusted: a.why });
const doc = {
  ticket: 'LIN-3166',
  about: 'Hand codes behind proportional-process-backtest.md. finderOnly: changes the scorecard counts as escaped only because a Bug names the ticket whose review FOUND an older fault (survey-check-2.md:309-312). namedFixes: every named fix-follow-up the scorecard counts on a change any classifier routes light, read against its evidence. reviewCatches: every light change a plan review or code review sent back, each send-back finding followed to what it changed.',
  method: 'One in-session subagent of the frontier tier coded the named fixes; four more coded the review catches, one batch each, from git-ignored digests (scripts/survey-proportional-digests.mjs) against the rubric below, fixed before reading. Not second-read.',
  finderOnly: { source: 'docs/papers/harbour/survey-check-2.md@b36e5d3f:309-312', ids: ['LIN-1815', 'LIN-2037', 'LIN-2291', 'LIN-2331', 'LIN-2333', 'LIN-2351', 'LIN-2354', 'LIN-2384'] },
  namedFixRubric: 'blames: the later ticket or commit says the change introduced a fault, or its fix was wrong, inert or incomplete, and the fix repairs code the change wrote or should have written. unclear: same code, change mentioned, fault not clearly the change\'s. mention: the change is cited only as context or history.',
  namedFixes: read('data/survey-proportional/namedfix-codes.json'),
  catchRubric: readFileSync('data/survey-proportional/catch-rubric.md', 'utf8'),
  adjustments: ADJUST,
  reviewCatches: catches,
};
writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
console.log(`named fixes ${doc.namedFixes.length}; review-catch tickets ${catches.length}, findings ${catches.reduce((a, t) => a + t.findings.length, 0)}, real faults ${catches.reduce((a, t) => a + t.findings.filter((f) => f.realFault).length, 0)}`);
