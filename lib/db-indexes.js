/**
 * Boot-time database index creation (LIN-610).
 *
 * Declares the full set of indexes the app's collections need and applies them
 * idempotently at startup via `ensureIndexes(db)`. Running it on every boot IS
 * the deploy mechanism — `createIndex` is a no-op when an identical index
 * already exists (MongoDB and MangoDB both early-return on a matching spec), so
 * there is no migration framework and the stores stay untouched.
 *
 * Design decisions (see LIN-610):
 * - NO TTL indexes. Every expiry field gets a plain index only; the hourly
 *   `.cleanup()` loop in server.js stays the sole, authoritative evictor. The
 *   plain index just accelerates its `deleteMany({ <field>: { $lt: now } })`
 *   range scan in production. (MangoDB has no TTL daemon, so plain indexes also
 *   keep dev/prod behaviour identical.)
 *   One named exception: `email-magic-links` (LIN-1892) has a TTL on
 *   `expiresAt` in place of a `.cleanup()` loop. Its expiry is enforced by
 *   every MagicLinkStore query (`expiresAt: { $gt: now }`), so the TTL only
 *   removes dead rows, and MangoDB never running it changes no behaviour.
 * - Evidence stores: plain timestamp indexes, no evictor (LIN-3163, LIN-3157 B).
 *   The six evidence stores (dispatch-history, prompt-traces, foreman-status,
 *   llm-call-log, proxy-events, credential-lifecycle-events) are retained for
 *   the project's lifetime: they no longer stamp an expiry field and no longer
 *   have a `.cleanup()` evictor. Their reads are backed by plain
 *   `{urlKey, timestamp:-1}` indexes (the paged lists page over the full
 *   retained history), so no TTL index and no expiry-keyed index is declared
 *   for them. `observation-sessions` is a TTL'd derived read-model (not
 *   evidence) and keeps its own `{historyExpiresAt}` cleanup index.
 * - `unique` builds are non-fatal. A unique build over pre-existing duplicates
 *   throws in production MongoDB; we log and continue rather than wedge a deploy.
 *   tokenHash is a SHA-256 hash, so a real collision is effectively impossible —
 *   a failure means corrupt/legacy data needing manual cleanup, not a deploy
 *   blocker.
 * - Dev vs prod: MangoDB has no query planner, so in dev these indexes give
 *   unique-constraint correctness only; production MongoDB gets the query speedup.
 *   The same portable code is safe in both.
 *
 * Deliberately NOT indexed (pure composite-`_id` lookups, already covered by the
 * auto `_id` index): user-preferences, workspace-preferences, recap-cache,
 * run-summary-cache, session-summary-cache, brief-cache, owner-credentials
 * (LIN-1523 — composite `${accountId}::${urlKey}` key), scheduler-locks
 * (LIN-2128 — one lock document per registered job, `_id: 'tick:<name>'`;
 * seed/acquire/extend all filter on that bare `_id`, so there is nothing an
 * extra index would buy), account-merge-events (LIN-2233 — write-only append
 * log with no field-keyed read path today; a query pattern arriving with
 * Ticket D's broader credential-lifecycle-events work should add one then),
 * harbour-comments (LIN-2648/LIN-2649 — composite `${urlKey}::${commentId}`
 * key; `wereRecordedByHarbour`'s batch read filters on that same `_id` via
 * `$in`, so the automatic `_id_` index already serves it), workspace-halt
 * (LIN-2994/LIN-3023 — `_id: urlKey`; get/set/clear all filter on that bare
 * `_id`, so there is no query pattern beyond a point read).
 */

// Each spec: { collection, keySpec, options, reason }.
// `options` is passed straight to `createIndex` (e.g. { unique: true }).
export const INDEX_SPECS = [
  // --- Hot per-request token validation (full-scan today) ---
  {
    collection: 'proxy-tokens',
    keySpec: { tokenHash: 1 },
    options: { unique: true },
    reason: 'per-request proxy token validation (lib/proxy-tokens.js)'
  },
  {
    collection: 'proxy-tokens',
    keySpec: { urlKey: 1 },
    options: {},
    reason: 'token management list by workspace'
  },
  {
    collection: 'proxy-tokens',
    keySpec: { expiresAt: 1 },
    options: {},
    reason: 'cleanup deleteMany range scan'
  },
  {
    collection: 'dispatch-tokens',
    keySpec: { tokenHash: 1 },
    options: { unique: true },
    reason: 'per-request dispatch token validation (lib/dispatch-tokens.js)'
  },
  {
    collection: 'dispatch-tokens',
    keySpec: { urlKey: 1 },
    options: {},
    reason: 'token management list by workspace'
  },
  {
    collection: 'harbour-feedback-tokens',
    keySpec: { tokenHash: 1, used: 1, expiresAt: 1 },
    options: {},
    reason: 'atomic single-use claim (lib/harbour-feedback-tokens.js)'
  },

  // --- Workspace-scoped list + expiry reads ---
  {
    collection: 'dispatch-queue',
    keySpec: { urlKey: 1, expiresAt: 1 },
    options: {},
    reason: 'active-item list by workspace (lib/dispatch-store.js)'
  },
  {
    collection: 'dispatch-queue',
    keySpec: { expiresAt: 1 },
    options: {},
    reason: 'cleanup deleteMany range scan'
  },
  {
    collection: 'dispatch-queue',
    keySpec: { urlKey: 1, issueIdentifier: 1 },
    options: {},
    reason: 'issue-scoped active-item read (getLoopsForIssue, LIN-613)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1 },
    options: {},
    reason: 'history list by workspace (lib/dispatch-store.js)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1, issueIdentifier: 1 },
    options: {},
    reason: 'issue-scoped history read (getLoopsForIssue, LIN-613)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1, resolvedAt: -1 },
    options: {},
    // LIN-2079 (PR #1145 review ledger item 3): listHistory's `{status,
    // silentSince}` diagnostic read is a RESIDUAL filter on top of this index —
    // it adds no index of its own and relies on this one to keep the scan
    // bounded to a urlKey's newest-N. Dropping or re-keying this spec silently
    // turns that read into a full-collection scan with no test failing, since
    // nothing in CI pins the query plan. Named here so the dependency is
    // visible at the thing it depends on.
    reason: 'bounded newest-first history read — index-backs the sort+limit pushed into listHistory so /api/proxy/dispatch reads a top-N slice, not the whole feedback-bearing history (LIN-1030); also carries listHistory\'s LIN-2079 {status, silentSince} residual filter'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1, sessionId: 1 },
    options: {},
    reason: 'session-scoped history read for the Observation materializer closure (LIN-623)'
  },
  {
    collection: 'dispatch-queue',
    keySpec: { urlKey: 1, sessionId: 1 },
    options: {},
    reason: 'session-scoped live read for the Observation materializer closure (LIN-623)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1, followUpTo: 1 },
    options: {},
    reason: 'followUpTo BFS discovery for the Observation materializer closure (LIN-1307)'
  },
  {
    collection: 'dispatch-queue',
    keySpec: { urlKey: 1, followUpTo: 1 },
    options: {},
    reason: 'followUpTo BFS discovery for the Observation materializer closure (LIN-1307)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1, sessionGroupId: 1 },
    options: {},
    reason: 'durable session-group read for the Observation materializer closure, O(1) instead of a followUpTo chain-walk (LIN-1341)'
  },
  {
    collection: 'dispatch-queue',
    keySpec: { urlKey: 1, sessionGroupId: 1 },
    options: {},
    reason: 'durable session-group read for the Observation materializer closure, O(1) instead of a followUpTo chain-walk (LIN-1341)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1, rootItemId: 1 },
    options: {},
    reason: 'per-runner-session lineage candidate lookup for _collectGroupFeedback, O(1) instead of an unindexed scan (LIN-1468)'
  },
  {
    collection: 'dispatch-queue',
    keySpec: { urlKey: 1, rootItemId: 1 },
    options: {},
    reason: 'per-runner-session lineage candidate lookup for _collectGroupFeedback, O(1) instead of an unindexed scan (LIN-1468)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { urlKey: 1, producingItemId: 1, producingItemAttempt: -1 },
    options: {},
    reason: 'wake-row lookup by producing item, backing the durable wake witness (LIN-1698 Phase 1). No reader in Phase 1 — declared ahead of the reconciliation-sweep follow-up ticket, the field\'s first consumer'
  },
  {
    collection: 'dispatch-queue',
    keySpec: { urlKey: 1, producingItemId: 1, producingItemAttempt: -1 },
    options: {},
    reason: 'wake-row lookup by producing item, backing the durable wake witness (LIN-1698 Phase 1). No reader in Phase 1 — declared ahead of the reconciliation-sweep follow-up ticket, the field\'s first consumer'
  },
  {
    collection: 'foreman-status',
    keySpec: { urlKey: 1, taskIdentifier: 1 },
    options: {},
    reason: 'issue-scoped agent-status read (getLoopsForIssue, LIN-613)'
  },
  {
    collection: 'foreman-status',
    keySpec: { urlKey: 1, dispatchId: 1 },
    options: {},
    reason: 'general-anchor agent-status read (getSessionsForIssues extraItems, LIN-2934 D1)'
  },
  {
    collection: 'observation-sessions',
    keySpec: { urlKey: 1 },
    options: {},
    reason: 'hot Observation feed read of the materialized read-model (LIN-623)'
  },
  {
    collection: 'observation-sessions',
    keySpec: { historyExpiresAt: 1 },
    options: {},
    reason: 'derived read-model cleanup deleteMany range scan (LIN-623)'
  },

  // --- LIN-3162 (LIN-3157 A2) / LIN-3163 (B): plain timestamp indexes for the DB-side reads ---
  // The four paged lists filter/sort/skip/limit in the database over the
  // workspace's FULL retained history, so each needs a `{urlKey, timestamp:-1}`
  // index. B removed the pre-A2 `{urlKey, expiresAt}` / `{historyExpiresAt}`
  // evidence-store specs: those stores are lifetime-retained (plain timestamp
  // indexes, no evictor — see the design note above). LLM-call-log keeps a
  // per-issue successor for summarizeByIssue.
  {
    collection: 'proxy-events',
    keySpec: { urlKey: 1, timestamp: -1 },
    options: {},
    reason: 'lifetime newest-first event list (listEvents, LIN-3162)'
  },
  {
    collection: 'foreman-status',
    keySpec: { urlKey: 1, timestamp: -1 },
    options: {},
    reason: 'lifetime newest-first status list (listStatus, LIN-3162)'
  },
  {
    collection: 'llm-call-log',
    keySpec: { urlKey: 1, timestamp: -1 },
    options: {},
    reason: 'lifetime newest-first call list (listCalls, LIN-3162)'
  },
  {
    collection: 'llm-call-log',
    keySpec: { urlKey: 1, issueIdentifier: 1, timestamp: -1 },
    options: {},
    reason: 'per-issue call-log summary over the horizon (summarizeByIssue with since, LIN-3162)'
  },
  {
    collection: 'prompt-traces',
    keySpec: { urlKey: 1, timestamp: -1 },
    options: {},
    reason: 'lifetime newest-first trace list (listTraces, LIN-3162)'
  },

  // --- Local provider: every page load for local workspaces ---
  {
    collection: 'local-issues',
    keySpec: { scope: 1, kind: 1 },
    options: {},
    reason: 'per-page list (lib/local-store.js)'
  },
  {
    collection: 'local-issues',
    keySpec: { scope: 1, kind: 1, identifier: 1 },
    options: {},
    reason: 'identifier lookup (lib/local-store.js)'
  },
  {
    collection: 'local-issues',
    keySpec: { scope: 1, kind: 1, parentId: 1 },
    options: {},
    reason: 'children lookup (lib/local-store.js)'
  },

  // --- Workspace management lists ---
  {
    collection: 'custom-prompts',
    keySpec: { urlKey: 1 },
    options: {},
    reason: 'per-workspace custom prompt list'
  },
  {
    collection: 'report-history',
    keySpec: { urlKey: 1 },
    options: {},
    reason: 'per-workspace roadmap report list'
  },
  {
    collection: 'task-snapshots',
    keySpec: { urlKey: 1, taskIdentifier: 1 },
    options: {},
    reason: 'per-task history archive read + dedupe gate (lib/task-snapshot-store.js, LIN-598)'
  },
  {
    collection: 'task-snapshots',
    keySpec: { urlKey: 1, canonicalId: 1 },
    options: {},
    reason: 'UUID-shaped snapshot lookup fallback (lib/task-snapshot-store.js, LIN-598)'
  },
  {
    collection: 'task-decisions',
    keySpec: { urlKey: 1, issueId: 1 },
    options: {},
    reason: 'per-task scan-decision read + dedupe gate, canonical-UUID only (lib/task-decisions-store.js, LIN-2197)'
  },

  // --- Account identity lookup ---
  // MUST precede the non-unique spec below: MangoDB's createIndex matches on
  // keySpec alone and early-returns, ignoring options AND name, so whichever
  // spec is created first wins there (real Mongo builds both regardless of
  // order). `sparse` is mandatory — createAccount() inserts `identities: []`,
  // and plain `unique` makes the SECOND identity-less account throw E11000.
  // A distinct `name` is mandatory — same keySpec + different options under
  // the auto-generated name throws code 86 on real Mongo, which
  // ensureIndexes swallows into a warning.
  // Accepted gap: on a PRE-EXISTING MangoDB ./data dir that already has the
  // non-unique spec below applied, this spec's createIndex call still
  // early-returns on the matching keySpec (MangoDB ignores options AND name
  // once a keySpec match exists) — so it no-ops there and that dir gets no
  // backstop. Real Mongo is unaffected (order-independent; both build).
  // Correctness on an affected MangoDB dir still rests on its per-collection
  // write mutex + the retained `$elemMatch` pre-check, not a fix.
  {
    collection: 'accounts',
    keySpec: { 'identities.provider': 1, 'identities.scope': 1 },
    options: { unique: true, sparse: true, name: 'accounts_identity_unique' },
    reason: 'cross-document identity uniqueness — the ONLY enforcer of the linkIdentity race (lib/account-store.js, LIN-1338); the non-unique spec below is redundant but retained (ensureIndexes has no drop mechanism; cost is one index write on a one-doc-per-human collection)'
  },
  {
    collection: 'accounts',
    keySpec: { 'identities.provider': 1, 'identities.scope': 1 },
    options: {},
    reason: 'identity conflict lookup (lib/account-store.js, LIN-1327). Superseded as the enforcement mechanism by accounts_identity_unique above (LIN-1338); kept because ensureIndexes has no drop mechanism and this predates the unique spec on any already-deployed data dir.'
  },

  // --- Connection referents (LIN-3124 PR2, D10) ---
  {
    collection: 'connections',
    keySpec: { 'referents.urlKey': 1, 'referents.provider': 1 },
    options: {},
    reason: 'connection-first read arms resolve a connection by referent (lib/connection-store.js, LIN-3124 D10); the composite-_id point lookups/upserts stay on the auto _id index'
  },

  // --- Durable workspaces + account↔workspace membership (LIN-1328) ---
  {
    collection: 'workspaces',
    keySpec: { urlKey: 1 },
    options: {},
    reason: 'urlKey lookup (lib/workspace-store.js, LIN-1328) — D\'s cutover reads through getWorkspaceByUrlKey'
  },
  {
    collection: 'account-workspaces',
    keySpec: { accountId: 1 },
    options: {},
    reason: 'listWorkspacesForAccount (lib/account-workspace-store.js, LIN-1328)'
  },
  {
    collection: 'account-workspaces',
    keySpec: { workspaceId: 1 },
    options: {},
    reason: 'listAccountsForWorkspace (lib/account-workspace-store.js, LIN-1328)'
  },
  {
    collection: 'account-workspaces',
    keySpec: { accountId: 1, workspaceId: 1 },
    options: { unique: true },
    reason: 'dedupe backstop for bindAccountToWorkspace — application code enforces idempotency, this is a backstop only (lib/account-workspace-store.js, LIN-1328)'
  },
  // Compound, NOT `{workspaceId: 1}`: that key spec is already declared above,
  // and MangoDB's createIndex early-returns on a matching keySpec whatever the
  // options, so a partial unique index on the same key would never build
  // there. Only `role: 'owner'` edges enter the index, so uniqueness over
  // `(workspaceId, 'owner')` is exactly "at most one owner edge per workspace".
  {
    collection: 'account-workspaces',
    keySpec: { workspaceId: 1, role: 1 },
    options: { unique: true, partialFilterExpression: { role: 'owner' }, name: 'account_workspaces_one_owner' },
    reason: 'at most one owner edge per workspace — the only enforcer of bindAccountToWorkspace\'s concurrent first-binder race (lib/account-workspace-store.js, LIN-1892)'
  },

  // --- Email magic-link sign-in (LIN-1892) ---
  // Link lookups are by `_id` (the token's SHA-256), served by the automatic
  // `_id_` index; these two back the send throttle and cleanup.
  {
    collection: 'email-magic-links',
    keySpec: { emailNorm: 1, createdAt: -1 },
    options: {},
    reason: 'per-email send throttle, MagicLinkStore.recentCountForEmail (lib/email-auth.js, LIN-1892)'
  },
  {
    collection: 'email-magic-links',
    keySpec: { expiresAt: 1 },
    options: { expireAfterSeconds: 86400 },
    reason: 'TTL cleanup of spent/expired links a day after expiry — the LIN-610 no-TTL rule\'s one exception (see header); expiry itself is enforced by the query (lib/email-auth.js, LIN-1892)'
  },

  // --- Expiry cleanup only (pure _id lookups otherwise) ---
  {
    collection: 'sessions',
    keySpec: { expires: 1 },
    options: {},
    reason: 'session expiry cleanup scan'
  },
  {
    collection: 'free-tier-usage',
    keySpec: { expiresAt: 1 },
    options: {},
    reason: 'free-tier usage cleanup scan'
  },

  // --- Observer harness state (LIN-2129) ---
  {
    collection: 'observer-state',
    keySpec: { lastSeenAt: 1 },
    options: {},
    reason: 'cleanup() range scan for decommissioned observer instances, keyed on last-seen (not last-changed) so a live, diagnosis-unchanged instance is never evicted (lib/observer-state-store.js, LIN-2129 review F1) — the _id (instance key) point read needs no index, per the deliberately-not-indexed precedent above'
  },

  // --- Observer harness shadow action log (LIN-2132, P1-5) ---
  {
    collection: 'observer-shadow-log',
    keySpec: { urlKey: 1, recordedAt: -1 },
    options: {},
    reason: 'per-workspace newest-first read + prune-to-capacity scan (lib/observer-shadow-log.js, LIN-2132)'
  },
  {
    collection: 'observer-shadow-log',
    keySpec: { recordedAt: 1 },
    options: {},
    reason: 'cleanup() range scan for aged shadow-log entries, matching P1-2 observer-state\'s retention posture (lib/observer-shadow-log.js, LIN-2132)'
  }
]

/**
 * Apply every declared index idempotently. Best-effort per index: a failing
 * build (e.g. a `unique` build over pre-existing duplicates, which throws in
 * production MongoDB) is logged and skipped so it can never wedge startup.
 *
 * @param {object} db - connected MongoDB/MangoDB database handle.
 * @param {object} [opts]
 * @param {object} [opts.logger=console] - logger with a `.warn` method.
 * @returns {Promise<{applied: Array, failed: Array}>} summary of the run.
 */
export async function ensureIndexes(db, { logger = console } = {}) {
  const applied = []
  const failed = []

  for (const spec of INDEX_SPECS) {
    try {
      const name = await db.collection(spec.collection).createIndex(spec.keySpec, spec.options)
      applied.push({ collection: spec.collection, name, keySpec: spec.keySpec })
    } catch (err) {
      failed.push({ collection: spec.collection, keySpec: spec.keySpec, error: err })
      logger.warn(
        `[db-indexes] skipped index on "${spec.collection}" ${JSON.stringify(spec.keySpec)}: ${err.message}`
      )
    }
  }

  return { applied, failed }
}
