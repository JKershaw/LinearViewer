/**
 * scripts/lin3014/lib/equivalence-core.mjs (LIN-3014)
 *
 * Pure comparison + row-classification helpers for the output-equivalence
 * sample (LIN-1021-style: deep-equal the lean path's output against today's
 * baseline on sampled rows). No Mongo connection lives here — `equivalence.mjs`
 * wires these to real collections/stores; this file is what the unit tests
 * exercise directly.
 *
 * Deliberately uses `assert.deepStrictEqual`, never a JSON round-trip
 * (`JSON.parse(JSON.stringify(x))`), which normalises away exactly the
 * differences this comparison exists to catch: a `Date` compares equal to
 * its own ISO string after a JSON round-trip, and an omitted key compares
 * equal to an explicit `undefined` (research beat 3, `299efc16`, step 7 A).
 */
import assert from 'node:assert';
import { isFreshDigest } from '../../../lib/digest-feedback.js';
import { findTerminalFeedback, feedbackWithHarvestedAbort } from '../../../lib/dispatch-terminal.js';
import { LOOP_EXEMPTIONS, SESSION_LOOP_EXEMPTIONS, stripPaths } from './exemptions.mjs';

/**
 * Compare a lean-path loop against the non-lean baseline, after stripping
 * the known-legitimate exemptions from both sides. Returns a result object
 * rather than throwing, so a caller can keep sampling past one mismatch and
 * report every failure instead of stopping at the first.
 *
 * @param {Object} leanLoop
 * @param {Object} baselineLoop
 * @param {Array<string>} [exemptions] - defaults to LOOP_EXEMPTIONS
 * @returns {{ equal: boolean, message?: string }}
 */
export function compareLoops(leanLoop, baselineLoop, exemptions = LOOP_EXEMPTIONS) {
  const leanStripped = stripPaths(leanLoop, exemptions);
  const baselineStripped = stripPaths(baselineLoop, exemptions);
  try {
    assert.deepStrictEqual(leanStripped, baselineStripped);
    return { equal: true };
  } catch (err) {
    return { equal: false, message: err.message };
  }
}

/**
 * The session-feed counterpart of `compareLoops`: sessions must be compared
 * against the PRE-DIGEST LEAN baseline (`feedback: []` on every loop, as at
 * `36425161` `lib/pipeline-loops.js:734`), never the non-lean baseline —
 * beat 3's correction (`299efc16`, step 7 point 3). Comparing against
 * non-lean would flag `telemetry`-derived session fields that have always
 * differed on a lean feed, for reasons unrelated to LIN-3011.
 *
 * Callers build `preDigestLeanSession` by taking a non-lean session and,
 * BEFORE re-assembling it, stripping each loop's `feedback`/`promptText` —
 * see `equivalence.mjs`'s use of `pipeline-loops.js`'s `__internal._buildSessions`.
 * Stripping those two fields only, pre-assembly, reproduces what
 * `buildSessionTelemetry` derived from a pre-digest lean feed; the remaining
 * legitimate differences are exemptions 3-5 (`toolPeak`, `telemetry.metrics`,
 * `lineageMetrics`), scoped under `loops[]` (`SESSION_LOOP_EXEMPTIONS`).
 *
 * @param {Object} leanSession
 * @param {Object} preDigestLeanSession
 * @param {Array<string>} [exemptions]
 */
export function compareSessions(leanSession, preDigestLeanSession, exemptions = SESSION_LOOP_EXEMPTIONS) {
  return compareLoops(leanSession, preDigestLeanSession, exemptions);
}

/**
 * `buildSessionCounts` equivalence: same issue -> count map, from the lean
 * and non-lean row sets. No exemptions apply — the count map has no
 * feedback-derived field, so it must be byte-for-byte identical (research
 * beat 3: "swipe buildSessionCounts: ... equal=true").
 */
export function compareSessionCounts(leanCounts, baselineCounts) {
  try {
    assert.deepStrictEqual(leanCounts, baselineCounts);
    return { equal: true };
  } catch (err) {
    return { equal: false, message: err.message };
  }
}

/**
 * True if `feedback`'s timestamps are non-decreasing (research beat 3, step
 * 7 C): the condition under which `lineageLastActivityMs` is PROVED equal
 * between lean and non-lean (the newest heartbeat is always among the last-6
 * retained). False means this row is a `lineageLastActivityMs` risk and
 * needs an explicit side-by-side check, not an assumption of equality.
 *
 * Mirrors the `$reduce` predicate in `measure.template.js` exactly, so the
 * production population count and this row-level screen agree by
 * construction.
 *
 * @param {Array<{timestamp: Date|string}>} feedback
 * @returns {boolean}
 */
export function hasNonDecreasingTimestamps(feedback) {
  if (!Array.isArray(feedback) || feedback.length === 0) return true;
  let prev = null;
  for (const entry of feedback) {
    const t = entry?.timestamp instanceof Date ? entry.timestamp : new Date(entry?.timestamp);
    if (prev !== null && t.getTime() < prev.getTime()) return false;
    prev = t;
  }
  return true;
}

/**
 * Classify a raw `dispatch-history` document into the V2/V3 populations the
 * plan requires the equivalence sample to cover by name: legacy rows,
 * just-healed rows, abort-harvest sources, and lineage members. Reuses the
 * app's own `isFreshDigest` (not a re-typed approximation) so this can never
 * silently drift from the freshness rule the app itself applies.
 *
 * @param {Object} doc - a raw `dispatch-history` row
 * @returns {{legacyUnhealed: boolean, healWritten: boolean, healedLegacy: boolean, abortSource: boolean, lineageMember: boolean, stale: boolean}}
 */
export function classifyRow(doc) {
  const hasVersion = doc?.feedbackVersion !== undefined && doc?.feedbackVersion !== null;
  const digest = doc?.feedbackDigest;
  const digestIsObject = digest !== null && typeof digest === 'object';

  return {
    // Never healed: no version counter, no digest at all.
    legacyUnhealed: !hasVersion && digest === undefined,
    // The self-heal write-back always stamps a digest with `.version` >= 0
    // (`_archiveItem` seeds `null`, not `{version:0}`) — so `.version === 0`
    // on a present digest object is the heal's own signature.
    healWritten: digestIsObject && digest.version === 0,
    // A legacy row that has just been healed: the write-back sets the
    // digest but never invents a `feedbackVersion` for a row that never had
    // one.
    healedLegacy: !hasVersion && digestIsObject,
    abortSource: doc?.abort === true,
    lineageMember: doc?.rootItemId != null,
    stale: !isFreshDigest(doc)
  };
}

/**
 * An abort row is never its own standalone loop — it carries no prompt and
 * exists only to harvest its `[aborted]` entry onto the TARGET loop named by
 * `abortTo` (`_harvestAbortedTargetsFromDigests`/`harvestAbortedTargets`).
 * Looking a sampled abort row up by its OWN `_id` in a loop-by-loopId map
 * always misses — on BOTH the lean and non-lean side equally, so that's not
 * a lean/non-lean divergence, just the wrong key. The abort-harvest
 * equivalence case is what the TARGET loop looks like with the abort
 * applied, so compare THAT loop's id instead.
 *
 * @param {Object} row - a raw dispatch-history document
 * @returns {string} the loopId to look up for this row's comparison
 */
export function comparisonKeyFor(row) {
  return row?.abort === true && row?.abortTo ? row.abortTo : row?._id;
}

/**
 * V2 abort-harvest population stats: every abort-harvest source and target
 * in `rows`, plus which of them are the required W1 sub-second case — a
 * target whose own genuine terminal comes BEFORE the abort, so the
 * harvested abort must win (review ledger L1(b), `2fa813e3`).
 *
 * Reuses the app's OWN append guard (`feedbackWithHarvestedAbort`,
 * `lib/dispatch-terminal.js`) to decide W1, rather than re-deriving the
 * timestamp comparison: that function returns the SAME array reference when
 * the abort does not outrank an existing terminal, and a NEW array when it
 * does — so identity tells us whether the target's own terminal predates
 * the abort, with zero chance of drifting from the app's real F1 rule.
 *
 * @param {Array<Object>} rows - raw `dispatch-history` documents, each with
 *   `_id` and (for abort sources) `abort`/`abortTo`/`feedback`
 * @returns {{ sourceCount: number, targetCount: number, w1Cases: Array<{sourceId: *, targetId: *}> }}
 */
export function computeAbortHarvestStats(rows) {
  const byId = new Map((rows || []).map((r) => [String(r?._id), r]));
  const sources = (rows || []).filter((r) => r?.abort === true && r?.abortTo != null);
  const targetIds = new Set(sources.map((r) => String(r.abortTo)));
  const w1Cases = [];

  for (const source of sources) {
    const target = byId.get(String(source.abortTo));
    if (!target) continue;
    const abortTerminal = findTerminalFeedback(Array.isArray(source.feedback) ? source.feedback : []);
    if (!abortTerminal || abortTerminal.status !== 'aborted') continue;
    const targetFeedback = Array.isArray(target.feedback) ? target.feedback : [];
    const merged = feedbackWithHarvestedAbort(targetFeedback, abortTerminal.entry);
    // `merged` is a NEW array only when the abort was appended — i.e. only
    // when it outranked (postdates) an existing genuine terminal on target.
    if (merged !== targetFeedback) {
      w1Cases.push({ sourceId: source._id, targetId: source.abortTo });
    }
  }

  return { sourceCount: sources.length, targetCount: targetIds.size, w1Cases };
}

/**
 * Pick a bounded sample that's guaranteed to cover the named classes the
 * plan requires (abort-harvest, lineage, >=1 legacy row, >=1 just-healed
 * row) wherever the population has them, plus enough of the rest to reach
 * `targetSize`. Rows the population doesn't have (e.g. no legacy row left in
 * the window) are reported as missing, never silently skipped — no estimate
 * stands in for a measurement that didn't happen.
 *
 * @param {Array<Object>} docs - raw `dispatch-history` rows, each with `_id`
 * @param {Object} [opts]
 * @param {number} [opts.targetSize]
 * @returns {{ sample: Array<Object>, coverage: Object<string, boolean>, missing: Array<string> }}
 */
export function selectSample(docs, { targetSize = 20 } = {}) {
  const classified = docs.map((doc) => ({ doc, classes: classifyRow(doc) }));
  const wanted = [
    ['legacyUnhealed', 'legacy row'],
    ['healWritten', 'just-healed row'],
    ['abortSource', 'abort-harvest source'],
    ['lineageMember', 'lineage member']
  ];

  const picked = new Map();
  const coverage = {};
  const missing = [];

  for (const [key, description] of wanted) {
    const hit = classified.find((row) => row.classes[key]);
    coverage[key] = !!hit;
    if (hit) picked.set(hit.doc._id, hit.doc);
    else missing.push(description);
  }

  for (const row of classified) {
    if (picked.size >= targetSize) break;
    picked.set(row.doc._id, row.doc);
  }

  return { sample: Array.from(picked.values()), coverage, missing };
}
