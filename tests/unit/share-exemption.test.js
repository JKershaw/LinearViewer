/**
 * Server root-route exemption guard for /s/ (LIN-3243, Session A of LIN-3073).
 *
 * Run with: node --test tests/unit/share-exemption.test.js
 *
 * `server.js`'s global token-refresh middleware and `lib/pat-session.js`'s
 * skip list must each exempt `/s/` — and the exemption must be the trailing-
 * slash prefix so sibling roots (`/swipe`, `/settings`, `/styleguide`) are NOT
 * swept in. These are read straight from source: the middleware is inline in
 * server.js and the unit suite never boots it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSrc = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const patSrc = readFileSync(new URL('../../lib/pat-session.js', import.meta.url), 'utf8');

test('server.js exempts the /s/ prefix in the token-refresh middleware', () => {
  const match = serverSrc.match(/\n\s*if \(req\.path\.startsWith\('\/auth\/'\)[^\n]*/);
  assert.ok(match, 'the token-refresh middleware condition is present');
  assert.ok(match[0].includes("req.path.startsWith('/s/')"), '/s/ is exempt');
});

test('the /s/ exemption is not so broad that /swipe or /settings are swept in', () => {
  const match = serverSrc.match(/\n\s*if \(req\.path\.startsWith\('\/auth\/'\)[^\n]*/);
  assert.ok(match, 'the token-refresh middleware condition is present');
  assert.ok(!match[0].includes("'/swipe'"), '/swipe must not be exempt');
  assert.ok(!match[0].includes("'/settings'"), '/settings must not be exempt');
});

test('lib/pat-session.js exempts the /s/ prefix in its skip list', () => {
  assert.ok(
    /req\.path === '\/styleguide'[\s\S]{0,160}?req\.path\.startsWith\('\/s\/'\)/.test(patSrc),
    'pat-session skips /s/ alongside the other auth-free routes'
  );
});
