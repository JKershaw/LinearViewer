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
  getSessionsForIssues,
  isDecisionAnswerEntry,
  resolvedDecisionEvents,
  firstRaisedAt,
  __internal
} from '../../lib/pipeline-loops.js';
import { parseDecisions, parseHeartbeat } from '../../lib/session-telemetry.js';
import { loopLastActivityMs, isFreshlyActive, isLoopActive } from '../../lib/live-console.js';
import { digestFeedback } from '../../lib/digest-feedback.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const {
  _toDate,
  _deriveAgentState,
  _deriveStage,
  _matchAgentStatusToLoop,
  _buildLoops,
  LOOKBACK_MS,
  _findLastDecision,
  _findDecisionAnswer,
  correlateDecisionCase
} = __internal;

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
  const item = {
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
  // LIN-3011: the lean build derives ONLY from `feedbackDigest` — a raw
  // `feedback` array is never read on the lean path (production Mongo
  // excludes it entirely under the new projection). Every existing/new test
  // that exercises `lean: true` through this fixture needs a digest
  // consistent with its OWN `feedback`, computed here so fixture authors
  // don't have to hand-derive one; `digestFeedback` shares the exact same
  // per-row derivation `_buildLoops`'s non-lean path uses, so lean/non-lean
  // stay in agreement by construction. Skipped when the caller explicitly
  // provides `feedbackVersion`/`feedbackDigest` (e.g. the LIN-3011-specific
  // self-heal/freshness/abort-harvest fixtures below, which need full control
  // over staleness and legacy shapes).
  if (!('feedbackDigest' in overrides) && !('feedbackVersion' in overrides)) {
    const digest = digestFeedback({ feedback: item.feedback, dispatchedAt: item.dispatchedAt }, { now: Date.now() });
    digest.version = 0;
    item.feedbackVersion = 0;
    item.feedbackDigest = digest;
  }
  return item;
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
    const fmn = agentStatusEntry({ action: 'review', status: 'completed', tokenId: 'tok-1', tokenLabel: 'dispatch-bootstrap' });
    const loops = _buildLoops({ historyItems: [hist], agentStatusEntries: [fmn], now: NOW });
    assert.strictEqual(loops[0].agentState, 'complete');
    assert.strictEqual(loops[0].stage, 'review');
    assert.strictEqual(loops[0].agentAction, 'review');
    assert.strictEqual(loops[0].agentStatus, 'completed');
    assert.strictEqual(loops[0].agentSummary, 'Done.');
    // LIN-1587 R2 — credential identity carried off the matched agent-status entry.
    assert.strictEqual(loops[0].agentTokenId, 'tok-1');
    assert.strictEqual(loops[0].agentTokenLabel, 'dispatch-bootstrap');
  });

  test('LIN-1587 R2: no agentStatus match → agentTokenId/agentTokenLabel are null, never undefined', () => {
    const hist = historyItem({ id: 'h-1' });
    const loops = _buildLoops({ historyItems: [hist], now: NOW });
    assert.strictEqual(loops[0].agentTokenId, null);
    assert.strictEqual(loops[0].agentTokenLabel, null);
  });

  test('LIN-1587 R2: matched agentStatus entry with no tokenId/tokenLabel → null, never undefined', () => {
    const hist = historyItem({ id: 'h-1' });
    const fmn = agentStatusEntry({ action: 'review', status: 'completed' }); // no tokenId/tokenLabel
    const loops = _buildLoops({ historyItems: [hist], agentStatusEntries: [fmn], now: NOW });
    assert.strictEqual(loops[0].agentTokenId, null);
    assert.strictEqual(loops[0].agentTokenLabel, null);
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

  // ─── LIN-2232: wake rows are identifier-less by design, not malformed ───────
  test('LIN-2232: history row with kind:"wake" and no issueIdentifier → skipped silently, zero warn lines', (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    const wake = historyItem({ id: 'wake-1', issueIdentifier: undefined, kind: 'wake' });
    const good = historyItem({ id: 'good' });
    const loops = _buildLoops({ historyItems: [wake, good], now: NOW });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].loopId, 'good');
    assert.strictEqual(warnMock.mock.calls.length, 0, 'a wake row must produce zero warn lines');
  });

  test('LIN-2232: live row with kind:"wake" and no issueIdentifier → skipped silently, zero warn lines', (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    const wake = liveItem({ id: 'wake-live-1', issueIdentifier: undefined, kind: 'wake' });
    const good = liveItem({ id: 'good-live' });
    const loops = _buildLoops({ liveItems: [wake, good], now: NOW });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].loopId, 'good-live');
    assert.strictEqual(warnMock.mock.calls.length, 0, 'a wake row must produce zero warn lines');
  });

  test('LIN-2232: a genuinely malformed row (no issueIdentifier, not identifier-less-by-design) still warns at least once, with its cause', (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    const bad = historyItem({ id: 'bad-warns-once', issueIdentifier: undefined });
    _buildLoops({ historyItems: [bad], now: NOW });
    assert.strictEqual(warnMock.mock.calls.length, 1);
    const [message] = warnMock.mock.calls[0].arguments;
    assert.match(message, /malformed/);
  });

  test('LIN-2232: repeated polls over the same genuinely-malformed row warn once per process lifetime, not once per poll', (t) => {
    const warnMock = t.mock.method(console, 'warn', () => {});
    const bad = historyItem({ id: 'bad-repeat', issueIdentifier: undefined });
    _buildLoops({ historyItems: [bad], now: NOW }); // poll 1
    _buildLoops({ historyItems: [bad], now: NOW }); // poll 2
    _buildLoops({ historyItems: [bad], now: NOW }); // poll 3
    assert.strictEqual(warnMock.mock.calls.length, 1, 'must not re-warn on every poll for the same malformed cause');
  });

  // ─── LIN-2121: the deliberate cross-surface effect of stamping the scope ────
  //
  // Once a wake row carries an `issueIdentifier`, the identifier-less skip no
  // longer applies and the row is built as an ordinary loop (attached to its
  // parent chain via `followUpTo`/`sessionGroupId`). Pinned here so the
  // consequence of LIN-2121 is a witnessed behaviour, not a silent change.
  test('LIN-2121: a wake row WITH issueIdentifier is built as a loop, not skipped as identifier-less', () => {
    const wake = historyItem({ id: 'wake-lin2121', kind: 'wake', issueIdentifier: ISSUE_A, followUpTo: 'root-1' });
    const loops = _buildLoops({ historyItems: [wake], now: NOW });
    assert.strictEqual(loops.length, 1, 'a scoped wake row is a first-class loop');
    assert.strictEqual(loops[0].loopId, 'wake-lin2121');
    assert.strictEqual(loops[0].kind, 'wake');
    assert.strictEqual(loops[0].issueIdentifier, ISSUE_A, 'its issue scope rides through to the loop');
    assert.strictEqual(loops[0].followUpTo, 'root-1', 'and it still points at its parent for session stitching');
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

// ─── Abort terminal-attribution (LIN-1257) ───────────────────────────────────
//
// When Simple Dispatcher aborts a session it posts the terminal `[aborted]`
// marker to the abort item's OWN dispatch row, which carries `issueIdentifier:
// null` and is therefore dropped by reconstruction. The original target row
// (named by `abortTo`) receives no terminal marker and keeps rendering its last
// running heartbeat. `_buildLoops`' pre-pass harvests each abort row's `[aborted]`
// entry BEFORE the drop and appends it to a LOCAL copy of the target loop's
// feedback, so the existing terminal derivation yields `terminalStatus:'aborted'`.
describe('_buildLoops abort attribution (LIN-1257)', () => {
  const ABORT_TS = '2026-04-11T11:30:00.000Z';

  function targetWorker(overrides = {}) {
    // A surviving target: live row, has an issueIdentifier, last feedback a
    // running heartbeat (would otherwise render in-progress forever).
    return liveItem({
      id: 'W',
      issueIdentifier: ISSUE_A,
      dispatchedAt: '2026-04-11T11:00:00.000Z',
      feedback: [{ message: '[working · running] 4 tools in 34s', timestamp: '2026-04-11T11:20:00.000Z' }],
      ...overrides
    });
  }

  function abortRow(overrides = {}) {
    // The abort item: no issueIdentifier (dropped by reconstruction), abort=true,
    // abortTo = the target id, terminal `[aborted]` feedback carrying the timestamp.
    return historyItem({
      id: 'A',
      issueIdentifier: null,
      abort: true,
      abortTo: 'W',
      dispatchedAt: '2026-04-11T11:29:00.000Z',
      resolvedAt: ABORT_TS,
      feedback: [{ message: '[aborted] Cancelled running session 3e626118 (EXECUTING).', timestamp: ABORT_TS }],
      ...overrides
    });
  }

  test('worker-abort attributes terminalStatus:aborted (+ completedAt) to the target; the abort row yields no loop', () => {
    const loops = _buildLoops({ liveItems: [targetWorker()], historyItems: [abortRow()], now: NOW });
    // Exactly one loop — the surviving target. The abort row (issueIdentifier:null)
    // is still dropped and produces no loop of its own.
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].loopId, 'W');
    assert.strictEqual(loops.find(l => l.loopId === 'A'), undefined, 'abort row must not become a loop');
    // The target is now terminal:aborted, timestamped from the abort row's entry.
    assert.strictEqual(loops[0].terminalStatus, 'aborted');
    assert.strictEqual(loops[0].terminalCompletedAt, ABORT_TS);
  });

  test('the synthesized [aborted] entry is a LOCAL copy — the stored dispatch record is not mutated', () => {
    const storedFeedback = [{ message: '[working · running] alive', timestamp: '2026-04-11T11:20:00.000Z' }];
    const target = targetWorker({ feedback: storedFeedback });
    _buildLoops({ liveItems: [target], historyItems: [abortRow()], now: NOW });
    // The original item.feedback array is untouched (no synthetic entry appended).
    assert.strictEqual(storedFeedback.length, 1, 'stored feedback must not be mutated in place');
    assert.strictEqual(storedFeedback[0].message, '[working · running] alive');
  });

  test('an abort with NO abortTo attributes to nothing (target keeps its running heartbeat)', () => {
    const loops = _buildLoops({
      liveItems: [targetWorker()],
      historyItems: [abortRow({ abortTo: undefined })],
      now: NOW
    });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].terminalStatus, null, 'no abortTo → no attribution');
  });

  test('[skipped] abort (human-continued, runner refused) must NOT attribute terminal to its target', () => {
    // The runner posts `[skipped]` (not `[aborted]`) when it refuses a cascade
    // abort because a human is still in the session — nothing ended there, so the
    // target must stay non-terminal. This pins the `terminal.status === 'aborted'`
    // gate: a blind "grab the abort row's last feedback" would mis-flip this.
    const skippedAbort = abortRow({
      feedback: [{ message: '[skipped] human-continued session 3e626118 (implementation).', timestamp: ABORT_TS }]
    });
    const loops = _buildLoops({ liveItems: [targetWorker()], historyItems: [skippedAbort], now: NOW });
    assert.strictEqual(loops.length, 1);
    assert.strictEqual(loops[0].loopId, 'W');
    assert.strictEqual(loops[0].terminalStatus, null, 'a [skipped] abort must not flip the target terminal');
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

  test('_buildLoops carries agentTokenId + agentTokenLabel on every loop (lean and default, LIN-1587 R2)', () => {
    const hist = historyItem({ id: 'h-1' });
    const fmn = agentStatusEntry({ tokenId: 'tok-42', tokenLabel: 'wake-bootstrap' });
    const full = _buildLoops({ historyItems: [hist], agentStatusEntries: [fmn], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], agentStatusEntries: [fmn], now: NOW, lean: true });
    for (const [label, loop] of [['default', full[0]], ['lean', lean[0]]]) {
      assert.strictEqual(loop.agentTokenId, 'tok-42', `${label}: agentTokenId`);
      assert.strictEqual(loop.agentTokenLabel, 'wake-bootstrap', `${label}: agentTokenLabel`);
    }
  });

  // T16 (LIN-2653): the fossil-bookkeeping stamp rides the always-present
  // scalar set beside historyStatus (lib/pipeline-loops.js:763), same as
  // agentTokenId/agentTokenLabel just above — it must survive the lean drop
  // the 60s observer sweep uses, not just the full read-summary path.
  test('_buildLoops carries `bookkeeping` on every loop (lean and default, LIN-2653)', () => {
    const stamp = { at: '2026-04-10T09:00:00.000Z', by: 'operator-1', reason: 'fossil pass' };
    const hist = historyItem({ id: 'h-stamped', bookkeeping: stamp });
    const full = _buildLoops({ historyItems: [hist], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    for (const [label, loop] of [['default', full[0]], ['lean', lean[0]]]) {
      assert.deepStrictEqual(loop.bookkeeping, stamp, `${label}: bookkeeping`);
    }
  });

  test('_buildLoops carries `bookkeeping: null` for an unstamped row (lean and default)', () => {
    const hist = historyItem({ id: 'h-unstamped' });
    const full = _buildLoops({ historyItems: [hist], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    for (const [label, loop] of [['default', full[0]], ['lean', lean[0]]]) {
      assert.strictEqual(loop.bookkeeping, null, `${label}: bookkeeping`);
    }
  });

  // ── T17 (LIN-2653): the pinned reader `_deriveAgentState` ────────────────
  //
  // The fossil pass never touches `status`, so a stamped row must read
  // IDENTICALLY to the same row unstamped. Pinned at two levels: the
  // derivation itself, which structurally cannot see the stamp, and the whole
  // built Loop record, which must differ in the `bookkeeping` field and in
  // nothing else whatsoever.
  test('T17: _deriveAgentState is byte-identical for a stamped vs unstamped row', () => {
    const stamp = { at: '2026-04-04T09:00:00.000Z', by: 'operator-1', reason: 'fossil-pass-lin2633' };
    const unstamped = historyItem({ id: 'h-t17', issueIdentifier: 'LIN-1700' });
    const stamped = historyItem({ id: 'h-t17', issueIdentifier: 'LIN-1700', bookkeeping: stamp });

    const before = _buildLoops({ historyItems: [unstamped], now: NOW })[0];
    const after = _buildLoops({ historyItems: [stamped], now: NOW })[0];

    assert.strictEqual(after.bookkeeping, stamp, 'sanity: the row really is stamped');
    assert.strictEqual(before.bookkeeping, null, 'sanity: and its twin really is not');
    assert.strictEqual(after.agentState, before.agentState, 'agentState must not move');
    assert.strictEqual(after.historyStatus, 'taken', 'and status is untouched — still taken');
    assert.strictEqual(before.historyStatus, after.historyStatus);

    // The whole record, not just the one field: delete the stamp from both and
    // they must be deep-equal. This catches any downstream derivation that
    // starts keying on the stamp, not merely `_deriveAgentState`.
    const { bookkeeping: _a, ...afterRest } = after;
    const { bookkeeping: _b, ...beforeRest } = before;
    assert.deepStrictEqual(afterRest, beforeRest,
      'the stamp must change the loop record in exactly one field and no other');
  });

  test('T17: the same holds for every agent-status decoration branch', () => {
    const stamp = { at: '2026-04-04T09:00:00.000Z', by: null, reason: 'fossil-pass-lin2633' };
    for (const agentStatus of ['completed', 'failed', 'blocked', 'in-progress']) {
      const fmn = agentStatusEntry({ dispatchId: 'h-t17b', taskIdentifier: 'LIN-1701', status: agentStatus });
      const base = { id: 'h-t17b', issueIdentifier: 'LIN-1701' };
      const before = _buildLoops({ historyItems: [historyItem(base)], agentStatusEntries: [fmn], now: NOW })[0];
      const after = _buildLoops({ historyItems: [historyItem({ ...base, bookkeeping: stamp })], agentStatusEntries: [fmn], now: NOW })[0];
      assert.strictEqual(after.agentState, before.agentState, `agentState must not move for agentStatus=${agentStatus}`);
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

  test('_buildLoops: a [pending] run is NOT human-waiting — wakeMarker kept, but no waitingMessage (LIN-1025)', () => {
    // [pending] is an agent-to-agent orchestrator handoff (LIN-843), not a request
    // for user input. findWakeEvent still returns it (it stays a wake marker for the
    // orchestrator path), but it is excluded from WAITING_WAKE_MARKERS, so the
    // human-facing waitingMessage must be null and the run must not be terminal.
    const pendingFeedback = [
      { message: '[working] 2 tools/8s · alive', timestamp: '2026-04-10T10:20:00.000Z' },
      { message: '[pending] my beat is done, task is not', timestamp: '2026-04-10T10:40:00.000Z' }
    ];
    const hist = historyItem({ feedback: pendingFeedback });
    const full = _buildLoops({ historyItems: [hist], now: NOW });
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true });
    for (const [label, loop] of [['default', full[0]], ['lean', lean[0]]]) {
      assert.strictEqual(loop.wakeMarker, 'pending', `${label}: wakeMarker still recorded`);
      assert.strictEqual(loop.waitingMessage, null, `${label}: [pending] is not human-waiting`);
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
  test('getSessionsForWorkspace lean projects `prompt` AND `feedback` out of the history read (LIN-3011)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getSessionsForWorkspace('ws', { ...stores, lean: true });
    assert.deepStrictEqual(capture.listHistoryOptions.projection, { prompt: 0, feedback: 0 },
      'the lean feed read must exclude BOTH `prompt` and `feedback` at the query (LIN-3011) — the digest is a complete substitute, so feedback need not cross the wire either');
    // It is a column exclusion, NOT a row cap — the truncation-footgun guard stays.
    assert.ok(!('limit' in capture.listHistoryOptions), 'projection must not become a row cap');
  });

  // LIN-3011: this replaces the old "feedback must NOT be projected away" guard.
  // That constraint held only because the derivations ran over raw feedback at
  // read time; now that `feedbackDigest` (lib/digest-feedback.js, LIN-3008)
  // persists every loop-facing fact `_buildLoops` derives, feedback is safe to
  // exclude too. This asserts BOTH halves: the digest is a complete substitute
  // (precondition, already true post-Phase-0), and the lean read now excludes
  // feedback given that precondition (LIN-3011, not yet true pre-fix).
  test('the digest carries every derived fact, which is why the lean read can now project feedback away too', async () => {
    const doc = {
      feedback: [
        { kind: 'assistant-text', message: 'working on it', timestamp: new Date('2026-04-10T10:00:00.000Z') },
        { kind: 'status', message: '[done] finished in 5m', timestamp: new Date('2026-04-10T10:05:00.000Z') }
      ],
      dispatchedAt: new Date('2026-04-10T09:55:00.000Z')
    };
    const digest = digestFeedback(doc, { now: Date.now() });
    for (const key of ['terminal', 'wake', 'decision', 'decisionEntryIndex', 'decisionCase', 'answeredDecisionId', 'parkedWait', 'telemetry']) {
      assert.ok(key in digest, `digest is missing loop-facing fact "${key}" — not a complete substitute for feedback`);
    }

    const capture = {};
    const stores = makeMockStores({ capture });
    await getSessionsForWorkspace('ws', { ...stores, lean: true });
    assert.deepStrictEqual(capture.listHistoryOptions.projection, { prompt: 0, feedback: 0 },
      'now that the digest carries every derived fact, the lean read excludes feedback too (LIN-3011)');
  });

  test('getLoopsForWorkspace lean also projects `prompt` AND `feedback` out of the read (LIN-3011)', async () => {
    const capture = {};
    const stores = makeMockStores({ capture });
    await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.deepStrictEqual(capture.listHistoryOptions.projection, { prompt: 0, feedback: 0 });
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

// ═══════════════════════════════════════════════════════════════════════════
// LIN-3011 (LIN-2996 Phase 3): self-heal + digest-backed lean loop build
// ═══════════════════════════════════════════════════════════════════════════
//
// From LIN-3011 the lean read excludes `feedback` too (see above), so the lean
// path can no longer derive terminal/wake/decision/telemetry facts by
// re-scanning `item.feedback` — that array is absent. It must instead read
// those facts off the row's persisted `feedbackDigest` (lib/digest-feedback.js,
// LIN-3008), self-healing (`historyCollection.find({_id:{$in:[...]}})`,
// `{prompt:0}` projection) any row whose digest is missing or stale. None of
// this exists at HEAD yet — every witness below fails today, either because a
// derived fact comes back null/undefined (nothing scans the absent `feedback`)
// or because a field this beat's acceptance requires (`loop.toolPeak`) does
// not exist on the built loop at all yet.
//
// `leanDigestItem` shapes a `listHistory` row EXACTLY as a post-LIN-3011 lean
// read would: no `feedback` key (exclusion projection), plus
// `feedbackVersion`/`feedbackDigest`. `rawCollectionDoc` shapes what a
// self-heal `_id $in` re-read would hit: a raw Mongo-ish doc with `feedback`
// retained. The two are deliberately NOT auto-derived from one another so each
// test states its fixture in the exact shape it needs.
//
// Fixture timestamps are relative to test-run time (`Date.now()`), never a
// fixed calendar date: these go through the PUBLIC getLoops*/getSessions* API
// (not `_buildLoops` directly), which always uses a real `now`, so a fixed
// calendar date risks silently ageing out of the 30-day lookback and being
// dropped rather than genuinely asserted on.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DIGEST_ANCHOR_MS = Date.now() - 8 * HOUR; // the whole fixture timeline sits inside the last 8h
function digestIso(offsetMs = 0) { return new Date(DIGEST_ANCHOR_MS + offsetMs).toISOString(); }

function leanDigestItem(overrides = {}) {
  const item = {
    id: 'h-1',
    promptName: 'implementation',
    issueId: 'uuid-100',
    issueIdentifier: ISSUE_A,
    issueTitle: 'Issue A',
    issueUrl: 'https://linear.app/x/issue/LIN-100',
    dispatchedAt: digestIso(HOUR),
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: digestIso(2 * HOUR),
    sessionId: null,
    rootItemId: null,
    abort: false,
    abortTo: null,
    feedbackVersion: 1,
    feedbackDigest: null,
    ...overrides
  };
  delete item.feedback; // exclusion projection: the key is never present, not even []
  return item;
}

function rawCollectionDoc(overrides = {}) {
  return {
    _id: 'h-1',
    urlKey: 'ws',
    issueIdentifier: ISSUE_A,
    dispatchedAt: new Date(digestIso(HOUR)),
    feedback: [],
    feedbackVersion: 1,
    feedbackDigest: null,
    ...overrides
  };
}

function makeLeanDigestStores({ items = [], collectionDocs = [], findError = null, updateError = null, findSpy = null, updateSpy = null } = {}) {
  const collection = createMockCollection();
  for (const d of collectionDocs) collection._docs.push({ ...d });
  const historyCollection = {
    find(query, opts) {
      if (findSpy) findSpy(query, opts);
      if (findError) return { toArray: async () => { throw findError; } };
      return collection.find(query, opts);
    },
    async updateOne(query, update, opts) {
      if (updateSpy) updateSpy(query, update, opts);
      if (updateError) throw updateError;
      return collection.updateOne(query, update, opts);
    }
  };
  return {
    // `_collection` is the raw, UNSPIED mock — tests that need to read back
    // written state (e.g. "did the write-back land") use this directly so
    // that diagnostic read doesn't itself inflate `findSpy`'s call count.
    _collection: collection,
    dispatchStore: {
      historyCollection,
      async listItems() { return []; },
      async listHistory() { return { items, total: items.length }; }
    },
    agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } }
  };
}

describe('self-heal (LIN-3011): missing/stale feedbackDigest re-reads by _id, guarded write-back', () => {
  test('a missing digest (feedbackVersion:0, feedbackDigest:null) triggers a re-read and the fill derives from the healed digest', async () => {
    const findCalls = [];
    const updateCalls = [];
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({ feedbackVersion: 0, feedbackDigest: null })],
      collectionDocs: [rawCollectionDoc({
        feedbackVersion: 0,
        feedback: [{ kind: 'status', message: '[done] finished in 5m', timestamp: new Date(digestIso(HOUR + 5 * MIN)) }]
      })],
      findSpy: (q, o) => findCalls.push({ q, o }),
      updateSpy: (q, u) => updateCalls.push({ q, u })
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(loops.length, 1, 'the row is not dropped');
    assert.strictEqual(loops[0].terminalStatus, 'done', 'derived from the re-read + digested feedback, not the absent lean feedback[]');
    assert.strictEqual(findCalls.length, 1, 'exactly one self-heal re-read for the one stale row');
    assert.deepStrictEqual(findCalls[0].q, { _id: { $in: ['h-1'] } });
    assert.deepStrictEqual(findCalls[0].o?.projection, { prompt: 0 }, 'self-heal re-read excludes prompt (N3) but keeps feedback');
    assert.strictEqual(updateCalls.length, 1, 'the healed digest is written back');
    assert.deepStrictEqual(updateCalls[0].q, { _id: 'h-1', feedbackVersion: 0 },
      'write-back is guarded on the row\'s CURRENT feedbackVersion ({_id, feedbackVersion: doc.feedbackVersion ?? null})');
  });

  test('a stale version (feedbackVersion !== feedbackDigest.version) triggers a re-read', async () => {
    const findCalls = [];
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({
        feedbackVersion: 3,
        feedbackDigest: { version: 2, terminal: null, wake: null, decision: null, decisionCase: [], answeredDecisionId: null, parkedWait: null, telemetry: { runtime: {}, metrics: [], toolPeak: null } }
      })],
      collectionDocs: [rawCollectionDoc({
        feedbackVersion: 3,
        feedback: [{ kind: 'status', message: '[done] finished in 5m', timestamp: new Date(digestIso(HOUR + 5 * MIN)) }]
      })],
      findSpy: (q, o) => findCalls.push({ q, o })
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(findCalls.length, 1, 'stale version must re-read, not trust the outdated digest');
    assert.strictEqual(loops[0].terminalStatus, 'done');
  });

  test('a fresh digest (feedbackVersion === feedbackDigest.version) needs zero re-reads', async () => {
    const findCalls = [];
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({
        feedbackVersion: 2,
        feedbackDigest: {
          version: 2,
          terminal: { status: 'done', entry: { message: '[done] finished', timestamp: digestIso(HOUR + 5 * MIN) } },
          wake: null, decision: null, decisionCase: [], answeredDecisionId: null,
          parkedWait: null,
          telemetry: { runtime: {}, metrics: [], toolPeak: null }
        }
      })],
      collectionDocs: [rawCollectionDoc({ feedbackVersion: 2 })],
      findSpy: (q, o) => findCalls.push({ q, o })
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(findCalls.length, 0, 'a fresh digest must not trigger any re-read');
    assert.strictEqual(loops[0].terminalStatus, 'done', 'derived straight from the fresh digest');
  });

  test('a re-read failure THROWS and fails the whole fill — no dropped row, no nulled fact', async () => {
    const stores = makeLeanDigestStores({
      items: [
        leanDigestItem({ id: 'h-1', feedbackVersion: 0, feedbackDigest: null }),
        leanDigestItem({ id: 'h-2', feedbackVersion: 0, feedbackDigest: null })
      ],
      collectionDocs: [rawCollectionDoc({ _id: 'h-1' }), rawCollectionDoc({ _id: 'h-2' })],
      findError: new Error('simulated Mongo re-read failure')
    });
    await assert.rejects(
      () => getLoopsForWorkspace('ws', { ...stores, lean: true }),
      /simulated Mongo re-read failure/,
      "the fill must fail loudly, unlike listHistory's catch -> {items:[]} convention"
    );
  });

  test('a write-back failure is logged only — the fill still succeeds with the healed value', async () => {
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    try {
      const stores = makeLeanDigestStores({
        items: [leanDigestItem({ feedbackVersion: 0, feedbackDigest: null })],
        collectionDocs: [rawCollectionDoc({
          feedbackVersion: 0,
          feedback: [{ kind: 'status', message: '[done] finished in 5m', timestamp: new Date(digestIso(HOUR + 5 * MIN)) }]
        })],
        updateError: new Error('simulated write-back failure')
      });
      const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
      assert.strictEqual(loops.length, 1, 'the fill still succeeds');
      assert.strictEqual(loops[0].terminalStatus, 'done', 'still uses the healed value for THIS fill');
      assert.ok(
        logged.some(a => a.join(' ').match(/write-?back/i)),
        'the write-back failure is logged, not swallowed silently'
      );
    } finally {
      console.error = originalError;
    }
  });

  test('a legacy row converges after one heal — the second lean fill makes zero further re-reads', async () => {
    const findCalls = [];
    const items = [leanDigestItem({ feedbackVersion: 0, feedbackDigest: null })];
    const stores = makeLeanDigestStores({
      items,
      collectionDocs: [rawCollectionDoc({
        feedbackVersion: 0,
        feedback: [{ kind: 'status', message: '[done] finished in 5m', timestamp: new Date(digestIso(HOUR + 5 * MIN)) }]
      })],
      findSpy: (q, o) => findCalls.push({ q, o })
    });
    await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(findCalls.length, 1, 'first fill heals the legacy row');

    // Read back what the first fill's write-back actually persisted, and feed
    // THAT (not a hand-authored fixture) into the second fill's listHistory —
    // isolates "does a fresh digest skip re-reads" (covered above) from "does
    // this converge via the real write-back the first fill performed".
    const healed = (await collectionArray(stores)).find(d => d._id === 'h-1');
    items[0] = leanDigestItem({ feedbackVersion: healed.feedbackVersion, feedbackDigest: healed.feedbackDigest });

    await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(findCalls.length, 1, 'second fill made zero further re-reads — the healed digest is now fresh');
  });

  test('self-heal re-read excludes `prompt` but keeps `feedback` (N3)', async () => {
    const findCalls = [];
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({ feedbackVersion: 0, feedbackDigest: null })],
      collectionDocs: [rawCollectionDoc({ feedbackVersion: 0, prompt: 'a 30kb prompt body', feedback: [] })],
      findSpy: (q, o) => findCalls.push({ q, o })
    });
    await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(findCalls.length, 1);
    assert.deepStrictEqual(findCalls[0].o?.projection, { prompt: 0 });
  });
});

// Helper for the convergence test above: read back the mock historyCollection's
// current documents via its own `find` (not `_docs` directly), so the test
// exercises the same interface production code uses.
async function collectionArray(stores) {
  // Reads the raw, UNSPIED collection directly — going through
  // `historyCollection.find` here would itself count as a self-heal read and
  // inflate `findSpy`'s call count, contaminating the very thing this helper
  // exists to verify.
  return stores._collection.find({}, {}).toArray();
}

describe('lean loop build reads terminal/wake/decision/telemetry from feedbackDigest (LIN-3011)', () => {
  const FRESH_DIGEST = {
    version: 5,
    terminal: { status: 'done', entry: { message: '[done] shipped it', timestamp: digestIso(HOUR + 10 * MIN) } },
    wake: { marker: 'blocked', waitingMessage: 'need a ruling' },
    decision: { decision_id: 'd-1', question: 'ship or hold?' },
    decisionEntryIndex: 2,
    decisionCase: ['here is the case'],
    answeredDecisionId: 'd-0',
    parkedWait: { reason: 'ci-poll' },
    telemetry: {
      model: 'opus', evidence: [{ url: 'https://x' }], usage: { costUsd: 1.2 }, resources: null,
      ticketMarkers: [], metrics: [{ timestamp: digestIso(HOUR), total: 3 }], toolPeak: 3,
      runtime: { ms: 600000, dispatchedAt: digestIso(HOUR), completedAt: digestIso(HOUR + 10 * MIN), crossCheck: null }
    }
  };

  test('terminal/wake/decision/decisionCase/answeredDecisionId/parkedWait are sourced from the digest, not re-derived from (absent) feedback', async () => {
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({ feedbackVersion: 5, feedbackDigest: FRESH_DIGEST })],
      collectionDocs: [rawCollectionDoc({ feedbackVersion: 5 })]
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(loops.length, 1);
    const loop = loops[0];
    assert.strictEqual(loop.terminalStatus, 'done');
    assert.strictEqual(loop.terminalCompletedAt, digestIso(HOUR + 10 * MIN));
    assert.strictEqual(loop.wakeMarker, 'blocked');
    assert.strictEqual(loop.waitingMessage, 'need a ruling');
    assert.deepStrictEqual(loop.decision, FRESH_DIGEST.decision);
    assert.deepStrictEqual(loop.decisionCase, ['here is the case']);
    assert.strictEqual(loop.answeredDecisionId, 'd-0');
    assert.deepStrictEqual(loop.telemetry.parkedWait, { reason: 'ci-poll' });
    assert.strictEqual(loop.telemetry.runtime.ms, 600000);
  });

  test('omitted vs null is preserved through the digest-backed build: absent decision/wake stay null, absent parkedWait stays OMITTED (never invented as null)', async () => {
    // LIN-3011 beat-4 fix: this test originally asserted
    // `loop.telemetry.parkedWait === null` for the absent case, but the REAL
    // contract (confirmed against `deriveLoopFacingFacts`/`buildRunTelemetry`,
    // session-telemetry.js's `_assembleTelemetry`: `if (parkedWait) telemetry.
    // parkedWait = parkedWait`) OMITS the key entirely when there is no
    // parked wait — unlike `decision`/`wake`, which are always-present,
    // explicit-null-when-absent fields. Asserting `=== null` here would have
    // been the WRONG omitted-vs-null contract to pin, and the fix that makes
    // this beat's build correctly omit the key (matching non-lean byte-for-
    // byte) would have looked like a regression against it. Corrected to
    // check for the key's absence instead, which is what "never coerced or
    // invented" actually requires for this specific field.
    const digest = { ...FRESH_DIGEST, decision: null, decisionCase: [], parkedWait: null, wake: null };
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({ feedbackVersion: 5, feedbackDigest: digest })],
      collectionDocs: [rawCollectionDoc({ feedbackVersion: 5 })]
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const loop = loops[0];
    assert.strictEqual(loop.decision, null);
    assert.deepStrictEqual(loop.decisionCase, []);
    assert.strictEqual(loop.wakeMarker, null);
    assert.strictEqual(loop.waitingMessage, null);
    assert.ok(!('parkedWait' in loop.telemetry), 'no parked wait -> the key is omitted, matching the non-lean buildRunTelemetry contract exactly');
    assert.ok('decision' in loop && 'decisionCase' in loop, 'keys present even when empty — the !== undefined build-discriminators depend on this');
  });

  test('the non-lean path is unaffected: it still derives from raw feedback, ignoring any feedbackDigest present (regression guard)', async () => {
    // Not a new-behavior witness — deliberately NOT expected to fail today,
    // since no production code has changed yet. See the beat-2 report for the
    // mutation evidence proving this guard catches a regression if the
    // non-lean path is ever accidentally switched to read the digest.
    const misleadingDigest = {
      ...FRESH_DIGEST,
      terminal: { status: 'aborted', entry: { message: '[aborted]', timestamp: '2099-01-01T00:00:00.000Z' } }
    };
    const stores = makeMockStores({
      history: [historyItem({
        id: 'h-1',
        dispatchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        resolvedAt: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
        feedback: [{ message: '[done] finished in 5m', timestamp: new Date(Date.now() - 55 * 60 * 1000).toISOString() }],
        feedbackVersion: 5,
        feedbackDigest: misleadingDigest
      })]
    });
    const loops = await getLoopsForWorkspace('ws', stores); // no lean: true
    assert.strictEqual(loops[0].terminalStatus, 'done', 'non-lean derives from raw feedback, not the (deliberately wrong) digest');
  });
});

describe("abort harvest sourced from the abort row's own feedbackDigest.terminal (LIN-3011)", () => {
  function abortRow(overrides = {}) {
    return leanDigestItem({
      id: 'abort-1',
      abort: true,
      abortTo: 'target-1',
      feedbackVersion: 1,
      feedbackDigest: {
        version: 1,
        terminal: { status: 'aborted', entry: { message: '[aborted] cancelled', timestamp: digestIso(HOUR + 900) } },
        wake: null, decision: null, decisionCase: [], answeredDecisionId: null, parkedWait: null,
        telemetry: { runtime: {}, metrics: [], toolPeak: null }
      },
      dispatchedAt: digestIso(59 * MIN),
      resolvedAt: digestIso(HOUR + MIN),
      ...overrides
    });
  }

  function targetRow(digestOverrides = {}) {
    return leanDigestItem({
      id: 'target-1',
      feedbackVersion: 1,
      feedbackDigest: {
        version: 1,
        terminal: null, wake: { marker: 'blocked', waitingMessage: 'waiting' }, decision: null, decisionCase: [],
        answeredDecisionId: null,
        parkedWait: { reason: 'ci-poll' },
        telemetry: { runtime: { ms: null, dispatchedAt: digestIso(0), completedAt: null, crossCheck: null }, metrics: [], toolPeak: null },
        ...digestOverrides
      },
      dispatchedAt: digestIso(0)
    });
  }

  const abortCollectionDocs = () => [rawCollectionDoc({ _id: 'abort-1' }), rawCollectionDoc({ _id: 'target-1' })];

  test('terminal status becomes aborted on the target', async () => {
    const stores = makeLeanDigestStores({ items: [abortRow(), targetRow()], collectionDocs: abortCollectionDocs() });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const target = loops.find(l => l.loopId === 'target-1');
    assert.ok(target, 'target loop survives');
    assert.strictEqual(target.terminalStatus, 'aborted');
  });

  test('wakeMarker becomes "aborted" with a null waitingMessage', async () => {
    const stores = makeLeanDigestStores({ items: [abortRow(), targetRow()], collectionDocs: abortCollectionDocs() });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const target = loops.find(l => l.loopId === 'target-1');
    assert.strictEqual(target.wakeMarker, 'aborted');
    assert.strictEqual(target.waitingMessage, null);
  });

  test('runtime completedAt/ms are taken from the abort entry', async () => {
    const stores = makeLeanDigestStores({ items: [abortRow(), targetRow()], collectionDocs: abortCollectionDocs() });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const target = loops.find(l => l.loopId === 'target-1');
    assert.strictEqual(target.telemetry.runtime.completedAt, digestIso(HOUR + 900));
    assert.strictEqual(target.telemetry.runtime.ms, Date.parse(digestIso(HOUR + 900)) - Date.parse(digestIso(0)));
  });

  test('parkedWait becomes null on a harvested abort (omitted on the built loop, matching the non-lean omit-when-absent contract)', async () => {
    // LIN-3011 beat-4 fix: same correction as the "omitted vs null" test
    // above — `digest.parkedWait: null` correctly maps to the KEY BEING
    // OMITTED on `loop.telemetry`, never an explicit `null`, matching
    // `buildRunTelemetry`'s `if (parkedWait) telemetry.parkedWait = ...`
    // omit-when-absent convention exactly.
    const stores = makeLeanDigestStores({ items: [abortRow(), targetRow()], collectionDocs: abortCollectionDocs() });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const target = loops.find(l => l.loopId === 'target-1');
    assert.ok(!('parkedWait' in target.telemetry), 'a harvested abort clears any parked wait, and the key is omitted, not set to null');
  });

  test('crossCheck: the F1 millisecond-exact guard lets a 700ms-later abort win over a pre-abort duration tail', async () => {
    // The target's own digest already carries a genuine terminal at
    // HOUR+200ms ("[failed] ... in 3m"); the abort at HOUR+900ms is strictly
    // later, so F1 lets it win — the plan's sub-second reproduction.
    const stores = makeLeanDigestStores({
      items: [
        abortRow(),
        targetRow({ terminal: { status: 'failed', entry: { message: '[failed] ... in 3m', timestamp: digestIso(HOUR + 200) } } })
      ],
      collectionDocs: abortCollectionDocs()
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const target = loops.find(l => l.loopId === 'target-1');
    assert.strictEqual(target.terminalStatus, 'aborted', 'the later abort (700ms after) wins the millisecond-exact F1 guard');
    assert.strictEqual(target.terminalCompletedAt, digestIso(HOUR + 900));
  });

  test('decision fields are unaffected by the harvested abort', async () => {
    const decision = { decision_id: 'd-9', question: 'proceed?' };
    const stores = makeLeanDigestStores({
      items: [abortRow(), targetRow({ decision, decisionCase: ['case text'], answeredDecisionId: 'd-8' })],
      collectionDocs: abortCollectionDocs()
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const target = loops.find(l => l.loopId === 'target-1');
    assert.deepStrictEqual(target.decision, decision);
    assert.deepStrictEqual(target.decisionCase, ['case text']);
    assert.strictEqual(target.answeredDecisionId, 'd-8');
  });
});

describe('lineage metrics union + retention-safe toolPeak on the lean digest-backed build (LIN-3011)', () => {
  test("lineageMetrics is a time-ordered union of each row's retained metric list; lineageLastActivityMs is exact", async () => {
    const m1 = { timestamp: digestIso(0), total: 2 };
    const m2 = { timestamp: digestIso(30 * MIN), total: 4 };
    const items = [
      leanDigestItem({
        id: 'r-1', dispatchedAt: digestIso(0), feedbackVersion: 1,
        feedbackDigest: { version: 1, terminal: null, wake: null, decision: null, decisionCase: [], answeredDecisionId: null, parkedWait: null, telemetry: { runtime: {}, metrics: [m2], toolPeak: 4 } }
      }),
      leanDigestItem({
        id: 'r-2', dispatchedAt: digestIso(1000), feedbackVersion: 1, rootItemId: 'r-1',
        feedbackDigest: { version: 1, terminal: null, wake: null, decision: null, decisionCase: [], answeredDecisionId: null, parkedWait: null, telemetry: { runtime: {}, metrics: [m1], toolPeak: 2 } }
      })
    ];
    const stores = makeLeanDigestStores({ items, collectionDocs: [rawCollectionDoc({ _id: 'r-1' }), rawCollectionDoc({ _id: 'r-2' })] });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    const r1 = loops.find(l => l.loopId === 'r-1');
    assert.deepStrictEqual(r1.lineageMetrics.map(m => m.timestamp), [m1.timestamp, m2.timestamp], 'time-ordered union across the lineage, not fetch order');
    assert.strictEqual(r1.lineageLastActivityMs, Date.parse(m2.timestamp));
  });

  test('runs[].toolPeak is exact even when telemetry.metrics is retention-trimmed to the recent tail', async () => {
    // The digest's retained `metrics` deliberately does NOT include the peak
    // (it fell outside the 6h/last-6 retention window) — `toolPeak` must still
    // be exact because it is a SEPARATE, always-full-window digest field, not
    // a recompute over the (trimmed) metrics list.
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({
        feedbackVersion: 1,
        feedbackDigest: {
          version: 1, terminal: null, wake: null, decision: null, decisionCase: [], answeredDecisionId: null, parkedWait: null,
          telemetry: {
            runtime: {},
            metrics: [{ timestamp: digestIso(7 * HOUR), total: 2 }], // recent tail only, NOT the peak
            toolPeak: 50 // the true peak, from an early heartbeat retention dropped
          }
        }
      })],
      collectionDocs: [rawCollectionDoc({})]
    });
    const loops = await getLoopsForWorkspace('ws', { ...stores, lean: true });
    assert.strictEqual(loops[0].toolPeak, 50, "toolPeak reads the digest field directly, never recomputed from the (trimmed) metrics list");
  });
});

describe('getSessionsForIssues lean path inherits self-heal + digest-backed build (LIN-3011)', () => {
  test('a lean getSessionsForIssues call heals a stale digest and builds the session from it (materializer\'s only lean caller, observation-sessions-materializer.js:336)', async () => {
    const findCalls = [];
    const stores = makeLeanDigestStores({
      items: [leanDigestItem({ feedbackVersion: 0, feedbackDigest: null })],
      collectionDocs: [rawCollectionDoc({
        feedbackVersion: 0,
        feedback: [{ kind: 'status', message: '[done] finished in 5m', timestamp: new Date(digestIso(HOUR + 5 * MIN)) }]
      })],
      findSpy: (q, o) => findCalls.push({ q, o })
    });
    const sessions = await getSessionsForIssues('ws', stores, [ISSUE_A], { lean: true });
    assert.strictEqual(findCalls.length, 1, "getSessionsForIssues's lean read self-heals too");
    const loop = sessions.flatMap(s => s.loops).find(l => l.loopId === 'h-1');
    assert.ok(loop, 'the loop is present');
    assert.strictEqual(loop.terminalStatus, 'done');
  });
});

// ── LIN-2182 (H3): decision/decisionCase derivation ────────────────────────────
// `decision` is the most-recent parseable `kind:'decision'` entry in a loop's
// post-harvest feedback (backward scan, not `parseDecisions().at(-1)`);
// `decisionCase` is the maximal contiguous run of `kind:'assistant-text'`
// entries immediately preceding it. Both are always present (lean and
// non-lean) — `null`/`[]` when absent, never `undefined`.

function decisionMessage(payload) {
  return `[decision] ${JSON.stringify(payload)}`;
}

function decisionEntry(payload, timestamp) {
  return { kind: 'decision', message: decisionMessage(payload), timestamp };
}

function textEntry(text, timestamp) {
  return { kind: 'assistant-text', message: text, timestamp };
}

const FULL_DECISION_PAYLOAD = {
  decision_id: 'd-1',
  question: 'Proceed with the migration?',
  options: [
    { id: 'yes', label: 'Proceed' },
    { id: 'no', label: 'Hold', cost: 2 }
  ],
  recommended: 'yes',
  free_text: true,
  if_unanswered: { disposition: 'a', note: 'default to hold' }
};

describe('correlateDecisionCase (LIN-2182 / H3, pure helper)', () => {
  test('an assistant-text × N run immediately before the index yields exactly those N messages, in order', () => {
    const feedback = [textEntry('A'), textEntry('B'), textEntry('C'), decisionEntry(FULL_DECISION_PAYLOAD)];
    assert.deepStrictEqual(correlateDecisionCase(feedback, 3), ['A', 'B', 'C']);
  });

  test('an interruption (evidence/tool) between the text run and the decision truncates — text before the break is excluded', () => {
    const feedback = [
      textEntry('A'),
      textEntry('B'),
      { kind: 'evidence', message: '[evidence] PR opened' },
      textEntry('C'),
      decisionEntry(FULL_DECISION_PAYLOAD)
    ];
    assert.deepStrictEqual(correlateDecisionCase(feedback, 4), ['C']);
  });

  test('any unexpected kind in the gap truncates, not just evidence/tool — no enumerated blocklist', () => {
    const feedback = [
      textEntry('A'),
      { kind: 'heartbeat', message: '[working] 2 tools/5s' },
      textEntry('B'),
      decisionEntry(FULL_DECISION_PAYLOAD)
    ];
    assert.deepStrictEqual(correlateDecisionCase(feedback, 3), ['B']);
  });

  test('a break immediately before the decision degrades to []', () => {
    const feedback = [textEntry('A'), textEntry('B'), { kind: 'tool', message: 'Bash' }, decisionEntry(FULL_DECISION_PAYLOAD)];
    assert.deepStrictEqual(correlateDecisionCase(feedback, 3), []);
  });

  test('the decision as the very first entry yields []', () => {
    const feedback = [decisionEntry(FULL_DECISION_PAYLOAD)];
    assert.deepStrictEqual(correlateDecisionCase(feedback, 0), []);
  });

  test('non-array feedback and a non-integer index are tolerated, never throw', () => {
    assert.deepStrictEqual(correlateDecisionCase(undefined, 3), []);
    assert.deepStrictEqual(correlateDecisionCase([], -1), []);
    assert.deepStrictEqual(correlateDecisionCase([textEntry('A')], null), []);
  });
});

describe('_findLastDecision (LIN-2182 / H3, backward scan)', () => {
  test('a malformed decision entry (unparseable message) is skipped, scanning backwards to an earlier parseable one', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1' }),
      { kind: 'decision', message: '[decision] {"decision_id":"d-2", not-json' }
    ];
    const { decision, decisionEntryIndex } = _findLastDecision(feedback);
    assert.strictEqual(decision.decision_id, 'd-1');
    assert.strictEqual(decisionEntryIndex, 0);
  });

  test('a decision-shaped message on a non-decision kind is ignored entirely', () => {
    const feedback = [textEntry(decisionMessage({ decision_id: 'd-1' }))];
    assert.deepStrictEqual(_findLastDecision(feedback), { decision: null, decisionEntryIndex: -1 });
  });

  test('repeated decision_ids: returns the CHRONOLOGICALLY LAST entry, unlike parseDecisions().at(-1)', () => {
    // The exact research repro: d-1 first ask, d-2, then a re-ask of d-1 that is
    // chronologically last. parseDecisions() dedupes into a Map — last-wins
    // VALUE but first-appearance POSITION — so .at(-1) returns d-2, which is
    // wrong. The backward scan must return d-1's re-ask.
    const feedback = [
      decisionEntry({ decision_id: 'd-1', question: 'first ask' }, 't1'),
      decisionEntry({ decision_id: 'd-2', question: 'second ask' }, 't2'),
      decisionEntry({ decision_id: 'd-1', question: 're-ask of d-1 — chronologically last' }, 't3')
    ];

    // Prove the trap is real: .at(-1) on parseDecisions gives the WRONG entry.
    const wrongViaAtMinusOne = parseDecisions(feedback).at(-1);
    assert.strictEqual(wrongViaAtMinusOne.decision_id, 'd-2', 'sanity: this IS the trap the plan rejected');

    const { decision, decisionEntryIndex } = _findLastDecision(feedback);
    assert.strictEqual(decision.decision_id, 'd-1');
    assert.strictEqual(decision.question, 're-ask of d-1 — chronologically last');
    assert.strictEqual(decisionEntryIndex, 2);
  });

  test('no decision entries at all yields { decision: null, decisionEntryIndex: -1 }', () => {
    assert.deepStrictEqual(_findLastDecision([textEntry('A'), { kind: 'status', message: '[done]' }]), {
      decision: null,
      decisionEntryIndex: -1
    });
  });
});

describe('_buildLoops: decision/decisionCase derivation end-to-end (LIN-2182 / H3)', () => {
  test('producer envelope round-trip: a real S2-shaped [decision] message parses through to the loop', () => {
    const feedback = [textEntry('weighing the options', 't1'), decisionEntry(FULL_DECISION_PAYLOAD, 't2')];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.deepStrictEqual(loop.decision, FULL_DECISION_PAYLOAD);
    assert.deepStrictEqual(loop.decisionCase, ['weighing the options']);
  });

  // LIN-2182 review ledger 6: the round-trip above cannot demonstrate whitelisting,
  // because FULL_DECISION_PAYLOAD carries no field OUTSIDE parseDecision's allow-list
  // — an equal round-trip is what you would see either way. A wire payload that DOES
  // carry extraneous keys is the only fixture that can tell the two apart. The
  // allow-list itself is H2's (LIN-2181) and pinned there; this asserts that H3's
  // loop-level field inherits it rather than re-widening it.
  test('extraneous wire fields are stripped on the way onto the loop — top-level and per-option', () => {
    const wire = {
      ...FULL_DECISION_PAYLOAD,
      // Not in parseDecision's top-level allow-list.
      unexpected_top_level: 'should not survive',
      internal_cursor: { seq: 7 },
      options: [
        { id: 'yes', label: 'Proceed', unexpected_option_field: 'should not survive' },
        { id: 'no', label: 'Hold', cost: 2 }
      ]
    };
    const feedback = [textEntry('weighing the options', 't1'), decisionEntry(wire, 't2')];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];

    assert.ok(!('unexpected_top_level' in loop.decision), 'unknown top-level key stripped');
    assert.ok(!('internal_cursor' in loop.decision), 'unknown top-level object key stripped');
    assert.ok(!('unexpected_option_field' in loop.decision.options[0]), 'unknown per-option key stripped');
    assert.deepStrictEqual(loop.decision, FULL_DECISION_PAYLOAD, 'what survives is exactly the allow-listed shape');
  });

  test('if_unanswered is a deliberate passthrough, NOT allow-listed — recorded so the pin above is not read as wider than it is', () => {
    // `_parseIfUnanswered` spreads the object wholesale (`{ ...value }`), so keys
    // inside it are NOT filtered — unlike the top level and unlike options[].
    // LIN-1727 owns the `if_unanswered` enum; asserting the current behaviour here
    // means that ticket has a failing pin to update rather than a silent widening.
    const wire = {
      decision_id: 'd-1',
      if_unanswered: { disposition: 'a', note: 'default to hold', extra_inner_key: 'survives today' }
    };
    const feedback = [decisionEntry(wire, 't1')];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.deepStrictEqual(loop.decision.if_unanswered, wire.if_unanswered);
  });

  test('producer-gap pin (row 17, routed to LIN-2187): S2s own wire fixture with no decision_id derives decision: null', () => {
    // Real shipped producer output (test/decision-emission.test.js in simple-dispatcher):
    // schema-shaped `options[{id,label}]` + `decision_id` is NOT yet emitted, so every
    // real message parses to null today. H3 ships inert until LIN-2187 lands.
    const feedback = [
      textEntry('should we escalate?', 't1'),
      { kind: 'decision', message: '[decision] {"kind":"escalate","options":["A","B"]}', timestamp: 't2' }
    ];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.strictEqual(loop.decision, null);
    assert.deepStrictEqual(loop.decisionCase, []);
  });

  test('relay OFF (always ≥1 assistant-text): decisionCase carries the turn text', () => {
    // ASSISTANT_TEXT_RELAY OFF always posts at least one assistant-text (postTurnText,
    // including a synthetic EMPTY_RECAP_MARKER for an empty turn) — never a silent
    // omission (LIN-1291). This is the case where decisionCase is populated.
    const feedback = [textEntry('(no new output this turn)', 't1'), decisionEntry(FULL_DECISION_PAYLOAD, 't2')];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.deepStrictEqual(loop.decisionCase, ['(no new output this turn)']);
  });

  test('relay ON, empty delta (can post ZERO assistant-text): decisionCase degrades to [] — this is the degraded-not-OFF case', () => {
    // ASSISTANT_TEXT_RELAY ON can post nothing when the position-keyed dedup finds no
    // new blocks (postAssistantTextDelta's `if (!blocks.length) return;`). The ticket's
    // intuitive framing has this backwards — the empty case belongs to ON, not OFF.
    const feedback = [decisionEntry(FULL_DECISION_PAYLOAD, 't1'), { kind: 'status', message: '[blocked]', timestamp: 't2' }];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.strictEqual(loop.decision.decision_id, 'd-1');
    assert.deepStrictEqual(loop.decisionCase, []);
  });

  test('lean/non-lean parity: decision and decisionCase are identical, and present on the lean loop even though feedback is []', () => {
    const feedback = [textEntry('A', 't1'), textEntry('B', 't2'), decisionEntry(FULL_DECISION_PAYLOAD, 't3')];
    const hist = historyItem({ feedback });
    const full = _buildLoops({ historyItems: [hist], now: NOW })[0];
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true })[0];
    assert.deepStrictEqual(lean.decision, full.decision);
    assert.deepStrictEqual(lean.decisionCase, full.decisionCase);
    assert.deepStrictEqual(lean.decisionCase, ['A', 'B']);
    assert.deepStrictEqual(lean.feedback, [], 'lean loop still drops raw feedback');
  });

  test('empty shapes: no decision anywhere yields decision: null and decisionCase: [], never undefined', () => {
    const feedback = [textEntry('A', 't1'), { kind: 'status', message: '[done]', timestamp: 't2' }];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.strictEqual(loop.decision, null);
    assert.deepStrictEqual(loop.decisionCase, []);
    assert.ok('decision' in loop && 'decisionCase' in loop, 'both keys must be present, not omitted');

    const lean = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW, lean: true })[0];
    assert.strictEqual(lean.decision, null);
    assert.deepStrictEqual(lean.decisionCase, []);
    assert.ok('decision' in lean && 'decisionCase' in lean, 'lean loop must carry both keys too, per !== undefined discriminators');
  });

  // ── Table-driven matrix: homogeneous feedback[]-kind fixtures ──────────────
  const MATRIX = [
    {
      name: 'blocked, short turn: one assistant-text then decision',
      feedback: [textEntry('turn text', 't1'), decisionEntry({ decision_id: 'd-1' }, 't2'), { kind: 'status', message: '[blocked]', timestamp: 't3' }],
      decision: { decision_id: 'd-1' },
      decisionCase: ['turn text']
    },
    {
      name: 'chunked turn: two assistant-text entries then decision',
      feedback: [
        textEntry('(recap 1/2) first half', 't1'),
        textEntry('(recap 2/2) second half', 't2'),
        decisionEntry({ decision_id: 'd-1' }, 't3'),
        { kind: 'status', message: '[blocked]', timestamp: 't4' }
      ],
      decision: { decision_id: 'd-1' },
      decisionCase: ['(recap 1/2) first half', '(recap 2/2) second half']
    },
    {
      name: 'multi-block delta: three assistant-text entries then decision',
      feedback: [textEntry('A', 't1'), textEntry('B', 't2'), textEntry('C', 't3'), decisionEntry({ decision_id: 'd-1' }, 't4')],
      decision: { decision_id: 'd-1' },
      decisionCase: ['A', 'B', 'C']
    },
    {
      name: 'complete run with evidence + tool after the decision — those do not affect decisionCase',
      feedback: [
        textEntry('A', 't1'),
        decisionEntry({ decision_id: 'd-1' }, 't2'),
        { kind: 'evidence', message: '[evidence] PR', timestamp: 't3' },
        { kind: 'status', message: '[done]', timestamp: 't4' }
      ],
      decision: { decision_id: 'd-1' },
      decisionCase: ['A']
    },
    {
      name: 'decision is first entry',
      feedback: [decisionEntry({ decision_id: 'd-1' }, 't1'), { kind: 'status', message: '[blocked]', timestamp: 't2' }],
      decision: { decision_id: 'd-1' },
      decisionCase: []
    },
    {
      name: 'no decision at all',
      feedback: [textEntry('A', 't1'), { kind: 'status', message: '[done]', timestamp: 't2' }],
      decision: null,
      decisionCase: []
    },
    {
      name: 'two decisions, distinct ids — takes the later one and its own preceding run',
      feedback: [
        textEntry('A', 't1'),
        decisionEntry({ decision_id: 'd-1' }, 't2'),
        textEntry('B', 't3'),
        decisionEntry({ decision_id: 'd-2' }, 't4'),
        { kind: 'status', message: '[blocked]', timestamp: 't5' }
      ],
      decision: { decision_id: 'd-2' },
      decisionCase: ['B']
    },
    {
      name: 'a live heartbeat race (concurrent reaper writer) breaks the run',
      feedback: [textEntry('A', 't1'), { kind: 'heartbeat', message: '[working] 1 tools/1s', timestamp: 't2' }, decisionEntry({ decision_id: 'd-1' }, 't3')],
      decision: { decision_id: 'd-1' },
      decisionCase: []
    },
    // ── LIN-2182 review ledger 5 ────────────────────────────────────────────
    // Plan rows 13, 14 and 6 were asserted at helper level only (_findLastDecision
    // for 13/14, a near-variant for 6); their plan-specified `decisionCase` values
    // were never asserted through `_buildLoops`. Helper-level coverage cannot see a
    // wiring regression between the backward scan and the correlation call, which is
    // precisely the seam these rows exercise — so they belong in the matrix too.
    {
      // Plan row 13. `parseDecision` collapses a same-id re-post LAST-wins; the
      // backward scan must agree with that AND correlate against the re-ask's OWN
      // preceding run (['B']), not the first ask's (['A']).
      name: 'two decisions, SAME id (a re-post): last-wins value, and the case is the re-ask own run',
      feedback: [
        textEntry('A', 't1'),
        decisionEntry({ decision_id: 'd-1', question: 'first ask' }, 't2'),
        textEntry('B', 't3'),
        decisionEntry({ decision_id: 'd-1', question: 're-ask, supersedes' }, 't4'),
        { kind: 'status', message: '[blocked]', timestamp: 't5' }
      ],
      decision: { decision_id: 'd-1', question: 're-ask, supersedes' },
      decisionCase: ['B']
    },
    {
      // Plan row 14. The LAST decision entry is unparseable; the scan must fall back
      // to the last PARSEABLE one and correlate against THAT index — ['A'], not ['B'].
      // Getting the index wrong here yields a plausible-but-wrong case rather than a
      // crash, which is why it needs an end-to-end assertion and not just the helper.
      name: 'a malformed decision AFTER a good one: falls back to the good one and to ITS preceding run',
      feedback: [
        textEntry('A', 't1'),
        decisionEntry({ decision_id: 'd-1' }, 't2'),
        textEntry('B', 't3'),
        { kind: 'decision', message: '[decision] {"decision_id":"d-2", not-json', timestamp: 't4' },
        { kind: 'status', message: '[blocked]', timestamp: 't5' }
      ],
      decision: { decision_id: 'd-1' },
      decisionCase: ['A']
    },
    {
      // Plan row 6: relay ON, complete run, with tool/usage/evidence entries trailing
      // the decision. Everything AFTER the decision index is irrelevant by
      // construction (the scan walks backwards from it) — this pins that.
      name: 'complete run, relays ON: tool/usage/evidence AFTER the decision leave a two-block case intact',
      feedback: [
        textEntry('A', 't1'),
        textEntry('B', 't2'),
        decisionEntry({ decision_id: 'd-1' }, 't3'),
        { kind: 'tool', message: 'Bash', timestamp: 't4' },
        { kind: 'usage', message: '[usage] 1200 in / 340 out', timestamp: 't5' },
        { kind: 'evidence', message: '[evidence] PR opened', timestamp: 't6' },
        { kind: 'status', message: '[done]', timestamp: 't7' }
      ],
      decision: { decision_id: 'd-1' },
      decisionCase: ['A', 'B']
    }
  ];

  for (const row of MATRIX) {
    test(`matrix: ${row.name}`, () => {
      const hist = historyItem({ feedback: row.feedback });
      const full = _buildLoops({ historyItems: [hist], now: NOW })[0];
      const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true })[0];
      for (const [label, loop] of [['default', full], ['lean', lean]]) {
        assert.deepStrictEqual(loop.decision, row.decision, `${label}: decision`);
        assert.deepStrictEqual(loop.decisionCase, row.decisionCase, `${label}: decisionCase`);
      }
    });
  }
});

// ── LIN-2182 review ledger 1: the heartbeat exclusion is LIVE-affecting ────────
// H3 ships inert for `decision` (no shipped producer emits a `decision_id` until
// LIN-2187, pinned by the producer-gap row above) — but the `parseHeartbeats`
// exclusion is NOT inert. S2/LIN-2186 is merged, so `kind:'decision'` entries
// exist in live data today; they simply fail `parseDecision`. Any such entry whose
// PROSE matches HEARTBEAT_HINT minted a phantom beat carrying the decision entry's
// timestamp, and `parseHeartbeats` feeds three consumers. The PR pinned only the
// first (`buildRunTelemetry().metrics`, tests/unit/session-telemetry.test.js). The
// other two are activity clocks, and a phantom moved BOTH:
//
//   loop.telemetry.metrics  → loopLastActivityMs → isFreshlyActive  (lib/live-console.js)
//   loop.lineageLastActivityMs → loopActivityMs  → merged-feed sort (routes/dashboard.js)
//
// `lineageLastActivityMs` is the ONLY parseHeartbeats-derived input to
// routes/dashboard.js's `loopActivityMs` (its other inputs are
// completedAt/agentTimestamp/resolvedAt/dispatchedAt), so pinning it here pins that
// consumer's exposure at the source; the user-reachable effect — a session rescued
// from stale by nothing but decision prose — is pinned end-to-end at route level in
// tests/unit/dashboard-routes.test.js.
describe('_buildLoops: decision prose does not float the activity clock (LIN-2182 ledger 1)', () => {
  const REAL_BEAT_TS = '2026-04-10T10:05:00.000Z';   // ~26h before NOW
  const LATE_TS = '2026-04-11T11:55:00.000Z';        // 5 min before NOW
  const STALE_MS = 60 * 60 * 1000;                   // 1h, DEFAULT_LANE_STALE_MS
  // Reproduced live during LIN-2182 research: this question mints { toolCount: 3 }.
  const HEARTBEAT_SHAPED_QUESTION = 'batch 3 tools in one turn, or keep them serial?';

  function loopWithLateEntry(lateEntry) {
    const feedback = [
      { kind: 'heartbeat', message: '[working] 2 tools in 4s', timestamp: REAL_BEAT_TS },
      textEntry('weighing it up', '2026-04-11T11:54:00.000Z'),
      lateEntry,
      { kind: 'status', message: '[blocked] awaiting a ruling', timestamp: LATE_TS }
    ];
    return _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
  }

  const lateDecision = () =>
    decisionEntry({ decision_id: 'd-1', question: HEARTBEAT_SHAPED_QUESTION }, LATE_TS);

  test('sanity: the prose IS heartbeat-shaped in isolation — only the kind exclusion keeps it out', () => {
    // Without this, every assertion below would pass vacuously against prose that
    // never matched HEARTBEAT_HINT in the first place.
    const phantom = parseHeartbeat(HEARTBEAT_SHAPED_QUESTION, LATE_TS);
    assert.ok(phantom, 'the question parses as a heartbeat when kind is not consulted');
    assert.strictEqual(phantom.toolCount, 3);
    assert.strictEqual(phantom.timestamp, LATE_TS, 'and it carries the entry timestamp — this is what moved the clock');
  });

  test('the phantom reaches neither telemetry.metrics nor lineageLastActivityMs', () => {
    const loop = loopWithLateEntry(lateDecision());
    assert.strictEqual(loop.telemetry.metrics.length, 1, 'only the genuine beat');
    assert.strictEqual(loop.telemetry.metrics[0].timestamp, REAL_BEAT_TS);
    assert.strictEqual(loop.lineageLastActivityMs, Date.parse(REAL_BEAT_TS),
      'the lineage clock — routes/dashboard.js loopActivityMs sole heartbeat-derived input — stays at the real beat');
    assert.ok(loop.decision, 'and the decision itself still derives — the exclusion is scoped to heartbeat parsing');
  });

  test('live-console: loopLastActivityMs stays at the real beat, so a blocked run is not classified freshly-active', () => {
    const loop = loopWithLateEntry(lateDecision());
    assert.ok(isLoopActive(loop), 'precondition: the loop is active, so isFreshlyActive turns purely on the clock');
    assert.strictEqual(loopLastActivityMs(loop), Date.parse(REAL_BEAT_TS));
    assert.strictEqual(isFreshlyActive(loop, NOW.getTime(), STALE_MS), false,
      'a run blocked awaiting a human must not read as freshly active on the strength of its own question');
  });

  test('negative control: a GENUINE beat at the same late timestamp does move both clocks', () => {
    // Isolates the exclusion (skips kind:'decision') from a hardcoded pass (nothing
    // late ever counts). Same timestamp, same prose — only `kind` differs.
    const loop = loopWithLateEntry({ kind: 'heartbeat', message: '[working] 3 tools in 9s', timestamp: LATE_TS });
    assert.strictEqual(loop.lineageLastActivityMs, Date.parse(LATE_TS));
    assert.strictEqual(loopLastActivityMs(loop), Date.parse(LATE_TS));
    assert.strictEqual(isFreshlyActive(loop, NOW.getTime(), STALE_MS), true);
  });
});

// ── LIN-1728: answeredDecisionId derivation ────────────────────────────────
function answerEntry(decisionId, timestamp) {
  return { kind: 'decision-answer', message: JSON.stringify({ decision_id: decisionId }), timestamp };
}

describe('isDecisionAnswerEntry (LIN-1728)', () => {
  test('true only for kind: "decision-answer"', () => {
    assert.strictEqual(isDecisionAnswerEntry({ kind: 'decision-answer' }), true);
    assert.strictEqual(isDecisionAnswerEntry({ kind: 'decision' }), false);
    assert.strictEqual(isDecisionAnswerEntry({ kind: 'status' }), false);
    assert.strictEqual(isDecisionAnswerEntry(undefined), false);
    assert.strictEqual(isDecisionAnswerEntry(null), false);
  });
});

describe('_findDecisionAnswer (LIN-1728, backward scan)', () => {
  test('returns the decision_id of the last decision-answer entry', () => {
    const feedback = [answerEntry('d-1', 't1'), answerEntry('d-2', 't2')];
    assert.strictEqual(_findDecisionAnswer(feedback), 'd-2');
  });

  test('a malformed answer entry is skipped, scanning backwards to an earlier valid one', () => {
    const feedback = [answerEntry('d-1', 't1'), { kind: 'decision-answer', message: 'not-json', timestamp: 't2' }];
    assert.strictEqual(_findDecisionAnswer(feedback), 'd-1');
  });

  test('no decision-answer entries at all yields null', () => {
    assert.strictEqual(_findDecisionAnswer([textEntry('A'), { kind: 'status', message: '[done]' }]), null);
  });

  test('non-array feedback is tolerated, never throws', () => {
    assert.strictEqual(_findDecisionAnswer(undefined), null);
  });

  // LIN-2225: a dismiss stamp is the SAME 'decision-answer' kind with an
  // additive `outcome: 'dismissed'` field (lib/dispatch-store.js). This
  // module's job — "was this decision_id resolved at all" — must not care
  // which outcome resolved it, so a dismissed decision clears the unanswered
  // queue exactly like an answered one.
  test('a dismiss-tagged entry ({decision_id, outcome:"dismissed"}) still resolves the decision_id', () => {
    const feedback = [{ kind: 'decision-answer', message: JSON.stringify({ decision_id: 'd-1', outcome: 'dismissed' }), timestamp: 't1' }];
    assert.strictEqual(_findDecisionAnswer(feedback), 'd-1');
  });
});

// LIN-1736: the loop-backed half of the escalation KPIs' time-to-response and
// false-escalation inputs — every RESOLVED decision in a loop's feedback,
// paired with when it was raised and how it was resolved.
describe('resolvedDecisionEvents (LIN-1736)', () => {
  test('null/non-array feedback yields []', () => {
    assert.deepStrictEqual(resolvedDecisionEvents(undefined), []);
    assert.deepStrictEqual(resolvedDecisionEvents(null), []);
  });

  test('a decision with no matching stamp is excluded (still-unanswered is not this function\'s question)', () => {
    const feedback = [decisionEntry({ decision_id: 'd-1', question: 'q?' }, 't1')];
    assert.deepStrictEqual(resolvedDecisionEvents(feedback), []);
  });

  test('a resolved decision pairs raisedAt (the decision entry) with resolvedAt (the stamp), outcome "answered" when the stamp carries no outcome field', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1', question: 'q?' }, 't1'),
      answerEntry('d-1', 't2'),
    ];
    assert.deepStrictEqual(resolvedDecisionEvents(feedback), [
      { decisionId: 'd-1', raisedAt: 't1', resolvedAt: 't2', outcome: 'answered' },
    ]);
  });

  test('outcome "dismissed" is read off the stamp\'s own outcome field (LIN-2225)', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1', question: 'q?' }, 't1'),
      { kind: 'decision-answer', message: JSON.stringify({ decision_id: 'd-1', outcome: 'dismissed' }), timestamp: 't2' },
    ];
    assert.deepStrictEqual(resolvedDecisionEvents(feedback), [
      { decisionId: 'd-1', raisedAt: 't1', resolvedAt: 't2', outcome: 'dismissed' },
    ]);
  });

  test('multiple distinct decisions in one loop each resolve independently', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1', question: 'first?' }, 't1'),
      answerEntry('d-1', 't2'),
      decisionEntry({ decision_id: 'd-2', question: 'second?' }, 't3'),
      answerEntry('d-2', 't4'),
    ];
    assert.deepStrictEqual(resolvedDecisionEvents(feedback), [
      { decisionId: 'd-1', raisedAt: 't1', resolvedAt: 't2', outcome: 'answered' },
      { decisionId: 'd-2', raisedAt: 't3', resolvedAt: 't4', outcome: 'answered' },
    ]);
  });

  test('FIRST occurrence wins on both sides — a dedup-retry double-stamp (LIN-2208) does not shift the resolution instant, and a re-raised decision_id keeps its ORIGINAL raisedAt', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1', question: 'q?' }, 't1'),
      decisionEntry({ decision_id: 'd-1', question: 'q? (re-asked)' }, 't1b'),
      answerEntry('d-1', 't2'),
      answerEntry('d-1', 't2b'), // a redundant re-stamp of the same decision_id
    ];
    assert.deepStrictEqual(resolvedDecisionEvents(feedback), [
      { decisionId: 'd-1', raisedAt: 't1', resolvedAt: 't2', outcome: 'answered' },
    ]);
  });

  test('a malformed stamp is skipped, not thrown', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1', question: 'q?' }, 't1'),
      { kind: 'decision-answer', message: 'not-json', timestamp: 't2' },
    ];
    assert.deepStrictEqual(resolvedDecisionEvents(feedback), []);
  });

  test('a decision entry with no decision_id (unparseable) is tolerated — the answer, if any, still resolves with raisedAt: null', () => {
    const feedback = [
      { kind: 'decision', message: '[decision] not-json', timestamp: 't1' },
      answerEntry('d-1', 't2'),
    ];
    assert.deepStrictEqual(resolvedDecisionEvents(feedback), [
      { decisionId: 'd-1', raisedAt: null, resolvedAt: 't2', outcome: 'answered' },
    ]);
  });
});

// LIN-1736: the unanswered-age half — companion to resolvedDecisionEvents,
// for a decision that has NOT been resolved.
describe('firstRaisedAt (LIN-1736)', () => {
  test('null/non-array feedback, or no decisionId, yields null', () => {
    assert.strictEqual(firstRaisedAt(undefined, 'd-1'), null);
    assert.strictEqual(firstRaisedAt([], null), null);
  });

  test('returns the timestamp of the matching decision entry', () => {
    const feedback = [decisionEntry({ decision_id: 'd-1', question: 'q?' }, 't1')];
    assert.strictEqual(firstRaisedAt(feedback, 'd-1'), 't1');
  });

  test('a decision_id never raised in this feedback yields null', () => {
    const feedback = [decisionEntry({ decision_id: 'd-1', question: 'q?' }, 't1')];
    assert.strictEqual(firstRaisedAt(feedback, 'd-2'), null);
  });

  test('FIRST occurrence wins — a re-raised decision_id keeps its original raisedAt', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1', question: 'first ask' }, 't1'),
      decisionEntry({ decision_id: 'd-1', question: 're-ask' }, 't2'),
    ];
    assert.strictEqual(firstRaisedAt(feedback, 'd-1'), 't1');
  });
});

describe('_buildLoops: answeredDecisionId derivation end-to-end (LIN-1728)', () => {
  test('a loop with no decision-answer stamp derives answeredDecisionId: null', () => {
    const feedback = [decisionEntry(FULL_DECISION_PAYLOAD, 't1')];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.strictEqual(loop.answeredDecisionId, null);
    assert.ok('answeredDecisionId' in loop, 'key must be present, never omitted');
  });

  test('a stamped answer matching the current decision derives answeredDecisionId equal to it', () => {
    const feedback = [decisionEntry(FULL_DECISION_PAYLOAD, 't1'), answerEntry('d-1', 't2')];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.strictEqual(loop.answeredDecisionId, 'd-1');
  });

  test('a newer decision after an old answer: answeredDecisionId still names the OLD answered id, distinct from the new decision', () => {
    const feedback = [
      decisionEntry({ decision_id: 'd-1' }, 't1'),
      answerEntry('d-1', 't2'),
      decisionEntry({ decision_id: 'd-2' }, 't3')
    ];
    const loop = _buildLoops({ historyItems: [historyItem({ feedback })], now: NOW })[0];
    assert.strictEqual(loop.decision.decision_id, 'd-2', 'the current decision is the newer, unanswered one');
    assert.strictEqual(loop.answeredDecisionId, 'd-1', 'the answer stamp still names the old id — this loop is unanswered for d-2');
  });

  test('lean/non-lean parity: answeredDecisionId is identical and present on the lean loop even though feedback is []', () => {
    const feedback = [decisionEntry(FULL_DECISION_PAYLOAD, 't1'), answerEntry('d-1', 't2')];
    const hist = historyItem({ feedback });
    const full = _buildLoops({ historyItems: [hist], now: NOW })[0];
    const lean = _buildLoops({ historyItems: [hist], now: NOW, lean: true })[0];
    assert.strictEqual(lean.answeredDecisionId, full.answeredDecisionId);
    assert.strictEqual(lean.answeredDecisionId, 'd-1');
  });
});
