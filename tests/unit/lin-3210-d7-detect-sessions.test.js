/**
 * LIN-3210 (sub-task (c) of LIN-3197): fixture tests for the D7 join to the
 * `launch.duplicate` alarm and the bucket split.
 *
 * D7 pairs same `issue|kind` launches and marks a HIT when `concurrent >= 2`
 * (the ±2-min step-minute overlap). M23's `launch.duplicate` alarm is keyed on
 * `(issueIdentifier|kind, new session id)`. The join tells an ALARMED hit from
 * an UNALARMED one. Buckets are mutually exclusive, precedence:
 *
 *   alarmed > alreadyEnded > parkedOnly > unalarmed
 *
 * `alreadyEnded` is the binding R2 case: the first session ended (terminal)
 * before the second launched (`overlapMin === 0`), so the alarm — which scans
 * only non-terminal sessions — cannot fire. It must read apart from both
 * `unalarmed` and `parkedOnly`.
 *
 * Event shape grounded on merged simple-dispatcher (`dispatcher.js:1162`):
 * `launch.duplicate` = `{session,item,issueIdentifier,kind,otherSession,otherItem,otherPhase,otherParked}`,
 * where `session` is the NEWLY LAUNCHED session (`ownSessionId`, `dispatcher.js:1144`) and
 * `otherSession` is the pre-existing non-terminal one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { joinDuplicateAlarms, bucketCounts } from '../../scripts/survey-hides-d7-lib.mjs';

const uuid = (p) => `${p}-0000-4000-8000-000000000000`;
const hit = (over = {}) => ({ set: 'hit', issue: 'LIN-1', kind: 'plan', first: 'aaaa1111', second: 'bbbb2222', overlapMin: 10, concurrentMin: 3, firstParked: false, ...over });
const alarm = (over = {}) => ({ session: uuid('bbbb2222'), issueIdentifier: 'LIN-1', kind: 'plan', otherSession: uuid('aaaa1111'), otherParked: false, ...over });

describe('D7 join to launch.duplicate + buckets (LIN-3210)', () => {
  test('(alarmed) a hit whose second session has a launch.duplicate is alarmed', () => {
    const rows = joinDuplicateAlarms([hit()], [alarm()]);
    assert.equal(rows[0].bucket, 'alarmed');
  });

  test('(unalarmed) a hit with no matching launch.duplicate is unalarmed', () => {
    const rows = joinDuplicateAlarms([hit()], []);
    assert.equal(rows[0].bucket, 'unalarmed');
  });

  test('(parkedOnly) an unalarmed hit whose first session was parked-only is parkedOnly', () => {
    const rows = joinDuplicateAlarms([hit({ firstParked: true })], []);
    assert.equal(rows[0].bucket, 'parkedOnly');
  });

  test('(alreadyEnded R2) overlapMin === 0 with no alarm is alreadyEnded, apart from unalarmed', () => {
    const rows = joinDuplicateAlarms([hit({ overlapMin: 0 })], []);
    assert.equal(rows[0].bucket, 'alreadyEnded');
    assert.notEqual(rows[0].bucket, 'unalarmed');
    assert.notEqual(rows[0].bucket, 'parkedOnly');
  });

  test('the join key is (issue|kind, SECOND session id) — session, not otherSession', () => {
    // Same issue+kind but the alarm names a different new session: no match.
    const otherNew = alarm({ session: uuid('cccc3333') });
    assert.equal(joinDuplicateAlarms([hit()], [otherNew])[0].bucket, 'unalarmed');
    // An alarm that names the pair's second session only in `otherSession` is not a match.
    const swapped = alarm({ session: uuid('dddd4444'), otherSession: uuid('bbbb2222') });
    assert.equal(joinDuplicateAlarms([hit()], [swapped])[0].bucket, 'unalarmed');
  });

  test('a different issue or kind does not alarm even on the same session id', () => {
    assert.equal(joinDuplicateAlarms([hit()], [alarm({ kind: 'review' })])[0].bucket, 'unalarmed');
    assert.equal(joinDuplicateAlarms([hit()], [alarm({ issueIdentifier: 'LIN-2' })])[0].bucket, 'unalarmed');
  });

  test('precedence: alarmed beats alreadyEnded; alreadyEnded beats parkedOnly', () => {
    assert.equal(joinDuplicateAlarms([hit({ overlapMin: 0 })], [alarm()])[0].bucket, 'alarmed');
    assert.equal(joinDuplicateAlarms([hit({ overlapMin: 0, firstParked: true })], [])[0].bucket, 'alreadyEnded');
  });

  test('non-hits (sequential / excluded-kind) are left unbucketed', () => {
    const rows = joinDuplicateAlarms([{ ...hit(), set: 'sequential' }], [alarm()]);
    assert.equal(rows[0].bucket, undefined);
  });

  test('bucketCounts sums the hit buckets', () => {
    const rows = joinDuplicateAlarms([
      hit(), hit({ second: 'cccc3333' }), hit({ firstParked: true, second: 'dddd4444' }), hit({ overlapMin: 0, second: 'eeee5555' }),
    ], [alarm()]);
    assert.deepEqual(bucketCounts(rows), { alarmed: 1, unalarmed: 1, parkedOnly: 1, alreadyEnded: 1 });
  });
});
