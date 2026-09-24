/**
 * Unit tests for the LIN-3008 (LIN-2996 Phase 0) extraction:
 *   - `formatFeedbackEntries`, a named export promoted from
 *     `dispatch-store.js`'s private `_formatFeedbackEntries` method.
 *   - `digestFeedback(doc, { now } = {})`, a new pure module
 *     (`lib/digest-feedback.js`) that has not been created yet.
 *
 * TDD red (beat 2): both `lib/digest-feedback.js` and the `formatFeedbackEntries`
 * export do not exist on this branch yet. Every test below that calls
 * `digestFeedback(...)` or `formatFeedbackEntries(...)` fails with
 * "... is not a function" (see the beat-2 report for the captured transcript) —
 * imported via a guarded dynamic import at the top of this file rather than a
 * static one, so each test reports its OWN failure instead of one whole-file
 * load error, and so this file can still be run (and read) before the module
 * exists.
 *
 * Fixtures reuse the house conventions from tests/unit/pipeline-loops.test.js
 * (decisionEntry/textEntry) and tests/unit/session-telemetry.test.js
 * (usageMessage/resourcesMessage), and cross-check against the SAME production
 * functions `digestFeedback` must wire together
 * (`__internal._buildLoops` for loop-facing fields, `loadDispatchHistory` via a
 * real in-memory MangoDB collection for `kpi*` fields) rather than
 * reimplementing their logic — a drift in either real implementation must show
 * up here, not just a local reimplementation agreeing with itself.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { __internal as PIPELINE_LOOPS_INTERNAL } from '../../lib/pipeline-loops.js';
import { feedbackWithHarvestedAbort, findTerminalFeedback } from '../../lib/dispatch-terminal.js';
import { loadDispatchHistory } from '../../lib/kpi-stats.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { PULSE_MAX_WINDOW_MS } from '../../lib/live-console.js';

// ── Guarded dynamic imports: the modules/exports under test, which do not ──
// ── exist yet on this branch (TDD red). Each stays `null` until beat 3.   ──
let digestFeedback = null;
let digestFeedbackImportError = null;
try {
  ({ digestFeedback } = await import('../../lib/digest-feedback.js'));
} catch (err) {
  digestFeedbackImportError = err;
}

let formatFeedbackEntries = null;
try {
  ({ formatFeedbackEntries } = await import('../../lib/dispatch-store.js'));
} catch (err) {
  // dispatch-store.js itself exists (DispatchQueueStore imports fine above),
  // so this only fires if a future change makes the whole module unloadable.
  formatFeedbackEntries = undefined;
}

function requireDigestFeedback() {
  assert.ok(typeof digestFeedback === 'function',
    `lib/digest-feedback.js must export digestFeedback (import error: ${digestFeedbackImportError?.message || 'n/a'})`);
}

function requireFormatFeedbackEntries() {
  assert.ok(typeof formatFeedbackEntries === 'function',
    'lib/dispatch-store.js must export formatFeedbackEntries (promoted from the private _formatFeedbackEntries method)');
}

const { _buildLoops } = PIPELINE_LOOPS_INTERNAL;

// ── Fixture helpers (mirrors pipeline-loops.test.js / session-telemetry.test.js) ──

const T0 = new Date('2026-01-01T10:00:00.000Z');
const at = (offsetSec) => new Date(T0.getTime() + offsetSec * 1000);

function decisionMessage(payload) {
  return `[decision] ${JSON.stringify(payload)}`;
}
function decisionEntry(payload, timestamp) {
  return { kind: 'decision', message: decisionMessage(payload), timestamp };
}
function textEntry(text, timestamp) {
  return { kind: 'assistant-text', message: text, timestamp };
}
function decisionAnswerEntry(decisionId, timestamp, extra = {}) {
  return { kind: 'decision-answer', message: JSON.stringify({ decision_id: decisionId, ...extra }), timestamp };
}
function usageMessage(overrides = {}) {
  return `[usage] ${JSON.stringify({
    schema: 1, harness: 'claude-code', model: 'claude-opus-4-8',
    inputTokens: 100, outputTokens: 200, costUsd: null, ...overrides,
  })}`;
}
function resourcesMessage(overrides = {}) {
  return `[resources] ${JSON.stringify({ peakRssBytes: 536870912, ...overrides })}`;
}

/** A raw dispatch doc, as `findOneAndUpdate`/an archived history row carries it: `Date` timestamps throughout. */
function rawDoc({ feedback = [], dispatchedAt = T0 } = {}) {
  return { _id: 'doc-1', urlKey: 'ws', rootItemId: 'doc-1', status: 'taken', dispatchedAt, feedback };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. formatFeedbackEntries (export) ≡ _formatFeedbackEntries (method)
// ─────────────────────────────────────────────────────────────────────────

describe('formatFeedbackEntries export ≡ _formatFeedbackEntries method (exactly one formatter)', () => {
  const fixtures = [
    [],
    [{ message: 'plain', timestamp: at(0) }],
    [{ message: 'with url', url: 'https://x.example/1', urlLabel: 'label', timestamp: at(1) }],
    [{ message: 'with rootItemId', rootItemId: 'root-9', timestamp: at(2) }],
    [{ message: 'with kind', kind: 'heartbeat', timestamp: at(3) }],
    [
      { message: 'a', timestamp: at(0) },
      { message: 'b', kind: 'evidence', url: 'https://x.example/2', urlLabel: 'ev', timestamp: at(1) },
      { message: 'c', rootItemId: 'root-1', kind: 'status', timestamp: at(2) },
    ],
  ];

  for (const [i, feedback] of fixtures.entries()) {
    test(`fixture ${i}: identical output`, () => {
      requireFormatFeedbackEntries();
      const viaExport = formatFeedbackEntries(feedback);
      const viaMethod = DispatchQueueStore.prototype._formatFeedbackEntries(feedback);
      assert.deepStrictEqual(viaExport, viaMethod);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 6. digestFeedback takes a raw doc, never a bare feedback array
// ─────────────────────────────────────────────────────────────────────────

describe('digestFeedback(doc, { now }): doc contract', () => {
  test('count === feedback.length exactly (never a guard counter)', () => {
    requireDigestFeedback();
    const doc = rawDoc({ feedback: [
      { message: 'a', timestamp: at(0) },
      { message: 'b', timestamp: at(1) },
      { message: 'c', timestamp: at(2) },
    ] });
    const digest = digestFeedback(doc, { now: Date.now() });
    assert.equal(digest.count, 3);
  });

  test('empty feedback: count 0, terminal/wake/decision/parkedWait all null, decisionCase []', () => {
    requireDigestFeedback();
    const digest = digestFeedback(rawDoc({ feedback: [] }), { now: Date.now() });
    assert.equal(digest.count, 0);
    assert.equal(digest.terminal, null);
    assert.equal(digest.wake, null);
    assert.equal(digest.decision, null);
    assert.equal(digest.decisionEntryIndex, null);
    assert.deepStrictEqual(digest.decisionCase, []);
    assert.equal(digest.answeredDecisionId, null);
    assert.equal(digest.parkedWait, null);
  });

  test('telemetry.runtime.dispatchedAt is the ISO form of doc.dispatchedAt (a raw Date on input)', () => {
    requireDigestFeedback();
    const digest = digestFeedback(rawDoc({ feedback: [], dispatchedAt: T0 }), { now: Date.now() });
    assert.equal(digest.telemetry.runtime.dispatchedAt, T0.toISOString());
  });

  test('a bare feedback array (no .feedback/.dispatchedAt doc wrapper) cannot supply telemetry.runtime.dispatchedAt', () => {
    // Documents the doc-vs-array contract directly: passing what would be a bare
    // array's worth of entries with no `.dispatchedAt` on the wrapper leaves
    // runtime.dispatchedAt null — this is why the ticket requires a doc, not an array.
    requireDigestFeedback();
    const noDispatchedAtDoc = { feedback: [{ message: '[done] x', timestamp: at(0) }] };
    const digest = digestFeedback(noDispatchedAtDoc, { now: Date.now() });
    assert.equal(digest.telemetry.runtime.dispatchedAt, null);
  });

  // Ledger L1: a REAL bare feedback array (not a doc wrapper) must be
  // rejected with a TypeError, not silently coerced into an empty digest.
  // Current code (`Array.isArray(doc?.feedback) ? doc.feedback : []`, `digest-feedback.js:286`)
  // reads `.feedback` off an array `doc`, which is always `undefined` on a
  // plain array, so it falls through to `[]` and returns a fully-formed,
  // wrongly-empty digest instead of throwing — the exact "wrong but fresh"
  // shape N1 warns about (mutant #31 survived on this). Expected RED against 92ef6706.
  test('a real bare feedback array (not a doc wrapper) throws a TypeError (L1)', () => {
    requireDigestFeedback();
    const bareArray = [{ message: '[done] x', timestamp: at(0) }];
    assert.throws(() => digestFeedback(bareArray, { now: Date.now() }), TypeError);
  });

  test('null throws a TypeError (L1)', () => {
    requireDigestFeedback();
    assert.throws(() => digestFeedback(null, { now: Date.now() }), TypeError);
  });

  test('a non-object primitive throws a TypeError (L1)', () => {
    requireDigestFeedback();
    assert.throws(() => digestFeedback('not a doc', { now: Date.now() }), TypeError);
  });

  // Ledger L7: `count` must be the doc's exact `feedback.length`, including
  // entries that carry no `message` at all — never a length recomputed from
  // a filtered subset (mutant #33 survived: every prior fixture entry had a
  // message, so a "count of messaged entries" mutation went undetected).
  test('count === feedback.length exactly, even when an entry has no message (L7)', () => {
    requireDigestFeedback();
    const doc = rawDoc({ feedback: [
      { message: 'a', timestamp: at(0) },
      { timestamp: at(1) }, // no `message` field at all
      { message: 'c', timestamp: at(2) },
    ] });
    const digest = digestFeedback(doc, { now: Date.now() });
    assert.equal(digest.count, 3, 'count must be the exact array length, never a filtered count');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 1(a/b). Loop-facing timestamps are ISO strings; kpi* timestamps are raw Dates
// ─────────────────────────────────────────────────────────────────────────

describe('digestFeedback: timestamp types (N1 a/b)', () => {
  function kitchenSinkDoc() {
    return rawDoc({
      dispatchedAt: T0,
      feedback: [
        { kind: 'heartbeat', message: '[working] 6 tools/32s · alive', timestamp: at(10) },
        { kind: 'evidence', message: '[evidence] doc · https://example.com · 1 mentions', timestamp: at(20), url: 'https://example.com', urlLabel: 'doc' },
        textEntry('reasoning', at(30)),
        decisionEntry({ decision_id: 'd-1', question: 'Proceed?' }, at(31)),
        decisionAnswerEntry('d-1', at(35)),
        { kind: 'ticket', message: '[ticket] LIN-1 started', timestamp: at(40) },
        { kind: 'usage', message: usageMessage(), timestamp: at(45) },
        { kind: 'status', message: '[done] finished in 50s', timestamp: at(50) },
      ],
    });
  }

  test('every loop-facing timestamp is an ISO string', () => {
    requireDigestFeedback();
    const digest = digestFeedback(kitchenSinkDoc(), { now: Date.now() });
    assert.equal(typeof digest.terminal.entry.timestamp, 'string');
    assert.match(digest.terminal.entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof digest.telemetry.runtime.dispatchedAt, 'string');
    assert.equal(typeof digest.telemetry.runtime.completedAt, 'string');
    for (const m of digest.telemetry.metrics) {
      assert.equal(typeof m.timestamp, 'string', 'retained metric timestamps must be ISO strings');
    }
  });

  test('a parked-wait fixture: since/latest are ISO strings', () => {
    requireDigestFeedback();
    const doc = rawDoc({
      feedback: [
        { message: '[working] normal beat', timestamp: at(0) },
        { message: '[working · verifying] Not done yet — a scheduled wakeup still pending.', timestamp: at(10) },
        { message: '[working · verifying] Not done yet — a scheduled wakeup still pending.', timestamp: at(20) },
      ],
    });
    const digest = digestFeedback(doc, { now: Date.now() });
    assert.ok(digest.parkedWait, 'parkedWait must be derived');
    assert.equal(typeof digest.parkedWait.since, 'string');
    assert.equal(typeof digest.parkedWait.latest, 'string');
  });

  test('every kpi* timestamp is a raw Date, never a string', () => {
    requireDigestFeedback();
    const digest = digestFeedback(kitchenSinkDoc(), { now: Date.now() });
    assert.ok(digest.kpiTerminalEntry.timestamp instanceof Date, 'kpiTerminalEntry.timestamp must be a Date');
    assert.ok(digest.kpiUsageEntry.timestamp instanceof Date, 'kpiUsageEntry.timestamp must be a Date');
    for (const entry of digest.kpiTicketMarkerEntries) {
      assert.ok(entry.timestamp instanceof Date, 'kpiTicketMarkerEntries[].timestamp must be a Date');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 1(c). Sub-second terminal case resolves to `aborted` via the real F1 guard
// ─────────────────────────────────────────────────────────────────────────

describe('digestFeedback: sub-second abort-vs-terminal, proven through the real F1 guard (W1)', () => {
  test('digest.terminal.entry.timestamp (ISO) lets the real F1 guard resolve a 900ms-later harvested abort as aborted', () => {
    requireDigestFeedback();
    const targetDoc = rawDoc({
      feedback: [{ message: '[failed] boom', timestamp: new Date('2026-01-01T10:00:00.200Z') }],
    });
    const digest = digestFeedback(targetDoc, { now: Date.now() });
    assert.equal(digest.terminal.status, 'failed');

    const abortEntry = { message: '[aborted] cascade', timestamp: '2026-01-01T10:00:00.900Z' };
    // Run the SAME production F1 guard the lean read will use in Phase 3,
    // fed the digest's own (ISO) terminal entry as the pre-existing terminal —
    // this is a real runtime witness of the guard's behavior, not a re-derived assertion.
    const harvested = feedbackWithHarvestedAbort([digest.terminal.entry], abortEntry);
    const result = findTerminalFeedback(harvested);
    assert.equal(result.status, 'aborted',
      'a genuinely later abort must win when the existing terminal timestamp is ISO (millisecond-exact)');
  });

  test('contrast (the W1 bug this digest shape must prevent): RAW Date timestamps on both sides lose sub-second precision and wrongly compare equal', () => {
    // Not a digestFeedback call — this documents WHY loop-facing timestamps
    // must be ISO, by exercising Date.parse(dateObject) directly, mirroring
    // dispatch-terminal.js:252-266's own Date.parse calls. Reproduces the
    // exact pre-W1 (Revision 4) scenario `342516ab` found: a bare-array
    // `digestFeedback(feedback)` would carry raw `Date` timestamps straight
    // through for BOTH the target's own terminal and the harvested abort
    // (there is no formatting step at all in that shape) — so both sides
    // truncate through `Date.prototype.toString()` (never `toISOString()`)
    // to the same whole second and compare EQUAL, not abort-later.
    const existingEntryWithRawDate = { message: '[failed] boom', timestamp: new Date('2026-01-01T10:00:00.200Z') };
    const abortEntryWithRawDate = { message: '[aborted] cascade', timestamp: new Date('2026-01-01T10:00:00.900Z') };
    const harvested = feedbackWithHarvestedAbort([existingEntryWithRawDate], abortEntryWithRawDate);
    const result = findTerminalFeedback(harvested);
    // Both sides truncate to the same second, so `abortMs > existingMs` is
    // false and the F1 guard keeps the (wrongly) stale target terminal.
    assert.equal(result.status, 'failed',
      'demonstrates the exact bug a raw-Date terminal timestamp would reproduce — digestFeedback must never emit one');
  });

  // Ledger L6: the INVERSE sub-second direction. N1(c) only proves a LATER
  // harvested abort (.900) beats an earlier target (.200). This proves the
  // guard also correctly keeps an EARLIER abort (.200) from overriding a
  // LATER genuine terminal (.900) — millisecond precision must be preserved
  // on both sides, not just the direction the existing test happens to cover
  // (mutant #29, truncating `terminal.entry.timestamp` to the whole second,
  // survived because the existing fixtures never separate two timestamps by
  // less than a full second in this direction).
  test('inverse case: an EARLIER harvested abort (.200) must not override a LATER genuine failed terminal (.900) (L6)', () => {
    requireDigestFeedback();
    const targetDoc = rawDoc({
      feedback: [{ message: '[failed] boom', timestamp: new Date('2026-01-01T10:00:00.900Z') }],
    });
    const digest = digestFeedback(targetDoc, { now: Date.now() });
    assert.equal(digest.terminal.status, 'failed');

    const abortEntry = { message: '[aborted] cascade', timestamp: '2026-01-01T10:00:00.200Z' };
    const harvested = feedbackWithHarvestedAbort([digest.terminal.entry], abortEntry);
    const result = findTerminalFeedback(harvested);
    assert.equal(result.status, 'failed',
      'an abort only 700ms EARLIER than the genuine terminal must not win — sub-second ISO precision must be preserved on both sides');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. No `undefined` anywhere in the digest output; absence convention is `null`
// ─────────────────────────────────────────────────────────────────────────

function assertNoUndefined(value, path = 'digest') {
  if (value === undefined) {
    assert.fail(`${path} is undefined — absent fields must be null, never omitted as undefined`);
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    assertNoUndefined(v, `${path}.${k}`);
  }
}

describe('digestFeedback: no undefined values anywhere (absence convention: null)', () => {
  test('minimal (empty) feedback', () => {
    requireDigestFeedback();
    assertNoUndefined(digestFeedback(rawDoc({ feedback: [] }), { now: Date.now() }));
  });

  test('feedback with no usage/resources/ticket markers/evidence (every optional telemetry field absent)', () => {
    requireDigestFeedback();
    const doc = rawDoc({ feedback: [{ message: '[working] 1 tools/1s', kind: 'heartbeat', timestamp: at(0) }] });
    const digest = digestFeedback(doc, { now: Date.now() });
    assertNoUndefined(digest);
    assert.equal(digest.kpiUsageEntry, null, 'absent kpi* field must be null, not omitted/undefined');
    assert.equal(digest.telemetry.usage, null, 'absent optional telemetry field must be null, not omitted/undefined');
  });

  test('a "kitchen sink" feedback array touching every field', () => {
    requireDigestFeedback();
    const doc = rawDoc({
      feedback: [
        { kind: 'heartbeat', message: '[working] 6 tools/32s · alive', timestamp: at(0) },
        { kind: 'evidence', message: '[evidence] doc · https://example.com · 1 mentions', timestamp: at(1) },
        textEntry('reasoning', at(2)),
        decisionEntry({ decision_id: 'd-1' }, at(3)),
        decisionAnswerEntry('d-1', at(4)),
        { kind: 'ticket', message: '[ticket] LIN-1 started', timestamp: at(5) },
        { kind: 'usage', message: usageMessage(), timestamp: at(6) },
        { kind: 'resources', message: resourcesMessage(), timestamp: at(7) },
        { message: '[done] finished in 8s', timestamp: at(8) },
      ],
    });
    assertNoUndefined(digestFeedback(doc, { now: Date.now() }));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Loop-facing derivations match today's per-row _buildLoops behaviour
// ─────────────────────────────────────────────────────────────────────────

describe('digestFeedback: loop-facing fields match _buildLoops per-row derivation (representative fixtures)', () => {
  const CASES = {
    'terminal: done': [{ message: '[done] finished in 5s', timestamp: at(0) }],
    'terminal: failed': [{ message: '[failed] blew up', timestamp: at(0) }],
    'terminal: aborted': [{ message: '[aborted] cancelled', timestamp: at(0) }],
    'wake marker: blocked (non-terminal)': [{ message: '[blocked] need input', timestamp: at(0) }],
    'decision with decisionCase': [
      textEntry('A', at(0)), textEntry('B', at(1)),
      decisionEntry({ decision_id: 'd-1', question: 'Proceed?' }, at(2)),
    ],
    'answered decision': [
      decisionEntry({ decision_id: 'd-1' }, at(0)),
      decisionAnswerEntry('d-1', at(1)),
    ],
    'model + usage + evidence + resources + ticket markers': [
      { kind: 'usage', message: usageMessage(), timestamp: at(0) },
      { kind: 'evidence', message: '[evidence] doc · https://example.com · 1 mentions', timestamp: at(1) },
      { kind: 'resources', message: resourcesMessage(), timestamp: at(2) },
      { kind: 'ticket', message: '[ticket] LIN-1 started', timestamp: at(3) },
    ],
    'runtime with a duration tail': [{ message: '[done] finished in 45s', timestamp: at(45) }],
    'runtime without a duration tail': [{ message: '[done] all set', timestamp: at(45) }],
    'empty feedback': [],
  };

  for (const [label, feedback] of Object.entries(CASES)) {
    test(label, () => {
      requireDigestFeedback();
      requireFormatFeedbackEntries();

      const doc = rawDoc({ feedback });
      const digest = digestFeedback(doc, { now: Date.now() });

      const formatted = formatFeedbackEntries(feedback);
      const historyItem = {
        id: 'x', issueIdentifier: 'LIN-1', dispatchedAt: T0.toISOString(), resolvedAt: null,
        status: 'taken', feedback: formatted, kind: 'implementation',
      };
      const [expected] = _buildLoops({ historyItems: [historyItem], now: new Date(at(1000)), lean: false });

      assert.deepStrictEqual(digest.terminal, expected.terminalStatus
        ? { status: expected.terminalStatus, entry: { message: expected.feedback.find(f => f.timestamp === expected.terminalCompletedAt)?.message, timestamp: expected.terminalCompletedAt } }
        : null, 'terminal must match _buildLoops (status/entry)');
      assert.deepStrictEqual(digest.wake, expected.wakeMarker
        ? { marker: expected.wakeMarker, waitingMessage: expected.waitingMessage }
        : null, 'wake must match _buildLoops (marker/waitingMessage)');
      assert.deepStrictEqual(digest.decision, expected.decision, 'decision must match _buildLoops');
      assert.deepStrictEqual(digest.decisionCase, expected.decisionCase, 'decisionCase must match _buildLoops');
      assert.deepStrictEqual(digest.answeredDecisionId, expected.answeredDecisionId, 'answeredDecisionId must match _buildLoops');
      assert.deepStrictEqual(digest.telemetry.runtime, expected.telemetry.runtime, 'telemetry.runtime must match _buildLoops');
      assert.deepStrictEqual(digest.telemetry.model ?? null, expected.telemetry.model ?? null);
      assert.deepStrictEqual(digest.telemetry.evidence, expected.telemetry.producedArtifacts);
      assert.deepStrictEqual(digest.telemetry.usage ?? null, expected.telemetry.usage ?? null);
      assert.deepStrictEqual(digest.telemetry.resources ?? null, expected.telemetry.resources ?? null);
      assert.deepStrictEqual(digest.telemetry.ticketMarkers, expected.telemetry.ticketWalk ?? []);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 4 (cont'd). kpi* fields match /kpis' loadDispatchHistory selectors exactly
// ─────────────────────────────────────────────────────────────────────────

describe('digestFeedback: kpi* fields match loadDispatchHistory (real MangoDB aggregation, not a reimplementation)', () => {
  let client;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3008-kpi-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  async function seededCollection(doc) {
    const db = client.db(`lin3008_${counter++}`);
    const col = db.collection('dispatchHistory');
    await col.insertOne(doc);
    return col;
  }

  test('kpiTerminalEntry/kpiUsageEntry/kpiEvidenceCount/kpiTicketMarkerEntries agree with the real aggregation, Date types included', async () => {
    requireDigestFeedback();
    const doc = rawDoc({
      feedback: [
        { message: 'heartbeat: still going', timestamp: at(0), kind: 'heartbeat' },
        { message: '[usage] {"costUsd":1}', timestamp: at(1), kind: 'usage' },
        { message: '[usage] {"costUsd":2}', timestamp: at(2), kind: 'usage' }, // last usage wins
        { message: 'link A', timestamp: at(3), kind: 'evidence' },
        { message: 'link B', timestamp: at(4), kind: 'evidence' },
        { message: '[ticket] LIN-920 started', timestamp: at(5) },
        { message: '[ticket] LIN-920 done', timestamp: at(6) },
        { message: '[done] finished', timestamp: at(7) },
      ],
    });

    const collection = await seededCollection(doc);
    const [row] = await loadDispatchHistory(collection);
    const digest = digestFeedback(doc, { now: Date.now() });

    assert.deepStrictEqual(digest.kpiTerminalEntry, row.terminalEntry);
    assert.deepStrictEqual(digest.kpiUsageEntry, row.usageEntry);
    assert.equal(digest.kpiEvidenceCount, row.evidenceCount);
    assert.equal(digest.kpiEvidenceCount, 2);
    assert.deepStrictEqual(digest.kpiTicketMarkerEntries, row.ticketMarkerEntries);
    assert.equal(digest.kpiTicketMarkerEntries.length, 2);
  });

  test('kind:"evidence" gate, not EVIDENCE_PREFIX — a message that LOOKS like evidence prose but lacks kind:"evidence" must not count', async () => {
    requireDigestFeedback();
    const doc = rawDoc({
      feedback: [
        { message: '[evidence] looks like evidence but has no kind tag', timestamp: at(0) },
        { message: 'tagged evidence', timestamp: at(1), kind: 'evidence' },
      ],
    });
    const collection = await seededCollection(doc);
    const [row] = await loadDispatchHistory(collection);
    const digest = digestFeedback(doc, { now: Date.now() });

    assert.equal(digest.kpiEvidenceCount, 1, 'must use kind==="evidence", not the loop-side EVIDENCE_PREFIX regex');
    assert.equal(digest.kpiEvidenceCount, row.evidenceCount);
  });

  // Ledger L2: kpiTerminalEntry must be the LAST terminal marker, matching
  // the aggregation's `$last` (mutant #16 survived: the only prior kpi
  // fixture had a single terminal entry, so "take the FIRST match" was
  // indistinguishable from "take the LAST match").
  test('kpiTerminalEntry is the LAST terminal entry on a multi-terminal fixture, matching the aggregation\'s $last (L2)', async () => {
    requireDigestFeedback();
    const doc = rawDoc({
      feedback: [
        { message: '[failed] first attempt', timestamp: at(0) },
        { message: 'unrelated chatter', timestamp: at(1) },
        { message: '[done] retried and finished', timestamp: at(2) },
      ],
    });
    const collection = await seededCollection(doc);
    const [row] = await loadDispatchHistory(collection);
    const digest = digestFeedback(doc, { now: Date.now() });

    assert.deepStrictEqual(digest.kpiTerminalEntry, row.terminalEntry);
    assert.equal(digest.kpiTerminalEntry.message, '[done] retried and finished',
      'kpiTerminalEntry must be the LAST terminal marker, matching the aggregation\'s $last');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Metric retention: 6h window ∪ last 6, full state+raw, toolPeak over the FULL list
// ─────────────────────────────────────────────────────────────────────────

describe('digestFeedback: metric retention (persisted digest only)', () => {
  test('keeps metrics newer than now-6h plus the last 6, preserving state and raw; toolPeak is the max over the FULL list', () => {
    requireDigestFeedback();
    const now = at(0).getTime() + 12 * 60 * 60 * 1000; // 12h after T0
    const hb = (hoursBeforeNow, toolCount) => ({
      kind: 'heartbeat',
      message: `[working · running] ${toolCount} tools in ${toolCount}s: Bash×${toolCount} · ${toolCount} total`,
      timestamp: new Date(now - hoursBeforeNow * 60 * 60 * 1000),
    });

    // A busy run: a spike far outside the 6h retention window (the peak), then
    // a long quiet stretch, then 8 recent beats inside 6h (more than the last-6 rule keeps alone).
    const oldSpike = hb(10, 999); // 10h before now: OUTSIDE 6h window, must still set toolPeak
    const recent = Array.from({ length: 8 }, (_, i) => hb(5 - i * 0.5, i + 1)); // 5h..1.5h before now, ascending toolCount

    const feedback = [oldSpike, ...recent];
    const doc = rawDoc({ feedback, dispatchedAt: at(0) });
    const digest = digestFeedback(doc, { now });

    assert.equal(digest.telemetry.toolPeak, 999, 'toolPeak must be the max over the FULL list, including metrics outside retention');

    const within6h = recent.filter(e => (now - e.timestamp.getTime()) <= 6 * 60 * 60 * 1000);
    const last6 = feedback.slice(-6);
    const expectedRetainedCount = new Set([...within6h, ...last6].map(e => e.timestamp.getTime())).size;
    assert.equal(digest.telemetry.metrics.length, expectedRetainedCount);

    assert.ok(!digest.telemetry.metrics.some(m => m.timestamp === oldSpike.timestamp.toISOString()),
      'the old spike itself must be trimmed by retention even though it still sets toolPeak');

    for (const m of digest.telemetry.metrics) {
      assert.ok('state' in m && 'raw' in m, 'retained metrics must be full parseHeartbeat() objects, including state and raw');
    }
  });

  // Ledger L3: the "last 6" half of the union must apply even when ALL of
  // them are outside the 6h window (mutant #18: dropping the last-6 union
  // entirely, and mutant #20: keeping the last 3 instead of the last 6, both
  // survived because the prior fixture's last 6 all happened to also fall
  // inside the 6h window).
  test('the last 6 heartbeats are kept even when every one of them lies outside the 6h window (L3)', () => {
    requireDigestFeedback();
    const now = at(0).getTime() + 24 * 60 * 60 * 1000; // now = T0 + 24h
    const hb = (offsetSec, toolCount) => ({
      kind: 'heartbeat',
      message: `[working · running] ${toolCount} tools in ${toolCount}s: Bash×${toolCount} · ${toolCount} total`,
      timestamp: at(offsetSec),
    });
    // Exactly 6 heartbeats, all clustered near T0 — ~24h before `now`, far
    // outside the 6h retention window. None qualifies via the window alone.
    const feedback = Array.from({ length: 6 }, (_, i) => hb(i, i + 1));
    const doc = rawDoc({ feedback, dispatchedAt: at(0) });
    const digest = digestFeedback(doc, { now });

    assert.equal(digest.telemetry.metrics.length, 6,
      'the last 6 must be kept via the union even though every one of them is outside the 6h window');
  });

  // Ledger L4: the exact `now - PULSE_MAX_WINDOW_MS` (6h) boundary.
  // Chosen: INCLUSIVE (`timestamp >= cutoff`), matching `retainMetrics`'s
  // existing implementation (`lib/digest-feedback.js:263`). No other
  // production call site pins a direction — `PULSE_MAX_WINDOW_MS`'s only
  // other use (`lib/live-console.js`) is a UI zoom-span rung, not a
  // retention filter — so this test documents and pins the implementation's
  // own existing boundary choice rather than a documented external contract
  // (mutant #24, flipping `>=` to `>`, survived: it is only observable for a
  // metric exactly at the millisecond boundary, which no fixture had).
  test('retention boundary at exactly now - 6h is INCLUSIVE (documented choice) (L4)', () => {
    requireDigestFeedback();
    const now = at(0).getTime() + 7 * 60 * 60 * 1000; // now = T0 + 7h
    const cutoffMs = now - PULSE_MAX_WINDOW_MS; // = T0 + 1h, to the millisecond
    const boundary = {
      kind: 'heartbeat',
      message: '[working · running] 1 tools in 1s: Bash×1 · 1 total',
      timestamp: new Date(cutoffMs),
    };
    // 6 more, chronologically AFTER the boundary row, so `slice(-6)` excludes
    // it — isolating the boundary row to the window check alone.
    const recent = Array.from({ length: 6 }, (_, i) => ({
      kind: 'heartbeat',
      message: `[working · running] ${i + 2} tools in ${i + 2}s: Bash×${i + 2} · ${i + 2} total`,
      timestamp: new Date(cutoffMs + (i + 1) * 60 * 60 * 1000),
    }));
    const feedback = [boundary, ...recent];
    const doc = rawDoc({ feedback, dispatchedAt: at(0) });
    const digest = digestFeedback(doc, { now });

    assert.equal(digest.telemetry.metrics.length, 7, 'the exact-boundary metric must be retained (inclusive)');
    assert.ok(digest.telemetry.metrics.some(m => m.timestamp === boundary.timestamp.toISOString()),
      'the boundary row itself must appear in the retained metrics');
  });

  // Ledger L5: `toolPeak` must use `total ?? toolCount` precedence
  // (`peakToolCount` semantics), not `toolCount` alone (mutant #26 survived:
  // the prior fixture messages always had `total === toolCount`).
  test('toolPeak uses total ?? toolCount precedence on a mixed heartbeat (L5)', () => {
    requireDigestFeedback();
    const doc = rawDoc({
      feedback: [
        { kind: 'heartbeat', message: '[working · running] 3 tools in 3s: Bash×3 · 12 total', timestamp: at(0) },
      ],
    });
    const digest = digestFeedback(doc, { now: Date.now() });
    assert.equal(digest.telemetry.toolPeak, 12, 'toolPeak must prefer `total` over `toolCount` when they differ');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ledger L8: no `undefined` on a message-less / timestamp-less RAW entry
// ─────────────────────────────────────────────────────────────────────────

describe('digestFeedback: message-less / timestamp-less raw entries normalize to null, never undefined (L8)', () => {
  test('a message-less usage entry: kpiUsageEntry.message is null, not undefined (L8)', () => {
    requireDigestFeedback();
    const doc = rawDoc({ feedback: [{ kind: 'usage', timestamp: at(0) }] }); // no `message`
    const digest = digestFeedback(doc, { now: Date.now() });
    assert.ok(digest.kpiUsageEntry, 'a usage entry exists and must be surfaced');
    assertNoUndefined(digest.kpiUsageEntry, 'digest.kpiUsageEntry');
    assert.equal(digest.kpiUsageEntry.message, null);
  });

  test('a timestamp-less terminal entry: kpiTerminalEntry.timestamp is null, not undefined (L8)', () => {
    requireDigestFeedback();
    const doc = rawDoc({ feedback: [{ message: '[done] finished' }] }); // no `timestamp`
    const digest = digestFeedback(doc, { now: Date.now() });
    assert.ok(digest.kpiTerminalEntry, 'a terminal entry exists and must be surfaced');
    assertNoUndefined(digest.kpiTerminalEntry, 'digest.kpiTerminalEntry');
    assert.equal(digest.kpiTerminalEntry.timestamp, null);
  });
});
