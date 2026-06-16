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

function makeMockStores({ live = [], history = [], agentStatus = [], capture = {} } = {}) {
  return {
    dispatchStore: {
      async listItems(urlKey) {
        capture.listItemsUrlKey = urlKey;
        return live;
      },
      async listHistory(urlKey, options) {
        capture.listHistoryUrlKey = urlKey;
        capture.listHistoryOptions = options;
        return { items: history, total: history.length };
      }
    },
    agentStatusStore: {
      async listStatus(urlKey, options) {
        capture.listStatusUrlKey = urlKey;
        capture.listStatusOptions = options;
        return { items: agentStatus, total: agentStatus.length };
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

  test('calls agentStatusStore.listStatus WITHOUT a limit option (regression guard for the pre-fixed truncation footgun)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForWorkspace('ws', stores);
    // The library must not pass any options to listStatus — it relies on the
    // store's "no limit means everything" contract.
    assert.strictEqual(capture.listStatusOptions, undefined);
  });

  test('calls dispatchStore.listHistory WITHOUT a limit option', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForWorkspace('ws', stores);
    assert.strictEqual(capture.listHistoryOptions, undefined);
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
