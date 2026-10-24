#!/usr/bin/env node
// Change coupling (LIN-3860): which areas keep landing in the same change, from local git history only.
// Usage: node cochange.mjs <repoDir> <commit> [--areas path] [--days 60]
//        → JSON on stdout, one-line summary on stderr. No acorn needed.
import { resolve } from 'node:path';
import { commitDateOf, compileGuide, emitJson, git, loadAreas, parseArgs, resolveCommit, runCli, UsageError } from './code-shape-lib.mjs';
import { buildReport, parseChangeLog, summariseCochange } from './cochange-core.mjs';

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), { '--areas': 'value', '--days': 'value' });
  const [repoArg, commitArg] = positional;
  if (!repoArg || !commitArg || positional.length > 2) {
    console.error('usage: node cochange.mjs <repoDir> <commit> [--areas path] [--days 60]');
    process.exit(2);
  }
  const daysText = flags['--days'] ?? '60';
  if (!/^[1-9]\d*$/.test(daysText)) throw new UsageError(`--days ${daysText}: needs a positive whole number`);
  const days = Number(daysText);
  const { areaMap } = loadAreas(flags['--areas']);
  // Census can fall back to top-level directories; here everything would be unmapped.
  if (!areaMap) throw new UsageError('no area guide: pass --areas <path>');
  const repo = resolve(repoArg);
  const sha = resolveCommit(repo, commitArg);
  const windowEnd = new Date(commitDateOf(repo, sha));
  const windowStart = new Date(windowEnd.getTime() - days * 86400e3);
  // --no-renames: a move would otherwise show only its new path and count in one area only.
  // --since/--until are inclusive, the window idiom of the lib's churnByFile.
  const log = git(repo, ['log', sha, '--first-parent', '--diff-merges=first-parent', '--name-only', '--no-renames', '--format=@%H',
    `--since=${windowStart.toISOString()}`, `--until=${windowEnd.toISOString()}`]);
  const shallow = git(repo, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  const report = buildReport({
    changes: parseChangeLog(log), guide: compileGuide(areaMap), commit: sha,
    windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), days, shallow,
  });
  emitJson(report);
  console.error(summariseCochange(report));
});
