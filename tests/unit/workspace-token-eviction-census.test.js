/**
 * LIN-1507 witness D(ii): the destroy-path census, plus source assertions
 * for the three session-destruction sites in server.js that cannot be driven
 * behaviourally (ensureValidToken, handleWorkspaceRemoval,
 * handleUnauthorizedError are module-private — server.js exports none of
 * them). The other two destroy sites (routes/auth.js's /logout and
 * routes/workspace.js's /workspace/:urlKey/remove) ARE driven behaviourally,
 * with a fake evictor and exact-key-string assertions, in
 * tests/unit/auth-logout-route.test.js and
 * tests/unit/workspace-remove-route.test.js.
 *
 * Run with: node --test tests/unit/workspace-token-eviction-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

function countDestroys(source) {
  return (source.match(/\bsession\.destroy\(/g) || []).length;
}

// The parent LIN-1500's witness-D prose implies SIX destroy paths (it says the
// census should catch "a seventh"). That is wrong: `grep -c "session.destroy("`
// across these three files returns server.js:3, routes/workspace.js:1,
// routes/auth.js:1 — five, verified at LIN-1507's HEAD. The "six" in the plan
// is the count of *eviction sites* (#13–#18 in the ticket), of which
// routes/workspace.js:144 (remove-one-of-many) is NOT a destroy at all — the
// session survives there. Coding to "seventh" would ship a census off by one
// that silently never fires on a genuinely new sixth destroy path. Pinned at
// 5 deliberately; a sixth path must fail this test.
const KNOWN_DESTROY_COUNT = 5;

describe('LIN-1507 witness D(ii) — session.destroy( census', () => {
  test('the total count of session.destroy( across server.js + routes/auth.js + routes/workspace.js is exactly 5', () => {
    const counts = {
      'server.js': countDestroys(read('server.js')),
      'routes/auth.js': countDestroys(read('routes/auth.js')),
      'routes/workspace.js': countDestroys(read('routes/workspace.js')),
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    assert.equal(
      total,
      KNOWN_DESTROY_COUNT,
      `Found ${total} session.destroy( call site(s) (${JSON.stringify(counts)}), expected exactly ${KNOWN_DESTROY_COUNT}. ` +
      'A NEW session-destruction path needs a matching cache eviction, per LIN-1507: cached workspace tokens ' +
      'must not outlive the session row that granted them. Before touching KNOWN_DESTROY_COUNT in this test, add ' +
      '(or remove) a matching evictWorkspaceTokenPair(evictWorkspaceToken, urlKey, accountId) call immediately ' +
      "before the new/removed destroy() — capturing urlKey/accountId into locals BEFORE calling destroy(), since " +
      "destroy()'s callback runs after the session data is gone. See lib/workspace-token-cache.js's " +
      'evictWorkspaceTokenPair and the existing sites: server.js (ensureValidToken, handleWorkspaceRemoval, ' +
      'handleUnauthorizedError), routes/auth.js (/logout), routes/workspace.js (/workspace/:urlKey/remove).'
    );
  });
});

describe('LIN-1507 witness D(ii) — source assertions for the 3 non-injectable server.js sites', () => {
  // Honesty about what this proves, per the ticket: witness D(ii) pins the
  // SET of destroy sites, not their correctness. This test proves an
  // evictWorkspaceTokenPair(evictWorkspaceToken or evictAllWorkspaceTokens(
  // evictWorkspaceToken call appears in the source text shortly before each
  // session.destroy( in server.js — it does NOT prove the call is reached at
  // runtime, receives the right urlKey/accountId, or runs in the correct
  // order relative to other statements. Three calls in subtly wrong places
  // (e.g. evicting the wrong workspace, or a dead branch) would still pass
  // this test. Its real value is catching a FUTURE destroy call added with
  // no matching eviction nearby — not certifying today's three are wired
  // correctly. That confidence instead comes from the manual source excerpts
  // reviewed in the LIN-1507 beat reports and the behavioural witness D(i)
  // tests covering the two sites (routes/auth.js, routes/workspace.js) that
  // CAN be driven directly, plus the direct unit tests on
  // evictAllWorkspaceTokens itself (tests/unit/workspace-token-cache.test.js)
  // for the PAT site's multi-workspace loop.
  test('every session.destroy( in server.js is preceded by an eviction call (evictWorkspaceTokenPair or evictAllWorkspaceTokens)', () => {
    const source = read('server.js');
    const destroyRegex = /\bsession\.destroy\(/g;
    let match;
    let count = 0;
    while ((match = destroyRegex.exec(source)) !== null) {
      count++;
      const windowStart = Math.max(0, match.index - 500);
      const preceding = source.slice(windowStart, match.index);
      assert.ok(
        /(evictWorkspaceTokenPair|evictAllWorkspaceTokens)\(evictWorkspaceToken/.test(preceding),
        `session.destroy( at character offset ${match.index} in server.js has no ` +
        'evictWorkspaceTokenPair(evictWorkspaceToken or evictAllWorkspaceTokens(evictWorkspaceToken call in the preceding 500 characters. Every session-' +
        'destruction path in server.js must evict its workspace(s)\' cache entries BEFORE destroy() runs (LIN-1507).'
      );
    }
    assert.equal(count, 3, 'expected exactly 3 session.destroy( sites in server.js — update this test if that count changes');
  });
});
