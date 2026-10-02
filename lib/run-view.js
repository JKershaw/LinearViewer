/**
 * Run view model (LIN-3250, S1 of LIN-2948).
 *
 * The pure core of the run page: `buildRunView(session, { now })` turns an
 * already-loaded, non-lean session into the whole-read shape the page renders —
 * run id, title, steps, progress, what comes next, and (from S1b onward) cost,
 * time and waiting. NO I/O, no store reads, no clock beyond the injected `now`.
 *
 * "Step" vocabulary: a STEP is one lineage group — the reworks of a single
 * dispatch, folded by `groupLoopsByLineage`. A step's kind/status/tier come from
 * its ACTIVE loop (the tail, i.e. the one no follow-up supersedes), so a
 * resolved earlier attempt never decides what the step is. Every loop of the
 * lineage, superseded included, stays on the step's `loops` for row rendering.
 *
 * Progress is the one number, over the fixed spine
 * `plan → implementation → review → close-out` (real `PROMPT_TEMPLATES` keys).
 * A step that finished (`done`) reaches its spine stage and every earlier one,
 * so a run that skipped a stage still counts it once a later stage finishes;
 * a rework or an out-of-spine step never lowers the number. Monotone by
 * construction. The number is withheld — never guessed — for a standalone
 * single-step session ("the step's own state") and for a general goal-only
 * session ("N steps so far").
 */

import { computeSupersededLoopIds } from './loop-supersede.js';

/** The fixed pipeline spine. Real `PROMPT_TEMPLATES` keys; order is the contract. */
export const SPINE = ['plan', 'implementation', 'review', 'close-out'];

const SPINE_INDEX = new Map(SPINE.map((kind, i) => [kind, i]));

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
 * The raw value (e.g. a worker-reported `claude-opus-4-8`) stays in the step's
 * operator details; the page only ever prints "premium", "standard", "small" or
 * "not reported". By family, not by exact id, so a newer sibling in the same
 * family still lands.
 *
 * @param {string|null|undefined} model
 * @returns {'premium'|'standard'|'small'|'not reported'}
 */
export function tierOf(model) {
  if (typeof model !== 'string' || !model.trim()) return 'not reported';
  const m = model.toLowerCase();
  if (m.includes('opus') || m.includes('fable') || m.includes('gpt-5.5')) return 'premium';
  if (m.includes('sonnet') || m.includes('gpt-5.6')) return 'standard';
  if (m.includes('haiku') || m.includes('mini')) return 'small';
  return 'not reported';
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
 *   cost: null,
 *   time: null,
 *   waiting: null
 * }}
 */
export function buildRunView(session = {}, { now } = {}) {
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
    return {
      lineageId,
      kind,
      status: terminalStatus || 'running',
      terminalStatus,
      finished: terminalStatus === 'done',
      iteration: lead ? (lead.iteration ?? null) : null,
      model,
      tier: tierOf(model),
      summary: `${kind || 'run'} · ${statusWords(terminalStatus)}`,
      loops: group,
      cost: null,
      time: null,
      waiting: null,
    };
  });

  let reached = 0;
  for (const step of steps) {
    if (!step.finished) continue;
    const index = SPINE_INDEX.get(step.kind);
    if (index == null) continue;
    reached = Math.max(reached, index + 1);
  }

  const progress = standalone
    ? { mode: 'state', reached: null, total: null, label: "the step's own state" }
    : goalOnly
      ? { mode: 'steps', reached: null, total: null, label: `${steps.length} step${steps.length === 1 ? '' : 's'} so far` }
      : { mode: 'stages', reached, total: SPINE.length, label: `${reached} of ${SPINE.length} stages` };

  const next = progress.mode === 'stages' && reached < SPINE.length ? SPINE[reached] : null;

  const title = (loops.find(l => l && l.issueTitle) || {}).issueTitle || session.seedIssue || null;

  return {
    runId: session.sessionId || null,
    title,
    steps,
    progress,
    next,
    cost: null,
    time: null,
    waiting: null,
  };
}
