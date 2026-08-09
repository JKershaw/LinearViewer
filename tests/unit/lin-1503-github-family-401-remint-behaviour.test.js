// LIN-1503 close-out: the BEHAVIORAL counterpart to
// lin-1503-github-family-401-remint.test.js, discharging ledger rows 3-6 of the
// implementation review's "What CI Did Not Prove" table.
//
// The sibling file pins the GitHub-family branch as *source text* — it proves
// the branch has the right shape (ordering, try-scoping, the explicit `await`,
// the `false` argument) but never executes it. That was not a shortcut: server.js
// is not import-safe in a unit test (it connects to Mongo and calls app.listen()
// at module load), the same documented constraint behind
// owner-credential-durable-delete-census.test.js and workspace-token-refresh.test.js's
// Block E. The consequence was that NO test in the repo executed
// handleUnauthorizedError at all, so the two findings that blocked this ticket at
// plan review (F1: a post-remint render failure must not destroy the workspace)
// and at implementation review (F1: a re-mint failure must not delete a
// co-resident Linear durable credential) were proven only by reading.
//
// This file closes that gap WITHOUT making server.js importable and WITHOUT
// moving a line of it. It reuses the census pattern one step further: it slices
// the real source of the GitHub-family branch and of handleWorkspaceRemoval by
// the same pinned markers the census tests already depend on, then EXECUTES that
// real source in a vm context with the collaborators injected. removeWorkspace
// and serviceUnavailable are the real implementations, imported normally — only
// the I/O boundaries (re-mint, session save, render, durable store) are faked, so
// a fault can be injected at each one.
//
// What this proves that source-text pins cannot: that the `await` genuinely
// routes a render rejection to catch (renderError) rather than catch
// (remintError); that the workspace object is still on the session afterwards;
// and that ownerCredentialStore.delete is never called when the re-mint fails.
//
// What it still does NOT prove (ledger rows 1, 2 — accepted, not discharged):
// real GitHub App semantics. remintActiveCredential is faked here, so nothing
// asserts that a live installation token is actually minted or that a revoked
// installation actually throws. That needs a staging App and remains this
// ticket's accepted gap.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { removeWorkspace, normalizeProvider } from '../../lib/workspace.js';
import { REFRESH_STRATEGY, refreshDeclarationFor, relinkNotice } from '../../lib/refresh-strategy.js';
import { serviceUnavailable } from '../../lib/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const GITHUB_FAMILY_GUARD =
  "if (declaration.strategy === REFRESH_STRATEGY.REMINT) {";

/**
 * The body of handleUnauthorizedError, sliced by the same two markers the
 * census tests pin (`lin-1524-legacy-no-accountid-accepted-behaviour.test.js:117`,
 * `owner-credential-durable-delete-census.test.js:201`).
 */
function sliceHandleUnauthorizedErrorBody() {
  const startMarker = 'async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {';
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find handleUnauthorizedError in server.js');
  const endIdx = SERVER_SRC.indexOf('\n/**\n * Home page', startIdx);
  assert.notEqual(endIdx, -1, 'expected the "Home page" docstring marker that bounds handleUnauthorizedError');
  return SERVER_SRC.slice(startIdx, endIdx);
}

/**
 * The GitHub-family `if` block, in full, taken from INSIDE
 * handleUnauthorizedError's body — the anchor matters: the identical guard
 * string also appears in ensureValidToken (server.js:647), and slicing from
 * SERVER_SRC directly would capture that one instead.
 */
function sliceGitHubFamilyBranch() {
  const body = sliceHandleUnauthorizedErrorBody();
  const guardIdx = body.indexOf(GITHUB_FAMILY_GUARD);
  assert.notEqual(guardIdx, -1, 'expected the GitHub-family guard inside handleUnauthorizedError');
  const linearIdx = body.indexOf('const durableRecord = await ownerCredentialStore.get(', guardIdx);
  assert.notEqual(linearIdx, -1, 'expected the Linear durableRecord check to follow the GitHub-family branch');
  const upTo = body.slice(guardIdx, linearIdx);
  const branch = upTo.slice(0, upTo.lastIndexOf('}') + 1);
  assert.equal(
    (branch.match(/{/g) || []).length,
    (branch.match(/}/g) || []).length,
    'the sliced GitHub-family branch must be brace-balanced — if this fails the branch was reformatted and this harness needs re-anchoring'
  );
  return branch;
}

/**
 * handleWorkspaceRemoval's real source, sliced by the docstring markers pinned
 * at owner-credential-durable-delete-census.test.js:128,187 and
 * workspace-token-eviction-census.test.js:214,242.
 */
function sliceHandleWorkspaceRemoval() {
  const startMarker = 'async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {';
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find handleWorkspaceRemoval in server.js');
  const endIdx = SERVER_SRC.indexOf('\n/**\n * Attempts to refresh an expired token and retry the request.', startIdx);
  assert.notEqual(endIdx, -1, 'expected the docstring marker that bounds handleWorkspaceRemoval');
  return SERVER_SRC.slice(startIdx, endIdx);
}

const RENDERED_OK = Symbol('rendered');

/**
 * Executes the real GitHub-family branch source against injected collaborators,
 * wired to the real handleWorkspaceRemoval source so a removal decision runs the
 * genuine durable-delete gate rather than a stand-in.
 */
async function runGitHubFamilyBranch({
  provider = 'github',
  remint = async () => {},
  save = async () => {},
  render = async () => RENDERED_OK,
  extraWorkspaces = []
} = {}) {
  const calls = {
    remint: 0,
    save: 0,
    render: 0,
    durableDeletes: [],
    evictions: [],
    removalArgs: null,
    sessionDestroyed: false
  };

  const workspace = { id: 'ws-github', urlKey: 'acme', provider };
  const session = {
    accountId: 'acct-1',
    activeWorkspaceId: 'ws-github',
    workspaces: [workspace, ...extraWorkspaces],
    destroy(cb) {
      calls.sessionDestroyed = true;
      cb(null);
    }
  };

  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    redirect(target) { this.body = `redirect:${target}`; return this; }
  };

  const context = vm.createContext({
    // Real implementations — the removal path's session mutation and the
    // retryable-503 response are genuine, not modelled.
    // LIN-1887 Step 1: handleUnauthorizedError now reads the shared
    // provider-declared refresh strategy instead of asking its own question.
    // These are the REAL implementations — the declaration is exactly what this
    // harness must exercise, not a stand-in for it.
    REFRESH_STRATEGY,
    refreshDeclarationFor,
    relinkNotice,
    normalizeProvider,
    refreshExchangeFor: () => (async () => ({})),
    sendRelinkNotice: (workspace, res) => {
      const notice = relinkNotice(workspace);
      calls.renderErrorPage.push({ title: notice.title, message: notice.message, opts: { action: notice.action, actionUrl: notice.actionUrl } });
      return res.status(401).send(`<error:${notice.title}>`);
    },
    removeWorkspace,
    serviceUnavailable,

    // Faked I/O boundaries, each independently injectable.
    remintActiveCredential: async (...args) => { calls.remint++; return remint(...args); },
    getProviderForWorkspace: () => ({ name: provider }),
    saveSession: async (...args) => { calls.save++; return save(...args); },
    renderDashboardAfterRefresh: async (...args) => { calls.render++; return render(...args); },
    ownerCredentialStore: {
      delete: async (accountId, urlKey) => { calls.durableDeletes.push([accountId, urlKey]); }
    },
    evictWorkspaceTokenPair: (_evict, urlKey, accountId) => { calls.evictions.push([urlKey, accountId]); },
    evictWorkspaceToken: () => {},
    getDeployInfo: () => ({}),
    renderLandingPage: () => '<landing/>',
    isGitHubConfigured: () => true,
    // LIN-1890: this harness evals REAL server.js source, so every free
    // identifier that source references must be declared here. The landing
    // render inside handleWorkspaceRemoval now gates a Jira CTA on this
    // predicate; without the binding the slice throws ReferenceError mid-removal
    // and the preservation assertions fail for a reason unrelated to what they
    // test.
    isJiraOAuthConfigured: () => true,
    process: { env: {} },
    console: { log() {}, error() {} }
  });

  const script = [
    sliceHandleWorkspaceRemoval(),
    '',
    // The branch verbatim, wrapped in the same signature it lives under. The
    // trailing sentinel is what a non-GitHub-family workspace returns by
    // falling through — i.e. reaching the Linear arm this branch must not eat.
    'async function __runBranch(workspace, session, teamId, openRouterSource, res) {',
    // LIN-1887 Step 1: the branch's guard now reads the shared refresh
    // declaration, which handleUnauthorizedError computes once at the top of its
    // body. Recomputed here with the REAL `refreshDeclarationFor` — the slice
    // stays verbatim, and the declaration is a genuine collaborator rather than
    // a hard-coded truthy stand-in, so a wrong declaration still fails this
    // harness.
    '  const declaration = refreshDeclarationFor(workspace);',
    '  const provider = normalizeProvider(workspace);',
    sliceGitHubFamilyBranch(),
    "  return '__FELL_THROUGH_TO_LINEAR__';",
    '}',
    '__runBranch'
  ].join('\n');

  // Record the removal call's arguments without displacing the real function.
  const realRemoval = vm.runInContext(script, context);
  const wrapped = vm.runInContext(
    `(function(orig, calls) {
       const inner = handleWorkspaceRemoval;
       handleWorkspaceRemoval = function(session, workspaceId, res, deleteDurable) {
         calls.removalArgs = { workspaceId, deleteDurable, argCount: arguments.length };
         return inner(session, workspaceId, res, deleteDurable);
       };
       return orig;
     })`,
    context
  )(realRemoval, calls);

  const result = await wrapped(workspace, session, 'team-1', null, res);
  return { result, calls, session, res, workspace };
}

describe('LIN-1503 close-out: GitHub-family 401 branch, executed (ledger rows 3-6)', () => {
  // Ledger row 3 + row 4 — the plan review's F1 finding, the single behavior
  // that finding existed to protect, and the only proof that `await` routes.
  test('row 3/4: a post-remint render failure returns a retryable 503 and PRESERVES the workspace', async () => {
    const renderFailure = Object.assign(new Error('GitHub API rate limit exceeded'), { status: 403 });
    const { result, calls, session, res } = await runGitHubFamilyBranch({
      render: async () => { throw renderFailure; }
    });

    assert.equal(calls.remint, 1, 'the re-mint must have been attempted');
    assert.equal(calls.render, 1, 'the render must have been attempted after a successful re-mint');

    // The rejection landed in catch (renderError), NOT catch (remintError):
    // if the `await` were missing or the try-scoping wrong, this would have
    // been treated as a re-mint failure and removed the workspace.
    assert.equal(calls.removalArgs, null, 'handleWorkspaceRemoval must NEVER be called when the re-mint succeeded and only the render failed');
    assert.deepEqual(calls.durableDeletes, [], 'no durable credential may be deleted on a render failure');
    assert.deepEqual(calls.evictions, [], 'no token eviction may occur on a render failure');

    // The workspace is still on the session — the F1 regression guard, executed.
    assert.equal(session.workspaces.length, 1, 'the workspace must still be on the session');
    assert.equal(session.workspaces[0].id, 'ws-github', 'the preserved workspace must be the same one');
    assert.equal(session.activeWorkspaceId, 'ws-github', 'the workspace must still be the active one');
    assert.equal(calls.sessionDestroyed, false, 'the session must not be destroyed');

    // And the failure is retryable, not terminal — real serviceUnavailable.
    assert.equal(res.statusCode, 503, 'a post-remint render failure must surface as a retryable 503');
    assert.notEqual(result, undefined, 'the branch must return the 503 response, not fall through to the Linear arm');
  });

  // Ledger row 6 — the implementation review's F1 finding: the amendment's own
  // claim, previously proven only by source-text pin plus a reading of
  // handleWorkspaceRemoval:957.
  test('row 6: a re-mint failure removes the workspace but PRESERVES a co-resident Linear durable credential', async () => {
    const linearWorkspace = { id: 'ws-linear', urlKey: 'acme', provider: 'linear' };
    const { calls, session } = await runGitHubFamilyBranch({
      remint: async () => { throw new Error('installation suspended'); },
      extraWorkspaces: [linearWorkspace]
    });

    assert.equal(calls.render, 0, 'the render must not run after a failed re-mint');
    assert.ok(calls.removalArgs, 'a re-mint failure must route to handleWorkspaceRemoval');
    assert.equal(calls.removalArgs.deleteDurable, false, 'deleteDurable must be false — the durable record is keyed per workspace identity (accountId, urlKey), not per binding');

    // The executed consequence of that `false`, which is the actual claim:
    // the durable owner-credential record survives.
    assert.deepEqual(
      calls.durableDeletes,
      [],
      'ownerCredentialStore.delete must NOT be called — a GitHub re-mint failure must not destroy a co-resident Linear durable credential for the same (accountId, urlKey)'
    );

    // The removal itself still happened (accepted behavior, not a regression):
    // the GitHub binding left the session, the Linear one did not.
    assert.equal(calls.removalArgs.workspaceId, 'ws-github');
    assert.deepEqual(session.workspaces.map(w => w.id), ['ws-linear'], 'only the GitHub-family workspace may be removed from the session');
    assert.deepEqual(calls.evictions, [['acme', 'acct-1']], 'the removed workspace\'s cached token must still be evicted');
  });

  // Ledger row 5 — accepted parity with ensureValidToken, previously unobserved
  // and (per the plan review) not written down anywhere. Now it is executed, so
  // the accepted outcome is recorded rather than assumed.
  test('row 5: a saveSession failure AFTER a successful re-mint removes the workspace (accepted parity with ensureValidToken)', async () => {
    const { calls, session } = await runGitHubFamilyBranch({
      save: async () => { throw new Error('session store write failed'); }
    });

    assert.equal(calls.remint, 1, 'the re-mint succeeded before the save failed');
    assert.equal(calls.render, 0, 'the render must not run when the save failed');
    assert.ok(calls.removalArgs, 'a saveSession failure inside the remint try is treated as a remint failure — accepted parity with ensureValidToken, whose try has the same scope');
    assert.equal(calls.removalArgs.deleteDurable, false, 'even on the save-failure path the durable record must survive');
    assert.deepEqual(calls.durableDeletes, [], 'no durable delete on a session-store write failure');
    assert.deepEqual(session.workspaces, [], 'the workspace is removed from the session — this is the accepted, now-observed outcome');
  });

  test('the happy path re-mints, saves, and renders — returning the render result, never the Linear arm', async () => {
    const { result, calls, session, res } = await runGitHubFamilyBranch();

    assert.equal(calls.remint, 1);
    assert.equal(calls.save, 1);
    assert.equal(calls.render, 1);
    assert.equal(calls.removalArgs, null, 'a successful re-mint + render must never remove the workspace');
    assert.equal(result, RENDERED_OK, 'the branch must return the render result');
    assert.equal(res.statusCode, 200, 'no error status on the happy path');
    assert.equal(session.workspaces.length, 1, 'the workspace survives');
  });

  test('github-projects takes the same branch as github', async () => {
    const { result, calls } = await runGitHubFamilyBranch({ provider: 'github-projects' });
    assert.equal(calls.remint, 1, 'github-projects must re-mint too — it was the provider LIN-1499 unmasked into this path');
    assert.equal(result, RENDERED_OK);
  });

  test('a Linear workspace falls THROUGH the branch untouched, reaching the Linear durableRecord arm', async () => {
    const { result, calls, session } = await runGitHubFamilyBranch({ provider: 'linear' });

    assert.equal(result, '__FELL_THROUGH_TO_LINEAR__', 'a Linear workspace must not be captured by the GitHub-family branch');
    assert.equal(calls.remint, 0, 'a Linear workspace must never be re-minted');
    assert.equal(calls.save, 0);
    assert.equal(calls.render, 0);
    assert.equal(calls.removalArgs, null);
    assert.equal(session.workspaces.length, 1, 'the Linear arm is reached with the session untouched');
  });
});
