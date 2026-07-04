/**
 * Unit tests for lib/pipeline-loops.js
 *
 * Run with: node --test tests/unit/pipeline-loops.test.js
 *
 * Coverage:
 *   - Pure derivation helpers (_deriveAgentState, _deriveStage)
 *   - Join logic (_matchAgentStatusToLoop)
 *   - End-to-end _buildLoops fixture scenarios
 *   - Public API (getLoopsForIssue, getLoopsForWorkspace) with mock stores
 *   - Defensive checks (30d post-filter, malformed rows, listStatus call shape)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  getLoopsForIssue,
  getLoopsForWorkspace,
  getSessionsForWorkspace,
  __internal
} from '../../lib/pipeline-loops.js';

const { _toDate, _deriveAgentState, _deriveStage, _matchAgentStatusToLoop, _buildLoops, LOOKBACK_MS } = __internal;

// ─── Test fixture helpers ────────────────────────────────────────────────────

const ISSUE_A = 'LIN-100';
const ISSUE_B = 'LIN-200';
const NOW = new Date('2026-04-11T12:00:00.000Z');

function liveItem(overrides = {}) {
  return {
    id: 'live-1',
    promptName: 'plan',
    prompt: 'plan prompt text',
    issueId: 'uuid-100',
    issueIdentifier: ISSUE_A,
    issueTitle: 'Issue A',
    issueUrl: 'https://linear.app/x/issue/LIN-100',
    workspace: { urlKey: 'ws' },
    dispatchedAt: '2026-04-11T11:00:00.000Z',
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    expiresAt: '2026-04-12T11:00:00.000Z',
    ...overrides
  };
}

function historyItem(overrides = {}) {
  return {
    id: 'hist-1',
    promptName: 'implementation',
    prompt: 'implementation prompt text',
    issueId: 'uuid-100',
    issueIdentifier: ISSUE_A,
    issueTitle: 'Issue A',
    issueUrl: 'https://linear.app/x/issue/LIN-100',
    workspace: { urlKey: 'ws' },
    dispatchedAt: '2026-04-10T10:00:00.000Z',
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: '2026-04-10T11:00:00.000Z',
    takenByTokenLabel: 'consumer-1',
    feedback: [],
    ...overrides
  };
}

function agentStatusEntry(overrides = {}) {
  return {
    id: 'fmn-1',
    taskIdentifier: ISSUE_A,
    action: 'implementation',
    status: 'completed',
    summary: 'Done.',
    timestamp: '2026-04-10T10:30:00.000Z',
    ...overrides
  };
}

// ─── _toDate ─────────────────────────────────────────────────────────────────

describe('_toDate', () => {
  test('passes Date through unchanged', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    assert.strictEqual(_toDate(d), d);
  });

  test('parses ISO string', () => {
    const d = _toDate('2026-01-01T00:00:00Z');
    assert.ok(d instanceof Date);
    assert.strictEqual(d.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  test('returns null for null/undefined', () => {
    assert.strictEqual(_toDate(null), null);
    assert.strictEqual(_toDate(undefined), null);
  });

  test('returns null for invalid string', () => {
    assert.strictEqual(_toDate('not-a-date'), null);
  });

  test('returns null for invalid Date', () => {
    assert.strictEqual(_toDate(new Date('not-a-date')), null);
  });
});

// ─── _deriveAgentState ───────────────────────────────────────────────────────

describe('_deriveAgentState', () => {
  test('live source → queued (agentStatus irrelevant)', () => {
    assert.strictEqual(_deriveAgentState('live', null, null), 'queued');
    assert.strictEqual(_deriveAgentState('live', null, 'completed'), 'queued');
  });

  test('history + expired → error (agentStatus irrelevant)', () => {
    assert.strictEqual(_deriveAgentState('history', 'expired', null), 'error');
    assert.strictEqual(_deriveAgentState('history', 'expired', 'completed'), 'error');
  });

  test('history + cancelled → complete (operator decision is terminal-good)', () => {
    assert.strictEqual(_deriveAgentState('history', 'cancelled', null), 'complete');
    assert.strictEqual(_deriveAgentState('history', 'cancelled', 'failed'), 'complete');
  });

  test('history + taken + no agentStatus match → running', () => {
    assert.strictEqual(_deriveAgentState('history', 'taken', null), 'running');
  });

  test('history + taken + agentStatus completed → complete', () => {
    assert.strictEqual(_deriveAgentState('history', 'taken', 'completed'), 'complete');
  });

  test('history + taken + agentStatus failed → error', () => {
    assert.strictEqual(_deriveAgentState('history', 'taken', 'failed'), 'error');
  });

  test('history + taken + agentStatus blocked → waiting', () => {
    assert.strictEqual(_deriveAgentState('history', 'taken', 'blocked'), 'waiting');
  });

  test('history + taken + unknown free-form agentStatus status → running (fall-through)', () => {
    assert.strictEqual(_deriveAgentState('history', 'taken', 'in-progress'), 'running');
    assert.strictEqual(_deriveAgentState('history', 'taken', 'whatever'), 'running');
    assert.strictEqual(_deriveAgentState('history', 'taken', ''), 'running');
  });
});

// ─── _deriveStage ────────────────────────────────────────────────────────────

describe('_deriveStage', () => {
  test('agentAction wins when both present', () => {
    assert.strictEqual(_deriveStage('review', 'plan'), 'review');
  });

  test('promptName fallback when agentAction is null', () => {
    assert.strictEqual(_deriveStage(null, 'plan'), 'plan');
  });

  test('"unknown" fallback when both are null', () => {
    assert.strictEqual(_deriveStage(null, null), 'unknown');
  });

  test('empty-string agentAction falls through to promptName', () => {
    assert.strictEqual(_deriveStage('', 'plan'), 'plan');
  });
});

// ─── _matchAgentStatusToLoop ─────────────────────────────────────────────────────

describe('_matchAgentStatusToLoop', () => {
  function loop(overrides = {}) {
    return {
      loopId: 'hist-1',
      issueIdentifier: ISSUE_A,
      _dispatchedAtDate: new Date('2026-04-10T10:00:00.000Z'),
      _upperDate: new Date('2026-04-10T11:00:00.000Z'),
      ...overrides
    };
  }

  test('returns null when agentStatus list is empty', () => {
    assert.strictEqual(_matchAgentStatusToLoop(loop(), [], NOW), null);
  });

  test('returns null when agentStatus list is null', () => {
    assert.strictEqual(_matchAgentStatusToLoop(loop(), null, NOW), null);
  });

  test('single in-window entry is picked', () => {
    const f = agentStatusEntry({ timestamp: '2026-04-10T10:30:00.000Z' });
    assert.strictEqual(_matchAgentStatusToLoop(loop(), [f], NOW), f);
  });

  test('multiple in-window entries → latest by timestamp wins', () => {
    const earlier = agentStatusEntry({ id: 'f1', timestamp: '2026-04-10T10:10:00.000Z', status: 'blocked' });
    const later   = agentStatusEntry({ id: 'f2', timestamp: '2026-04-10T10:50:00.000Z', status: 'completed' });
    const result = _matchAgentStatusToLoop(loop(), [earlier, later], NOW);
    assert.strictEqual(result.id, 'f2');
  });

  test('entry before dispatchedAt is rejected', () => {
    const f = agentStatusEntry({ timestamp: '2026-04-10T09:59:59.000Z' });
    assert.strictEqual(_matchAgentStatusToLoop(loop(), [f], NOW), null);
  });

  test('entry after upper bound is rejected', () => {
    const f = agentStatusEntry({ timestamp: '2026-04-10T11:00:01.000Z' });
    assert.strictEqual(_matchAgentStatusToLoop(loop(), [f], NOW), null);
  });

  test('window bounds are inclusive on both ends', () => {
    const fLower = agentStatusEntry({ id: 'f-lower', timestamp: '2026-04-10T10:00:00.000Z' });
    const fUpper = agentStatusEntry({ id: 'f-upper', timestamp: '2026-04-10T11:00:00.000Z' });
    assert.strictEqual(_matchAgentStatusToLoop(loop(), [fLower], NOW).id, 'f-lower');
    assert.strictEqual(_matchAgentStatusToLoop(loop(), [fUpper], NOW).id, 'f-upper');
  });

  test('exact dispatchId match overrides window matching', () => {
    // The "matching" entry is OUTSIDE the timestamp window — would normally be
    // rejected. The exact-match branch must accept it anyway.
    const exact = agentStatusEntry({
      id: 'f-exact',
      dispatchId: 'hist-1',
      timestamp: '2026-04-10T13:00:00.000Z' // outside window
    });
    const result = _matchAgentStatusToLoop(loop(), [exact], NOW);
    assert.strictEqual(result.id, 'f-exact');
  });

  test('exact dispatchId match — multiple → latest by timestamp', () => {
    const earlier = agentStatusEntry({
      id: 'f-exact-1', dispatchId: 'hist-1', timestamp: '2026-04-10T10:10:00.000Z'
    });
    const later = agentStatusEntry({
      id: 'f-exact-2', dispatchId: 'hist-1', timestamp: '2026-04-10T10:55:00.000Z'
    });
    const result = _matchAgentStatusToLoop(loop(), [earlier, later], NOW);
    assert.strictEqual(result.id, 'f-exact-2');
  });

  test('agentStatus entry with mismatched dispatchId falls through to window match', () => {
    const wrongExact = agentStatusEntry({
      id: 'f-wrong', dispatchId: 'some-other-id', timestamp: '2026-04-10T10:30:00.000Z'
    });
    // No exact match for our loopId, but it IS in window → window-match path picks it.
    const result = _matchAgentStatusToLoop(loop(), [wrongExact], NOW);
    assert.strictEqual(result.id, 'f-wrong');
  });
});

// ─── _buildLoops fixture scenarios ───────────────────────────────────────────

describe('_buildLoops', () => {
  test('empty inputs → empty array', () => {
    assert.deepStrictEqual(_buildLoops({ now: NOW }), []);
  });

  test('single live loop, no history, no agentStatus', () => {
    const loops = _buildLoops({
      liveItems: [liveItem({ id: 'live-a', dispatchedAt: '2026-04-11T11:00:00.000Z' })],
      now: NOW
    });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].iteration, 1);
    assert.strictEqual(loops[0].agentState, 'queued');
    assert.strictEqual(loops[0].agentAction, null);
    assert.strictEqual(loops[0].stage, 'plan'); // promptName fallback
    assert.strictEqual(loops[0].source, 'live');
    assert.strictEqual(loops[0].resolvedAt, null);
  });

  test('two history loops for same issue → iterations 1, 2 in dispatch order', () => {
    const a = historyItem({ id: 'h-old', dispatchedAt: '2026-04-09T10:00:00.000Z', resolvedAt: '2026-04-09T10:30:00.000Z' });
    const b = historyItem({ id: 'h-new', dispatchedAt: '2026-04-10T10:00:00.000Z', resolvedAt: '2026-04-10T10:30:00.000Z' });
    const loops = _buildLoops({ historyItems: [b, a], now: NOW }); // shuffled input
    assert.strictEqual(loops.length, 2);
    assert.strictEqual(loops[0].loopId, 'h-old');
    assert.strictEqual(loops[0].iteration, 1);
    assert.strictEqual(loops[1].loopId, 'h-new');
    assert.strictEqual(loops[1].iteration, 2);
  });

  test('mixed live + history → live loop sorts last and gets highest iteration', () => {
    const hist = historyItem({ id: 'h-1', dispatchedAt: '2026-04-09T10:00:00.000Z', resolvedAt: '2026-04-09T10:30:00.000Z' });
    const live = liveItem({ id: 'l-1', dispatchedAt: '2026-04-11T11:00:00.000Z' });
    const loops = _buildLoops({ liveItems: [live], historyItems: [hist], now: NOW });
    assert.strictEqual(loops.length, 2);
    assert.strictEqual(loops[0].loopId, 'h-1');
    assert.strictEqual(loops[0].iteration, 1);
    assert.strictEqual(loops[1].loopId, 'l-1');
    assert.strictEqual(loops[1].iteration, 2);
    assert.strictEqual(loops[1].agentState, 'queued');
  });

  test('history loop + completed agentStatus → agentState=complete, stage=agentAction', () => {
    const hist = historyItem({ id: 'h-1', promptName: 'plan' });
    const fmn = agentStatusEntry({ action: 'review', status: 'completed' });
    const loops = _buildLoops({ historyItems: [hist], agentStatusEntries: [fmn], now: NOW });
    assert.strictEqual(loops[0].agentState, 'complete');
    assert.strictEqual(loops[0].stage, 'review');
    assert.strictEqual(loops[0].agentAction, 'review');
    assert.strictEqual(loops[0].agentStatus, 'completed');
    assert.strictEqual(loops[0].agentSummary, 'Done.');
  });

  test('history loop with status:expired → agentState=error regardless of agentStatus', () => {
    const hist = historyItem({ status: 'expired' });
    const fmn = agentStatusEntry({ status: 'completed' });
    const loops = _buildLoops({ historyItems: [hist], agentStatusEntries: [fmn], now: NOW });
    assert.strictEqual(loops[0].agentState, 'error');
  });

  test('history loop with status:cancelled → agentState=complete regardless of agentStatus', () => {
    const hist = historyItem({ status: 'cancelled' });
    const fmn = agentStatusEntry({ status: 'failed' });
    const loops = _buildLoops({ historyItems: [hist], agentStatusEntries: [fmn], now: NOW });
    assert.strictEqual(loops[0].agentState, 'complete');
  });

  test('two issues interleaved → iteration counts are per-issue, not global', () => {
    const a1 = historyItem({ id: 'a1', issueIdentifier: ISSUE_A, dispatchedAt: '2026-04-09T10:00:00.000Z', resolvedAt: '2026-04-09T10:10:00.000Z' });
    const b1 = historyItem({ id: 'b1', issueIdentifier: ISSUE_B, dispatchedAt: '2026-04-09T11:00:00.000Z', resolvedAt: '2026-04-09T11:10:00.000Z' });
    const a2 = historyItem({ id: 'a2', issueIdentifier: ISSUE_A, dispatchedAt: '2026-04-10T10:00:00.000Z', resolvedAt: '2026-04-10T10:10:00.000Z' });
    const loops = _buildLoops({ historyItems: [a1, b1, a2], now: NOW });
    const byId = Object.fromEntries(loops.map(l => [l.loopId, l]));
    assert.strictEqual(byId.a1.iteration, 1);
    assert.strictEqual(byId.a2.iteration, 2);
    assert.strictEqual(byId.b1.iteration, 1);
  });

  test('dispatch row older than 30 days → filtered out', () => {
    const stale = historyItem({
      id: 'stale',
      dispatchedAt: new Date(NOW.getTime() - LOOKBACK_MS - 1000).toISOString()
    });
    const fresh = historyItem({
      id: 'fresh',
      dispatchedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      resolvedAt: new Date(NOW.getTime() - 30_000).toISOString()
    });
    const loops = _buildLoops({ historyItems: [stale, fresh], now: NOW });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].loopId, 'fresh');
  });

  test('malformed row (no dispatchedAt) → skipped, others processed', () => {
    const bad = historyItem({ id: 'bad', dispatchedAt: 'not-a-date' });
    const good = historyItem({ id: 'good' });
    const loops = _buildLoops({ historyItems: [bad, good], now: NOW });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].loopId, 'good');
  });

  test('malformed row (no issueIdentifier) → skipped', () => {
    const bad = historyItem({ id: 'bad', issueIdentifier: undefined });
    const good = historyItem({ id: 'good' });
    const loops = _buildLoops({ historyItems: [bad, good], now: NOW });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].loopId, 'good');
  });

  test('same-millisecond dispatchedAt → stable order via loopId tie-breaker', () => {
    const ts = '2026-04-10T10:00:00.000Z';
    const a = historyItem({ id: 'aaa', dispatchedAt: ts, resolvedAt: ts });
    const b = historyItem({ id: 'bbb', dispatchedAt: ts, resolvedAt: ts });
    // Run twice with shuffled inputs — order must be the same.
    const r1 = _buildLoops({ historyItems: [a, b], now: NOW });
    const r2 = _buildLoops({ historyItems: [b, a], now: NOW });
    assert.deepStrictEqual(r1.map(l => l.loopId), r2.map(l => l.loopId));
    assert.strictEqual(r1[0].loopId, 'aaa');
    assert.strictEqual(r1[0].iteration, 1);
    assert.strictEqual(r1[1].iteration, 2);
  });

  test('live loop followed by another live loop on same issue → agentStatus after the next dispatch leaks to the next loop, not this one', () => {
    const live1 = liveItem({ id: 'l1', dispatchedAt: '2026-04-11T10:00:00.000Z' });
    const live2 = liveItem({ id: 'l2', dispatchedAt: '2026-04-11T11:00:00.000Z' });
    // Agent entry recorded between l1 and l2 — must decorate l1.
    const between = agentStatusEntry({
      id: 'f-between',
      action: 'plan',
      status: 'completed',
      timestamp: '2026-04-11T10:30:00.000Z'
    });
    // Agent entry recorded after l2 dispatch — must decorate l2.
    const after = agentStatusEntry({
      id: 'f-after',
      action: 'implementation',
      status: 'completed',
      timestamp: '2026-04-11T11:30:00.000Z'
    });
    const loops = _buildLoops({
      liveItems: [live1, live2],
      agentStatusEntries: [between, after],
      now: NOW
    });
    const byId = Object.fromEntries(loops.map(l => [l.loopId, l]));
    assert.strictEqual(byId.l1.agentAction, 'plan');
    assert.strictEqual(byId.l2.agentAction, 'implementation');
  });

  test('exact dispatchId match takes precedence over timestamp window', () => {
    const hist = historyItem({ id: 'h-target' });
    // Agent entry timestamped OUTSIDE the loop window but with matching dispatchId.
    const exact = agentStatusEntry({
      id: 'f-exact',
      dispatchId: 'h-target',
      action: 'review',
      status: 'completed',
      timestamp: '2026-04-10T13:00:00.000Z' // way after resolvedAt 10:30
    });
    const loops = _buildLoops({ historyItems: [hist], agentStatusEntries: [exact], now: NOW });
    assert.strictEqual(loops[0].agentAction, 'review');
    assert.strictEqual(loops[0].agentState, 'complete');
  });

  test('feedback array is passed through verbatim', () => {
    const hist = historyItem({
      feedback: [
        { message: 'started', url: null, urlLabel: null, timestamp: '2026-04-10T10:05:00.000Z' },
        { message: 'done',    url: 'https://x', urlLabel: 'PR', timestamp: '2026-04-10T10:25:00.000Z' }
      ]
    });
    const loops = _buildLoops({ historyItems: [hist], now: NOW });
    assert.strictEqual(loops[0].feedback.length, 2);
    assert.strictEqual(loops[0].feedback[0].message, 'started');
  });

  test('takenAt and resolvedAt both expose the same source field on history items', () => {
    const hist = historyItem({ resolvedAt: '2026-04-10T10:30:00.000Z' });
    const loops = _buildLoops({ historyItems: [hist], now: NOW });
    assert.strictEqual(loops[0].takenAt, '2026-04-10T10:30:00.000Z');
    assert.strictEqual(loops[0].resolvedAt, '2026-04-10T10:30:00.000Z');
  });
});

// ─── Public API with mock stores ─────────────────────────────────────────────

// Mock stores that HONOUR the issue-scope filters (LIN-613). The real stores
// push the predicate into the DB query; modelling that here means the
// issue-scoped tests genuinely prove the store narrowed the read, rather than
// passing only because the caller re-filtered in JS (the behaviour we removed).
function makeMockStores({ live = [], history = [], agentStatus = [], capture = {} } = {}) {
  return {
    dispatchStore: {
      async listItems(urlKey, options) {
        capture.listItemsUrlKey = urlKey;
        capture.listItemsOptions = options;
        const id = options?.issueIdentifier;
        return id ? live.filter(x => x.issueIdentifier === id) : live;
      },
      async listHistory(urlKey, options) {
        capture.listHistoryUrlKey = urlKey;
        capture.listHistoryOptions = options;
        const id = options?.issueIdentifier;
        const items = id ? history.filter(x => x.issueIdentifier === id) : history;
        return { items, total: items.length };
      }
    },
    agentStatusStore: {
      async listStatus(urlKey, options) {
        capture.listStatusUrlKey = urlKey;
        capture.listStatusOptions = options;
        const id = options?.taskIdentifier;
        const items = id ? agentStatus.filter(x => x.taskIdentifier === id) : agentStatus;
        return { items, total: items.length };
      }
    }
  };
}

describe('getLoopsForIssue', () => {
  test('returns [] for missing urlKey or issueIdentifier', async () => {
    const stores = makeMockStores();
    assert.deepStrictEqual(await getLoopsForIssue('', 'LIN-1', stores), []);
    assert.deepStrictEqual(await getLoopsForIssue('ws', '', stores), []);
  });

  test('throws when stores not injected', async () => {
    await assert.rejects(
      () => getLoopsForIssue('ws', 'LIN-1'),
      /dispatchStore and agentStatusStore must be injected/
    );
  });

  test('filters to a single issue', async () => {
    // Use recent dates so the 30-day lookback in _buildLoops keeps them.
    const recentDispatched = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentResolved = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const stores = makeMockStores({
      history: [
        historyItem({ id: 'h-a', issueIdentifier: ISSUE_A, dispatchedAt: recentDispatched, resolvedAt: recentResolved }),
        historyItem({ id: 'h-b', issueIdentifier: ISSUE_B, dispatchedAt: recentDispatched, resolvedAt: recentResolved })
      ],
      agentStatus: [
        agentStatusEntry({ id: 'f-a', taskIdentifier: ISSUE_A, timestamp: recentResolved }),
        agentStatusEntry({ id: 'f-b', taskIdentifier: ISSUE_B, timestamp: recentResolved })
      ]
    });
    const loops = await getLoopsForIssue('ws', ISSUE_A, stores);
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].issueIdentifier, ISSUE_A);
  });

  test('returns empty list when no loops match the issue', async () => {
    const stores = makeMockStores({
      history: [historyItem({ issueIdentifier: ISSUE_B })]
    });
    const loops = await getLoopsForIssue('ws', ISSUE_A, stores);
    assert.deepStrictEqual(loops, []);
  });

  // LIN-613: the single-issue read must push the issue filter DOWN into every
  // store read, so a busy workspace's 30-day log is never downloaded just to
  // serve one issue's accordion. These pin the call shape, not just the result.
  test('pushes the issue filter down into all three store reads (no whole-workspace scan)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForIssue('ws', ISSUE_A, stores);

    // Live queue stays issue-only (it is small/current, not windowed); the two
    // archive reads carry both the issue filter AND the 30-day since window
    // (LIN-622). Both are selective predicates — never a `limit` cap.
    assert.deepStrictEqual(capture.listItemsOptions, { issueIdentifier: ISSUE_A });
    assert.strictEqual(capture.listHistoryOptions.issueIdentifier, ISSUE_A);
    assert.ok(capture.listHistoryOptions.since instanceof Date);
    assert.strictEqual(capture.listStatusOptions.taskIdentifier, ISSUE_A);
    assert.ok(capture.listStatusOptions.since instanceof Date);
  });

  test('does NOT re-add a blanket limit when scoping (filter-pushdown, not a cap)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForIssue('ws', ISSUE_A, stores);

    // The prior blanket cap (truncation footgun) must not return via the scoped
    // path — the only options passed are selective predicates, never a `limit`.
    assert.ok(!('limit' in capture.listStatusOptions), 'no limit on listStatus');
    assert.ok(!('limit' in capture.listHistoryOptions), 'no limit on listHistory');
    assert.ok(!('limit' in capture.listItemsOptions), 'no limit on listItems');
  });
});

describe('getLoopsForWorkspace', () => {
  test('returns [] for missing urlKey', async () => {
    const stores = makeMockStores();
    assert.deepStrictEqual(await getLoopsForWorkspace('', stores), []);
  });

  test('throws when stores not injected', async () => {
    await assert.rejects(
      () => getLoopsForWorkspace('ws'),
      /dispatchStore and agentStatusStore must be injected/
    );
  });

  test('returns flat list across all issues', async () => {
    // Use recent dates so the 30-day lookback in _buildLoops keeps them.
    const recentDispatched = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentResolved = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const stores = makeMockStores({
      history: [
        historyItem({ id: 'h-a', issueIdentifier: ISSUE_A, dispatchedAt: recentDispatched, resolvedAt: recentResolved }),
        historyItem({ id: 'h-b', issueIdentifier: ISSUE_B, dispatchedAt: recentDispatched, resolvedAt: recentResolved })
      ]
    });
    const loops = await getLoopsForWorkspace('ws', stores);
    assert.strictEqual(loops.length, 2);
    const ids = loops.map(l => l.issueIdentifier).sort();
    assert.deepStrictEqual(ids, [ISSUE_A, ISSUE_B]);
  });

  test('calls agentStatusStore.listStatus WITHOUT a limit option but WITH the 30-day since window (regression guard for the pre-fixed truncation footgun; LIN-622 windowing)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForWorkspace('ws', stores);
    // The library must never pass a `limit`/cap — that truncated reconstruction
    // (the pre-fixed footgun). It DOES pass a `since` predicate (a selective
    // window, not a cap) so rows outside the 30-day lookback are never loaded.
    assert.strictEqual(capture.listStatusOptions?.limit, undefined);
    assert.ok(capture.listStatusOptions?.since instanceof Date, 'expected a since window');
    // The window is ~30 days back (LOOKBACK_MS), matching the _buildLoops cutoff.
    const ageMs = Date.now() - capture.listStatusOptions.since.getTime();
    assert.ok(Math.abs(ageMs - 30 * 24 * 60 * 60 * 1000) < 60 * 1000, 'since ≈ now − 30d');
  });

  test('calls dispatchStore.listHistory WITHOUT a limit option but WITH the 30-day since window (LIN-622 windowing)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForWorkspace('ws', stores);
    assert.strictEqual(capture.listHistoryOptions?.limit, undefined);
    assert.ok(capture.listHistoryOptions?.since instanceof Date, 'expected a since window');
    const ageMs = Date.now() - capture.listHistoryOptions.since.getTime();
    assert.ok(Math.abs(ageMs - 30 * 24 * 60 * 60 * 1000) < 60 * 1000, 'since ≈ now − 30d');
  });

  test('survives when listHistory rejects but listItems succeeds', async () => {
    // Stores normally swallow errors and return empty containers, but if a
    // store ever did throw, the error should propagate. This documents the
    // contract.
    const stores = {
      dispatchStore: {
        async listItems() { return [liveItem()]; },
        async listHistory() { throw new Error('boom'); }
      },
      agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } }
    };
    await assert.rejects(() => getLoopsForWorkspace('ws', stores), /boom/);
  });

  test('handles stores that return empty containers', async () => {
    const stores = {
      dispatchStore: {
        async listItems() { return []; },
        async listHistory() { return { items: [], total: 0 }; }
      },
      agentStatusStore: {
        async listStatus() { return { items: [], total: 0 }; }
      }
    };
    const loops = await getLoopsForWorkspace('ws', stores);
    assert.deepStrictEqual(loops, []);
  });
});

// ─── Lean projection (feed memory; LIN-622) ──────────────────────────────────
//
// The Observation feed reconstructs every workspace's full 30-day history on a
// 5s poll. `promptText` (5–30 KB/loop) is the dominant avoidable allocation and
// is never read by the feed, so the feed consumers pass `lean: true` to omit it.
// The run-summary path still needs it, so the DEFAULT must keep it.
describe('lean projection (LIN-622)', () => {
  function recentHistoryStore() {
    const dispatchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resolvedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    return makeMockStores({
      history: [historyItem({ id: 'h-a', dispatchedAt, resolvedAt, prompt: 'a very large prompt body' })]
    });
  }

  test('_buildLoops omits promptText when lean, keeps it by default', () => {
    const hist = historyItem({ prompt: 'big prompt body' });
    const full = _buildLoops({ historyItems: [hist], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    assert.strictEqual(full[0].promptText, 'big prompt body');
    assert.ok(!('promptText' in lean[0]), 'lean loop must not carry a promptText key');
  });

  test('getLoopsForWorkspace lean omits promptText; default carries it', async () => {
    const full = await getLoopsForWorkspace('ws', recentHistoryStore());
    assert.strictEqual(full.length, 1);
    assert.strictEqual(full[0].promptText, 'a very large prompt body');

    const lean = await getLoopsForWorkspace('ws', { ...recentHistoryStore(), lean: true });
    assert.strictEqual(lean.length, 1);
    assert.ok(!('promptText' in lean[0]), 'feed reconstruction must not carry promptText');
  });

  test('getSessionsForWorkspace lean: no loop in any session carries promptText', async () => {
    // A session needs an autopilot orchestrator + a worker carrying its sessionId.
    const dispatchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resolvedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const stores = makeMockStores({
      history: [
        historyItem({ id: 'sess-1', kind: 'autopilot', dispatchedAt, resolvedAt, prompt: 'orchestrator prompt body' }),
        historyItem({ id: 'w-1', sessionId: 'sess-1', dispatchedAt, resolvedAt, prompt: 'worker prompt body' })
      ]
    });
    const sessions = await getSessionsForWorkspace('ws', { ...stores, lean: true });
    const allLoops = sessions.flatMap(s => s.loops || []);
    assert.ok(allLoops.length > 0, 'expected at least one reconstructed loop');
    for (const loop of allLoops) {
      assert.ok(!('promptText' in loop), `session loop ${loop.loopId} must not carry promptText`);
    }
  });

  // ── Option 2: drop retained feedback[] in lean, pre-deriving terminal facts ──

  const TERMINAL_TS = '2026-04-10T10:45:00.000Z';
  function feedbackWithTerminal() {
    return [
      { message: '[working] 6 tools/32s · alive', timestamp: '2026-04-10T10:20:00.000Z' },
      { message: '[evidence] PR opened · https://example.com/pr/1', timestamp: '2026-04-10T10:40:00.000Z' },
      { message: '[done] Task completed in 45s', timestamp: TERMINAL_TS }
    ];
  }

  test('_buildLoops pre-derives terminalStatus + terminalCompletedAt on every loop (lean and default)', () => {
    const hist = historyItem({ feedback: feedbackWithTerminal() });
    const full = _buildLoops({ historyItems: [hist], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    for (const [label, loop] of [['default', full[0]], ['lean', lean[0]]]) {
      assert.strictEqual(loop.terminalStatus, 'done', `${label}: terminalStatus`);
      assert.strictEqual(loop.terminalCompletedAt, TERMINAL_TS, `${label}: terminalCompletedAt`);
    }
  });

  test('_buildLoops pre-derives wakeMarker + waitingMessage for a [blocked] run (LIN-1005, lean and default)', () => {
    const blockedFeedback = [
      { message: '[working] 3 tools/12s · alive', timestamp: '2026-04-10T10:20:00.000Z' },
      { message: '[blocked] need a decision on the auth flow', timestamp: '2026-04-10T10:40:00.000Z' }
    ];
    const hist = historyItem({ feedback: blockedFeedback });
    const full = _buildLoops({ historyItems: [hist], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    for (const [label, loop] of [['default', full[0]], ['lean', lean[0]]]) {
      assert.strictEqual(loop.wakeMarker, 'blocked', `${label}: wakeMarker`);
      assert.match(loop.waitingMessage, /need a decision on the auth flow/, `${label}: waitingMessage`);
      // A [blocked] run is NOT terminal (dispatch-terminal keeps them separate).
      assert.strictEqual(loop.terminalStatus, null, `${label}: not terminal`);
    }
  });

  test('_buildLoops: a [blocked]-then-[done] run pre-derives a done wakeMarker with no waitingMessage (LIN-1005)', () => {
    // findWakeEvent returns the LAST marker; a later [done] means finished, not
    // waiting — so waitingMessage must be null and the run is terminal.
    const feedback = [
      { message: '[blocked] paused for input', timestamp: '2026-04-10T10:20:00.000Z' },
      { message: '[done] resolved and shipped', timestamp: TERMINAL_TS }
    ];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.strictEqual(loop.wakeMarker, 'done', 'latest wake marker wins');
    assert.strictEqual(loop.waitingMessage, null, 'a finished run carries no waiting message');
    assert.strictEqual(loop.terminalStatus, 'done', 'terminal marker is still derived');
  });

  test('_buildLoops drops raw feedback[] when lean but keeps it (and telemetry) by default', () => {
    const hist = historyItem({ feedback: feedbackWithTerminal() });
    const full = _buildLoops({ historyItems: [hist], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    // Default keeps the full witness; lean drops it to bound memory.
    assert.strictEqual(full[0].feedback.length, 3, 'default retains raw feedback');
    assert.deepStrictEqual(lean[0].feedback, [], 'lean must not retain raw feedback');
    // Telemetry is built BEFORE the drop, so the feed keeps its metric chips.
    assert.ok(lean[0].telemetry, 'lean loop still carries telemetry');
    assert.ok(Array.isArray(lean[0].telemetry.metrics) && lean[0].telemetry.metrics.length >= 1,
      'lean telemetry retains the parsed heartbeat metrics');
  });

  test('lean session completedAt is identical to default — the derived terminal time survives the feedback drop', async () => {
    const dispatchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resolvedAt = new Date(Date.now() - 50 * 60 * 1000).toISOString();
    const completedTs = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const feedback = [{ message: `[done] finished in 5m`, timestamp: completedTs }];
    const makeStores = () => makeMockStores({
      history: [
        historyItem({ id: 'sess-1', kind: 'autopilot', dispatchedAt, resolvedAt, feedback }),
        historyItem({ id: 'w-1', sessionId: 'sess-1', dispatchedAt, resolvedAt, feedback })
      ]
    });
    const full = await getSessionsForWorkspace('ws', makeStores());
    const lean = await getSessionsForWorkspace('ws', { ...makeStores(), lean: true });
    assert.strictEqual(lean.length, full.length);
    assert.strictEqual(lean[0].completedAt, full[0].completedAt, 'session completedAt must not regress under lean');
    assert.strictEqual(lean[0].completedAt, completedTs);
  });
});

// ── LIN-623: push the lean intent into the cold history READ (projection) ──────
// LIN-622 dropped `prompt`/`feedback` from OUTPUT loops; the cold read still
// fetched them. These pin that the lean feed now projects `prompt` out of the
// Mongo read (the cold-start latency win) while leaving non-lean reads — and the
// retained `feedback` the feed still derives telemetry from — untouched.
describe('lean read projection (LIN-623)', () => {
  test('getSessionsForWorkspace lean projects `prompt` out of the history read', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getSessionsForWorkspace('ws', { ...stores, lean: true });
    assert.deepStrictEqual(capture.listHistoryOptions.projection, { prompt: 0 },
      'the lean feed read must exclude `prompt` at the query so a real DB never transfers it');
    // It is a column exclusion, NOT a row cap — the truncation-footgun guard stays.
    assert.ok(!('limit' in capture.listHistoryOptions), 'projection must not become a row cap');
  });

  test('lean read projects ONLY `prompt` — feedback (telemetry source) is retained', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getSessionsForWorkspace('ws', { ...stores, lean: true });
    assert.ok(!('feedback' in capture.listHistoryOptions.projection),
      'feedback must NOT be projected away — terminal/telemetry facts are derived from it');
  });

  test('getLoopsForWorkspace lean also projects `prompt` out of the read', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.deepStrictEqual(capture.listHistoryOptions.projection, { prompt: 0 });
  });

  test('non-lean reads carry NO projection (byte-identical full documents)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getSessionsForWorkspace('ws', stores);
    assert.ok(!('projection' in capture.listHistoryOptions),
      'full paths (run-summary/pipeline/single-session) must read the whole document');
  });

  test('issue-scoped reads carry NO projection (drill-down reads the prompt body)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForIssue('ws', ISSUE_A, stores);
    assert.ok(!('projection' in capture.listHistoryOptions),
      'getLoopsForIssue is not lean — it keeps the full document');
  });

  test('lean session still reconstructs terminal facts despite the projected read', async () => {
    // The projection drops `prompt` (unused), not `feedback`; terminal derivation
    // must survive end-to-end through the lean session path.
    const dispatchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resolvedAt = new Date(Date.now() - 50 * 60 * 1000).toISOString();
    const completedTs = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const feedback = [{ message: '[done] finished in 5m', timestamp: completedTs }];
    const stores = makeMockStores({
      history: [
        historyItem({ id: 'sess-1', kind: 'autopilot', dispatchedAt, resolvedAt, feedback }),
        historyItem({ id: 'w-1', sessionId: 'sess-1', dispatchedAt, resolvedAt, feedback })
      ]
    });
    const sessions = await getSessionsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].completedAt, completedTs,
      'derived terminal time survives the projected lean read');
  });
});
