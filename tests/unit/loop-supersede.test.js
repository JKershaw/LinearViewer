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
    const { waiting, message } = deriveSessionWaiting(twoLineageEnrichedLoops());
    assert.equal(waiting, true, 'a2 (lineage A tail) and b1 are both genuinely waiting');
    assert.match(message, /a2 needs a decision|b1 needs a decision/, 'message comes from a non-superseded loop, never a1');

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
    assert.deepEqual(deriveSessionWaiting([]), { waiting: false, message: null });

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
});
