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

describe('render-session: anchor issue title (LIN-1801)', () => {
  test('a distinct anchorIssueTitle renders on the header, browser title, and a new seed-title span; session-seed stays identifier-only', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], anchorIssueTitle: 'Seed task' },
      {}
    );
    assert.match(html, /data-testid="session-seed"[^>]*>LIN-900</, 'session-seed keeps its identifier-only content');
    assert.match(html, /data-testid="session-seed-title"[^>]*>Seed task</);
    assert.match(html, /<h1>Session · LIN-900 — Seed task<\/h1>/);
    assert.match(html, /<title>Session · LIN-900 — Seed task<\/title>/);
  });

  test('an absent anchorIssueTitle renders byte-identical to today (no new span, no suffix)', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] }, {});
    assert.ok(!html.includes('data-testid="session-seed-title"'));
    assert.match(html, /<h1>Session · LIN-900<\/h1>/);
    assert.match(html, /<title>Session · LIN-900<\/title>/);
  });

  test('anchorIssueTitle equal to session.seedIssue is treated as no title (LIN-783-style regression guard)', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], anchorIssueTitle: 'LIN-900' },
      {}
    );
    assert.ok(!html.includes('data-testid="session-seed-title"'));
    assert.match(html, /<h1>Session · LIN-900<\/h1>/);
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
    // The banner steers the human to the per-run reply box (LIN-1163 — the
    // page-level box it used to point at was removed).
    assert.match(html, /data-testid="session-waiting-cta"[^>]*>[^<]*own reply box/);
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

  test('LIN-1425: telemetry.usage is inert — output is byte-identical whether present or absent', () => {
    const withoutUsage = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });

    const session = fixtureSession();
    session.telemetry.usage = { harness: 'claude-code', model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 2, costUsd: null };
    session.loops[0].telemetry.usage = { harness: 'claude-code', model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 2, costUsd: null };
    const withUsage = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });

    assert.equal(withUsage, withoutUsage, 'renderRunChips/renderSessionPage must not render or be affected by telemetry.usage (display is LIN-1426)');
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

describe('render-session: section order (LIN-1163 item 2)', () => {
  test('Task context renders between Overview and Runs', () => {
    const issueContext = [{ issueIdentifier: 'LIN-900', issueId: 'uuid-900', brief: 'A brief.', recap: null }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    const overviewIdx = html.indexOf('sess-overview');
    const contextIdx = html.indexOf('sess-context-section');
    const runsIdx = html.indexOf('sess-runs-section');
    assert.ok(overviewIdx > -1 && contextIdx > -1 && runsIdx > -1, 'all three sections render');
    assert.ok(overviewIdx < contextIdx, 'Overview renders before Task context');
    assert.ok(contextIdx < runsIdx, 'Task context renders before Runs');
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

  test('the session-level Overview "completed" row gets the same treatment when the session is non-terminal', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], sessionTerminal: false });
    assert.ok(!html.includes('completed —'));
    assert.match(html, /data-testid="session-elapsed"[^>]*data-dispatched-at="2026-07-04T10:00:00\.000Z"[^>]*>in progress</);
  });

  test('the session-level Overview "completed" row shows the real timestamp when the session is terminal', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [], sessionTerminal: true });
    assert.ok(!html.includes('data-testid="session-elapsed"'));
    assert.match(html, /<span class="sess-k">completed<\/span><span class="sess-v">2026-07-04T10:05:00\.000Z</);
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

  test('a non-terminal run whose last feedback entry is [pending] renders the waiting flag', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [{ message: '[pending] stepper beat done', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' }];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-waiting-flag"/);
  });

  test('a run whose [blocked] entry is NOT the last one does not render the flag', () => {
    const session = fixtureSession();
    session.loops[0].terminalStatus = null;
    session.loops[0].feedback = [
      { message: '[blocked] need a decision', url: null, urlLabel: null, timestamp: '2026-07-04T10:01:00.000Z' },
      { message: 'human replied, back to work', url: null, urlLabel: null, timestamp: '2026-07-04T10:02:00.000Z' }
    ];
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.ok(!html.includes('data-testid="session-run-waiting-flag"'));
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
