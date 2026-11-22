/**
 * LIN-1693 — cost-accounting and dry-run regression tests for the dense sweep
 * harness (scripts/eval/eval-dense.mjs).
 *
 *   node --test scripts/eval/eval-dense.test.mjs
 *
 * Every case runs the harness as a CHILD process with STUB=1 (an injected
 * transport) from a cwd that has no .env, then reads the emitted summary.json.
 * OPENROUTER_API_KEY is removed from the child env, so the run is provably
 * key-free and makes zero network calls. Nothing here touches the paid path.
 *
 * Cost cases use a tiny generated leaf-only fixture (single hop per run) and
 * STUB_COST to make per-call spend exact and deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS = join(HERE, 'eval-dense.mjs');

function leafWorkspace(ids) {
  const bundles = {};
  const targets = ids.map((id) => {
    bundles[id] = {
      issue: {
        id, identifier: id, title: `task ${id}`,
        description: `A focused ${id} task that one session can build.`,
        state: { name: 'In Progress', type: 'started' },
        createdAt: '2026-01-01T00:00:00.000Z', labels: []
      },
      parent: null, siblings: [], siblingsTotal: 0, project: null,
      children: [], comments: [], focusedChild: null
    };
    return { id, expect: ['research'] };
  });
  return { name: 'LeafTest', targets, bundles };
}

/**
 * Spawn the harness once. `overrides` sets env; OPENROUTER_API_KEY is always
 * removed so the run is key-free. `fixtureIds` (when given) writes a temp
 * leaf-only fixture dir, making each run a deterministic single hop.
 */
function runHarness(overrides, fixtureIds) {
  const work = mkdtempSync(join(tmpdir(), 'eval-dense-test-'));
  const out = join(work, 'out');
  const env = { ...process.env, OUT_DIR: out, ...overrides };
  delete env.OPENROUTER_API_KEY;
  if (fixtureIds) {
    const fixtures = join(work, 'fixtures');
    mkdirSync(fixtures, { recursive: true });
    writeFileSync(join(fixtures, 'leaf.json'), JSON.stringify(leafWorkspace(fixtureIds)));
    env.FIXTURES_DIR = fixtures;
  }
  const res = spawnSync(process.execPath, [HARNESS], { cwd: work, env, encoding: 'utf8' });
  const summaryPath = join(out, 'summary.json');
  return {
    res,
    summary: existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null,
    cleanup: () => rmSync(work, { recursive: true, force: true })
  };
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('STUB runs with OPENROUTER_API_KEY unset (reaches the stub transport)', (t) => {
  const r = runHarness({ STUB: '1' });
  t.after(r.cleanup);
  assert.equal(r.res.status, 0, r.res.stderr);
  assert.ok(r.summary, 'summary.json was written');
  assert.equal(r.summary.production.errors, 0, 'no run may error without a key under STUB');
  // 56 targets × 5 models. Under the stub the answer is a code route's or the stub's expected
  // action, so the hit count moves only where a route's action moves. LIN-4518 (finding-004175cc)
  // hands every hop its trail, landing and plan-review loop from records: 250/280. The FIX-812 approve hops are
  // read from records now (a no-PR review on the plan), and the stub answers every model hop with its expected
  // action, so their hits are unchanged, not re-earned. The 25 misses
  // the previous count held are the pre-existing LIN-385 / LIN-389 / LIN-428 descent cases; the
  // other 5 are LIN-3135, whose review comment reads as `unknown` on the comment path. Its records
  // hold the approval, so the blind read is owed and the route sends it (the expectation there was
  // written from the unreadable verdict).
  assert.equal(r.summary.production.hit, 250);
  assert.equal(r.summary.production.n, 280);
});

test('the sweep reads its trail, landing and plan-review loop from records, never from a comment', (t) => {
  const r = runHarness({ STUB: '1' });
  t.after(r.cleanup);
  assert.equal(r.res.status, 0, r.res.stderr);
  const { records } = r.summary;
  assert.ok(records.seeded > 0, 'the authored records are seeded into a records store');
  assert.equal(records.hops.comments, 0, 'no hop is handed a comment-only context');
  assert.ok(records.hops.records > 0, 'every hop is handed a records context');
  // 29 targets are seeded from their authored events. FIX-812 x2 are among them: a review with no PR is a verdict on
  // the task's plan (LIN-4518 finding-d3b5b9de), so no target is handed "not read" for its trail.
  assert.equal(records.seeded, 29);
});

test('cost of a failed attempt that is then retried is counted', (t) => {
  const r = runHarness(
    { STUB: '1', STUB_COST: '0.25', STUB_BAD_AT: '1', MODELS: 'stub/model' },
    ['LEAF-1']
  );
  t.after(r.cleanup);
  assert.equal(r.res.status, 0, r.res.stderr);
  assert.equal(r.summary.production.errors, 0, 'the retried attempt should succeed');
  assert.equal(r.summary.totalRuns, 1);
  assert.ok(
    near(r.summary.totalCostUsd, 0.5),
    `both attempts must be counted ($0.50), got $${r.summary.totalCostUsd}`
  );
});

test('cost of an error run is counted (not 0)', (t) => {
  const r = runHarness(
    { STUB: '1', STUB_COST: '0.25', STUB_BAD_ALWAYS: '1', MODELS: 'stub/model' },
    ['LEAF-1']
  );
  t.after(r.cleanup);
  assert.equal(r.res.status, 0, r.res.stderr);
  assert.equal(r.summary.production.errors, 1, 'both attempts fail the parser');
  assert.equal(r.summary.totalRuns, 1);
  assert.ok(
    near(r.summary.totalCostUsd, 0.5),
    `an error run must still record its spend ($0.50), got $${r.summary.totalCostUsd}`
  );
});

test('MAX_USD is checked before each run and a steady sweep halts below the cap', (t) => {
  const r = runHarness(
    { STUB: '1', STUB_COST: '0.3', MAX_USD: '1', MODELS: 'stub/model' },
    ['LEAF-1', 'LEAF-2', 'LEAF-3', 'LEAF-4', 'LEAF-5', 'LEAF-6', 'LEAF-7', 'LEAF-8', 'LEAF-9', 'LEAF-10']
  );
  t.after(r.cleanup);
  assert.equal(r.res.status, 0, r.res.stderr);
  assert.equal(r.summary.halted?.reason, 'budget');
  assert.ok(
    r.summary.totalCostUsd <= r.summary.maxUsd,
    `spend $${r.summary.totalCostUsd} must not exceed the $${r.summary.maxUsd} cap`
  );
  assert.ok(
    near(r.summary.totalCostUsd, 0.9),
    `expected the halt before the fourth $0.30 run ($0.90), got $${r.summary.totalCostUsd}`
  );
});
