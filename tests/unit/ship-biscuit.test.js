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

// A raw task-snapshot record in the shape listByWorkspace(...).items yields (see
// TaskSnapshotStore.toRecord): { taskIdentifier, capturedAt (ISO), snapshot{...} }.
// Larger offsetDays = further in the past, so an (earliest → latest) transition is
// modelled as a bigger-offset "before" and a smaller-offset "after".
function taskSnap(taskIdentifier, offsetDays, snap = {}) {
  return {
    taskIdentifier,
    capturedAt: new Date(NOW - offsetDays * 86400000).toISOString(),
    snapshot: {
      title: snap.title || 'A task',
      state: snap.state || { name: 'In Progress', type: 'started' },
      priority: snap.priority ?? 2
    }
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

// ── LIN-1197: task-snapshot feedstock ────────────────────────────────────────

describe('buildEditionModel — task sources (LIN-1197)', () => {
  test('a state change produces a kind:task SourceRef with the full slice shape', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-10', 3, { title: 'Fix the boiler', state: { name: 'In Progress', type: 'started' }, priority: 2 }),
        taskSnap('LIN-10', 1, { title: 'Fix the boiler', state: { name: 'In Review', type: 'started' }, priority: 2 }),
      ],
    });
    const s = m.sources.find(x => x.kind === 'task');
    assert.ok(s, 'a task source exists');
    assert.strictEqual(s.id, 'task:LIN-10');
    assert.strictEqual(s.kind, 'task');
    assert.strictEqual(s.desk, 'The Wire');            // non-completion transition
    assert.strictEqual(s.weight, 3);                    // real move is lead-worthy
    assert.strictEqual(s.headline, 'Fix the boiler — In Progress → In Review');
    assert.strictEqual(new Date(s.timestamp).getTime(), NOW - 1 * 86400000); // latest capturedAt
    assert.deepStrictEqual(s.snapshot, {
      taskIdentifier: 'LIN-10',
      title: 'Fix the boiler',
      from: 'In Progress',
      to: 'In Review',
      transitioned: true,
      completed: false,
      priorityBefore: 2,
      priorityAfter: 2,
      priorityChanged: false,
      snapshots: 2,
      capturedFrom: new Date(NOW - 3 * 86400000).toISOString(),
      capturedTo: new Date(NOW - 1 * 86400000).toISOString(),
    });
  });

  test('a completion (state.type completed) floats to the Front Page', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-11', 3, { state: { name: 'In Progress', type: 'started' } }),
        taskSnap('LIN-11', 1, { state: { name: 'Done', type: 'completed' } }),
      ],
    });
    const s = m.sources.find(x => x.id === 'task:LIN-11');
    assert.strictEqual(s.snapshot.completed, true);
    assert.strictEqual(s.desk, 'Front Page');
    assert.strictEqual(s.weight, 3);
    assert.strictEqual(s.headline, 'A task — In Progress → Done');
  });

  test('a priority-only move (no state change) headlines "priority changed"', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-12', 3, { title: 'Paint the hull', state: { name: 'In Progress', type: 'started' }, priority: 3 }),
        taskSnap('LIN-12', 1, { title: 'Paint the hull', state: { name: 'In Progress', type: 'started' }, priority: 1 }),
      ],
    });
    const s = m.sources.find(x => x.id === 'task:LIN-12');
    assert.strictEqual(s.snapshot.transitioned, false);
    assert.strictEqual(s.snapshot.priorityChanged, true);
    assert.strictEqual(s.snapshot.priorityBefore, 3);
    assert.strictEqual(s.snapshot.priorityAfter, 1);
    assert.strictEqual(s.headline, 'Paint the hull — priority changed');
    assert.strictEqual(s.weight, 2);
  });

  test('a degenerate no-change snapshot headlines "still <state>", never a null X → X', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [
        // Single in-window snapshot, and a same-state pair — both are degenerate.
        taskSnap('LIN-13', 1, { title: 'Stow the sails', state: { name: 'In Progress', type: 'started' } }),
        taskSnap('LIN-14', 3, { title: 'Swab the deck', state: { name: 'Todo', type: 'unstarted' } }),
        taskSnap('LIN-14', 1, { title: 'Swab the deck', state: { name: 'Todo', type: 'unstarted' } }),
      ],
    });
    const single = m.sources.find(x => x.id === 'task:LIN-13');
    assert.strictEqual(single.snapshot.transitioned, false);
    assert.strictEqual(single.headline, 'Stow the sails — still In Progress');
    assert.strictEqual(single.weight, 2);
    // No degenerate task may ever render a transition arrow (a null X → X).
    for (const s of m.sources.filter(x => x.kind === 'task')) {
      assert.strictEqual(s.snapshot.transitioned, false);
      assert.doesNotMatch(s.headline, / → /);
    }
  });

  test('task snapshots outside the window are excluded (by capturedAt)', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-in', 2, { state: { name: 'Done', type: 'completed' } }),
        taskSnap('LIN-out', 20, { state: { name: 'Done', type: 'completed' } }),
      ],
    });
    assert.deepStrictEqual(m.sources.map(s => s.id), ['task:LIN-in']);
  });

  test('only in-window snapshots form a group — a pre-window snapshot is not the "before"', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-16', 20, { state: { name: 'Backlog', type: 'backlog' } }),   // pre-window
        taskSnap('LIN-16', 1, { state: { name: 'In Progress', type: 'started' } }), // in-window
      ],
    });
    const s = m.sources.find(x => x.id === 'task:LIN-16');
    assert.strictEqual(s.snapshot.snapshots, 1);
    assert.strictEqual(s.snapshot.transitioned, false);
    assert.strictEqual(s.headline, 'A task — still In Progress');
  });

  test('a month window includes a task a week window excludes (no raised ceiling)', () => {
    const input = { now: NOW, taskSnapshotItems: [taskSnap('LIN-17', 20, { state: { name: 'Done', type: 'completed' } })] };
    assert.strictEqual(buildEditionModel({ ...input, window: 'week' }).counts.tasks, 0);
    assert.strictEqual(buildEditionModel({ ...input, window: 'month' }).counts.tasks, 1);
  });

  test('identical task inputs produce deeply-equal sources; ordering is newest capturedAt first', () => {
    const input = {
      window: 'month', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-old', 10, { state: { name: 'Done', type: 'completed' } }),
        taskSnap('LIN-new', 1, { state: { name: 'Done', type: 'completed' } }),
      ],
    };
    assert.deepStrictEqual(buildEditionModel(input).sources, buildEditionModel(input).sources);
    const ids = buildEditionModel(input).sources.filter(s => s.kind === 'task').map(s => s.id);
    assert.deepStrictEqual(ids, ['task:LIN-new', 'task:LIN-old']);
  });

  test('equal-timestamp task slices tie-break by their stable id', () => {
    const m = buildEditionModel({
      window: 'month', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-b', 3, { state: { name: 'Done', type: 'completed' } }),
        taskSnap('LIN-a', 3, { state: { name: 'Done', type: 'completed' } }),
      ],
    });
    const ids = m.sources.filter(s => s.kind === 'task').map(s => s.id);
    assert.deepStrictEqual(ids, ['task:LIN-a', 'task:LIN-b']);
  });
});

describe('buildEditionModel — task additivity & counts (LIN-1197)', () => {
  test('omitted vs empty taskSnapshotItems leaves the edition byte-identical (regression pin)', () => {
    const base = {
      window: 'week', now: NOW, workspaceName: 'WS',
      sessions: [sessionAt('s1', 1)],
      agentStatusItems: [statusAt('st1', 1)],
      llmStats: { totalCalls: 2, totalCost: 0.01, totalTokens: 100, byFeature: [] },
    };
    assert.deepStrictEqual(buildEditionModel({ ...base, taskSnapshotItems: [] }), buildEditionModel(base));
  });

  test('empty task input keeps a quiet window quiet', () => {
    const m = buildEditionModel({ window: 'week', now: NOW, sessions: [], agentStatusItems: [], taskSnapshotItems: [], llmStats: null });
    assert.strictEqual(m.isQuiet, true);
    assert.strictEqual(m.sources.length, 0);
  });

  test('counts pins sessions/status/tasks/total, with tasks folded into total', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      sessions: [sessionAt('s1', 1)],
      agentStatusItems: [statusAt('st1', 1)],
      taskSnapshotItems: [
        taskSnap('LIN-10', 3, { state: { name: 'In Progress', type: 'started' } }),
        taskSnap('LIN-10', 1, { state: { name: 'Done', type: 'completed' } }),
      ],
    });
    assert.deepStrictEqual(m.counts, { sessions: 1, status: 1, tasks: 1, roadmap: 0, total: 3 });
  });
});

describe('formatEditionContext — task branch (LIN-1197)', () => {
  test('emits the task by id with a state-change/completion line and a priority line', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [
        taskSnap('LIN-10', 3, { title: 'Fix the boiler', state: { name: 'In Progress', type: 'started' }, priority: 2 }),
        taskSnap('LIN-10', 1, { title: 'Fix the boiler', state: { name: 'Done', type: 'completed' }, priority: 1 }),
      ],
    });
    const ctx = formatEditionContext(m);
    assert.match(ctx, /id: task:LIN-10/);
    assert.match(ctx, /Fix the boiler — In Progress → Done/);       // title-led headline seed
    assert.match(ctx, /state change: In Progress → Done \(completed\)/);
    assert.match(ctx, /priority change: 2 → 1/);
    assert.match(ctx, /1 task\(s\) that moved on the board/);        // activity summary
  });

  test('a degenerate task shows an unchanged-state line, not a transition', () => {
    const m = buildEditionModel({
      window: 'week', now: NOW,
      taskSnapshotItems: [taskSnap('LIN-13', 1, { title: 'Stow the sails', state: { name: 'In Progress', type: 'started' } })],
    });
    const ctx = formatEditionContext(m);
    assert.match(ctx, /state: In Progress \(unchanged in window\)/);
    assert.doesNotMatch(ctx, /state change:/);
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
