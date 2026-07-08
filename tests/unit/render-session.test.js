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
  test('renders each feedback entry with message + evidence link in per-run transcript containers', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    // Per-run transcript containers (LIN-1133) — not a single page-level section.
    const txContainers = html.match(/data-session-run-tx/g) || [];
    assert.equal(txContainers.length, 2, 'both loops have per-run transcript containers');
    // Two feedback entries in loop-1 + one in loop-2 = 3 entries (server-rendered fallback).
    const entries = html.match(/data-testid="session-transcript-entry"/g) || [];
    assert.equal(entries.length, 3, 'all three feedback entries render');
    // Embedded feedback JSON for client-side markdown rendering.
    assert.match(html, /data-feedback="\[\{/);
    assert.match(html, /\[started\] session/);
    assert.match(html, /\[evidence\] opened PR/);
    // The link-rich entry renders its url + label.
    assert.match(html, /data-testid="session-transcript-link"[^>]*href="https:\/\/example\.com\/pr\/1"/);
    assert.match(html, />PR #1<\/a>/);
    // The old page-level transcript section is gone (LIN-1133).
    assert.ok(!html.includes('data-testid="session-transcript"'), 'no page-level transcript section');
  });

  test('a session with no feedback renders the run card without a transcript expand section', () => {
    const session = fixtureSession({
      loops: [{ loopId: 'l', issueIdentifier: 'LIN-900', issueId: 'u', iteration: 1, feedback: [], telemetry: null }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    // The run card renders (no crash); no expand section because no feedback and canReply defaults to false.
    assert.match(html, /data-testid="session-run"/);
    assert.ok(!html.includes('data-session-run-tx'), 'no transcript container when feedback is empty');
    // The old page-level empty-transcript note is gone (LIN-1133).
    assert.ok(!html.includes('data-testid="session-transcript-empty"'), 'no page-level empty-transcript note');
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
  test('renders the reply box + loads the scoped script when canReply', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    assert.match(html, /data-testid="session-reply"/);
    assert.match(html, /data-testid="session-reply-input"/);
    assert.match(html, /data-testid="session-reply-send"/);
    // followUpTo target is the session's own id; target threads through as a data-attr.
    assert.match(html, /data-testid="session-reply"[^>]*data-session-id="sess-abc"/);
    assert.match(html, /data-testid="session-reply"[^>]*data-target="cli"/);
    // The one scoped client script loads only when the box is present.
    assert.match(html, /<script src="\/session\.js"><\/script>/);
  });

  test('scripts load whenever feedback needs client-side rendering, even without canReply', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false },
      {}
    );
    assert.ok(!html.includes('data-testid="session-reply"'), 'no global reply box when canReply is false');
    assert.ok(!html.includes('data-testid="session-inline-reply"'), 'no inline reply boxes when canReply is false');
    // Scripts DO load because the fixture has feedback entries — the expand/collapse
    // toggle and markdown rendering need them even without reply capability.
    assert.match(html, /<script src="\/session\.js"><\/script>/);
    assert.match(html, /<script src="\/marked\.min\.js"><\/script>/);
  });

  test('a terminal session sends force (data-session-terminal="true") with an honest resume note', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: true },
      {}
    );
    assert.match(html, /data-testid="session-reply"[^>]*data-session-terminal="true"/);
    // The note surfaces the possible failed-resume honestly.
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

describe('render-session: per-run expandable transcript + inline reply (LIN-1133)', () => {
  test('each run card with feedback renders a per-run transcript container with data-feedback JSON', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false },
      {}
    );
    const txContainers = html.match(/data-session-run-tx/g) || [];
    assert.equal(txContainers.length, 2, 'both feedback-bearing loops have per-run transcript containers');
    assert.match(html, /data-feedback="\[/);
    // Server-rendered fallback inside <div class="sess-run-tx-fallback">.
    assert.match(html, /sess-run-tx-fallback/);
    // The old page-level transcript section is gone.
    assert.ok(!html.includes('session-transcript-section'), 'no page-level transcript section');
  });

  test('per-run inline reply boxes render with per-loop scoping (data-loop-id) when canReply', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    // Both runs have inline reply boxes.
    const inlineReplies = html.match(/data-testid="session-inline-reply"/g) || [];
    assert.equal(inlineReplies.length, 2, 'both loops have inline replies');

    // Scoped to each loop's own id, not the session root.
    assert.match(html, /data-loop-id="loop-1"/);
    assert.match(html, /data-loop-id="loop-2"/);
    assert.match(html, /data-testid="session-inline-reply-send"/);
    assert.match(html, /data-testid="session-inline-reply-input"/);
  });

  test('inline reply data-terminal reflects loop terminal status', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    // Both fixture loops are 'done' → terminal.
    const inlineReplies = html.match(/data-terminal="true"/g) || [];
    assert.equal(inlineReplies.length, 2, 'both done loops are terminal');
  });

  test('a live (non-terminal) loop gets data-terminal="false"', () => {
    const session = fixtureSession({
      loops: [{ loopId: 'l3', issueIdentifier: 'LIN-999', issueId: 'u99', iteration: 3, kind: 'implementation', feedback: [{ message: 'working…' }], telemetry: null }]
    });
    const html = renderSessionPage(
      { session, urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    assert.match(html, /data-terminal="false"/);
  });

  test('run card has expandable toggle button', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: false },
      {}
    );
    assert.match(html, /data-session-run-toggle/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /sess-run-toggle-icon/);
    // Expandable section exists but is hidden by CSS (display:none on .sess-run-expand).
    assert.match(html, /sess-run-expand/);
    assert.match(html, /sess-run--expandable/);
  });

  test('global reply box still present as fallback alongside per-run inline replies', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    // Both present: global reply AND per-run inline replies.
    assert.match(html, /data-testid="session-reply"/);
    assert.match(html, /data-testid="session-inline-reply"/);
  });

  test('base scripts (marked, purify, common, brief, recap) load when canReply is true', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [], canReply: true, replyTarget: 'cli', sessionTerminal: false },
      {}
    );
    assert.match(html, /<script src="\/marked\.min\.js"><\/script>/);
    assert.match(html, /<script src="\/purify\.min\.js"><\/script>/);
    assert.match(html, /<script src="\/common\.js"><\/script>/);
    assert.match(html, /<script src="\/brief\.js"><\/script>/);
    assert.match(html, /<script src="\/recap\.js"><\/script>/);
    assert.match(html, /<script src="\/session\.js"><\/script>/);
  });

  test('base scripts + session.js load when issueContext is present even without canReply', () => {
    const html = renderSessionPage(
      { session: fixtureSession(), urlKey: 'ws-a', issueContext: [{
        issueIdentifier: 'LIN-900', issueId: 'uuid-900', brief: null, recap: null
      }], canReply: false },
      {}
    );
    assert.match(html, /<script src="\/marked\.min\.js"><\/script>/);
    assert.match(html, /<script src="\/common\.js"><\/script>/);
    assert.match(html, /<script src="\/brief\.js"><\/script>/);
    assert.match(html, /<script src="\/recap\.js"><\/script>/);
    // session.js loads too when issueContext needs widget init.
    assert.match(html, /<script src="\/session\.js"><\/script>/);
  });
});

describe('render-session: Brief/Recap widget containers (LIN-1133)', () => {
  const RECAP_OBJECT = {
    done: [{ item: 'Wired the auth callback', evidence: 'commit abc123' }]
  };

  test('context panels carry data-url-key + data-identifier for client widget init', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      brief: 'The brief body.',
      briefModel: 'openai/gpt-5.4-mini',
      briefGeneratedAt: '2026-07-04T09:00:00.000Z',
      recap: RECAP_OBJECT,
      recapModel: 'openai/gpt-5.4-mini',
      recapGeneratedAt: '2026-07-04T09:01:00.000Z'
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    assert.match(html, /data-session-brief/);
    assert.match(html, /data-session-recap/);
    assert.match(html, /data-url-key="ws-a"/);
    assert.match(html, /data-identifier="LIN-900"/);
  });

  test('cache-miss panels also carry widget attributes for generate-on-demand', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      brief: null,
      recap: null
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    // Miss panels still have the widget attrs so the client can wire refresh.
    assert.match(html, /data-session-brief[^>]*data-url-key="ws-a"/);
    assert.match(html, /data-session-recap[^>]*data-identifier="LIN-900"/);
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
