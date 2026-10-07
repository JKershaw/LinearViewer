/**
 * LIN-3278 acceptance witness — a Linear Connection's credential is a single
 * authoritative record, not the Connection row's stale mirror.
 *
 * Drives the REAL `resolveWorkspaceAccess` body (server.js) + the REAL
 * `createConnectionAccess` arm + the REAL `attemptSuspectCredentialRefresh` and
 * rejected-credential registry over real in-process (`@jkershaw/mangodb`)
 * stores; only the provider's accept/reject is simulated (it accepts only the
 * HEALTHY record token and a 401 marks the served fingerprint suspect exactly
 * as `routes/proxy.js`'s `logEvent` does). Each matrix state runs 8 repeated
 * proxy requests and asserts NONE of them switch 401<->200 and ALL of them are
 * 200.
 *
 * The states cover the divergences the plan names: a stale-LIVE mirror, a
 * stale-EXPIRED mirror (refresh gate allowed and suppressed), and a dead legacy
 * session-row scalar beside a healthy Connection. The strict per-request
 * `401 200 401 200` alternation observed in production is reproduced by the
 * "dead legacy scalar + expired mirror, ISSUE no-selector" state on the
 * pre-fix tree: the arm fell through to the legacy session scan (path A),
 * which served the dead scalar, the next request adopted the healthy record
 * (200), `accept()` cleared the mark, and the following request served the dead
 * scalar again.
 *
 * Run with: node --test tests/unit/lin-3278-connection-credential-single-source.test.js
 */
process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { convertToConnectionBacked, createConnectionAccess } from '../../lib/connection-credential.js';
import { linkProvider, normalizeProvider } from '../../lib/workspace.js';
import { UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, selectOwnerSessionRow, classifyWorkspaceFailure, describeWorkspaceResolution } from '../../lib/workspace-token-resolver.js';
import { CREDENTIAL_SOURCES, fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { workspaceTokenCacheKey, createWorkspaceTokenCache } from '../../lib/workspace-token-cache.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';
import { selectOwnerWorkspaceTokenExcludingSuperseded } from '../../lib/superseded-selection.js';
import { attemptSuspectCredentialRefresh as attemptImpl } from '../../lib/suspect-credential-refresh.js';

const SERVER_SRC = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
function sliceServerFunction(name) {
  const asyncStart = SERVER_SRC.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : SERVER_SRC.indexOf(`\nfunction ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found`);
  return SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n}', start) + 2);
}

const ACCT = 'acct-3278';
const STALE = 'lin_STALE_mirror';
const HEALTHY = 'lin_HEALTHY_record';
const DEAD = 'lin_DEAD_legacy_scalar';
const CONNECTION_ID = `${ACCT}::linear::org-1`;
const SEL = { source: 'linear', bindingScope: 'org-1' };
// LIN-3335: the pair-era resolver intent/selector options are gone; these labels
// survive the case matrix above but `resolveWorkspaceAccess` ignores them now.
const BINDING_INTENT = { ISSUE: 'ISSUE', WORKSPACE: 'WORKSPACE', CREATE: 'CREATE' };

/**
 * Assert the repeated-request sequence is stable: no adjacent 401<->200 switch
 * and every request served the authoritative HEALTHY record.
 */
function assertNoSwitch(statuses) {
  for (let i = 1; i < statuses.length; i++) {
    assert.equal(statuses[i], statuses[i - 1], `401<->200 switch at request ${i}: ${statuses.join(' ')}`);
  }
  assert.deepEqual(statuses, Array(statuses.length).fill(200), `observed ${statuses.join(' ')}`);
}

describe('LIN-3278 — stale Connection mirror vs authoritative owner record', () => {
  let dir, client, n = 0;
  before(async () => { dir = mkdtempSync(join(tmpdir(), 'lin3278-')); client = new MangoClient(dir); await client.connect(); });
  after(async () => { await client?.close?.(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  /**
   * Build a Linear Connection via the real converter, then rotate its
   * AUTHORITATIVE owner record to HEALTHY while leaving the row mirror at
   * STALE (the D9 "mirror may be stale" state). Optional divergences:
   *   - mirrorExpiryPast: the mirror's expiry is already in the past;
   *   - deadScalarOnRow: the connection-backed session row still carries a dead
   *     legacy scalar `accessToken` (a row persisted before the D1 sanitizer);
   *   - legacyRow: add a SEPARATE legacy session row (its own legacy binding +
   *     dead scalar) and make the connection-backed row win owner-row selection.
   */
  async function world({ mirrorExpiryPast = false, deadScalarOnRow = false, legacyRow = false, legacyOwnerWins = false } = {}) {
    const db = client.db(`l3278_${n++}`);
    const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
    const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
    const live = Date.now() + 3600_000;
    const mirrorExpiry = mirrorExpiryPast ? Date.now() - 1_000 : live;
    const session = { accountId: ACCT, workspaces: [{ id: 'ws-1', urlKey: 'acme', bindings: [] }] };
    linkProvider(session.workspaces[0], 'linear', 'org-1', { token: STALE, tokenExpiresAt: mirrorExpiry });
    const out = await convertToConnectionBacked({ connectionStore, ownerCredentialStore, session, accountId: ACCT, workspaceId: 'ws-1', provider: 'linear', scope: 'org-1', credentials: { token: STALE, tokenExpiresAt: mirrorExpiry }, refreshToken: 'R1', prior: 'none', writesEnabled: true });
    assert.equal(out.connectionBacked, true);
    assert.equal(await ownerCredentialStore.putByConnection(CONNECTION_ID, { accountId: ACCT, provider: 'linear', scope: 'org-1', token: HEALTHY, refreshToken: 'R2', tokenExpiresAt: live + 60_000 }), true);

    const rows = [{ _id: 'sid-conn', session: structuredClone(session) }];
    if (deadScalarOnRow) {
      // A legacy scalar still sitting on the connection-backed session row.
      rows[0].session.workspaces[0].accessToken = DEAD;
      rows[0].session.workspaces[0].tokenExpiresAt = live;
    }
    if (legacyRow) {
      const legacyWs = { id: 'ws-legacy', urlKey: 'acme', provider: 'linear', bindings: [] };
      linkProvider(legacyWs, 'linear', 'org-1', { token: DEAD, tokenExpiresAt: live });
      rows.push({ _id: 'sid-legacy', session: { accountId: ACCT, workspaces: [legacyWs] } });
      // Keep the connection-backed row as the owner row `selectOwnerSessionRow`
      // picks, so the arm resolves the connection binding (the dead sibling row
      // is what path A would still serve). `legacyOwnerWins` leaves the legacy
      // row as the pick instead — the residual state below.
      if (!legacyOwnerWins) rows[0].session.workspaces[0].tokenExpiresAt = live + 10_000_000;
    }
    return { db, connectionStore, ownerCredentialStore, session, rows };
  }

  function resolver(w, { cache, gateAllows = false }) {
    const registry = createRejectedCredentialRegistry();
    const connectionAccess = createConnectionAccess({
      connectionStore: w.connectionStore, ownerCredentialStore: w.ownerCredentialStore,
      refreshConnection: async () => null, selectOwnerSessionRow, normalizeProvider, fingerprintCredential,
      gate: { shouldAttempt: () => gateAllows }, bufferMs: TOKEN_REFRESH_BUFFER_MS,
    });
    const lifecycle = { recordEvent: async () => {} };
    const attemptSuspectCredentialRefresh = (a) => attemptImpl({
      ...a, registry, store: w.ownerCredentialStore, lifecycleEventStore: lifecycle,
      refreshAccessToken: async () => { throw new Error('no exchange'); }, persistSession: async () => {}, resolveProvider: () => null, resolveExchange: () => null,
      adoptConnectionCredential: (x) => connectionAccess.adoptConnectionCredentialForUrlKey(x),
      refreshConnection: (x) => connectionAccess.refreshConnectionForSuspect(x),
      ownerHasConnection: (x) => connectionAccess.ownerHasConnection(x),
    });
    const context = vm.createContext({
      UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution,
      CREDENTIAL_SOURCES, fingerprintCredential, CREDENTIAL_LIFECYCLE_EVENT_KINDS, workspaceTokenCacheKey,
      selectOwnerWorkspaceTokenExcludingSuperseded, rejectedCredentialRegistry: registry,
      accountStore: { resolveCanonicalAccountId: async (id) => id },
      sessionsCollection: { find: () => ({ toArray: async () => w.rows }) },
      workspaceTokenCache: cache, ownerCredentialStore: { get: async () => null },
      refreshOnResolveGate: { shouldAttempt: () => false }, credentialLifecycleEventStore: lifecycle,
      attemptSuspectCredentialRefresh, connectionAccess, Date,
      console: { log() {}, warn() {}, error() {} }, process: { env: { NODE_ENV: 'prod' } },
    });
    const fn = vm.runInContext(`${sliceServerFunction('resolveWorkspaceAccess')}\nresolveWorkspaceAccess`, context);
    return { fn, registry };
  }

  /** One proxy request: resolve, call "Linear" (accepts only HEALTHY), mark suspect on 401 exactly as routes/proxy.js logEvent does. */
  async function request(r, options) {
    const out = await r.fn('acme', ACCT, options);
    const status = out.token === HEALTHY ? 200 : 401;
    if (status === 401) r.registry.markSuspect(out.credentialFingerprint, { reason: 'provider-401' });
    return status;
  }

  async function run(w, options, gateAllows) {
    const r = resolver(w, { cache: createWorkspaceTokenCache(), gateAllows });
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push(await request(r, options));
    return statuses;
  }

  // --- the acceptance matrix -------------------------------------------------
  const MATRIX = [
    ['stale-LIVE mirror, ISSUE + selector', { mirrorExpiryPast: false }, { intent: BINDING_INTENT.ISSUE, selector: SEL }, false],
    ['stale-LIVE mirror, ISSUE no-selector', { mirrorExpiryPast: false }, { intent: BINDING_INTENT.ISSUE }, false],
    ['stale-EXPIRED mirror, ISSUE no-selector', { mirrorExpiryPast: true }, { intent: BINDING_INTENT.ISSUE }, false],
    ['stale-EXPIRED mirror, ISSUE + selector', { mirrorExpiryPast: true }, { intent: BINDING_INTENT.ISSUE, selector: SEL }, false],
    ['stale-EXPIRED mirror, WORKSPACE no-selector', { mirrorExpiryPast: true }, { intent: BINDING_INTENT.WORKSPACE }, false],
    ['stale-EXPIRED mirror, gate ALLOWED, ISSUE + selector', { mirrorExpiryPast: true }, { intent: BINDING_INTENT.ISSUE, selector: SEL }, true],
    // The strict production alternation: dead legacy scalar beside a healthy Connection.
    ['dead legacy scalar + EXPIRED mirror, ISSUE no-selector (strict toggle)', { mirrorExpiryPast: true, deadScalarOnRow: true }, { intent: BINDING_INTENT.ISSUE }, false],
    ['dead legacy scalar + EXPIRED mirror, ISSUE + selector', { mirrorExpiryPast: true, deadScalarOnRow: true }, { intent: BINDING_INTENT.ISSUE, selector: SEL }, false],
    ['dead legacy scalar + LIVE stale mirror, ISSUE no-selector', { mirrorExpiryPast: false, deadScalarOnRow: true }, { intent: BINDING_INTENT.ISSUE }, false],
    ['separate dead legacy session row + EXPIRED mirror, ISSUE + selector', { mirrorExpiryPast: true, legacyRow: true }, { intent: BINDING_INTENT.ISSUE, selector: SEL }, false],
  ];

  for (const [label, cfg, options, gateAllows] of MATRIX) {
    test(`${label}: 8 repeated requests never switch 401<->200 and all serve the record`, async () => {
      const w = await world(cfg);
      const statuses = await run(w, options, gateAllows);
      assertNoSwitch(statuses);
    });
  }

  // B1a — the LIN-3278 residual this ticket closes (LIN-3282 commit 2).
  //
  // When the owner has BOTH a connection-backed session row and a legacy
  // session row for the same urlKey, `selectOwnerSessionRow` can pick the
  // legacy row (it outranks the stripped connection row on the expiry-tier
  // tie-break). `selectIssueBinding` then returns that row's LEGACY binding for
  // the same (provider, scope). Before commit 2 the arm saw a non-connection
  // target and bailed to the legacy scan, which served the dead scalar; the
  // next request adopted the healthy record (200) and `accept()` cleared the
  // mark, so the strict `401 200 401 200` alternation persisted.
  //
  // The connection-first fallback at the `:660` guard now derives the desired
  // `(provider, scope)` from the selected legacy binding, scope-filters the
  // owner's referent Connections, overlays the authoritative record and serves
  // it — so every one of the 8 repeated requests is a 200 from the record.
  test('KNOWN RESIDUAL: legacy owner row beats a same-scope healthy Connection', async () => {
    const w = await world({ mirrorExpiryPast: true, legacyRow: true, legacyOwnerWins: true });
    const statuses = await run(w, { intent: BINDING_INTENT.ISSUE, selector: SEL }, false);
    assertNoSwitch(statuses);
  });

  test('the arm repairs the stale mirror to the record (best-effort CAS) after a resolve', async () => {
    const w = await world({ mirrorExpiryPast: true });
    const before = await w.connectionStore.readConnectionById(CONNECTION_ID);
    assert.equal(before.credentials.token, STALE, 'precondition: mirror is stale');
    const statuses = await run(w, { intent: BINDING_INTENT.WORKSPACE }, false);
    assertNoSwitch(statuses);
    const after = await w.connectionStore.readConnectionById(CONNECTION_ID);
    assert.equal(after.credentials.token, HEALTHY, 'the mirror was healed to the authoritative record');
  });

  describe('ConnectionStore.mirrorCredentialIfToken — CAS on the observed mirror token', () => {
    async function storeRow(token, tokenExpiresAt) {
      const db = client.db(`l3278_cas_${n++}`);
      const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
      await connectionStore.link(ACCT, 'linear', 'org-1', { token, tokenExpiresAt });
      return connectionStore;
    }

    test('repairs when the observed token still matches', async () => {
      const store = await storeRow(STALE, 1);
      assert.equal(await store.mirrorCredentialIfToken(CONNECTION_ID, STALE, { token: HEALTHY, tokenExpiresAt: 2 }), true);
      const row = await store.readConnectionById(CONNECTION_ID);
      assert.equal(row.credentials.token, HEALTHY);
      assert.equal(row.credentials.tokenExpiresAt, 2);
    });

    test('refuses when a concurrent refresh already advanced the mirror (never regresses it)', async () => {
      const store = await storeRow(STALE, 1);
      // A concurrent refresh rotated the row to CONCURRENT while the caller was
      // still holding the OLD observed token.
      assert.equal(await store.updateCredentials(CONNECTION_ID, { token: 'CONCURRENT', tokenExpiresAt: 3 }), true);
      assert.equal(await store.mirrorCredentialIfToken(CONNECTION_ID, STALE, { token: HEALTHY, tokenExpiresAt: 2 }), false);
      const row = await store.readConnectionById(CONNECTION_ID);
      assert.equal(row.credentials.token, 'CONCURRENT', 'the CAS must not overwrite a newer concurrent refresh');
    });

    test('repairs a row whose mirror token is absent (observed undefined)', async () => {
      const store = await storeRow(undefined, undefined);
      assert.equal(await store.mirrorCredentialIfToken(CONNECTION_ID, undefined, { token: HEALTHY, tokenExpiresAt: 2 }), true);
      assert.equal((await store.readConnectionById(CONNECTION_ID)).credentials.token, HEALTHY);
    });
  });
});
