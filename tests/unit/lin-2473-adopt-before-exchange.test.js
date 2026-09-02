/**
 * LIN-2473 Fix A: adopt-before-exchange on a suspect credential.
 *
 * These tests drive the REAL production function —
 * `lib/suspect-credential-refresh.js`'s `attemptSuspectCredentialRefresh`,
 * which `server.js` calls with its live singletons — not a copy of it. That
 * distinction is the whole point of this file's second revision: the first
 * one asserted against a hand-written mirror declared in the test, so both a
 * dead adopt branch (M1) and an unconditional one (M2) passed green, and a
 * defect on the fix's own success path (B1: the durable record's `scope` —
 * for Linear the ORG ID — reaching `routes/proxy.js`'s `scope ?? token`
 * credential substitution) shipped under a green CI.
 *
 * Only IO is faked (the durable store, the sessions thunk, the OAuth exchange,
 * session persistence). The registry, the fingerprint function, and the whole
 * refresh core beneath it (`refreshOwnerWorkspaceToken`) are the real modules.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { attemptSuspectCredentialRefresh } from '../../lib/suspect-credential-refresh.js';
import { UNSCOPED } from '../../lib/workspace-token-resolver.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';

const URL_KEY = 'acme-adopt';
const ACCOUNT = 'account-adopt';

// The Linear ORG ID a durable record carries in `scope` (lib/workspace.js:
// "Provider-specific scope: Linear = org id"). Public, low-entropy, and NOT a
// credential — the value B1 was leaking onto the provider lane.
const ORG_ID = 'org-abc-123';

function recordingLifecycleStore() {
  return { events: [], async recordEvent(e) { this.events.push(e); } };
}

/** Counts calls without changing behaviour. */
function spy(fn) {
  const wrapped = (...args) => { wrapped.calls++; return fn(...args); };
  wrapped.calls = 0;
  return wrapped;
}

/**
 * Deps for one scenario. `durable` is the record the store point-read returns;
 * `exchange` is the OAuth round-trip (throws by default, so any test that does
 * not expect one fails loudly rather than silently rotating).
 */
function makeDeps({ durable = null, exchange, provider = 'linear', registry } = {}) {
  let record = durable;
  const lifecycleEventStore = recordingLifecycleStore();
  const store = {
    get: spy(async () => record),
    async putIfRefreshToken(accountId, urlKey, expected, next) {
      if (!record || record.refreshToken !== expected) return false;
      record = { ...record, ...next };
      return true;
    },
    async markSpendIntent() { return true; },
    async clearSpendIntent() { return true; },
  };
  const refreshAccessToken = spy(exchange || (async () => {
    throw new Error('the OAuth exchange must not run in this scenario');
  }));
  return {
    urlKey: URL_KEY,
    ownerAccountId: ACCOUNT,
    provider,
    registry: registry || createRejectedCredentialRegistry(),
    store,
    lifecycleEventStore,
    refreshAccessToken,
    persistSession: async () => {},
    resolveProvider: () => ({}),
    loadSessions: async () => [],
    _currentRecord: () => record,
  };
}

describe('LIN-2473 Fix A — adopt-before-exchange (real production function)', () => {
  test('B1: the adopted credential is the durable record\'s TOKEN — the org id in `scope` never reaches the provider lane', async () => {
    const rejected = fingerprintCredential('superseded-token');
    const deps = makeDeps({
      durable: {
        provider: 'linear',
        token: 'fresh-durable-token',
        refreshToken: 'refresh-fresh',
        tokenExpiresAt: Date.now() + 3600_000,
        scope: ORG_ID,
      },
    });
    deps.registry.markSuspect(rejected, { reason: 'provider-401' });

    const result = await attemptSuspectCredentialRefresh({ ...deps, fingerprint: rejected });

    assert.ok(result, 'a differing durable credential must be adopted');
    assert.equal(result.token, 'fresh-durable-token');

    // The credential `routes/proxy.js` actually sends upstream is `scope ?? token`
    // (its provider-lane substitution). That value must be the token bytes.
    assert.equal(result.scope ?? result.token, 'fresh-durable-token',
      'the provider-lane substitution must resolve to the access token, never the org id');
    assert.equal(result.scope, undefined,
      'the adopt path must not return the durable record\'s scope at all — for Linear it is the org id, not a credential');
    assert.ok(!JSON.stringify(result).includes(ORG_ID),
      'the org id must appear nowhere in the adopted result');

    // Identity must key on the same bytes every caller fingerprints
    // (`scope ?? token`), or the suspect registry, credential-health and the
    // event log all key on a digest of a public org id.
    assert.equal(result.credentialFingerprint, fingerprintCredential('fresh-durable-token'));
    assert.equal(result.credentialFingerprint, fingerprintCredential(result.scope ?? result.token));
    assert.notEqual(result.credentialFingerprint, fingerprintCredential(ORG_ID));
  });

  test('adoption spends no exchange and leaves the refresh cooldown unconsumed', async () => {
    const rejected = fingerprintCredential('superseded-token');
    const registry = createRejectedCredentialRegistry();
    const deps = makeDeps({
      durable: { provider: 'linear', token: 'fresh-durable-token', refreshToken: 'r', tokenExpiresAt: Date.now() + 3600_000, scope: ORG_ID },
      registry,
    });
    registry.markSuspect(rejected, { reason: 'provider-401' });
    const shouldAttempt = spy(registry.shouldAttemptRefresh);
    registry.shouldAttemptRefresh = shouldAttempt;

    const result = await attemptSuspectCredentialRefresh({ ...deps, fingerprint: rejected });

    assert.ok(result);
    assert.equal(deps.refreshAccessToken.calls, 0, 'no OAuth exchange on the adopt path');
    assert.equal(shouldAttempt.calls, 0, 'the cooldown gate is never consulted, so nothing is consumed');
    assert.equal(deps.store.get.calls, 1, 'exactly one durable point-read');
    // Proof the window is genuinely unspent: a real attempt still opens.
    assert.equal(registry.shouldAttemptRefresh(rejected, `${ACCOUNT}:${URL_KEY}`), true);
  });

  test('a durable record holding the SAME credential falls through to the gated exchange, unchanged', async () => {
    const same = 'still-the-same-token';
    const rejected = fingerprintCredential(same);
    const deps = makeDeps({
      durable: { provider: 'linear', token: same, refreshToken: 'refresh-0', tokenExpiresAt: Date.now() - 1000 },
      exchange: async () => ({ access_token: 'rotated-token', refresh_token: 'refresh-1', expires_in: 3600 }),
    });
    deps.registry.markSuspect(rejected, { reason: 'provider-401' });

    const result = await attemptSuspectCredentialRefresh({ ...deps, fingerprint: rejected });

    assert.equal(deps.refreshAccessToken.calls, 1, 'nothing to adopt ⇒ today\'s exchange must still run');
    assert.ok(result);
    assert.equal(result.token, 'rotated-token');
  });

  test('a durable store miss returns null — today\'s behaviour resumes', async () => {
    const rejected = fingerprintCredential('dead-token');
    const deps = makeDeps({ durable: null });
    deps.registry.markSuspect(rejected, { reason: 'provider-401' });

    const result = await attemptSuspectCredentialRefresh({ ...deps, fingerprint: rejected });

    assert.equal(result, null);
    assert.equal(deps.refreshAccessToken.calls, 0, 'no durable record ⇒ nothing to exchange either');
  });

  test('a store read that throws is not worse than not having looked — it falls through to the exchange', async () => {
    const same = 'dead-token';
    const rejected = fingerprintCredential(same);
    const deps = makeDeps({
      durable: { provider: 'linear', token: same, refreshToken: 'refresh-0', tokenExpiresAt: Date.now() - 1000 },
      exchange: async () => ({ access_token: 'rotated-token', refresh_token: 'refresh-1', expires_in: 3600 }),
    });
    // Throw ONLY on the adopt point-read; the exchange core's own re-reads
    // (which follow) must still see the real record.
    const realGet = deps.store.get;
    let first = true;
    deps.store.get = async (...args) => {
      if (first) { first = false; throw new Error('store unreachable'); }
      return realGet(...args);
    };
    deps.registry.markSuspect(rejected, { reason: 'provider-401' });

    const result = await attemptSuspectCredentialRefresh({ ...deps, fingerprint: rejected });

    assert.equal(deps.refreshAccessToken.calls, 1, 'a failed point-read must not suppress the exchange arm');
    assert.equal(result.token, 'rotated-token');
  });

  test('never attempted for an UNSCOPED (owner-blind) caller', async () => {
    const deps = makeDeps({ durable: { provider: 'linear', token: 'anything', tokenExpiresAt: Date.now() + 3600_000 } });
    const result = await attemptSuspectCredentialRefresh({ ...deps, ownerAccountId: UNSCOPED, fingerprint: fingerprintCredential('x') });
    assert.equal(result, null);
    assert.equal(deps.store.get.calls, 0, 'the owner-blind exclusion must short-circuit before any read');
  });

  test('a credential the registry has NOT marked suspect is left alone entirely', async () => {
    const deps = makeDeps({ durable: { provider: 'linear', token: 'newer', tokenExpiresAt: Date.now() + 3600_000 } });
    const result = await attemptSuspectCredentialRefresh({ ...deps, fingerprint: fingerprintCredential('not-suspect') });
    assert.equal(result, null);
    assert.equal(deps.store.get.calls, 0);
  });

  test('a structured-credential provider is not adopted — its call scope is a pairing, not a bare token', async () => {
    // Jira's call scope is {email, apiToken, site}; a bare durable token is
    // half a credential, and its fingerprint is computed over a different
    // field than the caller's, so "differs" would be an artefact of shape.
    //
    // The exchange arm reads the store too, so to attribute the read count to
    // the ADOPT arm alone both cases below spend the cooldown up front: the
    // function then returns at its own `shouldAttemptRefresh` gate, and any
    // read that did happen can only have come from the adopt arm.
    const durable = { provider: 'jira', token: 'some-other-token', refreshToken: 'r', tokenExpiresAt: Date.now() + 3600_000, scope: 'site-id' };

    const jira = makeDeps({ provider: 'jira', durable });
    const rejected = fingerprintCredential('jira-api-token');
    jira.registry.markSuspect(rejected, { reason: 'provider-401' });
    jira.registry.shouldAttemptRefresh(rejected, `${ACCOUNT}:${URL_KEY}`); // consume the window
    const jiraResult = await attemptSuspectCredentialRefresh({ ...jira, fingerprint: rejected });

    assert.equal(jira.store.get.calls, 0, 'the adopt arm must not point-read for a structured-credential provider');
    assert.equal(jiraResult, null);

    // Control: the identical setup on Linear DOES read and adopt, so the
    // assertion above is about the provider gate and nothing else.
    const linear = makeDeps({ provider: 'linear', durable: { ...durable, provider: 'linear' } });
    linear.registry.markSuspect(rejected, { reason: 'provider-401' });
    linear.registry.shouldAttemptRefresh(rejected, `${ACCOUNT}:${URL_KEY}`);
    const linearResult = await attemptSuspectCredentialRefresh({ ...linear, fingerprint: rejected });

    assert.equal(linear.store.get.calls, 1);
    assert.equal(linearResult.token, 'some-other-token');
  });
});

describe('LIN-2473 Fix A — the adopt arm must not starve the LIN-2327/2329 escalation path', () => {
  test('a byte-identical refresh still records the escalation (the mutation the adopt branch could silently eat)', async () => {
    // The durable record holds the SAME credential that was rejected, so the
    // adopt arm must decline; the exchange then hands back byte-identical
    // bytes, which is exactly what LIN-2327 escalates on. If the adopt arm
    // ever fires unconditionally, this path becomes unreachable and the
    // byte-identical loop goes silent again.
    const same = 'byte-identical-token';
    const rejected = fingerprintCredential(same);
    const deps = makeDeps({
      durable: { provider: 'linear', token: same, refreshToken: 'refresh-bi', tokenExpiresAt: Date.now() + 24 * 3600 * 1000 },
      exchange: async () => ({ access_token: same, refresh_token: 'rotated-refresh-bi', expires_in: 3600 }),
    });
    deps.registry.markSuspect(rejected, { reason: 'provider-401' });
    const escalations = [];
    deps.registry.recordByteIdenticalRejection = (fp) => escalations.push(fp);

    const result = await attemptSuspectCredentialRefresh({ ...deps, fingerprint: rejected });

    assert.equal(result, null, 'a byte-identical refresh is not a recovery — the caller keeps what it had');
    assert.deepEqual(escalations, [rejected], 'the byte-identical rejection must still be counted toward escalation');

    const skips = deps.lifecycleEventStore.events.filter(
      e => e.kind === 'refresh_skip' && e.detail?.branch === 'byte-identical-after-rejection');
    assert.equal(skips.length, 1, 'the refresh_skip lifecycle event must still be recorded');
    assert.match(skips[0].detail.fingerprint, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(deps.lifecycleEventStore.events).includes(same),
      'no lifecycle event may carry raw token bytes');
  });
});
