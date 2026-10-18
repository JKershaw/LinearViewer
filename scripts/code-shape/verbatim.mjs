#!/usr/bin/env node
// Verbatim share between two commits (LIN-3628). Reads git objects only.
// Usage: node verbatim.mjs <repoDir> <oldCommit> <newCommit> [--old a.js,b.js] [--new a.js,b.js]
//        [--areas path] [--include rx] [--exclude rx]   → JSON on stdout, summary on stderr
// Without --old / --new both sides are the in-scope files changed between the commits (a move
// counts on both sides: renames are not followed). The old side is read at <oldCommit>, the new at <newCommit>.
import { resolve } from 'node:path';
import { areaOf, changedPaths, compileGuide, compileScope, emitJson, loadAreas, loadCore, parseArgs, readPaths, resolveCommit, runCli } from './code-shape-lib.mjs';

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), { '--old': 'value', '--new': 'value', '--areas': 'value', '--include': 'value', '--exclude': 'value' });
  const [repoArg, oldArg, newArg] = positional;
  if (!repoArg || !oldArg || !newArg) {
    console.error('usage: node verbatim.mjs <repoDir> <oldCommit> <newCommit> [--old a,b] [--new a,b] [--areas path] [--include rx] [--exclude rx]');
    process.exit(2);
  }
  const { measureVerbatim } = await loadCore(new URL('./verbatim-core.mjs', import.meta.url));
  const repo = resolve(repoArg);
  const [oldSha, newSha] = [resolveCommit(repo, oldArg), resolveCommit(repo, newArg)];
  const { areaMap, source } = loadAreas(flags['--areas']);
  const guide = areaMap ? compileGuide(areaMap) : null;
  const inScope = compileScope({ include: flags['--include'], exclude: flags['--exclude'] });
  const changed = () => changedPaths(repo, oldSha, newSha).filter(inScope).sort();
  const oldPaths = flags['--old'] ? flags['--old'].split(',') : changed();
  const newPaths = flags['--new'] ? flags['--new'].split(',') : (flags['--old'] ? changed() : oldPaths);
  const result = measureVerbatim({
    oldFiles: readPaths(repo, oldSha, oldPaths),
    newFiles: readPaths(repo, newSha, newPaths),
    regionOf: (p) => areaOf(guide, p),
  });
  emitJson({ old: oldSha, new: newSha, areaMapSource: source, oldFiles: oldPaths, newFiles: newPaths, ...result });
  const { raw: r, semicolonsNormalised: n } = result;
  console.error(`verbatim ${oldSha.slice(0, 8)}→${newSha.slice(0, 8)}: ${r.newLines} new / ${r.oldLines} old lines, ${r.matched} matched (${r.newVerbatimPct}% new, ${r.oldSurvivingPct}% old), longest run ${r.longestRun.length}; semicolons normalised ${n.newVerbatimPct}%`);
});
