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
  test('renders each feedback entry with message + evidence link', () => {
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-transcript"/);
    // Two feedback entries in loop-1 + one in loop-2 = 3 entries.
    const entries = html.match(/data-testid="session-transcript-entry"/g) || [];
    assert.equal(entries.length, 3, 'all three feedback entries render');
    assert.match(html, /\[started\] session/);
    assert.match(html, /\[evidence\] opened PR/);
    // The link-rich entry renders its url + label.
    assert.match(html, /data-testid="session-transcript-link"[^>]*href="https:\/\/example\.com\/pr\/1"/);
    assert.match(html, />PR #1<\/a>/);
  });

  test('a session with no feedback shows an empty-transcript note, not a crash', () => {
    const session = fixtureSession({
      loops: [{ loopId: 'l', issueIdentifier: 'LIN-900', issueId: 'u', iteration: 1, feedback: [], telemetry: null }]
    });
    const html = renderSessionPage({ session, urlKey: 'ws-a', issueContext: [] });
    assert.match(html, /data-testid="session-transcript-empty"/);
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
  test('present brief + recap render their cached bodies', () => {
    const issueContext = [{
      issueIdentifier: 'LIN-900',
      issueId: 'uuid-900',
      brief: 'The current brief body.',
      briefModel: 'openai/gpt-5.4-mini',
      briefGeneratedAt: '2026-07-04T09:00:00.000Z',
      recap: 'The recap body.',
      recapModel: 'openai/gpt-5.4-mini',
      recapGeneratedAt: '2026-07-04T09:01:00.000Z'
    }];
    const html = renderSessionPage({ session: fixtureSession(), urlKey: 'ws-a', issueContext });
    assert.match(html, /data-testid="session-brief"/);
    assert.match(html, /The current brief body\./);
    assert.match(html, /data-testid="session-recap"/);
    assert.match(html, /The recap body\./);
    // A present panel does NOT render the miss affordance.
    assert.ok(!html.includes('data-testid="session-brief-generate"'), 'no generate affordance when brief is cached');
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
