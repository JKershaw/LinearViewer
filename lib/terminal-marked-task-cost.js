/**
 * Terminal-marked task cost (LIN-1957, Session 1 of LIN-1625).
 *
 * Computes the API-equivalent dollar cost of dispatched work that reached a
 * terminal `[done]` marker within the outcome window, plus the bias/coverage
 * disclosures the 2026-08-03 ruling requires alongside any such figure.
 *
 * Deliberately named for what it measures, not for what it does not measure:
 * a `[done]` terminal marker is a strictly weaker claim than verified-done
 * (true verified-done capture is LIN-1878). "Verified" and its reserved
 * synonyms must never appear in this module's name, its exports, or any
 * emitted field name — that naming discipline is pinned by the 2026-08-03
 * ruling and by `tests/unit/kpi-stats.test.js`.
 *
 * Consumes `groupDispatchLineages` (lib/kpi-stats.js) for lineage identity,
 * status, harness, and per-row usage — the same shared seam
 * `computeDispatchOutcomes` uses, so the two metrics can never disagree about
 * which issues count as resolved. This module never re-implements the
 * normalise/harvest/terminal-derivation pipeline locally.
 *
 * gap-beat 2 (LIN-1957 review round 2, F4/F5): also publishes the windowed
 * spend `costUsd` structurally cannot see (`inFlightUsd`, `overheadUsd`) and
 * two population-wide declared-coverage shares (`pricedLineageShare`,
 * `attributableLineageShare`) — so a reader of the headline number can also
 * see how much of the observed activity it does, and does not, cover.
 */

import { parseUsage } from './session-telemetry.js';
import { groupDispatchLineages, evidenceCountOf, OUTCOME_WINDOW_DAYS } from './kpi-stats.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a lineage-contributing row's raw usage entry via the shared
 * `parseUsage` seam (decision (b), LIN-1957 beat 2/3: `parseUsage([entry])`
 * over a one-element array is semantically identical to the unexported
 * `parseUsagePayload`, so no new export was added to session-telemetry.js).
 * @param {Object} entry - a raw `kind:'usage'` feedback entry
 * @returns {{costUsd: number|null, lane: string|null}|null}
 */
function parseRowUsage(entry) {
  return parseUsage([entry]);
}

/**
 * The harness-conditional per-lineage cost reduce (R1's fix — do not flatten
 * it to a single rule for both harnesses):
 * - `opencode` sums each contributing row's own costUsd. Verified against the
 *   producer: `opencode-runner.js` posts one `[usage]` entry per turn (one
 *   call site, `postUsageFeedback`), so a lineage's turns spread across
 *   *rows* and summing is the correct recovery.
 * - `claude-code` / unknown (last-wins): the runner posts a CUMULATIVE
 *   snapshot per Stop (`hook.js`'s `postUsageSnapshot`), so summing would
 *   multiply-count; only the LAST row's entry is authoritative.
 *
 * Null-safe, and — post LIN-1957 review F1 — never PARTIALLY silent either:
 * `priced` is true the moment there is a non-zero dollar figure to report
 * (so an opencode lineage with some priced rows still contributes its known
 * sum), but `fullyPriced` is the stricter signal `computeTerminalMarkedTaskCost`
 * actually gates the published figure on — false the instant ANY contributing
 * row failed to price. For opencode that means fewer priced rows than rows
 * attempted; for claude-code/unknown, only the last entry is authoritative by
 * design (earlier entries are superseded, not silently dropped data), so
 * `fullyPriced` there simply mirrors `priced`. A lineage with no `rowUsage`
 * at all (a `[done]` with no usage ever posted) is unpriced too — never
 * counted as `$0`.
 *
 * @param {{harness: string|null, rowUsage: Array<Object>}} lineage
 * @returns {{costUsd: number|null, lane: string|null, priced: boolean, fullyPriced: boolean}}
 */
function reduceLineageCost(lineage) {
  const parsed = lineage.rowUsage.map(parseRowUsage).filter(Boolean);

  if (lineage.harness === 'opencode') {
    const priced = parsed.filter(u => typeof u.costUsd === 'number');
    if (priced.length === 0) return { costUsd: null, lane: null, priced: false, fullyPriced: false };
    const costUsd = priced.reduce((sum, u) => sum + u.costUsd, 0);
    // Representative lane for the sum: the last priced contribution's lane.
    // A lineage's turns sharing one session should share one lane in
    // practice; this is the same "last row wins" idiom used for the
    // claude-code reduce below, applied here only to the DISCLOSURE lane,
    // never to the summed cost itself.
    const lane = priced[priced.length - 1].lane;
    // F1: a row that posted usage but failed to price (e.g. an unpriceable
    // model) must not silently vanish from the sum without disclosure —
    // fullyPriced is false whenever fewer rows priced than contributed usage.
    const fullyPriced = priced.length === lineage.rowUsage.length;
    return { costUsd, lane, priced: true, fullyPriced };
  }

  // claude-code or unknown harness: last-wins.
  const last = parsed[parsed.length - 1];
  if (!last || typeof last.costUsd !== 'number') return { costUsd: null, lane: null, priced: false, fullyPriced: false };
  return { costUsd: last.costUsd, lane: last.lane, priced: true, fullyPriced: true };
}

/**
 * Ratio rounded to 3dp (the existing `asRate` idiom, kpi-stats.js), null —
 * never 0 or NaN — when there is nothing to divide by.
 */
function asShare(count, of) {
  return of > 0 ? Math.round((count / of) * 1000) / 1000 : null;
}

/**
 * Compute the terminal-marked-task-cost metric and its disclosures.
 *
 * Aggregate-only by construction: nothing keyed on or containing an
 * `issueIdentifier` is ever placed on the returned object — it is used
 * internally to group lineages into issues and discarded.
 *
 * @param {Array<Object>} rows - history + queue dispatch rows, either shape
 *   (the same input `computeDispatchOutcomes` takes)
 * @param {Date} now
 * @returns {Object}
 */
export function computeTerminalMarkedTaskCost(rows, now) {
  const lineages = groupDispatchLineages(rows);

  // Per-lineage evidence and close-out signals are a SEPARATE, much simpler
  // fold over the same rows, keyed identically (`rootItemId || _id`) to
  // groupDispatchLineages — this is NOT a re-implementation of the
  // normalise/harvest/terminal pipeline (no abort handling, no terminal
  // derivation), just two independent per-lineage tallies groupDispatchLineages
  // has no reason to carry since computeDispatchOutcomes never needed them.
  const evidenceByLineage = new Map();
  const closeOutByLineage = new Map();
  for (const row of rows) {
    const key = String(row.rootItemId || row._id);
    evidenceByLineage.set(key, (evidenceByLineage.get(key) || 0) + evidenceCountOf(row));
    if (row.kind === 'close-out') closeOutByLineage.set(key, true);
  }

  const nowMs = now.getTime();
  const windowStart = nowMs - OUTCOME_WINDOW_DAYS * DAY_MS;

  // Per-issue accumulation. An issue can carry more than one DONE lineage
  // (a fresh re-dispatch after completion mints its own rootItemId, not a
  // follow-up) — the denominator T is the issue, not the lineage, so every
  // signal below is OR'd/summed across an issue's lineages before the T-wide
  // shares are computed.
  //
  // F1 (LIN-1957 review, Request Changes): `fullyPriced` — not `priced` — is
  // what gates an issue into the published costUsd/cashUsd/unknownLaneUsd
  // sums. The approved plan is explicit: an unpriced contribution "excludes
  // that lineage and sets unpriced — never counted as $0." Copying the house
  // pattern the review points at (`lib/task-cost.js`'s `fullyPriced`-gates-
  // `totalUsd`, not `lib/llm-call-log.js`'s always-sum-what's-priced shape —
  // that module discloses via a SEPARATE `unpricedCalls` count instead of
  // gating the dollar figure itself, which is exactly the shape review named
  // as the alternative and beat 1's tests did not encode): an issue with ANY
  // non-fully-priced contributing lineage is dropped from every dollar sum
  // and counted in `unpriced`, so `costUsd ÷ (issueCount − unpriced)` never
  // reads a full-weight denominator against a partial-weight numerator.
  const issues = new Map(); // issueIdentifier -> { costUsd, fullyPriced, cashUsd, unknownLaneUsd, evidenceLinked, closeOut, opencodeSummed, unknownHarness }

  // gap-beat 2 (F4/F5, LIN-1957 review round 2): inFlightUsd/overheadUsd and
  // the two declared-coverage counters are POPULATION-WIDE — computed over
  // every in-window lineage, not just the done-and-attributed subset that
  // feeds `issues` above. Both new USD lines sit outside the per-issue
  // `fullyPriced` gate (there is no issue to gate on yet), so they carry
  // their OWN fullyPriced discipline below: a partially- or un-priced
  // lineage is excluded from the sum rather than counted as `$0`, exactly
  // the rule costUsd already follows — an unpriced contribution must never
  // be presented as zero spend, here any more than there.
  let inFlightUsd = 0;
  let inFlightHasPriced = false;
  let overheadUsd = 0;
  let overheadHasPriced = false;

  // F5 declared-coverage counters. `ranLineages` is every in-window lineage
  // that represents real dispatched work — `skipped` is excluded here too,
  // the same "benign: nothing ended" treatment computeDispatchOutcomes
  // already applies (kpi-stats.js:630), so a cascade-abort refusal never
  // inflates or deflates either ratio.
  let ranLineages = 0;
  let attributableLineagesCount = 0;
  let usageBearingLineages = 0;
  let pricedLineagesCount = 0;

  for (const [key, lineage] of lineages) {
    if (lineage.earliest === null || lineage.earliest < windowStart || lineage.earliest > nowMs) continue;
    if (lineage.status === 'skipped') continue;

    ranLineages++;
    if (lineage.issueIdentifier) attributableLineagesCount++;
    const hasUsage = lineage.rowUsage.length > 0;
    if (hasUsage) usageBearingLineages++;

    const reduced = reduceLineageCost(lineage);
    if (hasUsage && reduced.fullyPriced) pricedLineagesCount++;

    if (lineage.status !== 'done') {
      // In-flight/failed/aborted (F4): published separately, NEVER folded
      // into costUsd — summing all windowed spend over only resolved tasks
      // is exactly the systematic overstatement this line exists to
      // disclose against.
      if (reduced.priced && reduced.fullyPriced) {
        inFlightUsd += reduced.costUsd;
        inFlightHasPriced = true;
      }
      continue;
    }

    if (!lineage.issueIdentifier) {
      // Issue-less "overhead" dispatch (F4): autopilot kickoff, Collective,
      // ad-hoc. The plan is explicit — never dropped (would understate) and
      // never spread across tasks (would invent attribution) — so it gets
      // its own line rather than vanishing at the `continue` below.
      if (reduced.priced && reduced.fullyPriced) {
        overheadUsd += reduced.costUsd;
        overheadHasPriced = true;
      }
      continue;
    }

    let issue = issues.get(lineage.issueIdentifier);
    if (!issue) {
      issue = {
        costUsd: 0, fullyPriced: true, cashUsd: 0, unknownLaneUsd: 0,
        evidenceLinked: false, closeOut: false, opencodeSummed: false, unknownHarness: false
      };
      issues.set(lineage.issueIdentifier, issue);
    }

    if (!reduced.fullyPriced) issue.fullyPriced = false;

    if (reduced.priced) {
      issue.costUsd += reduced.costUsd;
      // Cash split (never defaulting a null lane to 'subscription'):
      // metered lanes (api/openrouter) are real marginal cash; a null lane
      // is unknown cash; a 'subscription' lane contributes zero marginal
      // cash pending the amortised plan-fee seam (config only, invented
      // nowhere in this module) — its costUsd still counts toward the
      // API-equivalent total above, just not toward either cash bucket.
      if (reduced.lane === 'api' || reduced.lane === 'openrouter') issue.cashUsd += reduced.costUsd;
      else if (reduced.lane === null) issue.unknownLaneUsd += reduced.costUsd;
    }

    if ((evidenceByLineage.get(key) || 0) > 0) issue.evidenceLinked = true;
    if (closeOutByLineage.get(key)) issue.closeOut = true;
    if (lineage.harness === 'opencode') issue.opencodeSummed = true;
    if (!lineage.harness) issue.unknownHarness = true;
  }

  const T = issues.size;
  // `unpriced` now covers BOTH "nothing priced" and "partially priced" — the
  // same excluded-from-every-sum treatment either way, so the count alone
  // (read beside costUsd, or via costUsd ÷ (issueCount − unpriced)) already
  // discloses the full magnitude. A separate partially-priced share would
  // duplicate this exactly: under exclude-and-flag there is no longer a
  // meaningful distinction between "zero priced" and "some priced" once both
  // are equally excluded from the dollar figure.
  const fullyPricedIssues = [...issues.values()].filter(i => i.fullyPriced);
  const unpriced = T - fullyPricedIssues.length;

  const costUsd = fullyPricedIssues.length > 0
    ? Math.round(fullyPricedIssues.reduce((sum, i) => sum + i.costUsd, 0) * 10000) / 10000
    : null;
  const cashUsd = fullyPricedIssues.length > 0
    ? Math.round(fullyPricedIssues.reduce((sum, i) => sum + i.cashUsd, 0) * 10000) / 10000
    : null;
  const unknownLaneUsd = fullyPricedIssues.length > 0
    ? Math.round(fullyPricedIssues.reduce((sum, i) => sum + i.unknownLaneUsd, 0) * 10000) / 10000
    : null;

  const issueList = [...issues.values()];
  return {
    windowDays: OUTCOME_WINDOW_DAYS,
    issueCount: T,
    costUsd,
    cashUsd,
    unknownLaneUsd,
    unpriced,
    // F4 (LIN-1957 review round 2): windowed spend this metric's `costUsd`
    // structurally excludes, published rather than left invisible. Neither
    // folds into costUsd/cashUsd/unknownLaneUsd above; null (not `$0`) when
    // nothing in the category priced.
    inFlightUsd: inFlightHasPriced ? Math.round(inFlightUsd * 10000) / 10000 : null,
    overheadUsd: overheadHasPriced ? Math.round(overheadUsd * 10000) / 10000 : null,
    // Published beside the number, not hidden — the ruling's condition for
    // publishing this figure at all. These four are denominated over T
    // (issueCount) — the SAME T that gates costUsd — while costUsd itself
    // only sums the fully-priced subset of T. A reader must not treat these
    // as weights on costUsd: they describe the whole resolved population,
    // not the narrower priced slice the dollar figure actually covers.
    closeOutLineageShare: asShare(issueList.filter(i => i.closeOut).length, T),
    evidenceLinkedShare: asShare(issueList.filter(i => i.evidenceLinked).length, T),
    opencodeSummedShare: asShare(issueList.filter(i => i.opencodeSummed).length, T),
    unknownHarnessShare: asShare(issueList.filter(i => i.unknownHarness).length, T),
    // F5 (LIN-1957 review round 2): declared coverage, over the WHOLE
    // in-window lineage population (ranLineages) rather than T — these two
    // answer "how much of what ran do the figures above even see", not
    // "how much of the resolved population is priced". pricedLineageShare
    // is what the strict per-issue `fullyPriced` gate excludes upstream of
    // `unpriced`; attributableLineageShare is the standing disclosure for
    // what the issue-less `continue` above still drops (F2 improved WHICH
    // lineages attribute, not how much of the population never can).
    pricedLineageShare: asShare(pricedLineagesCount, usageBearingLineages),
    attributableLineageShare: asShare(attributableLineagesCount, ranLineages)
  };
}
