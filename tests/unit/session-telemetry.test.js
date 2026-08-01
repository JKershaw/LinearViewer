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
  parseUsage,
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

describe('parseUsage (LIN-1425)', () => {
  const usageMessage = (overrides = {}) =>
    `[usage] ${JSON.stringify({
      schema: 1,
      harness: 'claude-code',
      model: 'claude-opus-4-8',
      inputTokens: 5529,
      outputTokens: 25811,
      cacheCreationInputTokens: 145449,
      cacheReadInputTokens: 4588835,
      costUsd: null,
      ...overrides,
    })}`;

  test('omitted (null) when no kind:"usage" entry exists', () => {
    const feedback = [
      { message: '[started] session abc · tty 3' },
      { message: '[working] 6 tools/32s · alive', kind: 'heartbeat' },
    ];
    assert.equal(parseUsage(feedback), null);
  });

  // LIN-1495: the derived cost for the default `usageMessage()` payload, stated as
  // the arithmetic rather than as a magic literal — anthropic/claude-opus-4.8 at
  // prompt 5.00 / completion 25.00 / cacheWrite 6.25 / cacheRead 0.50 USD per 1M.
  const DEFAULT_PAYLOAD_COST = (
    5529 * 5.00
    + 25811 * 25.00
    + 145449 * 6.25
    + 4588835 * 0.50
  ) / 1e6;

  test('parses a well-formed kind:"usage" entry, whitelisting exactly the four token fields + model + lane + costUsd', () => {
    const feedback = [{ message: usageMessage(), kind: 'usage' }];
    const usage = parseUsage(feedback);
    assert.deepEqual(usage, {
      harness: 'claude-code',
      model: 'claude-opus-4-8',
      inputTokens: 5529,
      outputTokens: 25811,
      cacheCreationInputTokens: 145449,
      cacheReadInputTokens: 4588835,
      // LIN-1766: absent from the payload, so null (closed enum, no default lane).
      lane: null,
      // LIN-1495: claude-code posts costUsd: null (it has no native cost), so the
      // figure is derived here from the four token counts + the static rate card.
      costUsd: DEFAULT_PAYLOAD_COST,
    });
    // Assert the exact value, not merely non-null, so an arithmetic regression —
    // a dropped cache tier, a doubled 1e6 divisor — cannot pass.
    assert.equal(usage.costUsd, 3.87639375);
  });

  test('opencode-style entry carries a numeric costUsd through untouched', () => {
    const feedback = [{ message: usageMessage({ harness: 'opencode', costUsd: 0.0421 }), kind: 'usage' }];
    assert.equal(parseUsage(feedback).costUsd, 0.0421);
  });

  test('LIN-1495: a native cost of 0 is authoritative too — never overwritten by a derivation', () => {
    const feedback = [{ message: usageMessage({ harness: 'opencode', costUsd: 0 }), kind: 'usage' }];
    assert.equal(parseUsage(feedback).costUsd, 0);
  });

  test('LIN-1495: an opencode entry whose costUsd is null IS derived when its model resolves', () => {
    const feedback = [{
      message: usageMessage({ harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: null }),
      kind: 'usage',
    }];
    // sonnet-4.6: prompt 3.00 / completion 15.00 / cacheWrite 3.75 / cacheRead 0.30
    assert.equal(parseUsage(feedback).costUsd, (
      5529 * 3.00
      + 25811 * 15.00
      + 145449 * 3.75
      + 4588835 * 0.30
    ) / 1e6);
  });

  test('LIN-1495: a <synthetic> payload with real tokens stays null — unpriceable, never guessed', () => {
    const feedback = [{ message: usageMessage({ model: '<synthetic>' }), kind: 'usage' }];
    const usage = parseUsage(feedback);
    assert.equal(usage.model, '<synthetic>');
    assert.equal(usage.costUsd, null, 'null means unknown; a guessed rate would look authoritative');
  });

  test('LIN-1495: a bare model alias with real tokens stays null (no version, so no rate)', () => {
    assert.equal(parseUsage([{ message: usageMessage({ model: 'opus' }), kind: 'usage' }]).costUsd, null);
  });

  test('LIN-1495: a dated model id is priced after its build-date suffix is stripped', () => {
    const feedback = [{
      message: usageMessage({ model: 'claude-haiku-4-5-20251001', outputTokens: 1_000_000, inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
      kind: 'usage',
    }];
    assert.equal(parseUsage(feedback).costUsd, 5.00); // haiku-4.5 completion rate
  });

  test('LIN-1495: derivation adds no key to the usage object', () => {
    // lane is a parse-time key (assigned before costUsd's derivation branch runs),
    // so its presence here does not weaken this test's intent: the derivation
    // step itself still contributes nothing beyond costUsd.
    const usage = parseUsage([{ message: usageMessage(), kind: 'usage' }]);
    assert.deepEqual(
      Object.keys(usage).sort(),
      ['cacheCreationInputTokens', 'cacheReadInputTokens', 'costUsd', 'harness', 'inputTokens', 'lane', 'model', 'outputTokens'].sort()
    );
  });

  test('cumulative snapshot semantics: the LAST kind:"usage" entry wins, never summed', () => {
    const feedback = [
      { message: usageMessage({ inputTokens: 100, outputTokens: 200 }), kind: 'usage' },
      { message: usageMessage({ inputTokens: 5529, outputTokens: 25811 }), kind: 'usage' },
    ];
    const usage = parseUsage(feedback);
    assert.equal(usage.inputTokens, 5529);
    assert.equal(usage.outputTokens, 25811);
  });

  test('ignores an entry whose kind is not "usage" even if the message looks like a usage payload', () => {
    const feedback = [{ message: usageMessage(), kind: 'assistant-text' }];
    assert.equal(parseUsage(feedback), null);
  });

  test('an entry with no kind at all (pre-LIN-1475 row) is tolerated, never matched', () => {
    const feedback = [{ message: usageMessage() }];
    assert.equal(parseUsage(feedback), null);
  });

  test('malformed JSON payload is tolerated, never throws', () => {
    const feedback = [{ message: '[usage] {"schema":1, not-json', kind: 'usage' }];
    assert.doesNotThrow(() => parseUsage(feedback));
    assert.equal(parseUsage(feedback), null);
  });

  test('truncated JSON payload (e.g. cut at the message-length cap) is tolerated, never throws', () => {
    const feedback = [{ message: '[usage] {"schema":1,"harness":"claude-code","inputTokens":55', kind: 'usage' }];
    assert.doesNotThrow(() => parseUsage(feedback));
    assert.equal(parseUsage(feedback), null);
  });

  test('empty object payload is tolerated and yields null (no fields to attach)', () => {
    const feedback = [{ message: '[usage] {}', kind: 'usage' }];
    assert.equal(parseUsage(feedback), null);
  });

  test('absent message on a kind:"usage" entry is tolerated', () => {
    const feedback = [{ kind: 'usage' }];
    assert.doesNotThrow(() => parseUsage(feedback));
    assert.equal(parseUsage(feedback), null);
  });

  test('vendor-noise fields on the payload are dropped, not copied through', () => {
    const feedback = [{
      message: `[usage] ${JSON.stringify({
        inputTokens: 10,
        outputTokens: 20,
        cache_creation: { ephemeral_5m_input_tokens: 1 },
        server_tool_use: { web_search_requests: 0 },
        service_tier: 'standard',
        speed: 'fast',
        inference_geo: 'us',
      })}`,
      kind: 'usage',
    }];
    const usage = parseUsage(feedback);
    assert.deepEqual(Object.keys(usage).sort(), ['costUsd', 'inputTokens', 'lane', 'outputTokens'].sort());
  });

  test('non-array input returns null', () => {
    assert.equal(parseUsage(undefined), null);
  });

  test('LIN-1766: each closed-enum lane literal passes through unchanged', () => {
    for (const lane of ['subscription', 'api', 'openrouter']) {
      const feedback = [{ message: usageMessage({ lane }), kind: 'usage' }];
      assert.equal(parseUsage(feedback).lane, lane);
    }
  });

  test('LIN-1766: an unrecognized lane string is squashed to null, never passed through raw', () => {
    const feedback = [{ message: usageMessage({ lane: 'aws-bedrock' }), kind: 'usage' }];
    const usage = parseUsage(feedback);
    assert.strictEqual(usage.lane, null);
    assert.ok(!JSON.stringify(usage).includes('aws-bedrock'), 'the unrecognized lane value must not leak anywhere on the returned object');
  });

  test('LIN-1766: non-string lane values (number, object, array, boolean) all squash to null', () => {
    for (const lane of [42, { subscription: true }, ['subscription'], true]) {
      const feedback = [{ message: usageMessage({ lane }), kind: 'usage' }];
      assert.strictEqual(parseUsage(feedback).lane, null);
    }
  });

  test('LIN-1766: an absent lane key parses to null, present as a key rather than missing', () => {
    const feedback = [{ message: usageMessage(), kind: 'usage' }];
    const usage = parseUsage(feedback);
    assert.ok('lane' in usage);
    assert.strictEqual(usage.lane, null);
  });

  test('LIN-1766: [usage] {} still parses to null — lane must never be assigned before the empty-usage guard', () => {
    const feedback = [{ message: '[usage] {}', kind: 'usage' }];
    assert.strictEqual(parseUsage(feedback), null);
  });

  test('LIN-1766: lane coexists with a native (non-derived) costUsd', () => {
    const feedback = [{ message: usageMessage({ harness: 'opencode', lane: 'openrouter', costUsd: 0.0421 }), kind: 'usage' }];
    const usage = parseUsage(feedback);
    assert.strictEqual(usage.lane, 'openrouter');
    assert.strictEqual(usage.costUsd, 0.0421);
  });

  test('LIN-1766: lane coexists with a derived costUsd', () => {
    const feedback = [{ message: usageMessage({ lane: 'subscription' }), kind: 'usage' }];
    const usage = parseUsage(feedback);
    assert.strictEqual(usage.lane, 'subscription');
    assert.strictEqual(usage.costUsd, DEFAULT_PAYLOAD_COST);
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

  test('LIN-1425: usage field included, omitted (not null), when a kind:"usage" entry is/isn\'t present', () => {
    const withUsage = buildRunTelemetry({
      dispatchedAt: '2026-06-22T10:00:00.000Z',
      feedback: [{
        message: '[usage] {"schema":1,"harness":"claude-code","model":"claude-opus-4-8","inputTokens":1,"outputTokens":2,"cacheCreationInputTokens":3,"cacheReadInputTokens":4,"costUsd":null}',
        kind: 'usage',
      }],
    });
    assert.deepEqual(withUsage.usage, {
      harness: 'claude-code',
      model: 'claude-opus-4-8',
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 4,
      lane: null,
      // LIN-1495: derived, since claude-code reports no native cost —
      // (1×5.00 + 2×25.00 + 3×6.25 + 4×0.50) / 1e6
      costUsd: 0.00007575,
    });

    const withoutUsage = buildRunTelemetry({
      dispatchedAt: '2026-06-22T10:00:00.000Z',
      feedback: [{ message: '[working] 6 tools/32s · alive' }],
    });
    assert.ok(!('usage' in withoutUsage));
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
