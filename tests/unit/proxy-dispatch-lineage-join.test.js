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
import { createProxyRoutes, LINEAGE_QUERY_LIMIT } from '../../routes/proxy.js';

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
      // A real Mongo query ANDs every field present on `opts` into one query
      // object, so if the handler ever (wrongly) added `issueIdentifier` to
      // the lineage query, it WOULD narrow these results too — mirror that
      // here (rather than ignoring the field) so L4 actually fails if a
      // future change re-scopes the lineage query by issue, instead of
      // passing vacuously because the stub never modeled the field.
      const anchors = opts.rootItemId.$in;
      let items = history.filter(r => anchors.includes(r.rootItemId));
      if (opts.issueIdentifier) items = items.filter(r => r.issueIdentifier === opts.issueIdentifier);
      // LIN-1494: mirror the real store's `limit` branch (lib/dispatch-store.js)
      // — `total` is the exact PRE-slice matching count, `items` the capped
      // slice. The old stub ignored `limit` and returned no `total`, which is
      // exactly the harness gap that let a `length === cap` proxy look correct.
      const total = items.length;
      if (opts.limit) items = items.slice(0, opts.limit);
      return { items, total };
    }
    // Real store: the page call DOES push issueIdentifier into the query
    // when the caller passes it (LIN-613/615 index-backed predicate).
    let items = opts.issueIdentifier
      ? history.filter(r => r.issueIdentifier === opts.issueIdentifier)
      : history;
    const total = items.length; // pre-slice count, as the real store returns
    items = opts.limit ? items.slice(0, opts.limit) : items;
    return { items, total };
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
    const { app } = buildApp({ history: [parentDone, cancelledChild] });
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
    const { app } = buildApp({ history: [parentDone, expiredChild] });
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
    const { app } = buildApp({ history: [root, crossIssueChild] });

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

        const { app } = buildApp({ queued, history });
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
    const { app } = buildApp({ history: [root, child] });
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
    const { app } = buildApp({ history: [parent, runningFollowUp] });

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

describe('LIN-1485/LIN-1494 — L3: telemetry when the lineage query overruns LINEAGE_QUERY_LIMIT (exact truncation signal)', () => {
  // Imported from routes/proxy.js (LIN-1494 F2 tidy) — no more hand-mirrored
  // `const CAP = 2000` kept in sync by naming conventions.
  const CAP = LINEAGE_QUERY_LIMIT;

  // Builds `count` rows sharing one rootItemId anchor: index 0 is the anchor row
  // itself (id === anchor), the rest are siblings. The terminal `[done]` entry
  // rides an EARLY row (index 1) so it survives the stub's limit slice in the
  // over-cap fixtures — the real store keeps the newest rows, and which rows
  // are dropped is not what these cases pin.
  function lineageRows(anchor, count, terminalAt) {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const isTerminal = terminalAt != null && i === Math.min(1, count - 1);
      rows.push(row({
        id: i === 0 ? anchor : `${anchor}-sib-${i}`,
        rootItemId: anchor,
        feedback: [{
          message: isTerminal ? '[done] finished' : 'own beat',
          rootItemId: anchor,
          timestamp: isTerminal ? terminalAt : T1
        }]
      }));
    }
    return rows;
  }

  test('T13 — fires exactly once when the lineage genuinely overruns the cap, and reports the exact total', async (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    // CAP + 1 matching rows: the stub returns `items` sliced to CAP with
    // `total` = CAP + 1 — the store's exact pre-slice count.
    const history = lineageRows('root-cap', CAP + 1, T2);
    const { app } = buildApp({ history });

    const { status } = await get(app, '/api/proxy/dispatch');

    assert.equal(status, 200);
    assert.equal(warnMock.mock.calls.length, 1, 'must fire exactly once when the lineage overruns the cap');
    const [message] = warnMock.mock.calls[0].arguments;
    assert.match(message, /LINEAGE_QUERY_LIMIT/, 'the log line should name the signal it is reporting');
    assert.match(message, new RegExp(String(CAP)), 'the log line should carry the cap value itself');
    assert.match(message, new RegExp(`total=${CAP + 1}`), 'the log line should answer "how far over cap" with the exact total');
  });

  test('T13b (LIN-1494 headline) — SILENT on a lineage of exactly LINEAGE_QUERY_LIMIT rows (nothing was truncated)', async (t) => {
    // The shipped `lineageSiblings.length === LINEAGE_QUERY_LIMIT` gate
    // false-positived here: a lineage of exactly 2000 rows is complete, but
    // the proxy read "full page" as "may be truncated". The store's `total`
    // is exact, so exactly-at-cap must not warn.
    const warnMock = t.mock.method(console, 'warn', () => {});
    const history = lineageRows('root-exact', CAP, T2);
    const { app } = buildApp({ history });

    const { status } = await get(app, '/api/proxy/dispatch');

    assert.equal(status, 200);
    assert.equal(warnMock.mock.calls.length, 0, 'exactly-at-cap is complete, not truncated — must stay silent');
  });

  test('T14 — silent when the lineage query returns one row under the cap (the case that actually protects the ticket\'s intent)', async (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    const history = lineageRows('root-under', CAP - 1, T2);
    const { app } = buildApp({ history });

    const { status } = await get(app, '/api/proxy/dispatch');

    assert.equal(status, 200);
    assert.equal(warnMock.mock.calls.length, 0, 'a healthy under-cap lineage (CAP - 1 rows) must never trip the telemetry');
  });

  test('T15 — silent on an ordinary small lineage (no anchors even reach the batch query)', async (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    const root = row({
      id: 'root-small', rootItemId: 'root-small',
      feedback: [{ message: 'own beat', rootItemId: 'root-small', timestamp: T1 }]
    });
    const { app } = buildApp({ history: [root] });

    const { status } = await get(app, '/api/proxy/dispatch');

    assert.equal(status, 200);
    assert.equal(warnMock.mock.calls.length, 0);
  });

  test('T16 — response payload (merge/feedbackCount/status/completedAt) is unaffected by the telemetry firing', async (t) => {
    // Deliberately OVER the cap (same fixture shape as T13) so the telemetry
    // branch actually executes — this proves the added conditional/log line
    // is read-only and does not perturb the derived response fields it sits
    // beside, driving the real handler end to end rather than asserting on
    // the log call in isolation.
    const warnMock = t.mock.method(console, 'warn', () => {});
    const history = lineageRows('root-cap-2', CAP + 1, T2);
    const { app } = buildApp({ history });

    const { body } = await get(app, '/api/proxy/dispatch');
    const item = body.items.find(i => i.id === 'root-cap-2');

    assert.equal(warnMock.mock.calls.length, 1, 'precondition: the telemetry branch executed for this fixture');
    assert.ok(item, 'the anchor row is present in the response');
    // The lineage query returned the capped CAP rows (of CAP + 1), so the
    // merged feedback covers exactly the rows the store handed back.
    assert.equal(item.feedbackCount, CAP, 'lineage-wide count over the returned (capped) rows, unaffected by telemetry');
    assert.equal(item.status, 'done', 'lineage-derived terminal status, unaffected by telemetry');
    assert.equal(item.completedAt, T2, 'lineage-derived completedAt, unaffected by telemetry');
  });
});

describe('LIN-1494 — dispatch-list response: honest `total` + `truncated` from the store\'s pre-slice count', () => {
  // The page query carries `limit: 200`; `listHistory` returns the exact full
  // matching count beside the capped items. The response previously reported
  // `total: filtered.length` — a count over the newest-200 window presented
  // as the count of matching dispatch items.
  const PAGE_LIMIT = 200;

  function plainRows(count, { issueIdentifier = 'LIN-1494', feedback = [] } = {}) {
    // Legacy-style rows (no rootItemId, anchor falls back to own id) keep the
    // lineage query out of the way of what these cases pin.
    const rows = [];
    for (let i = 0; i < count; i++) {
      rows.push(row({ id: `h-${issueIdentifier}-${i}`, issueIdentifier, feedback }));
    }
    return rows;
  }

  test('unfiltered: total = queued + history.total when the 200-row window truncates, with truncated: true', async () => {
    const history = plainRows(PAGE_LIMIT + 50);
    const queuedRow = { ...row({ id: 'q-1' }), status: 'queued' };
    const { app } = buildApp({ queued: [queuedRow], history });

    const { status, body } = await get(app, '/api/proxy/dispatch');

    assert.equal(status, 200);
    assert.equal(body.total, 1 + PAGE_LIMIT + 50, 'the store\'s exact matching count, not the windowed 201');
    assert.equal(body.truncated, true, 'the newest-200 window did not cover the whole history');
  });

  test('unfiltered: total unchanged and truncated: false when the window covers everything (back-compat)', async () => {
    const history = plainRows(3);
    const queuedRow = { ...row({ id: 'q-1' }), status: 'queued' };
    const { app } = buildApp({ queued: [queuedRow], history });

    const { body } = await get(app, '/api/proxy/dispatch');

    assert.equal(body.total, 4, 'identical to the old filtered.length when history fits the window');
    assert.equal(body.truncated, false);
  });

  test('issue-scoped: total is the store\'s exact per-issue count past the window', async () => {
    const history = [
      ...plainRows(PAGE_LIMIT + 30, { issueIdentifier: 'LIN-A' }),
      ...plainRows(5, { issueIdentifier: 'LIN-B' })
    ];
    const { app } = buildApp({ history });

    const scoped = await get(app, '/api/proxy/dispatch?issueIdentifier=LIN-A');
    assert.equal(scoped.body.total, PAGE_LIMIT + 30, 'the scoped store count is exact for the issue');
    assert.equal(scoped.body.truncated, true);

    const other = await get(app, '/api/proxy/dispatch?issueIdentifier=LIN-B');
    assert.equal(other.body.total, 5);
    assert.equal(other.body.truncated, false);
  });

  test('status-filtered: total stays the windowed filtered.length (exact total is unknowable), truncated still disclosed', async () => {
    // Status is feedback-derived in JS — the store cannot count it — so the
    // existing `filtered.length` semantics are deliberately preserved (the
    // T2b pins depend on this). The `truncated` flag still discloses that
    // the window (and the lineage anchor seeding) did not cover everything.
    const history = plainRows(PAGE_LIMIT + 50, { feedback: [{ message: '[done] finished', timestamp: T1 }] });
    const { app } = buildApp({ history });

    const { body } = await get(app, '/api/proxy/dispatch?status=done');

    assert.equal(body.total, PAGE_LIMIT, 'the windowed count — NOT the store total — for a derived-status filter');
    assert.equal(body.truncated, true);
  });
});
