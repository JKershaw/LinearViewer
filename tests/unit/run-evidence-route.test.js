// Route tests for GET /workspace/:urlKey/api/run-evidence/:issueIdentifier
// (LIN-3247, P2 of LIN-2949).
//
// Run with: node --test tests/unit/run-evidence-route.test.js
//
// Mounts the REAL router with an injected provider + fail-open PR reader, so
// this exercises the actual handler: PR-URL extraction from tracker comments
// (any repo — LIN-3333 retired the allowlist filter), and the zero / one /
// many / unreadable derivation.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';

const PATH = '/workspace/:urlKey/api/run-evidence/:issueIdentifier';
const PR_A = 'https://github.com/acme/widget/pull/12';

before(() => { process.env.NODE_ENV = 'test'; });

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeProvider({ comments = [] } = {}) {
  return {
    async fetchIssueComments() { return comments; },
  };
}

function makeRouter({ comments = [], readPrStatus = null, owner = true } = {}) {
  return createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    runEvidence: {
      resolveProvider: () => ({ provider: fakeProvider({ comments }), callScope: 'scope' }),
      viewerIsOwner: () => owner,
      readPrStatus: readPrStatus || (async () => ({ readable: false, state: 'unknown', reason: 'stub' })),
    },
  });
}

async function callRoute(router) {
  const handler = getHandler(router, 'get', PATH);
  const req = { session: {}, workspace: { urlKey: 'ws', accessToken: 't' }, params: { urlKey: 'ws', issueIdentifier: 'LIN-1' }, query: {} };
  const res = {
    statusCode: 200, jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

const comment = (body, createdAt) => ({ body, createdAt, user: 'reviewer' });
const reviewBody = '## Review\n\n### What CI Did Not Prove\n- one claim\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**';

describe('GET /api/run-evidence/:issueIdentifier', () => {
  test('one open PR in the comments → ready, with the contracted response shape', async () => {
    const res = await callRoute(makeRouter({
      comments: [comment(`opened ${PR_A}`, '2026-07-01T00:00:00.000Z'), comment(reviewBody, '2026-07-02T00:00:00.000Z')],
      readPrStatus: async () => ({ readable: true, repo: 'acme/widget', number: 12, state: 'open', merged: false, head: { ref: 'f', sha: 'abc1234' }, ref: 'abc1234', checks: [{ name: 'unit', conclusion: 'success' }] }),
    }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.jsonBody).sort(), ['closeOut', 'evidence', 'ledger', 'state']);
    assert.equal(res.jsonBody.state.status, 'ready');
    assert.equal(res.jsonBody.state.pr.number, 12);
    assert.equal(res.jsonBody.evidence.checked.now.state, 'passing');
    assert.equal(res.jsonBody.ledger.verdict, 'approve-conditional');
  });

  test('zero PR URLs → no-pr (withholds)', async () => {
    const res = await callRoute(makeRouter({ comments: [comment('no PR here', '2026-07-01T00:00:00.000Z')] }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'no-pr');
  });

  test('more than one PR URL → multiple-prs (withholds, says what is known)', async () => {
    const PR_A2 = 'https://github.com/acme/widget/pull/13';
    const res = await callRoute(makeRouter({ comments: [comment(`${PR_A} and ${PR_A2}`, '2026-07-01T00:00:00.000Z')] }));
    assert.equal(res.jsonBody.state.status, 'multiple-prs');
    assert.match(res.jsonBody.state.message, /more than one PR/);
  });

  test('an unreadable PR read → unknown, never a 500', async () => {
    const res = await callRoute(makeRouter({
      comments: [comment(PR_A, '2026-07-01T00:00:00.000Z')],
      readPrStatus: async () => ({ readable: false, state: 'unknown', reason: 'not readable: private or unknown repository' }),
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state.status, 'unknown');
    assert.equal(res.jsonBody.evidence.checked.now.state, 'unknown');
  });

  test('a PR for any repo is accepted — the workspace allowlist is gone (LIN-3333)', async () => {
    const PR_FOREIGN = 'https://github.com/acme/other/pull/12';
    const res = await callRoute(makeRouter({
      comments: [comment(PR_FOREIGN, '2026-07-01T00:00:00.000Z')],
      readPrStatus: async () => ({ readable: true, repo: 'acme/other', number: 12, state: 'open', merged: false, head: { ref: 'f', sha: 'abc1234' }, ref: 'abc1234', checks: [] }),
    }));
    assert.equal(res.jsonBody.state.status, 'ready');
    assert.equal(res.jsonBody.state.pr.repo, 'acme/other');
  });

  test('a non-owner viewer gets closeOut.owner=false (the box will be omitted)', async () => {
    const res = await callRoute(makeRouter({ owner: false }));
    assert.equal(res.jsonBody.closeOut.owner, false);
  });
});
