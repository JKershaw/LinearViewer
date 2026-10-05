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
 * `finalizePrompt`, and stores back the returned
 * `{ prompt, bootstrapToken, grantDeclaration }`. Prompt construction +
 * bootstrap minting therefore stay OUTSIDE the factory (per the parent
 * LIN-1135 constraint) while resolution stays INSIDE it.
 *
 * LIN-3138 (LIN-3134 Decision 11): the `grantDeclaration` record is only ever
 * the factory's own `finalizePrompt` result; any caller- or anchor-supplied
 * copy is stripped before the field spreads and only the finalized value is
 * re-added after them, so a declared-mint record cannot be injected. A refusal
 * is never written here (only `addFeedback`'s wake path writes one).
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
import {
  COUNT_TIMEOUT_MS,
  PLAN_READ_TIMEOUT_MS,
  POINTER_STEP_TIMEOUT_MS,
  selectPilotArm,
  buildFilePointer,
  prependFilePointer
} from './file-pointer.js';
import { parseGitHubOwnerAllowlist, collectPrFiles } from './github-pr-files.js';
import { parseEvidenceArtifacts } from './session-telemetry.js';
import { readHorizonStart } from './read-horizon.js';

/** Env switch for the LIN-3200 file-pointer pilot. Default OFF. */
export const FILE_POINTER_PILOT_ENV = 'HARBOUR_FILE_POINTER_PILOT';

/**
 * The pilot flag. Read at call time (not module load) so tests and a live
 * operator can flip it without a restart-time import snapshot.
 */
export function isFilePointerPilotEnabled(env = process.env) {
  const raw = String(env?.[FILE_POINTER_PILOT_ENV] ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/**
 * Resolve a thunk to its value within `ms`, else `fallback`. NEVER rejects —
 * a sync throw, an async rejection, and a timeout are all the same fail-open
 * signal. A late settle after the cap is swallowed (its handlers are already
 * attached), so an abandoned read cannot surface as an unhandled rejection.
 */
function valueWithin(thunk, ms, fallback = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    Promise.resolve()
      .then(thunk)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      );
  });
}

/**
 * The default earlier-PR read: pull `[evidence]` artifacts from this ticket's
 * loop feedback (history ∪ live queue, the shared 30-day read horizon) and
 * hand the PR URLs to the bounded GitHub read. Never throws.
 */
async function defaultFetchPilotPrFiles({ store, urlKey, issueIdentifier, nowMs, doFetch, owners }) {
  let artifacts = [];
  try {
    const history = typeof store.listHistory === 'function'
      ? await store.listHistory(urlKey, { issueIdentifier, since: readHorizonStart(nowMs), projection: { prompt: 0 } })
      : { items: [] };
    const live = typeof store.listItems === 'function'
      ? await store.listItems(urlKey, { issueIdentifier, projection: { prompt: 0 } })
      : [];
    const feedback = [];
    for (const item of (Array.isArray(live) ? live : [])) {
      if (Array.isArray(item?.feedback)) feedback.push(...item.feedback);
    }
    for (const item of (history?.items || [])) {
      if (Array.isArray(item?.feedback)) feedback.push(...item.feedback);
    }
    artifacts = parseEvidenceArtifacts(feedback);
  } catch {
    artifacts = [];
  }
  return collectPrFiles(doFetch, { artifacts, ownerAllowlist: owners, now: nowMs });
}

/**
 * Assemble the pointer text under one hard cap, the plan read and the PR read
 * in parallel. Any failure or cap-hit resolves to null (nothing delivered),
 * never a throw and never a refusal.
 */
async function assemblePilotPointer({ readPlanBlock, fetchPilotPrFiles, ctx, planTimeout = PLAN_READ_TIMEOUT_MS, stepTimeout = POINTER_STEP_TIMEOUT_MS }) {
  const planRead = typeof readPlanBlock === 'function'
    ? valueWithin(() => readPlanBlock({ urlKey: ctx.urlKey, issueIdentifier: ctx.issueIdentifier }), planTimeout)
    : Promise.resolve(null);
  const prRead = typeof fetchPilotPrFiles === 'function'
    ? valueWithin(() => fetchPilotPrFiles(ctx), planTimeout)
    : Promise.resolve([]);
  const settled = await valueWithin(() => Promise.all([planRead, prRead]), stepTimeout);
  if (!settled) return null;
  const [planBlock, prFiles] = settled;
  const built = buildFilePointer({ planBlock, prFiles });
  return built ? built.text : null;
}

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

/**
 * Programmatic discriminator on the 409 refusal body (LIN-3245 / LIN-2949
 * P1a): a fresh close-out dispatch bound to a run that declared `stopAt: 'pr'`.
 * Distinct from BUDGET_EXHAUSTED — a close-out is the person's to send, not a
 * spent scope bound.
 */
export const CLOSE_OUT_IS_THE_PERSONS_CODE = 'CLOSE_OUT_IS_THE_PERSONS';

/** Programmatic discriminator on the 429 run-limit refusal body (LIN-3238). */
export const RUN_LIMIT_CODE = 'RUN_LIMIT_REACHED';

/** Programmatic discriminator on the 503 unverified-run-count body (LIN-3238). */
export const RUN_LIMIT_UNVERIFIED_CODE = 'RUN_LIMIT_UNVERIFIED';

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
 * @param {(harness: string|null) => (Promise<{prompt: string, bootstrapToken?: string|null, grantDeclaration?: Object|null}>|{prompt: string, bootstrapToken?: string|null, grantDeclaration?: Object|null})} [params.finalizePrompt]
 *   Called with the RESOLVED harness to produce the final prompt (and, for the
 *   claude-code MCP branch, a `bootstrapToken` to carry as a structured field;
 *   and, for a declared launch (LIN-3138), a `grantDeclaration` record to persist
 *   — never injected by a caller; see step 8). This is where
 *   `attachProxyContext` runs, preserving the harness→append→addItem ordering
 *   centrally.
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
 * @param {Object} [params.proxyTokenStore] - LIN-3130: proxy token store, read
 *   ONLY to fold grant-bearing `take` (runner) tokens into `consumerLastSeenAt`
 *   so a runner-only workspace does not read "never polled". Absent → the stamp
 *   is dispatch-token-only, byte-identical to before.
 * @param {boolean} [params.filePointerEnabled] - LIN-3200 pilot flag. Defaults
 *   to `isFilePointerPilotEnabled()` (env `HARBOUR_FILE_POINTER_PILOT`, OFF).
 *   When false, step 7.6 is a no-op and the `addItem` argument is byte-identical.
 * @param {Function} [params.readPlanBlock] - `({urlKey, issueIdentifier}) =>
 *   Promise<string|null>` returning the issue description (the pointer's plan
 *   source). Absent/throwing ⇒ no plan paths. Reads are capped at
 *   `PLAN_READ_TIMEOUT_MS`.
 * @param {Function} [params.fetchPilotPrFiles] - `(ctx) => Promise<Array<{repo,
 *   path}>>` for the earlier-PR half. Defaults to the bounded GitHub read over
 *   this ticket's `[evidence]` artifacts.
 * @param {Function} [params.filePointerDoFetch] - fetch-compatible seam for the
 *   default PR read (tests inject; production uses global fetch).
 * @param {Set<string>} [params.filePointerOwners] - owner allowlist for the PR
 *   read; omitted ⇒ `parseGitHubOwnerAllowlist()` (empty ⇒ PR files unavailable).
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
  runGate = null,
  now = Date.now,
  composedRunMarker,
  getWorkspaceAccessToken,
  fetchIssueContext,
  guardTaskDoneCache = dispatchGuardTaskDoneCache,
  dispatchTokenStore = null,
  proxyTokenStore = null,
  filePointerEnabled = undefined,
  readPlanBlock = null,
  fetchPilotPrFiles = null,
  filePointerDoFetch = null,
  filePointerOwners = null,
  filePointerTimeouts = null
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

  // 1.55. Free-tier run-limit guard (LIN-3238). A free-tier account may START at
  //    most `runLimit` fresh runs per UTC day across its merge group. Sequenced
  //    AFTER the duplicate guard (a duplicate of a just-created row must be
  //    refused as a duplicate, not charged) and BEFORE the budget guard, and —
  //    like both — before `finalizePrompt` (step 7), which mints the bootstrap
  //    credential, so a refusal leaves nothing behind.
  //
  //    GATE, deliberately narrower than the duplicate guard's: `force: true` is
  //    NOT in it. Unlike the duplicate guard's operator escape hatch, the run
  //    limit is a per-account quota — a bound any caller could wave through with
  //    `force` would be advisory, not a bound. Same stance as the budget guard.
  //
  //    Applies only to a FRESH row by the Q1 predicate: a `followUpTo` beat or a
  //    worker carrying a `sessionId` continues an existing run; an `abort`/
  //    `cascade` is coordination; a `kind:'wake'` continues a run. Those are never
  //    counted, so they are never gated. A `null` `runGate` means the lane is not
  //    gated (not free tier, no attributable account, or a store-less caller).
  //
  //    `runGate()` is the caller-built closure (lib/chat-request.js
  //    `buildRunGate`): it resolves the session account's merge group and calls
  //    `freeTierStore.checkRun`. It is invoked exactly once, only on a fresh row.
  //    A throw or a non-`limit` non-allowed result is treated as an UNVERIFIED
  //    count and fails CLOSED (503) — a run limit that silently admits every run
  //    when the count can't be read is useless, the budget guard's own stance.
  const runGateApplies = runGate != null
    && fields.followUpTo == null
    && fields.abort !== true
    && fields.cascade !== true
    && fields.sessionId == null
    && effectiveKind !== 'wake';

  if (runGateApplies) {
    const gateResult = await Promise.resolve().then(() => runGate()).catch(() => null);
    const runNowMs = typeof now === 'function' ? now() : new Date(now).getTime();

    // `checkRun` returns `{ allowed, reason?: 'limit'|'unverified', runsUsed,
    // limit, remaining, resetsAt }`. Allowed ⇒ proceed; `limit` ⇒ 429; anything
    // else (a throw, a null, or an unreadable count) ⇒ 503 unverified.
    if (gateResult?.allowed === true) {
      // Admitted — fall through to the remaining guards and the mint.
    } else if (gateResult && gateResult.reason === 'limit') {
      const limit = gateResult.limit;
      const runsUsed = gateResult.runsUsed;
      const resetsAt = gateResult.resetsAt;
      const retryAfter = Math.max(1, Math.ceil((Date.parse(resetsAt) - runNowMs) / 1000));
      const message = `Daily run limit reached (${runsUsed} of ${limit} today). Resets at midnight UTC.`;
      const err = new Error(message);
      err.runLimit = {
        error: message,
        code: RUN_LIMIT_CODE,
        freeTier: { used: true, remaining: 0, limit, resetsAt, runsUsed },
        retryAfter
      };
      err.status = 429;
      throw err;
    } else {
      const resetsAt = gateResult?.resetsAt ?? null;
      const retryAfter = resetsAt
        ? Math.max(1, Math.ceil((Date.parse(resetsAt) - runNowMs) / 1000))
        : 1;
      const message = 'Unable to verify the run limit for this account';
      const err = new Error(message);
      err.runLimit = {
        error: message,
        code: RUN_LIMIT_UNVERIFIED_CODE,
        freeTier: {
          used: true,
          remaining: 0,
          limit: gateResult?.limit ?? null,
          resetsAt,
          runsUsed: null
        },
        retryAfter
      };
      err.status = 503;
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

  // Close-out seam eligibility (LIN-3245 / LIN-2949 P1a): the run-boundary
  // fact only ever refuses a FRESH close-out dispatch — the same "not an abort,
  // not a follow-up beat" freshness the duplicate/budget guards use. Defined
  // here so the shared run-row read below serves both guards.
  const closeOutGuardApplies = effectiveKind === 'close-out'
    && fields.followUpTo == null
    && fields.abort !== true;

  // Child-autopilot inheritance eligibility (LIN-3245 / LIN-2949 P1a, N1): a
  // FRESH autopilot dispatch launched under a parent run's `sessionId` inherits
  // that run's `stopAt`. Same freshness rule as the guards above; defined here
  // so the shared run-row read below serves this case too.
  const inheritStopAtApplies = effectiveKind === 'autopilot'
    && fields.followUpTo == null
    && fields.abort !== true;

  // Shared run-row read (LIN-3245): the budget guard, the close-out seam guard
  // and child-autopilot stopAt inheritance ALL anchor on the run row named by
  // `fields.sessionId`, so read it once, and only when a consumer will actually
  // use it. Capability-gated exactly like the budget guard's own documented
  // invariant: a store without `getItemStatus` leaves `run` null (the budget
  // guard then sees no bound, the close-out guard no `stopAt`, and an autopilot
  // child inherits nothing), never a total dispatch outage.
  const run = (fields.sessionId
    && typeof store.getItemStatus === 'function'
    && (budgetGuardApplies || closeOutGuardApplies || inheritStopAtApplies))
    ? await Promise.resolve(store.getItemStatus(urlKey, fields.sessionId)).catch(() => null)
    : null;

  if (budgetGuardApplies && fields.sessionId) {
    // No `sessionId` on the incoming dispatch ⇒ it can't be tied to any run row,
    // so it is ADMITTED — same "can't resolve a budget ⇒ skip" path an unreadable
    // run row takes below, by construction rather than a special case. `sessionId`
    // is a cooperating-orchestrator convention (optional, caller-supplied,
    // format-validated only — see `validateSessionId`), never a hostile-caller
    // control, so this bound only holds for a run that follows the kickoff
    // prose's instruction to stamp `sessionId` on every worker dispatch.
    //
    // The anchor read itself is SHARED above (LIN-3245), keyed on
    // `fields.sessionId` — distinct from step 2's anchor below (keyed on
    // `fields.followUpTo`). The two never contend: both guards only run when
    // `followUpTo` is null, so this branch and step 2's anchor read are
    // mutually exclusive by construction.
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

  // 1.65. Run-boundary seam guard (LIN-3245 / LIN-2949 P1a). A FRESH close-out
  //    dispatch bound to a run that declared `stopAt: 'pr'` is refused: the run
  //    stops at its PR, and the close-out is the person's to send. Reads the
  //    SAME run row as the budget guard just above (the shared `run`), and is
  //    sequenced AFTER it so a budgeted run's task/session refusal keeps
  //    precedence. Distinct from budget exhaustion — its own tag
  //    (`err.closeOutRefusal`) and code (`CLOSE_OUT_IS_THE_PERSONS`) — relayed
  //    by `refuseIfBudgetExhausted` (proxy routes) and the session `/dispatch`
  //    sibling catch. Refused before step 7's finalizePrompt, like every guard
  //    above, so no credential is minted and no row is created. A press
  //    close-out (no resolvable run row), a null `stopAt`, an unreadable run
  //    row, and every other kind are admitted by construction: this fires only
  //    on a resolved `stopAt: 'pr'` run, so a run without the fact behaves
  //    exactly as today.
  if (run && run.stopAt === 'pr' && closeOutGuardApplies) {
    const err = new Error('This run stops at its PR — close-out is the person\'s to send');
    err.closeOutRefusal = {
      code: CLOSE_OUT_IS_THE_PERSONS_CODE,
      sessionId: fields.sessionId
    };
    err.status = 409;
    throw err;
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

  // 5.5a. Inherit the anchor's binding selector pair (LIN-3126 residual F1).
  //    Rides the SAME anchor lookup from step 2, but is deliberately NOT gated
  //    on the issue-identity guard above: a follow-up that names its own issue
  //    fields FOR THE SAME ISSUE must still keep the anchor's
  //    `issueSource`/`issueBindingScope`. Every human reply follow-up writes a
  //    row through here, and the run page renders its ONE hoisted reply box from
  //    the lineage TAIL (lib/render-session.js's `renderLineageGroup`), so
  //    without this the tail row is unstamped and the run page's Close out /
  //    reply senders 422 `BINDING_REQUIRED` on a two-binding connection-backed
  //    workspace. Two guards keep this honest:
  //      (a) SAME ISSUE ONLY — a follow-up that names a DIFFERENT issue
  //          (`issueIdentifier`/`issueId` set and not the anchor's) inherits
  //          nothing, or issue A's binding would be stamped onto issue B.
  //      (b) THE PAIR MOVES AS A UNIT — if the follow-up carries EITHER half
  //          itself, nothing is taken from the anchor; never splice one half
  //          from the follow-up and the other from the anchor.
  //    SPARSE — an absent anchor value adds no key, so an unstamped or legacy
  //    row keeps a byte-identical key set (S0). `issueBindingScope` is
  //    selection-only provenance, never a credential (B1).
  //
  //    NOT the only row producer: a wake follow-up bypasses this factory
  //    entirely (the store mints it via `buildWakeFollowUp` + `store.addItem`),
  //    so it carries its own sparse pair stamp there (LIN-3126 residual W1).
  //    This block covers factory-created follow-ups only.
  const namesAnchorIssue =
    (!fields.issueIdentifier || fields.issueIdentifier === anchor?.issueIdentifier) &&
    (!fields.issueId || fields.issueId === anchor?.issueId);
  const carriesOwnBindingPair = fields.issueSource != null || fields.issueBindingScope != null;
  const inheritedIssueBindingPair = {};
  if (fields.followUpTo && anchor && namesAnchorIssue && !carriesOwnBindingPair) {
    if (anchor.issueSource) inheritedIssueBindingPair.issueSource = anchor.issueSource;
    if (anchor.issueBindingScope) inheritedIssueBindingPair.issueBindingScope = anchor.issueBindingScope;
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
  //    then carry back any structured bootstrap token for the claude-code branch
  //    and the declared-mint record (LIN-3138 / LIN-3134 Decision 11).
  let finalPrompt = prompt;
  let bootstrapToken = null;
  let grantDeclaration = null;
  if (typeof finalizePrompt === 'function') {
    const finalized = await finalizePrompt(resolvedHarness);
    finalPrompt = finalized?.prompt;
    bootstrapToken = finalized?.bootstrapToken ?? null;
    grantDeclaration = finalized?.grantDeclaration ?? null;
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
  const consumerLastSeenAt = await getConsumerLastSeenAt(dispatchTokenStore, urlKey, proxyTokenStore);

  // 7.6. File-pointer pilot (LIN-3200). PREPEND a short pointer to the
  //    IMPLEMENTATION prompt only, on every second eligible implementation
  //    dispatch (deterministic from the live ordinal). Placed AFTER the 7.5
  //    consumer stamp and immediately BEFORE step 8's `addItem`, so the only
  //    gap from the count that decided the arm to `addItem`'s `new Date()` is
  //    synchronous work (bounded by COUNT_TIMEOUT_MS). It runs after guards
  //    1.5/1.6/1.7 and after `finalizePrompt`, so a refusal consumes no ordinal
  //    and a failing pointer cannot orphan a minted credential.
  //
  //    The WHOLE step never throws and never refuses: one outer try/catch means
  //    any failure leaves the prompt untouched (fail-open, residual R1). The
  //    control arm does no further read. The `addItem` argument is byte-identical
  //    in every arm except a delivered pointer, and no row field is added.
  let pilotLog = null;
  const pilotEnabled = filePointerEnabled === undefined
    ? isFilePointerPilotEnabled()
    : filePointerEnabled === true;
  if (pilotEnabled
    && effectiveKind === 'implementation'
    && fields.followUpTo == null
    && fields.abort !== true
    && !!fields.issueIdentifier
    && typeof finalPrompt === 'string' && finalPrompt.length > 0
    && typeof store.countPilotEligible === 'function') {
    const pilotNowMs = typeof now === 'function' ? now() : new Date(now).getTime();
    const pilotOwners = filePointerOwners instanceof Set ? filePointerOwners : parseGitHubOwnerAllowlist();
    const pilotDoFetch = typeof filePointerDoFetch === 'function' ? filePointerDoFetch : globalThis.fetch;
    const pilotPrReader = typeof fetchPilotPrFiles === 'function'
      ? fetchPilotPrFiles
      : (ctx) => defaultFetchPilotPrFiles(ctx);
    // Test seam only; production uses the exported timing constants.
    const pilotCountTimeout = Number.isFinite(filePointerTimeouts?.count) && filePointerTimeouts.count > 0
      ? filePointerTimeouts.count : COUNT_TIMEOUT_MS;
    const pilotPlanTimeout = Number.isFinite(filePointerTimeouts?.plan) && filePointerTimeouts.plan > 0
      ? filePointerTimeouts.plan : PLAN_READ_TIMEOUT_MS;
    const pilotStepTimeout = Number.isFinite(filePointerTimeouts?.step) && filePointerTimeouts.step > 0
      ? filePointerTimeouts.step : POINTER_STEP_TIMEOUT_MS;

    let c0 = null;
    let c1 = null;
    let arm = 'control';
    let delivered = false;
    let failOpen = false;
    let reason = null;
    let armDecidedAt = null;

    try {
      c0 = await valueWithin(() => store.countPilotEligible(urlKey), pilotCountTimeout);
      if (c0 == null) {
        failOpen = true;
        reason = 'c0-unavailable';
      } else {
        arm = selectPilotArm({ ordinal: c0 });
        if (arm === 'pointer') {
          const pointerText = await assemblePilotPointer({
            readPlanBlock,
            fetchPilotPrFiles: pilotPrReader,
            ctx: { store, urlKey, issueIdentifier: fields.issueIdentifier, nowMs: pilotNowMs, doFetch: pilotDoFetch, owners: pilotOwners },
            planTimeout: pilotPlanTimeout,
            stepTimeout: pilotStepTimeout
          });
          // Recount ALWAYS on the pointer-assigned path, even when the pointer
          // came out empty: the arm is decided on the count immediately before
          // addItem, so the reads no longer sit inside the gap (M4).
          c1 = await valueWithin(() => store.countPilotEligible(urlKey), pilotCountTimeout);
          if (c1 == null) {
            failOpen = true;
            reason = 'c1-unavailable';
          } else {
            arm = selectPilotArm({ ordinal: c1 });
            if (arm === 'pointer' && pointerText) {
              finalPrompt = prependFilePointer(finalPrompt, pointerText);
              delivered = true;
            }
          }
        }
        armDecidedAt = Date.now();
      }
    } catch {
      failOpen = true;
      reason = 'step-throw';
      arm = 'control';
      delivered = false;
    }

    pilotLog = { issueIdentifier: fields.issueIdentifier, c0, c1, arm, delivered, failOpen, reason, armDecidedAt };
  }

  // 8. Build the full field set and enqueue. The store owns the canonical shape.
  //    LIN-3138 (LIN-3134 Decision 11) — injection closure for the two declared
  //    row fields. A declared record may only come from THIS factory's own
  //    finalize result, and a refusal only from the wake path (`_mintWake`), so
  //    strip any caller- or anchor-supplied copy before the spreads, then re-add
  //    the factory's own record after them. An undeclared dispatch adds neither
  //    key, keeping the `addItem` argument (and the persisted doc) byte-identical
  //    to pre-LIN-3138 — the S0 witness, and the `dispatchQueueStore.calls[0]`
  //    floor in tests/unit/chat-tools.test.js.
  const sanitizedFields = { ...fields };
  delete sanitizedFields.grantDeclaration;
  delete sanitizedFields.grantRefusal;
  const sanitizedInheritedIssueFields = inheritedIssueFields ? { ...inheritedIssueFields } : null;
  if (sanitizedInheritedIssueFields) {
    delete sanitizedInheritedIssueFields.grantDeclaration;
    delete sanitizedInheritedIssueFields.grantRefusal;
  }
  const item = await store.addItem(urlKey, {
    ...sanitizedFields,
    ...(sanitizedInheritedIssueFields || {}),
    ...inheritedIssueBindingPair,
    ...(inheritedSessionGroupId ? { sessionGroupId: inheritedSessionGroupId } : {}),
    ...(inheritedRootItemId ? { rootItemId: inheritedRootItemId } : {}),
    // Child-autopilot inheritance (LIN-3245 / LIN-2949 P1a, N1): a fresh
    // autopilot launched under a parent run carrying `stopAt` is stamped with
    // the same boundary, covering BOTH launch shapes (the fused kickoff verb
    // and the two-step plain `/dispatch`). Only when the caller supplied no
    // `stopAt` of its own; the key is absent entirely on the dormant path, so
    // the `addItem` argument stays byte-identical when no boundary is in play.
    ...(inheritStopAtApplies && fields.stopAt == null && run?.stopAt === 'pr' ? { stopAt: 'pr' } : {}),
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
    consumerLastSeenAt,
    // Pinned AFTER every spread: only the factory's own finalize result can set
    // the record. A refusal is never written by this factory (only
    // `addFeedback`'s wake path does), so its injection is closed by the
    // pre-spread strip above rather than by an added key — this keeps an
    // undeclared `addItem` argument byte-identical to pre-LIN-3138.
    ...(grantDeclaration != null ? { grantDeclaration } : {})
  });

  // LIN-2934: non-persisted budget position, attached to the returned item
  // only (never stored) so the 201 response can echo "n of N" on admission.
  if (budgetPosition) {
    item.budgetPosition = budgetPosition;
  }

  // One structured audit line per eligible pilot decision (step 5). NEVER
  // relied on by the arm rule and never stored — R1's fail-open rows can be
  // listed from here when the log is retained; nothing depends on that.
  if (pilotLog) {
    const gapMs = pilotLog.armDecidedAt != null
      ? Math.max(0, Date.now() - pilotLog.armDecidedAt)
      : null;
    console.log('[file-pointer]', JSON.stringify({
      issueIdentifier: pilotLog.issueIdentifier,
      c0: pilotLog.c0,
      c1: pilotLog.c1,
      arm: pilotLog.arm,
      delivered: pilotLog.delivered,
      failOpen: pilotLog.failOpen,
      reason: pilotLog.reason,
      gapMs
    }));
  }
  return item;
}
