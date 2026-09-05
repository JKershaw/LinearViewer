/**
 * Unit tests for the fossil pass's CLI/execution wrapper
 * (`scripts/fossil-pass-lin2633.js`, LIN-2653 S1 of LIN-2633) — the plan's T20.
 *
 * Three things are pinned here, and all three are safety properties rather
 * than conveniences:
 *
 *   1. DRY RUN IS THE DEFAULT and writes nothing. `runFossilPass` without
 *      `execute: true` must not reach `stampBookkeeping` at all — asserted by
 *      driving it through a store whose write method THROWS if called, so a
 *      regression is a loud failure rather than a silently-written stamp.
 *   2. IMPORTING THE MODULE HAS NO SIDE EFFECT — no database connection, no
 *      write, no `main()`. This is what the `import.meta.url` guard buys, and
 *      it is the reason this file can import the script at all.
 *   3. `--execute` writes, and a read failure for one workspace stamps
 *      nothing for that workspace while the others still proceed.
 *
 * The write-side store is a real `DispatchQueueStore` over a real MangoDB
 * tmpdir for the execute path (the same reasoning as
 * tests/unit/dispatch-store-bookkeeping.test.js — the `{bookkeeping: null}`
 * idempotence clause is engine semantics the shared mock is a false witness
 * for), and a call-recording fake for the dry-run path, where the whole point
 * is that no write is attempted.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { FOSSIL_AGE_MS } from '../../lib/observer-sweep.js';
import {
  runFossilPass,
  buildFossilReport,
  selectFossilRows,
  STAMP_REASON,
  AGE_BUCKETS,
  SKIP_REASONS
} from '../../scripts/fossil-pass-lin2633.js';

const URL_KEY = 'acme';
const NOW = new Date('2026-09-05T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const daysAgo = (d) => new Date(NOW_MS - d * 24 * 60 * 60 * 1000);

// Two shapes are needed and conflating them is a real trap: the STORED
// document (`_id`, `Date` fields — what `history.insertOne` takes) and the
// FORMATTED item the store's own `listHistory` returns via
// `_formatHistoryItem` (`id`, ISO strings — what `getLoopsForWorkspace`, and
// therefore `_buildLoops`, actually consumes). A stub that hands back stored
// shapes silently yields zero loops, because `_buildLoops` finds no `id`.
//
// A `taken` history row old enough to be a fossil on both clocks, STORED shape.
function fossilRow(id, overrides = {}) {
  return {
    _id: id,
    urlKey: URL_KEY,
    prompt: 'p',
    promptName: 'implementation',
    kind: 'implementation',
    issueId: `uuid-${id}`,
    issueIdentifier: `LIN-${id}`,
    issueTitle: 'Issue',
    issueUrl: 'https://linear.app/x/issue/LIN-1',
    dispatchedAt: daysAgo(12),
    status: 'taken',
    resolvedAt: daysAgo(12),
    feedback: [],
    bookkeeping: null,
    ...overrides
  };
}

// The same row in the FORMATTED shape a real `listHistory` would return.
function fossilItem(id, overrides = {}) {
  const row = fossilRow(id, overrides);
  return {
    ...row,
    id: row._id,
    _id: undefined,
    dispatchedAt: row.dispatchedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    feedback: (row.feedback || []).map((f) => ({
      ...f,
      timestamp: f.timestamp instanceof Date ? f.timestamp.toISOString() : f.timestamp
    })),
    workspace: { urlKey: row.urlKey }
  };
}

// A store stub whose write method fails the test if it is ever reached.
function noWriteStore({ loopsByWorkspace, urlKeys }) {
  return {
    listObservedWorkspaceKeys: async () => urlKeys,
    stampBookkeeping: async () => {
      throw new Error('stampBookkeeping must NOT be called on a dry run');
    },
    // getLoopsForWorkspace's two injected reads.
    listItems: async (urlKey) => (loopsByWorkspace[urlKey]?.live || []),
    listHistory: async (urlKey) => ({ items: loopsByWorkspace[urlKey]?.history || [], total: 0 })
  };
}

const emptyAgentStatusStore = { listStatus: async () => ({ items: [] }) };

describe('fossil pass T20 — dry run is the default and writes nothing', () => {
  test('runFossilPass with no execute flag never calls stampBookkeeping, even with eligible rows', async () => {
    const store = noWriteStore({
      urlKeys: [URL_KEY],
      loopsByWorkspace: { [URL_KEY]: { history: [fossilItem('a'), fossilItem('b')] } }
    });

    const result = await runFossilPass({
      dispatchStore: store,
      agentStatusStore: emptyAgentStatusStore,
      now: NOW_MS
    });

    // If the default were `execute`, the throwing stub above would have
    // rejected this call — so reaching here IS the assertion.
    assert.equal(result.execute, false, 'execute defaults to false');
    assert.deepEqual(result.stamped, [], 'nothing was written');
    assert.equal(result.perWorkspace[0].selection.eligible.length, 2, 'and it did find rows it WOULD have stamped');
    assert.match(result.report, /DRY RUN/);
    assert.match(result.report, /Dry run — nothing was written/);
  });

  test('the report groups by the five promised age buckets and by lane', async () => {
    const store = noWriteStore({
      urlKeys: [URL_KEY],
      loopsByWorkspace: {
        [URL_KEY]: {
          history: [
            fossilItem('8d', { dispatchedAt: daysAgo(8), resolvedAt: daysAgo(8) }),
            fossilItem('12d', { dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12) }),
            fossilItem('16d', {
              dispatchedAt: daysAgo(16), resolvedAt: daysAgo(16),
              feedback: [{ message: '[blocked] need a decision', timestamp: daysAgo(16) }]
            }),
            fossilItem('25d', { dispatchedAt: daysAgo(25), resolvedAt: daysAgo(25) }),
            // Not eligible — a terminal row and a fresh row, so the
            // would-not-touch section has real content too.
            fossilItem('done', {
              dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
              feedback: [{ message: '[done] shipped', timestamp: daysAgo(11) }]
            }),
            fossilItem('fresh', { dispatchedAt: daysAgo(1), resolvedAt: daysAgo(1) })
          ]
        }
      }
    });

    const { report } = await runFossilPass({
      dispatchStore: store,
      agentStatusStore: emptyAgentStatusStore,
      now: NOW_MS,
      headSha: 'deadbeef'
    });

    for (const bucket of AGE_BUCKETS) {
      assert.ok(report.includes(bucket.key), `the report must name the ${bucket.key} bucket`);
    }
    assert.match(report, /By lane:/);
    assert.match(report, /silent\s+3/, 'three silent rows land in the lane table');
    assert.match(report, /blocked\s+1/, 'and one blocked row');
    assert.match(report, /## Would stamp: 4/);
    assert.match(report, /## Would NOT touch/);
    for (const reason of SKIP_REASONS) {
      assert.ok(report.includes(reason), `the would-not-touch section must itemise ${reason}`);
    }
    assert.match(report, /HEAD: deadbeef/, 'the report carries the HEAD sha');
    assert.match(report, /Criterion applied/, 'and states the exact criterion');
    assert.ok(report.includes('7-10d'), 'bucket labels are the operator-facing ones');
  });

  test('a NON-EMPTY >30d bucket is reported as a FINDING, not as rows to stamp', () => {
    // The retention edge: historyTtl (30d) and LOOKBACK_MS (30d) both bound
    // the readable band, so this bucket should be empty in production. If it
    // is not, the report must say so rather than quietly listing a count.
    const selection = {
      eligible: [{ loopId: 'ancient' }],
      skipped: [],
      skippedCounts: {},
      laneCounts: { silent: 1, blocked: 0 },
      bucketCounts: { '7-10d': 0, '10-14d': 0, '14-21d': 0, '21-30d': 0, '>30d': 1 }
    };
    const report = buildFossilReport({
      perWorkspace: [{ urlKey: URL_KEY, readFailed: false, selection }],
      now: NOW_MS
    });
    assert.match(report, /FINDING/, 'a populated >30d bucket must be flagged');
    assert.match(report, /should be EMPTY/);

    // And the same report on an empty >30d bucket carries no such warning.
    const clean = buildFossilReport({
      perWorkspace: [{
        urlKey: URL_KEY, readFailed: false,
        selection: { ...selection, bucketCounts: { ...selection.bucketCounts, '>30d': 0 } }
      }],
      now: NOW_MS
    });
    assert.ok(!clean.includes('FINDING'), 'and an empty bucket is not flagged');
  });
});

describe('fossil pass T20 — importing the module has no side effect', () => {
  test('a child process that imports the script runs main() not at all: no output, no connection, exit 0', () => {
    const scriptPath = fileURLToPath(new URL('../../scripts/fossil-pass-lin2633.js', import.meta.url));
    // If the import.meta.url guard were wrong (or absent), importing would
    // call main(), which opens a database connection against
    // HARBOUR_DATA_DIR and prints a report. Asserting on stdout is what
    // catches that: a guarded import prints nothing at all.
    const stdout = execFileSync(process.execPath, [
      '--input-type=module',
      '-e', `import ${JSON.stringify(scriptPath)}; process.stdout.write('IMPORTED-CLEANLY')`
    ], { encoding: 'utf8', env: { ...process.env, HARBOUR_DATA_DIR: '/nonexistent-on-purpose' } });

    assert.equal(stdout, 'IMPORTED-CLEANLY', 'import must produce no output of its own — no report, no log line');
  });

  test('the guard is the import.meta.url form the precedent uses', () => {
    const scriptPath = fileURLToPath(new URL('../../scripts/fossil-pass-lin2633.js', import.meta.url));
    const src = execFileSync('cat', [scriptPath], { encoding: 'utf8' });
    assert.match(src, /if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/,
      'same guard shape as scripts/repair-account-merge-lin2233.js');
  });
});

describe('fossil pass T20 — --execute writes, against a real MangoDB tmpdir', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'fossil-pass-script-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  async function seed(rows) {
    const db = client.db(`fossil_${counter++}`);
    const history = db.collection('dispatch-history');
    const store = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: history
    });
    for (const row of rows) await history.insertOne(row);
    return { store, history };
  }

  test('execute: true stamps every eligible row, and a re-run is a no-op (idempotent end to end)', async () => {
    const { store, history } = await seed([
      fossilRow('e1'),
      fossilRow('e2'),
      fossilRow('fresh', { dispatchedAt: daysAgo(1), resolvedAt: daysAgo(1) })
    ]);

    const first = await runFossilPass({
      dispatchStore: store,
      agentStatusStore: emptyAgentStatusStore,
      urlKeys: [URL_KEY],
      now: NOW_MS,
      execute: true,
      by: 'operator-1'
    });

    assert.equal(first.stamped.filter((s) => s.ok).length, 2, 'both fossils were stamped');
    assert.match(first.report, /EXECUTE/);
    assert.match(first.report, /## Stamped: 2 of 2 attempted/);

    const stamped = await history.findOne({ _id: 'e1' });
    assert.ok(stamped.bookkeeping, 'the stamp is on the row');
    assert.equal(stamped.bookkeeping.by, 'operator-1');
    assert.equal(stamped.bookkeeping.reason, STAMP_REASON);
    const untouched = await history.findOne({ _id: 'fresh' });
    assert.equal(untouched.bookkeeping, null, 'the fresh row was never touched');

    // A second pass finds nothing to do — the rows are now already-stamped,
    // so they are skipped at selection and never re-attempted.
    const second = await runFossilPass({
      dispatchStore: store,
      agentStatusStore: emptyAgentStatusStore,
      urlKeys: [URL_KEY],
      now: NOW_MS,
      execute: true,
      by: 'operator-2'
    });
    assert.deepEqual(second.stamped, [], 'the re-run attempts no write at all');
    assert.match(second.report, /already-stamped\s+2/);

    const reread = await history.findOne({ _id: 'e1' });
    assert.equal(reread.bookkeeping.by, 'operator-1', 'and the original stamp is unchanged');
  });

  test('a dry run against the SAME real store writes nothing (the default is safe on real data too)', async () => {
    const { store, history } = await seed([fossilRow('d1'), fossilRow('d2')]);

    const result = await runFossilPass({
      dispatchStore: store,
      agentStatusStore: emptyAgentStatusStore,
      urlKeys: [URL_KEY],
      now: NOW_MS
    });

    assert.equal(result.perWorkspace[0].selection.eligible.length, 2, 'it identified both rows');
    for (const id of ['d1', 'd2']) {
      const row = await history.findOne({ _id: id });
      assert.equal(row.bookkeeping, null, `${id} must be untouched by a dry run`);
    }
  });

  test('F2 (LIN-2653 close-out): the row must go through runFossilPass\'s own read, not a fixture bypass — a genuinely recent row is excluded, which only holds if that read is lean:false', async () => {
    // `dispatchedAt`/`resolvedAt` are 20 days old (well past FOSSIL_AGE_MS on
    // gate 2's own-signals fallback), but the row's OWN raw feedback carries
    // a `[blocked]` entry just 2 days old — real data a non-lean read
    // preserves. `runFossilPass` hardcodes `lean: false` at its one
    // `getLoopsForWorkspace` call site specifically so gate 3
    // (`ownRawLastActivityMs`) sees that entry; a `lean: true` read collapses
    // `feedback` to `[]` in `_buildLoops` (lib/pipeline-loops.js:730),
    // which falls back to the old `dispatchedAt` and would wrongly pass gate
    // 3 on "was this row dispatched long ago" alone — the exact silent
    // failure mode M17 proved by flipping that one literal and watching the
    // whole suite stay green.
    const { store } = await seed([
      fossilRow('e-recent-feedback', {
        dispatchedAt: daysAgo(20),
        resolvedAt: daysAgo(20),
        feedback: [{ message: '[blocked] need a decision', timestamp: daysAgo(2) }]
      })
    ]);

    const { perWorkspace } = await runFossilPass({
      dispatchStore: store,
      agentStatusStore: emptyAgentStatusStore,
      urlKeys: [URL_KEY],
      now: NOW_MS
    });

    const eligibleIds = perWorkspace[0].selection.eligible.map((r) => r.loopId);
    assert.ok(!eligibleIds.includes('e-recent-feedback'),
      'a row whose own raw feedback is 2 days old must not be selected on a 20-day-old dispatchedAt alone');
    const skipped = perWorkspace[0].selection.skipped.find((s) => s.loopId === 'e-recent-feedback');
    assert.equal(skipped?.reason, 'own-row-recent-activity');
  });
});

describe('fossil pass — a failed workspace read stamps nothing for that workspace', () => {
  test('a rejecting getLoopsForWorkspace is recorded and skipped; other workspaces still proceed', async () => {
    // T10 at the workspace level: the read for `broken` throws, so that
    // workspace stamps nothing at all — there is no partial-read path that
    // could stamp against half a picture.
    const store = {
      listObservedWorkspaceKeys: async () => ['broken', 'healthy'],
      listItems: async (urlKey) => {
        if (urlKey === 'broken') throw new Error('simulated read failure');
        return [];
      },
      listHistory: async (urlKey) => {
        if (urlKey === 'broken') throw new Error('simulated read failure');
        return { items: [fossilItem('h1', { urlKey: 'healthy' })], total: 1 };
      },
      stampBookkeeping: async (urlKey, id) => {
        assert.notEqual(urlKey, 'broken', 'the failed workspace must never be stamped');
        return { ok: true, item: { id } };
      }
    };

    const result = await runFossilPass({
      dispatchStore: store,
      agentStatusStore: emptyAgentStatusStore,
      now: NOW_MS,
      execute: true
    });

    const broken = result.perWorkspace.find((w) => w.urlKey === 'broken');
    assert.equal(broken.readFailed, true, 'the failure is recorded, not swallowed');
    assert.equal(broken.selection, null);
    assert.ok(!result.stamped.some((s) => s.urlKey === 'broken'), 'and nothing was stamped for it');

    assert.ok(result.stamped.some((s) => s.urlKey === 'healthy'), 'the healthy workspace still proceeded');
    assert.match(result.report, /1 FAILED: broken — stamped nothing/, 'the report names the failure honestly');
  });
});

describe('fossil pass F4 (LIN-2653 close-out) — a write error is reported as a write error, not a benign refusal', () => {
  // `stampBookkeeping`'s catch collapses BOTH "already stamped / no longer
  // taken" and "the write itself threw" into the identical
  // `{ok:false, reason:'not-found'}` shape (lib/dispatch-store.js — correct
  // for its own never-throws contract). `runFossilPass` must tell them apart
  // by reading the row back: still `taken` + `bookkeeping: null` means the
  // write never landed even though its own precondition still holds.
  function storeWithStampFailure({ postFailureStatus, postFailureBookkeeping }) {
    return {
      listObservedWorkspaceKeys: async () => [URL_KEY],
      listItems: async () => [],
      listHistory: async () => ({ items: [fossilItem('e1')], total: 1 }),
      stampBookkeeping: async () => ({ ok: false, reason: 'not-found' }),
      getItemStatus: async (_urlKey, itemId) => (itemId === 'e1'
        ? { id: itemId, status: postFailureStatus, bookkeeping: postFailureBookkeeping }
        : null)
    };
  }

  test('a row still eligible after the failed write is disposition "write-error"', async () => {
    const store = storeWithStampFailure({ postFailureStatus: 'taken', postFailureBookkeeping: null });
    const result = await runFossilPass({
      dispatchStore: store, agentStatusStore: emptyAgentStatusStore, now: NOW_MS, execute: true
    });
    assert.equal(result.stamped.length, 1);
    assert.equal(result.stamped[0].disposition, 'write-error');
    assert.match(result.report, /WRITE ERROR — still eligible after the attempt, so the write itself failed \(not a benign refusal\): 1/);
    assert.match(result.report, /e1 — not-found/);
  });

  test('a row already stamped or no longer taken by the time of the re-read is disposition "refused"', async () => {
    const store = storeWithStampFailure({
      postFailureStatus: 'taken',
      postFailureBookkeeping: { at: NOW.toISOString(), by: 'someone-else', reason: 'raced' }
    });
    const result = await runFossilPass({
      dispatchStore: store, agentStatusStore: emptyAgentStatusStore, now: NOW_MS, execute: true
    });
    assert.equal(result.stamped.length, 1);
    assert.equal(result.stamped[0].disposition, 'refused');
    assert.match(result.report, /Refused by the store's own filter \(already stamped, or no longer `taken`\): 1/);
    assert.ok(!result.report.includes('WRITE ERROR'), 'no write-error section when nothing qualifies');
  });
});

describe('fossil pass — the threshold is the imported constant', () => {
  test('selection uses FOSSIL_AGE_MS as imported, so a redefinition changes behaviour visibly', () => {
    // A row placed relative to the imported constant: if the script carried
    // its own local copy with a different value, this row's eligibility
    // would flip and this assertion would fail.
    const justPast = {
      loopId: 'x', source: 'history', historyStatus: 'taken', bookkeeping: null,
      feedback: [], terminalStatus: null, wakeMarker: null, agentState: 'running',
      dispatchedAt: new Date(NOW_MS - (FOSSIL_AGE_MS + 60_000)).toISOString(),
      agentTimestamp: null, telemetry: { metrics: [] }, lineageLastActivityMs: null,
      sessionGroupId: null, issueIdentifier: 'LIN-1', workspace: { urlKey: URL_KEY }
    };
    const result = selectFossilRows({ loops: [justPast], now: NOW_MS });
    assert.equal(result.eligible.length, 1);
  });
});
