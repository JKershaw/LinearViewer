/**
 * lib/unanswered-decisions.js
 *
 * Pure module (LIN-1728): "does this loop carry a decision with no recorded
 * answer" — the ONE predicate the ambient nav count and the filtered rulings
 * view both read, instead of independently re-deriving the same fact and
 * risking the disagreement this epic already contains once (`loopIsWaiting`
 * vs `deriveLifecycleStatus` on a `[blocked]`-then-`[done]` lineage).
 *
 * Deliberately separate from `loopIsWaiting` (routes/dashboard.js) — a
 * decision is orthogonal to both terminality and to "waiting" (`hook.js`'s
 * complete-path decision emission routinely lands on a terminal, non-waiting
 * loop) — this module never widens or imports that predicate.
 *
 * No I/O, `now` injected throughout, importing nothing from loopIsWaiting.
 */

import { computeSupersededLoopIds } from './loop-supersede.js';

// Mirrors simple-dispatcher's REAP_INACTIVITY_MS (config.js): a terminal
// session is reaped after this long of inactivity with no live child. The
// two repos share no config source of truth, so this is a duplicated
// constant, not an import — the drift risk this creates is tracked as
// LIN-2201 rather than fixed here (routed-around contract gap, small and
// self-limiting: a mislabeled reply-button action, backstopped by SD's own
// async `no-session` rejection when the guess is wrong).
const REAP_INACTIVITY_MS = 21600000; // 6h

/**
 * Resolve a loop's press-time reply disposition — a TOTAL mapping (LIN-1728
 * Revision 3, F8): every loop state maps to exactly one of four
 * dispositions, resolved fresh at press time and never stored (liveness
 * decays, so a stored flag would lie to the operator by the time they act
 * on it).
 *
 *   - `resumable` — permanently-parked-blocked (never reaped while
 *     `[blocked]`) OR freshly terminal within the reap window. Both take
 *     simple-dispatcher's plain no-force `resume` branch
 *     (`followup.js`'s `resolveFollowUpTarget`: a terminal loop is not an
 *     active phase, so `!active` and `forced: false`) — same button, same
 *     no-force follow-up, so they share one disposition.
 *   - `gone` — terminal, past the reap window. "Reply & start a run" is a
 *     different action, labelled honestly as such by the call site.
 *   - `mid-turn` — non-terminal, actively running. Hold rather than collide
 *     with a live writer.
 *   - `indeterminate` — the residual non-terminal/non-blocked/non-running
 *     case (e.g. a lean loop mid-transition between agent states).
 *     Read-only, distinct wording from `mid-turn` at the call site.
 *
 * @param {{terminalStatus?: string|null, terminalCompletedAt?: string|Date|null, wakeMarker?: string|null, agentState?: string|null}} loop
 * @param {{now: Date}} opts
 * @returns {'resumable'|'gone'|'mid-turn'|'indeterminate'}
 */
export function resolveDisposition(loop, { now }) {
  if (!loop.terminalStatus && loop.wakeMarker === 'blocked') return 'resumable';
  if (loop.terminalStatus) {
    const completedAtMs = loop.terminalCompletedAt ? new Date(loop.terminalCompletedAt).getTime() : NaN;
    const age = Number.isFinite(completedAtMs) ? now.getTime() - completedAtMs : Infinity;
    return age <= REAP_INACTIVITY_MS ? 'resumable' : 'gone';
  }
  if (loop.agentState === 'running') return 'mid-turn';
  return 'indeterminate';
}

const ON_ANSWER_EFFECT_DEFAULTS = { gone: 'dispatch', 'task-bound': 'record' };

/**
 * Derive a rulings row's `effect` — what happens when the operator answers —
 * kept strictly separate from `disposition` (LIN-2773 Area 3), which governs
 * only whether/how a reply can be delivered. Pure: no I/O, no loop-document
 * write (the row's `decision.on_answer`, added by Area 1, is the only
 * persisted form; `effect` here is always DERIVED fresh, never baked back
 * onto anything stored).
 *
 * Precedence, evaluated in this exact order — evidence overrides
 * declaration, never the reverse:
 *   1. `disposition === 'resumable'` → always `'resume'`, unconditional.
 *      `resolveDisposition` already merges permanently-parked-blocked and
 *      freshly-terminal-within-the-reap-window into this one value, so this
 *      single branch carries both hard overrides. A wrong resume costs a
 *      click; a wrong dispatch costs a run.
 *   2. `disposition === 'gone'` AND `anchorTerminal === true` → `'record'`.
 *      A `[failed] no live session to resume` reply would land nowhere
 *      useful once the anchor itself is done — recording the answer is the
 *      only sound action.
 *   3. `liveDispatchOnAnchor === true` → `'record'`. A live run already
 *      exists on this anchor; dispatching a second one would race it.
 *   4. Otherwise: `gone`/`task-bound` take the declared
 *      `decision.on_answer.effect` when present, else today's untouched
 *      default (`gone` → `dispatch`, `task-bound` → `record`).  `mid-turn`
 *      and `indeterminate` — the two READ-ONLY dispositions — never surface
 *      a declared effect: they return `effect: null`, so the call site's
 *      caption falls through to `DISPOSITION_CAPTIONS[disposition]`. A row
 *      that cannot act must never imply it can.
 *
 * `anchorTerminal`/`liveDispatchOnAnchor` are `undefined`, not `false`, when
 * a caller doesn't have the signal — the branch that reads it is SKIPPED,
 * never defaulted dangerous-side. Branch 3's `liveDispatchOnAnchor` override
 * is NOT gated on disposition — it fires for `mid-turn`/`indeterminate` rows
 * too, and is checked before branch 4. A `mid-turn` row's own loop is
 * non-terminal by construction, so it always self-matches in both feeds that
 * inject the predicate (`routes/dashboard.js:1537`, `routes/proxy-rulings.js:131`).
 * Branch 4's `null` is therefore reachable only when no caller injects the
 * predicate at all, or injects one that returns `false` for this specific row.
 *
 * `alternate` is `null` for every hard-override branch (1-3) BY
 * CONSTRUCTION — evidence wins outright there, there is no "other choice"
 * to surface. Inside branch 4 it names the untaken option only when the
 * declared effect and today's default genuinely diverge (a real choice
 * existed); when they agree, or nothing was declared, there is nothing
 * alternate to show and it stays `null` too.
 *
 * LIN-2773 Area 3 boundary: this beat introduces the function and calls it
 * from both `rows.push` sites below with `anchorTerminal`/
 * `liveDispatchOnAnchor` omitted (always `undefined` here) — neither this
 * pure module nor its callers can compute either signal without reading the
 * in-memory loop set a route already holds, which is Area 4's beat.
 *
 * @param {Object|null|undefined} decision - the row's `decision` (may carry `on_answer.effect`, added by Area 1)
 * @param {string} disposition - one of resolveDisposition's four values, or `'task-bound'`
 * @param {{anchorTerminal?: boolean, liveDispatchOnAnchor?: boolean}} [opts]
 * @returns {{effect: 'resume'|'dispatch'|'record'|null, declaredEffect: string|null, alternate: string|null}}
 */
export function resolveEffect(decision, disposition, { anchorTerminal, liveDispatchOnAnchor } = {}) {
  const declaredEffect = decision?.on_answer?.effect ?? null;

  if (disposition === 'resumable') {
    return { effect: 'resume', declaredEffect, alternate: null };
  }
  if (disposition === 'gone' && anchorTerminal === true) {
    return { effect: 'record', declaredEffect, alternate: null };
  }
  if (liveDispatchOnAnchor === true) {
    return { effect: 'record', declaredEffect, alternate: null };
  }
  if (disposition === 'mid-turn' || disposition === 'indeterminate') {
    return { effect: null, declaredEffect, alternate: null };
  }

  const defaultEffect = ON_ANSWER_EFFECT_DEFAULTS[disposition] ?? null;
  if (defaultEffect == null) {
    // Defensive only: resolveDisposition's four values plus the fixed
    // 'task-bound' assignment below are the only dispositions this module
    // ever produces, so branch 4 is never reached with anything else in
    // practice. Fail closed exactly like the two named read-only
    // dispositions above rather than guess at a default for an unknown one.
    return { effect: null, declaredEffect, alternate: null };
  }
  if (declaredEffect && declaredEffect !== defaultEffect) {
    return { effect: declaredEffect, declaredEffect, alternate: defaultEffect };
  }
  return { effect: defaultEffect, declaredEffect, alternate: null };
}

/**
 * `resumable`/`gone` both admit a reply (a different action under the hood);
 * `mid-turn`/`indeterminate` are read-only. `task-bound` (LIN-2197 Phase 3)
 * always admits a reply too — its answer path is the always-available
 * issue-keyed `POST /workspace/:urlKey/api/comments/:issueId`, not a
 * session-dependent resume, so it is structurally bounded rather than
 * liveness-dependent like a loop's `resumable`/`gone`.
 */
function canReplyFor(disposition) {
  return disposition === 'resumable' || disposition === 'gone' || disposition === 'task-bound';
}

function taskDecisionScannedAtMs(entry) {
  const raw = entry && entry.scannedAt;
  if (raw instanceof Date) return raw.getTime();
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * A task-decision row's anchor, normalised into the same shape a loop's
 * anchor carries — except `loopId` is always `null` (no dispatch item backs
 * a scan) and `target`/`followUpTo` are always `null` (a task decision has
 * neither a run target nor a follow-up lineage). `taskDecisionId` is an
 * additive field with no loop-anchor counterpart, carrying the scan store's
 * own record id so a reply/dismiss action can address the exact row.
 */
function taskDecisionAnchor(entry) {
  return {
    loopId: null,
    issueId: entry.issueId || null,
    issueIdentifier: entry.issueIdentifier || null,
    workspaceUrlKey: entry.urlKey || null,
    target: null,
    followUpTo: null,
    taskDecisionId: entry.id || null
  };
}

/**
 * The ONE answered-decision predicate (LIN-2671): a loop's `decision` has been
 * answered when its own pre-derived `answeredDecisionId` names the CURRENT
 * decision's `decision_id`. Exported so the observer census
 * (`lib/observer-sweep.js`'s `classifyLoop`) discharges a blocked lifecycle on
 * exactly this fact rather than re-deriving a second comparison that could
 * drift from the rulings feed's.
 *
 * The comparison is deliberately id-based rather than "an answer exists at
 * all": a newer decision posted after an older one was answered carries the
 * OLD id in `answeredDecisionId`, so the ids diverge and the row stays
 * unanswered — the same rule the loop branch below applies.
 *
 * A loop with no `decision` is never answered (`decision: null` is the
 * ordinary no-decision row, not an answered one); neither is one whose
 * `answeredDecisionId` is `null`. Requiring a non-empty `decision_id` keeps a
 * malformed `{decision_id: null}` from falsely matching a `null` answer.
 *
 * @param {{decision?: Object|null, answeredDecisionId?: string|null}|null|undefined} loop
 * @returns {boolean}
 */
export function isDecisionAnswered(loop) {
  const decisionId = loop?.decision?.decision_id;
  return Boolean(decisionId) && loop.answeredDecisionId === decisionId;
}

/**
 * Collect every unanswered decision across `loops` and `taskDecisions`
 * (LIN-2197's task-keyed decision producer, which has no dispatch item
 * behind it — a human-triggered scan of a task's description/comments/
 * subtask state). `taskDecisions` defaults to `[]`, the trivial no-op case.
 *
 * A loop's decision counts as unanswered when: the loop carries a decision,
 * the loop is not superseded by a later follow-up loop within this same
 * input set (`computeSupersededLoopIds` — see its own input-scope contract:
 * loopIds are globally unique dispatch-history ids, so a merged
 * cross-workspace set is safe here), and the loop's own `answeredDecisionId`
 * does not match the decision's own `decision_id` — a newer, still-unanswered
 * decision posted after an older one was answered stays unanswered.
 *
 * Each `taskDecisions` entry is a `lib/task-decisions-store.js` record
 * (`{id, urlKey, issueId, issueIdentifier, decision, scannedAt, outcome}`).
 * A task-decision entry counts as unanswered when: it carries a non-null
 * `decision` (a stored `decision: null` is a persisted *zero-finding* scan —
 * nothing to rule on, not the absence of a scan), it carries no `outcome`
 * (`'answered'`/`'dismissed'` are both terminal — resolved, not unanswered),
 * and it is the most-recently-scanned entry for its `(urlKey, issueId)` pair
 * in this input set — an older row for the same task is superseded by a
 * newer scan even when both are otherwise decision-bearing and unanswered,
 * mirroring the loop branch's own `computeSupersededLoopIds` treatment.
 * `resolveDisposition` is not consulted for task decisions — they get their
 * own fixed `'task-bound'` disposition, assigned here rather than folded
 * into that (loop-shaped, four-way) total mapping.
 *
 * A THIRD input, `shelvedRulings` (LIN-1727) — raw records from
 * `lib/shelved-rulings-store.js`, one per `(urlKey, decisionId)` that has
 * ever been shelved. A decision whose shelf row is still ACTIVE
 * (`resurfaceAt` in the future) is excluded from the result entirely — the
 * whole point of a shelve is to declutter the queue until it re-surfaces.
 * Once `resurfaceAt` passes, the row is included again like any other
 * unanswered decision (shelving never mutates the underlying answer state),
 * carrying `shelvedLapseCount` so the UI can flag a decision that keeps
 * getting shelved and re-lapsing rather than actually decided
 * (docs/escalation-philosophy.md §4/§6: repeated lapses should raise
 * priority, not be silently tolerated forever).
 *
 * A FOURTH opt, `liveDispatchOnAnchor` (LIN-2773 Area 4) — an optional
 * `(issueIdentifier) => boolean` predicate, called once per row with that
 * row's own anchor `issueIdentifier` and threaded straight into
 * `resolveEffect`'s branch 3 (a live run already exists on this anchor,
 * forcing `effect: 'record'`). This module stays pure and reads no loop set
 * of its own to answer it — the caller (a route) already holds the full
 * merged loop set in memory and owns its own notion of "terminal" (e.g.
 * `routes/dashboard.js`'s `isTerminalLoop`), so the predicate is built and
 * injected there. Omitted (the default), it is simply never called — every
 * row's `liveDispatchOnAnchor` stays `undefined` and branch 3 is skipped,
 * exactly like every other opt this function already tolerates missing.
 * `anchorTerminal` (resolveEffect's branch 2) is NOT threaded through here
 * at all: no opt, no call site — that read belongs to a later subtask
 * (S3), and the ambient `/api/dashboard/rulings` poll must never evaluate
 * it structurally, not merely by omission at any one call site.
 *
 * A FIFTH input, `newestScanByTask` (LIN-2729 / LIN-2893 Step 5) — the
 * `lib/task-decisions-store.js` `listNewestScanPerTask` result: an object
 * keyed `${urlKey}::${issueId}` (the SAME key format the `latestByTask`
 * reduction below already uses) whose value is that task's true newest scan
 * row, regardless of outcome. `taskDecisions` above is already the
 * `outcome:null`-filtered candidate set, so a task's true newest row is
 * invisible to `latestByTask` whenever it is outcome-bearing, letting an
 * older, still-unanswered row win the reduction (LIN-2729). `newestScanByTask`
 * restores newest-then-filter: a candidate is dropped only when its task's
 * true newest row is ITSELF outcome-bearing and strictly newer than the
 * candidate's own `scannedAt` — a newer zero-finding row is never grounds to
 * drop it (see the reduction below). Omitted (the default, `{}`), no
 * candidate is ever dropped by this input — the reduction behaves exactly as
 * it did before this input existed.
 *
 * @param {{loops?: Array<Object>, taskDecisions?: Array<Object>, shelvedRulings?: Array<Object>, newestScanByTask?: Object<string, {urlKey: string, issueId: string, outcome: string|null, scannedAt: *}>}} input
 * @param {{now: Date, liveDispatchOnAnchor?: (issueIdentifier: string|null) => boolean|undefined}} opts
 * @returns {Array<{decision: Object, decisionCase: Array<string>, anchor: Object, disposition: string, canReply: boolean, shelvedLapseCount: number, effect: string|null, declaredEffect: string|null, alternate: string|null}>}
 */
export function collectUnansweredDecisions(
  { loops = [], taskDecisions = [], shelvedRulings = [], newestScanByTask = {} } = {},
  { now, liveDispatchOnAnchor } = {}
) {
  const effectiveNow = now instanceof Date ? now : new Date();
  const resolveLiveDispatchOnAnchor = typeof liveDispatchOnAnchor === 'function'
    ? (issueIdentifier) => liveDispatchOnAnchor(issueIdentifier)
    : () => undefined;
  const superseded = computeSupersededLoopIds(loops);

  // LIN-2756: two tiers, matching lib/shelved-rulings-store.js's own two
  // possible `_id` shapes. `shelfByKey` holds LOOP-SCOPED shelves (a real
  // `decisionLoopId` was given) — indexed ONLY under their full 3-segment
  // key, never also under the bare (urlKey, decisionId) pair, or a shelve
  // aimed at one loop would leak onto every OTHER loop sharing that
  // decisionId — precisely the collision this ticket exists to fix.
  // `shelfByLegacyKey` holds workspace-wide shelves (decisionLoopId omitted
  // — either a pre-LIN-2756 row or a deliberately wide one) under the
  // (urlKey, decisionId) pair; `shelfGate` checks a row's own loop-scoped
  // key first and falls back to the legacy/wide one only when no
  // loop-specific shelf exists for that row.
  const shelfByKey = new Map();
  const shelfByLegacyKey = new Map();
  for (const shelf of shelvedRulings) {
    if (!shelf?.urlKey || !shelf?.decisionId) continue;
    if (shelf.decisionLoopId) {
      shelfByKey.set(`${shelf.urlKey}::${shelf.decisionLoopId}::${shelf.decisionId}`, shelf);
    } else {
      shelfByLegacyKey.set(`${shelf.urlKey}::${shelf.decisionId}`, shelf);
    }
  }
  // Returns null when actively shelved (caller must exclude the row), else
  // the lapse count to attach (0 when never shelved). `loopKey` is the
  // row's own `loopId ?? taskDecisionId` (LIN-2756) — decisionId alone is
  // agent-invented free text and not globally unique even within one
  // workspace, so two loops (or two workspaces) can share one without a
  // shelve on one silently suppressing an unrelated, unshelved decision.
  //
  // Precedence is by PRESENCE, not by standing: the row's own loop-scoped
  // shelf wins whenever one exists — lapsed or not — and only its own
  // activeness is checked; the legacy/workspace-wide shelf is consulted only
  // when no loop-scoped shelf exists at all. This is NOT the same axis as
  // `lib/dismissal-suggestions-store.js`'s `attachStandingSuggestions`/
  // `withdraw` (which via `pickStandingDoc` prefer whichever of scoped/
  // legacy is still STANDING, scoped first) — a lapsed loop-scoped shelf
  // here can and does override a still-active legacy one (LIN-2756 F4;
  // pinned by "a LAPSED loop-scoped shelf overrides a still-ACTIVE legacy
  // one" in tests/unit/unanswered-decisions.test.js). Whether that's the
  // right product semantics is open — see the F4 follow-up ticket.
  function shelfGate(urlKey, loopKey, decisionId) {
    const shelf = (loopKey && shelfByKey.get(`${urlKey}::${loopKey}::${decisionId}`))
      || shelfByLegacyKey.get(`${urlKey}::${decisionId}`);
    if (!shelf) return 0;
    const resurfaceMs = new Date(shelf.resurfaceAt).getTime();
    if (Number.isFinite(resurfaceMs) && resurfaceMs > effectiveNow.getTime()) return null; // still shelved
    return shelf.lapseCount || 0;
  }

  const rows = [];
  for (const loop of loops) {
    if (!loop || !loop.decision) continue;
    if (superseded.has(loop.loopId)) continue;
    if (isDecisionAnswered(loop)) continue;
    const shelvedLapseCount = shelfGate(loop.workspaceUrlKey, loop.loopId, loop.decision.decision_id);
    if (shelvedLapseCount === null) continue; // actively shelved

    const disposition = resolveDisposition(loop, { now: effectiveNow });
    const { effect, declaredEffect, alternate } = resolveEffect(loop.decision, disposition, {
      liveDispatchOnAnchor: resolveLiveDispatchOnAnchor(loop.issueIdentifier || null)
    });
    rows.push({
      decision: loop.decision,
      decisionCase: loop.decisionCase || [],
      anchor: {
        loopId: loop.loopId,
        issueId: loop.issueId || null,
        issueIdentifier: loop.issueIdentifier || null,
        workspaceUrlKey: loop.workspaceUrlKey || null,
        target: loop.target || null,
        followUpTo: loop.followUpTo || null
      },
      disposition,
      canReply: canReplyFor(disposition),
      shelvedLapseCount,
      effect,
      declaredEffect,
      alternate
    });
  }

  // Task decisions: only the most-recently-scanned entry per (urlKey, issueId)
  // is "live" — an older row for the same task is superseded by a newer scan,
  // regardless of that older row's own decision/outcome content.
  const latestByTask = new Map();
  for (const entry of taskDecisions) {
    if (!entry) continue;
    const key = `${entry.urlKey || ''}::${entry.issueId || ''}`;
    const existing = latestByTask.get(key);
    if (!existing || taskDecisionScannedAtMs(entry) > taskDecisionScannedAtMs(existing)) {
      latestByTask.set(key, entry);
    }
  }
  for (const entry of latestByTask.values()) {
    if (!entry.decision) continue; // persisted zero-finding: nothing to rule on
    if (entry.outcome) continue; // 'answered'/'dismissed': resolved, not unanswered
    // LIN-2729: `taskDecisions` (above) is already the `outcome:null`-filtered
    // candidate set, so `latestByTask` only ever picks the newest row AMONG
    // unanswered rows — when a task's true newest scan is outcome-bearing, it
    // was filtered out upstream and never reached this reduction, letting an
    // older unanswered row win and resurface. `newestScanByTask` is the
    // unfiltered, narrow-projection view of every task's true newest row, so
    // newest-then-filter is restored here rather than in the query: drop this
    // candidate only when its task's true newest row is ITSELF outcome-bearing
    // (a newer *zero-finding* row is explicitly NOT grounds to drop it — a
    // rescan that finds nothing must never silently discharge a still-open
    // ruling) AND strictly newer than this candidate's own `scannedAt`. Do
    // not "simplify" this to "any newer row wins".
    const newestScan = newestScanByTask[`${entry.urlKey || ''}::${entry.issueId || ''}`];
    if (newestScan && newestScan.outcome && taskDecisionScannedAtMs(newestScan) > taskDecisionScannedAtMs(entry)) {
      continue;
    }
    const shelvedLapseCount = shelfGate(entry.urlKey, entry.id, entry.decision.decision_id);
    if (shelvedLapseCount === null) continue; // actively shelved

    const { effect, declaredEffect, alternate } = resolveEffect(entry.decision, 'task-bound', {
      liveDispatchOnAnchor: resolveLiveDispatchOnAnchor(entry.issueIdentifier || null)
    });
    rows.push({
      decision: entry.decision,
      decisionCase: [],
      anchor: taskDecisionAnchor(entry),
      disposition: 'task-bound',
      canReply: canReplyFor('task-bound'),
      shelvedLapseCount,
      effect,
      declaredEffect,
      alternate
    });
  }

  return rows;
}
