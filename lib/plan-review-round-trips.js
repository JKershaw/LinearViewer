/**
 * lib/plan-review-round-trips.js  (LIN-1883 Session 1 — Implementation Plan v3)
 *
 * Pure, network-free computation of PLAN-REVIEW ROUND TRIPS per ticket — how
 * many `plan -> plan-review -> plan` cycles a ticket burns before plan-review
 * returns anything other than Request Changes. This is the "before" instrument
 * the LIN-1871 template fix is judged against (LIN-1883). The pure analysis
 * lives here; the proxy read lives in `scripts/plan-review-round-trips.mjs`,
 * mirroring the `follow-on-ratio` / `wall-clock-summary` / `transcript-spend`
 * lineage split.
 *
 * This header states the CONTRACT this module implements; the measurement and
 * argument behind each choice live on LIN-1883's Implementation Plan (v3) and
 * its approving plan-review verdict (`b44b782f`) — read those before disputing
 * a constant or a branch here.
 *
 * ── PRIMARY METRIC ────────────────────────────────────────────────────────
 * First-pass approval rate: resolved(R0) && verdict(R0) === 'approve', over
 * primaryDenominator = issues whose R0 walk settled on a RESOLVED row (see
 * below). The round-trip COUNT distribution is reported beside it, never as
 * the headline — the endpoint is censored at one revision cycle by the
 * templates themselves (`lib/prompt-template-defs.js:223`,
 * `lib/prompts/meta-prompt-template.js:199`,
 * `lib/prompts/autopilot-kickoff.js:411`), so the observable shape is 0-vs-1,
 * not 0-vs-2.
 *
 * ── R0 ELIGIBILITY (extraction-first, state-second — load-bearing ordering) ─
 * For each plan-review row in dispatch order, a verdict extraction is tried
 * BEFORE `status` is ever consulted for eligibility:
 *
 *   for each plan-review row R, in order:
 *     verdict = extractVerdict(tier A comment) or extractVerdict(tier B DONE-line)
 *     if verdict !== null:            R0 = R, resolved, settle here
 *     elif R.status in {queued,taken} and R.completedAt is null:
 *                                      R0 = R, right-censored, settle here
 *     elif R.status in {cancelled,expired,aborted,failed}:
 *                                      diagnostics.noGenuineAttempt++, next row
 *     else (status === 'done', no textual verdict):
 *                                      R0 = R, resolve via tier C (structural), settle here
 *   if no row settles: issue excluded, diagnostics.noGenuineAttemptIssues++
 *
 * Reversing this ordering (status-filter first) is the exact bug a prior
 * plan-review pass demonstrated on LIN-1408: an aborted row is `'taken'`
 * (`routes/proxy.js:6007`'s `joinsLineage` check, evaluated before
 * `deriveTerminalStatus` turns a taken row's feedback into done/failed/
 * aborted) — a fixed status allowlist alone does not exclude it. The
 * extraction-first walk settles on genuine textual evidence wherever it
 * exists, regardless of the row's derived status.
 *
 * ── VERDICT RESOLUTION (extractVerdict, shared by both textual tiers) ───────
 * Tier A (the issue comment, the mandated artifact — `lib/prompt-template-
 * defs.js:847`) precedes Tier B (the row's own `DONE:` feedback line, free-
 * form corroboration) precedes Tier C (structural: the next pipeline row's
 * kind — a `plan` row implies revision was requested, anything else implies
 * approval-shaped progress; used only once both textual tiers return null on
 * a genuinely completed row).
 *
 * Both textual tiers share ONE extractor: find every case-insensitive
 * `verdict` occurrence in document order, open a [-80,+120) character window
 * around it, and return the first `\b(approve|request changes|needs
 * discussion)\b` token found in that window. No unanchored fallback — an
 * anchor that resolves to nothing is a miss, not a license to scan the whole
 * text (that unanchored-scan shape is the exact bug class this extractor
 * replaces). Comments are evaluated INDIVIDUALLY, never concatenated, and the
 * most-recently-posted comment that resolves wins.
 *
 * ── WINDOW BOUND (shared by both textual tiers) ─────────────────────────────
 * windowStart = R.dispatchedAt (row-own, never lineage-merged).
 * windowEnd   = the next PIPELINE row's dispatchedAt (any kind, not only the
 *               next plan-review row), else R.completedAt ?? asOf.
 *
 * ── INPUT CONTRACT ───────────────────────────────────────────────────────
 * One element per issue:
 *   {
 *     id, identifier, description,
 *     comments: [{ id, body, createdAt }],           // GET /issues/{id}.comments
 *     rows: [{                                        // GET /dispatch?issueIdentifier=… .items
 *       id, kind, status, dispatchedAt, completedAt,
 *       feedback?: [{ message, timestamp }],          // populated ONLY on plan-review
 *     }],                                              // rows, via GET /dispatch/{id}
 *   }
 * `rows` need not be pre-sorted or pre-filtered to the pipeline — this module
 * sorts by `dispatchedAt` and drops `bucketOf(kind) === 'orchestration'` rows
 * itself (reusing `lib/wall-clock-summary.js`'s `bucketOf`, not re-deriving
 * the pipeline-vs-orchestration split).
 *
 * ── KNOWN LIMITS (read before quoting a number) ─────────────────────────────
 *  1. The 80/120-char extraction window is sized against a measured sample
 *     (17 verdict comments + 13 `DONE:` lines during planning, independently
 *     re-verified at 17/17 + 19/19 across a 101-comment superset with zero
 *     cross-anchor conflicts during plan-review). A pathological comment
 *     discussing an unrelated "verdict" within that span of an unrelated
 *     token is a theoretical residual — `diagnostics.verdictTier` and
 *     `crossTierDisagreements` are the audit trail if one surfaces in a live
 *     read.
 *  2. `status` on a `'taken'` row is itself lineage-derived
 *     (`lib/dispatch-terminal.js`'s `mergeLineageFeedback`, applied by the
 *     proxy's list endpoint before this module ever sees the row): the walk's
 *     state branch can be wrong when both textual tiers return null AND the
 *     merged status misattributes a sibling's terminal outcome. Reachable
 *     only in that narrow case — extraction-first makes the textual tiers the
 *     normal path — and `diagnostics.noGenuineAttemptRowIds` on the per-issue
 *     result carries the row id for audit.
 *  3. `gateDue` is a current-snapshot read (`/plan-review due:\s*yes/i`
 *     against the description ONLY, mirroring `lib/follow-on-ratio.js`'s
 *     `planMarker` scoping — see that module's limit 7) — a description
 *     edited after the fact changes the answer.
 *  4. `roundTrips(issue)` (the structural diagnostic — count of `plan`-kind
 *     rows following at least one earlier `plan-review`-kind row) never feeds
 *     the primary numerator/denominator; it is reported beside the primary
 *     rate for the bimodal 0-vs-1 shape.
 *  5. The sufficiency floor for the primary rate is DERIVED from the code's
 *     own measured `p1` at read time (never a hardcoded target) — see
 *     `derivePrimaryFloor` — mirroring `lib/follow-on-ratio.js`'s discipline
 *     (a floor computed from the effect actually being measured), not its
 *     specific formula (that module's constants are tuned to ITS
 *     pre-registered 50% effect, not this instrument's).
 *  6. `customKindExposure`: any dispatch kind outside `BUCKET_OF_KIND`'s known
 *     vocabulary defaults to `'orchestration'` via `bucketOf` and is silently
 *     excluded from the pipeline sequence — same behavior `wall-clock-
 *     summary.js` already accepts.
 */

import { bucketOf } from './wall-clock-summary.js';

// ─── pinned parameters ───────────────────────────────────────────────────────

const VERDICT_TOKEN = /\b(approve|request changes|needs discussion)\b/i;
const GATE_DUE_MARKER = /plan-review due:\s*yes/i;
const DONE_LINE = /^\s*DONE:/i;

const NO_ATTEMPT_STATUSES = new Set(['cancelled', 'canceled', 'expired', 'aborted', 'failed']);
const IN_FLIGHT_STATUSES = new Set(['queued', 'taken']);

// Sufficiency derivation constants (see `derivePrimaryFloor`) — same shape as
// `lib/follow-on-ratio.js`'s `2.80 · √(2/N) ≤ |ln(targetRatio)|` halving-
// detectable threshold, applied against THIS instrument's own measured p1
// rather than a hardcoded baseline.
const SUFFICIENCY_Z = 2.80;
const SUFFICIENCY_TARGET_RATIO = 0.5;

/** Gate-due/gate-honoured floor, same constant `lib/follow-on-ratio.js` uses. */
export const MIN_DENOMINATOR = 30;

// ─── small helpers ───────────────────────────────────────────────────────────

const toMs = (iso) => {
  if (typeof iso !== 'string' && !(iso instanceof Date)) return NaN;
  return new Date(iso).getTime();
};

const normalizeVerdict = (token) => token.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Find a verdict in `text` by anchoring on every case-insensitive `verdict`
 * occurrence, in document order, and returning the first bidirectional-window
 * token that resolves. No unanchored fallback: an anchor with no nearby token
 * is a miss, not a license to scan the rest of the text.
 *
 * @param {string} text
 * @returns {'approve'|'request changes'|'needs discussion'|null}
 */
export function extractVerdict(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const m of text.matchAll(/verdict/gi)) {
    const start = m.index;
    const end = start + m[0].length;
    const window = text.slice(Math.max(0, start - 80), end + 120);
    const token = VERDICT_TOKEN.exec(window);
    if (token) return normalizeVerdict(token[1]);
  }
  return null;
}

/** The pipeline sequence: non-orchestration rows, dispatch-time ascending. */
function pipelineRowsOf(issue) {
  return (Array.isArray(issue.rows) ? issue.rows : [])
    .filter((r) => r && bucketOf(r.kind) !== 'orchestration')
    .slice()
    .sort((a, b) => toMs(a.dispatchedAt) - toMs(b.dispatchedAt));
}

/** Structural round-trip count: `plan` rows following an earlier `plan-review` row. */
function countRoundTrips(pipelineRows) {
  let seenPlanReview = false;
  let count = 0;
  for (const row of pipelineRows) {
    if (row.kind === 'plan-review') { seenPlanReview = true; continue; }
    if (row.kind === 'plan' && seenPlanReview) count++;
  }
  return count;
}

/**
 * Resolve all three tiers independently for one plan-review row (diagnostic
 * tallies need every tier's answer, not just the precedence winner).
 *
 * @returns {{a: string|null, b: string|null, c: string|null}}
 */
function resolveAllTiers(row, comments, windowStart, windowEnd, nextRow) {
  const startMs = toMs(windowStart);
  const endMs = toMs(windowEnd);

  const inWindow = comments
    .filter((c) => c && typeof c.body === 'string' && typeof c.createdAt === 'string')
    .filter((c) => {
      const ms = toMs(c.createdAt);
      return Number.isFinite(ms) && ms >= startMs && ms < endMs;
    })
    // Most-recently-posted first — "a later clarifying comment wins."
    .sort((x, y) => toMs(y.createdAt) - toMs(x.createdAt));

  let a = null;
  for (const c of inWindow) {
    const v = extractVerdict(c.body);
    if (v) { a = v; break; }
  }

  const doneLines = (Array.isArray(row.feedback) ? row.feedback : [])
    .filter((f) => f && typeof f.message === 'string' && DONE_LINE.test(f.message));
  let b = null;
  for (const f of doneLines) {
    const v = extractVerdict(f.message);
    if (v) { b = v; break; }
  }

  // Tier C — structural: what kind of row followed this one. A `plan` row
  // means a revision was requested; anything else means the pipeline moved
  // on. No next row ⇒ no structural signal either.
  const c = nextRow ? (nextRow.kind === 'plan' ? 'request changes' : 'approve') : null;

  return { a, b, c };
}

/**
 * The R0 eligibility walk (see module header). Also tallies the per-row
 * diagnostics (`verdictTier`, `crossTierDisagreements`) and the diagnostic-
 * only sub-window resolutions for every plan-review row beyond R0.
 */
function walkR0(pipelineRows, comments, asOf) {
  const planReviewRows = pipelineRows.filter((r) => r.kind === 'plan-review');
  const diagnostics = { noGenuineAttempt: 0, noGenuineAttemptRowIds: [] };
  const verdictTier = { a: 0, b: 0, c: 0, none: 0 };
  const crossTierDisagreements = { aVsB: 0, aVsC: 0, bVsC: 0 };
  const subWindows = [];

  let R0 = null;

  for (const row of planReviewRows) {
    const rowIndex = pipelineRows.indexOf(row);
    const nextRow = pipelineRows[rowIndex + 1] || null;
    const windowStart = row.dispatchedAt;
    const windowEnd = nextRow ? nextRow.dispatchedAt : (row.completedAt || asOf);

    const tiers = resolveAllTiers(row, comments, windowStart, windowEnd, nextRow);

    if (R0 === null) {
      const textualVerdict = tiers.a ?? tiers.b ?? null;
      if (textualVerdict !== null) {
        R0 = {
          row, nextRow, windowStart, windowEnd,
          verdict: textualVerdict, tier: tiers.a !== null ? 'a' : 'b',
          resolved: true, rightCensored: false,
        };
      } else if (IN_FLIGHT_STATUSES.has(row.status) && !row.completedAt) {
        R0 = {
          row, nextRow, windowStart, windowEnd,
          verdict: null, tier: null,
          resolved: false, rightCensored: true,
        };
      } else if (NO_ATTEMPT_STATUSES.has(row.status)) {
        diagnostics.noGenuineAttempt++;
        diagnostics.noGenuineAttemptRowIds.push(row.id);
        // no settle — try the next plan-review row
      } else {
        // status === 'done' (or any status outside the above sets), no
        // textual verdict — fall through to the structural tier.
        R0 = {
          row, nextRow, windowStart, windowEnd,
          verdict: tiers.c, tier: tiers.c !== null ? 'c' : null,
          resolved: tiers.c !== null, rightCensored: false,
        };
      }
    } else {
      // Beyond R0 — diagnostic-only sub-window resolution, unchanged shape.
      const verdict = tiers.a ?? tiers.b ?? tiers.c ?? null;
      const tier = tiers.a !== null ? 'a' : tiers.b !== null ? 'b' : tiers.c !== null ? 'c' : null;
      subWindows.push({ rowId: row.id, windowStart, windowEnd, verdict, tier });
    }

    const usedTier = tiers.a !== null ? 'a' : tiers.b !== null ? 'b' : tiers.c !== null ? 'c' : 'none';
    verdictTier[usedTier]++;
    if (tiers.a !== null && tiers.b !== null && tiers.a !== tiers.b) crossTierDisagreements.aVsB++;
    if (tiers.a !== null && tiers.c !== null && tiers.a !== tiers.c) crossTierDisagreements.aVsC++;
    if (tiers.b !== null && tiers.c !== null && tiers.b !== tiers.c) crossTierDisagreements.bVsC++;
  }

  return { R0, diagnostics, verdictTier, crossTierDisagreements, subWindows };
}

/**
 * Compute the full result for ONE issue. Exported standalone so a caller (or
 * a test, or the real-record validation script) can inspect exactly which row
 * an issue's walk settled on as R0 without wading through the aggregate.
 *
 * @param {Object} issue  one element of the input contract (see module header)
 * @param {{asOf: string}} options  `asOf` — REQUIRED ISO instant, used as the
 *   fallback `windowEnd` for a `done` row with no next pipeline row
 * @returns {Object}
 */
export function computeIssueRoundTrips(issue, options = {}) {
  const asOf = options.asOf;
  const pipelineRows = pipelineRowsOf(issue);
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  const walk = walkR0(pipelineRows, comments, asOf);

  const hasPlanDispatch = pipelineRows.some((r) => r.kind === 'plan');
  const description = typeof issue.description === 'string' ? issue.description : '';
  const gateDue = hasPlanDispatch && GATE_DUE_MARKER.test(description);
  const reachedPlanReviewAny = walk.R0 !== null;
  const gateHonoured = gateDue && reachedPlanReviewAny;

  const roundTrips = countRoundTrips(pipelineRows);

  // Bleed detection only runs on a settled R0 (a skipped/no-genuine-attempt
  // row's completedAt-vs-next-row relationship is never evaluated).
  let lineageBleed = false;
  if (walk.R0 && walk.R0.nextRow && walk.R0.row.completedAt) {
    lineageBleed = toMs(walk.R0.row.completedAt) > toMs(walk.R0.nextRow.dispatchedAt);
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    R0: walk.R0,
    reachedPlanReviewAny,
    gateDue,
    gateHonoured,
    roundTrips,
    diagnostics: walk.diagnostics,
    verdictTier: walk.verdictTier,
    crossTierDisagreements: walk.crossTierDisagreements,
    subWindows: walk.subWindows,
    lineageBleed,
  };
}

/**
 * Derive the primary-rate sufficiency floor from the code's OWN measured p1
 * at read time — never a hardcoded target (see module limit 5). Mirrors
 * `lib/follow-on-ratio.js`'s halving-detectable-effect discipline
 * (`2.80 · √(2/N) ≤ |ln(targetRatio)|`), solved for N and re-based on this
 * instrument's measured p1 rather than that module's own pre-registered 50%
 * effect.
 *
 * @param {number|null} p1  measured primaryNumerator/primaryDenominator
 * @returns {{requiredN: number, requiredNumerator: number, p1: number, targetRatio: number, z: number}|null}
 */
export function derivePrimaryFloor(p1) {
  if (!(typeof p1 === 'number' && p1 > 0 && p1 < 1)) return null;
  const requiredN = Math.ceil(2 * (SUFFICIENCY_Z / Math.log(1 / SUFFICIENCY_TARGET_RATIO)) ** 2);
  const requiredNumerator = Math.ceil(requiredN * p1);
  return { requiredN, requiredNumerator, p1, targetRatio: SUFFICIENCY_TARGET_RATIO, z: SUFFICIENCY_Z };
}

/**
 * Aggregate plan-review round trips across every issue the read pass
 * collected. Pure; every instant that matters (`asOf`) arrives as a required
 * parameter.
 *
 * @param {Array<Object>} issues  the input contract (see module header)
 * @param {Object} options
 * @param {string} options.asOf  REQUIRED ISO instant the data was read
 * @param {string} [options.rulerChangeAt]  optional ISO instant of a ruler
 *   change inside the read window (LIN-1859's `b6c5e046`) — when supplied,
 *   `diagnostics.rulerContamination` counts issues whose settled R0 sits on
 *   one side while `nextRow` (used for its own window bound) sits on the
 *   other, so a re-read can decide whether to split the window there.
 * @param {Object|null} [options.codeVersion]  stamped by the script, not here
 * @returns {Object}
 */
export function computePlanReviewRoundTrips(issues = [], options = {}) {
  if (typeof options.asOf !== 'string' || !Number.isFinite(toMs(options.asOf))) {
    throw new Error(`plan-review-round-trips: asOf must be a parseable ISO instant (got ${JSON.stringify(options.asOf)})`);
  }
  const asOf = options.asOf;
  const rulerChangeAtMs = options.rulerChangeAt ? toMs(options.rulerChangeAt) : null;

  const perIssue = [];
  let primaryNumerator = 0;
  let primaryDenominator = 0;
  let rightCensoredFirstPass = 0;
  let reachedButUnresolvedFirstPass = 0;
  let noGenuineAttemptIssues = 0;
  let noGenuineAttemptRows = 0;
  let gateDueCount = 0;
  let gateHonouredCount = 0;
  let lineageBleedIssues = 0;
  let subWindowCount = 0;
  let rulerContamination = 0;
  const roundTripCounts = [];
  const verdictTierTotals = { a: 0, b: 0, c: 0, none: 0 };
  const crossTierTotals = { aVsB: 0, aVsC: 0, bVsC: 0 };

  for (const issue of Array.isArray(issues) ? issues : []) {
    const result = computeIssueRoundTrips(issue, { asOf });
    perIssue.push(result);

    noGenuineAttemptRows += result.diagnostics.noGenuineAttempt;
    for (const k of ['a', 'b', 'c', 'none']) verdictTierTotals[k] += result.verdictTier[k];
    for (const k of ['aVsB', 'aVsC', 'bVsC']) crossTierTotals[k] += result.crossTierDisagreements[k];
    subWindowCount += result.subWindows.length;
    if (result.lineageBleed) lineageBleedIssues++;

    if (result.R0 === null) {
      noGenuineAttemptIssues++;
    } else if (result.R0.rightCensored) {
      rightCensoredFirstPass++;
    } else if (!result.R0.resolved) {
      reachedButUnresolvedFirstPass++;
    } else {
      primaryDenominator++;
      if (result.R0.verdict === 'approve') primaryNumerator++;
    }

    roundTripCounts.push(result.roundTrips);
    if (result.gateDue) gateDueCount++;
    if (result.gateHonoured) gateHonouredCount++;

    if (rulerChangeAtMs != null && result.R0 && result.R0.nextRow) {
      const rMs = toMs(result.R0.row.dispatchedAt);
      const nMs = toMs(result.R0.nextRow.dispatchedAt);
      if (Number.isFinite(rMs) && Number.isFinite(nMs) &&
          (rMs < rulerChangeAtMs) !== (nMs < rulerChangeAtMs)) {
        rulerContamination++;
      }
    }
  }

  const p1 = primaryDenominator > 0 ? primaryNumerator / primaryDenominator : null;
  const distribution = {};
  for (const c of roundTripCounts) distribution[c] = (distribution[c] || 0) + 1;
  const meanRoundTrips = roundTripCounts.length
    ? roundTripCounts.reduce((s, c) => s + c, 0) / roundTripCounts.length
    : null;

  const floor = derivePrimaryFloor(p1);
  const primarySufficient = Boolean(
    floor && primaryDenominator >= floor.requiredN && primaryNumerator >= floor.requiredNumerator
  );

  const gateDueRate = perIssue.length ? gateDueCount / perIssue.length : null;
  const gateHonouredRate = gateDueCount > 0 ? gateHonouredCount / gateDueCount : null;
  const gateSufficient = gateDueCount >= MIN_DENOMINATOR;

  return {
    // ── the headline: first-pass approval rate ──
    primary: {
      numerator: primaryNumerator,
      denominator: primaryDenominator,
      rate: p1,
      sufficient: primarySufficient,
    },

    // ── the round-trip distribution, reported beside the headline, never as it ──
    roundTrips: { n: roundTripCounts.length, mean: meanRoundTrips, distribution },

    // ── the unconditioned gate-due / gate-honoured series ──
    gate: {
      due: gateDueCount,
      honoured: gateHonouredCount,
      dueRate: gateDueRate,
      honouredRate: gateHonouredRate,
      sufficient: gateSufficient,
      minDenominator: MIN_DENOMINATOR,
    },

    // ── diagnostics: the three separately-countable "excluded from primary" buckets ──
    diagnostics: {
      noGenuineAttempt: noGenuineAttemptRows,
      noGenuineAttemptIssues,
      rightCensoredFirstPass,
      reachedButUnresolvedFirstPass,
      verdictTier: verdictTierTotals,
      crossTierDisagreements: crossTierTotals,
      lineageBleed: lineageBleedIssues,
      subWindows: subWindowCount,
      ...(rulerChangeAtMs != null ? { rulerContamination } : {}),
    },

    definition: {
      pinnedOn: 'LIN-1883 (Implementation Plan v3, approved b44b782f)',
      primaryRule: "resolved(R0) && verdict(R0) === 'approve'; denominator = issues whose R0 walk settled RESOLVED (excludes right-censored, reached-but-unresolved, and no-genuine-attempt issues, each counted separately in diagnostics)",
      r0EligibilityRule: 'extraction-first, state-second — see module header',
      verdictExtraction: 'anchor every /verdict/i occurrence, [-80,+120) char window, first resolving token wins, no unanchored fallback; tier A comment > tier B DONE-line > tier C structural (next pipeline row kind)',
      windowBound: 'windowStart = row-own dispatchedAt (never lineage-merged); windowEnd = next pipeline row dispatchedAt, else completedAt ?? asOf',
      sufficiencyFormula: floor
        ? `N ≥ 2·(${SUFFICIENCY_Z}/ln(1/${SUFFICIENCY_TARGET_RATIO}))² ≈ ${floor.requiredN}, numerator ≥ N·p1 ≈ ${floor.requiredNumerator} (p1 = ${p1.toFixed(4)} measured at read time)`
        : 'undefined — no primary denominator to derive p1 from',
      measuredP1: p1,
    },

    window: { asOf, rulerChangeAt: options.rulerChangeAt || null },
    scale: { issuesRead: perIssue.length },

    // ── per-issue detail — the validation surface (e.g. confirming LIN-1408's
    //    R0 lands on 70eac018, not the aborted 50960260) ──
    perIssue: perIssue.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      R0: r.R0 ? {
        rowId: r.R0.row.id,
        dispatchedAt: r.R0.row.dispatchedAt,
        status: r.R0.row.status,
        verdict: r.R0.verdict,
        tier: r.R0.tier,
        resolved: r.R0.resolved,
        rightCensored: r.R0.rightCensored,
      } : null,
      reachedPlanReviewAny: r.reachedPlanReviewAny,
      gateDue: r.gateDue,
      gateHonoured: r.gateHonoured,
      roundTrips: r.roundTrips,
      noGenuineAttempt: r.diagnostics.noGenuineAttempt,
      noGenuineAttemptRowIds: r.diagnostics.noGenuineAttemptRowIds,
      lineageBleed: r.lineageBleed,
    })),

    codeVersion: options.codeVersion || null,
  };
}

export const __internal = {
  NO_ATTEMPT_STATUSES, IN_FLIGHT_STATUSES, GATE_DUE_MARKER, DONE_LINE,
  toMs, pipelineRowsOf, countRoundTrips, resolveAllTiers, walkR0,
};
