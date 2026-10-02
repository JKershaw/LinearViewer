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

// LIN-3219 A3 (M19): the numeric totals are gone. The production corpus (all
// routes except the routes/test.js harness, plus server.js) is scanned and the
// relation is a BOUNDARY on which modules may call the teardown symbols:
//   - every module that calls `session.destroy(` must also evict the workspace
//     token cache (pairing by module);
//   - every module that calls `removeWorkspace(` must also evict.
// A module that tears down without evicting fails, with no number to bump.
const DESTROY_RE = /\bsession\.destroy\(/g;
const EVICT_RE = /(evictWorkspaceTokenPair\(evictWorkspaceToken|evictAllWorkspaceTokens\(evictWorkspaceToken)/g;
const REMOVE_RE = /\bremoveWorkspace\((?!\))/g;

function productionSources() {
  const files = [
    'server.js',
    ...readdirSync(join(repoRoot, 'routes'))
      .filter((n) => n.endsWith('.js') && n !== 'test.js')
      .map((n) => `routes/${n}`),
  ];
  return new Map(files.map((rel) => [rel, readFileSync(join(repoRoot, rel), 'utf8')]));
}

function modulesMatching(sources, re) {
  const out = [];
  const stateless = new RegExp(re.source, re.flags.replace('g', ''));
  for (const [rel, src] of sources) if (stateless.test(src)) out.push(rel);
  return out.sort();
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

describe('LIN-1507 witness D(ii) — session.destroy module boundary (LIN-3219 A3)', () => {
  test('every module that destroys a session also evicts the workspace token cache', () => {
    // Boundary rule (not a count): a module may call `session.destroy(` only if
    // it also carries an eviction call. A new teardown module that forgets the
    // eviction fails here, with no number to bump.
    const sources = productionSources();
    const destroyers = modulesMatching(sources, DESTROY_RE);
    const evictors = modulesMatching(sources, EVICT_RE);
    assert.ok(destroyers.length > 0, 'a zero-destroy scan would be vacuous');
    const offenders = destroyers.filter((f) => !evictors.includes(f));
    assert.deepEqual(offenders, [], `destroying modules without an eviction: ${offenders.join(', ')}`);
  });

  test('WITNESS: a new destroy module with no eviction fails the boundary', () => {
    const planted = new Map([
      ...productionSources(),
      ['routes/new-teardown.js', "req.session.destroy(() => res.redirect('/'));\n"],
    ]);
    const destroyers = modulesMatching(planted, DESTROY_RE);
    const evictors = modulesMatching(planted, EVICT_RE);
    const offenders = destroyers.filter((f) => !evictors.includes(f));
    assert.ok(offenders.includes('routes/new-teardown.js'), `expected routes/new-teardown.js, got ${JSON.stringify(offenders)}`);
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
// handleWorkspaceRemoval is not a call site, so the lookahead excludes an
// empty argument list rather than counting mentions in comments.
function countWorkspaceRemovals(source) {
  return (source.match(/\bremoveWorkspace\((?!\))/g) || []).length;
}

const KNOWN_WORKSPACE_REMOVAL_COUNT = 3;

describe('LIN-1518 — removeWorkspace module boundary (LIN-3219 A3)', () => {
  test('every module that calls removeWorkspace( also evicts the workspace token cache', () => {
    // Boundary rule (not a count): dropping a workspace from a surviving session
    // must be paired with an eviction, module by module.
    const sources = productionSources();
    const removers = modulesMatching(sources, REMOVE_RE);
    const evictors = modulesMatching(sources, EVICT_RE);
    assert.ok(removers.length > 0, 'a zero-removal scan would be vacuous');
    const offenders = removers.filter((f) => !evictors.includes(f));
    assert.deepEqual(offenders, [], `removeWorkspace( modules without an eviction: ${offenders.join(', ')}`);
  });

  test('WITNESS: a new removeWorkspace( module with no eviction fails the boundary', () => {
    const planted = new Map([
      ...productionSources(),
      ['routes/new-remove.js', 'removeWorkspace(req.session, workspace.id);\n'],
    ]);
    const removers = modulesMatching(planted, REMOVE_RE);
    const evictors = modulesMatching(planted, EVICT_RE);
    const offenders = removers.filter((f) => !evictors.includes(f));
    assert.ok(offenders.includes('routes/new-remove.js'), `expected routes/new-remove.js, got ${JSON.stringify(offenders)}`);
  });

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
