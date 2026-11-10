/**
 * LIN-1775 — GET /api/proxy/issues/:identifier/cost (+ alias /api/proxy/cost/:identifier)
 *
 * Run with: node --test tests/unit/proxy-issue-cost-route.test.js
 *
 * Harness modeled on tests/unit/proxy-dispatch-lineage-join.test.js: an
 * OPTIONS-AWARE, CALL-RECORDING dispatch-store stub so both the issue-scoped
 * own-row reads and the unscoped lineage-sibling batch query can be asserted
 * on directly, alongside the actual response shape.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes as createProxyRoutes__unplumbed, LINEAGE_QUERY_LIMIT } from '../../routes/proxy.js';
import { LlmCallLogStore } from '../../lib/llm-call-log.js';
import { stubLineageIdentity } from '../fixtures/lineage-identity.js';
import { NO_REQUEST_RECORDS, withDefaults } from '../fixtures/request-usage-loader.js';
// LIN-4201: these tests read snapshot-only lineages, so they pass "no request records" explicitly (plumbing only).
const createProxyRoutes = withDefaults(createProxyRoutes__unplumbed, 0, { requestUsageLoader: NO_REQUEST_RECORDS });


// Fixture times sit two days back (the UTC day). Since LIN-4404 the route reads the task's whole life, so the day
// matters only to the task-life suite below, which also places rows 40 days back. `ts('HH:MM')` is that day at that time.
const FIXTURE_DAY_MS = (() => {
  const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
})();
const ts = (hm) => {
  const [h, m] = hm.split(':').map(Number);
  return new Date(FIXTURE_DAY_MS + (h * 60 + m) * 60 * 1000).toISOString();
};
const T1 = ts('10:00');

function usageEntry({ model = 'anthropic/claude-sonnet-5', costUsd, effort, timestamp = T1, rootItemId } = {}) {
  const payload = { model };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  if (effort !== undefined) payload.effort = effort;
  const entry = { kind: 'usage', timestamp, message: `[usage] ${JSON.stringify(payload)}` };
  if (rootItemId) entry.rootItemId = rootItemId;
  return entry;
}

function row(overrides = {}) {
  return {
    id: 'row-1',
    status: 'taken',
    promptName: 'implementation',
    kind: 'implementation',
    issueIdentifier: 'LIN-42',
    issueUrl: null,
    target: 'cli',
    dispatchedAt: T1,
    resolvedAt: T1,
    rootItemId: 'root-1',
    feedback: [usageEntry({ costUsd: 4.9 })],
    ...overrides
  };
}

// Build an app whose dispatch store returns the given queued/history rows,
// distinguishing the lineage batch query (`rootItemId: {$in: [...]}`) from
// the ordinary issue-scoped page query so both can be asserted on.
function buildApp({ queued = [], history = [], dispatchQueueStore: dispatchQueueStoreOverride, llmCallLogStore } = {}) {
  const historyCalls = [];
  const itemsCalls = [];

  // A `since` filters as the real store does (dispatch-store.js: `dispatchedAt: {$gte: since}`, which also skips a row
  // with no `dispatchedAt`), so a read the route bounds in time loses the rows the store would not serve (LIN-4404).
  const inSince = (r, since) => !since || (r.dispatchedAt != null && new Date(r.dispatchedAt).getTime() >= since.getTime());
  const listHistory = async (urlKey, opts = {}) => {
    historyCalls.push(opts);
    if (opts.rootItemId && opts.rootItemId.$in) {
      const anchors = opts.rootItemId.$in;
      let items = history.filter(r => anchors.includes(r.rootItemId) && inSince(r, opts.since));
      const total = items.length;
      if (opts.limit) items = items.slice(0, opts.limit);
      return { items, total };
    }
    let items = (opts.issueIdentifier
      ? history.filter(r => r.issueIdentifier === opts.issueIdentifier)
      : history).filter(r => inSince(r, opts.since));
    const total = items.length;
    return { items, total };
  };

  const listItems = async (urlKey, opts = {}) => {
    itemsCalls.push(opts);
    return opts.issueIdentifier ? queued.filter(r => r.issueIdentifier === opts.issueIdentifier) : queued;
  };

  const lineageIdentityRows = stubLineageIdentity(() => [...queued, ...history]);
  const dispatchQueueStore = dispatchQueueStoreOverride === null
    ? null
    : (dispatchQueueStoreOverride || { listItems, listHistory, lineageIdentityRows });

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
    dispatchQueueStore,
    llmCallLogStore,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, historyCalls, itemsCalls };
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

function lineageCallOf(historyCalls) {
  return historyCalls.find(c => c.rootItemId && c.rootItemId.$in);
}
function pageCallOf(historyCalls) {
  return historyCalls.find(c => !(c.rootItemId && c.rootItemId.$in));
}

describe('GET /api/proxy/issues/:identifier/cost — validation', () => {
  test('400 on an invalid identifier', async () => {
    const { app } = buildApp({ history: [row()] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN%2042/cost');
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  test('503 when dispatchQueueStore is not configured', async () => {
    const { app } = buildApp({ dispatchQueueStore: null });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 503);
    assert.ok(body.error);
  });

  test('read scope is sufficient — no write scope required', async () => {
    // The harness's validateToken already returns scope: 'read'; a 200
    // (not 403) proves the route imposes no requireWriteScope gate.
    const { app } = buildApp({ history: [row()] });
    const { status } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 200);
  });

  test('400 (not a silent zeroed result) on a UUID-shaped identifier — LIN-1775 R1', async () => {
    // A UUID passes isValidIssueId's shape check, but dispatch/call-log rows
    // are keyed by the human identifier, so it would otherwise silently
    // match zero rows and return an authoritative-looking $0.00.
    const ownRow = row({ id: 'row-uuid', issueIdentifier: '01882c20-bc5e-4307-8a33-4f9857e65f7e' });
    const { app, historyCalls } = buildApp({ history: [ownRow] });
    const { status, body } = await get(app, '/api/proxy/issues/01882c20-bc5e-4307-8a33-4f9857e65f7e/cost');
    assert.equal(status, 400);
    assert.ok(body.error);
    // No store read should be attempted once the identifier is rejected.
    assert.equal(historyCalls.length, 0);
  });

  test('the alias also rejects a UUID-shaped identifier with 400', async () => {
    const { app } = buildApp({ history: [] });
    const { status } = await get(app, '/api/proxy/cost/01882c20-bc5e-4307-8a33-4f9857e65f7e');
    assert.equal(status, 400);
  });

  test('a non-UUID identifier that merely contains hyphens/digits (e.g. LIN-1770) is unaffected', async () => {
    const { app } = buildApp({ history: [row()] });
    const { status } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 200);
  });
});

describe('GET /api/proxy/issues/:identifier/cost — route aliases', () => {
  test('canonical and alias forms return identical bodies', async () => {
    const { app } = buildApp({ history: [row()] });
    const a = await get(app, '/api/proxy/issues/LIN-42/cost');
    const b = await get(app, '/api/proxy/cost/LIN-42');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    // `window.appCallsSince` is computed from Date.now() per request, so it can
    // legitimately differ by a millisecond between the two calls; everything
    // else must be byte-identical.
    const strip = body => ({ ...body, window: { ...body.window, appCallsSince: undefined } });
    assert.deepEqual(strip(a.body), strip(b.body));
  });
});

describe('GET /api/proxy/issues/:identifier/cost — store wiring', () => {
  test('own-row reads are issue-scoped and exclude prompt', async () => {
    const { app, historyCalls, itemsCalls } = buildApp({ history: [row()] });
    await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(itemsCalls[0].issueIdentifier, 'LIN-42');
    assert.deepEqual(itemsCalls[0].projection, { prompt: 0 });

    const pageCall = pageCallOf(historyCalls);
    assert.equal(pageCall.issueIdentifier, 'LIN-42');
    assert.deepEqual(pageCall.projection, { prompt: 0 });
  });

  test('the lineage-sibling batch query is UNSCOPED by issueIdentifier and carries the defensive limit', async () => {
    const ownRow = row();
    // A cross-issue follow-up sharing the same rootItemId, filed under a
    // DIFFERENT issue — must still be fetched and merged for cost correctness.
    const crossIssueSibling = row({
      id: 'row-2', issueIdentifier: 'LIN-99', dispatchedAt: ts('10:10'),
      feedback: [usageEntry({ costUsd: 9, timestamp: ts('10:20'), rootItemId: 'root-1' })]
    });
    const { app, historyCalls, body: _unused } = buildApp({ history: [ownRow, crossIssueSibling] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(status, 200);
    const lineageCall = lineageCallOf(historyCalls);
    assert.ok(lineageCall, 'expected a lineage batch query');
    assert.equal(lineageCall.issueIdentifier, undefined);
    assert.equal(lineageCall.limit, LINEAGE_QUERY_LIMIT);
    assert.deepEqual(lineageCall.projection, { prompt: 0 });

    // Last-wins over the merged lineage: the cross-issue follow-up's cost (9),
    // not the sum of both (4.9 + 9).
    assert.equal(body.pricedUsd, 9);
    assert.equal(body.workerSessions.length, 1);
  });

  test('no lineage batch query is issued when there are no taken rows', async () => {
    const queuedOnly = row({ status: 'queued' });
    const { app, historyCalls } = buildApp({ queued: [queuedOnly], history: [] });
    await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(lineageCallOf(historyCalls), undefined);
  });
});

describe('GET /api/proxy/issues/:identifier/cost — response shape', () => {
  test('end-to-end: worker + app costs joined, fully priced', async () => {
    // LIN-3163 (LIN-3157 B): the call log is lifetime-retained and no longer
    // exposes a `ttl`. Since LIN-4404 the published /cost window is the task's
    // whole life (see the task-life suite below), never a store retention value.
    // listInHorizon is stubbed because a bare construction leaves this.collection undefined. The two priced
    // calls below are the app-call figure the route publishes (LIN-4179: the docs, summed by the one read).
    const llmCallLogStore = new LlmCallLogStore();
    llmCallLogStore.listInHorizon = async (urlKey, filters) => {
      assert.equal(urlKey, 'acme');
      assert.equal(filters.issueIdentifier, 'LIN-42');
      return [{ feature: 'recommend', model: 'm', cost: 0.02 }, { feature: 'recommend', model: 'm', cost: 0.03 }];
    };
    const { app } = buildApp({ history: [row()], llmCallLogStore });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(status, 200);
    assert.equal(body.identifier, 'LIN-42');
    assert.equal(body.pricedUsd, 4.9);
    assert.equal(body.totalUsd, 4.95);
    assert.deepEqual(body.unpriced, []);
    assert.equal(body.noTelemetryCount, 0);
    assert.equal(body.workerSessions.length, 1);
    assert.equal(body.workerSessions[0].rootItemId, 'root-1');
    assert.equal(body.workerSessions[0].kind, 'implementation');
    assert.equal(body.appCalls.calls, 2);
    assert.equal(body.appCalls.costUsd, 0.05);
    assert.deepEqual(body.window, { days: null, appCallsSince: null, scope: 'task-life' });
  });

  test('LIN-2615: effort and durationMs reach the wire through the route spread', async () => {
    // `buildTaskCost` is well covered directly, but the route re-emits its
    // result with a bare spread (`res.json({ identifier, ...result, window })`)
    // — no projection, so the two fields LIN-2615 added SHOULD survive. That
    // was inspection-only until now; this asserts it off a live request.
    const { app } = buildApp({
      history: [row({
        feedback: [
          usageEntry({ costUsd: 4.9, effort: 'high' }),
          { kind: 'status', timestamp: ts('10:05'), message: '[done] finished' }
        ]
      })]
    });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(status, 200);
    assert.equal(body.workerSessions.length, 1);
    assert.equal(body.workerSessions[0].effort, 'high');
    // dispatchedAt T1 (10:00:00Z) → terminal marker (10:05:00Z).
    assert.equal(body.workerSessions[0].durationMs, 5 * 60 * 1000);
  });

  test('missing llmCallLogStore degrades to an empty app-call summary, never a 500', async () => {
    const { app } = buildApp({ history: [row()], llmCallLogStore: undefined });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(status, 200);
    assert.deepEqual(body.appCalls, { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] });
    assert.equal(body.totalUsd, 4.9);
  });

  test('LIN-2253: an unknown issue with no dispatch rows returns 200 with noLineage — never a false $0', async () => {
    // Not 404 (the identifier itself may be perfectly valid — a lane-landed,
    // non-anchor ticket has no dispatch row of its own by construction), but
    // also never the old vacuous totalUsd: 0 — that read as a confirmed
    // zero-cost result rather than "no data reached this issue at all".
    const { app } = buildApp({ history: [] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-999/cost');
    assert.equal(status, 200);
    assert.equal(body.pricedUsd, 0);
    assert.equal(body.totalUsd, null);
    assert.equal(body.noLineage, true);
    assert.deepEqual(body.workerSessions, []);
  });
});

// LIN-4404 (replaces the LIN-3161 30-day suite): a task's own read covers its whole life (the task-life rule,
// lib/read-horizon.js). Published reporting windows stay at 30 days; their own suites are unchanged.
describe('GET /api/proxy/issues/:identifier/cost — task-life read (LIN-4404, was LIN-3161)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();

  test('a lineage dispatched 40 days ago is read and priced', async () => {
    const old = row({ id: 'O', rootItemId: 'O', dispatchedAt: daysAgo(40), resolvedAt: daysAgo(40), feedback: [usageEntry({ costUsd: 6, rootItemId: 'O', timestamp: daysAgo(40) })] });
    const { app } = buildApp({ history: [old] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(status, 200);
    assert.equal(body.noLineage, false);
    assert.equal(body.workerSessions.length, 1);
    assert.equal(body.workerSessions[0].rootItemId, 'O');
    assert.equal(body.pricedUsd, 6);
    assert.equal(body.totalUsd, 6);
  });

  test('an old lineage and a recent one both count: totalUsd is the whole-life figure', async () => {
    const old = row({ id: 'O', rootItemId: 'O', dispatchedAt: daysAgo(40), resolvedAt: daysAgo(40), feedback: [usageEntry({ costUsd: 6, rootItemId: 'O', timestamp: daysAgo(40) })] });
    const recent = row({ id: 'N', rootItemId: 'N', feedback: [usageEntry({ costUsd: 1.5, rootItemId: 'N' })] });
    const { app } = buildApp({ history: [old, recent] });
    const { body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.deepEqual(body.workerSessions.map(s => s.rootItemId).sort(), ['N', 'O']);
    assert.equal(body.totalUsd, 7.5);
  });

  test('an old snapshot-only lineage stays `dispatches: null`: no request spans are reconstructed', async () => {
    const old = row({ id: 'O', rootItemId: 'O', dispatchedAt: daysAgo(40), resolvedAt: daysAgo(40), feedback: [usageEntry({ costUsd: 6, rootItemId: 'O', timestamp: daysAgo(40) })] });
    const { app } = buildApp({ history: [old] });
    const { body } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(body.workerSessions[0].dispatches, null);
  });

  test('window is { days: null, appCallsSince: null, scope: "task-life" }, scope last', async () => {
    const lifetimeStore = new LlmCallLogStore({ ttl: 365 * 24 * 60 * 60 });
    lifetimeStore.listInHorizon = async () => [];
    const { app } = buildApp({ history: [row()], llmCallLogStore: lifetimeStore });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-42/cost');

    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.window), ['days', 'appCallsSince', 'scope']);
    assert.deepEqual(body.window, { days: null, appCallsSince: null, scope: 'task-life' });
  });

  test('the wire keys and their order are unchanged; the internal flags stay off the wire', async () => {
    const { app } = buildApp({ history: [row()] });
    const { body } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.deepEqual(Object.keys(body), ['identifier', 'pricedUsd', 'totalUsd', 'unpriced', 'noTelemetryCount', 'unreadableCount', 'noLineage', 'workerSessions', 'appCalls', 'window']);
    assert.deepEqual(Object.keys(body.workerSessions[0]), ['rootItemId', 'kind', 'dispatchedAt', 'harness', 'model', 'effort', 'costUsd', 'durationMs', 'tokens', 'byModel', 'dispatches']);
  });

  test('both listHistory calls carry no `since` (identity-bounded), and listInHorizon gets the explicit task-life Date', async () => {
    let summarizeOpts = null;
    const store = new LlmCallLogStore();
    store.listInHorizon = async (urlKey, filters = {}) => {
      summarizeOpts = filters;
      return [];
    };
    const { app, historyCalls } = buildApp({ history: [row()], llmCallLogStore: store });
    await get(app, '/api/proxy/issues/LIN-42/cost');

    const pageCall = pageCallOf(historyCalls);
    const lineageCall = lineageCallOf(historyCalls);
    assert.ok(pageCall, 'expected the issue-scoped page call');
    assert.ok(lineageCall, 'expected the lineage batch call');
    assert.equal(pageCall.since, undefined, 'the own-row read is bounded by its issue, not by time');
    assert.equal(lineageCall.since, undefined, 'the sibling read is bounded by its anchors and limit, not by time');
    assert.equal(pageCall.issueIdentifier, 'LIN-42');
    assert.deepEqual(lineageCall.rootItemId, { $in: ['root-1'] });

    assert.ok(summarizeOpts, 'listInHorizon must be called');
    // A missing `since` there means 30 days (lib/llm-call-log.js), so the bound is explicit, and a Date (read-horizon.js).
    assert.ok(summarizeOpts.since instanceof Date, 'listInHorizon must receive a Date since');
    assert.equal(summarizeOpts.since.getTime(), 0, 'listInHorizon since is the task-life bound, the epoch');
  });

  test('a call older than 30 days is in the app-call figure (the real store, the task-life bound)', async () => {
    const docs = [
      { urlKey: 'acme', issueIdentifier: 'LIN-42', feature: 'recommend', model: 'm', cost: 0.04, timestamp: new Date(Date.now() - 40 * DAY_MS) },
      { urlKey: 'acme', issueIdentifier: 'LIN-42', feature: 'recommend', model: 'm', cost: 0.01, timestamp: new Date(Date.now() - 1 * DAY_MS) },
    ];
    const collection = {
      find(query) {
        const since = query.timestamp?.$gte;
        const hits = docs.filter(d => d.urlKey === query.urlKey && d.issueIdentifier === query.issueIdentifier && (!since || d.timestamp >= since));
        return { toArray: async () => hits };
      }
    };
    const { app } = buildApp({ history: [row()], llmCallLogStore: new LlmCallLogStore({ collection }) });
    const { body } = await get(app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(body.appCalls.calls, 2);
    assert.equal(body.appCalls.costUsd, 0.05);
  });
});

// LIN-4147: the route must hand the requested issue to buildTaskCost, or /cost applies no issue
// filter and prices another issue's lineage as well. buildTaskCost's own tests call it directly,
// so these two drive the route (removing `issueIdentifier: identifier` from the call turns both red).
describe('GET /api/proxy/issues/:identifier/cost — only lineages that count under the requested issue (LIN-4147)', () => {
  test('a wake row for LIN-X, re-pointed into an issue-less root, is not priced under LIN-X', async () => {
    const root = row({ id: 'P', rootItemId: 'P', issueIdentifier: null, kind: 'autopilot', dispatchedAt: ts('10:00'), feedback: [usageEntry({ costUsd: 7, rootItemId: 'P' })] });
    const wake = row({ id: 'W', rootItemId: 'P', issueIdentifier: 'LIN-X', kind: 'wake', dispatchedAt: ts('11:00'), feedback: [usageEntry({ costUsd: 2, rootItemId: 'P', timestamp: ts('11:00') })] });
    const { app } = buildApp({ history: [root, wake] });
    const { status, body } = await get(app, '/api/proxy/issues/LIN-X/cost');
    assert.equal(status, 200);
    assert.equal(body.noLineage, true);
    assert.equal(body.totalUsd, null);
    assert.equal(body.pricedUsd, 0);
    assert.deepEqual(body.workerSessions, []);
  });

  test('a follow-up under LIN-99 inside a LIN-42 root is priced under LIN-42 only, on both route paths', async () => {
    const root = row({ id: 'R', rootItemId: 'R', issueIdentifier: 'LIN-42', kind: 'implementation', dispatchedAt: ts('10:00'), feedback: [usageEntry({ costUsd: 5, rootItemId: 'R' })] });
    const followUp = row({ id: 'F', rootItemId: 'R', issueIdentifier: 'LIN-99', kind: 'review', dispatchedAt: ts('11:00'), feedback: [usageEntry({ costUsd: 3, rootItemId: 'R', timestamp: ts('11:00') })] });
    const history = [root, followUp];

    const other = await get(buildApp({ history }).app, '/api/proxy/cost/LIN-99');
    assert.equal(other.status, 200);
    assert.equal(other.body.noLineage, true);
    assert.equal(other.body.totalUsd, null);

    // Control: the founder's issue still gets the whole lineage, so the test is not vacuous.
    const founder = await get(buildApp({ history }).app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(founder.body.noLineage, false);
    // The two rows' usage entries are running totals, so the lineage shows the last one ($3), once.
    assert.equal(founder.body.pricedUsd, 3);
    assert.equal(founder.body.workerSessions.length, 1);
  });

  test('LIN-4148: a founder the sibling read truncates is still the lineage\'s issue, and the lineage is counted once', async () => {
    // The founder (LIN-42) is the oldest row of its lineage, so a newest-first cap on the sibling read drops it and keeps
    // the follow-up (LIN-99). The founder lookup (lineageIdentityRows) is uncapped, so the lineage keeps its true issue.
    const root = row({ id: 'R', rootItemId: 'R', issueIdentifier: 'LIN-42', kind: 'implementation', dispatchedAt: ts('10:00'), feedback: [usageEntry({ costUsd: 5, rootItemId: 'R' })] });
    const followUp = row({ id: 'F', rootItemId: 'R', issueIdentifier: 'LIN-99', kind: 'review', dispatchedAt: ts('11:00'), feedback: [usageEntry({ costUsd: 3, rootItemId: 'R', timestamp: ts('11:00') })] });
    const history = [root, followUp];
    const identity = stubLineageIdentity(() => history);
    const truncating = {
      listItems: async () => [],
      listHistory: async (urlKey, opts = {}) => {
        if (opts.rootItemId && opts.rootItemId.$in) return { items: [followUp], total: 2 };
        const items = opts.issueIdentifier ? history.filter(r => r.issueIdentifier === opts.issueIdentifier) : history;
        return { items, total: items.length };
      },
      lineageIdentityRows: identity,
    };

    // The follow-up's own issue does not own the lineage: the founder is truncated out of its sibling read, and the
    // fetch alone would credit LIN-99 (the double count LIN-4148 names).
    const other = await get(buildApp({ dispatchQueueStore: truncating }).app, '/api/proxy/issues/LIN-99/cost');
    assert.equal(other.status, 200);
    assert.equal(other.body.noLineage, true, 'LIN-99 is not credited with the lineage');
    assert.deepEqual(other.body.workerSessions, []);

    // The founder's issue gets the whole lineage, once: the last running total ($3), not $5 + $3.
    const founder = await get(buildApp({ dispatchQueueStore: truncating }).app, '/api/proxy/issues/LIN-42/cost');
    assert.equal(founder.status, 200);
    assert.equal(founder.body.workerSessions.length, 1, 'the lineage is counted once');
    assert.equal(founder.body.pricedUsd, 3);
  });
});
