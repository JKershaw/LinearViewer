/**
 * Unit tests for the fossil pass's SELECTION logic
 * (`scripts/fossil-pass-lin2633.js`, LIN-2653 S1 of LIN-2633).
 *
 * Pure and fixture-based — no database at all. Revision 2 of the approved plan
 * moved selection out of the store and into the script, so the logic under
 * test here is plain functions over Loop-record fixtures; only the narrow
 * single-row write still needs a real MangoDB tmpdir (see
 * tests/unit/dispatch-store-bookkeeping.test.js).
 *
 * Fixtures are built through `__internal._buildLoops` with real marker text,
 * NEVER hand-built Loop literals — the same discipline
 * tests/unit/observer-sweep.test.js states for its own classification section,
 * and the reason these tests can be trusted about `loopLastActivityMs` /
 * `lineageLastActivityMs` / `feedback[]`, all of which are DERIVED fields a
 * hand-built literal would let us fake into agreement.
 *
 * Coverage: T1 (age gate), T3 (lineage-alive), T4 (live queue sibling),
 * T5 (terminal), T6 (cancelled/expired), T7 (exact boundary, strict >),
 * T10 (a failed/inconclusive liveness read leaves the row unstamped),
 * and the F3 gate (silent by heartbeats, recent by raw feedback).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { __internal } from '../../lib/pipeline-loops.js';
import { FOSSIL_AGE_MS, classifyLoop } from '../../lib/observer-sweep.js';
import { computeSupersededLoopIds } from '../../lib/loop-supersede.js';
import { loopLastActivityMs, DEFAULT_LANE_STALE_MS } from '../../lib/live-console.js';
import {
  selectFossilRows,
  isProvenSilent,
  ownRawLastActivityMs,
  hasLiveSessionGroupSibling,
  epochMs,
  bucketForAge,
  AGE_BUCKETS
} from '../../scripts/fossil-pass-lin2633.js';

const { _buildLoops } = __internal;

const NOW = new Date('2026-09-05T12:00:00.000Z');
const NOW_MS = NOW.getTime();

// Ages expressed against the IMPORTED constant, never a local literal — a
// local `7 * 24 * 60 * 60 * 1000` here would keep passing if the script
// redefined FOSSIL_AGE_MS, which is exactly the mutation T1 must catch.
const daysAgo = (d) => new Date(NOW_MS - d * 24 * 60 * 60 * 1000).toISOString();
const msAgo = (ms) => new Date(NOW_MS - ms).toISOString();

let idCounter = 0;

function historyItem(overrides = {}) {
  return {
    id: `hist-${idCounter++}`,
    promptName: 'implementation',
    prompt: 'implementation prompt text',
    issueId: 'uuid-1',
    issueIdentifier: `LIN-${900 + (idCounter % 90)}`,
    issueTitle: 'Issue',
    issueUrl: 'https://linear.app/x/issue/LIN-900',
    workspace: { urlKey: 'ws' },
    dispatchedAt: daysAgo(20),
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: daysAgo(20),
    takenByTokenLabel: 'consumer-1',
    feedback: [],
    ...overrides
  };
}

function liveItem(overrides = {}) {
  return {
    id: `live-${idCounter++}`,
    promptName: 'plan',
    prompt: 'plan prompt text',
    issueId: 'uuid-2',
    issueIdentifier: 'LIN-800',
    issueTitle: 'Issue',
    issueUrl: 'https://linear.app/x/issue/LIN-800',
    workspace: { urlKey: 'ws' },
    dispatchedAt: daysAgo(1),
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    expiresAt: msAgo(-86400000),
    ...overrides
  };
}

// Build one workspace's non-lean loops (lean: false is the production read —
// gate 3 needs raw feedback[]).
function build({ historyItems = [], liveItems = [], agentStatusEntries = [] } = {}) {
  return _buildLoops({ historyItems, liveItems, agentStatusEntries, now: NOW });
}

function select(loops) {
  return selectFossilRows({ loops, now: NOW_MS });
}

const eligibleIds = (loops) => select(loops).eligible.map((r) => r.loopId).sort();
const reasonFor = (loops, loopId) => select(loops).skipped.find((s) => s.loopId === loopId)?.reason;

// ─── T1: the age gate ──────────────────────────────────────────────────────

describe('fossil pass T1 — the age gate', () => {
  test('a 3-day-silent row is NOT selected; an 8-day-silent row IS', () => {
    const fresh = historyItem({ id: 'h-3d', dispatchedAt: daysAgo(3), resolvedAt: daysAgo(3) });
    const fossil = historyItem({ id: 'h-8d', dispatchedAt: daysAgo(8), resolvedAt: daysAgo(8) });
    const loops = build({ historyItems: [fresh, fossil] });

    assert.deepEqual(eligibleIds(loops), ['h-8d'], 'only the row past the threshold is eligible');
    assert.equal(reasonFor(loops, 'h-3d'), 'own-row-recent-activity', 'the fresh row is refused on its own activity');
  });

  test('the age gate is load-bearing on its OWN: a row gate 3 would pass is still refused by gate 2', () => {
    // The 3-day row above is refused by gate 2 AND gate 3 alike (with no
    // feedback, both clocks reduce to `dispatchedAt`), so it cannot witness
    // gate 2 by itself — dropping gate 2 would leave it refused anyway. This
    // row separates them: its own raw feedback is 12 days old, so GATE 3
    // PASSES it, but an agent-status decoration a day ago feeds
    // `loopLastActivityMs` (and not gate 3), so only gate 2 can refuse it.
    const row = historyItem({
      id: 'h-agent-fresh', issueIdentifier: 'LIN-905',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      feedback: [{ message: '[working] 2 tools/9s · alive', timestamp: daysAgo(12) }]
    });
    const recentAgentStatus = {
      id: 'fmn-fresh',
      taskIdentifier: 'LIN-905',
      dispatchId: 'h-agent-fresh',
      action: 'implementation',
      status: 'in-progress',
      summary: 'still going',
      timestamp: daysAgo(1)
    };
    const loops = build({ historyItems: [row], agentStatusEntries: [recentAgentStatus] });

    assert.ok(
      NOW_MS - ownRawLastActivityMs(loops[0]) > FOSSIL_AGE_MS,
      'sanity: gate 3 alone would admit this row — its own raw feedback is ancient'
    );
    assert.ok(
      NOW_MS - loopLastActivityMs(loops[0]) < FOSSIL_AGE_MS,
      'sanity: but gate 2 sees the recent agent-status decoration'
    );
    assert.deepEqual(eligibleIds(loops), [], 'the age gate must refuse it on its own');
  });

  test('the cutoff is the IMPORTED FOSSIL_AGE_MS, not a local literal — a row just past it is selected, just inside it is not', () => {
    // Expressed purely in terms of the imported constant: if the script
    // redefined it (say to 30 days), the "just past" row would stop being
    // selected and this test would die. A local literal here could not tell.
    const justPast = historyItem({
      id: 'h-just-past',
      dispatchedAt: msAgo(FOSSIL_AGE_MS + 60_000),
      resolvedAt: msAgo(FOSSIL_AGE_MS + 60_000)
    });
    const justInside = historyItem({
      id: 'h-just-inside',
      dispatchedAt: msAgo(FOSSIL_AGE_MS - 60_000),
      resolvedAt: msAgo(FOSSIL_AGE_MS - 60_000)
    });
    const loops = build({ historyItems: [justPast, justInside] });

    assert.deepEqual(eligibleIds(loops), ['h-just-past']);
  });
});

// ─── T7: the exact boundary, strict > ──────────────────────────────────────

describe('fossil pass T7 — the exact FOSSIL_AGE_MS boundary is strict >', () => {
  test('a row at EXACTLY FOSSIL_AGE_MS is excluded (matching buildSweepPayload:271)', () => {
    const exact = historyItem({
      id: 'h-exact',
      dispatchedAt: msAgo(FOSSIL_AGE_MS),
      resolvedAt: msAgo(FOSSIL_AGE_MS)
    });
    const loops = build({ historyItems: [exact] });

    // Sanity: the fixture really does sit on the boundary, so this is a
    // boundary test rather than an accidentally-fresh row.
    assert.equal(
      NOW_MS - loopLastActivityMs(loops[0]), FOSSIL_AGE_MS,
      'sanity: the row sits exactly on the threshold'
    );
    assert.deepEqual(eligibleIds(loops), [], 'strict > means exactly-at-threshold is NOT past it');
    assert.equal(isProvenSilent(loops[0], NOW_MS).silent, false);

    // One millisecond older flips it — proving the assertion above is about
    // the boundary and not about some unrelated refusal.
    const oneMsOlder = historyItem({
      id: 'h-1ms-past',
      dispatchedAt: msAgo(FOSSIL_AGE_MS + 1),
      resolvedAt: msAgo(FOSSIL_AGE_MS + 1)
    });
    assert.deepEqual(eligibleIds(build({ historyItems: [oneMsOlder] })), ['h-1ms-past']);
  });
});

// ─── T3: lineage-alive ─────────────────────────────────────────────────────

describe('fossil pass T3 — a lineage-alive row is never stamped', () => {
  test('a row silent 10 days whose lineage sibling heartbeated an HOUR ago is excluded (via the lane gate — a fresh lineage reads `working`)', () => {
    // Lineage is stitched on `rootItemId ?? loopId`
    // (lib/pipeline-loops.js:664) — NOT sessionGroupId — and
    // lineageLastActivityMs is parsed from the SIBLING's heartbeat feedback.
    // That derivation is exactly why this goes through _buildLoops rather
    // than hand-setting the field: a literal could fake agreement.
    const fossil = historyItem({
      id: 'h-lineage-old', issueIdentifier: 'LIN-910', rootItemId: 'root-1',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10),
      feedback: [{ message: '[working] 4 tools/20s · alive', timestamp: daysAgo(10) }]
    });
    const liveSibling = historyItem({
      id: 'h-lineage-fresh', issueIdentifier: 'LIN-911', rootItemId: 'root-1',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10),
      feedback: [{ message: '[working] 9 tools/44s · alive', timestamp: msAgo(60 * 60 * 1000) }]
    });
    const loops = build({ historyItems: [fossil, liveSibling] });

    const fossilLoop = loops.find((l) => l.loopId === 'h-lineage-old');
    assert.ok(
      Number.isFinite(fossilLoop.lineageLastActivityMs),
      'sanity: the lineage clock really is populated for this row — otherwise the gate could not fire'
    );
    assert.ok(
      NOW_MS - fossilLoop.lineageLastActivityMs < FOSSIL_AGE_MS,
      'sanity: and it is inside the threshold'
    );

    assert.ok(!eligibleIds(loops).includes('h-lineage-old'), 'a row whose lineage is alive must never be stamped');
    // Attributed to the LANE gate, not to gate 2: a lineage heartbeat an hour
    // ago is inside DEFAULT_LANE_STALE_MS, so `loopLastActivityMs` — which
    // folds the lineage component in — makes `isFreshlyActive` true and the
    // row classifies `working`. It is refused before gate 2 is even reached.
    // Two independent guards then, arranged front to back; the next test
    // covers the window where gate 2 is the one that fires.
    assert.equal(reasonFor(loops, 'h-lineage-old'), 'not-silent-or-blocked');
  });

  test('a row whose lineage sibling heartbeated 2 DAYS ago is excluded by GATE 2, attributed to the lineage', () => {
    // The window that makes gate 2's lineage attribution reachable: older
    // than DEFAULT_LANE_STALE_MS (1h, so the lane is `silent`, not `working`)
    // but newer than FOSSIL_AGE_MS (7d, so the row is not a fossil). This is
    // the case the plan's T3 is really about — a lineage that is quiet but
    // demonstrably not dead.
    const fossil = historyItem({
      id: 'h-lineage-2d-old', issueIdentifier: 'LIN-915', rootItemId: 'root-3',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10),
      feedback: [{ message: '[working] 4 tools/20s · alive', timestamp: daysAgo(10) }]
    });
    const sibling = historyItem({
      id: 'h-lineage-2d-fresh', issueIdentifier: 'LIN-916', rootItemId: 'root-3',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10),
      feedback: [{ message: '[working] 9 tools/44s · alive', timestamp: daysAgo(2) }]
    });
    const loops = build({ historyItems: [fossil, sibling] });
    const fossilLoop = loops.find((l) => l.loopId === 'h-lineage-2d-old');

    const ageOfLineage = NOW_MS - fossilLoop.lineageLastActivityMs;
    assert.ok(ageOfLineage > DEFAULT_LANE_STALE_MS, 'sanity: past the lane-stale threshold, so the lane is silent not working');
    assert.ok(ageOfLineage < FOSSIL_AGE_MS, 'sanity: but inside the fossil threshold, so the lineage is not dead');
    assert.equal(
      classifyLoop(fossilLoop, { superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: DEFAULT_LANE_STALE_MS }),
      'silent',
      'sanity: it really does reach the lane gate as a selected lane'
    );

    assert.ok(!eligibleIds(loops).includes('h-lineage-2d-old'), 'a quiet-but-alive lineage must still block the stamp');
    assert.equal(reasonFor(loops, 'h-lineage-2d-old'), 'lineage-alive', 'and gate 2 attributes it to the lineage, not to its own activity');

    // The witness that this is really about the lineage: the row's OWN
    // signals alone are well past the threshold.
    const ownOnly = loopLastActivityMs({ ...fossilLoop, lineageLastActivityMs: null });
    assert.ok(NOW_MS - ownOnly > FOSSIL_AGE_MS, 'its own activity is ancient — only the lineage keeps it alive');
  });

  test('control: the SAME row with no fresh lineage sibling IS selected', () => {
    const fossil = historyItem({
      id: 'h-lineage-solo', issueIdentifier: 'LIN-912', rootItemId: 'root-2',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10),
      feedback: [{ message: '[working] 4 tools/20s · alive', timestamp: daysAgo(10) }]
    });
    assert.deepEqual(eligibleIds(build({ historyItems: [fossil] })), ['h-lineage-solo']);
  });

  test('lineageLastActivityMs === null is INERT — neither a free pass nor a blanket refusal', () => {
    // A lineage that never parsed a heartbeat contributes nothing to
    // Math.max. The row is then judged on its OWN signals: old own-activity
    // is selected, recent own-activity is not.
    const oldOwn = historyItem({
      id: 'h-nulllin-old', issueIdentifier: 'LIN-913',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10)
    });
    const recentOwn = historyItem({
      id: 'h-nulllin-recent', issueIdentifier: 'LIN-914',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10),
      feedback: [{ message: '[blocked] need a decision', timestamp: msAgo(2 * 60 * 60 * 1000) }]
    });

    const oldLoops = build({ historyItems: [oldOwn] });
    assert.equal(oldLoops[0].lineageLastActivityMs, null, 'sanity: no lineage heartbeat was ever parsed');
    assert.deepEqual(eligibleIds(oldLoops), ['h-nulllin-old'], 'null lineage is not a blanket refusal');

    const recentLoops = build({ historyItems: [recentOwn] });
    assert.equal(recentLoops[0].lineageLastActivityMs, null, 'sanity: same null lineage');
    assert.deepEqual(eligibleIds(recentLoops), [], 'null lineage is not a free pass either');
  });
});

// ─── The F3 gate: silent by heartbeats, recent by raw feedback ─────────────

describe('fossil pass F3 gate — the row\'s own raw, unfiltered feedback', () => {
  test('a row whose heartbeat clock is 10 days stale but whose OWN feedback carries a [blocked] 2 hours ago is NOT selected', () => {
    // This is the gap gate 2 cannot see: parseHeartbeats filters to
    // heartbeat-shaped messages, so a [blocked] marker contributes nothing to
    // telemetry.metrics or to a sibling's lineage clock.
    const row = historyItem({
      id: 'h-f3-blocked', issueIdentifier: 'LIN-920',
      dispatchedAt: daysAgo(10), resolvedAt: daysAgo(10),
      feedback: [
        { message: '[working] 3 tools/12s · alive', timestamp: daysAgo(10) },
        { message: '[blocked] need a decision on the auth flow', timestamp: msAgo(2 * 60 * 60 * 1000) }
      ]
    });
    const loops = build({ historyItems: [row] });

    // Sanity: gate 2 ALONE would have allowed this row through — that is what
    // makes gate 3 load-bearing rather than redundant.
    assert.ok(
      NOW_MS - loopLastActivityMs(loops[0]) > FOSSIL_AGE_MS,
      'sanity: the heartbeat-based clock alone reads this row as ancient'
    );
    assert.ok(
      NOW_MS - ownRawLastActivityMs(loops[0]) < FOSSIL_AGE_MS,
      'sanity: but its own RAW feedback carries activity inside the threshold'
    );

    assert.deepEqual(eligibleIds(loops), [], 'the F3 gate must refuse it');
    assert.equal(reasonFor(loops, 'h-f3-blocked'), 'own-row-recent-activity');
  });

  test('a recent DECISION entry (kind: decision, skipped by parseHeartbeats) also refuses the row', () => {
    const row = historyItem({
      id: 'h-f3-decision', issueIdentifier: 'LIN-921',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      feedback: [
        { message: '[working] 3 tools/12s · alive', timestamp: daysAgo(12) },
        { message: '[decision] which auth flow?', kind: 'decision', timestamp: msAgo(3 * 60 * 60 * 1000) }
      ]
    });
    const loops = build({ historyItems: [row] });

    assert.ok(NOW_MS - loopLastActivityMs(loops[0]) > FOSSIL_AGE_MS, 'sanity: invisible to the heartbeat clock');
    assert.deepEqual(eligibleIds(loops), [], 'any feedback kind counts for gate 3, not just heartbeats');
  });

  test('a recent [evidence] entry also refuses the row', () => {
    const row = historyItem({
      id: 'h-f3-evidence', issueIdentifier: 'LIN-922',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      feedback: [
        { message: '[working] 3 tools/12s · alive', timestamp: daysAgo(12) },
        { message: '[evidence] PR opened · https://example.com/pr/1', timestamp: msAgo(4 * 60 * 60 * 1000) }
      ]
    });
    assert.deepEqual(eligibleIds(build({ historyItems: [row] })), []);
  });

  test('control: the same row with its non-heartbeat activity ALSO past the threshold IS selected', () => {
    const row = historyItem({
      id: 'h-f3-old', issueIdentifier: 'LIN-923',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      feedback: [
        { message: '[working] 3 tools/12s · alive', timestamp: daysAgo(12) },
        { message: '[blocked] need a decision on the auth flow', timestamp: daysAgo(9) }
      ]
    });
    assert.deepEqual(eligibleIds(build({ historyItems: [row] })), ['h-f3-old']);
  });

  test('gate 3 can only SHRINK the eligible set relative to gate 2 alone (it cannot reopen F1)', () => {
    // Property check over a mixed fixture: every row gate 3 admits was
    // already admitted by gate 2, so the eligible set is a subset of the
    // gate-2-only set — never a superset.
    const rows = [
      historyItem({ id: 'p-1', issueIdentifier: 'LIN-930', dispatchedAt: daysAgo(9), resolvedAt: daysAgo(9) }),
      historyItem({
        id: 'p-2', issueIdentifier: 'LIN-931', dispatchedAt: daysAgo(9), resolvedAt: daysAgo(9),
        feedback: [{ message: '[blocked] fresh', timestamp: msAgo(60 * 60 * 1000) }]
      }),
      historyItem({ id: 'p-3', issueIdentifier: 'LIN-932', dispatchedAt: daysAgo(2), resolvedAt: daysAgo(2) }),
      historyItem({
        id: 'p-4', issueIdentifier: 'LIN-933', dispatchedAt: daysAgo(20), resolvedAt: daysAgo(20),
        feedback: [{ message: '[working] 1 tools/2s · alive', timestamp: daysAgo(19) }]
      })
    ];
    const loops = build({ historyItems: rows });
    const gate2Only = loops
      .filter((l) => NOW_MS - loopLastActivityMs(l) > FOSSIL_AGE_MS)
      .map((l) => l.loopId);
    const selected = eligibleIds(loops);

    for (const id of selected) {
      assert.ok(gate2Only.includes(id), `${id} was selected but would NOT have passed gate 2 alone — gate 3 must never grow the set`);
    }
    assert.ok(selected.length < gate2Only.length, 'and on this fixture it genuinely does shrink it');
  });
});

// ─── T4: a live queue sibling ──────────────────────────────────────────────

describe('fossil pass T4 — a row with a live queue sibling is never stamped', () => {
  test('a fossil sharing sessionGroupId with a still-QUEUED (source: live) row is excluded', () => {
    const fossil = historyItem({
      id: 'h-sib-fossil', issueIdentifier: 'LIN-940', sessionGroupId: 'grp-live',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12)
    });
    const queuedSibling = liveItem({
      id: 'l-sib-queued', issueIdentifier: 'LIN-941', sessionGroupId: 'grp-live'
    });
    const loops = build({ historyItems: [fossil], liveItems: [queuedSibling] });

    const fossilLoop = loops.find((l) => l.loopId === 'h-sib-fossil');
    assert.ok(hasLiveSessionGroupSibling(fossilLoop, loops), 'sanity: the scan sees the queued sibling');
    assert.ok(!eligibleIds(loops).includes('h-sib-fossil'));
    assert.equal(reasonFor(loops, 'h-sib-fossil'), 'live-session-group-sibling');
  });

  test('control: the same fossil with no queued sibling IS selected', () => {
    const fossil = historyItem({
      id: 'h-sib-solo', issueIdentifier: 'LIN-942', sessionGroupId: 'grp-dead',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12)
    });
    assert.deepEqual(eligibleIds(build({ historyItems: [fossil] })), ['h-sib-solo']);
  });

  test('a followUpTo successor excludes the row too — via an EXPLICIT superseded check, because classifyLoop alone does not', () => {
    const original = historyItem({
      id: 'h-superseded', issueIdentifier: 'LIN-943',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      feedback: [{ message: '[blocked] need a decision', timestamp: daysAgo(12) }]
    });
    const followUp = historyItem({
      id: 'h-successor', issueIdentifier: 'LIN-944', followUpTo: 'h-superseded',
      dispatchedAt: daysAgo(1), resolvedAt: daysAgo(1),
      feedback: [{ message: '[done] resumed and finished', timestamp: daysAgo(1) }]
    });
    const loops = build({ historyItems: [original, followUp] });

    // NOT via classifyLoop, contrary to the plan's settled design call 2: a
    // superseded blocked row classifies `silent` (pinned independently by
    // tests/unit/observer-sweep.test.js:341), which is a SELECTED lane. The
    // script therefore carries an explicit `superseded.has(loopId)` check;
    // without it this row would be stamped. See the comment at that check.
    assert.equal(
      classifyLoop(loops.find((l) => l.loopId === 'h-superseded'), {
        superseded: computeSupersededLoopIds(loops), now: NOW_MS, staleMs: DEFAULT_LANE_STALE_MS
      }),
      'silent',
      'the plan claimed `unknown` here; it is `silent`, which is why the explicit check is needed'
    );
    assert.ok(!eligibleIds(loops).includes('h-superseded'), 'a row answered by a follow-up must never be stamped');
    assert.equal(reasonFor(loops, 'h-superseded'), 'superseded-by-follow-up');
  });

  test('null sessionGroupId matches no sibling (the chosen N3 semantics), and such a row is still judged on gates 2 and 3', () => {
    const legacyFossil = historyItem({
      id: 'h-nogroup', issueIdentifier: 'LIN-945', sessionGroupId: null,
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12)
    });
    const legacyQueued = liveItem({ id: 'l-nogroup', issueIdentifier: 'LIN-946', sessionGroupId: null });
    const loops = build({ historyItems: [legacyFossil], liveItems: [legacyQueued] });

    const fossilLoop = loops.find((l) => l.loopId === 'h-nogroup');
    assert.equal(hasLiveSessionGroupSibling(fossilLoop, loops), false, 'a null group id is not a wildcard');
    assert.deepEqual(eligibleIds(loops), ['h-nogroup']);
  });
});

// ─── T5 / T6: terminal and already-resolved rows ───────────────────────────

describe('fossil pass T5 — a terminal row is never stamped', () => {
  test('a [done]-10-days-ago row is excluded and attributed to terminal', () => {
    const done = historyItem({
      id: 'h-done', issueIdentifier: 'LIN-950',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      feedback: [{ message: '[done] shipped', timestamp: daysAgo(10) }]
    });
    const loops = build({ historyItems: [done] });

    assert.equal(loops[0].terminalStatus, 'done', 'sanity: the row really is terminal');
    assert.deepEqual(eligibleIds(loops), []);
    assert.equal(reasonFor(loops, 'h-done'), 'terminal');
  });

  test('[failed] and [aborted] are terminal too', () => {
    for (const marker of ['[failed] gave up', '[aborted] cancelled mid-run']) {
      const row = historyItem({
        id: `h-term-${marker.slice(1, 5)}`, issueIdentifier: 'LIN-951',
        dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
        feedback: [{ message: marker, timestamp: daysAgo(10) }]
      });
      const loops = build({ historyItems: [row] });
      assert.deepEqual(eligibleIds(loops), [], `${marker} must never be stamped`);
    }
  });
});

describe('fossil pass T6 — cancelled/expired rows are never selected', () => {
  test('a cancelled row and an expired row are both excluded as not-taken', () => {
    const cancelled = historyItem({
      id: 'h-cancelled', issueIdentifier: 'LIN-960', status: 'cancelled',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      feedback: [{ message: '[blocked] stale, cancelled after', timestamp: daysAgo(12) }]
    });
    const expired = historyItem({
      id: 'h-expired', issueIdentifier: 'LIN-961', status: 'expired',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12)
    });
    const loops = build({ historyItems: [cancelled, expired] });

    assert.deepEqual(eligibleIds(loops), []);
    assert.equal(reasonFor(loops, 'h-cancelled'), 'not-taken');
    assert.equal(reasonFor(loops, 'h-expired'), 'not-taken');
  });

  test('an already-stamped row is skipped as already-stamped — the pass is idempotent', () => {
    const stamped = historyItem({
      id: 'h-stamped', issueIdentifier: 'LIN-962',
      dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
      bookkeeping: { at: daysAgo(1), by: 'operator-1', reason: 'fossil-pass-lin2633' }
    });
    const loops = build({ historyItems: [stamped] });

    assert.deepEqual(eligibleIds(loops), []);
    assert.equal(reasonFor(loops, 'h-stamped'), 'already-stamped');
  });
});

// ─── T10: the safe default, expressed positively ───────────────────────────

describe('fossil pass T10 — an inconclusive activity read leaves the row unstamped', () => {
  test('a row whose activity cannot be established as a finite instant is treated as LIVE', () => {
    // Positive framing: eligibility REQUIRES proof of silence. A row with no
    // establishable activity instant has no such proof, so it is left alone —
    // rather than being swept up by a "stamp unless proven live" default,
    // which on a failed read degrades to "stamp everything".
    const loops = build({
      historyItems: [historyItem({ id: 'h-ok', issueIdentifier: 'LIN-970', dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12) })]
    });
    // Force the inconclusive shape onto a REAL built loop (rather than
    // fixturing a malformed dispatch, which `_buildLoops` would drop
    // outright): zero every activity signal the way a failed derivation
    // would leave them.
    const inconclusive = { ...loops[0], loopId: 'h-inconclusive', dispatchedAt: null, agentTimestamp: null, telemetry: { metrics: [] }, lineageLastActivityMs: null };

    assert.equal(loopLastActivityMs(inconclusive), 0, 'sanity: no activity signal can be established');
    const proof = isProvenSilent(inconclusive, NOW_MS);
    assert.equal(proof.silent, false, 'an unestablishable clock must never read as silent');
    assert.equal(proof.reason, 'inconclusive-activity');

    const result = select([inconclusive]);
    assert.deepEqual(result.eligible, [], 'and it must not be stamped');
    // Through the full chain this row is refused one gate EARLIER, by
    // classifyLoop's own zero-activity guard (`lib/observer-sweep.js`, the
    // `loopLastActivityMs(loop) === 0` branch) which emits `unknown` — a
    // second, independent conservative guard in front of the one asserted
    // above, not a weaker one. Either reason is a refusal; what must never
    // happen is selection.
    assert.ok(
      ['not-silent-or-blocked', 'inconclusive-activity'].includes(result.skipped[0].reason),
      `an inconclusive row must be refused, got reason ${result.skipped[0].reason}`
    );
  });

  test('an unparseable feedback timestamp makes the row inconclusive, never silent', () => {
    const loops = build({
      historyItems: [historyItem({
        id: 'h-badts', issueIdentifier: 'LIN-971',
        dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
        feedback: [{ message: '[working] beat', timestamp: daysAgo(12) }]
      })]
    });
    const corrupted = { ...loops[0], feedback: [{ message: '[working] beat', timestamp: 'not-a-date' }] };

    assert.equal(ownRawLastActivityMs(corrupted), null, 'an unparseable entry cannot be proven old');
    assert.equal(isProvenSilent(corrupted, NOW_MS).reason, 'inconclusive-activity');
    assert.deepEqual(select([corrupted]).eligible, [], 'so the row is left alone');
  });

  test('epochMs returns null (never 0) for an unparseable value — 0 would read as ancient-therefore-stampable', () => {
    assert.equal(epochMs(null), null);
    assert.equal(epochMs(undefined), null);
    assert.equal(epochMs('not-a-date'), null);
    assert.equal(epochMs(NaN), null);
    assert.equal(epochMs(new Date('nope')), null);
    assert.equal(epochMs('2026-09-05T12:00:00.000Z'), NOW_MS);
    assert.equal(epochMs(NOW_MS), NOW_MS);
    assert.equal(epochMs(new Date(NOW_MS)), NOW_MS);
  });
});

// ─── Report grouping primitives ────────────────────────────────────────────

describe('fossil pass — age bucketing', () => {
  test('bucket boundaries are lower-inclusive/upper-exclusive, so no age double-counts', () => {
    const day = 24 * 60 * 60 * 1000;
    assert.equal(bucketForAge(7 * day), '7-10d');
    assert.equal(bucketForAge(9.9 * day), '7-10d');
    assert.equal(bucketForAge(10 * day), '10-14d');
    assert.equal(bucketForAge(14 * day), '14-21d');
    assert.equal(bucketForAge(21 * day), '21-30d');
    assert.equal(bucketForAge(30 * day), '>30d');
    assert.equal(bucketForAge(60 * day), '>30d');
  });

  test('the bucket set is exactly the five the report promises', () => {
    assert.deepEqual(AGE_BUCKETS.map((b) => b.key), ['7-10d', '10-14d', '14-21d', '21-30d', '>30d']);
  });

  test('a selected row carries its bucket and lane, and the counts reconcile with the eligible list', () => {
    const rows = [
      historyItem({ id: 'b-8d', issueIdentifier: 'LIN-980', dispatchedAt: daysAgo(8), resolvedAt: daysAgo(8) }),
      historyItem({ id: 'b-12d', issueIdentifier: 'LIN-981', dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12) }),
      historyItem({
        id: 'b-16d-blocked', issueIdentifier: 'LIN-982', dispatchedAt: daysAgo(16), resolvedAt: daysAgo(16),
        feedback: [{ message: '[blocked] need a decision', timestamp: daysAgo(16) }]
      })
    ];
    const result = select(build({ historyItems: rows }));

    assert.equal(result.eligible.length, 3);
    assert.equal(result.bucketCounts['7-10d'], 1);
    assert.equal(result.bucketCounts['10-14d'], 1);
    assert.equal(result.bucketCounts['14-21d'], 1);
    assert.equal(result.bucketCounts['>30d'], 0, 'the retention edge keeps this empty');
    assert.equal(result.laneCounts.silent, 2);
    assert.equal(result.laneCounts.blocked, 1);
    assert.equal(
      Object.values(result.bucketCounts).reduce((a, b) => a + b, 0), result.eligible.length,
      'bucket counts must reconcile against the eligible list'
    );
    assert.equal(
      result.laneCounts.silent + result.laneCounts.blocked, result.eligible.length,
      'lane counts must reconcile too'
    );
  });

  test('every skipped row carries exactly one reason, so the skip counts partition the corpus', () => {
    const rows = [
      historyItem({ id: 'm-fresh', issueIdentifier: 'LIN-990', dispatchedAt: daysAgo(1), resolvedAt: daysAgo(1) }),
      historyItem({ id: 'm-cancelled', issueIdentifier: 'LIN-991', status: 'cancelled', dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12) }),
      historyItem({
        id: 'm-done', issueIdentifier: 'LIN-992', dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12),
        feedback: [{ message: '[done] shipped', timestamp: daysAgo(11) }]
      }),
      historyItem({ id: 'm-fossil', issueIdentifier: 'LIN-993', dispatchedAt: daysAgo(12), resolvedAt: daysAgo(12) })
    ];
    const result = select(build({ historyItems: rows }));

    assert.equal(result.eligible.length + result.skipped.length, 4, 'every row is accounted for exactly once');
    const totalSkips = Object.values(result.skippedCounts).reduce((a, b) => a + b, 0);
    assert.equal(totalSkips, result.skipped.length, 'the counts sum to the itemised list');
  });
});
