/**
 * Dispatch queue storage module.
 * Stores dispatched prompts in MongoDB, keyed by workspace urlKey.
 * Supports both MongoDB (production) and MangoDB (file-based, development).
 *
 * Schema:
 * {
 *   _id: string,              // Item ID (UUID)
 *   urlKey: string,           // Workspace URL key (indexed)
 *   prompt: string,           // The prompt text
 *   promptName: string,       // Display name (e.g., "blocked")
 *   kind: string,             // Stable task classification (PROMPT_TEMPLATES key, e.g. "implementation"; "custom" for freeform). See lib/prompt-templates.js DISPATCH_KINDS
 *   issueId: string,          // Issue UUID
 *   issueIdentifier: string,  // Issue identifier (e.g., "LIN-42")
 *   issueTitle: string,       // Issue title
 *   issueUrl: string,         // Full URL to issue
 *   dispatchedAt: Date,       // When item was dispatched
 *   dispatchedBy: string,     // Account ID of the dispatcher (optional)
 *   target: string,           // Dispatch target: 'cli' (default), 'web', 'dash', or 'local' (Harbour OS)
 *   repo: string,             // Target repo name (from project description, optional)
 *   model: string,            // Execution model the consumer/runner passes to its CLI (e.g. claude --model), optional/nullable. OpenRouter-style provider/model wire convention (e.g. 'anthropic/claude-opus-4.8'); opaque at the server boundary (NOT the OpenRouter generation model, NOT registry-validated). Stored + forwarded blindly; null preserves the consumer's current default. See LIN-438.
 *   harness: string,          // Execution harness the consumer/runner should use (e.g. 'claude-code', 'opencode'), optional/nullable. Opaque at the server boundary, not registry-validated. Stored + forwarded blindly; null preserves the consumer's own default. See LIN-1084.
 *   terminal: string,         // Terminal-emulator driver the consumer/runner should launch the session in (e.g. 'terminal', 'iterm', 'kitty', 'tmux'), optional/nullable. Opaque at the server boundary, not registry-validated, no Harbour-side default or precedence chain. Stored + forwarded blindly; null preserves the runner's own default. See LIN-2452.
 *   effort: string,           // Effort level for the consumer/runner to pass to its CLI (e.g. 'low', 'medium', 'high', 'xhigh', 'max'), optional/nullable. Opaque at the server boundary — an out-of-set value is accepted with a server-side warning, never rejected. Mirrors model's resolution shape (no anchor.effort tier). Stored + forwarded blindly; null preserves the consumer's own default/precedence chain. See LIN-2615.
 *   bootstrapToken: string,   // Structured single-use bootstrap token for the claude-code MCP branch (LIN-1155). Set only when the token is stripped from the prompt prose (attachProxyContext); delivered on poll/take (_formatItem) but deliberately NOT persisted to history (_archiveItem) nor exposed on the proxy list/watch endpoints. NOTE (LIN-3384): `_formatItem` ALSO feeds the session-readable queue list and trim responses, so the redaction lives at those routes (lib/dispatch-session-redaction.js), not here. null otherwise.
 *   followUpTo: string,       // Original dispatchId to resume as a follow-up (optional, nullable, cli/web only). Stored + forwarded blindly; the downstream dispatcher owns session identity/liveness. See LIN-415.
 *   force: boolean,           // Force-resume flag: when true a follow-up bypasses the runner's active-session liveness guard so a wedged/sleeping session can still be resumed (optional, defaults false). Only meaningful alongside followUpTo. Stored + forwarded blindly; the runner reads item.force. See LIN-559 (consumer-side gate: LIN-546).
 *   abort: boolean,           // Abort verb: when true this item asks the consumer to cancel/close an existing session instead of running a prompt (optional, defaults false). Carries no prompt. Stored + forwarded blindly; the consumer's abort arm reads abort/abortTo. See LIN-743 (verb internals: LIN-553).
 *   abortTo: string,          // The dispatchId of the session to abort (required when abort is true, UUID-shaped, else null). The abort item's OWN target — not the aborted session's substrate — governs poll eligibility. See LIN-743.
 *   cascade: boolean,         // Cascade-close modifier on an abort (optional, defaults false). When true, abortTo names the ROOT session of a subtree Harbour expands into one abort per descendant (the recursive walk is `expandCascadeAborts`). Route layer rejects cascade:true without abort. Stored + forwarded blindly; consumed by Harbour's expansion, not the runner. See LIN-946.
 *   sessionId: string,        // Autopilot dispatchId that spawned this worker dispatch (optional, nullable, any target). Stored + forwarded blindly; groups worker dispatches into one autopilot session. See LIN-591.
 *   periodicalId: string,     // Periodical-template join key (LIN-1825): the id of the periodicals-registry template (lib/periodicals.js) a Mint/Mint+Autopilot dispatch was minted from. Stamped once at dispatch time, never maintained — replaces the fragile join on promptName (a display string; the Mint+Autopilot variant sends "<title> + Autopilot"). null for every non-periodical dispatch. Does NOT propagate to a followUpTo/wake row (the factory's inheritance seam carries only issue fields + sessionGroupId + rootItemId) — a follow-up to a periodical run is not itself a fresh run of that template.
 *   sessionGroupId: string,   // Durable session-group id (LIN-1341): the id readers group follow-ups by, O(1), instead of walking the followUpTo chain. Precedence at ingest: an inherited parent group (a followUpTo dispatch whose anchor already carries one) ?? this item's own sessionId ?? this doc's own _id. Composes with, never overrides, sessionId grouping — a reply to an autopilot worker inherits the worker's sessionId as its group id, landing in the same session. Every row gets one; a pre-LIN-1341 row has none and readers fall back to the legacy followUpTo chain-walk for it.
 *   rootItemId: string,       // Per-runner-session lineage anchor (LIN-1468), item-doc-level. Precedence at ingest: an inherited followUpTo anchor's own rootItemId ?? this doc's own _id. TWO tiers only — deliberately never falls back to sessionId (unlike sessionGroupId), because every sibling worker an autopilot spawns shares one sessionId and a sessionId tier would collapse them onto one rootItemId, reinstating the sibling-collapse bug LIN-1461 fixed. Read precedence (getItemStatus's group-feedback merge): this field ?? the first feedback entry carrying rootItemId ?? doc._id. A pre-LIN-1468 row has none and derivation falls back accordingly; tolerated, never backfilled (no migration framework — see lib/db-indexes.js).
 *   waitForFollowUps: boolean,// Opt-in completion hold (default false). When true the runner holds the session open at completion to receive in-session follow-ups instead of finalizing. Stored + forwarded blindly; the runner owns the behaviour. See LIN-795/LIN-797.
 *   queueIfBusy: boolean,     // Push-comms (default false). When true the runner leaves a busy-target follow-up unclaimed rather than failing it (LIN-827 runner path). Stored + forwarded blindly; no Harbour semantics. See LIN-826.
 *   subscription: string,     // Push-comms edge declaration (LIN-900 §6): enum 'everything'|'terminal-only' (default 'terminal-only'). Declares which of this child's events wake its dispatching parent (§5 matrix). Stored + forwarded blindly; Harbour reads it only when building the wake follow-up. See LIN-826/LIN-901.
 *   producingItemId: string,  // Durable wake witness (LIN-1698): on a `kind:'wake'` row ONLY, the `_id` of the producing item whose terminal/blocked feedback minted this wake. Always the BARE producing-item id — never the composite `wakeWitnessMeta`/`terminalWakeItems` guard key (LIN-2297: `${producingItemId}#blocked` for a blocked wake), which is guard/witness identity, not row attribution. Set once at mint time in `_mintWake`; threaded through both `addItem`'s field list and `_archiveItem`'s allowlist so it survives the queue→history archive hop. null for every non-wake row.
 *   producingItemAttempt: number, // Durable wake witness (LIN-1698): 0-based mint attempt counter, paired with producingItemId. Phase 1 mints exactly one attempt (0) per producing item — the live CAS loses any repeat terminal for the SAME item outright, before a second attempt could ever be stamped. Reserved for a future re-mint (the sweep ticket) to increment; not written by anything in Phase 1's live path beyond the initial 0. null for every non-wake row.
 *   consumerLastSeenAt: string, // Consumer poll-recency stamp (LIN-2885): the most recent `lastUsedAt` across the workspace's non-revoked consumer tokens (lib/dispatch-tokens.js), as an ISO string, read ONCE at enqueue time by lib/dispatch-factory.js. null means no consumer token has ever polled/taken in this workspace ("never", not merely "not recently"). Read-only telemetry — never gates or delays the enqueue. The enqueue-time 201 `warning` is derived from this stamp via lib/consumer-poll-warning.js's buildConsumerPollWarning. Read-time `consumerPollWarning` (GET /dispatch/{id}, the lean list, the dispatch-page queue list) is NOT derived from the stamp: it comes from live poll recency, queued rows only (LIN-3367, buildQueuedPollWarning), sharing the same staleness threshold.
 *   grantDeclaration: object,  // Declared-mint record (LIN-3138 / LIN-3134 Decisions 2, 8, 9): the server-written `{ grants, ownerAccountId, workspaceId, profile: 'worker', site, declaredAt }` a declared launch resumed from. SPARSE — written on a queue/history document ONLY when present (conditional spread, never an unconditional `|| null`), so an undeclared document's key set is byte-identical to pre-LIN-3138 (S0). Never outward: stripped from `addItem`'s return and absent from every projection.
 *   grantRefusal: string,     // Declared-mint refusal code (LIN-3138 / LIN-3134 Decision 5): stamped beside `grantDeclaration` on a degraded declared wake row. Same sparse-write and secrecy treatment as `grantDeclaration`.
 *   issueSource: string,      // Dispatch binding selector (LIN-3242 / LIN-3126 §4): the provider/source of the binding an issue-addressed dispatch selected at enqueue time, SPARSE — written on a queue/history document ONLY when present (conditional spread, exactly like `grantDeclaration`), so an unstamped row keeps a byte-identical key set (S0). Selection-only provenance: read server-side by the session-lane referent guard and the effort read-out; never a credential (the call scope always comes from `getBindingCallScope` of the hydrated binding — B1/LIN-2473). Projected SPARSELY (only when present) by `_formatItem`/`_formatHistoryItem` for the effort read-out; the runner works from the prompt and ignores it.
 *   expiresAt: Date           // TTL-based expiration
 * }
 */

import crypto from 'crypto';
import { DispatchStoreFault } from './errors.js';

import { buildWakeFollowUp, formatGrantRefusalNotice } from './dispatch-wake.js';
import { normalizeRunFields, isPositiveInteger } from './dispatch-fields.js';
import { findWakeEvent, mergeLineageFeedback, deriveTerminalStatus, noOwnTerminalMarkerFilter, isLineageClosingTerminal } from './dispatch-terminal.js';
import { digestFeedback, isFreshDigest, _findDecisionWithdrawal, _findReversedDecisionIds } from './digest-feedback.js';
import { formatFeedbackEntries } from './dispatch-feedback-format.js';
import { LINEAGE_STATIC_SEED, LINEAGE_TAKEN_SEED, isLineageFresh, persistClosedLineage, persistLineageForEntry, recomputeLineageRows } from './dispatch-lineage-status.js';
import { readHorizonStart } from './read-horizon.js';
import { recordWakeShadow, readWakeShadowTally, wakeShadowVerdictId, WAKE_SHADOW_DEFAULT_DAYS } from './wake-shadow.js';

// LIN-3805: wrap a caught store error as the typed fault, leaving one that is
// already a DispatchStoreFault (e.g. thrown by _archiveItem inside takeItem) as is.
function asStoreFault(operation, err, opts) {
  return err instanceof DispatchStoreFault ? err : new DispatchStoreFault(operation, err, opts);
}

/**
 * Allowed values for a feedback ENTRY's `kind` (nested inside each `feedback[]`
 * element) — a vocabulary distinct from the dispatch-ITEM `kind` (DISPATCH_KINDS
 * in lib/prompt-templates.js, e.g. "implementation"/"custom"). Never validate
 * feedback-entry `kind` against DISPATCH_KINDS, and never write it top-level on
 * the doc. See LIN-1297.
 *
 * `'decision-answer'` (LIN-1728) is deliberately NOT a member: it is written
 * only via `markDecisionAnswered`, never through `addFeedback`/the runner-
 * facing sanitizer that reads this list (routes/dispatch.js) — a human Save
 * authenticates via session auth, not a runner token, and structurally cannot
 * use the runner-token write path. Keeping the kind out of this list is what
 * makes that guarantee structural rather than a convention.
 *
 * `'decision-withdrawn'` (LIN-2891/LIN-3035) IS a member — routes/dispatch.js
 * validates its `{decision_id, reason}` message (both required, non-empty)
 * immediately before the sole `addFeedback` call, but any caller holding a
 * valid feedback credential for the `taken` item can post one. That is a
 * narrower bound than "only the dispatcher process can reach the route":
 * the workspace-wide dispatch (runner) token lives in simple-dispatcher's
 * `workspaces.json`, readable by the agent's own OS user, and the Stop hook
 * reads it from disk inside the agent's own process tree — so an agent
 * session that reaches that file can stamp a withdrawal, with its stated
 * reason, on any item its token has taken. The Harbour OS local-target
 * token is narrower still: bound to one item, single-use, localhost-only.
 * Neither path is gated out here (John's ruling, LIN-3035 comment
 * `e56de2e1`; class audit in `c4ac57e1`) — what bounds a wrong withdrawal is
 * the required, visible `reason`; the item-scoped read; and the terminal
 * reversal below, which no token can ever call, only a logged-in human via
 * `workspaceFromUrl`. `'decision-withdrawal-reversed'` stays OFF this list,
 * for the same structural reason `'decision-answer'` does.
 */
export const FEEDBACK_ENTRY_KINDS = ['status', 'recap', 'heartbeat', 'evidence', 'assistant-text', 'tool', 'usage', 'resources', 'refusal', 'decision', 'decision-withdrawn'];

/**
 * Mongo/Mango read projection for lib/periodical-runs.js's `foldPeriodicalRuns`
 * (LIN-1827, LIN-373/G2 plan beat 1, decision 1). Beside FEEDBACK_ENTRY_KINDS
 * above, the existing precedent for a module-level exported constant. Homed
 * here rather than in the pure fold: a Mongo projection literal is storage
 * dialect, which this store already exists to own (it abstracts Mongo +
 * file-backed MangoDB); every other dispatch-store projection today is inline
 * at its read call site, and there is no repo precedent for a read-free module
 * exporting one. Keeping it beside `_formatItem` (:1826) / `_formatHistoryItem`
 * (:1301) means a formatter edit and a projection edit happen in the same
 * file, in view of each other — the same silent-drop discipline `_archiveItem`
 * (:772-827) already documents.
 */
export const PERIODICAL_PROJECTION = {
  kind: 1,
  periodicalId: 1,
  promptName: 1,
  dispatchedAt: 1,
  status: 1,
  followUpTo: 1,  // blocking correction 1 (research beat 2/4): omission makes the
                   // followUpTo-exclusion rule dead code — every row arrives null
  abort: 1,        // history-check finding (beat 2/3): identical silent-drop shape,
                   // confirmed present in both _archiveItem and both formatters
  repo: 1          // LIN-1932: same silent-drop shape again — _archiveItem and both
                   // formatters already carry repo (proven by probe), but the
                   // projection never granted it, so every queue/history read
                   // silently collapsed every repo to the default (null) lane
};

/**
 * LIN-2385: the periodicals HISTORY read's own projection — PERIODICAL_PROJECTION
 * plus `feedback: 1`, so the fold can require a terminal `[done]`/`[complete]`
 * marker (via lib/dispatch-terminal.js's deriveTerminalStatus), not just
 * `status: 'taken'`, before counting a row as run evidence. Deliberately a
 * SEPARATE constant, never merged into PERIODICAL_PROJECTION: the periodicals
 * QUEUE read (`listItems`) has no row-bounding predicate at all (unlike
 * `listHistory`, which can bound this on a `kind`/`periodicalId` predicate —
 * see `listHistory`'s `periodicalEvidenceRow` option below), so granting
 * `feedback` there would re-open the unbounded whole-workspace
 * `prompt`/`feedback[]` read this projection exists to prevent (the documented
 * cause of the LIN-1030 H12/503 incidents). Only the history read may use this.
 */
export const PERIODICAL_HISTORY_PROJECTION = { ...PERIODICAL_PROJECTION, feedback: 1 };

/**
 * Declared-mint lookup tuning (LIN-3138 / LIN-3134 Decision 10, R1).
 *
 * A row only ever moves from the active queue to history, by delete then insert
 * (`takeItem`'s `findOneAndDelete` then `_archiveItem`'s `insertOne`; cancel is
 * `deleteOne` then archive). The two steps are not atomic and there are no
 * transactions, so for one awaited round trip the row is in neither collection —
 * take is the normal lifecycle hop. Rows never return to the active queue, so a
 * second active read cannot find one; on a double miss the lookup re-reads
 * HISTORY a bounded number of times, about `GRANT_LOOKUP_RETRY_MS` apart, before
 * reporting `row-missing`. `GRANT_LOOKUP_HISTORY_RETRIES` re-reads bound the
 * added latency to about 150 ms, and the cost falls almost entirely on the rare
 * aged-out / wrong-id double miss. There is deliberately NO third active read.
 */
export const GRANT_LOOKUP_HISTORY_RETRIES = 3;
export const GRANT_LOOKUP_RETRY_MS = 50;

/**
 * The LIN-2955 Q1 predicate: whether a dispatch row is a FRESH run — exactly the
 * one row a Go press creates. This is the single shared definition of "a
 * person's Go"; callers must not re-implement the clauses.
 *
 * A run is continued, not started, by any of these shapes:
 *   followUpTo != null  — a follow-up beat resumes an existing run
 *   sessionId != null   — a worker carries its orchestrator's session id, so one
 *                         Go that spawns N workers is ONE run (and a
 *                         follow-up-shaped worker is excluded here too)
 *   cascade == true     — a cascade emits one abort per descendant
 *   kind == 'wake'      — a wake row continues a run (attribution is null anyway,
 *                         but the clause is pinned explicitly)
 *   abort == true       — an abort closes a session; it is never a run
 * Any other kind or target is a fresh manual dispatch on some rung: a Go.
 *
 * LIN-3238 (#1715) pins the same clauses for the free-tier run count as a Mongo
 * filter (`DispatchQueueStore.countFreshRunsSince`; `lib/dispatch-factory.js`'s
 * run gate applies them on caller fields). #1715 exports no JS predicate, so this
 * remains the single JS form; a test pins that it agrees with
 * `countFreshRunsSince`'s filter on one fixture (tests/unit/milestone-funnel.test.js).
 * LIN-2952 consumes it for first-Go attribution.
 *
 * Reads the stored row, so it is safe on a `find().toArray()` doc, on a queue
 * item, and on the `fields` object a dispatch-factory caller holds.
 *
 * @param {Object|null|undefined} row
 * @returns {boolean}
 */
export function isFreshRun(row) {
  if (!row || typeof row !== 'object') return false;
  return row.followUpTo == null
    && row.abort !== true
    && row.cascade !== true
    && row.sessionId == null
    && row.kind !== 'wake';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Append the autopilot session self-reference block to a kickoff prompt (LIN-599).
 *
 * An autopilot run must stamp its OWN dispatch id as `sessionId` on every worker
 * dispatch it spawns, so those workers group into one session (LIN-591). But the
 * id is minted here in `addItem` — after the kickoff prompt was built (and in a
 * separate request), so the running autopilot has no other channel to learn it.
 * This is the only point where the minted id and the prompt coexist, so for
 * `kind: 'autopilot'` we append a short, self-describing block naming the id.
 *
 * The block is self-contained on purpose: the kickoff guide (Seam B) tells the
 * autopilot to forward `sessionId`, and this is where it reads the concrete value.
 *
 * A standalone kickoff (built via `standalone: true`, e.g. the general
 * autopilot-prompt route) mints its OWN placeholder session id up front and tells
 * the orchestrator to use it — *unless* dispatched through the queue, in which case
 * this block's id is the true one (LIN-1737 B1). This block is that override: it
 * says so explicitly rather than relying on the standalone prose alone, so a
 * task-budget guard keyed on the real dispatch id can never fail open because the
 * orchestrator kept using the earlier placeholder.
 *
 * @param {string} prompt - The kickoff prompt text
 * @param {string} sessionId - The autopilot's own dispatch id (`doc._id`)
 * @returns {string} The prompt with the session-id block appended
 */
function appendAutopilotSessionRef(prompt, sessionId) {
  return `${prompt}

---

## Your autopilot session id

This run's own dispatch id — your **session id** — is \`${sessionId}\`. This is the
id to use: it **overrides any other session id mentioned earlier in this prompt**
(e.g. a standalone kickoff's placeholder, minted before this dispatch existed). Pass
\`${sessionId}\` as \`sessionId\` on **every** worker dispatch you issue this run: every
\`POST /recommend-and-dispatch\`, every plain \`POST /dispatch\`, and any \`followUpTo\`
liveness nudge. That explicit link is what groups all the work you spawn into this
one autopilot session.`;
}

/**
 * Dispatch queue store for managing dispatched prompts.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
// A simple-dispatcher stall warning (`kind:'heartbeat'`, text `[stalled?] …`): the
// one feedback entry that is evidence of inactivity rather than activity.
const STALL_WARNING_ENTRY = { kind: 'heartbeat', message: { $regex: '^\\[stalled\\?\\]' } };

/**
 * The store's DEFAULT read shape (LIN-3812, LIN-3810 H2): scalars plus the
 * self-healed `feedbackDigest`/`feedbackVersion`, no `prompt` (8-30 KB, up to MB)
 * and no raw `feedback[]` (unbounded `$push`). The prompt and the raw feedback
 * come only through the named methods (`getItemPrompt`, `getItemFeedback`,
 * `listItemsWithPrompt`, `listHistoryWithBodies`). An explicit `projection`
 * still wins for narrow reads; new callers should not add one.
 */
export const LEAN_HISTORY_PROJECTION = Object.freeze({ prompt: 0, feedback: 0 });
export const LEAN_QUEUE_PROJECTION = Object.freeze({ prompt: 0 });

/** Identity keys that bound a history read: a scalar or `{ $in: [non-empty scalars] }`. */
const HISTORY_BOUND_KEYS = ['issueIdentifier', 'sessionId', 'sessionGroupId', 'rootItemId', 'followUpTo'];

function isScalar(v) {
  return typeof v === 'string' || typeof v === 'number';
}

function isBoundValue(v) {
  if (isScalar(v) && v !== '') return true;
  const inList = v && typeof v === 'object' && Object.keys(v).length === 1 ? v.$in : undefined;
  return Array.isArray(inList) && inList.length > 0 && inList.every(isScalar);
}

/**
 * Thrown by `listHistory`/`listHistoryWithBodies` for a read with no `limit`,
 * no `since` and no identity key (LIN-3812): such a read is the workspace's
 * whole lifetime history (dispatch-history is lifetime-retained, LIN-3163).
 * A plain `Error`, not a `DispatchStoreFault`: that maps to a retryable 503,
 * and this is a programming error that retrying cannot fix.
 */
export class UnboundedHistoryReadError extends Error {
  constructor(message = 'listHistory requires a limit, a since, or an identity key (issueIdentifier | sessionId | sessionGroupId | rootItemId | followUpTo)') {
    super(message);
    this.name = 'UnboundedHistoryReadError';
  }
}

function assertBoundedHistoryRead({ limit, since, ...rest }) {
  if (limit || since) return;
  if (HISTORY_BOUND_KEYS.some(k => isBoundValue(rest[k]))) return;
  throw new UnboundedHistoryReadError();
}

/**
 * A history doc's own lineage anchor (LIN-1468 pinned precedence): the item-doc-level
 * `rootItemId` ?? the first own feedback entry carrying `rootItemId` ?? the doc's own
 * `_id`. ONE definition, read by `_collectGroupFeedback` (the watch body) and
 * `getItemWatchToken` (the watch's change detector), so the two cannot drift on
 * which siblings belong to a row's lineage (LIN-3812).
 * @param {{rootItemId?: string, feedback?: Array, _id: string}} doc
 * @returns {string}
 */
export function groupAnchorFor(doc) {
  return doc.rootItemId || (doc.feedback || []).find(f => f.rootItemId)?.rootItemId || doc._id;
}

export class DispatchQueueStore {
  /**
   * Creates a new dispatch queue store instance.
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection for storing items
   * @param {number} [options.ttl=86400] - Item time-to-live in seconds (default: 24 hours)
   * @param {Function} [options.onWrite] - Optional post-write hook (LIN-623). Invoked
   *   fire-and-forget after each feed-relevant write (dispatch add, archive, feedback)
   *   with `{ urlKey, sessionId, issueIdentifier }` so the Observation materializer can
   *   recompute the touched session's derived doc. Defaults to a no-op, so every
   *   existing caller stays byte-identical. NEVER blocks or fails the write it rides on.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.historyCollection = options.historyCollection || null;
    this.ttl = options.ttl || 86400; // 24 hours in seconds
    this.onWrite = typeof options.onWrite === 'function' ? options.onWrite : null;
    // LIN-3257 (M1 shadow): the OPTIONAL wake-shadow collection. Absent is a
    // no-op — the classifier still runs but nothing is stored and the proxy
    // reads return empty/null, so every existing caller/test stays
    // byte-identical. This is the ONLY new storage the shadow adds.
    this.wakeShadowCollection = options.wakeShadowCollection || null;
  }

  /**
   * Notify the post-write hook, fire-and-forget (LIN-623). A materializer failure
   * must never block or fail the dispatch write it rode in on, so this detaches
   * onto a microtask and swallows everything. A missed recompute self-heals on the
   * next write or via the read-miss live fallback.
   *
   * @param {{urlKey: string, sessionId?: string|null, issueIdentifier?: string|null}} payload
   * @private
   */
  _notifyWrite(payload) {
    if (!this.onWrite) return;
    Promise.resolve()
      .then(() => this.onWrite(payload))
      .catch(err => console.error('dispatch-store onWrite hook error:', err?.message || err));
  }

  /**
   * Feed-relevance gate for the `_notifyWrite` post-write hook (LIN-623, extended
   * LIN-1307). Fires the original sessioned/autopilot gate unchanged
   * (`kind==='autopilot'` or `sessionId`). A followUpTo-only write (the reply-box
   * case: no sessionId, kind !== 'autopilot') used to be silently skipped here —
   * that was the LIN-1307 gap, since it meant a follow-up's OWN addItem/take/
   * addFeedback writes never triggered a materializer rebuild. Now it resolves
   * the chain root via `_resolveEdgeDoc` (the same upward walk the wake-feedback
   * seam already uses) and notifies under the root's own session:
   *   - root.kind === 'autopilot' → notify `sessionId: root._id`
   *   - root.sessionId            → notify `sessionId: root.sessionId` (a worker)
   *   - otherwise                 → skip: the root is a standalone/manual
   *     dispatch, which stays live-only by design (matches the materializer's
   *     M1 test).
   * Best-effort: a resolution failure is swallowed so it can never break the
   * dispatch write it rides on. Callers do NOT await this — same fire-and-forget
   * contract as `_notifyWrite` itself.
   *
   * @param {Object} doc - the dispatch doc that just changed (queue or history shape)
   * @param {string} urlKey
   * @private
   */
  async _notifyWriteForDoc(doc, urlKey) {
    if (doc.kind === 'autopilot' || doc.sessionId) {
      this._notifyWrite({
        urlKey,
        sessionId: doc.kind === 'autopilot' ? doc._id : doc.sessionId,
        issueIdentifier: doc.issueIdentifier
      });
      return;
    }
    if (!doc.followUpTo || !this.historyCollection) return;
    try {
      const root = await this._resolveEdgeDoc(doc, urlKey);
      if (root.kind === 'autopilot') {
        this._notifyWrite({ urlKey, sessionId: root._id, issueIdentifier: doc.issueIdentifier });
      } else if (root.sessionId) {
        this._notifyWrite({ urlKey, sessionId: root.sessionId, issueIdentifier: doc.issueIdentifier });
      }
      // else: root is a standalone/manual dispatch — stays live-only, skip.
    } catch (err) {
      console.error('dispatch-store _notifyWriteForDoc resolve error:', err?.message || err);
    }
  }

  /**
   * Adds an item to the dispatch queue.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} item - Item to dispatch
   * @param {string} item.prompt - The prompt text
   * @param {string} item.promptName - Display name for the prompt
   * @param {string} [item.kind] - Stable task classification (a DISPATCH_KINDS value; defaults to 'custom')
   * @param {string} [item.issueId] - Issue UUID
   * @param {string} [item.issueIdentifier] - Issue identifier (e.g., "LIN-42")
   * @param {string} [item.issueTitle] - Issue title
   * @param {string} [item.issueUrl] - Full URL to issue
   * @param {string} [item.dispatchedBy] - Account ID of the dispatcher
   * @param {string} [item.target] - Dispatch target: 'cli' (default), 'web', 'dash', or 'local' (Harbour OS)
   * @param {string} [item.repo] - Target repo name (from project description)
   * @param {string} [item.model] - Execution model the consumer/runner passes to its CLI (OpenRouter-style provider/model wire convention; opaque, not registry-validated; NOT the OpenRouter generation model). Optional/nullable; stored + forwarded blindly; null preserves the consumer default (LIN-438)
   * @param {string} [item.harness] - Execution harness the consumer/runner should use (e.g. 'claude-code', 'opencode'). Optional/nullable; opaque, not registry-validated; stored + forwarded blindly; null preserves the consumer default (LIN-1084)
   * @param {string} [item.terminal] - Terminal-emulator driver the consumer/runner should launch the session in (e.g. 'terminal', 'iterm', 'kitty', 'tmux'). Optional/nullable; opaque, not registry-validated; stored + forwarded blindly; null preserves the runner's own default (LIN-2452)
   * @param {string} [item.effort] - Effort level for the consumer/runner to pass to its CLI (e.g. 'low', 'medium', 'high', 'xhigh', 'max'). Optional/nullable; opaque, not registry-validated; an out-of-set value is accepted with a warning, never rejected; stored + forwarded blindly; null preserves the consumer's own default/precedence chain (LIN-2615)
   * @param {Object} [item.presetConfig] - Frozen dispatch preset config snapshot (LIN-1390). Set only by the factory on kind:'autopilot' rows carrying a selected or inherited preset; null otherwise. Not a credential — persisted to history and exposed on list/watch/take.
   * @param {string} [item.presetName] - Display name of the preset `presetConfig` was captured from (LIN-1390); null when presetConfig is null.
   * @param {string} [item.bootstrapToken] - Structured single-use bootstrap token for the claude-code MCP branch (LIN-1155). Set only when the token is stripped from the prompt prose; delivered on poll/take, NOT persisted to history. Session-readable routes null it at the route boundary (LIN-3384). null otherwise
   * @param {string} [item.followUpTo] - Original dispatchId to resume as a follow-up (optional; stored + forwarded blindly)
   * @param {boolean} [item.force] - Force-resume flag: bypass the runner's active-session guard on a follow-up (optional; only meaningful with followUpTo; stored + forwarded blindly)
   * @param {boolean} [item.abort] - Abort verb: cancel/close an existing session instead of running a prompt (optional; carries no prompt; stored + forwarded blindly)
   * @param {string} [item.abortTo] - The dispatchId of the session to abort (required when abort is true; stored + forwarded blindly)
   * @param {boolean} [item.cascade] - Cascade-close modifier on an abort (default false); abortTo names a subtree root Harbour expands (the walk is `expandCascadeAborts`). Stored + forwarded blindly (LIN-946)
   * @param {string} [item.sessionId] - Autopilot dispatchId that spawned this worker (optional; stored + forwarded blindly)
   * @param {string} [item.periodicalId] - Periodical-template join key (LIN-1825): the periodicals-registry template id this dispatch was minted from (optional, nullable). Stamped once at dispatch time, never maintained; does not propagate to followUpTo/wake rows. See the schema comment above.
   * @param {string} [item.sessionGroupId] - Durable session-group id inherited from a followUpTo anchor (LIN-1341; normally set only by `createDispatchItem`'s follow-up inheritance seam, never by a caller directly). A root dispatch mints its own group id here from `item.sessionGroupId ?? item.sessionId ?? doc._id` — see the schema comment above for the full precedence rule.
   * @param {string} [item.rootItemId] - Per-runner-session lineage anchor inherited from a followUpTo anchor (LIN-1468; normally set only by `createDispatchItem`'s follow-up inheritance seam, never by a caller directly). A root dispatch mints its own anchor here from `item.rootItemId ?? doc._id` — two tiers only, never `sessionId`. See the schema comment above.
   * @param {boolean} [item.waitForFollowUps] - Opt-in completion hold (default false); stored + forwarded blindly, the runner owns the behaviour
   * @param {boolean} [item.queueIfBusy] - Push-comms (default false); runner leaves a busy-target follow-up unclaimed rather than failing it; stored + forwarded blindly (LIN-826/LIN-827)
   * @param {string} [item.subscription] - Push-comms edge declaration (LIN-900 §6): enum 'everything'|'terminal-only' (default 'terminal-only'); declares which events wake the dispatching parent; stored + forwarded blindly (LIN-826/LIN-901)
   * @param {string} [item.producingItemId] - Durable wake witness (LIN-1698): stamped by `_mintWake` on a `kind:'wake'` row only — the producing item's `_id`. Stored + forwarded blindly; null for every other caller.
   * @param {number} [item.producingItemAttempt] - Durable wake witness (LIN-1698): stamped by `_mintWake` alongside producingItemId — the 0-based mint attempt. Stored + forwarded blindly; null for every other caller.
   * @returns {Promise<Object>} The created item with ID
   */
  async addItem(urlKey, item) {
    // An abort item carries no prompt (it names a session to cancel via abortTo),
    // so prompt is required ONLY for non-abort dispatches. See LIN-743.
    if (!urlKey || (!item?.prompt && !item?.abort)) {
      throw new Error('urlKey and prompt are required');
    }

    const now = new Date();
    const doc = {
      _id: crypto.randomUUID(),
      urlKey,
      // An abort item carries no prompt; null is the explicit "no prompt" value.
      prompt: item.prompt || null,
      promptName: item.promptName || 'Prompt',
      // The 23 always-present run-row fields (kind, target, repo, model, harness,
      // terminal, effort, preset*, followUpTo, force, abort, cascade, sessionId,
      // periodicalId, maxTasks, stopAt, variant, waitForFollowUps, queueIfBusy,
      // subscription, consumerLastSeenAt) are declared once in lib/dispatch-fields.js.
      // Nothing below may repeat one of those keys: a later literal key would
      // override the spread.
      ...normalizeRunFields(item),
      issueId: item.issueId || null,
      issueIdentifier: item.issueIdentifier || null,
      issueTitle: item.issueTitle || null,
      issueUrl: item.issueUrl || null,
      dispatchedAt: now,
      dispatchedBy: item.dispatchedBy || null,
      // Structured single-use bootstrap token (LIN-1155). Set ONLY for the
      // claude-code harness branch (attachProxyContext), where the token is
      // stripped from the prompt prose and instead delivered here so the harness
      // can hand it to a primed MCP tool out-of-band — no credential in prompt
      // text for an injection guard to trip on. null for every other harness
      // (the token stays embedded in the prose block, as before). Delivered on
      // the consumer poll/take response (_formatItem) but deliberately NOT
      // persisted into history (_archiveItem) nor exposed on the proxy
      // list/watch endpoints (formatDispatchWatch / the list map) — it is a
      // live, single-use credential.
      // LIN-3384: `_formatItem` is not poll/take-only. It also backs listItems/
      // getItemStatus/trimSessionBudget, which the session queue list, trim and
      // the proxy /:id/prompt read serve — so those routes null this field (and
      // mask a prose Bearer line for non-owners) via
      // lib/dispatch-session-redaction.js. Poll/take must keep it.
      bootstrapToken: item.bootstrapToken || null,
      // Durable wake witness (LIN-1698): stamped by `_mintWake` on the wake
      // descriptor before this call, on a `kind:'wake'` row only. null for
      // every other caller — additive, no behavior change on any other path.
      producingItemId: item.producingItemId || null,
      producingItemAttempt: item.producingItemAttempt ?? null,
      // LIN-3138 (Decision 8): SPARSE writes — the declared-mint record and its
      // refusal code are copied whole, and ONLY when present. Deliberately not
      // the `|| null` convention used elsewhere (e.g. producingItemId): nothing
      // queries these on a default path, Mongo treats a missing key and null
      // alike, and an undeclared document must keep exactly the key set it had
      // before this field existed (S0 is the byte-identity witness). The record
      // is copied wholesale from the item, never merged from `fields`.
      ...(item.grantDeclaration != null ? { grantDeclaration: item.grantDeclaration } : {}),
      ...(item.grantRefusal != null ? { grantRefusal: item.grantRefusal } : {}),
      // LIN-3242 (LIN-3126 §4): the dispatch binding selector pair. Same SPARSE
      // conditional-spread idiom as `grantDeclaration` above: a row with no
      // selector keeps a byte-identical key set (S0), never an unconditional
      // `|| null`. Selection-only provenance — not a credential (B1/LIN-2473).
      ...(item.issueSource != null ? { issueSource: item.issueSource } : {}),
      // LIN-3853: the registry job the model-routing table resolved this row for. Same SPARSE
      // idiom: a row with no job (`defer`, a hand-built item) keeps its byte-identical key set.
      ...(item.jobId != null ? { jobId: item.jobId } : {}),
      expiresAt: new Date(now.getTime() + this.ttl * 1000)
    };

    // LIN-1341: durable session-group id, minted here (not in the factory) so it
    // can fall back to this doc's OWN freshly-minted `_id`. Precedence: an
    // inherited parent group (set by `createDispatchItem`'s followUpTo
    // inheritance seam onto `item.sessionGroupId`) ?? this item's own `sessionId`
    // (so an autopilot worker's group id equals its autopilot session id, and a
    // later reply to that worker inherits the SAME group) ?? this doc's own id
    // (a fresh root). See the schema comment above for the full rule.
    doc.sessionGroupId = item.sessionGroupId || doc.sessionId || doc._id;

    // LIN-1468: per-runner-session lineage anchor. TWO tiers only — an
    // inherited anchor (set by dispatch-factory.js's followUpTo inheritance
    // seam onto `item.rootItemId`, mirroring sessionGroupId above) ?? this
    // doc's own freshly-minted `_id`. Deliberately does NOT fall back to
    // `doc.sessionId` the way sessionGroupId does: every sibling worker an
    // autopilot spawns shares one sessionId, so a sessionId tier here would
    // give all siblings one identical rootItemId, reinstating the
    // sibling-collapse bug LIN-1461 fixed. See the schema comment above.
    doc.rootItemId = item.rootItemId || doc._id;

    // LIN-599: An autopilot kickoff can't know its own dispatch id until it's
    // minted just above — yet it must forward that id as `sessionId` on the
    // worker dispatches it spawns. Surface the id by appending a self-reference
    // block to the prompt. Gated on `kind === 'autopilot'`, so every other
    // dispatch (incl. the workers themselves, and collective fan-out) is left
    // byte-identical.
    if (doc.kind === 'autopilot') {
      doc.prompt = appendAutopilotSessionRef(doc.prompt, doc._id);
    }

    // LIN-3805: only the DB write is a store fault; the validation throw above is a
    // caller bug and stays a plain Error.
    try {
      await this.collection.insertOne(doc);
    } catch (err) {
      console.error('Error adding dispatch item:', err);
      throw new DispatchStoreFault('addItem', err);
    }
    // Recompute the Observation read-model for this session (LIN-623). Feed-
    // relevant dispatches carry/seed a session: an autopilot kickoff IS the
    // session (`doc._id`), a worker forwards its `sessionId`, and a followUpTo-
    // only write (the reply box) resolves to its chain root (LIN-1307). A plain
    // manual dispatch with none of these never appears in the sessions feed, so
    // it's skipped inside the helper.
    this._notifyWriteForDoc(doc, urlKey);
    // LIN-3138 (Decision 9): secrecy at the SOURCE. `addItem` returns the raw
    // doc to the factory (`createDispatchItem`'s `return item`), and every one
    // of the 10 callers consumes that object — so this return is the outward
    // boundary for the declared-mint record. When the persisted doc carries
    // either new field, hand back a shallow copy WITHOUT them; the persisted
    // document and `_notifyWriteForDoc` above keep the full record. An
    // undeclared item carries neither key, so it returns the SAME object as
    // before, byte-identical.
    if ('grantDeclaration' in doc || 'grantRefusal' in doc) {
      const outward = { ...doc };
      delete outward.grantDeclaration;
      delete outward.grantRefusal;
      return outward;
    }
    return doc;
  }

  /**
   * Looks up a single dispatch item by ID and reports its lifecycle status.
   *
   * Resolves across BOTH collections, because an item moves from the active
   * queue to history the moment a consumer takes it:
   *   - still in the active queue          → status 'queued'
   *   - archived in history (taken/etc.)   → its history status
   * Returns null if the ID is unknown to the workspace. This is the read
   * ("watch") half the autopilot orchestrator polls after dispatching.
   *
   * @param {string} urlKey - Workspace URL key (scopes the lookup)
   * @param {string} itemId - Item ID (UUID)
   *
   * LIN-3812: the LEAN shape - scalars plus a fresh, self-healed `feedbackDigest`,
   * no `prompt` and no raw `feedback[]`. Callers that need those use
   * `getItemPrompt` / `getItemFeedback` (the latter owns the LIN-1461 group merge).
   *
   * @param {string} urlKey - Workspace URL key (scopes the lookup)
   * @param {string} itemId - Item ID (UUID)
   * @returns {Promise<Object|null>} `{ id, status, target, issue*, feedbackDigest, ... }` or null (the row is genuinely absent)
   * @throws {DispatchStoreFault} on a store fault (LIN-3805): never null, which means absent
   */
  async getItemStatus(urlKey, itemId) {
    return this._readItem(urlKey, itemId, 'getItemStatus', { lean: true });
  }

  /**
   * The row WITH its prompt (LIN-3812): `GET /api/proxy/dispatch/:id/prompt`'s
   * read. Still no raw feedback.
   * @throws {DispatchStoreFault}
   */
  async getItemPrompt(urlKey, itemId) {
    return this._readItem(urlKey, itemId, 'getItemPrompt', { projection: { feedback: 0 } });
  }

  /**
   * The row's scalars plus its raw `feedback[]`, no prompt (LIN-3812). The watch
   * seam and the re-mint guard read terminal status off the feedback itself.
   *
   * @param {Object} [options]
   * @param {boolean} [options.includeGroupFeedback] - Merge in sibling-session
   *   feedback via `_collectGroupFeedback` (LIN-1461): an EXTRA indexed query plus
   *   an in-memory filter/sort, so opt-in. Without it, the row's OWN feedback.
   * @throws {DispatchStoreFault}
   */
  async getItemFeedback(urlKey, itemId, { includeGroupFeedback = false } = {}) {
    const row = await this._readItem(urlKey, itemId, 'getItemFeedback', { projection: { prompt: 0 }, includeGroupFeedback });
    // The pre-LIN-3812 `getItemStatus` shape: `feedback` is always an array (queued rows have none yet).
    if (row && !row.feedback) row.feedback = [];
    return row;
  }

  /**
   * Shared point read behind `getItemStatus`/`getItemPrompt`/`getItemFeedback`.
   * `lean` is the default read contract: no prompt, no feedback, self-healed digest.
   * @private
   */
  async _readItem(urlKey, itemId, operation, { lean = false, projection, includeGroupFeedback = false } = {}) {
    if (!urlKey || !itemId) {
      return null;
    }

    try {
      const historyProjection = lean ? LEAN_HISTORY_PROJECTION : projection;
      const queueProjection = lean ? LEAN_QUEUE_PROJECTION : projection;
      // Active queue first — present here means not yet taken.
      const active = await this.collection.findOne({ _id: itemId, urlKey }, queueProjection ? { projection: queueProjection } : undefined);
      if (active) {
        const formatted = { ...this._formatItem(active), status: 'queued' };
        if (!lean) formatted.feedback = [];
        return formatted;
      }

      // Otherwise it may have been taken (and possibly fed back on).
      if (this.historyCollection) {
        const hist = await this.historyCollection.findOne({ _id: itemId, urlKey }, historyProjection ? { projection: historyProjection } : undefined);
        if (hist) {
          const formatted = this._formatHistoryItem(hist);
          if (lean) {
            const [healed] = await this._selfHealDigests([formatted]);
            return healed;
          }
          if (includeGroupFeedback) {
            formatted.feedback = await this._collectGroupFeedback(urlKey, hist);
          }
          return formatted;
        }
      }

      return null;
    } catch (err) {
      console.error(`Error reading dispatch item (${operation}):`, err);
      throw asStoreFault(operation, err);
    }
  }

  /**
   * Self-heal (LIN-3011, moved into the store by LIN-3812): a lean history row
   * whose `feedbackDigest` is missing or stale has nothing to derive facts from,
   * so it is re-read whole by `_id` (`redigestHistoryRows`, prompt excluded) and
   * served with the fresh digest. A re-read failure THROWS and fails the fill (R5):
   * never a partial batch, a dropped row or a silently nulled fact. A row the lean
   * read found but the re-read did not (a TTL/delete race) is served with its
   * last-known digest and logged, not dropped.
   * @param {Array<Object>} rows - formatted history rows
   * @private
   */
  async _selfHealDigests(rows) {
    const needsHeal = (item) => item?.id && !isFreshDigest(item);
    const staleIds = rows.filter(needsHeal).map(item => item.id);
    if (staleIds.length === 0) return rows;

    const healed = await this.redigestHistoryRows(staleIds);
    return rows.map((item) => {
      if (!needsHeal(item)) return item;
      const fresh = healed.get(item.id);
      if (!fresh) {
        console.error(`Self-heal: row ${item.id} vanished between the lean read and the _id $in re-read (best-effort, likely a TTL/delete race) — serving it with its last-known (stale) digest.`);
        return item;
      }
      return { ...item, feedbackVersion: fresh.feedbackVersion, feedbackDigest: fresh.feedbackDigest };
    });
  }

  /**
   * Re-read history rows WHOLE by `_id` (prompt excluded), digest each, and when
   * `persist` write the digest back guarded on the row's own `feedbackVersion`
   * (best-effort: a write-back failure is logged only). Shared by the lean
   * self-heal and the ticket closer's legacy-digest verify. A re-read failure
   * propagates; an id whose row vanished is absent from the result.
   *
   * @param {string[]} ids
   * @param {{persist?: boolean}} [opts]
   * @returns {Promise<Map<string, {feedbackVersion: number, feedbackDigest: Object}>>}
   */
  async redigestHistoryRows(ids, { persist = true } = {}) {
    const healed = new Map();
    if (!Array.isArray(ids) || ids.length === 0 || !this.historyCollection) return healed;
    const rawDocs = await this.historyCollection
      .find({ _id: { $in: ids } }, { projection: { prompt: 0 } })
      .toArray();
    await Promise.all(rawDocs.map(async (raw) => {
      const version = raw.feedbackVersion ?? 0;
      const feedbackDigest = digestFeedback(raw, { now: Date.now() });
      feedbackDigest.version = version;
      if (persist) {
        try {
          await this.historyCollection.updateOne(
            { _id: raw._id, feedbackVersion: raw.feedbackVersion ?? null },
            { $set: { feedbackDigest } }
          );
        } catch (err) {
          console.error('Error writing back healed feedbackDigest (best-effort):', err?.message || err);
        }
      }
      healed.set(raw._id, { feedbackVersion: version, feedbackDigest });
    }));
    return healed;
  }

  /**
   * Everything that follows a landed feedback `$push` (LIN-3812; was four copies of the
   * digest block): (a) the best-effort `feedbackDigest` write, CAS on `feedbackVersion`,
   * then (b) the lineage persistence (lib/dispatch-lineage-status.js): sibling fan-out for
   * a tagged entry and a recompute for a status-bearing one. Each part has its own
   * try/catch and only logs: the append already landed and must never turn into the
   * caller's null/404. `doc` is the whole post-write document (the digest needs
   * `dispatchedAt` and the raw `feedback`). Runs BEFORE `_notifyWriteForDoc`, so every
   * write-triggered materialization sees a fresh digest.
   * @private
   */
  async _afterFeedbackWrite(doc, entry) {
    try {
      const feedbackDigest = digestFeedback(doc, { now: Date.now() });
      feedbackDigest.version = doc.feedbackVersion;
      await this.historyCollection.updateOne(
        { _id: doc._id, feedbackVersion: doc.feedbackVersion },
        { $set: { feedbackDigest } }
      );
    } catch (err) {
      console.error('Error updating feedbackDigest (best-effort):', err?.message || err);
    }
    try {
      await persistLineageForEntry(this.historyCollection, doc, entry);
    } catch (err) {
      console.error('Error persisting lineage fields (best-effort, healed on read):', err?.message || err);
    }
  }

  /**
   * One-time-per-process-per-workspace backfill of the persisted lineage fields (LIN-3812):
   * derives every `taken` row that has never been derived (`lineageStatusBasis` null or
   * absent: every pre-LIN-3812 row) in `_id`-ordered batches. The DB-side `?status=`
   * filter reads these fields, so without it the filter would silently miss old rows. No
   * deploy-time migration; a failure is not memoised, so the next read retries.
   * @param {string} urlKey
   * @returns {Promise<void>}
   * @throws {DispatchStoreFault}
   */
  ensureLineageStatus(urlKey) {
    if (!urlKey || !this.historyCollection) return Promise.resolve();
    this._lineageBackfills ??= new Map();
    let pending = this._lineageBackfills.get(urlKey);
    if (!pending) {
      pending = this._backfillLineage(urlKey).catch((err) => {
        this._lineageBackfills.delete(urlKey);
        console.error('Error backfilling lineage fields:', err);
        throw asStoreFault('ensureLineageStatus', err);
      });
      this._lineageBackfills.set(urlKey, pending);
    }
    return pending;
  }

  /** @private */
  async _backfillLineage(urlKey) {
    const BATCH = 100;
    let after = null;
    for (;;) {
      const query = { urlKey, status: 'taken', lineageStatusBasis: null };
      if (after !== null) query._id = { $gt: after };
      const rows = await this.historyCollection
        .find(query, { projection: { prompt: 0, feedback: 0, feedbackDigest: 0 } })
        .sort({ _id: 1 })
        .limit(BATCH)
        .toArray();
      if (rows.length === 0) return;
      await recomputeLineageRows(this.historyCollection, urlKey, rows.map(r => r._id));
      after = rows[rows.length - 1]._id;
      if (rows.length < BATCH) return;
    }
  }

  /**
   * The history half of `GET /api/proxy/dispatch` (LIN-3812, closes LIN-2120): one page of
   * rows plus the exact matching `total`, with `?status=` evaluated IN THE DATABASE on the
   * persisted lineage status. Each item is the lean history row plus `lineage:
   * {status, completedAt, feedbackCount}`; a row whose persisted values are stale
   * (never derived, or a raced write) is re-derived and written back before it is served.
   *
   * `status` is the wire status: `queued` selects nothing here (queue rows are not
   * history), `cancelled`/`expired` are stored statuses, `taken` is a running row
   * (`lineageStatus: null`), anything else is a lineage status of a `taken` row.
   * Callers filtering on a lineage status call `ensureLineageStatus` first.
   * @returns {Promise<{items: Array, total: number}>}
   * @throws {DispatchStoreFault}
   */
  async listHistoryLineageRows(urlKey, { issueIdentifier, status, limit } = {}) {
    if (!urlKey || !this.historyCollection || status === 'queued') return { items: [], total: 0 };
    try {
      const query = { urlKey };
      if (issueIdentifier) query.issueIdentifier = issueIdentifier;
      if (status === 'cancelled' || status === 'expired') query.status = status;
      else if (status === 'taken') Object.assign(query, { status: 'taken', lineageStatus: null });
      else if (status) Object.assign(query, { status: 'taken', lineageStatus: status });
      const [docs, total] = await Promise.all([
        this.historyCollection
          .find(query, { projection: { prompt: 0, feedback: 0, feedbackDigest: 0 } })
          // The page is the newest DISPATCHED rows (the route's order); the old read took the
          // newest-resolved window and re-sorted it, which differs whenever a row resolved
          // before an earlier-dispatched one. Index-backed by {urlKey, dispatchedAt}.
          .sort({ dispatchedAt: -1 })
          .limit(limit || 100)
          .toArray(),
        this.historyCollection.countDocuments(query)
      ]);
      const stale = docs.filter(d => !isLineageFresh(d)).map(d => d._id);
      const healed = stale.length ? await recomputeLineageRows(this.historyCollection, urlKey, stale) : new Map();
      let dropped = 0;
      const items = [];
      for (const doc of docs) {
        const f = healed.get(doc._id) || doc;
        // The filter ran on the PERSISTED status; a stale row's healed status may differ.
        // Serve it only under the filter it now matches (the wire status: the lineage one,
        // else the stored one) and take it out of this filter's total.
        if (status && (f.lineageStatus || doc.status) !== status) { dropped++; continue; }
        items.push({
          ...this._formatHistoryItem(doc),
          lineage: {
            status: f.lineageStatus ?? null,
            completedAt: f.lineageCompletedAt ?? null,
            feedbackCount: f.lineageFeedbackCount ?? 0
          }
        });
      }
      return { items, total: total - dropped };
    } catch (err) {
      console.error('Error listing dispatch history lineage rows:', err);
      throw asStoreFault('listHistoryLineageRows', err);
    }
  }

  /**
   * The watch long-poll's change detector (LIN-3812). The watch used to re-read the
   * whole document plus the lineage's feedback every 1.5 s just to notice that
   * something moved. This reads scalars only and returns a fingerprint; the caller
   * re-reads with `getItemFeedback` only when the fingerprint changes.
   *
   * What it fingerprints is a SUPERSET of what the body derives its answer from:
   * the row's own `feedbackVersion` / `status` / `bookkeeping` and, when the row has
   * a `sessionGroupId`, the same sibling candidate set `_collectGroupFeedback` merges
   * (`{urlKey, rootItemId: anchor}`, any status, uncapped) as `{_id, feedbackVersion,
   * status, bookkeeping}`. Every feedback writer `$inc`s `feedbackVersion`, so a
   * cancelled or expired sibling, or a `[done]` on a follow-up, moves the token.
   * Because it is a superset, a token move can be a false alarm (the body is
   * unchanged); the caller's `dispatchWatchChanged` on the re-read body decides.
   * It deliberately does NOT read the persisted list fields.
   *
   * A legacy row (a `sessionGroupId` but no doc-level `rootItemId`) resolves its
   * anchor from its first tagged own feedback entry, so only such rows pay for
   * reading their own `feedback`.
   *
   * @returns {Promise<string|null>} null when the row is genuinely absent
   * @throws {DispatchStoreFault}
   */
  async getItemWatchToken(urlKey, itemId) {
    if (!urlKey || !itemId) return null;
    try {
      const queued = await this.collection.findOne({ _id: itemId, urlKey }, { projection: LEAN_QUEUE_PROJECTION });
      if (queued) return JSON.stringify(['queue']);
      if (!this.historyCollection) return null;
      const scalars = { prompt: 0, feedbackDigest: 0 };
      let own = await this.historyCollection.findOne({ _id: itemId, urlKey }, { projection: { ...scalars, feedback: 0 } });
      if (!own) return null;
      const parts = ['history', own.status ?? null, own.feedbackVersion ?? 0, own.bookkeeping ?? null];
      if (own.sessionGroupId) {
        if (!own.rootItemId) {
          own = await this.historyCollection.findOne({ _id: itemId, urlKey }, { projection: scalars }) || own;
        }
        const anchor = groupAnchorFor(own);
        const siblings = await this.historyCollection
          .find({ urlKey, rootItemId: anchor, _id: { $ne: own._id } }, { projection: { ...scalars, feedback: 0 } })
          .toArray();
        parts.push(siblings
          .map(d => [String(d._id), d.feedbackVersion ?? 0, d.status ?? null, d.bookkeeping ?? null])
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
      }
      return JSON.stringify(parts);
    } catch (err) {
      console.error('Error reading dispatch watch token:', err);
      throw asStoreFault('getItemWatchToken', err);
    }
  }

  /**
   * Read the LIN-3257 shadow verdict for one minted wake row, or null. Read-only
   * and workspace-scoped; a no-op (null) when no shadow collection is wired.
   * Never throws — the proxy read degrades to null rather than failing the
   * watch response.
   *
   * @param {string} urlKey
   * @param {string} wakeRowId - the `kind:'wake'` dispatch row id
   * @returns {Promise<{wouldSkip: boolean, reason: string}|null>}
   */
  async getWakeShadow(urlKey, wakeRowId) {
    if (!this.wakeShadowCollection || !urlKey || !wakeRowId) return null;
    try {
      const doc = await this.wakeShadowCollection.findOne({ _id: wakeShadowVerdictId(wakeRowId), urlKey });
      if (!doc) return null;
      return { wouldSkip: doc.wouldSkip === true, reason: doc.reason || null };
    } catch (err) {
      // internal-only: best-effort observability, header says "never throws"
      console.error('Error reading wake shadow (best-effort):', err?.message || err);
      return null;
    }
  }

  /**
   * Read the LIN-3257 shadow per-day tally over the last `days` UTC days.
   * Read-only and workspace-scoped; returns an empty, well-formed summary when
   * no shadow collection is wired (the no-op degrade). Never throws.
   *
   * @param {string} urlKey
   * @param {Object} [options]
   * @param {number} [options.days=7]
   * @param {Date} [options.now]
   * @returns {Promise<{days: Array, totals: Object}>}
   */
  async getWakeShadowTally(urlKey, { days = WAKE_SHADOW_DEFAULT_DAYS, now = new Date() } = {}) {
    try {
      return await readWakeShadowTally(this.wakeShadowCollection, urlKey, { days, now });
    } catch (err) {
      // internal-only: best-effort observability, header says "never throws"
      console.error('Error reading wake shadow tally (best-effort):', err?.message || err);
      return { days: [], totals: { minted: 0, wouldSkip: 0, share: 0, byReason: {} } };
    }
  }

  /**
   * Reads the declared-mint record for a dispatch row (LIN-3138 / LIN-3134
   * Decisions 2, 8, 10). Called by `provisionResumeCredential` in
   * `lib/proxy-preamble.js` when a follow-up resumes a declared dispatch.
   *
   * Returns a distinguishable result, never a bare null:
   *   - `{ state: 'record', record }` — the row exists and carries a record
   *     (`doc.grantDeclaration ?? null`; a missing key and null read alike).
   *   - `{ state: 'none' }`            — the row exists, no record.
   *   - `{ state: 'row-missing' }`     — the row is in neither collection.
   *
   * Lookup order (R1): active `findOne`, then history `findOne`. On a double
   * miss, up to `GRANT_LOOKUP_HISTORY_RETRIES` HISTORY-ONLY re-reads,
   * `GRANT_LOOKUP_RETRY_MS` apart, stopping at the first that finds the row —
   * this closes the normal take-hop window (a row is briefly in neither
   * collection between `takeItem`'s delete and its history insert). There is
   * deliberately no third active read: rows never return to the active queue.
   * The re-read is skipped entirely when there is no history collection.
   *
   * The read NEVER goes through `_formatItem` / `_formatHistoryItem` — it is an
   * internal, `urlKey`-scoped `findOne({ _id, urlKey })` so a wrong-workspace id
   * cannot resolve.
   *
   * A read that THROWS at any step, including a re-read, is logged (ids only,
   * never values) and rethrown with `declarationLookupFailed = true`. This is a
   * deliberate departure from `getItemStatus`'s swallow-and-return-null:
   * swallowing would let a transient fault resume a declared orchestrator
   * grant-less. The helper (S3) maps the flag to a transient refusal. The
   * accepted residuals — an archive insert slower than the bound, or a
   * swallowed `_archiveItem` insert failure — still end as `row-missing`.
   *
   * @param {string} urlKey - Workspace URL key (scopes the lookup)
   * @param {string} itemId - Row id (UUID)
   * @returns {Promise<{state: 'record', record: Object}|{state: 'none'}|{state: 'row-missing'}>}
   * @throws {Error} On a read fault, with `declarationLookupFailed = true`
   */
  async getGrantDeclaration(urlKey, itemId) {
    const readActive = () => this.collection.findOne({ _id: itemId, urlKey });
    const readHistory = () => (
      this.historyCollection
        ? this.historyCollection.findOne({ _id: itemId, urlKey })
        : Promise.resolve(null)
    );
    const classify = (doc) => {
      const record = doc.grantDeclaration ?? null;
      return record != null ? { state: 'record', record } : { state: 'none' };
    };

    try {
      const active = await readActive();
      if (active) return classify(active);

      const hist = await readHistory();
      if (hist) return classify(hist);

      for (let i = 0; i < GRANT_LOOKUP_HISTORY_RETRIES; i++) {
        await sleep(GRANT_LOOKUP_RETRY_MS);
        const reread = await readHistory();
        if (reread) return classify(reread);
      }

      console.warn('[dispatch] resume-declaration-lookup-miss', { urlKey, itemId });
      return { state: 'row-missing' };
    } catch (err) {
      console.error('[dispatch] resume-declaration-lookup-error', { urlKey, itemId, message: err?.message });
      // LIN-3805: typed so the route layer answers a retryable 503. The flag stays for
      // callers that read it.
      const fault = asStoreFault('getGrantDeclaration', err);
      fault.declarationLookupFailed = true;
      throw fault;
    }
  }

  /**
   * Merge feedback across every history item that shares this doc's durable
   * session-group id (LIN-1341's `sessionGroupId`), so a caller polling
   * `getItemStatus` on the ORIGINAL dispatch id it dispatched keeps seeing
   * feedback posted after a follow-up REPOINTS the session onto a new item
   * id (the runner's next feedback/heartbeat POST lands on the new item's
   * own history doc, not the original's).
   *
   * `sessionGroupId` alone is NOT a safe merge key (LIN-1461 rework): it falls
   * back to `doc.sessionId` when unset (this file's `addItem`), and every
   * worker an autopilot orchestrator spawns carries `sessionId` == the
   * orchestrator's id — so ALL sibling workers in one autopilot run share ONE
   * sessionGroupId. Merging on that alone pulls a still-running sibling's
   * feedback (including a `[done]` terminal marker) into an UNRELATED item's
   * view. `rootItemId`, tagged on every feedback entry by the runner
   * (simple-dispatcher reapers.js:76-81, feedback.js:39 —
   * `session.rootItemId || itemMetadata.itemId`), is the actual per-runner-
   * session anchor: distinct for sibling workers (each is its own runner
   * session), shared across a single lineage's follow-up repoints (a
   * follow-up's session carries the SAME original rootItemId throughout).
   *
   * LIN-1468 (full-A) re-keyed the candidate query itself onto the item-doc-
   * level `rootItemId` (indexed, `lib/db-indexes.js`), instead of the broader
   * `{urlKey, sessionGroupId}` LIN-1461 used as a cheap-but-over-broad
   * pre-filter — the entry-level filter below is what actually enforces
   * lineage isolation either way, so this narrows the candidate set the same
   * filter has to walk. The `groupId` gate above is UNCHANGED: it still
   * decides whether this doc participates in a group at all, so a
   * pre-LIN-1341 legacy row (no sessionGroupId) still skips the query
   * entirely, exactly as before.
   *
   * The lineage anchor is derived per the pinned precedence: THIS doc's own
   * `rootItemId` field ?? the first own feedback entry carrying `rootItemId`
   * ?? the doc's own `_id`. Doc-level wins because `addFeedback` (Step 4)
   * reconciles that field on every tagged feedback write, so for any doc that
   * has received tagged feedback the two tiers agree by construction; the
   * entry-level tier only matters in the narrow window between insert and
   * first tagged feedback. A sibling entry with no `rootItemId` at all
   * (pre-LIN-1289 legacy data) never matches and is conservatively excluded —
   * the queried item must NOT absorb feedback it can't verify belongs to its
   * own lineage.
   *
   * Only merges `feedback`; every other field on the returned item (id,
   * prompt, promptName, status, ...) stays the QUERIED item's own — callers
   * like `GET /api/proxy/dispatch/:id/prompt` deliberately want THIS item's
   * own prompt, not a follow-up's. Falls back to the doc's own feedback when
   * it has no `sessionGroupId` (a pre-LIN-1341 legacy row), or when the
   * sibling query itself fails. See LIN-1461, LIN-1468.
   *
   * @param {string} urlKey
   * @param {Object} doc - the resolved history doc for the queried item
   * @returns {Promise<Array>} formatted feedback entries across the lineage,
   *   timestamp-ascending. Ties are ordered by `mergeLineageFeedback` (own
   *   first, then sibling rows by `_id`), NOT by the sibling `find()`'s order,
   *   which is deliberately left unsorted (LIN-1465).
   * @private
   */
  async _collectGroupFeedback(urlKey, doc) {
    const ownFeedback = doc.feedback || [];
    const groupId = doc.sessionGroupId;
    if (!groupId || !this.historyCollection) {
      return this._formatFeedbackEntries(ownFeedback);
    }

    // This item's own lineage anchor (LIN-1468 pinned precedence): the
    // item-doc-level field ?? the first own feedback entry carrying
    // `rootItemId` ?? this doc's own `_id`. Doc-level wins because Step 4's
    // write-time reconciliation (addFeedback) latches producer truth onto the
    // doc on every tagged feedback write, so for any doc that has received
    // tagged feedback the two tiers are identical by construction — computed
    // BEFORE the candidate query below so the re-keyed lookup can query on it
    // directly (full-A, LIN-1468).
    const anchor = groupAnchorFor(doc);

    let siblings;
    try {
      // Re-keyed candidate query (LIN-1468 full-A): was `{sessionGroupId:
      // groupId}` (over-broad — see LIN-1461's history above), now scoped
      // directly to this item's own rootItemId lineage. Straight swap, not a
      // union with the old sessionGroupId clause: pre-launch there is no
      // meaningful corpus of field-less rows for a union to rescue, so the
      // simpler query is safe (see LIN-1468 description for the fallback
      // condition if that premise turns out false). The `groupId` gate above
      // is UNCHANGED — it still decides whether this doc participates in a
      // group at all (a pre-LIN-1341 legacy row has no sessionGroupId and
      // skips the query entirely, same as before).
      siblings = await this.historyCollection
        .find(
          { urlKey, rootItemId: anchor, _id: { $ne: doc._id } },
          { projection: { feedback: 1 } }
        )
        .toArray();
    } catch (err) {
      // LIN-3805: own-feedback-only would read a hidden sibling `[done]` as "still
      // running" on the watch route; a fault is surfaced, not degraded.
      console.error('Error collecting session-group feedback:', err);
      throw new DispatchStoreFault('_collectGroupFeedback', err);
    }
    if (!siblings.length) {
      return this._formatFeedbackEntries(ownFeedback);
    }

    // LIN-1480: forward-only lineage merge, sharing the list endpoint's
    // implementation (LIN-1470 review F7) so the invariant "a row is never
    // reported complete before it was itself dispatched" has ONE definition.
    // `ownFeedback` is never filtered — only inherited sibling entries are
    // gated — so this row's own terminal always survives.
    return this._formatFeedbackEntries(
      mergeLineageFeedback(ownFeedback, siblings, anchor, doc.dispatchedAt)
    );
  }

  /**
   * Lists all items in the queue for a workspace.
   * Excludes expired items.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options]
   * @param {string} [options.issueIdentifier] - Restrict to one Linear issue
   *   (e.g. "LIN-42"). Pushed into the query so an issue-scoped read uses the
   *   {urlKey, issueIdentifier} index rather than scanning the whole queue (LIN-613).
   * @param {string} [options.sessionId] - Restrict to one autopilot session. Pushed
   *   into the query so the Observation materializer can discover a session's full
   *   issue closure via the {urlKey, sessionId} index instead of scanning (LIN-623).
   * @param {string|Object} [options.sessionGroupId] - Restrict to one durable session
   *   group (LIN-1341) — a scalar id, or a Mongo operator object (e.g. `{ $in: [...] }`).
   *   Pushed into the query so the Observation materializer can gather a stamped
   *   group's rows in one indexed read instead of walking followUpTo.
   * @param {string|Object} [options.rootItemId] - Restrict to one per-runner-session
   *   lineage (LIN-1468) — a scalar id, or a Mongo operator object. Pushed into the
   *   query so `_collectGroupFeedback`'s re-keyed candidate lookup uses the
   *   `{urlKey, rootItemId}` index instead of an unindexed scan.
   * @param {string|Object} [options.followUpTo] - Restrict to rows resuming a given
   *   dispatch id — a scalar id, or a Mongo operator object (e.g. `{ $in: [...] }`)
   *   to batch several ids in one query. Pushed into the query so the Observation
   *   materializer's downward followUpTo BFS can discover live follow-up rows
   *   without a full scan (LIN-1307).
   * @param {Object} [options.projection] - Mongo field projection passed straight to
   *   `find()`. Mirrors `listHistory`: a column filter, NOT a row cap — same rows,
   *   minus excluded fields. Readers that don't need the (potentially multi-KB)
   *   `prompt` set `{ prompt: 0 }` so a real DB never transfers it. Omit it (the
   *   default) for byte-identical full-document reads; `pollAvailable` does so the
   *   consumer still receives the prompt it must run.
   * @returns {Promise<Array>} Array of queued items
   * @throws {DispatchStoreFault} on a store fault (LIN-3805): `[]` means an empty queue
   */
  async listItems(urlKey, opts = {}) {
    return this._readQueue(urlKey, opts, 'listItems', { projection: opts.projection ?? LEAN_QUEUE_PROJECTION });
  }

  /**
   * `listItems` WITH each row's prompt (LIN-3812): the runner's `pollAvailable`
   * must hand the consumer the prompt it has to run, and the dispatch page's
   * queue list renders `firstPromptLine(item.prompt)`. The queue is small and
   * TTL-bounded, so this is the one queue read that stays whole-document.
   * @throws {DispatchStoreFault}
   */
  async listItemsWithPrompt(urlKey, opts = {}) {
    return this._readQueue(urlKey, opts, 'listItemsWithPrompt', { projection: opts.projection });
  }

  /** @private */
  async _readQueue(urlKey, { issueIdentifier, sessionId, sessionGroupId, rootItemId, followUpTo } = {}, operation, { projection } = {}) {
    if (!urlKey) {
      return [];
    }

    try {
      const now = new Date();
      const query = { urlKey, expiresAt: { $gt: now } };
      if (issueIdentifier) query.issueIdentifier = issueIdentifier;
      if (sessionId) query.sessionId = sessionId;
      if (sessionGroupId) query.sessionGroupId = sessionGroupId;
      if (rootItemId) query.rootItemId = rootItemId;
      if (followUpTo) query.followUpTo = followUpTo;
      const findOpts = projection ? { projection } : undefined;
      const docs = await this.collection.find(query, findOpts).toArray();

      return docs.map(doc => this._formatItem(doc));
    } catch (err) {
      console.error('Error listing dispatch items:', err);
      throw new DispatchStoreFault(operation, err);
    }
  }

  /**
   * Gets the count of items in the queue for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Count of queued items
   * @throws {DispatchStoreFault} on a store fault (LIN-3805): `0` means an empty queue
   */
  async countItems(urlKey) {
    if (!urlKey) {
      return 0;
    }

    try {
      const now = new Date();
      // LIN-3812: a count, not a find + length. This runs on the 1 s queue-badge
      // poll; materialising every queued prompt to read `.length` was the cost.
      // `countDocuments` is implemented by MangoDB and by tests/fixtures/mock-collection.js,
      // and already runs in production on the history collection (listHistory),
      // so there is no fallback and no feature check.
      return await this.collection.countDocuments({
        urlKey,
        expiresAt: { $gt: now }
      });
    } catch (err) {
      console.error('Error counting dispatch items:', err);
      throw new DispatchStoreFault('countItems', err);
    }
  }

  /**
   * Removes a specific item from the queue.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} itemId - Item ID to remove
   * @returns {Promise<boolean>} True if item was removed; false when it is genuinely absent
   * @throws {DispatchStoreFault} on a store fault (LIN-3805). A fault while archiving
   *   restores the deleted row to the queue first (_archiveOrRestore), so a retry can succeed.
   */
  async removeItem(urlKey, itemId) {
    if (!urlKey || !itemId) {
      return false;
    }

    try {
      // Fetch doc before deleting so we can archive it
      const doc = await this.collection.findOne({ _id: itemId, urlKey });
      const result = await this.collection.deleteOne({
        _id: itemId,
        urlKey
      });

      if (result.deletedCount > 0 && doc) {
        await this._archiveOrRestore(doc, 'cancelled');
      }

      return result.deletedCount > 0;
    } catch (err) {
      console.error('Error removing dispatch item:', err);
      throw asStoreFault('removeItem', err);
    }
  }

  /**
   * Atomically claims and removes an item from the queue.
   * Used by consumers to take items for processing.
   * Returns null if item doesn't exist, is expired, or was already taken.
   *
   * @param {string} itemId - Item ID to take
   * @param {string} [urlKey] - Optional workspace URL key for verification
   * @param {string} [tokenLabel] - Taking token's label (legacy ownership key)
   * @param {string} [tokenId] - Taking proxy token's id (LIN-3130 runner
   *   ownership key); null for a legacy dispatch/Harbour OS take
   * @param {Object} [opts]
   * @param {string[]} [opts.targets] - LIN-3622: opt-in; only claim a row whose
   *   target is in this list (an absent target counts as `cli`, so it matches
   *   too). Checked inside the atomic delete: a refused row is neither removed
   *   nor archived. Omitted = any target (dispatch-token and Harbour OS takes).
   * @returns {Promise<Object|null>} The taken item, or null when it is genuinely absent
   * @throws {DispatchStoreFault} on a store fault (LIN-3805). A fault while archiving
   *   restores the claimed row to the queue first (_archiveOrRestore), so the 503 is
   *   honestly retryable rather than a retry that finds the row gone.
   */
  async takeItem(itemId, urlKey = null, tokenLabel = null, tokenId = null, { targets } = {}) {
    if (!itemId) {
      return null;
    }

    try {
      const now = new Date();
      const query = {
        _id: itemId,
        expiresAt: { $gt: now }
      };

      // If urlKey provided, verify it matches (for consumer API security)
      if (urlKey) {
        query.urlKey = urlKey;
      }

      if (targets) {
        query.target = { $in: [...targets, null] };
      }

      // Atomic find and delete
      const doc = await this.collection.findOneAndDelete(query);

      if (!doc) {
        return null;
      }

      await this._archiveOrRestore(doc, 'taken', { takenByTokenLabel: tokenLabel, takenByTokenId: tokenId });

      return this._formatItem(doc);
    } catch (err) {
      console.error('Error taking dispatch item:', err);
      throw asStoreFault('takeItem', err);
    }
  }

  /**
   * Polls for available items in a workspace.
   * Returns items without removing them.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<Array>} Array of available items
   * @throws {DispatchStoreFault} on a store fault (LIN-3805), via listItems
   */
  async pollAvailable(urlKey) {
    return this.listItemsWithPrompt(urlKey);
  }

  /**
   * Removes all expired items from the queue.
   * Called periodically to prevent stale item buildup.
   *
   * LIN-3163 (LIN-3157 B): dispatch-history evidence is retained for the
   * project's lifetime, so the history half of this cleanup (the
   * `historyCollection.deleteMany` on `historyExpiresAt`) was removed. The
   * 24 h queue archive-then-delete below is unchanged.
   *
   * @returns {Promise<number>} Number of items removed
   */
  async cleanup() {
    try {
      const now = new Date();

      // Archive expired items before deleting. LIN-3805: _archiveItem now throws on a
      // store fault, so archive per row and delete only the rows that archived; a row
      // that failed (or a failed read of the expired set) stays queued for the next
      // cleanup instead of being deleted un-archived.
      if (this.historyCollection) {
        const archivedIds = [];
        try {
          const expired = await this.collection.find({
            expiresAt: { $lt: now }
          }).toArray();
          for (const doc of expired) {
            try {
              await this._archiveItem(doc, 'expired');
              archivedIds.push(doc._id);
            } catch (archiveErr) {
              console.error('Error archiving expired item:', doc._id, archiveErr);
            }
          }
        } catch (archiveErr) {
          console.error('Error archiving expired items:', archiveErr);
        }
        if (!archivedIds.length) return 0;
        const archivedResult = await this.collection.deleteMany({
          _id: { $in: archivedIds },
          expiresAt: { $lt: now }
        });
        return archivedResult.deletedCount || 0;
      }

      const result = await this.collection.deleteMany({
        expiresAt: { $lt: now }
      });
      return result.deletedCount || 0;
    } catch (err) {
      // internal-only: maintenance timer; the count of removed rows is not an answer to a client
      console.error('Dispatch queue cleanup error:', err);
      return 0;
    }
  }

  /**
   * Clears all items for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of items removed
   */
  async clear(urlKey) {
    try {
      const result = await this.collection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      // internal-only: test helper; the count of removed rows is not an answer to a client
      console.error('Error clearing dispatch queue:', err);
      return 0;
    }
  }

  /**
   * Archives a queue item to the history collection.
   *
   * @param {Object} doc - Original queue document
   * @param {'taken'|'expired'|'cancelled'} status - Resolution status
   * @param {Object} [metadata] - Additional metadata
   * @param {string} [metadata.takenByTokenLabel] - Token label for taken items
   * @param {string} [metadata.takenByTokenId] - Taking proxy token's id
   *   (LIN-3130); stored only, never formatted (see _formatHistoryItem)
   * @throws {DispatchStoreFault} when the history insert faults (LIN-3805). A duplicate
   *   key on the shared `_id` means the row is already archived (a lost ack on an earlier
   *   attempt), which counts as success: archiving is idempotent.
   * @private
   */
  async _archiveItem(doc, status, metadata = {}) {
    if (!this.historyCollection) return;

    const now = new Date();
    let inserted = false;
    try {
      await this.historyCollection.insertOne({
        _id: doc._id,
        urlKey: doc.urlKey,
        prompt: doc.prompt || null,
        promptName: doc.promptName,
        // Declared once in lib/dispatch-fields.js (see addItem); a field missing
        // from this hop is the silent-drop class that module exists to close.
        ...normalizeRunFields(doc),
        issueId: doc.issueId,
        issueIdentifier: doc.issueIdentifier,
        issueTitle: doc.issueTitle,
        issueUrl: doc.issueUrl,
        dispatchedAt: doc.dispatchedAt,
        dispatchedBy: doc.dispatchedBy,
        // Graceful-trim audit trail (LIN-2147): must be threaded across the
        // queue→history archive hop for the same reason as maxTasks (see
        // RUN_FIELDS.maxTasks in lib/dispatch-fields.js) — a trim applied
        // while the kickoff row is still queued must not vanish the instant a
        // runner takes it.
        trimHistory: doc.trimHistory || [],
        sessionGroupId: doc.sessionGroupId || null,
        rootItemId: doc.rootItemId || null,
        // Durable wake witness (LIN-1698): must be threaded here explicitly —
        // a wake row is archived within seconds of being claimed (`_archiveItem(doc,
        // 'taken')`), and without this allowlist entry both fields silently drop on
        // that hop, reproducing the exact silent-drop failure class this ticket
        // exists to close.
        producingItemId: doc.producingItemId || null,
        producingItemAttempt: doc.producingItemAttempt ?? null,
        // LIN-3138 (Decision 8): the archive allow-list must stay in step with
        // `addItem`'s explicit document — the LIN-1698/LIN-1751/LIN-3130
        // silent-drop class. Both new fields are SPARSE: copied from the source
        // doc only when present, so an undeclared row's history document keeps
        // exactly the key set it had at e9c8b3f1 (S0), while a declared row's
        // record (and a degraded wake row's refusal code) survive the
        // queue→history hop unchanged — take, cancel and expiry all archive
        // through here.
        ...(doc.grantDeclaration != null ? { grantDeclaration: doc.grantDeclaration } : {}),
        ...(doc.grantRefusal != null ? { grantRefusal: doc.grantRefusal } : {}),
        // LIN-3242 (LIN-3126 §4): the dispatch binding selector pair, threaded
        // across the queue→history archive hop with the same SPARSE conditional
        // spread as `grantDeclaration` above (the LIN-1698/LIN-1751/LIN-3130
        // silent-drop class) — a row with no selector keeps a byte-identical
        // history key set (S0).
        ...(doc.issueSource != null ? { issueSource: doc.issueSource } : {}),
        // LIN-3853: survives the queue→history hop like issueSource (sparse).
        ...(doc.jobId != null ? { jobId: doc.jobId } : {}),
        status,
        resolvedAt: now,
        takenByTokenLabel: metadata.takenByTokenLabel || null,
        // LIN-3130 (LIN-1698/1751 silent-drop class): the taking proxy token's
        // id, so runner feedback ownership can key on it across the queue→history
        // hop. STORED ONLY — deliberately not formatted into _formatHistoryItem
        // (a metadata key, not part of the item wire shape). Explicit null for a
        // legacy take (dispatch token / Harbour OS self-take), so the legacy
        // feedback filter's `takenByTokenId: null` matches both it and every
        // pre-existing row (absent).
        takenByTokenId: metadata.takenByTokenId || null,
        // Digest seeding (LIN-3010, LIN-2996 Phase 2): a queue doc never
        // carries feedback, a digest, or a count — this is a seeding point,
        // not a passthrough. Every newly inserted history row starts in this
        // known state so the guard counter tracks the length for every new
        // row (see lib/digest-feedback.js and the shared isFreshDigest
        // predicate, which reads a legacy row's absent fields the same way).
        feedbackVersion: 0,
        feedbackDigest: null,
        // Lineage-field seeding (LIN-3812, see lib/dispatch-lineage-status.js).
        // cancelled/expired never join a lineage, so they are born fresh; a `taken`
        // row is born "not yet derived" and derived just below, because sibling
        // entries stamped between its dispatch and its take already count for it.
        ...(status === 'taken' ? LINEAGE_TAKEN_SEED : LINEAGE_STATIC_SEED)
      });
      inserted = true;
    } catch (err) {
      // History `_id` is the queue `_id`: a duplicate key is this row already archived.
      if (err?.code !== 11000) {
        console.error('Error archiving dispatch item:', err);
        throw new DispatchStoreFault('_archiveItem', err);
      }
    }
    // Archive-time derivation (LIN-3812): the insert is an input change for the row it
    // creates. After the insert, so a sibling write landing before the recompute's read
    // is in the read and one landing after is fanned out to this row and bumps its basis
    // (the CAS retries). A failure leaves the null basis for the read-time self-heal and
    // never faults the take; a duplicate-key archive skips it.
    if (inserted && status === 'taken') {
      try {
        await recomputeLineageRows(this.historyCollection, doc.urlKey, [doc._id]);
      } catch (err) {
        console.error('Error deriving lineage fields at archive (best-effort, healed on read):', err?.message || err);
      }
    }
    // The dispatch moved to history (taken/cancelled/expired) — its session's
    // derived doc must reflect the new terminal/agentState (LIN-623). Same
    // feed-relevance gate as addItem, including the LIN-1307 followUpTo
    // resolution. Outside the fault-throwing try: a notify failure is best-effort
    // (its own catch at _notifyWriteForDoc), never a store fault.
    this._notifyWriteForDoc(doc, doc.urlKey);
  }

  /**
   * LIN-3805: archive a row the caller has ALREADY removed from the queue (takeItem's
   * findOneAndDelete, removeItem's deleteOne), without leaving a retry that finds the
   * row gone. On an archive fault:
   *   1. read history for the `_id`; found = the insert landed and only the ack was
   *      lost, so the archive succeeded (no restore, the caller's 200 is honest);
   *   2. not found = nothing was archived: put the queue doc back exactly as deleted
   *      (same `_id`, no re-stamping, so LIN-3622 `target` checks and `expiresAt` hold)
   *      and rethrow, making the 503 truly retryable;
   *   3. the history read itself faults = outcome unknown: do NOT restore (that could
   *      leave one `_id` in both collections); log loudly and rethrow. Residual: the row
   *      is neither restored nor archived, so a retry 404s, as it did before this change.
   *
   * @param {Object} doc - the queue document as deleted
   * @param {'taken'|'expired'|'cancelled'} status
   * @param {Object} [metadata] - as _archiveItem
   * @throws {DispatchStoreFault}
   * @private
   */
  async _archiveOrRestore(doc, status, metadata = {}) {
    try {
      await this._archiveItem(doc, status, metadata);
      return;
    } catch (archiveErr) {
      if (!(archiveErr instanceof DispatchStoreFault)) throw archiveErr;
      let landed;
      try {
        landed = await this.historyCollection.findOne({ _id: doc._id, urlKey: doc.urlKey });
      } catch (readErr) {
        console.error(`LIN-3805: archive outcome unknown for ${doc._id} (history read failed); NOT re-queuing:`, readErr);
        throw archiveErr;
      }
      if (landed) {
        this._notifyWriteForDoc(doc, doc.urlKey);
        return;
      }
      try {
        await this.collection.insertOne(doc);
      } catch (restoreErr) {
        if (restoreErr?.code !== 11000) {
          console.error(`LIN-3805: could not restore ${doc._id} to the queue after an archive fault; a retry will not find it:`, restoreErr);
        }
      }
      throw archiveErr;
    }
  }

  /**
   * Lists history items for a workspace, sorted by resolvedAt descending.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {Object} [options] - Query options
   * @param {number} [options.limit] - Maximum items to return (omit for all)
   * @param {number} [options.offset=0] - Number of items to skip
   * @param {string} [options.issueIdentifier] - Restrict to one Linear issue
   *   (e.g. "LIN-42"). Pushed into the query so an issue-scoped read uses the
   *   {urlKey, issueIdentifier} index rather than pulling the whole workspace's
   *   30-day history and filtering in JS (LIN-613).
   * @param {Date} [options.since] - Restrict to rows whose `dispatchedAt` is at
   *   or after this instant. A selective predicate (NOT a row cap), pushed into
   *   the query so rows the feed would discard anyway — anything older than the
   *   30-day lookback, plus any cleanup-lag backlog — are never materialised.
   *   Correctness-identical to the `dispatchedAt` cutoff pipeline-loops applies
   *   in JS, just moved server-side to bound peak memory (LIN-622).
   * @param {Object} [options.projection] - Mongo field projection passed straight
   *   to `find()`. The lean Observation feed sets `{ prompt: 0 }` to stop
   *   transferring + BSON-deserialising the dominant per-row field (~8–30 KB) it
   *   never reads, cutting the cold whole-workspace read (LIN-623). A column
   *   filter, NOT a row cap — it materialises the same rows, minus excluded
   *   fields. Omit it (the default) for byte-identical full-document reads.
   * @param {string} [options.sessionId] - Restrict to one autopilot session. Pushed
   *   into the query so the Observation materializer can discover every issue a
   *   session touched via the {urlKey, sessionId} index instead of scanning (LIN-623).
   * @param {string|Object} [options.sessionGroupId] - Restrict to one durable session
   *   group (LIN-1341) — a scalar id, or a Mongo operator object (e.g. `{ $in: [...] }`).
   *   Mirrors the `sessionId` clause; lets the Observation materializer gather a
   *   stamped group's history rows in one indexed read instead of walking followUpTo.
   * @param {string|Object} [options.rootItemId] - Restrict to one per-runner-session
   *   lineage (LIN-1468) — a scalar id, or a Mongo operator object. Mirrors the
   *   `sessionGroupId` clause; used by `_collectGroupFeedback`'s re-keyed candidate
   *   lookup so it hits the `{urlKey, rootItemId}` index instead of an unindexed scan.
   * @param {string|Object} [options.followUpTo] - Restrict to rows resuming a given
   *   dispatch id — a scalar id, or a Mongo operator object (e.g. `{ $in: [...] }`)
   *   to batch several ids in one query. Mirrors the `sessionId` clause; used by the
   *   Observation materializer's downward followUpTo BFS (LIN-1307).
   * @param {string} [options.status] - Restrict to one STORED status (`taken` /
   *   `cancelled` / `expired`). Until LIN-2079 status was only ever a JS filter
   *   applied by the route over an already-materialised page, so it could not
   *   select rows the newest-N window had never reached.
   * @param {Date} [options.silentSince] - Restrict to rows with NO feedback entry
   *   at or after this instant — an age-of-ACTIVITY predicate (LIN-2079, Option A).
   *   Note the direction: `since` above is a LOWER bound on `dispatchedAt`
   *   ("recent"); this is the opposite, "silent since". Keyed on
   *   `feedback[].timestamp` rather than `resolvedAt` deliberately — `resolvedAt`
   *   is CLAIM time, so a healthy lineage claimed days ago whose last heartbeat
   *   landed a minute ago would match identically to a genuine tombstone. A row
   *   with an empty or absent `feedback` array has no entry at or after any
   *   cutoff, so it is selected too — that is the silent hard-stop zombie the
   *   ticket is named after.
   *
   *   Both clauses are RESIDUAL filters: the {urlKey, resolvedAt:-1} index
   *   (lib/db-indexes.js) still serves the urlKey equality and the resolvedAt
   *   sort the limit path pushes down, and these are applied on top — the same
   *   cost class as the sessionId/sessionGroupId/followUpTo clauses above, on a
   *   collection scoped by urlKey (dispatch-history is lifetime-retained since
   *   LIN-3163, so the read carries the caller's own `since` bound, not a TTL).
   *   No new index, no stored field, no migration.
   *
   *   This is ROW-level silence, not LINEAGE-level: the route layer merges
   *   lineage feedback before deriving status, but a store predicate sees only
   *   the row's own array, so a parent row whose lineage stayed alive on a
   *   follow-up row still reads as silent. Harmless by construction — the
   *   predicate SELECTS, it never evicts, so over-selection costs nothing.
   *   Lineage-aware selection belongs with the observability family (LIN-2120).
   * @param {boolean} [options.periodicalEvidenceRow] - Restrict to rows a periodical
   *   evidence fold can match (LIN-2385): `kind: 'periodical'` OR a non-null
   *   `periodicalId`. A deliberate, scoped exception to this file's "no `$or`"
   *   convention (the LIN-2147 precedent right above rejected a generic `$or`-
   *   capable option because `tests/fixtures/mock-collection.js` — ~20 other
   *   store test files' shared fixture — has no `$or` support; widening it was
   *   a wider blast radius than the tradeoff it would close). This option is
   *   therefore narrowly named to its one caller and DELIBERATELY UNTESTED
   *   against the mock — it is exercised only against a real MangoDB tmpdir
   *   instance (see tests/unit/periodical-runs.test.js's round-trip block,
   *   following the LIN-2079 precedent in
   *   tests/unit/dispatch-store-silence-predicate.test.js). Exists to bound the
   *   periodicals route's history read BEFORE that read's projection widens to
   *   include `feedback` (PERIODICAL_HISTORY_PROJECTION above) — narrow rows
   *   first, then widen columns.
   * @returns {Promise<{items: Array, total: number}>} History items and total count
   * @throws {DispatchStoreFault} on a store fault (LIN-3805): an empty page means no history
   */
  async listHistory(urlKey, opts = {}) {
    return this._readHistory(urlKey, opts, 'listHistory', { lean: true });
  }

  /**
   * `listHistory` WITH each row's prompt and raw `feedback[]` (LIN-3812). For the
   * readers that render or scan them (the dispatch page's history list, the
   * non-lean loop builders). Same bound as `listHistory`: it refuses a read with
   * no `limit`, `since` or identity key.
   * @throws {UnboundedHistoryReadError}
   * @throws {DispatchStoreFault}
   */
  async listHistoryWithBodies(urlKey, opts = {}) {
    return this._readHistory(urlKey, opts, 'listHistoryWithBodies', { projection: opts.projection });
  }

  /**
   * One query builder behind both history reads. The default (`lean`) shape is
   * scalars + a fresh, self-healed digest; an explicit `projection` passes
   * through untouched (and so is not self-healed: the caller chose its columns).
   * @private
   */
  async _readHistory(urlKey, opts, operation, { lean = false, projection } = {}) {
    const { limit, offset = 0, issueIdentifier, since, sessionId, sessionGroupId, rootItemId, followUpTo, status, silentSince, periodicalEvidenceRow } = opts;
    if (!urlKey || !this.historyCollection) {
      return { items: [], total: 0 };
    }
    assertBoundedHistoryRead(opts);

    try {
      const query = { urlKey };
      if (issueIdentifier) query.issueIdentifier = issueIdentifier;
      if (sessionId) query.sessionId = sessionId;
      if (sessionGroupId) query.sessionGroupId = sessionGroupId;
      if (rootItemId) query.rootItemId = rootItemId;
      if (followUpTo) query.followUpTo = followUpTo;
      if (since) query.dispatchedAt = { $gte: since };
      if (status) query.status = status;
      // "No feedback entry at or after the cutoff" — Mongo array-traversal
      // semantics, so an empty or absent `feedback` array matches too (LIN-2079).
      if (silentSince) query.$nor = [{ 'feedback.timestamp': { $gte: silentSince } }];
      if (periodicalEvidenceRow) query.$or = [{ kind: 'periodical' }, { periodicalId: { $ne: null } }];
      const explicit = opts.projection;
      const effective = explicit ?? (lean ? LEAN_HISTORY_PROJECTION : projection);
      const findOpts = effective ? { projection: effective } : undefined;
      const heal = lean && !explicit;

      // `limit` pushes sort+skip+limit into the query so Mongo returns only the
      // newest N rows (index-backed by {urlKey, resolvedAt:-1}) instead of reading
      // the history into memory and slicing in JS (the LIN-1030 fix). `total` stays
      // the full matching count so paginating callers are unaffected.
      if (limit) {
        const [docs, total] = await Promise.all([
          this.historyCollection
            .find(query, findOpts)
            .sort({ resolvedAt: -1 })
            .skip(offset)
            .limit(limit)
            .toArray(),
          this.historyCollection.countDocuments(query)
        ]);
        const items = docs.map(doc => this._formatHistoryItem(doc));
        return { items: heal ? await this._selfHealDigests(items) : items, total };
      }

      // No limit: a `since` window or an identity key bounds the read (enforced
      // above), and the sort is the database's, not a JS sort over the result.
      const docs = await this.historyCollection.find(query, findOpts).sort({ resolvedAt: -1 }).toArray();
      const items = docs.slice(offset).map(doc => this._formatHistoryItem(doc));
      return {
        items: heal ? await this._selfHealDigests(items) : items,
        total: docs.length
      };
    } catch (err) {
      console.error('Error listing dispatch history:', err);
      throw asStoreFault(operation, err);
    }
  }

  /**
   * Find the newest FRESH dispatch for one issue+kind inside a recency window
   * (LIN-1656) — the read half of the duplicate-dispatch guard.
   *
   * Reads BOTH collections, because a dispatch lives in exactly one of them and
   * which one is a function of age: `dispatch-queue` holds a row only while it is
   * unclaimed and the runner polls every ~5s, so for anything more than a few
   * seconds old `dispatch-history` (which preserves the ORIGINAL `dispatchedAt`,
   * see `_archiveItem`) is the common case. A queue-only read would have caught
   * approximately none of the overlaps this guard exists for. It can be in either,
   * never both: `takeItem` is a `findOneAndDelete` followed by an archive insert.
   *
   * DELIBERATELY NOT `listItems`/`listHistory`: both return FORMATTED items whose
   * `dispatchedAt` is an ISO **string** (`_formatItem` / `_formatHistoryItem`), and
   * a JS string comparison inside a guard whose entire semantics is a date
   * comparison is a silent-wrong-answer shape. This method derives its result from
   * the raw doc, so `dispatchedAt` comes back as a real `Date` the caller can do
   * arithmetic on.
   *
   * Both collections carry the `{urlKey, issueIdentifier}` index (lib/db-indexes.js),
   * so each read is one index seek plus a residual in-memory filter — no new index
   * and no migration. `projection: { prompt: 0 }` is always applied: an untrimmed
   * dispatch doc carries an 8–30 KB prompt this caller never reads.
   *
   * Dual-backend safe: `$gte` on `dispatchedAt` and `$ne` are already in production
   * use on both MongoDB and the file-backed MangoDB (see `listHistory`'s `since`
   * clause), so no new operator is introduced.
   *
   * Fails OPEN on a read error (returns null ⇒ the caller dispatches). The guard's
   * asymmetry is the reason: wrong in the permissive direction it merely does
   * nothing, wrong in the restrictive direction it silently blocks legitimate work.
   *
   * @param {string} urlKey - Workspace URL key (the first clause; a duplicate in a
   *   different workspace is not a duplicate)
   * @param {Object} options
   * @param {string} options.issueIdentifier - Issue identifier (e.g. "LIN-42").
   *   Required: a row with no issue identity has nothing to key on.
   * @param {string} options.kind - The RESOLVED dispatch kind (the stored `kind`,
   *   not a caller's raw/absent argument). Required: same-issue different-kind
   *   pairs are the normal pipeline and must never collide.
   * @param {Date} options.since - Lower bound on `dispatchedAt` (inclusive).
   * @returns {Promise<{id: string, dispatchedAt: Date}|null>} The newest matching
   *   fresh dispatch, or null when there is none (or the read failed).
   */
  async findRecentFreshDispatch(urlKey, { issueIdentifier, kind, since } = {}) {
    if (!urlKey || !issueIdentifier || !kind || !since) return null;

    // Every clause is deliberate:
    //   urlKey/issueIdentifier — the indexed scope
    //   kind                   — mandatory; the pipeline legitimately runs
    //                            research → plan → implementation on one issue
    //                            within minutes
    //   followUpTo: null       — a follow-up IS the intended second dispatch
    //   abort: { $ne: true }   — a cascade emits one abort per descendant in the
    //                            same second, by design ($ne also matches an
    //                            absent field, which is the pre-LIN-743 shape)
    //   dispatchedAt: { $gte } — the recency window; never a `status` match, so the
    //                            stale `taken` pile (LIN-1594) cannot participate
    //   status: { $ne: 'cancelled' } — LIN-3968 (ruling, option a): a row the person
    //                            undid never ran, so running that stage again is not
    //                            a duplicate (Home offers the undone stage again).
    //                            Only an exclusion: a queue row has no status, and
    //                            `$ne` matches an absent field
    const query = {
      urlKey,
      issueIdentifier,
      kind,
      followUpTo: null,
      abort: { $ne: true },
      dispatchedAt: { $gte: since },
      status: { $ne: 'cancelled' }
    };
    const findOpts = { projection: { prompt: 0 } };

    try {
      const collections = [this.collection, this.historyCollection].filter(Boolean);
      const results = await Promise.all(
        collections.map(collection => collection.find(query, findOpts).toArray())
      );

      let newest = null;
      for (const doc of results.flat()) {
        const dispatchedAt = doc?.dispatchedAt instanceof Date
          ? doc.dispatchedAt
          : new Date(doc?.dispatchedAt);
        if (Number.isNaN(dispatchedAt.getTime())) continue;
        if (!newest || dispatchedAt > newest.dispatchedAt) {
          newest = { id: doc._id, dispatchedAt };
        }
      }
      return newest;
    } catch (err) {
      // internal-only: `null` is the documented "unknown" these callers fail open on
      console.error('Error finding recent fresh dispatch:', err);
      return null;
    }
  }

  /**
   * Count a person's fresh runs since a cutoff (LIN-3238 / LIN-2955 Q1) — the
   * read behind the free-tier run limit. A "run" is ONE fresh dispatch row: a
   * row a person started, not a continuation.
   *
   * The predicate (Q1), all clauses deliberate:
   *   dispatchedBy ∈ accountIds — server-stamped attribution; the caller passes
   *                            the session account's merge group
   *   dispatchedAt >= since  — the UTC day window (or any caller window)
   *   followUpTo == null     — a follow-up beat continues an existing run
   *   abort != true          — an abort closes a session; it is not a run
   *   cascade != true        — a cascade emits one abort per descendant
   *   sessionId == null      — a worker carries its orchestrator's session id and
   *                            is a continuation (count it and one Go press costs
   *                            1+N); also excludes follow-up-shaped workers
   *   kind != 'wake'         — a wake row continues a run (dispatchedBy is null
   *                            anyway, but pinned explicitly)
   * Any other kind or target counts: a fresh manual dispatch on any rung is a run.
   *
   * Reads BOTH `dispatch-queue` and `dispatch-history` (a row lives in exactly one,
   * and which one is a function of age). Raw docs via `find().toArray()`, never
   * `listItems`/`listHistory` (both return FORMATTED, `limit`-capped items) and
   * never `countDocuments` (house convention — MangoDB parity, see the note on
   * that method elsewhere in this file). No `status` filter, so the stale `taken`
   * pile (LIN-1594) never participates; the predicate, not status, is the filter.
   *
   * READ ORDER IS QUEUE, THEN HISTORY, SEQUENTIALLY (the `countPilotEligible`
   * pattern): take/cancel are delete-then-insert, so a row is in NEITHER
   * collection for one round trip and simultaneous reads can miss it. The `_id`
   * de-dupe covers the other direction — a row in BOTH while the archive hop runs
   * (archived into history, then only afterward deleted from the queue) is counted
   * once, never twice.
   *
   * `{dispatchedBy, dispatchedAt}` is indexed on both collections
   * (lib/db-indexes.js), so each read is one index seek plus a residual
   * in-memory filter.
   *
   * Fails OPEN on a read error — returns `null`, not a count of `0` — so the
   * caller (the free-tier run gate) can fail CLOSED on a count it could not read
   * (a `0` would silently allow a run).
   *
   * @param {string[]} accountIds - The attributed account ids (the merge group).
   *   Falsy entries are dropped; an empty list returns null (nothing attributable
   *   to count).
   * @param {Date|string} since - Lower bound on `dispatchedAt` (inclusive).
   * @returns {Promise<number|null>} Distinct fresh-run count, or null on a read
   *   error (or unusable arguments).
   */
  async countFreshRunsSince(accountIds, since) {
    const ids = Array.isArray(accountIds) ? accountIds.filter(Boolean) : [];
    if (ids.length === 0 || !since) return null;

    const query = {
      dispatchedBy: { $in: ids },
      dispatchedAt: { $gte: since },
      followUpTo: null,
      abort: { $ne: true },
      cascade: { $ne: true },
      sessionId: null,
      kind: { $ne: 'wake' }
    };
    // `_id` alone is enough — the count de-dupes by it and reads no other field.
    const findOpts = { projection: { _id: 1 } };

    try {
      const seen = new Set();
      // Queue FIRST, then history — see the method header; never Promise.all.
      const active = await this.collection.find(query, findOpts).toArray();
      for (const doc of active) {
        if (doc?._id != null) seen.add(String(doc._id));
      }
      if (this.historyCollection) {
        const archived = await this.historyCollection.find(query, findOpts).toArray();
        for (const doc of archived) {
          if (doc?._id != null) seen.add(String(doc._id));
        }
      }
      return seen.size;
    } catch (err) {
      // internal-only: `null` is the documented "unknown" these callers fail open on
      console.error('Error counting fresh runs since:', err);
      return null;
    }
  }

  /**
   * Count the distinct tasks a budgeted run has taken on (LIN-1751) — the read
   * half of the `maxTasks` guard, a one-clause variant of `findRecentFreshDispatch`
   * above (read its header first; every contract there applies here too):
   *
   *   - Reads BOTH `dispatch-queue` and `dispatch-history` (a dispatch lives in
   *     exactly one, and which one is a function of age).
   *   - Raw docs via `find().toArray()`, never `listItems`/`listHistory` (both
   *     return FORMATTED items — `listHistory` is also `limit`-capped, which would
   *     silently undercount a long run) and never `countDocuments` (house
   *     convention — MangoDB parity, see `dispatch-store.js`'s own note on that
   *     method elsewhere in this file).
   *   - No `status` filter, so the stale `taken` pile (LIN-1594) never participates.
   *   - `{urlKey, sessionId}` is already indexed on both collections
   *     (lib/db-indexes.js) — no new index, no migration.
   *
   * The key swap from `findRecentFreshDispatch`: keyed on `sessionId` (the run),
   * not `issueIdentifier`+`kind` (a duplicate pair), and requires `issueIdentifier`
   * to be PRESENT (`{ $ne: null }`) rather than taking one as input — every
   * qualifying row's own `issueIdentifier` is the thing being counted, deduped
   * into a `Set` so a dispatch for a task already inside the budget is never
   * double-counted (and, at the caller, never refused). No `since` window: unlike
   * the duplicate guard's 5-minute recency check, a budget counts every fresh
   * task dispatch for the run's whole lifetime.
   *
   * Fails OPEN on a read error — returns `null`, not a count of `0` — so the
   * caller (which only declares a budget exhausted with a real count in hand)
   * can tell "counted zero" from "couldn't count," per the guard's
   * fail-closed-on-real-read-error contract (the caller decides what `null`
   * means; this method only reports what it saw).
   *
   * Takes the CANDIDATE `issueIdentifier` (the dispatch about to be created,
   * not yet stored) as well as the count, and reports whether it is already
   * among the counted tasks — same query, same `Set`, no extra read. This is
   * what lets the caller admit a dispatch that continues a task already inside
   * the budget (its review, its close-out, a corrective follow-up) even when
   * the budget is fully spent, so a task is never stranded half-done: a
   * dispatch only needs refusing when admitting it would grow the distinct
   * count past `maxTasks`, which is exactly the case where `alreadyCounted` is
   * false.
   *
   * @param {string} urlKey - Workspace URL key (the first clause; a same-named
   *   sessionId in a different workspace is a different run).
   * @param {string} sessionId - The budgeted run's own dispatch id.
   * @param {string} issueIdentifier - The candidate dispatch's own issue
   *   identifier (the one about to be created, not yet persisted).
   * @returns {Promise<{count: number, alreadyCounted: boolean, taskDispatches: number}|null>}
   *   `count` is the number of distinct `issueIdentifier`s among qualifying
   *   rows BEFORE this candidate; `alreadyCounted` is whether the candidate's
   *   own `issueIdentifier` is already one of them; `taskDispatches`
   *   (LIN-2934) is the fresh-row count for the candidate `issueIdentifier`
   *   specifically, de-duplicated by `_id` — what the runaway
   *   failsafe (`MAX_FRESH_SESSIONS_PER_TASK`) is checked against. `null` on a read error.
   */
  async countDistinctTasksForSession(urlKey, sessionId, issueIdentifier) {
    if (!urlKey || !sessionId) return null;

    // Every clause mirrors findRecentFreshDispatch's rationale, key swapped:
    //   urlKey/sessionId          — the indexed scope (the run)
    //   followUpTo: null          — a follow-up beat is the intended in-session
    //                                continuation, never a new task
    //   abort: { $ne: true }      — a cascade abort is coordination, not a task
    //   issueIdentifier: { $ne: null } — only issue-bearing rows are tasks; the
    //                                kickoff row itself (this run's own owner
    //                                dispatch) carries no sessionId of its own
    //                                and so is structurally excluded here too
    const query = {
      urlKey,
      sessionId,
      followUpTo: null,
      abort: { $ne: true },
      issueIdentifier: { $ne: null }
    };
    // `_id` is projected too (LIN-2934, F3): `taskDispatches` below de-dupes by
    // `_id` across the queue+history union, so a row present in BOTH during
    // the `cleanup()` archive window (archived into history, then only
    // afterward deleted from the queue) is not double-counted. The distinct-
    // `issueIdentifier` Set needs no such change — a Set is already immune to
    // seeing the same identifier twice.
    const findOpts = { projection: { _id: 1, issueIdentifier: 1 } };

    try {
      const collections = [this.collection, this.historyCollection].filter(Boolean);
      const results = await Promise.all(
        collections.map(collection => collection.find(query, findOpts).toArray())
      );

      const tasks = new Set();
      const rowsById = new Map();
      for (const doc of results.flat()) {
        if (doc?.issueIdentifier) tasks.add(doc.issueIdentifier);
        if (doc?._id != null) rowsById.set(String(doc._id), doc);
      }

      let taskDispatches = 0;
      if (issueIdentifier) {
        for (const doc of rowsById.values()) {
          if (doc.issueIdentifier === issueIdentifier) taskDispatches += 1;
        }
      }

      return {
        count: tasks.size,
        alreadyCounted: !!issueIdentifier && tasks.has(issueIdentifier),
        taskDispatches
      };
    } catch (err) {
      // internal-only: `null` is the documented "unknown" these callers fail open on
      console.error('Error counting distinct tasks for session:', err);
      return null;
    }
  }

  /**
   * Count the pilot-eligible dispatch rows for a workspace (LIN-3200 P4) — the
   * ordinal read behind the file-pointer arm rule.
   *
   * Returns the count of distinct `_id`s over queue ∪ history matching exactly
   * the factory's eligibility predicate (`lib/file-pointer.js`
   * `isPilotEligible`): `kind === 'implementation'`, `followUpTo == null`,
   * `abort !== true`, `issueIdentifier != null`. Lifetime, NOT horizon-bound —
   * the arm is recomputable over every retained row (history is lifetime-
   * retained since LIN-3163 `c572a681`).
   *
   * READ ORDER IS QUEUE, THEN HISTORY, SEQUENTIALLY — deliberately NOT the
   * `Promise.all` `countDistinctTasksForSession` uses (finding 1(a) of plan-
   * review verdict `ee3c850d`). take and cancel are delete-then-insert
   * (`lib/dispatch-store.js:170-176`), so a row is in NEITHER collection for
   * one round trip. With simultaneous reads any read inside the hop misses the
   * row; history-first misses when the pair merely straddles the hop;
   * queue-then-history misses only when the hop outlasts the FIRST read. The
   * `_id` de-dupe (copied from `countDistinctTasksForSession`) covers the other
   * direction — a row in both while expiry archives before deleting.
   *
   * Fails OPEN on a read error — returns `null`, never a count of `0` — so the
   * caller can tell "counted zero" from "couldn't count" and leave the prompt
   * untouched (residual R1).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number|null>} distinct eligible `_id` count, or null on a read error
   */
  async countPilotEligible(urlKey) {
    if (!urlKey) return null;

    const query = {
      urlKey,
      kind: 'implementation',
      followUpTo: null,
      abort: { $ne: true },
      issueIdentifier: { $ne: null }
    };
    // `_id` alone is enough — the count de-dupes by it and reads no other field.
    const findOpts = { projection: { _id: 1 } };

    try {
      const ids = new Set();
      // Queue FIRST, then history — see the method header; never Promise.all.
      const active = await this.collection.find(query, findOpts).toArray();
      for (const doc of active) {
        if (doc?._id != null) ids.add(String(doc._id));
      }
      if (this.historyCollection) {
        const archived = await this.historyCollection.find(query, findOpts).toArray();
        for (const doc of archived) {
          if (doc?._id != null) ids.add(String(doc._id));
        }
      }
      return ids.size;
    } catch (err) {
      // internal-only: `null` is the documented "unknown" these callers fail open on
      console.error('Error counting pilot-eligible dispatches:', err);
      return null;
    }
  }

  /**
   * Graceful trim (LIN-2147): amend a live run's `maxTasks` bound DOWNWARD.
   * Deliberately invents no new termination path — the existing LIN-1751
   * guard (`countDistinctTasksForSession` + the `maxTasks` check in
   * `createDispatchItem`) already refuses any dispatch that would grow a
   * run's distinct-task count past `maxTasks`, and already ADMITS a
   * dispatch for a task already inside the budget regardless of count
   * (`alreadyCounted`). Lowering `maxTasks` here is therefore sufficient on
   * its own: the run's CURRENT in-flight ticket keeps dispatching (review,
   * close-out, corrective follow-ups all read as `alreadyCounted`), while
   * the very next attempt at a genuinely NEW task hits the same 409
   * BUDGET_EXHAUSTED refusal orderly-finish already handles — no child beat
   * is interrupted, and no second wind-down path is invented.
   *
   * Idempotent by construction: this SETS an absolute bound (never a
   * relative decrement), so repeating the identical call twice yields the
   * identical end state. The downward-only check reads the run first (via
   * `getItemStatus`, the same queue-then-history resolution every other
   * caller in this file uses) rather than folding the condition into the
   * write's own filter — this codebase's shared collection mock
   * (tests/fixtures/mock-collection.js) has no `$or` support, and the
   * alternative (extending a fixture ~20 other store test files depend on)
   * is a wider blast radius than the tradeoff it would close: two trims
   * racing to genuinely DIFFERENT values on the SAME run within the same
   * instant is not a realistic shape for a human-driven admin control, and
   * the worst case of losing that race is a bound that is briefly too
   * generous, not one that silently stops being enforced — the very next
   * over-budget dispatch attempt still hits the unchanged LIN-1751 guard.
   *
   * Mirrors `getItemStatus`'s own queue-then-history resolution for the
   * WRITE too (a live kickoff is USUALLY already archived to history by the
   * time a human reaches for the control, but a still-queued row is tried
   * first for parity with every other read/write in this file) — unlike
   * `addFeedback`, this is session-authenticated (workspace ownership via
   * the `{_id, urlKey}` filter IS the authorization boundary here), so it
   * carries no `takenByTokenLabel`/`status` restriction.
   *
   * @param {string} urlKey
   * @param {string} sessionId - the run's own dispatch id (the kickoff item)
   * @param {Object} bounds
   * @param {number} bounds.maxTasks - the new, tighter task bound (positive integer)
   * @param {Object} [meta]
   * @param {string|null} [meta.by] - account id recorded on the audit entry
   * @returns {Promise<{ok: true, item: Object}|{ok: false, reason: 'invalid-input'|'not-found'|'not-downward'}>}
   */
  async trimSessionBudget(urlKey, sessionId, { maxTasks } = {}, { by = null } = {}) {
    if (!urlKey || !sessionId || !isPositiveInteger(maxTasks)) {
      return { ok: false, reason: 'invalid-input' };
    }

    try {
      const existing = await this.getItemStatus(urlKey, sessionId);
      if (!existing) return { ok: false, reason: 'not-found' };
      // A previously-unbounded run (bound: null) is always trimmable —
      // turning it on for the first time is a downward move from "unbounded".
      // Otherwise the new bound must be strictly tighter.
      if (typeof existing.maxTasks === 'number' && maxTasks >= existing.maxTasks) {
        return { ok: false, reason: 'not-downward' };
      }

      const auditEntry = { at: new Date(), by: by || null, maxTasks };
      const filter = { _id: sessionId, urlKey };
      const update = { $set: { maxTasks }, $push: { trimHistory: auditEntry } };

      let doc = await this.collection.findOneAndUpdate(filter, update, { returnDocument: 'after' });
      let archived = false;

      if (!doc && this.historyCollection) {
        doc = await this.historyCollection.findOneAndUpdate(filter, update, { returnDocument: 'after' });
        archived = true;
      }

      if (!doc) return { ok: false, reason: 'not-found' };
      // LIN-2934 R6: a trim changes the bound the feed reads (`taskPosition`),
      // so notify the materializer or the chip's denominator stays stale until
      // this session's NEXT unrelated write. Same fire-and-forget hook every other mutating write in this file
      // uses; `doc` is already the raw (queue or history shape) post-update doc.
      this._notifyWriteForDoc(doc, urlKey);
      return { ok: true, item: archived ? this._formatHistoryItem(doc) : this._formatItem(doc) };
    } catch (err) {
      console.error('Error trimming session budget:', err);
      throw new DispatchStoreFault('trimSessionBudget', err);
    }
  }

  /**
   * Stamps a single already-taken history row as bookkept (LIN-2653, S1 of the
   * LIN-2633 fossil-bookkeeping pass). Mirrors `trimSessionBudget`'s shape —
   * one `findOneAndUpdate`, `{ok,item}`/`{ok:false,reason}`, never throws —
   * but is narrower: history-only (a bookkeeping stamp never applies to a
   * still-queued row, so there is no queue-then-history fallback), and it
   * carries NO selection/age/lineage logic of its own. It trusts the caller
   * completely, exactly as `trimSessionBudget` trusts its own `sessionId`
   * argument — selection lives one layer up, in the LIN-2653 operator script
   * (`scripts/fossil-pass-lin2633.js`), never here.
   *
   * Idempotence is expressed in the FILTER, not by reading-then-checking:
   * `bookkeeping: null` matches a document where the field is null OR MISSING
   * (`query-matcher.js`'s `null` branch, engine semantics — a dotted-path
   * `$exists: false` would match missing-only and miss the explicit `null`
   * this file's `doc.field || null` convention would otherwise produce). A
   * second call against an already-stamped row therefore finds no match and
   * returns `{ok:false, reason:'not-found'}` — the same not-found-covers-
   * guard-failure convention `trimSessionBudget` already uses for "no such
   * row" AND "row exists but fails a precondition".
   *
   * No `_notifyWriteForDoc` call: nothing downstream reads the stamp inline
   * (the sweep tick re-derives `classifyLoop` fresh every 60s and will
   * self-correct on its own next tick), and a bulk operator pass calling this
   * hundreds of times would re-materialize hundreds of session groups for a
   * byte-identical projection change. Same precedent: `trimSessionBudget`
   * doesn't call it either.
   *
   * @param {string} urlKey
   * @param {string} historyItemId - the history row's own `_id`
   * @param {Object} [meta]
   * @param {string|null} [meta.by] - account id / operator label recorded on the stamp
   * @param {string} [meta.reason] - short human-readable reason for the stamp
   * @returns {Promise<{ok: true, item: Object}|{ok: false, reason: 'not-found'}>}
   */
  async stampBookkeeping(urlKey, historyItemId, { by = null, reason = null } = {}) {
    if (!urlKey || !historyItemId || !this.historyCollection) {
      return { ok: false, reason: 'not-found' };
    }

    try {
      const filter = { _id: historyItemId, urlKey, status: 'taken', bookkeeping: null };
      const update = { $set: { bookkeeping: { at: new Date(), by: by || null, reason } } };

      const doc = await this.historyCollection.findOneAndUpdate(filter, update, { returnDocument: 'after' });
      if (!doc) return { ok: false, reason: 'not-found' };
      await this._persistClosed(urlKey, [historyItemId]);

      return { ok: true, item: this._formatHistoryItem(doc) };
    } catch (err) {
      console.error('Error stamping bookkeeping:', err);
      throw new DispatchStoreFault('stampBookkeeping', err);
    }
  }

  /**
   * Keep the persisted lineage status of just-closed rows in step with the `bookkeeping`
   * stamp (LIN-3812). Best-effort: a failure leaves the row stale and the read heals it.
   * @private
   */
  async _persistClosed(urlKey, ids) {
    try {
      await persistClosedLineage(this.historyCollection, urlKey, ids);
    } catch (err) {
      console.error('Error persisting closed lineage status (best-effort, healed on read):', err?.message || err);
    }
  }

  /**
   * Shared select-then-guarded-write for the bulk close methods (LIN-3364).
   * `find` the candidate ids with `filter`, `updateMany` with the SAME filter
   * plus `_id $in ids` (so a row that changed between select and write is not
   * closed), stamp one shared `at`, re-read the ids carrying that `at`
   * (`updateMany` returns a count, not ids), and `_notifyWriteForDoc` each —
   * the session feed reads the stamp, unlike the single-row operator pass in
   * `stampBookkeeping` (whose "no notify" rationale does not carry over).
   * Never throws.
   *
   * @private
   * @returns {Promise<{ok: boolean, closedIds: string[]}>}
   */
  async _closeRows(urlKey, filter, { by = null, reason = null } = {}) {
    if (!this.historyCollection) return { ok: false, closedIds: [] };
    try {
      const candidates = await this.historyCollection.find(filter).toArray();
      const ids = candidates.map(d => d._id);
      if (ids.length === 0) return { ok: true, closedIds: [] };

      const at = new Date();
      await this.historyCollection.updateMany(
        { ...filter, _id: { $in: ids } },
        { $set: { bookkeeping: { at, by: by || null, reason } } }
      );
      const written = await this.historyCollection
        .find({ _id: { $in: ids }, urlKey, 'bookkeeping.at': at })
        .toArray();
      await this._persistClosed(urlKey, written.map(d => d._id));
      for (const doc of written) this._notifyWriteForDoc(doc, urlKey);
      return { ok: true, closedIds: written.map(d => d._id) };
    } catch (err) {
      console.error('Error closing rows:', err);
      throw new DispatchStoreFault('closeRows', err);
    }
  }

  /**
   * Close (stamp `bookkeeping` on) every still-`taken`, unstamped, un-terminated
   * row of ONE runner-session lineage dispatched before `beforeDispatchedAt`
   * (LIN-3364). The lineage is `rootItemId` — never `sessionId`, which sibling
   * workers share. A pre-LIN-1468 row without `rootItemId` is not reached.
   *
   * @param {string} urlKey
   * @param {string} rootItemId
   * @param {Object} opts
   * @param {Date} opts.beforeDispatchedAt - only rows dispatched strictly before this
   * @param {string} [opts.exceptId] - a row to leave open (the newer anchor)
   * @param {string[]} [opts.kinds] - restrict to these dispatch kinds
   * @param {Date} [opts.takenBefore] - LIN-3365: only rows TAKEN (`resolvedAt`) strictly before this. A queued-busy row dispatched before the closing event but claimed after it is the resumed session and stays open.
   * @param {string[]} [opts.ids] - LIN-3365: only these row ids (the backfill passes the selector's set; the filter still re-asserts every other bound at write time)
   * @param {string} opts.reason - handed-on | lineage-terminal | ticket-closed
   * @param {string|null} [opts.by]
   * @returns {Promise<{ok: boolean, closedIds: string[]}>}
   */
  async closeLineageRows(urlKey, rootItemId, { beforeDispatchedAt, exceptId, kinds, takenBefore, ids, reason, by = null } = {}) {
    if (!urlKey || !rootItemId || !beforeDispatchedAt) return { ok: false, closedIds: [] };
    const filter = {
      urlKey,
      rootItemId,
      status: 'taken',
      bookkeeping: null,
      ...noOwnTerminalMarkerFilter(),
      dispatchedAt: { $lt: beforeDispatchedAt }
    };
    if (Array.isArray(ids)) {
      // One `_id` key only: `exceptId` is subtracted from the list.
      filter._id = { $in: ids.filter(i => i !== exceptId) };
    } else if (exceptId) {
      filter._id = { $ne: exceptId };
    }
    if (takenBefore) filter.resolvedAt = { $lt: takenBefore };
    if (Array.isArray(kinds) && kinds.length) filter.kind = { $in: kinds };
    return this._closeRows(urlKey, filter, { by, reason });
  }

  /**
   * Close the given rows of one issue (LIN-3364): `ids` are what the caller
   * selected; the quiet bound is RE-ASSERTED inside the write filter so a row
   * that gained feedback after `quietSince` between select and write (a
   * resumed session) is not closed.
   *
   * @param {string} urlKey
   * @param {string} issueIdentifier
   * @param {Object} opts
   * @param {string[]} opts.ids
   * @param {Date} opts.quietSince - close only rows with no feedback newer than this
   * @param {string} opts.reason
   * @param {string|null} [opts.by]
   * @returns {Promise<{ok: boolean, closedIds: string[]}>}
   */
  async closeIssueRows(urlKey, issueIdentifier, { ids, quietSince, reason, by = null } = {}) {
    if (!urlKey || !issueIdentifier || !Array.isArray(ids) || ids.length === 0 || !quietSince) {
      return { ok: false, closedIds: [] };
    }
    const filter = {
      urlKey,
      issueIdentifier,
      _id: { $in: ids },
      status: 'taken',
      bookkeeping: null,
      ...noOwnTerminalMarkerFilter()
    };
    // Both $not clauses live on `feedback`; combine them under $and.
    const { feedback: noTerminal, ...rest } = filter;
    return this._closeRows(urlKey, {
      ...rest,
      $and: [
        { feedback: noTerminal },
        // LIN-3358: a `[stalled?]` heartbeat says the session is NOT active, and the
        // dispatcher re-posts one every HEARTBEAT_POST_CAP_MS (= the closer's grace), so
        // counting it as activity made this filter refuse rows the selector
        // (`closerCandidates`) had already judged quiet. Every other entry — including
        // `[working]` heartbeats — still counts, so a lineage that resumes between select
        // and write is not closed.
        { feedback: { $not: { $elemMatch: { timestamp: { $gt: quietSince }, $nor: [STALL_WARNING_ENTRY] } } } }
      ]
    }, { by, reason });
  }

  /**
   * Recursively enumerate the descendant subtree of a root autopilot session,
   * returning the ordered list of dispatch ids to close (root FIRST), de-duped.
   *
   * Per-level lineage (LIN-946): a dispatch stamped `sessionId=<id>` is a direct
   * child of session <id>; a child *autopilot* stamps ITS OWN workers with its own
   * `_id` (the store stamps `sessionId` per level, never whole-tree), so the walk
   * recurses into each discovered child autopilot's `id`. Both the live queue
   * (`listItems`) and history (`listHistory`) are scanned per level, so a child
   * that has already resolved into history is still discovered.
   *
   * Cycle-safe + terminating: a `visited` set of expanded session ids means a
   * malformed lineage (or an id that points back up its own tree) can never loop —
   * each id expands at most once over a finite record set. The maybe-interactive /
   * human-continued exclusion is deliberately NOT applied here: no Harbour record
   * marks a session as human-continued, so the runner owns that skip on the emitted
   * plain abort (LIN-951). This is pure enumeration — it emits nothing. See LIN-946.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} rootSessionId - The root session's dispatch id (the cascade's abortTo)
   * @returns {Promise<string[]>} Ordered dispatch ids to abort (root first, de-duped)
   */
  async collectCascadeTargets(urlKey, rootSessionId) {
    if (!urlKey || !rootSessionId) return [];

    const visited = new Set();   // session ids already expanded — cycle guard
    const seen = new Set();      // dispatch ids already collected — dedup
    const toClose = [];          // ordered result, root first
    const collect = (id) => {
      if (id && !seen.has(id)) { seen.add(id); toClose.push(id); }
    };

    // The root session closes its own (spent) warm session too.
    collect(rootSessionId);

    const frontier = [rootSessionId];
    while (frontier.length) {
      const id = frontier.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const live = await this.listItems(urlKey, { sessionId: id });
      const { items: hist } = await this.listHistory(urlKey, { sessionId: id });
      for (const child of [...live, ...hist]) {
        collect(child.id);
        // A child autopilot stamps its OWN workers with its own id, so recurse into
        // it. Guard on `visited` so a re-listed child never re-expands.
        if (child.kind === 'autopilot' && !visited.has(child.id)) {
          frontier.push(child.id);
        }
      }
    }

    return toClose;
  }

  /**
   * Expand a single `cascade` close into the ordinary abort set: walk the root
   * session's descendant subtree (`collectCascadeTargets`) and emit ONE plain
   * `abort`/`abortTo` item per discovered session. Harbour does the walk + emits
   * the aborts here; the runner executes each cancel and skips human-continued
   * sessions (LIN-951). Harbour never cancels a session itself.
   *
   * The emitted items are deliberately minimal — `abort:true`, `abortTo:<id>`, and
   * the inherited `target`, and NOTHING ELSE: no `prompt`, no `sessionId`, no
   * `subscription`. Omitting `sessionId` (and leaving `kind` at its default, never
   * 'autopilot') keeps `addItem`'s feed-notify gate (`kind==='autopilot' ||
   * sessionId`) from firing, so the cascade's aborts never pollute Observation
   * session reconstruction; omitting the subscription means they declare no new
   * wake edge. Aborting an already-terminal/reaped session is a safe downstream
   * no-op, so the walk never needs to pre-check liveness. Called by
   * `expandCascadeAborts` in `lib/dispatch-entrance.js` for a cascade request;
   * no end-of-run path issues a cascade. See LIN-946.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} rootSessionId - Root session dispatch id (the cascade's abortTo)
   * @param {Object} [opts]
   * @param {string} [opts.target='cli'] - Poll-eligible target inherited from the call
   * @param {string} [opts.dispatchedBy] - Actor id recorded on the emitted aborts
   * @returns {Promise<{closed: Array<{id: string, abortTo: string, target: string}>, count: number}>}
   */
  async expandCascadeAborts(urlKey, rootSessionId, { target = 'cli', dispatchedBy = null } = {}) {
    const targets = await this.collectCascadeTargets(urlKey, rootSessionId);
    const closed = [];
    for (const abortTo of targets) {
      const item = await this.addItem(urlKey, {
        abort: true,
        abortTo,
        target,
        dispatchedBy
        // no prompt, no sessionId, no subscription — see the note above.
      });
      closed.push({ id: item._id, abortTo, target: item.target });
    }
    return { closed, count: closed.length };
  }

  /**
   * Clears all history for a workspace (used in tests).
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Number of items removed
   */
  async clearHistory(urlKey) {
    if (!this.historyCollection) return 0;

    try {
      const result = await this.historyCollection.deleteMany({ urlKey });
      return result.deletedCount || 0;
    } catch (err) {
      // internal-only: test helper; the count of removed rows is not an answer to a client
      console.error('Error clearing dispatch history:', err);
      return 0;
    }
  }

  /**
   * Read-only, additive (LIN-2146): the deduped set of `urlKey`s observed
   * across `dispatch-queue` ∪ `dispatch-history` — a row in either is, by
   * definition, an agent-worked workspace. This is the population the
   * observer sweep's session-derived roster (`lib/observer-sweep.js`
   * `resolveRosterFromSessions`) misses entirely: a workspace worked purely
   * by dispatched agents, with no browser session, never appears there.
   *
   * Bounded on `dispatchedAt` at the shared 30-day read horizon (LIN-3161,
   * LIN-3157 A1): "observed" means a row dispatched within the read window —
   * NOT merely "not yet aged out". The queue's own 24 h eviction still runs,
   * but `dispatch-history` is now lifetime-retained (LIN-3163), so the horizon
   * (not the store TTL) must define recency or every dormant workspace would
   * be re-admitted to the observer roster. Two halves, two postures (LIN-3811):
   * the HISTORY half is served by the declared `dispatch-history
   * {dispatchedAt:1, urlKey:1}` spec (a covered window scan), which is tier
   * `deferred`, so it exists only once the server's post-listen build
   * (LIN-3865; or `scripts/apply-deferred-indexes.mjs`) has made it; until then it is a 30-day
   * PAYLOAD bound over a full scan. The QUEUE half (`_collectDistinctUrlKeys`
   * on `this.collection`) stays unindexed ON PURPOSE: the queue is evicted
   * after 24 h and is small, so `dispatch-queue {dispatchedAt}` is not declared.
   *
   * The queue and history reads are swallowed INDEPENDENTLY, not under one
   * shared try/catch: a `historyCollection` fault must not discard `urlKey`s
   * already collected from the live queue, and vice versa — this store
   * method's own fail-soft posture must not blank one source because the
   * other one broke, the same independence the observer-sweep call site
   * keeps between this method and the session-derived half of its roster.
   *
   * @param {Object} [opts]
   * @param {Date} [opts.now] - injected clock; defaults to `new Date()`. The
   *   horizon start (`now − 30d`) bounds both reads.
   * @returns {Promise<Array<string>>} deduped urlKeys, unsorted (the caller,
   *   `mergeRosterUnion` in lib/observer-sweep.js, does the one terminal
   *   sort over the merged roster)
   */
  async listObservedWorkspaceKeys({ now = new Date() } = {}) {
    const since = readHorizonStart(now);
    const keys = new Set();
    try {
      await this._collectDistinctUrlKeys(this.collection, keys, since);
    } catch (err) {
      // internal-only: sweep roster; each half logs and continues
      console.error('Error listing observed workspace keys (queue):', err);
    }
    if (this.historyCollection) {
      try {
        await this._collectDistinctUrlKeys(this.historyCollection, keys, since);
      } catch (err) {
        // internal-only: sweep roster; each half logs and continues
        console.error('Error listing observed workspace keys (history):', err);
      }
    }
    return [...keys];
  }

  /**
   * `.distinct('urlKey')` when the collection supports it (MongoDB and
   * MangoDB both do), else a projected `find({})` fallback — same
   * capability-probe shape as the `.aggregate()` precedent in
   * `lib/kpi-stats.js`'s `loadProxyBins`. The probe exists for the shared
   * unit-test mock (`tests/fixtures/mock-collection.js`), which has neither
   * method — that fallback path is what every store unit test actually
   * exercises.
   *
   * @param {Object} collection
   * @param {Set<string>} keys - accumulator, mutated in place
   * @param {Date} [since] - shared read-horizon lower bound on `dispatchedAt`
   *   (LIN-3161); omitted → unbounded (no caller does this in production)
   * @private
   */
  async _collectDistinctUrlKeys(collection, keys, since) {
    const filter = since ? { dispatchedAt: { $gte: since } } : {};
    if (typeof collection.distinct === 'function') {
      for (const key of await collection.distinct('urlKey', filter)) {
        if (typeof key === 'string' && key) keys.add(key);
      }
      return;
    }
    const rows = await collection.find(filter, { projection: { urlKey: 1 } }).toArray();
    for (const row of rows) {
      if (typeof row?.urlKey === 'string' && row.urlKey) keys.add(row.urlKey);
    }
  }

  /**
   * Formats a history document for API response.
   *
   * @param {Object} doc - History database document
   * @returns {Object} Formatted history item
   * @private
   */
  _formatHistoryItem(doc) {
    const item = {
      id: doc._id,
      prompt: doc.prompt || null,
      promptName: doc.promptName,
      issueId: doc.issueId,
      issueIdentifier: doc.issueIdentifier,
      issueTitle: doc.issueTitle,
      issueUrl: doc.issueUrl,
      dispatchedAt: doc.dispatchedAt?.toISOString?.() || doc.dispatchedAt,
      // Attribution (LIN-1948, fix 3a). `_archiveItem` persists dispatchedBy and
      // `_formatItem` returns it, but THIS formatter dropped it — so a TAKEN
      // dispatch (which reads through here) reported no dispatcher at all, and
      // attributing the twelve phantom rows in LIN-1946 cost a research pass.
      // Also repairs `lib/pipeline-loops.js`, which read `dispatchedBy: null`
      // for every archived loop in the Observation feed for the same reason.
      // An ownerless token legitimately stamps null — absent attribution is a
      // real answer here, not a bug.
      dispatchedBy: doc.dispatchedBy || null,
      // Graceful-trim audit trail (LIN-2147) — see the schema comment and
      // `_formatItem`'s sibling field.
      trimHistory: doc.trimHistory || [],
      sessionGroupId: doc.sessionGroupId || null,
      // Item-doc-level lineage anchor (LIN-1468). Must be readable here (not
      // just persisted): dispatch-factory.js's followUpTo inheritance seam
      // reads it back off this exact shape (via getItemStatus) to resolve
      // `anchor.rootItemId` for the next dispatch in the lineage — the same
      // read path sessionGroupId inheritance already relies on.
      rootItemId: doc.rootItemId || null,
      status: doc.status,
      resolvedAt: doc.resolvedAt?.toISOString?.() || doc.resolvedAt,
      takenByTokenLabel: doc.takenByTokenLabel || null,
      // Fossil-bookkeeping stamp (LIN-2653): `{at, by, reason}` written by
      // `stampBookkeeping`, null on every unstamped row. Explicit allowlist
      // entry — this file's six recorded silent-drop incidents (LIN-1698/
      // 1751/1825/1932/1948/2615) are exactly what omitting it here would
      // reproduce: `classifyLoop` (lib/observer-sweep.js) could never see the
      // stamp, and the operator script's own "already stamped" report bucket
      // and idempotent re-run both read this field off the Loop record, which
      // only carries it because this allowlist does.
      bookkeeping: doc.bookkeeping || null
    };
    // The 23 always-present run-row fields come from lib/dispatch-fields.js, the
    // same declaration the writers use; none is listed in the literal above.
    Object.assign(item, normalizeRunFields(doc));

    if (doc.feedback && doc.feedback.length > 0) {
      item.feedback = this._formatFeedbackEntries(doc.feedback);
    }

    // Digest passthrough (LIN-3010, LIN-2996 Phase 2). Shallow only — never
    // reformat anything inside feedbackDigest, whose loop-facing fields are
    // already ISO and whose kpi* fields stay Date (lib/digest-feedback.js).
    // Copied only when present on the source doc, unlike every other field in
    // this allowlist: a legacy row (neither field ever written) must format
    // with both keys ABSENT, not invented as null, while a seeded row's
    // explicit `feedbackDigest: null` must survive unchanged. Collapsing that
    // distinction would violate the shared isFreshDigest predicate's
    // absent-vs-null contract.
    if ('feedbackVersion' in doc) item.feedbackVersion = doc.feedbackVersion;
    if ('feedbackDigest' in doc) item.feedbackDigest = doc.feedbackDigest;
    // LIN-3242 (LIN-3126 §4): project the dispatch binding selector pair when
    // present (sparse — an unstamped row's key set stays byte-identical; no
    // spread, per the C4 census). Read by the effort read-out to group rows by
    // their own binding.
    if (doc.issueSource != null) item.issueSource = doc.issueSource;
    // LIN-3384: sparse boolean marker that this row's credential was minted
    // from a declared-mint record (a declared resume mints for the recorded
    // OWNER, not the poster). Carries the fact, never the record: the session
    // redactor masks the prose token for EVERY reader when it is set, and strips
    // the marker itself. Exactly one assignment per formatter (the C4 census
    // pins that); no spread.
    if (doc.grantDeclaration != null) item.declaredMint = true;

    return item;
  }

  /**
   * Formats a raw feedback array (as stored on a history doc) for API
   * response. Extracted from `_formatHistoryItem` so `_collectGroupFeedback`
   * (LIN-1461) can shape a feedback array merged from MULTIPLE docs through
   * the exact same projection, byte-identical to the single-doc case.
   *
   * Thin delegate onto the module-level `formatFeedbackEntries` export
   * (LIN-3008): that export doesn't use `this`, so it is promoted to a named
   * export for `lib/digest-feedback.js` to import — exactly one formatter,
   * never a second copy that can drift. `_formatHistoryItem` and
   * `_collectGroupFeedback` keep calling this method unchanged.
   *
   * @param {Array} feedback - raw feedback entries (Mongo shape)
   * @returns {Array} formatted entries: `{message, url, urlLabel, timestamp}`,
   *   plus `rootItemId` when the entry carries one (LIN-1468) and `kind`
   *   when the entry carries one (LIN-1475)
   * @private
   */
  _formatFeedbackEntries(feedback) {
    return formatFeedbackEntries(feedback);
  }

  /**
   * Resolve the ROOT subscribed dispatch (the edge-bearing item) for a
   * feedback-receiving doc by walking its followUpTo chain (LIN-1059).
   *
   * Feedback ownership follows follow-ups — the runner repoints
   * itemMetadata.itemId onto each resume target — but the up-chain edge
   * (`sessionId` + `subscription`) lives ONLY on the original dispatch.
   * `rootItemId` (LIN-1468) identifies a feedback lineage's RUNNER session,
   * not this edge — it does not name which dispatch owns the `sessionId` +
   * `subscription` pair, so it is not a substitute here. The followUpTo chain
   * (predecessor pointer, set once per item) remains the only handle on the
   * edge-bearing root. A doc with no followUpTo is already the root (the
   * common, non-resumed case → returns `doc` unchanged, so behaviour is
   * identical to reading `doc` directly). The walk is bounded and
   * cycle-guarded; if a link's target is missing it stops at the last resolvable
   * item (conservative — a `kind:'wake'` current item with a gone target stays
   * itself and is then suppressed at the addFeedback seam by the doc-level
   * kind:'wake' self-termination guard, LIN-1165).
   *
   * @param {Object} doc - the feedback-receiving history doc
   * @param {string} urlKey - workspace url key (edges never cross workspaces)
   * @returns {Promise<Object>} the resolved edge-bearing doc (may be `doc`)
   * @private
   */
  async _resolveEdgeDoc(doc, urlKey) {
    let current = doc;
    const seen = new Set([current._id]);
    let depth = 0;
    while (current.followUpTo && depth < 64) {
      const parent = await this.historyCollection.findOne({ _id: current.followUpTo, urlKey });
      if (!parent || seen.has(parent._id)) break;
      seen.add(parent._id);
      current = parent;
      depth++;
    }
    return current;
  }

  /**
   * Public, id-based wrapper around `_resolveEdgeDoc` for callers outside this
   * class that only see dispatch-store's formatted rows (`.id`, never a raw `._id`
   * Mongo doc) — namely the Observation materializer's upward followUpTo
   * resolution (LIN-1307 gap 2). Looks `startId` up in history, then walks the
   * SAME bounded, cycle-guarded chain `_notifyWriteForDoc` (gap 1) and the
   * wake-feedback seam already use, so root-resolution semantics can never drift
   * between the write-trigger path and the materializer's discovery path.
   *
   * @param {string} urlKey
   * @param {string} startId - dispatch id of the row that CARRIES followUpTo
   *   (not its target) — typically a follow-up row discovered by issue/session lookup
   * @returns {Promise<{id: string, kind: string, sessionId: string|null}|null>}
   *   the resolved root's minimal shape, or null if `startId` isn't in history yet
   *   (the target is still live — a degraded-but-safe skip that self-heals later)
   */
  async resolveFollowUpRoot(urlKey, startId) {
    if (!this.historyCollection || !startId) return null;
    const start = await this.historyCollection.findOne({ _id: startId, urlKey });
    if (!start) return null;
    const root = await this._resolveEdgeDoc(start, urlKey);
    const { kind, sessionId } = normalizeRunFields(root);
    return { id: root._id, kind, sessionId };
  }

  /**
   * Mints a TERMINAL wake follow-up (LIN-1698 Phase 1) — the once-only CAS,
   * the durable `wakeWitnessMeta` seed, and the actual `addItem` enqueue, as
   * one unit. Single live-path caller: `addFeedback`'s `markTerminalOnEdge`
   * branch. A `[pending]` wake (unguarded by design, LIN-843) does not call
   * this — it has no once-only witness to seed.
   *
   * Witness contract (owner-ruled, revision 5 — see LIN-1698): the CAS write
   * seeds `wakeWitnessMeta.<key>` = `{feedbackIndex, attempt: 0,
   * mintedWakeId: null, lastAttemptAt}` in the SAME atomic `updateOne` as the
   * `terminalWakeItems` CAS — one write, not two. `<key>` is the class-aware
   * guard key (LIN-2297): bare `producingItemId` for a genuine terminal,
   * `${producingItemId}#blocked` for a blocked wake — NOT literally
   * `<producingItemId>` for a blocked wake. A future reconciliation sweep
   * joining `wakeWitnessMeta` keys against the `producingItemId` indexes
   * (lib/db-indexes.js:177,183) must strip the `#marker` suffix first.
   * `attempt: 0` is the implicit live-path slot, stamped once at seed time.
   * If the subsequent `addItem`
   * enqueue throws, that throw propagates to the caller UNCAUGHT (byte-
   * identical to pre-LIN-1698 behavior) and `wakeWitnessMeta` is deliberately
   * left exactly as seeded — `attempt: 0, mintedWakeId: null` — as durable,
   * queryable evidence that a wake was owed and the enqueue itself failed.
   * There is NO compensating `$pull`/rollback: that earlier design (revision
   * 1–3) was superseded by the owner's failed-but-present ruling, since a
   * rollback would delete the only recovery signal a future reconciliation
   * pass (a separate, spun-out ticket) could act on.
   *
   * On a successful mint, a SECOND best-effort `updateOne` stamps the minted
   * wake row's own `_id` (`mintedWakeId`) back onto the witness. This second
   * write is enrichment only, not the once-only guarantee (that is the CAS
   * above) — its own failure is caught and logged, never thrown.
   *
   * `producingItemId`/`producingItemAttempt` are stamped onto the wake
   * descriptor itself (not just `wakeWitnessMeta`, which lives on the edge doc
   * and never passes through `_archiveItem`) so the minted row can self-
   * identify its producing item after the queue→history archive hop.
   *
   * @param {string} urlKey
   * @param {Object} edgeDoc - the edge-bearing history doc (owns terminalWakeItems)
   * @param {Object} doc - the producing item (the feedback-receiving doc)
   * @param {Array} feedback - `doc`'s own post-append feedback array (for feedbackIndex)
   * @param {Object} wakeFollowUp - the wake descriptor from `buildWakeFollowUp` (mutated: producingItemId/producingItemAttempt stamped on)
   * @param {string} marker - the wake event's marker, for the existing observability log
   * @param {string} wakeKey - class-aware once-only guard/witness key (LIN-2297):
   *   bare `doc._id` for a genuine terminal, `${doc._id}#${marker}` for a
   *   blocked wake. Distinct from `producingItemId`, which stays the bare row
   *   id — this is guard/witness identity, not row attribution.
   * @returns {Promise<{wakeFollowUp: Object|null, nullWakeReason: string|null}>}
   * @private
   */
  async _mintWake(urlKey, edgeDoc, doc, feedback, wakeFollowUp, marker, wakeKey) {
    const producingItemId = doc._id;
    const feedbackIndex = feedback.length - 1;
    const now = new Date();

    const { matchedCount } = await this.historyCollection.updateOne(
      { _id: edgeDoc._id, terminalWakeItems: { $ne: wakeKey } },
      {
        $addToSet: { terminalWakeItems: wakeKey },
        $set: {
          [`wakeWitnessMeta.${wakeKey}`]: {
            feedbackIndex,
            attempt: 0,
            mintedWakeId: null,
            lastAttemptAt: now
          }
        }
      }
    );
    if (matchedCount !== 1) {
      return { wakeFollowUp: null, nullWakeReason: 'cas-lost-race (a concurrent duplicate terminal for this item already won)', mintedWakeId: null };
    }

    wakeFollowUp.producingItemId = producingItemId;
    wakeFollowUp.producingItemAttempt = 0;

    console.log(`[dispatch-wake] enqueued parent=${wakeFollowUp.followUpTo} producingItem=${producingItemId} marker=${marker}`);
    const minted = await this.addItem(urlKey, wakeFollowUp);

    try {
      await this.historyCollection.updateOne(
        { _id: edgeDoc._id },
        {
          $set: {
            [`wakeWitnessMeta.${wakeKey}.mintedWakeId`]: minted._id,
            [`wakeWitnessMeta.${wakeKey}.lastAttemptAt`]: new Date()
          }
        }
      );
    } catch (err) {
      // internal-only: best-effort stamp, never rethrown
      console.error('[dispatch-wake] best-effort mintedWakeId stamp failed:', err?.message || err);
    }

    return { wakeFollowUp, nullWakeReason: null, mintedWakeId: minted._id };
  }

  /**
   * Adds feedback to a history item.
   * Only allowed on items with status 'taken' in the matching workspace.
   *
   * @param {string} itemId - History item ID
   * @param {string} urlKey - Workspace URL key
   * @param {Object} feedback - Feedback data
   * @param {string} feedback.message - Feedback message (required)
   * @param {string} [feedback.url] - Optional link URL
   * @param {string} [feedback.urlLabel] - Optional link display text
   * @param {string} [feedback.kind] - Optional feedback-entry kind (one of FEEDBACK_ENTRY_KINDS; already validated by the caller, so it is stored as-is when present)
   * @param {string} [feedback.rootItemId] - Optional session-lineage root item id (UUID-shaped; already validated by the caller, so it is stored as-is when present)
   * @param {string} tokenLabel - Label of the token posting feedback
   * @param {Function} [provisionWakeCredential] - LIN-1430 (S2): optional async
   *   `(parentHarness: string|null) => { token: string|null, reason: string|null,
   *   degraded: string|null }` callback, injected by the route so this store stays
   *   a mechanism (donor lookup) while the route owns provisioning policy (mint
   *   args, the harness gate, the catch). Called ONLY when a wake follow-up is
   *   actually about to enqueue. The two null-token outcomes are deliberately
   *   DISTINCT and must not be collapsed:
   *     - `degraded: '<why>'` (with `reason: null`) — STRUCTURAL: no credential can
   *       exist for this caller (no proxy token store, ownerless token). The wake
   *       still ENQUEUES, token-less. Retrying cannot fix it, and suppressing would
   *       reproduce the LIN-1428 stall; LIN-1447 landed the same tolerate-ownerless
   *       policy on the broker-token mint one layer down.
   *     - `reason: '<why>'` — TRANSIENT: the mint was attempted and failed. The wake
   *       is WITHDRAWN so the terminal stays retryable (the CAS witness is not
   *       burned) and a re-report provisions again.
   *   Both null → no token was wanted (prose harness); enqueue normally. Absent
   *   (existing callers) → no provisioning, byte-identical to pre-S2 behavior.
   *   LIN-3134: called as `(parentHarness, grantDeclaration)` — the parent's
   *   record read just before (`null` when none). A structural refusal of a
   *   declared grant returns `degraded` plus `grantRefusal: '<CODE>'`, which is
   *   stamped on the (still enqueued) wake row with a notice.
   * @param {Object} [ownership] - LIN-3130: `{ takenByTokenId }`. Present → the
   *   runner ownership branch; absent → the legacy label + explicit-null branch
   *   (dispatch tokens and every existing caller).
   * @returns {Promise<{success: boolean, feedbackCount: number}|null>} Result or null if not found/unauthorized
   */
  async addFeedback(itemId, urlKey, { message, url, urlLabel, kind, rootItemId }, tokenLabel, provisionWakeCredential, { takenByTokenId } = {}) {
    if (!itemId || !urlKey || !this.historyCollection) {
      return null;
    }

    // LIN-3805: set once the atomic $push has landed, so a later fault is reported as
    // "write landed" (logged, never in the body). A retry of such a post may duplicate
    // the entry; retry-safety is a separate follow-up.
    let writeLanded = false;
    try {
      const feedbackEntry = {
        message,
        url: url || null,
        urlLabel: urlLabel || null,
        timestamp: new Date()
      };
      // Additive-only: a POST omitting kind/rootItemId (or the caller already
      // dropped an invalid value) must yield a byte-identical entry. See LIN-1297.
      if (kind) feedbackEntry.kind = kind;
      if (rootItemId) feedbackEntry.rootItemId = rootItemId;

      // LIN-1343: one atomic append replaces the old findOne + JS rebuild +
      // whole-array $set. That stale-snapshot round trip silently dropped
      // concurrent feedback (20 concurrent callers all reported success while
      // only 1 entry landed) because the second write's array was built from a
      // snapshot that never saw the first write. Folding ownership/status/
      // workspace into the filter also closes the same-class TOCTOU on those
      // checks and makes the returned feedback.length authoritative rather than
      // computed from a stale snapshot.
      // LIN-3009 (LIN-2996 Phase 1): $inc feedbackVersion in this SAME atomic
      // update — a write-race guard counter for the best-effort feedbackDigest
      // below, never a substitute for feedbackCount (array length, unchanged).
      // LIN-3812: the own-row lineage count rides the same atomic update, so an entry and its
      // count are never seen apart (the sibling fan-out is `_afterFeedbackWrite`'s).
      const update = { $push: { feedback: feedbackEntry }, $inc: { feedbackVersion: 1, lineageFeedbackCount: 1 } };
      // LIN-1468: reconcile the item-doc-level anchor from tagged feedback,
      // riding the SAME atomic update (never a separate write — that would
      // reopen the LIN-1343 stale-snapshot class). Idempotent: every entry in
      // a lineage carries the same rootItemId, so a repeated $set is a no-op,
      // and a doc whose own seed diverged from producer truth self-heals on
      // its next tagged feedback write.
      if (rootItemId) update.$set = { rootItemId };
      // LIN-3130 ownership (F3): two mutually-exclusive branches inside this ONE
      // atomic findOneAndUpdate. A runner feedback keys on the taking proxy
      // token's id; a legacy (dispatch-token / Harbour OS self-take) feedback
      // keys on the label AND `takenByTokenId: null`. The null clause is
      // load-bearing: dispatch tokens take with a free-text label, so without it
      // a dispatch token sharing the runner token's label would satisfy the
      // label check on a runner-taken row and could post a terminal /
      // wake-triggering / decision-withdrawn entry onto it. `{ takenByTokenId:
      // null }` matches both an explicit null (legacy takes after this change)
      // and an ABSENT field (every pre-existing history row), and never a string
      // id — verified on MangoDB and real MongoDB; do NOT rewrite as
      // `$exists: false` (that would stop matching explicit-null legacy rows).
      const ownershipFilter = takenByTokenId
        ? { takenByTokenId }
        : { takenByTokenLabel: tokenLabel, takenByTokenId: null };
      const doc = await this.historyCollection.findOneAndUpdate(
        { _id: itemId, urlKey, status: 'taken', ...ownershipFilter },
        update,
        { returnDocument: 'after' }
      );

      if (!doc) {
        // Preserves the single external contract: unknown item, wrong urlKey,
        // non-'taken' status, and wrong token all collapse to this one `null`
        // -> the existing 404 at routes/dispatch.js.
        return null;
      }

      writeLanded = true;
      const updated = doc.feedback;

      // Up-chain wake auto-enqueue (LIN-826/LIN-843/LIN-1059). If this feedback is
      // a wake event, wake the SUBSCRIBED child's parent with a follow-up carrying
      // the outcome. A wake event is terminal (done/failed/…), `[blocked]`, OR a
      // `[pending]` *pause* (LIN-843, labelled "paused (pending), not done" so the
      // parent never reads it as completion).
      //
      // Two LIN-1059 corrections to the old `doc.wakeEnqueued ? null : build(doc)`:
      //
      //  1. EDGE OWNERSHIP. The up-chain edge (`sessionId` + `subscription`) lives
      //     ONLY on the child's ROOT subscribed dispatch, but feedback ownership
      //     follows follow-ups — the runner repoints itemMetadata.itemId onto each
      //     resume target, so a resumed stepper's later beats + terminal land on a
      //     follow-up item (often a grandchild's `kind:'wake'` item carrying the
      //     WRONG sessionId). Building the wake from `doc` (the repointed item) then
      //     either hits the kind:'wake' loop guard or bubbles to the wrong parent,
      //     severing the edge → the parent hangs forever. Fix: resolve the
      //     edge-bearing root by walking the followUpTo chain (_resolveEdgeDoc) and
      //     build the wake from IT, not from `doc`. `rootItemId` (LIN-1468) names a
      //     feedback lineage's runner session, not this sessionId/subscription edge,
      //     so the followUpTo chain is still the only handle on the root. This separates
      //     "which edge to bubble on" (the root) from "is this feedback item itself
      //     a wake". That latter guard is applied to the ORIGINAL `doc` at this seam
      //     (LIN-1165), NOT only to the resolved edge doc: resolving from the root
      //     alone did NOT suppress the self-loop — `_resolveEdgeDoc` walking PAST the
      //     kind:'wake' item to a real dispatch defeated the loop guard (the LIN-1165
      //     bug). It is now caught two ways: the doc-level kind:'wake' self-
      //     termination guard (edge unresolved, `edgeDoc === doc`) and the self-edge
      //     `followUpTo === doc._id` check (edge resolved but looping back into the
      //     producing item). A genuine wake follow-up whose edge walks back to a
      //     DISTINCT ancestor dispatch still bubbles there (preserving LIN-1059).
      //
      //  2. PER-EVENT, TERMINAL-SCOPED dedup. Only the NEWLY appended entry can
      //     trigger a wake — so each beat + the terminal wakes exactly once and a
      //     later non-wake heartbeat never re-fires an earlier wake. The old
      //     "one wake ever per item" (`wakeEnqueued`) is incompatible with an
      //     `everything` edge that must wake on every beat + the terminal, and it
      //     doubled as a false "parent was told" witness. Replaced with a durable
      //     `terminalWakeItems` SET on the EDGE doc, keyed by the producing beat's
      //     `doc._id` (LIN-1357): a stepper drips several terminal beats through
      //     ONE shared edge via `followUpTo`+`force`, and a per-edge BOOLEAN
      //     witness (the original LIN-826/900 shape) suppressed every terminal
      //     after the first, permanently dropping the parent wake for beats 2..N.
      //     Keying on the producing item lets a DISTINCT beat still wake the
      //     parent while a re-report of the SAME beat stays suppressed —
      //     `[pending]` beats remain unguarded and may wake repeatedly.
      const newWake = findWakeEvent([feedbackEntry]);
      let wakeFollowUp = null;
      let edgeDoc = null;
      let markTerminalOnEdge = false;
      // LIN-3257 (M1 shadow): the id of the wake row this feedback mints, when
      // one is minted, so the shadow verdict can be keyed to it. Captured from
      // whichever enqueue branch wins below; null when no wake is owed.
      let mintedWakeId = null;
      // LIN-2297: the once-only guard/witness key, class-aware. Hoisted to this
      // outer scope (assigned, not declared, inside the `if (newWake)` block
      // below) so `_mintWake`'s call site further down can see it. Bare
      // `doc._id` for a genuine terminal (byte-identical to pre-LIN-2297 for
      // every done/complete/failed/aborted wake); `${doc._id}#blocked` for a
      // `[blocked]` wake, so a blocked wake and a later genuine terminal on the
      // SAME producing item no longer collide on one guard slot.
      let wakeGuardKey = null;
      // LIN-1357 observability (defense-in-depth, NOT the functional fix): track
      // why a wake event produced no wake, so a dropped/suppressed wake is
      // self-attributing in logs instead of a silent no-op — the gap that made
      // the original incident hard to diagnose. Purely additive bookkeeping;
      // never read by the control flow below.
      let nullWakeReason = null;
      if (newWake) {
        edgeDoc = await this._resolveEdgeDoc(doc, urlKey);
        const isTerminalWake = newWake.marker !== 'pending';
        // LIN-2297: class-aware guard key, derived via `deriveTerminalStatus`
        // (the same blocked-vs-terminal discriminator `dispatch-terminal.js`
        // already owns) rather than a second classifier. Only `blocked` is a
        // wake marker absent from TERMINAL_FEEDBACK_REGEX, so it is the only
        // marker that ever reaches the `#marker` branch — every other wake
        // marker (done/complete/failed/aborted) keeps the bare key.
        wakeGuardKey = isTerminalWake
          ? (deriveTerminalStatus([feedbackEntry]) ? doc._id : `${doc._id}#${newWake.marker}`)
          : null;
        // LIN-1165: apply the kind:'wake' loop guard to the ORIGINAL feedback-
        // receiving `doc`, not only to the resolved edge. A session executing a
        // RECEIVED wake and then posting its own sentinel must not beget a fresh
        // wake back up its own edge. This fires only when `_resolveEdgeDoc` did NOT
        // walk away from `doc` (edge unresolvable → `edgeDoc === doc`, e.g. a wake
        // whose followUpTo target is gone). When the walk DID resolve to a distinct
        // ancestor dispatch — the LIN-1059 repoint carrier, a subscribed child's
        // terminal riding on a kind:'wake' item — the terminal still bubbles to that
        // ancestor, so the LIN-1059 edge is preserved (the self-edge check below
        // covers the resolved-but-looping case).
        const isSelfWakeTermination = doc.kind === 'wake' && edgeDoc._id === doc._id;
        // Terminal-scoped once-only: a terminal/blocked wake fires at most once per
        // (edge, producing beat item) — keyed on `doc._id`, the item THIS feedback
        // landed on (LIN-1357). `[pending]` beats are not guarded (they legitimately
        // wake on every boundary on an `everything` edge); per-event firing keeps
        // each beat item to one wake, while distinct beat items sharing one edge
        // (a stepper's `followUpTo`+`force` drip) each still wake the parent.
        const alreadyWokeForThisItem = (edgeDoc.terminalWakeItems || []).includes(wakeGuardKey);
        if (!isSelfWakeTermination && !(isTerminalWake && alreadyWokeForThisItem)) {
          wakeFollowUp = buildWakeFollowUp(edgeDoc, updated);
          // LIN-1165 belt-and-suspenders: never re-deliver a wake to the very item
          // that produced this feedback — a self-edge, or stale re-delivery of an
          // already-handled edge. A genuine child terminal / subscribed-stepper beat
          // resolves to a DISTINCT ancestor (followUpTo !== doc._id) and still
          // bubbles; only a self-loop back into the producing item is dropped here.
          if (wakeFollowUp && wakeFollowUp.followUpTo === doc._id) {
            wakeFollowUp = null;
            nullWakeReason = 'self-edge-loop';
          } else if (!wakeFollowUp) {
            nullWakeReason = 'no-descriptor (no parent edge, self id===sessionId, kind:wake structural loop guard, or abort-row exclusion)';
          }
          if (wakeFollowUp && isTerminalWake) markTerminalOnEdge = true;
        } else if (isSelfWakeTermination) {
          nullWakeReason = 'self-wake-termination';
        } else {
          nullWakeReason = 'already-woke-for-this-item';
        }
      }

      // LIN-3134 T2-ii (S6): the wake is a follow-up of the PARENT session
      // (`edgeDoc.sessionId`), so it resumes on the parent's persisted
      // declared-mint record, read before the provider block for the same
      // withdraw-before-witness reason given below. A record is carried onto the
      // wake row whether or not the mint succeeds (C4), so a later follow-up to
      // this wake resumes declared; `_mintWake` enqueues this same descriptor. A
      // read FAULT is transient: withdraw (witness unburned) rather than resume
      // a declared parent grant-less — a re-report reads again. A missing row
      // reads as no record (the store logs the miss).
      let grantDeclaration = null;
      if (wakeFollowUp) {
        try {
          const lookup = await this.getGrantDeclaration(urlKey, edgeDoc.sessionId);
          if (lookup && lookup.state === 'record') {
            grantDeclaration = lookup.record;
            wakeFollowUp.grantDeclaration = grantDeclaration;
          }
        } catch {
          wakeFollowUp = null;
          markTerminalOnEdge = false;
          nullWakeReason = 'grant-mint-transient:declaration-lookup-unavailable';
          console.log(`[dispatch-wake] grant-mint-transient producingItem=${doc._id} reason=${nullWakeReason}`);
        }
      }

      // LIN-1430 (S2): provision a wake credential, if the caller wants one.
      // MUST run here — after the wake descriptor is built, strictly BEFORE the
      // CAS/witness update below — so a provisioning failure can still WITHDRAW
      // the wake instead of stranding a durably-set witness with nothing
      // enqueued (the terminal would then be permanently marked woken and could
      // never re-win its election). Only runs when a wake is actually about to
      // fire; `provisionWakeCredential` absent (existing callers) is a no-op.
      //
      // The donor is the PARENT session (edgeDoc.sessionId — the id the wake
      // addresses), not the finished child `doc`: the consumer resumes on the
      // parent session's own harness and never re-resolves from the follow-up
      // item (LIN-1077). Passing the raw stored harness keeps this store a
      // mechanism; resolving it against a default is the route's policy.
      if (wakeFollowUp && provisionWakeCredential) {
        // LIN-3805: getItemStatus now throws on a store fault. The feedback write has
        // already landed, so the `[done]` must not 503 for a wake-only read, and
        // resuming the parent on a default harness (a null parentStatus) would be
        // silently wrong: withdraw the wake as transient (witness unburned, a
        // re-report re-enters and provisions again), same as the lookup above.
        let parentStatus = null;
        let parentStatusUnavailable = false;
        try {
          parentStatus = await this.getItemStatus(urlKey, edgeDoc.sessionId);
        } catch {
          parentStatusUnavailable = true;
        }
        const { token, reason, degraded, grantRefusal } = parentStatusUnavailable
          ? { reason: 'grant-mint-transient:parent-status-unavailable' }
          : await provisionWakeCredential(parentStatus?.harness ?? null, grantDeclaration);
        if (reason) {
          // TRANSIENT failure: a credential was wanted, the mint was reachable and
          // attempted, and it failed anyway (threw, or returned no token). Withdraw
          // the wake — retryable, since a re-report of the same terminal re-enters
          // and provisions again — rather than burn the once-only CAS witness on a
          // wake we could not credential. Do NOT mark the CAS witness.
          wakeFollowUp = null;
          markTerminalOnEdge = false;
          nullWakeReason = reason;
          // LIN-3134: a declared mint's transient refusal (OWNER_CHECK_UNAVAILABLE).
          if (reason.startsWith('grant-mint-transient:')) {
            console.log(`[dispatch-wake] grant-mint-transient producingItem=${doc._id} reason=${reason}`);
          }
        } else {
          // ENQUEUE. Two ways to land here, both correct:
          //   - token present: provisioned normally.
          //   - token null: either no token was WANTED (prose harness), or none
          //     could STRUCTURALLY exist (`degraded` — no proxy token store, or an
          //     ownerless caller). A structural miss must NOT suppress the wake:
          //     retrying cannot fix it, and a parent that never wakes at all is the
          //     LIN-1428 stall this ticket exists to close. LIN-1447 landed the same
          //     tolerate-ownerless policy one layer down, on the broker-token mint.
          //     A token-less wake still resumes the parent — but it resumes it
          //     WITHOUT a credential: SD's resume branch (dispatcher.js:600-618)
          //     has no fallback mint, and returns at :658 before LIN-1446's
          //     fresh-launch mint at :741 is reachable. The degrade is a real
          //     narrow gap, not a handoff to a backstop. See LIN-1449.
          wakeFollowUp.bootstrapToken = token;
          // LIN-3134: a declared parent whose grant was STRUCTURALLY refused. The
          // wake still enqueues (grant-less) and burns its witness like any
          // structural degrade — retrying cannot help — but it carries the code
          // and a server-authored notice, so the parent is told why it can no
          // longer enqueue work rather than failing on its next dispatch.
          if (grantRefusal) {
            wakeFollowUp.grantRefusal = grantRefusal;
            wakeFollowUp.prompt = `${formatGrantRefusalNotice(grantRefusal)}\n\n${wakeFollowUp.prompt}`;
          }
          if (degraded) {
            const declaredParent = wakeFollowUp.grantDeclaration != null ? ' declaredParent=true' : '';
            console.log(`[dispatch-wake] provisioned-without-credential producingItem=${doc._id} degraded=${degraded}${declaredParent}`);
          }
        }
      }

      // LIN-1343: guard the terminal witness with its own atomic CAS instead of
      // folding it into the feedback write above. Folding is tempting for the
      // common edgeDoc._id === itemId case, but ownership (the feedback append)
      // and once-only (the terminal witness) are independent conditions — sharing
      // a filter would mean that once the witness is already set, the WHOLE op
      // (including the append) fails to match and the feedback itself is silently
      // dropped, trading the bug this fixes for a worse one. One unconditional
      // guarded write, identical whether or not the edge is the current item,
      // replaces the old fold-at-:1059 + separate-write-at-:1072 split. Mark-
      // then-enqueue ordering is preserved: the witness still lands before
      // addItem. Only the winner of the CAS (matchedCount === 1) enqueues; a lost
      // election means another concurrent caller already owns this terminal.
      //
      // LIN-1357: the CAS filter/update re-key from a per-edge boolean to a
      // per-(edge, producing item) set — `terminalWakeItems: { $ne: doc._id }`
      // matches unless THIS producing item already recorded its terminal wake on
      // the edge (array $ne checks membership, not identity), and `$addToSet`
      // adds `doc._id` without duplicating it on a re-report. A distinct beat
      // item on the same edge is a fresh CAS filter value, so it wins its own
      // election independent of any earlier beat's witness.
      //
      // LIN-1698 Phase 1: the CAS + the durable `wakeWitnessMeta` seed + the
      // actual enqueue now live together in `_mintWake` (single caller, this
      // branch). A `[pending]` wake never reaches here — `markTerminalOnEdge`
      // is only set for a terminal/blocked wake — so it stays unguarded and
      // enqueues directly below, exactly as before.
      if (markTerminalOnEdge) {
        const mintResult = await this._mintWake(urlKey, edgeDoc, doc, updated, wakeFollowUp, newWake.marker, wakeGuardKey);
        wakeFollowUp = mintResult.wakeFollowUp;
        mintedWakeId = mintResult.mintedWakeId || null;
        if (!wakeFollowUp) nullWakeReason = mintResult.nullWakeReason;
      } else if (wakeFollowUp) {
        // LIN-1357 observability (defense-in-depth, NOT the functional fix): every
        // wake-worthy feedback event now logs its outcome, enqueued or not.
        console.log(`[dispatch-wake] enqueued parent=${wakeFollowUp.followUpTo} producingItem=${doc._id} marker=${newWake.marker}`);
        const mintedWakeRow = await this.addItem(urlKey, wakeFollowUp);
        mintedWakeId = mintedWakeRow?._id || null;
      }
      if (!wakeFollowUp && newWake) {
        console.log(`[dispatch-wake] null-wake producingItem=${doc._id} marker=${newWake.marker} reason=${nullWakeReason}`);
      }

      // LIN-3257 (M1 shadow): record the shadow verdict + per-day tally for this
      // minted wake. Strictly ADDITIVE and best-effort: its own try/catch only
      // logs, the wake is already enqueued by this point, and nothing below
      // reads the result — so no branch here can suppress delivery or change the
      // addFeedback return value. A no-op when no shadow collection is wired.
      if (mintedWakeId) {
        try {
          await recordWakeShadow(this.wakeShadowCollection, {
            urlKey,
            wakeRowId: mintedWakeId,
            edgeId: edgeDoc?._id || null,
            producingItemId: doc._id,
            marker: newWake.marker,
            // H7 person relays (reply box, ruling reply, Task Chat, Flight
            // Companion) never reach this seam, so this is defence in depth.
            // A supervisor-child pause relay posts onto a received `kind:'wake'`
            // row (dispatchedBy null), so it stays a candidate; a session-route
            // dispatch (person) carries dispatchedBy.
            personOriginated: !!doc.dispatchedBy,
            message: newWake.entry?.message || ''
          });
        } catch (err) {
          console.error('Error recording wake shadow (best-effort):', err?.message || err);
        }
      }

      // LIN-3365 (LIN-3358 B): lineage closers. Strictly ADDITIVE and best-effort,
      // after the wake is fully built and enqueued (so wake delivery is
      // byte-identical with the closers on or off): own try/catch, awaited, only
      // logs. Stamps only — no feedback entry is appended, so `feedbackVersion`
      // and the digest are untouched. Keyed on `doc.rootItemId` (reconciled from
      // this post in the same atomic update), never `sessionId`.
      // (b) runs before (a): `lineage-terminal` beats `handed-on` on a row both apply to.
      try {
        const closeBase = { exceptId: doc._id, takenBefore: feedbackEntry.timestamp, by: 'addFeedback' };
        if (doc.rootItemId && isLineageClosingTerminal(feedbackEntry.message)) {
          await this.closeLineageRows(urlKey, doc.rootItemId, {
            ...closeBase, beforeDispatchedAt: feedbackEntry.timestamp, reason: 'lineage-terminal'
          });
        }
        // (a) fires on the FIRST tagged post only (stateless gate off the
        // post-write array). Earlier `kind:'wake'` rows ONLY: a non-wake
        // follow-up (beat, human reply) may be long-polled (LIN-1470) and a
        // `closed` stamp would hand a live watcher a false terminal.
        if (rootItemId && doc.rootItemId && updated.filter(f => f.rootItemId).length === 1) {
          await this.closeLineageRows(urlKey, doc.rootItemId, {
            ...closeBase, beforeDispatchedAt: doc.dispatchedAt, kinds: ['wake'], reason: 'handed-on'
          });
        }
      } catch (err) {
        // internal-only: best-effort closers, never rethrown (the feedback write already landed)
        console.error('Error closing lineage rows (best-effort):', err?.message || err);
      }

      // LIN-3009 (LIN-2996 Phase 1): best-effort feedbackDigest maintenance.
      // Own try/catch, never rethrown, never affecting the return value below
      // — a digest failure must never turn a landed append into the outer
      // catch's null/404. digestFeedback needs the WHOLE post-write doc (W1:
      // doc.dispatchedAt for telemetry.runtime, doc.feedback raw for both the
      // formatted loop-facing shape and the raw kpi* shape), never a bare
      // feedback array. The guard filter re-checks feedbackVersion so a
      // writer whose version has since moved on (a concurrent write landed
      // first) loses this $set silently rather than overwriting a newer
      // digest with a stale one. Must run BEFORE _notifyWriteForDoc so every
      // write-triggered materialization sees a fresh digest, never forcing an
      // unnecessary self-heal.
      await this._afterFeedbackWrite(doc, feedbackEntry);

      // Feedback (the heartbeat / [evidence] log) drives the session's runtime,
      // metrics and terminal facts — recompute its derived doc (LIN-623). Same
      // feed-relevance gate as addItem, including the LIN-1307 followUpTo
      // resolution.
      this._notifyWriteForDoc(doc, urlKey);

      return { success: true, feedbackCount: updated.length };
    } catch (err) {
      console.error('Error adding feedback:', err);
      throw asStoreFault('addFeedback', err, { writeLanded });
    }
  }

  /**
   * Stamps a `decision-answer` feedback entry onto a history item, recording
   * that `decisionId` has been answered (LIN-1728, decision 1). Deliberately
   * NOT `addFeedback`: that method gates on `status: 'taken'` +
   * `takenByTokenLabel` — a runner-token precondition a session-authenticated
   * human Save can never satisfy. `'decision-answer'` is kept OUT of
   * `FEEDBACK_ENTRY_KINDS` on purpose, so the runner-facing sanitizer
   * (routes/dispatch.js, which validates against that list) can never accept
   * this kind — the only write path is this method. The asymmetry is
   * structural, not merely intended.
   *
   * @param {string} itemId - History item ID (the decision-bearing loop)
   * @param {string} urlKey - Workspace URL key
   * @param {string} decisionId - The `decision_id` being answered
   * @param {'answered'|'dismissed'} [outcome='answered'] - LIN-2225: a loop-backed
   *   ruling has no separate outcome column the way a scan-produced task decision
   *   does (`TaskDecisionsStore.markOutcome`), so a Rulings-page dismiss reuses
   *   this SAME stamp — tagged `outcome: 'dismissed'` in the message JSON — rather
   *   than inventing a second feedback kind. Every existing reader only ever
   *   parses `decision_id` off this message (`lib/pipeline-loops.js`'s
   *   `_findDecisionAnswer`), so a dismissed decision clears the unanswered queue
   *   exactly like an answered one, while staying distinguishable in storage for
   *   a later false-escalation KPI read (LIN-1736). Omitting the argument keeps
   *   the message byte-identical to before (`{decision_id}` only) — no existing
   *   caller's stamp shape changes.
   * @param {string} [optionId] - LIN-2754 Track B: a second, independent conditional
   *   key on the stamp's message, present whenever supplied regardless of what
   *   `outcome` resolves to (it can ride the bare `{decision_id}` shape too). The
   *   `outcome === 'dismissed'` ternary above stays byte-untouched by this addition.
   * @returns {Promise<{success: boolean, feedbackCount: number}|null>} Result or null if not found/wrong workspace
   */
  async markDecisionAnswered(itemId, urlKey, decisionId, outcome, optionId) {
    if (!itemId || !urlKey || !decisionId || !this.historyCollection) {
      return null;
    }

    try {
      const messagePayload = outcome === 'dismissed'
        ? { decision_id: decisionId, outcome: 'dismissed' }
        : { decision_id: decisionId };
      if (optionId) {
        messagePayload.option_id = optionId;
      }
      const feedbackEntry = {
        kind: 'decision-answer',
        message: JSON.stringify(messagePayload),
        timestamp: new Date()
      };

      const doc = await this.historyCollection.findOneAndUpdate(
        { _id: itemId, urlKey },
        // LIN-3009 (LIN-2996 Phase 1): $inc feedbackVersion in this SAME
        // atomic update — see addFeedback's identical guard for the full
        // rationale.
        { $push: { feedback: feedbackEntry }, $inc: { feedbackVersion: 1, lineageFeedbackCount: 1 } },
        { returnDocument: 'after' }
      );

      if (!doc) {
        return null;
      }

      // LIN-3009 (LIN-2996 Phase 1): best-effort feedbackDigest maintenance —
      // identical guarded try/catch, whole-doc contract (W1) and version-CAS
      // guard as addFeedback's write below. Must run before _notifyWriteForDoc.
      await this._afterFeedbackWrite(doc, feedbackEntry);

      this._notifyWriteForDoc(doc, urlKey);

      return { success: true, feedbackCount: doc.feedback.length };
    } catch (err) {
      console.error('Error marking decision answered:', err);
      throw asStoreFault('markDecisionAnswered', err);
    }
  }

  /**
   * Withdraws an open decision (LIN-3366): appends a `decision-withdrawn`
   * stamp `{decision_id, reason}` for the ticket-closed closer. Direct history
   * write (NOT `addFeedback`, which gates on `taken` plus a token label).
   *
   * Return contract — the closer splits on it:
   *   - `{success: true, feedbackCount}`: appended.
   *   - `{refused: 'reversed'|'withdrawn'|'not-found'}`: an EXPECTED skip, no
   *     append (a human reversed it, it is already withdrawn, or the row is gone).
   *   - `null`: bad args, an error, or a lost `feedbackVersion` CAS — a failure.
   *
   * No digest heal here: by the time a refusal fires the carrier row may
   * already be stamped, so healing would converge the digest but not save it.
   *
   * @param {string} itemId
   * @param {string} urlKey
   * @param {string} decisionId
   * @param {string} reason
   * @returns {Promise<{success: boolean, feedbackCount: number}|{refused: string}|null>}
   */
  async markDecisionWithdrawn(itemId, urlKey, decisionId, reason) {
    if (!itemId || !urlKey || !decisionId || typeof reason !== 'string' || !reason || !this.historyCollection) {
      return null;
    }

    try {
      const doc = await this.historyCollection.findOne({ _id: itemId, urlKey });
      if (!doc) return { refused: 'not-found' };

      if (_findReversedDecisionIds(doc.feedback).has(decisionId)) return { refused: 'reversed' };
      if (_findDecisionWithdrawal(doc.feedback, decisionId)) return { refused: 'withdrawn' };

      const feedbackEntry = {
        kind: 'decision-withdrawn',
        message: JSON.stringify({ decision_id: decisionId, reason }),
        timestamp: new Date()
      };

      const updatedDoc = await this.historyCollection.findOneAndUpdate(
        { _id: doc._id, urlKey, feedbackVersion: doc.feedbackVersion },
        { $push: { feedback: feedbackEntry }, $inc: { feedbackVersion: 1, lineageFeedbackCount: 1 } },
        { returnDocument: 'after' }
      );
      if (!updatedDoc) return null; // lost the CAS: snapshot may be stale

      await this._afterFeedbackWrite(updatedDoc, feedbackEntry);

      this._notifyWriteForDoc(updatedDoc, urlKey);

      return { success: true, feedbackCount: updatedDoc.feedback.length };
    } catch (err) {
      console.error('Error marking decision withdrawn:', err);
      throw asStoreFault('markDecisionWithdrawn', err);
    }
  }

  /**
   * Reverses a live `decision-withdrawn` stamp by appending a terminal
   * `decision-withdrawal-reversed` entry (LIN-2891/LIN-3035). Session-auth
   * only: the sole caller is routes/dashboard.js's reverse-withdrawal route,
   * mounted under `workspaceFromUrl` — never through `addFeedback`/the
   * runner-facing sanitizer. `'decision-withdrawal-reversed'` is kept OUT of
   * `FEEDBACK_ENTRY_KINDS` on purpose, exactly like `'decision-answer'`, so
   * this method is structurally the only write path.
   *
   * Terminal: a pre-write read through `_findDecisionWithdrawal`
   * (lib/digest-feedback.js), scoped to the requested `decisionId`, confirms a
   * live withdrawal for THAT id on this item before anything is appended. A
   * never-withdrawn or already-reversed pair returns `null` with NO append —
   * the property this whole method exists for. `decisionId` scoping (LIN-2891
   * F1) means a live withdrawal of a moot, non-current id is still reversible
   * here, and a row carrying several withdrawals reverses each independently.
   *
   * The `$push` itself carries a NEW `{_id, urlKey, feedbackVersion}` CAS
   * (no precedent elsewhere in this file): unlike `addFeedback`/
   * `markDecisionAnswered`, which gate only on ownership, this write's
   * CORRECTNESS depends on the pre-write snapshot (`_findDecisionWithdrawal`'s
   * result) still holding at write time. Losing the CAS means some other
   * write landed between the read and this update, so the snapshot may be
   * stale; rather than blindly proceed, this returns `null` and lets the
   * caller re-read and retry.
   *
   * @param {string} itemId - History item ID (the decision-bearing loop)
   * @param {string} urlKey - Workspace URL key
   * @param {string} decisionId - The `decision_id` being reversed
   * @returns {Promise<{success: boolean, feedbackCount: number}|null>} Result,
   *   or `null` if the item doesn't exist/match the workspace, `decisionId`
   *   is not currently withdrawn, or a concurrent write won the CAS first.
   */
  async markDecisionWithdrawalReversed(itemId, urlKey, decisionId) {
    if (!itemId || !urlKey || !decisionId || !this.historyCollection) {
      return null;
    }

    try {
      const doc = await this.historyCollection.findOne({ _id: itemId, urlKey });
      if (!doc) {
        return null;
      }

      const liveWithdrawal = _findDecisionWithdrawal(doc.feedback, decisionId);
      if (!liveWithdrawal) {
        // Never-withdrawn, already reversed (and thus no longer "live"), or a
        // withdrawal that names a DIFFERENT decision on this row — all collapse
        // to this one terminal `null`, no append either way. Passing
        // `decisionId` makes the pre-check decision-aware (LIN-2891 F1): a live
        // withdrawal of a moot, non-current id is still independently reversible
        // here, because the caller names the id it wants to reverse.
        return null;
      }

      const feedbackEntry = {
        kind: 'decision-withdrawal-reversed',
        message: JSON.stringify({ decision_id: decisionId }),
        timestamp: new Date()
      };

      const updatedDoc = await this.historyCollection.findOneAndUpdate(
        { _id: doc._id, urlKey, feedbackVersion: doc.feedbackVersion },
        { $push: { feedback: feedbackEntry }, $inc: { feedbackVersion: 1, lineageFeedbackCount: 1 } },
        { returnDocument: 'after' }
      );

      if (!updatedDoc) {
        // Lost the CAS: the pre-check snapshot may now be stale. Do not
        // retry here — the caller re-reads on its own next request.
        return null;
      }

      // LIN-3009 (LIN-2996 Phase 1): best-effort feedbackDigest maintenance —
      // identical guarded try/catch, whole-doc contract (W1) and version-CAS
      // guard as addFeedback/markDecisionAnswered. Must run before
      // _notifyWriteForDoc.
      await this._afterFeedbackWrite(updatedDoc, feedbackEntry);

      this._notifyWriteForDoc(updatedDoc, urlKey);

      return { success: true, feedbackCount: updatedDoc.feedback.length };
    } catch (err) {
      console.error('Error marking decision withdrawal reversed:', err);
      throw asStoreFault('markDecisionWithdrawalReversed', err);
    }
  }

  /**
   * Formats a database document for API response.
   *
   * @param {Object} doc - Database document
   * @returns {Object} Formatted item
   * @private
   */
  _formatItem(doc) {
    const item = {
      id: doc._id,
      prompt: doc.prompt,
      promptName: doc.promptName,
      issueId: doc.issueId,
      issueIdentifier: doc.issueIdentifier,
      issueTitle: doc.issueTitle,
      issueUrl: doc.issueUrl,
      workspace: {
        urlKey: doc.urlKey
      },
      dispatchedAt: doc.dispatchedAt?.toISOString?.() || doc.dispatchedAt,
      dispatchedBy: doc.dispatchedBy,
      // The load-bearing forward for LIN-1155: deliver the structured bootstrap
      // token on the consumer poll/take response so the claude-code harness can
      // hand it to a primed MCP tool (the token was stripped from the prompt for
      // that harness). null for every other harness. Present ONLY here — never on
      // _formatHistoryItem, _archiveItem, or formatDispatchWatch — so a live,
      // single-use credential is delivered to the taker but not persisted to the
      // 30-day history. This formatter ALSO backs listItems/getItemStatus/
      // trimSessionBudget, which session-readable routes serve, so those routes
      // null it via lib/dispatch-session-redaction.js (LIN-3384) — redaction
      // cannot live here because poll/take alias this same formatter.
      bootstrapToken: doc.bootstrapToken || null,
      // Graceful-trim audit trail (LIN-2147): who/when/what for every
      // `trimSessionBudget` call against this run's `maxTasks`. Additive-only,
      // append-only; `[]` when the run has never been trimmed.
      trimHistory: doc.trimHistory || [],
      // The durable session-group id (LIN-1341) — readers (getItemStatus, the
      // pipeline-loops builder, the Observation materializer) group follow-ups
      // by this instead of walking the followUpTo chain. See the schema comment
      // and addItem for the precedence rule.
      sessionGroupId: doc.sessionGroupId || null,
      // Per-runner-session lineage anchor (LIN-1468) — readable here so
      // dispatch-factory.js's followUpTo inheritance seam can resolve
      // `anchor.rootItemId` off this exact shape (via getItemStatus), the same
      // read path sessionGroupId inheritance already relies on.
      rootItemId: doc.rootItemId || null,
      expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
    };
    // The 23 always-present run-row fields come from lib/dispatch-fields.js, the
    // same declaration the writers use; none is listed in the literal above.
    Object.assign(item, normalizeRunFields(doc));
    // LIN-3242 (LIN-3126 §4): project the dispatch binding selector pair when
    // present. Additive, non-secret selection provenance — the runner works from
    // the prompt and ignores it, while the effort read-out groups by it. SPARSE
    // (assigned only when present), so unstamped rows keep a byte-identical key
    // set. No spread in this body (the C4 census pins that, to keep the
    // declared-mint tokens out of the projections).
    if (doc.issueSource != null) item.issueSource = doc.issueSource;
    // LIN-3384: sparse boolean marker that this row's credential was minted
    // from a declared-mint record (a declared resume mints for the recorded
    // OWNER, not the poster). Carries the fact, never the record: the session
    // redactor masks the prose token for EVERY reader when it is set, and strips
    // the marker itself. Exactly one assignment per formatter (the C4 census
    // pins that); no spread.
    if (doc.grantDeclaration != null) item.declaredMint = true;
    return item;
  }
}
