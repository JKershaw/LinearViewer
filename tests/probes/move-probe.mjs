#!/usr/bin/env node
// Move probe (LIN-3861): which tests depend on WHERE the workspace-API routes sit rather than on what they do?
// Usage: node tests/probes/move-probe.mjs <repo> <commit> --variant flat|nested|all-unit
//        [--factory name] [--node-modules dir] [--test-cmd '<cmd>'] [--timeout ms] [--trace] [--keep]
// Extracts <commit> (git archive) into a temp dir, runs the test command there unmodified, then on a
// moved layout, and reports the failures the layout adds, the test names that vanished or appeared and
// the per-test status changes. The command must print TAP; the default is `npm run test:unit` with the
// TAP reporter. Blocking the network is the test command's job, not this probe's (see
// scripts/code-shape/probe.mjs). Failing tests are data, not an exit code.
//
// Layouts (buildLayout, pure over `{rel: src}`):
//   flat      routes/workspace-api.js -> routes/workspace-api-body.js unchanged, and
//             routes/workspace-api.js becomes `export * from './workspace-api-body.js';`.
//   nested    flat, but the stub exports its own createWorkspaceApiRoutes that mounts the body's router
//             one router deeper (a local export shadows the star export).
//   all-unit  flat applied to every file of the workspace-API unit.
// With --trace the test command runs with tests/probes/read-trace-hook.mjs preloaded, and the report
// says which test files read which unit file (once for the unmodified run, once for the layout).
//
// This file lives under tests/probes/, outside the unit glob (tests/unit/*.test.js), so CI never runs
// it. It imports scripts/code-shape/* and changes nothing under scripts/.
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { UsageError, archiveTo, emitJson, parseArgs, resolveCommit, runCli } from '../../scripts/code-shape/code-shape-lib.mjs';
import { diffFailures, looksLikeTap, parseTap } from '../../scripts/code-shape/tap.mjs';
import { isWorkspaceApiUnitFile, workspaceApiUnitFiles } from '../unit/lib/workspace-api-unit.js';

export const VARIANTS = ['flat', 'nested', 'all-unit'];
export const MAIN_UNIT_FILE = 'routes/workspace-api.js';
export const DEFAULT_TEST_CMD = 'node scripts/run-unit-tests.mjs --test-reporter=tap tests/unit/*.test.js scripts/eval/eval-dense.test.mjs scripts/code-shape/*.test.mjs';
export const TRACE_PATTERN = '(?:^|/)(?:routes/workspace-api(?:-[^/]+)?|lib/workspace-api-mocks)\\.js$';
const HOOK = fileURLToPath(new URL('./read-trace-hook.mjs', import.meta.url));

// `export *` drops a default export, so a layout that star-re-exports such a file would change what
// importers see. Refuse instead of moving it.
const DEFAULT_EXPORT = /^\s*export\s+default\b|^\s*export\s*\{[^}]*\bas\s+default\b[^}]*\}/m;

const bodyName = (rel) => rel.replace(/\.js$/, '-body.js');
const star = (rel) => `export * from './${bodyName(rel).split('/').pop()}';\n`;

/**
 * The files a variant adds or rewrites, from the unit files it moves. Pure: `{rel: src}` in, `{rel: src}` out.
 * The result holds, for each moved file, `<name>-body.js` (the original text, byte for byte) and the stub
 * at the original path. Files not moved are not in the result.
 * @param {Record<string,string>} files repo-relative path -> source; flat and nested read routes/workspace-api.js, all-unit every unit file
 * @param {{ variant: 'flat'|'nested'|'all-unit', factory?: string }} options
 * @returns {Record<string,string>}
 */
export function buildLayout(files, { variant, factory = 'createWorkspaceApiRoutes' }) {
  if (!VARIANTS.includes(variant)) throw new UsageError(`--variant must be one of ${VARIANTS.join(', ')}`);
  const targets = variant === 'all-unit' ? Object.keys(files).filter(isWorkspaceApiUnitFile).sort() : [MAIN_UNIT_FILE];
  if (variant !== 'all-unit' && !(MAIN_UNIT_FILE in files)) throw new UsageError(`${MAIN_UNIT_FILE} is not in the input files`);
  if (!targets.length) throw new UsageError('no workspace-API unit files in the input files');
  const out = {};
  for (const rel of targets) {
    const src = files[rel];
    if (DEFAULT_EXPORT.test(src)) throw new UsageError(`${rel} has an export default, which export * would drop; not moved`);
    out[bodyName(rel)] = src;
    if (variant === 'nested') {
      if (!new RegExp(`^export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var)\\s+${factory}\\b`, 'm').test(src)) {
        throw new UsageError(`${rel} does not export ${factory} (set --factory)`);
      }
      out[rel] = [
        "import { Router } from 'express';",
        `import { ${factory} as ${factory}Body } from './${bodyName(rel).split('/').pop()}';`,
        star(rel).trimEnd(),
        `export function ${factory}(deps) { const router = Router(); router.use(${factory}Body(deps)); return router; }`,
        ''
      ].join('\n');
    } else {
      out[rel] = star(rel);
    }
  }
  return out;
}

/**
 * The environment the test command runs in. NODE_TEST_CONTEXT marks a process as a child of a running
 * `node --test`; inherited, it would make the command's own `node --test` print machine-format output
 * instead of TAP.
 */
export function childEnv(env, { traceOut = null } = {}) {
  const { NODE_TEST_CONTEXT: _inherited, ...rest } = env;
  if (!traceOut) return rest;
  return {
    ...rest,
    NODE_OPTIONS: `${rest.NODE_OPTIONS ? `${rest.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(HOOK).href}`,
    MOVE_PROBE_TRACE_PATTERN: TRACE_PATTERN,
    MOVE_PROBE_TRACE_OUT: traceOut
  };
}

/** Trace lines (`<test file>\t<unit file>`) -> { unit file: sorted unique reading test files }. */
export function readersByUnitFile(traceText) {
  const readers = new Map();
  for (const line of traceText.split('\n')) {
    const [test, unit] = line.split('\t');
    if (!test || !unit) continue;
    if (!readers.has(unit)) readers.set(unit, new Set());
    readers.get(unit).add(test);
  }
  return Object.fromEntries([...readers].sort(([a], [b]) => (a < b ? -1 : 1)).map(([unit, set]) => [unit, [...set].sort()]));
}

/** Every test in a TAP run, by `<ok|not ok> :: name` status, so appeared/vanished/changed tests are visible. */
export function tapStatuses(text) {
  const statuses = new Map();
  for (const line of text.split('\n')) {
    const m = /^\s*(not ok|ok) \d+ - (.*?)(?:\s+#\s*(SKIP|TODO)\b.*)?$/.exec(line);
    if (!m) continue;
    statuses.set(m[2], m[3] ? m[3].toLowerCase() : m[1] === 'ok' ? 'pass' : 'fail');
  }
  return statuses;
}

export function diffStatuses(before, after) {
  const vanished = [...before.keys()].filter((n) => !after.has(n)).sort();
  const appeared = [...after.keys()].filter((n) => !before.has(n)).sort();
  const changed = [...after].filter(([n, s]) => before.has(n) && before.get(n) !== s).map(([name, to]) => ({ name, from: before.get(name), to })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { vanished, appeared, changed };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2), {
    '--variant': 'value', '--factory': 'value', '--node-modules': 'value', '--test-cmd': 'value', '--timeout': 'value', '--trace': 'bool', '--keep': 'bool'
  });
  const [repoArg, commitArg] = positional;
  const variant = flags['--variant'];
  if (!repoArg || !commitArg || !variant) {
    console.error("usage: node tests/probes/move-probe.mjs <repo> <commit> --variant flat|nested|all-unit [--factory name] [--node-modules dir] [--test-cmd '<cmd>'] [--timeout ms] [--trace] [--keep]");
    process.exit(2);
  }
  if (!VARIANTS.includes(variant)) throw new UsageError(`--variant must be one of ${VARIANTS.join(', ')}`);
  const testCmd = flags['--test-cmd'] ?? DEFAULT_TEST_CMD;
  const timeout = Number(flags['--timeout'] ?? 1800000);
  const repo = resolve(repoArg);
  const sha = resolveCommit(repo, commitArg);

  const tree = realpathSync(mkdtempSync(join(tmpdir(), 'move-probe-')));
  try {
    archiveTo(repo, sha, tree);
    if (flags['--node-modules']) symlinkSync(resolve(flags['--node-modules']), join(tree, 'node_modules'), 'dir');
    const run = (label) => {
      const traceOut = flags['--trace'] ? join(tree, `.move-probe-${label}.trace`) : null;
      if (traceOut) writeFileSync(traceOut, '');
      const r = spawnSync('sh', ['-c', testCmd], { cwd: tree, encoding: 'utf8', timeout, maxBuffer: 1 << 30, env: childEnv(process.env, { traceOut }) });
      const tap = r.stdout ?? '';
      if (!looksLikeTap(tap)) console.error(`move-probe: the ${label} run printed no TAP; add --test-reporter=tap (or equivalent) to --test-cmd`);
      return { exitCode: r.status, timedOut: r.error?.code === 'ETIMEDOUT', tap, readers: traceOut ? readersByUnitFile(readFileSync(traceOut, 'utf8')) : null };
    };

    const base = run('unmodified');
    const baseline = parseTap(base.tap, { root: tree });

    const unitFiles = variant === 'all-unit' ? workspaceApiUnitFiles(tree) : [MAIN_UNIT_FILE];
    const layout = buildLayout(Object.fromEntries(unitFiles.map((rel) => [rel, readFileSync(join(tree, rel), 'utf8')])), { variant, factory: flags['--factory'] });
    for (const rel of Object.keys(layout)) {
      if (!unitFiles.includes(rel) && existsSync(join(tree, rel))) throw new UsageError(`${rel} already exists at ${sha.slice(0, 8)}`);
    }
    for (const rel of unitFiles) renameSync(join(tree, rel), join(tree, bodyName(rel)));
    for (const [rel, src] of Object.entries(layout)) {
      if (unitFiles.includes(rel)) writeFileSync(join(tree, rel), src);
    }
    const moved = run(variant);
    const after = parseTap(moved.tap, { root: tree });

    emitJson({
      commit: sha, variant, testCmd, layout: Object.keys(layout).sort(),
      unmodified: { exitCode: base.exitCode, timedOut: base.timedOut, tapSeen: looksLikeTap(base.tap), tests: tapStatuses(base.tap).size, failures: baseline },
      moved: { exitCode: moved.exitCode, timedOut: moved.timedOut, tapSeen: looksLikeTap(moved.tap), tests: tapStatuses(moved.tap).size, failures: after },
      ...diffFailures(baseline, after),
      ...diffStatuses(tapStatuses(base.tap), tapStatuses(moved.tap)),
      ...(flags['--trace'] ? { readers: { unmodified: base.readers, moved: moved.readers } } : {}),
      ...(flags['--keep'] ? { tree } : {})
    });
    console.error(`move-probe ${sha.slice(0, 8)} ${variant}: ${baseline.length} failures unmodified, ${after.length} moved`);
  } finally {
    if (!flags['--keep']) rmSync(tree, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli(main);
