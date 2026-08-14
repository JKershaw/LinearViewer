/**
 * Ship Journey Derivation Library (LIN-1684 / LIN-1675 P2)
 *
 * Pure, network-free, LLM-free derivation of a waypoint trail from roadmap
 * report history and current issue data. One exported entry point
 * `deriveJourney({ reports, issues })`, internally decomposed into small
 * named private helpers sharing a single ascending pass over sorted reports.
 *
 * Exports:
 *   deriveJourney            The sole public entry point.
 */

import { BEARING_TO_ANGLE, BEARINGS } from './ship-layout.js';
import { ORIENTATION_CANDIDATE_CAP } from './prompts/roadmap-orientation-template.js';

const CAP_MESSAGE = "this run's list was at the cap — some candidates may have been dropped, count unknown";

// Heading-inertia walk (LIN-2065 / LIN-1675 P5, John's 2026-08-14 ruling on
// LIN-1675): the ship turns toward each waypoint's bearing angle instead of
// snapping to it, so a direct reversal renders as an arc over several steps
// rather than a one-step flip across the ship's own wake.
export const MAX_TURN_DEGREES = 40;

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Sort reports defensively by generatedAt ascending.
 * Never assume caller order — `listFull()` is documented newest-first,
 * but a pure library that silently trusts a single caller's ordering is
 * exactly the kind of implicit contract that breaks quietly when a future
 * caller passes data in a different order.
 * @param {ReportRecord[]} reports
 * @returns {ReportRecord[]}
 */
function sortReportsChronological(reports) {
  return [...reports].sort((a, b) => {
    if (a.generatedAt < b.generatedAt) return -1;
    if (a.generatedAt > b.generatedAt) return 1;
    return 0;
  });
}

/**
 * Build a Map(identifier → issue) from a plain array.
 * Issues arrives as a bare array (the shape `fetchWorkspaceIssues` returns) —
 * it is never pre-indexed by identifier.  Build the index once internally,
 * private to this module.
 * @param {Issue[]} issues
 * @returns {Map<string, Object>}
 */
function buildIssueIndex(issues) {
  const index = new Map();
  for (const issue of issues) {
    if (issue && issue.identifier) {
      index.set(issue.identifier, issue);
    }
  }
  return index;
}

/**
 * Single ascending pass over sorted reports, producing three of the five
 * output families at once (one O(reports × avg orientation length) pass):
 *
 *   candidateReadings  Map(identifier → { bearing }) — overwritten on every
 *                      non‑archived orientation[] entry seen.  Because the pass
 *                      is chronological, the last write for a given identifier
 *                      is automatically its **newest** reading — no extra
 *                      bookkeeping needed.
 *   starChanges        [{ from, to, at }] — chronological; empty ('' )
 *                      northStar snapshots are skipped entirely as both
 *                      values and diff-breakers (so `'x' → '' → 'x'` produces
 *                      zero entries).
 *   atCapCount         Count of RETAINED REPORTS whose raw
 *                      orientation.length === ORIENTATION_CANDIDATE_CAP.
 *                      Archived entries are included in this raw count
 *                      (they were candidates at generation time), even though
 *                      they are excluded from candidateReadings.
 *   span               { oldest, newest } | null — report generatedAt bounds;
 *                      null when reports.length === 0.
 *   totalReports       reports.length (degraded reports with orientation: []
 *                      are NOT filtered out).
 *
 * @param {ReportRecord[]} sortedReports — already sorted ascending by generatedAt
 * @returns {Object}
 */
function walkReportHistory(sortedReports) {
  const candidateReadings = new Map();
  const starChanges = [];
  let atCapCount = 0;
  let span = null;
  const totalReports = sortedReports.length;
  let lastNonEmptyNorthStar = null;

  for (const report of sortedReports) {
    // ── span bounds ───────────────────────────────────────────────────────
    if (span === null) {
      span = { oldest: report.generatedAt, newest: report.generatedAt };
    } else {
      if (report.generatedAt < span.oldest) span.oldest = report.generatedAt;
      if (report.generatedAt > span.newest) span.newest = report.generatedAt;
    }

    // ── cap-hit: RAW orientation.length (archived entries included) ───────
    if (report.orientation && report.orientation.length === ORIENTATION_CANDIDATE_CAP) {
      atCapCount++;
    }

    // ── star diff: skip empty ('' ) snapshots entirely ────────────────────
    const ns = report.northStar;
    if (ns && ns !== '') {
      if (lastNonEmptyNorthStar !== null && lastNonEmptyNorthStar !== ns) {
        starChanges.push({ from: lastNonEmptyNorthStar, to: ns, at: report.generatedAt });
      }
      lastNonEmptyNorthStar = ns;
    }

    // ── candidate readings: overwrite on every non-archived entry ─────────
    if (report.orientation && report.orientation.length > 0) {
      for (const entry of report.orientation) {
        if (!entry.archived && entry.identifier && entry.bearing) {
          candidateReadings.set(entry.identifier, { bearing: entry.bearing });
        }
      }
    }
  }

  return { candidateReadings, starChanges, atCapCount, span, totalReports };
}

/**
 * Filter candidateReadings to identifiers whose issue is terminal-completed
 * and derive waypoints.  Uses the literal `issue.state?.type === 'completed'`
 * check — NEVER `isCompleted()`/`isTerminalState()`, which admit canceled and
 * duplicate (see `lib/follow-on-ratio.js:301-304` for the in‑house precedent).
 *
 * @param {Map<string, {bearing: string}>} candidateReadings
 * @param {Map<string, Object>} issueIndex
 * @returns {Array<{identifier: string, bearing: string, angle: number, completedAt: string}>}
 */
function deriveWaypoints(candidateReadings, issueIndex) {
  const waypoints = [];

  for (const [identifier, { bearing }] of candidateReadings) {
    const issue = issueIndex.get(identifier);
    if (!issue) continue;
    if (issue.state?.type !== 'completed') continue;

    waypoints.push({
      identifier,
      bearing,
      angle: BEARING_TO_ANGLE[bearing],
      completedAt: issue.completedAt
    });
  }

  waypoints.sort((a, b) => {
    if (a.completedAt < b.completedAt) return -1;
    if (a.completedAt > b.completedAt) return 1;
    return 0;
  });

  return waypoints;
}

/**
 * Signed shortest angular delta from `current` to `target`, in (-180, 180].
 * Positive = clockwise (screen-coords convention, matching BEARING_TO_ANGLE).
 * @param {number} target
 * @param {number} current
 * @returns {number}
 */
function shortestAngleDelta(target, current) {
  return ((target - current + 540) % 360) - 180;
}

/**
 * Wrap an angle into [0, 360).
 * @param {number} angle
 * @returns {number}
 */
function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

/**
 * Clamp a signed delta's magnitude to ±MAX_TURN_DEGREES.
 * @param {number} delta
 * @returns {number}
 */
function clampTurn(delta) {
  if (delta > MAX_TURN_DEGREES) return MAX_TURN_DEGREES;
  if (delta < -MAX_TURN_DEGREES) return -MAX_TURN_DEGREES;
  return delta;
}

/**
 * For each index i>0 in `placeable`, whether a starChange's `at` falls in
 * (placeable[i-1].completedAt, placeable[i].completedAt] — the same "does a
 * north-star change land between these two consecutive waypoints" test
 * public/ship-journey.js runs client-side for its own segment breaks. Kept
 * in sync by construction (same starChanges, same completedAt comparison).
 * @param {Array<{completedAt: string}>} placeable
 * @param {Array<{at: string}>} starChanges
 * @returns {boolean[]}
 */
function computeBreakBefore(placeable, starChanges) {
  const breakBefore = new Array(placeable.length).fill(false);
  for (let i = 1; i < placeable.length; i++) {
    const prevAt = placeable[i - 1].completedAt;
    const currAt = placeable[i].completedAt;
    for (const change of starChanges) {
      if (change.at > prevAt && change.at <= currAt) {
        breakBefore[i] = true;
        break;
      }
    }
  }
  return breakBefore;
}

/**
 * Derive per-waypoint `x`/`y` via a heading-inertia cumulative walk over the
 * **placeable projection** (waypoints with a `completedAt`, in their existing
 * ascending order) — never the raw waypoint list, so a waypoint that can't be
 * placed on the chronological trail can't perturb the spacing of the ones
 * that can (John's 2026-08-14 ruling on LIN-1675, "placeable-projection
 * finding").
 *
 * The ship's heading turns toward each waypoint's bearing angle by at most
 * `MAX_TURN_DEGREES` per step, then advances one unit along the resulting
 * heading — a direct reversal arcs over several steps rather than snapping
 * across the ship's own wake. Heading starts at the first placeable
 * waypoint's own bearing angle (no clamp on step one), and both heading and
 * position reset — "a fresh berth" — at a north-star segment break, matching
 * the break public/ship-journey.js already draws (no connecting line, ★
 * marker).
 *
 * @param {Array<{identifier: string, angle: number, completedAt: string}>} waypoints
 * @param {Array<{at: string}>} starChanges
 * @returns {Map<string, {x: number, y: number}>} identifier → position
 */
function derivePositions(waypoints, starChanges) {
  const placeable = waypoints.filter(wp => !!wp.completedAt);
  const breakBefore = computeBreakBefore(placeable, starChanges);

  const positions = new Map();
  let heading = null;
  let x = 0;
  let y = 0;

  for (let i = 0; i < placeable.length; i++) {
    const bearingAngle = placeable[i].angle;
    if (i === 0 || breakBefore[i]) {
      heading = bearingAngle;
      x = 0;
      y = 0;
    } else {
      heading = normalizeAngle(heading + clampTurn(shortestAngleDelta(bearingAngle, heading)));
    }
    const rad = (heading * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
    positions.set(placeable[i].identifier, { x, y });
  }

  return positions;
}

/**
 * Derive coverage: how many completed issues in the span were represented as
 * waypoints.
 *
 * completions — ALL completed issues (scored + never‑scored) whose
 *   completedAt falls within [span.oldest, span.newest].  Never‑scored
 *   completions are part of the coverage story and must be counted.
 *   When span is null (no reports), completions is 0.
 * ratio       — waypoints.length / completions, or null when completions === 0.
 * span        — passed through unchanged.
 *
 * @param {Array} waypoints
 * @param {Issue[]} issues
 * @param {{oldest: string, newest: string}|null} span
 * @returns {{completions: number, ratio: number|null, span: {oldest:string,newest:string}|null}}
 */
function deriveCoverage(waypoints, issues, span) {
  let completions = 0;

  if (span !== null) {
    for (const issue of issues) {
      if (issue.state?.type !== 'completed') continue;
      if (!issue.completedAt) continue;
      if (issue.completedAt >= span.oldest && issue.completedAt <= span.newest) {
        completions++;
      }
    }
  }

  // ratio can exceed 1: a waypoint's completedAt can fall after span.newest
  // (the task was a candidate in retained history but didn't complete until
  // after the newest retained report) — documented edge case, not a bug.
  // Do not clamp.
  const ratio = completions === 0 ? null : waypoints.length / completions;

  return { completions, ratio, span };
}

/**
 * Derive the cap‑dropped signal.
 *
 * atCapCount — count of RETAINED REPORTS (not candidates) whose
 *   orientation.length hit ORIENTATION_CANDIDATE_CAP.  Deliberately named
 *   to avoid any reading of it as a historical drop count.
 * message   — exact mandated sentence when atCapCount > 0, null otherwise.
 *             Never "at least N were dropped" — the drop count was never
 *             persisted and cannot be recovered.
 *
 * @param {number} atCapCount
 * @param {number} totalReports
 * @returns {{atCapCount: number, totalReports: number, message: string|null}}
 */
function deriveCapDropped(atCapCount, totalReports) {
  return {
    atCapCount,
    totalReports,
    message: atCapCount > 0 ? CAP_MESSAGE : null
  };
}

/**
 * Derive bearing histogram — a display‑only honesty signal over waypoints.
 * All 8 BEARINGS keys are always present, defaulting to 0.  Counted over
 * waypoints only (never over raw orientation candidates).
 *
 * This field is deliberately NOT used as a build/no‑build or degenerate‑path
 * gate — see LIN‑1684's own 2026‑07‑29 plan‑review resolution overriding the
 * stale parent‑ticket phrasing.
 *
 * @param {Array<{bearing: string}>} waypoints
 * @returns {Object}
 */
function deriveBearingHistogram(waypoints) {
  const histogram = {};
  for (const key of BEARINGS) {
    histogram[key] = 0;
  }
  for (const wp of waypoints) {
    if (Object.prototype.hasOwnProperty.call(histogram, wp.bearing)) {
      histogram[wp.bearing]++;
    }
  }
  return histogram;
}

// =============================================================================
// Exported entry point
// =============================================================================

/**
 * Derive a waypoint journey trail from report history and current issue data.
 *
 * Pure, network‑free, LLM‑free — every field derives from reports[].generatedAt,
 * issues[].completedAt, and the static BEARING_TO_ANGLE / ORIENTATION_CANDIDATE_CAP
 * tables.  No wall‑clock time is read anywhere in this module.
 *
 * @param {Object} params
 * @param {ReportRecord[]} params.reports — unsorted array of reports (the shape
 *        ReportHistoryStore.listFull() returns); sorted defensively internally.
 * @param {Issue[]} params.issues — plain array of canonical issue objects
 *        (the shape fetchWorkspaceIssues() returns); an identifier → issue map
 *        is built internally.
 * @returns {Object} { waypoints, coverage, capDropped, starChanges, bearingHistogram }
 *
 *         waypoints[]     { identifier, bearing, angle, completedAt, x?, y? }
 *                          ascending by completedAt. `x`/`y` are the
 *                          heading-inertia walk position (see
 *                          `derivePositions`) and are present only on
 *                          placeable waypoints (a truthy `completedAt`).
 *
 *         coverage        { completions, ratio, span }
 *         capDropped      { atCapCount, totalReports, message }
 *         starChanges[]   { from, to, at }
 *         bearingHistogram { N, NE, E, SE, S, SW, W, NW }
 */
export function deriveJourney({ reports, issues }) {
  const sorted = sortReportsChronological(reports);
  const issueIndex = buildIssueIndex(issues);

  const { candidateReadings, starChanges, atCapCount, span, totalReports } =
    walkReportHistory(sorted);

  const waypoints = deriveWaypoints(candidateReadings, issueIndex);
  const positions = derivePositions(waypoints, starChanges);
  const placedWaypoints = waypoints.map(wp => {
    const pos = positions.get(wp.identifier);
    return pos ? { ...wp, x: pos.x, y: pos.y } : { ...wp };
  });
  const coverage = deriveCoverage(placedWaypoints, issues, span);
  const capDropped = deriveCapDropped(atCapCount, totalReports);
  const bearingHistogram = deriveBearingHistogram(placedWaypoints);

  return { waypoints: placedWaypoints, coverage, capDropped, starChanges, bearingHistogram };
}
