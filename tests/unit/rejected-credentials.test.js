import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRejectedCredentialRegistry,
  DEFAULT_REJECTION_THRESHOLD,
  DEFAULT_SUSPENSION_MS,
} from '../../lib/rejected-credentials.js';
import { selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';

// The feedback edge the headless proxy lane never had: a credential the provider
// refuses must stop being re-served. See the 2026-08-09 incident write-up in
// docs/incidents/2026-08-09-proxy-401-flood.md.

function registry(overrides = {}) {
  let clock = 1_000_000;
  const reg = createRejectedCredentialRegistry({ now: () => clock, ...overrides });
  return { reg, advance: ms => { clock += ms; }, at: () => clock };
}

describe('createRejectedCredentialRegistry', () => {
  test('a single refusal does NOT suspend — a lone scope-403 must cost nothing', () => {
    // graphqlErrorStatus collapses upstream 401 and 403 into one proxy 401, so a
    // single strike cannot distinguish "dead" from "lacks scope for this write".
    const { reg } = registry();
    assert.equal(reg.reject('tok'), false);
    assert.equal(reg.isSuspended('tok'), false);
  });

  test('suspends on the threshold-th CONSECUTIVE refusal', () => {
    const { reg } = registry();
    assert.equal(reg.reject('tok'), false);
    assert.equal(reg.reject('tok'), false);
    assert.equal(reg.reject('tok'), true, 'third consecutive refusal suspends');
    assert.equal(reg.isSuspended('tok'), true);
    assert.equal(DEFAULT_REJECTION_THRESHOLD, 3);
  });

  test('a success resets the count — counting is consecutive, not cumulative', () => {
    // Without this a healthy credential could accrue three unrelated scope-403s
    // over an hour and suspend itself.
    const { reg } = registry();
    reg.reject('tok');
    reg.reject('tok');
    reg.accept('tok');
    assert.equal(reg.reject('tok'), false, 'count restarted from zero');
    assert.equal(reg.isSuspended('tok'), false);
  });

  test('suspension is bounded — a wrong verdict self-repairs without a deploy', () => {
    const { reg, advance } = registry();
    for (let i = 0; i < 3; i++) reg.reject('tok');
    assert.equal(reg.isSuspended('tok'), true);

    advance(DEFAULT_SUSPENSION_MS - 1);
    assert.equal(reg.isSuspended('tok'), true, 'still suspended inside the window');

    advance(2);
    assert.equal(reg.isSuspended('tok'), false, 'retried once the window elapses');
  });

  test('strikes decay too, so refusals spread far apart never accumulate', () => {
    const { reg, advance } = registry();
    reg.reject('tok');
    reg.reject('tok');
    advance(DEFAULT_SUSPENSION_MS + 1);
    assert.equal(reg.reject('tok'), false, 'stale strikes were pruned, not carried');
  });

  test('suspends only the offending credential, never a sibling', () => {
    const { reg } = registry();
    for (let i = 0; i < 3; i++) reg.reject('dead');
    assert.equal(reg.isSuspended('dead'), true);
    assert.equal(reg.isSuspended('healthy'), false);
  });

  test('identifies a credential through its provider call-scope wrapper', () => {
    // Selection hands a structured scope; the proxy may report the same
    // credential in another shape. Fingerprint identity must survive that.
    const { reg } = registry();
    for (let i = 0; i < 3; i++) reg.reject({ token: 'tok', repo: 'o/r' });
    assert.equal(reg.isSuspended('tok'), true, 'same secret, different wrapper');
  });

  test('fails OPEN on a credential it cannot identify', () => {
    // Withholding a credential we cannot name would 503 a workspace on a guess.
    const { reg } = registry();
    assert.equal(reg.reject(null), false);
    assert.equal(reg.reject({}), false);
    assert.equal(reg.isSuspended(null), false);
    assert.equal(reg.isSuspended({}), false);
  });

  test('is bounded, and a SUSPENDED entry survives churn from sub-threshold ones', () => {
    // Evicting a suspended entry is indistinguishable from never having refused
    // the credential, so selection would hand the dead one straight back out.
    const { reg } = registry({ limit: 3 });
    for (let i = 0; i < 3; i++) reg.reject('dead');
    assert.equal(reg.isSuspended('dead'), true);

    for (const cold of ['a', 'b', 'c', 'd', 'e']) reg.reject(cold);

    assert.ok(reg.size() <= 3, 'stayed bounded');
    assert.equal(reg.isSuspended('dead'), true, 'suspension outlived the churn');
  });

  test('still frees a slot when every tracked credential is suspended', () => {
    const { reg } = registry({ limit: 2 });
    for (const cred of ['x', 'y', 'z']) for (let i = 0; i < 3; i++) reg.reject(cred);
    assert.ok(reg.size() <= 2, 'never grows unbounded, even with no cheap victim');
  });
});

describe('selectOwnerWorkspaceToken × suspension', () => {
  const FUTURE = Date.now() + 24 * 3600_000;
  const sessions = [{
    _id: 's1',
    session: { accountId: 'acct-1', workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'dead-tok', tokenExpiresAt: FUTURE }] },
  }];

  test('without the predicate, selection is byte-identical to before', () => {
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'acct-1');
    assert.equal(result.token, 'dead-tok');
    assert.equal(result.reason, 'ok');
  });

  test('a suspended credential is skipped despite a future expiry — the whole point', () => {
    // Recorded expiry is selection's ONLY liveness test, so a credential revoked
    // upstream reads as healthy here and is re-selected forever.
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'acct-1', cred => cred === 'dead-tok');
    assert.equal(result.token, null);
  });

  test('skipping reports session_expired, which is what reaches refresh-on-resolve', () => {
    // NOT not_connected: a session row genuinely exists. The distinction routes
    // the caller into a refresh rather than a dead end.
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'acct-1', () => true);
    assert.equal(result.reason, 'session_expired');
  });

  test('a healthy sibling row still wins when only one credential is suspended', () => {
    const twoRows = [
      sessions[0],
      { _id: 's2', session: { accountId: 'acct-1', workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'live-tok', tokenExpiresAt: FUTURE - 1000 }] } },
    ];
    const result = selectOwnerWorkspaceToken(twoRows, 'acme', 'acct-1', cred => cred === 'dead-tok');
    assert.equal(result.token, 'live-tok', 'suspension must not take the workspace down');
    assert.equal(result.reason, 'ok');
  });

  test('the provider is still reported for a fully-suspended workspace', () => {
    // The capability gate runs BEFORE the token check on writes, so it must
    // still see the right provider on a credential-less result.
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'acct-1', () => true);
    assert.equal(result.provider, 'linear');
  });
});
