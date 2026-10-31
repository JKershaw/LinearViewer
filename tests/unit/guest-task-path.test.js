/**
 * LIN-3330 / LIN-3346 — lib/guest-task-path.js, the ONE predicate for the two
 * auth-middleware exemptions (the token-refresh `app.use` in server.js and
 * `lib/pat-session.js`), `isAuthExemptPath`.
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
import { isGuestTaskPath, isPublicLibraryPath, isAuthExemptPath } from '../../lib/guest-task-path.js';

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

// LIN-3346: the ONE shared exemption for PAT auto-login and token refresh.
// Every public page that must skip session mint/refresh is a yes row, in any
// case and with one trailing slash (Express routes both). Each no row is a
// path that must keep minting or refreshing exactly as it does today.
describe('isAuthExemptPath (shared PAT + refresh exemption, LIN-3346)', () => {
  const yes = [
    // Prefix exemptions, with their slash.
    '/auth/', '/auth/login', '/auth/callback', '/AUTH/callback',
    '/runner-kit/broker.mjs', '/Runner-Kit/broker.mjs',
    '/t/', '/t/x', `/t/${TOKEN}`, `/t/${TOKEN}/state`, '/T/x', '/T/x/STATE',
    // Exact public pages, in any case and with one trailing slash.
    '/logout', '/privacy', '/terms', '/styleguide', '/kpis', '/templates',
    '/KPIS', '/kpis/', '/Privacy/', '/TEMPLATES', '/templates/',
    // Archive: digits only, with one optional trailing slash.
    '/archive/1', '/archive/01', '/archive/1/', '/Archive/1/',
    // Library, sitemap and robots (isPublicLibraryPath, via the stripped path).
    '/library', '/library/', '/library/ladder', '/Library/x', '/LIBRARY',
    '/sitemap.xml', '/sitemap.xml/', '/Sitemap.xml', '/robots.txt', '/robots.txt/',
  ];
  const no = [
    // Landing and session-aware routes: they redirect a signed-in visitor, so
    // they must keep refreshing and keep PAT auto-login (local-dev entry).
    '/', '/swipe', '/swipe/x', '/swim', '/ship',
    // Lookalikes and near-misses of the exempt prefixes.
    '/t', '/test/x', '/auth', '/kpisx', '/archive', '/archive/x', '/archive/1x',
    '/libraryfoo', '/librarian', '/api/library', '/library.md', '/s/x',
    // App paths keep refreshing.
    '/workspace/a/', '/workspace/a/api/task/LIN-1/state',
    // Bearer APIs are a different class and stay out.
    '/api/proxy/x', '/api/dispatch/poll',
    // Express does not decode or collapse these, so they must not match.
    '//t/x', '/%74/x', '/t%2Fx',
    // Non-strings and empties are never exempt.
    '', null, undefined, 42,
  ];

  for (const path of yes) {
    test(`exempts ${JSON.stringify(path)}`, () => assert.equal(isAuthExemptPath(path), true));
  }
  for (const path of no) {
    test(`does NOT exempt ${JSON.stringify(path)}`, () => assert.equal(isAuthExemptPath(path), false));
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
  test('server.js and lib/pat-session.js each import and call isAuthExemptPath(req.path)', () => {
    const server = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const pat = readFileSync(join(__dirname, '../../lib/pat-session.js'), 'utf8');
    assert.match(server, /import \{ isAuthExemptPath \} from '\.\/lib\/guest-task-path\.js'/, 'server.js imports the shared predicate');
    assert.match(server, /isAuthExemptPath\(req\.path\)/, 'server.js token-refresh exemption calls the shared predicate');
    assert.match(pat, /import \{ isAuthExemptPath \} from '\.\/guest-task-path\.js'/, 'pat-session imports the shared predicate');
    assert.match(pat, /isAuthExemptPath\(req\.path\)/, 'pat-session PAT exemption calls the shared predicate');
  });

  test('the old refresh-only predicate is gone from both consumers', () => {
    const server = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const pat = readFileSync(join(__dirname, '../../lib/pat-session.js'), 'utf8');
    assert.doesNotMatch(server, /isTokenRefreshExempt/, 'server.js does not reference isTokenRefreshExempt');
    assert.doesNotMatch(pat, /isTokenRefreshExempt/, 'pat-session.js does not reference isTokenRefreshExempt');
  });

  test('pat-session keeps no private public-path list: no req.path equality, one startsWith (the /test/ clause)', () => {
    const pat = readFileSync(join(__dirname, '../../lib/pat-session.js'), 'utf8');
    assert.doesNotMatch(pat, /req\.path\s*===/, 'no equality literal on req.path');
    const starts = pat.match(/req\.path\.startsWith\(/g) ?? [];
    assert.equal(starts.length, 1, 'exactly one req.path.startsWith (the PAT-only /test/ clause)');
    assert.match(pat, /req\.path\.startsWith\('\/test\/'\)/, 'that one startsWith is /test/');
  });
});
