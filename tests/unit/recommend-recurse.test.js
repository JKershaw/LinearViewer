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

  test('noDescend resolves the start node in one hop and never follows a defer (LIN-365)', async () => {
    // A parent that would normally defer into its open child. With noDescend the
    // resolver must stop at the parent — the child is never fetched or dispatched.
    let childFetched = false;
    const computeOne = async (id) => {
      if (id === 'CHILD') { childFetched = true; return { identifier: id, recommendedAction: 'research', prompt: 'child work', deferTo: null }; }
      return { identifier: 'PARENT', recommendedAction: 'defer', prompt: null, deferTo: 'CHILD' };
    };
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'PARENT', noDescend: true });
    assert.strictEqual(out.recommendation.identifier, 'PARENT', 'stays on the node the caller named');
    assert.deepStrictEqual(out.deferredVia, ['PARENT'], 'no descent happened');
    assert.strictEqual(out.deferTruncated, false, 'a deliberate non-descent is not a truncation');
    assert.strictEqual(out.deferStopReason, null);
    assert.strictEqual(childFetched, false, 'the child is never fetched under noDescend');
  });

  test('noDescend on a real-work start node behaves like a normal single hop', async () => {
    // The realistic case: with focusedChild suppressed upstream, the parent recommends
    // its OWN work (a non-defer action). noDescend must not perturb that path.
    const computeOne = fakeComputeOne({
      'PARENT': { recommendedAction: 'implement', prompt: 'do the parent work', deferTo: null }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'PARENT', noDescend: true });
    assert.strictEqual(out.recommendation.recommendedAction, 'implement');
    assert.strictEqual(out.recommendation.prompt, 'do the parent work');
    assert.deepStrictEqual(out.deferredVia, ['PARENT']);
    assert.strictEqual(out.deferTruncated, false);
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

describe('resolveRecommendation — terminal-state descent guard (LIN-353)', () => {
  // The guard activates only when a hop surfaces its `children` (each carrying
  // `state`) plus the node's own `state`. The graph entries below include those.

  test('defer → terminal child: refuses the descent and redirects to the ready sibling', async () => {
    const computeOne = fakeComputeOne({
      'CONTAINER': {
        recommendedAction: 'defer', prompt: null, deferTo: 'DONE',
        state: { type: 'started' },
        children: [
          { identifier: 'DONE', state: { type: 'completed' } },
          { identifier: 'READY', state: { type: 'unstarted' } }
        ]
      },
      'READY': { recommendedAction: 'implement', prompt: 'build it', deferTo: null, state: { type: 'unstarted' } }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'CONTAINER' });
    assert.strictEqual(out.recommendation.identifier, 'READY', 'lands on the ready child, NOT the Done one');
    assert.strictEqual(out.recommendation.recommendedAction, 'implement');
    assert.strictEqual(out.recommendation.prompt, 'build it');
    assert.deepStrictEqual(out.deferredVia, ['CONTAINER', 'READY'], 'breadcrumb shows the redirect target');
    assert.strictEqual(out.deferTruncated, false, 'a successful redirect is not a truncation');
    assert.strictEqual(out.deferStopReason, null);
  });

  test('defer → terminal child with NO non-terminal sibling: stops with deferStopReason=terminal, no dispatch', async () => {
    const computeOne = fakeComputeOne({
      'ALLDONE': {
        recommendedAction: 'defer', prompt: null, deferTo: 'D1',
        state: { type: 'started' },
        children: [
          { identifier: 'D1', state: { type: 'completed' } },
          { identifier: 'D2', state: { type: 'canceled' } }
        ]
      }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'ALLDONE' });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'terminal');
    // Stays on the deferring node — a `defer` with no prompt → the route's 422 guard.
    assert.strictEqual(out.recommendation.identifier, 'ALLDONE');
    assert.strictEqual(out.recommendation.recommendedAction, 'defer');
    assert.deepStrictEqual(out.deferredVia, ['ALLDONE']);
  });

  test('defer → non-child identifier: rejected as a hallucinated target (deferStopReason=non-child)', async () => {
    const computeOne = fakeComputeOne({
      'NODE': {
        recommendedAction: 'defer', prompt: null, deferTo: 'LIN-9999',
        state: { type: 'started' },
        children: [{ identifier: 'REAL-KID', state: { type: 'unstarted' } }]
      },
      'LIN-9999': { recommendedAction: 'implement', prompt: 'should never reach', deferTo: null }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'NODE' });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'non-child');
    assert.strictEqual(out.recommendation.identifier, 'NODE', 'never fetched the phantom target');
    assert.deepStrictEqual(out.deferredVia, ['NODE']);
  });

  test('descent LANDS on a terminal node at depth>0: non-actionable stop (no dispatch)', async () => {
    // Child was non-terminal in the parent's snapshot (so the edge guard let the
    // descent through) but resolves Done at its own hop — caught by the landed net.
    const computeOne = fakeComputeOne({
      'PARENT': {
        recommendedAction: 'defer', prompt: null, deferTo: 'CHILD',
        state: { type: 'started' },
        children: [{ identifier: 'CHILD', state: { type: 'started' } }]
      },
      'CHILD': { recommendedAction: 'implement', prompt: 'stale work', deferTo: null, state: { type: 'completed' } }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'PARENT' });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'terminal');
    assert.strictEqual(out.recommendation.identifier, 'CHILD', 'reached it, but flags it as non-actionable');
    assert.deepStrictEqual(out.deferredVia, ['PARENT', 'CHILD']);
  });

  test('start node itself terminal at depth 0: HONORED (not blocked) — direct review of a Done ticket', async () => {
    const computeOne = fakeComputeOne({
      'DONE-LEAF': { recommendedAction: 'review', prompt: 'verify and close out', deferTo: null, state: { type: 'completed' }, children: [] }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'DONE-LEAF' });
    assert.strictEqual(out.deferTruncated, false, 'the start node is always honored, whatever its state');
    assert.strictEqual(out.deferStopReason, null);
    assert.strictEqual(out.recommendation.recommendedAction, 'review');
    assert.strictEqual(out.recommendation.prompt, 'verify and close out');
    assert.deepStrictEqual(out.deferredVia, ['DONE-LEAF']);
  });

  test('a valid non-terminal deferTo still descends normally (guard does not over-fire)', async () => {
    const computeOne = fakeComputeOne({
      'HEALTHY': {
        recommendedAction: 'defer', prompt: null, deferTo: 'OPEN',
        state: { type: 'started' },
        children: [
          { identifier: 'OPEN', state: { type: 'unstarted' } },
          { identifier: 'OLD', state: { type: 'completed' } }
        ]
      },
      'OPEN': { recommendedAction: 'implement', prompt: 'do it', deferTo: null, state: { type: 'unstarted' } }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'HEALTHY' });
    assert.strictEqual(out.recommendation.identifier, 'OPEN');
    assert.deepStrictEqual(out.deferredVia, ['HEALTHY', 'OPEN']);
    assert.strictEqual(out.deferTruncated, false);
  });

  test('terminal predicate covers duplicate (not just completed): defer → duplicate child redirects', async () => {
    const computeOne = fakeComputeOne({
      'C': {
        recommendedAction: 'defer', prompt: null, deferTo: 'DUP',
        state: { type: 'started' },
        children: [
          { identifier: 'DUP', state: { type: 'duplicate' } },
          { identifier: 'GO', state: { type: 'backlog' } }
        ]
      },
      'GO': { recommendedAction: 'implement', prompt: 'go', deferTo: null, state: { type: 'backlog' } }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'C' });
    assert.strictEqual(out.recommendation.identifier, 'GO', 'duplicate is terminal → redirected past it');
  });

  test('guard is inert when a hop omits children (back-compat with leaner computeOne shapes)', async () => {
    // No `children`/`state` on the entries → the historical permissive descent.
    const computeOne = fakeComputeOne({
      'A': { recommendedAction: 'defer', prompt: null, deferTo: 'B' },
      'B': { recommendedAction: 'implement', prompt: 'build', deferTo: null }
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'A' });
    assert.strictEqual(out.recommendation.identifier, 'B');
    assert.strictEqual(out.deferTruncated, false);
    assert.deepStrictEqual(out.deferredVia, ['A', 'B']);
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
