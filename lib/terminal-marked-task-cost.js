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
 *
 * LIN-1959: `captureRateShare` (`usageBearingLineages ÷ ranLineages`) closes
 * the remaining honesty gap — `pricedLineageShare`'s own denominator already
 * excludes every lineage that posted no usage at all, so a public reader
 * could see it read near-100% beside a headline that in fact covers a small
 * fraction of everything that ran. Published beside, never instead of,
 * `pricedLineageShare`.
 *
 * LIN-2253: a multi-ticket worker lane (LIN-2242) delivers several tickets
 * under ONE dispatch lineage, but only that lineage's own anchor
 * (`issueIdentifier`) previously reached `issues` — every other ticket the
 * lane landed had no lineage of its own and was silently absent from T, not
 * counted as unpriced. `T` now also counts a DONE lineage's OWN `[ticket]
 * LIN-XXXX done` walk (`groupDispatchLineages`'s `ticketMarkers`, LIN-2242/
 * LIN-2243), reconciled against every known anchor so nothing double-counts.
 * These lane-landed, no-lineage issues are flagged `noLineage: true` and
 * published as `laneLandedCount` (`noLineageCount` kept as a deprecated
 * alias — `__KPI_DATA__` is public wire) — distinct from `unpriced`'s
 * pre-existing "had a lineage but some contributing row failed to price"
 * meaning — and are never assigned a dollar figure of their own: splitting a
 * lane's spend per landed ticket is an open attribution-design question this
 * module does not decide (per-ticket split vs anchor-attributed vs a new
 * unit).
 *
 * LIN-2253 (narrowed headline-denominator follow-up): the public `/kpis`
 * headline previously divided by `issueCount - unpriced`, which is
 * anchor-only — a lane-landed ticket is never `fullyPriced` under the
 * per-issue fold above, so it lands in `unpriced` and cancels out of that
 * quotient exactly. `pricedTicketCount`/`ticketsPerPricedLane` are an
 * ADDITIONAL, separately-computed denominator (a connected-component fold
 * over the ticket↔anchored-lineage graph, kept deliberately apart from the
 * per-issue fold above) so the headline can divide by every ticket a priced
 * lane actually delivered. This is a narrowed scope: `unpriced`,
 * `lineageBearingCount`, and the two ignorance shares below are UNCHANGED —
 * LIN-2418's exclusion mechanism stays intact, and no harness/goodness flag
 * is propagated to a lane-landed ticket by this follow-up.
 *
 * LIN-2253 review (Request Changes, F1): the first cut of the above divided
 * the per-issue-fold `costUsd` by the component-fold `pricedTicketCount` —
 * two DIFFERENT inclusion populations. A fully-priced lineage transitively
 * merged (via a shared lane-landed ticket) with an unpriced sibling stayed
 * IN `costUsd` (the per-issue fold only looks at its own anchor issue) while
 * its tickets left `pricedTicketCount` (the component fold excludes the
 * whole merged component) — a full-weight numerator over a partial-weight
 * denominator, the mirror image of the bug this follow-up exists to fix.
 * `pricedTicketCostUsd` closes this: it sums lineage cost over the SAME
 * fully-priced, INCLUDED components `pricedTicketCount` counts tickets
 * over, so the headline's numerator and denominator always describe the
 * same population. `costUsd` itself is UNCHANGED — still the per-issue-fold
 * aggregate published in its own right (`.kpi-cost-usd-lines`); this is a
 * headline-only correction, not a redefinition of the published dollar
 * figure.
 *
 * LIN-2423: `markerOccupiedLineages`/`markerOccupancyShare` are the marker-channel occupancy
 * probe — the count (and share of `ranLineages`) of in-window lineages carrying at least one
 * `[ticket]` marker, computed ABOVE the `status !== 'done'` gate so an in-flight lane's markers
 * are visible immediately rather than only once it finishes. This resolves the ambiguity
 * `laneLandedCount === 0` alone could not: "no lane-landed tickets" (honest zero) versus "the
 * marker channel is empty" (LIN-2423's own defect — the producer-side fix this ticket also
 * ships is what makes a nonzero reading possible at all). Published beside `laneLandedCount`,
 * never folded into it or into any existing sum.
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
 * Exported (LIN-2118) so the weekly-budget gauge (`lib/weekly-budget.js`) can
 * reduce a lineage's own windowed spend the same way this module does,
 * rather than re-deriving the harness-conditional sum/last-wins rule a
 * second time.
 *
 * @param {{harness: string|null, rowUsage: Array<Object>}} lineage
 * @returns {{costUsd: number|null, lane: string|null, priced: boolean, fullyPriced: boolean}}
 */
export function reduceLineageCost(lineage) {
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
 * LIN-2419: the three-valued sentinel for `opencodeSummed`/`unknownHarness`.
 * A string (truthy) — never `null`/`undefined` (falsy) — so a read site that
 * forgets to check for it fails toward OVER-disclosing ignorance (the safe
 * direction) rather than silently re-folding "unknown" into "false".
 */
const UNKNOWN = 'unknown';

/** True iff `value` is a real true/false reading, not the `UNKNOWN` sentinel. */
function isKnown(value) {
  return value !== UNKNOWN;
}

/**
 * Kleene strong-OR: `true` dominates (a single known approximation is never
 * demoted by a sibling lineage's ignorance), `UNKNOWN` beats `false` (absent
 * a `true`, any ignorance in the fold makes the issue's own reading
 * ignorance too — it must not read as a confident "no"). `false` is this
 * fold's identity element, so seeding an accumulator at `false` and folding
 * in one lineage at a time (the existing per-issue loop shape) is safe.
 */
function kleeneOr(a, b) {
  if (a === true || b === true) return true;
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN;
  return false;
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
  const issues = new Map(); // issueIdentifier -> { costUsd, fullyPriced, cashUsd, unknownLaneUsd, evidenceLinked, closeOut, opencodeSummed, unknownHarness, noLineage }

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
  // LIN-2423: the marker-channel occupancy probe. `laneLandedCount === 0` alone cannot tell
  // "no lane-landed tickets" (a real, honest zero) apart from "the marker channel is empty"
  // (the LIN-2423 defect — markers never reached feedback[] at all) — both read as the same
  // `0`. Counted over EVERY in-window, non-skipped lineage regardless of status (computed
  // ABOVE the `status !== 'done'` gate below), so an in-flight lane's markers are visible on
  // `/kpis` immediately rather than only once the lane finishes — see the loop body.
  let occupiedLineages = 0;

  // LIN-2253: every ticket a DONE, in-window lineage's own `[ticket]` walk
  // marked `done` — a worker-lane session can land several tickets under
  // ONE lineage, but only the dispatch's own anchor (`lineage.issueIdentifier`)
  // gets a lineage of its own below. Collected here and reconciled against
  // EVERY known anchor (not just the ones that made it into `issues` — see
  // `anchoredIdentifiers` immediately below) AFTER the main loop, so a
  // ticket that already has its own lineage anywhere in the population is
  // never double-counted.
  const laneTicketDoneIdentifiers = [];

  // LIN-2253 (narrowed): one record per DONE, anchored (has `issueIdentifier`)
  // lineage, capturing exactly the ticket set THAT lineage delivers (its own
  // anchor plus its own `[ticket] … done` walk) and whether it priced fully.
  // Kept separate from `issues` above — this feeds ONLY the component fold
  // below (`pricedTicketCount`/`ticketsPerPricedLane`), never `unpriced` or
  // the two LIN-2418 ignorance shares.
  const anchoredLineageRecords = [];

  // LIN-2253 review (Request Changes): `issues` is populated ONLY from DONE
  // lineages — an in-window lineage that is still in-flight/failed/aborted
  // never reaches it. The reconciliation below must not mistake "this
  // ticket's own lineage hasn't finished yet" for "this ticket has no
  // lineage at all", so every in-window, non-skipped lineage's identifier is
  // recorded here regardless of status — the exact same population
  // `attributableLineagesCount` already counts over, just kept as a set too.
  const anchoredIdentifiers = new Set();

  for (const [key, lineage] of lineages) {
    if (lineage.earliest === null || lineage.earliest < windowStart || lineage.earliest > nowMs) continue;
    if (lineage.status === 'skipped') continue;

    ranLineages++;
    if (lineage.issueIdentifier) {
      attributableLineagesCount++;
      anchoredIdentifiers.add(lineage.issueIdentifier);
    }
    // LIN-2423 (F4): computed here, ABOVE the `status !== 'done'` gate a few lines below, so an
    // in-flight/failed/aborted lineage that has already posted markers still counts as
    // occupied — the whole point of this probe is to expose marker-channel health for a
    // lane that hasn't finished yet, not only completed ones.
    if (Array.isArray(lineage.ticketMarkers) && lineage.ticketMarkers.length > 0) occupiedLineages++;
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

    // LIN-2253: gather this DONE lineage's own ticket walk regardless of
    // whether the lineage carries an issueIdentifier of its own — a bare
    // worker-lane kickoff dispatch could in principle land tickets with no
    // issueIdentifier on the dispatch row at all.
    if (lineage.ticketMarkers) {
      for (const marker of lineage.ticketMarkers) {
        if (marker.state === 'done') laneTicketDoneIdentifiers.push(marker.identifier);
      }
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

    // LIN-2253 (narrowed): this lineage carries an issueIdentifier, so it is
    // eligible to found or join a component below. Its own delivered-ticket
    // set is its anchor plus every ticket its OWN marker walk marked done —
    // an issue-less lineage's markers (harvested above) never reach here,
    // matching the F3 rule that overhead spend/tickets never enter a priced
    // component.
    const lineageTicketIds = new Set([lineage.issueIdentifier]);
    if (lineage.ticketMarkers) {
      for (const marker of lineage.ticketMarkers) {
        if (marker.state === 'done') lineageTicketIds.add(marker.identifier);
      }
    }
    // F1 fix: carry this lineage's own priced cost alongside its ticket set
    // so the component fold below can sum a numerator over the exact same
    // included population `pricedTicketCount` counts tickets over. `0` when
    // unpriced is safe — such a lineage forces `component.fullyPriced =
    // false` below, so its component (and this `0`) never reaches the sum.
    anchoredLineageRecords.push({
      ticketIds: lineageTicketIds,
      fullyPriced: reduced.fullyPriced,
      costUsd: reduced.priced ? reduced.costUsd : 0
    });

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
    // LIN-2419: `unknownHarness` is directly observable per lineage (the
    // field IS declared or it is not) — its own contribution is always a
    // real true/false, never UNKNOWN. `opencodeSummed` is NOT observable
    // when the harness itself is unknown: a `harness: null` lineage could
    // have gone either way through reduceLineageCost's harness-conditional
    // reduce, so its contribution is UNKNOWN, not a known-false "not
    // summed" — the exact false assertion this ticket exists to remove.
    const opencodeContribution = lineage.harness === 'opencode' ? true : (lineage.harness ? false : UNKNOWN);
    issue.opencodeSummed = kleeneOr(issue.opencodeSummed, opencodeContribution);
    issue.unknownHarness = kleeneOr(issue.unknownHarness, !lineage.harness);
  }

  // LIN-2253: reconcile lane-landed tickets AFTER every anchor is known, so
  // a ticket that has its own lineage anywhere in the population (the
  // common case — most lanes' FIRST ticket is also the dispatch's anchor)
  // is never double-counted here. Checked against `anchoredIdentifiers`
  // (every in-window anchor regardless of status, populated at `:230-233`)
  // — a ticket whose own real lineage is still in-flight/failed/aborted has
  // a lineage, just not a finished one, and must not be misclassified as
  // `noLineage`; that is a DIFFERENT, already-disclosed mechanism
  // (`inFlightUsd`), not this one.
  //
  // LIN-2418: a single `anchoredIdentifiers` check is sufficient — an
  // earlier version of this loop also checked `issues.has(identifier)`, but
  // that clause was provably dead. Two facts make one guard enough, and
  // BOTH legs matter: (1) every key `issues` gains at the DONE-anchor write
  // site above (`:281`) is already in `anchoredIdentifiers` by construction
  // — that write is reachable only via the truthy-identifier branch, and
  // this lineage's own identifier was added to `anchoredIdentifiers`
  // earlier in the SAME iteration (`:230-233`), so `issues.has(identifier)`
  // could never have caught anything `anchoredIdentifiers.has(identifier)`
  // had not already caught first; and (2) the keys `issues` gains at THIS
  // loop's own write site (`:343`, below) never enter `anchoredIdentifiers`
  // at all — the invariant survives only because this loop iterates a
  // DEDUPED `new Set(laneTicketDoneIdentifiers)`, so a repeat identifier
  // here is an idempotent `Map.set` overwrite rather than a second
  // `noLineage` entry, not a second independent guard.
  //
  // Every identifier surviving the check genuinely has no lineage of its
  // own anywhere in the population — exactly the ~70% LIN-2253 measured —
  // and is counted into T now, distinctly flagged `noLineage: true`.
  // Deliberately NOT assigned any share of the lane's costUsd: splitting a
  // lane's spend per landed ticket (per-ticket split vs anchor-attributed vs
  // a new unit) is the open design question this ticket does not decide —
  // see the ticket's "Not proposing the fix here". `noLineage` issues land
  // in `unpriced` below like any other unpriced issue, but are also counted
  // in the separate `noLineageCount` so a reader can tell "no lineage at
  // all" apart from "had a lineage but failed to price" — the ticket's
  // constraint that these stay distinct.
  for (const identifier of new Set(laneTicketDoneIdentifiers)) {
    if (anchoredIdentifiers.has(identifier)) continue;
    issues.set(identifier, {
      costUsd: 0, fullyPriced: false, cashUsd: 0, unknownLaneUsd: 0,
      // LIN-2419: a `noLineage` issue has no lineage at all to read a
      // harness off — both provenance flags are UNKNOWN, not a known
      // `false`, so `filter(isKnown)` below excludes them from either
      // share's denominator instead of asserting a false negative over a
      // population this system has no data on.
      evidenceLinked: false, closeOut: false, opencodeSummed: UNKNOWN, unknownHarness: UNKNOWN,
      noLineage: true
    });
  }

  // LIN-2253 (narrowed): connected-component fold over `anchoredLineageRecords`
  // — the headline denominator this follow-up adds. Two anchored lineages
  // that share a delivered ticket (one lineage's lane-landed ticket is
  // ANOTHER lineage's own anchor, e.g. `:656`-shape fixtures) belong to the
  // same component; a component is included only when EVERY member lineage
  // is `fullyPriced`, so a lane sharing a ticket with an unpriced lineage
  // excludes the whole component rather than dividing a partial numerator by
  // a full-weight denominator (the same discipline `fullyPriced` already
  // enforces per-issue above).
  const componentParent = new Map();
  function componentFind(x) {
    if (!componentParent.has(x)) componentParent.set(x, x);
    let root = x;
    while (componentParent.get(root) !== root) root = componentParent.get(root);
    while (componentParent.get(x) !== root) {
      const next = componentParent.get(x);
      componentParent.set(x, root);
      x = next;
    }
    return root;
  }
  function componentUnion(a, b) {
    const rootA = componentFind(a);
    const rootB = componentFind(b);
    if (rootA !== rootB) componentParent.set(rootA, rootB);
  }
  for (const { ticketIds } of anchoredLineageRecords) {
    const ids = [...ticketIds];
    componentFind(ids[0]);
    for (let i = 1; i < ids.length; i++) componentUnion(ids[0], ids[i]);
  }

  const componentsByRoot = new Map(); // root -> { ticketIds: Set, fullyPriced: boolean, lineageCount: number }
  for (const record of anchoredLineageRecords) {
    const root = componentFind([...record.ticketIds][0]);
    let component = componentsByRoot.get(root);
    if (!component) {
      component = { ticketIds: new Set(), fullyPriced: true, lineageCount: 0, costUsd: 0 };
      componentsByRoot.set(root, component);
    }
    for (const ticketId of record.ticketIds) component.ticketIds.add(ticketId);
    if (!record.fullyPriced) component.fullyPriced = false;
    component.lineageCount += 1;
    component.costUsd += record.costUsd;
  }

  let pricedTicketCount = 0;
  let includedLineageCount = 0;
  // F1 fix: the headline-rate numerator, summed over the exact same
  // fully-priced INCLUDED components pricedTicketCount counts tickets over —
  // never the per-issue-fold costUsd below, which is keyed on a DIFFERENT
  // (per-anchor-issue) inclusion rule and can disagree with the component
  // fold in a transitively-merged, partially-priced shape.
  let pricedTicketCostUsd = 0;
  let hasPricedComponent = false;
  for (const component of componentsByRoot.values()) {
    if (component.fullyPriced) {
      pricedTicketCount += component.ticketIds.size;
      includedLineageCount += component.lineageCount;
      pricedTicketCostUsd += component.costUsd;
      hasPricedComponent = true;
    }
  }
  // Amortisation factor published beside the rate so a discontinuity from
  // the old anchor-denominated headline is self-explaining rather than read
  // as an efficiency win on faith. Null (never 0 or NaN) when there is no
  // included lane to divide by, mirroring `asShare`'s null-on-empty idiom.
  const ticketsPerPricedLane = includedLineageCount > 0
    ? Math.round((pricedTicketCount / includedLineageCount) * 1000) / 1000
    : null;
  // F1 fix: null (never $0), mirroring `costUsd`'s own null-on-nothing-priced
  // idiom, when there is no included component to sum over.
  const roundedPricedTicketCostUsd = hasPricedComponent
    ? Math.round(pricedTicketCostUsd * 10000) / 10000
    : null;

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
  // LIN-2253 (narrowed): `laneLandedCount` is the rename of `noLineageCount`
  // — the filter itself is unchanged; `noLineageCount` stays on the wire for
  // one deprecation cycle since `__KPI_DATA__` is public wire.
  //
  // LIN-2419: the old `lineageBearingCount = T - laneLandedCount` denominator
  // (a parallel exclusion counter, kept beside the flags and re-derived a
  // third time in lib/render-kpis.js) is gone. Each of the two shares below
  // now derives its OWN denominator straight from the representation —
  // `filter(isKnown(...))` — rather than sharing one population-wide
  // exclusion count. For `unknownHarnessShare` this is provably the same
  // population `lineageBearingCount` was (that flag is UNKNOWN iff
  // `noLineage`); for `opencodeSummedShare` it is narrower, since a
  // lineage-bearing issue whose only lineage has `harness: null` is also
  // UNKNOWN for that flag now, not a known `false`.
  const laneLandedCount = issueList.filter(i => i.noLineage).length;
  return {
    windowDays: OUTCOME_WINDOW_DAYS,
    issueCount: T,
    costUsd,
    cashUsd,
    unknownLaneUsd,
    unpriced,
    // LIN-2253: how many of `unpriced` (and of T) never had a lineage of
    // their own at all — a distinct mechanism from "had a lineage but some
    // contributing row failed to price". Always a subset of `unpriced`
    // (noLineage issues are never fullyPriced), never merged into its
    // pre-existing meaning.
    laneLandedCount,
    // Deprecated alias for `laneLandedCount`, kept for one cycle — remove
    // once every `__KPI_DATA__` consumer has migrated off the old name.
    noLineageCount: laneLandedCount,
    // LIN-2423: published BESIDE laneLandedCount, never instead of it — the "published beside,
    // never instead of" idiom captureRateShare already established. `markerOccupiedLineages`
    // is the raw count (over `ranLineages`, computed above the done gate — see the loop body);
    // `markerOccupancyShare` is that count's share of `ranLineages`, the SAME denominator
    // `attributableLineageShare` uses. Occupancy `0` over a nonzero `ranLineages` means the
    // marker channel itself is empty (the LIN-2423 defect); occupancy `> 0` with
    // `laneLandedCount` also `0` means an honest "no lane-landed tickets this window", not a
    // silent channel gap — the ambiguity this probe exists to resolve.
    markerOccupiedLineages: occupiedLineages,
    markerOccupancyShare: asShare(occupiedLineages, ranLineages),
    // LIN-2253 (narrowed headline-denominator follow-up): the component-fold
    // ticket denominator + amortisation factor `lib/render-kpis.js` divides
    // the headline by, instead of `issueCount - unpriced`. Independent of
    // `unpriced`/`lineageBearingCount` above — see the module doc comment.
    pricedTicketCount,
    ticketsPerPricedLane,
    // LIN-2253 review (Request Changes, F1): the headline-rate NUMERATOR,
    // matched to `pricedTicketCount`'s own inclusion population (the
    // component fold) rather than `costUsd`'s (the per-issue fold) — see the
    // module doc comment. `lib/render-kpis.js` divides THIS by
    // `pricedTicketCount`, never `costUsd` by `pricedTicketCount`. Null,
    // never $0, when there is no included component (mirrors `costUsd`).
    pricedTicketCostUsd: roundedPricedTicketCostUsd,
    // F4 (LIN-1957 review round 2): windowed spend this metric's `costUsd`
    // structurally excludes, published rather than left invisible. Neither
    // folds into costUsd/cashUsd/unknownLaneUsd above; null (not `$0`) when
    // nothing in the category priced.
    inFlightUsd: inFlightHasPriced ? Math.round(inFlightUsd * 10000) / 10000 : null,
    overheadUsd: overheadHasPriced ? Math.round(overheadUsd * 10000) / 10000 : null,
    // Published beside the number, not hidden — the ruling's condition for
    // publishing this figure at all. `closeOutLineageShare`/
    // `evidenceLinkedShare` are denominated over T (issueCount) — the SAME T
    // that gates costUsd — while costUsd itself only sums the fully-priced
    // subset of T. `opencodeSummedShare`/`unknownHarnessShare` are
    // DIFFERENT (LIN-2418, widened by LIN-2419): each is a three-valued
    // (`true | false | 'unknown'`) predicate per issue, folded via
    // `kleeneOr` across an issue's own lineages, and each share's own
    // denominator is derived straight from that representation —
    // `issueList.filter(isKnown(...))` — rather than one shared exclusion
    // count. `unknownHarnessShare`'s known population is exactly
    // `lineageBearingCount` was (T minus every `noLineage` issue: that flag
    // is `unknown` iff `noLineage`); `opencodeSummedShare`'s known
    // population is narrower still, since a lineage-bearing issue whose
    // only lineage declared no harness cannot say whether it would have hit
    // the sum-reduce or the last-wins one — so it too reads `unknown`, never
    // a known `false`. A reader must not treat any of these four as weights
    // on costUsd: they describe (subsets of) the whole resolved population,
    // not the narrower priced slice the dollar figure actually covers.
    closeOutLineageShare: asShare(issueList.filter(i => i.closeOut).length, T),
    evidenceLinkedShare: asShare(issueList.filter(i => i.evidenceLinked).length, T),
    opencodeSummedShare: asShare(
      issueList.filter(i => i.opencodeSummed === true).length,
      issueList.filter(i => isKnown(i.opencodeSummed)).length
    ),
    unknownHarnessShare: asShare(
      issueList.filter(i => i.unknownHarness === true).length,
      issueList.filter(i => isKnown(i.unknownHarness)).length
    ),
    // F5 (LIN-1957 review round 2): declared coverage, over the WHOLE
    // in-window lineage population (ranLineages) rather than T — these two
    // answer "how much of what ran do the figures above even see", not
    // "how much of the resolved population is priced". pricedLineageShare
    // is what the strict per-issue `fullyPriced` gate excludes upstream of
    // `unpriced`; attributableLineageShare is the standing disclosure for
    // what the issue-less `continue` above still drops (F2 improved WHICH
    // lineages attribute, not how much of the population never can).
    pricedLineageShare: asShare(pricedLineagesCount, usageBearingLineages),
    attributableLineageShare: asShare(attributableLineagesCount, ranLineages),
    // LIN-1959: the true capture rate — usageBearingLineages ÷ ranLineages,
    // over the SAME ranLineages denominator attributableLineageShare already
    // uses. `pricedLineageShare` alone reads as near-total coverage because
    // its OWN denominator (usageBearingLineages) already excludes every
    // lineage that posted no usage at all — it cannot see, and was never
    // meant to disclose, that exclusion. This is the honesty check upstream
    // of that share: how much of everything that actually ran even posted
    // usage in the first place, before pricing is asked of it at all.
    captureRateShare: asShare(usageBearingLineages, ranLineages)
  };
}
