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
 * `buildTaskCost` groups rows by lineage anchor first (`anchorFor`, the same
 * two-tier precedence pinned at the `/dispatch` list route in
 * routes/proxy.js), merges each lineage's feedback via
 * `mergeLineageFeedback` (lib/dispatch-terminal.js), and parses it ONCE with
 * `parseUsage` (lib/session-telemetry.js) — the exact primitives the
 * `/dispatch` list route already relies on for lineage-spanning status.
 *
 * `totalUsd` is null whenever any component is not fully priced or
 * accounted for — a worker session with an unpriced model, a `taken` row
 * with no usage telemetry at all, or unpriced app calls — never a silent
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
import { parseUsage } from './session-telemetry.js';

/**
 * The lineage anchor a dispatch row belongs to — the same two-tier
 * precedence the `/dispatch` list route derives inline (routes/proxy.js):
 * the row's own `rootItemId`, else the first OWN feedback entry carrying
 * one, else the row's own id.
 *
 * @param {{id?: string, rootItemId?: string, feedback?: Array}} item
 * @returns {string|undefined}
 */
export function anchorFor(item) {
  return item.rootItemId ?? item.feedback?.find(f => f.rootItemId)?.rootItemId ?? item.id;
}

const EMPTY_APP_CALLS = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };

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
 *   sharing a lineage anchor with one of `ownRows`, keyed by anchor,
 *   batch-fetched UNSCOPED by issueIdentifier (a cross-issue follow-up must
 *   still merge for cost correctness).
 * @param {Object} [params.appSummary] - `LlmCallLogStore.summarizeByIssue()`'s
 *   return shape; defaults to the empty shape.
 * @returns {{
 *   pricedUsd: number,
 *   totalUsd: number|null,
 *   unpriced: string[],
 *   noTelemetryCount: number,
 *   noLineage: boolean,
 *   workerSessions: Array<{rootItemId: string, kind: string, dispatchedAt: string|null, model: string|null, effort: string|null, costUsd: number|null, durationMs: number|null}>,
 *   appCalls: Object
 * }}
 */
export function buildTaskCost({ ownRows = [], siblingRowsByAnchor = new Map(), appSummary = EMPTY_APP_CALLS } = {}) {
  const taken = ownRows.filter(row => row && row.status === 'taken');

  // Group taken rows by lineage anchor, keeping the earliest-dispatched row
  // per anchor as the merge base — its `dispatchedAt` is `mergeLineageFeedback`'s
  // forward-only `since` bound, and its `kind` labels the worker session.
  const lineages = new Map();
  for (const row of taken) {
    const anchor = anchorFor(row);
    if (!anchor) continue;
    const existing = lineages.get(anchor);
    if (!existing) {
      lineages.set(anchor, { base: row, extraOwnRows: [] });
    } else if (new Date(row.dispatchedAt || 0).getTime() < new Date(existing.base.dispatchedAt || 0).getTime()) {
      lineages.set(anchor, { base: row, extraOwnRows: [...existing.extraOwnRows, existing.base] });
    } else {
      existing.extraOwnRows.push(row);
    }
  }

  let pricedUsd = 0;
  let noTelemetryCount = 0;
  const unpricedModels = new Set();
  const workerSessions = [];

  for (const [anchor, { base, extraOwnRows }] of lineages) {
    // A row may appear in both `extraOwnRows` (this issue's own siblings) and
    // the batch-fetched `siblingRowsByAnchor` (unscoped, so it can re-include
    // the same rows) — dedupe by id so `mergeLineageFeedback` never merges
    // one row's feedback twice.
    const siblingsById = new Map();
    for (const sib of [...extraOwnRows, ...(siblingRowsByAnchor.get(anchor) || [])]) {
      if (sib.id !== base.id) siblingsById.set(sib.id, sib);
    }
    const merged = mergeLineageFeedback(base.feedback, [...siblingsById.values()], anchor, base.dispatchedAt);
    const usage = parseUsage(merged);
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

    if (!usage) {
      noTelemetryCount += 1;
      workerSessions.push({ rootItemId: anchor, kind: base.kind || 'custom', dispatchedAt: base.dispatchedAt || null, model: null, effort: null, costUsd: null, durationMs });
      continue;
    }

    const priced = typeof usage.costUsd === 'number';
    if (priced) pricedUsd += usage.costUsd;
    else unpricedModels.add(usage.model || 'unknown');

    workerSessions.push({
      rootItemId: anchor,
      kind: base.kind || 'custom',
      dispatchedAt: base.dispatchedAt || null,
      model: usage.model || null,
      effort: usage.effort || null,
      costUsd: priced ? usage.costUsd : null,
      durationMs
    });
  }

  const appCalls = appSummary || EMPTY_APP_CALLS;
  const unpriced = [...unpricedModels];
  // LIN-2253: `noLineage` — zero `taken` rows resolved to a lineage at all —
  // gates `fullyPriced` shut the same as an unpriced model or a missing-
  // telemetry row would. Without this an empty `lineages` map vacuously
  // satisfies every other condition (there is no member to fail them), so a
  // lane-landed ticket with no dispatch row of its own would otherwise read
  // as a confirmed $0 rather than "no data".
  const noLineage = lineages.size === 0;
  const fullyPriced = !noLineage && unpriced.length === 0 && noTelemetryCount === 0 && (appCalls.unpricedCalls || 0) === 0;

  return {
    pricedUsd,
    totalUsd: fullyPriced ? pricedUsd + (appCalls.costUsd || 0) : null,
    unpriced,
    noTelemetryCount,
    noLineage,
    workerSessions,
    appCalls
  };
}
