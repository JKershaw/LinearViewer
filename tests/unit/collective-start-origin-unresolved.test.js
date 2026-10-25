/**
 * LIN-3931: POST /workspace/:urlKey/collective/start embeds the request's origin in
 * each participant's prompt (the prose branch), so a Host-less request with no
 * PUBLIC_ORIGIN is refused up front, before any participant is queued. A refusal
 * part-way through would leave a half-started channel, so the check runs first.
 *
 * Scaffolding follows tests/unit/collective-dispatch-defaults.test.js. The
 * no-Host probe is a raw HTTP/1.0 request, since fetch always sends a Host.
 *
 * Run with: node --test tests/unit/collective-start-origin-unresolved.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCollectiveRoutes } from '../../routes/collective.js';
import { requestWithoutHost } from './lib/raw-http.js';

const WORKSPACES = [
  { urlKey: 'alpha', name: 'Alpha Project' },
];
const START_PATH = '/workspace/alpha/collective/start';
const BODY = { channel: '#room', characters: [{ workspaceUrlKey: 'alpha' }], target: 'cli' };

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createCollectiveRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.push({ urlKey, item });
        return { _id: `disp-${captured.length}`, ...item };
      },
    },
    // A prose participant embeds the origin only alongside a minted bootstrap, so the
    // fake store mints one (the prose branch of routes/collective.js's finalizePrompt).
    proxyTokenStore: { createToken: async () => ({ token: 'bootstrap-token' }) },
    yapClient: { baseUrl: 'https://yap.test' },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1', features: { collective: true }, workspaces: WORKSPACES };
      next();
    },
  }));
  return app;
}

describe('LIN-3931 — collective start with no Host and no PUBLIC_ORIGIN', () => {
  let savedPublicOrigin;
  beforeEach(() => {
    savedPublicOrigin = process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.EMAIL_LINK_ORIGIN;
  });
  afterEach(() => {
    if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
  });

  test('is refused up front: nothing is queued and no participant prompt carries http://undefined', async () => {
    const captured = [];
    const r = await requestWithoutHost(buildApp(captured), 'POST', START_PATH, { body: BODY });

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, 'ORIGIN_UNRESOLVED');
    assert.equal(r.body.retryable, false);
    assert.equal(captured.length, 0, 'no participant queued');
  });

  test('with PUBLIC_ORIGIN set, the same start launches and the prompt names the configured origin', async () => {
    process.env.PUBLIC_ORIGIN = 'https://harbour.example';
    const captured = [];
    const r = await requestWithoutHost(buildApp(captured), 'POST', START_PATH, { body: BODY });

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(captured.length, 1);
    assert.doesNotMatch(captured[0].item.prompt, /http:\/\/undefined/);
    assert.match(captured[0].item.prompt, /https:\/\/harbour\.example/);
  });
});
