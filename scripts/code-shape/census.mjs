#!/usr/bin/env node
// Census of decisions held in many places (LIN-3628). Reads one commit from the git object store.
// Usage: node census.mjs <repoDir> <commit> [--out file.json] [--areas path] [--include rx] [--exclude rx]
//        [--churn-days 90] [--redact rx]   → JSON on stdout (or --out), summary on stderr
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { churnByFile, compileScope, loadAreas, loadCore, parseArgs, readCommit, runCli } from './code-shape-lib.mjs';

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), {
    '--out': 'value', '--areas': 'value', '--include': 'value', '--exclude': 'value', '--churn-days': 'value', '--redact': 'value',
  });
  const [repoArg, commitArg] = positional;
  if (!repoArg || !commitArg) {
    console.error('usage: node census.mjs <repoDir> <commit> [--out file.json] [--areas path] [--include rx] [--exclude rx] [--churn-days 90] [--redact rx]');
    process.exit(2);
  }
  const { runCensus, serialiseCensus, summariseCensus } = await loadCore(new URL('./census-core.mjs', import.meta.url));
  const repo = resolve(repoArg);
  const churnDays = Number(flags['--churn-days'] ?? 90);
  const { areaMap } = loadAreas(flags['--areas']);
  const { sha, commitDate, files } = readCommit(repo, commitArg, compileScope({ include: flags['--include'], exclude: flags['--exclude'] }));
  const fileCommits = churnByFile(repo, sha, commitDate, churnDays, Object.keys(files));
  const report = runCensus({ files, areaMap, fileCommits, commit: sha, commitDate, churnDays, repo });
  const json = serialiseCensus(report, flags['--redact']);
  if (flags['--out']) writeFileSync(flags['--out'], json);
  else process.stdout.write(json);
  console.error(summariseCensus(report));
});
