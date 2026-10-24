/**
 * LIN-3875: the background precomputes (run paragraph, session summary) spend the shared
 * free-tier key, so on that key they charge the hourly free-tier gate (checkFreeTierGate)
 * right before the generator call. A refusal stores nothing, with no error and no placeholder.
 *
 * Run with: node --test tests/unit/precompute-free-tier-gate.test.js
 * Fully offline: generators and the free-tier store are fakes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createRunParagraphPrecompute } from '../../lib/run-paragraph-hook.js';
import { createSessionSummaryPrecompute } from '../../lib/session-materializer-precompute.js';

const URL_KEY = 'ws-gate';
const SESSION = { sessionId: 's1' };
const DENIAL = { allowed: false, reason: 'limit', remaining: 0, limit: 50, resetsAt: 'x' };

function spyStore(result) {
  const calls = [];
  return { calls, tryUse: async (urlKey) => { calls.push(urlKey); return result; } };
}

function paragraphPath({ freeTierStore, cached = null }) {
  const generated = [];
  const puts = [];
  const errors = [];
  const pre = createRunParagraphPrecompute({
    runParagraphStore: { get: async () => cached, put: async (...a) => { puts.push(a[2]); } },
    buildView: () => ({}),
    freeTierStore,
    generateParagraph: async () => { generated.push(1); return { paragraph: 'p', model: 'm' }; },
    logger: { error: (...a) => errors.push(a) }
  });
  return { pre, generated, puts, errors };
}

function summaryPath({ freeTierStore, cached = null }) {
  const generated = [];
  const puts = [];
  const pre = createSessionSummaryPrecompute({
    sessionSummaryStore: { get: async () => cached, put: async (...a) => { puts.push(a[2]); } },
    isTerminal: () => true,
    hashSessionFn: () => 'h',
    childLoopsFn: () => [],
    freeTierStore,
    generateSummary: async () => { generated.push(1); return { summary: 's', model: 'm' }; }
  });
  return { pre, generated, puts };
}

const PATHS = [
  ['run-paragraph', paragraphPath, { inputHash: 'x' }],
  ['session-summary', summaryPath, { inputHash: 'h' }]
];

for (const [name, build] of PATHS) {
  describe(`${name} precompute free-tier gate (LIN-3875)`, () => {
    test('free key + gate refusal: no generator call, nothing stored, no error', async () => {
      const store = spyStore(DENIAL);
      const p = build({ freeTierStore: store });
      await p.pre(URL_KEY, SESSION, { apiKey: 'k', isFreeTier: true });
      assert.equal(p.generated.length, 0);
      assert.deepEqual(p.puts, []);
      assert.deepEqual(p.errors ?? [], []);
      assert.deepEqual(store.calls, [URL_KEY]);
    });

    test('free key + gate allowing: generates and stores as before, charging once', async () => {
      const store = spyStore({ allowed: true });
      const p = build({ freeTierStore: store });
      await p.pre(URL_KEY, SESSION, { apiKey: 'k', isFreeTier: true });
      assert.equal(p.generated.length, 1);
      assert.equal(p.puts.length, 1);
      assert.equal(store.calls.length, 1);
    });

    test('paid key bypasses the gate entirely', async () => {
      const store = spyStore(DENIAL);
      const p = build({ freeTierStore: store });
      await p.pre(URL_KEY, SESSION, { apiKey: 'k', isFreeTier: false });
      assert.equal(p.generated.length, 1);
      assert.equal(store.calls.length, 0);
    });

    test('free key with no freeTierStore wired fails closed', async () => {
      const p = build({ freeTierStore: null });
      await p.pre(URL_KEY, SESSION, { apiKey: 'k', isFreeTier: true });
      assert.equal(p.generated.length, 0);
      assert.deepEqual(p.puts, []);
    });
  });
}

describe('cache hits are never charged (LIN-3875)', () => {
  test('run paragraph: an unchanged input is a hit before the gate', async () => {
    const store = spyStore({ allowed: true });
    const probe = paragraphPath({ freeTierStore: store });
    // Learn the hash the real builder would produce by generating once, then replay it as the cache.
    await probe.pre(URL_KEY, SESSION, { apiKey: 'k', isFreeTier: true });
    const hash = probe.puts[0].inputHash;
    store.calls.length = 0;
    const p = paragraphPath({ freeTierStore: store, cached: { inputHash: hash, final: false } });
    await p.pre(URL_KEY, SESSION, { apiKey: 'k', isFreeTier: true });
    assert.equal(p.generated.length, 0);
    assert.equal(store.calls.length, 0);
  });

  test('session summary: a fresh cached summary is a hit before the gate', async () => {
    const store = spyStore({ allowed: true });
    const p = summaryPath({ freeTierStore: store, cached: { inputHash: 'h' } });
    await p.pre(URL_KEY, SESSION, { apiKey: 'k', isFreeTier: true });
    assert.equal(p.generated.length, 0);
    assert.equal(store.calls.length, 0);
  });
});

describe('server.js wiring census (LIN-3875)', () => {
  test('both precompute factory calls receive the shared freeTierStore', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    for (const factory of ['createRunParagraphPrecompute', 'createSessionSummaryPrecompute']) {
      const m = src.match(new RegExp(`= ${factory}\\(\\{([\\s\\S]*?)\\n\\}\\)`));
      assert.ok(m, `${factory} call found`);
      assert.match(m[1], /\bfreeTierStore\b/, `${factory} is wired with freeTierStore`);
    }
  });
});
