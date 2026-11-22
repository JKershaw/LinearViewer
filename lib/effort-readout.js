/**
 * lib/effort-readout.js  (LIN-2641 — Phase 2 of LIN-2566)
 *
 * Pure, network-free per-kind effort self-assessment: for the last N dispatch
 * rows in a workspace, joins per-kind EFFORT x COST x DURATION (from
 * `lib/cost-read.js`'s `readCost`) with whether the kind's output
 * SURVIVED THE NEXT GATE without a re-pass (`plan` -> plan-review verdict on
 * first pass; `implementation` -> review verdict — both via
 * `lib/plan-review-round-trips.js`'s `{gateKind, rePassKind}` walk, LIN-2592).
 *
 * Zero I/O. Callers (`routes/dashboard.js`) do every read (the two
 * `dispatchQueueStore` reads and the verdict and plan facts from records
 * fetch) and hand this module plain data.
 *
 * ── WHY THIS MODULE EXISTS, NOT A THIRD VERDICT WALK ────────────────────────
 * `computePlanReviewRoundTrips` already IS the canonical gate-survival
 * instrument (LIN-1883/LIN-2592). This module's only job is the JOIN: one
 * unified dispatch-row population, fed through `readCost` for cost/
 * duration/effort and through the walk (twice, once per gate pair) for
 * survival, meeting in one per-kind record.
 *
 * ── THE INPUT CONTRACT J1 GOT WRONG (plan-review `583701c2`) ────────────────
 * `computePlanReviewRoundTrips` takes ISSUE OBJECTS
 * (`{id, identifier, rows}`, see that module's own
 * header), never a bare row set. Passing rows directly makes every issue's
 * `rows` read as `[]` (`pipelineRowsOf` reads `issue.rows`, and a dispatch row
 * has no `.rows`), so both survival columns silently ship empty — the exact
 * defect `buildIssueCorpus` below exists to close. See its own docstring for
 * the fix and `tests/unit/effort-readout.test.js`'s G2 pin for the executed
 * proof (red on a row-set, green on issue objects).
 *
 * ── EFFORT COLUMN HONESTY (ruling `5ec445a0`, D10; corrected R1, review
 * `62e30986`) ────────────────────────────────────────────────────────────────
 * The effort cell reads `workerSessions[].effort` (telemetry-realised) and
 * renders it when present, "not reported" when absent — never the raw
 * dispatch row's REQUESTED `effort` (`lib/dispatch-validation.js`); this read
 * path is unconditional and unchanged by the fix below. LIN-2567 landed mid-
 * implementation, so the ORIGINAL unconditional "ships empty" caption went
 * stale on this workspace's own data (two worker sessions reported `effort`
 * before this fix landed). `notes.effortShipEmpty` is now computed per corpus
 * (`anyEffortReported` below): when genuinely no session in the read corpus has
 * reported one it says so and names no ticket's state (the old empty caption
 * claimed LIN-2567 was still in progress after it landed; LIN-2683), and otherwise
 * states that runs after the stamp populate it while backfill rows stay
 * permanently `null` — never re-asserting a universal absence once it is
 * false.
 *
 * ── HARNESS/MODEL/EFFORT ROWS (LIN-2830) ────────────────────────────────────
 * Each kind card additionally carries `rows`, one per distinct REALISED
 * (harness, model, effort) triple among that kind's worker sessions — the
 * bake-off granularity (LIN-2828/LIN-2831): a run on opencode must be
 * distinguishable from one on claude-code, and per-model cost/duration must
 * be readable per kind. The row key includes effort, so a session that
 * reported NO effort (opencode omits the field by design — its runner posts
 * no effort key, so the value is genuinely absent, not zero) forms its own
 * row with `effort: null` rather than being dropped or silently pooled into
 * a reported-level group; `lib/render-effort-readout.js` renders that null as
 * "—". All three key values are telemetry-realised (`[usage]` payloads stamp
 * their own harness/model), per the same realised-never-requested rule as the
 * effort column above — a backfill lineage with no telemetry groups under
 * (null, null, null), also rendered as "—". Row cost/duration repeat the
 * card's own aggregation discipline (R2: cost is a SUM over priced
 * lineages, duration a MEAN over timed lineages) scoped to the row's
 * sessions, with per-row coverage counts so a partial row figure is
 * disclosed, never presented as if it covered the row.
 */

import { readCost, anchorsOfRows } from './cost-read.js';
import { isMember } from './lineage-membership.js';
import { anchorFor } from './dispatch-lineage-status.js';
import { ORCHESTRATION_KINDS } from './run-view.js';
import {
  mergeLineageFeedback,
  deriveWireStatus,
  deriveCompletedAt,
  feedbackWithHarvestedAbort,
  harvestAbortedTargets,
} from './dispatch-terminal.js';
import {
  computePlanReviewRoundTrips,
  NO_ATTEMPT_STATUSES,
  IN_FLIGHT_STATUSES,
} from './plan-review-round-trips.js';
import { PLAN_RECORDS_SINCE } from './records/plan-facts.js';
import { VERDICT_RECORDS_SINCE } from './records/verdict-facts.js';

// The four explicitly-named orchestration kinds (LIN-2566 §"Other established
// constraints"). NOT `bucketOf(kind) === 'orchestration'` — that fallback
// (`lib/wall-clock-summary.js`'s `BUCKET_OF_KIND[kind] || 'orchestration'`)
// silently routes any kind absent from its map here too, mislabelling real
// task-phase kinds as orchestration overhead (`bug` did, until LIN-1653 mapped it).
// `wake` is deliberately included though it is absent from `DISPATCH_KINDS`
// itself (it reaches the join through row data, not the enum) — it is the
// single most common kind in this workspace's live queue.
// Defined in lib/run-view.js (LIN-3977); re-exported so importers keep resolving it here.
export { ORCHESTRATION_KINDS };

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
    lifecycleStatus = deriveWireStatus({ feedback: terminalFeedback, bookkeeping: row.bookkeeping }) || row.status;
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
 * `583701c2`): `{id, identifier, rows}`, where `rows`
 * carries the CONTRACT's fields (`id, kind, status, dispatchedAt, completedAt,
 * feedback`), `status` re-pointed at each row's own `lifecycleStatus` (a
 * field rename, not a second filter — it cannot select a different
 * population). The gate verdicts are read from verdict records by the caller
 * (LIN-4519), not from comments, so the issue carries none.
 *
 * @param {Array<Object>} eligibleRows
 * @returns {Array<Object>} the input contract array
 */
export function buildIssueCorpus(eligibleRows) {
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
    corpus.push({
      id: identifier,
      identifier,
      rows,
    });
  }
  return corpus;
}

/**
 * The issue identifiers the caller must read records for (verdict and plan facts): the
 * eligible population's own issues, and only those. Exported so the route reads records for
 * exactly the issues scored, without re-implementing the population rule: this runs the SAME
 * `normalizeDispatchRow` + `partitionPopulation` pair `computeEffortReadout` runs, so the set
 * of issues read and the set of issues scored cannot disagree.
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
 * issue whether or not a review verdict record was written in the row's window —
 * biasing the pooled rate downward by verdict-record coverage on the
 * approve side only (tier a is the verdict record since LIN-4519). Computed over tier a/b-resolved issues only; tier-c
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
 * NULL-last comparator for one nullable string row-key column (LIN-2830).
 * `null` sorts after every reported value so the "—"-rendered unknown rows
 * are stable and always visually last within a kind.
 */
function compareNullLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * LIN-2830: group one kind's worker sessions into rows keyed by their
 * REALISED (harness, model, effort) triple, carrying per-row session count,
 * cost (SUM over the row's priced sessions — null when none are priced,
 * R2's discipline row-scoped) and duration (MEAN over the row's timed
 * sessions — null when none are timed), plus per-row coverage counts. A
 * session with no effort — the opencode case, whose runner posts no effort
 * key — keys `effort: null` and SURVIVES as its own row; nothing is dropped.
 * Deterministic output order: harness, then model, then effort, nulls last.
 *
 * @param {Array<{harness: string|null, model: string|null, effort: string|null, costUsd: number|null, durationMs: number|null}>} sessions
 * @returns {Array<{harness: string|null, model: string|null, effort: string|null, sessionCount: number, costUsd: number|null, costPricedCount: number, durationMs: number|null, durationCoveredCount: number}>}
 */
export function buildSessionRows(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const harness = session.harness ?? null;
    const model = session.model ?? null;
    const effort = session.effort ?? null;
    const key = `${harness ?? ''}\u0000${model ?? ''}\u0000${effort ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = { harness, model, effort, sessions: [] };
      groups.set(key, group);
    }
    group.sessions.push(session);
  }
  return [...groups.values()]
    .sort((a, b) =>
      compareNullLast(a.harness, b.harness)
      || compareNullLast(a.model, b.model)
      || compareNullLast(a.effort, b.effort))
    .map(({ harness, model, effort, sessions: groupSessions }) => {
      const pricedSessions = groupSessions.filter((s) => s.costUsd != null);
      const costUsd = pricedSessions.length
        ? pricedSessions.reduce((sum, s) => sum + s.costUsd, 0)
        : null;
      const durationSamples = groupSessions.filter((s) => s.durationMs != null);
      const durationMs = durationSamples.length
        ? durationSamples.reduce((sum, s) => sum + s.durationMs, 0) / durationSamples.length
        : null;
      return {
        harness,
        model,
        effort,
        sessionCount: groupSessions.length,
        costUsd,
        costPricedCount: pricedSessions.length,
        durationMs,
        durationCoveredCount: durationSamples.length,
      };
    });
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
 * @param {string} params.asOf  REQUIRED ISO instant (page-load `now`)
 * @param {number} [params.skipped]  issues the caller could not read and left out of the population (threaded into both walks' `completeness`).
 *   The route reads no per-issue provider data since LIN-4519 and passes 0, so its read-out is always complete; a caller that drops issues says how many here.
 * @param {boolean} [params.survivalAvailable=true]  false when the verdict records could not be read for the workspace
 *   (the route's call) — the survival columns then report "unavailable" rather than a fabricated zero; cost/
 *   duration/effort still render.
 * @param {Object} params.requestSource  REQUIRED (LIN-4226): the request-usage loader; the cost read loads the rows'
 *   lineages' records through it, once. Async: resolves to the readout.
 * @param {string} params.urlKey  REQUIRED: the workspace the rows belong to (the cost read is scoped to it)
 * @param {Map<string, Object>|null} [params.planFacts]  LIN-4504: identifier → plan facts from records
 *   (lib/records/plan-facts.js), read by the route. `gateDue`/`gateHonoured` count only issues the plan
 *   records cover; the rest are counted as not measured, never zero. Absent (no records store), none is measured.
 * @param {string|null} [params.planRecordsSince]  the coverage instant (default PLAN_RECORDS_SINCE; a test seam)
 * @param {Map<string, Object>|null} [params.verdictFacts]  LIN-4519: identifier → verdict facts from records
 *   (lib/records/verdict-facts.js), read by the route. A gate verdict is taken from these, never from a comment; an
 *   issue with no facts is not measured.
 * @param {string|null} [params.verdictRecordsSince]  the verdict coverage instant (default VERDICT_RECORDS_SINCE; a test seam)
 * @returns {Object}
 */
export async function computeEffortReadout({
  liveRows = [],
  historyRows = [],
  historyTotal = historyRows.length,
  asOf,
  skipped = 0,
  survivalAvailable = true,
  planFacts = null,
  planRecordsSince = PLAN_RECORDS_SINCE,
  verdictFacts = null,
  verdictRecordsSince = VERDICT_RECORDS_SINCE,
  identityRows = [],
  requestSource,
  urlKey,
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
  // LIN-4177: the cost read, over the lineage's fetched rows, with the founder lookup for identity.
  // Selected: the lineages an eligible own row is a member of (the population's own lineages).
  const siblingRows = [...siblingsByAnchor.values()].flat();
  const taskCost = await readCost({
    fetchedRows: [...siblingRows, ...eligible],
    identityRows,
    requestSource,
    urlKey,
    selectAnchors: anchorsOfRows(eligible.filter(isMember)),
  });
  const workerSessionsByKind = new Map();
  for (const ws of taskCost.workerSessions) {
    const kind = ws.kind || 'custom';
    if (!workerSessionsByKind.has(kind)) workerSessionsByKind.set(kind, []);
    workerSessionsByKind.get(kind).push(ws);
  }

  // Step 5 — survival, two calls over one corpus (G2/G3/G4).
  const corpus = buildIssueCorpus(eligible);
  // Without verdict records no gate verdict can be read, so the walk would return a well-formed all-zero result that
  // reads as "nothing survived" rather than "nothing was measured". Skip it and say so (survivalAvailable is false then).
  const verdicts = verdictFacts || new Map();
  const planRow = survivalAvailable
    ? computePlanReviewRoundTrips(corpus, { asOf, skipped, planFacts: planFacts || new Map(), planRecordsSince, verdictFacts: verdicts, verdictRecordsSince })
    : null;
  const reviewRow = survivalAvailable
    ? computePlanReviewRoundTrips(corpus, { asOf, gateKind: 'review', rePassKind: 'implementation', skipped, verdictFacts: verdicts, verdictRecordsSince })
    : null;
  const reviewTierAb = reviewRow ? tierAbSurvival(reviewRow) : null;

  // Step 6 — join, total function over every kind present anywhere in the
  // read corpus (F1) — a kind whose every row is excluded/in-flight still
  // gets a card (cost/duration/effort empty, survival per its own state),
  // rather than vanishing silently.
  const kinds = new Set(normalized.map((r) => r.kind || 'custom'));

  // R2 fix (implementation review `62e30986`): cost, duration and effort are
  // three DIFFERENT aggregations over the same lineage population — cost is a
  // SUM (only over priced lineages), duration a MEAN (only over lineages with
  // a resolved terminal duration), effort a COUNT distribution. A kind whose
  // lineages are only partly priced/timed reports a coverage count for each
  // column rather than presenting the partial figure as if it covered every
  // session (the "denominator hazard" the ticket's own research named).
  const perKind = [...kinds].sort().map((kind) => {
    const sessions = workerSessionsByKind.get(kind) || [];
    const pricedSessions = sessions.filter((s) => s.costUsd != null);
    const costUsd = pricedSessions.length
      ? pricedSessions.reduce((sum, s) => sum + s.costUsd, 0)
      : null;
    const durationSamples = sessions.filter((s) => s.durationMs != null);
    const durationMs = durationSamples.length
      ? durationSamples.reduce((sum, s) => sum + s.durationMs, 0) / durationSamples.length
      : null;
    const effortLevels = sessions.map((s) => s.effort).filter(Boolean);
    const effortDistribution = effortLevels.length
      ? effortLevels.reduce((acc, level) => ((acc[level] = (acc[level] || 0) + 1), acc), {})
      : null;

    let survival;
    if (SURVIVAL_SOURCE[kind] && !survivalAvailable) {
      survival = { state: 'unavailable_records' };
    } else if (kind === 'plan') {
      survival = {
        state: 'computed',
        numerator: planRow.primary.numerator,
        denominator: planRow.primary.denominator,
        rate: planRow.primary.rate,
        // LIN-4504: `gateDue`/`gateHonoured` are read from records (a plan-review finding about one of the issue's
        // plans existed), over the issues the plan records cover; the rest are counted, never shown as 0.
        gateDue: planRow.gate.due,
        gateHonoured: planRow.gate.honoured,
        gateDueRate: planRow.gate.dueRate,
        gateHonouredRate: planRow.gate.honouredRate,
        gateMeasured: planRow.gate.measured,
        gateNotMeasured: planRow.gate.notMeasured,
        gateCoverageFrom: planRecordsSince,
        verdictNotMeasured: planRow.diagnostics.verdictNotMeasured,
        verdictCoverageFrom: verdictRecordsSince,
      };
    } else if (kind === 'implementation') {
      survival = {
        state: 'computed',
        numerator: reviewTierAb.numerator,
        denominator: reviewTierAb.denominator,
        rate: reviewTierAb.rate,
        tierCCount: reviewTierAb.tierCCount,
        comparableToPlanRate: false,
        verdictNotMeasured: reviewRow.diagnostics.verdictNotMeasured,
        verdictCoverageFrom: verdictRecordsSince,
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
      costAggregation: 'sum',
      costPricedCount: pricedSessions.length,
      costUnpricedCount: sessions.length - pricedSessions.length,
      costUnit: 'lineage',
      durationMs,
      durationAggregation: 'mean',
      durationCoveredCount: durationSamples.length,
      durationMissingCount: sessions.length - durationSamples.length,
      effort: effortDistribution,
      effortAggregation: 'count',
      // LIN-2830: the per-(harness, model, effort) breakdown of the SAME
      // session population the card's own figures aggregate — a partition,
      // never a second population: row session counts sum to sessionCount.
      rows: buildSessionRows(sessions),
      survival,
      survivalUnit: SURVIVAL_SOURCE[kind] ? 'issue' : null,
      excluded: excludedByKind[kind] || {},
      inFlight: inFlightByKind[kind] || {},
    };
  });

  // R1 fix (implementation review `62e30986`): the ship-empty caption was
  // unconditional, asserting no realised effort exists at all — a claim
  // LIN-2567 falsified mid-implementation (this ticket's own `implementation`
  // and `review` runs already carry a realised `effort`). State what is true
  // for THIS corpus: populated where LIN-2567 has stamped a run, permanently
  // `null` for the backfill, no backfill planned — the same not-instrumented
  // honesty rule already applied to the `research` row and S1's tier-c count.
  const anyEffortReported = taskCost.workerSessions.some((s) => s.effort != null);

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
      // Emitted text, pinned byte for byte by the cost-replay goldens (tests/fixtures/cost-replay/). LIN-4504: the gate
      // is read from records, not a description line.
      reviewGateDueHonoured:
        'gateDue/gateHonoured are plan-pair-only (a plan-review finding about one of the issue\'s plan records); they are not rendered for the review pair, which has no review-finding analogue.',
      orchestrationKinds:
        'Orchestration-step kinds (autopilot, wake, custom, periodical) are excluded from survival by construction, not because they were never measured.',
      noGatePairKinds:
        'A kind with no defined next-gate pair (e.g. plan-review, review, close-out) still reports cost/duration/effort; it has no survival concept, which is distinct from "not yet instrumented".',
      denominatorsNotComparable:
        "The plan card's survival rate pools verdict tiers a/b/c; the implementation card's pools tiers a/b only (tier-c count shown beside it) — the two rates are not directly comparable.",
      siblingCompleteness:
        'Lineage siblings are derived in-memory from this same bounded read (no third store call); a lineage whose sibling rows fall outside the 200-row history window is right-censored, not mis-scored — see population.historyTruncated.',
      costUnit:
        "Duration and effort are counted per dispatch LINEAGE (anchor-attributed), the same population cost draws from — but the three do not aggregate the same way: cost is the SUM of the kind's priced lineages, duration is the MEAN of the lineages with a resolved terminal duration, and effort is a COUNT of lineages at each reported level. Survival, by contrast, is per ISSUE: a kind with N lineages on one issue reports N sessions but 1 survival row. A lineage missing a column's input (no [usage] telemetry, an unpriced model, or no terminal marker) is excluded from that column's aggregate while still counting toward sessionCount — see each card's own coverage footnote for how many lineages contributed to cost/duration.",
      // LIN-2830: what the per-card rows are, so a bake-off reader never
      // mistakes a missing datum for a missing (or failed) run.
      harnessModelRows:
        'Per-card rows split the kind\'s lineages by their REALISED harness, model and effort — the values the run itself stamped on its [usage] telemetry, never the dispatch row\'s requested fields. A "—" cell means the run reported no value there: opencode posts no effort field by design, so its rows read "—" for effort rather than disappearing, and backfill lineages with no telemetry at all read "—" for all three columns.',
      // B4 (plan-review 583701c2). This module's OWN join refuses bucketOf's
      // fallback, but the walk it reuses keeps only spine rows — `bug` is
      // off-spine (LIN-1653), so a bug card is invisible to the survival walk
      // while still getting a card here. Coherent, but a reader would
      // otherwise read the two as contradicting each other.
      walkKindBlindness:
        'The reused verdict walk keeps only plan-review spine rows and never reads bug rows (an off-spine investigation, not a gate step), so bug rows are invisible to survival while still reporting cost, duration and effort here. That is why they show a card but no gate figure.',
      ...(survivalAvailable ? {} : {
        survivalUnavailable:
          "The verdict records for this workspace could not be read, so no gate verdict can be resolved. The survival columns report unavailable rather than zero; cost, duration and effort are unaffected.",
      }),
      verdictRecordsCoverage: verdictRecordsSince
        ? `gate verdicts are read from verdict records from ${verdictRecordsSince.slice(0, 16).replace('T', ' ')}Z; a gate row dispatched earlier reads not measured, never zero and never a figure read from a comment.`
        : 'gate verdicts read not measured: no verdict records cover this history yet (the verdict import has not applied).',
      planRecordsCoverage: planRecordsSince
        ? `plan-review gate due/honoured count only issues whose plan records cover their plan (from ${planRecordsSince.slice(0, 10)}); earlier issues read not measured, never zero.`
        : 'plan-review gate due/honoured read not measured: no plan records cover this history yet (the slice-2 cutover has not applied), and no figure is derived from description text.',
      effortShipEmpty: anyEffortReported
        ? "The effort column is populated for dispatch runs after the LIN-2567 telemetry stamp landed; earlier (backfill) rows report no realised effort and stay \"not reported\" permanently — no backfill is planned. It reads the SAME telemetry field either way; no Harbour-side change was needed for it to start filling."
        : "The effort column is empty: none of the runs in this corpus reported a realised effort value. It reads the SAME telemetry field either way, so the column fills for any run that does report one.",
    },
  };
}
