/**
 * LIN-3775: the source-aware 503 page. Pure mapping (describeSourceFailure) and the
 * renderer (renderSourceErrorPage); the six server.js exits are covered in the
 * slice-and-vm harnesses (lin-1503-*-behaviour, lin-1887-*, lin-3124-pr3-*, lin-3774-*).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describeSourceFailure, errorReference } from '../../lib/errors.js';
import { renderSourceErrorPage, renderServiceUnavailablePage, renderErrorPage } from '../../lib/render-pages.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';
import { relinkNotice } from '../../lib/refresh-strategy.js';

const ghWs = { provider: 'github', urlKey: 'acme', name: 'Acme', activeBinding: { provider: 'github', scope: 'JKershaw/LinearViewer' } };
const linWs = { provider: 'linear', urlKey: 'acme', name: 'Acme Linear', activeBinding: { provider: 'linear', scope: 'org-1' } };
const tagged = (status, provider, scope, message = 'boom') =>
  Object.assign(new Error(message), { status, binding: { provider, scope, connectionId: 'c1' } });
const html = (err, ws, extra = {}) => renderSourceErrorPage(err, ws, { ref: 'abc12345', relink: relinkNotice, time: 'T', ...extra });

describe('describeSourceFailure', () => {
  const kinds = [
    ['tagged 401', tagged(401, 'github', 'o/r'), ghWs, 'auth'],
    ['tagged 403 (not rate limit)', tagged(403, 'github', 'o/r', 'Resource not accessible'), ghWs, 'auth'],
    ['tagged 403 rate limit', tagged(403, 'github', 'o/r', 'API rate limit exceeded'), ghWs, 'rate-limited'],
    ['tagged 429', tagged(429, 'github', 'o/r'), ghWs, 'rate-limited'],
    ['tagged 502', tagged(502, 'github', 'o/r'), ghWs, '5xx'],
    ['graphql ClientError shape', Object.assign(new Error('x'), { response: { status: 503 } }), linWs, '5xx'],
    ['untagged 401 is NOT auth', Object.assign(new Error('x'), { status: 401 }), ghWs, 'renew-failed'],
    ['TokenRefreshError NETWORK', new TokenRefreshError('x', 'NETWORK'), linWs, 'renew-unreachable'],
    ['TokenRefreshError INVALID', new TokenRefreshError('x', 'INVALID'), linWs, 'renew-failed'],
    ['TokenRefreshError UNKNOWN', new TokenRefreshError('x', 'UNKNOWN'), linWs, 'renew-failed'],
    ['network, no status', Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }), ghWs, 'unreachable'],
    ['plain Error', new Error('nope'), ghWs, 'internal'],
    ['Jira-shaped, no status', Object.assign(new Error('x'), { binding: { provider: 'jira', scope: 'https://a.atlassian.net' } }), linWs, 'internal'],
  ];
  for (const [name, err, ws, kind] of kinds) {
    test(`${name} → ${kind}`, () => assert.equal(describeSourceFailure(err, ws).kind, kind));
  }

  test('status is carried when present and null otherwise', () => {
    assert.equal(describeSourceFailure(tagged(401, 'github', 'o/r'), ghWs).status, 401);
    assert.equal(describeSourceFailure(new Error('x'), ghWs).status, null);
  });

  test('where: GitHub scope from the tag, else the active binding', () => {
    assert.equal(describeSourceFailure(tagged(401, 'github', 'o/other'), linWs).where, 'o/other');
    assert.equal(describeSourceFailure(new Error('x'), ghWs).where, 'JKershaw/LinearViewer');
  });

  test('where: active Linear is the workspace name; a secondary Linear on a GitHub-primary workspace is never named', () => {
    assert.equal(describeSourceFailure(new Error('x'), linWs).where, 'Acme Linear');
    const sec = describeSourceFailure(tagged(401, 'linear', 'org-9'), ghWs);
    assert.equal(sec.where, '');
    assert.equal(sec.isActiveSource, false);
  });

  test('activeness: tagged secondary is not active; matching tag is; ambiguity resolves to not active', () => {
    assert.equal(describeSourceFailure(tagged(401, 'github', 'o/other'), linWs).isActiveSource, false);
    assert.equal(describeSourceFailure(tagged(401, 'github', 'JKershaw/LinearViewer'), ghWs).isActiveSource, true);
    assert.equal(describeSourceFailure(tagged(401, 'github', 'o/other'), ghWs).isActiveSource, false);
    assert.equal(describeSourceFailure(new Error('x'), ghWs).isActiveSource, true);
  });

  test('activeness on a legacy workspace with no marker and two same-provider bindings (C2)', () => {
    const legacy = {
      provider: 'linear', urlKey: 'acme', name: 'Acme Linear', accessToken: 'A',
      bindings: [
        { provider: 'linear', scope: 'org-1', credentials: { token: 'A' } },
        { provider: 'linear', scope: 'org-OTHER', credentials: { token: 'B' } },
      ],
    };
    const other = describeSourceFailure(tagged(401, 'linear', 'org-OTHER'), legacy);
    assert.equal(other.isActiveSource, false);
    assert.equal(other.where, '');
    const primary = describeSourceFailure(tagged(401, 'linear', 'org-1'), legacy);
    assert.equal(primary.isActiveSource, true);
    assert.equal(primary.where, 'Acme Linear');
    // no binding found for the tag ⇒ not active
    assert.equal(describeSourceFailure(tagged(401, 'linear', 'org-GONE'), legacy).isActiveSource, false);
  });

  test('errorReference is 8 lowercase hex and varies', () => {
    assert.match(errorReference(), /^[0-9a-f]{8}$/);
    assert.notEqual(errorReference(), errorReference());
  });
});

describe('renderSourceErrorPage', () => {
  test('no error ⇒ exactly the generic 503 page', () => {
    assert.equal(renderSourceErrorPage(null, ghWs), renderServiceUnavailablePage());
  });

  test('names the source, status and reference, and says what failed', () => {
    const out = html(tagged(401, 'github', 'JKershaw/LinearViewer'), ghWs);
    assert.match(out, /data-testid="error-detail-source"[^]*GitHub Issues \(JKershaw\/LinearViewer\)/);
    assert.match(out, /data-testid="error-detail-reference"[^]*abc12345/);
    assert.match(out, /HTTP 401/);
    assert.match(out, /rejected Harbour(&#039;|&#39;|')s credential/);
    assert.doesNotMatch(out, /try again later/i);
  });

  test('auth on the active source offers relinkNotice\'s target; on a secondary it offers settings', () => {
    const active = html(tagged(401, 'github', 'JKershaw/LinearViewer'), ghWs);
    assert.ok(active.includes(`href="${relinkNotice(ghWs).actionUrl}"`) || active.includes(relinkNotice(ghWs).actionUrl.replace(/&/g, '&amp;')));
    const secondary = html(tagged(401, 'github', 'o/other'), linWs);
    assert.match(secondary, /href="\/workspace\/acme\/settings"/);
    assert.match(secondary, /Go to settings/);
  });

  test('auth on the ACTIVE Jira source offers relinkNotice\'s /auth/jira target, not settings (M3 witness)', () => {
    const jiraWs = { provider: 'jira', urlKey: 'acme', name: 'Acme Jira', activeBinding: { provider: 'jira', scope: 'https://a.atlassian.net' } };
    const expected = relinkNotice(jiraWs).actionUrl;
    assert.match(expected, /^\/auth\/jira/);
    const out = html(tagged(401, 'jira', 'https://a.atlassian.net'), jiraWs);
    assert.ok(out.includes(`href="${expected.replace(/&/g, '&amp;')}"`), 'button links to relinkNotice target');
    assert.doesNotMatch(out, /href="\/workspace\/acme\/settings"/);
    assert.doesNotMatch(out, /Go to settings/);
  });

  const neverReconnect = [
    ['5xx', tagged(502, 'github', 'o/r')],
    ['429', tagged(429, 'github', 'o/r')],
    ['rate-limit 403', tagged(403, 'github', 'o/r', 'secondary rate limit')],
    ['untagged 401', Object.assign(new Error('x'), { status: 401 })],
    ['refresh NETWORK', new TokenRefreshError('x', 'NETWORK')],
    ['refresh INVALID', new TokenRefreshError('x', 'INVALID')],
    ['plain', new Error('x')],
  ];
  for (const [name, err] of neverReconnect) {
    test(`${name} never offers reconnect or settings`, () => {
      const out = html(err, ghWs);
      assert.doesNotMatch(out, /[Rr]econnect/);
      assert.doesNotMatch(out, /Go to settings/);
      assert.doesNotMatch(out, /\/settings/);
    });
  }

  test('no secret, stack or raw upstream message reaches the page, for every kind', () => {
    const secret = 'ghs_' + randomBytes(12).toString('hex');
    const conn = 'mongodb://u:' + randomBytes(6).toString('hex') + '@db/x';
    const mk = (e) => Object.assign(e, { stack: `Error at ${secret}`, token: secret, detail: conn });
    const errs = [
      mk(tagged(401, 'github', 'o/r', `bad ${secret}`)), mk(tagged(502, 'github', 'o/r', conn)),
      mk(tagged(429, 'github', 'o/r', secret)), mk(new TokenRefreshError(secret, 'NETWORK')),
      mk(new TokenRefreshError(conn, 'INVALID')), mk(new Error(secret)),
      mk(Object.assign(new Error(secret), { code: 'ECONNRESET' })),
    ];
    for (const err of errs) {
      const out = html(err, ghWs);
      assert.ok(!out.includes(secret), 'secret leaked');
      assert.ok(!out.includes(conn), 'connection string leaked');
      assert.ok(!out.includes('Error at'), 'stack leaked');
    }
  });

  test('Code row is left out when no response came back', () => {
    assert.doesNotMatch(html(new Error('x'), ghWs), /<span class="error-detail-key">Code/);
  });
});

describe('renderErrorPage diagnostic block stays byte-identical without the new keys', () => {
  test('four-row block has no testids and no Source/Reference rows', () => {
    const out = renderErrorPage('T', 'M', { diagnostic: { detail: 'd', category: 'upstream', retryable: true, code: 'C', time: 'T0' } });
    assert.doesNotMatch(out, /data-testid="error-detail/);
    assert.doesNotMatch(out, />Source<|>Reference</);
    assert.match(out, /Reason<\/span> <span class="error-detail-value">d/);
  });

  // Captured from renderErrorPage at base c93f8792 (LIN-3775 close-out). The
  // container is compared, not the whole document, so unrelated shell changes
  // (head, footer) don't trip it; every byte of the diagnostic block is inside.
  const BASE_CONTAINER = '<div class="error-container">\n    <h2 class="error-title">T</h2>\n    <p class="error-message">M</p>\n    <div class="error-details" role="note">\n      <div class="error-detail-row"><span class="error-detail-key">Reason</span> <span class="error-detail-value">d</span></div>\n      <div class="error-detail-row"><span class="error-detail-key">Type</span> <span class="error-detail-value">upstream · retryable</span></div>\n      <div class="error-detail-row"><span class="error-detail-key">Code</span> <span class="error-detail-value">C</span></div>\n      <div class="error-detail-row"><span class="error-detail-key">Time</span> <span class="error-detail-value">T0</span></div>\n    </div>\n    <a href="/" class="login-button">Go back</a>\n    \n  </div>';

  test('four-key output is byte-identical to the base render (exact assertion)', () => {
    const out = renderErrorPage('T', 'M', { diagnostic: { detail: 'd', category: 'upstream', retryable: true, code: 'C', time: 'T0' } });
    const start = out.indexOf('<div class="error-container">');
    const end = out.indexOf('\n</body>');
    assert.ok(start >= 0 && end > start);
    assert.equal(out.slice(start, end), BASE_CONTAINER);
  });
});
