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
 *     rate for the bimodal 0-vs-1 shape. The AGGREGATE `roundTrips` series
 *     (`n`/`mean`/`distribution`) is conditioned on `reachedPlanReviewAny`
 *     (LIN-1883 §2.3 — "round trips, conditional on reaching the gate"): an
 *     issue that never dispatched a plan-review row is excluded from it
 *     entirely, the same way it is excluded from `primary`. Mixing in
 *     never-reached issues dilutes the distribution toward 0 and makes it
 *     incomparable across workspace sizes — see LIN-2035.
 *  5. The sufficiency floor for the primary rate is a two-proportion power
 *     calculation — DERIVED from the code's own measured `p1` at read time
 *     (never a hardcoded target) — see `derivePrimaryFloor`. It is
 *     parameterised against a doubling-capped-by-shortfall-halving relative
 *     effect (p2 = min(p1·RATIO, 1-(1-p1)/RATIO); the plan's worked example,
 *     19%→38%, is the RATIO=2 doubling arm), α=0.05, power=0.80, mirroring
 *     `lib/follow-on-ratio.js`'s discipline of deriving the floor from the
 *     effect actually being measured, not that module's own count-based
 *     formula (`follow-on-ratio.js:133`, tuned to ITS pre-registered 50%
 *     rate-ratio effect — a floor for a COUNT, not this instrument's
 *     PROPORTION primary metric; reusing it verbatim was LIN-2035's B1
 *     defect).
 *  6. `customKindExposure`: any dispatch kind outside `BUCKET_OF_KIND`'s known
 *     vocabulary defaults to `'orchestration'` via `bucketOf` and is silently
 *     excluded from the pipeline sequence — same behavior `wall-clock-
 *     summary.js` already accepts.
 */

import { bucketOf } from './wall-clock-summary.js';
import { __internal as followOnRatioInternal } from './follow-on-ratio.js';

// ─── pinned parameters ───────────────────────────────────────────────────────

const VERDICT_TOKEN = /\b(approve|request changes|needs discussion)\b/i;
const GATE_DUE_MARKER = /plan-review due:\s*yes/i;
const DONE_LINE = /^\s*DONE:/i;

const NO_ATTEMPT_STATUSES = new Set(['cancelled', 'canceled', 'expired', 'aborted', 'failed']);
// 'blocked' (LIN-2079) is a DERIVED status the proxy list endpoint reports for a
// row whose runner posted `[blocked]` — alive, parked on a human, and stored as
// 'taken'. It belongs here rather than in NO_ATTEMPT_STATUSES: such a row is
// still in flight, so it stays right-censored exactly as it was while it
// reported 'taken'. Omitting it would match neither closed set and fall through
// to the structural tier, silently scoring a parked row as a settled attempt.
const IN_FLIGHT_STATUSES = new Set(['queued', 'taken', 'blocked']);

// Sufficiency derivation constants (see `derivePrimaryFloor`) — a standard
// two-proportion power calculation (LIN-1883 Plan v1 §9), NOT `lib/follow-on-
// ratio.js`'s count-based `2.80 · √(2/N) ≤ |ln(targetRatio)|` formula (that
// module's floor is for a rate-ratio effect on a COUNT; this instrument's
// primary metric is a PROPORTION — reusing the count formula verbatim was
// LIN-2035's B1 defect).
//   z(α/2) for a two-sided α=0.05 test, z(β) for power=0.80 (standard values).
const SUFFICIENCY_Z_ALPHA = 1.959964;
const SUFFICIENCY_Z_BETA = 0.841621;
// The effect class the plan's worked example measures against: a relative
// doubling of the observed rate (19%→38%), capped by halving the shortfall
// to 1: p2 = min(p1·RATIO, 1-(1-p1)/RATIO).
const SUFFICIENCY_EFFECT_RATIO = 2;
// Clamp away from the exact 0/1 boundary so the two-proportion variance terms
// stay finite when p1 ∈ {0, 1} (an all-request-changes or all-approve
// sub-window) — see `derivePrimaryFloor`'s doc comment for why this must
// still return a real (very demanding) floor rather than `null`.
const SUFFICIENCY_MIN_P = 1e-6;

/**
 * Gate-due/gate-honoured floor. Single-sourced from `lib/follow-on-ratio.js`'s
 * exported `__internal.MIN_DENOMINATOR` bag (LIN-1883 Plan v3 §9) rather than
 * re-declared here, and re-exported under the same name so existing importers
 * (this module's own `gateSufficient` included) stay byte-compatible.
 */
export const MIN_DENOMINATOR = followOnRatioInternal.MIN_DENOMINATOR;

// ─── small helpers ───────────────────────────────────────────────────────────

const toMs = (iso) => {
  if (typeof iso !== 'string' && !(iso instanceof Date)) return NaN;
  return new Date(iso).getTime();
};

const normalizeVerdict = (token) => token.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Fail-fast `asOf` validation shared by both exported entry points (LIN-2037
 * item 3) — a missing/unparseable `asOf` is a silent-wrong-answer path
 * (every comment falls out of window) rather than a loud one, so both
 * `computeIssueRoundTrips` and `computePlanReviewRoundTrips` throw on it.
 *
 * @param {*} asOf
 * @param {string} fnName  the calling function's name, folded into the message
 */
function requireAsOf(asOf, fnName) {
  if (typeof asOf !== 'string' || !Number.isFinite(toMs(asOf))) {
    throw new Error(`plan-review-round-trips: ${fnName}: asOf must be a parseable ISO instant (got ${JSON.stringify(asOf)})`);
  }
}

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
    let isNoGenuineAttempt = false;

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
        isNoGenuineAttempt = true;
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

    // `noGenuineAttempt` rows were never used to settle anything — exclude
    // them from the tier histogram (LIN-2037 item 2); `crossTierDisagreements`
    // stays unconditional, since it answers a different question ("did tiers
    // disagree on this row") independent of whether the row settled anything.
    if (!isNoGenuineAttempt) {
      const usedTier = tiers.a !== null ? 'a' : tiers.b !== null ? 'b' : tiers.c !== null ? 'c' : 'none';
      verdictTier[usedTier]++;
    }
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
  requireAsOf(options.asOf, 'computeIssueRoundTrips');
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
 * at read time — never a hardcoded target (see module limit 5). A standard
 * two-proportion sample-size calculation (per-group N), targeting the plan's
 * worked doubling-capped effect (p2 = min(p1·`SUFFICIENCY_EFFECT_RATIO`,
 * 1-(1-p1)/`SUFFICIENCY_EFFECT_RATIO`)) at α=0.05 (two-sided), power=0.80:
 *
 *   N = [z(α/2)·√(2·p̄·(1-p̄)) + z(β)·√(p1·(1-p1) + p2·(1-p2))]² / (p2-p1)²
 *
 * `null` is returned ONLY when there is no primary denominator at all
 * (`p1 === null`). `p1 ∈ {0, 1}` (an all-request-changes or all-approve
 * sub-window) is a REAL, measured proportion, not a missing one — clamping
 * p1 away from the exact boundary (`SUFFICIENCY_MIN_P`) keeps the variance
 * terms finite there and yields a very large (correctly almost-unreachable)
 * `requiredN` instead of a bogus "no denominator" claim (LIN-2035 B1).
 *
 * The comparison proportion p2 is the smaller — more conservative — of two
 * candidate effects: doubling the rate (`p1c·RATIO`) and halving the
 * shortfall to 1 (`1-(1-p1c)/RATIO`), taken via `Math.min` unconditionally
 * (no branch on p1c). The two arms cross at p1c=1/3; below that the doubling
 * arm is smaller, at or above it the shortfall-halving arm is. p2 carries no
 * upper clamp of its own — under this unified rule one would be actively
 * harmful, not merely redundant: at p1c=1 it would pull p2 back onto p1c,
 * making `(p2-p1c) = 0` and `requiredN = Infinity`, reintroducing the exact
 * divide-by-zero LIN-2035 B1 removed. The `p1c` clamp below (bounding p1
 * away from the exact 0/1 boundary) is the only boundary guarantee this
 * function needs: it alone keeps both arms — and therefore p2 itself —
 * strictly inside `(0, 1)`, so the variance terms stay finite everywhere.
 *
 * `effectRatio` on the object this returns is the REALISED ratio `p2/p1c`,
 * not the constant `SUFFICIENCY_EFFECT_RATIO` — see the emitted formula in
 * `computePlanReviewRoundTrips`'s `definition.sufficiencyFormula`.
 *
 * @param {number|null} p1  measured primaryNumerator/primaryDenominator
 * @returns {{requiredN: number, requiredNumerator: number, p1: number, p2: number, effectRatio: number, zAlpha: number, zBeta: number}|null}
 */
export function derivePrimaryFloor(p1) {
  if (!(typeof p1 === 'number' && Number.isFinite(p1) && p1 >= 0 && p1 <= 1)) return null;
  const p1c = Math.min(Math.max(p1, SUFFICIENCY_MIN_P), 1 - SUFFICIENCY_MIN_P);
  const p2 = Math.min(p1c * SUFFICIENCY_EFFECT_RATIO, 1 - (1 - p1c) / SUFFICIENCY_EFFECT_RATIO);
  const pBar = (p1c + p2) / 2;
  const pooledTerm = SUFFICIENCY_Z_ALPHA * Math.sqrt(2 * pBar * (1 - pBar));
  const spreadTerm = SUFFICIENCY_Z_BETA * Math.sqrt(p1c * (1 - p1c) + p2 * (1 - p2));
  const requiredN = Math.ceil((pooledTerm + spreadTerm) ** 2 / (p2 - p1c) ** 2);
  const requiredNumerator = Math.ceil(requiredN * p1);
  return {
    requiredN, requiredNumerator, p1, p2,
    effectRatio: p2 / p1c, zAlpha: SUFFICIENCY_Z_ALPHA, zBeta: SUFFICIENCY_Z_BETA,
  };
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
 * @param {Array|number} [options.skipped]  ids/rows the reader could not fetch
 * @returns {Object}
 */
export function computePlanReviewRoundTrips(issues = [], options = {}) {
  requireAsOf(options.asOf, 'computePlanReviewRoundTrips');
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
  let reachedPlanReviewCount = 0;
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

    // Conditional on reaching the gate (LIN-1883 §2.3), not every issue read —
    // an issue that never dispatched a plan-review row contributes no round
    // trips to measure and would otherwise dilute the distribution toward 0
    // in proportion to workspace size (LIN-2035 B2).
    if (result.reachedPlanReviewAny) {
      roundTripCounts.push(result.roundTrips);
      reachedPlanReviewCount++;
    }
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
  // F3 (LIN-2036): the numerator conjunct is DROPPED, not merely redundant.
  // With p1 = numerator/denominator, denominator >= requiredN generally
  // implies numerator >= requiredNumerator via Math.ceil, but at the
  // floating-point knife edge (denominator === requiredN, a Math.ceil
  // round-up like 52.00000000000001) it BINDS and flips the verdict wrong
  // (confirmed: n=52,d=85 and n=21,d=300). `requiredNumerator` stays
  // published on `floor` and in the emitted formula below — only its use as
  // a verdict conjunct is removed. Contrast `lib/follow-on-ratio.js:420`,
  // where the sibling shape's two floors are independently derived and the
  // analogous clause genuinely binds.
  const primarySufficient = Boolean(floor && primaryDenominator >= floor.requiredN);

  const gateDueRate = perIssue.length ? gateDueCount / perIssue.length : null;
  const gateHonouredRate = gateDueCount > 0 ? gateHonouredCount / gateDueCount : null;
  const gateSufficient = gateDueCount >= MIN_DENOMINATOR;

  const skippedCount = Array.isArray(options.skipped) ? options.skipped.length
    : Number.isFinite(options.skipped) ? options.skipped : 0;

  return {
    // ── the headline: first-pass approval rate ──
    primary: {
      numerator: primaryNumerator,
      denominator: primaryDenominator,
      rate: p1,
      sufficient: primarySufficient,
    },

    // ── the round-trip distribution, reported beside the headline, never as it —
    //    conditional on reachedPlanReviewAny (LIN-1883 §2.3), NOT every issue
    //    read; see `scale.reachedPlanReviewAny` for how it relates to `issuesRead` ──
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
      roundTripsRule: 'n/mean/distribution computed over issues with reachedPlanReviewAny === true only (LIN-1883 §2.3, conditional on reaching the gate) — see scale.reachedPlanReviewAny',
      sufficiencyFormula: floor
        ? `two-proportion power calc: N ≥ [z(α/2)·√(2p̄(1-p̄)) + z(β)·√(p1(1-p1)+p2(1-p2))]² / (p2-p1)² ≈ ${floor.requiredN}, numerator ≥ N·p1 ≈ ${floor.requiredNumerator} (p1 = ${p1.toFixed(4)} measured at read time, p2 = ${floor.p2.toFixed(4)} = min(${SUFFICIENCY_EFFECT_RATIO}·p1, 1−(1−p1)/${SUFFICIENCY_EFFECT_RATIO}) — the more conservative of doubling the rate and halving the shortfall — a ${floor.effectRatio.toFixed(3)}× realised relative effect, α = 0.05, power = 0.80)`
        : 'undefined — no primary denominator (0 resolved issues) to derive p1 from',
      measuredP1: p1,
    },

    window: { asOf, rulerChangeAt: options.rulerChangeAt || null },
    scale: { issuesRead: perIssue.length, reachedPlanReviewAny: reachedPlanReviewCount },

    // ── completeness (LIN-1984): a top-level, advisory signal so a run can no
    //    longer *look* complete while silently missing rows — never a
    //    publication gate.
    completeness: {
      attempted: perIssue.length + skippedCount,
      read: perIssue.length,
      skipped: skippedCount,
      complete: skippedCount === 0,
    },

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
