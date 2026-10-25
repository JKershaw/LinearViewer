/**
 * LIN-3833 step 1: GET /workspace/:urlKey/api/dispatch/preview, the read-only answer the run control
 * shows. Route-level, on the real createDispatchRoutes, with the same owner seam the POST uses.
 *
 * Witnesses: the owner gets the resolved setting with a source per field; a non-owner is refused
 * (the PREVIEW_OWNER_ONLY code is defined, not silently allowed); an unknown surface is a 400; a
 * surface-tagged request takes the opened-task settle; the preset is named when it answers.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { emptyTable } from '../../lib/model-routing.js';

function buildApp({ owner = true, table = emptyTable(), presets = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: { addItem: async () => ({ _id: 'disp-1' }) },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { id: 'ws-1', urlKey: req.params.urlKey };
      req.session = { accountId: 'acct-1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: { getRoutingTable: async () => table },
    dispatchPresetsStore: { get: async (_urlKey, id) => presets[id] || null },
    workspaceOwnerCheck: async () => ({ status: owner ? 'owner' : 'not-owner' })
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /api/dispatch/preview — the owner gets the resolution with its sources', () => {
  test('a job row answers with the job as the source for harness and model', async () => {
    const table = emptyTable();
    table.jobs.implementation = { harness: 'opencode', model: 'job-model' };
    const { status, body } = await get(buildApp({ table }), '/workspace/acme/api/dispatch/preview?promptName=implementation');
    assert.equal(status, 200);
    assert.equal(body.kind, 'implementation');
    assert.equal(body.model, 'job-model');
    assert.equal(body.harness, 'opencode');
    assert.deepEqual(body.sources, { harness: 'job', model: 'job', effort: 'none' });
  });

  test('a surface-tagged request settles the harness: a blank table answers claude-code, as the fallback', async () => {
    const { body } = await get(buildApp(), '/workspace/acme/api/dispatch/preview?promptName=plan&surface=home');
    assert.equal(body.harness, 'claude-code');
    assert.equal(body.sources.harness, 'fallback');
  });

  test('without a surface the same blank table answers a null harness (the dispatch page passthrough)', async () => {
    const { body } = await get(buildApp(), '/workspace/acme/api/dispatch/preview?promptName=plan');
    assert.equal(body.harness, null);
    assert.equal(body.sources.harness, 'none');
  });

  test('a preset that answers is named, and its source is "preset"', async () => {
    const presets = { careful: { id: 'careful', name: 'Careful', config: { model: 'preset-model', harness: 'claude-code' } } };
    const { body } = await get(buildApp({ presets }), '/workspace/acme/api/dispatch/preview?promptName=review&presetId=careful');
    assert.equal(body.presetName, 'Careful');
    assert.equal(body.model, 'preset-model');
    assert.equal(body.sources.model, 'preset');
  });

  test('an explicit kind wins over the promptName, as the entrance takes it', async () => {
    const { body } = await get(buildApp(), '/workspace/acme/api/dispatch/preview?promptName=implementation&kind=review');
    assert.equal(body.kind, 'review');
  });
});

describe('GET /api/dispatch/preview — refusals', () => {
  test('a non-owner is refused, not answered', async () => {
    const { status, body } = await get(buildApp({ owner: false }), '/workspace/acme/api/dispatch/preview?promptName=plan');
    assert.equal(status, 403);
    assert.equal(body.code, 'PREVIEW_OWNER_ONLY');
    assert.equal(body.harness, undefined);
  });

  test('an unknown surface is a 400 naming the allowed values', async () => {
    const { status, body } = await get(buildApp(), '/workspace/acme/api/dispatch/preview?promptName=plan&surface=mars');
    assert.equal(status, 400);
    assert.match(body.error, /surface must be one of: swipe, home/);
  });
});
