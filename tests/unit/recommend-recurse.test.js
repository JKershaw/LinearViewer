/**
 * Unit tests for the recommend recursion (LIN-329).
 *
 * Run with: node --test tests/unit/recommend-recurse.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveRecommendation, describeDescent, armHopSignal, DEFAULT_DEFER_MAX_DEPTH } from '../../lib/recommend-recurse.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// A tiny fake recommender: a map of identifier -> recommendation. `defer` entries
// carry a deferTo; everything else is terminal. computeOne throws "not found" for
// unknown identifiers, mirroring the real per-hop fetch.
function fakeComputeOne(graph) {
  return async (id) => {
    if (!(id in graph)) throw new Error(`Issue not found: ${id}`);
    return { identifier: id, ...graph[id] };
  };
}

describe('resolveRecommendation', () => {
  test('a leaf resolves in one hop (no descent)', async () => {
    const computeOne = fakeComputeOne({
      'LIN-1': { recommendedAction: 'research', prompt: 'do research', deferTo: null }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'LIN-1' });
    assert.strictEqual(out.recommendation.recommendedAction, 'research');
    assert.strictEqual(out.recommendation.prompt, 'do research');
    assert.deepStrictEqual(out.deferredVia, ['LIN-1']);
    assert.strictEqual(out.deferTruncated, false);
    assert.strictEqual(out.deferStopReason, null);
  });

  test('a defer re-enters on the target and returns the terminal node + chain', async () => {
    const computeOne = fakeComputeOne({
      'LIN-318': { recommendedAction: 'defer', prompt: null, deferTo: 'LIN-297' },
      'LIN-297': { recommendedAction: 'research', prompt: 'investigate', deferTo: null }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'LIN-318' });
    assert.strictEqual(out.recommendation.identifier, 'LIN-297', 'returns the TERMINAL identifier');
    assert.strictEqual(out.recommendation.recommendedAction, 'research');
    assert.strictEqual(out.recommendation.prompt, 'investigate');
    assert.deepStrictEqual(out.deferredVia, ['LIN-318', 'LIN-297'], 'breadcrumb: epic → actionable node');
    assert.strictEqual(out.deferTruncated, false);
  });

  test('descends multiple levels to the first real-work node', async () => {
    const computeOne = fakeComputeOne({
      'A': { recommendedAction: 'defer', prompt: null, deferTo: 'B' },
      'B': { recommendedAction: 'defer', prompt: null, deferTo: 'C' },
      'C': { recommendedAction: 'implement', prompt: 'build it', deferTo: null }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'A' });
    assert.strictEqual(out.recommendation.identifier, 'C');
    assert.deepStrictEqual(out.deferredVia, ['A', 'B', 'C']);
  });

  test('node-work terminus: a node that needs breakdown is NOT descended past', async () => {
    const computeOne = fakeComputeOne({
      'EPIC': { recommendedAction: 'breakdown', prompt: 'decompose it', deferTo: null }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'EPIC' });
    assert.strictEqual(out.recommendation.recommendedAction, 'breakdown');
    assert.deepStrictEqual(out.deferredVia, ['EPIC']);
    assert.strictEqual(out.deferTruncated, false);
  });

  test('depth cap stops the descent with a flag and never loops', async () => {
    // An infinite defer chain id -> id+1.
    const computeOne = async (id) => ({
      identifier: id, recommendedAction: 'defer', prompt: null, deferTo: `n${Number(id.slice(1)) + 1}`
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'n0', maxDepth: 4 });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'depth');
    assert.strictEqual(out.deferredVia.length, 4, 'stops exactly at the depth cap');
  });

  test('default depth cap is 10', async () => {
    const computeOne = async (id) => ({
      identifier: id, recommendedAction: 'defer', prompt: null, deferTo: `n${Number(id.slice(1)) + 1}`
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'n0' });
    assert.strictEqual(out.deferredVia.length, DEFAULT_DEFER_MAX_DEPTH);
    assert.strictEqual(DEFAULT_DEFER_MAX_DEPTH, 10);
  });

  test('cycle guard: a defer pointing back at a visited node terminates with a flag', async () => {
    const computeOne = fakeComputeOne({
      'X': { recommendedAction: 'defer', prompt: null, deferTo: 'Y' },
      'Y': { recommendedAction: 'defer', prompt: null, deferTo: 'X' }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'X' });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'cycle');
    assert.deepStrictEqual(out.deferredVia, ['X', 'Y']);
  });

  test('missing/invalid child: an unresolved deferTo stops at the deferring node', async () => {
    const computeOne = fakeComputeOne({
      'P': { recommendedAction: 'defer', prompt: null, deferTo: 'GHOST' }
      // GHOST is absent → computeOne throws "not found"
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'P' });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'unresolved');
    assert.strictEqual(out.recommendation.identifier, 'P', 'stays on the node that deferred');
    assert.strictEqual(out.recommendation.deferTo, 'GHOST', 'the attempted target is available to surface');
  });

  test('a bad START identifier rethrows (first-hop not-found is a real error)', async () => {
    const computeOne = fakeComputeOne({});
    await assert.rejects(
      () => resolveRecommendation({ computeOne, startIdentifier: 'NOPE' }),
      /not found/
    );
  });

  test('onHop fires once per hop with the deferring flag (lets callers stream the descent)', async () => {
    const computeOne = fakeComputeOne({
      'LIN-318': { recommendedAction: 'defer', prompt: null, deferTo: 'LIN-297' },
      'LIN-297': { recommendedAction: 'research', prompt: 'investigate', deferTo: null }
    });
    const hops = [];
    await resolveRecommendation({
      computeOne, startIdentifier: 'LIN-318',
      onHop: (rec, info) => hops.push({ id: rec.identifier, deferring: info.deferring, depth: info.depth })
    });
    assert.deepStrictEqual(hops, [
      { id: 'LIN-318', deferring: true, depth: 0 },
      { id: 'LIN-297', deferring: false, depth: 1 }
    ]);
  });

  test('a delta-forwarding computeOne resolves identically to a plain one (resolver is transport-agnostic)', async () => {
    // Under Option B (LIN-346) the workspace-api computeOne streams each hop's deltas
    // to the client as a side effect, then returns the same structured rec. The
    // resolver must not care: same graph in, same descent out, regardless of streaming.
    const graph = {
      'LIN-318': { recommendedAction: 'defer', prompt: null, deferTo: 'LIN-297' },
      'LIN-297': { recommendedAction: 'research', prompt: 'investigate', deferTo: null }
    };
    const plain = await resolveRecommendation({ computeOne: fakeComputeOne(graph), startIdentifier: 'LIN-318' });

    const streamed = [];
    const forwardingComputeOne = async (id) => {
      const rec = { identifier: id, ...graph[id] };
      // Emit live deltas as a pure side effect (the real path calls sendSSE here).
      streamed.push({ section: 'reasoning', content: `reasoning for ${id}` });
      if (rec.prompt) streamed.push({ section: 'prompt', content: rec.prompt });
      return rec;
    };
    const out = await resolveRecommendation({ computeOne: forwardingComputeOne, startIdentifier: 'LIN-318' });

    assert.deepStrictEqual(out, plain, 'streaming side effects do not change the resolved result');
    // And the side-effect deltas covered every hop (reasoning for both, prompt for the terminal).
    assert.deepStrictEqual(streamed, [
      { section: 'reasoning', content: 'reasoning for LIN-318' },
      { section: 'reasoning', content: 'reasoning for LIN-297' },
      { section: 'prompt', content: 'investigate' }
    ]);
  });

  test('shared deadline stops the descent before the next hop with a timeout flag', async () => {
    let clock = 1000;
    const now = () => clock;
    const computeOne = async (id) => {
      clock += 100; // each hop advances the clock
      return { identifier: id, recommendedAction: 'defer', prompt: null, deferTo: `n${Number(id.slice(1)) + 1}` };
    };
    const out = await resolveRecommendation({
      computeOne, startIdentifier: 'n0', maxDepth: 100, now, deadline: 1250
    });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'timeout');
    // hops run at start-clock 1000 and 1100 (both < 1250); the third is blocked at 1200<1250?
    // 1000→hop(→1100), 1100→hop(→1200), 1200<1250 so another hop(→1300), 1300>=1250 stop.
    assert.ok(out.deferredVia.length >= 1);
  });
});

describe('armHopSignal (LIN-346 gap #3)', () => {
  test('composed signal aborts when the client signal aborts (propagates to the in-flight hop)', () => {
    const client = new AbortController();
    const { signal, release } = armHopSignal({ clientSignal: client.signal });
    assert.strictEqual(signal.aborted, false);
    client.abort();
    assert.strictEqual(signal.aborted, true, 'client disconnect aborts the per-hop signal synchronously');
    release();
  });

  test('honors an already-aborted client signal', () => {
    const client = new AbortController();
    client.abort();
    const { signal, release } = armHopSignal({ clientSignal: client.signal });
    assert.strictEqual(signal.aborted, true);
    release();
  });

  test('composed signal aborts when the descent deadline elapses', async () => {
    const { signal, release } = armHopSignal({ deadline: Date.now() + 20 });
    assert.strictEqual(signal.aborted, false);
    await delay(45);
    assert.strictEqual(signal.aborted, true, 'a stalled hop is interrupted, not just checked between hops');
    release();
  });

  test('uses the REMAINING budget, not a fresh window (deadline - now)', async () => {
    let clock = 1000;
    // deadline already reached → remaining 0 → aborts on the next tick.
    const { signal } = armHopSignal({ deadline: 1000, now: () => clock });
    await delay(5);
    assert.strictEqual(signal.aborted, true);
  });

  test('release() clears the per-hop timer so it cannot leak across hops', async () => {
    const { signal, release } = armHopSignal({ deadline: Date.now() + 20 });
    release(); // hop settled before the deadline
    await delay(45);
    assert.strictEqual(signal.aborted, false, 'a released timer never fires');
  });

  test('with neither a client signal nor a deadline, the signal never fires', async () => {
    const { signal, release } = armHopSignal({});
    await delay(10);
    assert.strictEqual(signal.aborted, false);
    release();
  });
});

describe('describeDescent', () => {
  test('returns null when no descent happened', () => {
    assert.strictEqual(describeDescent(['LIN-1'], { identifier: 'LIN-1', recommendedAction: 'research' }), null);
    assert.strictEqual(describeDescent([], {}), null);
  });

  test('renders a breadcrumb for a real descent', () => {
    const s = describeDescent(['LIN-318', 'LIN-297'], { identifier: 'LIN-297', recommendedAction: 'research' });
    assert.strictEqual(s, 'LIN-318 is a container → descended to LIN-297 (research)');
  });
});
