#!/usr/bin/env node
// Code-shape facts for every in-scope file of one commit (LIN-3628). Reads git objects only.
// Usage: node shape.mjs <repoDir> <commit> [--areas path] [--include rx] [--exclude rx] [--functions]
//   → JSON on stdout, one summary line on stderr. --functions keeps per-function rows (large).
import { resolve } from 'node:path';
import { compileScope, emitJson, loadAreas, loadCore, parseArgs, readCommit, runCli } from './code-shape-lib.mjs';

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), { '--areas': 'value', '--include': 'value', '--exclude': 'value', '--functions': 'bool' });
  const [repoArg, commitArg] = positional;
  if (!repoArg || !commitArg) {
    console.error('usage: node shape.mjs <repoDir> <commit> [--areas path] [--include rx] [--exclude rx] [--functions]');
    process.exit(2);
  }
  const { measureShape } = await loadCore(new URL('./shape-report.mjs', import.meta.url));
  const { areaMap, source } = loadAreas(flags['--areas']);
  const { sha, files } = readCommit(resolve(repoArg), commitArg, compileScope({ include: flags['--include'], exclude: flags['--exclude'] }));
  const report = measureShape({ files, areaMap, detail: Boolean(flags['--functions']) });
  emitJson({ commit: sha, areaMapSource: source, ...report });
  console.error(`shape ${sha.slice(0, 8)}: ${report.scope.parsed}/${report.scope.files} files, ${report.totals.codeLines} code lines, ${report.totals.functions} functions, ${report.scope.parseFailures.length} parse failures`);
});
