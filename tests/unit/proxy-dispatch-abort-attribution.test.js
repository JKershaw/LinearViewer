/**
 * LIN-1261 F2 — abort terminal-attribution at the proxy read boundary (list path).
 *
 * Run with: node --test tests/unit/proxy-dispatch-abort-attribution.test.js
 *
 * Simple Dispatcher posts the terminal `[aborted]` marker to the abort item's OWN
 * dispatch row, never to the `abortTo` target's stored feedback. Without F2 a
 * consumer listing GET /api/proxy/dispatch reads the aborted TARGET as still
 * non-terminal until the 24h stale cutoff — the same class of bug the
 * reconstruction path (LIN-1257 A2) fixed, in a different consumer. F2 harvests the
 * abort rows already in the merged live+history set and applies the SAME shared F1
 * guard: attribute the abort to its target, but never override a later genuine
 * terminal or rewind completedAt.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const ABORT_TS = '2026-06-22T12:00:00.000Z';
const DONE_TS = '2026-06-22T12:00:00.000Z';
const EARLIER_ABORT_TS = '2026-06-22T11:30:00.000Z';

// Build an app whose dispatch store returns the given live (queued) + history
// rows. LIN-1470: the stubs are OPTIONS-AWARE (honour `rootItemId.$in`,
// `projection`, `limit`) rather than zero-arg — the list endpoint now issues
// a SECOND, differently-shaped `listHistory` call (the lineage batch query),
// and a stub that returns the identical fixture set regardless of options
// would pass these tests accidentally, proving nothing about that query.
function buildApp({ queued = [], history = [] } = {}) {
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
    dispatchQueueStore: {
      listItems: async () => queued,
      listHistory: async (urlKey, opts = {}) => {
        // LIN-1494: mirror the real store's shape — `total` is the exact
        // pre-slice matching count returned beside the capped `items`.
        if (opts.rootItemId && opts.rootItemId.$in) {
          const anchors = opts.rootItemId.$in;
          const matching = history.filter(r => anchors.includes(r.rootItemId));
          const items = opts.limit ? matching.slice(0, opts.limit) : matching;
          return { items, total: matching.length };
        }
        const items = opts.limit ? history.slice(0, opts.limit) : history;
        return { items, total: history.length };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
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

// A history row for the abort target: carries only a running heartbeat (non-terminal).
function targetRow(overrides = {}) {
  return {
    id: 'tgt-1',
    status: 'aborted',
    promptName: 'implementation',
    kind: 'implementation',
    issueIdentifier: 'LIN-591',
    issueUrl: null,
    target: 'cli',
    dispatchedAt: '2026-06-22T10:00:00.000Z',
    resolvedAt: '2026-06-22T10:01:00.000Z',
    feedback: [{ message: '[working · running] 4 tools in 34s', timestamp: '2026-06-22T11:00:00.000Z' }],
    ...overrides
  };
}

// The abort row: abort=true, abortTo names the target, its OWN feedback is [aborted].
function abortRow(overrides = {}) {
  return {
    id: 'abrt-1',
    status: 'aborted',
    abort: true,
    abortTo: 'tgt-1',
    issueIdentifier: null,
    target: 'cli',
    dispatchedAt: '2026-06-22T11:59:00.000Z',
    resolvedAt: ABORT_TS,
    feedback: [{ message: '[aborted] Cancelled running session (EXECUTING).', timestamp: ABORT_TS }],
    ...overrides
  };
}

describe('LIN-1261 F2 — proxy dispatch list attributes an abort to its target', () => {
  test('an aborted TARGET (heartbeat-only) is reported terminal `aborted` with the abort completedAt', async () => {
    const app = buildApp({ history: [targetRow(), abortRow()] });
    const { status, body } = await get(app, '/api/proxy/dispatch');
    assert.equal(status, 200);
    const target = body.items.find(i => i.id === 'tgt-1');
    assert.ok(target, 'the target row is listed');
    assert.equal(target.status, 'aborted', 'the target is attributed the abort terminality');
    assert.equal(target.completedAt, ABORT_TS, 'completedAt is the abort marker time');
    assert.equal(target.feedbackCount, 1, 'the synthetic abort entry does NOT inflate the stored feedback count');
  });

  test('F1 guard: an EARLIER abort does not override the target’s own later [done]', async () => {
    const doneTarget = targetRow({
      status: 'done',
      feedback: [{ message: '[done] finished', timestamp: DONE_TS }]
    });
    const earlierAbort = abortRow({
      feedback: [{ message: '[aborted] Cancelled', timestamp: EARLIER_ABORT_TS }],
      resolvedAt: EARLIER_ABORT_TS
    });
    const app = buildApp({ history: [doneTarget, earlierAbort] });
    const { status, body } = await get(app, '/api/proxy/dispatch');
    assert.equal(status, 200);
    const target = body.items.find(i => i.id === 'tgt-1');
    assert.equal(target.status, 'done', 'the genuine later [done] is preserved');
    assert.equal(target.completedAt, DONE_TS, 'completedAt is NOT rewound to the earlier abort');
  });

  test('a target with no matching abort is unaffected', async () => {
    const app = buildApp({ history: [targetRow({ id: 'other', status: 'taken', feedback: [] })] });
    const { status, body } = await get(app, '/api/proxy/dispatch');
    assert.equal(status, 200);
    const target = body.items.find(i => i.id === 'other');
    assert.equal(target.status, 'taken');
    assert.equal(target.completedAt, null);
  });
});
