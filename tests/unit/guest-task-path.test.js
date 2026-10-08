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
import { isGuestTaskPath, isTokenRefreshExempt, isPublicLibraryPath } from '../../lib/guest-task-path.js';

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
    '/library', '/library/', '/library/ladder', '/Library/x', '/sitemap.xml', '/robots.txt',
  ];
  const no = ['/t', '/test/x', '/s/x', '/workspace/a/', '/workspace/a/api/task/LIN-1/state', '/', '', '/libraryfoo', '/librarian', '/api/library'];

  for (const path of yes) {
    test(`exempts ${JSON.stringify(path)}`, () => assert.equal(isTokenRefreshExempt(path), true));
  }
  for (const path of no) {
    test(`does NOT exempt ${JSON.stringify(path)}`, () => assert.equal(isTokenRefreshExempt(path), false));
  }
});

// LIN-3344: the Library exemption needs its own behaviour table with
// negatives, so a lookalike clause (`startsWith('/library')`) cannot sweep in
// `/libraryfoo` and `/Librarian` un-noticed.
describe('isPublicLibraryPath (Library auth exemption)', () => {
  const yes = ['/library', '/library/', '/library/ladder', '/library/doc/ladder', '/library/a/b', '/Library/x', '/LIBRARY', '/sitemap.xml', '/robots.txt', '/Sitemap.xml'];
  const no = ['/libraryfoo', '/librarian', '/api/library', '/library.md', '/t/x', '/templates', '/terms', '/', '', null, undefined, 42];

  for (const path of yes) {
    test(`exempts ${JSON.stringify(path)}`, () => assert.equal(isPublicLibraryPath(path), true));
  }
  for (const path of no) {
    test(`does NOT exempt ${JSON.stringify(path)}`, () => assert.equal(isPublicLibraryPath(path), false));
  }
});

describe('the two exemptions use the shared predicate (drift guard)', () => {
  test('server.js and lib/pat-session.js both call the shared predicate', () => {
    const server = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const pat = readFileSync(join(__dirname, '../../lib/pat-session.js'), 'utf8');
    assert.match(server, /isTokenRefreshExempt\(req\.path\)/, 'server.js token-refresh exemption uses the helper');
    assert.match(server, /import \{ isTokenRefreshExempt \} from '\.\/lib\/guest-task-path\.js'/, 'server imports the helper');
    assert.match(pat, /isGuestTaskPath\(req\.path\)/, 'pat-session exemption uses the guest predicate');
    assert.match(pat, /isPublicLibraryPath\(req\.path\)/, 'pat-session exemption uses the library predicate');
    assert.match(pat, /import \{ isGuestTaskPath, isPublicLibraryPath \} from '\.\/guest-task-path\.js'/, 'pat-session imports both predicates');
  });
});
