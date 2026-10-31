#!/usr/bin/env node
/**
 * Unit-suite wrapper (LIN-3605): runs `node --test` over the file list it is
 * given, capping file concurrency locally so several agent sessions can share
 * one machine. Node's default is availableParallelism() - 1 processes per
 * session, which froze a laptop running three suites at once.
 *
 * The npm scripts keep the shell glob and pass the already-expanded file list
 * here, so the list and its order are exactly what `node --test <glob>` saw.
 *
 * Concurrency, first match wins:
 *   1. UNIT_TEST_CONCURRENCY (non-empty) - a positive integer, used as is;
 *      anything else is refused. Empty counts as unset.
 *   2. CI set (any non-empty value, as in playwright.config.js, so a local
 *      CI=false also counts as CI) - no flag: today's behaviour, CI unchanged.
 *   3. max(1, floor(availableParallelism / 2)).
 *
 * `--test-concurrency` needs Node >= 20.10 and is rejected in NODE_OPTIONS, so
 * it goes on the command line. UNIT_TEST_DRY_RUN=1 prints the argv as JSON
 * instead of spawning (used by tests/unit/run-unit-tests.test.js).
 *
 * Credentials (LIN-2369): the suite is handed OPENROUTER_API_KEY and
 * OPENROUTER_FREE_TIER_KEY set to '' whatever the caller's shell or .env holds,
 * so no test can reach a live model, and the result does not depend on whether
 * a key is around. See unitTestEnv.
 */
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

// Blanked, not deleted: server.js loads .env via dotenv/config, which fills a
// variable that is unset but never one that is set to ''. Empty is "unset" to
// the code too (getPaidEnvKey and the free-tier reader trim() to '').
const OPENROUTER_CREDENTIALS = ['OPENROUTER_API_KEY', 'OPENROUTER_FREE_TIER_KEY'];

export function unitTestEnv(env) {
  const out = { ...env };
  for (const name of OPENROUTER_CREDENTIALS) out[name] = '';
  return out;
}

export function unitTestConcurrency({ env, cpus }) {
  const override = env.UNIT_TEST_CONCURRENCY;
  if (override !== undefined && override !== '') {
    if (!/^[1-9]\d*$/.test(override)) {
      throw new Error(`UNIT_TEST_CONCURRENCY must be a positive integer, got "${override}"`);
    }
    return Number(override);
  }
  if (env.CI) return undefined;
  return Math.max(1, Math.floor(cpus / 2));
}

export function nodeTestArgs(files, n) {
  if (!files.length) {
    // A bare `node --test` would auto-discover a different set of files.
    throw new Error('run-unit-tests: no test files given');
  }
  return ['--test', ...(n ? [`--test-concurrency=${n}`] : []), ...files];
}

function main() {
  const cpus = availableParallelism();
  let args;
  try {
    const n = unitTestConcurrency({ env: process.env, cpus });
    args = nodeTestArgs(process.argv.slice(2), n);
    if (n) console.error(`[unit] --test-concurrency=${n} (${cpus} CPUs)`);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (process.env.UNIT_TEST_DRY_RUN) {
    console.log(JSON.stringify(args));
    return;
  }
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: unitTestEnv(process.env) });
  child.on('error', (err) => {
    console.error(`[unit] could not start node: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
