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
 * Known durable-delete call sites (5, all `if-guarded or unconditional`
 * `ownerCredentialStore.delete(`/`ownerCredentialStore.delete(` calls):
 *   - server.js: ensureValidToken's catch block (refresh failure → workspace removed)
 *   - server.js: handleWorkspaceRemoval (both the remaining>0 and destroy arms — one call site, shared)
 *   - server.js: /workspace/:urlKey/settings/providers/remove (Linear-only, gated on an actual unlink — Finding #2)
 *   - routes/workspace.js: /workspace/:urlKey/remove, single-workspace-logout-equivalent arm
 *   - routes/workspace.js: /workspace/:urlKey/remove, multi-workspace remove-one arm
 *
 * Run with: node --test tests/unit/owner-credential-durable-delete-census.test.js
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

function countDurableDeletes(source) {
  return (source.match(/\bownerCredentialStore\.delete\(/g) || []).length;
}

const KNOWN_DURABLE_DELETE_COUNT = 5;

describe('LIN-1524 close-out Finding #1 — ownerCredentialStore.delete( census', () => {
  test('the total count of ownerCredentialStore.delete( across server.js + routes/workspace.js is exactly 5', () => {
    const counts = {
      'server.js': countDurableDeletes(read('server.js')),
      'routes/workspace.js': countDurableDeletes(read('routes/workspace.js')),
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    assert.equal(
      total,
      KNOWN_DURABLE_DELETE_COUNT,
      `Found ${total} ownerCredentialStore.delete( call site(s) (${JSON.stringify(counts)}), expected exactly ` +
      `${KNOWN_DURABLE_DELETE_COUNT}. A NEW workspace/session-disconnect path needs a matching durable delete, ` +
      'per LIN-1524 close-out Finding #1: a durable Linear credential must not outlive the workspace connection ' +
      "that granted it. Before touching KNOWN_DURABLE_DELETE_COUNT, add (or remove) a matching " +
      'ownerCredentialStore.delete(accountId, urlKey) call for the new/removed teardown path. See the existing ' +
      'sites: server.js (ensureValidToken catch, handleWorkspaceRemoval, providers/remove) and routes/workspace.js ' +
      '(/workspace/:urlKey/remove, both arms). Do NOT add one for a plain logout — durable credentials must ' +
      'survive human logout by design (see the /logout test below).'
    );
  });

  test('routes/auth.js (/logout) has ZERO ownerCredentialStore.delete( calls — deliberate, not an omission', () => {
    const count = countDurableDeletes(read('routes/auth.js'));
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

    const deleteIdx = catchBody.indexOf('ownerCredentialStore.delete(');
    const destroyIdx = catchBody.indexOf('session.destroy(');
    assert.notEqual(deleteIdx, -1, 'expected an ownerCredentialStore.delete( call in ensureValidToken\'s catch block');
    assert.notEqual(destroyIdx, -1, 'expected a session.destroy( call in ensureValidToken\'s catch block');
    assert.ok(deleteIdx < destroyIdx, 'the durable delete must be wired BEFORE session.destroy(, not after');
  });

  test('handleWorkspaceRemoval calls ownerCredentialStore.delete( before either of its return paths (remaining>0 redirect, destroy arm)', () => {
    const source = read('server.js');
    const startMarker = 'async function handleWorkspaceRemoval(session, workspaceId, res) {';
    const startIdx = source.indexOf(startMarker);
    assert.notEqual(startIdx, -1, 'expected to find handleWorkspaceRemoval in server.js');

    const nextFnMarker = '\n/**\n * Attempts to refresh an expired token and retry the request.';
    const endIdx = source.indexOf(nextFnMarker, startIdx);
    assert.notEqual(endIdx, -1, 'expected to find the end of handleWorkspaceRemoval (the next function\'s docstring)');
    const fnBody = source.slice(startIdx, endIdx);

    const deleteIdx = fnBody.indexOf('ownerCredentialStore.delete(');
    const remainingCheckIdx = fnBody.indexOf('if (remaining > 0)');
    const destroyIdx = fnBody.indexOf('session.destroy(');
    assert.notEqual(deleteIdx, -1, 'expected an ownerCredentialStore.delete( call in handleWorkspaceRemoval');
    assert.notEqual(remainingCheckIdx, -1, 'expected the `if (remaining > 0)` branch in handleWorkspaceRemoval');
    assert.notEqual(destroyIdx, -1, 'expected a session.destroy( call in handleWorkspaceRemoval');
    assert.ok(
      deleteIdx < remainingCheckIdx && deleteIdx < destroyIdx,
      'the durable delete must be wired BEFORE the remaining>0/destroy branch, so it covers BOTH arms — not just one'
    );
  });
});
