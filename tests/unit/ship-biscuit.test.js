/**
 * Unit tests for lib/ship-biscuit.js — the deterministic Ship's Biscuit edition
 * model (LIN-818, V1).
 *
 * Run with: node --test tests/unit/ship-biscuit.test.js
 *
 * Covers the load-bearing properties the design flagged for the close-out ledger:
 *  - determinism + addressability of buildEditionModel (the §B grounding contract:
 *    stable, unique, resolvable source ids that snapshot content by value),
 *  - quiet-window honesty (empty window → isQuiet, zero news slices),
 *  - the window→TTL cap (month is max; an oversized request clamps to month).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildEditionModel,
  resolveWindow,
  windowRange,
  formatEditionContext,
  WINDOWS,
  DEFAULT_WINDOW,
  MAX_WINDOW
} from '../../lib/ship-biscuit.js';

const NOW = Date.UTC(2026, 6, 9, 12, 0, 0); // 2026-07-09T12:00:00Z, fixed clock

function sessionAt(id, offsetDays, extra = {}) {
  const ts = new Date(NOW - offsetDays * 86400000).toISOString();
  return {
    sessionId: id,
    seedIssue: extra.seedIssue || 'LIN-1',
    tasksTouched: extra.tasksTouched || ['LIN-1'],
    dispatchedAt: ts,
    completedAt: ts,
    telemetry: { runtime: '5m' },
    loops: extra.loops || [
      { loopId: `${id}-l1`, issueIdentifier: 'LIN-1', issueTitle: 'A task', promptName: 'implement', agentState: 'complete', agentSummary: 'Did the work.' }
    ],
    ...extra
  };
}

function statusAt(id, offsetDays, extra = {}) {
  return {
    id,
    taskIdentifier: extra.taskIdentifier || 'LIN-2',
    action: extra.action || 'investigate',
    status: extra.status || 'completed',
    summary: extra.summary || 'Found the root cause and noted it.',
    timestamp: new Date(NOW - offsetDays * 86400000).toISOString()
  };
}

describe('resolveWindow', () => {
  test('passes recognised windows through', () => {
    for (const w of WINDOWS) assert.strictEqual(resolveWindow(w), w);
  });
  test('defaults unknown/empty to week', () => {
    assert.strictEqual(resolveWindow(''), DEFAULT_WINDOW);
    assert.strictEqual(resolveWindow('fortnight'), DEFAULT_WINDOW);
    assert.strictEqual(resolveWindow(undefined), DEFAULT_WINDOW);
  });
  test('clamps an oversized window down to the month max (TTL ceiling)', () => {
    assert.strictEqual(resolveWindow('quarter'), MAX_WINDOW);
    assert.strictEqual(resolveWindow('year'), MAX_WINDOW);
    assert.strictEqual(MAX_WINDOW, 'month');
  });
});

describe('windowRange', () => {
  test('day/week/month map to 1/7/30 days back from now', () => {
    assert.strictEqual(windowRange('day', NOW).days, 1);
    assert.strictEqual(windowRange('week', NOW).days, 7);
    assert.strictEqual(windowRange('month', NOW).days, 30);
    const wk = windowRange('week', NOW);
    assert.strictEqual(wk.now.getTime(), NOW);
    assert.strictEqual(wk.since.getTime(), NOW - 7 * 86400000);
  });
});

describe('buildEditionModel — quiet window honesty', () => {
  test('empty sources → isQuiet with zero slices', () => {
    const m = buildEditionModel({ window: 'week', now: NOW, sessions: [], agentStatusItems: [], llmStats: null });
    assert.strictEqual(m.isQuiet, true);
    assert.strictEqual(m.sources.length, 0);
    assert.strictEqual(m.counts.total, 0);
    assert.match(formatEditionContext(m), /NO activity/);
  });

  test('a status entry with an empty summary carries no news (no article feedstock)', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      sessions: [], agentStatusItems: [statusAt('s1', 1, { summary: '   ' })], llmStats: null
    });
    assert.strictEqual(m.isQuiet, true);
  });

  test('weather (llm stats) alone does NOT make a window loud', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW, sessions: [], agentStatusItems: [],
      llmStats: { totalCalls: 5, totalCost: 0.02, totalTokens: 1234, byFeature: [] }
    });
    assert.strictEqual(m.isQuiet, true, 'numbers are a sidebar, not news');
    assert.ok(m.weather, 'weather is still attached for the by-the-numbers strip');
  });
});

describe('buildEditionModel — window filtering', () => {
  test('sources outside the window are excluded', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      sessions: [sessionAt('in', 2), sessionAt('out', 20)],
      agentStatusItems: [], llmStats: null
    });
    const ids = m.sources.map(s => s.id);
    assert.deepStrictEqual(ids, ['session:in']);
  });

  test('a month window includes what a week window excludes', () => {
    const input = { now: NOW, sessions: [sessionAt('s', 20)], agentStatusItems: [], llmStats: null };
    assert.strictEqual(buildEditionModel({ ...input, window: 'week' }).sources.length, 0);
    assert.strictEqual(buildEditionModel({ ...input, window: 'month' }).sources.length, 1);
  });
});

describe('buildEditionModel — determinism & addressability (§B)', () => {
  const input = {
    window: 'month', now: NOW,
    workspaceName: 'Acme',
    sessions: [sessionAt('sess-b', 3), sessionAt('sess-a', 3)], // equal timestamp → id tiebreak
    agentStatusItems: [statusAt('st-1', 1), statusAt('st-2', 5)],
    llmStats: { totalCalls: 3, totalCost: 0.01, totalTokens: 900, byFeature: [{ feature: 'recommend', calls: 3, cost: 0.01 }] }
  };

  test('identical inputs produce a deeply-equal model (deterministic)', () => {
    assert.deepStrictEqual(buildEditionModel(input), buildEditionModel(input));
  });

  test('every source id is unique and stable', () => {
    const m = buildEditionModel(input);
    const ids = m.sources.map(s => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids');
    // Stable, addressable id scheme.
    assert.ok(ids.includes('session:sess-a'));
    assert.ok(ids.includes('status:st-1'));
  });

  test('equal-timestamp slices are ordered by id (stable tiebreak)', () => {
    const m = buildEditionModel(input);
    const sessionIds = m.sources.filter(s => s.kind === 'session').map(s => s.id);
    assert.deepStrictEqual(sessionIds, ['session:sess-a', 'session:sess-b']);
  });

  test('each source snapshots content by value, not a bare id (grounding survives TTL)', () => {
    const m = buildEditionModel(input);
    for (const s of m.sources) {
      assert.ok(s.snapshot && typeof s.snapshot === 'object', `${s.id} carries a snapshot`);
    }
    const session = m.sources.find(s => s.kind === 'session');
    assert.ok(Array.isArray(session.snapshot.beats) && session.snapshot.beats.length > 0);
    assert.match(session.snapshot.beats[0].summary, /Did the work/);
    const status = m.sources.find(s => s.kind === 'status');
    assert.match(status.snapshot.summary, /root cause/);
  });

  test('newest slices sort ahead of older ones', () => {
    const m = buildEditionModel(input);
    const ts = m.sources.map(s => new Date(s.timestamp).getTime());
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i - 1] >= ts[i], 'descending by timestamp');
  });
});

describe('formatEditionContext', () => {
  test('lists every source by its exact id so the editor can reference it', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      sessions: [sessionAt('sess-1', 1)],
      agentStatusItems: [statusAt('st-9', 1)],
      llmStats: null
    });
    const ctx = formatEditionContext(m);
    assert.match(ctx, /id: session:sess-1/);
    assert.match(ctx, /id: status:st-9/);
  });
});
