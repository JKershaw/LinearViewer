/**
 * Root-route exemption behaviour for /s/ (LIN-3243, Session A of LIN-3073;
 * corrective review L3).
 *
 * Run with: node --test tests/unit/share-exemption.test.js
 *
 * The first round used a source-literal guard, which could not tell
 * `startsWith('/s/')` from the over-broad `startsWith('/s')` (M34). The
 * predicate now lives in `lib/root-route-exemption.js` and is tested
 * BEHAVIOURALLY: `/s/` is exempt, and sibling roots that merely start with `s`
 * (`/swipe`, `/settings`, `/ship`, `/swim`) still reach `ensureValidToken`.
 * A light static check keeps `server.js` delegating to that predicate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTokenRefreshExempt } from '../../lib/root-route-exemption.js';

const serverSrc = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const patSrc = readFileSync(new URL('../../lib/pat-session.js', import.meta.url), 'utf8');

test('isTokenRefreshExempt exempts the /s/ share prefix', () => {
  for (const path of ['/s/', '/s/x', `/s/${'a'.repeat(43)}`]) {
    assert.equal(isTokenRefreshExempt(path), true, `${path} must skip token refresh`);
  }
});

test('isTokenRefreshExempt does NOT sweep in sibling s-roots', () => {
  // /styleguideX is deliberately included: it starts with '/s' but is neither
  // the share prefix nor the exact /styleguide root.
  for (const path of ['/s', '/swipe', '/swipe/LIN-1', '/settings', '/ship', '/swim', '/styleguideX']) {
    assert.equal(isTokenRefreshExempt(path), false, `${path} must still reach ensureValidToken`);
  }
});

test('isTokenRefreshExempt keeps the pre-existing auth-free roots exempt', () => {
  for (const path of ['/auth/linear', '/logout', '/privacy', '/terms', '/styleguide', '/kpis', '/templates']) {
    assert.equal(isTokenRefreshExempt(path), true, `${path} stays exempt`);
  }
});

test('server.js delegates the root-route exemption to isTokenRefreshExempt', () => {
  assert.match(serverSrc, /isTokenRefreshExempt\(req\.path\)/, 'the middleware calls the extracted predicate');
  assert.ok(!/req\.path\.startsWith\('\/s/.test(serverSrc), 'no inline /s prefix remains in server.js to diverge');
});

test('lib/pat-session.js exempts the /s/ prefix in its skip list', () => {
  assert.ok(
    /req\.path === '\/styleguide'[\s\S]{0,160}?req\.path\.startsWith\('\/s\/'\)/.test(patSrc),
    'pat-session skips /s/ alongside the other auth-free routes'
  );
});
