/**
 * LIN-791 — the `variant` axis on the Autopilot kickoff proxy routes.
 *
 * Mounts the real proxy router over express with a stubbed readWrite token and a
 * fake dispatch store, then proves the POST /api/proxy/autopilot/kickoff verb:
 *   - resolves a MISSING variant to the default ('standard'),
 *   - 400s on an INVALID variant (mirroring the existing invalid-`mode` guard),
 *   - threads a valid 'stepper' through to the response,
 * and that the GET preview twin swaps the disposition in on `?variant=stepper`.
 *
 * General (no issueIdentifier) runs are used so the validation path is exercised
 * without needing a resolved workspace/issue — variant is validated up front,
 * right beside mode, before any issue resolution.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

before(() => { process.env.NODE_ENV = 'test'; });

const URL_KEY = 'test-workspace';

/** Build an app with the proxy router + a fake readWrite token and dispatch store. */
function buildApp() {
  const added = [];
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {
      addItem: async (urlKey, doc) => {
        const item = {
          _id: 'dispatch-1',
          kind: doc.kind,
          promptName: doc.promptName,
          issueIdentifier: doc.issueIdentifier ?? null,
          target: doc.target,
          dispatchedAt: new Date('2026-06-29T00:00:00Z'),
        };
        added.push({ urlKey, doc, item });
        return item;
      },
    },
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return { app, added };
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('POST kickoff: missing variant resolves to the default (standard)', async () => {
  const { app } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { goal: 'walk the stack' },
  });
  assert.equal(status, 201);
  assert.equal(body.variant, 'standard');
  assert.equal(body.kind, 'autopilot');
});

test('POST kickoff: an invalid variant is a 400 (mirrors invalid-mode)', async () => {
  const { app, added } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { variant: 'sideways' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /variant must be one of/);
  // a rejected request never reaches the dispatch store.
  assert.equal(added.length, 0);
});

test("POST kickoff: a valid variant 'stepper' is accepted and echoed back", async () => {
  const { app } = buildApp();
  const { status, body } = await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { variant: 'stepper' },
  });
  assert.equal(status, 201);
  assert.equal(body.variant, 'stepper');
});

test('POST kickoff: stepper dispatches a prompt carrying the stepper disposition', async () => {
  const { app, added } = buildApp();
  await request(app, '/api/proxy/autopilot/kickoff', {
    method: 'POST',
    body: { variant: 'stepper' },
  });
  assert.equal(added.length, 1);
  assert.match(added[0].doc.prompt, /You're running as the STEPPER/);
  // a standard run must NOT carry it.
  const std = buildApp();
  await request(std.app, '/api/proxy/autopilot/kickoff', { method: 'POST', body: {} });
  assert.doesNotMatch(std.added[0].doc.prompt, /You're running as the STEPPER/);
});

test('GET kickoff preview: ?variant=stepper swaps in the disposition; default omits it', async () => {
  const { app } = buildApp();
  const stepper = await request(app, '/api/proxy/autopilot/kickoff?variant=stepper');
  assert.equal(stepper.status, 200);
  assert.match(stepper.body, /You're running as the STEPPER/);

  const standard = await request(app, '/api/proxy/autopilot/kickoff');
  assert.equal(standard.status, 200);
  assert.doesNotMatch(standard.body, /You're running as the STEPPER/);

  // an unknown variant falls back to standard (GET is lenient, like ?mode=).
  const bogus = await request(app, '/api/proxy/autopilot/kickoff?variant=sideways');
  assert.equal(bogus.status, 200);
  assert.doesNotMatch(bogus.body, /You're running as the STEPPER/);
});
