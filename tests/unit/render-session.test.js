import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../../lib/render-session.js';

// LIN-1003: the dedicated per-session page renderer. Pure (data) → HTML on the
// shared shell; the route does all reads and hands this a plain data object.
// These tests build a NON-lean fixture session (with feedback[]) directly.

function fixtureSession(overrides = {}) {
  return {
    sessionId: 'sess-abc',
    seedIssue: 'LIN-900',
    tasksTouched: ['LIN-900', 'LIN-901'],
    dispatchedAt: '2026-07-04T10:00:00.000Z',
    completedAt: '2026-07-04T10:05:00.000Z',
    telemetry: { runtime: { ms: 300000 }, metrics: [], producedArtifacts: [] },
    loops: [
      {
        loopId: 'loop-1',
        issueIdentifier: 'LIN-900',
        issueId: 'uuid-900',
        issueTitle: 'Seed task',
        iteration: 1,
        kind: 'autopilot',
        dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: 'done',
        terminalCompletedAt: '2026-07-04T10:02:00.000Z',
        feedback: [
          { message: '[started] session', url: null, urlLabel: null, timestamp: '2026-07-04T10:00:01.000Z' },
          { message: '[evidence] opened PR', url: 'https://example.com/pr/1', urlLabel: 'PR #1', timestamp: '2026-07-04T10:01:00.000Z' }
        ],
        telemetry: { runtime: { ms: 120000 }, metrics: [{ toolCount: 3 }], producedArtifacts: [{ url: 'https://example.com/pr/1' }] }
      },
      {
        loopId: 'loop-2',
        issueIdentifier: 'LIN-901',
        issueId: 'uuid-901',
        issueTitle: 'Child task',
        iteration: 2,
        kind: 'implementation',
        dispatchedAt: '2026-07-04T10:02:00.000Z',
        terminalStatus: 'done',
        terminalCompletedAt: '2026-07-04T10:05:00.000Z',
        feedback: [
          { message: '[done] landed', url: null, urlLabel: null, timestamp: '2026-07-04T10:05:00.000Z' }
        ],
        telemetry: { runtime: { ms: 180000 }, metrics: [], producedArtifacts: [] }
      }
    ],
    ...overrides
  };
}

describe('render-session: transcript', () => {
  test('embeds per-run transcript data as JSON for client-side rendering', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-transcript"/);
    const txContainers = html.match(/data-testid="session-run-transcript"/g) || [];
    assert.equal(txContainers.length, 2, 'two run transcript containers');
    // Feedback data is HTML-escaped JSON in a data attribute.
    assert.match(html, /data-feedback="[^"]*\[started\] session[^"]*"/);
    assert.match(html, /data-feedback="[^"]*\[evidence\] opened PR[^"]*"/);
    assert.match(html, /data-feedback="[^"]*example\.com\/pr\/1[^"]*"/);
    assert.match(html, /data-feedback="[^"]*PR #1[^"]*"/);
  });

  test('a session with no feedback does not emit a transcript container', () => {
    const session = fixtureSession({
      loops: [{ loopId: 'l', issueIdentifier: 'LIN-900', issueId: 'u', iteration: 1, feedback: [], telemetry: null }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    // No feedback → no transcript container — the run body is empty.
    assert.ok(!html.includes('data-testid="session-run-transcript"'));
    assert.ok(!html.includes('data-testid="session-run-body"'));
  });

  test('LIN-1309: the transcript element is a shared chat.css thread, empty server-side (client-populated)', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    // The container carrying data-feedback is itself the `.chat-thread` element
    // (mirrors Task Chat's `.task-chat-transcript.chat-thread` — no wrapper div,
    // no server-rendered `.sess-run-tx-list`/`.sess-run-tx-entry` bubbles; those
    // are built client-side by session.js via window.ChatUI.appendMessage).
    assert.match(html, /<ul class="sess-run-tx chat-thread" data-testid="session-run-transcript" data-feedback="[^"]*"><\/ul>/);
    assert.ok(!html.includes('sess-run-tx-list'));
  });

  // LIN-2184 (H5): encodeFeedbackJSON must round-trip `kind` so a `decision`
  // entry can be styled distinctly client-side. The transcript is NOT
  // waiting-gated, so this must hold on a blocked (non-terminal) run and on a
  // completed (terminal) run alike.
  test('LIN-2184: round-trips kind for a decision entry on a waiting (blocked, non-terminal) run', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'loop-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900', issueTitle: 'Seed task',
        iteration: 1, kind: 'autopilot', dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: null,
        feedback: [
          { kind: 'assistant-text', message: 'Investigating the migration path.', url: null, urlLabel: null, timestamp: '2026-07-04T10:00:01.000Z' },
          { kind: 'decision', message: '[decision] {"decision_id":"d-1"}', url: null, urlLabel: null, timestamp: '2026-07-04T10:00:02.000Z' },
          { kind: 'status', message: '[blocked] awaiting your ruling', url: null, urlLabel: null, timestamp: '2026-07-04T10:00:03.000Z' }
        ],
        telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] }
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-feedback="[^"]*&quot;kind&quot;:&quot;decision&quot;[^"]*"/);
  });

  test('LIN-2184: round-trips kind for a decision entry on a completed (terminal) run', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'loop-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900', issueTitle: 'Seed task',
        iteration: 1, kind: 'autopilot', dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: 'done', terminalCompletedAt: '2026-07-04T10:05:00.000Z',
        feedback: [
          { kind: 'assistant-text', message: 'The migration is complete.', url: null, urlLabel: null, timestamp: '2026-07-04T10:04:00.000Z' },
          { kind: 'decision', message: '[decision] {"decision_id":"d-2"}', url: null, urlLabel: null, timestamp: '2026-07-04T10:04:30.000Z' },
          { kind: 'status', message: '[done] landed', url: null, urlLabel: null, timestamp: '2026-07-04T10:05:00.000Z' }
        ],
        telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] }
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-feedback="[^"]*&quot;kind&quot;:&quot;decision&quot;[^"]*"/);
  });

  test('LIN-2184: a normal entry with no kind carries kind:null, other keys unchanged', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    // fixtureSession's entries carry no `kind` — assert the shape gained `kind`
    // (null) without disturbing the pre-existing keys already asserted above.
    assert.match(html, /data-feedback="[^"]*&quot;kind&quot;:null[^"]*"/);
  });
});

describe('render-session: tasks + overview', () => {
  test('renders tasks-touched chips and the seed', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-tasks"/);
    // LIN-3331: each chip is a link through to that task's page.
    const tasks = html.match(/data-testid="session-task-link"/g) || [];
    assert.equal(tasks.length, 2);
    assert.match(html, /data-testid="session-task-link"[^>]*href="\/workspace\/ws-a\/task\/LIN-900"/);
    assert.match(html, /data-testid="session-task-link"[^>]*href="\/workspace\/ws-a\/task\/LIN-901"/);
    assert.match(html, /data-testid="session-seed"[^>]*>LIN-900</);
    // LIN-3331: the seed row's adjacent task-page link.
    assert.match(html, /data-testid="session-task-page-link"[^>]*href="\/workspace\/ws-a\/task\/LIN-900"/);
  });

  test('the seed row and chips carry the binding pair when a loop is stamped (LIN-3331)', () => {
    const session = fixtureSession();
    session.loops[0] = { ...session.loops[0], issueSource: 'linear', issueBindingScope: 'team-a' };
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    // The stamped task's seed link and chip carry `?source=&bindingScope=`.
    assert.match(html, /data-testid="session-task-page-link"[^>]*href="\/workspace\/ws-a\/task\/LIN-900\?source=linear&amp;bindingScope=team-a"/);
    assert.match(html, /data-testid="session-task-link"[^>]*href="\/workspace\/ws-a\/task\/LIN-900\?source=linear&amp;bindingScope=team-a"/);
    // A task with no stamped loop keeps the plain link (single-binding fallback).
    assert.match(html, /data-testid="session-task-link"[^>]*href="\/workspace\/ws-a\/task\/LIN-901"/);
  });

  test('back-to-feed link targets the workspace observation feed', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-back"[^>]*href="\/workspace\/ws-a\/observation"/);
  });
});

describe('render-session: anchor issue title (LIN-1801)', () => {
  test('a distinct anchorIssueTitle renders on the header, browser title, and a new seed-title span; session-seed stays identifier-only', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], anchorIssueTitle: 'Seed task' },
      {}
    );
    assert.match(html, /data-testid="session-seed"[^>]*>LIN-900</, 'session-seed keeps its identifier-only content');
    assert.match(html, /data-testid="session-seed-title"[^>]*>Seed task</);
    // LIN-3250: the body h1 is the task title + a short "Run <id>"; the document
    // <title> keeps the identifier-first form.
    assert.match(html, /data-testid="session-title"[^>]*>Seed task</);
    assert.match(html, /data-testid="session-run-id"[^>]*>Run sess-abc</);
    assert.match(html, /<title>Session · LIN-900 — Seed task<\/title>/);
  });

  test('an absent anchorIssueTitle still shows the run\'s own task title; no seed-title span, no title suffix', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] }, {});
    assert.ok(!html.includes('data-testid="session-seed-title"'));
    assert.match(html, /data-testid="session-title"[^>]*>Seed task</, 'the heading takes the loop\'s own issueTitle');
    assert.match(html, /<title>Session · LIN-900<\/title>/);
  });

  test('anchorIssueTitle equal to session.seedIssue is treated as no title (LIN-783-style regression guard)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], anchorIssueTitle: 'LIN-900' },
      {}
    );
    assert.ok(!html.includes('data-testid="session-seed-title"'));
    assert.match(html, /<title>Session · LIN-900<\/title>/);
  });

  test('a hostile anchorIssueTitle is escaped, single-escaped, and cannot break out of the header or <title>', () => {
    const HOSTILE_TITLE = '"><script>alert(1)</script> & co';
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], anchorIssueTitle: HOSTILE_TITLE },
      {}
    );
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not reach the document');
    assert.match(
      html,
      /data-testid="session-seed-title"[^>]*>&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co</
    );
    assert.match(
      html,
      /<title>Session · LIN-900 — &quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co<\/title>/
    );
  });
});

describe('render-session: pinned question card (LIN-3252 S2)', () => {
  // A row shaped exactly as `collectUnansweredDecisions` emits (the route's
  // `data.decisions`), so these exercise the render contract the route feeds.
  function decisionRow({
    loopId = 'loop-1', decisionId = 'd-1', question = 'Proceed with the migration?',
    options = [], ifUnanswered = null, disposition = 'resumable', canReply = true, decisionCase = [],
    effect = 'resume', recordOn = null
  } = {}) {
    const decision = { decision_id: decisionId };
    if (question != null) decision.question = question;
    if (options.length) decision.options = options;
    if (ifUnanswered) decision.if_unanswered = ifUnanswered;
    if (recordOn) decision.on_answer = { record_on: recordOn };
    return {
      decision, decisionCase,
      anchor: { loopId, issueId: 'uuid-900', issueIdentifier: 'LIN-900', workspaceUrlKey: 'ws-a', target: 'cli', followUpTo: null },
      stampLoopId: loopId, disposition, canReply, effect
    };
  }

  test('renders the question, options as choices, a "your own answer" box and ONE "Answer" verb', () => {
    const html = renderSessionPage(
      {
        session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, waiting: true, waitingMessage: 'awaiting your ruling',
        decisions: [decisionRow({ options: [{ id: 'yes', label: 'Yes, proceed' }, { id: 'no', label: 'No, hold off' }] })]
      },
      {}
    );
    assert.match(html, /data-testid="session-question-card"/);
    assert.match(html, /data-testid="session-question-card-question"[^>]*>Proceed with the migration\?</);
    assert.match(html, /data-testid="session-question-card-options"/);
    assert.match(html, /data-testid="session-question-card-option"[^>]*>Yes, proceed</);
    assert.match(html, /data-testid="session-question-card-option"[^>]*>No, hold off</);
    assert.match(html, /data-option-id="yes"/);
    assert.match(html, /data-testid="session-question-card-input"/);
    assert.match(html, /data-testid="session-question-card-answer"[^>]*>Answer</);
    assert.match(html, /data-testid="session-question-card-dismiss"[^>]*>this wasn't worth asking</);
    // The old waiting banner is gone.
    assert.ok(!html.includes('session-waiting-banner'), 'no legacy banner');
    // Decision ids are threaded for the stamp/answer path.
    assert.match(html, /data-testid="session-question-card"[^>]*data-decision-id="d-1"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-stamp-loop-id="loop-1"/);
  });

  test('"why is Harbour asking?" keeps each case chunk as its own node, including a baked-in (recap i/n) header', () => {
    const decisionCase = [
      'Part one of the case (recap 1/3)',
      'Part two of the case (recap 2/3)',
      'Part three of the case (recap 3/3)'
    ];
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: true, decisions: [decisionRow({ decisionCase })] },
      {}
    );
    assert.match(html, /data-testid="session-question-card-why"/);
    const chunkMatches = html.match(/data-testid="session-question-card-why-chunk"/g) || [];
    assert.equal(chunkMatches.length, 3, 'all three chunks render, none dropped or truncated');
    assert.match(html, /Part one of the case \(recap 1\/3\)/);
    assert.match(html, /Part two of the case \(recap 2\/3\)/);
    assert.match(html, /Part three of the case \(recap 3\/3\)/);
  });

  test('an ENDED session\'s "if you don\'t answer" fallback says the run has ended', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: false, sessionTerminal: true, decisions: [decisionRow()] },
      {}
    );
    assert.match(html, /data-testid="session-question-card-if-unanswered"[^>]*>if you don't answer: Nothing further runs; the run has ended\.</);
  });

  test('a LIVE session\'s "if you don\'t answer" fallback says Harbour keeps waiting', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: false, sessionTerminal: false, decisions: [decisionRow()] },
      {}
    );
    assert.match(html, /data-testid="session-question-card-if-unanswered"[^>]*>if you don't answer: Harbour keeps waiting for your answer\.</);
  });

  test("the agent's if_unanswered summary wins over the fallback", () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: false, sessionTerminal: true, decisions: [decisionRow({ ifUnanswered: { summary: 'The import continues; the publish halts.' } })] },
      {}
    );
    assert.match(html, /if you don't answer: The import continues; the publish halts\./);
  });

  test('a read-only disposition shows that Harbour is still working and offers NO input', () => {
    // F3: isolate the disposition path — `canReply` at BOTH the page and row
    // level is true, so the read-only rendering is guaranteed by
    // `readOnly` alone. A mutation setting `readOnly = false` now turns this
    // test red instead of being masked by a page-level `canReply: false`.
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, waiting: false, decisions: [decisionRow({ disposition: 'mid-turn', canReply: true })] },
      {}
    );
    assert.match(html, /data-testid="session-question-card-readonly"[^>]*>Harbour is still working; you can answer when it pauses\.</);
    assert.ok(!html.includes('data-testid="session-question-card-input"'), 'no own-answer box for a read-only disposition');
    assert.ok(!html.includes('data-testid="session-question-card-answer"'), 'no Answer verb for a read-only disposition');
    assert.ok(!html.includes('data-testid="session-question-card-options"'), 'no options for a read-only disposition');
    assert.ok(!html.includes('session-question-card-dismiss'), 'no dismiss where no input is offered');
  });

  test('emits the resolved effect and record_on the card branches on (LIN-3252 F1)', () => {
    const html = renderSessionPage(
      {
        session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, waiting: false,
        decisions: [
          decisionRow({ loopId: 'l-res', decisionId: 'd-res', disposition: 'resumable', effect: 'resume' }),
          decisionRow({ loopId: 'l-gone', decisionId: 'd-gone', disposition: 'gone', effect: 'dispatch' }),
          decisionRow({ loopId: 'l-rec', decisionId: 'd-rec', disposition: 'gone', effect: 'record', recordOn: 'LIN-SIB' })
        ]
      },
      {}
    );
    // Each card carries its OWN resolved effect — the gone run must not
    // collapse to a record-only answer.
    const cards = html.match(/data-testid="session-question-card"[^>]*/g) || [];
    assert.equal(cards.length, 3);
    assert.match(cards.find(c => c.includes('data-decision-id="d-res"')), /data-effect="resume"/);
    assert.match(cards.find(c => c.includes('data-decision-id="d-gone"')), /data-effect="dispatch"/);
    assert.match(cards.find(c => c.includes('data-decision-id="d-rec"')), /data-effect="record"/);
    // The declared record_on target rides the card so a `record` answer can
    // resolve it the way the Rulings tab does.
    assert.match(cards.find(c => c.includes('data-decision-id="d-rec"')), /data-record-on="LIN-SIB"/);
  });

  test('a bare [blocked] card carries effect="resume" (its only delivery)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, waiting: true, waitingMessage: 'blocked', decision: null, decisions: [], producer: { loopId: 'loop-w' } },
      {}
    );
    assert.match(html, /data-testid="session-question-card"[^>]*data-effect="resume"/);
  });

  test('the card renders on a non-waiting session that carries a decision', () => {
    // LIN-2184 V1 boundary INVERTED (LIN-3252 S2): the old test asserted a
    // decision on a non-waiting (terminal) session renders NEITHER the banner
    // NOR any decision markup. The card now renders it.
    const html = renderSessionPage(
      {
        session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: false, waitingMessage: null, sessionTerminal: true,
        decisions: [decisionRow({ decisionId: 'd-3', question: 'Ship it?', options: [{ id: 'yes', label: 'Yes' }], decisionCase: ['The migration completed cleanly.'] })]
      },
      {}
    );
    assert.match(html, /data-testid="session-question-card"/);
    assert.match(html, /data-testid="session-question-card-question"[^>]*>Ship it\?</);
    assert.match(html, /data-testid="session-question-card-why-chunk"[^>]*>The migration completed cleanly\.</);
    assert.ok(!html.includes('session-waiting-banner'), 'the legacy banner is never rendered');
  });

  test('no card when there are no decisions and the session is not waiting', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] }, {});
    assert.ok(!html.includes('data-testid="session-question-card"'), 'no card by default');
  });

  test('an answered OR dismissed decision (empty decisions) never reappears — and does not fall back to a bare card', () => {
    // `collectUnansweredDecisions` subtracts both an answered and a dismissed
    // decision (its predicate owns that); the render is handed an empty
    // `decisions`. Even though the rollup still names a decision and the session
    // is waiting, no second card is invented.
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: true, waitingMessage: 'awaiting your ruling', decision: { decision_id: 'd-ans', question: '?' }, decisions: [] },
      {}
    );
    assert.ok(!html.includes('data-testid="session-question-card"'), 'no card for an answered/dismissed decision');
  });

  test('a bare BLOCKED (waiting loop, no ruling row) renders the message, why-text, routing attrs and "Answer" — no dismiss', () => {
    const html = renderSessionPage(
      {
        session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true,
        waiting: true, waitingMessage: 'need your decision on the auth flow', decision: null, decisions: [],
        // The route threads the waiting producer loop's own reply target and
        // issue (so the follow-up resumes THAT run, never a hard-defaulted cli
        // target) plus its latest assistant text for the "why" fallback.
        producer: { loopId: 'loop-w', target: 'web', issueId: 'uuid-w', issueIdentifier: 'LIN-777', case: ['I compared the two rollout strategies and they diverge.'] }
      },
      {}
    );
    assert.match(html, /data-testid="session-question-card"/);
    assert.match(html, /data-testid="session-question-card-question"[^>]*>need your decision on the auth flow</);
    assert.match(html, /data-testid="session-question-card-input"/);
    assert.match(html, /data-testid="session-question-card-answer"[^>]*>Answer</);
    // "why" shows the producer's latest assistant text when there is no decisionCase.
    assert.match(html, /data-testid="session-question-card-why-chunk"[^>]*>I compared the two rollout strategies and they diverge\.</);
    // Routing attributes carry the producer's real target/issue/loop.
    assert.match(html, /data-testid="session-question-card"[^>]*data-loop-id="loop-w"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-stamp-loop-id="loop-w"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-target="web"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-issue-id="uuid-w"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-issue-identifier="LIN-777"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-disposition="resumable"/);
    // Live-session default.
    assert.match(html, /if you don't answer: Harbour keeps waiting for your answer\./);
    // No dismiss control (S2.7) and no options for a bare blocker.
    assert.ok(!html.includes('session-question-card-dismiss'), 'no dismiss on a bare blocker');
    assert.ok(!html.includes('data-testid="session-question-card-options"'), 'no options for a bare blocker');
  });

  test('the card question, case and if_unanswered are HTML-escaped', () => {
    const html = renderSessionPage(
      {
        session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: true,
        decisions: [decisionRow({ question: '<script>alert(1)</script>', decisionCase: ['<b>x</b>'], ifUnanswered: { summary: '<img src=x onerror=1>' } })]
      },
      {}
    );
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not leak');
    assert.ok(!html.includes('<img src=x onerror=1>'), 'raw if_unanswered must not leak');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img src=x onerror=1&gt;/);
  });
});

describe('render-session: telemetry + model omission', () => {
  test('renders telemetry chips (runtime, heartbeats, artifacts)', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-runtime"/);
    assert.match(html, /data-testid="session-run-metrics"/);
    assert.match(html, /data-testid="session-run-artifacts"/);
  });

  test('model chip is ABSENT (not "undefined") when telemetry omits model', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-model"'), 'no model chip when model absent');
    assert.ok(!html.includes('data-testid="session-model"'), 'no session-level model row when absent');
    assert.ok(!/>undefined</.test(html), 'no literal "undefined" leaks into the page');
  });

  test('model chip renders the TIER when telemetry supplies a model (identifier never printed)', () => {
    const session = fixtureSession();
    session.telemetry.model = 'claude-opus-4-8';
    session.loops[0].telemetry.model = 'claude-opus-4-8';
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-model"[^>]*data-tier="premium"[^>]*>◇ premium</);
    assert.match(html, /data-testid="session-tiers"[^>]*>premium</);
    assert.ok(!html.includes('claude-opus-4-8'), 'the model identifier is never printed on the page');
    assert.ok(!html.includes('data-testid="session-model"'), 'no session-level model row (tier only)');
  });

  test('LIN-1425: telemetry.usage is inert — output is byte-identical whether present or absent', () => {
    const withoutUsage = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });

    const session = fixtureSession();
    session.telemetry.usage = { harness: 'claude-code', model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 2, costUsd: null };
    session.loops[0].telemetry.usage = { harness: 'claude-code', model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 2, costUsd: null };
    const withUsage = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });

    assert.equal(withUsage, withoutUsage, 'renderRunChips/renderSessionPage must not render or be affected by telemetry.usage (display is LIN-1426)');
  });

  test('LIN-1789: peakRssBytes chip renders on the run that carries it', () => {
    const session = fixtureSession();
    session.loops[0].telemetry.resources = { peakRssBytes: 536870912, hostMemTotalBytes: 8589934592 };
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-resources"[^>]*>▤ 512 MB peak</);
    // Only one chip renders — the other nine resources fields stay unrendered.
    const chips = html.match(/data-testid="session-run-resources"/g) || [];
    assert.equal(chips.length, 1);
  });

  test('LIN-1789: the other nine resources fields are inert — output is byte-identical whether present or absent', () => {
    const withoutResources = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });

    // Host/session-wide fields present at BOTH session- and loop-level telemetry,
    // deliberately excluding peakRssBytes — must not leak into any run's chip row
    // (they'd misrepresent host-wide data as run-scoped).
    const NON_CHIP_FIELDS = {
      hostMemAvailableBytes: 2147483648, hostMemTotalBytes: 8589934592, hostSwapUsedBytes: 0,
      oomKillDelta: 0, loadAvg1: 1.5, cpuCount: 4, activeSessionCount: 2,
      cloneDiskBytes: 1073741824, cloneCount: 3,
    };
    const session = fixtureSession();
    session.telemetry.resources = { ...NON_CHIP_FIELDS };
    session.loops[0].telemetry.resources = { ...NON_CHIP_FIELDS };
    const withResources = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });

    assert.equal(withResources, withoutResources, 'renderRunChips/renderSessionPage must not render or be affected by resources fields other than peakRssBytes');
  });

  // ─── ticket walk (LIN-2242/LIN-2243) ────────────────────────────────────────
  test('LIN-2243: no ticket-walk markup at all when a run carries no [ticket] markers', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-ticket-walk"'), 'no ticket-walk list when the run is not a lane');
  });

  test('LIN-2243: a lane run renders an ordered ticket walk with each row\'s identifier + state', () => {
    const session = fixtureSession();
    session.loops[0].telemetry.ticketWalk = [
      { identifier: 'LIN-2242', state: 'done', outcomeLine: 'merged PR #1212', timestamp: null },
      { identifier: 'LIN-2243', state: 'started', outcomeLine: null, timestamp: null },
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-ticket-walk"/);
    const rows = html.match(/data-testid="session-ticket-row"/g) || [];
    assert.equal(rows.length, 2);
    assert.match(html, /LIN-2242[\s\S]*?status-pill--done[\s\S]*?done/);
    assert.match(html, /merged PR #1212/);
  });

  test('LIN-2243: blocked/refused/dissolved render as a first-class row with the SAME loud pill class a failed run gets — never buried in prose', () => {
    const session = fixtureSession();
    session.loops[0].telemetry.ticketWalk = [
      { identifier: 'LIN-1971', state: 'blocked', outcomeLine: 'needs Linux host + tmux', timestamp: null },
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-ticket-row"[^>]*data-state="blocked"/);
    assert.match(html, /status-pill--error/);
    assert.match(html, /needs Linux host \+ tmux/);
  });

  test('LIN-2243: ticket-walk content is escaped', () => {
    const session = fixtureSession();
    session.loops[0].telemetry.ticketWalk = [
      { identifier: '<script>alert(1)</script>', state: 'done', outcomeLine: '<img src=x onerror=alert(1)>', timestamp: null },
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  });
});

describe('render-session: brief/recap context branches', () => {
  // The recap cache stores a STRUCTURED OBJECT (lib/recap.js), not a Markdown
  // string like the brief — so the fixture mirrors the real shape.
  const RECAP_OBJECT = {
    done: [{ item: 'Wired the auth callback', evidence: 'commit abc123' }],
    pending: [{ item: 'Add rate limiting', predicted: 'guard the token route' }],
    deviations: [{ item: 'Token TTL shortened', type: 'scope-change', evidence: 'per review comment' }]
  };

  test('present brief (string) + recap (object) render their cached bodies', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      brief: 'The current brief body.',
      briefModel: 'openai/gpt-5.4-mini',
      briefGeneratedAt: '2026-07-04T09:00:00.000Z',
      recap: RECAP_OBJECT,
      recapModel: 'openai/gpt-5.4-mini',
      recapGeneratedAt: '2026-07-04T09:01:00.000Z'
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    assert.match(html, /data-testid="session-brief"/);
    assert.match(html, /The current brief body\./);
    assert.match(html, /data-testid="session-recap"/);
    // The structured recap renders its grouped content, NOT [object Object].
    assert.match(html, /data-testid="session-recap-body"/);
    assert.match(html, /Wired the auth callback/);
    assert.match(html, /Add rate limiting/);
    assert.match(html, /Token TTL shortened/);
    assert.match(html, /scope-change/);
    // A present panel does NOT render the miss affordance.
    assert.ok(!html.includes('data-testid="session-brief-generate"'), 'no generate affordance when brief is cached');
  });

  test('LIN-1023 regression: a structured recap object never renders as [object Object]', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      brief: null,
      recap: RECAP_OBJECT,
      recapModel: 'openai/gpt-5.4-mini',
      recapGeneratedAt: '2026-07-04T09:01:00.000Z'
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    assert.ok(!/\[object Object\]/i.test(html), 'the recap object must not be stringified into the page');
    // Present panel, not the generate affordance, since the recap IS cached.
    assert.ok(!html.includes('data-testid="session-recap-generate"'), 'a cached recap is present, not a miss');
  });

  test('an all-empty recap object is labelled, not silently blank or a [object Object]', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      brief: null,
      recap: { done: [], pending: [], deviations: [] },
      recapGeneratedAt: '2026-07-04T09:01:00.000Z'
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    assert.match(html, /data-testid="session-recap-empty"/);
    assert.ok(!/\[object Object\]/i.test(html), 'no stringified object even when empty');
  });

  test('a cache miss renders an explicit generate affordance (never auto-spend)', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      brief: null,
      recap: null
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    assert.match(html, /data-testid="session-brief-generate"/);
    assert.match(html, /data-testid="session-recap-generate"/);
    assert.match(html, /generate on demand/);
  });
});

describe('render-session: reply surface (LIN-1004; LIN-1163 removed the page-level box)', () => {
  test('no page-level reply box, even when canReply is true — the per-run inline reply is the only reply surface', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, sessionTerminal: false },
      {}
    );
    assert.ok(!html.includes('data-testid="session-reply"'), 'no global reply box even when canReply is true');
    assert.ok(!html.includes('data-testid="session-reply-input"'));
    assert.ok(!html.includes('data-testid="session-reply-send"'));
    assert.ok(!html.includes('data-testid="session-reply-note"'));
    // The per-run inline reply IS present (unaffected by the removal).
    assert.match(html, /data-testid="session-inline-reply"/);
    // Scripts always load (transcripts, widgets, expand/collapse, reply).
    assert.match(html, /<script src="\/session\.js"><\/script>/);
  });

  test('NO reply box of any kind when canReply is false (scripts still loaded for transcripts + widgets)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false },
      {}
    );
    assert.ok(!html.includes('data-testid="session-reply"'), 'no page-level reply box when canReply is false');
    assert.ok(!html.includes('data-testid="session-inline-reply"'), 'no inline reply boxes when canReply is false');
    // Scripts are always loaded — they handle transcripts, context widgets, and expand/collapse.
    assert.match(html, /script src="\/common\.js/);
    assert.match(html, /script src="\/session\.js/);
  });

  test('chat.css is linked even on the not-found body (LIN-1298)', () => {
    const html = renderSessionPage({ session: null, sessionId: 'nope', urlKey: 'ws-a' });
    assert.match(html, /<link[^>]*href="\/chat\.css"/);
  });
});

describe('render-session: not-found body', () => {
  test('a null session renders a 404 body, not a crash', () => {
    const html = renderSessionPage({ session: null, sessionId: 'nope', urlKey: 'ws-a' });
    assert.match(html, /data-testid="session-not-found"/);
    assert.match(html, /Session not found/);
    // Still has the back link so the user can return to the feed.
    assert.match(html, /data-testid="session-back"/);
  });
});

describe('render-session: per-run expand/collapse + inline reply (LIN-1133)', () => {
  test('each run card has a toggle with aria-expanded="false"', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    // Each run head is a button with the toggle testid.
    assert.match(html, /data-testid="session-run-toggle"[^>]*role="button"/);
    assert.match(html, /data-testid="session-run-toggle"[^>]*aria-expanded="false"/);
    // Toggle icon present.
    assert.match(html, /▸/);
  });

  test('each run card has a run body container for transcript + inline reply', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-run-body"/);
    // Two runs = two body containers.
    const bodies = html.match(/data-testid="session-run-body"/g) || [];
    assert.equal(bodies.length, 2);
  });

  test('per-run inline reply box emits with correct data attributes when canReply', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true });
    // Two inline reply boxes.
    assert.match(html, /data-testid="session-inline-reply"/);
    const ireplies = html.match(/data-testid="session-inline-reply"/g) || [];
    assert.equal(ireplies.length, 2);
    // First inline reply is scoped to loop-1, terminal = done.
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-loop-id="loop-1"/);
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-terminal="true"/);
    // Has textarea and send button.
    assert.match(html, /data-testid="session-inline-reply-send"/);
    // Uses the visible-button class sess-reply-send.
    assert.match(html, /action-btn sess-reply-send/);
  });

  test('per-run inline reply adopts the chat composer + per-run echo thread (LIN-1298)', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true });
    // One echo thread per inline reply box (two runs → two threads).
    const threads = html.match(/data-testid="session-inline-reply-thread"/g) || [];
    assert.equal(threads.length, 2);
    // The inline input sits in a chat composer.
    assert.match(html, /class="[^"]*chat-composer__input[^"]*"[^>]*class="sess-inline-reply-input"|class="sess-inline-reply-input[^"]*chat-composer__input"/);
  });

  test('no inline reply boxes when canReply is false', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false });
    assert.ok(!html.includes('data-testid="session-inline-reply"'));
  });

  test('a non-terminal run sets data-terminal="false"', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null; // running
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-loop-id="loop-1"[^>]*data-terminal="false"/);
  });

  // Inline boxes key `force` off the run's own terminal status OR the SESSION-level
  // waiting signal (LIN-1252) — waiting is session-scoped, not per-run.
  test('inline reply boxes carry data-session-waiting="true" when the session is waiting', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null; // a non-terminal run in a waiting session
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true, waiting: true });
    // Every inline box (even the non-terminal run) is flagged waiting → client forces.
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-loop-id="loop-1"[^>]*data-session-waiting="true"/);
    assert.ok(!html.includes('data-session-waiting="false"'), 'no inline box is unflagged in a waiting session');
  });

  test('inline reply boxes carry data-session-waiting="false" when the session is not waiting', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, waiting: false });
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-loop-id="loop-1"[^>]*data-session-waiting="false"/);
    assert.ok(!html.includes('data-session-waiting="true"'), 'no inline box is flagged waiting in a non-waiting session');
  });

  test('recipes are always loaded (common.js, marked, purify, brief, recap, session)', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false });
    // Scripts load in order.
    assert.match(html, /script src="\/common\.js"/);
    assert.match(html, /script src="\/purify\.min\.js"/);
    assert.match(html, /script src="\/marked\.min\.js"/);
    assert.match(html, /script src="\/brief\.js"/);
    assert.match(html, /script src="\/recap\.js"/);
    assert.match(html, /script src="\/session\.js"/);
  });

  test('LIN-1163: no global reply box is rendered even when canReply — the per-run inline reply is the only surface', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.ok(!html.includes('data-testid="session-reply"'));
    assert.ok(!html.includes('data-testid="session-reply-input"'));
  });

  test('context panels carry widget data attributes for BriefSection/RecapSection', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900', issueId: 'uuid-900',
      brief: 'A brief body.', briefModel: 'openai/gpt-5.4-mini', briefGeneratedAt: '2026-07-04T09:00:00.000Z',
      recap: null
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    // Brief panel has brief-section class + widget data attributes.
    assert.match(html, /data-testid="session-brief"/);
    assert.match(html, /brief-section/);
    assert.match(html, /data-testid="session-brief"[^>]*data-url-key="ws-a"/);
    assert.match(html, /data-testid="session-brief"[^>]*data-identifier="LIN-900"/);
    // Recap panel (cache miss) also has widget data attributes.
    assert.match(html, /data-testid="session-recap"/);
    assert.match(html, /recap-section/);
    assert.match(html, /data-testid="session-recap"[^>]*data-url-key="ws-a"/);
    assert.match(html, /data-testid="session-recap"[^>]*data-identifier="LIN-900"/);
  });
});

describe('render-session: escaping', () => {
  test('feedback message + urlLabel are HTML-escaped', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'l', issueIdentifier: 'LIN-900', issueId: 'u', iteration: 1,
        feedback: [{ message: '<script>alert(1)</script>', url: 'https://x/y', urlLabel: '<b>lbl</b>', timestamp: null }],
        telemetry: null
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;b&gt;lbl&lt;\/b&gt;/);
  });
});

describe('render-session: section order (LIN-3250)', () => {
  test('Header strip renders, then Steps, then Task context', () => {
    const issueContext = [{ issueIdentifier: 'LIN-900', issueId: 'uuid-900', brief: 'A brief.', recap: null }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    const headerIdx = html.indexOf('sess-run-header');
    const stepsIdx = html.indexOf('sess-steps');
    const contextIdx = html.indexOf('sess-context-section');
    assert.ok(headerIdx > -1 && stepsIdx > -1 && contextIdx > -1, 'all three sections render');
    assert.ok(headerIdx < stepsIdx, 'Header strip renders before Steps');
    assert.ok(stepsIdx < contextIdx, 'Steps render before Task context');
  });
});

describe('render-session: in-progress status (LIN-1163 item 4)', () => {
  test('a non-terminal run never shows "completed —"; it shows an in-progress element instead', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].terminalCompletedAt = null;
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('completed —'), 'never renders the misleading "completed —"');
    assert.match(html, /data-testid="session-run-elapsed"[^>]*data-dispatched-at="2026-07-04T10:00:00\.000Z"[^>]*>in progress</);
    // The OTHER (terminal) run still renders its real completion time.
    assert.match(html, /data-testid="session-run-completed"[^>]*>completed 2026-07-04T10:05:00\.000Z</);
  });

  test('a terminal run still renders its completed timestamp, not the in-progress element', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-completed"[^>]*>completed 2026-07-04T10:02:00\.000Z</);
  });

  test('the session-level wall clock ticks from data-start while the session is open', () => {
    const html = renderSessionPage({ session: fixtureSession({ completedAt: null }), urlKey: 'ws-a', issueContext: [], sessionTerminal: false });
    assert.ok(!html.includes('completed —'));
    assert.match(html, /data-testid="session-elapsed"[^>]*data-start="2026-07-04T10:00:00\.000Z"/);
    assert.match(html, /data-testid="session-elapsed"[^>]*data-end=""/, 'an open session has no end timestamp');
  });

  test('the session-level wall clock is fixed once the session is terminal', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], sessionTerminal: true });
    assert.match(html, /data-testid="session-elapsed"[^>]*data-end="2026-07-04T10:05:00\.000Z"[^>]*>5m</);
  });
});

describe('render-session: collapsed-run waiting flag (LIN-1163 item 5)', () => {
  test('a non-terminal run whose last feedback entry is [blocked] renders the waiting flag', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [
      { message: 'made some progress', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' },
      { message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:02:00.000Z' }
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-waiting-flag"/);
  });

  // LIN-2264: [pending] is an agent-to-agent orchestrator handoff (LIN-1025/
  // LIN-843), not a request for user input — it must NOT set this flag. This
  // used to assert the opposite (matching the old positional last-entry read,
  // which treated [blocked]/[pending] alike); the semantic-scan fix aligns
  // `runIsWaiting` with `routes/dashboard.js`'s `loopIsWaiting`, whose
  // `WAITING_WAKE_MARKERS` set is `{'blocked'}` only.
  test('a non-terminal run whose last feedback entry is [pending] does NOT render the waiting flag', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [{ message: '[pending] stepper beat done', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' }];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'));
  });

  // LIN-2264: the actual production defect. Simple Dispatcher posts a
  // `[usage]` bookkeeping entry at the same Stop boundary immediately after a
  // `[blocked]` status entry (postUsageSnapshot, hook.js), so on real data
  // EVERY blocked run's literal last feedback entry is `[usage]`, not
  // `[blocked]` — measured 19/19 in production. The old positional last-entry
  // read only skipped `decision-answer` entries, so it never found the
  // `[blocked]` marker here and this flag was effectively dead. The semantic
  // scan (`findWakeEvent`/`wakeMarker`) finds the LAST *wake* marker
  // regardless of trailing non-wake bookkeeping.
  test('LIN-2264: a trailing [usage] entry after [blocked] still renders the waiting flag', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [
      { kind: 'status', message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' },
      { kind: 'usage', message: '[usage] 12,345 tokens', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:01.000Z' }
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-waiting-flag"/);
  });

  // LIN-2264: robust the OTHER direction too — a genuine later wake/terminal
  // marker (here a resume that runs to completion) must still clear the flag,
  // proving this isn't just "always true once [blocked] ever appeared".
  test('LIN-2264: a [blocked] run is no longer waiting once a later real wake marker supersedes it', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [
      { kind: 'status', message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' },
      { kind: 'status', message: '[working] Resumed session', url: null, urlLabel: null, timestamp: '2026-07-04T10:02:00.000Z' },
      { kind: 'status', message: '[pending] stepper beat done', url: null, urlLabel: null, timestamp: '2026-07-04T10:03:00.000Z' }
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'));
  });

  // LIN-2264: prefers the build-time `loop.wakeMarker` (baked by
  // `lib/pipeline-loops.js`'s `_buildLoops`, present on lean and non-lean
  // loops alike) over re-scanning `feedback[]`, exactly like
  // `routes/dashboard.js`'s `loopIsWaiting` — so a lean loop (feedback
  // dropped) still renders correctly, and a loop's baked verdict is trusted
  // over stale raw feedback shape.
  test('LIN-2264: prefers the build-time wakeMarker over re-scanning feedback when present', () => {
    const waitingSession = fixtureSession();
    waitingSession.loops[0].terminalStatus = null;
    waitingSession.loops[0].wakeMarker = 'blocked';
    waitingSession.loops[0].feedback = [];
    const waitingHtml = renderSessionPage({ session: waitingSession, urlKey: 'ws-a', issueContext: [] });
    assert.match(waitingHtml, /data-testid="session-run-waiting-flag"/, 'wakeMarker: blocked renders even with empty feedback[]');

    const doneSession = fixtureSession();
    doneSession.loops[0].terminalStatus = null;
    doneSession.loops[0].wakeMarker = 'done';
    doneSession.loops[0].feedback = [{ message: '[blocked] stale, superseded by the baked wakeMarker', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' }];
    const doneHtml = renderSessionPage({ session: doneSession, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!doneHtml.includes('data-testid="session-run-waiting-flag"'), 'wakeMarker: done wins over a stale [blocked] in raw feedback');
  });

  test('LIN-2244: a run currently parked on an async wait renders a THIRD, distinct flag — not the waiting-for-input one', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].telemetry.parkedWait = { since: '2026-07-04T10:01:00.000Z', latest: '2026-07-04T10:03:00.000Z' };
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-parked-flag"[^>]*>◐ parked on a wait since 2026-07-04T10:01:00\.000Z</);
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'), 'not the blocked-on-a-human flag');
  });

  test('LIN-2244: blocked-on-a-human always wins if both signals were somehow present', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [{ message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:02:00.000Z' }];
    session.loops[0].telemetry.parkedWait = { since: '2026-07-04T10:01:00.000Z', latest: '2026-07-04T10:03:00.000Z' };
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-waiting-flag"/);
    assert.ok(!html.includes('data-testid="session-run-parked-flag"'));
  });

  test('LIN-2244: no parked flag at all when the run is not currently parked', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-parked-flag"'));
  });

  // LIN-2264: this used to assert the flag stays OFF here — a symptom of the
  // very bug this ticket fixes. A trailing non-wake entry (a bare status note,
  // exactly like the real `[usage]` bookkeeping entry) must NOT hide an
  // earlier `[blocked]` that nothing has actually superseded: `findWakeEvent`
  // scans backward past it and still finds `[blocked]` as the last WAKE
  // marker, matching `routes/dashboard.js`'s `loopIsWaiting` on the same
  // shape. Only a later marker that is ITSELF a wake event (see the
  // "superseded by a later real wake marker" test above) clears the flag.
  test('a [blocked] entry followed by a trailing non-wake entry still renders the flag', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [
      { message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' },
      { message: 'human replied, back to work', url: null, urlLabel: null, timestamp: '2026-07-04T10:02:00.000Z' }
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-waiting-flag"/);
  });

  test('a TERMINAL run does not render the flag even if its last entry looks like [blocked]', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = 'done'; // already fixtureSession default, kept explicit
    session.loops[0].feedback = [{ message: '[blocked] stale marker from earlier', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' }];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'));
  });

  test('an ordinary running run with no blocked marker does not render the flag', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'));
  });

  test('a run superseded by a follow-up loop does not render the flag, even though its own last feedback is [blocked]', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [{ message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' }];
    // The follow-up reply spawned a NEW loop pointing back at loop-1 (LIN-1341) —
    // the original loop's own feedback never changes, so without the supersession
    // exclusion it would stay flagged "waiting for input" forever.
    session.loops.push({
      loopId: 'loop-3',
      followUpTo: 'loop-1',
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      iteration: 3,
      kind: 'autopilot',
      dispatchedAt: '2026-07-04T10:03:00.000Z',
      terminalStatus: null,
      feedback: [{ message: 'resuming after reply', url: null, urlLabel: null, timestamp: '2026-07-04T10:03:01.000Z' }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'));
  });
});

describe('render-session: blocked/pending transcript marker (LIN-1163 item 6)', () => {
  test('a [blocked] feedback entry is flagged blocked:true in the embedded data-feedback JSON', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'l', issueIdentifier: 'LIN-900', issueId: 'u', iteration: 1,
        feedback: [
          { message: 'ordinary progress note', url: null, urlLabel: null, timestamp: null },
          { message: '[blocked] need your decision', url: null, urlLabel: null, timestamp: null },
          { message: '[pending] beat done, task continues', url: null, urlLabel: null, timestamp: null }
        ],
        telemetry: null
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    const match = html.match(/data-feedback="([^"]*)"/);
    assert.ok(match, 'transcript container with data-feedback renders');
    const decoded = match[1]
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const entries = JSON.parse(decoded);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].blocked, false, 'an ordinary entry is not flagged blocked');
    assert.equal(entries[1].blocked, true, 'a [blocked] entry is flagged');
    assert.equal(entries[2].blocked, true, 'a [pending] entry is flagged');
  });
});

describe('render-session: lineage-continuous rendering (LIN-1478 S-C fold)', () => {
  // Two loops sharing a lineageId (the second's `item.rootItemId ?? loop.loopId`
  // resolves to the first's id, mirroring lib/pipeline-loops.js's derivation).
  // wake-1 has 1 heartbeat, wake-2 has 3 — distinct `metrics.length`s so the
  // per-run chip test below can tell "own count" from "bled-in lineage total".
  function twoWakeSession(overrides = {}) {
    return fixtureSession({
      loops: [
        {
          loopId: 'wake-1', lineageId: 'wake-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900',
          issueTitle: 'Seed task', iteration: 1, kind: 'autopilot', dispatchedAt: '2026-07-04T10:00:00.000Z',
          terminalStatus: null, feedback: [{ message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:00:01.000Z' }],
          telemetry: { runtime: { ms: 60000 }, metrics: [{ toolCount: 2 }], producedArtifacts: [] }
        },
        {
          loopId: 'wake-2', lineageId: 'wake-1', followUpTo: 'wake-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900',
          issueTitle: 'Seed task', iteration: 2, kind: 'autopilot', dispatchedAt: '2026-07-04T10:05:00.000Z',
          terminalStatus: null, feedback: [{ message: 'resuming after reply', url: null, urlLabel: null, timestamp: '2026-07-04T10:05:01.000Z' }],
          telemetry: { runtime: { ms: 30000 }, metrics: [{ toolCount: 5 }, { toolCount: 7 }, { toolCount: 9 }], producedArtifacts: [] }
        }
      ],
      ...overrides
    });
  }

  test('a two-wake lineage renders ONE session-lineage container holding two session-run segments', () => {
    const html = renderSessionPage({ session: twoWakeSession(), urlKey: 'ws-a', issueContext: [] });
    const lineageContainers = html.match(/data-testid="session-lineage"/g) || [];
    assert.equal(lineageContainers.length, 1, 'exactly one lineage container');
    assert.match(html, /data-testid="session-lineage" data-lineage-id="wake-1"/);
    const runSegments = html.match(/data-testid="session-run"/g) || [];
    assert.equal(runSegments.length, 2, 'both constituent runs still render as session-run segments');
    assert.match(html, /data-loop-id="wake-1"/, 'the first wake keeps its own data-loop-id');
    assert.match(html, /data-loop-id="wake-2"/, 'the second wake keeps its own data-loop-id');
  });

  test('a single-run session renders with NO added lineage chrome — visually unchanged', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'solo-1', lineageId: 'solo-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900',
        issueTitle: 'Solo task', iteration: 1, kind: 'autopilot', dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: 'done', terminalCompletedAt: '2026-07-04T10:01:00.000Z',
        feedback: [{ message: '[done] landed', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' }],
        telemetry: { runtime: { ms: 60000 }, metrics: [], producedArtifacts: [] }
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-lineage"'), 'a lineage of one adds no wrapper');
    assert.match(html, /data-testid="session-run"[^>]*data-loop-id="solo-1"/);
  });

  test('two separate lineages in one session render as two containers, not one merged card', () => {
    const session = fixtureSession({
      loops: [
        ...twoWakeSession().loops,
        {
          loopId: 'other-1', lineageId: 'other-1', issueIdentifier: 'LIN-901', issueId: 'uuid-901',
          issueTitle: 'Unrelated task', iteration: 1, kind: 'implementation', dispatchedAt: '2026-07-04T10:10:00.000Z',
          terminalStatus: 'done', terminalCompletedAt: '2026-07-04T10:12:00.000Z',
          feedback: [{ message: '[done] separate work', url: null, urlLabel: null, timestamp: '2026-07-04T10:12:00.000Z' }],
          telemetry: { runtime: { ms: 60000 }, metrics: [], producedArtifacts: [] }
        }
      ]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    const lineageContainers = html.match(/data-testid="session-lineage"/g) || [];
    assert.equal(lineageContainers.length, 1, 'only the two-wake lineage gets a container; the solo other-1 loop does not');
    assert.match(html, /data-lineage-id="wake-1"/);
    assert.ok(!html.includes('data-lineage-id="other-1"'), 'a lineage of one carries no data-lineage-id container');
    const runSegments = html.match(/data-testid="session-run"/g) || [];
    assert.equal(runSegments.length, 3, 'all three runs across both lineages still render individually');
  });

  test('per-run telemetry chips stay per-run inside a folded lineage — no bleed between wakes', () => {
    const html = renderSessionPage({ session: twoWakeSession(), urlKey: 'ws-a', issueContext: [] });
    // wake-1 has 1 heartbeat, wake-2 has 3 — each run's own chip must reflect
    // only its own metrics.length, never the lineage total (4).
    const wake1Block = html.slice(html.indexOf('data-loop-id="wake-1"'), html.indexOf('data-loop-id="wake-2"'));
    const wake2Block = html.slice(html.indexOf('data-loop-id="wake-2"'));
    assert.match(wake1Block, /session-run-metrics">◐ 1 heartbeats/, 'wake-1 chip shows its own 1 heartbeat');
    assert.match(wake2Block, /session-run-metrics">◐ 3 heartbeats/, 'wake-2 chip shows its own 3 heartbeats');
    assert.ok(!html.includes('4 heartbeats'), 'no chip shows the lineage-wide total');
  });

  test('lineage grouping preserves loop order and does not re-key loop identity', () => {
    const html = renderSessionPage({ session: twoWakeSession(), urlKey: 'ws-a', issueContext: [] });
    const wake1Pos = html.indexOf('data-loop-id="wake-1"');
    const wake2Pos = html.indexOf('data-loop-id="wake-2"');
    assert.ok(wake1Pos > -1 && wake2Pos > wake1Pos, 'wake-1 renders before wake-2, matching dispatchedAt order');
    // loopId is never replaced by lineageId on the run node itself.
    assert.ok(!html.includes('data-loop-id="undefined"'));
  });
});

describe('render-session: tail-anchored reply box + force safety (LIN-1478 beat 4)', () => {
  // Extracts the single reply box's opening-tag attributes as a {name: value}
  // map, so tests compare data-* fields directly rather than fragile raw-HTML
  // string matching (whitespace/join order shouldn't matter to "field-for-field
  // identical").
  function extractReplyBoxAttrs(html) {
    const match = html.match(/<div class="sess-inline-reply" ([^>]*)>/);
    assert.ok(match, 'a reply box renders');
    const attrs = {};
    const attrRe = /([a-z-]+)="([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(match[1]))) attrs[m[1]] = m[2];
    return attrs;
  }

  function replyBoxCount(html) {
    return (html.match(/data-testid="session-inline-reply"/g) || []).length;
  }

  // wake-1 (root) then wake-2 (tail) — terminalStatus overridable per test to
  // drive the adversarial force cases.
  function lineageSession({ rootTerminal = null, tailTerminal = null } = {}) {
    return fixtureSession({
      loops: [
        {
          loopId: 'wake-1', lineageId: 'wake-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900',
          issueTitle: 'Seed task', iteration: 1, kind: 'autopilot', dispatchedAt: '2026-07-04T10:00:00.000Z',
          terminalStatus: rootTerminal, terminalCompletedAt: rootTerminal ? '2026-07-04T10:01:00.000Z' : null,
          feedback: [{ message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:00:01.000Z' }],
          telemetry: { runtime: { ms: 60000 }, metrics: [{ toolCount: 2 }], producedArtifacts: [] }
        },
        {
          loopId: 'wake-2', lineageId: 'wake-1', followUpTo: 'wake-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900',
          issueTitle: 'Seed task', iteration: 2, kind: 'autopilot', dispatchedAt: '2026-07-04T10:05:00.000Z',
          terminalStatus: tailTerminal, terminalCompletedAt: tailTerminal ? '2026-07-04T10:06:00.000Z' : null,
          feedback: [{ message: 'resuming after reply', url: null, urlLabel: null, timestamp: '2026-07-04T10:05:01.000Z' }]
        }
      ]
    });
  }

  test('exactly ONE reply box per lineage, on the tail, never the root', () => {
    const session = lineageSession({});
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.equal(replyBoxCount(html), 1, 'exactly one reply box for the whole lineage');
    const attrs = extractReplyBoxAttrs(html);
    assert.equal(attrs['data-loop-id'], 'wake-2', 'targets the tail (wake-2), never the root (wake-1)');
  });

  test('the lineage reply box is field-for-field identical to the tail run\'s own box rendered standalone', () => {
    const session = lineageSession({});
    const lineageHtml = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true, waiting: true });

    // Same tail loop object, rendered as if it were the session's only run —
    // i.e. what today's per-run inline box on that exact run emits.
    const soloSession = fixtureSession({ loops: [session.loops[1]] });
    const soloHtml = renderSessionPage({ session: soloSession, urlKey: 'ws-a', issueContext: [], canReply: true, waiting: true });

    assert.deepEqual(extractReplyBoxAttrs(lineageHtml), extractReplyBoxAttrs(soloHtml));
  });

  test('adversarial: tail RUNNING + an earlier run DONE — data-terminal is false (never aggregated true, never kill-firsts a live tail)', () => {
    const session = lineageSession({ rootTerminal: 'done', tailTerminal: null });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true, waiting: false });
    const attrs = extractReplyBoxAttrs(html);
    assert.equal(attrs['data-loop-id'], 'wake-2');
    assert.equal(attrs['data-terminal'], 'false', 'an any()-style aggregation would wrongly read true off the done root');
    assert.equal(attrs['data-session-waiting'], 'false');
  });

  test('adversarial: tail TERMINAL — data-terminal is true even though an earlier run is still running (never aggregated false, never collides with the parked window)', () => {
    const session = lineageSession({ rootTerminal: null, tailTerminal: 'done' });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true, waiting: false });
    const attrs = extractReplyBoxAttrs(html);
    assert.equal(attrs['data-loop-id'], 'wake-2');
    assert.equal(attrs['data-terminal'], 'true', 'an all()-style aggregation would wrongly read false off the running root');
  });

  test('non-tail runs inside a folded lineage render no reply box of their own', () => {
    const session = lineageSession({});
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true });
    // The single box found (asserted above) already proves this by count, but
    // pin it structurally too: the root's own data-loop-id never appears as a
    // reply box's data-loop-id value.
    const attrs = extractReplyBoxAttrs(html);
    assert.notEqual(attrs['data-loop-id'], 'wake-1');
  });

  test('a lineage of one is unchanged: its single run is trivially its own tail, reply box still inline', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'solo-1', lineageId: 'solo-1', issueIdentifier: 'LIN-900', issueId: 'uuid-900',
        issueTitle: 'Solo task', iteration: 1, kind: 'autopilot', dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: 'done', terminalCompletedAt: '2026-07-04T10:01:00.000Z',
        feedback: [{ message: '[done] landed', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' }],
        telemetry: { runtime: { ms: 60000 }, metrics: [], producedArtifacts: [] }
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.equal(replyBoxCount(html), 1);
    const attrs = extractReplyBoxAttrs(html);
    assert.equal(attrs['data-loop-id'], 'solo-1');
    assert.equal(attrs['data-terminal'], 'true');
    assert.ok(!html.includes('data-testid="session-lineage"'), 'no lineage wrapper for a group of one');
  });
});

// ── LIN-1567: the document <title> is a distinct sink from the body header ────
// `renderPage` documents `title` as already-escaped text and interpolates it raw
// into <title> (lib/components/page.js), so escaping is the caller's job. The
// body header (render-session.js:510) already escapes the same expression, so
// these assertions deliberately target the HEAD ONLY — a whole-document
// "contains no <script>" check would pass on the strength of line 510 while the
// title stayed vulnerable.
describe('render-session: document <title> escaping (LIN-1567)', () => {
  // Everything before </head>. The shared shell also emits the theme-prepaint
  // <script> in here, so assertions name the payload rather than "any script".
  function headOf(html) {
    const end = html.indexOf('</head>');
    assert.notEqual(end, -1, 'rendered document should have a </head>');
    return html.slice(0, end);
  }

  // Inner text of the first <title> in the head. A payload that breaks out of
  // the element leaves its tail OUTSIDE this capture — which is exactly the
  // failure mode being pinned.
  function titleOf(html) {
    const m = headOf(html).match(/<title>([\s\S]*?)<\/title>/);
    return m ? m[1] : null;
  }

  // LIN-1118 relaxed sessionId from a UUID to an opaque string, so `"`, `<`, `>`
  // and `/` can all reach the title.
  const HOSTILE = '"><script>alert(1)</script>';

  test('a hostile sessionId cannot break out of <title> into live markup', () => {
    const html = renderSessionPage(
      { session: fixtureSession({ sessionId: HOSTILE, seedIssue: null }), urlKey: 'ws-a', issueContext: [] },
      {}
    );
    const head = headOf(html);
    assert.ok(!head.includes('<script>alert(1)</script>'), 'raw script must not reach the document head');
    const title = titleOf(html);
    assert.ok(title != null, 'head should contain a <title>');
    assert.ok(!/[<>]/.test(title), `<title> must hold no markup characters (got: ${JSON.stringify(title)})`);
    assert.equal(title, 'Session · &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('a hostile seedIssue is escaped too — it is the first branch of the ||', () => {
    const html = renderSessionPage(
      { session: fixtureSession({ seedIssue: HOSTILE, sessionId: 'sess-abc' }), urlKey: 'ws-a', issueContext: [] },
      {}
    );
    const head = headOf(html);
    assert.ok(!head.includes('<script>alert(1)</script>'), 'raw script must not reach the document head');
    assert.equal(titleOf(html), 'Session · &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('the head carries exactly one <title> element', () => {
    const html = renderSessionPage(
      { session: fixtureSession({ sessionId: '</title><script>alert(1)</script>', seedIssue: null }), urlKey: 'ws-a', issueContext: [] },
      {}
    );
    const opens = (headOf(html).match(/<title>/g) || []).length;
    const closes = (headOf(html).match(/<\/title>/g) || []).length;
    assert.equal(opens, 1, 'one <title> open tag');
    assert.equal(closes, 1, 'one </title> close tag — a payload must not forge a second');
  });

  test('the ordinary seedIssue title is unchanged (no over-escaping)', () => {
    const html = renderSessionPage(
      { session: fixtureSession({ seedIssue: 'LIN-1567' }), urlKey: 'ws-a', issueContext: [] },
      {}
    );
    assert.equal(titleOf(html), 'Session · LIN-1567');
  });

  test('the ordinary sessionId title is unchanged when there is no seedIssue', () => {
    const html = renderSessionPage(
      { session: fixtureSession({ seedIssue: null, sessionId: 'sess-abc' }), urlKey: 'ws-a', issueContext: [] },
      {}
    );
    assert.equal(titleOf(html), 'Session · sess-abc');
  });

  test('an ampersand is escaped once, not twice (double-encoding guard)', () => {
    const html = renderSessionPage(
      { session: fixtureSession({ seedIssue: 'Tom & Jerry' }), urlKey: 'ws-a', issueContext: [] },
      {}
    );
    assert.equal(titleOf(html), 'Session · Tom &amp; Jerry');
  });

  test('a missing session identity degrades to the bare prefix, not "undefined"', () => {
    const html = renderSessionPage(
      { session: fixtureSession({ seedIssue: null, sessionId: null }), urlKey: 'ws-a', issueContext: [] },
      {}
    );
    assert.equal(titleOf(html), 'Session · ');
  });
});

// ── Credential state (LIN-1588, Beat 2 of LIN-1577) ───────────────────────────
//
// The session page is NOT flag-gated — it ships on the default path — so the
// ORDINARY state (`unknown`, ~99.86% of dispatches per LIN-1585) has to render
// calmly and always, never blank and never as healthy. The verdict itself is
// Beat 1's, resolved at the route and injected here as a tokenId → verdict index.

describe('render-session: credential state (LIN-1588)', () => {
  // Extract the Overview credential cell's inner text + state attribute.
  function credLine(html) {
    const m = html.match(/data-state="([^"]*)" data-testid="session-credential"[^>]*>([\s\S]*?)<\/span>/);
    return m ? { state: m[1], text: m[2] } : null;
  }

  test('the line renders for the ordinary null-token session as `unknown`, never blank', () => {
    // Neither loop in the fixture carries agentTokenId — the common case.
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    const line = credLine(html);
    assert.ok(line, 'the credential line is always rendered');
    assert.equal(line.state, 'unknown');
    assert.match(line.text, /unknown/);
  });

  test('a session whose run carries a dead token renders `dead`', () => {
    const session = fixtureSession();
    session.loops[0].agentTokenId = 'tok-1';
    session.loops[0].agentTokenLabel = 'dispatch-bootstrap';
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], credentialByToken: { 'tok-1': 'credential_dead' } }
    );
    assert.equal(credLine(html).state, 'dead');
    assert.match(html, /data-testid="session-credential"[^>]*>dead/);
  });

  test('a session whose run carries a healthy token renders `ok`', () => {
    const session = fixtureSession();
    session.loops[0].agentTokenId = 'tok-1';
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], credentialByToken: { 'tok-1': 'ok' } }
    );
    assert.equal(credLine(html).state, 'ok');
  });

  test('a token with no verdict in the index renders `unknown`, never a false `ok`', () => {
    const session = fixtureSession();
    session.loops[0].agentTokenId = 'tok-unseen';
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], credentialByToken: { 'tok-other': 'ok' } }
    );
    assert.equal(credLine(html).state, 'unknown');
  });

  test('ONE dead run makes the session dead — it is not averaged away by healthy siblings', () => {
    // "Which of my four trees is dead?" is the question the page answers; a
    // rollup that lets three ok runs outvote one dead run would not answer it.
    const session = fixtureSession();
    session.loops[0].agentTokenId = 'tok-ok';
    session.loops[1].agentTokenId = 'tok-dead';
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], credentialByToken: { 'tok-ok': 'ok', 'tok-dead': 'credential_dead' } }
    );
    assert.equal(credLine(html).state, 'dead');
  });

  test('a hostile agentTokenLabel is escaped at the call site (Overview line)', () => {
    const session = fixtureSession();
    session.loops[0].agentTokenId = 'tok-1';
    session.loops[0].agentTokenLabel = '<img src=x onerror="alert(1)">';
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], credentialByToken: { 'tok-1': 'credential_dead' } }
    );
    assert.ok(!html.includes('<img src=x'), 'the raw tag never reaches the document');
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  test('a hostile agentTokenLabel is escaped in the per-run chip too', () => {
    const session = fixtureSession();
    session.loops[1].agentTokenId = 'tok-2';
    session.loops[1].agentTokenLabel = '"><script>alert(1)</script>';
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], credentialByToken: { 'tok-2': 'ok' } }
    );
    assert.ok(!html.includes('<script>alert(1)</script>'), 'the raw script never reaches the document');
    assert.match(html, /data-testid="session-run-credential"/);
  });

  test('only a run carrying its own token gets a chip', () => {
    const session = fixtureSession();
    session.loops[0].agentTokenId = 'tok-1';
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], credentialByToken: { 'tok-1': 'ok' } }
    );
    const chips = html.match(/data-testid="session-run-credential"/g) || [];
    assert.equal(chips.length, 1, 'the tokenless second run gets no chip');
  });

  test('omitting credentialByToken entirely leaves every pre-existing surface untouched', () => {
    // Back-compat pin: the only difference a caller that never passes the index
    // sees is the added Overview row.
    const withIndex = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], credentialByToken: {} });
    const without = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.equal(withIndex, without);
  });
});

// =============================================================================
// LIN-2154: the durable-comment write's identity attributes + no `data-source`.
//
// A genuinely issueless dispatch item (no `issueIdentifier` at all) is dropped
// as "malformed" by `_buildLoops` (lib/pipeline-loops.js:246/:267) before it
// ever reaches session reconstruction, so it can never reach this renderer
// through the real end-to-end pipeline — an e2e fixture for it is impossible.
// This is the server-side half of the LIN-2154 issueless gate: the renderer's
// contract (an empty `data-issue-identifier` when the loop carries none), unit-
// tested directly against a hand-built loop, matching this file's existing
// pattern for shapes the live pipeline cannot itself produce.
// =============================================================================
describe('render-session: durable-comment identity attributes (LIN-2154)', () => {
  test('data-issue-id / data-issue-identifier are read off the loop, and data-source is never emitted', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-issue-id="uuid-900"/);
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-issue-identifier="LIN-900"/);
    // Deleted, not softened (Step 3 of the plan) — a prior revision threaded
    // loop.source (the dispatch collection) as if it were provider provenance.
    assert.ok(!html.includes('data-source='), 'no data-source attribute anywhere on the page');
  });

  test('issueless gate: a loop with no issueIdentifier emits an empty data-issue-identifier (Save hidden client-side)', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'loop-standalone', issueIdentifier: null, issueId: null,
        iteration: 1, kind: 'implementation', dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: null, feedback: [], telemetry: null
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-issue-id=""/);
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-issue-identifier=""/);
    // The "(no task)" badge (renderRun's own issueless definition) is the same
    // field — both readings must agree on this loop.
    assert.match(html, /sess-run-ident sess-muted/);
  });

  test('a loop carrying issueIdentifier but no issueId still gets a non-empty data-issue-identifier (the e2e fixtures\' own shape)', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'loop-fixture', issueIdentifier: 'LIN-1005', issueId: null,
        iteration: 1, kind: 'implementation', dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: null, feedback: [], telemetry: null
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-issue-id=""/);
    assert.match(html, /data-testid="session-inline-reply"[^>]*data-issue-identifier="LIN-1005"/);
  });

  // ─── LIN-3252 S2: the decision half of the inline reply is GONE ───────────
  test('the per-run inline reply no longer carries decision ids (the pinned card is the answer surface)', () => {
    const session = fixtureSession({
      loops: [{
        loopId: 'loop-decision', issueIdentifier: 'LIN-1006', issueId: 'uuid-1006',
        iteration: 1, kind: 'implementation', dispatchedAt: '2026-07-04T10:00:00.000Z',
        terminalStatus: null, feedback: [], telemetry: null,
        decision: { decision_id: 'd-abc123', question: 'Proceed?' }
      }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-inline-reply"/, 'the free-text reply box still renders');
    assert.ok(!html.includes('data-decision-id='), 'the per-run reply box never emits data-decision-id');
  });

  test('Save and Save-and-continue buttons both render, with distinct testids', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-inline-reply-save"/);
    assert.match(html, /data-testid="session-inline-reply-send"/);
    assert.match(html, /class="action-btn sess-reply-save"/);
  });
});

// ── Run-page header money + tier (LIN-3250) ───────────────────────────────────
describe('render-session: run-page header money (LIN-3250)', () => {
  test('no money markup at all when not every lineage is priced', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-cost"'), 'no money row when the total is withheld');
    assert.ok(!/\$\d/.test(html), 'no dollar figure anywhere when the total is withheld');
  });

  test('a total renders only when every lineage is priced and cumulative (claude-code)', () => {
    const session = fixtureSession();
    session.loops[0].telemetry.usage = { harness: 'claude-code', model: 'claude-opus-4-8', costUsd: 1.5 };
    session.loops[1].telemetry.usage = { harness: 'claude-code', model: 'claude-sonnet-4-6', costUsd: 2.5 };
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-cost"[^>]*>\$4\.00</);
  });

  test('a per-turn harness withholds the header total — no money markup in the header', () => {
    const session = fixtureSession();
    session.loops[0].telemetry.usage = { harness: 'opencode', model: 'claude-opus-4-8', costUsd: 1.5 };
    session.loops[1].telemetry.usage = { harness: 'opencode', model: 'claude-sonnet-4-6', costUsd: 2.5 };
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-cost"'));
    const headerBlock = html.slice(html.indexOf('sess-run-header'), html.indexOf('sess-steps'));
    assert.ok(!/\$\d/.test(headerBlock), 'no money in the header when the total is withheld');
  });

  test('no model identifier string appears anywhere on the page (tier only)', () => {
    const session = fixtureSession();
    session.loops[0].telemetry.model = 'claude-opus-4-8';
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('claude-opus-4-8'), 'the identifier is never printed');
    assert.match(html, /data-testid="session-run-model"[^>]*>◇ premium</);
  });

  test('standalone single-step and goal-only sessions render cleanly', () => {
    const standalone = fixtureSession({
      sessionId: 'solo',
      seedIssue: null,
      loops: [{ loopId: 'solo-1', lineageId: 'solo-1', issueIdentifier: 'LIN-1', issueId: 'u', issueTitle: 'Solo', iteration: 1, kind: 'research', dispatchedAt: '2026-07-04T10:00:00.000Z', terminalStatus: null, feedback: [], telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] } }]
    });
    const soloHtml = renderSessionPage({ session: standalone, urlKey: 'ws-a', issueContext: [] });
    assert.match(soloHtml, /data-testid="session-page"/);
    assert.match(soloHtml, /data-testid="session-progress"[^>]*>the step&#039;s own state</);

    const goalOnly = fixtureSession({
      sessionId: 'goal',
      seedIssue: null,
      loops: [
        { loopId: 'g1', lineageId: 'g1', sessionId: 'goal', issueIdentifier: 'LIN-1', issueId: 'u1', issueTitle: 'Task one', iteration: 1, kind: 'implementation', dispatchedAt: '2026-07-04T10:00:00.000Z', terminalStatus: 'done', telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] } },
        { loopId: 'g2', lineageId: 'g2', sessionId: 'goal', issueIdentifier: 'LIN-2', issueId: 'u2', issueTitle: 'Task two', iteration: 1, kind: 'review', dispatchedAt: '2026-07-04T10:01:00.000Z', terminalStatus: 'done', telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] } }
      ]
    });
    const goalHtml = renderSessionPage({ session: goalOnly, urlKey: 'ws-a', issueContext: [] });
    assert.match(goalHtml, /data-testid="session-page"/);
    assert.match(goalHtml, /data-testid="session-progress"[^>]*>2 steps so far</);
  });
});

// ── LIN-3250 rework: F2 per-row cost wording + plain-word step summaries ─────

// One loop in the reconstructed-session shape, carrying an optional `[usage]`.
function costLoop(overrides = {}) {
  const id = overrides.loopId || 'loop';
  return {
    loopId: id,
    lineageId: overrides.lineageId ?? id,
    kind: overrides.kind || 'implementation',
    issueIdentifier: 'LIN-900',
    issueId: 'uuid-900',
    issueTitle: 'Task title',
    iteration: overrides.iteration ?? 1,
    sessionId: 'sess-abc',
    dispatchedAt: '2026-07-04T10:00:00.000Z',
    terminalStatus: 'done',
    feedback: [],
    telemetry: { runtime: { ms: 1000 }, metrics: [], producedArtifacts: [] },
    ...overrides,
  };
}

// ─── LIN-3247: the run-evidence mount (the one seam LIN-2948 lifts out) ───────

function runEvidenceFixture(overrides = {}) {
  return {
    state: { status: 'ready', pr: { url: 'https://github.com/acme/widget/pull/12', repo: 'acme/widget', number: 12, headSha: 'deadbeef', checksUrl: 'https://github.com/acme/widget/pull/12/checks' }, message: null },
    evidence: {
      asked: 'Do the thing', done: 'PR #12',
      checked: {
        review: { verdict: 'approve-conditional', verdictText: 'Approve — conditional on close-out discharging the ledger.', ciLine: 'CI is green.', at: '2026-07-02T00:00:00.000Z', sha: 'abc1234' },
        now: { state: 'passing', checks: [], headSha: 'deadbeef', prUrl: 'https://github.com/acme/widget/pull/12', checksUrl: 'https://github.com/acme/widget/pull/12/checks', headMoved: false },
      },
    },
    ledger: { verdict: 'approve-conditional', verdictText: 'Approve — conditional on close-out discharging the ledger.', ciLine: 'CI is green.', at: '2026-07-02T00:00:00.000Z', sha: 'abc1234', ledger: { present: true, empty: false, unparsed: false, items: [{ id: 'L1', claim: 'a claim', scope: 'inside', discharge: 'check it', dischargedBy: null, discharged: false, followUp: null, raw: '' }], raw: '' } },
    closeOut: { owner: true, status: 'ready', pr: { url: 'https://github.com/acme/widget/pull/12', number: 12 }, message: null },
    ...overrides,
  };
}

// The `<div data-testid="session-step-summary">…</div>` text for the first step.
function stepSummaryText(html) {
  return /data-testid="session-step-summary">([^<]*)</.exec(html)?.[1] ?? null;
}

// The `<li class="sess-run" data-loop-id="…">…</li>` block for one loop.
function runBlock(html, loopId) {
  const marker = `data-loop-id="${loopId}"`;
  const start = html.lastIndexOf('<li class="sess-run"', html.indexOf(marker));
  assert.notEqual(start, -1, `no run block for ${loopId}`);
  const next = html.indexOf('<li class="sess-run"', start + 1);
  return next === -1 ? html.slice(start) : html.slice(start, next);
}

describe('render-session: per-row cost wording (LIN-3250 F2)', () => {
  test('a priced lineage: earlier rows read "included in the step total", the final row carries the figure', () => {
    const session = fixtureSession({
      loops: [
        costLoop({ loopId: 'r1', lineageId: 'R', iteration: 1, telemetry: { runtime: { ms: 1000 }, model: 'claude-opus-4-8', usage: { harness: 'claude-code', model: 'claude-opus-4-8', costUsd: 5 } } }),
        costLoop({ loopId: 'r2', lineageId: 'R', iteration: 2, followUpTo: 'r1', telemetry: { runtime: { ms: 1000 }, model: 'claude-opus-4-8', usage: { harness: 'claude-code', model: 'claude-opus-4-8', costUsd: 7 } } }),
      ],
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(runBlock(html, 'r1'), /data-testid="session-run-cost">included in the step total</);
    assert.match(runBlock(html, 'r2'), /data-testid="session-run-cost">\$7\.00</);
    assert.match(stepSummaryText(html), /Build · done · premium · \$7\.00/, 'the step summary carries the lineage figure and tier');
  });

  test('an unpriced lineage: rows and summary read "not reported", with the tier still shown', () => {
    const session = fixtureSession({
      loops: [costLoop({ loopId: 'i1', lineageId: 'I', telemetry: { runtime: { ms: 1000 }, model: 'claude-sonnet-4-6', usage: { harness: 'claude-code', model: 'claude-sonnet-4-6', costUsd: null } } })],
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(runBlock(html, 'i1'), /data-testid="session-run-cost">not reported</);
    assert.match(stepSummaryText(html), /Build · done · standard · not reported/, 'tier still shown beside the withheld figure');
    assert.ok(!/\$\d/.test(html), 'no dollar figure anywhere');
  });

  test('a harness-only [usage] reads "not reported" on both the row and the summary', () => {
    const session = fixtureSession({
      loops: [costLoop({ loopId: 'i1', lineageId: 'I', telemetry: { runtime: { ms: 1000 }, usage: { harness: 'claude-code' } } })],
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(runBlock(html, 'i1'), /session-run-cost">not reported</);
    assert.match(stepSummaryText(html), /not reported/);
    assert.ok(!/\$\d/.test(html));
  });

  test('a per-turn harness figure row carries its "as reported" qualifier, and the header total is withheld', () => {
    const session = fixtureSession({
      loops: [costLoop({ loopId: 'i1', lineageId: 'I', telemetry: { runtime: { ms: 1000 }, model: 'claude-opus-4-8', usage: { harness: 'opencode', model: 'claude-opus-4-8', costUsd: 1.25 } } })],
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(runBlock(html, 'i1'), /session-run-cost">\$1\.25 as reported</);
    assert.match(stepSummaryText(html), /Build · done · premium · \$1\.25 as reported/);
    assert.ok(!html.includes('data-testid="session-cost"'), 'per-turn harness withholds the header total');
  });
});

describe('render-session: plain-word step summaries (LIN-3250 nit)', () => {
  test('operator kinds are replaced by plain words in step summaries', () => {
    const session = fixtureSession({
      loops: [
        costLoop({ loopId: 'a1', lineageId: 'a1', kind: 'autopilot' }),
        costLoop({ loopId: 'w1', lineageId: 'w1', kind: 'wake', terminalStatus: null }),
        costLoop({ loopId: 'p1', lineageId: 'p1', kind: 'plan' }),
        costLoop({ loopId: 'i1', lineageId: 'i1', kind: 'implementation' }),
        costLoop({ loopId: 'r1', lineageId: 'r1', kind: 'review' }),
        costLoop({ loopId: 'c1', lineageId: 'c1', kind: 'close-out' }),
      ],
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    const summaries = [...html.matchAll(/data-testid="session-step-summary">([^<]*)</g)].map(m => m[1]);
    assert.deepEqual(summaries, [
      'Kick-off · done · not reported',
      'Check-in · in progress · not reported',
      'Plan · done · not reported',
      'Build · done · not reported',
      'Review · done · not reported',
      'Close-out · done · not reported',
    ]);
    for (const s of summaries) {
      assert.ok(!/autopilot|wake ·/.test(s), `operator kind leaked into summary: ${s}`);
    }
  });
});

describe('render-session: a real-shaped stepped single-lineage session (LIN-3250 ledger item 5)', () => {
  test('with close-out still running, one lineage renders 3 of 4 with Next: close-out and intact rows', () => {
    const session = fixtureSession({
      sessionId: 'stepped-1',
      completedAt: null,
      loops: [
        costLoop({ loopId: 'l1', lineageId: 'L', kind: 'plan', iteration: 1 }),
        costLoop({ loopId: 'l2', lineageId: 'L', kind: 'implementation', iteration: 2, followUpTo: 'l1' }),
        costLoop({ loopId: 'l3', lineageId: 'L', kind: 'review', iteration: 3, followUpTo: 'l2' }),
        costLoop({ loopId: 'l4', lineageId: 'L', kind: 'implementation', iteration: 4, followUpTo: 'l3' }),
        costLoop({ loopId: 'l5', lineageId: 'L', kind: 'close-out', iteration: 5, followUpTo: 'l4', terminalStatus: null }),
      ],
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-progress"[^>]*>3 of 4 stages</);
    assert.match(html, /data-testid="session-next"[^>]*>Next: close-out</);
    assert.match(stepSummaryText(html), /^Close-out · in progress/, 'the active loop decides the step kind/status');
    assert.equal((html.match(/data-testid="session-step"/g) || []).length, 1, 'one lineage → one step');
    assert.equal((html.match(/data-testid="session-run"/g) || []).length, 5, 'all five loops keep their rows');
  });
});

describe('render-session: run-evidence mounts (LIN-3247/LIN-3251 §4)', () => {
  test('renderEvidence mounts after the paragraph (before steps); renderCloseOutBox after the steps (before Task context)', () => {
    const html = renderSessionPage({
      session: fixtureSession(), urlKey: 'ws-a', issueContext: [], runEvidence: runEvidenceFixture(),
    });
    // LIN-3251 moved the LIN-3247 top-of-page mount into its two §4 slots.
    assert.ok(!html.includes('data-testid="run-evidence-mount"'), 'the old bundled top mount is gone');
    assert.match(html, /data-testid="run-evidence-checked"/);
    assert.match(html, /data-testid="run-evidence-closeout"/);
    const evidenceIdx = html.indexOf('data-testid="run-evidence"');
    const closeOutIdx = html.indexOf('data-testid="run-evidence-closeout"');
    const paragraphIdx = html.indexOf('data-testid="session-paragraph"');
    const stepsIdx = html.indexOf('sess-steps');
    const contextIdx = html.indexOf('sess-context-section');
    assert.ok(paragraphIdx < evidenceIdx, 'evidence after the paragraph');
    assert.ok(evidenceIdx < stepsIdx, 'evidence before the steps');
    assert.ok(stepsIdx < closeOutIdx, 'close-out box after the steps');
    assert.ok(closeOutIdx < contextIdx, 'close-out box before Task context');
  });

  test('no runEvidence renders neither fragment — no mount, no placeholder, no empty box', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="run-evidence-mount"'));
    assert.ok(!html.includes('data-testid="run-evidence"'));
    assert.ok(!html.includes('data-testid="run-evidence-closeout"'));
    assert.ok(!/has been merged/i.test(html), 'no merge claim without an open-PR read');
  });

  test('each fragment renders exactly once', () => {
    const html = renderSessionPage({
      session: fixtureSession(), urlKey: 'ws-a', issueContext: [], runEvidence: runEvidenceFixture(),
    });
    assert.equal((html.match(/data-testid="run-evidence"/g) || []).length, 1, 'one evidence fragment');
    assert.equal((html.match(/data-testid="run-evidence-closeout"/g) || []).length, 1, 'one close-out box');
  });

  test('a guest viewer gets the evidence rows but no close-out box', () => {
    const html = renderSessionPage({
      session: fixtureSession(), urlKey: 'ws-a', issueContext: [],
      runEvidence: runEvidenceFixture({ closeOut: { owner: false, status: 'ready', pr: { url: 'https://github.com/acme/widget/pull/12', number: 12 }, message: null } }),
    });
    assert.match(html, /data-testid="run-evidence-checked"/);
    assert.ok(!html.includes('data-testid="run-evidence-closeout"'));
  });
});

// ─── LIN-3251: the §4 page order and the header PR line ──────────────────────

describe('render-session: page order (LIN-3251, LIN-2948 §4)', () => {
  function orderDecisionRow() {
    return {
      decision: { decision_id: 'd-1', question: 'Proceed?' },
      decisionCase: [],
      anchor: { loopId: 'loop-1', issueId: 'uuid-900', issueIdentifier: 'LIN-900', workspaceUrlKey: 'ws-a', target: 'cli', followUpTo: null },
      stampLoopId: 'loop-1', disposition: 'resumable', canReply: true, effect: 'resume'
    };
  }

  test('heading → header strip → pinned card → paragraph → evidence → steps → close-out → Task context', () => {
    const html = renderSessionPage({
      session: fixtureSession(), urlKey: 'ws-a',
      issueContext: [{ issueIdentifier: 'LIN-900', issueId: 'uuid-900', brief: 'A brief.', recap: null }],
      decisions: [orderDecisionRow()],
      runEvidence: runEvidenceFixture(),
    });
    const idx = (needle) => {
      const i = html.indexOf(needle);
      assert.ok(i > -1, `marker present: ${needle}`);
      return i;
    };
    const heading = idx('data-testid="session-title"');
    const header = idx('sess-run-header');
    const pinned = idx('sess-qcards');
    const paragraph = idx('data-testid="session-paragraph"');
    // The evidence marker sits inside the evidence section; `run-evidence-closeout`
    // is only in the close-out box, so it unambiguously marks the later slot.
    const evidence = idx('data-testid="run-evidence-checked"');
    const steps = idx('sess-steps');
    const closeOut = idx('data-testid="run-evidence-closeout"');
    const context = idx('sess-context-section');

    assert.ok(heading < header, 'heading before header strip');
    assert.ok(header < pinned, 'header strip before pinned card');
    assert.ok(pinned < paragraph, 'pinned card before paragraph');
    assert.ok(paragraph < evidence, 'paragraph before evidence');
    assert.ok(evidence < steps, 'evidence before steps');
    assert.ok(steps < closeOut, 'steps before close-out box');
    assert.ok(closeOut < context, 'close-out box before Task context');
  });
});

describe('render-session: PR line (LIN-3251)', () => {
  const prLine = (data) => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], ...data });
    return { html, text: /data-testid="session-pr-line">([^<]*)</.exec(html)?.[1] ?? null };
  };

  test('the four approved copies, exact strings', () => {
    assert.equal(prLine({ prState: { state: 'none' } }).text, 'No pull request yet.');
    assert.equal(prLine({ prState: { state: 'open', number: 12, checks: 'passing' } }).text, 'Nothing has been merged. PR #12 is open: checks passing.');
    assert.equal(prLine({ prState: { state: 'open', number: 12, checks: 'failing' } }).text, 'Nothing has been merged. PR #12 is open: checks failing.');
    assert.equal(prLine({ prState: { state: 'open', number: 12, checks: 'running' } }).text, 'Nothing has been merged. PR #12 is open: checks running.');
    assert.equal(prLine({ prState: { state: 'merged', number: 12 } }).text, 'PR #12 was merged.');
    assert.equal(prLine({ prState: { state: 'unknown', number: 12 } }).text, 'PR #12: state not reported.');
  });

  test('with no known state the initial line is neutral — it never claims a merge', () => {
    const { html, text } = prLine({});
    assert.equal(text, 'Checking for a pull request…');
    assert.ok(!/has been merged|was merged/i.test(html), 'the neutral initial line makes no merge claim');
  });

  test('the line carries the poll URL and run liveness for beat 3', () => {
    const { html } = prLine({});
    assert.match(html, /data-testid="session-pr-state"[^>]*data-pr-state-url="\/workspace\/ws-a\/api\/run\/sess-abc\/pr-state"/);
    assert.match(html, /data-testid="session-pr-state"[^>]*data-run-live="true"/);
    const live = prLine({ sessionTerminal: true }).html;
    assert.match(live, /data-testid="session-pr-state"[^>]*data-run-live="false"/);
  });
});
