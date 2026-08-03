// LIN-1503: handleUnauthorizedError's 401/403 gate was provider-blind
// (`durableRecord?.refreshToken`, Linear-only) — a GitHub/github-projects
// workspace never has a durable record, so the gate always read false and fell
// through to unconditional handleWorkspaceRemoval, destroying a recoverable
// workspace instead of re-minting its credential. This is a source-text pin,
// not a behavioral test: server.js is not import-safe in a unit test (it
// connects to Mongo and calls app.listen() at module load), the same
// constraint documented in workspace-token-refresh.test.js's Block E and
// owner-credential-durable-delete-census.test.js. remintActiveCredential's own
// success/failure behavior for both github/github-projects is already covered
// by tests/unit/workspace.test.js (fake-provider unit tests, lines 587-721);
// this file proves handleUnauthorizedError actually wires that primitive in,
// with the two independently-scoped try/catches the plan-review's F1 finding
// required (a successful re-mint followed by a failed render must preserve the
// workspace, not destroy it).

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function getHandleUnauthorizedErrorBody() {
  const startMarker = 'async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {';
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find handleUnauthorizedError in server.js');
  const endIdx = SERVER_SRC.indexOf('\n/**\n * Home page', startIdx);
  assert.notEqual(endIdx, -1, 'expected to find the end of handleUnauthorizedError (the next route\'s docstring)');
  return SERVER_SRC.slice(startIdx, endIdx);
}

describe('LIN-1503: handleUnauthorizedError GitHub-family branch (source-text pin)', () => {
  test('the GitHub-family guard exists and precedes the Linear durableRecord check', () => {
    const body = getHandleUnauthorizedErrorBody();
    const guardIdx = body.indexOf("if (workspace.provider === 'github' || workspace.provider === 'github-projects') {");
    const linearCheckIdx = body.indexOf('const durableRecord = await ownerCredentialStore.get(');
    assert.notEqual(guardIdx, -1, 'expected the GitHub-family provider guard in handleUnauthorizedError');
    assert.notEqual(linearCheckIdx, -1, 'expected the Linear durableRecord check in handleUnauthorizedError');
    assert.ok(guardIdx < linearCheckIdx, 'the GitHub-family branch must precede the Linear durableRecord check, so GitHub-family workspaces never reach the Linear-only gate');
  });

  test('the remint try/catch is scoped to ONLY the re-mint + saveSession — it does not contain the render or the fetch', () => {
    const body = getHandleUnauthorizedErrorBody();
    const guardIdx = body.indexOf("if (workspace.provider === 'github' || workspace.provider === 'github-projects') {");
    const remintCallIdx = body.indexOf('await remintActiveCredential(workspace, getProviderForWorkspace(workspace));', guardIdx);
    assert.notEqual(remintCallIdx, -1, 'expected a remintActiveCredential( call in the GitHub-family branch');
    assert.ok(remintCallIdx > guardIdx, 'the remint call must be inside the GitHub-family guard');

    const remintCatchIdx = body.indexOf('catch (remintError)', remintCallIdx);
    assert.notEqual(remintCatchIdx, -1, 'expected a catch (remintError) clause after the remint call');

    const remintCatchRemovalIdx = body.indexOf('return handleWorkspaceRemoval(session, workspace.id, res, false);', remintCatchIdx);
    assert.notEqual(remintCatchRemovalIdx, -1, 'expected catch (remintError) to call handleWorkspaceRemoval(..., false) unconditionally — false because the durable owner-credential record is keyed per workspace identity, not per binding, so a re-mint failure must not delete a co-resident Linear durable credential');

    // F1's regression guard: the slice from the guard through catch
    // (remintError)'s own body must not contain the render or the live fetch it
    // triggers — if it did, a successful re-mint followed by a render failure
    // would land in THIS catch and destroy the workspace, re-entering the
    // exact defect class LIN-1503 exists to close. Bound the slice to BEFORE
    // the second try block (which legitimately calls the render) rather than
    // to catch (renderError) itself, which comes after that render call.
    const renderReturnIdx = body.indexOf('return await renderDashboardAfterRefresh(', remintCatchIdx);
    assert.notEqual(renderReturnIdx, -1, 'expected a render call after catch (remintError)');
    const renderCatchIdx = body.indexOf('catch (renderError)', renderReturnIdx);
    assert.notEqual(renderCatchIdx, -1, 'expected a second catch (renderError) clause');
    const remintTrySlice = body.slice(guardIdx, renderReturnIdx);
    assert.ok(!remintTrySlice.includes('renderDashboardAfterRefresh('), 'the remint try/catch must not contain the render call — a render failure must not be classified as a remint failure');
    assert.ok(!remintTrySlice.includes('fetchAndPrepareProjects('), 'the remint try/catch must not contain the live provider fetch — same reasoning as above');
  });

  test('the render call is explicitly awaited so a rejection reaches catch (renderError), not catch (remintError)', () => {
    const body = getHandleUnauthorizedErrorBody();
    const guardIdx = body.indexOf("if (workspace.provider === 'github' || workspace.provider === 'github-projects') {");
    const renderReturnIdx = body.indexOf('return await renderDashboardAfterRefresh(workspace, session, teamId, openRouterSource, res);', guardIdx);
    assert.notEqual(renderReturnIdx, -1, 'expected `return await renderDashboardAfterRefresh(...)` — a bare `return renderDashboardAfterRefresh(...)` without await would not route a rejection through catch (renderError)');
  });

  test('catch (renderError) preserves the workspace: returns a retryable 503 and never calls handleWorkspaceRemoval', () => {
    const body = getHandleUnauthorizedErrorBody();
    const guardIdx = body.indexOf("if (workspace.provider === 'github' || workspace.provider === 'github-projects') {");
    const renderCatchIdx = body.indexOf('catch (renderError)', guardIdx);
    assert.notEqual(renderCatchIdx, -1, 'expected a catch (renderError) clause in the GitHub-family branch');

    // Bound the slice to catch (renderError)'s own body: from the catch clause
    // to the GitHub-family branch's closing brace, i.e. up to the Linear
    // durableRecord check that follows the whole branch.
    const linearCheckIdx = body.indexOf('const durableRecord = await ownerCredentialStore.get(', renderCatchIdx);
    assert.notEqual(linearCheckIdx, -1, 'expected the Linear durableRecord check to follow the GitHub-family branch');
    const renderCatchBody = body.slice(renderCatchIdx, linearCheckIdx);

    assert.ok(renderCatchBody.includes('serviceUnavailable'), 'expected catch (renderError) to return a retryable serviceUnavailable response');
    assert.ok(!renderCatchBody.includes('handleWorkspaceRemoval('), 'catch (renderError) must NEVER call handleWorkspaceRemoval — a post-remint render failure must preserve the workspace, this is the direct F1 regression guard');
  });

  test('handleUnauthorizedError does not reintroduce the provider-blind `if (workspace.refreshToken)` guard', () => {
    const body = getHandleUnauthorizedErrorBody();
    assert.doesNotMatch(
      body,
      /if \(workspace\.refreshToken\)/,
      'the GitHub-family fix must route on workspace.provider, never resurrect the old provider-blind workspace.refreshToken gate this ticket exists to close'
    );
  });

  test('the pinned docstring slice-boundary marker for handleWorkspaceRemoval\'s census tests is untouched', () => {
    // tests/unit/owner-credential-durable-delete-census.test.js:128,187 and
    // tests/unit/workspace-token-eviction-census.test.js:214,242 all slice
    // handleWorkspaceRemoval's body up to this literal string. The
    // renderDashboardAfterRefresh extraction is placed AFTER
    // handleTokenRefreshAndRetry (between it and handleUnauthorizedError)
    // specifically so this marker is never disturbed.
    assert.ok(
      SERVER_SRC.includes('\n/**\n * Attempts to refresh an expired token and retry the request.'),
      'expected the docstring marker preceding handleTokenRefreshAndRetry to still be present verbatim — ' +
      'moving or rewriting it would silently break 4 pinned assertions in the census test files'
    );
  });

  test('handleUnauthorizedError\'s own end-of-body marker ("Home page" docstring) is untouched', () => {
    // Used by lin-1524-legacy-no-accountid-accepted-behaviour.test.js:117 and
    // owner-credential-durable-delete-census.test.js:201. The new GitHub-family
    // branch must live INSIDE handleUnauthorizedError's existing body, not
    // push a new function between it and the next route.
    assert.ok(
      SERVER_SRC.includes('\n/**\n * Home page'),
      'expected the "Home page" docstring marker immediately after handleUnauthorizedError to still be present verbatim'
    );
  });
});
