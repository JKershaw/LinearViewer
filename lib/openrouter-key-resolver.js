import { resolveWorkspaceIdMapFromSessions } from './credential-invariant-sweep.js';

// openrouter-key-resolver.js: resolves a proxy token creator's OpenRouter API key
// (LIN-1352). The key is read directly from the durable per-user preferences store
// (LIN-498), keyed by the token creator's accountId (LIN-1353) — the single source
// of truth.
// This replaced a DB-wide scan of all sessions plus a 30s cache, which became stale
// after session.regenerate() (the proxy would find the new, keyless session and
// report "AI not configured"). Only the creator's own key is returned, so one
// user's proxy token can't consume another user's OpenRouter quota.
//
// userPreferencesStore is an injected parameter rather than a module-scope binding
// so callers — notably D1b's quota-isolation test — can supply a real or fake store
// directly instead of stubbing/reimplementing this resolver.
export async function getWorkspaceOpenRouterKey(userPreferencesStore, creatorId) {
  // Without a creator user ID, we can't safely resolve a personal OAuth key
  if (!creatorId) {
    return null;
  }

  try {
    return await userPreferencesStore.getOpenRouterApiKey(creatorId);
  } catch (err) {
    console.error('Error looking up workspace OpenRouter key:', err);
    return null;
  }
}

/**
 * getUnattendedOpenRouterKey (LIN-2412): resolves a durable, consent-gated
 * OpenRouter key for a consumer with NO live session — a scheduler/wake
 * caller, never a request. Env-free and free-tier-free by construction: the
 * only source is `userPreferencesStore`'s durable per-account key, and only
 * when that account has also granted `openRouterDurableConsentAt`. Any miss
 * (no owner found, no key, no consent, ambiguous ownership, a canonical-
 * resolution failure) returns `null` — never throws — so callers can treat
 * this exactly like the existing `getWorkspaceOpenRouterKey`'s degrade-to-null
 * contract.
 *
 * Two owner-identity tiers (C1, resolved in this order):
 *   1. `dispatchedBy` — an explicit owner for dispatch/wake-driven work
 *      (`lib/dispatch-store.js`'s "Account ID of the dispatcher"). Direct,
 *      unambiguous by construction: no workspace/edge lookup at all.
 *   2. `urlKey` — a workspace-derived consumer (e.g. observer-pass) with no
 *      caller identity beyond the workspace it's observing. Resolved via a
 *      same-tick inversion of `resolveWorkspaceIdMapFromSessions`'s
 *      `workspaceId -> {urlKey, provider}` map (reused, not re-derived) to
 *      find the workspace, then `accountWorkspaceStore.listAccountsForWorkspace`
 *      for its candidate owners.
 *
 * Both tiers apply the same C2 merge-aware resolution per candidate account
 * id: dedup by canonical id (a `resolveCanonicalAccountId` throw — a
 * `mergedInto` cycle or max-depth overflow — is caught and treated as a miss,
 * never propagated), then within each canonical group try the canonical id
 * first, falling back to every as-written pre-merge alias in a deterministic
 * (stable-sorted) order until one has both a key and consent.
 *
 * Tier 2's candidate COUNT (after C2 dedup) governs ambiguity: zero consented
 * owners degrades exactly like "not connected"; more than one degrades too —
 * ambiguity never picks an account, it only ever fails closed.
 *
 * @param {Object} deps
 * @param {import('./user-preferences.js').UserPreferencesStore} deps.userPreferencesStore
 * @param {{find: Function}} [deps.sessionsCollection] - required only for the urlKey tier
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} [deps.accountWorkspaceStore] - required only for the urlKey tier
 * @param {import('./account-store.js').AccountStore} deps.accountStore
 * @param {Object} [identity]
 * @param {string|null} [identity.dispatchedBy] - explicit owner, when known (C1 tier 1)
 * @param {string|null} [identity.urlKey] - workspace to resolve ownership for (C1 tier 2)
 * @returns {Promise<string|null>}
 */
export async function getUnattendedOpenRouterKey(deps, { dispatchedBy = null, urlKey = null } = {}) {
  const { userPreferencesStore, sessionsCollection, accountWorkspaceStore, accountStore } = deps;

  if (dispatchedBy) {
    const canonicalId = await resolveCanonicalOrMiss(accountStore, dispatchedBy);
    if (!canonicalId) return null;
    return resolveConsentedKeyForGroup(userPreferencesStore, canonicalId, [dispatchedBy]);
  }

  if (!urlKey) return null;

  let sessions;
  try {
    sessions = await sessionsCollection.find({}).toArray();
  } catch (err) {
    console.error('Error reading sessions for unattended OpenRouter key lookup:', err);
    return null;
  }

  const workspaceIdMap = resolveWorkspaceIdMapFromSessions(sessions);
  let workspaceId = null;
  for (const [id, located] of workspaceIdMap) {
    if (located.urlKey === urlKey) {
      workspaceId = id;
      break;
    }
  }
  if (!workspaceId) return null;

  let accountIds;
  try {
    accountIds = await accountWorkspaceStore.listAccountsForWorkspace(workspaceId);
  } catch (err) {
    console.error('Error listing workspace accounts for unattended OpenRouter key lookup:', err);
    return null;
  }
  if (!accountIds.length) return null;

  // C2 dedup: group as-written candidate ids by their canonical account,
  // dropping any candidate whose canonicalization throws (cycle/max-depth).
  const groups = new Map();
  for (const accountId of accountIds) {
    const canonicalId = await resolveCanonicalOrMiss(accountStore, accountId);
    if (!canonicalId) continue;
    if (!groups.has(canonicalId)) groups.set(canonicalId, []);
    groups.get(canonicalId).push(accountId);
  }

  const resolvedKeys = [];
  for (const [canonicalId, aliasIds] of groups) {
    const key = await resolveConsentedKeyForGroup(userPreferencesStore, canonicalId, aliasIds);
    if (key) resolvedKeys.push(key);
  }

  if (resolvedKeys.length === 0) return null;
  if (resolvedKeys.length > 1) {
    console.warn(`Unattended OpenRouter key lookup: ${resolvedKeys.length} consented accounts own workspace ${urlKey} — degrading rather than picking (multiple-consented-accounts).`);
    return null;
  }
  return resolvedKeys[0];
}

/**
 * `resolveCanonicalAccountId` throws on a `mergedInto` cycle or max-depth
 * overflow — caught here and treated as a miss (`null`), consistent with the
 * sibling `getWorkspaceOpenRouterKey`'s try/catch-to-null discipline, so a
 * throw never propagates out of an unattended caller as an unhandled
 * rejection.
 *
 * @param {import('./account-store.js').AccountStore} accountStore
 * @param {string} accountId
 * @returns {Promise<string|null>}
 */
async function resolveCanonicalOrMiss(accountStore, accountId) {
  try {
    return (await accountStore.resolveCanonicalAccountId(accountId)) || accountId;
  } catch (err) {
    console.error('Error resolving canonical account id for unattended OpenRouter key lookup:', err);
    return null;
  }
}

/**
 * C2's credential fallback chain for one canonical group: try the canonical
 * id first, then every as-written alias in deterministic (stable-sorted)
 * order, until one candidate has BOTH a durable key AND durable consent.
 *
 * @param {import('./user-preferences.js').UserPreferencesStore} userPreferencesStore
 * @param {string} canonicalId
 * @param {string[]} aliasIds - as-written candidate ids that resolved to canonicalId
 * @returns {Promise<string|null>}
 */
async function resolveConsentedKeyForGroup(userPreferencesStore, canonicalId, aliasIds) {
  const fallbackAliases = [...new Set(aliasIds)].filter((id) => id !== canonicalId).sort();
  const orderedCandidates = [canonicalId, ...fallbackAliases];

  for (const candidateId of orderedCandidates) {
    const key = await userPreferencesStore.getOpenRouterApiKey(candidateId);
    if (!key) continue;
    const consentedAt = await userPreferencesStore.getOpenRouterConsent(candidateId);
    if (consentedAt) return key;
  }
  return null;
}
