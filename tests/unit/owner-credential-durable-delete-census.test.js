/**
 * LIN-1524 close-out Finding #1's own remedy: a durable-delete census,
 * mirroring tests/unit/workspace-token-eviction-census.test.js's
 * `session.destroy(` census for `ownerCredentialStore.delete(`. Without this,
 * the next teardown path added silently skips the durable delete — exactly
 * how the two sites in Finding #1 (ensureValidToken's catch block,
 * handleWorkspaceRemoval) went unwired by LIN-1523: they were caught by the
 * EVICTION census (they call evictWorkspaceTokenPair/session.destroy) but
 * nothing pinned the DURABLE-delete side of the same teardown set.
 *
 * Durable delete is a STRICT SUBSET of "session destroyed" — it fires only on
 * genuine disconnect (workspace/session teardown that revokes the workspace
 * connection itself), never on a plain human logout, which this ticket's
 * whole design exists to survive (a durable credential must outlive logout).
 * /logout (routes/auth.js) is therefore asserted to have ZERO durable-delete
 * calls, deliberately, not by omission.
 *
 * LIN-1545 narrowed the two human REFRESH sites further: at those sites the
 * delete now fires only on a DEFINITIVE revocation (`invalid_grant` →
 * `TokenRefreshError` code `EXPIRED`), NOT on any refresh failure. A transient
 * `NETWORK`/`INVALID`/`UNKNOWN` refresh blip keeps the credential and fails the
 * request transiently (a retryable 503) — otherwise one Linear 5xx during the
 * owner's refresh would nuke the shared durable record and flip every headless
 * worker on the workspace to WORKSPACE_NOT_CONNECTED tree-wide. This is a
 * deliberate revision recorded here (never a silent relaxation): the textual
 * call site + its pre-branch/pre-destroy order are unchanged (so the count and
 * the source-order assertions below still hold), only the guard around the two
 * refresh sites narrowed from "refresh failed" to "definitively revoked".
 *
 * LIN-1887 close-out F2 added the two NON-destructive refresh sites, which is a
 * widening of the census's population rather than an exception to it. Before
 * F2, "this provider's failed refresh must not remove the workspace" also meant
 * "…and therefore never revokes anything", because the non-destructive early
 * return sat above each dispatch's durable delete. Those are separable
 * decisions: the workspace survives, and the definitively-revoked partition is
 * revoked. So the rule this census enforces is unchanged and now stated in its
 * general form — every path that learns a credential is dead revokes it, and
 * only a path that tears the workspace down uses the whole-workspace verb.
 *
 * Known durable-delete call sites (7, all `if-guarded or unconditional`
 * `ownerCredentialStore.delete(`/`ownerCredentialStore.deleteAll(` calls):
 *   - server.js: ensureValidToken's NON-destructive arm (per-partition, gated on definitive revocation — LIN-1887 close-out F2)
 *   - server.js: handleUnauthorizedError's NON-destructive arm (the reactive twin of the same — LIN-1887 close-out F2)
 *   - server.js: ensureValidToken's catch block (gated on definitive revocation — LIN-1545 S1)
 *   - server.js: handleWorkspaceRemoval (both the remaining>0 and destroy arms — one call site, shared; gated on `deleteDurable`, only ever reached on definitive revocation from the 401-retry path — LIN-1545 S2)
 *   - server.js: /workspace/:urlKey/settings/providers/remove (Linear-only, gated on an actual unlink — Finding #2)
 *   - routes/workspace.js: /workspace/:urlKey/remove, single-workspace-logout-equivalent arm
 *   - routes/workspace.js: /workspace/:urlKey/remove, multi-workspace remove-one arm
 *
 * Run with: node --test tests/unit/owner-credential-durable-delete-census.test.js
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

// LIN-3219 A3 (M19): the numeric durable-delete total is gone, and the rule is
// PER OCCURRENCE rather than per module. The old boundary ("every module that
// durable-deletes also evicts somewhere") accepted a fresh unguarded delete in
// a module that already evicted elsewhere. Each `ownerCredentialStore.delete(`
// / `deleteAll(` is now checked on its own: it must sit on a guarded teardown
// statement (a definitive-revocation / actual-unlink / deleteDurable guard, or
// the optional-credential-store guard), so a new delete added without a guard
// fails with no number to bump. The durable-delete is intentionally NOT paired
// with a session cache eviction: routes/workspace.js pairs them, but
// server.js's unlink route legitimately revokes a partition with no cache
// eviction at all — the guard, not the eviction, is the per-occurrence contract.
const DURABLE_DELETE_RE = /\bownerCredentialStore\.delete(All)?\(/g;
const DURABLE_GUARD_RE = /if \(isDefinitiveRevocation\(|if \(bindingRemoved\)|if \(removedWorkspace && deleteDurable\)|if \(ownerCredentialStore\)/;

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
 * PER-OCCURRENCE relation: every durable-delete occurrence must sit on a
 * guarded teardown statement. The guard is looked for on the delete's own line
 * and the few lines above it, so a multi-line `if (...)` is seen but an
 * unguarded append is not. Returns `file:line` offenders.
 */
function unguardedDurableDeletes(sources) {
  const offenders = [];
  for (const [rel, src] of sources) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\bownerCredentialStore\.delete(All)?\(/.test(line)) return;
      const window = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
      if (!DURABLE_GUARD_RE.test(window)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  return offenders;
}

// LIN-1887 N2 gave the store a SECOND delete verb. `delete(accountId, urlKey,
// provider)` revokes ONE provider partition; `deleteAll(accountId, urlKey)`
// revokes every partition for a workspace. Whole-workspace teardown uses the
// latter; both are covered per occurrence above by the same guard rule.

describe('LIN-1524 close-out Finding #1 — ownerCredentialStore.delete per-occurrence guard (LIN-3219 A3)', () => {
  test('every durable-delete occurrence sits on a guarded teardown statement', () => {
    const sources = productionSources();
    const total = [...sources.values()].reduce((n, s) => n + matchPositions(s, DURABLE_DELETE_RE).length, 0);
    assert.ok(total > 0, 'a zero-delete scan would be vacuous');
    const offenders = unguardedDurableDeletes(sources);
    assert.deepEqual(offenders, [], `durable-delete occurrences without a guard: ${offenders.join(', ')}`);
  });

  test('WITNESS: a new unguarded ownerCredentialStore.delete( in routes/workspace.js (which already durable-deletes) fails', () => {
    const sources = productionSources();
    const planted = new Map(sources);
    planted.set('routes/workspace.js', `${sources.get('routes/workspace.js')}\nasync function _extra(ownerCredentialStore, accountId, urlKey) {\n  await ownerCredentialStore.delete(accountId, urlKey, 'linear');\n}\n`);
    assert.ok(
      unguardedDurableDeletes(planted).some((o) => o.startsWith('routes/workspace.js:')),
      'the planted unguarded durable delete in an already-compliant module must be an offender'
    );
  });

  test('routes/auth.js (/logout) has ZERO ownerCredentialStore.delete( calls — deliberate, not an omission', () => {
    const count = matchPositions(read('routes/auth.js'), DURABLE_DELETE_RE).length;
    assert.equal(
      count,
      0,
      'Logout must NEVER delete the durable owner credential — LIN-1524\'s entire point is that a durable ' +
      'credential survives logout (only workspace disconnect/removal revokes it). If this fails, someone wired ' +
      'a durable delete into /logout; revert it and use a session-only eviction instead.'
    );
  });
});

describe('LIN-1524 close-out Finding #1 — source assertions for the 2 non-injectable server.js sites', () => {
  // Same honesty caveat as workspace-token-eviction-census.test.js: this
  // proves an ownerCredentialStore.delete( call appears in the source text
  // near the teardown it should accompany — not that it runs correctly at
  // runtime, or with the right accountId/urlKey. Runtime correctness for
  // routes/workspace.js's two sites and the providers/remove route is
  // covered behaviourally in workspace-remove-route.test.js,
  // auth-logout-route.test.js (confirming NO delete there), and
  // provider-remove-durable-delete.test.js / workspace.test.js's composed
  // unlinkProvider tests. server.js's ensureValidToken and
  // handleWorkspaceRemoval are module-private (server.js exports none of
  // them, and isn't import-safe in a unit test), so this is the only
  // regression guard available for them.
  test('ensureValidToken\'s catch block calls ownerCredentialStore.delete( before its session.destroy(', () => {
    const source = read('server.js');
    const catchIdx = source.indexOf('} catch (error) {\n    console.error(`Token refresh failed for workspace');
    assert.notEqual(catchIdx, -1, 'expected to find ensureValidToken\'s catch block in server.js');

    const nextFnIdx = source.indexOf('\n// Apply middleware to all routes except auth and logout', catchIdx);
    assert.notEqual(nextFnIdx, -1, 'expected to find the end of ensureValidToken (the next middleware comment)');
    const catchBody = source.slice(catchIdx, nextFnIdx);

    const deleteIdx = catchBody.indexOf('ownerCredentialStore.delete(');  // per-partition: the routed provider (LIN-1887 N2)
    const destroyIdx = catchBody.indexOf('session.destroy(');
    assert.notEqual(deleteIdx, -1, 'expected an ownerCredentialStore.delete( call in ensureValidToken\'s catch block');
    assert.notEqual(destroyIdx, -1, 'expected a session.destroy( call in ensureValidToken\'s catch block');
    assert.ok(deleteIdx < destroyIdx, 'the durable delete must be wired BEFORE session.destroy(, not after');
  });

  test('handleWorkspaceRemoval calls ownerCredentialStore.deleteAll( before either of its return paths (remaining>0 redirect, destroy arm)', () => {
    const source = read('server.js');
    const startMarker = 'async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {';
    const startIdx = source.indexOf(startMarker);
    assert.notEqual(startIdx, -1, 'expected to find handleWorkspaceRemoval in server.js');

    const nextFnMarker = '\n/**\n * Attempts to refresh an expired token and retry the request.';
    const endIdx = source.indexOf(nextFnMarker, startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of handleWorkspaceRemoval (the next function\'s docstring)');
    const fnBody = source.slice(startIdx, endIdx);

    // LIN-1887 N2: whole-workspace teardown must use the whole-workspace verb.
    // `delete(` would type-check and pass a laxer assertion while leaving every
    // non-active provider's credential orphaned, so this pins the verb itself.
    const deleteIdx = fnBody.indexOf('ownerCredentialStore.deleteAll(');
    const remainingCheckIdx = fnBody.indexOf('if (remaining > 0)');
    const destroyIdx = fnBody.indexOf('session.destroy(');
    assert.notEqual(deleteIdx, -1, 'expected an ownerCredentialStore.deleteAll( call in handleWorkspaceRemoval');
    assert.notEqual(remainingCheckIdx, -1, 'expected the `if (remaining > 0)` branch in handleWorkspaceRemoval');
    assert.notEqual(destroyIdx, -1, 'expected a session.destroy( call in handleWorkspaceRemoval');
    assert.ok(
      deleteIdx < remainingCheckIdx && deleteIdx < destroyIdx,
      'the durable delete must be wired BEFORE the remaining>0/destroy branch, so it covers BOTH arms — not just one'
    );
  });
});

describe('LIN-1545 — durable delete narrowed to definitive revocation at both human refresh paths', () => {
  // These pin the *guard* around the two refresh-path deletes, not just their
  // presence: transient refresh failures must keep the durable credential and
  // fail with a retryable 503, and only a definitive (invalid_grant / EXPIRED)
  // revocation may delete it. Same honesty caveat as the census above — this is
  // a source-text assertion (the middleware is module-private and server.js is
  // not import-safe); genuine runtime coverage of the branch lives in the
  // isDefinitiveRevocation / isTransientRefreshFailure predicate unit tests in
  // tests/unit/token-refresh.test.js, which both server.js sites call.

  test('S1: ensureValidToken\'s catch returns a transient 503 before the guarded delete, and gates the delete on definitive revocation', () => {
    const source = read('server.js');
    const catchIdx = source.indexOf('} catch (error) {\n    console.error(`Token refresh failed for workspace');
    assert.notEqual(catchIdx, -1, 'expected to find ensureValidToken\'s catch block in server.js');
    const nextFnIdx = source.indexOf('\n// Apply middleware to all routes except auth and logout', catchIdx);
    assert.notEqual(nextFnIdx, -1, 'expected to find the end of ensureValidToken');
    const catchBody = source.slice(catchIdx, nextFnIdx);

    const transientIdx = catchBody.indexOf('isTransientRefreshFailure(');
    const serviceUnavailableIdx = catchBody.indexOf('serviceUnavailable');
    const definitiveIdx = catchBody.indexOf('isDefinitiveRevocation(');
    const deleteIdx = catchBody.indexOf('ownerCredentialStore.delete(');  // per-partition: the routed provider (LIN-1887 N2)

    assert.notEqual(transientIdx, -1, 'expected an isTransientRefreshFailure( branch in ensureValidToken\'s catch');
    assert.notEqual(serviceUnavailableIdx, -1, 'expected a serviceUnavailable (retryable 503) response for the transient path');
    assert.notEqual(definitiveIdx, -1, 'expected an isDefinitiveRevocation( guard around the durable delete');
    assert.notEqual(deleteIdx, -1, 'expected the ownerCredentialStore.delete( call to still exist (census site)');
    assert.ok(
      transientIdx < deleteIdx && serviceUnavailableIdx < deleteIdx,
      'the transient 503 early-return must come BEFORE the durable delete, so a transient blip never reaches it'
    );
    assert.ok(
      definitiveIdx < deleteIdx,
      'the durable delete must be gated on isDefinitiveRevocation(, so it fires only on EXPIRED'
    );
  });

  test('S2: handleWorkspaceRemoval gates its durable delete on the deleteDurable flag', () => {
    const source = read('server.js');
    const startIdx = source.indexOf('async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {');
    assert.notEqual(startIdx, -1, 'expected handleWorkspaceRemoval to carry the deleteDurable = true default param');
    const endIdx = source.indexOf('\n/**\n * Attempts to refresh an expired token and retry the request.', startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of handleWorkspaceRemoval');
    const fnBody = source.slice(startIdx, endIdx);

    const guardIdx = fnBody.indexOf('if (removedWorkspace && deleteDurable)');
    const deleteIdx = fnBody.indexOf('ownerCredentialStore.deleteAll(');
    assert.notEqual(guardIdx, -1, 'expected the durable delete to be gated on `removedWorkspace && deleteDurable`');
    assert.ok(guardIdx < deleteIdx, 'the deleteDurable guard must wrap the durable delete');
  });

  test('S2: handleUnauthorizedError deletes+removes only on definitive revocation, else returns a transient 503', () => {
    const source = read('server.js');
    const startIdx = source.indexOf('async function handleUnauthorizedError(workspace, session, teamId, assigneeState, openRouterSource, res) {');
    assert.notEqual(startIdx, -1, 'expected to find handleUnauthorizedError in server.js');
    const endIdx = source.indexOf('\n/**\n * Home page', startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of handleUnauthorizedError');
    const fnBody = source.slice(startIdx, endIdx);

    const catchIdx = fnBody.indexOf('catch (refreshError)');
    assert.notEqual(catchIdx, -1, 'expected the refresh-retry catch (refreshError) in handleUnauthorizedError');
    const catchBody = fnBody.slice(catchIdx);

    const definitiveIdx = catchBody.indexOf('isDefinitiveRevocation(refreshError)');
    const removalIdx = catchBody.indexOf('handleWorkspaceRemoval(session, workspace.id, res, true)');
    const serviceUnavailableIdx = catchBody.indexOf('serviceUnavailable');
    assert.notEqual(definitiveIdx, -1, 'expected the removal to be gated on isDefinitiveRevocation(refreshError)');
    assert.notEqual(removalIdx, -1, 'expected a definitive-only handleWorkspaceRemoval(..., true) call in the catch');
    assert.notEqual(serviceUnavailableIdx, -1, 'expected a serviceUnavailable (retryable 503) fall-through for transient failures');
    assert.ok(
      definitiveIdx < removalIdx && removalIdx < serviceUnavailableIdx,
      'the catch must delete+remove on definitive revocation, then fall through to the transient 503'
    );
  });

  test('the WORKSPACE_UNAVAILABLE_BY_REASON 503 envelope in lib/errors.js is untouched (codes/slugs unchanged)', () => {
    // LIN-1545 reuses the generic serviceUnavailable helper for the human
    // refresh paths and must NOT touch the structured headless-resolve envelope.
    // Pin every reason key and its code slug so an accidental edit here is caught.
    const source = read('lib/errors.js');
    assert.ok(source.includes('const WORKSPACE_UNAVAILABLE_BY_REASON = {'), 'expected the WORKSPACE_UNAVAILABLE_BY_REASON map to still exist');
    const expectedSlugs = [
      'WORKSPACE_STORE_UNAVAILABLE',
      'WORKSPACE_SESSION_EXPIRED',
      'WORKSPACE_NOT_CONNECTED',
      'WORKSPACE_OWNER_MISMATCH',
      'WORKSPACE_OWNER_SIGNED_OUT',
      'WORKSPACE_UNAVAILABLE', // the fallback code in workspaceUnavailableEnvelope
    ];
    for (const slug of expectedSlugs) {
      assert.ok(source.includes(`'${slug}'`), `expected the ${slug} code slug to be unchanged in lib/errors.js`);
    }
    for (const reason of ['store_unreachable', 'session_expired', 'not_connected', 'owner_mismatch', 'owner_signed_out']) {
      assert.ok(source.includes(`${reason}:`), `expected the ${reason} reason key to be unchanged in lib/errors.js`);
    }
  });
});
