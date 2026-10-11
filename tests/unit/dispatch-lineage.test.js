/**
 * Unit tests for lib/dispatch-lineage.js (LIN-2388): the dual-shape feedback
 * readers and `groupDispatchLineages`, moved here from kpi-stats.test.js
 * alongside the code they cover. Behaviour is unchanged by the move.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { harnessOf, usageOf, evidenceCountOf, ticketMarkerEntriesOf, groupDispatchLineages } from '../../lib/dispatch-lineage.js';
import { computeTerminalMarkedTaskCost } from '../../lib/terminal-marked-task-cost.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');
function daysAgo(n) {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

// The LIN-1957 dual-shape readers for the terminal-marked-task-cost numerator
// (Session 1 of LIN-1625) — exact siblings of feedbackLen/terminalFeedbackOf
// above, exported (like categorizeProxyEvent) for direct coverage ahead of
// their beat 3/4 consumer, which doesn't exist yet.
describe('harnessOf/usageOf/evidenceCountOf (LIN-1957)', () => {
  test('harnessOf reads the raw field on either shape, null when absent/non-string', () => {
    assert.strictEqual(harnessOf({ harness: 'claude-code' }), 'claude-code');
    assert.strictEqual(harnessOf({ harness: 'opencode', feedback: [] }), 'opencode');
    assert.strictEqual(harnessOf({}), null);
    assert.strictEqual(harnessOf({ harness: null }), null);
  });

  test('usageOf takes the LAST kind:usage entry on the find-path feedback[] shape', () => {
    const doc = {
      feedback: [
        { kind: 'usage', message: '[usage] {"costUsd":1}' },
        { kind: 'heartbeat', message: 'still going' },
        { kind: 'usage', message: '[usage] {"costUsd":2}' }
      ]
    };
    assert.deepStrictEqual(usageOf(doc), { kind: 'usage', message: '[usage] {"costUsd":2}' });
  });

  test('usageOf returns null when no feedback entry carries kind:usage', () => {
    assert.strictEqual(usageOf({ feedback: [{ kind: 'heartbeat', message: 'still going' }] }), null);
    assert.strictEqual(usageOf({ feedback: [] }), null);
  });

  test('usageOf reads the pre-derived usageEntry on the aggregation-path shape', () => {
    const entry = { message: '[usage] {}', timestamp: daysAgo(1).toISOString(), kind: 'usage' };
    assert.deepStrictEqual(usageOf({ usageEntry: entry }), entry);
    assert.strictEqual(usageOf({ usageEntry: null }), null);
    assert.strictEqual(usageOf({}), null);
  });

  test('evidenceCountOf counts kind:evidence entries on the find-path shape', () => {
    const doc = {
      feedback: [
        { kind: 'evidence', message: 'link A' },
        { kind: 'usage', message: '[usage] {}' },
        { kind: 'evidence', message: 'link B' }
      ]
    };
    assert.strictEqual(evidenceCountOf(doc), 2);
    assert.strictEqual(evidenceCountOf({ feedback: [] }), 0);
  });

  test('evidenceCountOf reads the pre-derived evidenceCount on the aggregation-path shape', () => {
    assert.strictEqual(evidenceCountOf({ evidenceCount: 3 }), 3);
    assert.strictEqual(evidenceCountOf({}), 0);
    assert.strictEqual(evidenceCountOf({ evidenceCount: null }), 0);
  });

  test('both load paths agree for equivalent underlying data', () => {
    const raw = { feedback: [
      { kind: 'usage', message: '[usage] {}', timestamp: daysAgo(1).toISOString() },
      { kind: 'evidence', message: 'link A' },
      { kind: 'evidence', message: 'link B' }
    ] };
    const aggregated = {
      usageEntry: { message: '[usage] {}', timestamp: daysAgo(1).toISOString(), kind: 'usage' },
      evidenceCount: 2
    };
    assert.deepStrictEqual(usageOf(raw), usageOf(aggregated));
    assert.strictEqual(evidenceCountOf(raw), evidenceCountOf(aggregated));
  });
});

describe('groupDispatchLineages (LIN-1957) — the shared extraction', () => {
  const usageMarker = (costUsd, days) => ({
    kind: 'usage', message: `[usage] {"costUsd":${costUsd}}`,
    timestamp: new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  });

  test('harness is captured ONCE from the earliest row only — a later follow-up with a DIFFERENT harness must not change it', () => {
    // 'orig' dispatched 6 days ago (earlier); 'fu' is a follow-up dispatched
    // 5 days ago (later, more recent) carrying a DIFFERENT harness. The
    // approved-plan semantics (beat 2 decision (a)): the lineage's harness is
    // whatever the earliest row carried, permanently.
    const rows = [
      { _id: 'orig', rootItemId: 'orig', harness: 'claude-code', status: 'taken', dispatchedAt: daysAgo(6), feedback: [] },
      { _id: 'fu', rootItemId: 'orig', followUpTo: 'orig', harness: 'opencode', status: 'taken', dispatchedAt: daysAgo(5), feedback: [] }
    ];
    const lineages = groupDispatchLineages(rows);
    assert.strictEqual(lineages.get('orig').harness, 'claude-code');
  });

  test('earliest-row-only capture is order-independent — the same result whichever row is processed first', () => {
    const rows = [
      { _id: 'orig', rootItemId: 'orig', harness: 'claude-code', status: 'taken', dispatchedAt: daysAgo(6), feedback: [] },
      { _id: 'fu', rootItemId: 'orig', followUpTo: 'orig', harness: 'opencode', status: 'taken', dispatchedAt: daysAgo(5), feedback: [] }
    ];
    const forward = groupDispatchLineages(rows);
    const reversed = groupDispatchLineages([...rows].reverse());
    assert.strictEqual(forward.get('orig').harness, 'claude-code');
    assert.strictEqual(reversed.get('orig').harness, 'claude-code');
  });

  test('issueIdentifier is captured from the same earliest row as harness', () => {
    const rows = [
      { _id: 'orig', rootItemId: 'orig', issueIdentifier: 'LIN-1', status: 'taken', dispatchedAt: daysAgo(6), feedback: [] },
      { _id: 'fu', rootItemId: 'orig', followUpTo: 'orig', issueIdentifier: 'LIN-2', status: 'taken', dispatchedAt: daysAgo(5), feedback: [] }
    ];
    const lineages = groupDispatchLineages(rows);
    assert.strictEqual(lineages.get('orig').issueIdentifier, 'LIN-1');
  });

  test('F2 (LIN-1957 review, Request Changes, expected-red): issueIdentifier must be captured from ANY row carrying one, not just the earliest — while harness stays earliest-row-only', () => {
    // Approved plan, Surface 2: "issueIdentifier — set from any row carrying
    // one." Unlike the pinned test above (which documents today's coupled,
    // buggy behavior), this asserts the plan's actual requirement: a
    // null-identifier earliest row must not blank out a later row's
    // identifier. harness is a SEPARATE field captured the same two places
    // today (beat 2 decision (a), explicitly kept as earliest-row-only) — the
    // fix must decouple the two, not take harness with it.
    const rows = [
      { _id: 'orig', rootItemId: 'orig', harness: 'claude-code', status: 'taken', dispatchedAt: daysAgo(6), feedback: [] }, // earliest row: no issueIdentifier
      { _id: 'fu', rootItemId: 'orig', followUpTo: 'orig', issueIdentifier: 'LIN-100', harness: 'opencode', status: 'taken', dispatchedAt: daysAgo(5), feedback: [] }
    ];
    const lineages = groupDispatchLineages(rows);
    assert.strictEqual(lineages.get('orig').issueIdentifier, 'LIN-100', 'plan: "issueIdentifier — set from any row carrying one"');
    assert.strictEqual(lineages.get('orig').harness, 'claude-code', 'harness must stay earliest-row-only — the fix must not decouple this pin too');
  });

  test('rowUsage collects each contributing row\'s own usage entry, rows with none omitted', () => {
    const rows = [
      { _id: 'orig', rootItemId: 'orig', status: 'taken', dispatchedAt: daysAgo(3), feedback: [usageMarker(1, 3)] },
      { _id: 'mid', rootItemId: 'orig', followUpTo: 'orig', status: 'taken', dispatchedAt: daysAgo(2), feedback: [] }, // no usage entry
      { _id: 'fu', rootItemId: 'orig', followUpTo: 'orig', status: 'taken', dispatchedAt: daysAgo(1), feedback: [usageMarker(2, 1)] }
    ];
    const lineages = groupDispatchLineages(rows);
    const rowUsage = lineages.get('orig').rowUsage;
    assert.strictEqual(rowUsage.length, 2);
    assert.strictEqual(rowUsage[0].message, '[usage] {"costUsd":1}');
    assert.strictEqual(rowUsage[1].message, '[usage] {"costUsd":2}');
  });

  test('LIN-2253: ticketMarkers accumulates [ticket] markers across every row in the lineage, parsed once', () => {
    const rows = [
      { _id: 'orig', rootItemId: 'lane1', status: 'taken', dispatchedAt: daysAgo(2), feedback: [
        { message: '[ticket] LIN-900 started', timestamp: daysAgo(2).toISOString() },
        { message: '[ticket] LIN-900 done', timestamp: daysAgo(1.5).toISOString() }
      ] },
      { _id: 'fu', rootItemId: 'lane1', followUpTo: 'lane1', status: 'taken', dispatchedAt: daysAgo(1), feedback: [
        { message: '[ticket] LIN-901 done', timestamp: daysAgo(0.9).toISOString() }
      ] }
    ];
    const lineages = groupDispatchLineages(rows);
    const walk = lineages.get('lane1').ticketMarkers;
    assert.strictEqual(walk.length, 2, 'LIN-900 (latest state wins) + LIN-901, across both rows');
    const byId = Object.fromEntries(walk.map(m => [m.identifier, m]));
    assert.strictEqual(byId['LIN-900'].state, 'done', 'the LATER started->done marker wins, not the first one seen');
    assert.strictEqual(byId['LIN-901'].state, 'done');
  });

  test('LIN-2253: ticketMarkers is order-independent, same as rowUsage', () => {
    const rows = [
      { _id: 'orig', rootItemId: 'lane2', status: 'taken', dispatchedAt: daysAgo(2), feedback: [
        { message: '[ticket] LIN-910 done', timestamp: daysAgo(1.5).toISOString() }
      ] },
      { _id: 'fu', rootItemId: 'lane2', followUpTo: 'lane2', status: 'taken', dispatchedAt: daysAgo(1), feedback: [
        { message: '[ticket] LIN-911 done', timestamp: daysAgo(0.9).toISOString() }
      ] }
    ];
    const forward = groupDispatchLineages(rows);
    const reversed = groupDispatchLineages([...rows].reverse());
    const idsOf = (lineages) => lineages.get('lane2').ticketMarkers.map(m => m.identifier).sort();
    assert.deepStrictEqual(idsOf(forward), ['LIN-910', 'LIN-911']);
    assert.deepStrictEqual(idsOf(reversed), ['LIN-910', 'LIN-911']);
  });

  test('review fix: same-identifier markers across rows resolve by the CONTRIBUTING ROW\'s dispatchedAt, not array/push order', () => {
    // parseTicketMarkers is last-ARRAY-POSITION-wins, not timestamp-aware —
    // groupDispatchLineages must sort each row's marker entries by the row's
    // own dispatchedAt BEFORE parsing, or an unsorted rows[] (an unsorted
    // concatenation of an unsorted aggregate and an unsorted find, same as
    // rowUsage's F3 concern) could resolve "latest state" to whichever row
    // the input array happened to visit last, not the row dispatched last.
    const earlyRow = { _id: 'early', rootItemId: 'lane5', status: 'taken', dispatchedAt: daysAgo(5), feedback: [
      { message: '[ticket] LIN-920 started', timestamp: daysAgo(5).toISOString() }
    ] };
    const lateRow = { _id: 'late', rootItemId: 'lane5', followUpTo: 'lane5', status: 'taken', dispatchedAt: daysAgo(1), feedback: [
      { message: '[ticket] LIN-920 done', timestamp: daysAgo(1).toISOString() }
    ] };
    // Pass the chronologically-LATER row FIRST in the input array — if the
    // fix regresses to plain concatenation order, this would resolve to
    // "started" (whichever entry parseTicketMarkers saw last in array
    // position) instead of the chronologically-later "done".
    const lineages = groupDispatchLineages([lateRow, earlyRow]);
    const walk = lineages.get('lane5').ticketMarkers;
    assert.strictEqual(walk.length, 1);
    assert.strictEqual(walk[0].state, 'done', 'the row dispatched LATER wins, regardless of its position in the input array');
  });

  test('a lineage with no [ticket] markers gets an empty ticketMarkers array, never undefined', () => {
    const rows = [{ _id: 'orig', rootItemId: 'plain', status: 'taken', dispatchedAt: daysAgo(1), feedback: [{ message: '[done] landed it', timestamp: daysAgo(1).toISOString() }] }];
    const lineages = groupDispatchLineages(rows);
    assert.deepStrictEqual(lineages.get('plain').ticketMarkers, []);
  });

  // ── LIN-2121 L1: a wake row may INHERIT a lineage's attribution, never FOUND it ──
  //
  // LIN-2121 stamped `issueIdentifier` onto wake rows. `groupDispatchLineages`
  // captures a lineage's identifier from the earliest row carrying one, keyed on
  // `rootItemId ?? _id`; LIN-1468's self-heal can reconcile a wake row onto an
  // identifier-LESS parent lineage (an autopilot or general run whose root has
  // no issue). Without the wake exclusion that wake's identifier would found the
  // whole lineage's attribution on /kpis, moving its cost from the overhead
  // bucket into the wake's issue. The rule: an identifier-less root lineage stays
  // in overhead exactly as before the stamp.
  test("LIN-2121 L1: a wake row must never found a lineage's attribution — an identifier-less root stays in overhead, not the wake's issue", () => {
    const rows = [
      // Identifier-less root (autopilot / general run): done + priced ($30).
      // The usage payload carries `harness` so parseUsage treats it as a real
      // usage entry (a costUsd-only payload with no token/harness field parses
      // to null — see USAGE_NUMBER_FIELDS in session-telemetry.js).
      {
        _id: 'root', rootItemId: 'root', kind: 'autopilot', harness: 'claude-code',
        status: 'taken', dispatchedAt: daysAgo(3),
        feedback: [
          { kind: 'usage', message: '[usage] {"harness":"claude-code","costUsd":30}', timestamp: daysAgo(3).toISOString() },
          { message: '[done] run complete', timestamp: daysAgo(2.9).toISOString() }
        ]
      },
      // A wake row self-healed onto the root's lineage, now stamped with an
      // issue identifier (LIN-2121). It must not become the lineage's anchor.
      {
        _id: 'wake', rootItemId: 'root', followUpTo: 'root', kind: 'wake',
        issueIdentifier: 'LIN-9999', harness: 'claude-code', status: 'taken', dispatchedAt: daysAgo(2),
        feedback: [{ message: '[done] parent reacted', timestamp: daysAgo(1.9).toISOString() }]
      }
    ];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.strictEqual(result.issueCount, 0,
      'the wake row must not found attribution — the identifier-less root keeps the lineage in overhead');
    assert.strictEqual(result.overheadUsd, 30,
      'the lineage cost stays in overhead exactly as before the wake stamp');
  });
});
