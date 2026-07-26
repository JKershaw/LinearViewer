/**
 * lib/follow-on-ratio.js  (LIN-1654 — LIN-1601 Phase 0 / LIN-1600 S6)
 *
 * Pure, network-free computation of the **follow-on task ratio**: follow-up
 * tasks filed per verified-done task, over an absolute window. It is the
 * "before" number of LIN-1600's falsifiable close — the baseline the
 * `plan-review` gate is judged against one cycle later — and it follows the
 * LIN-1235/1241 lineage split (`lib/wall-clock-summary.js`,
 * `lib/transcript-spend.js`): the pure analysis lives here, the proxy read in
 * `scripts/follow-on-ratio.mjs`.
 *
 * The definition is PINNED in a comment on LIN-1600 and is not re-litigated
 * here:
 *
 *   ratio = |{ P : P is a `related`/`blocks` peer of some X in D,
 *               and P.createdAt > X.completedAt }|
 *           ─────────────────────────────────────────────────────────
 *           |D|,  D = { X : X.state.type === 'completed'
 *                           and X.completedAt ∈ [windowStart, windowEnd) }
 *
 * NAMING — "follow-on", never "follow-up", in every identifier. `followUpTo`
 * is the dispatch **session-resume** mechanism (176+ hits across `lib`/
 * `routes`); a `followUp*` name here would read as that unrelated concept.
 *
 * NO IMPORT FROM `lib/providers/state-map.js`, DELIBERATELY. `isCompleted()` /
 * `isTerminalState()` (`:17-19`, `:26`) also admit `canceled` and `duplicate`:
 * 1,177 vs 1,035 on this workspace, a **+13.7% inflated denominator**. The
 * check is written out literally as `state.type === 'completed'` so a future
 * "tidy-up" onto the convenient helper is a visible edit, not a silent one.
 *
 * CLOCK-FREE, and that is load-bearing. `windowStart` / `windowEnd` / `asOf`
 * arrive as required ISO parameters and are echoed verbatim into the result;
 * a missing or unparseable boundary THROWS rather than defaulting (mirroring
 * `partitionByDispatchTime`, `lib/transcript-spend.js:319-321`). Freeze-list
 * item 1 says never "last 30 days" — a module reading its own clock would
 * silently measure a different window on every run, the exact failure the
 * pinned definition exists to prevent. Everything else is tolerant, with what
 * it tolerated surfaced in `diagnostics` rather than swallowed.
 *
 * ── KNOWN LIMITS OF THIS METRIC (read before quoting a number) ──────────────
 *
 *  1. **The causal rule is a proxy, and a lossy one.** Relations carry no
 *     timestamp through this API (`RELATIONS_QUERY`,
 *     `lib/providers/linear/index.js:1489-1502`), so "filed in response to"
 *     is approximated by `peer.createdAt > source.completedAt`. Measured on a
 *     107-edge live probe, that rule excludes **94.4% of qualifying edges** —
 *     because `close-out`'s own instruction order is file follow-ups → merge →
 *     set Done (`lib/prompt-template-defs.js:946`), so a genuine follow-up is
 *     usually created *before* its source completes. This under-counts real
 *     follow-on work by design; the alternative (count every peer) would count
 *     `breakdown`'s pre-work decomposition edges as follow-ups, which is worse.
 *  2. **Retro-links are invisible.** An older ticket linked to a newly-done
 *     task is not counted — its `createdAt` predates the completion. This
 *     measures follow-ups *created after* a completion, not relations *filed*
 *     in the window.
 *  3. **Reopens are invisible.** Reopening a ticket creates no new issue and no
 *     new `createdAt`, so rework that surfaces as a reopen never enters the
 *     numerator. Named blind spot, not an oversight.
 *  4. **Sub-issues are excluded on purpose.** Children are planned
 *     decomposition created by `plan`/`breakdown` *before* the work
 *     (`lib/prompt-template-defs.js:365-377`, `:332`), not follow-on rework.
 *     20% of completed issues have children; that population is deliberately
 *     outside the numerator. Do not read the exclusion as an undercount.
 *  5. **The session-provenance arm of the definition is NOT MEASURABLE.** No
 *     surface links a dispatch/session to an issue it created — every
 *     `createdBy` in the codebase is an account id. Enabling it means
 *     persisting the created issue's id at the `POST /api/proxy/issues` seam,
 *     which is forward-only and cannot reconstruct a past baseline.
 *  6. **`completed` alone over-counts the denominator.** ~31% of in-window
 *     completions carry no review ledger, so unreviewed closes enter D and
 *     **deflate** the ratio. Accepted for re-runnability (verdict text has no
 *     schema; a hardened regex between baseline and re-read would move the
 *     number because the *ruler* changed). `diagnostics.pctWithReviewLedger`
 *     records the exposure.
 *  7. **The plan marker is textual, not a schema.** `planScoped` keys off the
 *     `plan` template's own mandated wording (`lib/prompt-template-defs.js:242`
 *     — "fits one session" / "needs multiple sessions") plus an Implementation
 *     Plan heading. It is a heuristic; override it via `options.planMarker` and
 *     record which pattern a baseline used.
 *  8. **All instruments are underpowered at this workspace's scale.** At the
 *     estimated ~50 whole-window events the headline needs a 43% drop to
 *     register, and the designated primary instrument (plan-scoped × matured)
 *     rests on ~7 events and needs 78%. `sufficient` exists to say so out loud
 *     rather than let a ratio be quoted as a delta. A null result is valid and
 *     informative (LIN-1241's shape).
 *  9. **Two definition ambiguities are recorded, not silently resolved**
 *     (LIN-1600 §6). (i) numerator as edges vs distinct peers — both are
 *     returned (`numerator` / `distinctPeers`); the headline reads edges, per
 *     the prose "follow-up tasks filed *per* verified-done task". (ii) relation
 *     direction — the headline is the **union** of outgoing + inverse deduped
 *     by peer id, since "peer" is direction-agnostic; `arms.causalOutgoing` is
 *     returned alongside so the 6× swing between the two readings is visible in
 *     one run. Hygiene diagnostics count the union, so they will legitimately
 *     exceed research's outgoing-only 0.86.
 *
 * The input is the raw detail payload of `GET /api/proxy/issues/{id}`, exactly
 * as the proxy returns it — same keys, same nesting, ISO strings as strings.
 * Every transform is a place the script and this module can drift, and drift is
 * silent here: a renamed key yields `undefined`, and `undefined > completedAt`
 * is `false`, so edges vanish without an error.
 */

// ─── pinned definition parameters ────────────────────────────────────────────

/** Relation types that count as a follow-up link. `duplicate` is NOT new work. */
const COUNTED_RELATION_TYPES = ['related', 'blocks'];

/** Maturity horizon for the censoring-corrected companion instrument, in days. */
const MATURITY_DAYS = 7;

const MS_PER_DAY = 86_400_000;

// Sufficiency floors (LIN-1600, freeze-list item 7 — the `MIN_COHORT_EDIT`
// shape of `scripts/transcript-spend.mjs:282-283`, moved up a level). The
// numerator floor is DERIVED from the pre-registered ~50% effect, not chosen to
// be passable: 2.80 × √(2/N) ≤ |ln 0.5| ⇒ N ≥ 32.6. A denominator floor alone
// would declare the plan-scoped instrument sufficient on 105 completions while
// its numerator sat at 11 — exactly the over-claim MIN_COHORT_EDIT guards.
const MIN_DENOMINATOR = 30;
const MIN_NUMERATOR = 33;

/**
 * Did the `plan` step run on this issue? Keyed to the plan template's own
 * mandated session-fit wording (`lib/prompt-template-defs.js:242`) and the
 * heading planned work carries in practice. Heuristic — see limit 7.
 */
const PLAN_MARKER = /#{1,4}\s*implementation plan\b|\bfits one session\b|\bneeds multiple sessions\b/i;

/**
 * Did a review record its ledger on this issue? The `### What CI Did Not Prove`
 * literal (`lib/prompt-template-defs.js:955`) is the most stable review marker,
 * being template-emitted. Diagnostic only — never gates the denominator.
 */
const REVIEW_LEDGER_MARKER = /###\s*What CI Did Not Prove/i;

// ─── small helpers ───────────────────────────────────────────────────────────

const toMs = (iso) => {
  if (typeof iso !== 'string' && !(iso instanceof Date)) return NaN;
  return new Date(iso).getTime();
};

/**
 * Parse a required ISO boundary, throwing on absence or garbage. The metric is
 * only comparable across runs if its window is stated absolutely, so defaulting
 * here would be silence that lies.
 */
function requireInstant(value, name) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) throw new Error(`follow-on-ratio: ${name} must be a parseable ISO instant (got ${JSON.stringify(value)})`);
  return ms;
}

/**
 * A ratio, or null when there is nothing to divide by. `null`, never `0` —
 * `0` is a legitimate measured value for this metric (a window in which no
 * follow-ups were filed), so collapsing "no data" onto it would mislead. This
 * is `lib/kpi-stats.js:449`'s `asRate` posture, not `transcript-spend.js:188`'s
 * `ratioOf`. Deliberately unrounded: a recorded baseline keeps full precision.
 */
const rate = (part, whole) => (whole > 0 ? part / whole : null);

/** Every text surface of an issue a marker could appear on. */
function textOf(issue) {
  const parts = [];
  if (issue && typeof issue.description === 'string') parts.push(issue.description);
  const comments = issue && Array.isArray(issue.comments) ? issue.comments : [];
  for (const c of comments) if (c && typeof c.body === 'string') parts.push(c.body);
  return parts.join('\n');
}

const hasPlanMarker = (issue, pattern = PLAN_MARKER) => pattern.test(textOf(issue));
const hasReviewLedger = (issue, pattern = REVIEW_LEDGER_MARKER) => pattern.test(textOf(issue));

/**
 * The peer on the far side of a relation element, whichever arm it arrived on.
 * Outgoing nests the peer under `relatedIssue`; inverse nests it under `issue`
 * (`RELATIONS_QUERY`, `lib/providers/linear/index.js:1489-1502`).
 *
 * This normalizer is the highest-consequence predicate in the metric and lives
 * HERE rather than in the script on purpose: 5 of the 6 counted follow-ups in
 * the planning probe arrived on the inverse arm, so normalizing it away drops
 * five sixths of the numerator, and the script is the one file this lineage
 * never unit-tests.
 *
 * @param {Object} relation a `relations[]` or `inverseRelations[]` element
 * @returns {Object|null} the peer issue stub, or null when unrecognisable
 */
function peerOf(relation) {
  if (!relation || typeof relation !== 'object') return null;
  const peer = relation.relatedIssue || relation.issue || null;
  return peer && typeof peer === 'object' ? peer : null;
}

/** Index every issue by its UUID. Peer identity is the id everywhere — keying
 *  by `identifier` would double-count every two-sided edge. */
function buildPeerIndex(issues) {
  const index = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (issue && typeof issue.id === 'string' && issue.id) index.set(issue.id, issue);
  }
  return index;
}

const typeCounted = (relation, types) => {
  const t = relation && typeof relation.type === 'string' ? relation.type.trim().toLowerCase() : '';
  return types.includes(t);
};

// ─── the two pinned predicates ───────────────────────────────────────────────

/**
 * Definition (b): what counts as verified-done. `state.type === 'completed'`
 * ALONE — written out literally, never via `isCompleted()`/`isTerminalState()`,
 * which admit `canceled`/`duplicate` (+13.7% denominator; see the header).
 *
 * A trashed issue is also refused: the proxy rewrites a trashed issue's state
 * to `{name:'Trashed', type:'canceled'}` and returns 200 (`routes/proxy.js`
 * `applyTrashedSignal`), so the state check already excludes it on a detail
 * payload — this second clause makes the intent explicit and holds if a caller
 * ever supplies a payload whose state was not rewritten.
 *
 * @param {{state?: {type?: string}, trashed?: boolean|null}} issue
 * @returns {boolean}
 */
export function isVerifiedDone(issue) {
  if (!issue || typeof issue !== 'object') return false;
  if (issue.trashed === true) return false;
  return issue.state?.type === 'completed';
}

/**
 * Definitions (a) + (c) for ONE done task: the peers that qualify as follow-ons
 * of it. A peer qualifies when its relation type is `related`/`blocks`, it is
 * not a sub-issue of the source, it resolves in the index (so its own
 * `createdAt` is readable), and `peer.createdAt > source.completedAt` — strict,
 * so a peer created in the same instant as the completion does not count.
 *
 * Both relation arms are walked and the result is deduped by peer id, so a
 * source linked to the same peer twice (e.g. `related` and `blocks`) counts it
 * once — faithful to the pinned set-builder `|{ P : … }|`, which is over peers.
 *
 * @param {Object} source a done task's detail payload
 * @param {Map<string, Object>} peerIndex id → issue detail payload
 * @param {{relationTypes?: string[], maturityDays?: number}} [options]
 * @returns {{peers: Array<Object>, unresolvedPeers: number, relationsSeen: number}}
 */
export function countFollowOns(source, peerIndex, options = {}) {
  const relationTypes = options.relationTypes || COUNTED_RELATION_TYPES;
  const maturityDays = Number.isFinite(options.maturityDays) ? options.maturityDays : MATURITY_DAYS;
  const index = peerIndex instanceof Map ? peerIndex : new Map();

  const out = { peers: [], unresolvedPeers: 0, relationsSeen: 0 };
  if (!source || typeof source !== 'object') return out;

  const completedMs = toMs(source.completedAt);
  const childIds = new Set(
    (Array.isArray(source.children) ? source.children : [])
      .map((c) => c && c.id)
      .filter(Boolean)
  );
  const maturityCutoff = completedMs + maturityDays * MS_PER_DAY;

  const arms = [
    { direction: 'outgoing', list: Array.isArray(source.relations) ? source.relations : [] },
    { direction: 'inverse', list: Array.isArray(source.inverseRelations) ? source.inverseRelations : [] },
  ];

  const seen = new Set();
  for (const { direction, list } of arms) {
    for (const relation of list) {
      if (!typeCounted(relation, relationTypes)) continue;
      out.relationsSeen += 1;

      const stub = peerOf(relation);
      const peerId = stub && typeof stub.id === 'string' ? stub.id : null;
      if (!peerId || peerId === source.id) continue;
      if (childIds.has(peerId)) continue;           // planned decomposition, not rework
      if (seen.has(peerId)) continue;               // one peer counts once per source
      seen.add(peerId);                             // …including as an unresolved one

      const peer = index.get(peerId);
      const createdMs = toMs(peer && peer.createdAt);
      if (!Number.isFinite(createdMs)) {
        // The relation exists but the peer's own createdAt is unreadable, so the
        // causal rule cannot be evaluated. Surfaced, never counted either way.
        out.unresolvedPeers += 1;
        continue;
      }
      if (!(Number.isFinite(completedMs) && createdMs > completedMs)) continue;

      out.peers.push({
        id: peerId,
        identifier: (peer && peer.identifier) || (stub && stub.identifier) || null,
        createdAt: peer.createdAt,
        direction,
        type: String(relation.type).trim().toLowerCase(),
        sharesParent: Boolean(source.parent?.id) && peer.parent?.id === source.parent.id,
        withinMaturity: createdMs <= maturityCutoff,
      });
    }
  }
  return out;
}

// ─── instruments ─────────────────────────────────────────────────────────────

/**
 * One instrument reading over a set of already-resolved sources.
 * `numerator` is edge-flavoured (qualifying peers summed across sources);
 * `distinctPeers` is the set-flavoured companion. Both are recorded because the
 * pinned formula and freeze-list item 2 read the numerator differently and that
 * ambiguity is deliberately left open (limit 9).
 */
function reading(sources, keepPeer, floors) {
  let numerator = 0;
  const distinct = new Set();
  for (const source of sources) {
    for (const peer of source.peers) {
      if (!keepPeer(peer, source)) continue;
      numerator += 1;
      distinct.add(peer.id);
    }
  }
  const denominator = sources.length;
  return {
    numerator,
    denominator,
    distinctPeers: distinct.size,
    ratio: rate(numerator, denominator),
    sufficient: denominator >= floors.minDenominator && numerator >= floors.minNumerator,
  };
}

const keepAll = () => true;
const keepMatured = (peer) => peer.withinMaturity;

/**
 * Compute the follow-on task ratio and everything freeze-listed alongside it.
 *
 * Feed it EVERY issue detail payload the script read — not just the completed
 * ones. The extras are the peer index: a follow-up's own `createdAt` lives on
 * its detail payload, and a peer missing from the input lands in
 * `diagnostics.unresolvedPeers` rather than being silently dropped.
 *
 * @param {Array<Object>} issues  raw `GET /api/proxy/issues/{id}` payloads
 * @param {Object} options
 * @param {string} options.windowStart  REQUIRED absolute ISO instant, inclusive
 * @param {string} options.windowEnd    REQUIRED absolute ISO instant, exclusive
 * @param {string} options.asOf         REQUIRED ISO instant the data was read
 * @param {number} [options.maturityDays=7]
 * @param {number} [options.minDenominator=30]
 * @param {number} [options.minNumerator=33]
 * @param {string[]} [options.relationTypes=['related','blocks']]
 * @param {RegExp} [options.planMarker]
 * @param {RegExp} [options.reviewLedgerMarker]
 * @param {Array|number} [options.skipped]  ids the reader could not fetch
 * @param {Object|null} [options.codeVersion]  stamped by the script, not here
 * @returns {Object} the full freeze list — see the README-shaped fields below
 */
export function computeFollowOnRatio(issues = [], options = {}) {
  const windowStartMs = requireInstant(options.windowStart, 'windowStart');
  const windowEndMs = requireInstant(options.windowEnd, 'windowEnd');
  requireInstant(options.asOf, 'asOf');

  const relationTypes = (options.relationTypes || COUNTED_RELATION_TYPES).map((t) => String(t).trim().toLowerCase());
  const maturityDays = Number.isFinite(options.maturityDays) ? options.maturityDays : MATURITY_DAYS;
  const planMarker = options.planMarker || PLAN_MARKER;
  const reviewLedgerMarker = options.reviewLedgerMarker || REVIEW_LEDGER_MARKER;
  const floors = {
    minDenominator: Number.isFinite(options.minDenominator) ? options.minDenominator : MIN_DENOMINATOR,
    minNumerator: Number.isFinite(options.minNumerator) ? options.minNumerator : MIN_NUMERATOR,
  };

  const all = Array.isArray(issues) ? issues : [];
  const peerIndex = buildPeerIndex(all);

  // ── the denominator: D = completed, completedAt ∈ [windowStart, windowEnd) ──
  const sources = [];
  let totalCompleted = 0;
  let undated = 0;
  for (const issue of all) {
    if (!isVerifiedDone(issue)) continue;
    totalCompleted += 1;
    const completedMs = toMs(issue.completedAt);
    if (!Number.isFinite(completedMs)) {
      // Completed but undatable: it can belong to no window, so it enters
      // neither the denominator nor the numerator. Counted out loud — a large
      // undated set would otherwise look like a small workspace.
      undated += 1;
      continue;
    }
    // Half-open so adjacent windows tile without double-counting a completion.
    if (completedMs < windowStartMs || completedMs >= windowEndMs) continue;

    const { peers, unresolvedPeers, relationsSeen } = countFollowOns(issue, peerIndex, { relationTypes, maturityDays });
    sources.push({
      id: issue.id,
      identifier: issue.identifier || null,
      completedAt: issue.completedAt,
      completedMs,
      peers,
      unresolvedPeers,
      relationsSeen,
      planned: planMarker.test(textOf(issue)),
      reviewed: reviewLedgerMarker.test(textOf(issue)),
      // Fully matured = the maturity horizon closed inside the window, so the
      // task had its whole accrual period observed. Sources completed less than
      // `maturityDays` before windowEnd leave the matured DENOMINATOR; that is
      // the censoring correction, and it costs denominator, not numerator.
      matured: completedMs + maturityDays * MS_PER_DAY <= windowEndMs,
    });
  }

  const planned = sources.filter((s) => s.planned);
  const matured = sources.filter((s) => s.matured);
  const plannedMatured = planned.filter((s) => s.matured);

  // Headline = the pinned reading: causal rule, union of both relation arms.
  const causalUnion = reading(sources, keepAll, floors);

  const withAnyRelation = sources.filter((s) => s.relationsSeen > 0).length;
  const totalRelations = sources.reduce((n, s) => n + s.relationsSeen, 0);
  const skipped = Array.isArray(options.skipped) ? options.skipped.length
    : Number.isFinite(options.skipped) ? options.skipped : 0;

  return {
    // ── the headline number (freeze-list item 2: raw counts, not just a ratio)
    ratio: causalUnion.ratio,
    numerator: causalUnion.numerator,
    denominator: causalUnion.denominator,
    distinctPeers: causalUnion.distinctPeers,
    sufficient: causalUnion.sufficient,
    minDenominator: floors.minDenominator,
    minNumerator: floors.minNumerator,

    // ── item 1: absolute bounds, echoed verbatim, never "last 30 days"
    window: {
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      asOf: options.asOf,
      bounds: '[windowStart, windowEnd)',
    },

    // ── item 3: the definition parameters, verbatim, next to the number
    definition: {
      pinnedOn: 'LIN-1600',
      relationTypesCounted: relationTypes,
      excluded: ['duplicate relations', 'sub-issues (children)', 'reopens'],
      numeratorRule: 'peer.createdAt > source.completedAt',
      denominatorRule: "state.type === 'completed'",
      numeratorCounting: 'qualifying peers summed per source; distinctPeers reported alongside (LIN-1600 §6(i) open)',
      relationDirection: 'union of outgoing + inverse, deduped by peer id (LIN-1600 §6(ii) open)',
      maturityDays,
      planMarker: String(planMarker),
      reviewLedgerMarker: String(reviewLedgerMarker),
    },

    // ── the three predicate arms, from one pass, so the choice between them can
    //    be made from real numbers without a second 29-minute measurement
    arms: {
      causalUnion,
      causalOutgoing: reading(sources, (p) => p.direction === 'outgoing', floors),
      sharedParentExcluded: reading(sources, (p) => !p.sharesParent, floors),
    },

    // ── item 6: the two companion instruments, plus the designated primary
    matured7d: reading(matured, keepMatured, floors),
    planScoped: reading(planned, keepAll, floors),
    primary: reading(plannedMatured, keepMatured, floors),

    // ── item 5: diagnostics that let a re-read attribute any move
    diagnostics: {
      inWindowCompletions: sources.length,
      meanRelationsPerCompleted: rate(totalRelations, sources.length),
      pctWithAnyRelation: rate(withAnyRelation, sources.length),
      pctWithReviewLedger: rate(sources.filter((s) => s.reviewed).length, sources.length),
      pctWithPlanMarker: rate(planned.length, sources.length),
      maturedSources: matured.length,
      unresolvedPeers: sources.reduce((n, s) => n + s.unresolvedPeers, 0),
      undated,
      skipped,
    },

    // ── item 8: workspace scale, so a truncated read surfaces instead of hiding
    scale: { totalIssues: all.length, totalCompleted },

    // ── item 4: stamped by the script (which can read git); null here, because
    //    this module is shell-free and clock-free by contract
    codeVersion: options.codeVersion || null,
  };
}

export const __internal = {
  COUNTED_RELATION_TYPES, MATURITY_DAYS, MIN_DENOMINATOR, MIN_NUMERATOR, MS_PER_DAY,
  PLAN_MARKER, REVIEW_LEDGER_MARKER,
  toMs, requireInstant, rate, textOf, hasPlanMarker, hasReviewLedger,
  peerOf, buildPeerIndex, typeCounted, reading,
};
