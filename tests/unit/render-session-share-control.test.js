/**
 * LIN-3315 (Phase 4 of LIN-2950) — the run-page share control.
 *
 * Run with: `node --test tests/unit/render-session-share-control.test.js`.
 *
 * The control is owner-side only: create/copy/revoke a run share and a
 * "view as guest" link to the owner-gated preview route. It is mounted on the
 * authed run page and NEVER in guest mode (the guest render is a separate
 * branch, so the control is absent for a share holder by construction). This
 * file pins both halves and the two escaping rules on the preview href.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../../lib/render-session.js';
import { liveSession, CAPTURED_AT } from '../fixtures/guest-run-fixtures.js';

const OPTIONS = { now: '2026-07-04T10:10:00.000Z', deployInfo: { version: 'g', commit: 'g' }, featureFlags: {} };

function ownerHtml({ urlKey = 'ws-a', sessionId = 'sess-abc', session = null } = {}) {
  return renderSessionPage({
    session: session || {
      sessionId,
      seedIssue: 'LIN-900',
      tasksTouched: ['LIN-900'],
      dispatchedAt: '2026-07-04T10:00:00.000Z',
      completedAt: '2026-07-04T10:05:00.000Z',
      loops: []
    },
    urlKey,
    sessionTerminal: true
  }, OPTIONS);
}

function guestHtml() {
  return renderSessionPage({ session: liveSession(), capturedAt: CAPTURED_AT, sessionTerminal: true }, { guest: true });
}

const CONTROL_TESTIDS = [
  'session-share-section', 'session-share-control', 'session-share-create',
  'session-share-preview', 'session-share-created', 'session-share-url',
  'session-share-copy', 'session-share-message', 'session-share-list'
];

describe('run-page share control (LIN-3315)', () => {
  test('the owner page carries the control: create, copy, list and a view-as-guest link', () => {
    const html = ownerHtml();
    for (const id of CONTROL_TESTIDS) {
      assert.ok(html.includes(`data-testid="${id}"`), `owner page has ${id}`);
    }
    // The create button and the copy button are real controls, not links to the app.
    assert.match(html, /<button type="button" class="action-btn save sess-share-create" data-testid="session-share-create">create share link<\/button>/);
    assert.match(html, /data-testid="session-share-copy">copy<\/button>/);
    // The control carries the run identity the client needs.
    assert.match(html, /data-testid="session-share-control" data-url-key="ws-a" data-session-id="sess-abc"/);
    // The preview links to the owner-gated preview route.
    assert.ok(html.includes('data-testid="session-share-preview" href="/workspace/ws-a/observation/session/sess-abc/guest-preview"'));
  });

  test('the guest page carries NO share-control surface (owner-only)', () => {
    const html = guestHtml();
    for (const id of CONTROL_TESTIDS) {
      assert.ok(!html.includes(`data-testid="${id}"`), `guest page must not have ${id}`);
    }
    assert.ok(!html.includes('sess-share'), 'no share-control class leaks into guest');
    assert.ok(!html.includes('guest-preview'), 'no preview link in guest');
  });

  test('the preview href URL-encodes the urlKey and sessionId', () => {
    const html = ownerHtml({ urlKey: 'ws "a"&<b>', sessionId: 'sess/<x>&"y"' });
    assert.ok(
      html.includes('href="/workspace/ws%20%22a%22%26%3Cb%3E/observation/session/sess%2F%3Cx%3E%26%22y%22/guest-preview"'),
      'the preview path is fully percent-encoded'
    );
    // The data attributes stay plain text (escaped), not encoded, for the client.
    assert.ok(html.includes('data-url-key="ws &quot;a&quot;&amp;&lt;b&gt;"'), 'data-url-key is attribute-escaped');
  });

  test('the control needs a run: the not-found body has none', () => {
    const html = renderSessionPage({ session: null, sessionId: 'nope', urlKey: 'ws-a' }, OPTIONS);
    assert.ok(!html.includes('session-share-section'), 'no share control on the not-found body');
  });
});
