#!/usr/bin/env node
// Breaks down the files that cochange.mjs leaves unmapped, by top-level directory (LIN-4152 run 4).
// Usage (from the repo root): node docs/reviews/_evidence-2026-11-03/unmapped-by-topdir.mjs . <commit> <guide> [--days 60]
// Reads committed git objects only. Same window and git log as scripts/code-shape/cochange.mjs, so the
// distinct-unmapped total must equal that tool's `unmappedFiles` for the same commit, guide and window.
import { resolve } from 'node:path';
import { commitDateOf, compileGuide, git, resolveCommit } from '../../../scripts/code-shape/code-shape-lib.mjs';
import { parseChangeLog } from '../../../scripts/code-shape/cochange-core.mjs';
import { readFileSync } from 'node:fs';

const [repoArg, commitArg, guideArg, ...rest] = process.argv.slice(2);
const daysIdx = rest.indexOf('--days');
const days = daysIdx >= 0 ? Number(rest[daysIdx + 1]) : 60;
if (!repoArg || !commitArg || !guideArg) {
  console.error('usage: node unmapped-by-topdir.mjs <repoDir> <commit> <guide.json> [--days 60]');
  process.exit(2);
}
const repo = resolve(repoArg);
const sha = resolveCommit(repo, commitArg);
const guide = compileGuide(JSON.parse(readFileSync(guideArg, 'utf8')));
const windowEnd = new Date(commitDateOf(repo, sha));
const windowStart = new Date(windowEnd.getTime() - days * 86400e3);
const log = git(repo, ['log', sha, '--first-parent', '--diff-merges=first-parent', '--name-only', '--no-renames', '--format=@%H',
  `--since=${windowStart.toISOString()}`, `--until=${windowEnd.toISOString()}`]);
const changes = parseChangeLog(log);

const claimed = (p) => guide.some((a) => a.rx.some((r) => r.test(p)));
const unmapped = new Set();
for (const { files } of changes) for (const f of files) if (!claimed(f)) unmapped.add(f);

// Top-level directory, or (root) for a file at the repo root.
const topDir = (p) => (p.includes('/') ? p.split('/')[0] : '(root)');
const byTop = {};
for (const p of unmapped) byTop[topDir(p)] = (byTop[topDir(p)] ?? 0) + 1;
const byTopSorted = Object.fromEntries(Object.entries(byTop).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));

// docs/ split one level further, since docs/reviews is most of it.
const docsSub = {};
for (const p of unmapped) if (p.startsWith('docs/')) {
  const parts = p.split('/');
  const key = parts.length > 2 ? `docs/${parts[1]}` : 'docs (top-level file)';
  docsSub[key] = (docsSub[key] ?? 0) + 1;
}

const out = {
  commit: sha,
  guide: guideArg,
  windowStart: windowStart.toISOString(),
  windowEnd: windowEnd.toISOString(),
  days,
  changes: changes.length,
  distinctUnmappedFiles: unmapped.size,
  unmappedByTopDir: byTopSorted,
  unmappedDocsBySubdir: Object.fromEntries(Object.entries(docsSub).sort((a, b) => b[1] - a[1])),
  note: 'Distinct paths across the window that no area in the guide claims. Compare distinctUnmappedFiles with cochange.mjs unmappedFiles for the same commit, guide and days.',
};
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
