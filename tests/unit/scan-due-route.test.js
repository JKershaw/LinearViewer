/**
 * Route tests for `GET /workspace/:urlKey/api/scan-due` (LIN-2649 WS2/S3,
 * LIN-2666): the paginated, on-demand cross-task scan-due check — capability
 * gate, keyset cursor, bounded provider-read concurrency, per-item failure
 * isolation, tri-state `dueStatus`.
 *
 * Mounts the REAL router (`createWorkspaceApiRoutes`) with:
 *   - a REAL `TaskDecisionsStore` over a minimal in-memory collection (its own
 *     `listCandidatesForWorkspace` keyset pagination runs unmodified — only
 *     wrapped with a call-counting spy for the "no store read before the gate/
 *     cursor validation" assertions), rows seeded directly (bypassing
 *     `recordScan`, which stamps `scannedAt: new Date()` and can't produce the
 *     controlled, strictly-increasing timestamps pagination needs);
 *   - a fake provider (`registerProvider`, mirroring
 *     `tests/unit/comment-write-route.test.js`'s harness) with instrumented
 *     `fetchRecommendationContext` (call log + peak in-flight counter) and a
 *     toggleable `supports()` gate.
 *
 * Run with: node --test tests/unit/scan-due-route.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';
import { dueBasisHashFromContext } from '../../lib/scan-fingerprint.js';

const PROVIDER_NAME = 'scan-due-route-fake';

function makeContext(issueId, overrides = {}) {
  return {
    issue: {
      id: issueId,
      identifier: `T-${issueId}`,
      title: overrides.title || 'Title',
      description: overrides.description || 'Desc',
      state: { type: 'started' }
    },
    comments: [],
    children: [],
    parent: null
  };
}

function makeFakeProvider({ supportsGate = true, contexts = {}, failIssueIds = new Set(), delayMs = 0 } = {}) {
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  const provider = {
    name: PROVIDER_NAME,
    supports: (cap) => cap === 'fetchRecommendationContext' ? supportsGate : false,
    async fetchRecommendationContext(scope, issueId) {
      // A capability-absent provider genuinely lacks (or throws from) this
      // method in production — the fake mirrors that so a removed gate is
      // actually observable, not silently absorbed by a lenient mock.
      if (!supportsGate) throw new Error('NotImplementedError: fetchRecommendationContext');
      calls.push(issueId);
      inFlight++;
      peak = Math.max(peak, inFlight);
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      inFlight--;
      if (failIssueIds.has(issueId)) throw new Error(`boom-${issueId}`);
      return contexts[issueId] || makeContext(issueId);
    }
  };
  return { provider, calls, getPeak: () => peak };
}

function createMinimalCollection(seedDocs) {
  const docs = [...seedDocs];
  return {
    find(query = {}) {
      const results = docs.filter(d => query.urlKey === undefined || d.urlKey === query.urlKey);
      return { async toArray() { return results.slice(); } };
    }
  };
}

/** Real TaskDecisionsStore, seeded directly, with a call-counting spy on listCandidatesForWorkspace. */
function makeStore(seedDocs) {
  const collection = createMinimalCollection(seedDocs);
  const store = new TaskDecisionsStore({ collection });
  const calls = [];
  const real = store.listCandidatesForWorkspace.bind(store);
  store.listCandidatesForWorkspace = async (...args) => {
    calls.push(args);
    return real(...args);
  };
  return { store, calls };
}

function makeRow({ issueId, issueIdentifier, scannedAt, dueBasisHash = null, dueBasisVersion = null, seq = 0 }) {
  return {
    _id: `scan_${issueId}`,
    urlKey: 'ws1',
    issueId,
    issueIdentifier: issueIdentifier || `T-${issueId}`,
    inputHash: 'in',
    basisHash: null,
    basisVersion: null,
    dueBasisHash,
    dueBasisVersion,
    decision: null,
    scannedAt,
    seq,
    outcome: null,
    outcomeAt: null
  };
}

function buildApp({ provider, taskDecisionsStore, harbourCommentsStore = null }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: 'ws1', provider: PROVIDER_NAME, accessToken: 'ws-token' };
      req.session = {};
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {},
    dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {},
    taskDecisionsStore,
    harbourCommentsStore
  }));
  return app;
}

async function getScanDue(app, query = '') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/ws1/api/scan-due${query}`);
    let body = {};
    try { body = await res.json(); } catch { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// ─────────────────────────────────────────────────────────────────────────

describe('GET /workspace/:urlKey/api/scan-due — pagination (LIN-2666)', () => {
  function seedRows(n) {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    return Array.from({ length: n }, (_, i) => makeRow({
      issueId: `issue-${String(i).padStart(3, '0')}`,
      scannedAt: new Date(base + i * 1000)
    }));
  }

  test('walks two pages with zero overlap and zero gap across the full 41-candidate set', async () => {
    const rows = seedRows(41);
    const { provider } = makeFakeProvider();
    const { store } = makeStore(rows);
    const app = buildApp({ provider, taskDecisionsStore: store });

    const page1 = await getScanDue(app);
    assert.strictEqual(page1.status, 200);
    assert.strictEqual(page1.body.items.length, 40, 'page 1 returns exactly DUE_CHECK_PAGE_SIZE items');
    assert.ok(page1.body.nextCursor, 'page 1 must carry a non-null nextCursor — 41 candidates exist');
    assert.strictEqual(typeof page1.body.nextCursor, 'string', 'nextCursor is emitted as the same opaque string the cursor param accepts (LIN-2667 N-A)');
    assert.strictEqual(page1.body.totalCandidateCount, 41);

    const page2 = await getScanDue(app, `?cursor=${page1.body.nextCursor}`);
    assert.strictEqual(page2.status, 200);
    assert.strictEqual(page2.body.items.length, 1, 'page 2 returns the 41st candidate');
    assert.strictEqual(page2.body.nextCursor, null, 'the last page carries a null nextCursor');

    const seenIds = [...page1.body.items, ...page2.body.items].map(i => i.issueId);
    const expectedIds = rows.map(r => r.issueId);
    assert.strictEqual(seenIds.length, expectedIds.length, 'no gap: same total count across both pages');
    assert.strictEqual(new Set(seenIds).size, seenIds.length, 'no overlap: every id appears exactly once');
    assert.deepStrictEqual([...seenIds].sort(), [...expectedIds].sort(), 'the union is exactly the seeded candidate set');
  });

  test('the emitted nextCursor, fed back verbatim, genuinely resumes rather than restarting', async () => {
    const rows = seedRows(41);
    const { provider } = makeFakeProvider();
    const { store } = makeStore(rows);
    const app = buildApp({ provider, taskDecisionsStore: store });

    const page1 = await getScanDue(app);
    const page2 = await getScanDue(app, `?cursor=${page1.body.nextCursor}`);

    const page1Ids = new Set(page1.body.items.map(i => i.issueId));
    const page2Ids = page2.body.items.map(i => i.issueId);
    assert.strictEqual(page2Ids.length, 1);
    assert.ok(!page1Ids.has(page2Ids[0]), 'page 2 must not repeat a row already returned on page 1');
    assert.strictEqual(page2Ids[0], rows[40].issueId, 'page 2 resumes at the 41st (last) seeded row, not the start');
  });
});

describe('GET /workspace/:urlKey/api/scan-due — cursor validation (LIN-2666)', () => {
  test('undecodable garbage cursor -> 400 INVALID_CURSOR, no store call', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeStore([]);
    const app = buildApp({ provider, taskDecisionsStore: store });
    const res = await getScanDue(app, '?cursor=%25%25%25not-base64%25%25%25');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'INVALID_CURSOR');
    assert.strictEqual(calls.length, 0, 'the store must never be read for a malformed cursor');
  });

  test('valid base64url that decodes to non-JSON -> 400 INVALID_CURSOR, no store call', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeStore([]);
    const app = buildApp({ provider, taskDecisionsStore: store });
    const notJson = Buffer.from('this is not json').toString('base64url');
    const res = await getScanDue(app, `?cursor=${notJson}`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'INVALID_CURSOR');
    assert.strictEqual(calls.length, 0);
  });

  test('valid JSON of the wrong shape (missing/non-string scannedAt or issueId) -> 400 INVALID_CURSOR, no store call', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeStore([]);
    const app = buildApp({ provider, taskDecisionsStore: store });

    const missingIssueId = encodeCursor({ scannedAt: '2026-01-01T00:00:00.000Z' });
    const res1 = await getScanDue(app, `?cursor=${missingIssueId}`);
    assert.strictEqual(res1.status, 400);
    assert.strictEqual(res1.body.code, 'INVALID_CURSOR');

    const numericScannedAt = encodeCursor({ scannedAt: 12345, issueId: 'x' });
    const res2 = await getScanDue(app, `?cursor=${numericScannedAt}`);
    assert.strictEqual(res2.status, 400);
    assert.strictEqual(res2.body.code, 'INVALID_CURSOR');

    assert.strictEqual(calls.length, 0, 'the store must never be read for any of these malformed shapes');
  });
});

describe('GET /workspace/:urlKey/api/scan-due — stale cursor (LIN-2666)', () => {
  test('a decodable cursor naming a since-vanished (scannedAt, issueId) pair resumes from the nearest later point, not an error', async () => {
    const base = new Date('2026-02-01T00:00:00.000Z').getTime();
    const rows = [
      makeRow({ issueId: 'issue-a', scannedAt: new Date(base) }),
      makeRow({ issueId: 'issue-b', scannedAt: new Date(base + 5000) }),
      makeRow({ issueId: 'issue-c', scannedAt: new Date(base + 10000) })
    ];
    const { provider } = makeFakeProvider();
    const { store } = makeStore(rows);
    const app = buildApp({ provider, taskDecisionsStore: store });

    // Names a point strictly between issue-a and issue-b that never
    // corresponds to any real row — a stand-in for a row already pruned or
    // dismissed since the cursor was minted. Exercises the keyset `>`
    // compare's graceful degradation, never an exact-match lookup.
    const staleCursor = encodeCursor({ scannedAt: new Date(base + 2500).toISOString(), issueId: 'issue-ghost' });
    const res = await getScanDue(app, `?cursor=${staleCursor}`);

    assert.strictEqual(res.status, 200, 'a stale cursor must not error');
    assert.deepStrictEqual(res.body.items.map(i => i.issueId), ['issue-b', 'issue-c']);
    assert.strictEqual(res.body.nextCursor, null);
  });
});

describe('GET /workspace/:urlKey/api/scan-due — capability gate (LIN-2666)', () => {
  test('a provider without fetchRecommendationContext yields exactly one 422 before any store read or provider call', async () => {
    const rows = [makeRow({ issueId: 'issue-a', scannedAt: new Date() })];
    const { provider, calls: providerCalls } = makeFakeProvider({ supportsGate: false });
    const { store, calls: storeCalls } = makeStore(rows);
    const app = buildApp({ provider, taskDecisionsStore: store });

    const res = await getScanDue(app);
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(storeCalls.length, 0, 'no store read before the gate');
    assert.strictEqual(providerCalls.length, 0, 'no provider call before the gate');
  });
});

describe('GET /workspace/:urlKey/api/scan-due — per-item failure isolation (LIN-2666)', () => {
  test('one candidate mid-page rejects; response stays 200, that row alone carries {dueStatus:null,error:true}, others unaffected and index-aligned', async () => {
    const base = Date.now();
    const rows = Array.from({ length: 5 }, (_, i) => makeRow({
      issueId: `issue-${i}`, scannedAt: new Date(base + i * 1000)
    }));
    // The middle candidate (index 2 of 5) — deliberately not first or last,
    // so a naive "shift everything down one" bug would misalign it.
    const { provider } = makeFakeProvider({ failIssueIds: new Set(['issue-2']) });
    const { store } = makeStore(rows);
    const app = buildApp({ provider, taskDecisionsStore: store });

    const res = await getScanDue(app);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 5);

    const failedRow = res.body.items[2];
    assert.deepStrictEqual(failedRow, { issueId: 'issue-2', issueIdentifier: 'T-issue-2', dueStatus: null, error: true });

    for (const [i, item] of res.body.items.entries()) {
      if (i === 2) continue;
      assert.strictEqual(item.issueId, `issue-${i}`, 'every other row lines up with its own candidate, in order');
      assert.strictEqual(item.error, undefined, 'error stays orthogonal — absent on a successful row');
    }
  });
});

describe('GET /workspace/:urlKey/api/scan-due — concurrency bound (LIN-2666)', () => {
  test('peak concurrent fetchRecommendationContext calls never exceeds 5', async () => {
    const base = Date.now();
    const rows = Array.from({ length: 12 }, (_, i) => makeRow({ issueId: `issue-${i}`, scannedAt: new Date(base + i * 1000) }));
    const { provider, getPeak } = makeFakeProvider({ delayMs: 20 });
    const { store } = makeStore(rows);
    const app = buildApp({ provider, taskDecisionsStore: store });

    const res = await getScanDue(app);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 12);
    assert.ok(getPeak() <= 5, `observed peak in-flight ${getPeak()} exceeds the 5-candidate bound`);
    assert.strictEqual(getPeak(), 5, 'with 12 delayed candidates the bound should actually be reached, not just incidentally respected');
  });
});

describe('GET /workspace/:urlKey/api/scan-due — tri-state dueStatus (LIN-2666)', () => {
  test('dueStatus is true when the due-basis changed, false when unchanged, and null (never error) when incomparable', async () => {
    const unchangedCtx = makeContext('issue-unchanged', { title: 'Same title' });
    const changedCtxAtRaise = makeContext('issue-changed', { title: 'Old title' }); // only used to derive the OLD stored hash
    const changedCtxNow = makeContext('issue-changed', { title: 'New title' }); // what the provider returns NOW

    const unchangedHash = dueBasisHashFromContext(unchangedCtx, { recordedCommentIds: new Set() });
    const staleHashForChanged = dueBasisHashFromContext(changedCtxAtRaise, { recordedCommentIds: new Set() });

    const rows = [
      makeRow({ issueId: 'issue-unchanged', scannedAt: new Date(1000), dueBasisHash: unchangedHash, dueBasisVersion: 2 }),
      makeRow({ issueId: 'issue-changed', scannedAt: new Date(2000), dueBasisHash: staleHashForChanged, dueBasisVersion: 2 }),
      makeRow({ issueId: 'issue-never-fingerprinted', scannedAt: new Date(3000), dueBasisHash: null, dueBasisVersion: null }),
      makeRow({ issueId: 'issue-old-version', scannedAt: new Date(4000), dueBasisHash: 'whatever', dueBasisVersion: 1 })
    ];

    const { provider } = makeFakeProvider({
      contexts: {
        'issue-unchanged': unchangedCtx,
        'issue-changed': changedCtxNow,
        'issue-never-fingerprinted': makeContext('issue-never-fingerprinted'),
        'issue-old-version': makeContext('issue-old-version')
      }
    });
    const { store } = makeStore(rows);
    const app = buildApp({ provider, taskDecisionsStore: store });

    const res = await getScanDue(app);
    assert.strictEqual(res.status, 200);
    const byId = Object.fromEntries(res.body.items.map(i => [i.issueId, i]));

    assert.strictEqual(byId['issue-unchanged'].dueStatus, false);
    assert.strictEqual(byId['issue-unchanged'].error, undefined);

    assert.strictEqual(byId['issue-changed'].dueStatus, true);
    assert.strictEqual(byId['issue-changed'].error, undefined);

    assert.strictEqual(byId['issue-never-fingerprinted'].dueStatus, null);
    assert.strictEqual(byId['issue-never-fingerprinted'].error, undefined, 'a never-fingerprinted row is null, never a fabricated error');

    assert.strictEqual(byId['issue-old-version'].dueStatus, null);
    assert.strictEqual(byId['issue-old-version'].error, undefined, 'a version mismatch is null, never a fabricated error');
  });
});
