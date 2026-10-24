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
import { seededStore } from '../fixtures/dispatch-list-store.js';

const T1 = '2026-06-22T10:00:00.000Z';
const T2 = '2026-06-22T11:00:00.000Z';

// Build an app over a REAL store seeded with the given live (queued) + history rows
// (tests/fixtures/dispatch-list-store.js). LIN-3812: the list reads the lineage
// status/completedAt/feedbackCount PERSISTED on each history row, derived at write
// time; a seeded row has none yet, so the store's read-time self-heal derives it,
// which is the same derivation (lib/dispatch-lineage-status.js) every writer runs.
async function buildApp({ queued = [], history = [] } = {}) {
  const store = await seededStore({ queued, history });
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
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, store };
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
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
    const { app } = await buildApp({ history: [root, child] });
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
    const { app } = await buildApp({ history: [root, child] });
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
    const { app } = await buildApp({ history: [root, child] });

    const done = await get(app, '/api/proxy/dispatch?status=done');
    assert.ok(done.body.items.find(i => i.id === 'root-1'), 'root-1 IS present under ?status=done');
    assert.equal(done.body.total, 2, 'both root-1 (lineage-derived) and child-1 (own) are done');

    const taken = await get(app, '/api/proxy/dispatch?status=taken');
    assert.ok(!taken.body.items.find(i => i.id === 'root-1'), 'root-1 is ABSENT under ?status=taken — the field could look right while the filter still routes wrong');
    assert.equal(taken.body.total, 0);
  });

  test('T5 — the null-anchor trap: a row with no anchor falls through to its own id (never a null lineage key)', async () => {
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
    const { app } = await buildApp({ history: [modernRoot, modernChild, legacyRow] });
    const { body } = await get(app, '/api/proxy/dispatch');

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
    const { app } = await buildApp({ history: [root, child, abort] });
    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'root-1');
    // Merged-first: the lineage terminal is the LATER [done] at T2, so the F1
    // guard refuses the earlier abort. Own-feedback-only (wrong order) would
    // see root-1 with NO terminal of its own, so the abort would win instead —
    // reading 'aborted' at T1. That wrong-order failure mode is what this pins.
    assert.equal(item.status, 'done', 'lineage terminal wins; wrong order would read "aborted"');
    assert.equal(item.completedAt, T2);
  });

});

describe('LIN-1470 — lineage join, STANDING GUARD / CHARACTERIZATION (pass before and after)', () => {
  // Review F6 (verified, not taken on restatement): T3 does NOT catch a
  // coherent re-key of the anchor to sessionId/sessionGroupId (anchor +
  // query field + sibling grouping all switched together) — re-running that
  // exact mutation leaves T3 green, because wa/wb's feedback entries carry
  // `rootItemId: 'wa-root'`/`'wb-root'`, and mergeLineageFeedback's
  // entry-level `entry.rootItemId === anchor` filter (lib/dispatch-terminal.js)
  // rejects them against the wrong anchor regardless of which field the
  // candidate query and grouping used. T1/T2a/T2b/T5/T6c are what actually
  // catch that mutation (their fixtures tag feedback entries with the SAME
  // rootItemId as the row, so a wrong anchor lets the entry filter through).
  // Only disabling the entry-level filter TOO makes T3 fail — verified by
  // doing exactly that. So T3 is still real coverage (LIN-1461: shared
  // sessionId/sessionGroupId must not collapse distinct lineages), just not
  // for the anchor-rekey mutation class; it's two independent layers, and
  // this test pins the entry-level one when the anchor itself is correct.
  test('T3 — sibling non-collapse (LIN-1461 standing guard): shared sessionId/sessionGroupId must NOT merge distinct rootItemIds', async () => {
    const wa = row({
      id: 'wa', rootItemId: 'wa-root', sessionId: 'orch-1', sessionGroupId: 'orch-1',
      feedback: [{ message: '[done] wa finished', rootItemId: 'wa-root', timestamp: T1 }]
    });
    const wb = row({
      id: 'wb', rootItemId: 'wb-root', sessionId: 'orch-1', sessionGroupId: 'orch-1',
      feedback: [{ message: '[working · running] 2 tools in 10s', rootItemId: 'wb-root', timestamp: T1 }]
    });
    const { app } = await buildApp({ history: [wa, wb] });
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
    const { app } = await buildApp({ history: [legacyDone, legacyHeartbeat] });
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

    const { app } = await buildApp({ queued: [freshFollowUp], history: [parentDone] });
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
    const { app } = await buildApp({ history: [sibling, collidingAbort] });
    const { body } = await get(app, '/api/proxy/dispatch');

    const item = body.items.find(i => i.id === 'sibling-1');
    assert.equal(item.feedbackCount, 1, 'the untagged abort entry must NOT be absorbed into feedbackCount');
    assert.notEqual(item.status, 'aborted', 'the untargeted abort must not hijack this row\'s status via the generic merge');
  });
});

describe('LIN-1470 — review F1: archived cancelled/expired rows must NOT join the lineage', () => {
  // F1 (review of PR #971): the beat-4 carve-out excluded `status === 'queued'`,
  // but `_archiveItem` (lib/dispatch-store.js) is called with exactly THREE
  // statuses — 'taken' (:678), 'cancelled' (:635), 'expired' (:715) — so a
  // `!== 'queued'` denylist also let cancelled/expired archived rows join the
  // lineage and inherit a sibling's terminal feedback. Reachable ordinarily: a
  // follow-up enqueued after its parent already posted `[done]`, then
  // cancelled or expired before being taken. T9 only pinned the queued
  // instance; these pin the other two members of the same class.
  test('T11 — a cancelled follow-up does NOT inherit a completed lineage sibling\'s terminal status/completedAt/feedbackCount', async () => {
    const parentDone = row({
      id: 'parent-1', rootItemId: 'root-1',
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const cancelledChild = row({
      id: 'child-cancelled', rootItemId: 'root-1', followUpTo: 'parent-1', status: 'cancelled', feedback: []
    });
    const { app } = await buildApp({ history: [parentDone, cancelledChild] });
    const { body } = await get(app, '/api/proxy/dispatch');

    const child = body.items.find(i => i.id === 'child-cancelled');
    assert.equal(child.status, 'cancelled', 'must NOT inherit the sibling\'s "done"');
    assert.equal(child.completedAt, null, 'must NOT inherit the sibling\'s completedAt');
    assert.equal(child.feedbackCount, 0, 'a cancelled row reports only its own (empty) feedback');

    const doneList = await get(app, '/api/proxy/dispatch?status=done');
    assert.ok(!doneList.body.items.find(i => i.id === 'child-cancelled'), 'must not be routed into ?status=done');
    const cancelledList = await get(app, '/api/proxy/dispatch?status=cancelled');
    assert.ok(cancelledList.body.items.find(i => i.id === 'child-cancelled'), 'must still be found under its own ?status=cancelled');
  });

  test('T12 — an expired follow-up does NOT inherit a completed lineage sibling\'s terminal status/completedAt/feedbackCount', async () => {
    const parentDone = row({
      id: 'parent-1', rootItemId: 'root-1',
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const expiredChild = row({
      id: 'child-expired', rootItemId: 'root-1', followUpTo: 'parent-1', status: 'expired', feedback: []
    });
    const { app } = await buildApp({ history: [parentDone, expiredChild] });
    const { body } = await get(app, '/api/proxy/dispatch');

    const child = body.items.find(i => i.id === 'child-expired');
    assert.equal(child.status, 'expired', 'must NOT inherit the sibling\'s "done"');
    assert.equal(child.completedAt, null, 'must NOT inherit the sibling\'s completedAt');
    assert.equal(child.feedbackCount, 0, 'an expired row reports only its own (empty) feedback');

    const doneList = await get(app, '/api/proxy/dispatch?status=done');
    assert.ok(!doneList.body.items.find(i => i.id === 'child-expired'), 'must not be routed into ?status=done');
    const expiredList = await get(app, '/api/proxy/dispatch?status=expired');
    assert.ok(expiredList.body.items.find(i => i.id === 'child-expired'), 'must still be found under its own ?status=expired');
  });
});

describe('LIN-1470 — review L4: cross-issue lineage under ?issueIdentifier= scoping', () => {
  // L4 (review): reviewer decision #2 accepted this as correct-by-design
  // ("rootItemId already isolates the lineage; inheriting the issue scope
  // would drop siblings") but noted it was pinned by no test. The lineage
  // batch query is deliberately NOT scoped by issueIdentifier, so a row can
  // report complete via a sibling filed under a DIFFERENT issue that never
  // itself appears in the same scoped list.
  test('L4 — a row completes via a same-lineage sibling filed under a different issue, which itself is excluded from the scoped list', async () => {
    const root = row({
      id: 'root-1', rootItemId: 'root-1', issueIdentifier: 'LIN-A',
      feedback: [{ message: 'own beat', rootItemId: 'root-1', timestamp: T1 }]
    });
    const crossIssueChild = row({
      id: 'child-1', rootItemId: 'root-1', followUpTo: 'root-1', issueIdentifier: 'LIN-B',
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const { app } = await buildApp({ history: [root, crossIssueChild] });

    const scoped = await get(app, '/api/proxy/dispatch?issueIdentifier=LIN-A');
    const item = scoped.body.items.find(i => i.id === 'root-1');
    assert.ok(item, 'root-1 (issueIdentifier LIN-A) is present under its own scope');
    assert.equal(item.status, 'done', 'completes via the LIN-B sibling despite the LIN-A scope');
    assert.equal(item.completedAt, T2);
    assert.equal(item.feedbackCount, 2, 'lineage-wide, including the cross-issue sibling');
    assert.ok(!scoped.body.items.find(i => i.id === 'child-1'), 'the LIN-B sibling itself never appears in the LIN-A-scoped list');

    // Sanity: the sibling's OWN scope shows it directly, unaffected.
    const otherScoped = await get(app, '/api/proxy/dispatch?issueIdentifier=LIN-B');
    assert.ok(otherScoped.body.items.find(i => i.id === 'child-1'), 'child-1 is visible under its own LIN-B scope');
  });
});

describe('LIN-1470 — review F7: forward-only merge invariant (a row is never reported complete before it was dispatched)', () => {
  // F1 (T9/T11/T12) closed WHICH ROWS may join a lineage (status allowlist).
  // F7 found the real axis is WHICH FEEDBACK a joined row may inherit: a
  // still-running (`taken`) follow-up dispatched AFTER its parent already
  // finished was joining the lineage and absorbing the parent's earlier
  // terminal — no status predicate can close that, since the row genuinely
  // IS `taken`. The grid below is deliberately the full status × timing
  // cross-product asked for at review, not one more single-cell carve-out:
  // for queued/cancelled/expired, `joinsLineage` already excludes the row
  // regardless of timing (characterization, mirrors T9/T11/T12); for `taken`,
  // timing is the whole story (fix-proving).
  const DISPATCH_T = '2026-06-22T12:00:00.000Z'; // the row under test's own dispatchedAt
  const BEFORE = '2026-06-22T11:00:00.000Z';     // sibling terminal BEFORE the row was dispatched
  const AFTER = '2026-06-22T13:00:00.000Z';      // sibling terminal AT/AFTER the row was dispatched

  const STATUSES = ['queued', 'taken', 'cancelled', 'expired'];
  const TIMINGS = [
    { name: 'sibling terminal BEFORE this row\'s dispatchedAt', ts: BEFORE, forwardOfDispatch: false },
    { name: 'sibling terminal AT/AFTER this row\'s dispatchedAt', ts: AFTER, forwardOfDispatch: true }
  ];

  for (const status of STATUSES) {
    for (const timing of TIMINGS) {
      test(`status=${status} x ${timing.name} — invariant holds`, async () => {
        const parent = row({
          id: 'parent-1', rootItemId: 'root-1', dispatchedAt: T1,
          feedback: [{ message: 'own beat', rootItemId: 'root-1', timestamp: T1 }]
        });
        const sibling = row({
          id: 'sibling-1', rootItemId: 'root-1', followUpTo: 'parent-1', dispatchedAt: T1,
          feedback: [{ message: '[done] sibling finished', rootItemId: 'root-1', timestamp: timing.ts }]
        });
        const target = row({
          id: 'target-1', rootItemId: 'root-1', followUpTo: 'sibling-1',
          status, dispatchedAt: DISPATCH_T, feedback: []
        });

        // Only 'taken' rows join the lineage at all (the F1 allowlist); the
        // other three statuses are exercised via listItems (queued) or
        // listHistory (cancelled/expired) exactly as T9/T11/T12 do.
        const queued = status === 'queued' ? [target] : [];
        const history = status === 'queued' ? [parent, sibling] : [parent, sibling, target];

        const { app } = await buildApp({ queued, history });
        const { body } = await get(app, '/api/proxy/dispatch');
        const item = body.items.find(i => i.id === 'target-1');

        const canJoin = status === 'taken';
        const shouldInherit = canJoin && timing.forwardOfDispatch;

        assert.equal(item.status, shouldInherit ? 'done' : status,
          `status mismatch for ${status} x ${timing.name}`);
        assert.equal(item.completedAt, shouldInherit ? timing.ts : null,
          `completedAt mismatch for ${status} x ${timing.name}`);
        assert.equal(item.feedbackCount, shouldInherit ? 1 : 0,
          `feedbackCount mismatch for ${status} x ${timing.name}`);

        // The invariant itself, stated directly rather than inferred from
        // the field assertions above: never complete before dispatched.
        if (item.completedAt) {
          assert.ok(
            new Date(item.completedAt).getTime() >= new Date(DISPATCH_T).getTime(),
            `completedAt (${item.completedAt}) must not precede this row's own dispatchedAt (${DISPATCH_T})`
          );
        }

        // `?status=` routing must agree with the field, in both directions.
        const ownStatusList = await get(app, `/api/proxy/dispatch?status=${shouldInherit ? 'done' : status}`);
        assert.ok(ownStatusList.body.items.find(i => i.id === 'target-1'),
          `must be found under its own resolved status (${shouldInherit ? 'done' : status})`);
        if (!shouldInherit) {
          const doneList = await get(app, '/api/proxy/dispatch?status=done');
          assert.ok(!doneList.body.items.find(i => i.id === 'target-1'),
            'must not be routed into ?status=done when it has not earned that terminal');
        }
      });
    }
  }

  test('headline case (T1) still holds under the forward-only guard: an EARLIER original inherits a LATER follow-up\'s completion', async () => {
    // Sanity that the fix does not regress the ticket's own motivating case.
    // The original is dispatched at T1, before its follow-up's T2 completion,
    // so the forward-only comparison (entry timestamp >= original's own
    // dispatchedAt) passes trivially.
    const root = row({
      id: 'root-1', rootItemId: 'root-1', dispatchedAt: T1,
      feedback: [{ message: 'own beat', rootItemId: 'root-1', timestamp: T1 }]
    });
    const child = row({
      id: 'child-1', rootItemId: 'root-1', followUpTo: 'root-1', dispatchedAt: T2,
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const { app } = await buildApp({ history: [root, child] });
    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'root-1');
    assert.equal(item.feedbackCount, 2, 'still lineage-wide (own + child)');
    assert.equal(item.completedAt, T2, 'still inherits the later lineage terminal');
    assert.equal(item.status, 'done');
  });

  test('F7 repro fixture: a running (taken) follow-up dispatched AFTER its already-finished parent must NOT inherit the parent\'s terminal', async () => {
    const parent = row({
      id: 'parent-1', rootItemId: 'root-1', dispatchedAt: T1,
      feedback: [{ message: '[done] finished', rootItemId: 'root-1', timestamp: T2 }]
    });
    const runningFollowUp = row({
      id: 'followup-1', rootItemId: 'root-1', followUpTo: 'parent-1',
      dispatchedAt: DISPATCH_T, // AFTER the parent's own T2 completion
      feedback: []
    });
    const { app } = await buildApp({ history: [parent, runningFollowUp] });

    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'followup-1');
    assert.equal(item.status, 'taken', 'still running — must not read as "done"');
    assert.equal(item.completedAt, null, 'must not report a completedAt earlier than its own dispatchedAt');
    assert.equal(item.feedbackCount, 0, 'must not absorb the parent\'s earlier feedback entry');

    const takenList = await get(app, '/api/proxy/dispatch?status=taken');
    assert.ok(takenList.body.items.find(i => i.id === 'followup-1'), 'must still be found under ?status=taken');
    const doneList = await get(app, '/api/proxy/dispatch?status=done');
    assert.ok(!doneList.body.items.find(i => i.id === 'followup-1'), 'must NOT be routed into ?status=done');
  });
});

// LIN-3812 (closes LIN-2120): there is no read window any more. `total` is the exact
// count of matching rows (queued + the database's count), `?status=` is a database
// predicate on the persisted lineage status, and a lineage is no longer capped.
describe('LIN-3812 — the list on persisted lineage fields (the four intended value changes)', () => {
  function plainRows(count, { issueIdentifier = 'LIN-3812', feedback = [], resolvedBase = 0 } = {}) {
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(row({ id: `h-${issueIdentifier}-${i}`, issueIdentifier, feedback, resolvedAt: new Date(Date.UTC(2026, 5, 1) + (resolvedBase + i) * 1000).toISOString(), dispatchedAt: new Date(Date.UTC(2026, 5, 1) + (resolvedBase + i) * 1000).toISOString() }));
    }
    return rows;
  }

  test('total is exact past the old 200-row window, unfiltered and issue-scoped; truncated is never a window disclosure', async () => {
    const history = [...plainRows(250, { issueIdentifier: 'LIN-A' }), ...plainRows(5, { issueIdentifier: 'LIN-B' })];
    const queuedRow = { ...row({ id: 'q-1' }), status: 'queued' };
    const { app } = await buildApp({ queued: [queuedRow], history });

    const all = await get(app, '/api/proxy/dispatch');
    assert.equal(all.body.total, 1 + 255);
    assert.equal(all.body.truncated, false);
    const scoped = await get(app, '/api/proxy/dispatch?issueIdentifier=LIN-A');
    assert.equal(scoped.body.total, 250);
    assert.equal(scoped.body.items.length, 20);
  });

  test('intended change 4 / LIN-2120: ?status= pages in the database — a done row older than the newest 200 is found, and total is exact', async () => {
    const oldDone = plainRows(3, { issueIdentifier: 'LIN-OLD', feedback: [{ message: '[done] finished', timestamp: T1 }], resolvedBase: 0 });
    const newerRunning = plainRows(250, { issueIdentifier: 'LIN-NEW', resolvedBase: 1000 });
    const { app } = await buildApp({ history: [...oldDone, ...newerRunning] });

    const done = await get(app, '/api/proxy/dispatch?status=done&limit=100');
    assert.equal(done.body.total, 3, 'exact DB-side total under a status filter (was the windowed filtered.length)');
    assert.deepEqual(done.body.items.map(i => i.id).sort(), oldDone.map(r => r.id).sort(), 'rows the old newest-200 window never reached');
    assert.equal(done.body.truncated, false);
    const taken = await get(app, '/api/proxy/dispatch?status=taken&limit=100');
    assert.equal(taken.body.total, 250);
  });

  test('intended change 3: a lineage past the old LINEAGE_QUERY_LIMIT (2,000 siblings) reports its whole lineage', async () => {
    const siblings = [];
    for (let i = 0; i < 2100; i++) {
      siblings.push(row({ id: `sib-${i}`, rootItemId: 'big', issueIdentifier: 'LIN-BIG', feedback: [{ message: i === 0 ? '[done] finished' : 'beat', rootItemId: 'big', timestamp: T2 }] }));
    }
    const root = row({ id: 'big', rootItemId: 'big', issueIdentifier: 'LIN-BIG', feedback: [] });
    const { app } = await buildApp({ history: [root, ...siblings] });
    const { body } = await get(app, '/api/proxy/dispatch?issueIdentifier=LIN-BIG&limit=100');
    const item = body.items.find(i => i.id === 'big');
    assert.equal(item.feedbackCount, 2100);
    assert.equal(item.status, 'done');
  });

  test('intended change 1: an issue-scoped list attributes an abort to its target (the abort row carries issueIdentifier null)', async () => {
    const target = row({ id: 'target-1', rootItemId: 'target-1', issueIdentifier: 'LIN-AB', feedback: [{ message: '[working] x', rootItemId: 'target-1', timestamp: T1 }] });
    const abort = row({ id: 'abort-1', abort: true, abortTo: 'target-1', issueIdentifier: null, feedback: [{ message: '[aborted] cancelled', timestamp: T2 }] });
    const { app } = await buildApp({ history: [target, abort] });
    const { body } = await get(app, '/api/proxy/dispatch?issueIdentifier=LIN-AB');
    const item = body.items.find(i => i.id === 'target-1');
    assert.equal(item.status, 'aborted');
    assert.equal(item.completedAt, T2);
  });

  test('intended change 2: abort attribution does not depend on the abort row being inside the newest-200 window', async () => {
    const target = row({ id: 'target-1', rootItemId: 'target-1', issueIdentifier: 'LIN-AB', feedback: [{ message: '[working] x', rootItemId: 'target-1', timestamp: T1 }], resolvedAt: '2026-06-22T20:00:00.000Z' });
    const abort = row({ id: 'abort-1', abort: true, abortTo: 'target-1', issueIdentifier: null, feedback: [{ message: '[aborted] cancelled', timestamp: T2 }], resolvedAt: '2026-06-01T00:00:00.000Z' });
    const filler = plainRows(250, { issueIdentifier: 'LIN-FILL', resolvedBase: 100000 });
    const { app } = await buildApp({ history: [target, abort, ...filler] });
    const { body } = await get(app, '/api/proxy/dispatch?status=aborted');
    assert.ok(body.items.find(i => i.id === 'target-1'), 'the target is aborted although its abort row is far outside the newest 200');
  });

  test('F1 — the page is chosen by dispatchedAt, not resolvedAt: limit=1 returns the later-dispatched row even when it resolved earlier', async () => {
    const A = row({ id: 'A', status: 'taken', dispatchedAt: '2026-06-22T10:00:00.000Z', resolvedAt: '2026-06-22T12:00:00.000Z' });
    const X = row({ id: 'X', status: 'cancelled', dispatchedAt: '2026-06-22T11:00:00.000Z', resolvedAt: '2026-06-22T11:05:00.000Z' });
    const { app } = await buildApp({ history: [A, X] });
    const { body } = await get(app, '/api/proxy/dispatch?limit=1');
    assert.deepEqual(body.items.map(i => i.id), ['X'], 'base answered X: newest dispatch first, then sliced');
    assert.equal(body.total, 2);
  });

  test('F2 — a stale persisted row is never served under a ?status= its healed status does not match, and total drops it', async () => {
    // The state after a recompute lost every CAS (or threw): own [done], persisted lineageStatus null, bases apart.
    const stale = row({
      id: 'stale-1', feedback: [{ message: '[done] finished', timestamp: T2 }],
      lineageStatus: null, lineageBasis: 1, lineageStatusBasis: 0
    });
    const { app } = await buildApp({ history: [stale] });
    const taken = await get(app, '/api/proxy/dispatch?status=taken');
    assert.deepEqual(taken.body.items, [], 'healed to done, so it does not belong to ?status=taken');
    assert.equal(taken.body.total, 0);
    const unfiltered = await get(app, '/api/proxy/dispatch');
    assert.equal(unfiltered.body.items.find(i => i.id === 'stale-1').status, 'done');
  });
});

/**
 * LIN-2079 S3/S8 — `blocked` as a derived status on the LIST endpoint, and the
 * filter-semantics change that rides the same single assignment.
 *
 * The one assignment at the `resolved` map is read three times: the reported
 * `status` field, the `?status=` FILTER, and `total` (which follows
 * `filtered.length`). Deriving `blocked` there is therefore a wire-behaviour
 * change, not a field rename: `?status=taken` stops returning rows parked on a
 * human, and `?status=blocked` starts returning exactly those. That is the
 * ticket's own "listing filter that separates live items from tombstones" ask,
 * and these cases pin it in both directions rather than leaving it implicit.
 */
describe('LIN-2079 — derived `blocked` on the list endpoint (FIX-PROVING)', () => {
  const blockedEntry = (at = T2, rootItemId = 'root-b') => ({
    message: '[blocked] needs a human decision on the schema', rootItemId, timestamp: at
  });

  test('B1 — a [blocked]-only row: absent from ?status=taken, returned by ?status=blocked, reported as blocked unfiltered', async () => {
    const parked = row({ id: 'parked-1', rootItemId: 'root-b', feedback: [blockedEntry()] });
    const running = row({ id: 'running-1', rootItemId: 'root-r', feedback: [{ message: '[working] still going', rootItemId: 'root-r', timestamp: T1 }] });
    const { app } = await buildApp({ history: [parked, running] });

    const unfiltered = await get(app, '/api/proxy/dispatch');
    assert.equal(unfiltered.body.items.find(i => i.id === 'parked-1').status, 'blocked',
      'the reported field derives blocked instead of falling back to stored taken');
    assert.equal(unfiltered.body.items.find(i => i.id === 'running-1').status, 'taken',
      'a genuinely running row is untouched');
    assert.equal(unfiltered.body.items.length, 2, 'unfiltered returns the SAME rows as before — only the status string moved');

    const taken = await get(app, '/api/proxy/dispatch?status=taken');
    assert.ok(!taken.body.items.find(i => i.id === 'parked-1'), 'a parked row no longer pollutes the taken listing');
    assert.ok(taken.body.items.find(i => i.id === 'running-1'), 'the live row is still there');
    assert.equal(taken.body.total, 1, 'total tracks filtered.length on a ?status= read');

    const blocked = await get(app, '/api/proxy/dispatch?status=blocked');
    assert.deepEqual(blocked.body.items.map(i => i.id), ['parked-1'], '?status=blocked is queryable and returns exactly the parked rows');
    assert.equal(blocked.body.total, 1, 'total tracks filtered.length here too');
  });

  test('B2 — a blocked row reports completedAt: null (a parked run has not completed)', async () => {
    const parked = row({ id: 'parked-1', rootItemId: 'root-b', feedback: [blockedEntry()] });
    const { app } = await buildApp({ history: [parked] });

    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'parked-1');
    assert.equal(item.status, 'blocked');
    assert.equal(item.completedAt, null, 'blocked must never stamp a completion time');
    assert.equal(item.feedbackCount, 1);
  });

  test('B3 — ORDERING: a later lineage [done] beats an earlier [blocked] (no un-finishing, no completedAt rewind)', async () => {
    const root = row({ id: 'root-1', rootItemId: 'root-1', feedback: [
      { message: '[blocked] waiting on a decision', rootItemId: 'root-1', timestamp: T1 }
    ] });
    const child = row({ id: 'child-1', rootItemId: 'root-1', followUpTo: 'root-1', feedback: [
      { message: '[done] unblocked and finished', rootItemId: 'root-1', timestamp: T2 }
    ] });
    const { app } = await buildApp({ history: [root, child] });

    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'root-1');
    assert.equal(item.status, 'done', 'the later terminal wins — terminal-first, never wake-first');
    assert.equal(item.completedAt, T2, 'completedAt is the [done] timestamp, not rewound or nulled');

    const blocked = await get(app, '/api/proxy/dispatch?status=blocked');
    assert.equal(blocked.body.items.length, 0, 'a finished lineage is not routed into ?status=blocked');
  });

  test('B4 — sibling-blocked propagation: a follow-up\'s [blocked] back-propagates onto its predecessor (same precedent as [done])', async () => {
    const root = row({ id: 'root-1', rootItemId: 'root-1', feedback: [
      { message: 'own beat', rootItemId: 'root-1', timestamp: T1 }
    ] });
    const child = row({ id: 'child-1', rootItemId: 'root-1', followUpTo: 'root-1', feedback: [blockedEntry(T2, 'root-1')] });
    const { app } = await buildApp({ history: [root, child] });

    const { body } = await get(app, '/api/proxy/dispatch');
    assert.equal(body.items.find(i => i.id === 'root-1').status, 'blocked',
      'status is lineage-wide: the lineage IS parked, so the predecessor reports it too');
    assert.equal(body.items.find(i => i.id === 'child-1').status, 'blocked');

    const taken = await get(app, '/api/proxy/dispatch?status=taken');
    assert.equal(taken.body.items.length, 0, 'neither row pollutes the taken listing while the lineage is parked');
  });

  test('B5 — forward-only guard holds for [blocked] too: a sibling\'s earlier [blocked] must not mislabel a later row', async () => {
    const DISPATCH_LATE = '2026-06-22T12:00:00.000Z';
    const parked = row({ id: 'parked-1', rootItemId: 'root-1', dispatchedAt: T1, feedback: [blockedEntry(T2, 'root-1')] });
    const laterRow = row({
      id: 'later-1', rootItemId: 'root-1', followUpTo: 'parked-1',
      dispatchedAt: DISPATCH_LATE, // AFTER the sibling's [blocked]
      feedback: []
    });
    const { app } = await buildApp({ history: [parked, laterRow] });

    const { body } = await get(app, '/api/proxy/dispatch');
    assert.equal(body.items.find(i => i.id === 'later-1').status, 'taken',
      'a row dispatched after the [blocked] landed is running — it must not inherit it');
    assert.equal(body.items.find(i => i.id === 'parked-1').status, 'blocked', 'the parked row itself is unaffected');
  });

  test('B6 — kind:"blocked" and status:"blocked" are independent fields (namespace collision, both directions)', async () => {
    // `item.kind` legitimately takes the value 'blocked' (lib/completion-signals.js)
    // — same string, unrelated field. Neither may leak into the other.
    const finishedBlockedKind = row({
      id: 'kind-1', kind: 'blocked', rootItemId: 'root-k',
      feedback: [{ message: '[done] the blocked-kind prompt itself finished', rootItemId: 'root-k', timestamp: T2 }]
    });
    const parkedCustomKind = row({ id: 'kind-2', kind: 'implementation', rootItemId: 'root-b', feedback: [blockedEntry()] });
    const { app } = await buildApp({ history: [finishedBlockedKind, parkedCustomKind] });

    const { body } = await get(app, '/api/proxy/dispatch');
    const byKind = body.items.find(i => i.id === 'kind-1');
    assert.equal(byKind.kind, 'blocked');
    assert.equal(byKind.status, 'done', 'kind:"blocked" must not make the STATUS blocked');
    const byStatus = body.items.find(i => i.id === 'kind-2');
    assert.equal(byStatus.status, 'blocked');
    assert.equal(byStatus.kind, 'implementation', 'status:"blocked" must not rewrite the KIND');

    const blocked = await get(app, '/api/proxy/dispatch?status=blocked');
    assert.deepEqual(blocked.body.items.map(i => i.id), ['kind-2'], 'the filter routes on status, never on kind');
  });

  test('B7 — [pending] is NOT blocked: a paused row still reports taken (the split is preserved end to end)', async () => {
    const paused = row({ id: 'paused-1', rootItemId: 'root-p', feedback: [
      { message: '[pending] my part is done, the task is not', rootItemId: 'root-p', timestamp: T2 }
    ] });
    const { app } = await buildApp({ history: [paused] });

    const { body } = await get(app, '/api/proxy/dispatch');
    assert.equal(body.items.find(i => i.id === 'paused-1').status, 'taken');

    const taken = await get(app, '/api/proxy/dispatch?status=taken');
    assert.equal(taken.body.items.length, 1, 'a [pending] row stays in the taken listing — it has its own failsafe');
  });

  test('B8 — only a row that RAN joins a lineage: a queued row is never reported blocked', async () => {
    const queuedRow = { ...row({ id: 'q-1', rootItemId: 'root-b' }), status: 'queued' };
    const parked = row({ id: 'parked-1', rootItemId: 'root-b', feedback: [blockedEntry()] });
    const { app } = await buildApp({ queued: [queuedRow], history: [parked] });

    const { body } = await get(app, '/api/proxy/dispatch');
    assert.equal(body.items.find(i => i.id === 'q-1').status, 'queued', 'a never-run row keeps its own stored status');
  });
});
