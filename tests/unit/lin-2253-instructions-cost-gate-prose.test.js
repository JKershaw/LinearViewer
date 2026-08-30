/**
 * LIN-2253 close-out, ledger item 5 (review finding S3).
 *
 * PR #1306 corrected the `/api/proxy/instructions` catalog prose for
 * `GET /issues/{id}/cost` so it describes the ACTUAL `totalUsd` gate in
 * `lib/task-cost.js` — which since `fb8c023f` also requires `noLineage` to be
 * false. The prose was accurate at merge but nothing pinned it, and an
 * unpinned doc string is exactly how it went stale the first time (the gate
 * gained a fourth condition and the catalog kept describing three).
 *
 * This is a DOC-VS-CODE consistency pin, not a prose snapshot: it asserts the
 * served text names every condition the code actually gates on, and — the
 * non-vacuity half — that the gate in `lib/task-cost.js` still has exactly
 * those four conditions. If someone adds a fifth condition to the gate without
 * documenting it, the second half fails; if someone deletes the `noLineage`
 * clause from the catalog, the first half fails.
 *
 * Reuses the buildApp/call harness from
 * tests/unit/lin-2354-instructions-provider-identity.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createProxyRoutes } from '../../routes/proxy.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem: async () => ({}) },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: null
  }));
  return app;
}

async function fetchInstructions() {
  const server = buildApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/instructions`, {
      headers: { Authorization: 'Bearer anything' }
    });
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /api/proxy/instructions — /cost totalUsd gate prose stays true to lib/task-cost.js (LIN-2253 S3)', () => {
  test('the served catalog names noLineage as a totalUsd gate condition', async () => {
    const { status, text } = await fetchInstructions();

    assert.equal(status, 200);
    // Non-vacuity: we are looking at the /cost section, not an empty response.
    assert.ok(text.includes('"pricedUsd" is the worker-side sum'),
      'the /cost catalog entry is present in the served instructions');

    // The gate clause itself. `noLineage` must appear as a NAMED condition of
    // the `totalUsd` restatement — the exact clause that went stale.
    assert.match(
      text,
      /"totalUsd" restates\s+"pricedUsd" plus "appCalls\.costUsd" ONLY when "noLineage" is false AND "unpriced"\s+is empty AND "noTelemetryCount" is 0 AND "appCalls\.unpricedCalls" is 0/,
      'the totalUsd gate prose names all four conditions, noLineage first'
    );
  });

  test('the gate in lib/task-cost.js still has exactly the four documented conditions', () => {
    // The other half of the pin: the prose above is only "true" relative to
    // this expression. Read the source rather than re-deriving the gate, so a
    // fifth condition cannot be added while the catalog silently keeps
    // describing four.
    const source = readFileSync(
      fileURLToPath(new URL('../../lib/task-cost.js', import.meta.url)),
      'utf8'
    );

    assert.ok(
      source.includes('const fullyPriced = !noLineage && unpriced.length === 0 && noTelemetryCount === 0 && (appCalls.unpricedCalls || 0) === 0;'),
      'lib/task-cost.js gates fullyPriced on exactly the four conditions the catalog documents — ' +
      'if this fails, the gate changed and routes/proxy.js\'s /cost catalog prose must change with it'
    );
  });
});
