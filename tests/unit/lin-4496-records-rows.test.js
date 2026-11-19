/**
 * LIN-4496 (piece 5 of LIN-4491): the records rows and the held-run reading, pure over their inputs
 * (scripts/stability-measures-core.mjs). Reported beside the five measures, never a gate.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, recordsRows, heldRunReading, heldRunRow, openHandOffs } from '../../scripts/stability-measures-core.mjs';

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
  const dispatchRows = [
    { id: 'run-impl', stage: 'implementation', taskId: 'task-1', heldWakeFor: 'build-7', heldWakeClaimedAt: null },
    { id: 'run-review', stage: 'review', taskId: 'task-1', heldWakeFor: 'build-8', heldWakeClaimedAt: '2026-11-20T11:00:00.000Z' },
    { id: 'run-plain', stage: 'review', taskId: 'task-2' }
  ];

  test('a held run is a dispatch row with heldWakeFor and no claim stamp; a claimed or plain row is not held', () => {
    const r = heldRunReading({ records, queryLog: [], dispatchRows, asOf: ASOF });
    assert.equal(r.held, 1);
    assert.equal(r.addressed, 1, 'only question-3 is addressed to the held implementation run');
    assert.equal(r.sample[0].id, 'question-3');
    assert.deepEqual(r.sample[0].heldRunIds, ['run-impl']);
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
