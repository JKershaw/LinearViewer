/**
 * LIN-3327 — direct resolver-level acceptance witness that
 * `connectionResolveResult` ITSELF stamps `reason: 'ok'`.
 *
 * The gap this closes: the LIN-3323 acceptance witness
 * (tests/unit/lin-3323-connection-owner-login.test.js) drives the REAL
 * `resolveWorkspaceAccess` body, but `grant` in server.js
 * (`const grant = (fields) => ({ ...fields, reason: 'ok' })`, server.js:2529)
 * re-adds `reason` on the server path — applied to `arm.result` at
 * server.js:2621. So deleting the `reason: 'ok'` line from
 * `connectionResolveResult` leaves that test green even though the LIN-3323
 * owner-login bug (a caller gating on `reason === 'ok'` reads a valid
 * Connection-backed owner login as `refresh_error`) has been reintroduced.
 *
 * This test calls `connectionResolveResult` DIRECTLY — no server path, no
 * `grant` — and fails if the constructor stops returning `reason: 'ok'`.
 * Test only; no production change.
 *
 * Run with: node --test tests/unit/lin-3327-connection-resolve-result-ok.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { connectionResolveResult } from '../../lib/connection-access.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const future = () => Date.now() + 3_600_000;

/** A Connection row backing the workspace owner's Linear login. */
const ownerConnection = (overrides = {}) => ({
  _id: 'acct-3327::linear::org-3327',
  accountId: 'acct-3327',
  provider: 'linear',
  unitId: 'org-3327',
  credentials: { token: 'lin_connection_live_3327', tokenExpiresAt: future() },
  referents: [],
  ...overrides,
});

describe('LIN-3327 — connectionResolveResult itself stamps reason "ok"', () => {
  test('a Connection-backed owner result carries reason "ok" without server.js grant', () => {
    const result = connectionResolveResult(
      ownerConnection(),
      { scope: 'org-3327', source: 'connection', fingerprintCredential },
    );
    assert.equal(
      result.reason,
      'ok',
      'the resolver itself must stamp the success reason; the server-path grant must not be the only source',
    );
    assert.equal(result.token, 'lin_connection_live_3327', 'the live Connection credential resolves');
    assert.equal(result.provider, 'linear');
  });
});
