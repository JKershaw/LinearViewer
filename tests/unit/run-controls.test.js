// LIN-3849: run controls = owner AND a live runner key / queue token. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunControlsResolver, hasLiveRunnerKey, hasLiveQueueToken,
  setRunControlsResolver, requestFeatureFlags
} from '../../lib/run-controls.js';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const iso = (d) => new Date(NOW + d).toISOString();
const runner = (o = {}) => ({ grants: ['take', 'dispatch'], consumed: false, expiresAt: iso(60000), ...o });
const ws = { id: 'w1', urlKey: 'acme' };

function make({ owner = 'owner', proxy = [], queue = [], proxyThrows = false } = {}) {
  return createRunControlsResolver({
    ownerCheck: async () => (owner === 'throw' ? Promise.reject(new Error('x')) : { status: owner }),
    proxyTokenStore: { listTokens: async () => { if (proxyThrows) throw new Error('down'); return proxy; } },
    dispatchTokenStore: { listTokens: async () => queue },
    now: () => NOW
  });
}
const run = (r, accountId = 'a1') => r({ workspace: ws, accountId });

test('owner with a live runner key gets run controls', async () => {
  assert.deepEqual(await run(make({ proxy: [runner()] })), { runControls: true, runSetup: false });
});
test('member gets neither, and the stores are not read', async () => {
  assert.deepEqual(await run(make({ owner: 'not-owner', proxy: [runner()] })), { runControls: false, runSetup: false });
});
test('owner with no key gets the set-up rung only', async () => {
  assert.deepEqual(await run(make()), { runControls: false, runSetup: true });
});
test('expired runner key / expired queue token do not count', async () => {
  assert.equal((await run(make({ proxy: [runner({ expiresAt: iso(0) })] }))).runControls, false);
  assert.equal((await run(make({ queue: [{ expiresAt: iso(-1) }] }))).runControls, false);
  assert.equal((await run(make({ proxy: [runner({ expiresAt: iso(1) })] }))).runControls, true);
});
test('legacy null-expiry queue token counts', async () => {
  assert.equal((await run(make({ queue: [{ expiresAt: null }] }))).runControls, true);
});
test('driver/agent copies and consumed bootstraps are not runner keys', () => {
  assert.equal(hasLiveRunnerKey([runner({ grants: ['dispatch'] })], NOW), false);
  assert.equal(hasLiveRunnerKey([runner({ consumed: true })], NOW), false);
  assert.equal(hasLiveQueueToken([], NOW), false);
});
test('fails closed: owner throw, no-owner, anonymous, store throw', async () => {
  const closed = { runControls: false, runSetup: false };
  assert.deepEqual(await run(make({ owner: 'throw', proxy: [runner()] })), closed);
  assert.deepEqual(await run(make({ owner: 'no-owner', proxy: [runner()] })), closed);
  assert.deepEqual(await run(make({ proxy: [runner()] }), null), closed);
  assert.equal((await run(make({ proxyThrows: true }))).runControls, false);
});
test('requestFeatureFlags memoises per request, not per workspace', async () => {
  let calls = 0;
  setRunControlsResolver(async ({ accountId }) => { calls++; return { runControls: accountId === 'o', runSetup: false }; });
  const owner = { workspace: ws, session: { accountId: 'o' } };
  const member = { workspace: ws, session: { accountId: 'm' } };
  assert.equal((await requestFeatureFlags(owner)).runControls, true);
  assert.equal((await requestFeatureFlags(owner)).runControls, true);
  assert.equal((await requestFeatureFlags(member)).runControls, false);
  assert.equal(calls, 2);
  setRunControlsResolver(null);
  assert.equal((await requestFeatureFlags({ workspace: ws, session: {} })).runControls, false);
});
