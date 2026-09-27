/**
 * Durable, write-only Connection record (LIN-3127, Session 1 of LIN-2149's
 * Account -> Connection -> Workspace cutover). Dual-written alongside the
 * existing binding/owner-credential writers through the shared
 * {@link writeConnection} helper. NO read path is wired to it yet (LIN-3124
 * owns the read cutover), and — unlike the first plan draft — NO delete path
 * either: see "Lifecycle" below for why deletion is deferred whole, not
 * partially, and what that leaves outstanding.
 *
 * Schema:
 * {
 *   _id:          `${accountId}::${normalizeProviderName(provider)}::${unitId}`,
 *   accountId, provider, unitId,
 *   credentials: { token, tokenExpiresAt, installationId,
 *                  email, authType, cloudId },   // verbatim subset of the
 *                                                 // binding's POST-linkProvider
 *                                                 // merged credentials — see
 *                                                 // "Record contents" below.
 *                                                 // `token` is never named
 *                                                 // `apiToken` for Jira Basic
 *                                                 // (apiToken is a read-side
 *                                                 // projection only,
 *                                                 // workspace.js:694/785) —
 *                                                 // moot for Basic under the
 *                                                 // ruling below, which omits
 *                                                 // `token` entirely for it.
 *   createdAt, updatedAt
 * }
 *
 * ## The (accountId, provider, unitId) partition
 *
 * `unitId` is the provider-declared connection unit, derived per provider by
 * {@link unitIdForBinding}: the GitHub/GitHub-Projects installation id, the
 * Jira binding `scope` (site URL — never `cloudId`, which a Basic binding does
 * not carry), or the Linear binding `scope` (the org id; `connectionUnit` is
 * null for Linear, so this reads the same field as Jira). The provider is
 * folded into the `_id` through `normalizeProviderName`, applying LIN-1887's
 * partition lesson: without it, linking Jira would overwrite Linear's record.
 * Both the provider AND the unit id are in the key from day one so several
 * installations/sites/orgs never collapse into one record.
 *
 * ## Record contents (the write helper)
 *
 * {@link writeConnection} reads the binding back AFTER `linkProvider` merged
 * the new credential into it (`lib/workspace.js:427`) and copies only the
 * whitelisted fields below off the merged object. A seam that wrote the
 * call-site literal instead would silently drop previously-set fields on an
 * update (e.g. a Jira Basic -> OAuth upgrade-in-place losing `email`).
 *
 * ## Plaintext at rest, and retention (LIN-1522)
 *
 * Credential fields are plaintext, matching lib/owner-credential-store.js —
 * LIN-1522 owns encryption/retention repo-wide. Per-class exposure (verified
 * against source, not assumed):
 *   - Jira Basic `token` (Atlassian API token): NOT STORED. Ruling
 *     `lin3127-jira-basic-retention` (Con ruling, delegated by John, comment
 *     `fd45fc6a`, CONFIRMED non-provisional by John on 2026-09-27, comment
 *     `04461f8f`): the token never expires and today lives only in 30-day
 *     sessions with no durable copy anywhere — storing it durably with no
 *     delete path (LIN-3124 not yet landed) would be a security-boundary
 *     widening made by default, not a deliberate choice. Omitted at the shared
 *     write helper, keyed on the binding's Jira auth type (Basic never sets
 *     `authType`; OAuth always sets `'oauth'`), so EVERY seam that could reach
 *     a Basic credential — the Basic add-source seam, a same-site Basic->OAuth
 *     upgrade-in-place, and merge-confirm — is covered by one check, not a
 *     per-seam guard. A Basic record is still written (same key, same
 *     idempotent-upsert shape as every other provider), holding only its
 *     non-secret fields (`email`) and no `token`. Jira Basic is therefore NO
 *     LONGER new durable exposure: it gains no durable secret copy at all
 *     under this ticket; affected users re-enter the Basic token after
 *     LIN-3124 lands deletion.
 *   - Jira OAuth `token` (access token, no refreshToken — linkProvider never
 *     mirrors it) and Linear OAuth `token`: both already durable via
 *     OwnerCredentialStore (7-site delete lifecycle applies there); this store
 *     adds a second, UNDELETED copy of an already-lifecycled secret that
 *     self-invalidates at its real provider-set expiry.
 *   - GitHub/GitHub-Projects installation token: no durable copy exists today
 *     (GitHub-family owns no OwnerCredentialStore record at all), but the token
 *     itself self-invalidates at GitHub's real ~1h expiry regardless of this
 *     copy; only the (non-secret) installationId persists usefully past that.
 * LIN-1522 (https://linear.app/linearviewer/issue/LIN-1522) covers this
 * collection's encryption/retention alongside `owner-credentials`.
 *
 * ## Lifecycle: no deletion this ticket (LIN-3124 obligation)
 *
 * The key `(accountId, provider, unitId)` is shared across every binding on the
 * same installation/site/org and across workspaces — the connection-unit
 * partition has no `urlKey`. No durable binding->connection referent exists
 * today to tell a delete site "is any other binding still using this
 * Connection?" (`AccountWorkspaceStore` is membership-only; bindings live only
 * in session documents). Building a correct reference count would mean
 * inventing a reverse index/read pattern this write-only ticket has no mandate
 * for, or duplicating LIN-3124's own `{connectionId, scope}` binding-shape
 * change ahead of time, hidden here. Deletion is therefore deferred WHOLE: this
 * store ships no delete method. LIN-3124
 * (https://linear.app/linearviewer/issue/LIN-3124) carries the recorded
 * obligation to define and implement Connection's delete/cleanup lifecycle
 * (re-keying `OwnerCredentialStore`'s 7-site delete discipline, including the
 * `deleteDurable`/LIN-1545 gating), and its deletion work is what unlocks
 * storing the Jira Basic token later.
 *
 * ## Indexing
 *
 * No index: pure composite-`_id` point lookup/upsert, covered by the auto `_id`
 * index — listed in the "Deliberately NOT indexed" section of
 * lib/db-indexes.js and in tests/unit/db-indexes.test.js's
 * `EXCLUDED_COLLECTIONS`.
 *
 * Conventions mirror lib/owner-credential-store.js: class +
 * `constructor({collection})`, composite-`_id` upsert, null-on-miss/no-throw.
 */

import { normalizeProviderName } from './workspace.js';

/** The explicit credential-field whitelist this store will persist (never the object wholesale). */
export const CONNECTION_CREDENTIAL_FIELDS = [
  'token',
  'tokenExpiresAt',
  'installationId',
  'email',
  'authType',
  'cloudId'
];

/**
 * Durable, write-only Connection store. Mirrors `lib/owner-credential-store.js`
 * conventions: class + `constructor({collection})`, `null` on a missing point
 * read, no throws.
 */
export class ConnectionStore {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('connections')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /** Deterministic composite point-read key, partitioned by provider and connection unit. */
  _id(accountId, provider, unitId) {
    return `${accountId}::${normalizeProviderName(provider)}::${unitId}`;
  }

  /**
   * Best-effort upsert. Never throws; logs and returns `false` on failure,
   * including when `accountId`/`provider`/`unitId` is missing (warns, no-ops) —
   * mirrors `OwnerCredentialStore.put`'s discipline exactly. `$set`s an
   * EXPLICIT field list (only whichever of `token, tokenExpiresAt,
   * installationId, email, authType, cloudId` are present on the passed-in
   * `credentials`), never the object wholesale, and stores the NORMALIZED
   * `provider` exactly as `OwnerCredentialStore.put` does.
   *
   * @param {string} accountId
   * @param {string} provider
   * @param {string} unitId - the provider's connection unit (installation id / site / org id)
   * @param {Object} [credentials] - the binding's merged credential fields
   * @returns {Promise<boolean>} true if the write succeeded
   */
  async put(accountId, provider, unitId, credentials = {}) {
    if (!accountId || !provider || !unitId) {
      console.warn('ConnectionStore.put called without accountId/provider/unitId');
      return false;
    }

    try {
      const now = new Date();
      const normalizedProvider = normalizeProviderName(provider);
      const stored = {};
      for (const field of CONNECTION_CREDENTIAL_FIELDS) {
        if (credentials[field] !== undefined) stored[field] = credentials[field];
      }
      await this.collection.updateOne(
        { _id: this._id(accountId, normalizedProvider, unitId) },
        {
          $set: {
            accountId,
            provider: normalizedProvider,
            unitId,
            credentials: stored,
            updatedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        { upsert: true }
      );
      return true;
    } catch (err) {
      console.error('Error saving connection:', err);
      return false;
    }
  }

  /**
   * Test-only read, added ONLY so the acceptance witness's no-read-switch proof
   * is expressible (stub-to-throw). NO production caller — enforced by the
   * static repo-wide guard in the plan (check: zero non-test callers of
   * `connectionStore.get(`).
   *
   * @param {string} accountId
   * @param {string} provider
   * @param {string} unitId
   * @returns {Promise<Object|null>} the stored record, or null if not found
   */
  async get(accountId, provider, unitId) {
    if (!accountId || !provider || !unitId) {
      console.warn('ConnectionStore.get called without accountId/provider/unitId');
      return null;
    }
    try {
      return await this.collection.findOne({
        _id: this._id(accountId, normalizeProviderName(provider), unitId)
      });
    } catch (err) {
      console.error('Error fetching connection:', err);
      return null;
    }
  }

  // No delete()/deleteAll() this ticket. See "Lifecycle" in the module doc.
}

/**
 * Derives the provider's connection unit (the third `_id` component) from a
 * binding. Returns `null` for a provider with no connection unit (e.g. local).
 *
 * @param {Object} binding - a workspace binding `{ provider, scope, credentials }`
 * @returns {string|null}
 */
export function unitIdForBinding(binding) {
  switch (binding.provider) {
    case 'github':
    case 'github-projects':
      return binding.credentials.installationId;
    case 'jira':
      // Site URL, never cloudId — a Basic binding carries no cloudId. Basic's
      // scope is normalizeJiraSite's canonical `https://<host>`; OAuth's scope
      // is the raw `site.url` from accessible-resources. The two key the SAME
      // record only when byte-identical for a tenant (N6) — the same condition
      // that already governs the binding's Basic->OAuth upgrade-in-place.
      return binding.scope;
    case 'linear':
      // org.id — linkProvider's 3rd arg IS the org id (routes/auth.js:213).
      // connectionUnit is null for Linear, so this reads binding.scope exactly
      // like Jira's case, not a provider-declared unit label.
      return binding.scope;
    default:
      return null;
  }
}

/**
 * A Jira binding with no `authType: 'oauth'` is Basic.
 *
 * lin3127-jira-basic-retention (Con ruling, delegated by John, fd45fc6a;
 * confirmed non-provisional by John, comment 04461f8f): never persist a Basic
 * `token`. Checked in the ONE shared helper every seam funnels through, so a
 * Basic credential reaching Connection by ANY path (the Basic add-source seam,
 * a Basic->OAuth upgrade-in-place, or merge-confirm) is covered by this one
 * check, not a per-seam guard that could be missed on a new seam.
 */
function isJiraBasicCredential(provider, credentials = {}) {
  return provider === 'jira' && credentials.authType !== 'oauth';
}

/**
 * Dual-writes a Connection record for a binding on `workspace`.
 *
 * Called AFTER `linkProvider`, reading the binding back (not the call-site
 * literal) so the record carries the MERGED credentials. Best-effort at the
 * HELPER level (N4), not only inside `put`: a throw during the binding lookup
 * or unit-id derivation is caught here so it cannot fail the caller's
 * auth/merge path. No-ops when the store is absent (optional dependency), the
 * binding is not found, or the provider declares no unit id.
 *
 * @param {ConnectionStore} connectionStore
 * @param {string} accountId
 * @param {Object} workspace - the container the binding was linked onto
 * @param {string} provider
 * @param {string} scope - the binding scope the caller just linked
 * @returns {Promise<void>}
 */
export async function writeConnection(connectionStore, accountId, workspace, provider, scope) {
  if (!connectionStore) return;
  try {
    const binding = workspace.bindings.find(b => b.provider === provider && b.scope === scope);
    if (!binding) return;
    const unitId = unitIdForBinding(binding);
    if (!unitId) return;
    const omitToken = isJiraBasicCredential(provider, binding.credentials);
    const credentials = {};
    for (const field of CONNECTION_CREDENTIAL_FIELDS) {
      if (field === 'token' && omitToken) continue;
      if (binding.credentials[field] !== undefined) credentials[field] = binding.credentials[field];
    }
    await connectionStore.put(accountId, provider, unitId, credentials);
  } catch (err) {
    console.error('Connection write failed:', err);
  }
}
