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
});

describe('render-session: tasks + overview', () => {
  test('renders tasks-touched chips and the seed', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-tasks"/);
    const tasks = html.match(/data-testid="session-task"/g) || [];
    assert.equal(tasks.length, 2);
    assert.match(html, /data-testid="session-seed"[^>]*>LIN-900</);
  });

  test('back-to-feed link targets the workspace observation feed', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-back"[^>]*href="\/workspace\/ws-a\/observation"/);
  });
});

describe('render-session: waiting banner (LIN-1005)', () => {
  test('renders the "waiting on you" alert banner with the message + follow-up CTA when waiting', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: true, waitingMessage: 'need your decision on the auth flow' },
      {}
    );
    assert.match(html, /data-testid="session-waiting-banner"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Waiting on you/);
    assert.match(html, /data-testid="session-waiting-message"[^>]*>need your decision on the auth flow</);
    // The banner steers the human to the Phase 2 follow-up box.
    assert.match(html, /data-testid="session-waiting-cta"[^>]*>[^<]*follow-up box/);
  });

  test('no banner when the session is not waiting', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] }, {});
    assert.ok(!html.includes('data-testid="session-waiting-banner"'), 'no banner by default');
  });

  test('the banner renders without a message when none is available (agent-status-only block)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: true, waitingMessage: null },
      {}
    );
    assert.match(html, /data-testid="session-waiting-banner"/);
    assert.ok(!html.includes('data-testid="session-waiting-message"'), 'no message element when message is null');
  });

  test('the waiting message is HTML-escaped', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], waiting: true, waitingMessage: '<script>alert(1)</script>' },
      {}
    );
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not leak');
    assert.match(html, /&lt;script&gt;/);
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

  test('model chip renders when telemetry supplies a model', () => {
    const session = fixtureSession();
    session.telemetry.model = 'claude-opus-4-8';
    session.loops[0].telemetry.model = 'claude-opus-4-8';
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-model"[^>]*>◇ claude-opus-4-8</);
    assert.match(html, /data-testid="session-model"[^>]*>claude-opus-4-8</);
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

describe('render-session: human reply box (LIN-1004)', () => {
  test('renders the reply box + loads scripts when canReply', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    assert.match(html, /data-testid="session-reply"/);
    assert.match(html, /data-testid="session-reply-input"/);
    assert.match(html, /data-testid="session-reply-send"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-session-id="sess-abc"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-target="cli"/);
    // Scripts always load (transcripts, widgets, expand/collapse, reply).
    assert.match(html, /<script src="\/session\.js"><\/script>/);
  });

  test('NO reply box when canReply is false (scripts still loaded for transcripts + widgets)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false },
      {}
    );
    assert.ok(!html.includes('data-testid="session-reply"'), 'no reply box when canReply is false');
    // Scripts are always loaded — they handle transcripts, context widgets, and expand/collapse.
    assert.match(html, /script src="\/common\.js/);
    assert.match(html, /script src="\/session\.js/);
    // NO inline reply boxes when canReply is false.
    assert.ok(!html.includes('data-testid="session-inline-reply"'));
  });

  // Force is computed CLIENT-side (public/session.js) as `terminal || waiting`;
  // these tests pin the two attributes that drive it (LIN-1252).
  test('a terminal session sends force (data-session-terminal="true", waiting="false") with an honest resume note', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: true },
      {}
    );
    assert.match(html, /data-testid="session-reply"[^>]*data-session-terminal="true"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-session-waiting="false"/);
    // The note surfaces the possible failed-resume honestly.
    assert.match(html, /data-testid="session-reply-note"[^>]*>[^<]*no live session to resume/);
  });

  test('a waiting/non-terminal session sends force via data-session-waiting="true" (LIN-1252)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false, waiting: true, waitingMessage: 'pick one' },
      {}
    );
    // Non-terminal, but flagged waiting → the client ORs waiting into force.
    assert.match(html, /data-testid="session-reply"[^>]*data-session-terminal="false"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-session-waiting="true"/);
    // The note stays the warm/queued wording (terminal-driven), not the resume caveat.
    assert.match(html, /data-testid="session-reply-note"[^>]*>[^<]*queued into this session/);
  });

  test('a genuinely warm/executing session omits force (terminal="false", waiting="false")', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false, waiting: false },
      {}
    );
    assert.match(html, /data-testid="session-reply"[^>]*data-session-terminal="false"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-session-waiting="false"/);
  });

  test('a web-target session threads data-target="web"', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'web', sessionTerminal: false },
      {}
    );
    assert.match(html, /data-testid="session-reply"[^>]*data-target="web"/);
  });

  // LIN-1298: the reply surface reuses the shared Task Chat conversational UI — a
  // chat composer with an echo thread that the client fills with a "you" bubble on
  // send — and links the shared chat.css stylesheet + the shared chat.js render
  // helper (ChatUI, LIN-1298 v2) that builds that bubble.
  test('the reply box adopts the shared chat UI (composer + echo thread) and links chat.css + chat.js (LIN-1298)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    assert.match(html, /<link[^>]*href="\/chat\.css"/, 'the shared chat stylesheet is linked');
    assert.match(html, /<script src="\/chat\.js"><\/script>/, 'the shared chat render helper is loaded');
    assert.match(html, /class="chat-composer"/, 'the reply input sits in a chat composer');
    assert.match(html, /data-testid="session-reply-thread"/, 'an echo thread container is present for client-appended "you" bubbles');
    // The composer still carries the original interactive hooks (unchanged wire).
    assert.match(html, /class="[^"]*chat-composer__input[^"]*"[^>]*data-testid="session-reply-input"/);
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

  test('global reply box is still rendered as fallback when canReply', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true });
    assert.match(html, /data-testid="session-reply"/);
    assert.match(html, /data-testid="session-reply-input"/);
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
