/**
 * LIN-1470 — lineage join for GET /api/proxy/dispatch (list).
 *
 * Run with: node --test tests/unit/proxy-dispatch-lineage-join.test.js
 *
 * A repointed dispatch (a follow-up that resumes an item under a NEW history
 * row) used to freeze the ORIGINAL row's `feedbackCount`/`completedAt`/`status`
 * at the moment of repoint, because the list endpoint only ever read a row's
 * own stored feedback. This derives those three fields from the row's whole
 * `rootItemId` lineage instead: batch-fetch every OTHER row sharing an anchor
 * in one indexed query, merge (lib/dispatch-terminal.js's mergeLineageFeedback),
 * THEN apply the existing LIN-1261 abort attribution on top — ordering is
 * load-bearing (T6c).
 *
 * Cases are labelled FIX-PROVING (verified to genuinely fail against
 * pre-change `routes/proxy.js` in a scratch worktree at `b48faf0a` — see the
 * beat-3 report for the actual failure output) or STANDING-GUARD /
 * CHARACTERIZATION (pass before and after; their value is failing against a
 * *different wrong* implementation, not this one). T6a/T6b were pinned by the
 * plan as fix-proving but reclassified after verification: they pass
 * pre-change too, because the invariants they check (H12/503 projection +
 * the page limit) already held on the single pre-existing call.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const T1 = '2026-06-22T10:00:00.000Z';
const T2 = '2026-06-22T11:00:00.000Z';

// Build an app whose dispatch store returns the given live (queued) + history
// rows, via an OPTIONS-AWARE, CALL-RECORDING stub (the harness the LIN-1470
// plan pins): the lineage batch query (`rootItemId: {$in: [...]}`) is
// distinguished from the ordinary page query so both can be asserted on.
function buildApp({ queued = [], history = [] } = {}) {
  const historyCalls = [];
  const itemsCalls = [];

  const listHistory = async (urlKey, opts = {}) => {
    historyCalls.push(opts);
    if (opts.rootItemId && opts.rootItemId.$in) {
      const anchors = opts.rootItemId.$in;
      return { items: history.filter(r => anchors.includes(r.rootItemId)) };
    }
    const items = opts.limit ? history.slice(0, opts.limit) : history;
    return { items };
  };

  const listItems = async (urlKey, opts = {}) => {
    itemsCalls.push(opts);
    return queued;
  };

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { listItems, listHistory },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, historyCalls, itemsCalls };
}

async function get(app, path) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer anything' }
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// The lineage batch call is the one carrying `rootItemId.$in`; the page call
// is everything else on `listHistory`.
function lineageCallOf(historyCalls) {
  return historyCalls.find(c => c.rootItemId && c.rootItemId.$in);
}
function pageCallOf(historyCalls) {
  return historyCalls.find(c => !(c.rootItemId && c.rootItemId.$in));
}

function row(overrides = {}) {
  return {
    id: 'row-1',
    status: 'taken',
    promptName: 'implementation',
    kind: 'implementation',
    issueIdentifier: 'LIN-1470',
    issueUrl: null,
    target: 'cli',
    dispatchedAt: T1,
    resolvedAt: T1,
    feedback: [],
    ...overrides
  };
}

describe('LIN-1470 — lineage join, FIX-PROVING (fail against pre-change code)', () => {
  test('T1 — headline repoint: feedbackCount and completedAt reflect the whole lineage', async () => {
    const root = row({
      id: 'root-1', rootItemId: 'root-1',
      feedback: [{ message: 'own beat', rootItemId: 'root-1', timestamp: T1 }]
    });
    const child = row({
      id: 'child-1', rootItemId: 'root-1', followUpTo: 'root-1',
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const { app } = buildApp({ history: [root, child] });
    const { status, body } = await get(app, '/api/proxy/dispatch');
    assert.equal(status, 200);
    const item = body.items.find(i => i.id === 'root-1');
    assert.equal(item.feedbackCount, 2, 'lineage-wide count (own + child), not just own (1)');
    assert.equal(item.completedAt, T2, 'the LATER lineage terminal, not null');
  });

  test('T2a — status is lineage-derived', async () => {
    const root = row({
      id: 'root-1', rootItemId: 'root-1',
      feedback: [{ message: 'own beat', rootItemId: 'root-1', timestamp: T1 }]
    });
    const child = row({
      id: 'child-1', rootItemId: 'root-1', followUpTo: 'root-1',
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const { app } = buildApp({ history: [root, child] });
    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'root-1');
    assert.equal(item.status, 'done', 'lineage-derived, not the frozen own-feedback "taken"');
  });

  test('T2b — ?status= filter routing, both directions (asserted separately from T2a)', async () => {
    const root = row({
      id: 'root-1', rootItemId: 'root-1',
      feedback: [{ message: 'own beat', rootItemId: 'root-1', timestamp: T1 }]
    });
    const child = row({
      id: 'child-1', rootItemId: 'root-1', followUpTo: 'root-1',
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const { app } = buildApp({ history: [root, child] });

    const done = await get(app, '/api/proxy/dispatch?status=done');
    assert.ok(done.body.items.find(i => i.id === 'root-1'), 'root-1 IS present under ?status=done');
    assert.equal(done.body.total, 2, 'both root-1 (lineage-derived) and child-1 (own) are done');

    const taken = await get(app, '/api/proxy/dispatch?status=taken');
    assert.ok(!taken.body.items.find(i => i.id === 'root-1'), 'root-1 is ABSENT under ?status=taken — the field could look right while the filter still routes wrong');
    assert.equal(taken.body.total, 0);
  });

  test('T5 — the $in:[null] trap, asserted on the query itself + behaviourally', async () => {
    const modernRoot = row({
      id: 'modern-root', rootItemId: 'm-root',
      feedback: [{ message: 'own', rootItemId: 'm-root', timestamp: T1 }]
    });
    const modernChild = row({
      id: 'modern-child', rootItemId: 'm-root',
      feedback: [{ message: '[done] x', rootItemId: 'm-root', timestamp: T2 }]
    });
    // A row with an explicit null doc-level rootItemId and no entry-level
    // fallback either — the anchor MUST fall through to its own id. An
    // implementation reading `item.rootItemId` alone (no `?? item.id`
    // fallback) would put a literal `null` into the $in array here.
    const legacyRow = row({
      id: 'legacy-row', rootItemId: null,
      feedback: [{ message: '[done] legacy', timestamp: T1 }]
    });
    const { app, historyCalls } = buildApp({ history: [modernRoot, modernChild, legacyRow] });
    const { body } = await get(app, '/api/proxy/dispatch');

    const lineageCall = lineageCallOf(historyCalls);
    assert.ok(lineageCall, 'a lineage query was issued');
    assert.ok(
      lineageCall.rootItemId.$in.every(a => a != null && a !== ''),
      `$in must never contain null/empty — got ${JSON.stringify(lineageCall.rootItemId.$in)}`
    );

    // Behavioural half: the legacy row does not cross-merge with the modern lineage.
    const legacy = body.items.find(i => i.id === 'legacy-row');
    assert.equal(legacy.feedbackCount, 1, 'legacy row stays at its own count — no cross-merge');
    assert.equal(legacy.status, 'done', 'its own terminal is untouched');
  });

  test('T6c — merge-before-abort ordering: a later lineage [done] beats an earlier abort (wrong order reads "aborted")', async () => {
    const root = row({ id: 'root-1', rootItemId: 'root-1', feedback: [] });
    const child = row({
      id: 'child-1', rootItemId: 'root-1',
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    // Abort targets root-1 directly, EARLIER than the child's [done].
    const abort = row({
      id: 'abort-1', abort: true, abortTo: 'root-1', issueIdentifier: null,
      feedback: [{ message: '[aborted] cancelled', timestamp: T1 }]
    });
    const { app } = buildApp({ history: [root, child, abort] });
    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'root-1');
    // Merged-first: the lineage terminal is the LATER [done] at T2, so the F1
    // guard refuses the earlier abort. Own-feedback-only (wrong order) would
    // see root-1 with NO terminal of its own, so the abort would win instead —
    // reading 'aborted' at T1. That wrong-order failure mode is what this pins.
    assert.equal(item.status, 'done', 'lineage terminal wins; wrong order would read "aborted"');
    assert.equal(item.completedAt, T2);
  });

  test('T7 — query count is constant in N (2 history reads regardless of row/lineage count)', async () => {
    // Small: 3 rows across 2 lineages.
    {
      const small = [
        row({ id: 'a1', rootItemId: 'l1', feedback: [{ message: 'x', rootItemId: 'l1', timestamp: T1 }] }),
        row({ id: 'a2', rootItemId: 'l1', feedback: [{ message: '[done] x', rootItemId: 'l1', timestamp: T2 }] }),
        row({ id: 'b1', rootItemId: 'l2', feedback: [{ message: 'y', rootItemId: 'l2', timestamp: T1 }] })
      ];
      const { app, historyCalls, itemsCalls } = buildApp({ history: small });
      await get(app, '/api/proxy/dispatch');
      assert.equal(historyCalls.length, 2, 'page call + one batched lineage call, small case');
      assert.equal(itemsCalls.length, 1);
    }
    // Larger: 30 rows across 10 lineages.
    {
      const large = [];
      for (let i = 0; i < 10; i++) {
        const anchor = `lineage-${i}`;
        for (let j = 0; j < 3; j++) {
          large.push(row({
            id: `${anchor}-${j}`, rootItemId: anchor,
            feedback: [{ message: j === 2 ? '[done] x' : 'beat', rootItemId: anchor, timestamp: T1 }]
          }));
        }
      }
      const { app, historyCalls, itemsCalls } = buildApp({ history: large });
      await get(app, '/api/proxy/dispatch');
      assert.equal(historyCalls.length, 2, 'STILL page call + one batched lineage call — not 2+N — large case');
      assert.equal(itemsCalls.length, 1);
    }
  });
});

describe('LIN-1470 — lineage join, STANDING GUARD / CHARACTERIZATION (pass before and after)', () => {
  // T6a/T6b were pinned by the plan as "fail today" but RECLASSIFIED here
  // (beat 3, per the instruction to verify each fix-proving case against a
  // pre-change worktree rather than assume the classification): both pass
  // against pre-change `routes/proxy.js` too, because the invariants they
  // check — `projection:{prompt:0}` and the page call's `limit:200` — already
  // held on the SINGLE pre-existing `listHistory` call (H12/503 guards from
  // f5a94a53/15ca7b47, which predate this ticket). They are real regression
  // guards for THIS diff — a broken implementation that adds the new lineage
  // query without projection, or drops the page call's limit, fails them —
  // just not proof the original bug existed.
  test('T6a — every recorded call (including the new lineage query) carries projection:{prompt:0}', async () => {
    const root = row({ id: 'root-1', rootItemId: 'root-1', feedback: [{ message: 'own', rootItemId: 'root-1', timestamp: T1 }] });
    const child = row({ id: 'child-1', rootItemId: 'root-1', feedback: [{ message: '[done] x', rootItemId: 'root-1', timestamp: T2 }] });
    const { app, historyCalls, itemsCalls } = buildApp({ history: [root, child] });
    await get(app, '/api/proxy/dispatch');

    // Deliberately no precondition on historyCalls.length here — T7 owns that
    // assertion. This check holds over WHATEVER calls were actually made,
    // which is exactly why it passes vacuously pre-fix (one call, already
    // compliant) and is a standing guard rather than fix-proving.
    for (const call of [...historyCalls, ...itemsCalls]) {
      assert.deepEqual(call.projection, { prompt: 0 }, `every call must exclude prompt — got ${JSON.stringify(call)}`);
    }
  });

  test('T6b — the page call still carries limit:200', async () => {
    const root = row({ id: 'root-1', rootItemId: 'root-1' });
    const { app, historyCalls } = buildApp({ history: [root] });
    await get(app, '/api/proxy/dispatch');
    const pageCall = pageCallOf(historyCalls);
    assert.ok(pageCall, 'a page (non-lineage) history call was issued');
    assert.equal(pageCall.limit, 200);
  });

  test('T3 — sibling non-collapse (LIN-1461 standing guard): shared sessionId/sessionGroupId must NOT merge distinct rootItemIds', async () => {
    const wa = row({
      id: 'wa', rootItemId: 'wa-root', sessionId: 'orch-1', sessionGroupId: 'orch-1',
      feedback: [{ message: '[done] wa finished', rootItemId: 'wa-root', timestamp: T1 }]
    });
    const wb = row({
      id: 'wb', rootItemId: 'wb-root', sessionId: 'orch-1', sessionGroupId: 'orch-1',
      feedback: [{ message: '[working · running] 2 tools in 10s', rootItemId: 'wb-root', timestamp: T1 }]
    });
    const { app } = buildApp({ history: [wa, wb] });
    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'wb');
    assert.notEqual(item.status, 'done', 'wb must NOT inherit wa\'s terminal via the shared sessionId/sessionGroupId — that is the LIN-1461 bug');
    assert.equal(item.completedAt, null);
    assert.equal(item.feedbackCount, 1, 'wb keeps only its own entry');
  });

  test('T4 — unbackfilled legacy rows (characterization): byte-identical to today, no cross-merge', async () => {
    const legacyDone = row({
      id: 'legacy-done',
      feedback: [{ message: '[done] finished', timestamp: T1 }]
    });
    const legacyHeartbeat = row({
      id: 'legacy-heartbeat',
      feedback: [{ message: '[working · running] 1 tool in 5s', timestamp: T1 }]
    });
    const { app } = buildApp({ history: [legacyDone, legacyHeartbeat] });
    const { body } = await get(app, '/api/proxy/dispatch');

    const done = body.items.find(i => i.id === 'legacy-done');
    assert.equal(done.status, 'done');
    assert.equal(done.completedAt, T1);
    assert.equal(done.feedbackCount, 1);

    const heartbeat = body.items.find(i => i.id === 'legacy-heartbeat');
    assert.notEqual(heartbeat.status, 'done');
    assert.equal(heartbeat.completedAt, null);
    assert.equal(heartbeat.feedbackCount, 1);
  });
});

describe('LIN-1470 — beat 4 audit finding: queued rows must not join the lineage', () => {
  test('T9 — a freshly-queued follow-up does NOT inherit a completed parent\'s terminal status/completedAt/feedbackCount', async () => {
    // The common real trigger: a human replies to a FINISHED session
    // (session.js's reply box, LIN-1004) — POSTs a new dispatch with
    // followUpTo=<finished session>, target cli/web. dispatch-factory.js
    // inherits rootItemId onto the new item the same way sessionGroupId
    // inheritance already works. The new item sits QUEUED (not yet taken) —
    // it must read as queued/null/0 until it actually runs, not silently
    // "done" from a lineage sibling that already finished.
    const parentDone = row({
      id: 'parent-1', rootItemId: 'root-x', status: 'done',
      feedback: [{ message: '[done] finished beat 1', rootItemId: 'root-x', timestamp: T1 }]
    });
    const freshFollowUp = row({
      id: 'followup-1', rootItemId: 'root-x', followUpTo: 'parent-1'
      // no feedback field — a brand-new queued item has none yet
    });
    delete freshFollowUp.feedback;
    delete freshFollowUp.resolvedAt;

    const { app } = buildApp({ queued: [freshFollowUp], history: [parentDone] });
    const { body } = await get(app, '/api/proxy/dispatch');

    const followUp = body.items.find(i => i.id === 'followup-1');
    assert.equal(followUp.status, 'queued', 'must NOT inherit the parent\'s "done"');
    assert.equal(followUp.completedAt, null, 'must NOT inherit the parent\'s completedAt');
    assert.equal(followUp.feedbackCount, 0, 'a queued row has posted no feedback of its own yet');

    // Sanity: the history parent is unaffected by this guard — it still
    // gets its own (here, unremarkable) lineage-derived fields normally.
    const parent = body.items.find(i => i.id === 'parent-1');
    assert.equal(parent.status, 'done');
    assert.equal(parent.completedAt, T1);
    assert.equal(parent.feedbackCount, 1);
  });
});

describe('LIN-1470 — beat 4 audit: abort rows × lineage merge (defense in depth)', () => {
  test('T10 — an abort row\'s untagged [aborted] feedback is never absorbed as another row\'s lineage feedback, even under a hypothetical rootItemId collision', async () => {
    // Verified (beat 4) that this codebase never actually produces this
    // collision: an abort row's doc-level rootItemId always defaults to its
    // OWN freshly-minted id (lib/dispatch-store.js addItem: `item.rootItemId
    // || doc._id`, and dispatch-factory.js's rootItemId inheritance is gated
    // on `followUpTo`, which routes reject alongside `abort`), and
    // simple-dispatcher's abort branch posts the `[aborted]` marker to the
    // abort row's OWN feedback with no `rootItemId` tag at all. This test
    // pins the SECOND, independent layer of protection: even if a future
    // change broke that non-collision (an abort row ending up doc-level
    // rootItemId-tagged the SAME as a sibling it targets), the entry-level
    // `f.rootItemId === anchor` filter in mergeLineageFeedback still refuses
    // an untagged feedback entry, so the abort message could not leak into
    // another row's feedbackCount/status outside the deliberate
    // harvestAbortedTargets/feedbackWithHarvestedAbort(abortTo) path.
    const sibling = row({
      id: 'sibling-1', rootItemId: 'root-y',
      feedback: [{ message: 'own beat', rootItemId: 'root-y', timestamp: T1 }]
    });
    // Hypothetical: an abort row that DOES collide on doc-level rootItemId
    // with the sibling's anchor, but — matching real simple-dispatcher
    // behaviour — posts its [aborted] marker WITHOUT a rootItemId tag.
    const collidingAbort = row({
      id: 'abort-collide', rootItemId: 'root-y', abort: true, abortTo: 'some-other-target', issueIdentifier: null,
      feedback: [{ message: '[aborted] cancelled', timestamp: T2 }] // no rootItemId tag — matches dispatcher.js:479
    });
    const { app } = buildApp({ history: [sibling, collidingAbort] });
    const { body } = await get(app, '/api/proxy/dispatch');

    const item = body.items.find(i => i.id === 'sibling-1');
    assert.equal(item.feedbackCount, 1, 'the untagged abort entry must NOT be absorbed into feedbackCount');
    assert.notEqual(item.status, 'aborted', 'the untargeted abort must not hijack this row\'s status via the generic merge');
  });
});

describe('LIN-1470 — open question (beat 3): lineage query bound', () => {
  test('T8 — the lineage batch query carries a defensive limit', async () => {
    const root = row({ id: 'root-1', rootItemId: 'root-1' });
    const { app, historyCalls } = buildApp({ history: [root] });
    await get(app, '/api/proxy/dispatch');
    const lineageCall = lineageCallOf(historyCalls);
    assert.ok(lineageCall, 'a lineage query was issued');
    assert.equal(typeof lineageCall.limit, 'number', 'the lineage query is bounded, not unbounded');
    assert.ok(lineageCall.limit >= 200, 'generous enough to never truncate a realistic lineage');
  });
});
