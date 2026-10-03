/**
 * LIN-3282 commit 2 — the Connection-gated fallback at the
 * `resolveConnectionBackedAccess` `:660` guard.
 *
 * Arm-level proof (createConnectionAccess with fakes), covering the classes the
 * plan names: B1a/B1b/B2/B3, the multi-Connection selection the review required
 * (a wrong-scope Connection with the later expiry must not shadow the
 * right-scope one), ranking on the authoritative RECORD's expiry rather than
 * the stale mirror, and the null-preserving fall-throughs (no Connection, scope
 * mismatch, unauthorized, and the B4 "matched but not live, refresh yields
 * nothing" shape) which must stay byte-identical to the old `return null`.
 *
 * The real-store / real-resolver regression proof lives in
 * tests/unit/lin-3278-connection-credential-single-source.test.js (the
 * un-skipped residual).
 */
process.env.NODE_ENV = 'test';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential, CREDENTIAL_SOURCES } from '../../lib/credential-diagnostics.js';
import { BINDING_INTENT, selectIssueBinding } from '../../lib/workspace.js';

const ACCT = 'acct-3282';
const OTHER_ACCT = 'acct-other';
const URL_KEY = 'acme';
const BUFFER = 5 * 60 * 1000;
const HOUR = 3_600_000;
const now = () => Date.now();

/** A Connection row carrying a referent `{urlKey, provider, scope}`. */
function connection({ id, accountId = ACCT, provider = 'linear', unitId, scope, token = `tok-${id}`, expiresAt = now() + HOUR, referents } = {}) {
  return {
    _id: id,
    accountId,
    provider,
    unitId: unitId ?? scope,
    credentials: { token, tokenExpiresAt: expiresAt },
    referents: referents ?? [{ urlKey: URL_KEY, provider, scope }],
  };
}

/** An owner-record entry keyed by connection id (overlaid by authoritativeConnection). */
function record(connectionId, token, expiresAt) {
  return { token, tokenExpiresAt: expiresAt };
}

function ownerRow(workspace) {
  return { session: { workspaces: [workspace] }, workspaceIndex: 0 };
}

/** A legacy (non-connection-backed) owner workspace binding. */
function legacyBinding(provider, scope, token, expiresAt = now() + HOUR) {
  return { provider, scope, credentials: { token, tokenExpiresAt: expiresAt } };
}

function accessWith({ connections = [], row, records = {}, refresh = async () => null, gateAllows = true } = {}) {
  return createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => connections, mirrorCredentialIfToken: async () => true },
    ownerCredentialStore: { getByConnection: async (id) => records[id] ?? null },
    refreshConnection: refresh,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => row,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => gateAllows },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
}

async function resolve(access, options = {}) {
  return access.resolveConnectionBackedAccess({ urlKey: URL_KEY, ownerAccountId: ACCT, sessions: [], ...options });
}

describe('LIN-3282: B1a/B1b — a legacy selected binding resolves to the owner Connection', () => {
  test('B1a: a selector naming a legacy binding serves the same-scope Connection record', async () => {
    const row = ownerRow({
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [legacyBinding('linear', 'org-1', 'DEAD')],
      accessToken: 'DEAD',
    });
    const conn = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1', token: 'STALE' });
    const access = accessWith({
      connections: [conn], row,
      records: { [conn._id]: record(conn._id, 'HEALTHY', now() + HOUR) },
    });

    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.ok(out?.result, 'the fallback serves the Connection');
    assert.equal(out.result.token, 'HEALTHY');
    assert.equal(out.result.source, CREDENTIAL_SOURCES.CONNECTION);
    assert.ok(!('connectionSummary' in out), 'fallback mode never returns a connectionSummary');
  });

  test('B1b: a no-selector ISSUE read on a legacy workspace derives the binding scope and serves it', async () => {
    const row = ownerRow({
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [legacyBinding('linear', 'org-1', 'DEAD')],
      accessToken: 'DEAD',
    });
    const conn = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1', token: 'STALE' });
    const access = accessWith({
      connections: [conn], row,
      records: { [conn._id]: record(conn._id, 'HEALTHY', now() + HOUR) },
    });

    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE });
    assert.ok(out?.result);
    assert.equal(out.result.token, 'HEALTHY');
    assert.equal(out.result.source, CREDENTIAL_SOURCES.CONNECTION);
  });

  test('B1b multi-binding: the desired scope follows selectIssueBinding\'s legacy token-match rule (parity)', async () => {
    // Two legacy bindings for the active provider; the workspace scalar matches
    // the org-2 binding, so the desired scope is org-2 (else-first is not used).
    const workspace = {
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [legacyBinding('linear', 'org-1', 'TOK-1'), legacyBinding('linear', 'org-2', 'TOK-2')],
      accessToken: 'TOK-2',
    };
    // Parity: the same rule selectIssueBinding already applies for `source`.
    assert.equal(selectIssueBinding(workspace, { source: 'linear' }).binding.scope, 'org-2');

    const conn = connection({ id: `${ACCT}::linear::org-2`, scope: 'org-2', token: 'STALE-2' });
    const access = accessWith({
      connections: [conn], row: ownerRow(workspace),
      records: { [conn._id]: record(conn._id, 'HEALTHY-2', now() + HOUR) },
    });

    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE });
    assert.equal(out?.result?.token, 'HEALTHY-2', 'serves the token-matching binding scope (org-2)');
  });
});

describe('LIN-3282: B2 / multi-Connection — scope-filter before rank, then rank on the record', () => {
  function twoConnectionWorld({ c1Expiry, c2Expiry, c1MirrorExpiry, c1RecordExpiry } = {}) {
    const row = ownerRow({
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [legacyBinding('linear', 'org-1', 'DEAD')],
      accessToken: 'DEAD',
    });
    const c1 = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1', token: 'STALE-1', expiresAt: c1MirrorExpiry ?? now() + HOUR });
    const c2 = connection({ id: `${ACCT}::linear::org-2`, scope: 'org-2', token: 'STALE-2', expiresAt: c2Expiry ?? now() + 5 * HOUR });
    const records = {
      [c1._id]: record(c1._id, 'HEALTHY-1', c1RecordExpiry ?? c1Expiry ?? now() + HOUR),
      [c2._id]: record(c2._id, 'HEALTHY-2', c2Expiry ?? now() + 5 * HOUR),
    };
    return { row, connections: [c1, c2], records };
  }

  test('the wrong-scope Connection with the LATER expiry does not shadow the right-scope one (the review case)', async () => {
    const world = twoConnectionWorld({ c1Expiry: now() + HOUR, c2Expiry: now() + 5 * HOUR });
    const access = accessWith(world);

    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out?.result?.token, 'HEALTHY-1', 'org-1 must win despite org-2\'s later expiry');
  });

  test('the same holds with the expiries swapped', async () => {
    const world = twoConnectionWorld({ c1Expiry: now() + 5 * HOUR, c2Expiry: now() + HOUR });
    const access = accessWith(world);
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out?.result?.token, 'HEALTHY-1');
  });

  test('ranking uses the RECORD expiry, not a later stale mirror', async () => {
    // C1's mirror is expired, C2's mirror is later; C1's RECORD is healthy.
    const world = twoConnectionWorld({
      c1MirrorExpiry: now() - HOUR,
      c1RecordExpiry: now() + HOUR,
      c2Expiry: now() + 5 * HOUR,
    });
    const access = accessWith(world);
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out?.result?.token, 'HEALTHY-1', 'liveness/rank read the owner record, never the stale mirror');
  });

  test('two authorized Connections at the same scope, equal expiry: lowest _id wins, stable', async () => {
    const row = ownerRow({
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [legacyBinding('linear', 'org-1', 'DEAD')],
      accessToken: 'DEAD',
    });
    const a = connection({ id: `${ACCT}::linear::A`, scope: 'org-1', token: 'MIR-A' });
    const b = connection({ id: `${ACCT}::linear::B`, scope: 'org-1', token: 'MIR-B' });
    const expiry = now() + HOUR;
    const access = accessWith({
      connections: [b, a], row,
      records: { [a._id]: record(a._id, 'TOK-A', expiry), [b._id]: record(b._id, 'TOK-B', expiry) },
    });

    for (let i = 0; i < 8; i++) {
      const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
      assert.equal(out?.result?.token, 'TOK-A', `request ${i}: lowest _id must win the tie deterministically`);
    }
  });
});

describe('LIN-3282: null-preserving fall-throughs (byte-identical to the old guard)', () => {
  function legacyRow() {
    return ownerRow({
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [legacyBinding('linear', 'org-1', 'DEAD')],
      accessToken: 'DEAD',
    });
  }

  test('no Connection at all -> bare null, no connectionSummary', async () => {
    const access = accessWith({ connections: [], row: legacyRow() });
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out, null);
  });

  test('scope mismatch (only org-2 exists, target org-1) -> bare null', async () => {
    const c2 = connection({ id: `${ACCT}::linear::org-2`, scope: 'org-2' });
    const access = accessWith({ connections: [c2], row: legacyRow(), records: { [c2._id]: record(c2._id, 'TOK-2', now() + HOUR) } });
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out, null);
  });

  test('unauthorized Connection (another account) -> bare null', async () => {
    const c = connection({ id: `${OTHER_ACCT}::linear::org-1`, accountId: OTHER_ACCT, scope: 'org-1' });
    const access = accessWith({ connections: [c], row: legacyRow(), records: { [c._id]: record(c._id, 'TOK', now() + HOUR) } });
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out, null);
  });

  test('B4: matched, not live, refresh gated off -> bare null', async () => {
    const c = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1', token: 'MIRROR' });
    const access = accessWith({
      connections: [c], row: legacyRow(),
      records: { [c._id]: record(c._id, 'EXPIRED', now() - HOUR) },
      gateAllows: false,
    });
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out, null);
  });

  test('B4: matched, not live, refresh yields nothing -> bare null', async () => {
    const c = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1' });
    const access = accessWith({
      connections: [c], row: legacyRow(),
      records: { [c._id]: record(c._id, 'EXPIRED', now() - HOUR) },
      refresh: async () => null,
    });
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out, null);
  });

  test('not live but refresh succeeds -> serves with source refresh-on-resolve', async () => {
    const c = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1' });
    const access = accessWith({
      connections: [c], row: legacyRow(),
      records: { [c._id]: record(c._id, 'EXPIRED', now() - HOUR) },
      refresh: async () => ({ token: 'REFRESHED', expiresAt: now() + HOUR }),
    });
    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'linear', bindingScope: 'org-1' } });
    assert.equal(out?.result?.token, 'REFRESHED');
    assert.equal(out.result.source, CREDENTIAL_SOURCES.REFRESH_ON_RESOLVE);
  });
});

describe('LIN-3282: the fallback projects the BINDING scope, never connection.unitId', () => {
  test('GitHub: the served call scope is the legacy binding repo, not the installation id', async () => {
    const REPO = 'octo/repoA';
    const row = ownerRow({
      id: 'ws-1', urlKey: URL_KEY, provider: 'github',
      bindings: [legacyBinding('github', REPO, 'DEAD', now() + HOUR)],
      accessToken: 'DEAD',
    });
    const conn = {
      _id: `${ACCT}::github::99`,
      accountId: ACCT,
      provider: 'github',
      unitId: '99',
      credentials: { token: 'GH-TOKEN', installationId: '99', tokenExpiresAt: now() + HOUR },
      referents: [{ urlKey: URL_KEY, provider: 'github', scope: REPO }],
    };
    const access = accessWith({ connections: [conn], row, records: { [conn._id]: record(conn._id, 'GH-TOKEN', now() + HOUR) } });

    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE, selector: { source: 'github', bindingScope: REPO } });
    assert.ok(out?.result);
    assert.deepEqual(out.result.scope, { token: 'GH-TOKEN', repo: REPO });
    assert.notEqual(out.result.scope.repo, '99', 'unitId (installation id) must not leak into the call scope');
  });
});

describe('LIN-3282: L2 — the fallback reaches WORKSPACE and CREATE intents, not only ISSUE', () => {
  // Ledger L2: nothing pinned the fallback's WORKSPACE/CREATE reach — an
  // ISSUE-only mutation left the whole suite green. On a legacy-row-wins
  // workspace, a no-selector WORKSPACE/CREATE read must serve the same-scope
  // Connection record. Each case adds a later-expiry WRONG-scope Connection as
  // a distractor: an ISSUE-only mutation skips the fallback and drops into the
  // (scope-less) headless path, which would serve the later-expiry org-2
  // Connection instead — so the token assertion goes red.
  function legacyWorld() {
    const row = ownerRow({
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [legacyBinding('linear', 'org-1', 'DEAD')],
      accessToken: 'DEAD',
    });
    const c1 = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1', token: 'MIR-1', expiresAt: now() + HOUR });
    const c2 = connection({ id: `${ACCT}::linear::org-2`, scope: 'org-2', token: 'MIR-2', expiresAt: now() + 5 * HOUR });
    return {
      row,
      connections: [c1, c2],
      records: {
        [c1._id]: record(c1._id, 'HEALTHY-1', now() + HOUR),
        [c2._id]: record(c2._id, 'HEALTHY-2', now() + 5 * HOUR),
      },
    };
  }

  for (const [name, intent] of [['WORKSPACE', BINDING_INTENT.WORKSPACE], ['CREATE', BINDING_INTENT.CREATE]]) {
    test(`${name} intent, no selector: legacy-row-wins serves the same-scope Connection`, async () => {
      const access = accessWith(legacyWorld());
      const out = await resolve(access, { intent });
      assert.equal(out?.result?.token, 'HEALTHY-1', `${name}: must serve the same-scope Connection, not the later-expiry wrong-scope one`);
      assert.equal(out.result.source, CREDENTIAL_SOURCES.CONNECTION);
    });
  }
});

describe('LIN-3282: L3 (B3) — a connection-backed workspace with a stale active-binding marker', () => {
  // B3 shape: the workspace HAS a connection-backed binding, but its
  // `activeBinding` marker names a (provider, scope) that matches no binding, so
  // `activeConnectionBackedBinding` is null and ISSUE selection falls through.
  // No selector, ISSUE intent -> the fallback must still serve the Connection
  // record. Red under M1 (guard reverted to `return null`) and M6 (the
  // `legacyFallbackTarget` null-target branch removed).
  test('B3: stale marker scope, no selector, ISSUE intent -> serves the Connection record', async () => {
    const conn = connection({ id: `${ACCT}::linear::org-1`, scope: 'org-1', token: 'STALE' });
    const workspace = {
      id: 'ws-1', urlKey: URL_KEY, provider: 'linear',
      bindings: [{ provider: 'linear', scope: 'org-1', connectionId: conn._id }],
      activeBinding: { provider: 'linear', scope: 'org-STALE' },
    };
    const access = accessWith({
      connections: [conn], row: ownerRow(workspace),
      records: { [conn._id]: record(conn._id, 'HEALTHY', now() + HOUR) },
    });

    const out = await resolve(access, { intent: BINDING_INTENT.ISSUE });
    assert.ok(out?.result, 'the fallback serves the Connection');
    assert.equal(out.result.token, 'HEALTHY');
    assert.equal(out.result.source, CREDENTIAL_SOURCES.CONNECTION);
  });
});
