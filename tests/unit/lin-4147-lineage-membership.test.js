/**
 * LIN-4147: one answer to "which rows belong to a lineage, and which issue it counts under".
 *
 * `lib/lineage-membership.js` decides both, from each row's own data, and every cost reader takes
 * it. These tests pin the rule, then one synthetic case per behaviour that changed on the cost
 * reads (D1 wake rows, D2 cross-issue follow-ups, Home-Stop abort rows, never-ran rows, and a
 * never-re-pointed failed wake). The "before" figure in each case is what `main` produced on the
 * same rows, measured by running both trees; see the close-out on LIN-4147.
 *
 * Rows are written in both load shapes: the formatted `/dispatch` shape (`id`, `feedback`) that
 * `buildTaskCost` reads, and the KPI projection (`_id`, `usageEntry`, `terminalEntry`, no feedback)
 * that `windowedSpend` reads. A reader that decided membership its own way would disagree between
 * the two, so the agreement test feeds one fixture to both.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { anchorOf, groupLineageMembership, isMember } from '../../lib/lineage-membership.js';
import { groupDispatchLineages } from '../../lib/dispatch-lineage.js';
import { lineageRecords } from '../../lib/cost-read.js';
import { buildTaskCost } from '../fixtures/task-cost-adapter.js';
import { computeTerminalMarkedTaskCost } from '../../lib/terminal-marked-task-cost.js';
import { windowedSpend } from '../../lib/weekly-budget.js';

// LIN-4178: the lineage records of the one cost read (joinCostLineages is gone).
const lineageRecordsOf = rows => lineageRecords({ fetchedRows: rows, identityRows: [], outcomes: groupDispatchLineages(rows) });

const NOW = new Date('2026-11-02T12:00:00.000Z');
const WINDOW_START = Date.parse('2026-10-31T00:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

// A `[usage]` entry, tagged with its lineage root the way every producer tags it.
const usage = ({ cost, at, anchor }) => ({
  kind: 'usage', rootItemId: anchor, timestamp: at,
  message: `[usage] ${JSON.stringify({ model: 'anthropic/claude-sonnet-5', harness: 'claude-code', costUsd: cost })}`
});
const finished = (at) => ({ message: '[done] landed', timestamp: at });

// Formatted `/dispatch` shape.
const formatted = ({ id, rootItemId, issueIdentifier, kind = 'implementation', status = 'taken', abort, dispatchedAt, feedback = [] }) =>
  ({ id, _id: id, rootItemId, issueIdentifier, kind, status, abort, dispatchedAt, feedback });

// KPI projection: the same row without its feedback, carrying the derived usage and terminal entries.
const kpiShape = (row) => {
  const { id, feedback = [], ...rest } = row;
  const terminalEntry = feedback.find(e => /^\[(done|failed|aborted|complete|blocked)\]/.test(e.message)) || null;
  const usageEntry = [...feedback].reverse().find(e => e.kind === 'usage') || null;
  return { ...rest, _id: id, usageEntry, terminalEntry };
};

const ids = (lineage) => lineage.members.map(row => row.id ?? row._id);

describe('anchorOf — the lineage key (LIN-4147)', () => {
  test('the doc-level rootItemId wins', () => {
    assert.equal(anchorOf({ id: 'a', rootItemId: 'root1' }), 'root1');
  });

  test('a raw doc with no rootItemId anchors to its _id, then to its id', () => {
    assert.equal(anchorOf({ _id: 'raw' }), 'raw');
    assert.equal(anchorOf({ id: 'formatted' }), 'formatted');
  });

  test('a row with no doc rootItemId anchors to its own id, never to a feedback tag (the dropped tier)', () => {
    const legacy = { id: 'legacy', feedback: [{ rootItemId: 'tagged-root', message: '[usage] {}' }] };
    assert.equal(anchorOf(legacy), 'legacy');
  });

  test('a row with no id at all has no anchor', () => {
    assert.equal(anchorOf({}), null);
  });
});

describe('groupLineageMembership — who is a member, and which issue counts (LIN-4147)', () => {
  test('only a row that ran and is not an abort row is a member', () => {
    assert.equal(isMember({ status: 'taken' }), true);
    assert.equal(isMember({ status: 'taken', abort: true }), false, 'a Home-Stop abort row records a stop, not a call');
    assert.equal(isMember({ status: 'queued' }), false);
    assert.equal(isMember({ status: 'cancelled' }), false);
    assert.equal(isMember({ status: 'expired' }), false);
  });

  test('a never-ran row found nothing: its issue and its start do not count', () => {
    const rows = [
      formatted({ id: 'q', rootItemId: 'L', issueIdentifier: 'LIN-EARLY', status: 'queued', dispatchedAt: hoursAgo(9) }),
      formatted({ id: 'f', rootItemId: 'L', issueIdentifier: 'LIN-REAL', dispatchedAt: hoursAgo(5) })
    ];
    const lineage = groupLineageMembership(rows).get('L');
    assert.equal(lineage.issueIdentifier, 'LIN-REAL');
    assert.equal(lineage.start, Date.parse(hoursAgo(5)));
    assert.deepEqual(ids(lineage), ['f']);
  });

  test('a wake row never founds a lineage\'s issue; the earliest non-wake member with one does', () => {
    const rows = [
      formatted({ id: 'w', rootItemId: 'L', kind: 'wake', issueIdentifier: 'LIN-WAKE', dispatchedAt: hoursAgo(9) }),
      formatted({ id: 'f', rootItemId: 'L', issueIdentifier: 'LIN-FOUNDER', dispatchedAt: hoursAgo(8) })
    ];
    assert.equal(groupLineageMembership(rows).get('L').issueIdentifier, 'LIN-FOUNDER');
  });

  test('a lineage whose only issued member is a wake counts under no issue', () => {
    const rows = [
      formatted({ id: 'root', rootItemId: 'L', kind: 'autopilot', dispatchedAt: hoursAgo(9) }),
      formatted({ id: 'w', rootItemId: 'L', kind: 'wake', issueIdentifier: 'LIN-WAKE', dispatchedAt: hoursAgo(8) })
    ];
    assert.equal(groupLineageMembership(rows).get('L').issueIdentifier, null);
  });

  test('members come back in dispatch order, whatever order the rows arrive in', () => {
    const late = formatted({ id: 'late', rootItemId: 'L', dispatchedAt: hoursAgo(1) });
    const early = formatted({ id: 'early', rootItemId: 'L', dispatchedAt: hoursAgo(7) });
    assert.deepEqual(ids(groupLineageMembership([late, early]).get('L')), ['early', 'late']);
    assert.deepEqual(ids(groupLineageMembership([early, late]).get('L')), ['early', 'late']);
  });
});

describe('the cost readers, one synthetic case per changed behaviour (LIN-4147)', () => {
  test('D1: wake rows for X and Y pointing at an issue-less root P: /cost X and /cost Y are noLineage, P is counted once', () => {
    // Before: /cost X and Y each reported P's lineage, noTelemetryCount 1 and totalUsd null (the
    // root's pre-wake usage is outside the wake's forward-only bound). The root is still counted
    // once in the workspace-wide read ($9).
    const root = formatted({ id: 'P', rootItemId: 'P', kind: 'autopilot', dispatchedAt: hoursAgo(10),
      feedback: [usage({ cost: 9, at: hoursAgo(9.9), anchor: 'P' }), finished(hoursAgo(9.8))] });
    const wakeX = formatted({ id: 'WX', rootItemId: 'P', kind: 'wake', issueIdentifier: 'LIN-X', dispatchedAt: hoursAgo(8), feedback: [finished(hoursAgo(7.9))] });
    const wakeY = formatted({ id: 'WY', rootItemId: 'P', kind: 'wake', issueIdentifier: 'LIN-Y', dispatchedAt: hoursAgo(7), feedback: [finished(hoursAgo(6.9))] });
    const all = [root, wakeX, wakeY];
    const siblings = new Map([['P', all]]);

    const x = buildTaskCost({ ownRows: [wakeX], siblingRowsByAnchor: siblings, issueIdentifier: 'LIN-X' });
    const y = buildTaskCost({ ownRows: [wakeY], siblingRowsByAnchor: siblings, issueIdentifier: 'LIN-Y' });
    assert.equal(x.noLineage, true);
    assert.equal(y.noLineage, true);
    assert.equal(x.totalUsd, null);
    assert.equal(x.workerSessions.length, 0);

    assert.equal(buildTaskCost({ ownRows: all, siblingRowsByAnchor: new Map() }).pricedUsd, 9, 'the root is priced once, not once per wake');
  });

  test('D2: a follow-up filed under B counts under its founder\'s issue A; /cost B is noLineage', () => {
    const founder = formatted({ id: 'F', rootItemId: 'A', issueIdentifier: 'LIN-A', dispatchedAt: hoursAgo(12),
      feedback: [usage({ cost: 7, at: hoursAgo(11.9), anchor: 'A' }), finished(hoursAgo(11.8))] });
    const followUp = formatted({ id: 'U', rootItemId: 'A', issueIdentifier: 'LIN-B', dispatchedAt: hoursAgo(6),
      feedback: [finished(hoursAgo(5.8))] });
    const all = [founder, followUp];

    const a = buildTaskCost({ ownRows: [founder], siblingRowsByAnchor: new Map([['A', all]]), issueIdentifier: 'LIN-A' });
    const b = buildTaskCost({ ownRows: [followUp], siblingRowsByAnchor: new Map([['A', all]]), issueIdentifier: 'LIN-B' });
    assert.equal(a.pricedUsd, 7);
    assert.equal(a.totalUsd, 7);
    assert.equal(b.noLineage, true);
    assert.equal(b.totalUsd, null);
  });

  test('Home-Stop abort row on A: it adds no telemetry gap, so A is priced; an issue whose only row is the abort is noLineage', () => {
    // Before: the abort row was a taken row with no telemetry, so noTelemetryCount 1 and totalUsd null.
    const founder = formatted({ id: 'AF', rootItemId: 'A', issueIdentifier: 'LIN-A', dispatchedAt: hoursAgo(12),
      feedback: [usage({ cost: 7, at: hoursAgo(11.9), anchor: 'A' }), finished(hoursAgo(11.8))] });
    const abort = formatted({ id: 'AB', rootItemId: 'AB', issueIdentifier: 'LIN-A', abort: true, dispatchedAt: hoursAgo(3) });

    const a = buildTaskCost({ ownRows: [founder, abort], siblingRowsByAnchor: new Map([['A', [founder, abort]]]), issueIdentifier: 'LIN-A' });
    assert.equal(a.noTelemetryCount, 0);
    assert.equal(a.totalUsd, 7);

    const onlyAbort = buildTaskCost({ ownRows: [abort], siblingRowsByAnchor: new Map(), issueIdentifier: 'LIN-A' });
    assert.equal(onlyAbort.noLineage, true);
  });

  test('a never-ran lineage is no cost lineage: it is counted in neither the window\'s lineageCount nor its priced count', () => {
    const queued = kpiShape(formatted({ id: 'Q', rootItemId: 'Q', issueIdentifier: 'LIN-Q', status: 'queued', dispatchedAt: hoursAgo(5) }));
    const rows = [queued];
    const spend = windowedSpend(lineageRecordsOf(rows), WINDOW_START, NOW.getTime());
    assert.equal(spend.lineageCount, 0);
    assert.equal(spend.pricedCount, 0);
  });

  test('a never-ran row earlier on the same lineage does not set its start, so its day bucket is the founder\'s day', () => {
    // Before: the cancelled row (30h ago, Oct 31) set the lineage start, bucketing its spend on Oct 31.
    const founder = kpiShape(formatted({ id: 'FD', rootItemId: 'FD', issueIdentifier: 'LIN-R', dispatchedAt: hoursAgo(8),
      feedback: [usage({ cost: 4, at: hoursAgo(7.9), anchor: 'FD' }), finished(hoursAgo(7.8))] }));
    const cancelled = kpiShape(formatted({ id: 'CE', rootItemId: 'FD', issueIdentifier: 'LIN-Z', status: 'cancelled', dispatchedAt: hoursAgo(30) }));
    const rows = [founder, cancelled];
    const spend = windowedSpend(lineageRecordsOf(rows), WINDOW_START, NOW.getTime());
    assert.equal(spend.pricedCount, 1);
    assert.deepEqual([...spend.byDay.keys()], ['2026-11-02']);
    assert.equal(spend.byDay.get('2026-11-02'), 4);
  });

  test('a never-re-pointed failed wake on child issue C no longer counts under C', () => {
    // Before: its own anchor was its id, so /cost C reported its $2 under C.
    const wake = formatted({ id: 'WR', rootItemId: 'WR', kind: 'wake', issueIdentifier: 'LIN-C', dispatchedAt: hoursAgo(4),
      feedback: [usage({ cost: 2, at: hoursAgo(3.9), anchor: 'WR' }), { message: '[failed] x', timestamp: hoursAgo(3.8) }] });
    const result = buildTaskCost({ ownRows: [wake], siblingRowsByAnchor: new Map(), issueIdentifier: 'LIN-C' });
    assert.equal(result.noLineage, true);
    assert.equal(result.pricedUsd, 0);
  });

  test('the outcome grouping keeps earliest, status and statusMs exactly as before (LIN-4147 fence)', () => {
    // Recorded from `main` on this fixture (before the change), and asserted unchanged.
    const rows = [
      kpiShape(formatted({ id: 'A1', rootItemId: 'A', issueIdentifier: 'LIN-1', dispatchedAt: hoursAgo(6),
        feedback: [usage({ cost: 1, at: hoursAgo(5.9), anchor: 'A' }), finished(hoursAgo(5.8))] })),
      kpiShape(formatted({ id: 'A2', rootItemId: 'A', abort: true, dispatchedAt: hoursAgo(5), feedback: [] })),
      kpiShape(formatted({ id: 'A3', rootItemId: 'A', issueIdentifier: 'LIN-9', status: 'queued', dispatchedAt: hoursAgo(8) })),
      kpiShape(formatted({ id: 'W0', rootItemId: 'W', dispatchedAt: hoursAgo(4), feedback: [finished(hoursAgo(3.9))] })),
      kpiShape(formatted({ id: 'W1', rootItemId: 'W', kind: 'wake', issueIdentifier: 'LIN-2', dispatchedAt: hoursAgo(3),
        feedback: [{ message: '[failed] x', timestamp: hoursAgo(2.9) }] })),
      kpiShape(formatted({ id: 'C1', rootItemId: 'C', issueIdentifier: 'LIN-3', status: 'cancelled', dispatchedAt: hoursAgo(2) }))
    ];
    const outcomes = groupDispatchLineages(rows);
    assert.deepEqual(
      [...outcomes.keys()].sort(),
      ['A', 'C', 'W']
    );
    // The never-ran row (8h ago) is the earliest row of A, so it still sets `earliest` as it did before LIN-4147:
    // outcomes are not membership. The abort row (5h ago) sets nothing.
    assert.equal(outcomes.get('A').earliest, Date.parse(hoursAgo(8)));
    assert.equal(outcomes.get('A').status, 'done');
    assert.equal(outcomes.get('A').statusMs, Date.parse(hoursAgo(5.8)));
    assert.equal(outcomes.get('W').status, 'failed');
    assert.equal(outcomes.get('C').status, null);
  });
});

describe('buildTaskCost reports only lineages an own row is a member of (LIN-4147)', () => {
  test('with no issue filter, a lineage made only of siblings is not reported', () => {
    const own = formatted({ id: 'own', rootItemId: 'own', issueIdentifier: 'LIN-1', dispatchedAt: hoursAgo(5), feedback: [usage({ cost: 1, at: hoursAgo(5), anchor: 'own' })] });
    const stranger = formatted({ id: 'S', rootItemId: 'S', issueIdentifier: 'LIN-2', dispatchedAt: hoursAgo(4), feedback: [usage({ cost: 50, at: hoursAgo(4), anchor: 'S' })] });
    const siblings = new Map([['S', [stranger]]]);
    const result = buildTaskCost({ ownRows: [own], siblingRowsByAnchor: siblings });
    assert.equal(result.pricedUsd, 1, 'the sibling-only lineage is another issue\'s read');
    assert.equal(result.workerSessions.length, 1);
  });
});

describe('R9 effort readout: an in-flight earlier member becomes the merge base (LIN-4147)', () => {
  // Named in the close-out under "Figures that change". A finished wake W is re-pointed into an
  // in-flight root A: the session is now one lineage, labelled by A's kind and timed from A's dispatch.
  test('the session takes the earliest member\'s kind and dispatch time, not the wake\'s', () => {
    const MIN = 60e3;
    const t0 = Date.parse('2026-11-02T08:00:00.000Z');
    const at = (min) => new Date(t0 + min * MIN).toISOString();
    const root = formatted({ id: 'A', rootItemId: 'A', issueIdentifier: 'LIN-1', kind: 'autopilot', dispatchedAt: at(0), feedback: [usage({ cost: 0, at: at(1), anchor: 'A' })] });
    const wake = formatted({ id: 'W', rootItemId: 'A', issueIdentifier: 'LIN-1', kind: 'wake', dispatchedAt: at(60), feedback: [usage({ cost: 2, at: at(70), anchor: 'A' }), { rootItemId: 'A', message: '[done] landed', timestamp: at(80) }] });
    const result = buildTaskCost({ ownRows: [wake], siblingRowsByAnchor: new Map([['A', [root]]]), issueIdentifier: 'LIN-1' });
    assert.equal(result.workerSessions.length, 1);
    assert.equal(result.workerSessions[0].kind, 'autopilot');
    assert.equal(result.workerSessions[0].durationMs, 80 * MIN, 'timed from the root\'s dispatch (a wake alone: 20 min)');
  });
});

describe('one answer across the readers (LIN-4147)', () => {
  // One fixture, read through every engine in both shapes: a founder with usage, a follow-up under
  // another issue, an abort row, a never-ran row, a wake pointing at an issue-less root, and a
  // never-re-pointed wake.
  const founder = formatted({ id: 'F', rootItemId: 'A', issueIdentifier: 'LIN-A', dispatchedAt: hoursAgo(12),
    feedback: [usage({ cost: 7, at: hoursAgo(11.9), anchor: 'A' }), finished(hoursAgo(11.8))] });
  const followUp = formatted({ id: 'U', rootItemId: 'A', issueIdentifier: 'LIN-B', dispatchedAt: hoursAgo(6), feedback: [finished(hoursAgo(5.8))] });
  const abort = formatted({ id: 'AB', rootItemId: 'A', issueIdentifier: 'LIN-A', abort: true, dispatchedAt: hoursAgo(3) });
  const queued = formatted({ id: 'Q', rootItemId: 'Q', issueIdentifier: 'LIN-Q', status: 'queued', dispatchedAt: hoursAgo(2) });
  const rootP = formatted({ id: 'P', rootItemId: 'P', kind: 'autopilot', dispatchedAt: hoursAgo(20),
    feedback: [usage({ cost: 9, at: hoursAgo(19.9), anchor: 'P' }), finished(hoursAgo(19.8))] });
  const wakeP = formatted({ id: 'WP', rootItemId: 'P', kind: 'wake', issueIdentifier: 'LIN-X', dispatchedAt: hoursAgo(15), feedback: [finished(hoursAgo(14.9))] });
  const rePointed = formatted({ id: 'WR', rootItemId: 'WR', kind: 'wake', issueIdentifier: 'LIN-C', dispatchedAt: hoursAgo(4),
    feedback: [usage({ cost: 2, at: hoursAgo(3.9), anchor: 'WR' }), { message: '[failed] x', timestamp: hoursAgo(3.8) }] });
  const rows = [founder, followUp, abort, queued, rootP, wakeP, rePointed];

  test('the membership read from the formatted shape and from the KPI shape is the same, lineage by lineage', () => {
    const fromFormatted = groupLineageMembership(rows);
    const fromKpi = groupLineageMembership(rows.map(kpiShape));
    assert.deepEqual([...fromKpi.keys()].sort(), [...fromFormatted.keys()].sort());
    for (const [anchor, lineage] of fromFormatted) {
      assert.deepEqual(ids(fromKpi.get(anchor)), ids(lineage), `members of ${anchor}`);
      assert.equal(fromKpi.get(anchor).issueIdentifier, lineage.issueIdentifier, `issue of ${anchor}`);
      assert.equal(fromKpi.get(anchor).start, lineage.start, `start of ${anchor}`);
    }
  });

  test('each lineage counts under one issue or none, and no call is priced under two issues', () => {
    const issues = [...new Set(rows.map(r => r.issueIdentifier).filter(Boolean))];
    const underIssue = new Map(); // anchor -> issues it was reported under
    for (const issue of issues) {
      const own = rows.filter(r => r.issueIdentifier === issue);
      const { workerSessions } = buildTaskCost({ ownRows: own, siblingRowsByAnchor: new Map([['all', rows]]), issueIdentifier: issue });
      for (const session of workerSessions) {
        underIssue.set(session.rootItemId, [...(underIssue.get(session.rootItemId) || []), issue]);
      }
    }
    for (const [anchor, reportedUnder] of underIssue) {
      assert.equal(reportedUnder.length, 1, `lineage ${anchor} is reported under ${reportedUnder.join(', ')}`);
    }
    // A is the only lineage with an issue of its own (LIN-A, from its founder). P and WR found none (issue-less
    // root, and a wake that was never re-pointed), so they are under no issue. The follow-up on LIN-B is
    // A's lineage and counts under LIN-A only.
    assert.deepEqual([...underIssue.entries()], [['A', ['LIN-A']]]);
  });

  test('the workspace-wide read of the cost engines agrees on the lineage count (every reader, both shapes)', () => {
    const allCost = buildTaskCost({ ownRows: rows, siblingRowsByAnchor: new Map() });
    const kpiRows = rows.map(kpiShape);
    const spend = windowedSpend(lineageRecordsOf(kpiRows), WINDOW_START, NOW.getTime());
    // Every lineage that ran and is not skipped, with a start in the window. The queued row is not one.
    assert.equal(allCost.workerSessions.length, spend.lineageCount);
    assert.equal(allCost.workerSessions.length, 3, 'A, P and WR: the queued Q is not a member, so it is no lineage');
    const terminal = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(terminal.captureRateShare, 1, 'each counted lineage carries usage-bearing rows, none is a never-ran or abort-only lineage');
  });

  test('a sibling usage entry tagged with another root is still read from its own row (membership comes from the doc anchor alone)', () => {
    const member = formatted({ id: 'S', rootItemId: 'T', issueIdentifier: 'LIN-T', dispatchedAt: hoursAgo(5),
      feedback: [usage({ cost: 3, at: hoursAgo(4.9), anchor: 'OTHER' }), finished(hoursAgo(4.8))] });
    const base = formatted({ id: 'T0', rootItemId: 'T', issueIdentifier: 'LIN-T', dispatchedAt: hoursAgo(9), feedback: [finished(hoursAgo(8.9))] });
    const result = buildTaskCost({ ownRows: [base], siblingRowsByAnchor: new Map([['T', [member]]]), issueIdentifier: 'LIN-T' });
    assert.equal(result.pricedUsd, 3);
    assert.equal(result.workerSessions.length, 1);
  });
});
