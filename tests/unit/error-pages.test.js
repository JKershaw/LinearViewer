/**
 * Self-diagnosing error-page tests.
 *
 * When a Linear-backed route throws, the connection to Linear dropping
 * mid-request ("Premature close" from undici's native fetch) is a NON-401 error,
 * so it bypasses the re-auth path and lands on the generic error page. These
 * tests pin two things:
 *
 *   - `classifyUpstreamError` (lib/errors.js) maps the failure into the LIN-417
 *     vocabulary (category/retryable/code/detail), telling a transient upstream
 *     blip apart from a real auth failure or an internal bug.
 *   - `renderUpstreamAwareErrorPage` (lib/render-pages.js) turns an upstream blip
 *     into a clear "couldn't reach Linear, try again" page with a safe diagnostic
 *     block, while non-upstream errors keep the caller's default message — and
 *     the diagnostic never leaks secrets and is HTML-escaped.
 *
 * Run with: node --test tests/unit/error-pages.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { classifyUpstreamError, isAuthError } from '../../lib/errors.js';
import { renderErrorPage, renderUpstreamAwareErrorPage } from '../../lib/render-pages.js';

describe('classifyUpstreamError', () => {
  test('undici "Premature close" FetchError → retryable upstream', () => {
    const err = new Error('Invalid response body while trying to fetch https://api.linear.app/graphql: Premature close');
    err.name = 'FetchError';
    const c = classifyUpstreamError(err);
    assert.strictEqual(c.category, 'upstream');
    assert.strictEqual(c.retryable, true);
    assert.strictEqual(c.code, 'LINEAR_UNREACHABLE');
  });

  test('ECONNRESET on error.cause.code → retryable upstream', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNRESET' };
    assert.strictEqual(classifyUpstreamError(err).category, 'upstream');
  });

  test('undici body-timeout code → retryable upstream', () => {
    const err = new Error('terminated');
    err.code = 'UND_ERR_BODY_TIMEOUT';
    assert.strictEqual(classifyUpstreamError(err).retryable, true);
  });

  test('401 → non-retryable auth', () => {
    const err = new Error('Authentication required');
    err.response = { status: 401 };
    const c = classifyUpstreamError(err);
    assert.strictEqual(c.category, 'auth');
    assert.strictEqual(c.retryable, false);
  });

  test('429 and 5xx → retryable upstream', () => {
    const rate = new Error('rate'); rate.response = { status: 429 };
    assert.strictEqual(classifyUpstreamError(rate).category, 'upstream');
    const boom = new Error('boom'); boom.status = 503;
    assert.strictEqual(classifyUpstreamError(boom).category, 'upstream');
  });

  test('403 → non-retryable auth (not just 401)', () => {
    const err = new Error('Forbidden');
    err.response = { status: 403 };
    const c = classifyUpstreamError(err);
    assert.strictEqual(c.category, 'auth');
    assert.strictEqual(c.code, 'LINEAR_AUTH');
  });

  test('unknown error → non-retryable internal', () => {
    const c = classifyUpstreamError(new TypeError('x is not a function'));
    assert.strictEqual(c.category, 'internal');
    assert.strictEqual(c.retryable, false);
    assert.strictEqual(c.code, 'INTERNAL_ERROR');
  });
});

describe('renderUpstreamAwareErrorPage', () => {
  const prematureClose = () => {
    const e = new Error('Invalid response body while trying to fetch https://api.linear.app/graphql: Premature close');
    e.name = 'FetchError';
    return e;
  };

  test('upstream blip → "Trouble Reaching Linear" + retry-friendly message', () => {
    const html = renderUpstreamAwareErrorPage(prematureClose(), {
      defaultMessage: 'Could not load your projects.',
      actionUrl: '/workspace/acme/',
      time: '2026-06-18T00:00:00.000Z'
    });
    assert.ok(html.includes('Trouble Reaching Linear'));
    assert.ok(/usually temporary/i.test(html));
    // Does NOT fall back to the generic internal message for an upstream error.
    assert.ok(!html.includes('Could not load your projects.'));
  });

  test('upstream page carries a safe diagnostic block (reason/type/code/time)', () => {
    const html = renderUpstreamAwareErrorPage(prematureClose(), {
      actionUrl: '/workspace/acme/',
      time: '2026-06-18T12:34:56.000Z'
    });
    assert.ok(html.includes('error-details'));
    assert.ok(html.includes('LINEAR_UNREACHABLE'));
    assert.ok(html.includes('upstream · retryable'));
    assert.ok(html.includes('2026-06-18T12:34:56.000Z'));
  });

  test('internal error keeps the caller default message + generic title', () => {
    const html = renderUpstreamAwareErrorPage(new TypeError('nope'), {
      defaultMessage: 'Could not load your roadmap. Please try again.',
      actionUrl: '/workspace/acme/roadmap',
      time: 't'
    });
    assert.ok(html.includes('Something Went Wrong'));
    assert.ok(html.includes('Could not load your roadmap. Please try again.'));
    assert.ok(html.includes('INTERNAL_ERROR'));
  });

  test('auth failure → escapable page that logs out instead of looping the same URL', () => {
    const err = new Error('Authentication required');
    err.response = { status: 401 };
    // The caller passes the failing workspace URL — a "Try again" there would
    // just re-hit the rejected token. The page must override it with a logout.
    const html = renderUpstreamAwareErrorPage(err, {
      defaultMessage: 'Could not load your projects. Please try again or re-authenticate.',
      action: 'Try again',
      actionUrl: '/workspace/acme/',
      time: '2026-06-26T00:00:00.000Z'
    });
    assert.ok(html.includes('Re-authentication Needed'));
    assert.ok(html.includes('href="/logout"'));
    assert.ok(/log out and sign in again/i.test(html));
    // The dead-end retry into the same workspace must NOT be the primary action.
    assert.ok(!html.includes('href="/workspace/acme/"'));
    // Still carries the safe diagnostic so it can be quoted in a bug report.
    assert.ok(html.includes('LINEAR_AUTH'));
  });

  test('403 auth failure also gets the logout escape', () => {
    const err = new Error('Forbidden');
    err.response = { status: 403 };
    const html = renderUpstreamAwareErrorPage(err, { actionUrl: '/workspace/acme/', time: 't' });
    assert.ok(html.includes('href="/logout"'));
    assert.ok(html.includes('LINEAR_AUTH'));
  });

  test('diagnostic is HTML-escaped — no raw markup leaks through', () => {
    const err = new Error('boom');
    err.response = { status: 503 };
    // Sanity: even if a detail string ever contained markup, it must be escaped.
    const html = renderUpstreamAwareErrorPage(err, { time: '<script>x</script>' });
    assert.ok(!html.includes('<script>x</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

describe('isAuthError', () => {
  test('401 on error.response.status → true', () => {
    const err = new Error('nope'); err.response = { status: 401 };
    assert.strictEqual(isAuthError(err), true);
  });

  test('403 on error.response.status → true (the dead-end the route guard missed)', () => {
    const err = new Error('forbidden'); err.response = { status: 403 };
    assert.strictEqual(isAuthError(err), true);
  });

  test('401 on a bare error.status → true (the other shape the narrow guard missed)', () => {
    const err = new Error('nope'); err.status = 401;
    assert.strictEqual(isAuthError(err), true);
  });

  test('upstream / network failures → false (must not destroy the session)', () => {
    const net = new Error('fetch failed'); net.cause = { code: 'ECONNRESET' };
    assert.strictEqual(isAuthError(net), false);
    const five = new Error('boom'); five.response = { status: 503 };
    assert.strictEqual(isAuthError(five), false);
  });
});

describe('renderErrorPage backward compatibility', () => {
  test('no diagnostic option → no details block (existing callers unaffected)', () => {
    const html = renderErrorPage('X', 'Y', { action: 'Go', actionUrl: '/z' });
    assert.ok(!html.includes('error-details'));
    assert.ok(html.includes('Y'));
  });
});
