/**
 * Decision-lifecycle stamp inline-literal drift guard (LIN-2891/LIN-3037).
 *
 * `lib/digest-feedback.js`'s `isDecisionLifecycleStampEntry` is the ONE
 * canonical definition of the 3 decision-lifecycle stamp kinds
 * (`decision-answer`, `decision-withdrawn`, `decision-withdrawal-reversed`).
 * Four sites can't import it and instead carry their own inline 3-kind
 * literal copy — 4 literal copies across 5 call sites:
 *   - `public/dispatch.js` (`renderFeedbackEntries`) — a browser script, can't
 *     import `lib/`.
 *   - `public/session.js` (`renderRunTranscripts`) — same.
 *   - `lib/session-telemetry.js` — importing the helper here would close the
 *     documented `digest-feedback.js` <-> `session-telemetry.js` cycle
 *     (`digest-feedback.js` already imports FROM this module). ONE
 *     module-level literal set, shared by its two call sites
 *     (`parseHeartbeats` and `parseParkedWait`).
 *   - `lib/wall-clock-summary.js` (`decomposeEffort`'s `touchedCi` scan) —
 *     kept inline for consistency with `session-telemetry.js`, which this
 *     module already sources `parseHeartbeats` from.
 *
 * Nothing fails loudly if one of those copies drifts from the helper (a kind
 * added to the helper but not a copy, or a kind added to a copy but not the
 * helper) — this file is that alarm.
 *
 * Follows tests/unit/passage-runner-contract-drift.test.js's convention:
 * every source read into its own variable and asserted per-source (never
 * concatenated), and slicing by marker text, not line numbers.
 *
 * The expected 3-kind set is never hard-coded a second time here — it is
 * extracted from `isDecisionLifecycleStampEntry`'s OWN source text, and then
 * cross-checked by actually CALLING the live imported function with each
 * extracted kind (plus decoys), so a source/behavior divergence in the
 * helper itself would also be caught.
 *
 * Run with: node --test tests/unit/decision-lifecycle-stamp-drift.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDecisionLifecycleStampEntry } from '../../lib/digest-feedback.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relPath) => readFileSync(join(__dirname, '../..', relPath), 'utf8');

const digestFeedbackSource = read('lib/digest-feedback.js');
const dispatchJsSource = read('public/dispatch.js');
const sessionJsSource = read('public/session.js');
const sessionTelemetrySource = read('lib/session-telemetry.js');
const wallClockSummarySource = read('lib/wall-clock-summary.js');

const KIND_LITERAL_RE = /'(decision-[a-z-]+)'/g;

/** All single-quoted `'decision-...'` literals in `source`, deduped. */
function extractKindSet(source) {
  const set = new Set();
  KIND_LITERAL_RE.lastIndex = 0;
  let m;
  while ((m = KIND_LITERAL_RE.exec(source))) set.add(m[1]);
  return set;
}

/** Every `'decision-...'` literal occurrence in `source`, WITH duplicates. */
function extractKindOccurrences(source) {
  const out = [];
  KIND_LITERAL_RE.lastIndex = 0;
  let m;
  while ((m = KIND_LITERAL_RE.exec(source))) out.push(m[1]);
  return out;
}

// Slice ONLY isDecisionLifecycleStampEntry's own function body — not the
// whole file (which also carries isDecisionAnswerEntry's single-kind
// literal, and _findDecisionWithdrawal/resolvedDecisionEvents's per-kind
// guards elsewhere) — by marker text, same discipline as
// passage-runner-contract-drift.test.js.
function extractHelperBodySource() {
  const marker = 'export function isDecisionLifecycleStampEntry(entry) {';
  const start = digestFeedbackSource.indexOf(marker);
  assert.notEqual(start, -1, 'isDecisionLifecycleStampEntry found in lib/digest-feedback.js');
  const end = digestFeedbackSource.indexOf('\n}', start);
  assert.notEqual(end, -1, 'the closing brace marks the end of the function body');
  return digestFeedbackSource.slice(start, end);
}

const helperBodyKinds = extractKindSet(extractHelperBodySource());
const sortedHelperKinds = [...helperBodyKinds].sort();

describe('isDecisionLifecycleStampEntry: canonical 3-kind set (LIN-3037)', () => {
  test('the helper\'s own source declares exactly 3 kind literals', () => {
    assert.deepStrictEqual(sortedHelperKinds, [
      'decision-answer', 'decision-withdrawal-reversed', 'decision-withdrawn',
    ]);
  });

  test('the LIVE function returns true for every kind its own source declares, and false for decoys', () => {
    for (const kind of helperBodyKinds) {
      assert.strictEqual(isDecisionLifecycleStampEntry({ kind }), true,
        `expected the live isDecisionLifecycleStampEntry to match its own source-declared kind "${kind}"`);
    }
    // Plausible non-members: the single-kind sibling helper's kind alone
    // isn't enough to prove exclusivity, so probe kinds this class of code
    // actually encounters (decision / status / usage / heartbeat) plus a
    // couple of never-implemented lifecycle names, and absent/malformed input.
    for (const kind of ['decision', 'status', 'usage', 'heartbeat', 'decision-pending', 'decision-expired']) {
      assert.strictEqual(isDecisionLifecycleStampEntry({ kind }), false,
        `expected the live isDecisionLifecycleStampEntry to reject decoy kind "${kind}"`);
    }
    assert.strictEqual(isDecisionLifecycleStampEntry(undefined), false);
    assert.strictEqual(isDecisionLifecycleStampEntry(null), false);
    assert.strictEqual(isDecisionLifecycleStampEntry({}), false);
  });
});

describe('inline-literal copies stay in sync with the helper (LIN-3037)', () => {
  const sites = [
    { label: 'public/dispatch.js (renderFeedbackEntries)', source: dispatchJsSource },
    { label: 'public/session.js (renderRunTranscripts)', source: sessionJsSource },
    { label: "lib/session-telemetry.js (parseHeartbeats/parseParkedWait's shared module-level set)", source: sessionTelemetrySource },
    { label: 'lib/wall-clock-summary.js (decomposeEffort touchedCi scan)', source: wallClockSummarySource },
  ];

  for (const { label, source } of sites) {
    test(`${label} carries exactly the helper's 3 kinds, no more, no fewer`, () => {
      const siteKinds = [...extractKindSet(source)].sort();
      assert.deepStrictEqual(siteKinds, sortedHelperKinds,
        `${label}'s inline 3-kind literal set has drifted from isDecisionLifecycleStampEntry's own kinds`);
    });
  }

  // session-telemetry.js's set must be declared ONCE at module level and
  // shared, not re-typed separately per call site — each kind literal
  // should therefore appear exactly once in the whole file.
  test("lib/session-telemetry.js declares its 3-kind set ONCE (not duplicated per call site)", () => {
    const occurrences = extractKindOccurrences(sessionTelemetrySource);
    assert.strictEqual(occurrences.length, 3,
      `expected exactly 3 literal occurrences (one module-level declaration of 3 kinds), got ${occurrences.length}: ${JSON.stringify(occurrences)}`);
  });

  test('both parseHeartbeats and parseParkedWait reference the same shared stamp-check helper', () => {
    const heartbeatsStart = sessionTelemetrySource.indexOf('export function parseHeartbeats(');
    const heartbeatsEnd = sessionTelemetrySource.indexOf('\n}', heartbeatsStart);
    const parkedWaitStart = sessionTelemetrySource.indexOf('export function parseParkedWait(');
    const parkedWaitEnd = sessionTelemetrySource.indexOf('\n}', parkedWaitStart);
    assert.ok(heartbeatsStart !== -1 && heartbeatsEnd !== -1, 'parseHeartbeats found');
    assert.ok(parkedWaitStart !== -1 && parkedWaitEnd !== -1, 'parseParkedWait found');
    const heartbeatsBody = sessionTelemetrySource.slice(heartbeatsStart, heartbeatsEnd);
    const parkedWaitBody = sessionTelemetrySource.slice(parkedWaitStart, parkedWaitEnd);
    // Neither function body carries a 'decision-...' literal of its own —
    // both must go through the shared helper instead.
    assert.strictEqual(extractKindOccurrences(heartbeatsBody).length, 0,
      'parseHeartbeats must not carry its own decision-* literal — it must use the shared module-level set');
    assert.strictEqual(extractKindOccurrences(parkedWaitBody).length, 0,
      'parseParkedWait must not carry its own decision-* literal — it must use the shared module-level set');
    assert.match(heartbeatsBody, /_isStampEntry\(/, 'parseHeartbeats must call the shared stamp-check helper');
    assert.match(parkedWaitBody, /_isStampEntry\(/, 'parseParkedWait must call the shared stamp-check helper');
  });
});
