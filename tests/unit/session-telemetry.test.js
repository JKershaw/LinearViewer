/**
 * Unit tests for lib/session-telemetry.js (LIN-594).
 *
 * Run with: node --test tests/unit/session-telemetry.test.js
 *
 * The session/run telemetry seam: a tolerant, read-only parser over a loop's
 * `feedback[]` that derives `{ runtime, metrics[], producedArtifacts[], model? }`.
 * Cases are pinned to the REAL captured marker strings (docs/proxy-integration.md,
 * docs/autopilot-experiment.md, lib/prompts/autopilot-kickoff.js, and the ticket)
 * plus malformed/partial inputs that must be skipped without throwing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  parseHeartbeat,
  parseHeartbeats,
  parseEvidenceArtifacts,
  parseModel,
  deriveRuntime,
  buildRunTelemetry,
  buildSessionTelemetry,
} from '../../lib/session-telemetry.js';

describe('parseHeartbeat — real marker shapes', () => {
  test('compact form: "[working] 6 tools/32s · alive"', () => {
    const m = parseHeartbeat('[working] 6 tools/32s · alive');
    assert.equal(m.toolCount, 6);
    assert.equal(m.elapsedSeconds, 32);
    assert.equal(m.breakdown, null);
    assert.equal(m.total, null);
    assert.equal(m.state, null);
  });

  test('rich form with breakdown: "12 tools in 8m 11s: Bash×7, Read×2, Edit×2, Write×1 · 15 total"', () => {
    const m = parseHeartbeat('12 tools in 8m 11s: Bash×7, Read×2, Edit×2, Write×1 · 15 total');
    assert.equal(m.toolCount, 12);
    assert.equal(m.elapsedSeconds, 8 * 60 + 11);
    assert.deepEqual(m.breakdown, { Bash: 7, Read: 2, Edit: 2, Write: 1 });
    assert.equal(m.total, 15);
  });

  test('running substate: "[working · running] 6 tools in 32s: Bash×6 · 6 total · next heartbeat in ≤1m"', () => {
    const m = parseHeartbeat('[working · running] 6 tools in 32s: Bash×6 · 6 total · next heartbeat in ≤1m');
    assert.equal(m.toolCount, 6);
    assert.equal(m.elapsedSeconds, 32);
    assert.deepEqual(m.breakdown, { Bash: 6 });
    assert.equal(m.total, 6);
    assert.equal(m.state, 'running');
  });

  test('idle beat: "[working] no tool calls in 20s · 0 total · next heartbeat in ≤30s"', () => {
    const m = parseHeartbeat('[working] no tool calls in 20s · 0 total · next heartbeat in ≤30s');
    assert.equal(m.toolCount, 0);
    assert.equal(m.elapsedSeconds, 20);
    assert.equal(m.total, 0);
    assert.equal(m.state, 'idle');
  });

  test('proxy-doc form: "[working] 6 tools in 32s: Bash×6 · next heartbeat in ≤1m"', () => {
    const m = parseHeartbeat('[working] 6 tools in 32s: Bash×6 · next heartbeat in ≤1m');
    assert.equal(m.toolCount, 6);
    assert.equal(m.elapsedSeconds, 32);
    assert.deepEqual(m.breakdown, { Bash: 6 });
    assert.equal(m.total, null);
  });
});

describe('parseHeartbeat — tolerance', () => {
  test('non-heartbeat messages return null', () => {
    assert.equal(parseHeartbeat('[done] Task completed in 45s'), null);
    assert.equal(parseHeartbeat('[evidence] Pull request · 3 mentions'), null);
    assert.equal(parseHeartbeat('just some recap prose'), null);
    assert.equal(parseHeartbeat(''), null);
    assert.equal(parseHeartbeat(undefined), null);
    assert.equal(parseHeartbeat(null), null);
    assert.equal(parseHeartbeat(42), null);
  });

  test('does NOT mistake "5 tools" prose without an in/slash window for a beat', () => {
    assert.equal(parseHeartbeat('used 5 tools earlier'), null);
  });

  test('partial/malformed beat: missing elapsed still yields a metric, no throw', () => {
    const m = parseHeartbeat('[working] 3 tools');
    assert.equal(m.toolCount, 3);
    assert.equal(m.elapsedSeconds, null);
  });

  test('"Linux2"-style ASCII text never produces a phantom breakdown', () => {
    const m = parseHeartbeat('[working] 1 tools/5s · Linux2 box');
    assert.equal(m.breakdown, null);
  });
});

describe('parseHeartbeats', () => {
  test('parses each heartbeat in order, skipping non-beats', () => {
    const feedback = [
      { message: '[started] session abc · tty 3' },
      { message: '[working] no tool calls in 20s · 0 total', timestamp: 't1' },
      { message: '[working · running] 6 tools in 32s: Bash×6 · 6 total', timestamp: 't2' },
      { message: '[done] Task completed in 55s' },
    ];
    const metrics = parseHeartbeats(feedback);
    assert.equal(metrics.length, 2);
    assert.equal(metrics[0].toolCount, 0);
    assert.equal(metrics[0].timestamp, 't1');
    assert.equal(metrics[1].toolCount, 6);
    assert.equal(metrics[1].state, 'running');
  });

  test('non-array input returns []', () => {
    assert.deepEqual(parseHeartbeats(undefined), []);
    assert.deepEqual(parseHeartbeats(null), []);
    assert.deepEqual(parseHeartbeats('nope'), []);
  });
});

describe('parseEvidenceArtifacts', () => {
  test('reads the structured url field of an [evidence] entry', () => {
    const feedback = [
      {
        message: '[evidence] Pull request · 3 mentions',
        url: 'https://github.com/org/repo/pull/286',
        urlLabel: null,
        timestamp: 'ts',
      },
    ];
    const artifacts = parseEvidenceArtifacts(feedback);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].url, 'https://github.com/org/repo/pull/286');
    assert.equal(artifacts[0].label, 'Pull request');
    assert.equal(artifacts[0].mentions, 3);
    assert.equal(artifacts[0].timestamp, 'ts');
  });

  test('reads a URL embedded in the message text', () => {
    const feedback = [
      { message: '[evidence] CI run https://github.com/org/repo/actions/runs/99 passed' },
    ];
    const artifacts = parseEvidenceArtifacts(feedback);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].url, 'https://github.com/org/repo/actions/runs/99');
  });

  test('prefers urlLabel over the text label, and dedupes structured + text URLs', () => {
    const feedback = [
      {
        message: '[evidence] PR https://github.com/org/repo/pull/286',
        url: 'https://github.com/org/repo/pull/286',
        urlLabel: 'Pull request #286',
      },
    ];
    const artifacts = parseEvidenceArtifacts(feedback);
    assert.equal(artifacts.length, 1); // deduped by URL
    assert.equal(artifacts[0].label, 'Pull request #286');
  });

  test('ignores non-evidence entries and entries with no URL', () => {
    const feedback = [
      { message: '[working] 6 tools/32s · alive' },
      { message: '[evidence] mentioned but no link' },
    ];
    assert.deepEqual(parseEvidenceArtifacts(feedback), []);
  });

  test('non-array input returns []', () => {
    assert.deepEqual(parseEvidenceArtifacts(undefined), []);
  });
});

describe('parseModel', () => {
  test('omitted (null) when no runner emission exists', () => {
    const feedback = [
      { message: '[started] session abc · tty 3' },
      { message: '[working] 6 tools/32s · alive' },
      { message: '[done] Task completed in 45s' },
    ];
    assert.equal(parseModel(feedback), null);
  });

  test('forward-compat: reads "· model <id>" appended to the [started] marker', () => {
    const feedback = [
      { message: '[started] session abc · tty 3 · model claude-opus-4-8' },
    ];
    assert.equal(parseModel(feedback), 'claude-opus-4-8');
  });

  test('does not infer a model from non-[started] markers', () => {
    const feedback = [{ message: '[working] running model claude-opus-4-8' }];
    assert.equal(parseModel(feedback), null);
  });

  test('non-array input returns null', () => {
    assert.equal(parseModel(undefined), null);
  });
});

describe('deriveRuntime', () => {
  test('runtime from dispatchedAt → completedAt, with [done] duration as cross-check', () => {
    const feedback = [{ message: '[done] Task completed in 55s' }];
    const rt = deriveRuntime('2026-06-22T10:00:00.000Z', '2026-06-22T10:00:55.000Z', feedback);
    assert.equal(rt.ms, 55_000);
    assert.deepEqual(rt.crossCheck, { seconds: 55, ms: 55_000, raw: '55s' });
  });

  test('"landed in 3s" cross-check variant', () => {
    const feedback = [{ message: '[done] landed in 3s' }];
    const rt = deriveRuntime('2026-06-22T10:00:00.000Z', '2026-06-22T10:00:03.000Z', feedback);
    assert.equal(rt.crossCheck.seconds, 3);
  });

  test('null runtime while the run is still open (no completedAt)', () => {
    const rt = deriveRuntime('2026-06-22T10:00:00.000Z', null, []);
    assert.equal(rt.ms, null);
    assert.equal(rt.crossCheck, null);
  });

  test('null runtime when timestamps are invalid', () => {
    assert.equal(deriveRuntime('not-a-date', 'also-bad', []).ms, null);
  });
});

describe('buildRunTelemetry', () => {
  test('derives runtime from dispatchedAt → terminal marker timestamp', () => {
    const run = {
      dispatchedAt: '2026-06-22T10:00:00.000Z',
      feedback: [
        { message: '[working] 6 tools in 32s: Bash×6 · 6 total', timestamp: '2026-06-22T10:00:32.000Z' },
        { message: '[evidence] Pull request · 3 mentions', url: 'https://github.com/org/repo/pull/286' },
        { message: '[done] Task completed in 55s', timestamp: '2026-06-22T10:00:55.000Z' },
      ],
    };
    const t = buildRunTelemetry(run);
    assert.equal(t.runtime.ms, 55_000);
    assert.equal(t.metrics.length, 1);
    assert.equal(t.metrics[0].toolCount, 6);
    assert.equal(t.producedArtifacts.length, 1);
    assert.equal(t.producedArtifacts[0].url, 'https://github.com/org/repo/pull/286');
    assert.ok(!('model' in t)); // omitted until the runner emits it
  });

  test('empty run is tolerated', () => {
    const t = buildRunTelemetry({});
    assert.equal(t.runtime.ms, null);
    assert.deepEqual(t.metrics, []);
    assert.deepEqual(t.producedArtifacts, []);
  });

  test('model field included when a [started] marker carries it', () => {
    const t = buildRunTelemetry({
      dispatchedAt: '2026-06-22T10:00:00.000Z',
      feedback: [{ message: '[started] session abc · model claude-opus-4-8' }],
    });
    assert.equal(t.model, 'claude-opus-4-8');
  });
});

describe('buildSessionTelemetry', () => {
  test('runtime from the assembled session window; metrics/artifacts aggregate across loops', () => {
    const session = {
      dispatchedAt: '2026-06-22T10:00:00.000Z',
      completedAt: '2026-06-22T10:05:00.000Z',
      loops: [
        { feedback: [{ message: '[working] 6 tools/32s · alive' }] },
        {
          feedback: [
            { message: '12 tools in 8m 11s: Bash×7, Read×2, Edit×2, Write×1 · 15 total' },
            { message: '[evidence] Pull request', url: 'https://github.com/org/repo/pull/286' },
          ],
        },
      ],
    };
    const t = buildSessionTelemetry(session);
    assert.equal(t.runtime.ms, 5 * 60_000);
    assert.equal(t.metrics.length, 2);
    assert.equal(t.producedArtifacts.length, 1);
  });

  test('empty session is tolerated', () => {
    const t = buildSessionTelemetry({});
    assert.equal(t.runtime.ms, null);
    assert.deepEqual(t.metrics, []);
    assert.deepEqual(t.producedArtifacts, []);
  });
});
