#!/usr/bin/env node
// Census review (LIN-3629): the census at a commit and at the previous edition's commit, ranked by
// places x change, with the groups a review must rule on flagged. Reads committed git objects only.
// Usage: node census-review.mjs <repoDir> <commit> [previousCommit] [--areas path] [--include rx] [--exclude rx]
//        [--top 25] [--churn-days 90]   → JSON on stdout, summary on stderr
// One area guide is loaded once and used for both runs, so a map edit is not read as code moving.
// Without previousCommit this is the baseline: no statuses, nothing gone.
import { resolve } from 'node:path';
import { UsageError, churnByFile, compileScope, emitJson, loadAreas, loadCore, ownChurnByPattern, parseArgs, readCommit, runCli } from './code-shape-lib.mjs';
import { reviewCensus } from './census-review-core.mjs';

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), {
    '--areas': 'value', '--include': 'value', '--exclude': 'value', '--top': 'value', '--churn-days': 'value',
  });
  const [repoArg, commitArg, previousArg] = positional;
  if (!repoArg || !commitArg || positional.length > 3) {
    console.error('usage: node census-review.mjs <repoDir> <commit> [previousCommit] [--areas path] [--include rx] [--exclude rx] [--top 25] [--churn-days 90]');
    process.exit(2);
  }
  const top = Number(flags['--top'] ?? 25);
  const churnDays = Number(flags['--churn-days'] ?? 90);
  if (!Number.isInteger(top) || top < 0) throw new UsageError(`--top ${flags['--top']}: needs a whole number`);
  if (!Number.isFinite(churnDays) || churnDays <= 0) throw new UsageError(`--churn-days ${flags['--churn-days']}: needs a positive number`);
  const { runCensus } = await loadCore(new URL('./census-core.mjs', import.meta.url));
  const repo = resolve(repoArg);
  const { areaMap, source } = loadAreas(flags['--areas']);
  const inScope = compileScope({ include: flags['--include'], exclude: flags['--exclude'] });
  const census = (commit) => {
    const { sha, commitDate, files } = readCommit(repo, commit, inScope);
    const fileCommits = churnByFile(repo, sha, commitDate, churnDays, Object.keys(files));
    return runCensus({ files, areaMap, fileCommits, commit: sha, commitDate, churnDays, repo });
  };
  const head = census(commitArg);
  const previous = previousArg ? census(previousArg) : null;
  const review = reviewCensus({
    head, previous, top,
    ownChurn: (g, { pattern, ignoreCase }) => ownChurnByPattern(repo, head.commit, head.commitDate, churnDays, g.files, pattern, { ignoreCase }),
  });
  emitJson({
    commit: head.commit,
    commitDate: head.commitDate,
    previousCommit: previous?.commit ?? null,
    baseline: !previous,
    areaGuide: source,
    churnWindowDays: churnDays,
    top,
    ...review,
  });
  const c = review.counts;
  console.error(`census review ${head.commit.slice(0, 8)}${previous ? ` vs ${previous.commit.slice(0, 8)}` : ' (baseline)'}: ${c.groups} groups, ${c.mustRule} to rule on, ${c.table} tabled, ${c.gone} gone, ${c.unranked} unranked`);
});
