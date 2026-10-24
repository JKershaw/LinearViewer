/**
 * lib/pipeline-churn.js  (LIN-3891)
 *
 * Pure, network-free analysis behind `scripts/pipeline-churn.mjs`: for each
 * ticket, which dispatches between launch and Done were the stage path and
 * which were extra, and what caused each extra one. The proxy read lives in
 * the script, the same lib/script split as `wall-clock-summary` and
 * `plan-review-round-trips`.
 *
 * ── INPUT ───────────────────────────────────────────────────────────────────
 * One element per ticket:
 *   {
 *     identifier,
 *     rows: [{ ...GET /dispatch?issueIdentifier= list row, ...GET /dispatch/{id} detail,
 *              promptHead? }],   // promptHead: first line of GET /dispatch/{id}/prompt,
 *                                 // filled by the script for `custom` rows only
 *     rulings: [ ...GET /rulings?issueIdentifier=&includeResolved=true .rulings ],
 *   }
 *
 * ── WHAT A ROW COSTS ────────────────────────────────────────────────────────
 * A row's own segment runs from its `dispatchedAt` to the first wake marker
 * (`[done]`/`[failed]`/`[aborted]`/`[blocked]`/`[pending]`, the same
 * `WAKE_FEEDBACK_REGEX` the wake path reads) at or after it. Wake and custom
 * rows carry their lineage's merged feedback, so `completedAt` on them is the
 * lineage's end, not the row's; the segment is the row's own turn. An aborted
 * row with no marker ends at `completedAt`/`closedAt`.
 *
 * ── WAKES ───────────────────────────────────────────────────────────────────
 * A `wake` is the orchestrator's resume after one child reached a terminal or
 * parked outcome, so it is counted under the row it follows (LIN-3891's rule):
 * the non-wake, non-autopilot row whose segment ends closest to the wake's
 * `dispatchedAt`, within `WAKE_MATCH_MS`. A wake no row explains is
 * `unattributed-wake`.
 *
 * ── CAUSES ──────────────────────────────────────────────────────────────────
 * Assigned in dispatch order from the trail itself (verdicts via
 * `extractVerdict`, the same extractor the round-trips instrument uses).
 * `CAUSES` below lists each with its reading; whether an extra row was
 * avoidable is a judgement this module does not make — `defaultReading` is the
 * starting reading the findings argue from, not a verdict.
 */

import { extractVerdict } from './plan-review-round-trips.js';
import { WAKE_FEEDBACK_REGEX } from './dispatch-terminal.js';
import { toEpochMs } from './utils/time.js';

export const WAKE_MATCH_MS = 60 * 1000;
/** An aborted row this quick never did the work; it is a misroute or a duplicate. */
export const ABORTED_EARLY_MS = 2 * 60 * 1000;
/** An aborted `custom` this close to an aborted worker is that abort's carrier. */
const ABORT_CARRIER_MS = 60 * 1000;
/** A resume prompt dispatched this soon after a ruling's answer is that answer's delivery. */
const RULING_RESUME_MS = 60 * 1000;

const ORCHESTRATION_KINDS = new Set(['autopilot', 'wake', 'custom']);
const FIRST_PASS_KINDS = new Set(['research', 'design', 'spike', 'scoping', 'context', 'triage', 'bug', 'look-into']);
const POST_DEPLOY_TEXT = /post-deploy|after the deploy|on production|production check|production access|live check|in production/i;
/** A hold whose own text says the merge did not land is not a post-deploy hold, whatever else it mentions. */
const MERGE_HELD_TEXT = /\b(?:did not|didn't|not yet|haven't) merge|merge is held|held the merge|hold the merge|is (?:still )?(?:open and )?unmerged/i;

export const CAUSES = {
  'stage-path':            { label: 'stage path (autopilot, first implementation, review, close-out)', defaultReading: 'needed' },
  'first-pass-stage':      { label: 'first research / design / plan / plan-review', defaultReading: 'needed' },
  'plan-rejected':         { label: 'plan sent back by plan-review (re-plan + re-review)', defaultReading: 'judge per finding' },
  'review-changes':        { label: 'review asked for changes (fix round + re-review)', defaultReading: 'judge per finding' },
  'fixes-outside-close-out': { label: 'fix round after an Approve (close-out owns those fixes)', defaultReading: 'avoidable' },
  'ci-red':                { label: 'CI red on the PR', defaultReading: 'needed' },
  'ci-wake-worker':        { label: 'CI-finished wake to a worker parked on its own PR', defaultReading: 'needed' },
  'ci-wake-orchestrator':  { label: 'CI-finished wake to an autopilot parked on a child', defaultReading: 'avoidable' },
  'ruling-resume':         { label: 'resume after a ruling was answered', defaultReading: 'judge per ruling' },
  'close-out-held':        { label: 'close-out held, then re-dispatched', defaultReading: 'judge per hold' },
  'stall-recovery':        { label: 'worker went quiet: probe, abort or re-dispatch', defaultReading: 'avoidable' },
  'aborted-before-work':   { label: 'dispatch aborted before doing work (misroute or duplicate)', defaultReading: 'avoidable' },
  'concurrent-duplicate':  { label: 'a second live session of the same stage', defaultReading: 'avoidable' },
  'audit':                 { label: 'retrospective audit', defaultReading: 'orchestrator choice' },
  'operator-follow-up':    { label: 'other custom dispatch (operator note or probe)', defaultReading: 'judge per row' },
  'repeat-stage':          { label: 'a stage repeated with no verdict asking for it', defaultReading: 'judge per row' },
  'unattributed-wake':     { label: 'wake no row explains', defaultReading: 'unknown' },
};

const ms = (v) => toEpochMs(v);

/** The `Task: <name> — "<head>"` line of a row's own `[started]` entry. */
export function taskHead(row) {
  if (typeof row?.promptHead === 'string' && row.promptHead) return row.promptHead;
  const start = ms(row?.dispatchedAt);
  for (const f of row?.feedback || []) {
    if (start != null && (ms(f.timestamp) ?? 0) < start) continue;
    const m = /^\[started\][^\n]*\nTask: [^\n]*? — "([^\n]*)"/.exec(f.message || '');
    if (m) return m[1];
  }
  return '';
}

/**
 * The row's own segment: its dispatch to the first wake marker at or after it.
 * @returns {{startMs: number|null, endMs: number|null, wallMs: number|null, marker: string|null, text: string}}
 */
export function ownSegment(row) {
  const startMs = ms(row?.dispatchedAt);
  const fb = [...(row?.feedback || [])].sort((a, b) => (ms(a.timestamp) ?? 0) - (ms(b.timestamp) ?? 0));
  for (const f of fb) {
    const t = ms(f.timestamp);
    if (startMs != null && (t == null || t < startMs)) continue;
    const m = WAKE_FEEDBACK_REGEX.exec(f.message || '');
    if (m) return { startMs, endMs: t, wallMs: t - startMs, marker: m[1].toLowerCase(), text: f.message };
  }
  const end = ms(row?.completedAt) ?? ms(row?.closedAt);
  const own = end != null && startMs != null && row?.status === 'aborted';
  return { startMs, endMs: own ? end : null, wallMs: own ? end - startMs : null, marker: own ? 'aborted' : null, text: '' };
}

/**
 * Every wake marker at or after a row's dispatch, oldest first. A worker that
 * parks, is resumed (a ruling answer, a probe) and parks or finishes again
 * carries each of those in its own feedback, and each one mints a wake.
 */
export function markerEntries(row) {
  const startMs = ms(row?.dispatchedAt);
  return (row?.feedback || [])
    .map((f) => ({ t: ms(f.timestamp), m: WAKE_FEEDBACK_REGEX.exec(f.message || ''), text: f.message || '' }))
    .filter((x) => x.m && x.t != null && (startMs == null || x.t >= startMs))
    .sort((a, b) => a.t - b.t)
    .map((x) => ({ t: x.t, marker: x.m[1].toLowerCase(), text: x.text }));
}

/**
 * A worker row's whole span: dispatch to its lineage's end (`completedAt`,
 * else `closedAt`, else its last feedback entry). Unlike `ownSegment` this
 * keeps the time a worker sat parked (`[pending]` on CI, `[blocked]` on a
 * person) inside the row. Only meaningful for a worker with no `followUpTo`:
 * a wake's or custom's lineage end is its orchestrator's, not its own.
 */
export function workerSpanMs(row) {
  const startMs = ms(row?.dispatchedAt);
  const fbEnd = Math.max(...(row?.feedback || []).map((f) => ms(f.timestamp) ?? -Infinity));
  const end = ms(row?.completedAt) ?? ms(row?.closedAt) ?? (Number.isFinite(fbEnd) ? fbEnd : null);
  return startMs != null && end != null ? Math.max(0, end - startMs) : null;
}

const STALLED_BEAT = /^\[stalled\?\] no tool activity for (?:(\d+)h ?)?(?:(\d+)m ?)?(?:(\d+)s)?/;
/**
 * The longest `[stalled?] no tool activity for …` stretch a row's heartbeats
 * report inside its own working window (`dispatchedAt` to `untilMs`, the
 * row's first park or terminal marker), in ms, counting only a stretch that
 * began inside the window. Outside it the same heartbeat is a parked session
 * waiting on a person or a child (a wake's or custom's feedback is its whole
 * lineage's), which is a wait, not a hung tool.
 */
export function longestStallMs(row, untilMs = Infinity) {
  const startMs = ms(row?.dispatchedAt) ?? 0;
  let longest = 0;
  for (const f of row?.feedback || []) {
    const t = ms(f.timestamp) ?? 0;
    if (t < startMs || t > untilMs) continue;
    const m = STALLED_BEAT.exec(f.message || '');
    if (!m) continue;
    const stretch = ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
    if (t - stretch >= startMs) longest = Math.max(longest, stretch);
  }
  return longest;
}

/**
 * The verdict a worker row reported in its own sentinel lines (the tier B
 * extractor), or null. The caller falls back to the structural reading (tier C:
 * the next pipeline row's kind) the round-trips instrument also uses.
 */
function rowVerdict(row) {
  const startMs = ms(row.dispatchedAt);
  for (const f of row.feedback || []) {
    if (f.kind !== 'assistant-text' || (ms(f.timestamp) ?? 0) < startMs) continue;
    const v = extractVerdict(f.message || '');
    if (v) return v;
  }
  return null;
}

function rulingEvents(rulings) {
  return (rulings || []).map((r) => ({
    decisionId: r.decision?.decision_id || r.resolution?.decisionId || null,
    question: r.decision?.question || '',
    labels: (r.decision?.options || []).map((o) => o.label).filter(Boolean),
    loopId: r.stampLoopId || r.anchor?.loopId || null,
    raisedMs: ms(r.resolution?.raisedAt),
    resolvedMs: ms(r.resolution?.resolvedAt),
    outcome: r.resolution?.outcome ?? null,
  }));
}

/**
 * Classify every dispatch on one ticket.
 * @param {{identifier: string, rows: Array<Object>, rulings?: Array<Object>}} ticket
 */
export function classifyTicket(ticket) {
  const rows = [...(ticket.rows || [])].sort((a, b) => (ms(a.dispatchedAt) ?? 0) - (ms(b.dispatchedAt) ?? 0));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seg = new Map(rows.map((r) => [r.id, ownSegment(r)]));
  const rulings = rulingEvents(ticket.rulings);
  const entries = new Map();
  const put = (row, cause, note = null, ownerId = null) => {
    const whole = !ORCHESTRATION_KINDS.has(row.kind) && !row.followUpTo;
    const wallMs = whole ? workerSpanMs(row) : seg.get(row.id).wallMs;
    entries.set(row.id, {
      id: row.id, kind: row.kind, status: row.status, dispatchedAt: row.dispatchedAt,
      cause, note, ownerId, wallMs,
      stalledMs: longestStallMs(row, seg.get(row.id).endMs ?? (ms(row.dispatchedAt) ?? 0) + (wallMs ?? 0)),
    });
  };

  const isAbortedEarly = (r) => r.status === 'aborted' && (seg.get(r.id).wallMs ?? 0) <= ABORTED_EARLY_MS;
  const firstAutopilot = rows.find((r) => r.kind === 'autopilot');

  // 1. Workers, in order, against the trail so far.
  const seen = {};
  let lastPlanReview = null, lastReview = null, lastCloseOut = null, implSinceReview = false, lastImpl = null;
  for (const r of rows) {
    if (ORCHESTRATION_KINDS.has(r.kind)) continue;
    const followsWorker = r.followUpTo && byId.has(r.followUpTo) && !ORCHESTRATION_KINDS.has(byId.get(r.followUpTo).kind);
    const live = rows.find((o) => o !== r && o.kind === r.kind && !ORCHESTRATION_KINDS.has(o.kind)
      && entries.has(o.id) && (ms(o.dispatchedAt) ?? 0) < (ms(r.dispatchedAt) ?? 0)
      && (seg.get(o.id).endMs == null || seg.get(o.id).endMs > ms(r.dispatchedAt))
      && o.status !== 'aborted' && seg.get(o.id).marker !== 'blocked');
    let cause, note = null;
    if (isAbortedEarly(r)) { cause = 'aborted-before-work'; note = `${r.kind} aborted after ${Math.round((seg.get(r.id).wallMs ?? 0) / 1000)}s`; }
    else if (followsWorker) { cause = 'stall-recovery'; note = `follow-up into ${byId.get(r.followUpTo).kind} ${r.followUpTo.slice(0, 8)}`; }
    else if (live) { cause = 'concurrent-duplicate'; note = `${r.kind} ${live.id.slice(0, 8)} still live`; }
    else if (r.kind === 'implementation') {
      if (!seen.implementation) cause = 'stage-path';
      else if (lastImpl && lastImpl.status === 'aborted') cause = 'stall-recovery', note = `previous implementation ${lastImpl.id.slice(0, 8)} aborted`;
      else if (lastReview && !implSinceReview && /request changes|needs discussion/.test(lastReview.verdict || '')) cause = 'review-changes', note = `review ${lastReview.row.id.slice(0, 8)}: ${lastReview.verdict}`;
      else if (lastReview && !implSinceReview && lastReview.verdict === 'approve') cause = 'fixes-outside-close-out', note = `review ${lastReview.row.id.slice(0, 8)} approved`;
      else cause = 'repeat-stage';
      implSinceReview = true; lastImpl = r;
    } else if (r.kind === 'review') {
      cause = seen.review ? 'review-changes' : 'stage-path';
      if (seen.review) note = 're-review';
      lastReview = { row: r, verdict: rowVerdict(r) }; implSinceReview = false;
    } else if (r.kind === 'close-out') {
      if (!seen['close-out']) cause = 'stage-path';
      else if (lastCloseOut && lastCloseOut.status === 'aborted') cause = 'stall-recovery', note = `previous close-out ${lastCloseOut.id.slice(0, 8)} aborted`;
      else if (lastCloseOut && markerEntries(lastCloseOut).filter((x) => x.t <= ms(r.dispatchedAt)).at(-1)?.marker === 'blocked') {
        cause = 'close-out-held';
        // The hold that sent this close-out is the previous one's LATEST park before it, not its first.
        const held = markerEntries(lastCloseOut).filter((x) => x.t <= ms(r.dispatchedAt)).at(-1).text;
        note = POST_DEPLOY_TEXT.test(held) && !MERGE_HELD_TEXT.test(held) ? 'held on a post-deploy check' : 'held before the merge';
      } else cause = 'repeat-stage';
      lastCloseOut = r;
    } else if (r.kind === 'plan') {
      cause = seen.plan ? 'plan-rejected' : 'first-pass-stage';
      if (seen.plan && lastPlanReview) note = `plan-review ${lastPlanReview.row.id.slice(0, 8)}: ${lastPlanReview.verdict || 'request changes (structural: a plan followed)'}`;
    } else if (r.kind === 'plan-review') {
      cause = seen['plan-review'] ? 'plan-rejected' : 'first-pass-stage';
      lastPlanReview = { row: r, verdict: rowVerdict(r) };
    } else if (r.kind === 'retrospective-audit') cause = 'audit';
    else if (FIRST_PASS_KINDS.has(r.kind)) cause = seen[r.kind] ? 'repeat-stage' : 'first-pass-stage';
    else cause = 'repeat-stage', note = `${r.kind}`;
    if (cause !== 'aborted-before-work') seen[r.kind] = true;
    put(r, cause, note);
  }

  // 2. Custom rows: CI wakes, ruling resumes, abort carriers, the rest.
  for (const r of rows) {
    if (r.kind !== 'custom') continue;
    const head = taskHead(r);
    const t = ms(r.dispatchedAt);
    const target = r.followUpTo ? byId.get(r.followUpTo) : null;
    const ci = /^CI finished on (\S+) \(head \w+\): (\w+)/.exec(head);
    const lineageOf = (loopId) => {
      const loop = byId.get(loopId);
      return loop && loop.kind === 'wake' ? loop.followUpTo : loopId;
    };
    const answeredNear = (x) => x.resolvedMs != null && t - x.resolvedMs >= -5000 && t - x.resolvedMs <= RULING_RESUME_MS;
    const clean = head.replace(/…$/, '');
    const ruling = rulings.find((x) => answeredNear(x) && r.followUpTo && lineageOf(x.loopId) === r.followUpTo)
      || rulings.find((x) => clean && x.labels.some((l) => l.startsWith(clean) || clean.startsWith(l)))
      || rulings.find(answeredNear);
    const carrierFor = r.status === 'aborted' && rows.find((o) => o !== r && !ORCHESTRATION_KINDS.has(o.kind)
      && o.status === 'aborted' && (ms(o.dispatchedAt) ?? 0) <= t + ABORT_CARRIER_MS
      && Math.abs((seg.get(o.id).endMs ?? 0) - (seg.get(r.id).endMs ?? t)) <= ABORT_CARRIER_MS);
    if (ci) {
      const toWorker = target && !ORCHESTRATION_KINDS.has(target.kind);
      put(r, ci[2] === 'failing' ? 'ci-red' : toWorker ? 'ci-wake-worker' : 'ci-wake-orchestrator', `CI ${ci[2]} on ${ci[1]}`);
    } else if (carrierFor) {
      const owner = entries.get(carrierFor.id);
      put(r, owner?.cause === 'aborted-before-work' ? 'aborted-before-work' : 'stall-recovery',
        `abort of ${carrierFor.kind} ${carrierFor.id.slice(0, 8)}`, carrierFor.id);
    } else if (ruling) {
      // An answer resumed into a stage while a fresh session of that stage is already live runs it twice.
      const twin = target && !ORCHESTRATION_KINDS.has(target.kind) && rows.find((o) => o !== target
        && o.kind === target.kind && (ms(o.dispatchedAt) ?? 0) < t && (seg.get(o.id).endMs ?? Infinity) > t);
      if (twin) put(r, 'concurrent-duplicate', `${ruling.decisionId} resumed ${target.kind} ${target.id.slice(0, 8)} while ${twin.id.slice(0, 8)} was live`);
      else put(r, 'ruling-resume', `${ruling.decisionId}`);
    } else if (target && !ORCHESTRATION_KINDS.has(target.kind)) {
      put(r, 'stall-recovery', `follow-up into ${target.kind} ${target.id.slice(0, 8)}${head ? `: ${head.slice(0, 60)}` : ''}`);
    } else {
      put(r, 'operator-follow-up', head ? head.slice(0, 80) : null);
    }
  }

  // 3. The autopilot launch is the stage path; any other autopilot row is a re-launch.
  for (const r of rows) {
    if (r.kind !== 'autopilot') continue;
    put(r, r === firstAutopilot ? 'stage-path' : 'repeat-stage', r === firstAutopilot ? null : 'second autopilot');
  }

  // 4. Wakes go to the row they follow.
  const owners = rows.filter((r) => r.kind !== 'wake' && r.kind !== 'autopilot');
  for (const r of rows) {
    if (r.kind !== 'wake') continue;
    const t = ms(r.dispatchedAt);
    let best = null, bestGap = Infinity;
    for (const o of owners) {
      // A worker's own lineage can park more than once; a wake's or custom's feedback is the orchestrator's.
      const ends = ORCHESTRATION_KINDS.has(o.kind) ? [seg.get(o.id).endMs] : markerEntries(o).map((x) => x.t);
      for (const end of ends) {
        if (end == null) continue;
        const gap = Math.abs(t - end);
        // On a tie the later row wins: a resume shares its worker's lineage marker and is the nearer cause.
        if (gap <= WAKE_MATCH_MS && gap <= bestGap) { best = o; bestGap = gap; }
      }
    }
    if (best) {
      const owner = entries.get(best.id);
      // The stage path's wake is the one its finishing worker sends; an aborted worker's is the stall's.
      const cause = owner.cause === 'stage-path' && best.status === 'aborted' ? 'stall-recovery' : owner.cause;
      put(r, cause, `wake after ${best.kind} ${best.id.slice(0, 8)}`, best.id);
    } else put(r, 'unattributed-wake');
  }

  const list = rows.map((r) => entries.get(r.id));
  const firstImpl = rows.find((r) => r.kind === 'implementation' && r.status !== 'aborted');
  const firstImplMs = firstImpl ? ms(firstImpl.dispatchedAt) : null;
  for (const e of list) e.afterFirstImplementation = firstImplMs != null && (ms(e.dispatchedAt) ?? 0) > firstImplMs;

  const rulingRows = rulings.map((x) => {
    const raisedBy = rows.find((r) => r.id === x.loopId) || null;
    const overlaps = rulings.filter((y) => y !== x && y.raisedMs != null && x.raisedMs != null
      && y.raisedMs < x.raisedMs && (y.resolvedMs == null || y.resolvedMs > x.raisedMs)).map((y) => y.decisionId);
    return {
      decisionId: x.decisionId, question: x.question, outcome: x.outcome,
      raisedAt: x.raisedMs != null ? new Date(x.raisedMs).toISOString() : null,
      resolvedAt: x.resolvedMs != null ? new Date(x.resolvedMs).toISOString() : null,
      waitMs: x.raisedMs != null && x.resolvedMs != null ? x.resolvedMs - x.raisedMs : null,
      raisedByKind: raisedBy ? raisedBy.kind : null,
      raisedByStage: raisedBy ? (raisedBy.kind === 'wake' || raisedBy.kind === 'autopilot' ? 'autopilot' : raisedBy.kind) : null,
      openAtRaise: overlaps,
    };
  });

  // Time a person was being waited on: the union of the rulings' open intervals,
  // so two rulings open at once are not counted twice.
  const spans = rulings.filter((x) => x.raisedMs != null && x.resolvedMs != null)
    .map((x) => [x.raisedMs, x.resolvedMs]).sort((a, b) => a[0] - b[0]);
  let personWaitMs = 0, cur = null;
  for (const [a, b] of spans) {
    if (!cur || a > cur[1]) { if (cur) personWaitMs += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) personWaitMs += cur[1] - cur[0];

  return { identifier: ticket.identifier, total: list.length, entries: list, rulings: rulingRows, personWaitMs };
}

/**
 * Roll ticket results up by cause.
 * @param {Array<ReturnType<typeof classifyTicket>>} tickets
 */
export function summarizeChurn(tickets = []) {
  const byCause = {};
  for (const t of tickets) {
    for (const e of t.entries) {
      const c = (byCause[e.cause] ||= { cause: e.cause, label: CAUSES[e.cause]?.label || e.cause,
        defaultReading: CAUSES[e.cause]?.defaultReading || 'unknown', dispatches: 0, wakes: 0, wallMs: 0, tickets: {} });
      c.dispatches++;
      if (e.kind === 'wake') c.wakes++;
      c.wallMs += Math.max(0, e.wallMs || 0);
      c.stalledMs = (c.stalledMs || 0) + (e.stalledMs || 0);
      c.tickets[t.identifier] = (c.tickets[t.identifier] || 0) + 1;
    }
  }
  const rulings = tickets.flatMap((t) => t.rulings.map((r) => ({ identifier: t.identifier, ...r })));
  const personWaitMs = tickets.reduce((a, t) => a + (t.personWaitMs || 0), 0);
  const total = tickets.reduce((a, t) => a + t.total, 0);
  const extra = total - (byCause['stage-path']?.dispatches || 0);
  return {
    tickets: tickets.length, dispatches: total, extraOverStagePath: extra,
    byCause: Object.values(byCause).sort((a, b) => b.dispatches - a.dispatches),
    rulings, personWaitMs,
  };
}

export const __internal = { rowVerdict, rulingEvents, POST_DEPLOY_TEXT, MERGE_HELD_TEXT };
