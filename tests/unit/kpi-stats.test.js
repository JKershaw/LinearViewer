/**
 * Unit tests for lib/kpi-stats.js
 *
 * Run with: node --test tests/unit/kpi-stats.test.js
 *
 * Covers the aggregate shapes the public /kpis page depends on, plus the
 * privacy guarantee: no workspace urlKey, prompt text, or summary content
 * may appear anywhere in the collected stats (the page is public).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  collectKpiStats, categorizeProxyEvent, PROXY_PHASES,
  ACTIVITY_WINDOW_DAYS, HOURLY_WINDOW_HOURS, FREE_TIER_WINDOW_DAYS, WEEKLY_WINDOW_WEEKS
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
