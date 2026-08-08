/**
 * Source-text regression guard for POST /workspace/:urlKey/settings/providers/remove
 * (LIN-1523, beat 4 — the third durable deletion site).
 *
 * server.js is not import-safe in a unit test: importing it connects to Mongo
 * and calls app.listen() at module load (no require.main guard). The
 * codebase's established answer to this — precedented in
 * tests/unit/task-chat-route.test.js and Block E of
 * tests/unit/workspace-token-refresh.test.js — is a source-text regression
 * guard: cheap, deterministic, and it catches exactly the regression that
 * matters here (the durable delete silently dropping, or the scope-to-'linear'
 * guard being removed so a GitHub unlink wrongly touches the Linear-only
 * durable store).
 *
 * unlinkProvider itself (the pure/sync session-side mutator, unchanged by this
 * ticket — its existing session-side delete stays untouched) is covered
 * directly, with real assertions, in tests/unit/workspace.test.js. This file
 * only proves server.js's route actually calls the durable delete alongside
 * it, in the right place, under the right guard.
 *
 * Run with: node --test tests/unit/provider-remove-durable-delete.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function routeHandlerBody() {
  const startMarker = "app.post('/workspace/:urlKey/settings/providers/remove'";
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find the provider-removal route in server.js');
  // The handler ends at the route's own closing `});` — the next occurrence
  // of a line that is exactly `});` after the start marker.
  const lines = SERVER_SRC.slice(startIdx).split('\n');
  const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '});');
  assert.notEqual(endIdx, -1, 'expected to find the closing `});` of the provider-removal route');
  return lines.slice(0, endIdx + 1).join('\n');
}

describe('provider-removal route: durable delete (LIN-1523, source-text pin)', () => {
  test('unlinkProvider is still called — the existing session-side delete is untouched', () => {
    const body = routeHandlerBody();
    assert.match(body, /unlinkProvider\(workspace, provider, scope\)/);
  });

  test('ownerCredentialStore.delete is called, AFTER unlinkProvider, PARTITION-scoped to the unlinked provider', () => {
    const body = routeHandlerBody();
    const unlinkIdx = body.indexOf('unlinkProvider(workspace, provider, scope)');
    const deleteIdx = body.indexOf('ownerCredentialStore.delete(');
    assert.notEqual(deleteIdx, -1, 'expected an ownerCredentialStore.delete call in the provider-removal route');
    assert.ok(deleteIdx > unlinkIdx, 'the durable delete must be wired AFTER unlinkProvider, not before');

    // Walk back from the delete call to find its guarding `if (...)`.
    const beforeDelete = body.slice(0, deleteIdx);
    const ifLine = beforeDelete.split('\n').reverse().find(l => l.trim().startsWith('if ('));
    assert.ok(ifLine, 'expected an `if (...)` guarding the durable delete call');
    // LIN-1887 N2 REPEALED the `provider === 'linear'` gate this used to assert.
    // Its rationale — "the store is Linear-only by design" — was true only while
    // exactly one refreshable provider per workspace was true; Jira OAuth is the
    // second, and its credential is as revocable as Linear's. The gate did not
    // disappear, it became the PARTITION ARGUMENT, which is strictly more
    // precise: unlinking Jira deletes exactly Jira's credential and provably
    // cannot reach Linear's. What is worth pinning is therefore the scoping
    // itself — that this delete names the provider being unlinked — not the
    // repealed provider name.
    assert.match(ifLine, /bindingRemoved/, 'the durable delete must still be gated on an actual binding removal');
  });

  test('the durable delete call receives the session accountId, the workspace urlKey AND the provider — the correct partitioned key', () => {
    const body = routeHandlerBody();
    assert.match(
      body,
      /ownerCredentialStore\.delete\(req\.session\.accountId,\s*workspace\.urlKey,\s*provider\)/,
      'LIN-1887: the composite key gained a provider partition — an unlink must revoke exactly the unlinked binding’s credential, never a sibling provider’s'
    );
  });

  test('LIN-1524 close-out Finding #2: the durable delete is ALSO gated on an actual binding removal, not provider alone', () => {
    // unlinkProvider no-ops on an unmatched (provider, scope) — a bare
    // `if (provider === 'linear')` guard deletes the durable record even when
    // the session binding was untouched. The fix captures a reference to the
    // raw `workspace.bindings` array before the call and compares identity
    // after (unlinkProvider only ever reassigns it, via `.filter()`, on an
    // actual removal — never on a no-op). getBindingsForWorkspace().length is
    // deliberately NOT used: it synthesizes a phantom binding whenever
    // `bindings` is empty, which would mask a real removal. See
    // tests/unit/workspace.test.js's composed test for the behavioural proof
    // of the actual bug this pins.
    const body = routeHandlerBody();
    assert.match(body, /const bindingsBefore = workspace\.bindings/, 'expected a captured reference to workspace.bindings before unlinkProvider runs');
    assert.match(body, /workspace\.bindings !== bindingsBefore/, 'expected a reference-identity check after unlinkProvider runs');

    const deleteIdx = body.indexOf('ownerCredentialStore.delete(');
    const beforeDelete = body.slice(0, deleteIdx);
    const ifLine = beforeDelete.split('\n').reverse().find(l => l.trim().startsWith('if ('));
    assert.match(ifLine, /bindingRemoved/, "the durable delete's guard must also require the removal signal, not just provider === 'linear'");
  });
});
