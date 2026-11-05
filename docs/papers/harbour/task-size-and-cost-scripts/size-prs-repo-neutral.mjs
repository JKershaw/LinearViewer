#!/usr/bin/env node
// size-prs-repo-neutral.mjs — LIN-4257. Landed and proving size for a repo whose paths
// the census's LinearViewer rule does not fit (simple-dispatcher: every PR reads 0/0
// under coherence-census.mjs). Uses the census's own PR enumeration (mergedPrs, first
// parent, same ticket attribution) and the repo-neutral path rule imported from
// scripts/delivery-paths.mjs. Prints one JSON row per merged PR. Read-only.
//
// Usage: REPO=<path to repo> node size-prs-repo-neutral.mjs [rev]
// Note: the census module reads REPO at import time, so REPO must be set in the env.

import { execFileSync } from 'node:child_process';
import { mergedPrs } from '../coherence-as-it-grows-scripts/coherence-census.mjs';
import { isTest, isDoc } from '../../../../scripts/delivery-paths.mjs';

const repo = process.env.REPO;
if (!repo) { console.error('REPO must be set'); process.exit(2); }
const rev = process.argv[2] || 'origin/main';
const git = (args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });

const out = [];
for (const r of mergedPrs(rev)) {
  const numstat = git(['diff', '--numstat', r.parents[0], r.sha]).trim();
  const row = { pr: r.pr, sha: r.sha.slice(0, 8), day: r.day, ticket: r.ticket,
    codeFiles: 0, codeAdded: 0, codeDeleted: 0, testFiles: 0, testAdded: 0, testDeleted: 0, docFiles: 0 };
  for (const l of numstat ? numstat.split('\n') : []) {
    const [a, d, p] = l.split('\t');
    if (!p) continue;
    const add = a === '-' ? 0 : Number(a), del = d === '-' ? 0 : Number(d);
    if (isTest(p)) { row.testFiles++; row.testAdded += add; row.testDeleted += del; }
    else if (isDoc(p)) { row.docFiles++; }
    else { row.codeFiles++; row.codeAdded += add; row.codeDeleted += del; }
  }
  out.push(row);
}
console.log(JSON.stringify(out));
