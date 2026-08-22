import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSessionWaiting } from '../../routes/dashboard.js';
import { renderSessionPage } from '../../lib/render-session.js';

// LIN-1478 beat 1: characterization/agreement coverage for the supersede logic,
// written BEFORE `lib/loop-supersede.js` exists. `routes/dashboard.js`'s
// `deriveSessionWaiting` and `lib/render-session.js`'s per-run `runIsWaiting`
// each build their own `supersededLoopIds` set from the same rule (a loop named
// by another loop's `followUpTo` is excluded from "waiting"). Nothing today
// pins the two in agreement, because every existing fixture holds a single
// lineage — changing either side's input set fails neither test. This file
// pins the CURRENT (pre-extraction) behavior of both copies so the later
// extraction into a shared `computeSupersededLoopIds` can be verified against
// it, not merely trusted.
//
// Fixture: one session, two independent lineages.
//   Lineage A: a1 --[blocked]--> superseded by a2 (followUpTo: 'a1')
//              a2 --[blocked]--> the tail, genuinely still waiting
//   Lineage B: b1 --[blocked]--> standalone, waiting, unaffected by A

// ── routes/dashboard.js side: enriched-loop shape (post-enrichLoop) ─────────
// `deriveSessionWaiting` reads `loop.loopId`, `loop.followUpTo`, `loop.agentState`
// (already effective/marker-resolved) and `loop.wakeMarker` (or falls back to
// scanning `loop.feedback`) — see `loopIsWaiting`/`isTerminalLoop` in
// routes/dashboard.js. These fixtures set agentState/wakeMarker directly, as
// `enrichLoop` output would.
function enrichedLoop(overrides) {
  return {
    agentState: 'running', // non-terminal
    wakeMarker: 'blocked',
    waitingMessage: null,
    agentSummary: null,
    followUpTo: undefined,
    ...overrides
  };
}

function twoLineageEnrichedLoops() {
  return [
    enrichedLoop({ loopId: 'a1', waitingMessage: '[blocked] a1 needs a decision' }),
    enrichedLoop({ loopId: 'a2', followUpTo: 'a1', waitingMessage: '[blocked] a2 needs a decision' }),
    enrichedLoop({ loopId: 'b1', waitingMessage: '[blocked] b1 needs a decision' })
  ];
}

// ── lib/render-session.js side: raw session/loop shape (feedback[]-bearing) ──
// `renderSessionPage` → `renderRun` → `runIsWaiting` reads `loop.terminalStatus`,
// `loop.followUpTo`, and the LAST entry of `loop.feedback`.
function rawLoop({ loopId, followUpTo, blockedText }) {
  return {
    loopId,
    followUpTo,
    issueIdentifier: 'LIN-900',
    issueId: 'uuid-900',
    issueTitle: 'Lineage fixture',
    iteration: 1,
    kind: 'autopilot',
    dispatchedAt: '2026-07-20T10:00:00.000Z',
    terminalStatus: null, // non-terminal — required for the waiting flag to be eligible
    feedback: [{ message: blockedText, url: null, urlLabel: null, timestamp: '2026-07-20T10:00:01.000Z' }],
    telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] }
  };
}

function twoLineageSessionFixture() {
  return {
    sessionId: 'sess-lineage-ab',
    seedIssue: 'LIN-900',
    tasksTouched: ['LIN-900'],
    dispatchedAt: '2026-07-20T10:00:00.000Z',
    telemetry: { runtime: { ms: 3000 }, metrics: [], producedArtifacts: [] },
    loops: [
      rawLoop({ loopId: 'a1', followUpTo: undefined, blockedText: '[blocked] a1 needs a decision' }),
      rawLoop({ loopId: 'a2', followUpTo: 'a1', blockedText: '[blocked] a2 needs a decision' }),
      rawLoop({ loopId: 'b1', followUpTo: undefined, blockedText: '[blocked] b1 needs a decision' })
    ]
  };
}

// Extracts the single `<li data-loop-id="...">...</li>` run block for a given
// loopId out of the rendered page HTML, so an assertion can be scoped to ONE
// run's waiting flag rather than a page-wide substring search.
function runBlockHtml(html, loopId) {
  const marker = `data-loop-id="${loopId}"`;
  const liStart = html.lastIndexOf('<li class="sess-run"', html.indexOf(marker));
  assert.notEqual(liStart, -1, `no <li> found for loopId ${loopId}`);
  const nextLi = html.indexOf('<li class="sess-run"', liStart + 1);
  return nextLi === -1 ? html.slice(liStart) : html.slice(liStart, nextLi);
}

describe('loop-supersede characterization (LIN-1478 beat 1, pre-extraction)', () => {
  test('agreement: deriveSessionWaiting and the rendered per-run waiting flags agree on the same two-lineage input', () => {
    // LIN-2183: widened shape — producerLoopId/decision/decisionCase ride on the
    // exact same winning iteration as `message`, so they must name the same loop
    // (`a2`, the lineage-A tail) that produced `message`, never a1 (superseded)
    // or b1 (a later-but-not-first waiting loop). Neither fixture loop carries a
    // `decision`/`decisionCase` field, so both are the empty/null defaults here —
    // that's a separate, dedicated fixture below (the two-loop producer test).
    const { waiting, message, producerLoopId, decision, decisionCase } = deriveSessionWaiting(twoLineageEnrichedLoops());
    assert.equal(waiting, true, 'a2 (lineage A tail) and b1 are both genuinely waiting');
    assert.match(message, /a2 needs a decision|b1 needs a decision/, 'message comes from a non-superseded loop, never a1');
    assert.equal(producerLoopId, 'a2', 'producerLoopId names the same loop that won the message fold');
    assert.equal(decision, null, 'no loop in this fixture carries a decision');
    assert.deepEqual(decisionCase, [], 'no loop in this fixture carries a decisionCase');

    const html = renderSessionPage({ session: twoLineageSessionFixture(), urlKey: 'ws-a', issueContext: [] });
    assert.ok(!runBlockHtml(html, 'a1').includes('data-testid="session-run-waiting-flag"'), 'a1 is superseded by a2 — no flag');
    assert.ok(runBlockHtml(html, 'a2').includes('data-testid="session-run-waiting-flag"'), 'a2 is the lineage-A tail — still waiting');
    assert.ok(runBlockHtml(html, 'b1').includes('data-testid="session-run-waiting-flag"'), 'b1 is a standalone lineage — waiting, unaffected by A');
  });

  test('cross-session scope pin: a followUpTo naming b1 from a DIFFERENT session must not supersede b1 when the helper is called per-session', () => {
    // A loop dispatched under a different session, whose followUpTo happens to
    // name this session's b1 — modeled on the real LIN-1341 reply shape: itself
    // terminal/resolved (so it contributes no waiting signal of its own), only
    // its `followUpTo` edge matters. This is the mutation a future fold could
    // introduce by widening the input set passed to the shared helper — the
    // contract is that callers scope the input to ONE session's loops.
    const crossSessionLoop = enrichedLoop({
      loopId: 'other-session-loop',
      followUpTo: 'b1',
      agentState: 'complete',
      wakeMarker: 'done'
    });

    // Correct scope — the contract: only this session's loops are passed in.
    const perSessionLoops = twoLineageEnrichedLoops();
    const { waiting, message } = deriveSessionWaiting(perSessionLoops);
    assert.equal(waiting, true, 'b1 is still waiting when the helper only sees this session\'s loops');
    assert.match(message, /a2 needs a decision|b1 needs a decision/);

    // The trap this test exists to catch: isolate b1 on its own (no lineage A
    // noise) and show that wrongly widening the input to include a
    // cross-session loop DOES silently supersede it. A future fold that
    // widens deriveSessionWaiting's/computeSupersededLoopIds' input set past
    // one session would reproduce exactly this.
    const b1Only = [enrichedLoop({ loopId: 'b1', waitingMessage: '[blocked] b1 needs a decision' })];
    assert.equal(deriveSessionWaiting(b1Only).waiting, true, 'b1 alone, correctly scoped, is waiting');
    assert.equal(
      deriveSessionWaiting([...b1Only, crossSessionLoop]).waiting,
      false,
      'b1 alone, wrongly widened with a cross-session followUpTo naming it, is silently superseded'
    );
  });

  test('degenerate: no loops', () => {
    // LIN-2183: deliberate, planned widening of this literal from the old 2-key
    // `{ waiting: false, message: null }` to the settled 5-key empty shape — the
    // only whole-object-literal assertion in this suite, so it is the single
    // intentional breaker the return-shape widening causes. Not a patched-up red.
    assert.deepEqual(deriveSessionWaiting([]), { waiting: false, message: null, producerLoopId: null, decision: null, decisionCase: [] });

    const html = renderSessionPage({
      session: { sessionId: 'sess-empty', tasksTouched: [], dispatchedAt: '2026-07-20T10:00:00.000Z', telemetry: {}, loops: [] },
      urlKey: 'ws-a',
      issueContext: []
    });
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'));
  });

  test('degenerate: a followUpTo pointing outside the input set does not crash and supersedes nothing', () => {
    const loops = [enrichedLoop({ loopId: 'b1', followUpTo: 'no-such-loop', waitingMessage: '[blocked] b1 needs a decision' })];
    const { waiting, message } = deriveSessionWaiting(loops);
    assert.equal(waiting, true, 'b1 is not superseded by a followUpTo that names no loop in this set');
    assert.match(message, /b1 needs a decision/);

    const session = {
      sessionId: 'sess-dangling',
      tasksTouched: [],
      dispatchedAt: '2026-07-20T10:00:00.000Z',
      telemetry: {},
      loops: [rawLoop({ loopId: 'b1', followUpTo: 'no-such-loop', blockedText: '[blocked] b1 needs a decision' })]
    };
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(runBlockHtml(html, 'b1').includes('data-testid="session-run-waiting-flag"'));
  });

  // LIN-2183 (H4): the widened return's whole point — prove the fold names the
  // ACTUAL producing loop, not a take-first artifact. Loop 1 is terminal/`[done]`
  // with no waiting message at all (so it is never even a candidate — excluded by
  // `loopIsWaiting`, not by supersession, unlike the agreement-test fixture
  // above); loop 2 is the only genuinely waiting loop and carries a `decision`.
  // Before this ticket, the 2-key return had no identity field, so no test could
  // ever distinguish "correctly named loop 2" from "silently took loop 1" — this
  // fixture only becomes meaningful once `producerLoopId` exists.
  test('producer identity: the winning (second) loop names producerLoopId/decision/decisionCase, not a take-first artifact', () => {
    const decision = { decision_id: 'd-loop2', question: 'Proceed with the migration?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] };
    const decisionCase = ['Considered the schema diff.', 'Considered the rollback plan.'];
    const loops = [
      enrichedLoop({ loopId: 'loop1', agentState: 'complete', wakeMarker: 'done', waitingMessage: null, agentSummary: null }),
      enrichedLoop({ loopId: 'loop2', waitingMessage: '[blocked] loop2 needs a decision', decision, decisionCase })
    ];

    const result = deriveSessionWaiting(loops);
    assert.equal(result.waiting, true, 'loop2 is genuinely waiting; loop1 is terminal and excluded');
    assert.equal(result.message, '[blocked] loop2 needs a decision');
    assert.equal(result.producerLoopId, 'loop2', 'must name loop2, the loop that actually won the fold — not loop1');
    assert.deepEqual(result.decision, decision, 'decision must come from the same winning loop, never re-derived elsewhere');
    assert.deepEqual(result.decisionCase, decisionCase, 'decisionCase must come from the same winning loop, never re-derived elsewhere');
  });

  // Review (PR #1162, comment a0b0c83b): the mirror of the fixture above.
  // Proves "one producer, always" the other direction — the loop that WINS the
  // message fold carries no decision, and a LATER waiting loop does. The
  // producer-identity test above co-locates message and decision on the same
  // (second) loop, so it cannot tell "decision came from the producer" from
  // "decision came from anywhere waiting" — a mutant that sources `decision`
  // from any waiting loop rather than the message producer survives it. This
  // fixture separates the two loops so such a mutant is caught: it must assert
  // `decision === null`/`decisionCase === []`, not loop2's decision.
  test('one producer, always: decision does not leak from a later waiting loop that never won the message fold', () => {
    const decision = { decision_id: 'd-loop2', question: 'Proceed with the migration?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] };
    const decisionCase = ['Considered the schema diff.'];
    const loops = [
      enrichedLoop({ loopId: 'loop1', waitingMessage: '[blocked] loop1 needs a decision' }),
      enrichedLoop({ loopId: 'loop2', waitingMessage: '[blocked] loop2 needs a decision', decision, decisionCase })
    ];

    const result = deriveSessionWaiting(loops);
    assert.equal(result.waiting, true, 'both loop1 and loop2 are genuinely waiting');
    assert.equal(result.message, '[blocked] loop1 needs a decision', 'loop1 wins the message fold — it is first');
    assert.equal(result.producerLoopId, 'loop1', 'producerLoopId must name loop1, the loop that actually won the message fold');
    assert.equal(result.decision, null, 'decision must not leak from loop2, which never won the message fold');
    assert.deepEqual(result.decisionCase, [], 'decisionCase must not leak from loop2 either');
  });

  // Review (PR #1162, comment a0b0c83b), finding (a): pins the no-message
  // provenance rule as CHOSEN, not incidental. Several waiting loops carry no
  // message text at all (so nothing ever wins the fold), and one of them
  // carries a decision anyway. The rule: with no message to attach it to, a
  // provenance pointer is meaningless — all four derived fields stay
  // null/empty even though `waiting` is true and a decision exists somewhere
  // in the scan.
  test('no-message rule: several message-less waiting loops, one carrying a decision, still null everything out', () => {
    const decision = { decision_id: 'd-early', question: 'Proceed?', options: [] };
    const loops = [
      enrichedLoop({ loopId: 'loop1', waitingMessage: null, agentSummary: null, decision }),
      enrichedLoop({ loopId: 'loop2', waitingMessage: null, agentSummary: null }),
      enrichedLoop({ loopId: 'loop3', waitingMessage: null, agentSummary: null })
    ];

    const result = deriveSessionWaiting(loops);
    assert.equal(result.waiting, true, 'still waiting even though no loop has message text');
    assert.equal(result.message, null);
    assert.equal(result.producerLoopId, null, 'no loop produced a message — no provenance pointer to a loop that produced nothing');
    assert.equal(result.decision, null, 'an available decision on a message-less loop is not surfaced without a message to attach it to');
    assert.deepEqual(result.decisionCase, []);
  });

  // Routed in from LIN-2186 (S2) review, ledger item 3: S2 emits the `[decision]`
  // feedback entry BEFORE the `[blocked]` status entry precisely so a last-entry
  // predicate still reads `[blocked]` as the tail. S2's own tests pin this
  // ordering in simple-dispatcher, a separate package with no dependency edge to
  // Harbour — what they prove is a local mirror of the rule, not this consumer.
  // This exercises Harbour's REAL `runIsWaiting` (lib/render-session.js:150-156,
  // NOT exported — exercised indirectly via renderSessionPage's rendered output,
  // same technique the fixtures above already use) over a decision-bearing
  // feedback array in the shape S2 now emits. `runIsWaiting` is NOT modified —
  // this is a characterization/regression pin closing LIN-2186's ledger item, and
  // the plan is explicit that it *passes unchanged today* — it is not proof of
  // new behaviour from this ticket's widening.
  test('LIN-2186/S2: runIsWaiting still reads [blocked] as the tail past an intervening [decision] entry', () => {
    const session = {
      sessionId: 'sess-s2-decision',
      tasksTouched: ['LIN-900'],
      dispatchedAt: '2026-07-20T10:00:00.000Z',
      telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] },
      loops: [{
        loopId: 's2-loop',
        issueIdentifier: 'LIN-900',
        issueId: 'uuid-900',
        issueTitle: 'S2 decision-ordering fixture',
        iteration: 1,
        kind: 'autopilot',
        dispatchedAt: '2026-07-20T10:00:00.000Z',
        terminalStatus: null, // non-terminal — required for the waiting flag to be eligible
        feedback: [
          { kind: 'assistant-text', message: 'Investigating the migration path.', url: null, urlLabel: null, timestamp: '2026-07-20T10:00:01.000Z' },
          { kind: 'decision', message: '[decision] {"decision_id":"d-s2","question":"Proceed with the migration?"}', url: null, urlLabel: null, timestamp: '2026-07-20T10:00:02.000Z' },
          { kind: 'status', message: '[blocked] awaiting your ruling', url: null, urlLabel: null, timestamp: '2026-07-20T10:00:03.000Z' }
        ],
        telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] }
      }]
    };

    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(
      runBlockHtml(html, 's2-loop').includes('data-testid="session-run-waiting-flag"'),
      'runIsWaiting must still read the LAST entry ([blocked]) as waiting, unaffected by the intervening [decision] entry'
    );
  });
});
