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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

// LIN-3219 A3 (M19): the numeric totals are gone, and the pairing is now PER
// OCCURRENCE rather than per module. The old rule ("every module that destroys
// also evicts somewhere") accepted a new unguarded teardown in a module that
// already carried an eviction elsewhere. The production corpus (server.js plus
// every route except the routes/test.js harness) is scanned so that EVERY
// `session.destroy(` occurrence must be PRECEDED by a token-cache eviction
// (the server.js per-site shape, generalised) and every `removeWorkspace(`
// occurrence must be paired with one (the two server.js removal sites evict
// after the removal — the hoisted LIN-1518 eviction; that site is the carve-out).
const DESTROY_RE = /\bsession\.destroy\(/g;
const REMOVE_RE = /\bremoveWorkspace\((?!\))/g;
const EVICT_RE = /(evictWorkspaceTokenPair\(evictWorkspaceToken|evictAllWorkspaceTokens\(evictWorkspaceToken)/g;

function productionSources() {
  return new Map([
    ['server.js', read('server.js')],
    ...readdirSync(join(repoRoot, 'routes'))
      .filter((n) => n.endsWith('.js') && n !== 'test.js')
      .map((n) => [`routes/${n}`, read(`routes/${n}`)]),
  ]);
}

/** All match offsets of a global regex in `source` (lastIndex is reset). */
function matchPositions(source, re) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(source)) !== null) out.push(m.index);
  return out;
}

/**
 * PER-OCCURRENCE relation. For a `session.destroy(` occurrence the eviction must
 * PRECEDE it, within `(prevTeardown, pos)` — generalising the server.js per-site
 * rule (review `dfa3e1c3` finding #2: a two-sided window let a new destroy placed
 * before an existing eviction pass). `removeWorkspace(` is the one carve-out: the
 * two server.js removal sites (ensureValidToken, handleWorkspaceRemoval) evict
 * AFTER the removal — the hoisted LIN-1518 eviction covers both arms — so a
 * removal may be covered by an eviction in `(pos, nextTeardown)` as well. A
 * removal appended past every eviction still fails.
 */
function teardownEvictionOffenders(sources) {
  const offenders = [];
  for (const [rel, src] of sources) {
    const destroys = matchPositions(src, DESTROY_RE);
    const removes = matchPositions(src, REMOVE_RE);
    const teardowns = [...destroys, ...removes].sort((a, b) => a - b);
    const evictions = matchPositions(src, EVICT_RE);
    teardowns.forEach((pos, i) => {
      const prev = i === 0 ? -1 : teardowns[i - 1];
      const next = i + 1 < teardowns.length ? teardowns[i + 1] : src.length + 1;
      const preceded = evictions.some((e) => e > prev && e < pos);
      const removalCarveOut = removes.includes(pos) && evictions.some((e) => e > pos && e < next);
      if (!preceded && !removalCarveOut) offenders.push(`${rel}@${pos}`);
    });
  }
  return offenders;
}

describe('LIN-1507 witness D(ii) — session.destroy/removeWorkspace per-occurrence eviction (LIN-3219 A3)', () => {
  test('every teardown occurrence is covered by a workspace-token eviction', () => {
    const sources = productionSources();
    const destroys = [...sources.values()].reduce((n, s) => n + matchPositions(s, DESTROY_RE).length, 0);
    const removals = [...sources.values()].reduce((n, s) => n + matchPositions(s, REMOVE_RE).length, 0);
    assert.ok(destroys > 0 && removals > 0, 'a zero-teardown scan would be vacuous');
    const offenders = teardownEvictionOffenders(sources);
    assert.deepEqual(offenders, [], `teardown occurrences with no eviction between their neighbours: ${offenders.join(', ')}`);
  });

  test('WITNESS: a new session.destroy( in routes/auth.js (which already evicts) with no local eviction fails', () => {
    const sources = productionSources();
    const planted = new Map(sources);
    planted.set('routes/auth.js', `${sources.get('routes/auth.js')}\nfunction _extra(req, res) { req.session.destroy(() => res.redirect('/')); }\n`);
    assert.ok(
      teardownEvictionOffenders(planted).some((o) => o.startsWith('routes/auth.js@')),
      'the planted unguarded destroy in an already-evicting module must be an offender'
    );
  });

  test('WITNESS: a new session.destroy( planted BEFORE the existing eviction fails (order-dependent)', () => {
    // Review `dfa3e1c3` finding #2: a two-sided window let a destroy placed
    // before an existing eviction pass. Insert at the TOP of routes/auth.js,
    // before /logout's eviction.
    const sources = productionSources();
    const planted = new Map(sources);
    planted.set('routes/auth.js', `function _x(req) { req.session.destroy(() => {}); }\n${sources.get('routes/auth.js')}`);
    assert.ok(
      teardownEvictionOffenders(planted).some((o) => o.startsWith('routes/auth.js@')),
      'a destroy before the only eviction must be an offender'
    );
  });

  test('WITNESS: a new removeWorkspace( in routes/workspace.js (which already evicts) with no local eviction fails', () => {
    const sources = productionSources();
    const planted = new Map(sources);
    planted.set('routes/workspace.js', `${sources.get('routes/workspace.js')}\nfunction _extra(req, w) { removeWorkspace(req.session, w.id); }\n`);
    assert.ok(
      teardownEvictionOffenders(planted).some((o) => o.startsWith('routes/workspace.js@')),
      'the planted unguarded removal in an already-evicting module must be an offender'
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
    while ((match = destroyRegex.exec(source)) !== null) {
      const windowStart = Math.max(0, match.index - 500);
      const preceding = source.slice(windowStart, match.index);
      assert.ok(
        /(evictWorkspaceTokenPair|evictAllWorkspaceTokens)\(evictWorkspaceToken/.test(preceding),
        `session.destroy( at character offset ${match.index} in server.js has no ` +
        'evictWorkspaceTokenPair(evictWorkspaceToken or evictAllWorkspaceTokens(evictWorkspaceToken call in the preceding 500 characters. Every session-' +
        'destruction path in server.js must evict its workspace(s)\' cache entries BEFORE destroy() runs (LIN-1507).'
      );
    }
  });
});

/**
 * LIN-1518: the sibling census for the OTHER half of the class.
 *
 * The census above pins "session destroyed". This one pins "a workspace leaves
 * the session while the session itself SURVIVES" — the arm the destroy census
 * structurally cannot see, because there is no `session.destroy(` on it to
 * anchor to. LIN-1507 fixed 1 of the 3 instances (routes/workspace.js's
 * remove-one-of-many); the two `remaining > 0` arms in server.js kept returning
 * without evicting, so the removed workspace's cache entries (BOTH the
 * owner-scoped key and the legacy owner-blind `urlKey::*` key) went on
 * resolving for up to the full 30s TTL after the workspace had left.
 *
 * Severity, deliberately not inflated: this is NOT a revocation leak. At both
 * server.js sites the workspace is removed precisely BECAUSE its token failed
 * refresh, so the cached copy is a DEAD credential. What it actually is, is an
 * honesty regression against LIN-1506 — for up to 30s `resolveWorkspaceAccess`
 * answers `{ reason: 'ok', token: <dead> }` where the failure taxonomy would
 * otherwise give a truthful reason. Do not re-grade these tests as a
 * live-credential-leak guard; that would misdescribe what they protect.
 *
 * `removeWorkspace(` is the right anchor because it is the one shared mechanism
 * by which a workspace leaves a session — all three instances of the class call
 * it, so a fourth teardown path added later cannot dodge this census.
 *
 * Same honesty caveat as the destroy census above: these are SOURCE-TEXT
 * assertions, not behavioural ones. `ensureValidToken` and
 * `handleWorkspaceRemoval` are module-private (server.js exports nothing,
 * connects to a real DB, and calls app.listen() at module scope), so they
 * cannot be driven directly. This proves the call is present, unconditional,
 * and ordered before the branch — NOT that it is reached at runtime with the
 * right urlKey/accountId. See LIN-1514 (make resolveWorkspaceAccess
 * importable): if that lands, replace these with real behavioural tests. Do
 * NOT substitute a real-logout-vs-real-resolve end-to-end test — LIN-1507
 * established that shape is flaky by construction.
 */

// The bare `removeWorkspace()` inside LIN-1507's prose comment in
// handleWorkspaceRemoval is not a call site, so the lookahead in REMOVE_RE
// excludes an empty argument list rather than counting mentions in comments.

describe('LIN-1518 — removeWorkspace per-occurrence eviction (LIN-3219 A3)', () => {
  test('ensureValidToken evicts before its remaining>0 branch, so BOTH arms are covered', () => {
    const source = read('server.js');
    const catchIdx = source.indexOf('} catch (error) {\n    console.error(`Token refresh failed for workspace');
    assert.notEqual(catchIdx, -1, 'expected to find ensureValidToken\'s catch block in server.js');
    const nextFnIdx = source.indexOf('\n// Apply middleware to all routes except auth and logout', catchIdx);
    assert.notEqual(nextFnIdx, -1, 'expected to find the end of ensureValidToken');
    const catchBody = source.slice(catchIdx, nextFnIdx);

    const evictIdx = catchBody.indexOf('evictWorkspaceTokenPair(evictWorkspaceToken');
    const remainingCheckIdx = catchBody.indexOf('if (remaining > 0)');
    const destroyIdx = catchBody.indexOf('session.destroy(');
    assert.notEqual(evictIdx, -1, 'expected an evictWorkspaceTokenPair( call in ensureValidToken\'s catch block');
    assert.notEqual(remainingCheckIdx, -1, 'expected the `if (remaining > 0)` branch in ensureValidToken\'s catch block');
    assert.notEqual(destroyIdx, -1, 'expected a session.destroy( call in ensureValidToken\'s catch block');
    assert.ok(
      evictIdx < remainingCheckIdx && evictIdx < destroyIdx,
      'the cache eviction must be wired BEFORE the remaining>0/destroy branch so it covers BOTH arms — not just ' +
      'the destroy one. Inside the destroy arm alone is the LIN-1518 defect.'
    );
  });

  test('ensureValidToken\'s eviction is NOT gated on isDefinitiveRevocation (it tracks the removal, not the revocation)', () => {
    // The durable delete above it IS so gated (LIN-1545 S1): deleting the
    // SHARED durable credential on a transient blip would flip every headless
    // worker on the workspace to WORKSPACE_NOT_CONNECTED. The cache entry is
    // the opposite case — removeWorkspace has already run unconditionally by
    // this point, so the entry is stale on every failure that reaches here.
    // Nesting the eviction under that guard would silently restore the defect
    // for the non-definitive failures. Pinned via indentation: the statement
    // sits at the catch block's own 4-space level, not the 6-space level it
    // would occupy inside the isDefinitiveRevocation( block.
    const source = read('server.js');
    assert.ok(
      source.includes('\n    evictWorkspaceTokenPair(evictWorkspaceToken, workspace.urlKey, accountId)\n'),
      'expected ensureValidToken\'s eviction to sit unconditionally at the catch block\'s base indentation ' +
      '(4 spaces). A deeper indent means it was nested inside a guard — most likely isDefinitiveRevocation( — ' +
      'which reintroduces LIN-1518 for every non-definitive refresh failure.'
    );
  });

  test('handleWorkspaceRemoval evicts before its remaining>0 branch, so BOTH arms are covered', () => {
    const source = read('server.js');
    const startIdx = source.indexOf('async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {');
    assert.notEqual(startIdx, -1, 'expected to find handleWorkspaceRemoval in server.js');
    const endIdx = source.indexOf('\n/**\n * Attempts to refresh an expired token and retry the request.', startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of handleWorkspaceRemoval');
    const fnBody = source.slice(startIdx, endIdx);

    const evictIdx = fnBody.indexOf('evictWorkspaceTokenPair(evictWorkspaceToken');
    const remainingCheckIdx = fnBody.indexOf('if (remaining > 0)');
    const destroyIdx = fnBody.indexOf('session.destroy(');
    assert.notEqual(evictIdx, -1, 'expected an evictWorkspaceTokenPair( call in handleWorkspaceRemoval');
    assert.notEqual(remainingCheckIdx, -1, 'expected the `if (remaining > 0)` branch in handleWorkspaceRemoval');
    assert.notEqual(destroyIdx, -1, 'expected a session.destroy( call in handleWorkspaceRemoval');
    assert.ok(
      evictIdx < remainingCheckIdx && evictIdx < destroyIdx,
      'the cache eviction must be wired BEFORE the remaining>0/destroy branch so it covers BOTH arms — not just ' +
      'the destroy one. Inside the destroy arm alone is the LIN-1518 defect.'
    );
  });

  test('handleWorkspaceRemoval\'s eviction is guarded on removedWorkspace ALONE, never on deleteDurable', () => {
    // `deleteDurable` (LIN-1545 S2) governs whether the SHARED durable
    // credential is revoked — it is false on the transient-blip path precisely
    // so a blip does not revoke it. The session's own cache entry has no such
    // consideration: removeWorkspace ran unconditionally above, so the entry is
    // stale either way. Reusing the durable guard here would leave the
    // transient path unevicted. The `removedWorkspace` guard itself is real and
    // must stay — the lookup can miss, and urlKey would be read off undefined.
    const source = read('server.js');
    const startIdx = source.indexOf('async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {');
    assert.notEqual(startIdx, -1, 'expected to find handleWorkspaceRemoval in server.js');
    const endIdx = source.indexOf('\n/**\n * Attempts to refresh an expired token and retry the request.', startIdx);
    const fnBody = source.slice(startIdx, endIdx);

    const evictIdx = fnBody.indexOf('evictWorkspaceTokenPair(evictWorkspaceToken');
    const guardIdx = fnBody.lastIndexOf('if (removedWorkspace) {', evictIdx);
    assert.ok(
      guardIdx !== -1,
      'expected handleWorkspaceRemoval\'s eviction to be guarded on `if (removedWorkspace) {` alone. If this now ' +
      'reads `removedWorkspace && deleteDurable`, the transient-refresh-blip path removes the workspace without ' +
      'evicting its cache entries — LIN-1518, reintroduced.'
    );
    assert.ok(
      !fnBody.slice(guardIdx, evictIdx).includes('deleteDurable'),
      'the eviction guard must not mention deleteDurable — that flag scopes the DURABLE credential delete only.'
    );
  });
});
