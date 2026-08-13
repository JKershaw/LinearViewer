/**
 * LIN-1494 — route-level coverage for GET /workspace/:urlKey/api/live-console/events.
 *
 * Run with: node --test tests/unit/live-console-events-route.test.js
 *
 * The events endpoint reads agentStatusStore.listStatus with a PER-WORKSPACE
 * row cap (FEED_PER_WORKSPACE_LIMIT / HISTORY_PER_WORKSPACE_LIMIT). The store
 * computes `total` before slicing; the route used to destructure `{ items }`
 * only, so `hasMore` (and `summary.total`) were derived from the already-
 * truncated pool — "view earlier activity" dead-ended while older events
 * still existed in the store. These cases pin the fix end to end:
 *   - the live branch ORs per-workspace store truncation into `hasMore` and
 *     threads Σ per-workspace totals into `summary.total`;
 *   - the history branch pushes the `before` cursor DOWN into the store read
 *     (`until`) so paging genuinely advances past the cap — the one ordering
 *     constraint: an honest hasMore WITHOUT cursor pushdown would loop on
 *     empty pages, worse than the dead-end;
 *   - a per-workspace store failure degrades to [] for that workspace without
 *     poisoning `hasMore` for the rest.
 *
 * Modeled on the proxy-dispatch-lineage-join harness: express + stubbed,
 * call-recording stores. `dispatchQueueStore` is deliberately null so the
 * loops read (real pipeline-loops code) stays out of these cases.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLiveConsoleRoutes } from '../../routes/live-console.js';

// Build an app whose status store returns the given per-workspace pages.
// `pages` maps urlKey → { items, total } (or a function that throws).
function buildApp({ pages = {}, workspaces = [{ urlKey: 'acme', name: 'Acme' }] } = {}) {
  const statusCalls = [];

  const agentStatusStore = {
    listStatus: async (urlKey, opts = {}) => {
      statusCalls.push({ urlKey, opts });
      const page = pages[urlKey];
      if (typeof page === 'function') return page();
      return page || { items: [], total: 0 };
    }
  };

  const app = express();
  app.use(createLiveConsoleRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = workspaces[0];
      req.session = { workspaces, features: { liveConsole: true } };
      next();
    },
    agentStatusStore,
    dispatchQueueStore: null, // loops read stays out of these cases
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
  }));
  return { app, statusCalls };
}

async function get(app, path) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// Store-shaped status items with timestamps near now (inside every window).
function entries(count, { offsetMs = 60_000, stepMs = 1000, urlKey = 'acme' } = {}) {
  const base = Date.now() - offsetMs;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `${urlKey}-e${i}`,
      taskIdentifier: `LIN-${i}`,
      action: 'implementation',
      status: 'completed',
      summary: `entry ${i}`,
      timestamp: new Date(base - i * stepMs).toISOString(),
    });
  }
  return out;
}

describe('live branch — per-workspace store truncation feeds hasMore + summary.total', () => {
  test('a capped workspace read (total > items.length) forces hasMore even though the pool fits one page', async () => {
    const items = entries(3);
    const { app } = buildApp({ pages: { acme: { items, total: 450 } } });

    const { status, body } = await get(app, '/workspace/acme/api/live-console/events');

    assert.equal(status, 200);
    assert.equal(body.events.length, 3, 'the pool fits one page');
    assert.equal(body.hasMore, true, 'store-level truncation must surface — this is the dead-end fix');
    assert.equal(body.summary.total, 450, 'Σ per-workspace store totals (+ evidence), not the truncated pool length');
  });

  test('an uncapped read (total === items.length) keeps hasMore honest-false', async () => {
    const items = entries(3);
    const { app } = buildApp({ pages: { acme: { items, total: 3 } } });

    const { body } = await get(app, '/workspace/acme/api/live-console/events');

    assert.equal(body.hasMore, false);
    assert.equal(body.summary.total, 3);
  });

  test('totals and truncation aggregate across workspaces (OR / Σ)', async () => {
    const workspaces = [{ urlKey: 'acme', name: 'Acme' }, { urlKey: 'beta', name: 'Beta' }];
    const { app } = buildApp({
      workspaces,
      pages: {
        acme: { items: entries(2, { urlKey: 'acme' }), total: 2 },       // complete
        beta: { items: entries(2, { urlKey: 'beta' }), total: 900 },     // truncated
      }
    });

    const { body } = await get(app, '/workspace/acme/api/live-console/events');

    assert.equal(body.hasMore, true, 'ANY truncated workspace flips hasMore');
    assert.equal(body.summary.total, 902, 'sum of per-workspace store totals');
  });
});

// LIN-1505 Phase C: the strip's requested zoom span, threaded from the query
// string through snapPulseWindowMs into buildConsoleFeed/buildPulse. Bucket
// count must stay fixed at every span (payload size never changes), and a
// free-form/absent value must never reach the store-facing window unsnapped.
describe('live branch — pulseSpanMs query threading (LIN-1505 Phase C)', () => {
  test('an omitted pulseSpanMs keeps the unchanged 3-minute default', async () => {
    const { app } = buildApp({ pages: { acme: { items: [], total: 0 } } });
    const { body } = await get(app, '/workspace/acme/api/live-console/events');
    assert.equal(body.pulse.bucketMs, 5000); // 180000 / 36 === 5000, unchanged
    assert.equal(body.pulse.buckets.length, 36);
  });

  test('a valid rung is honoured, deriving bucketMs from the fixed 36-bucket count', async () => {
    const { app } = buildApp({ pages: { acme: { items: [], total: 0 } } });
    const { body } = await get(app, '/workspace/acme/api/live-console/events?pulseSpanMs=3600000'); // 1h
    assert.equal(body.pulse.buckets.length, 36, 'bucket count is fixed at every span');
    assert.equal(body.pulse.bucketMs, 100000); // 3600000 / 36
  });

  test('an unrecognised/free-form value snaps to the nearest rung rather than reaching the store as-is', async () => {
    const { app } = buildApp({ pages: { acme: { items: [], total: 0 } } });
    const { body } = await get(app, '/workspace/acme/api/live-console/events?pulseSpanMs=999999999'); // above the 6h ceiling
    assert.equal(body.pulse.buckets.length, 36);
    assert.equal(body.pulse.bucketMs, (6 * 60 * 60 * 1000) / 36, 'clamped to the 6h ceiling rung');
  });

  test('a junk pulseSpanMs falls back to the 3-minute default, never NaN/negative buckets', async () => {
    const { app } = buildApp({ pages: { acme: { items: [], total: 0 } } });
    const { body } = await get(app, '/workspace/acme/api/live-console/events?pulseSpanMs=not-a-number');
    assert.equal(body.pulse.bucketMs, 5000);
    assert.equal(body.pulse.buckets.length, 36);
  });
});

describe('history branch — the before cursor is pushed down as `until` so paging advances past the cap', () => {
  test('passes until: new Date(before) (with since + the history per-workspace limit) into the store read', async () => {
    const before = Date.now() - 30_000;
    const { app, statusCalls } = buildApp({ pages: { acme: { items: entries(2, { offsetMs: 60_000 }), total: 2 } } });

    const { status } = await get(app, `/workspace/acme/api/live-console/events?before=${before}`);

    assert.equal(status, 200);
    assert.equal(statusCalls.length, 1);
    const { opts } = statusCalls[0];
    assert.ok(opts.until instanceof Date, 'the cursor must ride into the QUERY, not stay a JS post-filter');
    assert.equal(opts.until.getTime(), before, 'until is exactly the before cursor');
    assert.ok(opts.since instanceof Date, 'the history window lower bound still applies');
    assert.equal(typeof opts.limit, 'number', 'the per-workspace cap still bounds the read');
  });

  test('reports honest hasMore when the windowed store read is itself truncated', async () => {
    const before = Date.now() - 30_000;
    const items = entries(2, { offsetMs: 60_000 });
    const { app } = buildApp({ pages: { acme: { items, total: 700 } } });

    const { body } = await get(app, `/workspace/acme/api/live-console/events?before=${before}`);

    assert.equal(body.events.length, 2);
    assert.equal(body.hasMore, true, 'older rows exist beyond the capped window read');
  });

  test('hasMore stays false when the windowed read is complete and fits the page', async () => {
    const before = Date.now() - 30_000;
    const items = entries(2, { offsetMs: 60_000 });
    const { app } = buildApp({ pages: { acme: { items, total: 2 } } });

    const { body } = await get(app, `/workspace/acme/api/live-console/events?before=${before}`);

    assert.equal(body.hasMore, false);
  });
});

describe('per-workspace failure degradation', () => {
  test('one failing workspace degrades to [] without blanking the feed or poisoning hasMore', async () => {
    const workspaces = [{ urlKey: 'acme', name: 'Acme' }, { urlKey: 'bad', name: 'Bad' }];
    const { app } = buildApp({
      workspaces,
      pages: {
        acme: { items: entries(2, { urlKey: 'acme' }), total: 2 },
        bad: () => { throw new Error('store down'); },
      }
    });

    const { status, body } = await get(app, '/workspace/acme/api/live-console/events');

    assert.equal(status, 200, 'one bad store never blanks the whole feed');
    assert.equal(body.events.length, 2, 'the healthy workspace still contributes');
    assert.equal(body.hasMore, false, 'a failed read contributes NO truncation signal');
    assert.equal(body.summary.total, 2, 'a failed read contributes no phantom total');
  });
});
