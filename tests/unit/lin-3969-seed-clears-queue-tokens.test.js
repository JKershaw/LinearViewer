/**
 * LIN-3969 (ruling `lin3969-seed-queue-tokens`): a default local seed starts from known state, with no runner
 * key AND no queue token. Queue tokens live in the shared store and outlast the spec that made them; when the
 * default kept them (LIN-3849), close-out.spec.js's token turned run controls on for the next spec on the same
 * per-worker urlKey, and detail-nonactive-binding's copy-first click timed out. A spec that made a queue token
 * before seeding keeps it only by saying `keepQueueTokens: true`.
 *
 * Witness: the body `seedLocalWorkspace` posts to /test/set-local-session, which routes/test.js hands to
 * seedRunnerKey (`keepQueueTokens` true skips dispatchTokenStore.clear).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';

async function postedBody(options) {
  let body = null;
  const page = {
    request: {
      post: async (url, { data }) => {
        assert.equal(url, '/test/set-local-session');
        body = data;
        return { ok: () => true, json: async () => ({ urlKey: data.urlKey }) };
      },
    },
  };
  await seedLocalWorkspace(page, null, { urlKey: 'local-workspace-w0', ...options });
  return body;
}

describe('LIN-3969 — a default local seed clears queue tokens too', () => {
  test('no options: no runner key, and queue tokens are cleared', async () => {
    const body = await postedBody({});
    assert.equal(body.runnerKey, false);
    assert.equal(body.keepQueueTokens, undefined, 'a default seed must not keep an earlier spec\'s queue token');
  });

  test('runnerKey: true or false clears queue tokens, as before', async () => {
    assert.equal((await postedBody({ runnerKey: true })).keepQueueTokens, undefined);
    assert.equal((await postedBody({ runnerKey: false })).keepQueueTokens, undefined);
  });

  test('keepQueueTokens: true keeps them, with or without a runner key', async () => {
    assert.equal((await postedBody({ keepQueueTokens: true })).keepQueueTokens, true);
    assert.equal((await postedBody({ runnerKey: true, keepQueueTokens: true })).keepQueueTokens, true);
  });
});
