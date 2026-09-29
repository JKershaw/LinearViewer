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
 * PR2 is inert: nothing writes a `connectionId` onto a binding until PR3's
 * write cutover, so every branch below is unreachable in production and every
 * legacy read/listener is byte-identical.
 *
 * The store INSTANCES are injected, never imported, so this module is IO-free
 * and unit-testable with fakes.
 */
import { calculateExpiresAt, isDefinitiveRevocation, TokenRefreshError } from './token-refresh.js';
import { normalizeProviderName } from './workspace.js';
import {
  isConnectionBacked,
  isRefreshTokenKind,
  isRemintKind,
  setBindingCredential,
  setWorkspaceCredential,
} from './connection-binding.js';

export { isConnectionBacked };

// Mirrors lib/workspace-token-refresh.js's Linear reuse-grace constant (kept
// local so this seam does not import the protected refresh module).
const LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS = 30 * 60 * 1000;

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

/** The workspace's active binding when it is connection-backed (D2 marker). */
function activeConnectionBackedBinding(workspace) {
  const marker = workspace?.activeBinding;
  if (!marker || !Array.isArray(workspace.bindings)) return null;
  const match = workspace.bindings.find(b => b && b.provider === marker.provider && b.scope === marker.scope);
  return isConnectionBacked(match) ? match : null;
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
} = {}) {
  // The ONLY `inflight` registration on the connection path (key `conn:${id}`).
  const inflight = new Map();

  async function refreshConnection(connectionId, ownerAccountId) {
    if (!connectionId) return null;
    const key = `conn:${connectionId}`;
    let promise = inflight.get(key);
    if (!promise) {
      promise = runConnectionRefresh(connectionId, ownerAccountId, {
        connectionStore, ownerCredentialStore, resolveProvider, resolveExchange, refreshAccessToken, fetchImpl, now, evict
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
  connectionStore, ownerCredentialStore, resolveProvider, resolveExchange, refreshAccessToken, fetchImpl, now, evict
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

  const record = await ownerCredentialStore.getByConnection(connectionId);
  if (!record?.refreshToken) return null;
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
      throw new TokenRefreshError("Connection credential rotation died mid-flight and its spend-intent marker is past Linear's reuse grace window", 'EXPIRED');
    }
  }
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
      if (fresh?.refreshToken && fresh.refreshToken !== attempted) return convergeConnection(fresh, provider);
    }
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
  if (!won) {
    const fresh = await ownerCredentialStore.getByConnection(connectionId);
    if (fresh?.refreshToken) return convergeConnection(fresh, provider);
    throw new TokenRefreshError('Connection credential rotation could not be persisted (record changed or unavailable)', 'UNKNOWN');
  }

  // D9: the owner CAS is authoritative; the Connection mirror follows, and a
  // failed mirror is repaired by the next resolve's durable re-read.
  await connectionStore.updateCredentials(connectionId, { token: tokenData.access_token, tokenExpiresAt });
  fanOutEviction(referents, ownerAccountId, evict);
  return { token: tokenData.access_token, expiresAt: tokenExpiresAt, refreshToken: tokenData.refresh_token, provider, scope: record.scope };
}
