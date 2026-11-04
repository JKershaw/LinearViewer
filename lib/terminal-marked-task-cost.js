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
 * Lineage membership, the issue a lineage counts under, and its figure come from the one cost read
 * (`lineageRecords` and `lineageFigure` in lib/cost-read.js, LIN-4178), which takes membership from
 * `groupLineageMembership` (lib/lineage-membership.js) and the true issue from the founder lookup. The
 * outcome status and ticket walk come from `groupDispatchLineages` — the same shared seam
 * `computeDispatchOutcomes` uses, so the two metrics never disagree about which issues count as
 * resolved. This module never re-implements the normalise/harvest/terminal-derivation pipeline
 * locally, and it never decides membership itself.
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

import { groupDispatchLineages, evidenceCountOf, OUTCOME_WINDOW_DAYS } from './dispatch-lineage.js';
import { anchorOf } from './lineage-membership.js';
import { lineageRecords, lineageFigure } from './cost-read.js';
import { toEpochMs } from './utils/time.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * The two harness readings a lineage adds to the disclosure shares (LIN-2419, LIN-4134), from the one read's
 * `harnessReading` (lib/cost-read.js `lineageUsageOf`, LIN-4201 review note 1): a snapshot lineage's harness is the
 * REPORTED one, and a record lineage's comes from its records (always known), so a record lineage never counts as
 * unknown-harness. `opencodeSummed` means the figure sums an opencode delta snapshot; a record lineage is not
 * delta-summed. `opencodeSummed` is UNKNOWN exactly when `unknownHarness` is true: a lineage nobody reported a
 * harness for could have gone either way.
 */
function harnessReadingOf(record) {
  const { reported, deltaSummed } = record.harnessReading;
  return {
    opencodeSummed: reported ? deltaSummed : UNKNOWN,
    unknownHarness: !reported
  };
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
 * @param {Object} [options]
 * @param {Array<Object>} [options.identityRows] the founder lookup's scalar rows over the same lineages
 *   (lib/founder-lookup.js). A lineage's issue and kind come from them, so a horizon straddler is credited to
 *   its true founder (LIN-4148). Absent, the fetched rows stand in for the lookup.
 * @param {Array<Object>} options.requestRows REQUIRED (LIN-4201): the request records of the same lineages, from the
 *   request-usage loader. The cost read throws without it.
 * @returns {{windowDays: number, pricedTicketCount: number, pricedTicketCostUsd: number|null,
 *   closeOutLineageShare: number|null, evidenceLinkedShare: number|null,
 *   opencodeSummedShare: number|null, unknownHarnessShare: number|null,
 *   pricedLineageShare: number|null, attributableLineageShare: number|null,
 *   captureRateShare: number|null}}
 */
export function computeTerminalMarkedTaskCost(rows, now, { identityRows, requestRows } = {}) {
  return terminalMarkedTaskCostDetail(rows, now, { identityRows, requestRows }).figures;
}

/**
 * The same figures as `computeTerminalMarkedTaskCost`, plus the population they were summed over (LIN-4178
 * review, W6): `countedAnchors` is the set of lineage anchors (rootItemIds) the card counts. It is internal.
 * kpi-stats.js reads only the figures, and `toPublicKpis` never receives this object, so no anchor reaches the
 * public page. The W6 witness reads `countedAnchors` to pin the card's real population against the outcome
 * rate's, instead of a reconstruction of it.
 *
 * @returns {{figures: Object, countedAnchors: Set<string>}}
 */
export function terminalMarkedTaskCostDetail(rows, now, { identityRows = [], requestRows } = {}) {
  const outcomes = groupDispatchLineages(rows);
  // The one lineage read (lib/cost-read.js): membership, the true issue and kind, the fold, and the
  // outcome facts (status, ticket walk) joined by anchor. This module decides only the population and
  // the tickets.
  const lineages = lineageRecords({ fetchedRows: rows, identityRows, requestRows, outcomes });

  // Per-lineage evidence and close-out signals are a separate, simpler fold over
  // the same rows, keyed identically (`anchorOf`, lib/lineage-membership.js) to
  // the lineages above. This is not a re-implementation of the
  // normalise/harvest/terminal pipeline (no abort handling, no terminal
  // derivation): just two tallies groupDispatchLineages does not carry.
  const evidenceByLineage = new Map();
  const closeOutByLineage = new Map();
  for (const row of rows) {
    const key = String(anchorOf(row));
    evidenceByLineage.set(key, (evidenceByLineage.get(key) || 0) + evidenceCountOf(row));
    if (row.kind === 'close-out') closeOutByLineage.set(key, true);
  }

  const nowMs = now.getTime();
  const windowStart = nowMs - OUTCOME_WINDOW_DAYS * DAY_MS;

  // The lineages the population counts (in the window, not skipped), by anchor. Returned beside the figures
  // for the W6 witness; the figures themselves are unchanged by it.
  const countedAnchors = new Set();

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

  for (const lineage of lineages) {
    // The population rule is unchanged (LIN-4178): the lineage's earliest fetched member is in the window.
    // The horizon bounds every fetched member from below, so this is "has a member in the window".
    const start = lineage.members[0] ? toEpochMs(lineage.members[0].dispatchedAt) : null;
    if (start === null || start < windowStart || start > nowMs) continue;
    if (lineage.status === 'skipped') continue;
    const key = lineage.anchor;
    countedAnchors.add(key);

    ranLineages++;
    if (lineage.issueIdentifier) {
      attributableLineagesCount++;
      anchoredIdentifiers.add(lineage.issueIdentifier);
    }
    // Usage-bearing: some counted row carries usage (absent rows are the only ones that do not).
    const hasUsage = lineage.fold.completeness !== 'no-usage';
    if (hasUsage) usageBearingLineages++;

    const figure = lineageFigure(lineage);
    if (hasUsage && figure.fullyPriced) pricedLineagesCount++;

    // In-flight, failed and aborted lineages count above, but contribute no
    // tickets and no flags: only a finished lineage delivers tickets.
    if (lineage.status !== 'done') continue;

    for (const marker of lineage.ticketMarkers) {
      if (marker.state === 'done') laneTicketDoneIdentifiers.push(marker.identifier);
    }

    // An issue-less dispatch (autopilot kickoff, Collective, ad-hoc) has no
    // anchor, so it contributes no ticket and no flag. Its markers were
    // gathered above, and it never joins a component below.
    if (!lineage.issueIdentifier) continue;

    // This lineage's delivered-ticket set: its anchor plus every ticket its
    // own marker walk marked done.
    const lineageTicketIds = new Set([lineage.issueIdentifier]);
    for (const marker of lineage.ticketMarkers) {
      if (marker.state === 'done') lineageTicketIds.add(marker.identifier);
    }
    // An unpriced lineage records 0 here, which is safe: it forces its whole
    // component to `fullyPriced: false`, so the 0 never reaches the sum.
    anchoredLineageRecords.push({
      ticketIds: lineageTicketIds,
      fullyPriced: figure.fullyPriced,
      costUsd: figure.costUsd ?? 0
    });

    let issue = issues.get(lineage.issueIdentifier);
    if (!issue) {
      issue = { evidenceLinked: false, closeOut: false, opencodeSummed: false, unknownHarness: false };
      issues.set(lineage.issueIdentifier, issue);
    }

    if ((evidenceByLineage.get(key) || 0) > 0) issue.evidenceLinked = true;
    if (closeOutByLineage.get(key)) issue.closeOut = true;
    // LIN-2419 / LIN-4134: both readings come from the reported harness (harnessReadingOf).
    const reading = harnessReadingOf(lineage);
    issue.opencodeSummed = kleeneOr(issue.opencodeSummed, reading.opencodeSummed);
    issue.unknownHarness = kleeneOr(issue.unknownHarness, reading.unknownHarness);
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

  const figures = {
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
  return { figures, countedAnchors };
}
