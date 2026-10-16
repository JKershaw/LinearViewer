/**
 * Shared dispatch-item creation factory (LIN-1139).
 *
 * Every external dispatch entry point (the two main handlers, the proxy
 * server-generated paths, the feedback follow-ups, the collective fan-out and
 * the chat-tools follow-up) used to hand-roll the SAME sequence: resolve the
 * prompt kind, fill blank model/harness from the workspace's dispatch defaults,
 * interpose the default harness, build the item field set, and enqueue it. Nine
 * copies drifted (LIN-1159's claude-code interpose reached only four of them).
 * This factory is the ONE seam that owns that resolution, so a new dispatch path
 * is a single call and no path can silently diverge on inheritance again.
 *
 * It owns only RESOLUTION + construction, never prompt authoring or auth
 * plumbing. The ordering the proxy-context paths depend on (harness resolved
 * BEFORE the prompt is finalized, because `attachProxyContext` gates its
 * MCP-token-vs-prose branch on the resolved harness, and the prompt finalized
 * BEFORE the row is written) is kept through the `finalizePrompt(harness)`
 * callback: the factory resolves the harness, hands it to the caller's
 * `finalizePrompt`, and stores back the returned
 * `{ prompt, bootstrapToken, grantDeclaration }`.
 *
 * LIN-3138 (LIN-3134 Decision 11): the `grantDeclaration` record is only ever
 * the factory's own `finalizePrompt` result. A caller-supplied copy is stripped
 * from `fields` before the spread and only the finalized value is re-added after
 * it, so a declared-mint record cannot be injected. A refusal is never written
 * here (only the wake path writes one).
 *
 * Being the one convergence point for every external creation surface, it is
 * also where the refusal guards live (duplicate LIN-1656, run limit LIN-3238,
 * task budget LIN-1751 / LIN-3461, close-out LIN-3245, terminal anchor
 * LIN-2775). Every guard runs BEFORE `finalizePrompt`, which mints the
 * single-use bootstrap credential, so a refused dispatch leaves nothing behind.
 *
 * NOT for the store-internal writes (cascade abort expansion, wake follow-ups):
 * those are below this layer and emit minimal, model/harness-free items by
 * design; routing them through a factory that itself calls the store would
 * invert the dependency.
 *
 * Layout. The census tests read this file as text (lin-3384, lin-3134, lin-3130,
 * lin-3383), so: every helper is declared ABOVE the exported function, nothing
 * header-shaped sits inside it before the single enqueue, and the run and anchor
 * reads sit directly under their own `const run = (` / `const anchor = (` lines.
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
 * Recency window for the duplicate-dispatch guard (LIN-1656).
 *
 * Chosen from measurement, not taste: the observed orchestrator collisions are
 * 2m17s to 8.8m apart, so a 2-minute window misses the clearest ones outright,
 * while 10 minutes triples the false refusals to catch one more. Five minutes is
 * also ~6x clear of the "when in doubt, dispatch fresh" policy trigger (~30 min
 * of silence), which is why no policy text moves for this guard. Marked for
 * revisit with live data rather than opinion.
 */
export const DUPLICATE_DISPATCH_WINDOW_MS = 5 * 60 * 1000;

/** Programmatic discriminator on the 409 refusal body (LIN-1656). */
export const DUPLICATE_DISPATCH_CODE = 'DUPLICATE_DISPATCH';

/** Programmatic discriminator on the 409 refusal body (LIN-1751). */
export const BUDGET_EXHAUSTED_CODE = 'BUDGET_EXHAUSTED';

/**
 * Fixed runaway failsafe (LIN-3461): the most fresh worker sessions one task may
 * have within one run (`sessionId`); the next is refused. A constant, not a
 * budget: no caller sets it, no prompt or feed shows it.
 */
export const MAX_FRESH_SESSIONS_PER_TASK = 30;

/**
 * Discriminator on the 409 refusal body (LIN-3461): a task hit
 * `MAX_FRESH_SESSIONS_PER_TASK`. Its own code, never `BUDGET_EXHAUSTED`: it is a
 * runaway alarm (stop and report `[blocked]`), not an orderly finish.
 */
export const TASK_SESSION_RUNAWAY_CODE = 'TASK_SESSION_RUNAWAY';

/**
 * Discriminator on the 409 refusal body (LIN-3245 / LIN-2949 P1a): a fresh
 * close-out dispatch bound to a run that declared `stopAt: 'pr'`. Distinct from
 * BUDGET_EXHAUSTED: a close-out is the person's to send, not a spent scope bound.
 */
export const CLOSE_OUT_IS_THE_PERSONS_CODE = 'CLOSE_OUT_IS_THE_PERSONS';

/** Discriminator on the 429 run-limit refusal body (LIN-3238). */
export const RUN_LIMIT_CODE = 'RUN_LIMIT_REACHED';

/** Discriminator on the 503 unverified-run-count body (LIN-3238). */
export const RUN_LIMIT_UNVERIFIED_CODE = 'RUN_LIMIT_UNVERIFIED';

/** Discriminator on the 409 refusal body (LIN-2775 Area 8). */
export const ANCHOR_TERMINAL_CODE = 'ANCHOR_TERMINAL';

/**
 * The terminal-anchor guard's cache: the one piece of module state here. A
 * SEPARATE instance from the Observation sessions feed's own (`routes/
 * dashboard.js`); widening that one in place would re-point its
 * `done-with-warning` derivation onto an unrelated read path. A module-level
 * singleton, not a per-call default (which would recreate the cache on every
 * call and defeat it): every dispatch attempt in the server's lifetime shares
 * this ONE 60s-TTL cache, bounding the guard to one provider read per anchor
 * per 60s.
 *
 * The 60s TTL is justified by that bounded cost, not by "`done` is sticky"
 * (true of `completed` only). The guard also refuses `canceled` and
 * `duplicate`, and a `canceled` issue CAN be reopened, which this cache would
 * then serve as terminal for up to 60s: an accepted, bounded cost (a dispatch a
 * person can retry a minute later), not a claim that those states are sticky.
 */
const dispatchGuardTaskDoneCache = createTaskDoneCache();

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/**
 * A tagged refusal. Each creation route relays its own tag (`err.<tag>` is the
 * response body, see lib/dispatch-refusal.js); `err.status` is the BACKSTOP, not
 * the mechanism: the catch-all middleware honours a 4xx on a thrown error, so a
 * surface that forgets its branch degrades to a correct status rather than a
 * misleading 500 (it carries only the status; the body is lost).
 */
function refuse(message, tag, body, status) {
  const err = new Error(message);
  err[tag] = body;
  err.status = status;
  return err;
}

/**
 * Run a store read; a sync throw, a rejection, and a plain (non-promise) return
 * are all one thing. The failure is `null`, a plain return is its value.
 *
 * The call is made inside the `.then`, not handed to `Promise.resolve`: that
 * would evaluate the call before the wrapper exists, so a store whose read
 * throws SYNCHRONOUSLY would escape the catch and take the dispatch down
 * (LIN-1656 review finding 1). Unreachable with the in-repo async stores, but
 * the fail-open is a published invariant other stores are written against.
 *
 * Each caller decides what `null` means (open or closed); this decides nothing.
 */
function readOrNull(read) {
  return Promise.resolve().then(read).catch(() => null);
}

/** Epoch ms from the injected clock: a function, an epoch-ms number, or a Date. */
function clockMs(now) {
  return typeof now === 'function' ? now() : new Date(now).getTime();
}

/** A FRESH dispatch: not a follow-up beat and not an abort. */
function isFresh(fields) {
  return fields.followUpTo == null && fields.abort !== true;
}

/** Whole seconds until `resetsAt`, at least 1. `NaN` when `resetsAt` is not a date. */
function secondsUntil(resetsAt, nowMs) {
  return Math.max(1, Math.ceil((Date.parse(resetsAt) - nowMs) / 1000));
}

// ---------------------------------------------------------------------------
// Guards. Each refuses (throws a tagged error) or returns; none is merged with
// another because each carries its own code, body and orchestrator-facing
// meaning (lib/dispatch-refusal.js maps each tag). Their order is the order of
// createDispatchItem's steps.
// ---------------------------------------------------------------------------

/**
 * Step 1.5, duplicate-dispatch guard (LIN-1656). Two independent orchestrators
 * (the autopilot loop and a person driving the board) can each dispatch the same
 * issue+kind minutes apart. Refuse a FRESH dispatch when an equivalent one was
 * created inside DUPLICATE_DISPATCH_WINDOW_MS.
 *
 * Keyed on the RESOLVED kind, never the caller's raw `kind`: the stored row
 * carries the resolved one and most surfaces pass no `kind` at all, so keying on
 * the argument would miss the majority of duplicates.
 *
 * The gate is as permissive as the predicate. A follow-up IS the intended second
 * dispatch, a cascade emits one abort per descendant in the same second, and an
 * issue-less row has nothing to key on. The asymmetry behind every judgement
 * here: wrong in the permissive direction the guard merely does nothing, wrong
 * in the restrictive direction it silently blocks legitimate work.
 *
 * `force: true` is the OPERATOR ESCAPE HATCH (LIN-1656 review): it sits in the
 * gate, so a forced dispatch never even consults the lookup. Deliberately NOT
 * advertised to the autopilot kickoff prompt: an orchestrator that learns
 * `force` beats the guard reaches for it reflexively. Capability-gated: a store
 * without the lookup SKIPS the guard, and a failed lookup admits (fail OPEN),
 * because failing closed would turn a store-shape mismatch into a total
 * dispatch outage.
 *
 * A prior whose `dispatchedAt` is absent or unreadable cannot be window-checked,
 * so it does not refuse (the store hands back a real Date; any other shape is
 * tolerated rather than turned into a 500 on the creation path).
 */
async function guardDuplicate({ store, urlKey, fields, kind, now }) {
  const applies = isFresh(fields)
    && fields.force !== true
    && !!fields.issueIdentifier
    && typeof store.findRecentFreshDispatch === 'function';
  if (!applies) return;

  const nowMs = clockMs(now);
  const existing = await readOrNull(() => store.findRecentFreshDispatch(urlKey, {
    issueIdentifier: fields.issueIdentifier,
    kind,
    since: new Date(nowMs - DUPLICATE_DISPATCH_WINDOW_MS)
  }));

  const recorded = existing?.dispatchedAt;
  if (recorded == null) return;
  const dispatchedAt = recorded instanceof Date ? recorded : new Date(recorded);
  if (Number.isNaN(dispatchedAt.getTime())) return;

  // Seconds until the window clears, so the caller is told WHEN rather than just
  // no. Clamped into (0, window]: clock skew that puts the prior dispatch in the
  // future must not produce an absurd or negative wait.
  const clearsAt = dispatchedAt.getTime() + DUPLICATE_DISPATCH_WINDOW_MS;
  const retryAfter = Math.min(
    Math.ceil(DUPLICATE_DISPATCH_WINDOW_MS / 1000),
    Math.max(1, Math.ceil((clearsAt - nowMs) / 1000))
  );
  throw refuse('A dispatch for this issue and kind was created moments ago', 'duplicateDispatch', {
    code: DUPLICATE_DISPATCH_CODE,
    id: existing.id,
    issueIdentifier: fields.issueIdentifier,
    kind,
    dispatchedAt: dispatchedAt.toISOString(),
    retryAfter
  }, 409);
}

/**
 * Step 1.55, free-tier run-limit guard (LIN-3238). A free-tier account may START
 * at most `runLimit` fresh runs per UTC day across its merge group. After the
 * duplicate guard (a duplicate of a just-created row is refused as a duplicate,
 * not charged) and before the budget guard.
 *
 * `force` is NOT in the gate: the limit is a per-account quota, and a bound any
 * caller could wave through would be advisory. Only a FRESH row counts: a
 * follow-up beat or a worker carrying a `sessionId` continues a run, an
 * abort/cascade is coordination, a `wake` continues a run. A null `runGate`
 * means the lane is not gated (not free tier, no attributable account, or a
 * store-less caller).
 *
 * `runGate()` is the caller-built closure (lib/chat-request.js `buildRunGate`),
 * invoked exactly once and only on a fresh row. It resolves
 * `{ allowed, reason?: 'limit'|'unverified', runsUsed, limit, remaining, resetsAt }`.
 * Allowed admits; `limit` is a 429; anything else (a throw, a null, an unreadable
 * count) is an UNVERIFIED count and fails CLOSED (503): a run limit that
 * silently admits every run when the count cannot be read is useless.
 */
async function guardRunLimit({ runGate, fields, kind, now }) {
  const applies = runGate != null
    && isFresh(fields)
    && fields.cascade !== true
    && fields.sessionId == null
    && kind !== 'wake';
  if (!applies) return;

  const gate = await readOrNull(() => runGate());
  const nowMs = clockMs(now);
  if (gate?.allowed === true) return;

  if (gate && gate.reason === 'limit') {
    const { limit, runsUsed, resetsAt } = gate;
    const message = `Daily run limit reached (${runsUsed} of ${limit} today). Resets at midnight UTC.`;
    throw refuse(message, 'runLimit', {
      error: message,
      code: RUN_LIMIT_CODE,
      freeTier: { used: true, remaining: 0, limit, resetsAt, runsUsed },
      retryAfter: secondsUntil(resetsAt, nowMs)
    }, 429);
  }

  const resetsAt = gate?.resetsAt ?? null;
  const message = 'Unable to verify the run limit for this account';
  throw refuse(message, 'runLimit', {
    error: message,
    code: RUN_LIMIT_UNVERIFIED_CODE,
    freeTier: { used: true, remaining: 0, limit: gate?.limit ?? null, resetsAt, runsUsed: null },
    retryAfter: resetsAt ? secondsUntil(resetsAt, nowMs) : 1
  }, 503);
}

/**
 * Step 1.6, task-budget guard and runaway failsafe (LIN-1751, LIN-3461). A
 * kickoff can declare `maxTasks`, a scope bound on how many DISTINCT tasks the
 * run may take on. Same seam and reason as the duplicate guard (before the mint),
 * sequenced after it: different codes, bodies and meanings, never one conditional.
 *
 * `force` is NOT in the gate: it is a rescue hatch for a guard whose only
 * failure mode is wrongly blocking work (LIN-1656), and a budget any caller can
 * wave through is advisory, not a bound. A dispatch with no `sessionId` cannot be
 * tied to a run row and is admitted (`sessionId` is a cooperating-orchestrator
 * convention, never a hostile-caller control).
 *
 * `maxTasks` is the only DECLARED bound. The per-task runaway failsafe is
 * declared by nobody and applies to every run, so the count is read for every
 * issue-bearing dispatch carrying a `sessionId`, whether or not the run row
 * resolved or declares `maxTasks`.
 *
 * An unreadable count (a failed read OR a missing result) is the one place the
 * two bounds part: with `maxTasks` declared it fails CLOSED (a budget that
 * silently admits extra work on every count failure is useless), without one
 * only the failsafe is at stake and it fails OPEN (a failsafe that failed closed
 * would turn a database blip into a total dispatch outage).
 *
 * A dispatch for a task ALREADY inside the budget (`alreadyCounted`) is always
 * admitted regardless of count, which keeps a task's review and close-out from
 * being stranded once the budget is reached. Only a genuinely NEW task past
 * `maxTasks` is refused.
 *
 * Returns the non-persisted budget position (LIN-2934) for a declared budget,
 * else null; the caller attaches it to the returned item, never to the row.
 */
async function guardBudget({ store, urlKey, fields, run }) {
  const maxTasks = run?.maxTasks;
  const hasMaxTasks = typeof maxTasks === 'number' && maxTasks >= 1;
  const sessionId = fields.sessionId;

  const counted = await readOrNull(
    () => store.countDistinctTasksForSession(urlKey, sessionId, fields.issueIdentifier)
  );

  if (counted == null) {
    if (!hasMaxTasks) return null;
    throw refuse('Could not verify the task budget for this run', 'budgetExhausted', {
      code: BUDGET_EXHAUSTED_CODE, bound: 'tasks', count: null, maxTasks, sessionId
    }, 409);
  }

  if (hasMaxTasks && !counted.alreadyCounted && counted.count >= maxTasks) {
    throw refuse(`This run's task budget (${maxTasks}) has been reached`, 'budgetExhausted', {
      code: BUDGET_EXHAUSTED_CODE, bound: 'tasks', count: counted.count, maxTasks, sessionId
    }, 409);
  }

  // `taskDispatches` counts PRIOR fresh worker rows to this issue under this
  // `sessionId` (follow-ups and aborts excluded), so reaching the limit refuses
  // the (limit + 1)th. An alarm to stop and report, never an orderly finish.
  if (counted.taskDispatches >= MAX_FRESH_SESSIONS_PER_TASK) {
    throw refuse(
      `This task has had ${MAX_FRESH_SESSIONS_PER_TASK} fresh sessions in this run. `
        + 'That looks like a runaway, not a normal finish: stop the run and report [blocked] so a person can look at it.',
      'taskSessionRunaway',
      {
        code: TASK_SESSION_RUNAWAY_CODE,
        taskDispatches: counted.taskDispatches,
        limit: MAX_FRESH_SESSIONS_PER_TASK,
        issueIdentifier: fields.issueIdentifier,
        sessionId
      },
      409
    );
  }

  // `tasks` keeps the `alreadyCounted` gate: `count` is a distinct-task count
  // that only advances for a genuinely new task. Unbudgeted runs get no position,
  // so an unbudgeted 201 never grows a `{tasks: null}` shape.
  return hasMaxTasks
    ? { tasks: { count: counted.alreadyCounted ? counted.count : counted.count + 1, maxTasks } }
    : null;
}

/**
 * Step 1.65, run-boundary guard (LIN-3245 / LIN-2949 P1a). A FRESH close-out
 * bound to a run that declared `stopAt: 'pr'` is refused: the run stops at its
 * PR and the close-out is the person's to send. After the budget guard, so a
 * budgeted run's task/session refusal keeps precedence. Fires only on a resolved
 * `stopAt: 'pr'` run, so a press close-out (no resolvable run row), a null
 * `stopAt`, an unreadable run row and every other kind are admitted.
 */
function guardCloseOut({ run, applies, sessionId }) {
  if (applies && run && run.stopAt === 'pr') {
    throw refuse('This run stops at its PR — close-out is the person\'s to send', 'closeOutRefusal', {
      code: CLOSE_OUT_IS_THE_PERSONS_CODE,
      sessionId
    }, 409);
  }
}

/**
 * Step 1.7, terminal-anchor guard (LIN-2775 Area 8), SCOPED to a composed-run
 * dispatch by the explicit `composedRunMarker`, never by `kind`. An
 * unconditional Done/Canceled refusal would break `retrospective-audit` and
 * `retro` (lib/prompt-template-defs.js), both DESIGNED to target already-closed
 * work. The marker is opaque, validated like model/harness/terminal, but HERE
 * and not at a route, so this stays the one testable chokepoint.
 *
 * Capability-gated: a marker without both read dependencies SKIPS the guard (a
 * wiring gap, not a signal about this anchor). Once marker and capability are
 * both present a REAL read failure (no token, provider error, unreadable issue)
 * fails CLOSED, like the budget guard: this is the one path here that triggers
 * an irreversible external action. A throwing producer propagates uncached
 * (createTaskDoneCache's contract), so a transient failure is retried on the
 * next attempt, never pinned as terminal for the TTL.
 */
async function guardComposedRun({ marker, fields, urlKey, getWorkspaceAccessToken, fetchIssueContext, cache }) {
  if (marker == null) return;

  const markerError = validateOpaqueDispatchField(marker, 'composedRunMarker', { maxLength: 200 });
  if (markerError) {
    // Tagged like the refusals below: a route relays THIS property, never
    // rebuilds the body from a generic `err.status` check, which would swallow a
    // future unrelated 400 from elsewhere in this factory into the same branch.
    throw refuse(markerError.error, 'composedRunMarkerInvalid', { field: 'composedRunMarker' }, 400);
  }

  const capable = fields.issueIdentifier
    && typeof getWorkspaceAccessToken === 'function'
    && typeof fetchIssueContext === 'function';
  if (!capable) return;

  let terminal = false;
  let verifyFailed = false;
  try {
    terminal = await cache.get(`${urlKey}::${fields.issueIdentifier}`, async () => {
      const token = await getWorkspaceAccessToken(urlKey);
      if (!token) throw new Error('no workspace access token');
      const context = await fetchIssueContext(token, fields.issueIdentifier);
      const issue = context?.issue || context || {};
      // The cache stores a BOOLEAN. TERMINAL_TYPES is the producer predicate,
      // imported and never re-listed, so `duplicate` is refused alongside
      // `completed`/`canceled` with no second copy to drift.
      return !!(issue.state && TERMINAL_TYPES.includes(issue.state.type));
    });
  } catch {
    verifyFailed = true;
  }

  if (terminal === true || verifyFailed) {
    throw refuse(
      verifyFailed
        ? 'Could not verify the anchor issue is not terminal — refusing this composed-run dispatch'
        : 'The anchor issue is terminal — refusing this composed-run dispatch',
      'anchorTerminalRefusal',
      { code: ANCHOR_TERMINAL_CODE, issueIdentifier: fields.issueIdentifier, verified: !verifyFailed },
      409
    );
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Step 3-5, model / harness / effort, one precedence list per field (LIN-1390):
 * explicit incoming > selected preset (byKind) > inherited anchor `presetConfig`
 * (byKind) > workspace dispatchDefaults (byKind, then workspace-wide) > null.
 * Sources combine field by field, so a preset with only `model` set still lets
 * harness fall through. Anchor inheritance needs an EXPLICIT preset marker
 * (`anchor.presetConfig` truthy); no marker is byte-identical to pre-LIN-1390.
 *
 * The fields are NOT independent chains (LIN-1694). Harness resolves first, then
 * model and effort, and a source row scoped to a harness other than the one now
 * in force is skipped rather than donating its model. The bug this closes: an
 * explicit `harness: 'claude-code'` short-circuited the harness chain while
 * `model` kept falling through to the workspace's `opencode` row, resolving the
 * crossed pair claude-code + `deepseek/deepseek-v4-pro`, which launched as
 * `claude --model deepseek-v4-pro`. Eligibility uses the PRE-interpose harness:
 * the default interpose is a post-resolution default, and letting it decide
 * eligibility would make a blank harness look like an explicit `claude-code`.
 *
 * Harness alone has one extra tier (LIN-1431 S3): the anchor's own resolved
 * harness, below explicit/preset/anchor-preset and above the workspace default.
 * A resume must run on the harness of the session it resumes; a workspace
 * default outranking it is exactly the bug (a resume landing on a different
 * runner). `anchor.harness` is `doc.harness || null`, so a blank-harness anchor
 * inherits nothing, which keeps the LIN-1111 blank-harness escape hatch intact
 * through the default interpose. Model and effort (LIN-2615) have no such tier.
 *
 * The workspace tier is one read for all three fields and is made only if one is
 * still blank. With no harness in force its row can donate fields from different
 * rows of one config (LIN-1694 review F2); with one in force the row must be
 * eligible. Last, the default harness is interposed (LIN-1159) unless the caller
 * opts out.
 */
async function resolveRouting({
  urlKey, kind, model, harness, effort, preset, anchor, workspacePreferencesStore, applyDefaultHarness
}) {
  const configs = [];
  if (preset) configs.push(preset.config);
  if (anchor?.presetConfig) configs.push(anchor.presetConfig);

  const fromConfigs = (current, field, options) => {
    let value = current;
    for (const config of configs) {
      if (!value) value = resolveRoutingFromConfig(config, kind, options)[field];
    }
    return value;
  };

  let resolvedHarness = fromConfigs(harness || null, 'harness');
  if (!resolvedHarness && anchor?.harness) resolvedHarness = anchor.harness;
  const eligibility = { harnessInForce: resolvedHarness };
  let resolvedModel = fromConfigs(model || null, 'model', eligibility);
  let resolvedEffort = fromConfigs(effort || null, 'effort', eligibility);

  if ((!resolvedModel || !resolvedHarness || !resolvedEffort) && workspacePreferencesStore) {
    const defaults = await resolveDispatchDefaults({
      urlKey,
      kind,
      store: workspacePreferencesStore,
      harnessInForce: resolvedHarness
    });
    if (!resolvedModel) resolvedModel = defaults.model;
    if (!resolvedHarness) resolvedHarness = defaults.harness;
    if (!resolvedEffort) resolvedEffort = defaults.effort;
  }

  if (applyDefaultHarness) resolvedHarness = applyDefaultDispatchHarness(resolvedHarness);
  return { model: resolvedModel, harness: resolvedHarness, effort: resolvedEffort };
}

/**
 * Step 5.5-5.7, what a follow-up inherits from its anchor. SPARSE: an absent
 * anchor value adds no key, so an unstamped or legacy row keeps a byte-identical
 * key set (S0). An anchor is only ever read for a truthy `followUpTo`, so with
 * one in hand `followUpTo` is truthy and both ids below are always set.
 *
 * - Issue identity (LIN-1292): a follow-up that supplies no issue of its own
 *   inherits the anchor's. The human reply-box producer (public/session.js)
 *   posts only { prompt, followUpTo, target }, and both session reconstruction
 *   paths need a real `issueIdentifier` to build a loop at all; an issue-less
 *   follow-up is dropped everywhere as malformed. Inheriting at this seam keeps
 *   the reply visible without a producer change.
 * - `issueSource` (LIN-3126 residual F1, reduced by LIN-3335): rides the same
 *   anchor read but is deliberately NOT gated on the identity rule, so a
 *   follow-up naming its own fields FOR THE SAME ISSUE still keeps the anchor's
 *   source. The run page renders its one hoisted reply box from the lineage
 *   TAIL (lib/render-session.js `renderLineageGroup`); without this the tail is
 *   unstamped and a non-primary-kind read routes to the wrong provider. Two
 *   guards: (a) SAME ISSUE ONLY, or issue A's source would be stamped onto issue
 *   B; (b) a follow-up carrying its own `issueSource` wins. A wake follow-up
 *   bypasses this factory (the store mints it), so it stamps its own source
 *   (LIN-3126 residual W1); this covers factory-created follow-ups only.
 * - `sessionGroupId` (LIN-1341): the anchor's own group, else its `sessionId`
 *   (an autopilot worker predating the field), else its dispatch id (a plain
 *   root; every descendant from here shares it though the root stays unstamped).
 *   Without an anchor (aged out of the store's window) nothing is inherited and
 *   the store mints a fresh root group.
 * - `rootItemId` (LIN-1468): the same shape with NO `sessionId` tier. Every
 *   sibling worker an autopilot spawns carries the orchestrator's `sessionId`,
 *   so borrowing it would give all siblings one rootItemId (the sibling-collapse
 *   bug LIN-1461 fixed, in a new field).
 */
function inheritFromAnchor(fields, anchor) {
  if (!anchor) return {};
  const inherited = {};
  if (!fields.issueIdentifier && anchor.issueIdentifier) {
    inherited.issueId = fields.issueId || anchor.issueId || null;
    inherited.issueIdentifier = anchor.issueIdentifier;
    inherited.issueTitle = fields.issueTitle || anchor.issueTitle || null;
    inherited.issueUrl = fields.issueUrl || anchor.issueUrl || null;
  }
  const sameIssue = (!fields.issueIdentifier || fields.issueIdentifier === anchor.issueIdentifier)
    && (!fields.issueId || fields.issueId === anchor.issueId);
  if (sameIssue && fields.issueSource == null && anchor.issueSource) {
    inherited.issueSource = anchor.issueSource;
  }
  inherited.sessionGroupId = anchor.sessionGroupId || anchor.sessionId || fields.followUpTo;
  inherited.rootItemId = anchor.rootItemId || fields.followUpTo;
  return inherited;
}

/**
 * Step 6, the preset snapshot. `presetConfig`/`presetName` are stamped ONLY on
 * `autopilot` rows (selected or inherited; the row's own selection wins), so a
 * child-autopilot chain carries the config forward transitively without leaking
 * it onto other kinds. The carrier is a FROZEN snapshot: deep-copied so a later
 * edit or delete of the preset (or mutation of the anchor's row) can never reach
 * an already-dispatched item. Done before the mint: a config `structuredClone`
 * cannot copy (a function in it) refuses the dispatch with nothing left behind.
 */
function presetSnapshot(kind, preset, anchor) {
  if (kind !== 'autopilot') return { presetConfig: null, presetName: null };
  const snapshot = (config) => (config ? structuredClone(config) : config);
  if (preset) return { presetConfig: snapshot(preset.config), presetName: preset.name || null };
  if (anchor?.presetConfig) {
    return { presetConfig: snapshot(anchor.presetConfig), presetName: anchor.presetName || null };
  }
  return { presetConfig: null, presetName: null };
}

// ---------------------------------------------------------------------------
// File-pointer pilot (LIN-3200)
// ---------------------------------------------------------------------------

/**
 * Resolve a thunk to its value within `ms`, else `fallback`. NEVER rejects: a
 * sync throw, a rejection and a timeout are all the same fail-open signal. A
 * promise settles once, so a late settle after the cap is ignored and its
 * handlers (already attached) swallow an abandoned read's rejection. The timer
 * is NOT unref'd (LIN-3200 removed that on purpose).
 */
function valueWithin(thunk, ms, fallback = null) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve().then(thunk).then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

/**
 * The default earlier-PR read: pull `[evidence]` artifacts from this ticket's
 * loop feedback (history plus live queue, the shared 30-day read horizon) and
 * hand the PR URLs to the bounded GitHub read. Never throws on the store side.
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
    const rows = [...(Array.isArray(live) ? live : []), ...(history?.items || [])];
    artifacts = parseEvidenceArtifacts(rows.flatMap((row) => (Array.isArray(row?.feedback) ? row.feedback : [])));
  } catch {
    artifacts = [];
  }
  return collectPrFiles(doFetch, { artifacts, ownerAllowlist: owners, now: nowMs });
}

/** A test-seam timeout: the override when it is a positive finite number, else the production constant. */
function timeoutOr(override, constant) {
  return Number.isFinite(override) && override > 0 ? override : constant;
}

/**
 * The pilot's decision for one dispatch: PREPEND a short file pointer to the
 * IMPLEMENTATION prompt only, on every second eligible implementation dispatch
 * (deterministic from the live ordinal). Returns `{ prompt, log }`; `log` is null
 * when the dispatch is not eligible, else the audit record for the caller to
 * print after the row is written.
 *
 * Runs after every guard and after `finalizePrompt`, so a refusal consumes no
 * ordinal and a failing pointer cannot orphan a minted credential. It runs
 * immediately before the row is written, so the only gap from the count that
 * decided the arm to the row's timestamp is synchronous work (the recount always
 * runs on the pointer path, even when the pointer came out empty, so the reads
 * no longer sit inside the gap). The step never throws and never refuses: any
 * failure leaves the prompt untouched (fail-open, residual R1), the control arm
 * does no further read, and no row field is added.
 */
async function pilotPrompt({
  store, urlKey, fields, kind, prompt, now, enabled,
  readPlanBlock, fetchPilotPrFiles, filePointerDoFetch, filePointerOwners, filePointerTimeouts
}) {
  const on = enabled === undefined ? isFilePointerPilotEnabled() : enabled === true;
  const eligible = on
    && kind === 'implementation'
    && isFresh(fields)
    && !!fields.issueIdentifier
    && typeof prompt === 'string' && prompt.length > 0
    && typeof store.countPilotEligible === 'function';
  if (!eligible) return { prompt, log: null };

  const nowMs = clockMs(now);
  const owners = filePointerOwners instanceof Set ? filePointerOwners : parseGitHubOwnerAllowlist();
  const doFetch = typeof filePointerDoFetch === 'function' ? filePointerDoFetch : globalThis.fetch;
  const readPrFiles = typeof fetchPilotPrFiles === 'function' ? fetchPilotPrFiles : defaultFetchPilotPrFiles;
  const countCap = timeoutOr(filePointerTimeouts?.count, COUNT_TIMEOUT_MS);
  const planCap = timeoutOr(filePointerTimeouts?.plan, PLAN_READ_TIMEOUT_MS);
  const stepCap = timeoutOr(filePointerTimeouts?.step, POINTER_STEP_TIMEOUT_MS);
  const countEligible = () => valueWithin(() => store.countPilotEligible(urlKey), countCap);

  let outPrompt = prompt;
  let c0 = null;
  let c1 = null;
  let arm = 'control';
  let delivered = false;
  let failOpen = false;
  let reason = null;
  let armDecidedAt = null;

  try {
    c0 = await countEligible();
    if (c0 == null) {
      failOpen = true;
      reason = 'c0-unavailable';
    } else {
      arm = selectPilotArm({ ordinal: c0 });
      if (arm === 'pointer') {
        // Plan read and earlier-PR read in parallel under one hard cap; any
        // failure or cap-hit delivers nothing.
        const ctx = { store, urlKey, issueIdentifier: fields.issueIdentifier, nowMs, doFetch, owners };
        const planRead = typeof readPlanBlock === 'function'
          ? valueWithin(() => readPlanBlock({ urlKey, issueIdentifier: fields.issueIdentifier }), planCap)
          : Promise.resolve(null);
        const prRead = valueWithin(() => readPrFiles(ctx), planCap);
        const reads = await valueWithin(() => Promise.all([planRead, prRead]), stepCap);
        const built = reads ? buildFilePointer({ planBlock: reads[0], prFiles: reads[1] }) : null;
        const pointerText = built ? built.text : null;

        c1 = await countEligible();
        if (c1 == null) {
          failOpen = true;
          reason = 'c1-unavailable';
        } else {
          arm = selectPilotArm({ ordinal: c1 });
          if (arm === 'pointer' && pointerText) {
            outPrompt = prependFilePointer(prompt, pointerText);
            delivered = true;
          }
        }
      }
      // The real clock, not the injected `now`: the gap is wall time.
      armDecidedAt = Date.now();
    }
  } catch {
    failOpen = true;
    reason = 'step-throw';
    arm = 'control';
    delivered = false;
  }

  return {
    prompt: outPrompt,
    log: { issueIdentifier: fields.issueIdentifier, c0, c1, arm, delivered, failOpen, reason, armDecidedAt }
  };
}

/**
 * One structured audit line per eligible pilot decision. NEVER relied on by the
 * arm rule and never stored: R1's fail-open rows can be listed from here when
 * the log is retained, but nothing depends on that.
 */
function logPilotDecision(log) {
  const gapMs = log.armDecidedAt != null ? Math.max(0, Date.now() - log.armDecidedAt) : null;
  console.log('[file-pointer]', JSON.stringify({
    issueIdentifier: log.issueIdentifier,
    c0: log.c0,
    c1: log.c1,
    arm: log.arm,
    delivered: log.delivered,
    failOpen: log.failOpen,
    reason: log.reason,
    gapMs
  }));
}

/**
 * Resolve + build a dispatch item and enqueue it via the store.
 *
 * @param {Object} params
 * @param {Object} params.store - The dispatch queue store (must expose `addItem`).
 * @param {string} params.urlKey - Workspace url key the item is scoped to.
 * @param {Object} [params.workspacePreferencesStore] - When present, blank
 *   `model`/`harness`/`effort` are filled from `dispatchDefaults` (per-kind
 *   override, then workspace-wide, then null). Absent: no inheritance.
 * @param {Object} [params.dispatchPresetsStore] - Dispatch presets store
 *   (LIN-1390); with `presetId`, the selected preset's `config` outranks both
 *   inherited-anchor and workspace-default routing.
 * @param {string} [params.presetId] - Selected preset id. An unknown id (the
 *   route layer rejects these first) resolves to "no preset" rather than throwing.
 * @param {string} [params.kind] - Explicit prompt kind; else derived from
 *   `fields.promptName` (falling back to the store's 'custom').
 * @param {string} [params.model] - Incoming model (may be blank/absent).
 * @param {string} [params.harness] - Incoming harness (may be blank/absent).
 * @param {string} [params.terminal] - Terminal-emulator driver name (LIN-2452).
 *   Pure passthrough: no preset, default, anchor inheritance or interpose. The
 *   runner owns the registry, validation and defaulting; blank/absent is null.
 * @param {string} [params.effort] - Incoming effort (LIN-2615; may be blank).
 * @param {boolean} [params.applyDefaultHarness=true] - Interpose `claude-code`
 *   (LIN-1159) when the resolved harness is still blank. The opt-out exists so a
 *   caller can be exempted without forking the field-build path, but the
 *   parent's convergence goal (LIN-1135) is uniform application.
 * @param {string} [params.prompt] - Base prompt for paths that don't finalize
 *   (collective, chat-tools). Ignored when `finalizePrompt` is supplied.
 * @param {(harness: string|null) => (Promise<{prompt: string, bootstrapToken?: string|null, grantDeclaration?: Object|null}>|{prompt: string, bootstrapToken?: string|null, grantDeclaration?: Object|null})} [params.finalizePrompt]
 *   Called once with the RESOLVED harness, after every guard, to produce the
 *   final prompt (and, for the claude-code MCP branch, a `bootstrapToken`, and
 *   for a declared launch (LIN-3138) a `grantDeclaration` record). This is where
 *   `attachProxyContext` runs, keeping harness-then-prompt-then-row ordering
 *   central. Its errors propagate unchanged.
 * @param {Object} [params.fields] - The remaining item fields (issue*, target,
 *   dispatchedBy, repo, force, abort*, cascade, sessionId, waitForFollowUps,
 *   queueIfBusy, subscription, followUpTo, promptName). The store null-coerces
 *   every optional field, so passing the union of what any caller needs is safe.
 * @param {(() => Promise<Object>)} [params.runGate] - Free-tier run-limit
 *   closure (LIN-3238); null means the lane is not gated.
 * @param {(() => number)|number|Date} [params.now=Date.now] - Clock injection for
 *   the guards' windows, mirroring `createDedupeCache`'s `now`.
 * @param {string} [params.composedRunMarker] - LIN-2775 Area 8: the scoped
 *   structural marker for a composed-run dispatch (a ruling reply's real agent
 *   brief, never a raw pressed-option label). Opaque; presence (not value)
 *   activates the terminal-anchor guard. Deliberately NOT named `terminal`.
 * @param {Function} [params.getWorkspaceAccessToken] - (urlKey) => Promise<string|null>.
 *   Required, with `fetchIssueContext`, for the terminal-anchor guard to run;
 *   absent either, the guard is SKIPPED.
 * @param {Function} [params.fetchIssueContext] - (token, identifier) => Promise<{issue}>.
 * @param {Object} [params.guardTaskDoneCache] - Test-injection seam for the
 *   terminal-anchor guard's cache (`{get}` from `createTaskDoneCache()`);
 *   defaults to this module's own persistent instance.
 * @param {Object} [params.dispatchTokenStore] - Consumer-token store, used ONLY
 *   to stamp `consumerLastSeenAt` (LIN-2885). Absent: the stamp skips it.
 * @param {Object} [params.proxyTokenStore] - LIN-3130: folds grant-bearing `take`
 *   (runner) tokens into the stamp so a runner-only workspace does not read
 *   "never polled". Absent: dispatch-token-only.
 * @param {boolean} [params.filePointerEnabled] - LIN-3200 pilot flag; defaults
 *   to `isFilePointerPilotEnabled()` (OFF). When false the row is unchanged.
 * @param {Function} [params.readPlanBlock] - `({urlKey, issueIdentifier}) =>
 *   Promise<string|null>`: the pointer's plan source. Capped at PLAN_READ_TIMEOUT_MS.
 * @param {Function} [params.fetchPilotPrFiles] - `(ctx) => Promise<Array<{repo,
 *   path}>>` for the earlier-PR half; defaults to the bounded GitHub read.
 * @param {Function} [params.filePointerDoFetch] - fetch seam for the default PR read.
 * @param {Set<string>} [params.filePointerOwners] - owner allowlist for the PR
 *   read; omitted means `parseGitHubOwnerAllowlist()`.
 * @param {{count?: number, plan?: number, step?: number}} [params.filePointerTimeouts] - test seam.
 * @returns {Promise<Object>} The created item, which is the store's own object
 *   (given a non-persisted `budgetPosition` under a declared budget).
 * @throws {Error} A tagged refusal (`err.duplicateDispatch` 409, `err.runLimit`
 *   429/503, `err.budgetExhausted` / `err.taskSessionRunaway` /
 *   `err.closeOutRefusal` / `err.anchorTerminalRefusal` 409,
 *   `err.composedRunMarkerInvalid` 400) before any side effect. `fields.force`
 *   bypasses ONLY the duplicate guard: a budget or quota any caller can wave
 *   through is advisory, not a bound.
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

  // 1. The effective kind keys dispatchDefaults/preset resolution and is the
  //    stored `kind`, so both agree.
  const effectiveKind = kind || deriveDispatchKind(fields.promptName);

  // 1.5 - 1.6. Refusal guards, in this order, all before the mint (see above).
  await guardDuplicate({ store, urlKey, fields, kind: effectiveKind, now });
  await guardRunLimit({ runGate, fields, kind: effectiveKind, now });

  const fresh = isFresh(fields);
  const budgetApplies = fresh
    && !!fields.issueIdentifier
    && typeof store.countDistinctTasksForSession === 'function';
  const closeOutApplies = fresh && effectiveKind === 'close-out';
  // A FRESH autopilot launched under a parent run's `sessionId` inherits that
  // run's `stopAt` (LIN-3245 / LIN-2949 P1a, N1).
  const inheritsStopAt = fresh && effectiveKind === 'autopilot';

  // The run row named by `fields.sessionId` serves the budget guard, the
  // close-out guard and stopAt inheritance, so it is read once and only when one
  // of them will use it (LIN-3245). A store without the read leaves it null: no
  // bound, no `stopAt`, nothing inherited, never a total dispatch outage.
  const run = (fields.sessionId
    && typeof store.getItemStatus === 'function'
    && (budgetApplies || closeOutApplies || inheritsStopAt))
    ? await readOrNull(() => store.getItemStatus(urlKey, fields.sessionId))
    : null;

  const budgetPosition = (budgetApplies && fields.sessionId)
    ? await guardBudget({ store, urlKey, fields, run })
    : null;
  guardCloseOut({ run, applies: closeOutApplies, sessionId: fields.sessionId });
  await guardComposedRun({
    marker: composedRunMarker,
    fields,
    urlKey,
    getWorkspaceAccessToken,
    fetchIssueContext,
    cache: guardTaskDoneCache
  });

  // 2. The anchor, read ONCE for issue-identity (LIN-1292) and preset-config
  //    (LIN-1390) inheritance. The store's status read resolves across the
  //    active queue AND history, which matters: by the time a descendant
  //    dispatches the kickoff anchor has usually been taken and archived, so a
  //    queue-only read would miss its `presetConfig` on every real run. Never
  //    contends with the run-row read above: both run only for a fresh row.
  const anchor = (fields.followUpTo && typeof store.getItemStatus === 'function')
    ? await readOrNull(() => store.getItemStatus(urlKey, fields.followUpTo))
    : null;

  // 3. The selected preset (LIN-1390). A stale id resolves to "no preset".
  const selectedPreset = (dispatchPresetsStore && presetId)
    ? await readOrNull(() => dispatchPresetsStore.get(urlKey, presetId))
    : null;

  // 4. - 5. Routing, anchor inheritance, preset snapshot.
  const routing = await resolveRouting({
    urlKey,
    kind: effectiveKind,
    model,
    harness,
    effort,
    preset: selectedPreset,
    anchor,
    workspacePreferencesStore,
    applyDefaultHarness
  });
  const inherited = inheritFromAnchor(fields, anchor);
  const { presetConfig, presetName } = presetSnapshot(effectiveKind, selectedPreset, anchor);

  // 7. Finalize the prompt with the RESOLVED harness (the ordering invariant),
  //    carrying back any structured bootstrap token (claude-code branch) and the
  //    declared-mint record (LIN-3138 / LIN-3134 Decision 11).
  let finalPrompt = prompt;
  let bootstrapToken = null;
  let grantDeclaration = null;
  if (typeof finalizePrompt === 'function') {
    const finalized = await finalizePrompt(routing.harness);
    finalPrompt = finalized?.prompt;
    bootstrapToken = finalized?.bootstrapToken ?? null;
    grantDeclaration = finalized?.grantDeclaration ?? null;
  }

  // 7.5. Consumer poll-recency stamp (LIN-2885): the latest poll/take across the
  //    workspace's consumer tokens. Read-only telemetry, NEVER a refusal: this
  //    dispatch enqueues whether or not anything is listening (a runner may come
  //    up later), and a failed read stamps null (docs/proxy-integration.md). It
  //    is stamped on the item so a LATER read can explain a stale queue; each
  //    caller derives its warning from the stamp via `buildConsumerPollWarning`,
  //    which keeps the one pure function rendering both the 201 and every read.
  //    Any rejection of the stamp read nulls the WHOLE stamp, because the cause
  //    (lib/consumer-poll-warning.js lets a sync throw or a plain return from one
  //    token store reject the whole call) is out of scope here: LIN-3581. Until
  //    that lands this wrapper stays, or a failure strands the credential just
  //    minted with no row.
  const consumerLastSeenAt = await readOrNull(
    () => getConsumerLastSeenAt(dispatchTokenStore, urlKey, proxyTokenStore)
  );

  // 7.6. File-pointer pilot (LIN-3200). Immediately before the enqueue, with no
  //    other await between its decision and the write.
  const pilot = await pilotPrompt({
    store,
    urlKey,
    fields,
    kind: effectiveKind,
    prompt: finalPrompt,
    now,
    enabled: filePointerEnabled,
    readPlanBlock,
    fetchPilotPrFiles,
    filePointerDoFetch,
    filePointerOwners,
    filePointerTimeouts
  });

  // 8. Build the full field set and enqueue; the store owns the canonical shape.
  //    LIN-3138 (LIN-3134 Decision 11): a declared record may only come from THIS
  //    factory's own finalize result, so any caller-supplied copy is stripped
  //    before the spread and the factory's own is re-added after it. A refusal is
  //    written only by the wake path. An undeclared dispatch adds neither key,
  //    keeping the argument (and the persisted doc) byte-identical to
  //    pre-LIN-3138.
  const callerFields = { ...fields };
  delete callerFields.grantDeclaration;
  delete callerFields.grantRefusal;
  const item = await store.addItem(urlKey, {
    ...callerFields,
    ...inherited,
    // Child-autopilot inheritance (LIN-3245 / LIN-2949 P1a, N1): only when the
    // caller supplied no `stopAt` of its own; absent entirely on the dormant
    // path, so the argument stays byte-identical when no boundary is in play.
    ...(inheritsStopAt && fields.stopAt == null && run?.stopAt === 'pr' ? { stopAt: 'pr' } : {}),
    prompt: pilot.prompt,
    kind: effectiveKind,
    model: routing.model,
    harness: routing.harness,
    // LIN-2452: payload passthrough only, deliberately not resolved above.
    terminal: terminal || null,
    effort: routing.effort,
    presetConfig,
    presetName,
    bootstrapToken,
    consumerLastSeenAt,
    // Pinned AFTER every spread: only the factory's own finalize result sets it.
    ...(grantDeclaration != null ? { grantDeclaration } : {})
  });

  // LIN-2934: the non-persisted budget position, attached to the returned item
  // only (never stored) so the 201 can echo "n of N" on admission.
  if (budgetPosition) {
    item.budgetPosition = budgetPosition;
  }
  if (pilot.log) logPilotDecision(pilot.log);
  return item;
}
