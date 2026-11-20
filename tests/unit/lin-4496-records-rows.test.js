/**
 * LIN-4496 (piece 5 of LIN-4491): the records rows and the held-run reading, pure over their inputs
 * (scripts/stability-measures-core.mjs). Reported beside the five measures, never a gate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, recordsRows, heldRunReading, heldRunRow, heldRunsOf, openHandOffs } from '../../scripts/stability-measures-core.mjs';

const ASOF = '2026-11-20T12:00:00.000Z';
const STAGES = ['implementation', 'review', 'close-out'];
const hours = (h) => new Date(Date.parse(ASOF) - h * 3600000).toISOString();

const records = [
  { id: 'finding-1', kind: 'finding', state: 'open', to: 'project', in: 'task-1', openedAt: hours(48) },
  { id: 'finding-2', kind: 'finding', state: 'open', to: 'project', in: 'task-1', openedAt: hours(24) },
  { id: 'question-3', kind: 'question', state: 'open', to: 'implementation', in: 'task-1', openedAt: hours(6) },
  { id: 'finding-4', kind: 'finding', state: 'done', to: 'review', in: 'task-1', openedAt: hours(72) },
  { id: 'lesson-5', kind: 'lesson', state: 'holds', to: undefined, in: undefined, openedAt: hours(90) },
  { id: 'finding-6', kind: 'finding', state: 'open', to: 'task-9', in: 'task-1', openedAt: hours(12) }
];

describe('the records rows: open to the project, open to a stage, sit time', () => {
  test('counts open hand-offs by addressee; ended records and lessons are not hand-offs', () => {
    assert.deepEqual(openHandOffs(records).map((r) => r.id), ['finding-1', 'finding-2', 'question-3', 'finding-6']);
    const [toProject, toStage] = recordsRows({ records, asOf: ASOF, stageKinds: STAGES });
    assert.equal(toProject.key, 'records.openToProject');
    assert.deepEqual(toProject.value, { count: 2, of: 4 });
    assert.equal(toStage.key, 'records.openToStage');
    assert.deepEqual(toStage.value, { count: 1, of: 4 });
  });

  test('sit time is the median age of the open hand-offs at asOf, in hours', () => {
    const [, , sit] = recordsRows({ records, asOf: ASOF, stageKinds: STAGES });
    assert.equal(sit.status, STATUS.MEASURED);
    // ages: 48, 24, 6, 12 hours; median of 6, 12, 24, 48 is 18
    assert.equal(sit.value.medianHours, 18);
    assert.equal(sit.value.open, 4);
  });

  test('no open hand-offs is not measured: a median of nothing is not zero', () => {
    const [toProject, toStage, sit] = recordsRows({ records: [records[3], records[4]], asOf: ASOF, stageKinds: STAGES });
    assert.equal(toProject.value.count, 0, 'a count of zero is a reading');
    assert.equal(toStage.value.count, 0);
    assert.equal(sit.status, STATUS.NOT_MEASURED);
    assert.equal(sit.value, null);
  });

  test('a records store that was not read makes every records row not measured, with its reason', () => {
    const rows = recordsRows({ records: null, asOf: ASOF, stageKinds: STAGES });
    assert.deepEqual(rows.map((r) => r.status), [STATUS.NOT_MEASURED, STATUS.NOT_MEASURED, STATUS.NOT_MEASURED]);
    assert.match(rows[0].reason, /not read/);
  });
});

describe('the held-run reading: how long a hand-off to a held run sat before it was read', () => {
  // The real shape (lib/dispatch-fields.js, lib/dispatch-leftover-hook.js): a dispatch row names its stage in `kind`. The
  // hook stamps the claim on the producer before it queues the leftover, so a held run has its producer stamped. Queue
  // and history rows are read together.
  const dispatchRows = [
    { _id: 'build-7', kind: 'implementation', issueIdentifier: 'LIN-1', status: 'taken', heldWakeClaimedAt: '2026-11-20T11:00:00.000Z' },
    { _id: 'leftover-1', kind: 'leftover', status: 'queued', heldWakeFor: 'build-7' },
    // an unclaimed producer has no held wake: its queued leftover holds nothing
    { _id: 'build-8', kind: 'review', issueIdentifier: 'LIN-1', status: 'taken', heldWakeClaimedAt: null },
    { _id: 'leftover-2', kind: 'leftover', status: 'queued', heldWakeFor: 'build-8' },
    { _id: 'build-9', kind: 'implementation', issueIdentifier: 'LIN-2', status: 'taken', heldWakeClaimedAt: '2026-11-20T11:30:00.000Z' },
    // a leftover that is running (taken) still holds its producer's wake
    { _id: 'leftover-3', kind: 'leftover', status: 'taken', heldWakeFor: 'build-9' },
    // a leftover that ended without running holds nothing
    { _id: 'leftover-4', kind: 'leftover', status: 'cancelled', heldWakeFor: 'build-9' },
    // a leftover that ran to its end releases the hold it had
    { _id: 'leftover-5', kind: 'leftover', status: 'done', heldWakeFor: 'build-7' },
    { _id: 'run-plain', kind: 'review', issueIdentifier: 'LIN-3', status: 'taken' }
  ];
  // The task records the addressees resolve through: LIN-1 is task-1, whose parent is task-0.
  const withTasks = [
    ...records,
    { id: 'task-0', kind: 'task', state: 'open', ref: 'LIN-0', openedAt: hours(300) },
    { id: 'task-1', kind: 'task', state: 'open', ref: 'LIN-1', in: 'task-0', openedAt: hours(300) },
    { id: 'finding-7', kind: 'finding', state: 'open', to: 'task-0', in: 'task-1', openedAt: hours(5) }
  ];

  test('a held run is a leftover still queued or taken whose producer is claimed; an unclaimed producer, an ended leftover or a plain row holds nothing', () => {
    assert.deepEqual(heldRunsOf(dispatchRows).map((h) => h.leftover._id), ['leftover-1', 'leftover-3']);
    assert.deepEqual(heldRunsOf([{ _id: 'L', kind: 'leftover', status: 'queued', heldWakeFor: 'nowhere' }]), [], 'a producer that cannot be found is not counted');
    assert.deepEqual(
      heldRunsOf([
        { _id: 'build-x', kind: 'implementation', status: 'taken', heldWakeClaimedAt: null },
        { _id: 'L-x', kind: 'leftover', status: 'queued', heldWakeFor: 'build-x', heldWakeClaimedAt: '2026-11-20T11:00:00.000Z' }
      ]),
      [],
      'a stamp on the leftover row does not claim its producer'
    );
  });

  test('a hand-off is addressed to a held run by its producer stage, or by the producer\'s task or that task\'s parent', () => {
    const r = heldRunReading({ records: withTasks, queryLog: [], dispatchRows, asOf: ASOF });
    assert.equal(r.held, 2);
    assert.deepEqual(r.sample.map((s) => s.id), ['question-3', 'finding-7']);
    assert.deepEqual(r.sample[0].heldRunIds, ['leftover-1', 'leftover-3'], 'question-3 is addressed to the implementation stage both held producers share');
    assert.deepEqual(r.sample[1].heldRunIds, ['leftover-1'], 'finding-7 is addressed to LIN-1\'s parent task, which only build-7 answers to');
  });

  test('a hand-off read by a reader is measured to that read; the measuring reader\'s own reads do not count', () => {
    const queryLog = [
      { at: hours(3), by: 'measure', taskId: 'task-1' },
      { at: hours(4), by: 'implementation', taskId: 'task-1' }
    ];
    const r = heldRunReading({ records, queryLog, dispatchRows, asOf: ASOF, measuringReader: 'measure' });
    assert.equal(r.read, 1);
    assert.equal(r.censored, 0);
    // opened 6 hours before asOf, read 4 hours before asOf: it sat 2 hours
    assert.equal(r.sample[0].sitHours, 2);
    assert.equal(r.medianSitHours, 2);
  });

  test('a hand-off no reader has read is censored at asOf, and is not counted as read', () => {
    const r = heldRunReading({ records, queryLog: [{ at: hours(1), by: 'measure', taskId: 'task-1' }], dispatchRows, asOf: ASOF, measuringReader: 'measure' });
    assert.equal(r.read, 0);
    assert.equal(r.censored, 1);
    assert.equal(r.sample[0].sitHours, 6);
    assert.equal(r.medianSitHours, null);
  });

  test('a read before the hand-off was opened does not count for it', () => {
    const r = heldRunReading({ records, queryLog: [{ at: hours(10), by: 'implementation', taskId: 'task-1' }], dispatchRows, asOf: ASOF });
    assert.equal(r.read, 0);
  });

  test('no held runs is a reading of 0, not a missing one; a missing source is null and not measured', () => {
    const none = heldRunReading({ records, queryLog: [], dispatchRows: [], asOf: ASOF });
    assert.equal(none.held, 0);
    assert.equal(none.addressed, 0);
    assert.equal(heldRunReading({ records, queryLog: null, dispatchRows, asOf: ASOF }), null);
    assert.equal(heldRunRow(null).status, STATUS.NOT_MEASURED);
    assert.equal(heldRunRow(none).status, STATUS.MEASURED);
  });
});
