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
 * (LIN-1523 — composite `${accountId}::${urlKey}` key).
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
    reason: 'bounded newest-first history read — index-backs the sort+limit pushed into listHistory so /api/proxy/dispatch reads a top-N slice, not the whole feedback-bearing history (LIN-1030)'
  },
  {
    collection: 'dispatch-history',
    keySpec: { historyExpiresAt: 1 },
    options: {},
    reason: 'history cleanup deleteMany range scan'
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
    collection: 'proxy-events',
    keySpec: { urlKey: 1, expiresAt: 1 },
    options: {},
    reason: 'audit-log list by workspace (lib/proxy-events.js)'
  },
  {
    collection: 'foreman-status',
    keySpec: { urlKey: 1, expiresAt: 1 },
    options: {},
    reason: 'agent status feed by workspace (lib/agent-status-store.js)'
  },
  {
    collection: 'foreman-status',
    keySpec: { urlKey: 1, taskIdentifier: 1 },
    options: {},
    reason: 'issue-scoped agent-status read (getLoopsForIssue, LIN-613)'
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
  {
    collection: 'llm-call-log',
    keySpec: { urlKey: 1, expiresAt: 1 },
    options: {},
    reason: 'call-log list by workspace (lib/llm-call-log.js)'
  },
  {
    collection: 'prompt-traces',
    keySpec: { urlKey: 1, expiresAt: 1 },
    options: {},
    reason: 'trace list by workspace (lib/prompt-trace-store.js)'
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
