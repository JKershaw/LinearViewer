/**
 * lib/task-cost.js
 *
 * Pure per-task cost aggregator (LIN-1775) — joins worker dispatch usage
 * telemetry with app-level LLM call-log spend into one API-equivalent USD
 * figure. Network/clock-free: callers fetch the dispatch rows and the
 * call-log summary; this module only joins and sums them.
 *
 * Correctness rests on processing each dispatch LINEAGE exactly once, never
 * once per row: a follow-up dispatch resumes the same transcript and the
 * runner reports a CUMULATIVE usage snapshot on every Stop (see
 * lib/session-telemetry.js), so every row in one lineage reports overlapping
 * totals. Summing per row would multiply a lineage by its dispatch count.
 * `buildTaskCost` groups rows into lineages with `groupLineageMembership`
 * (lib/lineage-membership.js, LIN-4147), which decides which rows belong to a
 * lineage and which issue it counts under, and folds each lineage's member
 * rows into one usage with `foldLineageUsage` (lib/row-usage.js, LIN-4136).
 * A member's usage is its own last usage entry. The lineage's duration still
 * comes from its merged feedback (`mergeLineageFeedback`).
 *
 * LIN-4147: with `issueIdentifier` set, only the lineages that count under that
 * issue are reported. A lineage counts under one issue or none, so each model
 * call is priced once across every `/cost` answer.
 *
 * `totalUsd` is null whenever any component is not fully priced or
 * accounted for — a worker session with an unpriced model, a `taken` row
 * with no usage telemetry at all, a lineage whose usage could not be read
 * (LIN-4136: `unreadableCount`), or unpriced app calls — never a silent
 * partial (LIN-1086's nullable-cost convention, extended to the join).
 * `pricedUsd` (worker-side only) always sums whatever IS priceable.
 *
 * LIN-2253: `totalUsd` is ALSO null whenever `ownRows` yields zero `taken`
 * lineages (`noLineage: true`) — an issue that landed inside a multi-ticket
 * worker lane as a non-anchor ticket has no dispatch row of its own, so
 * `ownRows` arrives empty. Before this fix that emptiness vacuously
 * satisfied "everything priced" (an empty set has no unpriced member),
 * producing `totalUsd: 0, unpriced: [], noTelemetryCount: 0` — a caller
 * could not tell "this issue confirmed $0" apart from "this issue is
 * invisible to the join." `noLineage` makes that distinction explicit and
 * gates `totalUsd` shut until it is false, exactly like the other
 * incompleteness signals above.
 */

import { mergeLineageFeedback, deriveCompletedAt } from './dispatch-terminal.js';
import { readRowUsage } from './session-telemetry.js';
import { foldLineageUsage } from './row-usage.js';
import { anchorOf, groupLineageMembership, isMember } from './lineage-membership.js';

const EMPTY_APP_CALLS = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };

/**
 * The rows with each row once, keyed by id. A later row with the same id replaces
 * an earlier one. A row with no id at all is kept (it cannot be a duplicate).
 *
 * @param {Array<Object>} rows
 * @returns {Array<Object>}
 */
function distinctRows(rows) {
  const byId = new Map();
  const withoutId = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const key = row.id ?? row._id;
    if (key === undefined) withoutId.push(row);
    else byId.set(String(key), row);
  }
  return [...byId.values(), ...withoutId];
}

/**
 * Join worker dispatch usage + app-call spend into one task-cost breakdown.
 *
 * @param {Object} params
 * @param {Array<Object>} params.ownRows - Dispatch rows (live queue + history,
 *   merged), in the `/dispatch` list route's formatted shape ({id, status,
 *   dispatchedAt, feedback, kind, rootItemId, ...}). Rows whose `status !==
 *   'taken'` never ran and are filtered out here (mirrors the `/dispatch`
 *   list route's own allowlist). Row-set-agnostic: the `/dispatch` list
 *   route scopes this to one task's `issueIdentifier`, but LIN-2641's
 *   cross-issue per-kind read-out (`lib/effort-readout.js`) hands this a
 *   whole-workspace row set instead — nothing here assumes single-issue scope.
 * @param {Map<string, Array<Object>>} [params.siblingRowsByAnchor] - Rows
 *   sharing a lineage anchor with one of `ownRows`, batch-fetched UNSCOPED by
 *   issueIdentifier (a cross-issue follow-up must still merge for cost
 *   correctness). The keys are only how the caller batched its fetch: membership
 *   is decided per row, so every sibling is pooled and regrouped by its own anchor.
 * @param {Object} [params.appSummary] - `LlmCallLogStore.summarizeByIssue()`'s
 *   return shape; defaults to the empty shape.
 * @param {string} [params.issueIdentifier] - LIN-4147: when set, report only the
 *   lineages that count under this issue (`lineage.issueIdentifier`). Unset, every
 *   lineage `ownRows` touches is reported.
 * @returns {{
 *   pricedUsd: number,
 *   totalUsd: number|null,
 *   unpriced: string[],
 *   noTelemetryCount: number,
 *   unreadableCount: number,
 *   noLineage: boolean,
 *   workerSessions: Array<{rootItemId: string, kind: string, dispatchedAt: string|null, harness: string|null, model: string|null, effort: string|null, costUsd: number|null, durationMs: number|null, telemetry: boolean}>,
 *   appCalls: Object
 * }}
 */
export function buildTaskCost({ ownRows = [], siblingRowsByAnchor = new Map(), appSummary = EMPTY_APP_CALLS, issueIdentifier } = {}) {
  // One pool: the siblings and the own rows, a row once. A row listed in both
  // (the unscoped sibling fetch can re-return a same-issue row) keeps its own copy.
  const pool = distinctRows([...[...siblingRowsByAnchor.values()].flat(), ...ownRows]);
  const memberships = groupLineageMembership(pool);
  // The lineages reported are those an own row is a member of; a sibling-only
  // lineage (no own row in it) belongs to some other issue's read.
  const ownAnchors = new Set(ownRows.filter(row => row && isMember(row)).map(anchorOf));

  let pricedUsd = 0;
  let noTelemetryCount = 0;
  let unreadableCount = 0;
  let lineageCount = 0;
  const unpricedModels = new Set();
  const workerSessions = [];

  for (const [anchor, lineage] of memberships) {
    if (!ownAnchors.has(anchor)) continue;
    if (issueIdentifier !== undefined && lineage.issueIdentifier !== issueIdentifier) continue;
    lineageCount++;

    // The merge base is the lineage's earliest member: its `dispatchedAt` is
    // `mergeLineageFeedback`'s forward-only `since` bound, and its `kind` labels
    // the worker session.
    const [base, ...others] = lineage.members;
    const merged = mergeLineageFeedback(base.feedback, others, anchor, base.dispatchedAt);
    const usage = foldLineageUsage(lineage.members.map(member => readRowUsage(member.feedback)));
    // LIN-2615: derived from the SAME merged lineage feedback both branches
    // below already have in hand — the terminal marker's timestamp minus
    // dispatchedAt, null until a terminal marker exists or either endpoint
    // is missing (mirrors deriveRuntime's non-negative guard, LIN-400).
    // LIN-2641: this is the LINEAGE-MERGED duration (anchor-scoped, one figure
    // per lineage) — a DIFFERENT derivation from `lib/wall-clock-summary.js`'s
    // `decomposeEffort`, which is offline-only and step-scoped (one figure per
    // dispatch row, using only that row's own feedback). The two diverge by
    // design; `lib/effort-readout.js` uses THIS one. Do not conflate them.
    const completedAt = deriveCompletedAt(merged);
    const durationMs = (base.dispatchedAt && completedAt)
      ? (() => {
          const ms = new Date(completedAt).getTime() - new Date(base.dispatchedAt).getTime();
          return Number.isFinite(ms) && ms >= 0 ? ms : null;
        })()
      : null;

    // LIN-4136: `no-usage` is the only case that counts as no telemetry. A row whose usage did not
    // parse posted something, so it is counted apart: its figure is unknown, never the stale one.
    if (usage.completeness === 'no-usage') {
      noTelemetryCount += 1;
      // LIN-3855: `telemetry` says whether the run posted any [usage]; a false row is unknown spend, never $0.
      workerSessions.push({ rootItemId: anchor, kind: base.kind || 'custom', dispatchedAt: base.dispatchedAt || null, harness: null, model: null, effort: null, costUsd: null, durationMs, telemetry: false });
      continue;
    }

    if (usage.completeness === 'unreadable') {
      unreadableCount += 1;
      workerSessions.push({ rootItemId: anchor, kind: base.kind || 'custom', dispatchedAt: base.dispatchedAt || null, harness: null, model: null, effort: null, costUsd: null, durationMs, telemetry: true });
      continue;
    }

    if (usage.completeness === 'complete') pricedUsd += usage.costUsd;
    for (const model of usage.unpricedModels) unpricedModels.add(model);

    // LIN-2830: `harness` is the REALISED harness the run itself stamped on its
    // [usage] telemetry (both harnesses do — hook.js 'claude-code',
    // opencode-runner.js 'opencode'), never the dispatch row's REQUESTED
    // `harness` field — the same realised-never-requested ruling the effort
    // column already carries (D10). The labels come from the lineage's last
    // counted row, the same row whose figure the lineage shows.
    const last = usage.last;
    workerSessions.push({
      rootItemId: anchor,
      kind: base.kind || 'custom',
      dispatchedAt: base.dispatchedAt || null,
      harness: last?.harness || null,
      model: last?.model || null,
      effort: last?.effort || null,
      costUsd: usage.costUsd,
      durationMs,
      telemetry: true
    });
  }

  const appCalls = appSummary || EMPTY_APP_CALLS;
  const unpriced = [...unpricedModels];
  // LIN-2253: `noLineage` — no lineage is reported (no own row is a member of
  // one, or none counts under the requested issue) — gates `fullyPriced` shut
  // the same as an unpriced model or a missing-telemetry row would. Without
  // this an empty set of lineages vacuously satisfies every other condition
  // (there is no member to fail them), so a lane-landed ticket with no
  // dispatch row of its own would otherwise read as a confirmed $0 rather
  // than "no data".
  const noLineage = lineageCount === 0;
  const fullyPriced = !noLineage && unpriced.length === 0 && noTelemetryCount === 0 && unreadableCount === 0 && (appCalls.unpricedCalls || 0) === 0;

  return {
    pricedUsd,
    totalUsd: fullyPriced ? pricedUsd + (appCalls.costUsd || 0) : null,
    unpriced,
    noTelemetryCount,
    unreadableCount,
    noLineage,
    workerSessions,
    appCalls
  };
}
