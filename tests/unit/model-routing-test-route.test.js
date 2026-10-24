/**
 * LIN-3853: /test/set-workspace-model seeds and resets through the model-routing store.
 * It is the only thing keeping the e2e specs independent once the store is the source of
 * truth: a seed that wrote the old preference field would be ignored after migration, and
 * a reset that left the table would leak one spec's routing into the next.
 *
 * Run with: node --test tests/unit/model-routing-test-route.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRoutes } from '../../routes/test.js';
import { resolveAiOperationModel, resolveWorkspaceModel } from '../../lib/workspace-preferences.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';
import { routingFixture } from './helpers/routing-fakes.js';

const URL_KEY = 'e2e-ws';
const NON_DEFAULT = 'anthropic/claude-sonnet-4';

function handlerOf(router) {
  const layer = router.stack.find((l) => l.route?.path === '/test/set-workspace-model' && l.route.methods.get);
  assert.ok(layer, 'route registered');
  return layer.route.stack.at(-1).handle;
}
const call = async (handler, query) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
  await handler({ query }, res);
  return res;
};

describe('/test/set-workspace-model through the routing store', () => {
  let fx, handler;
  beforeEach(() => {
    fx = routingFixture();
    handler = handlerOf(createTestRoutes({ workspacePreferencesStore: fx.preferencesStore, modelRoutingStore: fx.routingStore }));
  });
  const resolve = (opKind) => resolveAiOperationModel({ urlKey: URL_KEY, workspacePreferencesStore: fx.preferencesStore, opKind });

  test('seeding a model makes every Harbour job resolve to it (what prefs.modelId meant)', async () => {
    await fx.prefs.insertOne({ _id: URL_KEY, preferences: {} });
    await resolve('recommend'); // the workspace has already migrated
    assert.equal((await call(handler, { urlKey: URL_KEY, modelId: NON_DEFAULT })).body, 'ok');
    for (const opKind of ['recommend', 'roadmap', 'feedback-title', 'observer-pass']) assert.equal(await resolve(opKind), NON_DEFAULT, opKind);
    assert.equal(await resolveWorkspaceModel({ urlKey: URL_KEY, workspacePreferencesStore: fx.preferencesStore }), NON_DEFAULT);
    assert.equal((await fx.routingStore.getLog(URL_KEY)).length, 1);
  });

  test('a reset (no modelId) clears the table, log and presets, and the very next resolve sees it', async () => {
    await call(handler, { urlKey: URL_KEY, modelId: NON_DEFAULT });
    await fx.routingStore.changeJob('review', { model: 'x' }, { urlKey: URL_KEY, reason: 'r', actor: { via: 'page' } });
    await fx.routingStore.savePreset('p', { urlKey: URL_KEY, reason: 'r', actor: { via: 'page' } });
    assert.equal(await resolve('recommend'), NON_DEFAULT);

    assert.equal((await call(handler, { urlKey: URL_KEY })).body, 'ok');
    assert.equal(await resolve('recommend'), DEFAULT_MODEL);
    assert.deepEqual([await fx.routingStore.getLog(URL_KEY), await fx.routingStore.listPresets(URL_KEY)], [[], []]);
    assert.equal(fx.collections.routing._docs.filter((d) => d._id === URL_KEY).length, 1, 'only the fresh migration remains');
  });

  test('a reset also takes the old preferences doc, as before', async () => {
    await fx.prefs.insertOne({ _id: URL_KEY, preferences: { modelId: 'anthropic/legacy' } });
    assert.equal(await resolve('recommend'), 'anthropic/legacy');
    await call(handler, { urlKey: URL_KEY });
    assert.equal(await resolve('recommend'), DEFAULT_MODEL);
    assert.equal(fx.prefs._docs.length, 0);
  });
});
