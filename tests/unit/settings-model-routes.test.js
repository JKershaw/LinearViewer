/**
 * LIN-3853: the three old Settings forms write through the model-routing store.
 * After each POST the store holds the saved value, the job's effective setting reads it,
 * the log has exactly one entry with the form's fixed reason, and the section renders the
 * store's value. (On main there is no store or log, so each of these fails.)
 *
 * Run with: node --test tests/unit/settings-model-routes.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSettingsModelRoutes, LEGACY_FORM_REASONS } from '../../routes/settings-model.js';
import { renderAllAreas as renderSettingsPage } from '../helpers/render-settings-areas.js';
import { projectLegacy } from '../../lib/model-routing.js';
import { DEFAULT_MODEL } from '../../lib/openrouter.js';
import { routingFixture } from './helpers/routing-fakes.js';

const URL_KEY = 'acme';

describe('the old Settings forms, through the store', () => {
  let server, base, fx;
  before(async () => {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use((req, _res, next) => { req.session = { accountId: 'acct-1' }; next(); });
    app.use((req, res, next) => (fx ? next() : res.status(500).end()));
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
  const jobs = async () => Object.fromEntries((await fx.routingStore.getEffectiveTable(URL_KEY, { defaultModel: DEFAULT_MODEL })).jobs.map((j) => [j.id, j]));
  const page = async () => {
    const legacy = projectLegacy(await fx.preferencesStore.getRoutingTable(URL_KEY));
    return renderSettingsPage('Acme', { urlKey: URL_KEY, currentModel: legacy.modelId || DEFAULT_MODEL, dispatchDefaults: legacy.dispatchDefaults, aiModelOverrides: legacy.aiModelOverrides });
  };
  const onlyEntry = async (reason) => {
    const log = await fx.routingStore.getLog(URL_KEY);
    assert.equal(log.length, 1, 'exactly one log entry');
    assert.equal(log[0].reason, reason);
    assert.deepEqual([log[0].actor.via, log[0].actor.id], ['page', 'acct-1']);
    return log[0];
  };

  test('POST /settings/model sets every Harbour job\'s model, logs once, and the section shows it', async () => {
    const res = await post('model', { modelId: 'anthropic/claude-sonnet-4' });
    assert.equal(res.status, 302);
    const j = await jobs();
    for (const id of ['recommend', 'roadmap', 'feedback-title', 'observer-pass']) assert.equal(j[id].model, 'anthropic/claude-sonnet-4', id);
    await onlyEntry(LEGACY_FORM_REASONS.model);
    assert.match(await page(), /anthropic\/claude-sonnet-4/);
    // the old preference field is no longer written
    assert.equal(fx.prefs._docs.length, 0);
  });

  test('POST /settings/model keeps its validation redirects and writes nothing when refused', async () => {
    for (const [body, error] of [[{ modelId: '' }, 'empty'], [{ modelId: 'no-slash' }, 'invalid-format'], [{ modelId: 'a/b..c' }, 'invalid-format']]) {
      const res = await post('model', body);
      assert.equal(res.headers.get('location'), `/workspace/${URL_KEY}/settings/models?error=${error}`);
    }
    assert.deepEqual(await fx.routingStore.getLog(URL_KEY), []);
  });

  test('POST /settings/dispatch-defaults: the top row sets every agent group, per-kind rows set that job, one entry', async () => {
    const res = await post('dispatch-defaults', {
      defaultModel: 'top-m', defaultHarnessSelect: 'claude-code', defaultEffort: 'high',
      kind__review__Model: 'rev-m', kind__autopilot__HarnessSelect: 'opencode'
    });
    assert.equal(res.status, 302);
    const j = await jobs();
    assert.deepEqual([j.implementation.model, j.implementation.harness, j.implementation.effort, j.implementation.source.model], ['top-m', 'claude-code', 'high', 'group']);
    assert.deepEqual([j.review.model, j.review.source.model, j.review.harness], ['rev-m', 'job', 'claude-code']);
    assert.deepEqual([j.autopilot.harness, j.autopilot.source.harness, j.autopilot.model], ['opencode', 'job', 'top-m']);
    const entry = await onlyEntry(LEGACY_FORM_REASONS.dispatchDefaults);
    assert.ok(entry.changes.length > 0);
    const html = await page();
    assert.match(html, /top-m/);
    assert.match(html, /rev-m/);
  });

  test('POST /settings/dispatch-defaults: a blank per-kind field clears it so the job follows its group again', async () => {
    await post('dispatch-defaults', { defaultModel: 'top-m', kind__review__Model: 'rev-m' });
    await post('dispatch-defaults', { defaultModel: 'top-m' });
    assert.equal((await jobs()).review.source.model, 'group');
    assert.equal((await fx.routingStore.getLog(URL_KEY)).length, 2);
  });

  test('POST /settings/dispatch-defaults: an invalid field redirects with the error and writes nothing', async () => {
    const res = await post('dispatch-defaults', { defaultModel: 'x'.repeat(5000) });
    assert.match(res.headers.get('location'), /dispatchDefaultsError=invalid-field$/);
    assert.deepEqual(await fx.routingStore.getLog(URL_KEY), []);
  });

  test('POST /settings/ai-model-overrides: sets the job\'s own model, scan also sets scan-retire, one entry', async () => {
    const res = await post('ai-model-overrides', { byKind__recap__model: 'anthropic/recap-m', byKind__scan__modelCustom: 'anthropic/scan-m' });
    assert.equal(res.status, 302);
    const j = await jobs();
    assert.deepEqual([j.recap.model, j.scan.model, j['scan-retire'].model, j.brief.source.model], ['anthropic/recap-m', 'anthropic/scan-m', 'anthropic/scan-m', 'none']);
    await onlyEntry(LEGACY_FORM_REASONS.aiOverrides);
    assert.match(await page(), /anthropic\/recap-m/);
  });

  test('POST /settings/ai-model-overrides: invalid format redirects with the error and writes nothing', async () => {
    const res = await post('ai-model-overrides', { byKind__recap__model: 'nope' });
    assert.match(res.headers.get('location'), /aiOverridesError=invalid-format$/);
    assert.deepEqual(await fx.routingStore.getLog(URL_KEY), []);
  });

  test('a store failure renders the original settings error page (500), not a redirect', async () => {
    fx.routingStore.collection.updateOne = async () => { throw new Error('db down'); };
    const silenced = console.error;
    console.error = () => {};
    try {
      assert.equal((await post('model', { modelId: 'a/b' })).status, 500);
    } finally { console.error = silenced; }
  });

  test('each form\'s write is undoable from the log it left', async () => {
    await post('model', { modelId: 'a/one' });
    await post('model', { modelId: 'a/two' });
    const [latest] = await fx.routingStore.getLog(URL_KEY);
    await fx.routingStore.undo(latest._id, { urlKey: URL_KEY, reason: 'oops', actor: { via: 'page', id: 'acct-1' } });
    assert.equal((await jobs()).recommend.model, 'a/one');
  });
});
