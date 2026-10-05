/**
 * The single connection-credential seam (LIN-3124 PR2, S2 / D1 / D5 / D9 / D18).
 *
 * Everything that touches a connection-backed credential lives here, in one
 * module:
 *
 *   - `isConnectionBacked` — the D1 discriminator, re-exported from the
 *     store-free `lib/connection-binding.js`;
 *   - the per-request hydration side-table (the only writer of
 *     `connection-binding.js`'s WeakMaps);
 *   - `sanitizeSessionForPersist` — the backstop that keeps a connection-backed
 *     credential out of a persisted session row;
 *   - `createHydrationMiddleware` / `createConnectionRowLoader` — one batched
 *     read of the session's connection-backed Connections per request;
 *   - `authorizeConnection` — the one owner-scoped read authorization;
 *   - `createConnectionRefresher` — the re-keyed refresh, whose single-flight is
 *     keyed `conn:${connectionId}` and is the ONLY `inflight` registration on
 *     this path (outer entrants receive the function by injection and never
 *     coalesce themselves, so the LIN-1546 double-registration deadlock cannot
 *     recur).
 *
 *   - `convertToConnectionBacked` — the PR3 write flip (D2a/D8/D18/D11): the
 *     only writer of a `connectionId` onto a binding.
 *
 * The store INSTANCES are injected, never imported, so this module is IO-free
 * and unit-testable with fakes.
 */
import { calculateExpiresAt, isDefinitiveRevocation, TokenRefreshError, LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS } from './token-refresh.js';
import { normalizeProviderName, selectIssueBinding, selectDefaultBinding, BINDING_INTENT, getBindingsForWorkspace, getBindingCredentials, getWorkspaceToken } from './workspace.js';
import { CREDENTIAL_SOURCES } from './credential-diagnostics.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from './credential-lifecycle-events.js';
import {
  isConnectionBacked,
  isRefreshTokenKind,
  isRemintKind,
  setBindingCredential,
  setWorkspaceCredential,
  readBindingCredential,
  unitIdForBinding,
  bindingShapeAt,
  activeConnectionBackedBinding,
} from './connection-binding.js';
import { liveConnections, selectBestConnection, connectionResolveResult, ownerHeadlessContext } from './connection-access.js';
import { releaseOrphanOwnerRecord } from './connection-lifecycle.js';

export { isConnectionBacked, bindingShapeAt };

/** The connection ids referenced by a session's connection-backed bindings (unique). */
export function collectSessionConnectionIds(session) {
  const ids = new Set();
  for (const workspace of session?.workspaces || []) {
    for (const binding of workspace?.bindings || []) {
      if (isConnectionBacked(binding)) ids.add(binding.connectionId);
    }
  }
  return [...ids];
}

/**
 * D1 backstop, wired into both session write paths (`MongoSessionStore.set` and
 * `server.js`'s `persistSessionRow`). Strips `accessToken`/`credentials`/
 * `tokenExpiresAt` from a connection-backed workspace's scalar mirror, and
 * `credentials` from any connection-backed binding. Never throws; a legacy
 * shape (no `connectionId`) is untouched.
 *
 * @param {Object} session
 * @returns {Object} the same session object (mutated in place)
 */
export function sanitizeSessionForPersist(session) {
  try {
    if (!session || !Array.isArray(session.workspaces)) return session;
    for (const workspace of session.workspaces) {
      if (!workspace) continue;
      const active = activeConnectionBackedBinding(workspace);
      if (isConnectionBacked(workspace) || active) {
        delete workspace.accessToken;
        delete workspace.credentials;
        delete workspace.tokenExpiresAt;
      }
      if (Array.isArray(workspace.bindings)) {
        for (const binding of workspace.bindings) {
          if (isConnectionBacked(binding)) delete binding.credentials;
        }
      }
    }
  } catch (err) {
    console.error('[connection-credential] sanitizeSessionForPersist failed:', err);
  }
  return session;
}

/**
 * D7/D15 owner-scoped read authorization: a Connection may be read only by the
 * canonical owner of its `accountId`. Both sides are canonicalized so an
 * account merge does not re-home rows.
 *
 * @param {Object} connection
 * @param {string|null} ownerCanonicalId - the caller's canonical account id
 * @param {(id: string) => (string|Promise<string>)} [resolveCanonicalAccountId]
 * @returns {Promise<boolean>}
 */
export async function authorizeConnection(connection, ownerCanonicalId, resolveCanonicalAccountId = (id) => id) {
  if (!connection || typeof ownerCanonicalId !== 'string') return false;
  try {
    const connectionCanonical = await resolveCanonicalAccountId(connection.accountId);
    return connectionCanonical === ownerCanonicalId;
  } catch {
    return false;
  }
}

/**
 * LIN-3125 Phase 1 (C1) — the held picker's owner-scoped read: every Connection
 * an account owns for one provider, each authorized. Deliberately named NOT
 * `readConnection*`: it lives here (a reader module) so the D6 identifier law
 * stays intact and `READ_ALLOWED_MODULES` is never widened; callers receive it
 * by injection (server.js) rather than importing the store themselves. Never
 * throws; `[]` on a missing account/store.
 *
 * L1: a put-born/legacy row (no `referents` array) is excluded, so the picker
 * never offers a dual-write row — the same exclusion the sweep loader applies.
 *
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} deps.connectionStore
 * @param {string|null} deps.accountId - the caller's canonical account id
 * @param {string} deps.provider
 * @param {(id: string) => (string|Promise<string>)} [deps.resolveCanonicalAccountId]
 * @returns {Promise<Object[]>}
 */
export async function listAuthorizedAccountConnections({
  connectionStore,
  accountId,
  provider,
  resolveCanonicalAccountId = (id) => id,
} = {}) {
  if (!accountId || !provider || typeof connectionStore?.readConnectionsByAccountPrefix !== 'function') return [];
  try {
    const rows = await connectionStore.readConnectionsByAccountPrefix(accountId);
    const wanted = normalizeProviderName(provider);
    const out = [];
    for (const connection of rows || []) {
      if (!connection) continue;
      // L1: a put-born/legacy row (no `referents` array) is never
      // connection-managed, so it is never offered — matching the sweep
      // loader's exclusion (`readReferencedConnections` requires the field).
      if (!Array.isArray(connection.referents)) continue;
      if (normalizeProviderName(connection.provider) !== wanted) continue;
      if (await authorizeConnection(connection, accountId, resolveCanonicalAccountId)) out.push(connection);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * LIN-3125 Phase 3 (C1 wiring): bind {@link listAuthorizedAccountConnections} to
 * a store, so the flow entry hook and the held picker route receive an IO-free
 * function and import no reader module. `server.js` builds the one production
 * instance; exporting the binding as a factory is what makes that wiring
 * testable (the Phase 3 tests build the SAME instance and drive hook -> picker
 * through it).
 *
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} deps.connectionStore
 * @param {(id: string) => (string|Promise<string>)} [deps.resolveCanonicalAccountId]
 * @returns {(args: {accountId: string, provider: string}) => Promise<Object[]>}
 */
export function createAuthorizedAccountConnectionReader({ connectionStore, resolveCanonicalAccountId } = {}) {
  return (args = {}) => listAuthorizedAccountConnections({ connectionStore, resolveCanonicalAccountId, ...args });
}

/**
 * LIN-3125 Phase 3 (C1/D15): return a COPY of a held Connection row's stored
 * credentials for scope enumeration. Kept in the reader module so the picker
 * route never performs a raw `.credentials` read (the D15 census stays at 13)
 * and `READ_ALLOWED_MODULES` is untouched; the route receives it by injection.
 * Never throws; `{}` on a missing row.
 *
 * @param {Object} connection
 * @returns {Object}
 */
export function heldConnectionCredentials(connection) {
  return { ...(connection?.credentials || {}) };
}

/**
 * D1 batched loader: returns a Map of `connectionId -> connection row` for one
 * session, from ONE `readConnectionsByIds` call. Legacy-only sessions do zero
 * reads.
 *
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} deps.connectionStore
 * @returns {(session: Object) => Promise<Map<string, Object>>}
 */
export function createConnectionRowLoader({ connectionStore } = {}) {
  return async function loadSessionConnections(session) {
    const ids = collectSessionConnectionIds(session);
    if (ids.length === 0 || typeof connectionStore?.readConnectionsByIds !== 'function') return new Map();
    const rows = await connectionStore.readConnectionsByIds(ids);
    return new Map((rows || []).map(row => [row._id, row]));
  };
}

/**
 * Fill the side-table for one session: authorize each connection, then write the
 * binding credentials (and, for the active binding, the workspace credentials).
 * An unhydrated/missing/unauthorized Connection stays unhydrated — fail closed.
 * Never throws; returns the number of bindings hydrated.
 *
 * @param {Object} session
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} deps.connectionStore
 * @param {(id: string) => (string|Promise<string>)} [deps.resolveCanonicalAccountId]
 * @returns {Promise<number>}
 */
export async function hydrateSession(session, { connectionStore, resolveCanonicalAccountId = (id) => id } = {}) {
  try {
    if (!session || !Array.isArray(session.workspaces)) return 0;
    const ids = collectSessionConnectionIds(session);
    if (ids.length === 0 || !connectionStore) return 0;
    const rows = await connectionStore.readConnectionsByIds(ids);
    const byId = new Map((rows || []).map(row => [row._id, row]));
    const ownerCanonical = session.accountId ? await resolveCanonicalAccountId(session.accountId) : null;

    let hydrated = 0;
    for (const workspace of session.workspaces) {
      if (!workspace) continue;
      for (const binding of workspace.bindings || []) {
        if (!isConnectionBacked(binding)) continue;
        const connection = byId.get(binding.connectionId);
        if (!connection) continue; // missing/unhydrated: fail closed
        if (ownerCanonical === null) continue;
        if (!(await authorizeConnection(connection, ownerCanonical, resolveCanonicalAccountId))) continue;
        const credentials = connection.credentials || {};
        setBindingCredential(binding, credentials);
        hydrated += 1;
        if (activeConnectionBackedBinding(workspace) === binding) {
          setWorkspaceCredential(workspace, credentials);
        }
      }
    }
    return hydrated;
  } catch (err) {
    console.error('[connection-credential] hydrateSession failed:', err);
    return 0;
  }
}

/**
 * One global middleware after the session middleware (D1). A legacy-only
 * session does no store read and is a no-op.
 *
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} deps.connectionStore
 * @param {(id: string) => (string|Promise<string>)} [deps.resolveCanonicalAccountId]
 * @returns {(req, res, next) => Promise<void>}
 */
export function createHydrationMiddleware({ connectionStore, resolveCanonicalAccountId } = {}) {
  return async function hydrateConnections(req, _res, next) {
    try {
      await hydrateSession(req?.session, { connectionStore, resolveCanonicalAccountId });
    } catch (err) {
      console.error('[connection-credential] hydration middleware failed:', err);
    }
    return next();
  };
}

/** Evict every referent's cached token after a connection refresh (S7 fan-out). */
function fanOutEviction(referents, ownerAccountId, evict) {
  if (typeof evict !== 'function') return;
  for (const referent of referents || []) {
    try {
      if (referent?.urlKey) evict(referent.urlKey, ownerAccountId);
    } catch { /* best effort */ }
  }
}

/**
 * LIN-2236 lifecycle events for the re-keyed core (LIN-3124 PR3, N1): the same
 * four kinds `doOwnerRefresh` records, attributed to the Connection with the
 * `connectionId` in `detail` (a Connection spans referents, so `urlKey` is
 * null). Optional and never throws, like the legacy helper.
 */
async function recordConnectionEvent(lifecycleEventStore, { ownerAccountId, provider, connectionId, kind, detail }) {
  if (!lifecycleEventStore) return;
  try {
    await lifecycleEventStore.recordEvent({ accountId: ownerAccountId ?? null, urlKey: null, provider, kind, detail: { ...detail, connectionId } });
  } catch (err) {
    console.error('[connection-credential] lifecycle event failed:', err);
  }
}

function convergeConnection(record, provider) {
  return { token: record.token, expiresAt: record.tokenExpiresAt, refreshToken: record.refreshToken, provider, scope: record.scope };
}

/**
 * The re-keyed refresh core. Refresh-token kinds run the durable read →
 * spend-intent → exchange → CAS → re-read-on-`invalid_grant` core against the
 * CONNECTION-keyed owner record, then mirror the rotated credential onto the
 * Connection monotonically (D9). Remint kinds re-mint from the Connection row on
 * a transient in-memory binding and write the patch back. Success fans out cache
 * eviction over the referents.
 *
 * @param {Object} deps
 * @param {import('./connection-store.js').ConnectionStore} deps.connectionStore
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.ownerCredentialStore
 * @param {(connection: Object) => ({refreshCredential?: Function})} [deps.resolveProvider]
 * @param {(provider: string) => (Function|null)} [deps.resolveExchange]
 * @param {Function} [deps.refreshAccessToken] - the Linear exchange (default)
 * @param {Function} [deps.fetchImpl]
 * @param {number} [deps.now]
 * @param {(urlKey: string, ownerAccountId: string) => void} [deps.evict]
 * @param {import('./credential-lifecycle-events.js').CredentialLifecycleEventStore} [deps.lifecycleEventStore] - N1: optional, as in `doOwnerRefresh`
 * @returns {(connectionId: string, ownerAccountId: string) => Promise<Object|null>}
 */
export function createConnectionRefresher({
  connectionStore,
  ownerCredentialStore,
  resolveProvider,
  resolveExchange,
  refreshAccessToken,
  fetchImpl,
  now,
  evict,
  lifecycleEventStore,
} = {}) {
  // The ONLY `inflight` registration on the connection path (key `conn:${id}`).
  const inflight = new Map();

  async function refreshConnection(connectionId, ownerAccountId) {
    if (!connectionId) return null;
    const key = `conn:${connectionId}`;
    let promise = inflight.get(key);
    if (!promise) {
      promise = runConnectionRefresh(connectionId, ownerAccountId, {
        connectionStore, ownerCredentialStore, resolveProvider, resolveExchange, refreshAccessToken, fetchImpl, now, evict, lifecycleEventStore
      });
      inflight.set(key, promise);
      // Two-branch .then (never .finally) so cleanup does not mint an unhandled
      // rejection when runConnectionRefresh throws.
      promise.then(
        () => { if (inflight.get(key) === promise) inflight.delete(key); },
        () => { if (inflight.get(key) === promise) inflight.delete(key); }
      );
    }
    return promise;
  }

  return refreshConnection;
}

async function runConnectionRefresh(connectionId, ownerAccountId, {
  connectionStore, ownerCredentialStore, resolveProvider, resolveExchange, refreshAccessToken, fetchImpl, now, evict, lifecycleEventStore
}) {
  if (!connectionStore || !ownerCredentialStore) return null;
  const connection = await connectionStore.readConnectionById(connectionId);
  if (!connection) return null; // deleted/racing: nothing to serve
  const provider = normalizeProviderName(connection.provider);
  const referents = Array.isArray(connection.referents) ? connection.referents : [];

  if (isRemintKind(provider)) {
    const providerImpl = resolveProvider ? resolveProvider(connection) : null;
    if (!providerImpl?.refreshCredential) return null;
    const transient = { provider, scope: connection.unitId, credentials: { ...(connection.credentials || {}) } };
    const patch = await providerImpl.refreshCredential(transient, { fetchImpl, now });
    if (!patch || typeof patch.token !== 'string') return null;
    await connectionStore.updateCredentials(connectionId, patch);
    fanOutEviction(referents, ownerAccountId, evict);
    return { token: patch.token, expiresAt: patch.tokenExpiresAt, provider };
  }

  if (!isRefreshTokenKind(provider)) return null;

  const event = (kind, detail) => recordConnectionEvent(lifecycleEventStore, { ownerAccountId, provider, connectionId, kind, detail });

  const record = await ownerCredentialStore.getByConnection(connectionId);
  if (!record?.refreshToken) {
    await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SKIP, { branch: 'no-durable-record' });
    return null;
  }
  if (normalizeProviderName(record.provider) !== provider) {
    console.warn(`Connection credential ${connectionId} is labelled ${record.provider} in the ${provider} partition — refusing to refresh it`);
    return null;
  }
  const exchange = resolveExchange ? resolveExchange(provider) : (provider === 'linear' ? refreshAccessToken : null);
  if (typeof exchange !== 'function') return null;

  const attempted = record.refreshToken;
  const pending = record.pendingSpend;
  if (pending?.refreshToken === attempted) {
    const ageMs = Date.now() - new Date(pending.attemptedAt).getTime();
    if (ageMs > LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS) {
      await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_FAIL, { reason: 'spend-intent-past-grace', ageMs });
      throw new TokenRefreshError("Connection credential rotation died mid-flight and its spend-intent marker is past Linear's reuse grace window", 'EXPIRED');
    }
  }
  await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.SPEND_INTENT, { attempted: true });
  await ownerCredentialStore.markSpendIntentByConnection(connectionId, attempted);

  let tokenData;
  try {
    tokenData = await exchange(attempted);
  } catch (err) {
    await ownerCredentialStore.clearSpendIntentByConnection(connectionId);
    // A spurious `invalid_grant` means a concurrent winner already rotated the
    // connection-keyed record; re-read and converge. Everything else rethrows.
    if (isDefinitiveRevocation(err)) {
      const fresh = await ownerCredentialStore.getByConnection(connectionId);
      if (fresh?.refreshToken && fresh.refreshToken !== attempted) {
        await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SUCCESS, { via: 'converged-race-loser' });
        return convergeConnection(fresh, provider);
      }
    }
    await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_FAIL, { reason: err?.code || 'unknown' });
    throw err;
  }

  const isSameCredential = tokenData.access_token === record.token && Number.isFinite(record.tokenExpiresAt);
  const tokenExpiresAt = isSameCredential ? record.tokenExpiresAt : calculateExpiresAt(tokenData.expires_in);
  const won = await ownerCredentialStore.putIfRefreshTokenByConnection(connectionId, attempted, {
    provider,
    scope: record.scope,
    token: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt
  });
  if (won) await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SUCCESS, { via: isSameCredential ? 'byte-identical' : 'rotated' });
  if (!won) {
    const fresh = await ownerCredentialStore.getByConnection(connectionId);
    if (fresh?.refreshToken) {
      await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SUCCESS, { via: 'converged-cas-loser' });
      return convergeConnection(fresh, provider);
    }
    await event(CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_FAIL, { reason: 'cas-lost-no-record' });
    throw new TokenRefreshError('Connection credential rotation could not be persisted (record changed or unavailable)', 'UNKNOWN');
  }

  // D9: the owner CAS is authoritative; the Connection mirror follows, and a
  // failed mirror is repaired by the next resolve's durable re-read.
  await connectionStore.updateCredentials(connectionId, { token: tokenData.access_token, tokenExpiresAt });
  fanOutEviction(referents, ownerAccountId, evict);
  return { token: tokenData.access_token, expiresAt: tokenExpiresAt, refreshToken: tokenData.refresh_token, provider, scope: record.scope };
}

/**
 * LIN-3241 (A): the binding scope to project for a chosen Connection. A
 * Connection's `unitId` is its identity (a GitHub App installation id, a Jira
 * site, a Linear org) — never necessarily the binding's call scope. For the
 * GitHub family the binding scope is the `owner/name` repo, so projecting
 * `unitId` asked the wrong repo for every binding on the Connection. Read the
 * owner's own session-row workspace binding on THIS Connection, preferring the
 * active one; with no unambiguous match, return `undefined` so
 * {@link connectionResolveResult} falls back to `unitId` (byte-identical for
 * Linear/Jira and for a caller with no owner session row).
 *
 * Store-free (the owner workspace is session-resident), so it adds no IO and no
 * store import to this module.
 */
function bindingScopeForConnection(connection, ownerWorkspace) {
  if (!ownerWorkspace || !Array.isArray(ownerWorkspace.bindings)) return undefined;
  const onConnection = ownerWorkspace.bindings.filter(
    b => b && b.provider === connection.provider && b.connectionId === connection._id
  );
  if (onConnection.length === 0) return undefined;
  const active = activeConnectionBackedBinding(ownerWorkspace);
  if (active && onConnection.includes(active)) return active.scope;
  return onConnection.length === 1 ? onConnection[0].scope : undefined;
}

/**
 * LIN-3282: the desired `(provider, scope)` for the connection-first fallback at
 * the `resolveConnectionBackedAccess` `:660` guard, when the SELECTED target
 * binding is null or not connection-backed.
 *
 *   - B1a/B2 (a legacy `targetBinding` the selector named): that binding's own
 *     `(provider, scope)`. Deterministic — the selector picked it.
 *   - B1b/B3 (`targetBinding` null after the ISSUE fallthrough): among the owner
 *     workspace's bindings for the active provider, the existing
 *     `selectIssueBinding` legacy rule — the binding whose token equals
 *     `getWorkspaceToken(workspace)`, else the first (lib/workspace.js
 *     `selectIssueBinding`, §1 row 3). A connection-backed workspace with >1
 *     binding for the provider already refuses (`BINDING_REQUIRED`) upstream, so
 *     this arm never reaches here on that shape.
 *
 * Returns null when no deterministic target exists (no owner workspace, no
 * binding for the provider, or no scope to filter on) — the caller then keeps
 * today's `return null`, byte-identical.
 *
 * @param {Object|null} ownerWorkspace
 * @param {Object|null} targetBinding
 * @param {string} headlessProvider
 * @returns {{provider: string, scope: *}|null}
 */
function legacyFallbackTarget(ownerWorkspace, targetBinding, headlessProvider) {
  if (targetBinding) {
    if (targetBinding.provider == null || targetBinding.scope == null) return null;
    return { provider: targetBinding.provider, scope: targetBinding.scope };
  }
  if (!ownerWorkspace || headlessProvider == null) return null;
  const bindings = getBindingsForWorkspace(ownerWorkspace).filter(b => b && b.provider === headlessProvider);
  if (bindings.length === 0) return null;
  const token = getWorkspaceToken(ownerWorkspace);
  const matched = bindings.find(b => getBindingCredentials(b)?.token === token) || bindings[0];
  if (!matched || matched.scope == null) return null;
  return { provider: headlessProvider, scope: matched.scope };
}

/**
 * LIN-3124 PR3 (D7/D12/D5/D16/D17): the owner-scoped connection-first read arm
 * and its re-keyed gate, built as one seam so every `readConnectionsByReferent`
 * / `getByConnection` call lives in `lib/connection-credential.js` (D6(b′)) and
 * the protected modules import none of it.
 *
 * `server.js` injects the stores, the single `refreshConnection`, the
 * canonicalizer, the resolver's row selector and the gate. `UNSCOPED` callers
 * never reach it (the caller guards), and it never caches anything itself.
 *
 * @returns {{
 *   resolveConnectionBackedAccess: Function,
 *   refreshConnectionForWorkspace: Function,
 *   connectionRefreshGateAllows: Function,
 * }}
 */
export function createConnectionAccess({
  connectionStore,
  ownerCredentialStore,
  refreshConnection,
  resolveCanonicalAccountId = (id) => id,
  selectOwnerSessionRow,
  normalizeProvider,
  fingerprintCredential,
  gate,
  lifecycleEventStore,
  bufferMs,
  now = () => Date.now(),
} = {}) {
  /** D5 re-keyed gate: `conn:${connectionId}`, fingerprint from the record. */
  async function connectionRefreshGateAllows(connectionId, provider, ownerAccountId, urlKey) {
    if (!isRefreshTokenKind(provider)) return true;
    let fingerprint = null;
    try {
      const record = await ownerCredentialStore.getByConnection(connectionId);
      fingerprint = record?.token ? fingerprintCredential(record.token) : null;
    } catch (err) {
      console.error(`[connection-access] connection record read failed for ${connectionId}:`, err);
    }
    if (gate.shouldAttempt(`conn:${connectionId}`, fingerprint)) return true;
    try {
      await lifecycleEventStore?.recordEvent({
        accountId: ownerAccountId, urlKey, provider,
        kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.REFRESH_SKIP,
        detail: { branch: 'connection-cooldown-gate' },
      });
    } catch (err) {
      console.error('[connection-access] lifecycle event failed:', err);
    }
    return false;
  }

  /**
   * Gate-then-refresh one Connection (N3: the caller authorizes first). Gate
   * suppression and non-taxonomy failures return null; a `TokenRefreshError` is
   * RETHROWN (review blocker 4) so a human entrant's `isDefinitiveRevocation`
   * sees a genuine revocation and can take the D4 revoke path.
   */
  async function refreshConnectionForWorkspace(connection, ownerAccountId, urlKey) {
    const provider = normalizeProviderName(connection.provider);
    if (!(await connectionRefreshGateAllows(connection._id, provider, ownerAccountId, urlKey))) return null;
    try {
      return await refreshConnection(connection._id, ownerAccountId);
    } catch (err) {
      console.error(`[connection-access] connection refresh failed for ${connection._id}:`, err);
      if (err instanceof TokenRefreshError) throw err;
      return null;
    }
  }

  /**
   * The ungated refresh, for an entrant that has ALREADY consulted the D5 gate
   * itself (`ensureValidToken`), so one attempt passes exactly one gate (review
   * blocker 4). Errors propagate to the caller's revocation handling.
   */
  async function refreshConnectionUngated(connectionId, ownerAccountId) {
    return refreshConnection(connectionId, ownerAccountId);
  }

  /** The headless lanes keep their non-throwing contract: any failure is a miss. */
  async function refreshConnectionQuietly(connection, ownerAccountId, urlKey) {
    try {
      return await refreshConnectionForWorkspace(connection, ownerAccountId, urlKey);
    } catch {
      return null;
    }
  }

  /**
   * LIN-3278: the authoritative credential for one owner Connection.
   *
   * For a refresh-token kind (Linear/Jira) the connection-keyed owner record is
   * the single source of truth: `runConnectionRefresh` CASes it first and only
   * mirrors it onto the row afterwards, so the row's `credentials` is a mirror
   * that "may be stale" (D9). Serving the mirror made repeated resolves flip a
   * rejected stale token against the healthy record. Overlay the record's
   * `token`/`tokenExpiresAt` onto a transient view, and judge liveness on the
   * RECORD's expiry — a stale mirror whose expiry has already passed must not
   * disqualify a live record.
   *
   * When the mirror's token diverges, repair it best-effort with a CAS on the
   * observed mirror token (`mirrorCredentialIfToken`), so a concurrent refresh
   * is never regressed. A failed read or repair is logged and returns the
   * unchanged mirror view — never worse than before. Non-refresh kinds and a
   * record with no token keep today's mirror behaviour, byte-identical.
   */
  async function authoritativeConnection(connection) {
    const provider = normalizeProviderName(connection.provider);
    if (!isRefreshTokenKind(provider) || typeof ownerCredentialStore?.getByConnection !== 'function') {
      return connection;
    }
    let record = null;
    try {
      record = await ownerCredentialStore.getByConnection(connection._id);
    } catch (err) {
      console.error(`[connection-access] owner record read failed for ${connection._id}:`, err);
      return connection;
    }
    if (!record?.token) return connection;
    const mirrorToken = connection.credentials?.token;
    if (mirrorToken !== record.token && typeof connectionStore?.mirrorCredentialIfToken === 'function') {
      try {
        await connectionStore.mirrorCredentialIfToken(connection._id, mirrorToken, {
          token: record.token,
          tokenExpiresAt: record.tokenExpiresAt,
        });
      } catch (err) {
        console.error(`[connection-access] mirror repair failed for ${connection._id}:`, err);
      }
    }
    return {
      ...connection,
      credentials: { ...(connection.credentials || {}), token: record.token, tokenExpiresAt: record.tokenExpiresAt },
    };
  }

  /**
   * LIN-3282 (commit 2): the Connection-gated fallback at the `:660` guard.
   *
   * Reached only when the SELECTED target binding is null or not
   * connection-backed (B1a/B1b/B2/B3). Derives the desired `(provider, scope)`
   * ({@link legacyFallbackTarget}), reads the owner's Connections by referent,
   * **scope-filters BEFORE anything is ranked** (a later-expiry wrong-scope
   * Connection must not shadow the right-scope one — the failure
   * `resolveOwnerConnectionFor` causes), authorizes, overlays each authorized
   * Connection with its authoritative owner record, and serves the best of the
   * LIVE set ranked on the RECORD's expiry (never the stale mirror).
   *
   * Every non-serving outcome returns a BARE `null`, exactly as the old guard
   * did: no Connection, no scope match, unauthorized, or matched-but-not-live
   * and refresh yields nothing (B4). It never returns a `{connectionSummary}`,
   * so `connectionSummary` stays null and the durable-refresh branch
   * (`server.js:2639`) and failure classification see no change. The
   * deliberate legacy fall-through is preserved byte-identically.
   */
  async function resolveLegacyFallback({ urlKey, ownerAccountId, ownerWorkspace, targetBinding, headlessProvider }) {
    const desired = legacyFallbackTarget(ownerWorkspace, targetBinding, headlessProvider);
    if (!desired) return null;

    let connections;
    try {
      connections = await connectionStore.readConnectionsByReferent(urlKey, desired.provider);
    } catch (err) {
      console.error(`[connection-access] legacy-fallback connection lookup failed for ${urlKey}:`, err);
      return null;
    }
    if (!Array.isArray(connections) || connections.length === 0) return null;

    // Scope filter on the REFERENT (written as `{urlKey, provider, scope}` by
    // `link()`), before ranking or authorizing. Empty -> null.
    const scoped = connections.filter(c => Array.isArray(c.referents) && c.referents.some(r =>
      r && r.urlKey === urlKey && r.provider === desired.provider && r.scope === desired.scope));
    if (scoped.length === 0) return null;

    // Deterministic tie order (fallback mode only).
    scoped.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));

    const authorized = [];
    for (const connection of scoped) {
      let ok = false;
      try {
        ok = await authorizeConnection(connection, ownerAccountId, resolveCanonicalAccountId);
      } catch {
        ok = false;
      }
      if (ok) authorized.push(connection);
    }
    if (authorized.length === 0) return null;

    // Overlay the authoritative owner record before judging liveness/ranking.
    const overlaid = [];
    for (const connection of authorized) overlaid.push(await authoritativeConnection(connection));

    const live = liveConnections(overlaid, { now: now(), bufferMs });
    if (live.length > 0) {
      const chosen = selectBestConnection(live);
      return { result: connectionResolveResult(chosen, { bindingScope: desired.scope, source: CREDENTIAL_SOURCES.CONNECTION, fingerprintCredential }) };
    }

    // Not live: one gated quiet refresh of the best candidate; refreshed ->
    // serve. Gated/failed/revoked alike yield nothing (B4) -> bare null.
    const chosen = selectBestConnection(overlaid);
    const refreshed = await refreshConnectionQuietly(chosen, ownerAccountId, urlKey);
    if (refreshed?.token) {
      const refreshedConnection = { ...chosen, credentials: { ...chosen.credentials, token: refreshed.token, tokenExpiresAt: refreshed.expiresAt } };
      return { result: connectionResolveResult(refreshedConnection, { bindingScope: desired.scope, source: CREDENTIAL_SOURCES.REFRESH_ON_RESOLVE, fingerprintCredential }) };
    }
    return null;
  }

  async function resolveConnectionBackedAccess({ urlKey, ownerAccountId, sessions, intent, selector }) {
    const { provider: headlessProvider, ownerWorkspace } = ownerHeadlessContext(sessions, urlKey, ownerAccountId, { selectOwnerSessionRow, normalizeProvider });

    // LIN-3241 (E): when the caller declared an intent, the arm resolves the
    // TARGET binding by the intent rule — slice 1's `selectIssueBinding` /
    // `selectDefaultBinding`, never a re-created scan. A refusal is surfaced as
    // this seam's `{token:null, reason, provider, bindings}`; a legacy
    // (non-connection) target falls through to the session scan, which is the
    // legacy active-binding behaviour this slice deliberately preserves.
    //
    // LIN-3241 (F1): an intent is a SELECTION instruction against the owner's
    // session-row workspace. With no owner session row (logout / session expiry
    // while a proxy token is still live) there is no workspace to select within,
    // so selection is skipped entirely and the arm keeps the pre-PR D12 headless
    // path — serve the live Connection exactly as before this slice. Running the
    // selection against a null workspace instead returned `fallthrough` and made
    // the arm bail before reading any Connection, regressing every proxy route
    // to 503 `owner_signed_out`. `bindingScopeForConnection(connection, null)`
    // then falls back to `unitId`, byte-identical to the pre-PR projection.
    let targetBinding = null;
    if (ownerWorkspace && (intent === BINDING_INTENT.ISSUE || intent === BINDING_INTENT.CREATE || intent === BINDING_INTENT.WORKSPACE)) {
      const selection = intent === BINDING_INTENT.ISSUE
        ? selectIssueBinding(ownerWorkspace, selector)
        : selectDefaultBinding(ownerWorkspace, selector);
      if (selection.error) {
        return {
          result: {
            token: null,
            reason: selection.error.code === 'UNKNOWN_BINDING' ? 'unknown_binding' : 'binding_required',
            provider: selection.error.provider ?? null,
            bindings: Array.isArray(selection.error.bindings) ? selection.error.bindings : [],
            credentialFingerprint: null,
          },
        };
      }
      targetBinding = selection.binding ?? null;
      // LIN-3278: `selectIssueBinding` returns `fallthrough` for a workspace
      // whose ISSUE read names no binding (the common proxy `GET /issues/:id`,
      // no `source`/`bindingScope` query). Bailing here sent that read to the
      // legacy session scan (path A), which cannot serve a connection-backed
      // credential — its scalar mirror is stripped — so it fell back to any
      // stale legacy scalar still sitting in a session row and produced the
      // observed per-request 401/200 alternation. Resolve a fallthrough to the
      // workspace's ACTIVE connection-backed binding (the same binding
      // `selectDefaultBinding` already returns for WORKSPACE/CREATE), so the arm
      // reaches the Connection. A legacy workspace has no active
      // connection-backed binding, so its fallthrough to the legacy scan is
      // byte-identical.
      if (!targetBinding && selection.fallthrough) {
        targetBinding = activeConnectionBackedBinding(ownerWorkspace);
      }
      // LIN-3282 (commit 2): a null OR non-connection-backed target used to
      // bail to the legacy session scan even when the owner holds an authorized,
      // scope-matching Connection — the residual per-request 401/200 toggle.
      // Run the Connection-gated fallback instead; it returns a bare null for
      // every non-serving outcome, so the deliberate legacy fall-through is
      // preserved byte-identically.
      if (!targetBinding || !isConnectionBacked(targetBinding)) {
        return resolveLegacyFallback({ urlKey, ownerAccountId, ownerWorkspace, targetBinding, headlessProvider });
      }
    }

    const provider = targetBinding ? targetBinding.provider : headlessProvider;
    // The binding scope is the SELECTION-only identity of the target (a GitHub
    // repo, a Linear org, a Jira site). It never becomes a credential: the
    // credential always comes from the Connection via connectionResolveResult.
    const scopeFor = (connection) =>
      targetBinding ? targetBinding.scope : bindingScopeForConnection(connection, ownerWorkspace);

    let connections;
    try {
      connections = await connectionStore.readConnectionsByReferent(urlKey, provider);
    } catch (err) {
      console.error(`[connection-access] connection lookup failed for ${urlKey}:`, err);
      return { connectionSummary: { ownerCount: 0, ownerLive: false, otherLive: false, storeError: true } };
    }
    if (!Array.isArray(connections) || connections.length === 0) return null;
    // The plan's connection-first arm reads the Connection the binding names;
    // for the default/legacy path this is a no-op filter.
    if (targetBinding) connections = connections.filter(c => c._id === targetBinding.connectionId);

    const ownerConnections = [];
    let otherLive = false;
    for (const connection of connections) {
      let authorized = false;
      try {
        authorized = await authorizeConnection(connection, ownerAccountId, resolveCanonicalAccountId);
      } catch {
        authorized = false;
      }
      if (authorized) ownerConnections.push(connection);
      else if (liveConnections([connection], { now: now(), bufferMs }).length > 0) otherLive = true;
    }

    // LIN-3278: judge liveness on the authoritative record, not the row mirror.
    const effectiveOwnerConnections = [];
    for (const connection of ownerConnections) {
      effectiveOwnerConnections.push(await authoritativeConnection(connection));
    }

    const live = liveConnections(effectiveOwnerConnections, { now: now(), bufferMs });
    const connectionSummary = { ownerCount: ownerConnections.length, ownerLive: live.length > 0, otherLive, storeError: false };

    if (live.length > 0) {
      const chosen = selectBestConnection(live);
      return { result: connectionResolveResult(chosen, { bindingScope: scopeFor(chosen), source: CREDENTIAL_SOURCES.CONNECTION, fingerprintCredential }), connectionSummary };
    }
    if (ownerConnections.length === 0) return { connectionSummary };

    const chosen = selectBestConnection(effectiveOwnerConnections);
    const refreshed = await refreshConnectionQuietly(chosen, ownerAccountId, urlKey);
    if (refreshed?.token) {
      const refreshedConnection = { ...chosen, credentials: { ...chosen.credentials, token: refreshed.token, tokenExpiresAt: refreshed.expiresAt } };
      return { result: connectionResolveResult(refreshedConnection, { bindingScope: scopeFor(refreshedConnection), source: CREDENTIAL_SOURCES.REFRESH_ON_RESOLVE, fingerprintCredential }), connectionSummary };
    }
    return { connectionSummary };
  }

  /**
   * LIN-3124 PR3 (D7 title lane): the owner-scoped connection-first arm for
   * title resolution. Requires the owner's session row (no row => no
   * post-logout title widening), serves a LIVE Connection credential only (no
   * refresh), and returns a transient workspace for `fetchWorkspaceIssues`.
   */
  async function resolveConnectionBackedWorkspace({ urlKey, ownerAccountId, sessions }) {
    const ownerRow = selectOwnerSessionRow(sessions, urlKey, ownerAccountId);
    if (!ownerRow) return null;
    const provider = normalizeProvider(ownerRow.session.workspaces[ownerRow.workspaceIndex]);
    let connections;
    try {
      connections = await connectionStore.readConnectionsByReferent(urlKey, provider);
    } catch (err) {
      console.error(`[connection-access] title connection lookup failed for ${urlKey}:`, err);
      return null;
    }
    if (!Array.isArray(connections) || connections.length === 0) return null;
    const authorized = [];
    for (const connection of connections) {
      let ok = false;
      try {
        ok = await authorizeConnection(connection, ownerAccountId, resolveCanonicalAccountId);
      } catch {
        ok = false;
      }
      if (ok) authorized.push(connection);
    }
    // LIN-3282 (commit 3): the same idiom LIN-3278 fixed for the arm — judge
    // liveness and serve on the AUTHORITATIVE owner record, never the row
    // mirror (which "may be stale", D9). Overlay before the liveness check, so
    // a stale-expiry mirror cannot disqualify a live record. A failed read or
    // CAS repair returns the unchanged mirror view (best-effort; the repair is
    // the proxy lane's existing behavior, now shared by this title lane).
    const overlaid = [];
    for (const connection of authorized) overlaid.push(await authoritativeConnection(connection));
    const live = liveConnections(overlaid, { now: now(), bufferMs });
    if (live.length === 0) return null;
    const chosen = selectBestConnection(live);
    const credentials = chosen.credentials || {};
    return {
      urlKey,
      id: ownerRow.session.workspaces[ownerRow.workspaceIndex]?.id,
      provider: chosen.provider,
      accessToken: credentials.token,
      tokenExpiresAt: credentials.tokenExpiresAt,
      credentials,
      bindings: [{ provider: chosen.provider, scope: chosen.unitId, credentials }],
      activeBinding: { provider: chosen.provider, scope: chosen.unitId },
    };
  }

  /**
   * LIN-3124 PR3 (D7 adopt entrant): connection-keyed adopt-before-exchange.
   * Finds the workspace's ACTIVE connection-backed binding, authorizes the
   * owner, and returns the Connection credential when it differs from the
   * request's rejected fingerprint. The caller hydrates the side-table with it.
   */
  async function adoptConnectionCredential({ workspace, ownerAccountId, fingerprint }) {
    const marker = workspace?.activeBinding;
    if (!marker || !Array.isArray(workspace.bindings)) return null;
    const binding = workspace.bindings.find(b => b && b.provider === marker.provider && b.scope === marker.scope);
    if (!isConnectionBacked(binding)) return null;
    let connection;
    try {
      connection = await connectionStore.readConnectionById(binding.connectionId);
    } catch (err) {
      console.error(`[connection-access] adopt read failed for ${binding.connectionId}:`, err);
      return null;
    }
    if (!connection) return null;
    if (!(await authorizeConnection(connection, ownerAccountId, resolveCanonicalAccountId))) return null;
    // LIN-3282 (commit 3): compare against the AUTHORITATIVE owner record, not
    // the row mirror, so a stale mirror does not make a healthy record look
    // like a different credential (or a rejected one), and the adopted token is
    // the record's. Non-refresh-token kinds and a missing record return the
    // unchanged mirror view (authoritativeConnection's contract), byte-identical.
    const effective = await authoritativeConnection(connection);
    const credentials = effective.credentials || {};
    if (!credentials.token) return null;
    if (fingerprint && fingerprint === fingerprintCredential(credentials.token)) return null;
    return { connectionId: binding.connectionId, binding, credentialBag: credentials, token: credentials.token, expiresAt: credentials.tokenExpiresAt };
  }

  /**
   * The owner's best authorized Connection for urlKey+provider (D12 selection,
   * no refresh). Shared by the suspect entrant's adopt/refresh arms.
   */
  async function resolveOwnerConnectionFor({ urlKey, ownerAccountId, provider }) {
    let connections;
    try {
      connections = await connectionStore.readConnectionsByReferent(urlKey, provider);
    } catch (err) {
      console.error(`[connection-access] suspect connection lookup failed for ${urlKey}:`, err);
      return null;
    }
    if (!Array.isArray(connections) || connections.length === 0) return null;
    const authorized = [];
    for (const connection of connections) {
      let ok = false;
      try {
        ok = await authorizeConnection(connection, ownerAccountId, resolveCanonicalAccountId);
      } catch {
        ok = false;
      }
      if (ok) authorized.push(connection);
    }
    return authorized.length > 0 ? selectBestConnection(authorized) : null;
  }

  /**
   * LIN-3124 PR3 review blocker 8: does the owner have an authorized Connection
   * for urlKey+provider? The suspect lane must not fall back to the LEGACY
   * durable record when one matched but its adopt/refresh came back empty (a
   * gated or failed refresh) — that record is a different credential (D18
   * rows 5/6/8, or a legacy sibling at the same urlKey).
   */
  async function ownerHasConnection({ urlKey, ownerAccountId, provider }) {
    return (await resolveOwnerConnectionFor({ urlKey, ownerAccountId, provider })) !== null;
  }

  /** LIN-3124 PR3 (D7 suspect remedy 1): connection-keyed adopt (Linear only). */
  async function adoptConnectionCredentialForUrlKey({ urlKey, ownerAccountId, provider, fingerprint }) {
    if (provider !== 'linear') return null;
    const connection = await resolveOwnerConnectionFor({ urlKey, ownerAccountId, provider });
    if (!connection) return null;
    const record = await ownerCredentialStore.getByConnection(connection._id);
    if (!record?.token) return null;
    const durableFingerprint = fingerprintCredential(record.token);
    if (durableFingerprint === fingerprint) return null;
    return { token: record.token, expiresAt: record.tokenExpiresAt, provider, credentialFingerprint: durableFingerprint };
  }

  /**
   * LIN-3241 (F3): the owner binding's call scope for a Connection, read
   * lazily from the owner session row. `undefined` when there is no owner row
   * (or no loader), which keeps `connectionResolveResult`'s
   * `bindingScope ?? connection.unitId` fallback — byte-identical for
   * Linear/Jira and for the post-logout path.
   */
  async function bindingScopeForOwnerConnection({ connection, urlKey, ownerAccountId, loadSessions }) {
    if (typeof loadSessions !== 'function') return undefined;
    try {
      const sessions = await loadSessions();
      const { ownerWorkspace } = ownerHeadlessContext(sessions, urlKey, ownerAccountId, { selectOwnerSessionRow, normalizeProvider });
      return bindingScopeForConnection(connection, ownerWorkspace);
    } catch (err) {
      console.error('[connection-access] suspect owner-workspace read failed:', err);
      return undefined;
    }
  }

  /** LIN-3124 PR3 (D7 suspect remedy 2): refresh the owner's Connection. */
  async function refreshConnectionForSuspect({ urlKey, ownerAccountId, provider, loadSessions }) {
    const connection = await resolveOwnerConnectionFor({ urlKey, ownerAccountId, provider });
    if (!connection) return null;
    const refreshed = await refreshConnectionQuietly(connection, ownerAccountId, urlKey);
    if (!refreshed?.token) return null;
    const refreshedConnection = { ...connection, credentials: { ...connection.credentials, token: refreshed.token, tokenExpiresAt: refreshed.expiresAt } };
    // LIN-3241 (F3): project the BINDING scope, not `connection.unitId`. The
    // recovered credential is re-`set` under the base `workspaceTokenCache` key
    // by the caller's cache-hit `recovered` path, so on a GitHub
    // connection-backed workspace it would otherwise serve
    // `repo: <installationId>` for the TTL after a recovery — undoing the arm
    // fix this slice pins.
    const bindingScope = await bindingScopeForOwnerConnection({ connection: refreshedConnection, urlKey, ownerAccountId, loadSessions });
    const result = connectionResolveResult(refreshedConnection, { bindingScope, source: CREDENTIAL_SOURCES.REFRESH_ON_RESOLVE, fingerprintCredential });
    return { ...result, credentialFingerprint: fingerprintCredential(result.scope ?? result.token) };
  }

  return { resolveConnectionBackedAccess, resolveConnectionBackedWorkspace, refreshConnectionForWorkspace, refreshConnectionUngated, connectionRefreshGateAllows, adoptConnectionCredential, adoptConnectionCredentialForUrlKey, refreshConnectionForSuspect, ownerHasConnection };
}

/**
 * LIN-3124 PR3 review blocker 2: after a successful Connection refresh inside a
 * request, point that request's side-table at the NEW credential, so the rest of
 * the request (a post-401 retry render, or the handler after a proactive
 * refresh) never calls the provider with the credential it started with.
 * The hydration middleware is the only other side-table writer, and it runs
 * once, at request start. No-op for a legacy workspace.
 *
 * @param {Object} workspace - the session-resident workspace
 * @param {{token: string, expiresAt?: number}|null} refreshed
 * @returns {boolean} true when the side-table was updated
 */
export function rehydrateAfterRefresh(workspace, refreshed) {
  const binding = activeConnectionBackedBinding(workspace);
  if (!binding || !refreshed?.token) return false;
  const next = { ...(readBindingCredential(binding) || {}), token: refreshed.token, tokenExpiresAt: refreshed.expiresAt };
  setBindingCredential(binding, next);
  setWorkspaceCredential(workspace, next);
  return true;
}

/**
 * LIN-3124 PR3 (D3/S5): the sweep's connection-data loader. Built here (the one
 * seam) so the sweep module imports no store and no `getByConnection` call
 * leaves this file (D6(f)). Returns the `referents`-bearing Connection rows
 * (LIN-3127-born rows, with no `referents` field, are excluded) plus the
 * connection-keyed owner record for each refresh-token-kind row.
 *
 * @returns {() => Promise<{rows: Object[], recordsById: Map<string, Object|null>}>}
 */
export function createSweepConnectionDataLoader({ connectionStore, ownerCredentialStore } = {}) {
  return async function loadConnectionData() {
    const rows = ((await connectionStore?.readReferencedConnections?.()) || []).map(row => ({
      ...row,
      // Precomputed here so the sweep reads no raw `.credentials` (D15 census).
      hasInstallationId: !!(row.credentials && row.credentials.installationId),
    }));
    const recordsById = new Map();
    for (const row of rows) {
      if (!isRefreshTokenKind(row.provider)) continue;
      recordsById.set(row._id, (await ownerCredentialStore?.getByConnection?.(row._id)) ?? null);
    }
    return { rows, recordsById };
  };
}

// ---------------------------------------------------------------------------
// LIN-3124 PR3 checkpoint E — the write flip (S3: D2a / D8 / D18 / D11)
// ---------------------------------------------------------------------------

/**
 * D11: `CONNECTION_BACKED_WRITES` (default on). Governs CREATION only: with it
 * off a new binding stays legacy exactly as before the cutover, while an
 * existing connection-backed binding still updates its Connection on re-auth
 * (a downgrade would lose the fresh grant). Off is `off`/`false`/`0`/`no`.
 *
 * @param {Object} [env]
 * @returns {boolean}
 */
export function connectionBackedWritesEnabled(env = process.env) {
  const raw = String(env?.CONNECTION_BACKED_WRITES ?? '').trim().toLowerCase();
  return !['off', 'false', '0', 'no'].includes(raw);
}

/** User-facing copy for a conversion that must be retried (D18 rows 4, 8, 9). */
export const CONNECTION_RETRY_TITLE = 'Connection Not Saved';
export const CONNECTION_RETRY_MESSAGE = 'We could not finish saving this connection. Anything already connected is unchanged. Please try again in a moment.';

/**
 * D2a eligibility: linear, Jira OAuth and the GitHub family. Never local, Jira
 * Basic (its token is omitted, ruling `04461f8f`) or PAT (which never reaches a
 * seam). Read from the call-site credentials, never the merged binding, so a
 * Basic link over an OAuth site cannot inherit `authType: 'oauth'`.
 */
function isConnectionEligible(provider, credentials) {
  if (provider === 'linear' || isRemintKind(provider)) return true;
  return provider === 'jira' && credentials?.authType === 'oauth';
}

/** `${accountId}::${provider}::${unitId}` split on its first two separators. */
function connectionIdParts(connectionId) {
  const first = connectionId.indexOf('::');
  const second = first < 0 ? -1 : connectionId.indexOf('::', first + 2);
  if (second < 0) return null;
  return { accountId: connectionId.slice(0, first), provider: connectionId.slice(first + 2, second), unitId: connectionId.slice(second + 2) };
}

/**
 * D8/D18 step 0: a legacy OAuth `jira` binding elsewhere in the session-resident
 * workspace reads the staged record `acct::urlKey::jira`, so converting would
 * duplicate (or, at finalize, delete) its rotating refresh token. A Basic
 * binding reads no owner record and does not trigger the gate.
 */
function hasLegacyOAuthJiraReader(workspace, scope) {
  return (workspace.bindings || []).some(b =>
    b && b.provider === 'jira' && b.scope !== scope && !isConnectionBacked(b) && b.credentials?.authType === 'oauth'
  );
}

function referentMatches(connection, referent) {
  return Array.isArray(connection?.referents) && connection.referents.some(r =>
    r && r.urlKey === referent.urlKey && r.provider === referent.provider && r.scope === referent.scope
  );
}

/** Credential fields a Connection row carries (never a refresh token). */
function connectionCredentials(credentials) {
  const { refreshToken: _omit, ...rest } = credentials || {};
  return rest;
}

const noopFinalize = async () => false;

/**
 * D18 step 3: rewrite the binding to `{provider, scope, connectionId}` and, when
 * it is the active provider's binding (linkProvider's `isActive` rule), set the
 * D2 marker and strip the scalar mirror. The side-table is filled for the rest
 * of this request; the next request's hydration fills it from the store.
 */
function rewriteAsConnectionBacked(workspace, provider, scope, connectionId, credentials) {
  workspace.bindings = workspace.bindings || [];
  const next = { provider, scope, connectionId };
  const index = workspace.bindings.findIndex(b => b && b.provider === provider && b.scope === scope);
  if (index >= 0) workspace.bindings[index] = next;
  else workspace.bindings.push(next);
  const hydrated = connectionCredentials(credentials);
  setBindingCredential(next, hydrated);
  if (workspace.provider === provider) {
    workspace.activeBinding = { provider, scope };
    delete workspace.accessToken;
    delete workspace.credentials;
    delete workspace.tokenExpiresAt;
    delete workspace.refreshToken;
    setWorkspaceCredential(workspace, hydrated);
  }
}

/**
 * LIN-3125 Phase 1 (C3) — the held branch of {@link convertToConnectionBacked}:
 * bind a scope onto an already-held Connection, with NO credential/owner-record
 * write and NO legacy fallback. Every failure is `retryable` with zero store
 * writes, in this order: D11 off (F2); workspace/account missing; the row read
 * fails or is missing; the row is not owned by the caller (`authorizeConnection`,
 * which also refuses a foreign account); the row is a put-born/legacy row with
 * no `referents` array (L1); the row's provider does not match the requested
 * provider (L2); `addReferent` reports no existing row.
 * On success it adds the referent (never `link()`) and rewrites the binding to
 * LIN-3124's `{provider, scope, connectionId}` shape. It never calls
 * `establishAccount` and stamps no `identityAuthenticatedAt`.
 */
async function convertHeldConnectionBacked({
  connectionStore,
  session,
  accountId,
  workspaceId,
  provider,
  scope,
  heldConnectionId,
  resolveCanonicalAccountId = (id) => id,
  writesEnabled,
}) {
  const retryable = { connectionBacked: false, error: 'retryable', finalize: noopFinalize };
  // D11 (F2): a held add is creation, so it is gated; off => retryable before
  // any store call.
  if (!writesEnabled) return retryable;
  const workspace = (session?.workspaces || []).find(w => w && w.id === workspaceId);
  if (!workspace || !accountId) return retryable;
  if (typeof connectionStore?.readConnectionById !== 'function' || typeof connectionStore?.addReferent !== 'function') return retryable;

  const connection = await connectionStore.readConnectionById(heldConnectionId);
  if (!connection) return retryable;
  if (!(await authorizeConnection(connection, accountId, resolveCanonicalAccountId))) return retryable;
  // L1: a put-born/legacy row (no `referents` array) is never connection-managed;
  // converting it would make it "managed" (put's D10 skip) yet never deletable
  // (no `origin`). Refuse before any write.
  if (!Array.isArray(connection.referents)) return retryable;
  // L2: the held connection must be the requested provider, or the binding would
  // be backed by another provider's connection and refresh/eviction fan-out
  // would cross providers (silently deciding LIN-2397). Refuse before any write.
  if (normalizeProviderName(connection.provider) !== normalizeProviderName(provider)) return retryable;

  const referent = { urlKey: workspace.urlKey, provider, scope };
  const added = await connectionStore.addReferent(heldConnectionId, referent);
  if (!added) return retryable;

  rewriteAsConnectionBacked(workspace, provider, scope, heldConnectionId, connection.credentials);
  return { connectionBacked: true, connectionId: heldConnectionId, error: null, finalize: noopFinalize };
}

/**
 * LIN-3124 PR3 (S3): phase B of a link — convert the session-resident binding
 * phase A (`linkProvider`, legacy-shaped, in memory) just wrote into a
 * connection-backed binding. Called at the post-`establishAccount`
 * `writeConnection` positions, so a refused, conflicted or limit-failed link
 * never reaches it and persists nothing.
 *
 * Creation (D2a): a NEW binding converts iff `CONNECTION_BACKED_WRITES` is on,
 * the provider is eligible, and no binding existed at `(provider, scope)` before
 * phase A (`prior === 'none'`): a re-link of a legacy binding stays legacy. An
 * EXISTING connection-backed binding (phase A was a no-op over it) updates its
 * Connection whatever the flag says, and is never downgraded.
 *
 * Order (D18): 1. refresh-token kinds write the connection-keyed owner record
 * (`putByConnection`, or `copyToConnection` from the Jira add-source staging
 * record); 2. `link()` writes credentials, `origin` and the referent in one
 * upsert; 3. the binding is rewritten, the mirror stripped and the marker set.
 * `removeReferent` is never part of a fallback.
 *
 * Jira add-source (`staged`, D8): the step-0 gate keeps the site legacy while a
 * legacy OAuth Jira binding in this workspace reads the staged record; the
 * staged record is deleted only by the returned `finalize` thunk, which the
 * route awaits AFTER `saveSession` resolves, and which is a compare-and-delete.
 *
 * Result:
 *   - `connectionBacked` — the binding is connection-backed now. When false the
 *     route takes its unchanged legacy writes (the fallback);
 *   - `error: 'retryable'` — respond with a retryable error after the save
 *     (an existing binding's failed update, or an unreadable `link()`
 *     acknowledgement, residual (a));
 *   - `finalize()` — never throws; resolves `true` only when the staged record
 *     was deleted.
 *
 * @param {Object} args
 * @param {import('./connection-store.js').ConnectionStore} args.connectionStore
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} [args.ownerCredentialStore]
 * @param {Object} args.session - `req.session`; the workspace is looked up in it by id
 * @param {string} args.accountId - the established (canonical) account id
 * @param {string} args.workspaceId
 * @param {string} args.provider
 * @param {string} args.scope
 * @param {Object} args.credentials - the call-site credentials (never read back from the binding)
 * @param {string} [args.refreshToken] - refresh-token kinds, when not staged
 * @param {'none'|'legacy'|'connection'} [args.prior] - `bindingShapeAt` before phase A
 * @param {{accountId: string, urlKey: string}} [args.staged] - Jira add-source staging record key
 * @param {string} [args.heldConnectionId] - LIN-3125 Phase 1 held mode: when set,
 *   bind onto this Connection with a referent-only `addReferent` and no credential
 *   copy, never falling back to legacy. Omit for the credentials mode.
 * @param {(id: string) => (string|Promise<string>)} [args.resolveCanonicalAccountId] - held-mode owner canonicalization
 * @param {boolean} [args.writesEnabled]
 * @returns {Promise<{connectionBacked: boolean, connectionId?: string, error: string|null, finalize: () => Promise<boolean>}>}
 */
export async function convertToConnectionBacked({
  connectionStore,
  ownerCredentialStore,
  session,
  accountId,
  workspaceId,
  provider,
  scope,
  credentials = {},
  refreshToken,
  prior = 'none',
  staged = null,
  heldConnectionId = null,
  resolveCanonicalAccountId = (id) => id,
  writesEnabled = connectionBackedWritesEnabled(),
} = {}) {
  const legacy = { connectionBacked: false, error: null, finalize: noopFinalize };
  const retryable = { connectionBacked: false, error: 'retryable', finalize: noopFinalize };
  let failed = legacy;
  try {
    // LIN-3125 Phase 1 (C3): held mode runs BEFORE the legacy early returns
    // below, so a held failure can never fall back to a legacy result or copy a
    // credential. `failed` is retryable for the whole held path, so even a
    // thrown held failure (caught below) returns retryable, never legacy.
    if (heldConnectionId) {
      failed = retryable;
      return await convertHeldConnectionBacked({
        connectionStore, session, accountId, workspaceId, provider, scope, heldConnectionId, resolveCanonicalAccountId, writesEnabled,
      });
    }

    const workspace = (session?.workspaces || []).find(w => w && w.id === workspaceId);
    if (!workspace || !accountId) return legacy;
    const current = (workspace.bindings || []).find(b => b && b.provider === provider && b.scope === scope);
    const existing = isConnectionBacked(current);
    // An existing binding's failure is a retryable error, never a downgrade.
    if (existing) failed = { ...retryable, connectionBacked: true };

    if (!existing && (!writesEnabled || prior !== 'none' || !isConnectionEligible(provider, credentials))) return legacy;

    const refreshKind = isRefreshTokenKind(provider);
    if (typeof connectionStore?.link !== 'function' || typeof connectionStore?.readConnectionOutcome !== 'function') return failed;
    if (refreshKind && (typeof ownerCredentialStore?.putByConnection !== 'function' || typeof ownerCredentialStore?.getByConnection !== 'function')) return failed;

    let parts;
    if (existing) {
      parts = connectionIdParts(current.connectionId);
    } else {
      const unitId = unitIdForBinding({ provider, scope, credentials });
      parts = unitId ? { accountId, provider, unitId } : null;
    }
    if (!parts) return failed;
    const connectionId = existing ? current.connectionId : `${parts.accountId}::${normalizeProviderName(provider)}::${parts.unitId}`;

    // Step 0 (D8/D18, Jira add-source only): a co-resident legacy OAuth reader
    // of the staged record means nothing converts and no store call is made.
    // An existing connection-backed site here is residual (b): no copy, its
    // record is untouched, retryable error.
    if (staged && hasLegacyOAuthJiraReader(workspace, scope)) return failed;

    // Step 1: the connection-keyed owner record (refresh-token kinds).
    let preexisting = null;
    let copiedRefreshToken = null;
    if (refreshKind) {
      preexisting = await ownerCredentialStore.getByConnection(connectionId);
      let written;
      if (staged) {
        written = typeof ownerCredentialStore.copyToConnection === 'function' &&
          await ownerCredentialStore.copyToConnection(staged.accountId, staged.urlKey, provider, connectionId);
        if (written) copiedRefreshToken = (await ownerCredentialStore.getByConnection(connectionId))?.refreshToken ?? null;
      } else {
        written = await ownerCredentialStore.putByConnection(connectionId, {
          accountId: parts.accountId,
          provider,
          unitId: parts.unitId,
          scope,
          token: credentials.token,
          refreshToken,
          tokenExpiresAt: credentials.tokenExpiresAt,
        });
      }
      if (!written) {
        // A new binding releases its partial write (never someone else's
        // record); an existing one keeps its record and reports retryable.
        if (!existing && !preexisting) await releaseOrphanOwnerRecord({ ownerCredentialStore, connectionId });
        return failed;
      }
    }

    // Step 2: one atomic upsert of credentials, origin and the referent.
    const referent = { urlKey: workspace.urlKey, provider, scope };
    const linked = await connectionStore.link(parts.accountId, provider, parts.unitId, connectionCredentials(credentials), referent);
    if (!linked) {
      // An existing binding keeps the new record and is not finalized.
      if (existing) return failed;
      // D18 ambiguous acknowledgement: re-read BEFORE any release.
      const outcome = await connectionStore.readConnectionOutcome(connectionId);
      if (outcome === null) return retryable; // residual (a): keep copy, staged record and the legacy binding
      if (!referentMatches(outcome.connection, referent)) {
        if (refreshKind && !preexisting) await releaseOrphanOwnerRecord({ ownerCredentialStore, connectionId });
        return legacy;
      }
      // Committed: roll forward and keep the copy (releasing it and then
      // finalizing would delete the only refresh token).
    }

    // Step 3.
    rewriteAsConnectionBacked(workspace, provider, scope, connectionId, credentials);

    const finalize = staged && copiedRefreshToken
      ? async () => {
        try {
          return await ownerCredentialStore.finalizePromotion(staged.accountId, staged.urlKey, provider, { connectionId, copiedRefreshToken });
        } catch (err) {
          console.error('[connection-credential] finalizePromotion failed:', err);
          return false;
        }
      }
      : noopFinalize;
    return { connectionBacked: true, connectionId, error: null, finalize };
  } catch (err) {
    console.error('[connection-credential] convertToConnectionBacked failed:', err);
    return failed;
  }
}
