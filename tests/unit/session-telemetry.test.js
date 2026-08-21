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
  parseResources,
  parseDecision,
  parseDecisions,
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

  test('LIN-2113: cacheCreation1hInputTokens passes through USAGE_NUMBER_FIELDS like the other number fields', () => {
    const feedback = [{ message: usageMessage({ cacheCreation1hInputTokens: 90210 }), kind: 'usage' }];
    const usage = parseUsage(feedback);
    assert.strictEqual(usage.cacheCreation1hInputTokens, 90210);
  });

  test('LIN-2113: an absent cacheCreation1hInputTokens does not add the key at all', () => {
    const usage = parseUsage([{ message: usageMessage(), kind: 'usage' }]);
    assert.strictEqual('cacheCreation1hInputTokens' in usage, false);
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

describe('parseResources (LIN-1789)', () => {
  const resourcesMessage = (overrides = {}) =>
    `[resources] ${JSON.stringify({
      peakRssBytes: 536870912,
      hostMemAvailableBytes: 2147483648,
      hostMemTotalBytes: 8589934592,
      hostSwapUsedBytes: 0,
      oomKillDelta: 0,
      loadAvg1: 1.5,
      cpuCount: 4,
      activeSessionCount: 2,
      cloneDiskBytes: 1073741824,
      cloneCount: 3,
      ...overrides,
    })}`;

  test('omitted (null) when no kind:"resources" entry exists', () => {
    const feedback = [
      { message: '[started] session abc · tty 3' },
      { message: '[working] 6 tools/32s · alive', kind: 'heartbeat' },
    ];
    assert.equal(parseResources(feedback), null);
  });

  test('parses a well-formed kind:"resources" entry, whitelisting exactly the ten numeric fields', () => {
    const feedback = [{ message: resourcesMessage(), kind: 'resources' }];
    const resources = parseResources(feedback);
    assert.deepEqual(resources, {
      peakRssBytes: 536870912,
      hostMemAvailableBytes: 2147483648,
      hostMemTotalBytes: 8589934592,
      hostSwapUsedBytes: 0,
      oomKillDelta: 0,
      loadAvg1: 1.5,
      cpuCount: 4,
      activeSessionCount: 2,
      cloneDiskBytes: 1073741824,
      cloneCount: 3,
    });
  });

  test('malformed JSON payload is tolerated, never throws', () => {
    const feedback = [{ message: '[resources] {"peakRssBytes":1, not-json', kind: 'resources' }];
    assert.doesNotThrow(() => parseResources(feedback));
    assert.equal(parseResources(feedback), null);
  });

  test('truncated JSON payload (e.g. cut at the message-length cap) is tolerated, never throws', () => {
    const feedback = [{ message: '[resources] {"peakRssBytes":536870912,"hostMemAvailableBytes":21', kind: 'resources' }];
    assert.doesNotThrow(() => parseResources(feedback));
    assert.equal(parseResources(feedback), null);
  });

  test('empty object payload is tolerated and yields null (no fields to attach)', () => {
    const feedback = [{ message: '[resources] {}', kind: 'resources' }];
    assert.equal(parseResources(feedback), null);
  });

  test('absent message on a kind:"resources" entry is tolerated', () => {
    const feedback = [{ kind: 'resources' }];
    assert.doesNotThrow(() => parseResources(feedback));
    assert.equal(parseResources(feedback), null);
  });

  test('unrecognized fields on the payload are dropped, not copied through', () => {
    const feedback = [{
      message: `[resources] ${JSON.stringify({
        peakRssBytes: 536870912,
        vmHwmRaw: '524288 kB',
        hostname: 'worker-7',
        arch: 'x86_64',
      })}`,
      kind: 'resources',
    }];
    const resources = parseResources(feedback);
    assert.deepEqual(Object.keys(resources), ['peakRssBytes']);
  });

  test('non-array feedback input returns null', () => {
    assert.equal(parseResources(undefined), null);
  });

  test('top-level-array JSON payload is tolerated, never throws — the Array.isArray(payload) guard', () => {
    const feedback = [{ message: '[resources] [1,2,3]', kind: 'resources' }];
    assert.doesNotThrow(() => parseResources(feedback));
    assert.equal(parseResources(feedback), null);
  });

  test('last-entry-wins semantics: the LAST kind:"resources" entry wins, never merged', () => {
    const feedback = [
      { message: resourcesMessage({ peakRssBytes: 100 }), kind: 'resources' },
      { message: resourcesMessage({ peakRssBytes: 536870912 }), kind: 'resources' },
    ];
    assert.equal(parseResources(feedback).peakRssBytes, 536870912);
  });

  // Verified by hand during review (cases E and H) but unpinned — a future
  // refactor of the `Number.isFinite` gate or the `if (parsed)` guard would
  // regress either silently. LIN-1789 close-out ledger items 7.
  test('non-numeric values are dropped field-by-field, never coerced', () => {
    const feedback = [{
      message: `[resources] ${JSON.stringify({
        peakRssBytes: '536870912', // numeric-looking STRING — not coerced
        hostMemAvailableBytes: null,
        hostMemTotalBytes: true,
        hostSwapUsedBytes: { bytes: 0 },
        oomKillDelta: [0],
        loadAvg1: 1.5, // the one genuinely numeric field
      })}`,
      kind: 'resources',
    }];
    const resources = parseResources(feedback);
    assert.deepEqual(resources, { loadAvg1: 1.5 });
  });

  test('non-finite numeric values (NaN/Infinity, arriving as JSON null) are dropped', () => {
    // JSON.stringify turns NaN/Infinity into null, so this is the shape that
    // actually reaches the wire — Number.isFinite rejects it either way.
    const feedback = [{
      message: `[resources] ${JSON.stringify({ peakRssBytes: NaN, cpuCount: Infinity, cloneCount: 3 })}`,
      kind: 'resources',
    }];
    assert.deepEqual(parseResources(feedback), { cloneCount: 3 });
  });

  test('a malformed entry AFTER a valid one does not clobber it — last PARSEABLE entry wins', () => {
    const feedback = [
      { message: resourcesMessage({ peakRssBytes: 536870912 }), kind: 'resources' },
      { message: '[resources] {"peakRssBytes":1, not-json', kind: 'resources' },
    ];
    assert.equal(parseResources(feedback).peakRssBytes, 536870912);
  });

  test('an unrecognized-fields-only entry AFTER a valid one does not clobber it either', () => {
    const feedback = [
      { message: resourcesMessage({ peakRssBytes: 536870912 }), kind: 'resources' },
      { message: '[resources] {"vmHwmRaw":"524288 kB"}', kind: 'resources' },
    ];
    assert.equal(parseResources(feedback).peakRssBytes, 536870912);
  });

  test('ignores an entry whose kind is not "resources" even if the message looks like a resources payload', () => {
    const feedback = [{ message: resourcesMessage(), kind: 'assistant-text' }];
    assert.equal(parseResources(feedback), null);
  });

  test('an entry with no kind at all is tolerated, never matched', () => {
    const feedback = [{ message: resourcesMessage() }];
    assert.equal(parseResources(feedback), null);
  });
});

describe('parseDecision (LIN-2181)', () => {
  const decisionMessage = (overrides = {}) =>
    `[decision] ${JSON.stringify({
      decision_id: 'd-1',
      question: 'Proceed with the migration?',
      options: [
        { id: 'yes', label: 'Proceed' },
        { id: 'no', label: 'Hold', cost: 2 },
      ],
      recommended: 'yes',
      free_text: true,
      if_unanswered: { disposition: 'a', note: 'default to hold' },
      ...overrides,
    })}`;

  test('parses a well-formed decision payload, whitelisting exactly the known fields', () => {
    const decision = parseDecision(decisionMessage());
    assert.deepEqual(decision, {
      decision_id: 'd-1',
      question: 'Proceed with the migration?',
      options: [
        { id: 'yes', label: 'Proceed' },
        { id: 'no', label: 'Hold', cost: 2 },
      ],
      recommended: 'yes',
      free_text: true,
      if_unanswered: { disposition: 'a', note: 'default to hold' },
    });
  });

  test('malformed JSON returns null, never throws', () => {
    assert.doesNotThrow(() => parseDecision('[decision] {"decision_id":"d-1", not-json'));
    assert.equal(parseDecision('[decision] {"decision_id":"d-1", not-json'), null);
  });

  test('a non-string message is tolerated', () => {
    assert.doesNotThrow(() => parseDecision(undefined));
    assert.equal(parseDecision(undefined), null);
  });

  test('no "{" in the message returns null', () => {
    assert.equal(parseDecision('[decision] no payload here'), null);
  });

  test('a non-object (array) payload is rejected', () => {
    assert.equal(parseDecision('[decision] [1,2,3]'), null);
  });

  test('unknown top-level keys are dropped, not carried through', () => {
    const message = `[decision] ${JSON.stringify({ decision_id: 'd-1', bogus_field: 'nope' })}`;
    const decision = parseDecision(message);
    assert.deepEqual(decision, { decision_id: 'd-1' });
    assert.ok(!('bogus_field' in decision));
  });

  test('missing decision_id drops the WHOLE entry', () => {
    const message = `[decision] ${JSON.stringify({ question: 'no id here' })}`;
    assert.equal(parseDecision(message), null);
  });

  test('a non-string decision_id is treated as missing', () => {
    const message = `[decision] ${JSON.stringify({ decision_id: 42 })}`;
    assert.equal(parseDecision(message), null);
  });

  test('recommended not present in options[].id drops only the FIELD, keeping the entry', () => {
    const message = decisionMessage({ recommended: 'not-an-option' });
    const decision = parseDecision(message);
    assert.ok(decision);
    assert.equal(decision.decision_id, 'd-1');
    assert.ok(!('recommended' in decision));
  });

  test('recommended is dropped when there are no options at all to validate against', () => {
    const message = `[decision] ${JSON.stringify({ decision_id: 'd-1', recommended: 'yes' })}`;
    const decision = parseDecision(message);
    assert.ok(!('recommended' in decision));
  });

  test('options[] is bounded to a small cap (10)', () => {
    const options = Array.from({ length: 25 }, (_, i) => ({ id: `opt-${i}`, label: `Option ${i}` }));
    const message = `[decision] ${JSON.stringify({ decision_id: 'd-1', options })}`;
    const decision = parseDecision(message);
    assert.equal(decision.options.length, 10);
  });

  test('a malformed option (missing id/label, wrong shape) is skipped, not the whole array', () => {
    const message = `[decision] ${JSON.stringify({
      decision_id: 'd-1',
      options: [{ id: 'yes', label: 'Proceed' }, { id: 'no' }, 'not-an-object', { label: 'no id' }],
    })}`;
    const decision = parseDecision(message);
    assert.deepEqual(decision.options, [{ id: 'yes', label: 'Proceed' }]);
  });

  test('an empty options array yields no options field', () => {
    const message = `[decision] ${JSON.stringify({ decision_id: 'd-1', options: [] })}`;
    const decision = parseDecision(message);
    assert.ok(!('options' in decision));
  });

  test('a non-boolean free_text is dropped', () => {
    const message = `[decision] ${JSON.stringify({ decision_id: 'd-1', free_text: 'yes' })}`;
    const decision = parseDecision(message);
    assert.ok(!('free_text' in decision));
  });

  test('if_unanswered stays opaque — unknown-to-us keys pass through with no enum validation', () => {
    const message = `[decision] ${JSON.stringify({
      decision_id: 'd-1',
      if_unanswered: { disposition: 'not-a-real-enum-value', anything: 'goes' },
    })}`;
    const decision = parseDecision(message);
    assert.deepEqual(decision.if_unanswered, { disposition: 'not-a-real-enum-value', anything: 'goes' });
  });

  test('a non-object if_unanswered (array or scalar) is dropped', () => {
    const arrayMessage = `[decision] ${JSON.stringify({ decision_id: 'd-1', if_unanswered: [1, 2] })}`;
    assert.ok(!('if_unanswered' in parseDecision(arrayMessage)));
    const scalarMessage = `[decision] ${JSON.stringify({ decision_id: 'd-1', if_unanswered: 'stop' })}`;
    assert.ok(!('if_unanswered' in parseDecision(scalarMessage)));
  });
});

describe('parseDecisions (LIN-2181)', () => {
  test('omitted (empty array) when no kind:"decision" entry exists', () => {
    assert.deepEqual(parseDecisions([]), []);
    assert.deepEqual(parseDecisions([{ message: '[decision] {"decision_id":"d-1"}', kind: 'assistant-text' }]), []);
  });

  test('a non-array feedback input is tolerated', () => {
    assert.doesNotThrow(() => parseDecisions(undefined));
    assert.deepEqual(parseDecisions(undefined), []);
  });

  test('scans only kind:"decision" entries, ignoring everything else', () => {
    const feedback = [
      { message: '[usage] {"model":"x"}', kind: 'usage' },
      { message: '[decision] {"decision_id":"d-1","question":"go?"}', kind: 'decision' },
      { message: '[heartbeat] [working] 1 tools/1s', kind: 'heartbeat' },
    ];
    const decisions = parseDecisions(feedback);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision_id, 'd-1');
  });

  test('a malformed decision entry is skipped, never throws, never breaks a sibling entry', () => {
    const feedback = [
      { message: '[decision] {"decision_id":"d-1"}', kind: 'decision' },
      { message: '[decision] {"decision_id":"d-2", not-json', kind: 'decision' },
    ];
    assert.doesNotThrow(() => parseDecisions(feedback));
    const decisions = parseDecisions(feedback);
    assert.deepEqual(decisions.map((d) => d.decision_id), ['d-1']);
  });

  test('dedupes by decision_id with LAST-wins semantics across two entries sharing an id', () => {
    const feedback = [
      { message: '[decision] {"decision_id":"d-1","question":"first ask"}', kind: 'decision' },
      { message: '[decision] {"decision_id":"d-1","question":"re-answered"}', kind: 'decision' },
    ];
    const decisions = parseDecisions(feedback);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].question, 're-answered');
  });

  test('distinct decision_ids each survive as their own entry', () => {
    const feedback = [
      { message: '[decision] {"decision_id":"d-1"}', kind: 'decision' },
      { message: '[decision] {"decision_id":"d-2"}', kind: 'decision' },
    ];
    const decisions = parseDecisions(feedback);
    assert.deepEqual(decisions.map((d) => d.decision_id).sort(), ['d-1', 'd-2']);
  });
});

describe('decision parsing does not disturb sibling feedback-kind handling (LIN-2181)', () => {
  const mixedFeedback = [
    { message: '[working] 3 tools/12s', kind: 'heartbeat' },
    {
      message: `[usage] ${JSON.stringify({ harness: 'claude-code', model: 'claude-opus-4-8', inputTokens: 10, outputTokens: 20 })}`,
      kind: 'usage',
    },
    {
      message: `[resources] ${JSON.stringify({ peakRssBytes: 12345 })}`,
      kind: 'resources',
    },
    { message: '[decision] {"decision_id":"d-1","question":"proceed?"}', kind: 'decision' },
    { message: '[evidence] https://example.com/report · 2 mentions', kind: 'evidence' },
  ];

  test('parseUsage still finds the usage entry, unaffected by the decision entry in the same feedback array', () => {
    const usage = parseUsage(mixedFeedback);
    assert.ok(usage);
    assert.equal(usage.model, 'claude-opus-4-8');
  });

  test('parseResources still finds the resources entry, unaffected by the decision entry', () => {
    const resources = parseResources(mixedFeedback);
    assert.deepEqual(resources, { peakRssBytes: 12345 });
  });

  test('parseHeartbeats still finds the heartbeat, unaffected by the decision entry', () => {
    const heartbeats = parseHeartbeats(mixedFeedback);
    assert.equal(heartbeats.length, 1);
    assert.equal(heartbeats[0].toolCount, 3);
  });

  test('parseEvidenceArtifacts still finds the evidence entry, unaffected by the decision entry', () => {
    const artifacts = parseEvidenceArtifacts(mixedFeedback);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].url, 'https://example.com/report');
  });

  test('parseDecisions finds exactly the one decision entry in the same mixed feedback array', () => {
    const decisions = parseDecisions(mixedFeedback);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision_id, 'd-1');
  });

  test('a decision-kinded entry whose message looks like a usage/resources payload is not picked up by those parsers', () => {
    const feedback = [
      { message: `[decision] ${JSON.stringify({ decision_id: 'd-1', inputTokens: 999 })}`, kind: 'decision' },
    ];
    assert.equal(parseUsage(feedback), null);
    assert.equal(parseResources(feedback), null);
  });

  test('buildRunTelemetry composite output is unaffected by a decision entry (Phase 1 stays inert — no decisions field attached yet)', () => {
    const telemetry = buildRunTelemetry({ dispatchedAt: '2026-06-22T10:00:00.000Z', feedback: mixedFeedback });
    assert.ok(!('decisions' in telemetry));
    assert.equal(telemetry.usage.model, 'claude-opus-4-8');
    assert.deepEqual(telemetry.resources, { peakRssBytes: 12345 });
  });
});

describe('parseHeartbeats — decision-prose collision (LIN-2182)', () => {
  // Reproduced live during LIN-2182 research: decision `question`/`options[].label`
  // prose can incidentally match HEARTBEAT_HINT (e.g. a batching question phrased as
  // "N tools in ..."), minting a phantom heartbeat metric from human prose that was
  // never a heartbeat. `parseHeartbeats` must exclude `kind === 'decision'` entries.
  test('a decision question phrased as "N tools in ..." mints no phantom heartbeat', () => {
    const feedback = [
      {
        kind: 'decision',
        message: `[decision] ${JSON.stringify({
          decision_id: 'd-1',
          question: 'batch 3 tools in one turn, or keep them serial?',
        })}`,
      },
    ];
    assert.deepEqual(parseHeartbeats(feedback), []);
  });

  test('a decision option label phrased as "N tools in ..." mints no phantom heartbeat', () => {
    const feedback = [
      {
        kind: 'decision',
        message: `[decision] ${JSON.stringify({
          decision_id: 'd-1',
          question: 'how should we proceed?',
          options: [{ id: 'parallel', label: 'run 5 tools in parallel' }],
        })}`,
      },
    ];
    assert.deepEqual(parseHeartbeats(feedback), []);
  });

  test('the phantom is confirmed reachable via buildRunTelemetry().metrics — pinned empty', () => {
    const feedback = [
      {
        kind: 'decision',
        message: `[decision] ${JSON.stringify({
          decision_id: 'd-1',
          question: 'batch 3 tools in one turn, or keep them serial?',
        })}`,
      },
    ];
    const telemetry = buildRunTelemetry({ feedback });
    assert.deepEqual(telemetry.metrics, []);
  });

  test('a real heartbeat in the same feedback array still parses — the exclusion is scoped to kind:"decision" only', () => {
    const feedback = [
      { kind: 'heartbeat', message: '[working] 6 tools in 32s: Bash×6 · 6 total' },
      {
        kind: 'decision',
        message: `[decision] ${JSON.stringify({ decision_id: 'd-1', question: 'batch 3 tools in one turn?' })}`,
      },
    ];
    const metrics = parseHeartbeats(feedback);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].toolCount, 6);
  });

  test('untagged legacy rows (no kind at all) still parse — the exclusion is negative, not a positive allow-list', () => {
    const feedback = [{ message: '[working] 3 tools/12s' }];
    const metrics = parseHeartbeats(feedback);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].toolCount, 3);
  });

  test('kind:"status" beats still parse — the exclusion does not require kind:"heartbeat"', () => {
    const feedback = [{ kind: 'status', message: '[working] 4 tools/10s' }];
    const metrics = parseHeartbeats(feedback);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].toolCount, 4);
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
