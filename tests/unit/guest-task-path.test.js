/**
 * LIN-3330 — lib/guest-task-path.js, the ONE predicate for the two auth-middleware
 * exemptions (the token-refresh `app.use` in server.js and `lib/pat-session.js`).
 *
 * A behaviour table with negatives, not a source-literal guard (LIN-3243 review L3).
 *
 * Run with: node --test tests/unit/guest-task-path.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGuestTaskPath, isTokenRefreshExempt } from '../../lib/guest-task-path.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN = 'A'.repeat(43);

describe('isGuestTaskPath', () => {
  const yes = ['/t/x', `/t/${TOKEN}`, `/t/${TOKEN}/state`, '/t/', '/t//x'];
  const no = ['/t', '/test/x', '/terms', '/templates', '/s/x', '/task/LIN-1', '/', '', null, undefined, 42];

  for (const path of yes) {
    test(`exempts ${JSON.stringify(path)}`, () => assert.equal(isGuestTaskPath(path), true));
  }
  for (const path of no) {
    test(`does NOT exempt ${JSON.stringify(path)}`, () => assert.equal(isGuestTaskPath(path), false));
  }
});

// LIN-3330 review, ledger 1: the server token-refresh exemption needs a
// behaviour table, because the source-text drift guard below cannot see the
// guest clause being defeated (`isGuestTaskPath(req.path) && false` still
// matched the regex). These cases are the server.js `app.use` skip list.
describe('isTokenRefreshExempt (server.js token-refresh skip list)', () => {
  const yes = [
    '/auth/login', '/auth/callback',
    '/logout', '/privacy', '/terms', '/styleguide', '/kpis', '/templates',
    '/t/x', `/t/${TOKEN}`, `/t/${TOKEN}/state`,
  ];
  const no = ['/t', '/test/x', '/s/x', '/workspace/a/', '/workspace/a/api/task/LIN-1/state', '/', ''];

  for (const path of yes) {
    test(`exempts ${JSON.stringify(path)}`, () => assert.equal(isTokenRefreshExempt(path), true));
  }
  for (const path of no) {
    test(`does NOT exempt ${JSON.stringify(path)}`, () => assert.equal(isTokenRefreshExempt(path), false));
  }
});

describe('the two exemptions use the shared predicate (drift guard)', () => {
  test('server.js and lib/pat-session.js both call the shared predicate', () => {
    const server = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const pat = readFileSync(join(__dirname, '../../lib/pat-session.js'), 'utf8');
    assert.match(server, /isTokenRefreshExempt\(req\.path\)/, 'server.js token-refresh exemption uses the helper');
    assert.match(server, /import \{ isTokenRefreshExempt \} from '\.\/lib\/guest-task-path\.js'/, 'server imports the helper');
    assert.match(pat, /isGuestTaskPath\(req\.path\)/, 'pat-session exemption uses the predicate');
    assert.match(pat, /import \{ isGuestTaskPath \} from '\.\/guest-task-path\.js'/, 'pat-session imports the predicate');
  });
});
