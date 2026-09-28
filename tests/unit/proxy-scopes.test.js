/**
 * LIN-3129 S1 step 1 — the shared proxy scope/grant vocabulary (lib/proxy-scopes.js).
 *
 * This pins the ONE vocabulary the token model, its enforcement sites and the
 * runner mint all share, so a second dialect cannot drift in. The sibling
 * proxy-scopes-source-pin.test.js pins that the five A2 sites actually import
 * and use it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  READ,
  READ_WRITE,
  SCOPES,
  GRANTS,
  RUNNER_GRANTS,
  hasGrant,
  RUNNER_BOOTSTRAP_TTL_SECONDS,
  RUNNER_WORKING_TTL_SECONDS,
} from '../../lib/proxy-scopes.js';

describe('LIN-3129 — proxy scope vocabulary', () => {
  test('READ_WRITE is the writable scope and SCOPES carries exactly the two token scopes', () => {
    assert.equal(READ, 'read');
    assert.equal(READ_WRITE, 'readWrite');
    assert.deepEqual(SCOPES, ['read', 'readWrite']);
    assert.ok(SCOPES.includes(READ_WRITE), 'READ_WRITE must be a member of SCOPES');
  });

  test('SCOPES is frozen so no site can widen the vocabulary in place', () => {
    assert.ok(Object.isFrozen(SCOPES));
  });
});

describe('LIN-3129 — proxy grant vocabulary', () => {
  test('GRANTS is the closed set the runner can carry: take and dispatch (J1/J2)', () => {
    assert.deepEqual(GRANTS, ['take', 'dispatch']);
    assert.ok(Object.isFrozen(GRANTS));
  });

  test('RUNNER_GRANTS is a non-empty subset of GRANTS — one vocabulary, no dialect', () => {
    assert.ok(Array.isArray(RUNNER_GRANTS));
    assert.ok(RUNNER_GRANTS.length > 0, 'the runner mint stamps a non-empty grant set');
    for (const grant of RUNNER_GRANTS) {
      assert.ok(GRANTS.includes(grant), `${grant} is not a known grant`);
    }
    assert.deepEqual(RUNNER_GRANTS, ['take', 'dispatch'], 'J2(a): the runner carries both grants');
  });
});

describe('LIN-3129 — hasGrant', () => {
  test('true for a grant present in a grant list', () => {
    assert.equal(hasGrant(['take', 'dispatch'], 'take'), true);
    assert.equal(hasGrant(['take', 'dispatch'], 'dispatch'), true);
  });

  test('false for a grant absent from a grant list', () => {
    assert.equal(hasGrant(['take'], 'dispatch'), false);
    assert.equal(hasGrant([], 'take'), false);
  });

  test('fails closed on a missing or malformed grants value (never throws)', () => {
    assert.equal(hasGrant(null, 'take'), false);
    assert.equal(hasGrant(undefined, 'take'), false);
    assert.equal(hasGrant('take', 'take'), false, 'a string is not a grant list');
    assert.equal(hasGrant({ take: true }, 'take'), false);
  });
});

describe('LIN-3129 — runner lifetimes (J3(b))', () => {
  test('bootstrap TTL is one hour and working TTL is 24 hours', () => {
    assert.equal(RUNNER_BOOTSTRAP_TTL_SECONDS, 3600);
    assert.equal(RUNNER_WORKING_TTL_SECONDS, 86400);
  });
});
