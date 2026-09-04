// LIN-1885 (Phase 1 of LIN-275), beat 3: the non-destructive Jira 401/403
// branch — the defect class LIN-1503 closed for the GitHub family
// (`tests/unit/lin-1503-github-family-401-remint-behaviour.test.js`), applied
// here to Jira, which research explicitly flagged as needing the SAME reuse:
// "write a Jira variant of the vm harness instead ... Mutation-verify it,"
// and named the pin-only sibling
// (`lin-1503-github-family-401-remint.test.js`) as "precisely the artefact
// LIN-1503's review rejected three weeks ago, for the same defect class at
// the same function."
//
// So this file does NOT settle for a source-text pin. It slices the REAL
// `handleUnauthorizedError` body out of server.js (which is not import-safe
// in a unit test — it connects to Mongo and calls app.listen() at module
// load, the same constraint the LIN-1503 harness documents) by the same
// docstring-marker convention, and EXECUTES it in a `node:vm` context with
// every collaborator injected — `removeWorkspace` and `serviceUnavailable`
// are the REAL implementations (imported normally), so a removal decision
// runs the genuine durable-delete gate rather than a stand-in. Only the I/O
// boundaries (remint, session save/destroy, render, durable store, eviction)
// are faked, each independently injectable so a fault can be introduced at
// any one of them.
//
// Unlike the GitHub-family harness (which slices ONLY the github-family `if`
// block), this executes the WHOLE `handleUnauthorizedError` body so the SAME
// harness can drive every branch (isPAT / jira / github-family / Linear) off
// the same real source and prove they don't interfere with each other — the
// direct proof that inserting the Jira branch before the github-family guard
// did not widen or shrink any neighbour's slice (LIN-1885 research finding 2).

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

/** The full body of handleUnauthorizedError, sliced by its docstring bounds. */
function sliceHandleUnauthorizedErrorBody(source = SERVER_SRC) {
  const startMarker = 'async function handleUnauthorizedError(workspace, session, teamId, assigneeState, openRouterSource, res) {';
  const startIdx = source.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find handleUnauthorizedError in server.js');
  const endIdx = source.indexOf('\n/**\n * Home page', startIdx);
  assert.notEqual(endIdx, -1, 'expected the "Home page" docstring marker that bounds handleUnauthorizedError');
  return source.slice(startIdx, endIdx);
}

/** handleWorkspaceRemoval's real source, sliced by its docstring bounds (same markers the LIN-1503 harness uses). */
function sliceHandleWorkspaceRemoval(source = SERVER_SRC) {
  const startMarker = 'async function handleWorkspaceRemoval(session, workspaceId, res, deleteDurable = true) {';
  const startIdx = source.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find handleWorkspaceRemoval in server.js');
  const endIdx = source.indexOf('\n/**\n * Attempts to refresh an expired token and retry the request.', startIdx);
  assert.notEqual(endIdx, -1, 'expected the docstring marker that bounds handleWorkspaceRemoval');
  return source.slice(startIdx, endIdx);
}

// LIN-1887 Step 1 RE-ANCHORED these two markers. The github-family guard is no
// longer spelled out as a pair of provider names — it is the shared declared
// strategy. And there is no longer a Jira `if` block at all: the guarantee this
// file exists to pin (a dead Jira credential never removes the workspace) moved
// from a hard-coded `provider === 'jira'` branch to the provider's DECLARATION
// plus the non-destructive terminal every such provider reaches. The behavioural
// assertions below are unchanged and still pass, which is the point — the
// guarantee survived the generalisation.
const NON_DESTRUCTIVE_TERMINAL = "if (!declaration.destructiveOnFailure) {\n    return sendRelinkNotice(workspace, res);\n  }\n  return handleWorkspaceRemoval(session, workspace.id, res);";
const GITHUB_FAMILY_GUARD = "if (declaration.strategy === REFRESH_STRATEGY.REMINT) {";

/**
 * The non-destructive terminal a Basic-auth Jira 401 now lands on — the
 * successor to Phase 1's Jira `if` block, and the unit the mutation-check
 * harness below breaks. Sliced from the body, not raw SERVER_SRC, for the same
 * defensive-anchoring discipline as before.
 */
function sliceJiraBranch(source = SERVER_SRC) {
  const body = sliceHandleUnauthorizedErrorBody(source);
  const guardIdx = body.indexOf(NON_DESTRUCTIVE_TERMINAL);
  assert.notEqual(guardIdx, -1, 'expected the non-destructive terminal inside handleUnauthorizedError');
  const upTo = body.slice(guardIdx, guardIdx + NON_DESTRUCTIVE_TERMINAL.length);
  const branch = upTo.slice(0, upTo.lastIndexOf('}') + 1);
  assert.equal(
    (branch.match(/{/g) || []).length,
    (branch.match(/}/g) || []).length,
    'the sliced Jira branch must be brace-balanced — if this fails the branch was reformatted and this harness needs re-anchoring'
  );
  return branch;
}

/** Just the `{ ... }` interior of handleUnauthorizedError's body — what gets re-wrapped under a fresh function name/signature for vm execution. */
function handleUnauthorizedErrorInnerBody(source = SERVER_SRC) {
  const body = sliceHandleUnauthorizedErrorBody(source);
  const openIdx = body.indexOf('{');
  const closeIdx = body.lastIndexOf('}');
  assert.ok(openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx, 'expected a balanced { ... } body');
  return body.slice(openIdx + 1, closeIdx);
}

const RENDERED_OK = Symbol('rendered');

/**
 * Executes the REAL, FULL handleUnauthorizedError body (every branch: isPAT,
 * jira, github-family, Linear) against injected collaborators, wired to the
 * real handleWorkspaceRemoval source exactly like the LIN-1503 harness.
 * `source` lets the mutation-check tests substitute a deliberately-broken
 * copy of SERVER_SRC while every other harness plumbing stays identical.
 */
async function runHandleUnauthorizedError({
  workspace,
  extraWorkspaces = [],
  durableRecord = null,
  remint = async () => {},
  save = async () => {},
  render = async () => RENDERED_OK,
  tokenRefreshAndRetry = async () => RENDERED_OK,
  isDefinitiveRevocationResult = false,
  source = SERVER_SRC
} = {}) {
  const calls = {
    renderErrorPage: [],
    remint: 0,
    save: 0,
    render: 0,
    tokenRefreshAndRetry: 0,
    durableDeletes: [],
    durableGets: 0,
    durableGetProviders: [],
    evictions: [],
    evictAllWorkspaceTokensCalls: 0,
    removalArgs: null,
    sessionDestroyed: false
  };

  const session = {
    accountId: 'acct-1',
    activeWorkspaceId: workspace.id,
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
    renderErrorPage: (title, message, opts) => { calls.renderErrorPage.push({ title, message, opts }); return `<error:${title}>`; },
    evictAllWorkspaceTokens: (_evict, workspaces, accountId) => { calls.evictAllWorkspaceTokensCalls++; calls.evictions.push(['ALL', accountId, workspaces.map(w => w.id)]); },
    evictWorkspaceToken: () => {},
    evictWorkspaceTokenPair: (_evict, urlKey, accountId) => { calls.evictions.push([urlKey, accountId]); },
    remintActiveCredential: async (...args) => { calls.remint++; return remint(...args); },
    getProviderForWorkspace: () => ({ name: workspace.provider }),
    saveSession: async (...args) => { calls.save++; return save(...args); },
    renderDashboardAfterRefresh: async (...args) => { calls.render++; return render(...args); },
    handleTokenRefreshAndRetry: async (...args) => { calls.tokenRefreshAndRetry++; return tokenRefreshAndRetry(...args); },
    isDefinitiveRevocation: () => isDefinitiveRevocationResult,
    ownerCredentialStore: {
      get: async (_a, _u, provider) => { calls.durableGets++; calls.durableGetProviders.push(provider); return durableRecord; },
      delete: async (accountId, urlKey, provider) => { calls.durableDeletes.push([accountId, urlKey, provider]); },
      deleteAll: async (accountId, urlKey) => { calls.durableDeletes.push([accountId, urlKey, 'ALL']); }
    },
    getDeployInfo: () => ({}),
    renderLandingPage: () => '<landing/>',
    // LIN-2010: this harness evals REAL server.js source, so every free
    // identifier that source references must be declared here. The landing
    // render inside handleWorkspaceRemoval now reads GitHub/Jira configured-ness
    // through the provider registry (`getProvider(name).entryCta.isConfigured()`)
    // rather than the standalone isGitHubConfigured()/isJiraOAuthConfigured()
    // predicates this stub used to fake directly; without this binding the slice
    // throws ReferenceError mid-removal and the preservation assertions fail for
    // a reason unrelated to what they test.
    getProvider: () => ({ entryCta: { isConfigured: () => true } }),
    process: { env: {} },
    console: { log() {}, error() {} }
  });

  const script = [
    sliceHandleWorkspaceRemoval(source),
    '',
    'async function __runFull(workspace, session, teamId, assigneeState, openRouterSource, res) {',
    handleUnauthorizedErrorInnerBody(source),
    '}',
    '__runFull'
  ].join('\n');

  const realFn = vm.runInContext(script, context);
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
  )(realFn, calls);

  const result = await wrapped(workspace, session, 'team-1', { selectedAssignee: 'all', resolvedAssigneeName: null }, null, res);
  return { result, calls, session, res, workspace };
}

describe('LIN-1885: Jira 401/403 does not destroy the workspace (executed, not just source-pinned)', () => {
  test('renders an actionable "invalid, re-link" 401 page and returns — no refresh, no removal, no eviction, no session.destroy', async () => {
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    const { result, calls, session, res } = await runHandleUnauthorizedError({ workspace });

    // 1. No handleTokenRefreshAndRetry.
    assert.equal(calls.tokenRefreshAndRetry, 0, 'must never attempt a token refresh — a Jira API token has no refresh mechanism');
    // 2. No handleWorkspaceRemoval.
    assert.equal(calls.removalArgs, null, 'must never call handleWorkspaceRemoval');
    // 3. No credential deletion.
    assert.deepEqual(calls.durableDeletes, [], 'must never delete a durable credential');
    // 4. No eviction (neither the PAT-style evictAll nor a per-workspace evictWorkspaceTokenPair).
    assert.equal(calls.evictAllWorkspaceTokensCalls, 0, 'must never call evictAllWorkspaceTokens');
    assert.deepEqual(calls.evictions, [], 'must never evict any cached token');
    // 5. No session.destroy().
    assert.equal(calls.sessionDestroyed, false, 'must never destroy the session');

    // The workspace and session survive intact.
    assert.equal(session.workspaces.length, 1, 'the workspace must still be on the session');
    assert.equal(session.workspaces[0].id, 'ws-jira');
    assert.equal(session.activeWorkspaceId, 'ws-jira');

    // An actionable page was actually rendered, not a silent no-op.
    assert.equal(calls.renderErrorPage.length, 1);
    assert.equal(calls.renderErrorPage[0].title, 'Access Token Invalid');
    assert.match(calls.renderErrorPage[0].opts.actionUrl, /^\/auth\/jira\?workspace=acme$/, 'the action link must point at the re-link form, not a dead end');
    assert.equal(res.statusCode, 401);
    assert.notEqual(result, undefined, 'the branch must return the rendered response, not fall through to a later arm');
  });

  test('a co-resident Linear workspace on the same session is completely untouched', async () => {
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    const linearWorkspace = { id: 'ws-linear', urlKey: 'other', provider: 'linear' };
    const { calls, session } = await runHandleUnauthorizedError({ workspace, extraWorkspaces: [linearWorkspace] });

    assert.deepEqual(session.workspaces.map(w => w.id), ['ws-jira', 'ws-linear'], 'both workspaces survive, in place');
    // LIN-1887: a Jira 401 now DOES perform one durable read — Step 7 needs it
    // to tell an OAuth binding (refreshable) from a Basic one (not). What must
    // never happen is that read touching LINEAR's partition, which the
    // provider-scoped `get` makes structurally impossible.
    assert.deepEqual(calls.durableGetProviders, ['jira'], 'the read must be jira-partitioned — never Linear’s');
  });

  test('regression: isPAT is unaffected by the new branch (still destroys the session, unlike Jira)', async () => {
    const workspace = { id: 'ws-pat', urlKey: 'acme', provider: 'linear', isPAT: true };
    const { calls, res } = await runHandleUnauthorizedError({ workspace });

    assert.equal(calls.evictAllWorkspaceTokensCalls, 1, 'PAT must still evict every workspace token — unchanged');
    assert.equal(calls.sessionDestroyed, true, 'PAT must still destroy the session — unchanged (this is what makes Jira NOT reusing isPAT a deliberate choice, not an oversight)');
    assert.equal(res.statusCode, 401);
  });

  test('regression: github-family is unaffected by the new branch (still re-mints, never renders the Jira/PAT page)', async () => {
    const workspace = { id: 'ws-gh', urlKey: 'acme', provider: 'github' };
    const { calls, result } = await runHandleUnauthorizedError({ workspace });

    assert.equal(calls.remint, 1, 'github-family must still re-mint — unchanged');
    assert.equal(calls.render, 1, 'github-family must still render the dashboard on success — unchanged');
    assert.equal(calls.renderErrorPage.length, 0, 'github-family must never hit the Jira/PAT renderErrorPage path');
    assert.equal(result, RENDERED_OK);
  });

  test('regression: a Linear workspace with a durable refresh record still refreshes (falls through Jira/github-family untouched)', async () => {
    const workspace = { id: 'ws-lin', urlKey: 'acme', provider: 'linear' };
    const { calls, result } = await runHandleUnauthorizedError({
      workspace, durableRecord: { refreshToken: 'rt-1' }
    });

    assert.equal(calls.durableGets, 1);
    assert.equal(calls.tokenRefreshAndRetry, 1, 'a Linear workspace with a refresh token must still attempt refresh — unchanged');
    assert.equal(calls.renderErrorPage.length, 0);
    assert.equal(result, RENDERED_OK);
  });

  test('regression: a Linear workspace with NO durable record still falls to the destructive removal fallthrough (unchanged, accepted behavior)', async () => {
    const workspace = { id: 'ws-lin', urlKey: 'acme', provider: 'linear' };
    const { calls } = await runHandleUnauthorizedError({ workspace, durableRecord: null });

    assert.ok(calls.removalArgs, 'a genuinely disconnected Linear workspace must still be removed — this fallthrough is what the Jira branch exists to keep Jira OUT of, not to remove for everyone');
    assert.equal(calls.removalArgs.workspaceId, 'ws-lin');
  });
});

// =============================================================================
// Mutation-check: deliberately break the Jira branch, prove each preservation
// assertion above actually fails against the broken version, then implicitly
// "restore" by never touching the real file — each test builds its own
// mutated SOURCE STRING from a fresh read of SERVER_SRC and feeds it through
// the SAME harness via the `source` override, so the on-disk server.js is
// never modified by the test run itself.
// =============================================================================

describe('LIN-1885 mutation-check: each preservation assertion must actually catch its own removal', () => {
  function mutate(replacer) {
    const body = sliceHandleUnauthorizedErrorBody();
    const branch = sliceJiraBranch();
    const mutatedBranch = replacer(branch);
    assert.notEqual(mutatedBranch, branch, 'the mutation must actually change the branch text');
    const mutatedBody = body.replace(branch, mutatedBranch);
    assert.notEqual(mutatedBody, body, 'the mutated body must differ from the original');
    return SERVER_SRC.replace(body, mutatedBody);
  }

  test('mutation 1: route the Jira branch through handleTokenRefreshAndRetry — caught by the "no refresh" assertion', async () => {
    const mutatedSource = mutate(branch =>
      branch.replace(
        "return sendRelinkNotice(workspace, res);",
        "return handleTokenRefreshAndRetry(workspace, session, teamId, openRouterSource, res);"
      )
    );
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    const { calls } = await runHandleUnauthorizedError({ workspace, source: mutatedSource });
    assert.notEqual(calls.tokenRefreshAndRetry, 0, 'sanity: the mutation must actually invoke the refresh path');
    assert.throws(() => assert.equal(calls.tokenRefreshAndRetry, 0));
  });

  test('mutation 2: route the Jira branch through handleWorkspaceRemoval — caught by the "no removal" assertion', async () => {
    const mutatedSource = mutate(branch =>
      branch.replace(
        "return sendRelinkNotice(workspace, res);",
        "return handleWorkspaceRemoval(session, workspace.id, res);"
      )
    );
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    const { calls } = await runHandleUnauthorizedError({ workspace, source: mutatedSource });
    assert.ok(calls.removalArgs, 'sanity: the mutation must actually invoke removal');
    assert.throws(() => assert.equal(calls.removalArgs, null));
  });

  test('mutation 3: delete the durable credential before rendering — caught by the "no credential deletion" assertion', async () => {
    const mutatedSource = mutate(branch =>
      branch.replace(
        "if (!declaration.destructiveOnFailure) {",
        "if (!declaration.destructiveOnFailure) {\n    await ownerCredentialStore.delete(session.accountId, workspace.urlKey, provider);"
      )
    );
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    const { calls } = await runHandleUnauthorizedError({ workspace, source: mutatedSource });
    assert.deepEqual(calls.durableDeletes, [['acct-1', 'acme', 'jira']], 'sanity: the mutation must actually delete');
    assert.throws(() => assert.deepEqual(calls.durableDeletes, []));
  });

  test('mutation 4: evict tokens before rendering (isPAT-style) — caught by the "no eviction" assertion', async () => {
    const mutatedSource = mutate(branch =>
      branch.replace(
        "if (!declaration.destructiveOnFailure) {",
        "if (!declaration.destructiveOnFailure) {\n    evictAllWorkspaceTokens(evictWorkspaceToken, session.workspaces, session.accountId);"
      )
    );
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    const { calls } = await runHandleUnauthorizedError({ workspace, source: mutatedSource });
    assert.equal(calls.evictAllWorkspaceTokensCalls, 1, 'sanity: the mutation must actually evict');
    assert.throws(() => assert.equal(calls.evictAllWorkspaceTokensCalls, 0));
  });

  test('mutation 5: destroy the session before rendering (isPAT-style) — caught by the "no session.destroy" assertion', async () => {
    const mutatedSource = mutate(branch =>
      branch.replace(
        "if (!declaration.destructiveOnFailure) {",
        "if (!declaration.destructiveOnFailure) {\n    session.destroy(() => {});"
      )
    );
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    const { calls } = await runHandleUnauthorizedError({ workspace, source: mutatedSource });
    assert.equal(calls.sessionDestroyed, true, 'sanity: the mutation must actually destroy the session');
    assert.throws(() => assert.equal(calls.sessionDestroyed, false));
  });

  test('mutation 6: drop the Jira branch entirely (workspace falls through) — caught by the workspace-preservation / no-removal assertions', async () => {
    const mutatedSource = mutate(() => '// jira branch removed entirely');
    const workspace = { id: 'ws-jira', urlKey: 'acme', provider: 'jira' };
    // With the branch gone and no durable record, a Jira workspace now falls
    // all the way through to the destructive fallthrough — the exact
    // regression this whole ticket exists to prevent.
    const { calls } = await runHandleUnauthorizedError({ workspace, source: mutatedSource, durableRecord: null });
    assert.ok(calls.removalArgs, 'sanity: with the branch dropped, the workspace IS destructively removed');
    assert.throws(() => assert.equal(calls.removalArgs, null));
  });
});
