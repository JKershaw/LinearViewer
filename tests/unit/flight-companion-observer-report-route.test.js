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
    assert.deepStrictEqual(observerStateStore.calls, [
      // LIN-2621: the GET handler ALSO reads the companion + census docs
      // once each per page load, for the status strip's last-check-in and
      // sweep-liveness/no-census lines — still read-only (readCurrent ONLY),
      // the same discipline this file's own header/guard enforces.
      { method: 'readCurrent', instanceKey: 'pass:v1:acme' },
      { method: 'readCurrent', instanceKey: 'companion:v1:acme' },
      { method: 'readCurrent', instanceKey: 'sweep:v1:acme' },
    ]);
  });

  test('honest empty state when the instance exists but is still at the seed marker (never completed one tick)', async () => {
    const observerStateStore = readOnlyObserverStateStore({ state: { v: 1, seeded: true }, rev: 1, updatedAt: new Date() });
    const app = buildApp({ observerStateStore });
    const { text } = await get(app, '/workspace/acme/flight-companion');
    assert.match(text, /No observer pass has run for this workspace yet\./);
  });

  test('renders a real report: narrative, lane counts, flags, attention rows, and TWO DISTINCT freshness stamps (report vs. census)', async () => {
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
          attention: [{ loopId: 'l3', issue: 'LIN-3003', lane: 'blocked', stage: 'plan', since: '2026-08-30T05:33:11.858Z' }],
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
    // The stored attention row must be visible — this is the read surface
    // LIN-2405 closes.
    assert.match(text, /LIN-3003/);
    assert.match(text, /plan/);
    assert.match(text, /2026-08-30T05:33:11\.858Z/);
    // The report's OWN freshness stamp (doc.updatedAt) ...
    assert.match(text, /2026-08-30T07:15:00\.000Z/);
    // ... and the census's freshness stamp (report.censusGroundedAt) must
    // BOTH appear, distinctly — never conflated into one timestamp.
    assert.match(text, /2026-08-30T07:00:00\.000Z/);
    assert.deepStrictEqual(observerStateStore.calls, [
      // LIN-2621: the GET handler ALSO reads the companion + census docs
      // once each per page load, for the status strip's last-check-in and
      // sweep-liveness/no-census lines — still read-only (readCurrent ONLY),
      // the same discipline this file's own header/guard enforces.
      { method: 'readCurrent', instanceKey: 'pass:v1:acme' },
      { method: 'readCurrent', instanceKey: 'companion:v1:acme' },
      { method: 'readCurrent', instanceKey: 'sweep:v1:acme' },
    ]);
  });

  test('renders attention row truncation via attentionCount when the array is capped', async () => {
    const reportDoc = {
      rev: 5,
      updatedAt: new Date('2026-08-30T07:15:00.000Z'),
      state: {
        v: 1,
        authority: 'off',
        summary: 'Several blocked.',
        report: {
          lanes: { working: 0, silent: 0, blocked: 12, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
          attentionCount: 12,
          attention: [{ loopId: 'l1', issue: 'LIN-1', lane: 'blocked', stage: 'implement', since: '2026-08-30T05:00:00.000Z' }],
          narrative: 'A dozen loops are blocked.',
          flags: [],
          degraded: null,
          censusGroundedAt: '2026-08-30T07:00:00.000Z',
          censusRev: 12
        }
      }
    };
    const observerStateStore = readOnlyObserverStateStore(reportDoc);
    const app = buildApp({ observerStateStore });
    const { text } = await get(app, '/workspace/acme/flight-companion');
    assert.match(text, /LIN-1/);
    assert.match(text, /…and 11 more/);
  });

  test('a report with no attention field renders the empty state, not a crash', async () => {
    const reportDoc = {
      rev: 6,
      updatedAt: new Date('2026-08-30T07:15:00.000Z'),
      state: {
        v: 1,
        authority: 'off',
        summary: 'Quiet.',
        report: {
          lanes: { working: 0, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
          narrative: 'Nothing to report.',
          flags: [],
          degraded: null,
          censusGroundedAt: '2026-08-30T07:00:00.000Z',
          censusRev: 3
          // no attention / attentionCount at all
        }
      }
    };
    const observerStateStore = readOnlyObserverStateStore(reportDoc);
    const app = buildApp({ observerStateStore });
    const { status, text } = await get(app, '/workspace/acme/flight-companion');
    assert.strictEqual(status, 200);
    assert.match(text, /No attention rows this tick\./);
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
    assert.deepStrictEqual(observerStateStore.calls, [
      // LIN-2621: the GET handler ALSO reads the companion + census docs
      // once each per page load, for the status strip's last-check-in and
      // sweep-liveness/no-census lines — still read-only (readCurrent ONLY),
      // the same discipline this file's own header/guard enforces.
      { method: 'readCurrent', instanceKey: 'pass:v1:acme' },
      { method: 'readCurrent', instanceKey: 'companion:v1:acme' },
      { method: 'readCurrent', instanceKey: 'sweep:v1:acme' },
    ]);
  });

  test('omitting observerStateStore entirely still renders the page with the honest empty state (no crash)', async () => {
    const app = buildApp({ observerStateStore: undefined });
    const { status, text } = await get(app, '/workspace/acme/flight-companion');
    assert.strictEqual(status, 200);
    assert.match(text, /No observer pass has run for this workspace yet\./);
  });

  test('LIN-2410: a rejecting readCurrent degrades to the empty-state panel and still carries the kickoff prompt, instead of 500ing the whole page', async () => {
    const observerStateStore = {
      calls: [],
      async readCurrent(instanceKey) {
        this.calls.push({ method: 'readCurrent', instanceKey });
        throw new Error('store unavailable');
      },
      async ensureSeeded() {
        throw new Error('the Flight Companion route must never call ensureSeeded — read-only');
      },
      async advance() {
        throw new Error('the Flight Companion route must never call advance — read-only');
      }
    };
    const app = buildApp({ observerStateStore });
    const { status, text } = await get(app, '/workspace/acme/flight-companion');
    assert.strictEqual(status, 200);
    assert.match(text, /No observer pass has run for this workspace yet\./);
    // The page's primary deliverable — the kickoff prompt — must survive a
    // rejecting observer-state read, not just the empty-state panel.
    assert.match(text, /id="flight-companion-prompt"/);
    assert.deepStrictEqual(observerStateStore.calls, [
      // LIN-2621: the GET handler ALSO reads the companion + census docs
      // once each per page load, for the status strip's last-check-in and
      // sweep-liveness/no-census lines — still read-only (readCurrent ONLY),
      // the same discipline this file's own header/guard enforces.
      { method: 'readCurrent', instanceKey: 'pass:v1:acme' },
      { method: 'readCurrent', instanceKey: 'companion:v1:acme' },
      { method: 'readCurrent', instanceKey: 'sweep:v1:acme' },
    ]);
  });
});
