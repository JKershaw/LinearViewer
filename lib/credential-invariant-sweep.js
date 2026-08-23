/**
 * lib/credential-invariant-sweep.js
 *
 * Startup/periodic invariant sweep (LIN-2236, L5.4 of the LIN-2231 design).
 * Same shape as lib/observer-sweep.js (already in the codebase for a related
 * purpose): a pure classification function over one tick's read, plus a
 * thin I/O-injected orchestration wrapper and a scheduler-compatible `run`
 * closure — read/observe/log ONLY, no write, no auto-remediation.
 *
 * The invariant: every live account↔workspace edge (accountWorkspaceStore)
 * should resolve, through the CANONICAL account (LIN-2234's
 * resolveCanonicalAccountId), to an owner-credentials record with a
 * future-or-sentinel tokenExpiresAt. A violation means the credential
 * lifecycle silently died somewhere upstream of this sweep ever running.
 *
 * Known, accepted gap (not a false positive to fix here): an edge's
 * `workspaceId` is `workspace.id` (the provider's own org id,
 * routes/auth.js), NOT the `urlKey` owner-credentials is keyed on — and the
 * durable general-purpose WorkspaceStore that would carry that mapping
 * (lib/workspace-store.js) is Phase B, wired to no route, so it holds no
 * data yet. This sweep derives the SAME id->urlKey/provider mapping the rest
 * of the codebase currently relies on: a scan over live sessions (the same
 * precedent observer-sweep.js's own roster derivation and
 * resolveWorkspaceAccess's session scan both already use). An edge whose
 * workspaceId isn't found in any live session's `workspaces[]` is SKIPPED,
 * not reported — there is no urlKey to check it against, so silence there is
 * honest, not a false negative this sweep is claiming to rule out.
 */

import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from './credential-lifecycle-events.js';

/**
 * Build the workspaceId -> {urlKey, provider} map this sweep needs, from the
 * raw `sessionsCollection.find({}).toArray()` rows. Mirrors
 * lib/observer-sweep.js's `resolveRosterFromSessions` fail-soft shape: a
 * malformed row's session JSON is skipped, never wedges the whole scan.
 *
 * @param {Array<{session: string|Object}>} sessions
 * @returns {Map<string, {urlKey: string, provider: string}>}
 */
export function resolveWorkspaceIdMapFromSessions(sessions) {
  const map = new Map();
  for (const row of sessions || []) {
    let data;
    try {
      data = typeof row.session === 'string' ? JSON.parse(row.session) : row.session;
    } catch {
      continue;
    }
    const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : [];
    for (const ws of workspaces) {
      if (ws?.id && ws?.urlKey && !map.has(ws.id)) {
        map.set(ws.id, { urlKey: ws.urlKey, provider: ws.provider || 'linear' });
      }
    }
  }
  return map;
}

/**
 * Is this durable owner-credentials record's expiry a live one? Reuses the
 * SAME sentinel/finite distinction lib/credential-diagnostics.js's
 * `describeExpiry` already establishes (SENTINEL_EXPIRY_FLOOR_MS) — a
 * never-expires GitHub/Jira-Basic credential is not a violation just because
 * its `tokenExpiresAt` sits in the far future by design.
 *
 * @param {Object|null} record
 * @param {number} now
 * @returns {boolean}
 */
function hasLiveExpiry(record, now) {
  if (!record || !Number.isFinite(record.tokenExpiresAt)) return false;
  return record.tokenExpiresAt > now;
}

/**
 * Classify every account↔workspace edge into ok/skipped/violation. Pure —
 * `credentialLookup` is a plain synchronous function over an already-fetched
 * map, not a live store, so this stays a pure function of its inputs and is
 * unit-testable with no I/O (same discipline as observer-sweep's
 * `buildSweepPayload`/`classifyLoop`).
 *
 * @param {Array<{accountId: string, workspaceId: string}>} edges - accountWorkspaceStore.listAllEdges()
 * @param {Map<string, string>} canonicalByAccountId - accountId -> its resolveCanonicalAccountId() result, pre-resolved by the caller (async work stays outside this pure function)
 * @param {Map<string, {urlKey: string, provider: string}>} workspaceIdMap - resolveWorkspaceIdMapFromSessions() result
 * @param {(canonicalAccountId: string, urlKey: string, provider: string) => Object|null} credentialLookup - synchronous point-read over an already-fetched record map
 * @param {number} now
 * @returns {{violations: Array<Object>, skipped: number, checked: number}}
 */
export function findCredentialInvariantViolations(edges, canonicalByAccountId, workspaceIdMap, credentialLookup, now) {
  const violations = [];
  let skipped = 0;
  let checked = 0;

  for (const edge of edges || []) {
    const located = workspaceIdMap.get(edge.workspaceId);
    if (!located) {
      // No live session has ever named this workspaceId's urlKey — nothing
      // to check it against (see module doc's "known, accepted gap").
      skipped += 1;
      continue;
    }
    const canonicalAccountId = canonicalByAccountId.get(edge.accountId) ?? edge.accountId;
    checked += 1;
    const record = credentialLookup(canonicalAccountId, located.urlKey, located.provider);
    if (!hasLiveExpiry(record, now)) {
      violations.push({
        accountId: edge.accountId,
        canonicalAccountId,
        urlKey: located.urlKey,
        provider: located.provider,
        reason: record ? 'expired' : 'missing',
      });
    }
  }

  return { violations, skipped, checked };
}

/**
 * The tick body: read the edges + sessions, resolve canonical ids, classify,
 * and log every violation LOUDLY (console.error) and DURABLY (via
 * lifecycleEventStore — L5.4's own "not just to console" requirement).
 * Read/observe/log only — no write to any account/workspace/credential store.
 *
 * @param {Object} deps
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} deps.accountWorkspaceStore
 * @param {import('./account-store.js').AccountStore} deps.accountStore
 * @param {import('./owner-credential-store.js').OwnerCredentialStore} deps.ownerCredentialStore
 * @param {import('./credential-lifecycle-events.js').CredentialLifecycleEventStore} deps.lifecycleEventStore
 * @param {{find: Function}} deps.sessionsCollection
 * @param {number} deps.now - epoch ms, resolved by the caller's closure (see createCredentialInvariantSweepRun)
 * @returns {Promise<{violations: Array<Object>, skipped: number, checked: number}>}
 */
export async function runCredentialInvariantSweep({ accountWorkspaceStore, accountStore, ownerCredentialStore, lifecycleEventStore, sessionsCollection, now }) {
  if (!Number.isFinite(now)) {
    throw new Error('credential-invariant-sweep: deps.now (epoch ms) is required');
  }

  const [edges, sessions] = await Promise.all([
    accountWorkspaceStore.listAllEdges(),
    sessionsCollection.find({}).toArray(),
  ]);
  const workspaceIdMap = resolveWorkspaceIdMapFromSessions(sessions);

  const uniqueAccountIds = [...new Set(edges.map(e => e.accountId))];
  const canonicalByAccountId = new Map();
  for (const accountId of uniqueAccountIds) {
    canonicalByAccountId.set(accountId, await accountStore.resolveCanonicalAccountId(accountId));
  }

  const recordsByKey = new Map();
  for (const edge of edges) {
    const located = workspaceIdMap.get(edge.workspaceId);
    if (!located) continue;
    const canonicalAccountId = canonicalByAccountId.get(edge.accountId) ?? edge.accountId;
    const key = `${canonicalAccountId}::${located.urlKey}::${located.provider}`;
    if (recordsByKey.has(key)) continue;
    recordsByKey.set(key, await ownerCredentialStore.get(canonicalAccountId, located.urlKey, located.provider));
  }
  const credentialLookup = (canonicalAccountId, urlKey, provider) =>
    recordsByKey.get(`${canonicalAccountId}::${urlKey}::${provider}`) ?? null;

  const result = findCredentialInvariantViolations(edges, canonicalByAccountId, workspaceIdMap, credentialLookup, now);

  for (const violation of result.violations) {
    console.error('[credential-invariant] violation:', JSON.stringify(violation));
    await lifecycleEventStore.recordEvent({
      accountId: violation.canonicalAccountId,
      urlKey: violation.urlKey,
      provider: violation.provider,
      kind: CREDENTIAL_LIFECYCLE_EVENT_KINDS.INVARIANT_VIOLATION,
      detail: violation,
    });
  }

  return result;
}

/**
 * Build the `run` callback `Scheduler.register()` arms for the credential
 * invariant sweep — same extraction discipline as
 * lib/observer-sweep.js's `createObserverSweepRun` (close-out ledger item 6
 * there): the tick body lives in an importable, independently-testable
 * function rather than an anonymous closure inside server.js, so CI actually
 * exercises the wiring instead of merely being compatible with it never
 * running.
 *
 * @param {Object} deps - forwarded verbatim to runCredentialInvariantSweep, plus:
 * @param {Function} [deps.now] - seam for tests; defaults to Date.now
 * @returns {() => Promise<void>}
 */
export function createCredentialInvariantSweepRun({ accountWorkspaceStore, accountStore, ownerCredentialStore, lifecycleEventStore, sessionsCollection, now = Date.now }) {
  return async () => {
    try {
      await runCredentialInvariantSweep({ accountWorkspaceStore, accountStore, ownerCredentialStore, lifecycleEventStore, sessionsCollection, now: now() });
    } catch (err) {
      // Fail soft, like observer-sweep's own roster read: a tick that can't
      // complete (e.g. a store blip) logs and self-heals next tick, rather
      // than crashing the scheduler's timer loop.
      console.error('[credential-invariant] sweep tick failed:', err);
    }
  };
}
