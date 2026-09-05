/**
 * lib/effort-readout.js  (LIN-2641 — Phase 2 of LIN-2566)
 *
 * Pure, network-free per-kind effort self-assessment: for the last N dispatch
 * rows in a workspace, joins per-kind EFFORT x COST x DURATION (from
 * `lib/task-cost.js`'s `buildTaskCost`) with whether the kind's output
 * SURVIVED THE NEXT GATE without a re-pass (`plan` -> plan-review verdict on
 * first pass; `implementation` -> review verdict — both via
 * `lib/plan-review-round-trips.js`'s `{gateKind, rePassKind}` walk, LIN-2592).
 *
 * Zero I/O. Callers (`routes/dashboard.js`) do every read (the two
 * `dispatchQueueStore` reads, the per-issue `description`/comments provider
 * fetch) and hand this module plain data.
 *
 * ── WHY THIS MODULE EXISTS, NOT A THIRD VERDICT WALK ────────────────────────
 * `computePlanReviewRoundTrips` already IS the canonical gate-survival
 * instrument (LIN-1883/LIN-2592). This module's only job is the JOIN: one
 * unified dispatch-row population, fed through `buildTaskCost` for cost/
 * duration/effort and through the walk (twice, once per gate pair) for
 * survival, meeting in one per-kind record.
 *
 * ── THE INPUT CONTRACT J1 GOT WRONG (plan-review `583701c2`) ────────────────
 * `computePlanReviewRoundTrips` takes ISSUE OBJECTS
 * (`{id, identifier, description, comments, rows}`, see that module's own
 * header), never a bare row set. Passing rows directly makes every issue's
 * `rows` read as `[]` (`pipelineRowsOf` reads `issue.rows`, and a dispatch row
 * has no `.rows`), so both survival columns silently ship empty — the exact
 * defect `buildIssueCorpus` below exists to close. See its own docstring for
 * the fix and `tests/unit/effort-readout.test.js`'s G2 pin for the executed
 * proof (red on a row-set, green on issue objects).
 *
 * ── SHIP_EMPTY (ruling `5ec445a0`, D10) ─────────────────────────────────────
 * The effort cell reads `workerSessions[].effort` (telemetry-realised) and
 * renders it when present, "not reported" when absent — never the raw
 * dispatch row's REQUESTED `effort` (`lib/dispatch-validation.js`). At HEAD
 * every worker session's `effort` is `null` (the runner does not yet emit it;
 * LIN-2567, in progress, independently) — "ships empty" describes today's
 * data, not a new branch keyed on whether LIN-2567 has landed.
 */

import { anchorFor, buildTaskCost } from './task-cost.js';
import {
  mergeLineageFeedback,
  deriveLifecycleStatus,
  deriveCompletedAt,
  feedbackWithHarvestedAbort,
  harvestAbortedTargets,
} from './dispatch-terminal.js';
import {
  computePlanReviewRoundTrips,
  NO_ATTEMPT_STATUSES,
  IN_FLIGHT_STATUSES,
} from './plan-review-round-trips.js';

// The four explicitly-named orchestration kinds (LIN-2566 §"Other established
// constraints"). NOT `bucketOf(kind) === 'orchestration'` — that fallback
// (`lib/wall-clock-summary.js`'s `BUCKET_OF_KIND[kind] || 'orchestration'`)
// silently routes any kind absent from its map here too, mislabelling real
// task-phase kinds (`bug`, `defer` at today's HEAD) as orchestration overhead.
// `wake` is deliberately included though it is absent from `DISPATCH_KINDS`
// itself (it reaches the join through row data, not the enum) — it is the
// single most common kind in this workspace's live queue.
export const ORCHESTRATION_KINDS = new Set(['autopilot', 'wake', 'custom', 'periodical']);

// `research -> re-grounding` is not instrumented (proved absent — zero hits
// for refuted/re-ground/reground/re-grounded outside prompt text). Render as
// such; never tune `research` effort from a signal that does not exist.
export const NOT_INSTRUMENTED_KINDS = new Set(['research']);

// Which gate pair computes which kind's survival (LIN-2592).
const SURVIVAL_SOURCE = { plan: 'planRow', implementation: 'reviewRow' };

/**
 * Adapter closing G1 (missing status/feedback/completedAt on a live-queue
 * row) and Revision-1's F1 (raw `status` vs. derived `lifecycleStatus` are
 * two different vocabularies, and a caller reading the wrong one for the
 * wrong purpose silently mis-scores a row) in ONE function over ONE row
 * shape, for both read paths.
 *
 * - Live rows (`isLive: true`): `listItems`/`_formatItem` emits no `status`,
 *   `feedback`, or `completedAt` key at all (confirmed `lib/dispatch-store.js`
 *   :2125-2236). Stamped `status: 'queued', feedback: [], completedAt: null,
 *   lifecycleStatus: 'queued'` — extending (not mirroring) the two-field
 *   live-queue stamp at `routes/proxy-dispatch.js:1079`.
 * - History rows (`isLive: false`): `_formatHistoryItem` always emits raw
 *   `status`, but `feedback` is ABSENT as a key (not `[]`) when empty, and
 *   `completedAt` is never emitted. For a `status === 'taken'` row (the same
 *   gate `routes/proxy-dispatch.js:1194` uses), the lineage-merged feedback
 *   (own + verified siblings + any harvested abort targeting this row)
 *   derives `lifecycleStatus`/`completedAt`; any other raw status needs no
 *   derivation.
 *
 * `abortedTargets` (from `harvestAbortedTargets` over the WHOLE raw corpus,
 * per B3) lets an abort recorded on a separate row (`issueIdentifier: null`)
 * still resolve this row's terminality when this read is workspace-wide —
 * unlike an issue-scoped read, the abort row is genuinely present here.
 *
 * @param {Object} row  raw formatted row (`_formatItem`/`_formatHistoryItem` shape)
 * @param {Object} opts
 * @param {boolean} opts.isLive
 * @param {Array<Object>} [opts.siblingRows]  other rows sharing this row's lineage anchor
 * @param {Map<string,Object>} [opts.abortedTargets]  `harvestAbortedTargets` output
 * @returns {Object}  `{...row, status, feedback, completedAt, lifecycleStatus}`
 */
export function normalizeDispatchRow(row, { isLive, siblingRows = [], abortedTargets = new Map() } = {}) {
  if (isLive) {
    return { ...row, status: 'queued', feedback: [], completedAt: null, lifecycleStatus: 'queued' };
  }
  const feedback = row.feedback || [];
  let lifecycleStatus = row.status;
  let completedAt = null;
  if (row.status === 'taken') {
    const anchor = anchorFor(row);
    const terminalFeedback = feedbackWithHarvestedAbort(
      mergeLineageFeedback(feedback, siblingRows, anchor, row.dispatchedAt),
      abortedTargets.get(row.id)
    );
    lifecycleStatus = deriveLifecycleStatus(terminalFeedback) || row.status;
    completedAt = deriveCompletedAt(terminalFeedback);
  }
  return { ...row, feedback, status: row.status, lifecycleStatus, completedAt };
}

/**
 * Partition a normalized row set into: rows eligible for both joins (a
 * settled attempt), rows excluded because they never ran (`NO_ATTEMPT`,
 * per-kind counted), and rows right-censored because they are still in
 * flight (per-kind counted). Reads `lifecycleStatus`/`completedAt` only
 * (never raw `status`) — this IS the population the two joins share (step 3).
 *
 * @param {Array<Object>} rows  normalized rows (see `normalizeDispatchRow`)
 * @returns {{eligible: Array<Object>, excludedByKind: Object, inFlightByKind: Object}}
 */
export function partitionPopulation(rows) {
  const eligible = [];
  const excludedByKind = {};
  const inFlightByKind = {};
  for (const row of rows) {
    const kind = row.kind || 'custom';
    if (NO_ATTEMPT_STATUSES.has(row.lifecycleStatus)) {
      const bucket = (excludedByKind[kind] ||= {});
      bucket[row.lifecycleStatus] = (bucket[row.lifecycleStatus] || 0) + 1;
      continue;
    }
    if (IN_FLIGHT_STATUSES.has(row.lifecycleStatus) && !row.completedAt) {
      const bucket = (inFlightByKind[kind] ||= {});
      bucket[row.lifecycleStatus] = (bucket[row.lifecycleStatus] || 0) + 1;
      continue;
    }
    eligible.push(row);
  }
  return { eligible, excludedByKind, inFlightByKind };
}

/**
 * Group the eligible population into the per-issue objects
 * `computePlanReviewRoundTrips` actually requires (J1, plan-review
 * `583701c2`): `{id, identifier, description, comments, rows}`, where `rows`
 * carries the CONTRACT's fields (`id, kind, status, dispatchedAt, completedAt,
 * feedback`), `status` re-pointed at each row's own `lifecycleStatus` (a
 * field rename, not a second filter — it cannot select a different
 * population).
 *
 * `issueContext` supplies `description`/`comments` per issue identifier
 * (fetched by the ROUTE via the provider seam — this module stays zero-I/O).
 * An identifier missing from `issueContext` degrades to `description: ''`,
 * `comments: []` — never thrown — so a skipped/failed per-issue fetch still
 * lets every OTHER issue's rows compute; the route tracks the skip count and
 * threads it into `computePlanReviewRoundTrips`'s own `options.skipped`.
 *
 * @param {Array<Object>} eligibleRows
 * @param {Map<string, {id?: string, description?: string, comments?: Array}>} issueContext
 * @returns {Array<Object>} the input contract array
 */
export function buildIssueCorpus(eligibleRows, issueContext = new Map()) {
  const byIdentifier = new Map();
  for (const row of eligibleRows) {
    const identifier = row.issueIdentifier;
    if (!identifier) continue;
    if (!byIdentifier.has(identifier)) byIdentifier.set(identifier, []);
    byIdentifier.get(identifier).push({
      id: row.id,
      kind: row.kind || 'custom',
      status: row.lifecycleStatus,
      dispatchedAt: row.dispatchedAt,
      completedAt: row.completedAt,
      feedback: row.feedback || [],
    });
  }

  const corpus = [];
  for (const [identifier, rows] of byIdentifier) {
    const ctx = issueContext.get(identifier) || {};
    corpus.push({
      id: ctx.id || rows[0].id,
      identifier,
      description: typeof ctx.description === 'string' ? ctx.description : '',
      comments: Array.isArray(ctx.comments) ? ctx.comments : [],
      rows,
    });
  }
  return corpus;
}

/**
 * The issue identifiers the caller must fetch `description`/comments for — the
 * eligible population's own issues, and only those. Exported so the ROUTE can
 * bound its provider fan-out without re-implementing (or drifting from) the
 * population rule: this runs the SAME `normalizeDispatchRow` +
 * `partitionPopulation` pair `computeEffortReadout` runs, so the set of issues
 * fetched and the set of issues scored cannot disagree.
 *
 * @param {{liveRows?: Array<Object>, historyRows?: Array<Object>}} params
 * @returns {Array<string>} unique issue identifiers, in first-seen order
 */
export function eligibleIssueIdentifiers({ liveRows = [], historyRows = [] } = {}) {
  const { eligible } = partitionPopulation(normalizeCorpus(liveRows, historyRows).normalized);
  const seen = [];
  const set = new Set();
  for (const row of eligible) {
    if (row.issueIdentifier && !set.has(row.issueIdentifier)) {
      set.add(row.issueIdentifier);
      seen.push(row.issueIdentifier);
    }
  }
  return seen;
}

/**
 * Tier a/b-only survival over a `computePlanReviewRoundTrips` result (S1,
 * D9): the `review` gate is universal, not `plan-review`-gated, so tier c
 * (a request-changes re-pass, or a non-re-pass row following) resolves an
 * issue whether or not a human ever posted a parseable verdict comment —
 * biasing the pooled rate downward by verdict-comment coverage on the
 * approve side only. Computed over tier a/b-resolved issues only; tier-c
 * resolved issues are counted and returned SEPARATELY, never pooled into the
 * denominator. `plan` needs no such split (`plan-review` is a `before`-bucket
 * gate, so tier c already resolves its approve case too) — callers use
 * `result.primary` directly for `plan`.
 *
 * @param {Object} result  a `computePlanReviewRoundTrips` return value
 * @returns {{numerator: number, denominator: number, rate: number|null, tierCCount: number}}
 */
export function tierAbSurvival(result) {
  let numerator = 0;
  let denominator = 0;
  let tierCCount = 0;
  for (const p of result.perIssue) {
    if (!p.R0 || !p.R0.resolved) continue;
    if (p.R0.tier === 'c') {
      tierCCount++;
      continue;
    }
    denominator++;
    if (p.R0.verdict === 'approve') numerator++;
  }
  return { numerator, denominator, rate: denominator ? numerator / denominator : null, tierCCount };
}

/**
 * Normalise one raw two-read corpus (live + history) in the single order the
 * whole module depends on. Sibling grouping happens on the RAW corpus (every
 * status) — a sibling's own feedback matters to the lineage merge regardless
 * of whether that sibling is itself eligible. J2/B3: this workspace-wide read
 * already CONTAINS every sibling inside the window, so the map is derived
 * in-memory here rather than by a third `listHistory` call; a lineage whose
 * siblings resolved outside the window loses those members and right-censors
 * (fails safe — under-counts, never fabricates), which the surface discloses.
 *
 * @param {Array<Object>} liveRows
 * @param {Array<Object>} historyRows
 * @returns {{normalized: Array<Object>, siblingsByAnchor: Map<string, Array<Object>>}}
 */
function normalizeCorpus(liveRows, historyRows) {
  const rawRows = [
    ...liveRows.map((r) => ({ ...r, __isLive: true })),
    ...historyRows.map((r) => ({ ...r, __isLive: false })),
  ];
  const siblingsByAnchor = new Map();
  for (const row of rawRows) {
    const anchor = anchorFor(row);
    if (!anchor) continue;
    if (!siblingsByAnchor.has(anchor)) siblingsByAnchor.set(anchor, []);
    siblingsByAnchor.get(anchor).push(row);
  }
  const abortedTargets = harvestAbortedTargets(rawRows);
  const normalized = rawRows.map((row) => {
    const anchor = anchorFor(row);
    const siblings = (siblingsByAnchor.get(anchor) || []).filter((s) => s.id !== row.id);
    return normalizeDispatchRow(row, { isLive: row.__isLive, siblingRows: siblings, abortedTargets });
  });
  return { normalized, siblingsByAnchor };
}

/**
 * The full per-kind effort read-out. Pure; every instant that matters
 * (`asOf`) arrives as a required parameter (G3) and is threaded, unchanged,
 * to both `computePlanReviewRoundTrips` calls.
 *
 * @param {Object} params
 * @param {Array<Object>} params.liveRows  raw `listItems` rows (TTL-bounded, not row-capped)
 * @param {Array<Object>} params.historyRows  raw `listHistory` rows (row-bounded at the caller's `limit`)
 * @param {number} [params.historyTotal]  `listHistory`'s pre-slice `total` — the full matching count, for the population caption
 * @param {Map<string, Object>} [params.issueContext]  per-identifier `{id, description, comments}` (route-fetched)
 * @param {string} params.asOf  REQUIRED ISO instant (page-load `now`)
 * @param {number} [params.skipped]  per-issue provider-fetch failures the route could not read (threaded into both walks' `completeness`)
 * @param {boolean} [params.survivalAvailable=true]  false when the workspace's provider cannot serve comments
 *   (`supports('fetchIssueComments')`) — the survival columns then report
 *   "unavailable for this provider" rather than a fabricated zero; cost/
 *   duration/effort still render.
 * @param {boolean} [params.gateFieldsAvailable=true]  false when no per-issue `description`
 *   could be read — `gateDue`/`gateHonoured` are then OMITTED from the plan
 *   card rather than rendered as a uniform zero that is not a measurement
 *   (plan-review `583701c2` J1, second half).
 * @returns {Object}
 */
export function computeEffortReadout({
  liveRows = [],
  historyRows = [],
  historyTotal = historyRows.length,
  issueContext = new Map(),
  asOf,
  skipped = 0,
  survivalAvailable = true,
  gateFieldsAvailable = true,
} = {}) {
  if (typeof asOf !== 'string' && !(asOf instanceof Date)) {
    throw new Error('computeEffortReadout: asOf must be a parseable ISO instant');
  }

  const { normalized, siblingsByAnchor } = normalizeCorpus(liveRows, historyRows);
  const { eligible, excludedByKind, inFlightByKind } = partitionPopulation(normalized);

  // Step 4 — cost/duration/effort. `ownRows` carries RAW `status` (untouched);
  // after the population filter every eligible row's raw status is 'taken'
  // (a settled lifecycle value is derived only from a 'taken' row). Siblings
  // come from the SAME raw corpus grouped above, not a second read.
  const taskCost = buildTaskCost({ ownRows: eligible, siblingRowsByAnchor: siblingsByAnchor });
  const workerSessionsByKind = new Map();
  for (const ws of taskCost.workerSessions) {
    const kind = ws.kind || 'custom';
    if (!workerSessionsByKind.has(kind)) workerSessionsByKind.set(kind, []);
    workerSessionsByKind.get(kind).push(ws);
  }

  // Step 5 — survival, two calls over one corpus (G2/G3/G4).
  const corpus = buildIssueCorpus(eligible, issueContext);
  // A provider that cannot serve comments cannot resolve a verdict at all, so
  // the walk would return a well-formed all-zero result that reads as "nothing
  // survived" rather than "nothing was measured". Skip it and say so.
  const planRow = survivalAvailable ? computePlanReviewRoundTrips(corpus, { asOf, skipped }) : null;
  const reviewRow = survivalAvailable
    ? computePlanReviewRoundTrips(corpus, { asOf, gateKind: 'review', rePassKind: 'implementation', skipped })
    : null;
  const reviewTierAb = reviewRow ? tierAbSurvival(reviewRow) : null;

  // Step 6 — join, total function over every kind present anywhere in the
  // read corpus (F1) — a kind whose every row is excluded/in-flight still
  // gets a card (cost/duration/effort empty, survival per its own state),
  // rather than vanishing silently.
  const kinds = new Set(normalized.map((r) => r.kind || 'custom'));

  const perKind = [...kinds].sort().map((kind) => {
    const sessions = workerSessionsByKind.get(kind) || [];
    const costUsd = sessions.every((s) => s.costUsd == null)
      ? null
      : sessions.reduce((sum, s) => sum + (s.costUsd || 0), 0);
    const durationSamples = sessions.map((s) => s.durationMs).filter((d) => d != null);
    const durationMs = durationSamples.length
      ? durationSamples.reduce((a, b) => a + b, 0) / durationSamples.length
      : null;
    const effortLevels = sessions.map((s) => s.effort).filter(Boolean);
    const effortDistribution = effortLevels.length
      ? effortLevels.reduce((acc, level) => ((acc[level] = (acc[level] || 0) + 1), acc), {})
      : null;

    let survival;
    if (SURVIVAL_SOURCE[kind] && !survivalAvailable) {
      survival = { state: 'unavailable_provider' };
    } else if (kind === 'plan') {
      survival = {
        state: 'computed',
        numerator: planRow.primary.numerator,
        denominator: planRow.primary.denominator,
        rate: planRow.primary.rate,
        // J1 (second half): `gateDue`/`gateHonoured` are read from the issue
        // DESCRIPTION (`GATE_DUE_MARKER`). With no description read they would
        // render a uniform zero that is not a measurement, so they are omitted
        // — never emitted as a plausible-looking 0.
        ...(gateFieldsAvailable ? {
          gateDue: planRow.gate.due,
          gateHonoured: planRow.gate.honoured,
          gateDueRate: planRow.gate.dueRate,
          gateHonouredRate: planRow.gate.honouredRate,
        } : { gateFieldsUnavailable: true }),
      };
    } else if (kind === 'implementation') {
      survival = {
        state: 'computed',
        numerator: reviewTierAb.numerator,
        denominator: reviewTierAb.denominator,
        rate: reviewTierAb.rate,
        tierCCount: reviewTierAb.tierCCount,
        comparableToPlanRate: false,
      };
    } else if (NOT_INSTRUMENTED_KINDS.has(kind)) {
      survival = { state: 'not_instrumented' };
    } else if (ORCHESTRATION_KINDS.has(kind)) {
      survival = { state: 'not_applicable_orchestration' };
    } else {
      survival = { state: 'not_applicable_no_gate' };
    }

    return {
      kind,
      sessionCount: sessions.length,
      costUsd,
      costUnit: 'lineage',
      durationMs,
      effort: effortDistribution,
      survival,
      survivalUnit: SURVIVAL_SOURCE[kind] ? 'issue' : null,
      excluded: excludedByKind[kind] || {},
      inFlight: inFlightByKind[kind] || {},
    };
  });

  return {
    perKind,
    population: {
      liveCount: liveRows.length,
      liveBound: 'ttl',
      historyCount: historyRows.length,
      historyTotal,
      historyBound: 'row-limit',
      historyTruncated: historyTotal > historyRows.length,
    },
    completeness: {
      issuesInCorpus: corpus.length,
      skipped,
      complete: skipped === 0,
    },
    notes: {
      reviewGateDueHonoured:
        'gateDue/gateHonoured are plan-pair-only (GATE_DUE_MARKER is a plan-phase description-text marker); they are not rendered for the review pair, which has no `review due:` analogue.',
      orchestrationKinds:
        'Orchestration-step kinds (autopilot, wake, custom, periodical) are excluded from survival by construction, not because they were never measured.',
      noGatePairKinds:
        'A kind with no defined next-gate pair (e.g. plan-review, review, close-out) still reports cost/duration/effort; it has no survival concept, which is distinct from "not yet instrumented".',
      denominatorsNotComparable:
        "The plan card's survival rate pools verdict tiers a/b/c; the implementation card's pools tiers a/b only (tier-c count shown beside it) — the two rates are not directly comparable.",
      siblingCompleteness:
        'Lineage siblings are derived in-memory from this same bounded read (no third store call); a lineage whose sibling rows fall outside the 200-row history window is right-censored, not mis-scored — see population.historyTruncated.',
      costUnit:
        'Cost/duration/effort are per dispatch LINEAGE (anchor-attributed); survival is per ISSUE. A kind with N lineages on one issue reports N sessions but 1 survival row.',
      ...(survivalAvailable ? {} : {
        survivalUnavailable:
          "This workspace's provider does not serve issue comments, so no gate verdict can be resolved. The survival columns report unavailable rather than zero; cost, duration and effort are unaffected.",
      }),
      ...(gateFieldsAvailable ? {} : {
        gateFieldsUnavailable:
          'No per-issue description could be read, so plan-review due/honoured are omitted rather than reported as zero (they are derived from description text).',
      }),
      effortShipEmpty:
        "The effort column is empty by design: this workspace's runner does not yet report a realised effort value per run (LIN-2567, tracked separately, in progress). It reads the SAME telemetry field either way — no rework needed once LIN-2567 lands.",
    },
  };
}
