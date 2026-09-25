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

// LIN-3021: the canonical scoped ruling-ref key, extracted verbatim from the
// inline construction shared by `shelfByKey`/`shelfGate` below and
// `lib/dismissal-suggestions-store.js`'s `byKey`/`attachStandingSuggestions`
// — the exact duplicated-key pattern LIN-2262/LIN-2756 both had to fix. Never
// falls back to a bare-`decisionId` or two-part key; that fallback stays the
// caller's own explicit legacy branch (see those callers).
export function buildRulingRef({ urlKey, loopId, taskDecisionId, decisionId }) {
  if (!urlKey || !decisionId) return null;
  const hasLoop = loopId != null && loopId !== '';
  const hasTask = taskDecisionId != null && taskDecisionId !== '';
  if (hasLoop === hasTask) return null; // neither, or both — ambiguous/no scope
  return `${urlKey}::${hasLoop ? loopId : taskDecisionId}::${decisionId}`;
}

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

// Mirrors taskDecisionScannedAtMs's tolerant-parse discipline — used by
// collectUnansweredDecisions's contentLoop selection (LIN-2991/LIN-3022 §2)
// to find the latest-dispatched member of a decision group.
function _dispatchedAtMs(loop) {
  const raw = loop && loop.dispatchedAt;
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
 * The ONE answered-decision predicate (LIN-2671), rewritten for LIN-3022/
 * LIN-2991 Surface 2 from scalar equality to SET membership over the loop's
 * own `answeredDecisions` (lib/digest-feedback.js's `resolvedDecisionEvents`,
 * every distinct `decision_id` this loop has ever been stamped for) — never
 * the legacy scalar `answeredDecisionId`, which the last stamp on this loop
 * alone could overwrite and lose an earlier one. Same signature, same total
 * mapping, still the ONLY definition. Exported so the observer census
 * (`lib/observer-sweep.js`'s `classifyLoop`, via `isDecisionAnsweredInLineage`
 * below) discharges a blocked lifecycle on exactly this fact rather than
 * re-deriving a second comparison that could drift from the rulings feed's.
 *
 * The comparison is deliberately id-based rather than "an answer exists at
 * all": a newer decision posted after an older one was answered has a
 * DIFFERENT `decision_id`, which the set does not contain yet, so the row
 * stays unanswered — the same rule the set-membership check below applies at
 * lineage scope.
 *
 * A loop with no `decision` is never answered (`decision: null` is the
 * ordinary no-decision row, not an answered one); neither is one whose
 * `answeredDecisions` is empty or absent. Requiring a non-empty `decision_id`
 * keeps a malformed `{decision_id: null}` from falsely matching a stamp
 * that (in principle) recorded a null id.
 *
 * @param {{decision?: Object|null, answeredDecisions?: Array<{decisionId: string}>}|null|undefined} loop
 * @returns {boolean}
 */
export function isDecisionAnswered(loop) {
  const decisionId = loop?.decision?.decision_id;
  return Boolean(decisionId) && Array.isArray(loop.answeredDecisions) &&
    loop.answeredDecisions.some(e => e.decisionId === decisionId);
}

/**
 * `Map<lineageId, Set<decisionId>>` — the UNION of every member loop's own
 * `answeredDecisions` set within a lineage, keyed `loop.lineageId ?? loop.
 * loopId` (a loop with no lineage is its own lineage of one, mirroring
 * `lib/pipeline-loops.js`'s own `item.rootItemId ?? loop.loopId` derivation
 * of `lineageId`). This is the LIN-2991 C1/D1 fix: because it unions every
 * member's stamps rather than reading one loop's last stamp, a lineage where
 * `x` was answered on one loop and `y` later answered on another (or the
 * same) member reports BOTH correctly, in either order — no member's
 * classification is ever overwritten by a sibling's later, unrelated answer.
 *
 * @param {Array<Object>} loops
 * @returns {Map<string, Set<string>>}
 */
export function answeredDecisionIdsByLineage(loops) {
  const map = new Map();
  for (const loop of loops) {
    const entries = Array.isArray(loop?.answeredDecisions) ? loop.answeredDecisions : [];
    if (!entries.length) continue;
    const lineageId = loop.lineageId ?? loop.loopId;
    if (!map.has(lineageId)) map.set(lineageId, new Set());
    for (const e of entries) map.get(lineageId).add(e.decisionId);
  }
  return map;
}

/**
 * Lineage-aware sibling of `isDecisionAnswered` above (LIN-2991 design step
 * 4/R6). `classifyLoop` (`lib/observer-sweep.js`) and `collectUnansweredDecisions`
 * below both call this, never `isDecisionAnswered` directly, once a
 * `answeredByLineage` map is available — this is the ONE place that decides
 * whether to consult the wider lineage or fall back to a loop's own set.
 *
 * `answeredByLineage` ABSENT (not passed at all, `undefined`/`null`) means
 * the caller isn't doing lineage-wide grouping — fall back to the loop's OWN
 * answered set (`isDecisionAnswered(loop)`). A map PRESENT but with no entry
 * for this lineage is a real "no one in this lineage has answered" fact and
 * must NOT fall back — that is why this checks `!answeredByLineage` (map
 * absent) and never `!answeredByLineage.has(lineageId)` (map present,
 * lineage absent).
 *
 * This is what makes every caller that does not thread `answeredByLineage` —
 * present or future — correct BY CONSTRUCTION, without needing to be
 * individually found and threaded (A3: `scripts/fossil-pass-lin2633.js`'s
 * `selectFossilRows` relies on exactly this). The fallback safely NARROWS
 * eligibility relative to today's scalar `isDecisionAnswered` check — set
 * membership accepts a superset of what scalar equality accepted, so a loop
 * whose current `decision_id` matches an EARLIER stamp but not the most
 * recent one now resolves (`resolved`) rather than staying `blocked`/eligible
 * — it does not "reproduce today's exact behaviour". The named limitation is
 * unchanged either way: an unmapped caller still cannot see an answer on a
 * SIBLING loop in the same lineage.
 *
 * @param {{decision?: Object|null, lineageId?: string, loopId?: string, answeredDecisions?: Array}|null|undefined} loop
 * @param {Map<string, Set<string>>|null|undefined} answeredByLineage
 * @returns {boolean}
 */
export function isDecisionAnsweredInLineage(loop, answeredByLineage) {
  const decisionId = loop?.decision?.decision_id;
  if (!decisionId) return false;
  if (!answeredByLineage) return isDecisionAnswered(loop);
  const lineageId = loop?.lineageId ?? loop?.loopId;
  return Boolean(answeredByLineage.get(lineageId)?.has(decisionId));
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
 * A SIXTH opt, `includeResolved` (LIN-2991/LIN-3022 §3) — when true, a
 * LOOP-BACKED group that the lineage-wide answered map discharges is not
 * dropped; it is pushed with an added `resolution` field instead (see the
 * group-processing loop below). Task-bound rows are unaffected either way —
 * `includeResolved` covers loop rulings only, never the task-decision branch.
 * An answered group is also exempted from the content-loop supersession skip
 * below (LIN-2991 corrective fix) — a root-raised decision answered on the
 * root and later superseded by an unrelated reply (the live LIN-2985 shape)
 * would otherwise vanish from `includeResolved` too, hiding the very row an
 * agent needs to see to avoid re-raising it. The default (unanswered) read
 * is untouched: that exemption only ever fires for a group `includeResolved`
 * already chose to keep.
 *
 * `resolution.outcome` can be `null` for a row synthesized from a
 * pre-answered-set-redesign ("legacy") digest — one carrying only the old
 * scalar `answeredDecisionId` with no `answeredDecisions` array at all (the
 * `_loopFactsFromDigest` legacy fallback). That scalar never recorded
 * whether the answer was `'answered'` or `'dismissed'`, so a caller must not
 * assume `resolution.outcome` is always one of those two strings — treat
 * `null` as "answered, outcome unknown", not as a missing/invalid row.
 *
 * @param {{loops?: Array<Object>, taskDecisions?: Array<Object>, shelvedRulings?: Array<Object>, newestScanByTask?: Object<string, {urlKey: string, issueId: string, outcome: string|null, scannedAt: *}>}} input
 * @param {{now: Date, liveDispatchOnAnchor?: (issueIdentifier: string|null) => boolean|undefined, includeResolved?: boolean}} opts
 * @returns {Array<{decision: Object, decisionCase: Array<string>, anchor: Object, stampLoopId: string|null, disposition: string, canReply: boolean, shelvedLapseCount: number, effect: string|null, declaredEffect: string|null, alternate: string|null, resolution?: {decisionId: string, raisedAt: string|null, resolvedAt: string|null, outcome: string|null}|null}>}
 */
export function collectUnansweredDecisions(
  { loops = [], taskDecisions = [], shelvedRulings = [], newestScanByTask = {} } = {},
  { now, liveDispatchOnAnchor, includeResolved = false } = {}
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
      shelfByKey.set(buildRulingRef({ urlKey: shelf.urlKey, loopId: shelf.decisionLoopId, decisionId: shelf.decisionId }), shelf);
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
    const shelf = shelfByKey.get(buildRulingRef({ urlKey, loopId: loopKey, decisionId }))
      || shelfByLegacyKey.get(`${urlKey}::${decisionId}`);
    if (!shelf) return 0;
    const resurfaceMs = new Date(shelf.resurfaceAt).getTime();
    if (Number.isFinite(resurfaceMs) && resurfaceMs > effectiveNow.getTime()) return null; // still shelved
    return shelf.lapseCount || 0;
  }

  // LIN-2991/LIN-3022 §2: three passes over the already-fetched `loops` array
  // (no new read) — grouping is READ-TIME ONLY, never a storage re-key and
  // never a change to per-loop identity.
  //
  // Pass 1: the lineage-wide answered-decision map, reused as-is for the
  // group discharge check below — never a second, forked derivation.
  const answeredByLineage = answeredDecisionIdsByLineage(loops);

  // Pass 2: bucket every decision-bearing loop into a group keyed
  // `${lineageId ?? loopId}::${decisionId}`. The `?? loopId` fallback is
  // REQUIRED, not cosmetic — a loop with no `lineageId` field at all (every
  // pre-this-plan fixture, and the LIN-2756 pins at
  // tests/unit/unanswered-decisions.test.js) must keep grouping by its own
  // `loopId` alone, exactly as before this change.
  const groups = new Map();
  for (const loop of loops) {
    if (!loop || !loop.decision) continue;
    const lineageId = loop.lineageId ?? loop.loopId;
    const decisionId = loop.decision.decision_id;
    const key = `${lineageId}::${decisionId}`;
    let group = groups.get(key);
    if (!group) {
      group = { lineageId, decisionId, members: [] };
      groups.set(key, group);
    }
    group.members.push(loop);
  }

  const rows = [];
  for (const { lineageId, decisionId, members } of groups.values()) {
    // Discharge the whole group when the lineage-wide map has this decision
    // — a stamp on ANY member (not just this group's contentLoop candidate)
    // answers every row raising the same decisionId in this lineage.
    // `includeResolved` (§3) does not drop an answered group; it keeps it and
    // adds a `resolution` field below instead of skipping.
    const answered = Boolean(answeredByLineage.get(lineageId)?.has(decisionId));
    if (answered && !includeResolved) continue;

    // contentLoop: the member with the latest `dispatchedAt` (tie-break
    // `loopId`, descending, for determinism only — ties are not expected in
    // practice) whose OWN `decision.decision_id` matches this group's
    // decisionId. Every member of a group shares this decisionId by
    // construction (pass 2's bucket key), so this always finds one.
    let contentLoop = null;
    for (const loop of members) {
      if (!contentLoop) { contentLoop = loop; continue; }
      const a = _dispatchedAtMs(loop), b = _dispatchedAtMs(contentLoop);
      if (a > b || (a === b && String(loop.loopId) > String(contentLoop.loopId))) contentLoop = loop;
    }
    // Skip the group if the CONTENT loop is superseded — never the root
    // (R7): the root can be superseded by an entirely unrelated follow-up
    // while the decision-bearing content loop is still live.
    //
    // LIN-2991 corrective fix: this skip applies to UNANSWERED groups only.
    // An answered group only reaches this line when `includeResolved` kept
    // it past the discharge check above, and the live LIN-2985 shape is
    // exactly a root-raised, root-answered decision whose root (also its
    // own content loop, being the group's only member) is later superseded
    // by an unrelated reply — the common case for a resumed/re-visited
    // session. Hiding it from `includeResolved` defeated the no-re-raise
    // guidance this endpoint exists to support: an agent checking for a
    // prior ruling on this finding would see nothing and re-raise it. The
    // default (unanswered) read is unaffected — `answered` is only ever
    // true here when `includeResolved` let the group through in the first
    // place, so this narrows nothing for the default caller.
    if (!answered && superseded.has(contentLoop.loopId)) continue;

    // anchorLoop: the lineage's root, found in the WHOLE fetched set (the
    // root may carry no decision of its own, so it is never a candidate
    // group member) — falling back to contentLoop when the root is absent
    // from this input set (a wake-first fetch, or the root has aged out of
    // the 30-day window).
    const rootMember = loops.find(l => l.loopId === lineageId) ?? null;
    const anchorLoop = rootMember ?? contentLoop;

    // shelfGate is keyed on the ANCHOR (LIN-3021's buildRulingRef, merged —
    // see that function), so a shelve persists across a content-loop shift:
    // group identity is anchorLoop, not whichever loop happens to be
    // contentLoop on any given read.
    const shelvedLapseCount = shelfGate(anchorLoop.workspaceUrlKey, anchorLoop.loopId, decisionId);
    if (shelvedLapseCount === null) continue; // actively shelved

    // Disposition and effect come from the CONTENT loop — it is the one
    // that would actually receive a reply/stamp, never the (possibly
    // long-terminal, possibly unrelated-in-liveness) root.
    const disposition = resolveDisposition(contentLoop, { now: effectiveNow });
    const { effect, declaredEffect, alternate } = resolveEffect(contentLoop.decision, disposition, {
      liveDispatchOnAnchor: resolveLiveDispatchOnAnchor(anchorLoop.issueIdentifier || null)
    });
    rows.push({
      decision: contentLoop.decision,
      decisionCase: contentLoop.decisionCase || [],
      anchor: {
        loopId: anchorLoop.loopId,
        issueId: anchorLoop.issueId || null,
        issueIdentifier: anchorLoop.issueIdentifier || null,
        workspaceUrlKey: anchorLoop.workspaceUrlKey || null,
        target: anchorLoop.target || null,
        followUpTo: anchorLoop.followUpTo || null
      },
      // The reply target (`anchor.loopId`) and the stamp target are now
      // separate: `anchor.loopId` is where a reply/comment posts, `stampLoopId`
      // is where `markDecisionAnswered` writes. They coincide only when the
      // decision was raised on the lineage's own root loop.
      stampLoopId: contentLoop.loopId,
      disposition,
      canReply: canReplyFor(disposition),
      shelvedLapseCount,
      effect,
      declaredEffect,
      alternate,
      // `includeResolved` only (§3/N3): the first matching entry across
      // EVERY loop in the LINEAGE (the same candidate set `answeredByLineage`
      // itself was unioned from above) — never just this group's own bucket
      // `members` (loops whose CURRENT decision is this one). The discharge
      // check is lineage-wide, so the resolution lookup must be too, or an
      // answered: true row could carry a null resolution whenever the stamp
      // sits on a sibling raising a DIFFERENT current decision (D1's own
      // shape) rather than on a same-bucket member (the content-loop-shift
      // shape N3 was originally written against).
      ...(answered ? {
        resolution: loops
          .filter(l => (l?.lineageId ?? l?.loopId) === lineageId)
          .flatMap(m => Array.isArray(m.answeredDecisions) ? m.answeredDecisions : [])
          .find(e => e.decisionId === decisionId) ?? null
      } : {})
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
