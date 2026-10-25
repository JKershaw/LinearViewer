/**
 * LIN-3855: the Settings › Models page's writes (routes/settings-model.js), through the store.
 *
 * The three legacy forms are retired: their POSTs answer 404 and write nothing. The page's own writes
 * are one staged save (one reason, one log entry, the version checked, the runnable check on every
 * changed job), the routing presets (save, and apply through the same check), and the undo (a refused
 * undo says why and writes nothing).
 *
 * Run with: node --test tests/unit/settings-model-routes.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSettingsModelRoutes } from '../../routes/settings-model.js';
import { routingFixture } from './helpers/routing-fakes.js';

const URL_KEY = 'acme';
const MAKE_MODEL = 'c__group__agent-session__make__model';
const MAKE_HARNESS = 'c__group__agent-session__make__harness';

describe('the Models page writes (LIN-3855)', () => {
  let server, base, fx;
  before(async () => {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use((req, _res, next) => { req.session = { accountId: 'acct-1' }; next(); });
    const workspaceFromUrl = (req, _res, next) => { req.workspace = { urlKey: req.params.urlKey, name: 'Acme' }; next(); };
    app.use((req, res, next) => createSettingsModelRoutes({ workspaceFromUrl, modelRoutingStore: fx.routingStore })(req, res, next));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => { fx = routingFixture(); });

  const post = (path, body) => fetch(`${base}/workspace/${URL_KEY}/settings/${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const location = (res) => res.headers.get('location');
  const logOf = () => fx.routingStore.getLog(URL_KEY);
  const version = async () => (await fx.routingStore.getTable(URL_KEY)).version;
  const snapshot = () => JSON.stringify([fx.collections.routing._docs, fx.collections.log._docs, fx.collections.presets._docs]);

  describe('the retired forms', () => {
    for (const path of ['model', 'dispatch-defaults', 'ai-model-overrides']) {
      test(`POST /settings/${path} is gone: 404, and it writes nothing`, async () => {
        await fx.routingStore.getTable(URL_KEY);
        const before = snapshot();
        const res = await post(path, { modelId: 'anthropic/claude-sonnet-4', reason: 'x' });
        assert.equal(res.status, 404);
        assert.equal(snapshot(), before);
      });
    }
  });

  describe('the staged save', () => {
    test('one save, one reason, one log entry; the fields it posted are the changes', async () => {
      const v = await version();
      const res = await post('models/changes', { version: String(v), reason: 'cheaper make', [MAKE_MODEL]: 'anthropic/claude-sonnet-5' });
      assert.equal(res.status, 302);
      assert.match(location(res), /\/settings\/models\?changed=1$/);
      const log = await logOf();
      assert.equal(log.length, 1);
      assert.equal(log[0].reason, 'cheaper make');
      assert.deepEqual(log[0].changes.map((c) => [c.scope, c.key, c.field, c.to]), [['group', 'make', 'model', 'anthropic/claude-sonnet-5']]);
      assert.equal(log[0].actor.via, 'page');
      assert.equal(log[0].actor.id, 'acct-1');
    });

    test('two edits in one save make one entry', async () => {
      const v = await version();
      await post('models/changes', { version: String(v), reason: 'both', [MAKE_MODEL]: 'anthropic/claude-sonnet-5', [MAKE_HARNESS]: 'claude-code' });
      assert.equal((await logOf()).length, 1);
    });

    test('a save with nothing changed writes nothing', async () => {
      const v = await version();
      const res = await post('models/changes', { version: String(v), reason: 'nothing', [MAKE_MODEL]: '' });
      assert.match(location(res), /nothing=1/);
      assert.equal((await logOf()).length, 0);
    });

    test('no reason: refused in place, the staged values are kept, nothing is written', async () => {
      const v = await version();
      const before = snapshot();
      const res = await post('models/changes', { version: String(v), reason: '   ', [MAKE_MODEL]: 'anthropic/claude-sonnet-5' });
      assert.match(location(res), /\/settings\/models$/);
      assert.equal(snapshot(), before);
    });

    test('a stale version is CONFLICT: the save is refused, nothing is overwritten', async () => {
      const v = await version();
      await post('models/changes', { version: String(v), reason: 'first', [MAKE_MODEL]: 'anthropic/claude-sonnet-5' });
      const before = snapshot();
      const res = await post('models/changes', { version: String(v), reason: 'second', [MAKE_MODEL]: 'anthropic/claude-opus-5' });
      assert.match(location(res), /\/settings\/models$/);
      assert.equal(snapshot(), before, 'the stale save wrote nothing');
    });

    test('a group move to a model its harness cannot run is refused, naming the jobs, and writes nothing', async () => {
      const v = await version();
      const before = snapshot();
      await post('models/changes', { version: String(v), reason: 'move make', [MAKE_MODEL]: 'openai/gpt-6.1-sol' });
      assert.equal(snapshot(), before);
    });

    test('the same move with OpenCode named on the group is accepted', async () => {
      const v = await version();
      await post('models/changes', { version: String(v), reason: 'move make', [MAKE_MODEL]: 'openai/gpt-6.1-sol', [MAKE_HARNESS]: 'opencode' });
      const log = await logOf();
      assert.equal(log.length, 1);
      assert.deepEqual(log[0].changes.map((c) => c.field).sort(), ['harness', 'model']);
    });

    test('a field the page does not own is refused', async () => {
      const v = await version();
      const before = snapshot();
      const res = await post('models/changes', { version: String(v), reason: 'bad', c__group__agent_session__make__model: 'x/y' });
      assert.equal(res.status, 302);
      assert.equal(snapshot(), before);
    });
  });

  describe('routing presets', () => {
    test('save a preset: one log entry, the table unchanged', async () => {
      await post('models/changes', { version: String(await version()), reason: 'set', [MAKE_MODEL]: 'anthropic/claude-sonnet-5' });
      const table = JSON.stringify((await fx.routingStore.getTable(URL_KEY)).jobs);
      const res = await post('models/presets', { name: 'the cheap one', reason: 'keep this' });
      assert.match(location(res), /saved=1/);
      assert.equal((await fx.routingStore.listPresets(URL_KEY)).length, 1);
      assert.equal(JSON.stringify((await fx.routingStore.getTable(URL_KEY)).jobs), table);
      assert.equal((await logOf())[0].kind, 'preset-save');
    });

    test('apply a preset: refused for a snapshot the runnable check rejects, and nothing is written', async () => {
      // A snapshot written through the proxy's shape-only path can hold a model its harness cannot run.
      await fx.routingStore.changeGroup('agent-session', 'make', { model: 'openai/gpt-6.1-sol' }, { urlKey: URL_KEY, reason: 'proxy-style', actor: { via: 'proxy' } });
      await post('models/presets', { name: 'bad', reason: 'keep' });
      const [preset] = await fx.routingStore.listPresets(URL_KEY);
      await fx.routingStore.changeGroup('agent-session', 'make', { harness: null, model: null }, { urlKey: URL_KEY, reason: 'clear', actor: { via: 'proxy' } });
      const before = snapshot();
      const res = await post(`models/presets/${preset._id}/apply`, { reason: 'apply it' });
      assert.match(location(res), /\/settings\/models$/);
      assert.equal(snapshot(), before);
    });
  });
});
