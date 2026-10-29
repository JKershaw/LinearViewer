/**
 * Run view model (LIN-3250, S1 of LIN-2948).
 *
 * The pure core of the run page: `buildRunView(session, { now })` turns an
 * already-loaded, non-lean session into the whole-read shape the page renders —
 * run id, title, steps, progress, what comes next, and honest cost, time and
 * waiting clocks. NO I/O, no store reads, no clock beyond the injected `now`.
 *
 * "Step" vocabulary: a STEP is one lineage group — the reworks of a single
 * dispatch, folded by `groupLoopsByLineage`. A step's kind/status/tier come from
 * its ACTIVE loop (the tail, i.e. the one no follow-up supersedes), so a
 * resolved earlier attempt never decides what the step is. Every loop of the
 * lineage, superseded included, stays on the step's `loops` for row rendering.
 *
 * Progress is the one number, over the fixed spine
 * `plan → implementation → review → close-out` (real `PROMPT_TEMPLATES` keys).
 * A finished (`done`) loop reaches its spine stage and every earlier one, so a
 * run that skipped a stage still counts it once a later stage finishes, and a
 * rework in flight never lowers the number its finished predecessor set
 * (superseded loops count for progress). An out-of-spine step never lowers the
 * number. Monotone by construction. The number is withheld — never guessed — for a standalone
 * single-step session ("the step's own state") and for a general goal-only
 * session ("N steps so far").
 */

import { computeSupersededLoopIds } from './loop-supersede.js';
import { findWakeEvent, isRowClosed, isWaitingWakeMarker, WAKE_FEEDBACK_REGEX } from './dispatch-terminal.js';
import { NON_SESSION_TARGETS } from './dispatch-targets.js';
import { toEpochMs } from './utils/time.js';

/** The fixed pipeline spine. Real `PROMPT_TEMPLATES` keys; order is the contract. */
export const SPINE = ['plan', 'implementation', 'review', 'close-out'];

const SPINE_INDEX = new Map(SPINE.map((kind, i) => [kind, i]));

/**
 * The task page's "usual stages": the ordered guess it draws after the furthest
 * stage a task has reached, research first (LIN-3328). Plan review sits straight
 * after Plan (LIN-4010): a plan is reviewed before anything is built on it, so
 * Home never offers Build over a review that is still due. `SPINE` is deliberately
 * unchanged — the run page's progress reads `SPINE` and still means "n of 4".
 */
export const USUAL_STAGES = ['research', SPINE[0], 'plan-review', ...SPINE.slice(1)];

/**
 * One display word per dispatch kind, shared by every task-page label site
 * (LIN-3328). Covers `DISPATCH_KINDS` (`lib/prompt-templates.js`); a kind not
 * listed falls back to `stepKindWord`'s capitalised form
 * (below).
 */
export const STAGE_LABELS = {
  // The usual stages, in `USUAL_STAGES` order.
  research: 'Research',
  plan: 'Plan',
  implementation: 'Build',
  review: 'Review',
  'close-out': 'Close-out',
  // The remaining prompt-template stages.
  blocked: 'Blocked',
  bug: 'Bug fix',
  'look-into': 'Look into',
  triage: 'Triage',
  breakdown: 'Breakdown',
  scoping: 'Scoping',
  design: 'Design',
  spike: 'Spike',
  context: 'Context',
  'plan-review': 'Plan review',
  'retrospective-audit': 'Retrospective audit',
  retro: 'Retro',
  // Meta / lifecycle kinds.
  autopilot: 'Kick-off',
  wake: 'Check-in',
  periodical: 'Periodical',
  custom: 'Custom',
  defer: 'Defer',
};

// Plain words for a step's kind (LIN-3250 review nit): operator kinds such as
// `autopilot`/`wake` never reach the page. Unknown kinds fall back to a
// capitalised form, so a new kind degrades gracefully instead of leaking.
export const STEP_KIND_WORDS = {
  autopilot: 'Kick-off',
  wake: 'Check-in',
  plan: 'Plan',
  implementation: 'Build',
  review: 'Review',
  'close-out': 'Close-out',
  research: 'Research',
  bug: 'Bug fix',
};

/**
 * A kind's plain display word: `STEP_KIND_WORDS` when known, else the
 * capitalised kind. The fallback for an unlabelled dispatch kind (LIN-3328).
 *
 * @param {string|null|undefined} kind
 * @returns {string}
 */
export function stepKindWord(kind) {
  if (!kind) return 'Step';
  return STEP_KIND_WORDS[kind] || kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * A kind's stage word: `STAGE_LABELS` when mapped, else `stepKindWord`. Moved
 * here from `lib/task-page-loader.js` (LIN-3977) so the Live Console poll path
 * can read it without importing the task-page model; the loader re-exports it.
 *
 * @param {string|null|undefined} kind
 * @returns {string}
 */
export function stageLabel(kind) {
  return (kind && STAGE_LABELS[kind]) || stepKindWord(kind);
}

// The four explicitly-named orchestration kinds (LIN-2566 §"Other established
// constraints"). Moved here from `lib/effort-readout.js` (LIN-3977) so the Live
// Console can read "a kind that is not a stage" without that module's imports;
// effort-readout re-exports it. `wake` is deliberately included though it is
// absent from `DISPATCH_KINDS` itself (it reaches the join through row data).
export const ORCHESTRATION_KINDS = new Set(['autopilot', 'wake', 'custom', 'periodical']);

/**
 * Group a session's loops by lineage — `loop.lineageId ?? loop.loopId` (the same
 * `item.rootItemId ?? loop.loopId` key `lib/pipeline-loops.js` derives), preserving
 * the ORDER the loops already arrive in (ascending `dispatchedAt`, `loopId`
 * tiebreak). A lineage's loops move together at its first-seen position.
 *
 * Moved here from `lib/render-session.js` (LIN-3250) so the view model and the
 * renderer share ONE definition; `render-session.js` imports it back.
 *
 * @param {Array<Object>} loops
 * @returns {Array<Array<Object>>} groups, each one lineage's loops in order
 */
export function groupLoopsByLineage(loops) {
  const order = [];
  const byLineage = new Map();
  for (const loop of loops) {
    const key = loop.lineageId ?? loop.loopId;
    if (!byLineage.has(key)) {
      byLineage.set(key, []);
      order.push(key);
    }
    byLineage.get(key).push(loop);
  }
  return order.map(key => byLineage.get(key));
}

/**
 * A realised model string → its tier family. Never the identifier.
 *
 * The raw value (e.g. a worker-reported `claude-opus-4-8`, or an OpenRouter-shaped
 * `anthropic/claude-opus-4-8`) stays in the step's operator details; the page only
 * ever prints "premium", "standard", "small" or "not reported". By family, not by
 * exact id, so a newer sibling in the same family still lands.
 *
 * The small-family check runs FIRST so a size suffix wins over a version match:
 * `gpt-5.5-mini` is small, never premium, despite sharing `gpt-5.5`.
 *
 * @param {string|null|undefined} model
 * @returns {'premium'|'standard'|'small'|'not reported'}
 */
export function tierOf(model) {
  if (typeof model !== 'string' || !model.trim()) return 'not reported';
  const m = model.toLowerCase();
  if (m.includes('mini') || m.includes('haiku')) return 'small';
  if (m.includes('opus') || m.includes('fable') || m.includes('gpt-5.5')) return 'premium';
  if (m.includes('sonnet') || m.includes('gpt-5.6')) return 'standard';
  return 'not reported';
}

// ─── Feedback markers (waiting clock) ────────────────────────────────────────

// The three decision-lifecycle stamp kinds (LIN-3037) a waiting scan must skip:
// an answer/withdrawal stamp is bookkeeping, never a wake marker.
const DECISION_STAMP_KINDS = new Set([
  'decision-answer', 'decision-withdrawn', 'decision-withdrawal-reversed',
]);

// A wake marker is a leading prefix (a mid-sentence mention never counts),
// matched by WAKE_FEEDBACK_REGEX from lib/dispatch-terminal.js. Only
// [blocked] of these means "waiting on a person".

/**
 * The LAST wake marker in a loop's feedback, skipping decision-lifecycle stamps.
 * Scans the whole array (never just the last entry): the runner posts `[usage]`
 * bookkeeping immediately after a `[blocked]` status entry (LIN-2264), so a
 * last-entry read would miss the block.
 *
 * @param {Array<{kind?: string, message?: string, timestamp?: string}>} feedback
 * @returns {{entry: Object, marker: string}|null}
 */
function lastWakeEntry(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (let i = feedback.length - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (!entry || DECISION_STAMP_KINDS.has(entry.kind)) continue;
    const match = WAKE_FEEDBACK_REGEX.exec(entry.message || '');
    if (match) return { entry, marker: match[1].toLowerCase() };
  }
  return null;
}

// ─── Cost (honest, never guessed) ────────────────────────────────────────────

const NOT_REPORTED = 'not reported';
const CUMULATIVE_HARNESS = 'claude-code';

/**
 * A lineage's cost, from its LAST valid `[usage]` (a cumulative snapshot per
 * Stop; earlier loops' snapshots are superseded). `costUsd` is read straight
 * from `loop.telemetry.usage`:
 *
 *   - no usage, or a harness-only snapshot → not reported;
 *   - a priced figure (finite, > 0) → priced;
 *   - `costUsd === null` (unpriced tier) or `0` → not reported.
 *
 * `cumulative` is true only for the `claude-code` snapshot (OpenCode posts
 * per-turn rows, LIN-1426), which is what the header total is gated on. The
 * final loop that carried the usage is named so the renderer puts the figure on
 * that row and "included in the step total" on its earlier siblings.
 *
 * @param {Array<Object>} group - one lineage's loops in order
 * @returns {{status:'priced'|'not-reported', usd:number|null, label:string|null, cumulative:boolean, finalLoopId:string|null}}
 */
function lineageCost(group) {
  let usage = null;
  let finalLoopId = null;
  for (const loop of group) {
    const u = loop && loop.telemetry ? loop.telemetry.usage : null;
    if (u) { usage = u; finalLoopId = loop.loopId ?? null; }
  }
  if (!usage) return { status: 'not-reported', usd: null, label: NOT_REPORTED, cumulative: false, finalLoopId: null };
  const usd = usage.costUsd;
  if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
    return { status: 'priced', usd, label: null, cumulative: usage.harness === CUMULATIVE_HARNESS, finalLoopId };
  }
  return { status: 'not-reported', usd: null, label: NOT_REPORTED, cumulative: false, finalLoopId };
}

/** Per-loop cost rows for a lineage: the figure on its final row, "included" before it. */
function lineageLoopCosts(group, cost) {
  return group.map(loop => {
    const loopId = loop.loopId ?? null;
    if (cost.status !== 'priced') return { loopId, status: 'not-reported', usd: null, label: NOT_REPORTED };
    if (loopId === cost.finalLoopId) return { loopId, status: 'figure', usd: cost.usd, label: null };
    return { loopId, status: 'included', usd: null, label: 'included in the step total' };
  });
}

// ─── Time ────────────────────────────────────────────────────────────────────

/**
 * Wall clock from `session.dispatchedAt` to `completedAt` (or `now` while open).
 * `start`/`end` ride along so the page can tick the open clock client-side.
 */
function wallClock(session, nowMs) {
  const start = session.dispatchedAt || null;
  const end = session.completedAt || null;
  const startMs = toEpochMs(start);
  if (startMs == null) return { start, end, ms: null };
  const endMs = end != null ? toEpochMs(end) : nowMs;
  return { start, end, ms: endMs != null ? Math.max(0, endMs - startMs) : null };
}

// ─── Waiting clock ───────────────────────────────────────────────────────────

/**
 * The session's waiting clock: the first live (non-terminal, non-superseded)
 * loop whose last wake marker is `[blocked]` -- the person's turn. `since` is
 * that marker's timestamp, exposed for a client-side tick.
 */
function waitingClock(loops, supersededLoopIds, nowMs) {
  for (const loop of loops) {
    if (!loop || loop.terminalStatus) continue;
    if (isRowClosed(loop)) continue; // LIN-3364
    if (supersededLoopIds.has(loop.loopId)) continue;
    const wake = lastWakeEntry(loop.feedback);
    if (!wake || !isWaitingWakeMarker(wake.marker)) continue;
    const since = wake.entry.timestamp || null;
    const sinceMs = toEpochMs(since);
    return {
      active: true,
      since,
      ms: sinceMs != null ? Math.max(0, nowMs - sinceMs) : null,
      loopId: loop.loopId ?? null,
    };
  }
  return { active: false, since: null, ms: null, loopId: null };
}

/** Plain words for a run's terminal status; a still-open run is "in progress". */
function statusWords(terminalStatus) {
  if (terminalStatus === 'done') return 'done';
  if (terminalStatus === 'failed') return 'failed';
  if (terminalStatus) return String(terminalStatus);
  return 'in progress';
}

/**
 * The active loop of a lineage group: the last loop no follow-up supersedes.
 * Always present for a linear chain (its tail is never superseded); falls back
 * to the group's tail defensively.
 */
function activeLoop(group, supersededLoopIds) {
  const active = group.filter(l => l && !supersededLoopIds.has(l.loopId));
  return active[active.length - 1] || group[group.length - 1];
}

/**
 * A standalone session — a single user-dispatched prompt `_buildSessions` pass 3
 * synthesized on its own (LIN-1194). Same rule as `routes/dashboard.js`'s
 * `isStandaloneSession`: no autopilot anchor AND no loop carrying a `sessionId`.
 * Inlined here (rather than importing the route) to keep this module pure and
 * dependency-light.
 */
function isStandalone(session, loops) {
  const anchored = loops.some(l => l && l.kind === 'autopilot' && String(l.loopId) === String(session.sessionId));
  if (anchored) return false;
  if (loops.length === 0) return false;
  return !loops.some(l => l && l.sessionId);
}

/**
 * Build the run view. Pure: reads only `session` and `now`.
 *
 * @param {Object} session - an already-loaded, non-lean reconstructed session
 * @param {{ now?: Date|string|number }} [options]
 * @returns {{
 *   runId: string|null,
 *   title: string|null,
 *   steps: Array<Object>,
 *   progress: { mode: 'stages'|'steps'|'state', reached: number|null, total: number|null, label: string },
 *   next: string|null,
 *   cost: { status: 'total'|'not-reported', usd: number|null, label: string|null },
 *   time: { activeMs: number, wall: { start: string|null, end: string|null, ms: number|null } },
 *   waiting: { active: boolean, since: string|null, ms: number|null, loopId: string|null }
 * }}
 */
export function buildRunView(session = {}, { now } = {}) {
  const nowMs = toEpochMs(now) ?? Date.now();
  const loops = Array.isArray(session.loops) ? session.loops : [];
  const supersededLoopIds = computeSupersededLoopIds(loops);
  const groups = groupLoopsByLineage(loops);
  const standalone = isStandalone(session, loops);
  const goalOnly = !session.seedIssue;

  const steps = groups.map(group => {
    const lead = activeLoop(group, supersededLoopIds);
    const terminalStatus = lead ? (lead.terminalStatus ?? null) : null;
    const kind = lead ? (lead.kind ?? null) : null;
    const model = lead && lead.telemetry ? (lead.telemetry.model ?? null) : null;
    const lineageId = group[0] ? (group[0].lineageId ?? group[0].loopId) : null;
    const cost = lineageCost(group);
    return {
      lineageId,
      kind,
      status: terminalStatus || (isRowClosed(lead) ? 'closed' : 'running'),
      terminalStatus,
      finished: terminalStatus === 'done',
      iteration: lead ? (lead.iteration ?? null) : null,
      model,
      tier: tierOf(model),
      summary: `${kind || 'run'} · ${statusWords(terminalStatus)}`,
      loops: group,
      loopCosts: lineageLoopCosts(group, cost),
      cost,
    };
  });

  // Count every `done` loop of a spine kind, superseded loops included: a rework
  // dispatched on top of a finished stage must never lower the number the
  // finished stage already set. (Step kind/status/tier still read the active
  // loop; only progress scans all loops.)
  let reached = 0;
  for (const loop of loops) {
    if (!loop || loop.terminalStatus !== 'done') continue;
    const index = SPINE_INDEX.get(loop.kind);
    if (index == null) continue;
    reached = Math.max(reached, index + 1);
  }

  const progress = standalone
    ? { mode: 'state', reached: null, total: null, label: "the step's own state" }
    : goalOnly
      ? { mode: 'steps', reached: null, total: null, label: `${steps.length} step${steps.length === 1 ? '' : 's'} so far` }
      : { mode: 'stages', reached, total: SPINE.length, label: `${reached} of ${SPINE.length} stages` };

  const waiting = waitingClock(loops, supersededLoopIds, nowMs);

  let next = progress.mode === 'stages' && reached < SPINE.length ? SPINE[reached] : null;
  if (waiting.active && progress.mode !== 'state') next = 'your answer';

  // Header total: only when EVERY lineage is priced AND reports cumulatively
  // (claude-code). Otherwise omitted — never a partial sum, never 0.
  const allPricedCumulative = steps.length > 0 && steps.every(s => s.cost.status === 'priced' && s.cost.cumulative);
  const cost = allPricedCumulative
    ? { status: 'total', usd: steps.reduce((sum, s) => sum + s.cost.usd, 0), label: null }
    : { status: 'not-reported', usd: null, label: NOT_REPORTED };

  let activeMs = 0;
  for (const loop of loops) {
    const ms = loop && loop.telemetry && loop.telemetry.runtime ? loop.telemetry.runtime.ms : null;
    if (Number.isFinite(ms) && ms > 0) activeMs += ms;
  }

  const title = (loops.find(l => l && l.issueTitle) || {}).issueTitle || session.seedIssue || null;

  return {
    runId: session.sessionId || null,
    title,
    steps,
    progress,
    next,
    cost,
    time: { activeMs, wall: wallClock(session, nowMs) },
    waiting,
  };
}

// =============================================================================
// Per-run facts (LIN-3754)
// =============================================================================
// The page modules format these; they do not apply the rules themselves. The
// rule modules stay where they are (dispatch-terminal, dispatch-targets,
// loop-supersede). What lives here is the application that combines them.

export { computeSupersededLoopIds };

const EMPTY_SET = new Set();

/**
 * A per-run "waiting for input" signal (LIN-1163, item 5), derived read-only
 * from the run's OWN feedback — deliberately NOT the session-level `waiting`
 * rollup (which is keyed session-wide and can't say *which* run is parked).
 * A run only counts as waiting while it is itself non-terminal — a finished
 * run's last entry could still carry a `[blocked]` marker from earlier in its
 * life, and that's not "waiting" anymore. A run superseded by a follow-up loop
 * (see `computeSupersededLoopIds`) is also excluded — it has since been replied
 * to, even though its own stale feedback still ends on a blocked marker.
 *
 * LIN-2264: this used to walk back from `feedback[]`'s LAST entry, skipping
 * only `decision-answer` stamps — positional adjacency, not a semantic scan.
 * Simple Dispatcher posts a `[usage]` bookkeeping entry at the same Stop
 * boundary immediately after a `[blocked]` status entry, and that predicate
 * didn't skip it, so on real data (measured: 19/19 blocked loops) the walk
 * stopped on `[usage]` and this always read false — the flag was effectively
 * dead in production. It now uses the same SEMANTIC scan
 * `routes/dashboard.js`'s `loopIsWaiting` uses: the build-time `wakeMarker`
 * baked onto every loop `_buildLoops` produces (lean or not —
 * `lib/pipeline-loops.js`), falling back to `findWakeEvent` over raw
 * `feedback[]` for a loop built elsewhere (e.g. a test fixture). Both scan
 * for the LAST *wake* marker (`[done]`/`[complete]`/`[failed]`/`[aborted]`/
 * `[blocked]`/`[pending]`) regardless of what non-wake bookkeeping — `[usage]`,
 * a `decision`/`decision-answer` entry, a plain heartbeat — sits after it, so
 * this is robust to `WORKER_USAGE_RELAY` being on or off and to future
 * bookkeeping entries alike. Only `[blocked]` counts as waiting-on-a-human
 * (`WAITING_WAKE_MARKERS`, lib/dispatch-terminal.js); `[pending]` no longer does, matching
 * `loopIsWaiting` — this is what keeps the per-run flag and the session
 * banner from disagreeing (the divergence this ticket closes).
 */
export function runIsWaiting(loop, supersededLoopIds = EMPTY_SET) {
  if (loop.terminalStatus) return false;
  if (isRowClosed(loop)) return false; // LIN-3364
  if (supersededLoopIds.has(loop.loopId)) return false;
  const marker = loop.wakeMarker !== undefined
    ? loop.wakeMarker
    : (findWakeEvent(loop.feedback)?.marker || null);
  return isWaitingWakeMarker(marker);
}

/**
 * Closed at the source (LIN-3364): a non-terminal row with bookkeeping that the
 * source closed. The status pill and the times line both read this one fact.
 *
 * @param {Object} loop
 * @returns {boolean}
 */
export function runClosedAtSource(loop) { return !loop.terminalStatus && isRowClosed(loop); }

/**
 * The run page's reply rule (LIN-3467): a question can be answered in place
 * unless its producer is missing or targets a non-session target
 * (`NON_SESSION_TARGETS`). `null`, `undefined` and `''` targets stay open,
 * because that list is the complement of the replyable targets.
 *
 * @param {Object|null} producer - The question's producer, with a `target`
 * @returns {boolean}
 */
export function canReplyTo(producer) { return !!producer && !NON_SESSION_TARGETS.includes(producer.target); }
