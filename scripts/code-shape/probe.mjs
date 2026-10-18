#!/usr/bin/env node
// Perturbation probe (LIN-3628): which tests depend on the text of one file rather than its behaviour?
// Usage: node probe.mjs <repoDir> <commit> --target <path> --test-cmd '<cmd>'
//        [--rename-map map.json] [--perturb-module file.mjs] [--node-modules dir] [--timeout ms] [--keep]
// Extracts <commit> (git archive) into a temp dir, runs --test-cmd there unmodified, then once per
// rewrite with --target replaced, and reports the failures each rewrite adds. The command must print
// TAP (e.g. `node --test --test-reporter=tap tests/a.test.js`). Blocking the network is the test
// command's job (see experiments/rebuild-exp1/kit/lib/no-network.mjs). Failing tests are data, not an exit code.
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { UsageError, archiveTo, emitJson, loadCore, parseArgs, resolveCommit, runCli } from './code-shape-lib.mjs';
import { diffFailures, looksLikeTap, parseTap } from './tap.mjs';

await runCli(async () => {
  const { positional, flags } = parseArgs(process.argv.slice(2), {
    '--target': 'value', '--test-cmd': 'value', '--rename-map': 'value', '--perturb-module': 'value', '--node-modules': 'value', '--timeout': 'value', '--keep': 'bool',
  });
  const [repoArg, commitArg] = positional;
  const target = flags['--target'], testCmd = flags['--test-cmd'];
  if (!repoArg || !commitArg || !target || !testCmd) {
    console.error("usage: node probe.mjs <repoDir> <commit> --target <path> --test-cmd '<cmd>' [--rename-map f] [--perturb-module f] [--node-modules dir] [--timeout ms] [--keep]");
    process.exit(2);
  }
  if (isAbsolute(target) || normalize(target).startsWith('..')) throw new UsageError('--target must be a path inside the repository');
  const core = await loadCore(new URL('./perturb-core.mjs', import.meta.url));
  const readJson = (flag) => { try { return JSON.parse(readFileSync(flags[flag], 'utf8')); } catch (e) { throw new UsageError(`${flag} ${flags[flag]}: ${e.message}`); } };
  const renameMap = flags['--rename-map'] ? readJson('--rename-map') : null;
  let custom = {};
  if (flags['--perturb-module']) {
    try { custom = await core.loadPerturbModule(pathToFileURL(resolve(flags['--perturb-module'])).href); } catch (e) { throw new UsageError(`--perturb-module: ${e.message}`); }
  }
  const timeout = Number(flags['--timeout'] ?? 600000);
  const repo = resolve(repoArg);
  const sha = resolveCommit(repo, commitArg);

  const tree = realpathSync(mkdtempSync(join(tmpdir(), 'code-shape-probe-')));
  try {
    archiveTo(repo, sha, tree);
    if (flags['--node-modules']) symlinkSync(resolve(flags['--node-modules']), join(tree, 'node_modules'), 'dir');
    const targetPath = join(tree, target);
    let original;
    try { original = readFileSync(targetPath, 'utf8'); } catch { throw new UsageError(`--target ${target}: not a file at ${sha.slice(0, 8)}`); }

    // NODE_TEST_CONTEXT marks a process as a child of a running `node --test`; inherited, it would
    // make the test command's own `node --test` print machine-format output instead of TAP.
    const { NODE_TEST_CONTEXT: _inherited, ...env } = process.env;
    const run = () => {
      const r = spawnSync('sh', ['-c', testCmd], { cwd: tree, encoding: 'utf8', timeout, maxBuffer: 1 << 30, env });
      return { exitCode: r.status, timedOut: r.error?.code === 'ETIMEDOUT', tap: r.stdout ?? '' };
    };
    const base = run();
    if (!looksLikeTap(base.tap)) console.error('probe: the unmodified run printed no TAP; add --test-reporter=tap (or equivalent) to --test-cmd');
    const baseline = parseTap(base.tap, { root: tree });

    const rewrites = core.buildRewrites({ renameMap, custom });
    const results = [];
    try {
      for (const [name, fn] of Object.entries(rewrites)) {
        const text = fn(original);
        let astEqual = null;
        try { astEqual = core.astEqual(original, text); } catch { /* a file acorn cannot parse has no AST verdict */ }
        writeFileSync(targetPath, text);
        const r = run();
        results.push({ rewrite: name, astEqual, exitCode: r.exitCode, timedOut: r.timedOut, ...diffFailures(baseline, parseTap(r.tap, { root: tree })) });
      }
    } finally {
      writeFileSync(targetPath, original);
    }
    emitJson({
      commit: sha, target, testCmd,
      baseline: { exitCode: base.exitCode, timedOut: base.timedOut, tapSeen: looksLikeTap(base.tap), failures: baseline },
      rewrites: results,
      skipped: renameMap ? [] : [{ rewrite: 'rename', reason: 'no --rename-map' }],
      ...(flags['--keep'] ? { tree } : {}),
    });
    console.error(`probe ${sha.slice(0, 8)} ${target}: ${baseline.length} baseline failures; ${results.map((r) => `${r.rewrite} +${r.addedFailures.length}`).join(', ')}`);
  } finally {
    if (!flags['--keep']) rmSync(tree, { recursive: true, force: true });
  }
});
