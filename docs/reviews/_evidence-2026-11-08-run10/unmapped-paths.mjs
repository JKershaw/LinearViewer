#!/usr/bin/env node
// LIN-4298 (run 8): the exact set of files cochange.mjs counts as unmapped for one commit and window, one line per path.
// Uses the tool's own modules and its own git log call (first-parent, no renames, same window), so the output is the
// set behind the `unmappedFiles` count in cochange-code-*.json, not a re-derivation of it.
// usage (repo root): node docs/reviews/_evidence-2026-11-05-run8/unmapped-paths.mjs . <commit> <guide.json> [days=60] > out.txt
import { resolve } from 'node:path';
import { compileGuide, loadAreas, commitDateOf, git } from '../../../scripts/code-shape/code-shape-lib.mjs';
import { parseChangeLog } from '../../../scripts/code-shape/cochange-core.mjs';

const [, , repoArg, sha, guidePath, days = '60'] = process.argv;
const repo = resolve(repoArg);
const guide = compileGuide(loadAreas(guidePath).areaMap);
const windowEnd = new Date(commitDateOf(repo, sha));
const windowStart = new Date(windowEnd.getTime() - Number(days) * 86400e3);
const log = git(repo, ['log', sha, '--first-parent', '--diff-merges=first-parent', '--name-only', '--no-renames', '--format=@%H',
  `--since=${windowStart.toISOString()}`, `--until=${windowEnd.toISOString()}`]);
const claimed = (p) => guide.find((a) => a.rx.some((r) => r.test(p)))?.name ?? null;
const unmapped = new Set();
for (const { files } of parseChangeLog(log)) for (const f of files) if (claimed(f) === null) unmapped.add(f);
process.stdout.write([...unmapped].sort().join('\n') + '\n');
