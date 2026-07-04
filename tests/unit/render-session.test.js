import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../../lib/render-session.js';

// LIN-1003 Phase 1: the standalone per-session page renderer. Pure
// (data, options) → HTML; these assert the four content surfaces (tasks,
// per-run telemetry, transcript, brief/recap) plus the two behavioural
// contracts the ticket pins: `model` is omitted when absent, and a brief/recap
// cache miss renders an explicit generate affordance (never auto-generated
// content).

// A hand-built NON-lean session: two loops (one with a null issueId), transcript
// feedback with an evidence link, per-run telemetry, and a session runtime.
function fixtureSession() {
  return {
    sessionId: 'sess-abc',
    seedIssue: 'LIN-1',
    tasksTouched: ['LIN-1', 'LIN-2'],
    dispatchedAt: '2026-07-04T10:00:00.000Z',
    completedAt: '2026-07-04T10:12:30.000Z',
    telemetry: { runtime: { ms: 750000 }, metrics: [], producedArtifacts: [] },
    loops: [
      {
        loopId: 'l1', iteration: 1, kind: 'implementation',
        issueIdentifier: 'LIN-1', issueId: 'uuid-1', issueTitle: 'First task',
        issueUrl: 'https://linear.app/x/LIN-1', terminalStatus: 'done',
        telemetry: { runtime: { ms: 300000 }, metrics: [{ total: 12 }], producedArtifacts: [{ url: 'https://gh/pr/1', label: 'PR #1' }] },
        feedback: [
          { message: '[started] session sess-abc', timestamp: '2026-07-04T10:00:00.000Z' },
          { message: '[evidence] opened a PR', url: 'https://gh/pr/1', urlLabel: 'PR #1', timestamp: '2026-07-04T10:05:00.000Z' }
        ]
      },
      {
        loopId: 'l2', iteration: 2, kind: 'review',
        issueIdentifier: 'LIN-2', issueId: null, issueTitle: 'Second task',
        issueUrl: null, terminalStatus: 'done',
        telemetry: { runtime: { ms: 200000 }, metrics: [], producedArtifacts: [], model: 'anthropic/claude-opus' },
        feedback: [{ message: '[done] finished the review', timestamp: '2026-07-04T10:12:00.000Z' }]
      }
    ]
  };
}

describe('render-session: page shell + overview', () => {
  test('renders a complete themed document with the session id and a back link', () => {
    const html = renderSessionPage({ session: fixtureSession() }, { urlKey: 'ws-a', workspaces: [] });
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'is a full HTML document');
    assert.match(html, /data-testid="session-page"/);
    assert.match(html, /data-testid="session-back"/);
    assert.ok(html.includes('/workspace/ws-a/observation'), 'back link points at the feed');
    assert.match(html, /data-session-id="sess-abc"/);
    // Session runtime 750000ms → 12m 30s (a machine fact).
    assert.ok(html.includes('12m 30s'), 'session runtime is formatted');
  });
});

describe('render-session: tasks touched', () => {
  test('lists distinct issues, links the one with a url, and flags the seed', () => {
    const html = renderSessionPage({ session: fixtureSession() }, { urlKey: 'ws-a' });
    assert.match(html, /data-testid="session-tasks"/);
    const taskCount = (html.match(/data-testid="session-task"/g) || []).length;
    assert.equal(taskCount, 2, 'both touched issues are listed');
    assert.ok(html.includes('href="https://linear.app/x/LIN-1"'), 'LIN-1 links out');
    assert.ok(html.includes('First task') && html.includes('Second task'), 'titles render');
    assert.ok(html.includes('sp-seed-tag'), 'the seed issue is flagged');
  });
});

describe('render-session: per-run telemetry + transcript', () => {
  test('renders one run block per loop with timing, and the model chip only when present', () => {
    const html = renderSessionPage({ session: fixtureSession() }, { urlKey: 'ws-a' });
    const runCount = (html.match(/data-testid="session-run"/g) || []).length;
    assert.equal(runCount, 2, 'one run block per loop');
    assert.equal((html.match(/data-testid="session-telemetry"/g) || []).length, 2);
    // loop 1 runtime 300000ms → 5m; loop 2 carries a model, loop 1 does not.
    assert.ok(html.includes('5m'), 'per-run runtime formatted');
    assert.ok(html.includes('anthropic/claude-opus'), 'model rendered when present');
    // tool-count chip from the last metric (total: 12).
    assert.ok(html.includes('tools'), 'metric chip rendered');
    assert.ok(html.includes('https://gh/pr/1'), 'produced-artifact link rendered');
  });

  test('renders the transcript entries with timestamps and evidence links', () => {
    const html = renderSessionPage({ session: fixtureSession() }, { urlKey: 'ws-a' });
    assert.match(html, /data-testid="session-transcript"/);
    const entries = (html.match(/data-testid="session-transcript-entry"/g) || []).length;
    assert.equal(entries, 3, 'every feedback entry across both loops is rendered');
    assert.ok(html.includes('opened a PR'), 'a transcript message renders');
    assert.ok(html.includes('>PR #1<'), 'the evidence urlLabel renders as a link');
  });

  test('omits the model chip entirely when telemetry.model is absent (LIN-1003 constraint)', () => {
    const s = fixtureSession();
    // Strip all model fields.
    delete s.telemetry.model;
    for (const l of s.loops) delete l.telemetry.model;
    const html = renderSessionPage({ session: s }, { urlKey: 'ws-a' });
    assert.ok(!html.includes('data-testid="session-model"'), 'no session model chip');
    assert.ok(!/model <code/.test(html), 'no per-run model chip');
    assert.ok(!html.toLowerCase().includes('undefined'), 'never renders the literal "undefined"');
  });
});

describe('render-session: brief/recap panels (cache-only + explicit generate)', () => {
  test('renders cached brief text and structured recap when present', () => {
    const briefRecap = [{
      issueId: 'uuid-1', issueIdentifier: 'LIN-1', issueTitle: 'First task',
      brief: { brief: 'A concise **brief** body.', model: 'anthropic/claude-haiku', generatedAt: '2026-07-04T10:00:00.000Z' },
      recap: { recap: { done: [{ item: 'shipped X', evidence: 'PR#1' }], pending: [{ item: 'do Y', predicted: 'soon' }], deviations: [] }, model: 'm', generatedAt: '2026-07-04T10:01:00.000Z' }
    }];
    const html = renderSessionPage({ session: fixtureSession(), briefRecap }, { urlKey: 'ws-a' });
    assert.match(html, /data-testid="session-brief"/);
    assert.match(html, /data-testid="session-recap"/);
    assert.ok(html.includes('A concise **brief** body.'), 'brief body renders (as safe text)');
    assert.ok(html.includes('shipped X') && html.includes('PR#1'), 'recap Done item renders');
    assert.ok(html.includes('do Y'), 'recap Pending item renders');
    // No generate affordance when both are cached.
    assert.ok(!html.includes('data-testid="session-brief-generate"'), 'no brief generate form on a hit');
  });

  test('renders an explicit generate form on a cache miss — never auto-generated content', () => {
    const briefRecap = [{
      issueId: 'uuid-1', issueIdentifier: 'LIN-1', issueTitle: 'First task', brief: null, recap: null
    }];
    const html = renderSessionPage({ session: fixtureSession(), briefRecap }, { urlKey: 'ws-a' });
    assert.match(html, /data-testid="session-brief-generate"/);
    assert.match(html, /data-testid="session-recap-generate"/);
    // The affordance is an explicit POST form to the on-demand endpoint — a
    // user action, not something the render triggered.
    assert.ok(html.includes('method="post"'), 'generate is a POST form');
    assert.ok(html.includes('action="/workspace/ws-a/api/brief/uuid-1"'), 'brief generate targets the on-demand endpoint');
    assert.ok(html.includes('action="/workspace/ws-a/api/recap/uuid-1"'), 'recap generate targets the on-demand endpoint');
  });

  test('escapes HTML in brief text (no injection through cached content)', () => {
    const briefRecap = [{
      issueId: 'uuid-1', issueIdentifier: 'LIN-1', issueTitle: 'T',
      brief: { brief: '<script>alert(1)</script>', model: null, generatedAt: null }, recap: null
    }];
    const html = renderSessionPage({ session: fixtureSession(), briefRecap }, { urlKey: 'ws-a' });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag is not emitted');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script tag is escaped');
  });
});
