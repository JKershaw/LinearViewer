// The census seed: the deterministic text the Flight Companion turn is seeded with
// (moved byte for byte out of routes/flight-companion.js, LIN-3717; routes/flight-companion.js
// re-exports `buildCensusSeedText`).
import { buildCompanionSnapshot } from './flight-companion-gate.js';
import { renderStaleAttentionLine } from './prompts/flight-companion-brief.js';

// Restated, not imported, from lib/flight-companion-gate.js's own private
// LANE_KEYS (which itself restates lib/observer-sweep.js's LANE_KEYS) — same
// house convention its header documents: each consumer of the 7-lane census
// vocabulary restates it rather than sharing a cross-module import.
const CENSUS_LANE_KEYS = ['working', 'silent', 'blocked', 'terminal', 'queued', 'resolved', 'unknown'];

/**
 * §A.7: the deterministic census seed, built from the SAME raw sweep census
 * doc (`sweep:v1:<urlKey>`, via `buildCompanionSnapshot`) the auto-wake gate
 * already reads. Every number below is interpolated straight from the
 * snapshot with no rounding/reformatting/recomputation — copied verbatim, so
 * a caller diffing this text against `buildCompanionSnapshot`'s own output
 * finds the exact same values. The model is told explicitly to treat these as
 * ground truth and narrate, never recompute or restate them differently; it
 * can reach for `list_task_sessions`/`get_session` (via its tool catalog) for
 * depth beyond these counts — never a `/api/dashboard/*` poll, which a
 * proxy-token session can't reach anyway and which this builder must not add.
 *
 * @param {Object|null} currentCensusDoc - `observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s
 *   result, or `null` when no sweep has ever run for this workspace.
 * @returns {string}
 */
// Exported for direct unit testing of the verbatim guarantee (LIN-2432 §A.7),
// and now also because `buildFlightCompanionMessages` reads it from another
// module. LIN-2618 RETIRES this note's former second half ("no premature
// lib/prompts/ extraction", beat-2 feedback): the builder has moved to
// `lib/prompts/flight-companion-brief.js`.
// The seed lives here in lib/flight-companion-census-seed.js, beside
// lib/flight-companion-gate.js: its counts are `buildCompanionSnapshot`'s output
// verbatim. LIN-2631 moved the turn's census read into lib/agent-turn.js, which
// receives this builder from its callers. LIN-3717 moved it out of
// routes/flight-companion.js, which re-exports it.
export function buildCensusSeedText(currentCensusDoc) {
  if (!currentCensusDoc) {
    return 'CURRENT CENSUS: not available yet for this workspace (no sweep has run).';
  }
  // This filter is for RENDERING HONESTY, not crash avoidance (LIN-2661 made
  // `buildCompanionSnapshot` itself safe against a null/undefined row — see
  // `isWellFormedAttentionRow`, `lib/flight-companion-gate.js:280` — so
  // feeding it the raw `currentCensusDoc` directly, below, is no longer a
  // hazard). It stays because it serves an independent purpose: this builder
  // reads `since`/`issue` straight off these rows for `attentionLines` below,
  // fields the snapshot's identity-tuple projection deliberately drops
  // (`lib/flight-companion-gate.js:360`), and a row with no `loopId` cannot be
  // drilled into or shown honestly to a human — it is dropped outright rather
  // than rendered as a half-row. The bar here is deliberately LOOSER than the
  // gate's own well-formed-ROW criterion (`loopId`+`lane`+`stage`,
  // `isWellFormedAttentionRow`, `lib/flight-companion-gate.js:280`): a row with
  // an id but no `lane`/`stage` still renders here, honestly labelled, even
  // though the gate excludes it from its own identity-tuple accounting.
  const attention = (Array.isArray(currentCensusDoc.state?.attention) ? currentCensusDoc.state.attention : [])
    .filter((row) => row && typeof row === 'object' && row.loopId);
  const snapshot = buildCompanionSnapshot(currentCensusDoc);
  const laneLines = CENSUS_LANE_KEYS.map((key) => `  ${key}: ${snapshot.lanes[key]}`).join('\n');

  // LIN-2617: the ROWS, not just the count. Read straight off the census doc's
  // own `state.attention` (written by lib/observer-sweep.js:161-170), copied
  // field-for-field under the same no-recompute discipline the counts above
  // already carry — never re-sorted, re-dated or re-derived here.
  //
  // Deliberately NOT `buildCompanionSnapshot`'s `attentionKeys`: that projection
  // drops `since` on purpose (lib/flight-companion-gate.js:360), because it
  // moves on every heartbeat and would defeat the gate's own identity
  // comparison. The gate needs the identity tuple; the model needs the age.
  // The sweep already applies ATTENTION_CAP before storing, so the stored array
  // is bounded and `truncated` says whether it was cut.
  // Every remaining field is defended too: this document is persisted store
  // state read back at turn time, so a row written by an older sweep revision
  // can be partial, and rendering the literal string "undefined" inside a block
  // the prompt calls ground truth is worse than saying "unknown".
  const attentionLines = attention.map(
    (row) => `  - ${row.issue || '(no task)'} · ${row.lane || 'unknown lane'} · stage ${row.stage || 'unknown'}` +
      ` · since ${row.since || 'unknown'} · loop ${row.loopId}`
  );

  // The header count is computed from THIS builder's own filtered `attention`
  // array (loopId-present criterion), not `snapshot.attentionCount`
  // (loopId+lane+stage, LIN-2661) — a deliberate, permanent divergence, not a
  // bug to reconcile later. `snapshot.attentionCount` only counts rows the
  // gate trusts as identity-tuples for its own no-delta diff; this header
  // must count the SAME set as `attentionLines` above so the header and the
  // rendered rows never disagree (the invariant at
  // `tests/unit/flight-companion-turn-route.test.js:982-984`). The two predicates
  // can differ in both directions: a row with an id but no `lane`/`stage`
  // renders here (counted in the header) but is excluded from the gate's own
  // `attentionCount`; conversely a falsy-but-present `loopId` (e.g. `''`) is
  // dropped by this builder's truthiness filter but kept by the gate's `!= null`
  // check, so the gate's count can exceed the header's. No producer emits
  // that second case today, and it is harmless either way since this header
  // is compared only against this builder's own rows, never against the gate's
  // count. Do NOT "fix" the two numbers back into agreement: doing so either
  // re-admits an unsanitized tuple into the gate's identity diff, or deletes
  // the tested honest-partial-row rendering at
  // `tests/unit/flight-companion-turn-route.test.js:979`.
  const lines = [
    'CURRENT CENSUS (authoritative — these numbers are ground truth; narrate them, never recompute or restate them differently):',
    laneLines,
    `  attention items: ${attention.length}${snapshot.truncated ? ' (list truncated)' : ''}`,
  ];
  if (attentionLines.length) {
    lines.push('ATTENTION ROWS (each is a real run — name the task, never just the count):', ...attentionLines);
  }

  // LIN-2619's fossil fold, rendered through the SHARED helper so this line and
  // the instruction the brief teaches (COMPANION_FOSSIL_READOUT, carried
  // byte-identically into the pasted kickoff) cannot drift apart. #1399 landed
  // the count alone, without its threshold; LIN-2619's review ledger item 5 asks
  // for both, because "313 fossil rows" and "313 rows older than 7d" are
  // different claims and only the second is actionable.
  const staleLine = renderStaleAttentionLine(
    currentCensusDoc.state?.staleAttentionCount,
    currentCensusDoc.state?.staleAttentionThresholdMs
  );
  if (staleLine) lines.push(staleLine);

  lines.push(
    `  census revision: ${snapshot.censusRev}`,
    // The vocabulary line (plan-review 2617-F1). The model wrote "2,197 tasks
    // terminal" on 2026-09-05 because nothing here told it what a lane counts:
    // `buildSweepPayload` tallies one lane per LOOP (lib/observer-sweep.js:132-157)
    // and `classifyLoop` classifies one Loop (:70), while a session spans several
    // loops and a task can span several sessions.
    'VOCABULARY: these lanes count dispatch loops (runs) — not sessions (one session spans several loops) and not tasks. ' +
      '"silent" and "terminal" include historical bookkeeping. "blocked" means parked waiting on a human: alive, not dead.',
  );
  return lines.join('\n');
}
