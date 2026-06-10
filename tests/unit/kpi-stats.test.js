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
import { collectKpiStats, ACTIVITY_WINDOW_DAYS, FREE_TIER_WINDOW_DAYS } from '../../lib/kpi-stats.js';

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
    foremanStatus: empty(),
    freeTier: empty(),
    recapCache: empty(),
    briefCache: empty(),
    reportHistory: empty(),
    ...overrides
  };
}

describe('collectKpiStats', () => {
  test('returns all-zero stats for an empty instance', async () => {
    const stats = await collectKpiStats(buildCollections(), { now: NOW });

    assert.strictEqual(stats.totals.workspaces, 0);
    assert.strictEqual(stats.totals.users, 0);
    assert.strictEqual(stats.totals.activeSessions, 0);
    assert.strictEqual(stats.totals.agentActions, 0);
    assert.strictEqual(stats.totals.dispatches, 0);
    assert.strictEqual(stats.totals.aiSummaries, 0);
    assert.strictEqual(stats.totals.activeTokens, 0);
    assert.strictEqual(stats.activity.days.length, ACTIVITY_WINDOW_DAYS);
    assert.ok(stats.activity.proxy.every(count => count === 0));
    assert.strictEqual(stats.vanity.busiestDay, null);
    assert.deepStrictEqual(stats.dispatchOutcomes, { queued: 0, taken: 0, expired: 0, cancelled: 0 });
  });

  test('counts workspaces as the union of keys across collections', async () => {
    const collections = buildCollections({
      workspacePreferences: createMockCollection([{ _id: 'acme' }, { _id: 'globex' }]),
      proxyEvents: createMockCollection([{ urlKey: 'acme', endpoint: '/api/proxy/me', status: 200, timestamp: daysAgo(1) }]),
      foremanStatus: createMockCollection([{ urlKey: 'initech', action: 'review', timestamp: daysAgo(2) }]),
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

  test('buckets activity per UTC day, ignoring out-of-window docs', async () => {
    const collections = buildCollections({
      proxyEvents: createMockCollection([
        { endpoint: '/api/proxy/me', status: 200, timestamp: daysAgo(0) },
        { endpoint: '/api/proxy/me', status: 200, timestamp: daysAgo(0) },
        { endpoint: '/api/proxy/teams', status: 200, timestamp: daysAgo(3) },
        { endpoint: '/api/proxy/teams', status: 200, timestamp: daysAgo(45) } // outside window
      ]),
      foremanStatus: createMockCollection([
        { action: 'implementation', timestamp: daysAgo(3) }
      ]),
      dispatchQueue: createMockCollection([
        { prompt: 'secret prompt', dispatchedAt: daysAgo(0) }
      ]),
      dispatchHistory: createMockCollection([
        { prompt: 'older prompt', status: 'taken', dispatchedAt: daysAgo(3), feedback: [{}, {}] }
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    const last = ACTIVITY_WINDOW_DAYS - 1;

    assert.strictEqual(stats.activity.proxy[last], 2);
    assert.strictEqual(stats.activity.proxy[last - 3], 1);
    assert.strictEqual(stats.activity.foreman[last - 3], 1);
    assert.strictEqual(stats.activity.dispatch[last], 1);
    assert.strictEqual(stats.activity.dispatch[last - 3], 1);
    // Out-of-window doc still counts toward the total, just not the series
    assert.strictEqual(stats.totals.agentActions, 5);
    assert.strictEqual(stats.totals.dispatches, 2);
    assert.strictEqual(stats.totals.feedbackNotes, 2);

    // Busiest day: today has 2 proxy + 1 dispatch = 3 vs 3 on day -3 — first max wins
    assert.ok(stats.vanity.busiestDay);
    assert.strictEqual(stats.vanity.busiestDay.count, 3);
  });

  test('aggregates dispatch outcomes from queue and history', async () => {
    const collections = buildCollections({
      dispatchQueue: createMockCollection([{ dispatchedAt: daysAgo(0) }]),
      dispatchHistory: createMockCollection([
        { status: 'taken', dispatchedAt: daysAgo(1) },
        { status: 'taken', dispatchedAt: daysAgo(2) },
        { status: 'expired', dispatchedAt: daysAgo(2) },
        { status: 'cancelled', dispatchedAt: daysAgo(3) },
        { status: 'unknown-status', dispatchedAt: daysAgo(3) } // ignored, not an own bucket
      ])
    });

    const stats = await collectKpiStats(collections, { now: NOW });
    assert.deepStrictEqual(stats.dispatchOutcomes, { queued: 1, taken: 2, expired: 1, cancelled: 1 });
  });

  test('classifies proxy responses and ranks top endpoints', async () => {
    const event = (endpoint, status) => ({ endpoint, status, timestamp: daysAgo(1) });
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
        urlKey: 'secret-workspace',
        prompt: 'TOP-SECRET-PROMPT-TEXT',
        issueTitle: 'Confidential issue title',
        issueIdentifier: 'LIN-999',
        dispatchedAt: daysAgo(0)
      }]),
      foremanStatus: createMockCollection([{
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
    assert.ok(!serialized.includes('CONFIDENTIAL-SUMMARY-CONTENT'), 'foreman summary leaked');
    assert.ok(!serialized.includes('LIN-999'), 'issue identifier leaked');
    assert.ok(!serialized.includes('SECRET_TOKEN'), 'session token leaked');
  });
});
