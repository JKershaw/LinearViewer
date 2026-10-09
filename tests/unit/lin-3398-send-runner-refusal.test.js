/**
 * LIN-3398 / LIN-3408: sendRunnerRefusal is the one responder for a runner
 * owner refusal. It sends exactly the {error, code, category, retryable}
 * envelope at the refusal's own status, and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRunnerOwnerRefusal, sendRunnerRefusal } from '../../lib/runner-owner-gate.js';

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function quiet(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = orig; }
}

test('not-owner refusal: 403 + envelope with the RUNNER_OWNER_ONLY copy', async () => {
  const refusal = await resolveRunnerOwnerRefusal({
    ownerCheck: async () => ({ status: 'not-owner' }), workspaceId: 'w1', accountId: 'a1', target: 'cli'
  });
  const res = fakeRes();
  await quiet(() => sendRunnerRefusal(res, refusal));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    error: "Only this workspace's owner can act on its runner.",
    code: 'RUNNER_OWNER_ONLY',
    category: 'auth',
    retryable: false
  });
});

test('fail-closed refusals keep their own status and retryable flag', async () => {
  const refusal = await resolveRunnerOwnerRefusal({ ownerCheck: null, workspaceId: 'w1', accountId: 'a1', target: 'cli' });
  const res = fakeRes();
  await quiet(() => sendRunnerRefusal(res, refusal));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
  assert.equal(res.body.retryable, true);
});

test('logs the code once and never the row/extra fields', async () => {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    const res = fakeRes();
    sendRunnerRefusal(res, { code: 'RUNNER_OWNER_ONLY', status: 403, category: 'auth', retryable: false, error: 'x', bootstrapToken: 'SECRET' });
    assert.deepEqual(Object.keys(res.body).sort(), ['category', 'code', 'error', 'retryable']);
  } finally { console.warn = orig; }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /RUNNER_OWNER_ONLY/);
  assert.doesNotMatch(lines[0], /SECRET/);
});
