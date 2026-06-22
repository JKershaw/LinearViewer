/**
 * Unit tests for lib/session-summary.js (LIN-592).
 *
 * Run with: node --test tests/unit/session-summary.test.js
 *
 * Covers the pure surface: anchor/child loop identification, context formatting
 * (cached child outcomes vs. fallback excerpt), and the tolerant response parser.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  findAnchorLoop,
  childLoops,
  formatSessionContext,
  parseSessionSummaryResponse,
  buildSessionSummaryMessages
} from '../../lib/session-summary.js';

function makeSession() {
  return {
    sessionId: 'sess-1',
    seedIssue: 'LIN-100',
    tasksTouched: ['LIN-100', 'LIN-101'],
    dispatchedAt: '2026-06-22T10:00:00.000Z',
    loops: [
      { loopId: 'sess-1', kind: 'autopilot', issueIdentifier: 'LIN-100', agentSummary: 'Orchestrated the epic descent', feedback: [] },
      { loopId: 'w-1', kind: null, sessionId: 'sess-1', issueIdentifier: 'LIN-101', stage: 'implementation', agentSummary: 'Shipped the fix', feedback: [] }
    ]
  };
}

describe('findAnchorLoop / childLoops', () => {
  test('anchor is the kind:autopilot loop whose loopId === sessionId', () => {
    const s = makeSession();
    const anchor = findAnchorLoop(s);
    assert.equal(anchor.loopId, 'sess-1');
    const children = childLoops(s);
    assert.equal(children.length, 1);
    assert.equal(children[0].loopId, 'w-1');
  });

  test('anchorless session has no anchor and all loops are children', () => {
    const s = { sessionId: 'orphan', tasksTouched: ['LIN-9'], loops: [{ loopId: 'w-9', kind: null, sessionId: 'orphan', issueIdentifier: 'LIN-9', feedback: [] }] };
    assert.equal(findAnchorLoop(s), null);
    assert.equal(childLoops(s).length, 1);
  });
});

describe('formatSessionContext', () => {
  test('includes tasks, orchestrator narration, and cached child outcomes', () => {
    const s = makeSession();
    const ctx = formatSessionContext(s, { 'w-1': 'Fixed the auth bug and opened a PR' });
    assert.match(ctx, /Session: sess-1/);
    assert.match(ctx, /Tasks touched \(2\): LIN-100, LIN-101/);
    assert.match(ctx, /Orchestrated the epic descent/);
    assert.match(ctx, /LIN-101 @ implementation: Fixed the auth bug/);
  });

  test('falls back to a run-context excerpt when a child outcome is not cached', () => {
    const s = makeSession();
    const ctx = formatSessionContext(s, {}); // no cached outcomes
    // The child line should still be present, sourced from formatRunContext.
    assert.match(ctx, /LIN-101 @ implementation:/);
    assert.match(ctx, /Shipped the fix/);
  });

  test('handles a null/empty session gracefully', () => {
    assert.equal(formatSessionContext(null), 'No session data available.');
  });
});

describe('buildSessionSummaryMessages', () => {
  test('produces a system + user message pair', () => {
    const msgs = buildSessionSummaryMessages(makeSession(), {});
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[1].role, 'user');
    assert.match(msgs[1].content, /sess-1/);
  });
});

describe('parseSessionSummaryResponse', () => {
  test('parses a clean JSON object', () => {
    const r = parseSessionSummaryResponse(JSON.stringify({
      outcome: 'Completed the auth refactor across two tasks',
      statusLine: 'Wrapping up the auth refactor',
      highlights: ['Refactored token store', 'Opened 2 PRs']
    }));
    assert.equal(r.outcome, 'Completed the auth refactor across two tasks');
    assert.equal(r.statusLine, 'Wrapping up the auth refactor');
    assert.deepEqual(r.highlights, ['Refactored token store', 'Opened 2 PRs']);
  });

  test('tolerates code fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n{"outcome":"x","statusLine":"y","highlights":["z"]}\n```\nthanks';
    const r = parseSessionSummaryResponse(raw);
    assert.equal(r.outcome, 'x');
    assert.equal(r.statusLine, 'y');
    assert.deepEqual(r.highlights, ['z']);
  });

  test('caps highlights at 4 and drops non-strings', () => {
    const r = parseSessionSummaryResponse(JSON.stringify({
      outcome: 'o', statusLine: 's', highlights: ['a', 'b', 'c', 'd', 'e', 5, null]
    }));
    assert.equal(r.highlights.length, 4);
  });

  test('returns an empty summary for garbage input', () => {
    const r = parseSessionSummaryResponse('not json at all');
    assert.deepEqual(r, { outcome: '', statusLine: '', highlights: [] });
  });

  test('returns an empty summary for null', () => {
    assert.deepEqual(parseSessionSummaryResponse(null), { outcome: '', statusLine: '', highlights: [] });
  });
});
