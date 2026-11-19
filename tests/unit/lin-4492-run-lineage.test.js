/**
 * LIN-4492 (plan decision 2): the lineage check is a pure function over the run's own row. These tests pin
 * its three outcomes, the refusal reasons, and that nothing falls through to a person.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writerOf, WRITER_REFUSAL, lineageOfRun } from '../../lib/run-lineage.js';

// A build's stage row is its own root; its leftover inherits the build's root (lib/dispatch-factory.js anchor).
const BUILD = { id: 'build-1', kind: 'implementation', open: true, rootItemId: 'build-1' };
const LEFTOVER = { id: 'left-1', kind: 'leftover', open: true, rootItemId: 'build-1' };
const REVIEW_ELSEWHERE = { id: 'review-9', kind: 'review', open: true, rootItemId: 'review-9' };
const ENDED_BUILD = { ...BUILD, open: false };
const BUILD_CREDENTIAL = { origin: 'dispatch', runRecordId: 'build-1', createdBy: 'acct-owner' };

describe('LIN-4492: the three outcomes of a records write', () => {
  test('(i) a person credential is filed as the person, and no run is needed', () => {
    const r = writerOf({ credential: { origin: 'person', createdBy: 'acct-owner', runRecordId: null } });
    assert.deepEqual(r, { ok: true, as: 'person', by: 'person:acct-owner' });
  });

  test('(ii) a dispatch credential naming an open run in its own lineage is filed as that run\'s kind', () => {
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: BUILD, namedRun: BUILD, namedRunGiven: true });
    assert.deepEqual(r, { ok: true, as: 'dispatch', by: 'implementation', run: 'build-1' });
  });

  test('(ii) a build\'s leftover writes as leftover: same lineage, the named run is the leftover', () => {
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: BUILD, namedRun: LEFTOVER, namedRunGiven: true });
    assert.deepEqual(r, { ok: true, as: 'dispatch', by: 'leftover', run: 'left-1' });
  });
});

describe('LIN-4492: every refusal names its cause, and none is filed as a person', () => {
  test('no credential', () => {
    assert.deepEqual(writerOf({ credential: null }), { ok: false, reason: WRITER_REFUSAL.NO_CREDENTIAL });
  });

  test('a credential with no origin predates run identity', () => {
    const r = writerOf({ credential: { origin: null, createdBy: 'acct-owner' }, tokenRun: BUILD, namedRun: BUILD, namedRunGiven: true });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.PREDATES_RUN_IDENTITY });
  });

  test('an origin nobody classified is refused, not read as a person', () => {
    const r = writerOf({ credential: { origin: 'something', createdBy: 'acct-owner' }, tokenRun: BUILD, namedRun: BUILD, namedRunGiven: true });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.UNKNOWN_ORIGIN });
  });

  test('a person credential with no owner is refused', () => {
    assert.deepEqual(writerOf({ credential: { origin: 'person', createdBy: null } }), { ok: false, reason: WRITER_REFUSAL.PERSON_WITHOUT_OWNER });
  });

  test('a dispatch credential with no run is refused, even when the write names one', () => {
    const r = writerOf({ credential: { origin: 'dispatch', runRecordId: null, createdBy: 'acct-owner' }, tokenRun: null, namedRun: BUILD, namedRunGiven: true });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.NO_RUN });
  });

  test('a dispatch credential whose own run row cannot be read is refused (token-run-unknown)', () => {
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: null, namedRun: BUILD, namedRunGiven: true });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.TOKEN_RUN_UNKNOWN });
  });

  test('a dispatch write that names no run is refused', () => {
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: BUILD, namedRun: null, namedRunGiven: false });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.RUN_NOT_NAMED });
  });

  test('a dispatch write that names a run that does not exist is refused', () => {
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: BUILD, namedRun: null, namedRunGiven: true });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.RUN_NOT_FOUND });
  });

  test('a write naming an ended run is refused', () => {
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: BUILD, namedRun: ENDED_BUILD, namedRunGiven: true });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.RUN_ENDED });
  });

  test('a write naming a run in another lineage is refused', () => {
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: BUILD, namedRun: REVIEW_ELSEWHERE, namedRunGiven: true });
    assert.deepEqual(r, { ok: false, reason: WRITER_REFUSAL.OTHER_LINEAGE });
  });

  test('a wake row\'s own rootItemId is not its run: lineage is read through the run row', () => {
    // A wake row of the build would carry the build's sessionId, not its own run; the run row is the build.
    const wakeRowRoot = { id: 'wake-7', kind: 'implementation', open: true, rootItemId: 'review-9' };
    assert.equal(lineageOfRun(wakeRowRoot), 'review-9');
    const r = writerOf({ credential: BUILD_CREDENTIAL, tokenRun: BUILD, namedRun: wakeRowRoot, namedRunGiven: true });
    assert.equal(r.reason, WRITER_REFUSAL.OTHER_LINEAGE);
  });
});

describe('LIN-4492: exactly the three outcomes, over every combination', () => {
  const credentials = [
    null,
    { origin: undefined, createdBy: 'acct-owner' },
    { origin: null, createdBy: 'acct-owner' },
    { origin: 'person', createdBy: 'acct-owner' },
    { origin: 'person', createdBy: null },
    { origin: 'dispatch', runRecordId: null, createdBy: 'acct-owner' },
    { origin: 'dispatch', runRecordId: 'build-1', createdBy: 'acct-owner' },
    { origin: 'robot', runRecordId: 'build-1', createdBy: 'acct-owner' }
  ];
  const tokenRuns = [null, BUILD, REVIEW_ELSEWHERE];
  const named = [
    { namedRun: null, namedRunGiven: false },
    { namedRun: null, namedRunGiven: true },
    { namedRun: BUILD, namedRunGiven: true },
    { namedRun: LEFTOVER, namedRunGiven: true },
    { namedRun: ENDED_BUILD, namedRunGiven: true },
    { namedRun: REVIEW_ELSEWHERE, namedRunGiven: true }
  ];
  const REASONS = new Set(Object.values(WRITER_REFUSAL));

  test('every result is a person, a dispatch with a valid run, or a named refusal; never a silent person', () => {
    let seen = 0;
    for (const credential of credentials) {
      for (const tokenRun of tokenRuns) {
        for (const n of named) {
          const r = writerOf({ credential, tokenRun, ...n });
          seen++;
          if (r.ok) {
            if (r.as === 'person') {
              assert.equal(credential?.origin, 'person', 'only a person credential is filed as a person');
              assert.ok(credential.createdBy, 'and it has an owner');
              assert.equal(r.by, `person:${credential.createdBy}`);
            } else {
              assert.equal(r.as, 'dispatch');
              assert.equal(credential?.origin, 'dispatch', 'a dispatch write needs a dispatch credential');
              assert.ok(credential.runRecordId, 'with a run');
              assert.ok(!r.by.startsWith('person:'), 'and is never filed as a person');
              assert.equal(r.by, n.namedRun.kind);
            }
          } else {
            assert.ok(REASONS.has(r.reason), `refusal names a known cause: ${r.reason}`);
          }
        }
      }
    }
    assert.equal(seen, credentials.length * tokenRuns.length * named.length);
  });
});
