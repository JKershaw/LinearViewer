/**
 * Unit tests for lib/kpi-stats.js
 *
 * Run with: node --test tests/unit/kpi-stats.test.js
 *
 * Covers the aggregate shapes the public /kpis page depends on, plus the
 * privacy guarantee: no workspace urlKey, prompt text, or summary content
 * may appear anywhere in the collected stats (the page is public).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import {
  collectKpiStats, categorizeProxyEvent, PROXY_PHASES,
  ACTIVITY_WINDOW_DAYS, HOURLY_WINDOW_HOURS, FREE_TIER_WINDOW_DAYS, WEEKLY_WINDOW_WEEKS,
  OUTCOME_WINDOW_WEEKS, OUTCOME_WINDOW_DAYS
} from '../../lib/kpi-stats.js';

// Minimal in-memory mock of the collection surface kpi-stats uses:
// find({}).toArray() and countDocuments({} | simple equality filter).
function createMockCollection(docs = []) {
  return {
    find() {
      return { toArray: async () => docs };
    },
    async countDocuments(filter = {}) {
      return docs.filter(doc =>
        Object.entries(filter).every(([key, value]) => doc[key] === value)
      ).length;
    }
  };
}

const NOW = new Date('2026-06-10T12:00:00.000Z');

function daysAgo(n) {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

function buildCollections(overrides = {}) {
  const empty = () => createMockCollection([]);
  return {
    sessions: empty(),
    userPreferences: empty(),
    workspacePreferences: empty(),
    customPrompts: empty(),
    localIssues: empty(),
    dispatchQueue: empty(),
    dispatchHistory: empty(),
    dispatchTokens: empty(),
    proxyTokens: empty(),
    proxyEvents: empty(),
    agentStatus: empty(),
    freeTier: empty(),
    recapCache: empty(),
    briefCache: empty(),
    reportHistory: empty(),
    ...overrides
  };
}

describe('categorizeProxyEvent', () => {
  test('maps endpoints to agent-loop phases', () => {
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/stack'), 'orienting');
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/brief/:id'), 'orienting');
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/issues/:id'), 'orienting');
    assert.strictEqual(categorizeProxyEvent('POST', '/api/proxy/recommend-and-dispatch'), 'deciding');
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/autopilot/kickoff'), 'deciding');
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/foreman/playbook'), 'deciding');
    assert.strictEqual(categorizeProxyEvent('POST', '/api/proxy/dispatch'), 'deciding');
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/dispatch/:id'), 'watching');
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/foreman/sessions'), 'watching');
    // agent/status is canonical (LIN-533); foreman/status is the deprecated alias.
    // Both classify the same — legacy audit events still carry the old path.
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/agent/status'), 'watching');
    assert.strictEqual(categorizeProxyEvent('POST', '/api/proxy/agent/status'), 'reporting');
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/foreman/status'), 'watching');
    assert.strictEqual(categorizeProxyEvent('POST', '/api/proxy/foreman/status'), 'reporting');
    assert.strictEqual(categorizeProxyEvent('POST', '/api/proxy/issues'), 'acting');
    assert.strictEqual(categorizeProxyEvent('PATCH', '/api/proxy/issues/:id'), 'acting');
    assert.strictEqual(categorizeProxyEvent('POST', '/api/proxy/issues/comments'), 'acting');
  });

  test('unknown endpoints degrade by method: reads orient, writes act', () => {
    assert.strictEqual(categorizeProxyEvent('GET', '/api/proxy/some-future-endpoint'), 'orienting');
    assert.strictEqual(categorizeProxyEvent('POST', '/api/proxy/some-future-endpoint'), 'acting');
    assert.strictEqual(categorizeProxyEvent(undefined, undefined), 'orienting');
  });
});

describe('collectKpiStats', () => {
  test('returns all-zero stats for an empty instance', async () => {
    const stats = await collectKpiStats(buildCollections(), { now: NOW });

    assert.strictEqual(stats.totals.workspaces, 0);
    assert.strictEqual(stats.totals.users, 0);
    assert.strictEqual(stats.totals.activeSessions, 0);
    assert.strictEqual(stats.totals.agentActions, 0);
    assert.strictEqual(stats.totals.dispatches, 0);
    assert.strictEqual(stats.totals.autopilotRuns, 0);
    assert.strictEqual(stats.totals.aiSummaries, 0);
    assert.strictEqual(stats.totals.activeTokens, 0);
    assert.strictEqual(stats.proxyCategories.days.length, ACTIVITY_WINDOW_DAYS);
    assert.strictEqual(stats.proxyCategoriesHourly.hours.length, HOURLY_WINDOW_HOURS);
    for (const phase of PROXY_PHASES) {
      assert.ok(stats.proxyCategories[phase].every(count => count === 0), `${phase} not all zero`);
      assert.ok(stats.proxyCategoriesHourly[phase].every(count => count === 0), `hourly ${phase} not all zero`);
    }
    assert.strictEqual(stats.dispatchByWeek.weeks.length, WEEKLY_WINDOW_WEEKS);
    assert.deepStrictEqual(stats.dispatchByWeek.kinds, []);
    assert.deepStrictEqual(stats.funnel, { dispatched: 0, taken: 0, reported: 0, completed: 0 });
    assert.deepStrictEqual(stats.stepOutcomes, { completed: 0, failed: 0, blocked: 0, other: 0 });
    assert.deepStrictEqual(stats.dispatchKinds, []);
    assert.strictEqual(stats.hourOfDay.length, 24);
    assert.ok(stats.hourOfDay.every(count => count === 0));
    assert.strictEqual(stats.vanity.busiestDay, null);
    assert.strictEqual(stats.vanity.readsPerWrite, null);
    assert.strictEqual(stats.vanity.medianQueueToTakeMinutes, null);
  });

  test('counts workspaces as the union of keys across collections', async () => {
    const collections = buildCollections({
      workspacePreferences: createMockCollection([{ _id: 'acme' }, { _id: 'globex' }]),
      proxyEvents: createMockCollection([{ urlKey: 'acme', endpoint: '/api/proxy/me', method: 'GET', status: 200, timestamp: daysAgo(1) }]),
      agentStatus: createMockCollection([{ urlKey: 'initech', action: 'review', timestamp: daysAgo(2) }]),
      freeTier: createMockCollection([
        { urlKey: 'hooli', date: '2026-06-09', count: 3 },
        { urlKey: null, date: '2026-06-09T11', count: 9 } // global hourly record: no workspace
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.totals.workspaces, 4); // acme, globex, initech, hooli
  });

  test('counts only unexpired sessions as active', async () => {
    const collections = buildCollections({
      sessions: createMockCollection([
        { _id: 'a', expires: daysAgo(-5) },           // future → active
        { _id: 'b', expires: daysAgo(1) },            // past → expired
        { _id: 'c', expires: daysAgo(-5).toISOString() } // string date → still active
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.totals.activeSessions, 2);
  });

  test('buckets proxy calls per phase per UTC day and tracks read:write ratio', async () => {
    const event = (method, endpoint, days) => ({ method, endpoint, status: 200, timestamp: daysAgo(days) });
    const collections = buildCollections({
      proxyEvents: createMockCollection([
        event('GET', '/api/proxy/stack', 0),
        event('GET', '/api/proxy/issues/:id', 0),
        event('POST', '/api/proxy/recommend-and-dispatch', 0),
        event('GET', '/api/proxy/dispatch/:id', 0),
        event('POST', '/api/proxy/foreman/status', 3),
        event('PATCH', '/api/proxy/issues/:id', 3),
        event('GET', '/api/proxy/me', 45) // outside window: counts toward totals, not buckets
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    const last = ACTIVITY_WINDOW_DAYS - 1;

    assert.strictEqual(stats.proxyCategories.orienting[last], 2);
    assert.strictEqual(stats.proxyCategories.deciding[last], 1);
    assert.strictEqual(stats.proxyCategories.watching[last], 1);
    assert.strictEqual(stats.proxyCategories.reporting[last - 3], 1);
    assert.strictEqual(stats.proxyCategories.acting[last - 3], 1);
    assert.strictEqual(stats.totals.agentActions, 7);
    // 4 GET reads vs 3 writes → 1.3 reads per write
    assert.strictEqual(stats.vanity.readsPerWrite, 1.3);
    // Busiest day is today: 4 events vs 2 on day -3
    assert.ok(stats.vanity.busiestDay);
    assert.strictEqual(stats.vanity.busiestDay.count, 4);
  });

  test('buckets proxy calls per phase per UTC hour for the 24h view', async () => {
    const hoursAgo = (n) => new Date(NOW.getTime() - n * 60 * 60 * 1000);
    const event = (method, endpoint, hours) => ({ method, endpoint, status: 200, timestamp: hoursAgo(hours) });
    const collections = buildCollections({
      proxyEvents: createMockCollection([
        event('GET', '/api/proxy/stack', 0),
        event('GET', '/api/proxy/issues/:id', 0),
        event('POST', '/api/proxy/foreman/status', 5),
        event('PATCH', '/api/proxy/issues/:id', 30) // outside 24h window: daily buckets only
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    const lastHour = HOURLY_WINDOW_HOURS - 1;

    assert.strictEqual(stats.proxyCategoriesHourly.orienting[lastHour], 2);
    assert.strictEqual(stats.proxyCategoriesHourly.reporting[lastHour - 5], 1);
    const hourlyTotal = PROXY_PHASES.reduce(
      (sum, phase) => sum + stats.proxyCategoriesHourly[phase].reduce((a, b) => a + b, 0), 0
    );
    assert.strictEqual(hourlyTotal, 3); // the 30h-old event is excluded
    // ...but it still lands in the daily buckets
    assert.strictEqual(stats.proxyCategories.acting[ACTIVITY_WINDOW_DAYS - 2], 1);
    // Hour keys are UTC 'YYYY-MM-DDTHH', ending at now
    assert.strictEqual(stats.proxyCategoriesHourly.hours[lastHour], '2026-06-10T12');
  });

  test('counts autopilot runs and ranks dispatch kinds across queue and history', async () => {
    const collections = buildCollections({
      dispatchQueue: createMockCollection([
        { _id: 'q1', kind: 'autopilot', dispatchedAt: daysAgo(0) },
        { _id: 'q2', kind: 'research', dispatchedAt: daysAgo(0) }
      ]),
      dispatchHistory: createMockCollection([
        { _id: 'h1', kind: 'autopilot', status: 'taken', dispatchedAt: daysAgo(2) },
        { _id: 'h2', kind: 'implementation', status: 'taken', dispatchedAt: daysAgo(1) },
        { _id: 'h3', kind: 'implementation', status: 'taken', dispatchedAt: daysAgo(2) },
        { _id: 'h4', kind: 'review', status: 'expired', dispatchedAt: daysAgo(3) }
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.totals.autopilotRuns, 2);
    assert.deepStrictEqual(stats.dispatchKinds[0], { label: 'autopilot', count: 2 });
    assert.deepStrictEqual(stats.dispatchKinds[1], { label: 'implementation', count: 2 });
    assert.strictEqual(stats.dispatchKinds.length, 4);
  });

  test('buckets dispatched work by kind into weekly windows', async () => {
    const collections = buildCollections({
      dispatchHistory: createMockCollection([
        { _id: 'h1', kind: 'autopilot', status: 'taken', dispatchedAt: daysAgo(1) },   // newest week
        { _id: 'h2', kind: 'research', status: 'taken', dispatchedAt: daysAgo(2) },    // newest week
        { _id: 'h3', kind: 'research', status: 'taken', dispatchedAt: daysAgo(10) },   // 2 weeks back
        { _id: 'h4', kind: 'research', status: 'taken', dispatchedAt: daysAgo(40) }    // outside windows
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.dispatchByWeek.weeks.length, WEEKLY_WINDOW_WEEKS);

    const research = stats.dispatchByWeek.kinds.find(k => k.label === 'research');
    const autopilot = stats.dispatchByWeek.kinds.find(k => k.label === 'autopilot');
    const lastWeek = WEEKLY_WINDOW_WEEKS - 1;
    assert.strictEqual(research.counts[lastWeek], 1);
    assert.strictEqual(research.counts[lastWeek - 1], 1);
    assert.strictEqual(autopilot.counts[lastWeek], 1);
    // Out-of-window doc contributes to no week
    assert.strictEqual(research.counts.reduce((a, b) => a + b, 0), 2);
  });

  test('folds long-tail kinds into other in the weekly view', async () => {
    const docs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((kind, i) => (
      { _id: `h${i}`, kind, status: 'taken', dispatchedAt: daysAgo(1) }
    ));
    // Make 'a' dominant so the top-5 cut is deterministic
    docs.push({ _id: 'h-extra', kind: 'a', status: 'taken', dispatchedAt: daysAgo(1) });

    const collections = buildCollections({ dispatchHistory: createMockCollection(docs) });
    const stats = await collectKpiStats(collections, { now: NOW });

    const labels = stats.dispatchByWeek.kinds.map(k => k.label);
    assert.strictEqual(labels.length, 6); // top 5 + other
    assert.ok(labels.includes('other'));
    const other = stats.dispatchByWeek.kinds.find(k => k.label === 'other');
    assert.strictEqual(other.counts[WEEKLY_WINDOW_WEEKS - 1], 2); // f, g
  });

  test('builds the work funnel from dispatch status, feedback, and linked steps', async () => {
    const collections = buildCollections({
      dispatchQueue: createMockCollection([
        { _id: 'q1', kind: 'research', dispatchedAt: daysAgo(0) } // dispatched only
      ]),
      dispatchHistory: createMockCollection([
        // taken + feedback + completed step
        { _id: 'h1', kind: 'implementation', status: 'taken', dispatchedAt: daysAgo(2), resolvedAt: daysAgo(1), feedback: [{}] },
        // taken, no feedback, step posted but failed
        { _id: 'h2', kind: 'review', status: 'taken', dispatchedAt: daysAgo(3), resolvedAt: daysAgo(2), feedback: [] },
        // taken, silent (no feedback, no step)
        { _id: 'h3', kind: 'research', status: 'taken', dispatchedAt: daysAgo(4), resolvedAt: daysAgo(3) },
        // expired, never taken
        { _id: 'h4', kind: 'planning', status: 'expired', dispatchedAt: daysAgo(5) }
      ]),
      agentStatus: createMockCollection([
        { dispatchId: 'h1', action: 'implementation', status: 'completed', timestamp: daysAgo(1) },
        { dispatchId: 'h2', action: 'review', status: 'failed', timestamp: daysAgo(2) },
        { dispatchId: 'unknown-dispatch', action: 'review', status: 'completed', timestamp: daysAgo(2) }, // no matching dispatch → ignored
        { action: 'triage', status: 'completed', timestamp: daysAgo(2) } // no dispatchId → not part of the funnel
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.deepStrictEqual(stats.funnel, { dispatched: 5, taken: 3, reported: 2, completed: 1 });
  });

  test('computes median queue→take latency minutes for taken items', async () => {
    // resolvedAt is take/archive time (not completion), so this measures the
    // dispatch→claim wait, not task duration (LIN-400).
    const minutes = (n) => new Date(NOW.getTime() - n * 60000);
    const collections = buildCollections({
      dispatchHistory: createMockCollection([
        { _id: 'h1', status: 'taken', dispatchedAt: minutes(100), resolvedAt: minutes(90) },  // 10m
        { _id: 'h2', status: 'taken', dispatchedAt: minutes(80), resolvedAt: minutes(50) },   // 30m
        { _id: 'h3', status: 'taken', dispatchedAt: minutes(70), resolvedAt: minutes(20) },   // 50m
        { _id: 'h4', status: 'expired', dispatchedAt: minutes(60), resolvedAt: minutes(10) }, // not taken → excluded
        { _id: 'h5', status: 'taken', dispatchedAt: minutes(5) }                              // no resolvedAt → excluded
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.vanity.medianQueueToTakeMinutes, 30);
  });

  test('buckets step outcomes from agent-status, defaulting to other', async () => {
    const entry = (status) => ({ action: 'research', status, timestamp: daysAgo(1) });
    const collections = buildCollections({
      agentStatus: createMockCollection([
        entry('completed'),
        entry('Completed'),   // case-insensitive
        entry('failed'),
        entry('blocked'),
        entry('in-progress'), // unconventional → other
        entry(null)           // missing → other
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.deepStrictEqual(stats.stepOutcomes, { completed: 2, failed: 1, blocked: 1, other: 2 });
  });

  test('classifies proxy responses and ranks top endpoints', async () => {
    const event = (endpoint, status) => ({ endpoint, method: 'GET', status, timestamp: daysAgo(1) });
    const collections = buildCollections({
      proxyEvents: createMockCollection([
        event('/api/proxy/me', 200),
        event('/api/proxy/me', 200),
        event('/api/proxy/issues/:id', 404),
        event('/api/proxy/recommend', 500),
        event('/api/proxy/issues/:id', 200)
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.deepStrictEqual(stats.proxyStatus, { ok: 3, clientError: 1, serverError: 1 });
    // Tied counts break alphabetically for deterministic output
    assert.deepStrictEqual(stats.topEndpoints[0], { label: '/api/proxy/issues/:id', count: 2 });
    assert.deepStrictEqual(stats.topEndpoints[1], { label: '/api/proxy/me', count: 2 });
    assert.deepStrictEqual(stats.topEndpoints[2], { label: '/api/proxy/recommend', count: 1 });
  });

  test('histograms all agent actions by UTC hour', async () => {
    const at = (iso) => new Date(iso);
    const collections = buildCollections({
      proxyEvents: createMockCollection([
        { method: 'GET', endpoint: '/api/proxy/me', status: 200, timestamp: at('2026-06-10T03:15:00Z') },
        { method: 'GET', endpoint: '/api/proxy/me', status: 200, timestamp: at('2026-06-09T03:45:00Z') }
      ]),
      agentStatus: createMockCollection([
        { action: 'review', status: 'completed', timestamp: at('2026-06-10T11:00:00Z') }
      ]),
      dispatchQueue: createMockCollection([
        { _id: 'q1', kind: 'research', dispatchedAt: at('2026-06-10T03:59:00Z') }
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.hourOfDay[3], 3);
    assert.strictEqual(stats.hourOfDay[11], 1);
    assert.strictEqual(stats.hourOfDay.reduce((a, b) => a + b, 0), 4);
  });

  test('sums free tier usage per day, excluding global hourly records', async () => {
    const yesterday = daysAgo(1).toISOString().slice(0, 10);
    const collections = buildCollections({
      freeTier: createMockCollection([
        { urlKey: 'acme', date: yesterday, count: 4 },
        { urlKey: 'globex', date: yesterday, count: 2 },
        { urlKey: null, date: `${yesterday}T10`, count: 50 } // global hourly: excluded
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.freeTier.days.length, FREE_TIER_WINDOW_DAYS);
    assert.strictEqual(stats.freeTier.counts[FREE_TIER_WINDOW_DAYS - 2], 6);
  });

  test('sums cache, token, and local provider counts', async () => {
    const collections = buildCollections({
      recapCache: createMockCollection([{ _id: 'w:1' }, { _id: 'w:2' }]),
      briefCache: createMockCollection([{ _id: 'w:1' }]),
      proxyTokens: createMockCollection([{ _id: 't1' }, { _id: 't2' }]),
      dispatchTokens: createMockCollection([{ _id: 't3' }]),
      localIssues: createMockCollection([
        { kind: 'issue' }, { kind: 'issue' }, { kind: 'project' }
      ]),
      reportHistory: createMockCollection([{ urlKey: 'acme', generatedAt: daysAgo(1) }]),
      customPrompts: createMockCollection([{ urlKey: 'acme', name: 'My prompt', template: 'do {{thing}}' }])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.totals.aiSummaries, 3);
    assert.strictEqual(stats.totals.activeTokens, 3);
    assert.strictEqual(stats.totals.localIssues, 2);
    assert.strictEqual(stats.totals.localProjects, 1);
    assert.strictEqual(stats.totals.roadmapReports, 1);
    assert.strictEqual(stats.totals.customPrompts, 1);
  });

  test('privacy: no workspace keys, prompts, or summaries leak into the stats', async () => {
    const collections = buildCollections({
      workspacePreferences: createMockCollection([{ _id: 'secret-workspace', preferences: { modelId: 'some/model' } }]),
      dispatchQueue: createMockCollection([{
        _id: 'q1',
        urlKey: 'secret-workspace',
        prompt: 'TOP-SECRET-PROMPT-TEXT',
        issueTitle: 'Confidential issue title',
        issueIdentifier: 'LIN-999',
        dispatchedAt: daysAgo(0)
      }]),
      agentStatus: createMockCollection([{
        urlKey: 'secret-workspace',
        action: 'implementation',
        summary: 'CONFIDENTIAL-SUMMARY-CONTENT',
        taskIdentifier: 'LIN-999',
        timestamp: daysAgo(0)
      }]),
      sessions: createMockCollection([{
        _id: 'sess1',
        session: { workspaces: [{ accessToken: 'lin_oauth_SECRET_TOKEN' }] },
        expires: daysAgo(-1)
      }])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    const serialized = JSON.stringify(stats);

    assert.ok(!serialized.includes('secret-workspace'), 'workspace urlKey leaked');
    assert.ok(!serialized.includes('TOP-SECRET-PROMPT-TEXT'), 'prompt text leaked');
    assert.ok(!serialized.includes('Confidential issue title'), 'issue title leaked');
    assert.ok(!serialized.includes('CONFIDENTIAL-SUMMARY-CONTENT'), 'agent summary leaked');
    assert.ok(!serialized.includes('LIN-999'), 'issue identifier leaked');
    assert.ok(!serialized.includes('SECRET_TOKEN'), 'session token leaked');
  });
});

// LIN-1586 pins the PROJECTION half of the LIN-1539/LIN-1540 verdict, the half
// the aggregation-path privacy test below explicitly does not cover. `note` is
// free text; /kpis is unauthenticated, so free text fails open there. Beat 1
// adds a SECOND reader of `note` (the credential-health read, which is
// session-authenticated and workspace-scoped) — the moment a field has two
// readers, "the other one doesn't read it" stops being obvious, so the guard is
// asserted here rather than assumed.
describe('PROXY_FIELDS keeps the free-text note out of the unauthenticated read (LIN-1586)', () => {
  // The find() fallback is the branch PROXY_FIELDS governs; a spy records the
  // projection the collection is actually handed.
  function createProjectionSpy(docs = []) {
    const calls = [];
    return {
      _calls: calls,
      find(query = {}, options) {
        calls.push({ query, options });
        return { toArray: async () => docs };
      },
      async countDocuments() { return docs.length; }
    };
  }

  test('the proxy-event projection omits note entirely', async () => {
    const proxyEvents = createProjectionSpy([
      { method: 'GET', endpoint: '/api/proxy/me', status: 200, timestamp: daysAgo(0), urlKey: 'acme', note: 'SENSITIVE-NOTE-BREADCRUMB' }
    ]);
    await collectKpiStats(buildCollections({ proxyEvents }), { now: NOW });

    const projection = proxyEvents._calls.at(-1)?.options?.projection;
    assert.ok(projection, 'the proxy-event read must be projected, not a raw find({})');
    assert.strictEqual(projection.note, undefined, 'note must stay out of PROXY_FIELDS');
    assert.deepStrictEqual(Object.keys(projection).sort(),
      ['endpoint', 'method', 'status', 'timestamp', 'urlKey']);
  });

  test('a note in the source docs still never reaches the serialized stats', async () => {
    // The emit half, on the find() branch (its aggregate-branch twin lives below).
    const proxyEvents = createProjectionSpy([
      { method: 'GET', endpoint: '/api/proxy/me', status: 200, timestamp: daysAgo(0), urlKey: 'acme', note: 'SENSITIVE-NOTE-BREADCRUMB' }
    ]);
    const stats = await collectKpiStats(buildCollections({ proxyEvents }), { now: NOW });
    assert.ok(!JSON.stringify(stats).includes('SENSITIVE-NOTE-BREADCRUMB'), 'proxy event note leaked');
  });
});

// The headline outcome metric (LIN-1596). One seed, exercised here through the
// mock (find) path and again below through real MangoDB's aggregation path, so
// the two shapes — a raw `feedback[]` vs a single derived `terminalEntry` —
// are proven to produce identical numbers rather than assumed to.
const marker = (message, days) => ({
  message,
  timestamp: new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
});

// A mixed seed covering every rule the metric encodes: the three slices, the
// two exclusions, abort attribution, and follow-up lineage collapsing.
function outcomeSeed() {
  return [
    // --- the three slices ---
    { _id: 'h-done', rootItemId: 'h-done', status: 'taken', dispatchedAt: daysAgo(3), feedback: [marker('heartbeat: still going', 3), marker('[done] landed it', 2)] },
    { _id: 'h-failed', rootItemId: 'h-failed', status: 'taken', dispatchedAt: daysAgo(3), feedback: [marker('[failed] remote-control never connected', 2)] },
    // --- abort: the marker lives on the abort ROW, targeting h-target ---
    { _id: 'h-abortrow', rootItemId: 'h-abortrow', abort: true, abortTo: 'h-target', status: 'taken', dispatchedAt: daysAgo(3), feedback: [marker('[aborted] cascade cancel', 2)] },
    { _id: 'h-target', rootItemId: 'h-target', status: 'taken', dispatchedAt: daysAgo(3), feedback: [] },
    // --- exclusions ---
    { _id: 'h-skipped', rootItemId: 'h-skipped', status: 'taken', dispatchedAt: daysAgo(3), feedback: [marker('[skipped] human-continued session', 2)] },
    { _id: 'h-unconfirmed', rootItemId: 'h-unconfirmed', status: 'taken', dispatchedAt: daysAgo(3), feedback: [marker('[ended·unconfirmed] session ended without a sentinel', 2)] },
    { _id: 'h-nofeedback', rootItemId: 'h-nofeedback', status: 'taken', dispatchedAt: daysAgo(3), feedback: [] },
    // --- one lineage, two rows: the later marker wins, counted ONCE ---
    { _id: 'h-lin1', rootItemId: 'h-lin1', status: 'taken', dispatchedAt: daysAgo(6), feedback: [marker('[failed] first attempt', 6)] },
    { _id: 'h-lin2', rootItemId: 'h-lin1', followUpTo: 'h-lin1', status: 'taken', dispatchedAt: daysAgo(5), feedback: [marker('[done] follow-up landed it', 5)] }
  ];
}

describe('collectKpiStats — dispatch outcomes (find path)', () => {
  async function outcomes(history, queue = []) {
    const stats = await collectKpiStats(buildCollections({
      dispatchHistory: createMockCollection(history),
      dispatchQueue: createMockCollection(queue)
    }), { now: NOW });
    return stats.dispatchOutcomes;
  }

  test('computes the three slices and the landed rate from a mixed seed', async () => {
    const result = await outcomes(outcomeSeed());

    // done: h-done + the h-lin1 lineage. failed: h-failed. aborted: h-target.
    assert.strictEqual(result.done, 2);
    assert.strictEqual(result.failed, 1);
    assert.strictEqual(result.aborted, 1);
    assert.strictEqual(result.resolved, 4);
    assert.strictEqual(result.rate, 0.5);
    assert.strictEqual(result.windowDays, OUTCOME_WINDOW_DAYS);
  });

  test('excludes [skipped] from BOTH numerator and denominator', async () => {
    const result = await outcomes(outcomeSeed());
    // 6 lineages in `total`: h-done, h-failed, h-target, h-unconfirmed,
    // h-nofeedback, h-lin1. The abort ROW and the [skipped] row are both gone.
    assert.strictEqual(result.total, 6);
    // A skipped-only instance has nothing to report at all.
    const onlySkipped = await outcomes([outcomeSeed().find(d => d._id === 'h-skipped')]);
    assert.strictEqual(onlySkipped.total, 0);
    assert.strictEqual(onlySkipped.resolved, 0);
    assert.strictEqual(onlySkipped.rate, null);
  });

  test('[ended·unconfirmed] and empty feedback land in total but not resolved', async () => {
    const result = await outcomes(outcomeSeed().filter(d => ['h-unconfirmed', 'h-nofeedback'].includes(d._id)));
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.resolved, 0);
    assert.strictEqual(result.rate, null, 'no resolved lineages → null, never 0');
  });

  test('attributes an abort row\'s [aborted] to its target and drops the abort row itself', async () => {
    const result = await outcomes(outcomeSeed().filter(d => ['h-abortrow', 'h-target'].includes(d._id)));
    // One cancelled task = ONE aborted lineage, not an [aborted] row plus an
    // unresolved target (the LIN-1257 case).
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.resolved, 1);
    assert.strictEqual(result.aborted, 1);
    assert.strictEqual(result.rate, 0);
  });

  test('never lets an EARLIER harvested abort override a LATER genuine terminal', async () => {
    // The shared F1 guard (LIN-1261), inherited by consuming the seam.
    const result = await outcomes([
      { _id: 'ab', rootItemId: 'ab', abort: true, abortTo: 'tgt', status: 'taken', dispatchedAt: daysAgo(3), feedback: [marker('[aborted] too late', 4)] },
      { _id: 'tgt', rootItemId: 'tgt', status: 'taken', dispatchedAt: daysAgo(5), feedback: [marker('[done] already finished', 2)] }
    ]);
    assert.strictEqual(result.done, 1);
    assert.strictEqual(result.aborted, 0);
  });

  test('counts a two-row follow-up lineage ONCE, taking the later marker', async () => {
    const result = await outcomes(outcomeSeed().filter(d => ['h-lin1', 'h-lin2'].includes(d._id)));
    assert.strictEqual(result.total, 1, 'the anti-inflation rule: rows collapse to one lineage');
    assert.strictEqual(result.resolved, 1);
    assert.strictEqual(result.done, 1);
    assert.strictEqual(result.failed, 0, 'the earlier [failed] is superseded');
    assert.strictEqual(result.rate, 1);
  });

  test('pre-LIN-1468 rows with no rootItemId degrade to per-row counting', async () => {
    const result = await outcomes([
      { _id: 'old1', status: 'taken', dispatchedAt: daysAgo(2), feedback: [marker('[done] a', 1)] },
      { _id: 'old2', status: 'taken', dispatchedAt: daysAgo(2), feedback: [marker('[failed] b', 1)] }
    ]);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.rate, 0.5);
  });

  test('rate is null on an empty instance, and queue rows contribute unresolved lineages', async () => {
    const empty = await outcomes([]);
    assert.strictEqual(empty.rate, null);
    assert.strictEqual(empty.total, 0);
    assert.deepStrictEqual(empty.weeklyRate, new Array(OUTCOME_WINDOW_WEEKS).fill(null));

    // Queue rows never carry feedback (addFeedback writes only to history).
    const queued = await outcomes([], [{ _id: 'q1', rootItemId: 'q1', dispatchedAt: daysAgo(0) }]);
    assert.strictEqual(queued.total, 1);
    assert.strictEqual(queued.resolved, 0);
    assert.strictEqual(queued.rate, null);
  });

  test('buckets each lineage into exactly one week, keyed on its EARLIEST dispatch', async () => {
    const result = await outcomes([
      { _id: 'w-new', rootItemId: 'w-new', status: 'taken', dispatchedAt: daysAgo(1), feedback: [marker('[done] recent', 0)] },
      // Dispatched 20d ago, finished 1d ago: the lineage belongs to the OLD
      // bucket (dispatch time), and its follow-up must not double-count it.
      { _id: 'w-old', rootItemId: 'w-old', status: 'taken', dispatchedAt: daysAgo(20), feedback: [marker('[failed] slow burn', 19)] },
      { _id: 'w-oldfu', rootItemId: 'w-old', followUpTo: 'w-old', status: 'taken', dispatchedAt: daysAgo(2), feedback: [marker('[done] eventually', 1)] }
    ]);

    assert.strictEqual(result.weeks.length, OUTCOME_WINDOW_WEEKS);
    assert.strictEqual(result.weeklyResolved.length, OUTCOME_WINDOW_WEEKS);
    assert.deepStrictEqual(result.weeklyResolved, [0, 1, 0, 1], 'one lineage per bucket, keyed on earliest dispatch');
    assert.deepStrictEqual(result.weeklyRate, [null, 1, null, 1]);
    assert.strictEqual(result.total, 2);
  });

  test('excludes lineages dispatched outside the 30-day window', async () => {
    const result = await outcomes([
      { _id: 'stale', rootItemId: 'stale', status: 'taken', dispatchedAt: daysAgo(45), feedback: [marker('[done] ancient', 44)] }
    ]);
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.rate, null);
  });

  test('privacy: a terminal marker\'s free-text tail never reaches the stats', async () => {
    const stats = await collectKpiStats(buildCollections({
      dispatchHistory: createMockCollection([
        { _id: 'h1', urlKey: 'secret-workspace', status: 'taken', rootItemId: 'h1', dispatchedAt: daysAgo(1), feedback: [marker('[done] MARKER-FREE-TEXT-TAIL', 0)] }
      ])
    }), { now: NOW });

    const serialized = JSON.stringify(stats);
    assert.strictEqual(stats.dispatchOutcomes.done, 1, 'the marker was read');
    assert.ok(!serialized.includes('MARKER-FREE-TEXT-TAIL'), 'marker free-text leaked');
    assert.ok(!serialized.includes('secret-workspace'), 'workspace urlKey leaked');
  });
});

// The production read path runs DB-side aggregation (group proxy events by
// method/endpoint/status/UTC-hour; drop dispatch feedback[] to a count) instead
// of pulling whole collections into memory — that full read is what pushed
// /kpis past the 30s router timeout. The mock above exercises the find()
// fallback; these tests run the SAME assertions against a real MangoDB instance
// so the aggregation pipelines are proven to produce identical results.
describe('collectKpiStats (aggregation path, real MangoDB)', () => {
  let client;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'kpi-agg-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  // Build a real, isolated collection set seeded with the given docs. Only the
  // collections under test need real data; the rest are empty real collections.
  async function realCollections(seed = {}) {
    const db = client.db(`kpi_${counter++}`);
    const names = [
      'sessions', 'userPreferences', 'workspacePreferences', 'customPrompts',
      'localIssues', 'dispatchQueue', 'dispatchHistory', 'dispatchTokens',
      'proxyTokens', 'proxyEvents', 'agentStatus', 'freeTier', 'recapCache',
      'briefCache', 'reportHistory'
    ];
    const collections = {};
    for (const name of names) {
      const col = db.collection(name);
      const docs = seed[name];
      if (Array.isArray(docs) && docs.length) await col.insertMany(docs);
      collections[name] = col;
    }
    return collections;
  }

  test('proxy day/hour buckets, read:write ratio and totals match the find path', async () => {
    const event = (method, endpoint, days) => ({ method, endpoint, status: 200, timestamp: daysAgo(days) });
    const collections = await realCollections({
      proxyEvents: [
        event('GET', '/api/proxy/stack', 0),
        event('GET', '/api/proxy/issues/:id', 0),
        event('POST', '/api/proxy/recommend-and-dispatch', 0),
        event('GET', '/api/proxy/dispatch/:id', 0),
        event('POST', '/api/proxy/foreman/status', 3),
        event('PATCH', '/api/proxy/issues/:id', 3),
        event('GET', '/api/proxy/me', 45) // outside window: totals only, not buckets
      ]
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    const last = ACTIVITY_WINDOW_DAYS - 1;

    assert.strictEqual(stats.proxyCategories.orienting[last], 2);
    assert.strictEqual(stats.proxyCategories.deciding[last], 1);
    assert.strictEqual(stats.proxyCategories.watching[last], 1);
    assert.strictEqual(stats.proxyCategories.reporting[last - 3], 1);
    assert.strictEqual(stats.proxyCategories.acting[last - 3], 1);
    assert.strictEqual(stats.totals.agentActions, 7); // includes the out-of-window event
    assert.strictEqual(stats.vanity.readsPerWrite, 1.3);
    assert.strictEqual(stats.vanity.busiestDay.count, 4);
  });

  test('proxy hourly buckets and UTC-hour key match the find path', async () => {
    const hoursAgo = (n) => new Date(NOW.getTime() - n * 60 * 60 * 1000);
    const event = (method, endpoint, hours) => ({ method, endpoint, status: 200, timestamp: hoursAgo(hours) });
    const collections = await realCollections({
      proxyEvents: [
        event('GET', '/api/proxy/stack', 0),
        event('GET', '/api/proxy/issues/:id', 0),
        event('POST', '/api/proxy/foreman/status', 5),
        event('PATCH', '/api/proxy/issues/:id', 30) // outside 24h window
      ]
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    const lastHour = HOURLY_WINDOW_HOURS - 1;
    assert.strictEqual(stats.proxyCategoriesHourly.orienting[lastHour], 2);
    assert.strictEqual(stats.proxyCategoriesHourly.reporting[lastHour - 5], 1);
    assert.strictEqual(stats.proxyCategoriesHourly.hours[lastHour], '2026-06-10T12');
    assert.strictEqual(stats.proxyCategories.acting[ACTIVITY_WINDOW_DAYS - 2], 1);
  });

  test('proxy status classes and top endpoints match the find path', async () => {
    const event = (endpoint, status) => ({ endpoint, method: 'GET', status, timestamp: daysAgo(1) });
    const collections = await realCollections({
      proxyEvents: [
        event('/api/proxy/me', 200),
        event('/api/proxy/me', 200),
        event('/api/proxy/issues/:id', 404),
        event('/api/proxy/recommend', 500),
        event('/api/proxy/issues/:id', 200)
      ]
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.deepStrictEqual(stats.proxyStatus, { ok: 3, clientError: 1, serverError: 1 });
    assert.deepStrictEqual(stats.topEndpoints[0], { label: '/api/proxy/issues/:id', count: 2 });
    assert.deepStrictEqual(stats.topEndpoints[1], { label: '/api/proxy/me', count: 2 });
    assert.deepStrictEqual(stats.topEndpoints[2], { label: '/api/proxy/recommend', count: 1 });
  });

  test('hour-of-day histogram and workspace union match the find path', async () => {
    const at = (iso) => new Date(iso);
    const collections = await realCollections({
      proxyEvents: [
        { method: 'GET', endpoint: '/api/proxy/me', status: 200, timestamp: at('2026-06-10T03:15:00Z'), urlKey: 'acme' },
        { method: 'GET', endpoint: '/api/proxy/me', status: 200, timestamp: at('2026-06-09T03:45:00Z'), urlKey: 'globex' }
      ],
      agentStatus: [
        { dispatchId: 'h1', action: 'review', status: 'completed', timestamp: at('2026-06-10T11:00:00Z'), urlKey: 'initech' }
      ],
      dispatchQueue: [
        { _id: 'q1', kind: 'research', dispatchedAt: at('2026-06-10T03:59:00Z') }
      ]
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.strictEqual(stats.hourOfDay[3], 3);
    assert.strictEqual(stats.hourOfDay[11], 1);
    assert.strictEqual(stats.hourOfDay.reduce((a, b) => a + b, 0), 4);
    assert.strictEqual(stats.totals.workspaces, 3); // acme, globex, initech
  });

  test('work funnel and feedback notes survive the feedback[] → count projection', async () => {
    const collections = await realCollections({
      dispatchQueue: [
        { _id: 'q1', kind: 'research', dispatchedAt: daysAgo(0) }
      ],
      dispatchHistory: [
        { _id: 'h1', kind: 'implementation', status: 'taken', dispatchedAt: daysAgo(2), resolvedAt: daysAgo(1), feedback: [{ note: 'a' }, { note: 'b' }] },
        { _id: 'h2', kind: 'review', status: 'taken', dispatchedAt: daysAgo(3), resolvedAt: daysAgo(2), feedback: [] },
        { _id: 'h3', kind: 'research', status: 'taken', dispatchedAt: daysAgo(4), resolvedAt: daysAgo(3) }, // no feedback field
        { _id: 'h4', kind: 'planning', status: 'expired', dispatchedAt: daysAgo(5) }
      ],
      agentStatus: [
        { dispatchId: 'h1', action: 'implementation', status: 'completed', timestamp: daysAgo(1) },
        { dispatchId: 'h2', action: 'review', status: 'failed', timestamp: daysAgo(2) }
      ]
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    // h1 reported (2 feedback) + h2 reported (linked step) → reported: 2
    assert.deepStrictEqual(stats.funnel, { dispatched: 5, taken: 3, reported: 2, completed: 1 });
    assert.strictEqual(stats.totals.feedbackNotes, 2); // only h1's two notes, counted via $size
  });

  test('does not leak workspace keys or feedback content through aggregation', async () => {
    const collections = await realCollections({
      proxyEvents: [
        // `note` is a FREE-TEXT breadcrumb (lib/proxy-events.js), not an enum: today's
        // writers are a reason token (LIN-1540) and an English sentence (LIN-961's
        // free-tier fallback), and nothing constrains a future writer. It is therefore
        // deliberately NOT projected into PROXY_FIELDS or emitted here — see the
        // LIN-1540 verdict. What this pins is the EMIT half: whatever a note carries
        // never reaches the serialized stats. It does NOT pin the projection half —
        // adding `note: 1` to PROXY_FIELDS keeps this green, which is correct by the
        // same reasoning (`urlKey` IS projected yet reduced to a count; the boundary
        // sits at emit, not at projection). The two defenses are complementary: this
        // test seeds the `aggregate` branch of loadProxyBins, while the `find`
        // fallback is defended by PROXY_FIELDS omitting `note` in the first place.
        { method: 'GET', endpoint: '/api/proxy/me', status: 200, timestamp: daysAgo(0), urlKey: 'secret-workspace', note: 'SENSITIVE-NOTE-BREADCRUMB' }
      ],
      dispatchHistory: [
        { _id: 'h1', urlKey: 'secret-workspace', kind: 'implementation', status: 'taken', dispatchedAt: daysAgo(1), feedback: [{ body: 'CONFIDENTIAL-FEEDBACK-BODY' }] }
      ]
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    const serialized = JSON.stringify(stats);
    assert.ok(!serialized.includes('secret-workspace'), 'workspace urlKey leaked');
    assert.ok(!serialized.includes('CONFIDENTIAL-FEEDBACK-BODY'), 'feedback content leaked');
    assert.ok(!serialized.includes('SENSITIVE-NOTE-BREADCRUMB'), 'proxy event note leaked');
  });

  // --- dispatch outcomes (LIN-1596) through the aggregation path ---

  test('derives the outcome slices in-DB, matching the find path exactly', async () => {
    const collections = await realCollections({ dispatchHistory: outcomeSeed() });
    const stats = await collectKpiStats(collections, { now: NOW });

    assert.strictEqual(stats.dispatchOutcomes.done, 2);
    assert.strictEqual(stats.dispatchOutcomes.failed, 1);
    assert.strictEqual(stats.dispatchOutcomes.aborted, 1);
    assert.strictEqual(stats.dispatchOutcomes.resolved, 4);
    assert.strictEqual(stats.dispatchOutcomes.total, 6);
    assert.strictEqual(stats.dispatchOutcomes.rate, 0.5);
  });

  test('parity: one seed yields identical dispatchOutcomes on both load paths', async () => {
    // The ONLY shape difference is `feedback[]` vs the derived `terminalEntry`,
    // absorbed at a single helper. This pins that the abort harvest, the F1
    // guard, lineage grouping and weekly bucketing all agree across the two.
    const seed = outcomeSeed();
    const aggregated = await collectKpiStats(await realCollections({ dispatchHistory: seed }), { now: NOW });
    const found = await collectKpiStats(
      buildCollections({ dispatchHistory: createMockCollection(seed) }),
      { now: NOW }
    );

    assert.deepStrictEqual(aggregated.dispatchOutcomes, found.dispatchOutcomes);
  });

  test('projection returns no raw feedback array, only the single derived entry', async () => {
    // The standing guard on the /kpis timeout fix (ea7abb56): the fattest field
    // in the collection must never cross the wire, even though the outcome
    // metric now needs the marker inside it.
    const collections = await realCollections({
      dispatchHistory: [{
        _id: 'h1', rootItemId: 'h1', status: 'taken', dispatchedAt: daysAgo(2),
        feedback: [
          { message: 'heartbeat', timestamp: daysAgo(2).toISOString(), telemetry: 'BULKY-HEARTBEAT-PAYLOAD' },
          { message: '[done] finished', timestamp: daysAgo(1).toISOString() }
        ]
      }]
    });

    const projected = await collections.dispatchHistory.aggregate([
      {
        $project: {
          feedbackCount: { $size: { $ifNull: ['$feedback', []] } },
          terminalEntry: {
            $last: {
              $filter: {
                input: {
                  $map: {
                    input: { $ifNull: ['$feedback', []] },
                    as: 'f',
                    in: { message: '$$f.message', timestamp: '$$f.timestamp' }
                  }
                },
                as: 'entry',
                cond: {
                  $regexMatch: {
                    input: { $ifNull: ['$$entry.message', ''] },
                    regex: '^\\s*\\[(done|complete|failed|aborted|skipped)\\]',
                    options: 'i'
                  }
                }
              }
            }
          }
        }
      }
    ]).toArray();

    assert.strictEqual(projected.length, 1);
    assert.ok(!('feedback' in projected[0]), 'raw feedback array leaked into the projection');
    assert.strictEqual(projected[0].feedbackCount, 2);
    assert.deepStrictEqual(Object.keys(projected[0].terminalEntry).sort(), ['message', 'timestamp']);
    assert.ok(!JSON.stringify(projected).includes('BULKY-HEARTBEAT-PAYLOAD'), 'non-terminal entry content leaked');
  });
});
