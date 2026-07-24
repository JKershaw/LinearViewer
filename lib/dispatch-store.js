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
 *   bootstrapToken: string,   // Structured single-use bootstrap token for the claude-code MCP branch (LIN-1155). Set only when the token is stripped from the prompt prose (attachProxyContext); delivered on poll/take (_formatItem) but deliberately NOT persisted to history (_archiveItem) nor exposed on the proxy list/watch endpoints. null otherwise.
 *   followUpTo: string,       // Original dispatchId to resume as a follow-up (optional, nullable, cli/web only). Stored + forwarded blindly; the downstream dispatcher owns session identity/liveness. See LIN-415.
 *   force: boolean,           // Force-resume flag: when true a follow-up bypasses the runner's active-session liveness guard so a wedged/sleeping session can still be resumed (optional, defaults false). Only meaningful alongside followUpTo. Stored + forwarded blindly; the runner reads item.force. See LIN-559 (consumer-side gate: LIN-546).
 *   abort: boolean,           // Abort verb: when true this item asks the consumer to cancel/close an existing session instead of running a prompt (optional, defaults false). Carries no prompt. Stored + forwarded blindly; the consumer's abort arm reads abort/abortTo. See LIN-743 (verb internals: LIN-553).
 *   abortTo: string,          // The dispatchId of the session to abort (required when abort is true, UUID-shaped, else null). The abort item's OWN target — not the aborted session's substrate — governs poll eligibility. See LIN-743.
 *   cascade: boolean,         // Cascade-close modifier on an abort (optional, defaults false). When true, abortTo names the ROOT session of a subtree Harbour expands into one abort per descendant (the recursive walk is a later beat). Route layer rejects cascade:true without abort. Stored + forwarded blindly; consumed by Harbour's expansion, not the runner. See LIN-946.
 *   sessionId: string,        // Autopilot dispatchId that spawned this worker dispatch (optional, nullable, any target). Stored + forwarded blindly; groups worker dispatches into one autopilot session. See LIN-591.
 *   sessionGroupId: string,   // Durable session-group id (LIN-1341): the id readers group follow-ups by, O(1), instead of walking the followUpTo chain. Precedence at ingest: an inherited parent group (a followUpTo dispatch whose anchor already carries one) ?? this item's own sessionId ?? this doc's own _id. Composes with, never overrides, sessionId grouping — a reply to an autopilot worker inherits the worker's sessionId as its group id, landing in the same session. Every row gets one; a pre-LIN-1341 row has none and readers fall back to the legacy followUpTo chain-walk for it.
 *   rootItemId: string,       // Per-runner-session lineage anchor (LIN-1468), item-doc-level. Precedence at ingest: an inherited followUpTo anchor's own rootItemId ?? this doc's own _id. TWO tiers only — deliberately never falls back to sessionId (unlike sessionGroupId), because every sibling worker an autopilot spawns shares one sessionId and a sessionId tier would collapse them onto one rootItemId, reinstating the sibling-collapse bug LIN-1461 fixed. Read precedence (getItemStatus's group-feedback merge): this field ?? the first feedback entry carrying rootItemId ?? doc._id. A pre-LIN-1468 row has none and derivation falls back accordingly; tolerated, never backfilled (no migration framework — see lib/db-indexes.js).
 *   waitForFollowUps: boolean,// Opt-in completion hold (default false). When true the runner holds the session open at completion to receive in-session follow-ups instead of finalizing. Stored + forwarded blindly; the runner owns the behaviour. See LIN-795/LIN-797.
 *   queueIfBusy: boolean,     // Push-comms (default false). When true the runner leaves a busy-target follow-up unclaimed rather than failing it (LIN-827 runner path). Stored + forwarded blindly; no Harbour semantics. See LIN-826.
 *   subscription: string,     // Push-comms edge declaration (LIN-900 §6): enum 'everything'|'terminal-only' (default 'terminal-only'). Declares which of this child's events wake its dispatching parent (§5 matrix). Stored + forwarded blindly; Harbour reads it only when building the wake follow-up. See LIN-826/LIN-901.
 *   expiresAt: Date           // TTL-based expiration
 * }
 */

import crypto from 'crypto';
import { buildWakeFollowUp, DEFAULT_SUBSCRIPTION } from './dispatch-wake.js';
import { findWakeEvent, mergeLineageFeedback } from './dispatch-terminal.js';

/**
 * Allowed values for a feedback ENTRY's `kind` (nested inside each `feedback[]`
 * element) — a vocabulary distinct from the dispatch-ITEM `kind` (DISPATCH_KINDS
 * in lib/prompt-templates.js, e.g. "implementation"/"custom"). Never validate
 * feedback-entry `kind` against DISPATCH_KINDS, and never write it top-level on
 * the doc. See LIN-1297.
 */
export const FEEDBACK_ENTRY_KINDS = ['status', 'recap', 'heartbeat', 'evidence', 'assistant-text', 'tool', 'usage'];

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
 * @param {string} prompt - The kickoff prompt text
 * @param {string} sessionId - The autopilot's own dispatch id (`doc._id`)
 * @returns {string} The prompt with the session-id block appended
 */
function appendAutopilotSessionRef(prompt, sessionId) {
  return `${prompt}

---

## Your autopilot session id

This run's own dispatch id — your **session id** — is \`${sessionId}\`. Pass it as
\`sessionId\` on **every** worker dispatch you issue this run: every
\`POST /recommend-and-dispatch\`, every plain \`POST /dispatch\`, and any \`followUpTo\`
liveness nudge. That explicit link is what groups all the work you spawn into this
one autopilot session.`;
}

/**
 * Dispatch queue store for managing dispatched prompts.
 * Works with both MongoDB and MangoDB (file-based MongoDB-like storage).
 */
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
    this.historyTtl = options.historyTtl || 30 * 24 * 60 * 60; // 30 days in seconds
    this.onWrite = typeof options.onWrite === 'function' ? options.onWrite : null;
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
   * @param {Object} [item.presetConfig] - Frozen dispatch preset config snapshot (LIN-1390). Set only by the factory on kind:'autopilot' rows carrying a selected or inherited preset; null otherwise. Not a credential — persisted to history and exposed on list/watch/take.
   * @param {string} [item.presetName] - Display name of the preset `presetConfig` was captured from (LIN-1390); null when presetConfig is null.
   * @param {string} [item.bootstrapToken] - Structured single-use bootstrap token for the claude-code MCP branch (LIN-1155). Set only when the token is stripped from the prompt prose; delivered on poll/take, NOT persisted to history or exposed on list/watch. null otherwise
   * @param {string} [item.followUpTo] - Original dispatchId to resume as a follow-up (optional; stored + forwarded blindly)
   * @param {boolean} [item.force] - Force-resume flag: bypass the runner's active-session guard on a follow-up (optional; only meaningful with followUpTo; stored + forwarded blindly)
   * @param {boolean} [item.abort] - Abort verb: cancel/close an existing session instead of running a prompt (optional; carries no prompt; stored + forwarded blindly)
   * @param {string} [item.abortTo] - The dispatchId of the session to abort (required when abort is true; stored + forwarded blindly)
   * @param {boolean} [item.cascade] - Cascade-close modifier on an abort (default false); abortTo names a subtree root Harbour expands (walk is a later beat). Stored + forwarded blindly (LIN-946)
   * @param {string} [item.sessionId] - Autopilot dispatchId that spawned this worker (optional; stored + forwarded blindly)
   * @param {string} [item.sessionGroupId] - Durable session-group id inherited from a followUpTo anchor (LIN-1341; normally set only by `createDispatchItem`'s follow-up inheritance seam, never by a caller directly). A root dispatch mints its own group id here from `item.sessionGroupId ?? item.sessionId ?? doc._id` — see the schema comment above for the full precedence rule.
   * @param {string} [item.rootItemId] - Per-runner-session lineage anchor inherited from a followUpTo anchor (LIN-1468; normally set only by `createDispatchItem`'s follow-up inheritance seam, never by a caller directly). A root dispatch mints its own anchor here from `item.rootItemId ?? doc._id` — two tiers only, never `sessionId`. See the schema comment above.
   * @param {boolean} [item.waitForFollowUps] - Opt-in completion hold (default false); stored + forwarded blindly, the runner owns the behaviour
   * @param {boolean} [item.queueIfBusy] - Push-comms (default false); runner leaves a busy-target follow-up unclaimed rather than failing it; stored + forwarded blindly (LIN-826/LIN-827)
   * @param {string} [item.subscription] - Push-comms edge declaration (LIN-900 §6): enum 'everything'|'terminal-only' (default 'terminal-only'); declares which events wake the dispatching parent; stored + forwarded blindly (LIN-826/LIN-901)
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
      // Stable task classification. The route layer resolves this (explicit
      // `kind` or derived from promptName); 'custom' is a defensive default for
      // any caller that doesn't supply one. See lib/prompt-templates.js.
      kind: item.kind || 'custom',
      issueId: item.issueId || null,
      issueIdentifier: item.issueIdentifier || null,
      issueTitle: item.issueTitle || null,
      issueUrl: item.issueUrl || null,
      dispatchedAt: now,
      dispatchedBy: item.dispatchedBy || null,
      target: item.target || 'cli',
      repo: item.repo || null,
      // Execution model (LIN-438): the model the consumer/runner passes to its own
      // CLI (e.g. claude --model) to RUN this prompt — NOT the OpenRouter generation
      // model that WRITES prompts (lib/openrouter.js AVAILABLE_MODELS; different
      // namespace, deliberately not validated here). Opaque OpenRouter-style
      // provider/model wire value; stored + forwarded blindly. null preserves the
      // consumer's current default (e.g. Opus), so the field is inert until the
      // external runner reads item.model.
      model: item.model || null,
      // Execution harness (LIN-1084): which harness (e.g. 'claude-code',
      // 'opencode') the consumer/runner should use to run this prompt. Opaque,
      // not registry-validated; stored + forwarded blindly. null preserves the
      // consumer's own default/precedence chain.
      harness: item.harness || null,
      // Frozen preset snapshot + display name (LIN-1390). Stamped ONLY on
      // kind:'autopilot' rows carrying a selected or inherited dispatch preset
      // (lib/dispatch-factory.js); null otherwise. Unlike bootstrapToken these
      // are not credentials — they belong in history and on the watch echo, so
      // a child-autopilot dispatched as a followUpTo can read this row's
      // presetConfig back (via getItemStatus) and inherit it transitively.
      presetConfig: item.presetConfig || null,
      presetName: item.presetName || null,
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
      bootstrapToken: item.bootstrapToken || null,
      // Optional follow-up reference: the original dispatchId whose session the
      // downstream dispatcher should resume. Stored + forwarded blindly (no
      // liveness check here); cli/web only. See LIN-415.
      followUpTo: item.followUpTo || null,
      // Force-resume flag (LIN-559): when true a follow-up overrides the runner's
      // active-session liveness guard so a wedged/sleeping session can still be
      // resumed (the human asserts the prior process is dead — see LIN-546). Only
      // meaningful alongside followUpTo; the route layer rejects force:true without
      // it. Stored + forwarded blindly; the runner reads item.force.
      force: item.force === true,
      // Abort verb (LIN-743): when `abort` is true the consumer cancels/closes the
      // session named by `abortTo` instead of running a prompt. Stored + forwarded
      // blindly here; the route layer enforces the contract (abortTo required + UUID,
      // own target poll-eligible, mutually exclusive with followUpTo).
      abort: item.abort === true,
      abortTo: item.abortTo || null,
      // Cascade-close modifier (LIN-946): when true, abortTo names a subtree root
      // Harbour expands into one abort per descendant (the recursive walk lands in
      // a later beat). Stored + forwarded blindly; consumed by Harbour's expansion,
      // not the runner. The route layer rejects cascade:true without abort.
      cascade: item.cascade === true,
      // Optional autopilot session reference: the dispatchId of the autopilot
      // run that spawned this worker. Stored + forwarded blindly (no liveness
      // check); any target, groups workers into one session. See LIN-591.
      sessionId: item.sessionId || null,
      // Opt-in completion hold (LIN-795/LIN-797): when true the runner holds the
      // session open at completion to receive in-session follow-ups (beats)
      // instead of finalizing. Coerced to a strict boolean, default false;
      // forwarded blindly — the runner owns the behaviour.
      waitForFollowUps: item.waitForFollowUps === true,
      // Push-based inter-session comms. Both stored + forwarded blindly, exactly
      // like waitForFollowUps/force — Harbour owns no semantics beyond the wake:
      //   queueIfBusy  — the runner leaves a busy-target follow-up unclaimed
      //                  rather than failing it (LIN-827 runner path).
      //   subscription — edge declaration (LIN-900 §6): which of this child's
      //                  events wake the dispatching parent (§5 matrix). Enum,
      //                  declared once on the edge; undeclared → 'terminal-only'.
      queueIfBusy: item.queueIfBusy === true,
      subscription: item.subscription || DEFAULT_SUBSCRIPTION,
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

    await this.collection.insertOne(doc);
    // Recompute the Observation read-model for this session (LIN-623). Feed-
    // relevant dispatches carry/seed a session: an autopilot kickoff IS the
    // session (`doc._id`), a worker forwards its `sessionId`, and a followUpTo-
    // only write (the reply box) resolves to its chain root (LIN-1307). A plain
    // manual dispatch with none of these never appears in the sessions feed, so
    // it's skipped inside the helper.
    this._notifyWriteForDoc(doc, urlKey);
    return doc;
  }

  /**
   * Looks up a single dispatch item by ID and reports its lifecycle status.
   *
   * Resolves across BOTH collections, because an item moves from the active
   * queue to history the moment a consumer takes it:
   *   - still in the active queue          → status 'queued', feedback []
   *   - archived in history (taken/etc.)   → its history status + feedback[]
   * Returns null if the ID is unknown to the workspace. This is the read
   * ("watch") half the autopilot orchestrator polls after dispatching.
   *
   * @param {string} urlKey - Workspace URL key (scopes the lookup)
   * @param {string} itemId - Item ID (UUID)
   * @param {Object} [options]
   * @param {boolean} [options.includeGroupFeedback] - Merge in sibling-session
   *   feedback via `_collectGroupFeedback` (LIN-1461). This is an EXTRA indexed
   *   query plus an in-memory filter/sort, so it's opt-in: only the watch/poll
   *   seam (`GET /api/proxy/dispatch/:id`, routes/proxy.js) that actually reads
   *   `feedback` to derive terminal status needs it. Every other caller here
   *   (dispatch-factory.js's followUpTo anchor lookup, the Observation
   *   materializer, the dashboard's issue-scoped point-reads, `GET
   *   /api/proxy/dispatch/:id/prompt`) only reads id/prompt/issue* fields and
   *   stays on the cheap default (this item's own feedback only).
   * @returns {Promise<Object|null>} `{ id, status, target, issue*, feedback, ... }` or null
   */
  async getItemStatus(urlKey, itemId, { includeGroupFeedback = false } = {}) {
    if (!urlKey || !itemId) {
      return null;
    }

    try {
      // Active queue first — present here means not yet taken.
      const active = await this.collection.findOne({ _id: itemId, urlKey });
      if (active) {
        return { ...this._formatItem(active), status: 'queued', feedback: [] };
      }

      // Otherwise it may have been taken (and possibly fed back on).
      if (this.historyCollection) {
        const hist = await this.historyCollection.findOne({ _id: itemId, urlKey });
        if (hist) {
          const formatted = this._formatHistoryItem(hist);
          formatted.feedback = includeGroupFeedback
            ? await this._collectGroupFeedback(urlKey, hist)
            : (formatted.feedback || []);
          return formatted;
        }
      }

      return null;
    } catch (err) {
      console.error('Error getting dispatch item status:', err);
      return null;
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
   *   timestamp-ascending
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
    const anchor = doc.rootItemId || ownFeedback.find(f => f.rootItemId)?.rootItemId || doc._id;

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
      console.error('Error collecting session-group feedback:', err);
      return this._formatFeedbackEntries(ownFeedback);
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
   */
  async listItems(urlKey, { issueIdentifier, sessionId, sessionGroupId, rootItemId, followUpTo, projection } = {}) {
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
      return [];
    }
  }

  /**
   * Gets the count of items in the queue for a workspace.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<number>} Count of queued items
   */
  async countItems(urlKey) {
    if (!urlKey) {
      return 0;
    }

    try {
      const now = new Date();
      // MangoDB may not support countDocuments, so use find + length
      const docs = await this.collection.find({
        urlKey,
        expiresAt: { $gt: now }
      }).toArray();
      return docs.length;
    } catch (err) {
      console.error('Error counting dispatch items:', err);
      return 0;
    }
  }

  /**
   * Removes a specific item from the queue.
   *
   * @param {string} urlKey - Workspace URL key
   * @param {string} itemId - Item ID to remove
   * @returns {Promise<boolean>} True if item was removed
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
        await this._archiveItem(doc, 'cancelled');
      }

      return result.deletedCount > 0;
    } catch (err) {
      console.error('Error removing dispatch item:', err);
      return false;
    }
  }

  /**
   * Atomically claims and removes an item from the queue.
   * Used by consumers to take items for processing.
   * Returns null if item doesn't exist, is expired, or was already taken.
   *
   * @param {string} itemId - Item ID to take
   * @param {string} [urlKey] - Optional workspace URL key for verification
   * @returns {Promise<Object|null>} The taken item or null
   */
  async takeItem(itemId, urlKey = null, tokenLabel = null) {
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

      // Atomic find and delete
      const doc = await this.collection.findOneAndDelete(query);

      if (!doc) {
        return null;
      }

      await this._archiveItem(doc, 'taken', { takenByTokenLabel: tokenLabel });

      return this._formatItem(doc);
    } catch (err) {
      console.error('Error taking dispatch item:', err);
      return null;
    }
  }

  /**
   * Polls for available items in a workspace.
   * Returns items without removing them.
   *
   * @param {string} urlKey - Workspace URL key
   * @returns {Promise<Array>} Array of available items
   */
  async pollAvailable(urlKey) {
    return this.listItems(urlKey);
  }

  /**
   * Removes all expired items from the queue.
   * Called periodically to prevent stale item buildup.
   *
   * @returns {Promise<number>} Number of items removed
   */
  async cleanup() {
    try {
      const now = new Date();

      // Archive expired items before deleting
      if (this.historyCollection) {
        try {
          const expired = await this.collection.find({
            expiresAt: { $lt: now }
          }).toArray();
          for (const doc of expired) {
            await this._archiveItem(doc, 'expired');
          }
        } catch (archiveErr) {
          console.error('Error archiving expired items:', archiveErr);
        }

        // Clean up old history entries
        try {
          await this.historyCollection.deleteMany({
            historyExpiresAt: { $lt: now }
          });
        } catch (historyErr) {
          console.error('Error cleaning up history:', historyErr);
        }
      }

      const result = await this.collection.deleteMany({
        expiresAt: { $lt: now }
      });
      return result.deletedCount || 0;
    } catch (err) {
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
   * @private
   */
  async _archiveItem(doc, status, metadata = {}) {
    if (!this.historyCollection) return;

    try {
      const now = new Date();
      await this.historyCollection.insertOne({
        _id: doc._id,
        urlKey: doc.urlKey,
        prompt: doc.prompt || null,
        promptName: doc.promptName,
        kind: doc.kind || 'custom',
        issueId: doc.issueId,
        issueIdentifier: doc.issueIdentifier,
        issueTitle: doc.issueTitle,
        issueUrl: doc.issueUrl,
        dispatchedAt: doc.dispatchedAt,
        dispatchedBy: doc.dispatchedBy,
        target: doc.target || 'cli',
        repo: doc.repo || null,
        model: doc.model || null,
        harness: doc.harness || null,
        presetConfig: doc.presetConfig || null,
        presetName: doc.presetName || null,
        followUpTo: doc.followUpTo || null,
        force: doc.force === true,
        abort: doc.abort === true,
        abortTo: doc.abortTo || null,
        cascade: doc.cascade === true,
        sessionId: doc.sessionId || null,
        sessionGroupId: doc.sessionGroupId || null,
        rootItemId: doc.rootItemId || null,
        waitForFollowUps: doc.waitForFollowUps === true,
        queueIfBusy: doc.queueIfBusy === true,
        subscription: doc.subscription || DEFAULT_SUBSCRIPTION,
        status,
        resolvedAt: now,
        takenByTokenLabel: metadata.takenByTokenLabel || null,
        historyExpiresAt: new Date(now.getTime() + this.historyTtl * 1000)
      });
      // The dispatch moved to history (taken/cancelled/expired) — its session's
      // derived doc must reflect the new terminal/agentState (LIN-623). Same
      // feed-relevance gate as addItem, including the LIN-1307 followUpTo
      // resolution.
      this._notifyWriteForDoc(doc, doc.urlKey);
    } catch (err) {
      console.error('Error archiving dispatch item:', err);
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
   * @returns {Promise<{items: Array, total: number}>} History items and total count
   */
  async listHistory(urlKey, { limit, offset = 0, issueIdentifier, since, projection, sessionId, sessionGroupId, rootItemId, followUpTo } = {}) {
    if (!urlKey || !this.historyCollection) {
      return { items: [], total: 0 };
    }

    try {
      const query = { urlKey };
      if (issueIdentifier) query.issueIdentifier = issueIdentifier;
      if (sessionId) query.sessionId = sessionId;
      if (sessionGroupId) query.sessionGroupId = sessionGroupId;
      if (rootItemId) query.rootItemId = rootItemId;
      if (followUpTo) query.followUpTo = followUpTo;
      if (since) query.dispatchedAt = { $gte: since };
      const findOpts = projection ? { projection } : undefined;

      // When a `limit` is set, push sort+skip+limit into the query so Mongo
      // returns only the newest N rows (index-backed by {urlKey, resolvedAt:-1})
      // instead of reading the whole 30-day, feedback-bearing history into memory
      // and slicing in JS. This is the LIN-1030 fix for the live `/api/proxy/
      // dispatch` H12: the read is now bounded by `limit`, not by history size.
      // `total` stays the full matching count (index-only) so paginating callers
      // are unaffected. The unlimited path below is left exactly as it was for the
      // callers that legitimately need the whole (already `since`-windowed) set.
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
        return {
          items: docs.map(doc => this._formatHistoryItem(doc)),
          total
        };
      }

      const docs = await this.historyCollection.find(query, findOpts).toArray();

      // Sort by resolvedAt descending
      docs.sort((a, b) => {
        const aTime = a.resolvedAt instanceof Date ? a.resolvedAt.getTime() : new Date(a.resolvedAt).getTime();
        const bTime = b.resolvedAt instanceof Date ? b.resolvedAt.getTime() : new Date(b.resolvedAt).getTime();
        return bTime - aTime;
      });

      const total = docs.length;
      const sliced = docs.slice(offset);

      return {
        items: sliced.map(doc => this._formatHistoryItem(doc)),
        total
      };
    } catch (err) {
      console.error('Error listing dispatch history:', err);
      return { items: [], total: 0 };
    }
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
   * no-op, so the walk never needs to pre-check liveness. INERT until a caller
   * issues a cascade — nothing does yet. See LIN-946.
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
      console.error('Error clearing dispatch history:', err);
      return 0;
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
      kind: doc.kind || 'custom',
      issueId: doc.issueId,
      issueIdentifier: doc.issueIdentifier,
      issueTitle: doc.issueTitle,
      issueUrl: doc.issueUrl,
      dispatchedAt: doc.dispatchedAt?.toISOString?.() || doc.dispatchedAt,
      target: doc.target || 'cli',
      repo: doc.repo || null,
      model: doc.model || null,
      harness: doc.harness || null,
      presetConfig: doc.presetConfig || null,
      presetName: doc.presetName || null,
      followUpTo: doc.followUpTo || null,
      force: doc.force === true,
      abort: doc.abort === true,
      abortTo: doc.abortTo || null,
      cascade: doc.cascade === true,
      sessionId: doc.sessionId || null,
      sessionGroupId: doc.sessionGroupId || null,
      // Item-doc-level lineage anchor (LIN-1468). Must be readable here (not
      // just persisted): dispatch-factory.js's followUpTo inheritance seam
      // reads it back off this exact shape (via getItemStatus) to resolve
      // `anchor.rootItemId` for the next dispatch in the lineage — the same
      // read path sessionGroupId inheritance already relies on.
      rootItemId: doc.rootItemId || null,
      waitForFollowUps: doc.waitForFollowUps === true,
      queueIfBusy: doc.queueIfBusy === true,
      subscription: doc.subscription || DEFAULT_SUBSCRIPTION,
      status: doc.status,
      resolvedAt: doc.resolvedAt?.toISOString?.() || doc.resolvedAt,
      takenByTokenLabel: doc.takenByTokenLabel || null
    };

    if (doc.feedback && doc.feedback.length > 0) {
      item.feedback = this._formatFeedbackEntries(doc.feedback);
    }

    return item;
  }

  /**
   * Formats a raw feedback array (as stored on a history doc) for API
   * response. Extracted from `_formatHistoryItem` so `_collectGroupFeedback`
   * (LIN-1461) can shape a feedback array merged from MULTIPLE docs through
   * the exact same projection, byte-identical to the single-doc case.
   *
   * @param {Array} feedback - raw feedback entries (Mongo shape)
   * @returns {Array} formatted entries: `{message, url, urlLabel, timestamp}`,
   *   plus `rootItemId` when the entry carries one (LIN-1468) and `kind`
   *   when the entry carries one (LIN-1475)
   * @private
   */
  _formatFeedbackEntries(feedback) {
    return (feedback || []).map(f => {
      const entry = {
        message: f.message,
        url: f.url || null,
        urlLabel: f.urlLabel || null,
        timestamp: f.timestamp?.toISOString?.() || f.timestamp
      };
      // Additive-only (LIN-1297 idiom): assign only when present, never emit
      // `rootItemId: null` for an entry that lacks it (LIN-1468).
      if (f.rootItemId) entry.rootItemId = f.rootItemId;
      // Additive-only (LIN-1297 idiom): assign only when present, never emit
      // `kind: null` for an entry that lacks it (LIN-1475).
      if (f.kind) entry.kind = f.kind;
      return entry;
    });
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
    return { id: root._id, kind: root.kind || 'custom', sessionId: root.sessionId || null };
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
   * @returns {Promise<{success: boolean, feedbackCount: number}|null>} Result or null if not found/unauthorized
   */
  async addFeedback(itemId, urlKey, { message, url, urlLabel, kind, rootItemId }, tokenLabel, provisionWakeCredential) {
    if (!itemId || !urlKey || !this.historyCollection) {
      return null;
    }

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
      const update = { $push: { feedback: feedbackEntry } };
      // LIN-1468: reconcile the item-doc-level anchor from tagged feedback,
      // riding the SAME atomic update (never a separate write — that would
      // reopen the LIN-1343 stale-snapshot class). Idempotent: every entry in
      // a lineage carries the same rootItemId, so a repeated $set is a no-op,
      // and a doc whose own seed diverged from producer truth self-heals on
      // its next tagged feedback write.
      if (rootItemId) update.$set = { rootItemId };
      const doc = await this.historyCollection.findOneAndUpdate(
        { _id: itemId, urlKey, status: 'taken', takenByTokenLabel: tokenLabel },
        update,
        { returnDocument: 'after' }
      );

      if (!doc) {
        // Preserves the single external contract: unknown item, wrong urlKey,
        // non-'taken' status, and wrong token all collapse to this one `null`
        // -> the existing 404 at routes/dispatch.js.
        return null;
      }

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
      // LIN-1357 observability (defense-in-depth, NOT the functional fix): track
      // why a wake event produced no wake, so a dropped/suppressed wake is
      // self-attributing in logs instead of a silent no-op — the gap that made
      // the original incident hard to diagnose. Purely additive bookkeeping;
      // never read by the control flow below.
      let nullWakeReason = null;
      if (newWake) {
        edgeDoc = await this._resolveEdgeDoc(doc, urlKey);
        const isTerminalWake = newWake.marker !== 'pending';
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
        const alreadyWokeForThisItem = (edgeDoc.terminalWakeItems || []).includes(doc._id);
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
            nullWakeReason = 'no-descriptor (no parent edge, self id===sessionId, or kind:wake structural loop guard)';
          }
          if (wakeFollowUp && isTerminalWake) markTerminalOnEdge = true;
        } else if (isSelfWakeTermination) {
          nullWakeReason = 'self-wake-termination';
        } else {
          nullWakeReason = 'already-woke-for-this-item';
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
        const parentStatus = await this.getItemStatus(urlKey, edgeDoc.sessionId);
        const { token, reason, degraded } = await provisionWakeCredential(parentStatus?.harness ?? null);
        if (reason) {
          // TRANSIENT failure: a credential was wanted, the mint was reachable and
          // attempted, and it failed anyway (threw, or returned no token). Withdraw
          // the wake — retryable, since a re-report of the same terminal re-enters
          // and provisions again — rather than burn the once-only CAS witness on a
          // wake we could not credential. Do NOT mark the CAS witness.
          wakeFollowUp = null;
          markTerminalOnEdge = false;
          nullWakeReason = reason;
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
          if (degraded) {
            console.log(`[dispatch-wake] provisioned-without-credential producingItem=${doc._id} degraded=${degraded}`);
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
      if (markTerminalOnEdge) {
        const { matchedCount } = await this.historyCollection.updateOne(
          { _id: edgeDoc._id, terminalWakeItems: { $ne: doc._id } },
          { $addToSet: { terminalWakeItems: doc._id } }
        );
        if (matchedCount !== 1) {
          wakeFollowUp = null;
          nullWakeReason = 'cas-lost-race (a concurrent duplicate terminal for this item already won)';
        }
      }
      // LIN-1357 observability (defense-in-depth, NOT the functional fix): every
      // wake-worthy feedback event now logs its outcome, enqueued or not.
      if (wakeFollowUp) {
        console.log(`[dispatch-wake] enqueued parent=${wakeFollowUp.followUpTo} producingItem=${doc._id} marker=${newWake.marker}`);
        await this.addItem(urlKey, wakeFollowUp);
      } else if (newWake) {
        console.log(`[dispatch-wake] null-wake producingItem=${doc._id} marker=${newWake.marker} reason=${nullWakeReason}`);
      }

      // Feedback (the heartbeat / [evidence] log) drives the session's runtime,
      // metrics and terminal facts — recompute its derived doc (LIN-623). Same
      // feed-relevance gate as addItem, including the LIN-1307 followUpTo
      // resolution.
      this._notifyWriteForDoc(doc, urlKey);

      return { success: true, feedbackCount: updated.length };
    } catch (err) {
      console.error('Error adding feedback:', err);
      return null;
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
    return {
      id: doc._id,
      prompt: doc.prompt,
      promptName: doc.promptName,
      kind: doc.kind || 'custom',
      issueId: doc.issueId,
      issueIdentifier: doc.issueIdentifier,
      issueTitle: doc.issueTitle,
      issueUrl: doc.issueUrl,
      workspace: {
        urlKey: doc.urlKey
      },
      dispatchedAt: doc.dispatchedAt?.toISOString?.() || doc.dispatchedAt,
      dispatchedBy: doc.dispatchedBy,
      target: doc.target || 'cli',
      repo: doc.repo || null,
      // The load-bearing forward for LIN-438: deliver the execution model so the
      // external runner can pass it to its own CLI (e.g. claude --model). Without
      // this the field is stored but undetectable on poll/take and the runner keeps
      // its default. null ⇒ consumer default (e.g. Opus). Opaque wire value.
      model: doc.model || null,
      // The load-bearing forward for LIN-1084: deliver the execution harness so
      // the external runner knows which harness (e.g. 'claude-code', 'opencode')
      // to run this prompt through. null ⇒ the runner's own default/precedence
      // chain. Opaque wire value, forwarded blindly.
      harness: doc.harness || null,
      // Frozen preset snapshot + display name (LIN-1390): present ONLY on
      // kind:'autopilot' rows carrying a selected or inherited dispatch
      // preset; null otherwise. Delivered here AND on `_formatHistoryItem` /
      // `formatDispatchWatch` (unlike bootstrapToken) — a child-autopilot
      // dispatched as a followUpTo reads this back via getItemStatus to
      // inherit it, and this is not a credential so history/echo exposure is
      // fine.
      presetConfig: doc.presetConfig || null,
      presetName: doc.presetName || null,
      // The load-bearing forward for LIN-1155: deliver the structured bootstrap
      // token on the consumer poll/take response so the claude-code harness can
      // hand it to a primed MCP tool (the token was stripped from the prompt for
      // that harness). null for every other harness. Present ONLY here — never on
      // _formatHistoryItem, _archiveItem, or formatDispatchWatch — so a live,
      // single-use credential is delivered to the taker but not persisted to the
      // 30-day history or surfaced on the widely-polled list/watch endpoints.
      bootstrapToken: doc.bootstrapToken || null,
      // The seam poll/take hand to the consumer: deliver the follow-up reference
      // so the downstream dispatcher can resume the original session. See LIN-415.
      followUpTo: doc.followUpTo || null,
      // Deliver the force-resume flag so the runner can bypass its active-session
      // guard on a follow-up. The load-bearing forward — without it item.force is
      // never visible to the runner. See LIN-559.
      force: doc.force === true,
      // Deliver the abort verb so the consumer's abort arm can cancel/close the
      // session named by abortTo. This is the load-bearing forward — without it the
      // consumer never sees the verb. See LIN-743.
      abort: doc.abort === true,
      abortTo: doc.abortTo || null,
      // Deliver the cascade modifier alongside the abort. Forwarded blindly for
      // wire completeness; today Harbour's own expansion consumes it (a later beat)
      // and emits plain aborts, so the runner never branches on it. See LIN-946.
      cascade: doc.cascade === true,
      // Deliver the autopilot session reference so the consumer can forward it
      // (e.g. the autopilot stamps it onto subsequent worker dispatches). See LIN-591.
      sessionId: doc.sessionId || null,
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
      // Opt-in completion hold the runner reads to decide whether to hold the
      // session open for in-session follow-ups. Default false. See LIN-795/LIN-797.
      waitForFollowUps: doc.waitForFollowUps === true,
      // Push-based inter-session comms (LIN-826), forwarded blindly. queueIfBusy:
      // the runner leaves a busy-target follow-up unclaimed rather than failing it
      // (LIN-827). subscription: edge declaration (LIN-900 §6) that governs which of
      // this child's events wake its parent — Harbour reads it when building the
      // wake follow-up; undeclared → 'terminal-only'.
      queueIfBusy: doc.queueIfBusy === true,
      subscription: doc.subscription || DEFAULT_SUBSCRIPTION,
      expiresAt: doc.expiresAt?.toISOString?.() || doc.expiresAt
    };
  }
}
