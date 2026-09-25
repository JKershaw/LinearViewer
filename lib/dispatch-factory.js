/**
 * Shared dispatch-item creation factory (LIN-1139).
 *
 * Every external dispatch entry point — the two main handlers, the four proxy
 * server-generated paths, the two feedback follow-ups, the collective fan-out,
 * and the chat-tools follow-up — used to hand-roll the SAME sequence: resolve
 * the prompt kind, fill blank model/harness from the workspace's dispatch
 * defaults, interpose the default harness, build the item field set, and call
 * `dispatchQueueStore.addItem`. Nine copies drifted (LIN-1159's claude-code
 * interpose reached only four of them; feedback/session/collective did not). This
 * factory is the ONE seam that owns that resolution, so adding a new dispatch
 * path is a single call and no path can silently diverge on inheritance again.
 *
 * It deliberately owns only RESOLUTION + construction, never prompt authoring or
 * auth plumbing. The ordering invariant the proxy-context paths depend on —
 * harness resolved BEFORE the prompt is finalized (because `attachProxyContext`
 * gates its MCP-token-vs-prose branch on the resolved harness), and the prompt
 * finalized BEFORE `addItem` — is preserved through the `finalizePrompt(harness)`
 * callback: the factory resolves the harness, hands it to the caller's
 * `finalizePrompt`, and stores back the returned `{ prompt, bootstrapToken }`.
 * Prompt construction + bootstrap minting therefore stay OUTSIDE the factory
 * (per the parent LIN-1135 constraint) while resolution stays INSIDE it.
 *
 * Because it is the one convergence point for every external creation surface, it
 * is also where the duplicate-dispatch guard lives (LIN-1656) — see step 1.5. That
 * is a refusal, not prompt authoring or auth plumbing, and it is placed ahead of
 * every side effect (notably the bootstrap-credential mint inside `finalizePrompt`)
 * so a refused dispatch leaves nothing behind.
 *
 * NOT for the store-internal `addItem` uses (cascade abort expansion, wake
 * follow-ups): those are below this layer and emit minimal, model/harness-free
 * items by design — routing them through a factory that itself calls the store
 * would invert the dependency.
 */

import { deriveDispatchKind } from './prompt-templates.js';
import { resolveDispatchDefaults, resolveRoutingFromConfig } from './workspace-preferences.js';
import { applyDefaultDispatchHarness } from './proxy-preamble.js';
import { validateOpaqueDispatchField } from './dispatch-validation.js';
import { createTaskDoneCache } from './task-done-cache.js';
import { TERMINAL_TYPES } from './providers/models.js';
import { getConsumerLastSeenAt } from './consumer-poll-warning.js';

/**
 * Recency window for the duplicate-dispatch guard (LIN-1656).
 *
 * Chosen from measurement, not taste: the observed orchestrator collisions are
 * 2m17s–8.8m apart, so a 2-minute window misses the clearest ones outright, while
 * 10 minutes triples the false refusals to catch one more. Five minutes is also
 * ~6× clear of the "when in doubt, dispatch fresh" policy trigger (~30 min of
 * silence), which is why no policy text moves for this guard.
 *
 * Deliberately marked for revisit with live data rather than opinion.
 */
export const DUPLICATE_DISPATCH_WINDOW_MS = 5 * 60 * 1000;

/** Programmatic discriminator on the 409 refusal body (LIN-1656). */
export const DUPLICATE_DISPATCH_CODE = 'DUPLICATE_DISPATCH';

/** Programmatic discriminator on the 409 refusal body (LIN-1751). */
export const BUDGET_EXHAUSTED_CODE = 'BUDGET_EXHAUSTED';

/** Programmatic discriminator on the 409 refusal body (LIN-2775 Area 8). */
export const ANCHOR_TERMINAL_CODE = 'ANCHOR_TERMINAL';

/**
 * A SEPARATE cache instance from the Observation sessions feed's own
 * (`routes/dashboard.js`'s `taskDoneCache` default param) — widening that
 * one in place would silently re-point its `done-with-warning` derivation
 * onto an unrelated read path. Module-level singleton (not a per-call
 * default parameter, which would evaluate — and so recreate the cache —
 * on every single `createDispatchItem` call, defeating the whole point of
 * caching across calls): every dispatch attempt across the server's
 * lifetime shares this ONE 60s-TTL cache, bounding the guard below to at
 * most one provider read per anchor per 60s regardless of how many
 * composed-run attempts land in that window.
 *
 * The 60s TTL is kept, but justified FRESHLY here: the bounded
 * one-read-per-dispatch-attempt cost this guard actually has — never the
 * original "`done` is sticky" rationale `routes/dashboard.js`'s own cache
 * was built on, which is specific to `completed` (a task, once Done, stays
 * Done). This guard also refuses `canceled` and `duplicate`, and a
 * `canceled` issue CAN be reopened — a state this cache would then serve
 * stale-terminal for up to 60s. That is an accepted, bounded cost (a
 * dispatch a human can simply retry a minute later), not a correctness
 * claim that `canceled`/`duplicate` are sticky the way `completed` is.
 */
const dispatchGuardTaskDoneCache = createTaskDoneCache();

/**
 * Resolve + build a dispatch item and enqueue it via the store.
 *
 * @param {Object} params
 * @param {Object} params.store - The dispatch queue store (must expose `addItem`).
 * @param {string} params.urlKey - Workspace url key the item is scoped to.
 * @param {Object} [params.workspacePreferencesStore] - Workspace preferences store;
 *   when present, blank `model`/`harness` are filled from `dispatchDefaults`
 *   (per-kind override → workspace-wide → null). Absent → no inheritance (the
 *   pre-LIN-1094 null passthrough).
 * @param {Object} [params.dispatchPresetsStore] - Dispatch presets store (LIN-1390);
 *   when present with `presetId`, the selected preset's `config` is resolved
 *   (byKind → top-level → null, via `resolveRoutingFromConfig`) and takes
 *   precedence over both inherited-anchor and workspace-default routing.
 * @param {string} [params.presetId] - Selected preset id. Unknown/invalid ids
 *   (the route layer validates and rejects these before calling in) resolve to
 *   "no preset" here rather than throwing.
 * @param {string} [params.kind] - Explicit prompt kind; when omitted it is
 *   derived from `fields.promptName` (falling back to the store's 'custom').
 * @param {string} [params.model] - Incoming execution model (may be blank/absent).
 * @param {string} [params.harness] - Incoming execution harness (may be blank/absent).
 * @param {string} [params.terminal] - Incoming terminal-emulator driver name
 *   (LIN-2452; may be blank/absent). Pure payload passthrough: unlike
 *   model/harness it has NO precedence chain here — no preset, workspace
 *   default, anchor inheritance or interposed default. The runner owns the
 *   driver registry, validation and defaulting; blank/absent ⇒ null.
 * @param {boolean} [params.applyDefaultHarness=true] - Interpose `claude-code`
 *   (LIN-1159) when the resolved harness is still blank. The opt-out exists so a
 *   caller can be exempted from the default without forking the field-build path,
 *   but the parent's convergence goal (LIN-1135) is uniform application.
 * @param {string} [params.prompt] - Base prompt for paths that don't finalize
 *   (collective, chat-tools). Ignored when `finalizePrompt` is supplied.
 * @param {(harness: string|null) => (Promise<{prompt: string, bootstrapToken?: string|null}>|{prompt: string, bootstrapToken?: string|null})} [params.finalizePrompt]
 *   Called with the RESOLVED harness to produce the final prompt (and, for the
 *   claude-code MCP branch, a `bootstrapToken` to carry as a structured field).
 *   This is where `attachProxyContext` runs, preserving the harness→append→addItem
 *   ordering centrally.
 * @param {Object} [params.fields] - The remaining item fields (issue*, target,
 *   dispatchedBy, repo, force, abort*, cascade, sessionId, waitForFollowUps,
 *   queueIfBusy, subscription, followUpTo, promptName). The store null-coerces
 *   every optional field, so passing the union of what any caller needs is safe.
 * @param {(() => number)|number|Date} [params.now=Date.now] - Clock injection for the
 *   duplicate-dispatch guard's window (LIN-1656), mirroring `createDedupeCache`'s
 *   `now` in lib/proxy-dedupe.js. A function, an epoch-ms number, or a Date.
 * @returns {Promise<Object>} The created dispatch item (from `store.addItem`).
 * @throws {Error} With `err.duplicateDispatch` + `err.status = 409` when a fresh
 *   dispatch for the same workspace + issue + resolved kind was created inside
 *   `DUPLICATE_DISPATCH_WINDOW_MS`. Thrown BEFORE any side effect (see step 1.5).
 *   `fields.force === true` bypasses the guard entirely (operator escape hatch).
 * @throws {Error} With `err.budgetExhausted` + `err.status = 409` (LIN-1751) when
 *   `fields.sessionId` names a run declaring `maxTasks` and this dispatch would be
 *   a NEW distinct task past that bound. Thrown BEFORE any side effect (see step
 *   1.6). Unlike the duplicate guard, `fields.force === true` does NOT bypass
 *   this — a budget any caller can wave through is advisory, not a bound.
 * @param {string} [params.composedRunMarker] - LIN-2775 Area 8: the SCOPED structural
 *   marker for a composed-run dispatch (a ruling reply's real agent brief, never a
 *   raw pressed-option label). Opaque, validated the SAME way as model/harness/
 *   terminal (`validateOpaqueDispatchField`, no registry check) — but validated and
 *   consumed HERE, not at any route layer, so this stays the one reusable, testable
 *   chokepoint. Presence (not any particular value) activates the terminal-anchor
 *   guard below; blank/absent ⇒ the guard never runs — every one of this factory's
 *   OTHER call sites never sets this field and is completely unaffected, `kind` or
 *   no `kind`. Deliberately NOT named `terminal` — that name already carries an
 *   unrelated opaque field (LIN-2452, the runner's terminal-emulator driver name).
 * @param {Function} [params.getWorkspaceAccessToken] - (urlKey) => Promise<string|null>.
 *   Required, alongside `fetchIssueContext`, for the terminal-anchor guard to run
 *   at all — absent either one, the guard is SKIPPED (fail-open on a structural
 *   capability gap, mirroring the duplicate/budget guards' own documented
 *   invariant), never evaluated as "cannot verify, refuse anyway". Unused unless
 *   `composedRunMarker` is set.
 * @param {Function} [params.fetchIssueContext] - (token, identifier) => Promise<{issue}>.
 *   See `getWorkspaceAccessToken` above.
 * @param {Object} [params.guardTaskDoneCache] - Override for the terminal-anchor
 *   guard's own cache instance (`createTaskDoneCache()` shape: `{peek, get, clear}`).
 *   Test-injection seam only — production callers never pass this; it defaults to
 *   this module's own persistent singleton (LIN-2775 Area 8), a SEPARATE instance
 *   from the Observation sessions feed's (`routes/dashboard.js`).
 * @param {Object} [params.dispatchTokenStore] - Consumer-token store (must expose
 *   `listTokens(urlKey)`), used ONLY to stamp `consumerLastSeenAt` (LIN-2885) — the
 *   most recent poll/take across the workspace's consumer tokens, or null when
 *   none has ever polled. Read-only telemetry, never a refusal; absent store
 *   SKIPS the stamp (stays null), mirroring the other capability-gated guards
 *   above.
 */
export async function createDispatchItem({
  store,
  urlKey,
  workspacePreferencesStore = null,
  dispatchPresetsStore = null,
  presetId = null,
  kind = undefined,
  model,
  harness,
  terminal,
  effort,
  applyDefaultHarness = true,
  prompt,
  finalizePrompt = null,
  fields = {},
  now = Date.now,
  composedRunMarker,
  getWorkspaceAccessToken,
  fetchIssueContext,
  guardTaskDoneCache = dispatchGuardTaskDoneCache,
  dispatchTokenStore = null
} = {}) {
  if (!store || typeof store.addItem !== 'function') {
    throw new Error('createDispatchItem requires a dispatch store with addItem');
  }
  if (!urlKey) {
    throw new Error('createDispatchItem requires a urlKey');
  }

  // 1. Resolve the effective kind — used both to key dispatchDefaults/preset
  //    resolution and as the stored `kind`, so both agree (mirroring the two
  //    main handlers).
  const effectiveKind = kind || deriveDispatchKind(fields.promptName);

  // 1.5. Duplicate-dispatch guard (LIN-1656). Two independent orchestrators — the
  //    autopilot loop and a human/companion driving the board — can each dispatch
  //    the same issue+kind minutes apart, because nothing on this path ever
  //    checked whether a live dispatch already existed. Refuse a FRESH dispatch
  //    when an equivalent one was created inside the recency window.
  //
  //    PLACEMENT IS LOAD-BEARING. This is the earliest line at which the whole
  //    input set exists (`store`/`urlKey` validated just above, `effectiveKind`
  //    resolved, the caller's raw `fields` in hand), and — decisively — it is
  //    before `finalizePrompt` (step 7), which mints the single-use bootstrap
  //    credential. Guarding down at `store.addItem` would mint and then orphan a
  //    credential nobody can exchange on every refusal. Refuse before any side
  //    effect. Nothing reorders: the guard and the step-2 anchor lookup are
  //    mutually exclusive by construction (the guard runs only when `followUpTo`
  //    is null; the anchor is read only when it is set).
  //
  //    KEYED ON THE RESOLVED KIND, never the caller's raw `kind`: the stored row
  //    carries `kind: effectiveKind`, and most surfaces pass no `kind` at all
  //    (the board route and POST /api/proxy/dispatch derive it from promptName).
  //    Keying on the argument would compare `undefined` against a stored
  //    'implementation' and miss the majority of duplicates — and it is exactly
  //    the real case, two orchestrators writing different promptName prose that
  //    derives to one kind.
  //
  //    The entry gate is as permissive as the predicate, deliberately. A
  //    `followUpTo` row IS the intended second dispatch (beat drips, wakes); an
  //    `abort` row is emitted one-per-descendant by a cascade in the same second;
  //    an issue-less row (collective fan-out, stack-walk kickoff) has nothing to
  //    key on. The asymmetry that governs every judgement call here: wrong in the
  //    permissive direction this guard merely does nothing, wrong in the
  //    restrictive direction it silently blocks legitimate work — which is the
  //    failure the measured 9.0% false-refusal rate of the `status: taken` shape
  //    got that shape rejected for.
  //
  //    Capability-gated exactly as step 2 gates `getItemStatus`: this seam has
  //    never hard-required a read capability, so a store without the method
  //    SKIPS the guard and dispatches. That fail-open is intent, not accident —
  //    failing closed would turn a store-shape mismatch into a total dispatch
  //    outage.
  //
  //    `force: true` is the OPERATOR ESCAPE HATCH (LIN-1656 review, owner
  //    condition 2). It belongs in the GATE, not the predicate, so it inherits
  //    the same property the other gate negatives assert: a forced dispatch
  //    never even consults the lookup. Rationale: the recovery playbook that has
  //    been doing the actual saving is deliberate re-dispatch, and a guard whose
  //    only failure mode is silently refusing legitimate work must have a way
  //    out that does not require waiting for a window to clear. Deliberately NOT
  //    advertised to the autopilot kickoff prompt — an orchestrator that learns
  //    `force` beats the guard reaches for it reflexively and the guard becomes
  //    advisory. This is for a human recovering a wedge.
  const guardApplies = fields.followUpTo == null
    && fields.abort !== true
    && fields.force !== true
    && !!fields.issueIdentifier
    && typeof store.findRecentFreshDispatch === 'function';

  if (guardApplies) {
    const nowMs = typeof now === 'function' ? now() : new Date(now).getTime();
    // The CALL is inside the `.then`, not an argument to `Promise.resolve`
    // (LIN-1656 review, finding 1). `Promise.resolve(store.find…())` evaluates
    // the call BEFORE the wrapper exists, so a store whose lookup throws
    // SYNCHRONOUSLY escapes the `.catch` and takes the whole dispatch down —
    // failing closed on exactly the path the fail-open is documented to protect.
    // Unreachable with the in-repo async store, but the fail-open is a published
    // invariant other stores will be written against, so both shapes must hold.
    const existing = await Promise.resolve().then(() => store.findRecentFreshDispatch(urlKey, {
      issueIdentifier: fields.issueIdentifier,
      kind: effectiveKind,
      since: new Date(nowMs - DUPLICATE_DISPATCH_WINDOW_MS)
    })).catch(() => null);

    // A prior whose `dispatchedAt` can't be read as a real instant can't be
    // window-checked, so it does not refuse — permissive, per the asymmetry above.
    // (The store hands back a real Date; this tolerates any other store shape
    // rather than turning a surprise into a 500 on the creation path.)
    const priorDispatchedAt = existing
      ? (existing.dispatchedAt instanceof Date ? existing.dispatchedAt : new Date(existing.dispatchedAt))
      : null;

    if (existing && priorDispatchedAt && !Number.isNaN(priorDispatchedAt.getTime())) {
      // Seconds until the window clears, so the caller is told WHEN rather than
      // just no. Clamped into (0, window] — a clock skew that puts the prior
      // dispatch in the future must not produce an absurd or negative wait.
      const clearsAt = priorDispatchedAt.getTime() + DUPLICATE_DISPATCH_WINDOW_MS;
      const retryAfter = Math.min(
        Math.ceil(DUPLICATE_DISPATCH_WINDOW_MS / 1000),
        Math.max(1, Math.ceil((clearsAt - nowMs) / 1000))
      );

      // Tagged throw, following the `err.proxyAttachFailed` precedent: each
      // creation route maps the tag to its own 409 response. `err.status` is a
      // BACKSTOP, not the mechanism — the catch-all middleware honours a 4xx on a
      // thrown error, so a future creation surface that forgets its branch
      // degrades to a correct 409 rather than a misleading 500 (it carries only
      // the status; the flattened body loses `code`/`id`).
      const err = new Error('A dispatch for this issue and kind was created moments ago');
      err.duplicateDispatch = {
        code: DUPLICATE_DISPATCH_CODE,
        id: existing.id,
        issueIdentifier: fields.issueIdentifier,
        kind: effectiveKind,
        dispatchedAt: priorDispatchedAt.toISOString(),
        retryAfter
      };
      err.status = 409;
      throw err;
    }
  }

  // 1.6. Task-budget guard (LIN-1751). A kickoff can declare `maxTasks` — a scope
  //    bound on how many DISTINCT tasks the run may take on — enforced HERE, at
  //    the same seam and for the same reason as the duplicate guard just above:
  //    before `finalizePrompt` (step 7) mints the bootstrap credential, so a
  //    refusal leaves nothing behind. Independent of and sequenced AFTER the
  //    duplicate guard: different codes, different bodies, different orchestrator-
  //    facing meanings — never merged into one conditional.
  //
  //    GATE, deliberately narrower than the duplicate guard's: `force` is NOT in
  //    it. `force: true` is a human rescue hatch for a guard whose only failure
  //    mode is wrongly blocking legitimate work (LIN-1656) — a budget any caller
  //    can wave through with `force` is advisory, not a bound, so a forced
  //    dispatch is still evaluated here and can still be refused.
  //
  //    Capability-gated exactly like the duplicate guard's own documented
  //    invariant above: a store without `countDistinctTasksForSession` SKIPS the
  //    guard. Fail-open is intent, not accident — the method's absence is a
  //    store-shape mismatch, not a signal about any run's budget, and failing
  //    closed on it would turn that mismatch into a total dispatch outage the
  //    instant any run declares a budget.
  const budgetGuardApplies = fields.followUpTo == null
    && fields.abort !== true
    && !!fields.issueIdentifier
    && typeof store.countDistinctTasksForSession === 'function';

  // Non-persisted budget-position snapshot (LIN-2934): set below when a
  // budget is declared and the dispatch is admitted, then attached directly
  // to the item `store.addItem` returns (never passed INTO `addItem` — this
  // is read-time-computed-at-admission, not a stored field).
  let budgetPosition = null;

  if (budgetGuardApplies && fields.sessionId) {
    // No `sessionId` on the incoming dispatch ⇒ it can't be tied to any run row,
    // so it is ADMITTED — same "can't resolve a budget ⇒ skip" path an unreadable
    // run row takes below, by construction rather than a special case. `sessionId`
    // is a cooperating-orchestrator convention (optional, caller-supplied,
    // format-validated only — see `validateSessionId`), never a hostile-caller
    // control, so this bound only holds for a run that follows the kickoff
    // prose's instruction to stamp `sessionId` on every worker dispatch.
    //
    // A NEW anchor read, keyed on `fields.sessionId` — distinct from step 2's
    // anchor below (keyed on `fields.followUpTo`). The two never contend: both
    // guards above only run when `followUpTo` is null, so this branch and step
    // 2's anchor read are mutually exclusive by construction.
    const run = typeof store.getItemStatus === 'function'
      ? await Promise.resolve(store.getItemStatus(urlKey, fields.sessionId)).catch(() => null)
      : null;
    const maxTasks = run?.maxTasks;
    // Sibling per-task bound (LIN-2934): caps fresh worker-session dispatches
    // for THIS candidate's issueIdentifier, checked at the same seam right
    // after the maxTasks check below.
    const maxSessionsPerTask = run?.maxSessionsPerTask;

    // `hasBudget` is false only when NEITHER bound is declared ⇒ skip entirely
    // — zero extra reads beyond the one above, zero behavior change. This is
    // what makes "a kickoff without either bound behaves exactly as today"
    // true on cost, not just semantics. A budget that was never confirmed to
    // exist can't be enforced.
    const hasMaxTasks = typeof maxTasks === 'number' && maxTasks >= 1;
    const hasMaxSessionsPerTask = typeof maxSessionsPerTask === 'number' && maxSessionsPerTask >= 1;
    const hasBudget = hasMaxTasks || hasMaxSessionsPerTask;

    if (hasBudget) {
      const result = await store.countDistinctTasksForSession(urlKey, fields.sessionId, fields.issueIdentifier).catch(() => null);

      // A REAL read error — the capability exists and a budget IS declared —
      // fails CLOSED, inverted from the duplicate guard's fail-open: a budget
      // that silently admits extra work on every count failure is useless.
      //
      // N3: the fail-closed body must carry a `bound` value so the refusal
      // note template (`${refusal.bound}`, routes/proxy.js) never interpolates
      // `undefined`. Name the single declared bound when only one is set, and
      // the distinct value 'unverified' when both are — the read failed
      // before either could be evaluated, so naming one specific bound would
      // misattribute which one "fired". Also include `maxSessionsPerTask`
      // whenever it's declared, so a run declaring only that bound doesn't
      // fail closed with a body that mentions only `maxTasks: null`.
      if (result === null) {
        const err = new Error('Could not verify the task budget for this run');
        const bound = hasMaxTasks && hasMaxSessionsPerTask
          ? 'unverified'
          : (hasMaxSessionsPerTask ? 'sessionsPerTask' : 'tasks');
        err.budgetExhausted = {
          code: BUDGET_EXHAUSTED_CODE,
          bound,
          count: null,
          maxTasks: maxTasks ?? null,
          sessionId: fields.sessionId
        };
        if (hasMaxSessionsPerTask) {
          err.budgetExhausted.maxSessionsPerTask = maxSessionsPerTask;
        }
        err.status = 409;
        throw err;
      }

      // A dispatch for a task ALREADY inside the budget (`alreadyCounted`) is
      // always admitted, regardless of count — this is what keeps a task's
      // review/close-out from being stranded half-done once the budget is
      // reached (the ticket's own "wind down in-flight work" requirement).
      // Only a dispatch that would grow the distinct-task count past `maxTasks`
      // — a genuinely NEW task — is refused.
      if (hasMaxTasks && !result.alreadyCounted && result.count >= maxTasks) {
        const err = new Error(`This run's task budget (${maxTasks}) has been reached`);
        err.budgetExhausted = {
          code: BUDGET_EXHAUSTED_CODE,
          bound: 'tasks',
          count: result.count,
          maxTasks,
          sessionId: fields.sessionId
        };
        err.status = 409;
        throw err;
      }

      // Sibling per-task bound (LIN-2934): unlike `maxTasks`, this counts
      // DISPATCHES to the candidate task, not distinct tasks — there is no
      // `alreadyCounted`-style exemption, since every admitted dispatch to
      // this task (first or fourth) is exactly what the bound caps.
      if (hasMaxSessionsPerTask && result.taskDispatches >= maxSessionsPerTask) {
        const err = new Error(`This task's session budget (${maxSessionsPerTask}) has been reached`);
        err.budgetExhausted = {
          code: BUDGET_EXHAUSTED_CODE,
          bound: 'sessionsPerTask',
          taskDispatches: result.taskDispatches,
          maxSessionsPerTask,
          sessionId: fields.sessionId
        };
        err.status = 409;
        throw err;
      }

      // Non-persisted budget position (N2): attached directly to the
      // returned `item` below (never passed to `store.addItem`), so the 201
      // response can echo "n of N" without a second stored snapshot. `tasks`
      // keeps the `alreadyCounted` gate — `count` is a distinct-task count
      // that only advances for a genuinely new task. `sessionsPerTask` does
      // NOT gate on it — `taskDispatches` is always the fresh-row count
      // BEFORE this candidate, and an admitted dispatch always adds exactly
      // one row to its own task, whether or not that task was already
      // counted toward `maxTasks`.
      budgetPosition = {
        tasks: hasMaxTasks
          ? { count: result.alreadyCounted ? result.count : result.count + 1, maxTasks }
          : null,
        sessionsPerTask: hasMaxSessionsPerTask
          ? { count: result.taskDispatches + 1, maxSessionsPerTask }
          : null
      };
    }
  }

  // 1.7. Terminal-anchor guard (LIN-2775 Area 8) — SCOPED to a composed-run
  //    dispatch specifically, gated on the explicit `composedRunMarker`, never
  //    on `kind`. An unconditional Done/Canceled refusal on every dispatch
  //    would silently break `retrospective-audit` and `retro`
  //    (lib/prompt-template-defs.js) — both DESIGNED to target already-
  //    merged/closed work ("Start from the fact that this is already
  //    merged") — and `periodical` is issueless by construction and would
  //    never trip it anyway. Neither sets this marker, so neither is
  //    affected regardless of the anchor's state.
  //
  //    Sequenced with the SAME "refuse before any side effect" placement as
  //    the guards above — before step 7's finalizePrompt, which mints the
  //    single-use bootstrap credential a refusal must not orphan.
  //
  //    Capability-gated like the duplicate/budget guards: `composedRunMarker`
  //    truthy but either read dependency (`getWorkspaceAccessToken`/
  //    `fetchIssueContext`) missing SKIPS the guard — a structural wiring
  //    gap, not a signal about this dispatch's own anchor, and every
  //    call site that actually sets the marker (today: only
  //    routes/dispatch.js's composed-run path) always wires both.
  //
  //    Once BOTH the marker and the capability are present, though, this
  //    departs from the duplicate guard's fail-open-on-read-failure stance
  //    and instead mirrors the BUDGET guard's: a REAL read failure (bad/no
  //    token, provider error, unreadable issue) fails CLOSED — refuses —
  //    rather than silently admitting an unverified dispatch. A marker-
  //    gated safety check that proceeds anyway when it cannot verify its own
  //    condition is exactly as useless as the budget guard's own "count
  //    failure" case, and this IS the one path in this whole factory that
  //    triggers an irreversible external action.
  if (composedRunMarker != null) {
    const markerError = validateOpaqueDispatchField(composedRunMarker, 'composedRunMarker', { maxLength: 200 });
    if (markerError) {
      // Tagged, same convention as anchorTerminalRefusal below — a route
      // relays THIS property, never re-constructs the body from a generic
      // `err.status` check (beat 5 correction: a status-only check would
      // have quietly swallowed a future, unrelated 400 from elsewhere in
      // this factory into the same relay branch).
      const err = new Error(markerError.error);
      err.composedRunMarkerInvalid = { field: 'composedRunMarker' };
      err.status = 400;
      throw err;
    }

    const guardCapable = fields.issueIdentifier
      && typeof getWorkspaceAccessToken === 'function'
      && typeof fetchIssueContext === 'function';

    if (guardCapable) {
      const cacheKey = `${urlKey}::${fields.issueIdentifier}`;
      let anchorState = null;
      let verifyFailed = false;
      try {
        anchorState = await guardTaskDoneCache.get(cacheKey, async () => {
          const token = await getWorkspaceAccessToken(urlKey);
          if (!token) throw new Error('no workspace access token');
          const context = await fetchIssueContext(token, fields.issueIdentifier);
          const issue = context?.issue || context || {};
          // Cache stores a BOOLEAN (createTaskDoneCache's own contract) — the
          // producer predicate itself, imported and never re-listed, so
          // `duplicate` is refused alongside `completed`/`canceled` exactly
          // as TERMINAL_TYPES defines it, with no second local copy to drift.
          return !!(issue.state && TERMINAL_TYPES.includes(issue.state.type));
        });
      } catch {
        // A throwing producer propagates uncached (createTaskDoneCache's own
        // contract) — a transient failure is naturally retried on the NEXT
        // attempt, never pinned as terminal for the rest of the TTL window.
        verifyFailed = true;
      }

      if (anchorState === true || verifyFailed) {
        const err = new Error(
          verifyFailed
            ? 'Could not verify the anchor issue is not terminal — refusing this composed-run dispatch'
            : 'The anchor issue is terminal — refusing this composed-run dispatch'
        );
        err.anchorTerminalRefusal = {
          code: ANCHOR_TERMINAL_CODE,
          issueIdentifier: fields.issueIdentifier,
          verified: !verifyFailed
        };
        err.status = 409;
        throw err;
      }
    }
  }

  // 2. Look up the anchor ONCE — used below for BOTH issue-identity inheritance
  //    (LIN-1292) and preset-config inheritance (LIN-1390). `getItemStatus`
  //    resolves across the active queue AND history (`_formatItem` /
  //    `_formatHistoryItem`), which matters here: by the time a descendant
  //    dispatches, the kickoff anchor has usually already been taken and
  //    archived, so a read that only checked the active queue would silently
  //    miss the anchor's `presetConfig` on every real run.
  const anchor = (fields.followUpTo && typeof store.getItemStatus === 'function')
    ? await Promise.resolve(store.getItemStatus(urlKey, fields.followUpTo)).catch(() => null)
    : null;

  // 3. Resolve the selected preset (LIN-1390 S1/S3). An unknown/invalid
  //    `presetId` (the route layer validates and rejects these before calling
  //    in) resolves to "no preset" here rather than throwing, so this seam
  //    degrades gracefully if it's ever reached with a stale id.
  const selectedPreset = (dispatchPresetsStore && presetId)
    ? await dispatchPresetsStore.get(urlKey, presetId).catch(() => null)
    : null;

  // 4. Resolve model/harness with the unified per-field precedence (LIN-1390):
  //    explicit incoming > selected preset (byKind) > inherited anchor
  //    presetConfig (byKind) > workspace dispatchDefaults (byKind → workspace-
  //    wide) > null. Each source's byKind/top-level blend is handled by
  //    `resolveRoutingFromConfig`; sources are combined field-by-field so e.g.
  //    a preset with only `model` set still lets harness fall through to the
  //    next source. Anchor inheritance is gated on an EXPLICIT preset marker
  //    (`anchor.presetConfig` truthy) — no marker means byte-identical to
  //    pre-LIN-1390 behavior.
  //    LIN-1694: the two fields are no longer INDEPENDENT chains. Resolution runs in two passes over
  //    the same source order — harness first, then model, where a source row scoped to a harness
  //    other than the one now in force is skipped rather than allowed to donate its model. The bug
  //    this closes: an explicit `harness: 'claude-code'` short-circuited the harness chain while
  //    `model` kept falling through to the workspace's `opencode` row, resolving the crossed pair
  //    claude-code + `deepseek/deepseek-v4-pro` that SD then launched as
  //    `claude --model deepseek-v4-pro`. Eligibility deliberately uses the PRE-interpose harness —
  //    `applyDefaultDispatchHarness` in step 5 is a post-resolution default, and letting it decide
  //    eligibility would make a blank harness look like an explicit `claude-code` and wrongly
  //    disqualify a workspace's opencode row.
  let resolvedModel = model || null;
  let resolvedHarness = harness || null;
  // Effort (LIN-2615) mirrors MODEL's shape (chain + row-atomic harness
  // scoping), not harness's — there is deliberately no `anchor.effort` tier
  // (harness alone gets step 4.5 below). Resolved in its own pass 3, after
  // harness/model but still before the workspace-tier gate at :412 below.
  let resolvedEffort = effort || null;

  // Pass 1 — harness, across the full chain, in the unchanged precedence order.
  if (!resolvedHarness && selectedPreset) {
    resolvedHarness = resolveRoutingFromConfig(selectedPreset.config, effectiveKind).harness;
  }
  if (!resolvedHarness && anchor?.presetConfig) {
    resolvedHarness = resolveRoutingFromConfig(anchor.presetConfig, effectiveKind).harness;
  }

  // 4.5. Inherit the anchor's own resolved harness (LIN-1431 S3) — a follow-up
  //   must run on the harness of the session it resumes, not re-resolve
  //   independently. Below explicit/preset/anchor.presetConfig (all of which
  //   still win); above workspace dispatchDefaults, since a workspace default
  //   outranking the anchor is exactly the bug (a resume silently landing on a
  //   different runner). `anchor.harness` is `doc.harness || null`, so a
  //   blank-harness anchor inherits `null` — indistinguishable from not
  //   inheriting at all, which keeps the LIN-1111 blank-harness escape hatch
  //   intact all the way through the `applyDefaultHarness` interpose below.
  if (!resolvedHarness && anchor?.harness) resolvedHarness = anchor.harness;

  // Pass 2 — model, over the SAME sources, now that the harness in force is known. Each
  // `resolveRoutingFromConfig` call re-runs on the same in-memory config (pure and cheap); only the
  // workspace read below touches the store, and it still happens at most once.
  if (!resolvedModel && selectedPreset) {
    resolvedModel = resolveRoutingFromConfig(
      selectedPreset.config, effectiveKind, { harnessInForce: resolvedHarness }
    ).model;
  }
  if (!resolvedModel && anchor?.presetConfig) {
    resolvedModel = resolveRoutingFromConfig(
      anchor.presetConfig, effectiveKind, { harnessInForce: resolvedHarness }
    ).model;
  }

  // Pass 3 — effort (LIN-2615), over the SAME sources and the SAME
  // `harnessInForce`/row-atomic eligibility as the model pass above. Must be
  // interleaved HERE — before the workspace-tier gate below — not appended
  // after it: `resolvedEffort` needs to already reflect explicit/preset/anchor
  // sources by the time the gate below decides whether it still needs to read
  // the workspace tier (plan-review correction C5). No anchor.effort tier
  // (mirrors model, not harness's extra step 4.5).
  if (!resolvedEffort && selectedPreset) {
    resolvedEffort = resolveRoutingFromConfig(
      selectedPreset.config, effectiveKind, { harnessInForce: resolvedHarness }
    ).effort;
  }
  if (!resolvedEffort && anchor?.presetConfig) {
    resolvedEffort = resolveRoutingFromConfig(
      anchor.presetConfig, effectiveKind, { harnessInForce: resolvedHarness }
    ).effort;
  }

  if ((!resolvedModel || !resolvedHarness || !resolvedEffort) && workspacePreferencesStore) {
    // One read serves all three fields (LIN-2615 widened this from two). When `resolvedHarness` is
    // still null, `harnessInForce` is null too — the eligibility check is off, so this read's
    // `model`/`harness`/`effort` can still come from different rows of the same config (`byKind` vs.
    // top-level; LIN-1694 review F2), not necessarily one self-consistent row. When a harness is
    // already in force, that row must clear eligibility to donate a model or an effort.
    const defaults = await resolveDispatchDefaults({
      urlKey,
      kind: effectiveKind,
      store: workspacePreferencesStore,
      harnessInForce: resolvedHarness
    });
    if (!resolvedModel) resolvedModel = defaults.model;
    if (!resolvedHarness) resolvedHarness = defaults.harness;
    if (!resolvedEffort) resolvedEffort = defaults.effort;
  }

  // 5. Interpose the default harness (LIN-1159) unless the caller opts out.
  if (applyDefaultHarness) {
    resolvedHarness = applyDefaultDispatchHarness(resolvedHarness);
  }

  // 5.5. Inherit the anchor's issue identity for a follow-up that didn't supply
  //    its own (LIN-1292). The human reply-box producer (public/session.js) posts
  //    only { prompt, followUpTo, target } — no issue* fields — and BOTH session
  //    reconstruction paths (`_buildLoops`'s malformed-row guard and the
  //    `_buildSessions` followUpTo stitch pass) need a real `issueIdentifier` to
  //    build a loop at all; an issue-less follow-up is dropped everywhere as
  //    malformed, not merely left unstitched. Inheriting here — the one seam every
  //    followUpTo dispatch path already resolves through — keeps the reply visible
  //    without a producer change (a ticket constraint: the render stitch must work
  //    with the existing public/session.js behavior).
  let inheritedIssueFields = null;
  if (fields.followUpTo && !fields.issueIdentifier && anchor?.issueIdentifier) {
    inheritedIssueFields = {
      issueId: fields.issueId || anchor.issueId || null,
      issueIdentifier: anchor.issueIdentifier,
      issueTitle: fields.issueTitle || anchor.issueTitle || null,
      issueUrl: fields.issueUrl || anchor.issueUrl || null
    };
  }

  // 5.6. Inherit the anchor's durable session-group id (LIN-1341), riding the
  //   SAME anchor lookup from step 2 — no second round-trip. Precedence mirrors
  //   the store's own root-minting rule: the anchor's own group (the common
  //   case, once the anchor itself is stamped) ?? the anchor's `sessionId` (an
  //   autopilot worker anchor predating this ticket, whose own sessionGroupId
  //   hasn't been backfilled) ?? the anchor's own dispatch id (a plain
  //   pre-field root — self-heals the chain from here on: every descendant
  //   from this point forward shares this group id, even though the root
  //   itself stays unstamped). Absent an anchor (aged out of the store's
  //   window), no group id is inherited and the store's own fallback mints a
  //   fresh root group for this dispatch — the un-stamped chain-walk is the
  //   reader's fallback for that case, not this ticket's.
  let inheritedSessionGroupId = null;
  if (anchor) {
    inheritedSessionGroupId = anchor.sessionGroupId || anchor.sessionId || fields.followUpTo;
  }

  // 5.7. Inherit the anchor's per-runner-session lineage anchor (LIN-1468),
  //   riding the SAME anchor lookup from step 2. Mirrors inheritedSessionGroupId
  //   immediately above, with one deliberate difference: NO `anchor.sessionId`
  //   tier. Every sibling worker an autopilot spawns carries the orchestrator's
  //   sessionId, so borrowing that tier here would give all siblings one
  //   identical rootItemId — the sibling-collapse bug LIN-1461 fixed, in a new
  //   field. Precedence: the anchor's own rootItemId (the common case, once the
  //   anchor itself is stamped) ?? the anchor's own dispatch id (a pre-LIN-1468
  //   anchor, self-healing the chain from here on). Absent an anchor, no anchor
  //   is inherited and the store's own two-tier fallback mints a fresh root.
  let inheritedRootItemId = null;
  if (anchor) {
    inheritedRootItemId = anchor.rootItemId || fields.followUpTo;
  }

  // 6. Stamp presetConfig/presetName ONLY on kind:'autopilot' rows (selected OR
  //    inherited — an autopilot's own selection wins over what it inherited),
  //    so a child-autopilot chain carries the config forward transitively
  //    without leaking it onto non-autopilot kinds. The carrier is a FROZEN
  //    snapshot: deep-copy it here so a later edit/delete of the preset (or
  //    mutation of the anchor's own row) can never reach an already-dispatched
  //    item (snapshot-at-dispatch, not live-reference).
  let presetConfig = null;
  let presetName = null;
  if (effectiveKind === 'autopilot') {
    if (selectedPreset) {
      presetConfig = selectedPreset.config;
      presetName = selectedPreset.name || null;
    } else if (anchor?.presetConfig) {
      presetConfig = anchor.presetConfig;
      presetName = anchor.presetName || null;
    }
  }
  if (presetConfig) {
    presetConfig = structuredClone(presetConfig);
  }

  // 7. Finalize the prompt with the RESOLVED harness (the ordering invariant),
  //    then carry back any structured bootstrap token for the claude-code branch.
  let finalPrompt = prompt;
  let bootstrapToken = null;
  if (typeof finalizePrompt === 'function') {
    const finalized = await finalizePrompt(resolvedHarness);
    finalPrompt = finalized?.prompt;
    bootstrapToken = finalized?.bootstrapToken ?? null;
  }

  // 7.5. Consumer poll-recency stamp (LIN-2885). Read-only telemetry computed
  //    at every enqueue, never a refusal — this dispatch enqueues regardless of
  //    whether anything is listening (a runner may come up later). Stamped on
  //    the item itself (not just returned) so a LATER read (GET /dispatch/{id},
  //    the lean list, the dispatch page, Observation queued rows) can explain a
  //    stale queue without re-reading token history itself. Each caller derives
  //    its own `warning` string from this stamp via `buildConsumerPollWarning`
  //    (lib/consumer-poll-warning.js) — kept out of the factory so the SAME pure
  //    function renders both the 201 body and every later read of the stamp.
  const consumerLastSeenAt = await getConsumerLastSeenAt(dispatchTokenStore, urlKey);

  // 8. Build the full field set and enqueue. The store owns the canonical shape.
  const item = await store.addItem(urlKey, {
    ...fields,
    ...(inheritedIssueFields || {}),
    ...(inheritedSessionGroupId ? { sessionGroupId: inheritedSessionGroupId } : {}),
    ...(inheritedRootItemId ? { rootItemId: inheritedRootItemId } : {}),
    prompt: finalPrompt,
    kind: effectiveKind,
    model: resolvedModel,
    harness: resolvedHarness,
    // LIN-2452: payload passthrough only — deliberately not resolved above.
    terminal: terminal || null,
    // LIN-2615: unlike terminal, effort IS resolved above (pass 3, mirroring
    // model) — the build takes the resolved value, not the raw parameter.
    effort: resolvedEffort,
    presetConfig,
    presetName,
    bootstrapToken,
    consumerLastSeenAt
  });

  // LIN-2934: non-persisted budget position, attached to the returned item
  // only (never stored) so the 201 response can echo "n of N" on admission.
  if (budgetPosition) {
    item.budgetPosition = budgetPosition;
  }
  return item;
}
