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
  landedInWindow,
  MAX_LANDED,
  MAX_BACKGROUND,
  resolveWindow,
  windowRange,
  formatEditionContext,
  WINDOWS,
  DEFAULT_WINDOW,
  MAX_WINDOW
} from '../../lib/ship-biscuit.js';
import { callsSurfaceOf } from '../../lib/cost-read-calls.js';

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

// A saved roadmap report in the shape reportHistoryStore.getLatest() returns (LIN-1212):
// { id, generatedAt (ISO), northStar, narrative{digest,technical,product,…}, orientation[] }.
function roadmapReportAt(id, offsetDays, extra = {}) {
  return {
    id,
    generatedAt: new Date(NOW - offsetDays * 86400000).toISOString(),
    northStar: extra.northStar ?? 'Ship the thing',
    narrative: extra.narrative ?? { digest: 'Steady progress on the core path.', technical: 'Tech note.', product: 'Product note.' },
    orientation: extra.orientation ?? [
      { identifier: 'LIN-9', bearing: 'toward', reason: 'on the critical path', archived: false },
      { identifier: 'LIN-8', bearing: 'away', reason: 'archived side quest', archived: true },
    ],
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
      llmStats: callsSurfaceOf([1, 2, 3, 4, 5].map(() => ({ feature: 'recap', model: 'm', cost: 0.004, totalTokens: 10, timestamp: NOW })))
    });
    assert.strictEqual(m.isQuiet, true, 'numbers are a sidebar, not news');
    assert.ok(m.weather, 'weather is still attached for the by-the-numbers strip');
    assert.strictEqual(m.weather.totalCalls, 5);
  });

  test('the by-the-numbers line names the unpriced calls, and never reads them as $0 (LIN-4179)', () => {
    const llmStats = callsSurfaceOf([
      { feature: 'scan', model: 'm', cost: 0.03, totalTokens: 100, timestamp: NOW },
      { feature: 'review', model: 'm', cost: null, totalTokens: 50, timestamp: NOW },
    ]);
    // A quiet window's grounding text stops before the numbers (existing behaviour), so the window carries one session.
    const m = buildEditionModel({ window: 'week', now: NOW, sessions: [sessionAt('in', 2)], agentStatusItems: [], llmStats });
    const text = formatEditionContext(m);
    assert.match(text, /By the numbers: 2 AI call\(s\), \$0\.0300, 1 not priced, 150 token\(s\)\./);
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

// ── LIN-1212: roadmap report-history feedstock ───────────────────────────────

describe('buildEditionModel — roadmap report-history source (LIN-1212)', () => {
  test('an in-window report produces a kind:roadmap SourceRef with the full slice shape + stable id', () => {
    const m = buildEditionModel({ window: 'week', now: NOW, roadmapReport: roadmapReportAt('rep-1', 1) });
    const s = m.sources.find(x => x.kind === 'roadmap');
    assert.ok(s, 'a roadmap source exists');
    assert.strictEqual(s.id, 'roadmap:rep-1');            // addressable by roadmap:<id>
    assert.strictEqual(s.kind, 'roadmap');
    assert.strictEqual(s.desk, 'Deep Dive');
    assert.strictEqual(s.weight, 2);                       // analysis feedstock, not a lead
    assert.strictEqual(s.headline, 'The roadmap, measured against "Ship the thing"');
    assert.strictEqual(new Date(s.timestamp).getTime(), NOW - 1 * 86400000); // generatedAt
    assert.deepStrictEqual(s.snapshot, {
      reportId: 'rep-1',
      generatedAt: new Date(NOW - 1 * 86400000).toISOString(),
      northStar: 'Ship the thing',
      digest: 'Steady progress on the core path.',
      technical: 'Tech note.',
      product: 'Product note.',
      // Archived bearings are dropped; only the live bearing rides along, by value.
      orientation: [{ identifier: 'LIN-9', bearing: 'toward', reason: 'on the critical path' }],
    });
  });

  test('a report with no north star falls back to a plain "re-read" headline', () => {
    const m = buildEditionModel({ window: 'week', now: NOW, roadmapReport: roadmapReportAt('rep-ns', 1, { northStar: '' }) });
    const s = m.sources.find(x => x.kind === 'roadmap');
    assert.strictEqual(s.headline, 'The roadmap, re-read');
    assert.strictEqual(s.snapshot.northStar, '');
  });

  test('the roadmap source is counted and makes an otherwise-quiet window loud', () => {
    const m = buildEditionModel({ window: 'week', now: NOW, sessions: [], agentStatusItems: [], roadmapReport: roadmapReportAt('rep-fresh', 1) });
    assert.strictEqual(m.counts.roadmap, 1);
    assert.strictEqual(m.isQuiet, false);
    assert.ok(m.counts.total >= 1);
  });

  test('quiet-window honesty: a STALE (out-of-window) report never flips isQuiet loud', () => {
    const m = buildEditionModel({ window: 'week', now: NOW, sessions: [], agentStatusItems: [], roadmapReport: roadmapReportAt('rep-old', 20) });
    assert.strictEqual(m.isQuiet, true, 'a report generated before the window must not force a loud edition');
    assert.strictEqual(m.counts.roadmap, 0);
    assert.ok(!m.sources.some(s => s.kind === 'roadmap'));
  });

  test('a month window includes a report a week window excludes (window semantics, no raised ceiling)', () => {
    const input = { now: NOW, roadmapReport: roadmapReportAt('rep-mid', 20) };
    assert.strictEqual(buildEditionModel({ ...input, window: 'week' }).counts.roadmap, 0);
    assert.strictEqual(buildEditionModel({ ...input, window: 'month' }).counts.roadmap, 1);
  });

  test('absent (null/omitted) report leaves the existing edition byte-identical (regression floor)', () => {
    const base = {
      window: 'week', now: NOW, workspaceName: 'WS',
      sessions: [sessionAt('s1', 1)],
      agentStatusItems: [statusAt('st1', 1)],
      llmStats: { totalCalls: 2, totalCost: 0.01, totalTokens: 100, byFeature: [] },
    };
    assert.deepStrictEqual(buildEditionModel({ ...base, roadmapReport: null }), buildEditionModel(base));
    const m = buildEditionModel(base);
    assert.strictEqual(m.counts.roadmap, 0);
    assert.ok(!m.sources.some(s => s.kind === 'roadmap'));
  });

  test('identical roadmap inputs produce a deeply-equal model (deterministic)', () => {
    const input = { window: 'week', now: NOW, roadmapReport: roadmapReportAt('rep-det', 1) };
    assert.deepStrictEqual(buildEditionModel(input), buildEditionModel(input));
  });
});

describe('formatEditionContext — roadmap branch (LIN-1212)', () => {
  test('emits the roadmap by id with north star, digest and live bearings; archived bearings never leak', () => {
    const m = buildEditionModel({ window: 'week', now: NOW, roadmapReport: roadmapReportAt('rep-1', 1) });
    const ctx = formatEditionContext(m);
    assert.match(ctx, /id: roadmap:rep-1/);
    assert.match(ctx, /north star: Ship the thing/);
    assert.match(ctx, /roadmap digest: Steady progress on the core path\./);
    assert.match(ctx, /LIN-9 — toward: on the critical path/);
    assert.match(ctx, /1 roadmap report\(s\)/);            // activity summary line
    assert.doesNotMatch(ctx, /LIN-8/);                     // archived bearing filtered upstream
  });
});

// ── LIN-3456 (LIN-3453 C): characterization of the NaN-contract `toMs` ───────
// Written BEFORE the swap to lib/utils/time.js#toEpochMs and green on the old
// code. Junk is `undefined` (field absent) or 'not-a-date', NEVER `null`: `null`
// is a distinct case in some of the sibling modules (LIN-3453 plan, test rule).

describe('buildEditionModel — junk timestamps (LIN-3456 characterization)', () => {
  test('a source with an unparseable timestamp sorts as epoch 0: after every dated source', () => {
    const m = buildEditionModel({
      window: 'month', now: NOW,
      sessions: [
        // dispatchedAt is in the window (so it is admitted); completedAt wins the
        // source timestamp and is junk.
        sessionAt('s-junk', 1, { completedAt: 'not-a-date' }),
        sessionAt('s-old', 20),
        sessionAt('s-new', 2),
      ],
    });
    const order = m.sources.map(x => x.id);
    assert.deepStrictEqual(order, ['session:s-new', 'session:s-old', 'session:s-junk']);
  });
});

// ── LIN-4500: landed work leads the edition ──────────────────────────────────

// A merge record in the shape closeOutEventsStore.listMergedSince returns: { prUrl, issueIdentifier, mergedAt }.
function mergeAt(issueIdentifier, offsetDays, prUrl = `https://github.com/acme/app/pull/${issueIdentifier}`) {
  return { prUrl, issueIdentifier, mergedAt: new Date(NOW - offsetDays * 86400000).toISOString() };
}

// A tracker issue in the shape fetchWorkspaceIssues returns (only the fields this module reads).
function issueAt(identifier, { title = `Title of ${identifier}`, stateType = 'started', completedOffsetDays = null } = {}) {
  return {
    identifier,
    title,
    state: { name: stateType === 'completed' ? 'Done' : 'In Progress', type: stateType },
    completedAt: completedOffsetDays == null ? null : new Date(NOW - completedOffsetDays * 86400000).toISOString(),
  };
}

const WEEK = { window: 'week', now: NOW };

describe('landedInWindow (LIN-4500)', () => {
  const since = new Date(NOW - 7 * 86400000);
  const now = new Date(NOW);
  const land = (input) => landedInWindow({ since, now, ...input });

  test('a merge-only identifier is one item, labelled by its identifier with no title', () => {
    const out = land({ merges: [mergeAt('LIN-30', 1)], issues: [] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].identifier, 'LIN-30');
    assert.strictEqual(out[0].title, null);
    assert.strictEqual(out[0].merged, true);
    assert.strictEqual(out[0].finished, false);
    assert.strictEqual(out[0].completedAt, null);
  });

  test('a completion-only identifier is one item, titled by the tracker, with no PRs', () => {
    const out = land({ merges: [], issues: [issueAt('LIN-31', { title: 'Seal the hatch', stateType: 'completed', completedOffsetDays: 2 })] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].title, 'Seal the hatch');
    assert.strictEqual(out[0].finished, true);
    assert.strictEqual(out[0].merged, false);
    assert.deepStrictEqual(out[0].prs, []);
  });

  test('a merge and a completion on the same issue join into one item carrying both facts', () => {
    const out = land({ merges: [mergeAt('LIN-32', 3)], issues: [issueAt('LIN-32', { title: 'Both sides', stateType: 'completed', completedOffsetDays: 1 })] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].merged, true);
    assert.strictEqual(out[0].finished, true);
    assert.strictEqual(out[0].title, 'Both sides');
    assert.strictEqual(out[0].prs.length, 1);
    assert.strictEqual(out[0].completedAt, new Date(NOW - 86400000).toISOString());
  });

  test('several PRs on one issue are all kept, newest first, deduplicated by prUrl, with item time the latest merge', () => {
    const out = land({
      merges: [
        mergeAt('LIN-33', 4, 'https://github.com/acme/app/pull/101'),
        mergeAt('LIN-33', 2, 'https://github.com/acme/app/pull/102'),
        mergeAt('LIN-33', 2, 'https://github.com/acme/app/pull/102'), // the same PR recorded twice
      ],
      issues: [],
    });
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0].prs.map(p => p.url), [
      'https://github.com/acme/app/pull/102',
      'https://github.com/acme/app/pull/101',
    ]);
    assert.strictEqual(out[0].time, NOW - 2 * 86400000, 'item time is the latest in-window merge');
  });

  test('a canceled, duplicate or merely started state is never a completion', () => {
    for (const stateType of ['canceled', 'duplicate', 'started']) {
      const out = land({ merges: [], issues: [issueAt('LIN-34', { stateType, completedOffsetDays: 1 })] });
      assert.deepStrictEqual(out, [], `state ${stateType} is not finished work`);
    }
  });

  test('the window is inclusive at both ends and excludes just outside', () => {
    const edge = land({ merges: [mergeAt('LIN-35', 7), mergeAt('LIN-36', 0), mergeAt('LIN-37', 7.001)], issues: [] });
    assert.deepStrictEqual(edge.map(e => e.identifier).sort(), ['LIN-35', 'LIN-36']);
  });

  test('a completion just outside the window is excluded; junk timestamps are excluded, never coerced', () => {
    const out = land({
      merges: [{ prUrl: 'u-junk', issueIdentifier: 'LIN-38', mergedAt: 'not-a-date' }, { prUrl: 'u-missing', issueIdentifier: 'LIN-39' }],
      issues: [
        issueAt('LIN-40', { stateType: 'completed', completedOffsetDays: 8 }),
        { identifier: 'LIN-41', title: 'Junk done', state: { type: 'completed' }, completedAt: 'nope' },
      ],
    });
    assert.deepStrictEqual(out, []);
  });

  test('a completion whose merge predates the window shows as finished, with no old PR attached', () => {
    const out = land({ merges: [mergeAt('LIN-42', 20)], issues: [issueAt('LIN-42', { stateType: 'completed', completedOffsetDays: 1 })] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].finished, true);
    assert.strictEqual(out[0].merged, false);
    assert.deepStrictEqual(out[0].prs, []);
  });

  test('a merge whose issue is absent from the tracker keeps its identifier as label and is never dropped', () => {
    const out = land({ merges: [mergeAt('LIN-43', 1)], issues: [issueAt('LIN-other', { stateType: 'started' })] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].identifier, 'LIN-43');
    assert.strictEqual(out[0].title, null);
  });

  test('items are newest first, identifier as tie-break, and deterministic', () => {
    const input = { merges: [mergeAt('LIN-b', 3), mergeAt('LIN-a', 3), mergeAt('LIN-c', 1)], issues: [] };
    assert.deepStrictEqual(land(input).map(i => i.identifier), ['LIN-c', 'LIN-a', 'LIN-b']);
    assert.deepStrictEqual(land(input), land(input));
  });

  test('an unusable window yields nothing rather than throwing', () => {
    assert.deepStrictEqual(landedInWindow({ merges: [mergeAt('LIN-44', 1)], issues: [], since: 'junk', now }), []);
  });
});

describe('buildEditionModel — landed work leads (LIN-4500)', () => {
  test('a landed item becomes a kind:landed Front Page slice with the full snapshot and id landed:<IDENTIFIER>', () => {
    const m = buildEditionModel({
      ...WEEK,
      merges: [mergeAt('LIN-50', 1, 'https://github.com/acme/app/pull/50')],
      issues: [issueAt('LIN-50', { title: 'Fix the boiler', stateType: 'completed', completedOffsetDays: 1 })],
    });
    const s = m.sources[0];
    assert.strictEqual(s.id, 'landed:LIN-50');
    assert.strictEqual(s.kind, 'landed');
    assert.strictEqual(s.desk, 'Front Page');
    assert.strictEqual(s.weight, 5);
    assert.strictEqual(s.headline, 'Fix the boiler — finished, and its PR merged');
    assert.strictEqual(s.timestamp, new Date(NOW - 86400000).toISOString());
    assert.deepStrictEqual(s.snapshot, {
      identifier: 'LIN-50',
      title: 'Fix the boiler',
      prs: [{ url: 'https://github.com/acme/app/pull/50', mergedAt: new Date(NOW - 86400000).toISOString() }],
      merged: true,
      finished: true,
      completedAt: new Date(NOW - 86400000).toISOString(),
    });
  });

  test('the headline reads correctly for a merge-only and a finished-only item', () => {
    const m = buildEditionModel({
      ...WEEK,
      merges: [mergeAt('LIN-51', 1)],
      issues: [issueAt('LIN-52', { title: 'Seal', stateType: 'completed', completedOffsetDays: 2 })],
    });
    const headlines = Object.fromEntries(m.sources.map(s => [s.id, s.headline]));
    assert.strictEqual(headlines['landed:LIN-51'], 'LIN-51 — its PR merged');
    assert.strictEqual(headlines['landed:LIN-52'], 'Seal — finished');
  });

  test('landed slices come before every run slice, even when the runs are newer', () => {
    const m = buildEditionModel({
      ...WEEK,
      merges: [mergeAt('LIN-60', 6)],
      sessions: [sessionAt('new', 0.5)],
      agentStatusItems: [statusAt('st-new', 0.1)],
    });
    assert.strictEqual(m.sources[0].id, 'landed:LIN-60');
    assert.deepStrictEqual(m.sources.slice(1).map(s => s.kind), ['status', 'session']);
    assert.strictEqual(m.counts.landed, 1);
  });

  test('source priority under heavy background load: every landed item survives, ahead of every run', () => {
    const busyStatus = Array.from({ length: 80 }, (_, i) => statusAt(`busy-${i}`, 0.01 * (i + 1)));
    const landedMerges = Array.from({ length: 3 }, (_, i) => mergeAt(`LIN-7${i}`, 6 - i));
    const m = buildEditionModel({ ...WEEK, merges: landedMerges, agentStatusItems: busyStatus });
    assert.deepStrictEqual(m.sources.filter(s => s.kind === 'landed').map(s => s.id), ['landed:LIN-72', 'landed:LIN-71', 'landed:LIN-70']);
    assert.deepStrictEqual(m.sources.slice(0, 3).map(s => s.kind), ['landed', 'landed', 'landed'], 'landed work leads the list');
    assert.strictEqual(m.counts.status, MAX_BACKGROUND, 'background is capped at its own budget');
    assert.strictEqual(m.sources.length, 3 + MAX_BACKGROUND);
    assert.strictEqual(m.landedOmitted, 0);
  });

  test('when landed work exceeds its cap, the model says how many were left out', () => {
    const merges = Array.from({ length: MAX_LANDED + 4 }, (_, i) => mergeAt(`LIN-8${String(i).padStart(2, '0')}`, 1 + i * 0.01));
    const m = buildEditionModel({ ...WEEK, merges });
    assert.strictEqual(m.counts.landed, MAX_LANDED);
    assert.strictEqual(m.landedOmitted, 4);
    assert.strictEqual(m.sources.filter(s => s.kind === 'landed').length, MAX_LANDED);
  });

  test('an unread tracker is never quiet: no sources but unread means isQuiet is false', () => {
    const m = buildEditionModel({ ...WEEK, sourcesUnread: ['tracker'] });
    assert.strictEqual(m.sources.length, 0);
    assert.strictEqual(m.isQuiet, false);
    assert.deepStrictEqual(m.sourcesUnread, ['tracker']);
  });

  test('a truly empty, fully-read window stays the honest quiet edition', () => {
    const m = buildEditionModel({ ...WEEK, merges: [], issues: [], sourcesUnread: [] });
    assert.strictEqual(m.isQuiet, true);
    assert.deepStrictEqual(m.sourcesUnread, []);
  });

  test('an unread tracker beside a run is not quiet and carries the unread flag', () => {
    const m = buildEditionModel({ ...WEEK, sourcesUnread: ['tracker'], agentStatusItems: [statusAt('st-u', 1)] });
    assert.strictEqual(m.isQuiet, false);
    assert.strictEqual(m.counts.status, 1);
    assert.deepStrictEqual(m.sourcesUnread, ['tracker']);
  });

  test('the retired task-snapshot input is ignored: a task snapshot no longer makes a window loud', () => {
    const m = buildEditionModel({
      ...WEEK,
      taskSnapshotItems: [{ taskIdentifier: 'LIN-9', capturedAt: new Date(NOW - 86400000).toISOString(), snapshot: { title: 'x', state: { name: 'Done', type: 'completed' } } }],
    });
    assert.strictEqual(m.isQuiet, true);
    assert.strictEqual(m.counts.total, 0);
  });

  test('a month window includes a landed item a week window excludes', () => {
    const input = { now: NOW, merges: [mergeAt('LIN-95', 20)] };
    assert.strictEqual(buildEditionModel({ ...input, window: 'week' }).counts.landed, 0);
    assert.strictEqual(buildEditionModel({ ...input, window: 'month' }).counts.landed, 1);
  });

  test('omitted vs empty landed inputs leave the edition byte-identical (regression pin)', () => {
    const base = {
      ...WEEK, workspaceName: 'WS',
      sessions: [sessionAt('s1', 1)],
      agentStatusItems: [statusAt('st1', 1)],
      llmStats: { totalCalls: 2, totalCost: 0.01, totalTokens: 100, byFeature: [] },
    };
    assert.deepStrictEqual(buildEditionModel({ ...base, merges: [], issues: [], sourcesUnread: [] }), buildEditionModel(base));
  });

  test('counts pins landed/sessions/status/roadmap/total, with landed in total', () => {
    const m = buildEditionModel({
      ...WEEK,
      merges: [mergeAt('LIN-90', 1)],
      issues: [issueAt('LIN-90', { stateType: 'completed', completedOffsetDays: 1 })],
      sessions: [sessionAt('s1', 1)],
      agentStatusItems: [statusAt('st1', 1)],
    });
    assert.deepStrictEqual(m.counts, { landed: 1, sessions: 1, status: 1, roadmap: 0, total: 3 });
  });

  test('a merge with a junk timestamp or a completion with a junk date never makes a landed item', () => {
    const m = buildEditionModel({
      ...WEEK,
      merges: [{ prUrl: 'u1', issueIdentifier: 'LIN-120', mergedAt: undefined }, { prUrl: 'u2', issueIdentifier: 'LIN-121', mergedAt: 'not-a-date' }],
      issues: [{ identifier: 'LIN-122', title: 't', state: { type: 'completed' }, completedAt: 'not-a-date' }],
    });
    assert.strictEqual(m.counts.landed, 0);
    assert.strictEqual(m.isQuiet, true);
  });
});

describe('formatEditionContext — landed work (LIN-4500)', () => {
  test('lists landed work first under its own heading, with PR and finished details, before the background', () => {
    const m = buildEditionModel({
      ...WEEK,
      merges: [mergeAt('LIN-100', 1, 'https://github.com/acme/app/pull/100')],
      issues: [issueAt('LIN-100', { title: 'Ship the hatch', stateType: 'completed', completedOffsetDays: 1 })],
      agentStatusItems: [statusAt('st-bg', 0.5)],
    });
    const ctx = formatEditionContext(m);
    assert.match(ctx, /Activity: 1 landed item\(s\)/);
    assert.ok(ctx.indexOf('LANDED IN THIS WINDOW') < ctx.indexOf('BACKGROUND'), 'the landed heading comes first');
    assert.ok(ctx.indexOf('id: landed:LIN-100') < ctx.indexOf('id: status:st-bg'), 'the landed slice is listed before the run');
    assert.match(ctx, /title: Ship the hatch/);
    assert.match(ctx, /finished in the tracker: /);
    assert.match(ctx, /PR merged: https:\/\/github\.com\/acme\/app\/pull\/100/);
  });

  test('an unread tracker puts a warning before the slices and never says quiet', () => {
    const m = buildEditionModel({ ...WEEK, sourcesUnread: ['tracker'], agentStatusItems: [statusAt('st-x', 1)] });
    const ctx = formatEditionContext(m);
    assert.match(ctx, /WARNING: the issue tracker could not be read/);
    assert.ok(ctx.indexOf('WARNING') < ctx.indexOf('id: status:st-x'), 'the warning comes before the slices');
    assert.doesNotMatch(ctx, /NO activity/);
  });

  test('landed work past its cap is disclosed as omitted', () => {
    const merges = Array.from({ length: MAX_LANDED + 2 }, (_, i) => mergeAt(`LIN-11${String(i).padStart(2, '0')}`, 1 + i * 0.01));
    const ctx = formatEditionContext(buildEditionModel({ ...WEEK, merges }));
    assert.match(ctx, /2 more landed item\(s\) in this window are not listed/);
  });
});
