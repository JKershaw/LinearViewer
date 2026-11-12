#!/usr/bin/env node
// size-golden-glob.mjs — LIN-4427 (v2). The golden lines of the SENSITIVITY size, under the rule the ask names: a test file
// whose basename matches the glob `*.golden.*`. scripts/delivery-paths.mjs isGolden (the census's golden rule, LIN-4426)
// is broader (any test path containing "golden") and is not used here; the difference is stated in the paper's Method.
// Prints one JSON row per merged PR, the same PR enumeration as size-prs-repo-neutral.mjs. Read-only.
//
// Usage: REPO=<path to repo> node size-golden-glob.mjs <sha> <repo-label>
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mergedPrs } from '../coherence-as-it-grows-scripts/coherence-census.mjs';
import { isTest } from '../../../../scripts/delivery-paths.mjs';

const repo = process.env.REPO;
if (!repo) { console.error('REPO must be set'); process.exit(2); }
const rev = process.argv[2];
const label = process.argv[3];
if (!rev || !label) { console.error('usage: REPO=<path> size-golden-glob.mjs <sha> <repo-label>'); process.exit(2); }
const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
// The glob `*.golden.*` on the basename: the basename contains ".golden." (a leading `*` may be empty).
const isStarGolden = (p) => /\.golden\./.test(path.posix.basename(p));

const out = [];
for (const r of mergedPrs(rev)) {
  const numstat = git(['diff', '--numstat', r.parents[0], r.sha]).trim();
  const row = { repo: label, pr: r.pr, ticket: r.ticket, goldenGlobAdded: 0, goldenGlobDeleted: 0 };
  for (const l of numstat ? numstat.split('\n') : []) {
    const [a, d, p] = l.split('\t');
    if (!p || !isTest(p) || !isStarGolden(p)) continue;
    row.goldenGlobAdded += a === '-' ? 0 : Number(a);
    row.goldenGlobDeleted += d === '-' ? 0 : Number(d);
  }
  out.push(row);
}
console.log(JSON.stringify(out));
