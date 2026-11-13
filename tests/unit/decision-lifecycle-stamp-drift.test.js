/**
 * Decision-lifecycle stamp drift guard (LIN-2891/LIN-3037; re-pointed by LIN-4455).
 *
 * The 3 decision-lifecycle stamp kinds (`decision-answer`, `decision-withdrawn`,
 * `decision-withdrawal-reversed`) are declared ONCE, as the `decisionStamp` role of the
 * feedback kinds table (`lib/dispatch-feedback-kinds.js`, a leaf that imports nothing).
 * Before LIN-4455 the helper `isDecisionLifecycleStampEntry` (`lib/digest-feedback.js`)
 * spelled them, and `lib/session-telemetry.js` and `lib/wall-clock-summary.js` carried
 * inline copies (an import back would have closed the digest-feedback <->
 * session-telemetry cycle; the leaf closes none). Those copies are retired, so for them
 * this file now checks the stronger property: they spell no `'decision-...'` literal and
 * import the set from the table. `lib/run-view.js`'s waiting scan is held to the same.
 *
 * Two copies remain because a browser script cannot import `lib/`:
 *   - `public/dispatch.js` (`renderFeedbackEntries`);
 *   - `public/session.js` (`renderRunTranscripts`).
 * Each must carry exactly the table's 3 kinds; this file is that alarm.
 *
 * Follows tests/unit/passage-runner-contract-drift.test.js's convention:
 * every source read into its own variable and asserted per-source (never
 * concatenated), and slicing by marker text, not line numbers.
 *
 * The expected set comes from the table's derived `DECISION_LIFECYCLE_STAMP_KINDS`,
 * checked against the 3-kind literal once, and cross-checked by CALLING the live
 * helper with each kind (plus decoys), so a divergence between the table and the
 * helper's behaviour is also caught.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/decision-lifecycle-stamp-drift.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDecisionLifecycleStampEntry } from '../../lib/digest-feedback.js';
import { DECISION_LIFECYCLE_STAMP_KINDS } from '../../lib/dispatch-feedback-kinds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relPath) => readFileSync(join(__dirname, '../..', relPath), 'utf8');

const digestFeedbackSource = read('lib/digest-feedback.js');
const dispatchJsSource = read('public/dispatch.js');
const sessionJsSource = read('public/session.js');
const sessionTelemetrySource = read('lib/session-telemetry.js');
const wallClockSummarySource = read('lib/wall-clock-summary.js');
const runViewSource = read('lib/run-view.js');

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

// The one declaration: the table's `decisionStamp` role.
const helperBodyKinds = new Set(DECISION_LIFECYCLE_STAMP_KINDS);

// isDecisionLifecycleStampEntry's own function body, sliced by marker text.
function extractHelperBodySource() {
  const marker = 'export function isDecisionLifecycleStampEntry(entry) {';
  const start = digestFeedbackSource.indexOf(marker);
  assert.notEqual(start, -1, 'isDecisionLifecycleStampEntry found in lib/digest-feedback.js');
  const end = digestFeedbackSource.indexOf('\n}', start);
  assert.notEqual(end, -1, 'the closing brace marks the end of the function body');
  return digestFeedbackSource.slice(start, end);
}

const sortedHelperKinds = [...helperBodyKinds].sort();

describe('the stamp kinds: one 3-kind declaration (LIN-3037, LIN-4455)', () => {
  test('the table\'s decisionStamp role declares exactly the 3 kinds', () => {
    assert.deepStrictEqual(sortedHelperKinds, [
      'decision-answer', 'decision-withdrawal-reversed', 'decision-withdrawn',
    ]);
  });

  test('the LIVE function returns true for every kind its own source declares, and false for decoys', () => {
    for (const kind of helperBodyKinds) {
      assert.strictEqual(isDecisionLifecycleStampEntry({ kind }), true,
        `expected the live isDecisionLifecycleStampEntry to match the table's stamp kind "${kind}"`);
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

  test('the helper spells no kind of its own: it reads the table\'s set', () => {
    const body = extractHelperBodySource();
    assert.strictEqual(extractKindOccurrences(body).length, 0, 'isDecisionLifecycleStampEntry carries its own decision-* literal');
    assert.match(body, /DECISION_LIFECYCLE_STAMP_KINDS\.has\(/);
  });
});

describe('the browser copies stay in sync with the table (LIN-3037)', () => {
  const sites = [
    { label: 'public/dispatch.js (renderFeedbackEntries)', source: dispatchJsSource },
    { label: 'public/session.js (renderRunTranscripts)', source: sessionJsSource },
  ];

  for (const { label, source } of sites) {
    test(`${label} carries exactly the table's 3 kinds, no more, no fewer`, () => {
      const siteKinds = [...extractKindSet(source)].sort();
      assert.deepStrictEqual(siteKinds, sortedHelperKinds,
        `${label}'s inline 3-kind literal set has drifted from the table's stamp kinds`);
    });
  }
});

describe('the lib/ readers take the stamp kinds from the table (LIN-4455)', () => {
  const sites = [
    { label: "lib/session-telemetry.js (parseHeartbeats/parseParkedWait's shared stamp check)", source: sessionTelemetrySource },
    { label: 'lib/wall-clock-summary.js (decomposeEffort touchedCi scan)', source: wallClockSummarySource },
    { label: 'lib/run-view.js (the waiting scan)', source: runViewSource },
    { label: 'lib/digest-feedback.js (isDecisionLifecycleStampEntry)', source: digestFeedbackSource },
  ];

  for (const { label, source } of sites) {
    test(`${label} imports DECISION_LIFECYCLE_STAMP_KINDS from the table`, () => {
      assert.match(source, /import \{[^}]*\bDECISION_LIFECYCLE_STAMP_KINDS\b[^}]*\} from '\.\/dispatch-feedback-kinds\.js';/,
        `${label} must import the stamp set from lib/dispatch-feedback-kinds.js`);
    });
  }

  for (const { label, source } of sites.slice(0, 3)) {
    test(`${label} spells no decision-lifecycle stamp literal`, () => {
      const stamps = extractKindOccurrences(source).filter((kind) => helperBodyKinds.has(kind));
      assert.deepStrictEqual(stamps, [], `${label} carries its own stamp literal(s)`);
    });
  }

  // The set is declared ONCE (in the table), never re-typed per call site: no stamp
  // literal at all in session-telemetry.js. (Before LIN-4455: exactly one module-level
  // declaration of 3 kinds here.)
  test("lib/session-telemetry.js declares no copy of the set (not one, not one per call site)", () => {
    const occurrences = extractKindOccurrences(sessionTelemetrySource);
    assert.strictEqual(occurrences.length, 0,
      `expected no literal occurrences (the set is declared once, in the table), got ${occurrences.length}: ${JSON.stringify(occurrences)}`);
  });

  // LIN-4240: parseParkedWait now walks past a wider set (`_isNonStateEntry`),
  // which itself delegates the stamp check to `_isStampEntry`. The stamp check
  // is still shared, just one level down, so this test follows that chain.
  test('parseParkedWait reaches the stamp check through the shared skip predicate (LIN-4240)', () => {
    const predicateStart = sessionTelemetrySource.indexOf('const _isNonStateEntry = ');
    const predicateEnd = sessionTelemetrySource.indexOf('\n};', predicateStart);
    assert.ok(predicateStart !== -1 && predicateEnd !== -1, '_isNonStateEntry found');
    const predicateBody = sessionTelemetrySource.slice(predicateStart, predicateEnd);
    const parkedWaitStart = sessionTelemetrySource.indexOf('export function parseParkedWait(');
    const parkedWaitEnd = sessionTelemetrySource.indexOf('\n}', parkedWaitStart);
    const parkedWaitBody = sessionTelemetrySource.slice(parkedWaitStart, parkedWaitEnd);
    assert.strictEqual(extractKindOccurrences(predicateBody).length, 0,
      '_isNonStateEntry must not carry its own decision-* literal — it must use the shared stamp-check helper');
    assert.match(predicateBody, /_isStampEntry\(/, '_isNonStateEntry must call the shared stamp-check helper');
    assert.match(parkedWaitBody, /_isNonStateEntry\(/, 'parseParkedWait must walk past entries via the skip predicate');
    assert.strictEqual(extractKindOccurrences(parkedWaitBody).length, 0,
      'parseParkedWait must not carry its own decision-* literal');
  });

  test('parseHeartbeats and parseParkedWait carry no decision-* literal of their own (LIN-4240: parseParkedWait checked in the test above)', () => {
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
  });
});
