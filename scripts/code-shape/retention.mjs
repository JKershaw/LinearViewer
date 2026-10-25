#!/usr/bin/env node
// Dropped-reference retention check (LIN-3829). Reads git objects only.
// Usage: node retention.mjs <repoDir> <baseCommit> <headCommit> [--include rx] [--exclude rx]   → JSON on stdout, summary on stderr
// Report only: exit 0 whatever the list holds. Exit 2 means a usage error or a missing acorn.
import { resolve } from 'node:path';
import { changedPaths, compileScope, emitJson, loadCore, parseArgs, readCommit, readPaths, resolveCommit, runCli } from './code-shape-lib.mjs';

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), { '--include': 'value', '--exclude': 'value' });
  const [repoArg, baseArg, headArg] = positional;
  if (!repoArg || !baseArg || !headArg) {
    console.error('usage: node retention.mjs <repoDir> <baseCommit> <headCommit> [--include rx] [--exclude rx]');
    process.exit(2);
  }
  const { measureRetention } = await loadCore(new URL('./retention-core.mjs', import.meta.url));
  const repo = resolve(repoArg);
  const [baseSha, headSha] = [resolveCommit(repo, baseArg), resolveCommit(repo, headArg)];
  const inScope = compileScope({ include: flags['--include'], exclude: flags['--exclude'] });
  const paths = changedPaths(repo, baseSha, headSha).filter(inScope).sort();
  const changed = new Set(paths);
  const result = measureRetention({
    baseFiles: readPaths(repo, baseSha, paths),
    headFiles: readPaths(repo, headSha, paths),
    headTree: () => readCommit(repo, headSha, (p) => inScope(p) && !changed.has(p)).files,
  });
  emitJson({ base: baseSha, head: headSha, ...result });
  const refs = result.dropped.map((d) => d.ref).join(', ') || 'none';
  console.error(`retention ${baseSha.slice(0, 8)}→${headSha.slice(0, 8)}: ${result.dropped.length} dropped (${refs}); ${result.parseFailures.length} parse failure(s)`);
});
