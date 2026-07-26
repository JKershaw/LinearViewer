/**
 * lib/wall-clock-summary.js  (LIN-987)
 *
 * Pure, network-free analysis behind the wall-clock summary
 * (`scripts/wall-clock-summary.mjs`). Given enriched dispatch steps
 * (`{ kind, sessionId, dispatchedAt, completedAt, resolvedAt, feedback[] }` — the
 * shape `GET /api/proxy/dispatch/{id}` returns), it answers three questions:
 *
 *  1. WHERE in the lifecycle does time go? — each step's `kind` maps to a phase
 *     bucket (before-the-diff / the-diff / after-the-diff / orchestration).
 *  2. Per SESSION (autopilot run) — steps sharing a `sessionId` are one run; this
 *     rolls them up so time is attributed to a run, not just an issue.
 *  3. WHERE does the EFFORT go inside a step? — `decomposeEffort` walks the
 *     heartbeat log (via `lib/session-telemetry.js`) and splits a step's
 *     wall-clock into onboarding / active-tool-work / waiting (0-tool stretches:
 *     long commands like tests/CI/builds, or think-time) / wrap-up.
 *
 * Reuses the repo's existing tolerant parsers rather than re-deriving them:
 *  - `parseHeartbeats` (session-telemetry) → the `[working]` beats, each with its
 *    interval (`elapsedSeconds`, the "in Xs"), `toolCount` (this interval) and
 *    cumulative `total`.
 *  - `deriveCompletedAt` (dispatch-terminal) → the true terminal-marker time.
 *
 * Honesty notes:
 *  - `waiting` is a LOWER BOUND on time-spent-waiting: a long tool (e.g. a
 *    multi-minute `npm test`) that completes inside a heartbeat interval is
 *    counted as `active`, because heartbeat granularity cannot see within an
 *    interval which single tool ran long. Only stretches where ZERO tools
 *    completed are unambiguously attributed to waiting.
 *  - Steps with no heartbeats (short orchestration `wake`s, still-open steps)
 *    can't be decomposed; their wall-clock is reported as `unclassifiedMs`.
 *  - Tokens are not derivable — worker token/cost is emitted nowhere today.
 */

import { parseHeartbeats } from './session-telemetry.js';
import { deriveCompletedAt } from './dispatch-terminal.js';

// ─── phase → bucket (mirrors PROMPT_TEMPLATES lifecycle + dispatch meta-kinds) ──
export const BUCKET_OF_KIND = {
  // BEFORE the diff — turning an idea into an implementable spec
  triage: 'before', research: 'before', scoping: 'before', design: 'before',
  spike: 'before', context: 'before', plan: 'before', breakdown: 'before',
  'look-into': 'before', blocked: 'before', 'plan-review': 'before',
  // THE diff — the core nugget
  implementation: 'diff',
  // AFTER the diff — confirmation & paperwork
  review: 'after', 'close-out': 'after', retro: 'after',
  // ORCHESTRATION — the loop's own overhead, not task-phase work
  autopilot: 'orchestration', wake: 'orchestration', custom: 'orchestration',
  periodical: 'orchestration',
};
export const BUCKET_ORDER = ['before', 'diff', 'after', 'orchestration'];
export const bucketOf = (kind) => BUCKET_OF_KIND[kind] || 'orchestration';

// Free-form signatures that a step's feedback touched tests / CI / builds. Used
// only to FLAG which steps spent waiting-time on CI/tests (qualitative), never to
// claim exact seconds — the seconds come from the 0-tool `waiting` intervals.
const CI_TEST_SIGNATURE = /\b(npm (?:run )?test|playwright|vitest|jest|\bci\b|ci-success|actions\/runs|workflow run|gh pr checks|pytest|\bbuild\b|typecheck|tsc\b)/i;

const _ms = (a, b) => {
  const x = new Date(a).getTime(), y = new Date(b).getTime();
  return Number.isFinite(x) && Number.isFinite(y) ? y - x : null;
};

/**
 * Decompose one step's observed wall-clock into effort classes from its
 * heartbeat log. Every heartbeat reports the interval since the previous beat
 * (`elapsedSeconds`) and how many tools completed in it (`toolCount`), plus a
 * cumulative `total`. We classify each interval:
 *   - onboarding : intervals before any tool has ever run (the project-summary
 *                  prep step — "not task work")
 *   - active     : interval in which ≥1 tool completed
 *   - waiting    : interval in which 0 tools completed AFTER work has started
 *                  (blocked on a long command — tests/CI/build — or think-time)
 * The gap from the last heartbeat to the terminal marker is `wrapup` (finalizing,
 * writing the recap, git/PR). Uncovered/short steps yield `unclassifiedMs`.
 *
 * @param {{dispatchedAt?:string, completedAt?:string, feedback?:Array}} step
 * @returns {{wallMs:number|null, onboardingMs:number, activeMs:number, waitingMs:number, wrapupMs:number, unclassifiedMs:number, hasBeats:boolean, touchedCi:boolean, beatCount:number}}
 */
export function decomposeEffort(step = {}) {
  const feedback = Array.isArray(step.feedback) ? step.feedback : [];
  const completedAt = step.completedAt || deriveCompletedAt(feedback);
  const wallMs = _ms(step.dispatchedAt, completedAt);
  const beats = parseHeartbeats(feedback).filter((b) => b.elapsedSeconds != null);
  const touchedCi = feedback.some((f) => CI_TEST_SIGNATURE.test(f?.message || ''));

  const out = { wallMs, onboardingMs: 0, activeMs: 0, waitingMs: 0, wrapupMs: 0,
                unclassifiedMs: 0, hasBeats: beats.length > 0, touchedCi, beatCount: beats.length };

  if (!beats.length) {
    if (wallMs != null && wallMs > 0) out.unclassifiedMs = wallMs;
    return out;
  }

  let sawWork = false;
  let coveredMs = 0;
  for (const b of beats) {
    const interval = Math.max(0, (b.elapsedSeconds || 0) * 1000);
    coveredMs += interval;
    if (!sawWork && (b.toolCount || 0) === 0) out.onboardingMs += interval;
    else if ((b.toolCount || 0) > 0) out.activeMs += interval;
    else out.waitingMs += interval;
    if ((b.total || 0) > 0 || (b.toolCount || 0) > 0) sawWork = true;
  }
  // Time after the last heartbeat until the terminal marker = wrap-up (finalize).
  if (wallMs != null) out.wrapupMs = Math.max(0, wallMs - coveredMs);
  return out;
}

/** Median of a numeric array; null when empty. */
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Aggregate a flat list of steps: phase buckets, per-kind, effort totals,
 * queue-wait, coverage. Pure.
 * @param {Array<Object>} items enriched steps
 */
export function summarizeSteps(items = []) {
  const byBucket = {}, byKind = {};
  const zero = () => ({ onboardingMs: 0, activeMs: 0, waitingMs: 0, wrapupMs: 0, unclassifiedMs: 0 });
  // Effort is split worker-vs-orchestration: an orchestrator/`wake` step is alive
  // (watching) for the whole run, overlapping its workers, so its long post-
  // heartbeat "tail" is watch-idle, NOT task finalization. Folding it into the
  // worker effort split would swamp the real signal (LIN-987). `effort` stays the
  // combined total for back-compat; `workerEffort` is the meaningful one.
  const effort = zero(), workerEffort = zero(), orchEffort = zero();
  const queueWaits = [];
  let openCount = 0, totalActiveWall = 0, ciTouchSteps = 0, decomposedSteps = 0, workerDecomposed = 0;
  let spanMin = null, spanMax = null;

  for (const it of items) {
    const kind = it.kind || 'custom';
    const bucket = bucketOf(kind);
    const completedAt = it.completedAt || deriveCompletedAt(it.feedback || []);
    const dur = completedAt ? _ms(it.dispatchedAt, completedAt) : null;
    const qw = it.resolvedAt ? _ms(it.dispatchedAt, it.resolvedAt) : null;
    if (qw != null && qw >= 0) queueWaits.push(qw);
    if (dur == null) openCount++;
    else totalActiveWall += Math.max(0, dur);
    if (it.dispatchedAt) {
      spanMin = spanMin && spanMin < it.dispatchedAt ? spanMin : it.dispatchedAt;
      const end = completedAt || it.dispatchedAt;
      spanMax = spanMax && spanMax > end ? spanMax : end;
    }

    const B = (byBucket[bucket] ||= { steps: 0, wallMs: 0 });
    B.steps++; if (dur != null && dur >= 0) B.wallMs += dur;
    const K = (byKind[kind] ||= { steps: 0, wallMs: 0, bucket });
    K.steps++; if (dur != null && dur >= 0) K.wallMs += dur;

    const e = decomposeEffort({ ...it, completedAt });
    if (e.hasBeats) decomposedSteps++;
    if (e.touchedCi) ciTouchSteps++;
    const target = bucket === 'orchestration' ? orchEffort : workerEffort;
    if (bucket !== 'orchestration' && e.hasBeats) workerDecomposed++;
    for (const k of Object.keys(effort)) { effort[k] += e[k] || 0; target[k] += e[k] || 0; }
  }

  return { byBucket, byKind, effort, workerEffort, orchEffort, queueWaits, openCount,
           totalActiveWall, ciTouchSteps, decomposedSteps, workerDecomposed,
           steps: items.length, span: { min: spanMin, max: spanMax } };
}

/**
 * Group steps into sessions by `sessionId`. Steps with no sessionId are each
 * their own singleton session (a standalone/manual dispatch), keyed `solo:<id>`.
 * Each session gets its own summary plus a calendar span and tasksTouched.
 * @param {Array<Object>} items
 */
export function groupBySession(items = []) {
  const groups = new Map();
  for (const it of items) {
    const key = it.sessionId || `solo:${it.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const sessions = [];
  for (const [sessionId, steps] of groups) {
    const summary = summarizeSteps(steps);
    const tasks = [...new Set(steps.map((s) => s.issueIdentifier).filter(Boolean))];
    const kinds = {};
    for (const s of steps) kinds[s.kind || 'custom'] = (kinds[s.kind || 'custom'] || 0) + 1;
    const calendarMs = _ms(summary.span.min, summary.span.max);
    sessions.push({
      sessionId, solo: sessionId.startsWith('solo:'),
      steps: steps.length, tasks, kinds, calendarMs,
      activeWallMs: summary.totalActiveWall, effort: summary.effort,
      byBucket: summary.byBucket, openCount: summary.openCount,
      ciTouchSteps: summary.ciTouchSteps, span: summary.span,
    });
  }
  // Real (multi-step / sessioned) runs first, by active wall-clock.
  sessions.sort((a, b) => (b.activeWallMs || 0) - (a.activeWallMs || 0));
  return sessions;
}
