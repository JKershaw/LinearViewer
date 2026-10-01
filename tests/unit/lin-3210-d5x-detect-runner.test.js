/**
 * LIN-3210 (sub-task (c) of LIN-3197): fixture tests for the D5x counts in
 * `scripts/survey-hides-detect-runner.mjs`.
 *
 * D5x reads the runner's completion-post record. Before LIN-3208/LIN-3209 the
 * detector flagged every failed terminal post whose item carried a
 * `hook.done_posted` within 60 s as "logged as posted anyway", so a retry that
 * HEALED read as a false posted (red while right). The new counts distinguish:
 *
 *   - `doneLoggedAnyway` — a FALSE `done_posted`: a `hook.done_posted` with no
 *     ok `[done]` `feedback.post` for that item. A healed retry has one, so it
 *     does not count.
 *   - `donePostFailed` — a `hook.done_post_failed` (honest loss).
 *   - `unresolved` — a `hook.done_post_started` with neither a `done_posted`
 *     nor a `done_post_failed`.
 *
 * Event shapes are grounded on the merged simple-dispatcher code: `hook.done_post_started`
 * (`hook.js:2137`, `{session,item}`), `hook.done_posted` (`hook.js:2148`, `{session,item}`),
 * `hook.done_post_failed` (`hook.js:2150`, `{session,item,status,error,cause,url,attempts,skipped}`),
 * `feedback.post` (`hook.js:154`, `{item,ok,status,error,cause,url,attempts,msg}`).
 *
 * The classifier is a pure function in `scripts/survey-hides-d5x-lib.mjs` so the
 * detector logic is testable without reading production state.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDonePosts } from '../../scripts/survey-hides-d5x-lib.mjs';

const T0 = Date.parse('2026-09-10T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

describe('D5x classifyDonePosts (LIN-3210)', () => {
  test('(i) a healed retry is NOT counted as doneLoggedAnyway or as a loss', () => {
    // A [done] post failed, its unconditional hook.done_posted landed anyway (legacy
    // behaviour), then the same item later successfully posted the same [done] line.
    const ops = [
      { event: 'feedback.post', item: 'aaaa1111', ok: false, status: 503, msg: '[done] finished', ts: at(0) },
      { event: 'hook.done_posted', item: 'aaaa1111', session: 'sess0001', ts: at(0) },
      { event: 'feedback.post', item: 'aaaa1111', ok: true, status: 200, msg: '[done] finished', ts: at(1) },
    ];
    const failures = [{ item: 'aaaa1111', terminal: true, healed: true, ts: at(0), msg: '[done] finished' }];

    const r = classifyDonePosts(ops, failures);
    assert.equal(r.doneLoggedAnyway, 0, 'a healed retry has an ok [done] row, so no false done_posted');
    assert.equal(r.healedLosses, 1);
    assert.equal(r.unhealedLosses, 0);
    assert.equal(r.falseDonePosted.length, 0);
  });

  test('(ii) a false done_posted (no ok [done] feedback.post for that item) is counted', () => {
    const ops = [
      { event: 'feedback.post', item: 'bbbb2222', ok: false, status: 503, msg: '[done] finished', ts: at(0) },
      { event: 'hook.done_posted', item: 'bbbb2222', session: 'sess0002', ts: at(0) },
    ];
    const failures = [{ item: 'bbbb2222', terminal: true, healed: false, ts: at(0), msg: '[done] finished' }];

    const r = classifyDonePosts(ops, failures);
    assert.equal(r.doneLoggedAnyway, 1);
    assert.equal(r.falseDonePosted.length, 1);
    assert.equal(r.falseDonePosted[0].item, 'bbbb2222');
    assert.equal(r.unhealedLosses, 1);
  });

  test('(iii) done_post_started with no done_posted|done_post_failed is unresolved', () => {
    const ops = [
      { event: 'hook.done_post_started', session: 'sess0003', item: 'cccc3333', ts: at(0) },
    ];
    const r = classifyDonePosts(ops, []);
    assert.equal(r.unresolved, 1);
    assert.equal(r.unresolvedStarted.length, 1);
    assert.equal(r.unresolvedStarted[0].session, 'sess0003');
  });

  test('(iii-b) a started post that reaches done_posted is NOT unresolved', () => {
    const ops = [
      { event: 'hook.done_post_started', session: 'sess0004', item: 'dddd4444', ts: at(0) },
      { event: 'hook.done_posted', session: 'sess0004', item: 'dddd4444', ts: at(0) },
      { event: 'feedback.post', item: 'dddd4444', ok: true, msg: '[done] finished', ts: at(0) },
    ];
    const r = classifyDonePosts(ops, []);
    assert.equal(r.unresolved, 0);
    assert.equal(r.doneLoggedAnyway, 0);
  });

  test('(iii-c) a started post that reaches done_post_failed is NOT unresolved', () => {
    const ops = [
      { event: 'hook.done_post_started', session: 'sess0005', item: 'eeee5555', ts: at(0) },
      { event: 'hook.done_post_failed', session: 'sess0005', item: 'eeee5555', status: 503, ts: at(0) },
    ];
    const r = classifyDonePosts(ops, []);
    assert.equal(r.unresolved, 0);
    assert.equal(r.donePostFailed, 1);
  });

  test('(iv) done_post_failed is counted separately', () => {
    const ops = [
      { event: 'hook.done_post_started', session: 'sess0006', item: 'ffff6666', ts: at(0) },
      { event: 'hook.done_post_failed', session: 'sess0006', item: 'ffff6666', status: 503, error: 'bad gateway', attempts: 4, ts: at(1) },
      { event: 'hook.done_post_failed', session: 'sess0007', item: 'ffff7777', status: 502, attempts: 4, ts: at(2) },
    ];
    const r = classifyDonePosts(ops, []);
    assert.equal(r.donePostFailed, 2);
    assert.equal(r.donePostFailedEvents.length, 2);
  });
});
