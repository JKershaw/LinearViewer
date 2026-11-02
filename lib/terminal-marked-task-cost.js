/**
 * Terminal-marked task cost (LIN-1957, Session 1 of LIN-1625).
 *
 * Computes the population figures behind the "Cost per finished task" card:
 * the priced-ticket count and the cost summed over the same tickets, plus the
 * coverage shares that sit beside them. LIN-3714 moved the shares into a fold
 * on the public page; they are still published.
 *
 * Deliberately named for what it measures, not for what it does not measure:
 * a `[done]` terminal marker is a strictly weaker claim than verified-done
 * (true verified-done capture is LIN-1878). "Verified" and its reserved
 * synonyms must never appear in this module's name, its exports, or any
 * emitted field name — that naming discipline is pinned by the 2026-08-03
 * ruling and by `tests/unit/kpi-stats.test.js`.
 *
 * Consumes `groupDispatchLineages` (lib/dispatch-lineage.js) for lineage identity,
 * status, harness, and per-row usage — the same shared seam
 * `computeDispatchOutcomes` uses, so the two metrics can never disagree about
 * which issues count as resolved. This module never re-implements the
 * normalise/harvest/terminal-derivation pipeline locally.
 *
 * Tickets, not lineages: a multi-ticket worker lane (LIN-2242) lands several
 * tickets under ONE lineage. A done lineage's own `[ticket] LIN-XXXX done`
 * walk names them, and they join the priced-ticket count alongside the
 * lineage's anchor (`issueIdentifier`). A ticket named by a walk that no
 * lineage anchors is counted too (LIN-2253), but it never gets a dollar figure
 * of its own: how to split a lane's spend per landed ticket is an open
 * attribution question this module does not decide.
 *
 * Population parity (LIN-2253 review F1): `pricedTicketCostUsd` sums lineage
 * cost over exactly the fully-priced components that `pricedTicketCount`
 * counts tickets over. A cost fold keyed on the anchor issue would use a
 * different inclusion rule, and the two can disagree when lineages merge
 * transitively through a shared ticket. So the numerator and the denominator
 * come from the same component fold, and a component with any unpriced
 * lineage is excluded whole.
 *
 * Coverage shares, all published beside the figures and never folded into
 * them: `captureRateShare` (usage-bearing lineages ÷ ran lineages, LIN-1959) is
 * the honesty check upstream of `pricedLineageShare` (priced ÷ usage-bearing).
 * `attributableLineageShare` is the share of ran lineages that carry an
 * anchor. `closeOutLineageShare`, `evidenceLinkedShare`, `opencodeSummedShare`
 * and `unknownHarnessShare` are per-ticket flags over the anchored tickets (T).
 * The two harness shares are three-valued (LIN-2418/2419): a flag that cannot
 * be read is `UNKNOWN` and sits outside that share's denominator, never a
 * known `false`.
 */

import { parseUsage } from './session-telemetry.js';
import { groupDispatchLineages, evidenceCountOf, OUTCOME_WINDOW_DAYS } from './dispatch-lineage.js';

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
 * Exported (LIN-2118) so `windowedSpend` (`lib/weekly-budget.js`) reduces a
 * lineage's windowed spend through this same rule rather than a second copy.
 *
 * @param {{harness: string|null, rowUsage: Array<Object>}} lineage
 * @returns {{costUsd: number|null, priced: boolean, fullyPriced: boolean}}
 */
export function reduceLineageCost(lineage) {
  const parsed = lineage.rowUsage.map(parseRowUsage).filter(Boolean);

  if (lineage.harness === 'opencode') {
    const priced = parsed.filter(u => typeof u.costUsd === 'number');
    if (priced.length === 0) return { costUsd: null, priced: false, fullyPriced: false };
    const costUsd = priced.reduce((sum, u) => sum + u.costUsd, 0);
    // F1: a row that posted usage but failed to price (e.g. an unpriceable
    // model) must not silently vanish from the sum without disclosure —
    // fullyPriced is false whenever fewer rows priced than contributed usage.
    const fullyPriced = priced.length === lineage.rowUsage.length;
    return { costUsd, priced: true, fullyPriced };
  }

  // claude-code or unknown harness: last-wins.
  const last = parsed[parsed.length - 1];
  if (!last || typeof last.costUsd !== 'number') return { costUsd: null, priced: false, fullyPriced: false };
  return { costUsd: last.costUsd, priced: true, fullyPriced: true };
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
 * Compute the terminal-marked-task-cost figures and their coverage shares.
 *
 * Aggregate-only by construction: nothing keyed on or containing an
 * `issueIdentifier` is ever placed on the returned object — it is used
 * internally to group lineages into tickets and discarded.
 *
 * @param {Array<Object>} rows - history + queue dispatch rows, either shape
 *   (the same input `computeDispatchOutcomes` takes)
 * @param {Date} now
 * @returns {{windowDays: number, pricedTicketCount: number, pricedTicketCostUsd: number|null,
 *   closeOutLineageShare: number|null, evidenceLinkedShare: number|null,
 *   opencodeSummedShare: number|null, unknownHarnessShare: number|null,
 *   pricedLineageShare: number|null, attributableLineageShare: number|null,
 *   captureRateShare: number|null}}
 */
export function computeTerminalMarkedTaskCost(rows, now) {
  const lineages = groupDispatchLineages(rows);

  // Per-lineage evidence and close-out signals are a separate, simpler fold over
  // the same rows, keyed identically (`rootItemId || _id`) to
  // groupDispatchLineages. This is not a re-implementation of the
  // normalise/harvest/terminal pipeline (no abort handling, no terminal
  // derivation): just two tallies groupDispatchLineages does not carry.
  const evidenceByLineage = new Map();
  const closeOutByLineage = new Map();
  for (const row of rows) {
    const key = String(row.rootItemId || row._id);
    evidenceByLineage.set(key, (evidenceByLineage.get(key) || 0) + evidenceCountOf(row));
    if (row.kind === 'close-out') closeOutByLineage.set(key, true);
  }

  const nowMs = now.getTime();
  const windowStart = nowMs - OUTCOME_WINDOW_DAYS * DAY_MS;

  // Per-ticket flags, keyed on the anchor identifier. An issue can carry more
  // than one DONE lineage (a fresh re-dispatch after completion mints its own
  // rootItemId, not a follow-up), so each flag is OR'd across an issue's
  // lineages. The map's size is T, the denominator of the two per-ticket shares.
  const issues = new Map(); // issueIdentifier -> { evidenceLinked, closeOut, opencodeSummed, unknownHarness }

  // Population-wide declared-coverage counters, over every in-window lineage
  // that represents real dispatched work. `skipped` is excluded: a cascade-abort
  // refusal ended nothing, so it must not inflate or deflate any ratio.
  let ranLineages = 0;
  let attributableLineagesCount = 0;
  let usageBearingLineages = 0;
  let pricedLineagesCount = 0;

  // Every ticket a DONE, in-window lineage's own `[ticket]` walk marked done.
  // Reconciled after the loop against EVERY anchor (see `anchoredIdentifiers`),
  // so a ticket that already has its own lineage is never counted twice.
  const laneTicketDoneIdentifiers = [];

  // One record per DONE, anchored lineage: the tickets that lineage delivers
  // (its anchor plus its own done walk) and whether it priced fully. Feeds only
  // the component fold below.
  const anchoredLineageRecords = [];

  // Every in-window, non-skipped lineage's identifier, regardless of status. A
  // ticket whose own lineage is still in flight has a lineage, just not a
  // finished one, so the reconciliation must not count it as lane-landed.
  const anchoredIdentifiers = new Set();

  for (const [key, lineage] of lineages) {
    if (lineage.earliest === null || lineage.earliest < windowStart || lineage.earliest > nowMs) continue;
    if (lineage.status === 'skipped') continue;

    ranLineages++;
    if (lineage.issueIdentifier) {
      attributableLineagesCount++;
      anchoredIdentifiers.add(lineage.issueIdentifier);
    }
    const hasUsage = lineage.rowUsage.length > 0;
    if (hasUsage) usageBearingLineages++;

    const reduced = reduceLineageCost(lineage);
    if (hasUsage && reduced.fullyPriced) pricedLineagesCount++;

    // In-flight, failed and aborted lineages count above, but contribute no
    // tickets and no flags: only a finished lineage delivers tickets.
    if (lineage.status !== 'done') continue;

    if (lineage.ticketMarkers) {
      for (const marker of lineage.ticketMarkers) {
        if (marker.state === 'done') laneTicketDoneIdentifiers.push(marker.identifier);
      }
    }

    // An issue-less dispatch (autopilot kickoff, Collective, ad-hoc) has no
    // anchor, so it contributes no ticket and no flag. Its markers were
    // gathered above, and it never joins a component below.
    if (!lineage.issueIdentifier) continue;

    // This lineage's delivered-ticket set: its anchor plus every ticket its
    // own marker walk marked done.
    const lineageTicketIds = new Set([lineage.issueIdentifier]);
    if (lineage.ticketMarkers) {
      for (const marker of lineage.ticketMarkers) {
        if (marker.state === 'done') lineageTicketIds.add(marker.identifier);
      }
    }
    // An unpriced lineage records 0 here, which is safe: it forces its whole
    // component to `fullyPriced: false`, so the 0 never reaches the sum.
    anchoredLineageRecords.push({
      ticketIds: lineageTicketIds,
      fullyPriced: reduced.fullyPriced,
      costUsd: reduced.priced ? reduced.costUsd : 0
    });

    let issue = issues.get(lineage.issueIdentifier);
    if (!issue) {
      issue = { evidenceLinked: false, closeOut: false, opencodeSummed: false, unknownHarness: false };
      issues.set(lineage.issueIdentifier, issue);
    }

    if ((evidenceByLineage.get(key) || 0) > 0) issue.evidenceLinked = true;
    if (closeOutByLineage.get(key)) issue.closeOut = true;
    // LIN-2419: `unknownHarness` is directly observable per lineage (the field
    // is declared or it is not), so it is always a real true/false. `opencodeSummed`
    // is not observable when the harness is unknown: a `harness: null` lineage
    // could have gone either way through reduceLineageCost, so it is UNKNOWN.
    const opencodeContribution = lineage.harness === 'opencode' ? true : (lineage.harness ? false : UNKNOWN);
    issue.opencodeSummed = kleeneOr(issue.opencodeSummed, opencodeContribution);
    issue.unknownHarness = kleeneOr(issue.unknownHarness, !lineage.harness);
  }

  // Lane-landed reconciliation, after every anchor is known. A ticket with its
  // own lineage anywhere in the population is skipped (`anchoredIdentifiers` is
  // checked, not `issues`: a ticket whose lineage is still in flight is in
  // `anchoredIdentifiers` but not in `issues`). What survives has no lineage of
  // its own and joins T with both provenance flags UNKNOWN, so neither share
  // counts it as a known `false`. The dedupe means a repeated identifier is an
  // idempotent overwrite, not a second entry.
  for (const identifier of new Set(laneTicketDoneIdentifiers)) {
    if (anchoredIdentifiers.has(identifier)) continue;
    issues.set(identifier, {
      evidenceLinked: false, closeOut: false, opencodeSummed: UNKNOWN, unknownHarness: UNKNOWN
    });
  }

  // Connected-component fold over `anchoredLineageRecords`: two anchored lineages
  // that share a delivered ticket belong to one component. A component counts
  // only when EVERY member lineage is fully priced, so a lane that shares a
  // ticket with an unpriced lineage is excluded whole, rather than dividing a
  // partial numerator by a full-weight denominator.
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

  const componentsByRoot = new Map(); // root -> { ticketIds: Set, fullyPriced: boolean, costUsd: number }
  for (const record of anchoredLineageRecords) {
    const root = componentFind([...record.ticketIds][0]);
    let component = componentsByRoot.get(root);
    if (!component) {
      component = { ticketIds: new Set(), fullyPriced: true, costUsd: 0 };
      componentsByRoot.set(root, component);
    }
    for (const ticketId of record.ticketIds) component.ticketIds.add(ticketId);
    if (!record.fullyPriced) component.fullyPriced = false;
    component.costUsd += record.costUsd;
  }

  let pricedTicketCount = 0;
  let pricedTicketCostUsd = 0;
  let hasPricedComponent = false;
  for (const component of componentsByRoot.values()) {
    if (component.fullyPriced) {
      pricedTicketCount += component.ticketIds.size;
      pricedTicketCostUsd += component.costUsd;
      hasPricedComponent = true;
    }
  }
  // Null, never $0, when there is no fully priced component to sum over.
  const roundedPricedTicketCostUsd = hasPricedComponent
    ? Math.round(pricedTicketCostUsd * 10000) / 10000
    : null;

  const T = issues.size;
  const issueList = [...issues.values()];

  return {
    windowDays: OUTCOME_WINDOW_DAYS,
    pricedTicketCount,
    pricedTicketCostUsd: roundedPricedTicketCostUsd,
    // Per-ticket shares, over T. Each read off a three-valued flag excludes
    // UNKNOWN from its own denominator.
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
    // Declared coverage, over the whole in-window population (ranLineages), not T.
    pricedLineageShare: asShare(pricedLineagesCount, usageBearingLineages),
    attributableLineageShare: asShare(attributableLineagesCount, ranLineages),
    // LIN-1959: the true capture rate. `pricedLineageShare`'s own denominator
    // already excludes every lineage that posted no usage, so it cannot show
    // that exclusion. This does.
    captureRateShare: asShare(usageBearingLineages, ranLineages)
  };
}
