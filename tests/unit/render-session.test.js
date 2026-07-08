import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../../lib/render-session.js';

// LIN-1003: the dedicated per-session page renderer. Pure (data) → HTML on the
// shared shell; the route does all reads and hands this a plain data object.
// These tests build a NON-lean fixture session (with feedback[]) directly.
// LIN-1133: transcript is now per-run (expandable <details>), brief is rendered
// markdown, panels carry refresh/generate buttons.

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

describe('render-session: per-run transcript (LIN-1133)', () => {
  test('renders each feedback entry inside per-run expandable details', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    // Two runs → two per-run transcript details sections.
    const detailBlocks = html.match(/data-testid="session-run-transcript"/g) || [];
    assert.equal(detailBlocks.length, 2, 'two per-run transcript sections');
    // Three total feedback entries across two runs.
    const entries = html.match(/data-testid="session-transcript-entry"/g) || [];
    assert.equal(entries.length, 3, 'all three feedback entries render');
    assert.match(html, /\[started\] session/);
    assert.match(html, /\[evidence\] opened PR/);
    assert.match(html, /data-testid="session-transcript-link"[^>]*href="https:\/\/example\.com\/pr\/1"/);
    assert.match(html, />PR #1<\/a>/);
  });

  test('a run with no feedback shows an empty note inside details', () => {
    const session = fixtureSession({
      loops: [{ loopId: 'l', issueIdentifier: 'LIN-900', issueId: 'u', iteration: 1, feedback: [], telemetry: null }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-run-transcript"/);
    assert.match(html, /no transcript entries/);
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

describe('render-session: brief/recap context branches (LIN-1023 + LIN-1133)', () => {
  const RECAP_OBJECT = {
    done: [{ item: 'Wired the auth callback', evidence: 'commit abc123' }],
    pending: [{ item: 'Add rate limiting', predicted: 'guard the token route' }],
    deviations: [{ item: 'Token TTL shortened', type: 'scope-change', evidence: 'per review comment' }]
  };

  test('present brief renders as markdown HTML, not escaped pre-text', () => {
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
    // The brief is rendered as markdown (HTML), not escaped <pre> text.
    assert.match(html, /class="sess-ctx-body rendered-markdown"/);
    assert.match(html, /<p>The current brief body\.<\/p>/);
    // Refresh button is present when body is cached.
    assert.match(html, /data-testid="session-brief-refresh"/);
    assert.match(html, /\u21BB refresh/);
    assert.match(html, /data-testid="session-recap"/);
    assert.match(html, /data-testid="session-recap-body"/);
    assert.match(html, /Wired the auth callback/);
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

  test('a cache miss renders a generate button (never auto-spend)', () => {
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

describe('render-session: human reply box (LIN-1004) + per-run inline (LIN-1133)', () => {
  test('renders the bottom reply box + per-run inline replies when canReply', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    // Bottom reply box.
    assert.match(html, /data-testid="session-reply"/);
    assert.match(html, /data-testid="session-reply-input"/);
    assert.match(html, /data-testid="session-reply-send"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-session-id="sess-abc"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-target="cli"/);
    // Per-run inline reply boxes — one per run.
    const runReplies = html.match(/data-testid="session-run-reply"/g) || [];
    assert.equal(runReplies.length, 2, 'two per-run inline reply boxes');
    assert.match(html, /data-testid="session-run-reply"[^>]*data-follow-up="loop-1"/);
    assert.match(html, /data-testid="session-run-reply"[^>]*data-follow-up="loop-2"/);
    // session.js loads when canReply is true; common.js loads only with issueContext present.
    assert.match(html, /<script src="\/session\.js"><\/script>/);
  });

  test('per-run inline replies are absent when canReply is false', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false },
      {}
    );
    assert.ok(!html.includes('data-testid="session-run-reply"'), 'no per-run reply boxes');
  });

  test('per-run replies are present but bottom reply box is NOT when canReply is false', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false },
      {}
    );
    assert.ok(!html.includes('data-testid="session-reply"'), 'no reply box when canReply is false');
    assert.ok(!html.includes('/session.js'), 'no scoped script when the box is absent');
  });

  test('a terminal session sends force (data-session-terminal="true") with an honest resume note', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: true },
      {}
    );
    assert.match(html, /data-testid="session-reply"[^>]*data-session-terminal="true"/);
    assert.match(html, /data-testid="session-reply-note"[^>]*>[^<]*no live session to resume/);
  });

  test('a waiting/non-terminal session omits force (data-session-terminal="false")', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false, waiting: true, waitingMessage: 'pick one' },
      {}
    );
    assert.match(html, /data-testid="session-reply"[^>]*data-session-terminal="false"/);
    assert.match(html, /data-testid="session-reply-note"[^>]*>[^<]*queued into this session/);
  });

  test('a web-target session threads data-target="web"', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'web', sessionTerminal: false },
      {}
    );
    assert.match(html, /data-testid="session-reply"[^>]*data-target="web"/);
  });
});

describe('render-session: not-found body', () => {
  test('a null session renders a 404 body, not a crash', () => {
    const html = renderSessionPage({ session: null, sessionId: 'nope', urlKey: 'ws-a' });
    assert.match(html, /data-testid="session-not-found"/);
    assert.match(html, /Session not found/);
    assert.match(html, /data-testid="session-back"/);
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
