/**
 * LIN-3487 — route-level pins for entrance messages that no unit test reached
 * before the entrances started reading the declared rules (lib/dispatch-fields.js,
 * lib/dispatch-validation.js). Each case sends one bad value to one route and
 * pins the exact status and message, so a wrong rule name or list at a swapped
 * call site goes red. The `logEvent` side is not asserted here.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DISPATCH_KINDS } from '../../lib/prompt-templates.js';
import { SUBSCRIPTION_LEVELS } from '../../lib/dispatch-wake.js';

const UUID = '11111111-2222-4333-8444-555555555555';

async function call(app, path, body, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const addItem = async (urlKey, item) => ({ _id: 'disp-1', dispatchedAt: '2026-10-11T00:00:00.000Z', ...item });

function buildDispatchApp() {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: { addItem },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { accountId: 'u1', linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined
  }));
  return app;
}

function buildProxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        grants: ['dispatch'], workspaceId: 'ws-acme',
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

const AUTH = { Authorization: 'Bearer anything' };
const DISPATCH = '/workspace/acme/api/dispatch';

function expect400(res, error) {
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, error);
}

describe('LIN-3487 — POST /workspace/:urlKey/api/dispatch entrance messages', () => {
  test('kind: an unknown kind is rejected with the kinds list', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', kind: 'nope' }),
      `kind must be one of: ${DISPATCH_KINDS.join(', ')}`);
  });
  test('target: an unknown target lists the DISPATCH list, which includes local', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', target: 'nope' }),
      'target must be one of: cli, web, dash, local');
  });
  test('target: local is a valid dispatch target', async () => {
    const res = await call(buildDispatchApp(), DISPATCH, { prompt: 'x', target: 'local' });
    assert.notEqual(res.body?.error, 'target must be one of: cli, web, dash, local');
  });
  test('abort and followUpTo are mutually exclusive', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { abort: true, abortTo: UUID, followUpTo: UUID }),
      'abort and followUpTo are mutually exclusive');
  });
  test('abortTo is required and must be a UUID when abort is true', async () => {
    const msg = 'abortTo is required and must be a UUID when abort is true';
    expect400(await call(buildDispatchApp(), DISPATCH, { abort: true }), msg);
    expect400(await call(buildDispatchApp(), DISPATCH, { abort: true, abortTo: 'nope' }), msg);
  });
  test('abortTo without abort is rejected', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', abortTo: UUID }), 'abortTo requires abort to be true');
  });
  test('a poll-eligible failure keeps its order after the abortTo check', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { abort: true, abortTo: 'nope', target: 'local' }),
      'abortTo is required and must be a UUID when abort is true');
    expect400(await call(buildDispatchApp(), DISPATCH, { abort: true, abortTo: UUID, target: 'local' }),
      'abort target must be poll-eligible (cli, web, or dash)');
  });
  test('cascade without abort is rejected; a non-boolean cascade gets the boolean message first', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', cascade: true }), 'cascade requires abort to be true');
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', cascade: 'yes' }), 'cascade must be a boolean');
  });
  test('waitForFollowUps must be a boolean', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', waitForFollowUps: 'yes' }),
      'waitForFollowUps must be a boolean');
  });
  test('queueIfBusy must be a boolean', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', queueIfBusy: 'yes' }),
      'queueIfBusy must be a boolean');
  });
  test('subscription lists the levels', async () => {
    expect400(await call(buildDispatchApp(), DISPATCH, { prompt: 'x', subscription: 'bogus' }),
      `subscription must be one of: ${SUBSCRIPTION_LEVELS.join(', ')}`);
  });
});

describe('LIN-3487 — POST /api/proxy/dispatch entrance messages', () => {
  const PATH = '/api/proxy/dispatch';
  test('kind: an unknown kind is rejected with the kinds list', async () => {
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', kind: 'nope' }, AUTH),
      `kind must be one of: ${DISPATCH_KINDS.join(', ')}`);
  });
  test('target: local is not polled, so it is rejected with the POLLED list', async () => {
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', target: 'local' }, AUTH),
      'target must be one of: cli, web, dash');
  });
  test('the abort relations, in order', async () => {
    expect400(await call(buildProxyApp(), PATH, { abort: true, abortTo: UUID, followUpTo: UUID }, AUTH),
      'abort and followUpTo are mutually exclusive');
    expect400(await call(buildProxyApp(), PATH, { abort: true, abortTo: 'nope' }, AUTH),
      'abortTo is required and must be a UUID when abort is true');
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', abortTo: UUID }, AUTH),
      'abortTo requires abort to be true');
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', cascade: true }, AUTH),
      'cascade requires abort to be true');
  });
  test('queueIfBusy and waitForFollowUps each name themselves; subscription lists the levels', async () => {
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', queueIfBusy: 'yes' }, AUTH), 'queueIfBusy must be a boolean');
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', waitForFollowUps: 'yes' }, AUTH), 'waitForFollowUps must be a boolean');
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', subscription: 'nope' }, AUTH),
      'subscription must be one of: everything, terminal-only');
  });
  test('cascade must be a boolean', async () => {
    expect400(await call(buildProxyApp(), PATH, { prompt: 'x', cascade: 'yes' }, AUTH), 'cascade must be a boolean');
  });
});

describe('LIN-3487 — POST /api/proxy/recommend-and-dispatch entrance messages', () => {
  const PATH = '/api/proxy/recommend-and-dispatch';
  test('target: local is rejected with the POLLED list', async () => {
    const res = await call(buildProxyApp(), PATH, { issueIdentifier: 'LIN-1', target: 'local' }, AUTH);
    expect400(res, 'target must be one of: cli, web, dash');
  });
  test('waitForFollowUps must be a boolean', async () => {
    expect400(await call(buildProxyApp(), PATH, { issueIdentifier: 'LIN-1', waitForFollowUps: 'yes' }, AUTH),
      'waitForFollowUps must be a boolean');
  });
  test('queueIfBusy must be a boolean', async () => {
    expect400(await call(buildProxyApp(), PATH, { issueIdentifier: 'LIN-1', queueIfBusy: 'yes' }, AUTH),
      'queueIfBusy must be a boolean');
  });
});

describe('LIN-3487 — POST /api/proxy/autopilot/kickoff target', () => {
  test('target: local is rejected with the POLLED list', async () => {
    expect400(await call(buildProxyApp(), '/api/proxy/autopilot/kickoff', { goal: 'ship it', target: 'local' }, AUTH),
      'target must be one of: cli, web, dash');
  });
});
