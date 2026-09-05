/**
 * LIN-1829 — GET /api/proxy/periodicals
 *
 * Run with: node --test tests/unit/proxy-periodicals-route.test.js
 *
 * Harness modeled on tests/unit/proxy-issue-cost-route.test.js: an
 * OPTIONS-AWARE, CALL-RECORDING dispatch-store stub (`listItems`/`listHistory`
 * record their args) so the route's read shape — projection, absence of
 * `limit`, workspace scoping — can be asserted on directly, alongside the
 * real foldPeriodicalRuns() output via the actual periodicals registry
 * (the route calls getPeriodicals() itself; it takes no injectable
 * templates param, so fixtures below use real registry ids).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { getPeriodicals } from '../../lib/periodicals.js';
import { PERIODICAL_PROJECTION, PERIODICAL_HISTORY_PROJECTION } from '../../lib/dispatch-store.js';

const TEMPLATES = getPeriodicals();
const TEMPLATE = TEMPLATES[0]; // { id, title, mode, cadence: 'weekly', ... }
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HISTORY_TTL_SECONDS = 30 * 24 * 60 * 60; // store default (lib/dispatch-store.js:142)

const NOW = Date.now();
const daysAgo = n => new Date(NOW - n * DAY_MS).toISOString();

// Defaults to a terminal [done] marker (LIN-2385) so the existing
// positive-evidence fixtures below keep passing under the new gate; a case
// exercising the negative direction passes `feedback` explicitly.
function historyRow(overrides = {}) {
  return {
    kind: 'periodical',
    periodicalId: TEMPLATE.id,
    promptName: TEMPLATE.title,
    dispatchedAt: daysAgo(10),
    status: 'taken',
    followUpTo: null,
    abort: false,
    feedback: [{ message: '[done] Task completed', timestamp: daysAgo(10) }],
    ...overrides
  };
}

function queueRow(overrides = {}) {
  return {
    kind: 'periodical',
    periodicalId: TEMPLATE.id,
    promptName: TEMPLATE.title,
    followUpTo: null,
    abort: false,
    ...overrides
  };
}

// Call-recording, workspace-partitioned fake store. `historyTtl` defaults to
// the store's real 30-day-in-SECONDS default so the seconds-vs-ms trap is
// exercised under realistic conditions, not a convenient round number.
function buildApp({
  queued = {},   // { [urlKey]: rows }
  history = {},  // { [urlKey]: rows }
  historyTtl = HISTORY_TTL_SECONDS,
  dispatchQueueStore: dispatchQueueStoreOverride,
  tokenScope = 'read',
  tokenUrlKey = 'acme',
  validateToken: validateTokenOverride
} = {}) {
  const itemsCalls = [];
  const historyCalls = [];

  const listItems = async (urlKey, opts = {}) => {
    itemsCalls.push({ urlKey, ...opts });
    return queued[urlKey] || [];
  };

  const listHistory = async (urlKey, opts = {}) => {
    historyCalls.push({ urlKey, ...opts });
    return { items: history[urlKey] || [], total: (history[urlKey] || []).length };
  };

  const dispatchQueueStore = dispatchQueueStoreOverride === null
    ? null
    : (dispatchQueueStoreOverride || { listItems, listHistory, historyTtl });

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: validateTokenOverride
        || (async () => ({ tokenId: 't1', urlKey: tokenUrlKey, label: 'test', scope: tokenScope, createdBy: 'u1' })),
      // LIN-1938 S2: this fixture's invalid-token case is a bearer nothing recognizes.
      describeRejectionCause: async () => null,
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, itemsCalls, historyCalls };
}

async function get(app, { token = 'anything', noAuth = false } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = noAuth ? {} : { Authorization: `Bearer ${token}` };
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/periodicals`, { method: 'GET', headers });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function findTemplateResult(body) {
  return body.periodicals.find(p => p.id === TEMPLATE.id);
}

describe('GET /api/proxy/periodicals', () => {
  // -- availability / auth -----------------------------------------------

  test('503 when dispatchQueueStore is not configured', async () => {
    const { app } = buildApp({ dispatchQueueStore: null });
    const { status, body } = await get(app);
    assert.equal(status, 503);
    assert.ok(body.error);
  });

  test('read scope is sufficient — no write scope required', async () => {
    const { app } = buildApp({ tokenScope: 'read' });
    const { status } = await get(app);
    assert.equal(status, 200);
  });

  test('missing Authorization header is rejected (401)', async () => {
    const { app } = buildApp();
    const { status, body } = await get(app, { noAuth: true });
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  test('invalid/unrecognized token is rejected (401)', async () => {
    const { app } = buildApp({ validateToken: async () => null });
    const { status, body } = await get(app);
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  // -- response shape -------------------------------------------------------

  test('response carries EXACTLY the documented keys — no `runs`, `id` not `periodicalId`', async () => {
    const { app } = buildApp({ history: { acme: [historyRow()] } });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.ok(item, 'template result present');
    assert.deepEqual(
      Object.keys(item).sort(),
      ['cadence', 'daysSince', 'id', 'lastDispatchedAt', 'mode', 'repos', 'state', 'title'].sort()
    );
    assert.equal(item.id, TEMPLATE.id);
    assert.equal('periodicalId' in item, false);
    assert.equal('runs' in item, false);
  });

  // LIN-1932 B5, part 2 (§7): a `repos[]` lane entry's own key set. Without
  // this, a lane silently missing `isDefault` or leaking `runs` would pass
  // every other test in the plan.
  test('each `repos[]` lane entry carries EXACTLY {repo, label, isDefault, state, lastDispatchedAt, daysSince} — no `runs`', async () => {
    const { app } = buildApp({ history: { acme: [historyRow()] } });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.ok(Array.isArray(item.repos) && item.repos.length > 0, 'expected at least one lane');
    assert.deepEqual(
      Object.keys(item.repos[0]).sort(),
      ['daysSince', 'isDefault', 'label', 'lastDispatchedAt', 'repo', 'state'].sort()
    );
    assert.equal('runs' in item.repos[0], false);
  });

  // LIN-1932 B5, part 1 (§3): the aggregation witness. Two archived `taken`
  // rows for one template — repo-a (older, aged past cadence) and the
  // default lane (newer, within cadence) — no live queue rows. Proves
  // top-level `lastDispatchedAt`/`state` aggregate over ALL lanes rather
  // than mirroring any single one (including repo-a, which would plausibly
  // sort first) — the divergent top-level `state: 'recent'` vs. repo-a's
  // own `due` is the load-bearing assertion a weaker additive-shape-only
  // test would not catch. (`runs`'s SUM aggregation is not asserted here:
  // `runs` is never on the wire at all, per the key-set test above and
  // LIN-1829's original top-level withholding — its sum property is a
  // fold-internal invariant, already exercised by beat 2's B1/B2 fixtures.)
  test('top-level lastDispatchedAt/state aggregate across lanes (MAX / any-lane), and state can diverge from any single lane\'s own state', async () => {
    const { app } = buildApp({
      history: {
        acme: [
          historyRow({ repo: 'repo-a', dispatchedAt: daysAgo(10) }), // older, aged past weekly cadence -> due
          historyRow({ repo: null, dispatchedAt: daysAgo(1) })       // newer, within weekly cadence -> recent
        ]
      }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);

    const repoALane = item.repos.find(l => l.repo === 'repo-a');
    const defaultLane = item.repos.find(l => l.isDefault);
    assert.ok(repoALane, 'expected a repo-a lane');
    assert.ok(defaultLane, 'expected a default lane');
    assert.equal(repoALane.state, 'due');
    assert.equal(defaultLane.state, 'recent');

    assert.equal(item.state, 'recent', 'top-level state must reflect the aggregated (max) lastDispatchedAt, not repo-a\'s own due');
    assert.equal(item.lastDispatchedAt, new Date(daysAgo(1)).toISOString(), 'top-level lastDispatchedAt must be the MAX across lanes');
    assert.equal(item.daysSince, 1);
  });

  test('publishes exactly one entry per registry template, even with zero evidence', async () => {
    const { app } = buildApp();
    const { body } = await get(app);
    assert.equal(body.periodicals.length, TEMPLATES.length);
  });

  test('correctly destructures listHistory\'s {items,total} shape (does not iterate the wrapper object)', async () => {
    // If the route ever iterated `history` directly instead of `history.items`,
    // `.filter` on a plain {items,total} object throws — this would 500, not
    // silently misbehave. A 200 with the row's evidence present proves the
    // destructure is correct, not merely that it didn't throw.
    const { app } = buildApp({ history: { acme: [historyRow({ dispatchedAt: daysAgo(2) })] } });
    const { status, body } = await get(app);
    assert.equal(status, 200);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'recent');
    assert.equal(item.daysSince, 2);
  });

  // -- read shape: projection / no-limit / workspace scoping ----------------

  // LIN-2385: the two reads DELIBERATELY diverge — the queue read never gains
  // `feedback` (listItems has no row-bounding predicate of any kind, so
  // widening it would re-open the LIN-1030 unbounded-read hazard), only the
  // history read does, via the separate PERIODICAL_HISTORY_PROJECTION
  // constant. A second reviewer should verify the split is real (queue truly
  // never gets the wider projection) rather than assumed from the plan text.
  test('the queue read carries PERIODICAL_PROJECTION and the history read carries PERIODICAL_HISTORY_PROJECTION', async () => {
    const { app, itemsCalls, historyCalls } = buildApp();
    await get(app);
    assert.equal(itemsCalls.length, 1);
    assert.equal(historyCalls.length, 1);
    assert.strictEqual(itemsCalls[0].projection, PERIODICAL_PROJECTION);
    assert.strictEqual(historyCalls[0].projection, PERIODICAL_HISTORY_PROJECTION);
    assert.notStrictEqual(PERIODICAL_HISTORY_PROJECTION, PERIODICAL_PROJECTION, 'sanity: the two constants must actually be distinct objects');
  });

  // LIN-2385, B4: the history read pushes the same row set the JS-side
  // admission filter uses down into the store query, BEFORE the projection
  // widens to grant `feedback` — narrow rows first, then widen columns. The
  // queue read gets no such predicate (it needs no row-bounding for this).
  test('the history read carries periodicalEvidenceRow:true; the queue read carries no such predicate', async () => {
    const { app, itemsCalls, historyCalls } = buildApp();
    await get(app);
    assert.equal(historyCalls[0].periodicalEvidenceRow, true);
    assert.equal('periodicalEvidenceRow' in itemsCalls[0], false);
  });

  test('the history read carries no `limit` — listHistory\'s limit path sorts on resolvedAt, not dispatchedAt', async () => {
    const { app, historyCalls } = buildApp();
    await get(app);
    assert.equal('limit' in historyCalls[0], false);
    assert.equal(historyCalls[0].limit, undefined);
  });

  // Caught by the e2e suite (LIN-1829 beat 5), not this file originally: the
  // route once passed `since` as a raw epoch-ms NUMBER. `dispatchedAt` is
  // stored as a real Date, and the file-backed MangoDB store's cross-type
  // `$gte` comparator returns NaN (no match) for a Date-vs-Number comparison
  // — so on that backend the belt-and-suspenders `since` trim silently
  // excluded EVERY history row, making every template read `never`
  // regardless of real dispatch history. This fake store's `since` was never
  // type-checked, so this class of bug was invisible here until the e2e
  // mint-take-read-back test caught it against the real store.
  test('`since` is passed as a real Date instance, not a raw epoch-ms number', async () => {
    const { app, historyCalls } = buildApp();
    await get(app);
    assert.ok(historyCalls[0].since instanceof Date, `expected a Date, got ${typeof historyCalls[0].since}`);
  });

  test('both reads are scoped to req.proxyUrlKey', async () => {
    const { app, itemsCalls, historyCalls } = buildApp({ tokenUrlKey: 'acme' });
    await get(app);
    assert.equal(itemsCalls[0].urlKey, 'acme');
    assert.equal(historyCalls[0].urlKey, 'acme');
  });

  test('workspace isolation: workspace A never reflects workspace B\'s queue or history', async () => {
    const { app } = buildApp({
      tokenUrlKey: 'acme',
      queued: { other: [queueRow()] },
      history: { other: [historyRow()] }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    // acme's own rows are empty; 'other' workspace's evidence must not leak in.
    assert.equal(item.state, 'never');
    assert.equal(item.lastDispatchedAt, null);
  });

  // -- queue-vs-history precedence ------------------------------------------

  test('a live queue row reads `recent`, even when history alone would say `due`', async () => {
    const { app } = buildApp({
      queued: { acme: [queueRow()] },
      // A stale history run that WOULD be `due` on its own (weekly cadence, 30 days old).
      history: { acme: [historyRow({ dispatchedAt: daysAgo(30) })] }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'recent');
  });

  // -- state transitions ------------------------------------------------

  test('state transitions: no evidence -> never; recent history -> recent; elapsed cadence -> due', async () => {
    async function stateFor(historyRows) {
      const { app } = buildApp({ history: { acme: historyRows } });
      const { body } = await get(app);
      return findTemplateResult(body).state;
    }
    assert.equal(await stateFor([]), 'never');
    assert.equal(await stateFor([historyRow({ dispatchedAt: daysAgo(2) })]), 'recent');
    assert.equal(await stateFor([historyRow({ dispatchedAt: daysAgo(10) })]), 'due'); // weekly cadence, 10 days elapsed
  });

  test('a followUpTo or aborted row is excluded from evidence', async () => {
    const { app } = buildApp({
      history: {
        acme: [
          historyRow({ dispatchedAt: daysAgo(2), followUpTo: 'some-other-id' }),
          historyRow({ dispatchedAt: daysAgo(2), abort: true })
        ]
      }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'never');
    assert.equal(item.lastDispatchedAt, null);
  });

  test('unknown is reachable when the store\'s retention exceeds the route\'s 30-day horizon (documented, not produced by any real deployment)', async () => {
    // effectiveHorizonMs = min(DEFAULT_HORIZON_MS, historyTtlMs). Configuring a
    // longer-than-30-day retention makes historyTtlMs the LARGER value, so the
    // cap stops being conclusive and "unknown" (not "never") is correct.
    const { app } = buildApp({ historyTtl: 60 * 24 * 60 * 60 }); // 60 days, in seconds
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'unknown');
  });

  // -- the false-`never` direction: real evidence must never be hidden ------

  test('does not read a template as `never` when real, in-window evidence exists (the direction this endpoint must never fail toward)', async () => {
    const { app } = buildApp({ history: { acme: [historyRow({ dispatchedAt: daysAgo(1) })] } });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.notEqual(item.state, 'never');
    assert.equal(item.state, 'recent');
    assert.notEqual(item.lastDispatchedAt, null);
  });

  // -- the seconds-vs-ms retention trap --------------------------------------
  //
  // dispatchQueueStore.historyTtl is SECONDS; foldPeriodicalRuns wants ms. A
  // raw-seconds value is finite, so it passes the fold's Number.isFinite
  // guard and silently collapses the horizon to ~30 minutes — real evidence
  // 10 days old then reads as `never`, which is the exact fleet-wide
  // over-dispatch hazard this ticket exists to prevent. This test is written
  // to fail if the route's `* 1000` conversion is removed — see the beat's
  // sibling verification (`git diff` restore of routes/proxy.js) which
  // deletes and restores the conversion to prove this test is load-bearing,
  // not merely present.
  test('a real run 10 days old reads `due`, not `never` — proves historyTtl seconds->ms conversion is applied', async () => {
    const { app } = buildApp({
      historyTtl: HISTORY_TTL_SECONDS, // 2,592,000 (SECONDS) — finite, so an
      // unconverted value would silently pass the fold's guard and collapse
      // the horizon to ~30 minutes instead of 30 days.
      history: { acme: [historyRow({ dispatchedAt: daysAgo(10) })] }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'due'); // weekly cadence, 10 days elapsed
    assert.equal(item.daysSince, 10);
    assert.notEqual(item.state, 'never');
  });

  // -- LIN-2385 Part A: row admission relaxation (falsifiable acceptance, B2) --
  //
  // Part A's route change is inert against the live workspace as of this
  // writing — this is unit-level, falsifiable acceptance instead of a live-
  // population re-check (see the plan's B2 resolution).

  test('a non-periodical-kind history row carrying a valid periodicalId (and a non-matching promptName) is folded as a run', async () => {
    const { app } = buildApp({
      history: {
        acme: [historyRow({
          kind: 'implementation', // the batch/lane dispatch shape — never 'periodical'
          periodicalId: TEMPLATE.id,
          promptName: 'LIN-2385: fix the thing', // does not match any template title
          dispatchedAt: daysAgo(1)
        })]
      }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'recent');
    assert.notEqual(item.lastDispatchedAt, null);
  });

  // Regression: the title-fallback guard the relaxation must not weaken — a
  // row with NO periodicalId and a non-'periodical' kind must not count just
  // because its promptName happens to collide with a template title.
  test('a non-periodical-kind history row with NO periodicalId is excluded even when promptName collides with a template title', async () => {
    const { app } = buildApp({
      history: {
        acme: [historyRow({
          kind: 'implementation',
          periodicalId: null,
          promptName: TEMPLATE.title,
          dispatchedAt: daysAgo(1)
        })]
      }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'never');
    assert.equal(item.lastDispatchedAt, null);
  });

  // -- LIN-2385 Part B: terminal-marker gate ---------------------------------

  test('a taken row with NO feedback marker at all does not count as run evidence', async () => {
    const { app } = buildApp({ history: { acme: [historyRow({ dispatchedAt: daysAgo(1), feedback: [] })] } });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'never');
    assert.equal(item.lastDispatchedAt, null);
  });

  // The regression case for the 2026-08-07 incident: a claim that was taken
  // and then [failed] must not reset the cadence clock.
  test('a taken row with a terminal [failed] marker does not count as run evidence', async () => {
    const { app } = buildApp({
      history: {
        acme: [historyRow({
          dispatchedAt: daysAgo(1),
          feedback: [{ message: '[failed] remote-control never connected', timestamp: daysAgo(1) }]
        })]
      }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'never');
    assert.equal(item.lastDispatchedAt, null);
  });

  test('a taken row with a terminal [complete] marker counts as run evidence too, not just [done]', async () => {
    const { app } = buildApp({
      history: {
        acme: [historyRow({
          dispatchedAt: daysAgo(1),
          feedback: [{ message: '[complete] all good', timestamp: daysAgo(1) }]
        })]
      }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'recent');
    assert.notEqual(item.lastDispatchedAt, null);
  });

  // Regression: rule 1 (a live queue row reads `recent` unconditionally) must
  // survive the new terminal-marker gate unchanged — a queue row carries no
  // `feedback` at all, and must never be run through the marker check.
  test('a live queue row still reads recent under the new gate, even with a taken-but-unmarked history row present', async () => {
    const { app } = buildApp({
      queued: { acme: [queueRow()] },
      history: { acme: [historyRow({ dispatchedAt: daysAgo(30), feedback: [] })] }
    });
    const { body } = await get(app);
    const item = findTemplateResult(body);
    assert.equal(item.state, 'recent');
  });
});
