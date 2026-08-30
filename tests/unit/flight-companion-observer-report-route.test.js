/**
 * Route-level tests for the LIN-2395 read-only observer report panel on the
 * Flight Companion page (routes/flight-companion.js + lib/render-flight-companion.js).
 *
 * Driven through a real Express app with only the observerStateStore faked
 * (LIN-2023 bind convention: listen(0, '127.0.0.1'), addressed the same way).
 *
 * Covers: an honest empty state when no report has ever been written, a real
 * report rendering with lane counts + narrative + flags + two DISTINCT
 * freshness stamps (report vs. census), and — the load-bearing guard — that
 * request/render handling can only ever call `readCurrent` on the store,
 * never `ensureSeeded`/`advance`. A bug in this route can therefore never
 * become an observer-state write.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';

function readOnlyObserverStateStore(doc) {
  return {
    calls: [],
    async readCurrent(instanceKey) {
      this.calls.push({ method: 'readCurrent', instanceKey });
      return doc;
    },
    async ensureSeeded() {
      this.calls.push({ method: 'ensureSeeded' });
      throw new Error('the Flight Companion route must never call ensureSeeded — read-only');
    },
    async advance() {
      this.calls.push({ method: 'advance' });
      throw new Error('the Flight Companion route must never call advance — read-only');
    }
  };
}

function buildApp({ observerStateStore }) {
  const app = express();
  app.use((req, res, next) => {
    req.session = { features: { flightCompanion: true }, workspaces: [{ urlKey: 'acme' }] };
    next();
  });
  app.use(createFlightCompanionRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: 'acme' }; next(); },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    observerStateStore
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('Flight Companion — LIN-2395 observer report panel (route)', () => {
  test('honest empty state when the observer-pass instance has never been seeded', async () => {
    const observerStateStore = readOnlyObserverStateStore(null);
    const app = buildApp({ observerStateStore });
    const { status, text } = await get(app, '/workspace/acme/flight-companion');
    assert.strictEqual(status, 200);
    assert.match(text, /No observer pass has run for this workspace yet\./);
    assert.deepStrictEqual(observerStateStore.calls, [{ method: 'readCurrent', instanceKey: 'pass:v1:acme' }]);
  });

  test('honest empty state when the instance exists but is still at the seed marker (never completed one tick)', async () => {
    const observerStateStore = readOnlyObserverStateStore({ state: { v: 1, seeded: true }, rev: 1, updatedAt: new Date() });
    const app = buildApp({ observerStateStore });
    const { text } = await get(app, '/workspace/acme/flight-companion');
    assert.match(text, /No observer pass has run for this workspace yet\./);
  });

  test('renders a real report: narrative, lane counts, flags, and TWO DISTINCT freshness stamps (report vs. census)', async () => {
    const reportDoc = {
      rev: 4,
      updatedAt: new Date('2026-08-30T07:15:00.000Z'),
      state: {
        v: 1,
        authority: 'off',
        summary: 'One loop blocked.',
        report: {
          lanes: { working: 2, silent: 0, blocked: 1, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
          attentionCount: 1,
          narrative: 'Two loops working, one blocked on a decision.',
          flags: ['blocked-cluster'],
          degraded: null,
          censusGroundedAt: '2026-08-30T07:00:00.000Z',
          censusRev: 12
        }
      }
    };
    const observerStateStore = readOnlyObserverStateStore(reportDoc);
    const app = buildApp({ observerStateStore });
    const { status, text } = await get(app, '/workspace/acme/flight-companion');

    assert.strictEqual(status, 200);
    assert.match(text, /Two loops working, one blocked on a decision\./);
    assert.match(text, /blocked-cluster/);
    assert.match(text, /<code>off<\/code>/);
    // The report's OWN freshness stamp (doc.updatedAt) ...
    assert.match(text, /2026-08-30T07:15:00\.000Z/);
    // ... and the census's freshness stamp (report.censusGroundedAt) must
    // BOTH appear, distinctly — never conflated into one timestamp.
    assert.match(text, /2026-08-30T07:00:00\.000Z/);
    assert.deepStrictEqual(observerStateStore.calls, [{ method: 'readCurrent', instanceKey: 'pass:v1:acme' }]);
  });

  test('an authority: on-unimplemented report still renders as plainly report-only (same lanes/narrative shape, only the stamp differs)', async () => {
    const reportDoc = {
      rev: 2,
      updatedAt: new Date('2026-08-30T07:15:00.000Z'),
      state: {
        v: 1,
        authority: 'on-unimplemented',
        summary: 'Quiet.',
        report: {
          lanes: { working: 0, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
          attentionCount: 0,
          narrative: 'The fleet census is empty right now — no active loops to observe.',
          flags: [],
          degraded: null,
          censusGroundedAt: '2026-08-30T07:00:00.000Z',
          censusRev: 3
        }
      }
    };
    const observerStateStore = readOnlyObserverStateStore(reportDoc);
    const app = buildApp({ observerStateStore });
    const { text } = await get(app, '/workspace/acme/flight-companion');
    assert.match(text, /<code>on-unimplemented<\/code>/);
    assert.match(text, /No flags this tick\./);
    assert.deepStrictEqual(observerStateStore.calls, [{ method: 'readCurrent', instanceKey: 'pass:v1:acme' }]);
  });

  test('omitting observerStateStore entirely still renders the page with the honest empty state (no crash)', async () => {
    const app = buildApp({ observerStateStore: undefined });
    const { status, text } = await get(app, '/workspace/acme/flight-companion');
    assert.strictEqual(status, 200);
    assert.match(text, /No observer pass has run for this workspace yet\./);
  });
});
