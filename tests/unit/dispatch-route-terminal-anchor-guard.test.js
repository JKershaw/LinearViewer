/**
 * LIN-2775 beat 5 corrective — route-level: the terminal-anchor guard
 * (lib/dispatch-factory.js, LIN-2775 Area 8) is fully correct at the
 * factory seam, but `routes/dispatch.js`'s catch block never relayed
 * `err.anchorTerminalRefusal`/`err.composedRunMarkerInvalid` — both fell
 * through to the generic `jsonError(res, 500, 'Failed to dispatch prompt')`.
 * A correct, deliberate safety refusal was reaching the operator as a
 * server crash, and the stable `ANCHOR_TERMINAL` code that the factory's
 * own unit tests assert on never actually reached the wire.
 *
 * This file exercises the REAL POST /workspace/:urlKey/api/dispatch route
 * end to end (a real Express app on a real HTTP server), not a mocked
 * createDispatchItem — a factory-level assertion alone is exactly what let
 * the missing relay through undetected. Mirrors the buildApp/call
 * scaffolding in dispatch-route-max-tasks.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { ANCHOR_TERMINAL_CODE } from '../../lib/dispatch-factory.js';

function buildApp({ captured = {}, anchorStateType = 'started', getWorkspaceAccessToken, fetchIssueContext } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-01T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    workspacePreferencesStore: undefined,
    dispatchPresetsStore: undefined,
    getWorkspaceAccessToken: getWorkspaceAccessToken || (async () => 'tok'),
    fetchIssueContext: fetchIssueContext || (async () => ({ issue: { state: { name: 'x', type: anchorStateType } } }))
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PATH = '/workspace/acme/api/dispatch';

describe('POST /workspace/:urlKey/api/dispatch — terminal-anchor guard relay (LIN-2775 beat 5 corrective)', () => {
  // The guard's own cache (lib/dispatch-factory.js) is a module-level
  // singleton, by design (LIN-2775 Area 8 — it must persist across dispatch
  // attempts within the process). That means it ALSO persists across the
  // test cases in this one file, which all share the same imported module
  // instance — so each case below uses its OWN issueIdentifier as the cache
  // key, exactly the isolation discipline a shared production cache demands
  // of its own callers.
  for (const terminalType of ['completed', 'canceled', 'duplicate']) {
    test(`a composedRunMarker-carrying request against a ${terminalType} anchor is a REAL 409 with code ANCHOR_TERMINAL — not a 500`, async () => {
      const captured = {};
      const app = buildApp({ captured, anchorStateType: terminalType });
      const res = await call(app, 'post', PATH, {
        prompt: 'x', kind: 'implementation', issueIdentifier: `LIN-${terminalType}`,
        composedRunMarker: 'ruling-composed-run'
      });

      assert.equal(res.status, 409, `expected a 409 on the wire, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, ANCHOR_TERMINAL_CODE);
      assert.equal(res.body.issueIdentifier, `LIN-${terminalType}`);
      assert.equal(captured.item, undefined, 'nothing must be enqueued on a refusal');
    });
  }

  test('an invalid composedRunMarker is a REAL 400 — not a 500', async () => {
    const captured = {};
    const app = buildApp({ captured });
    // A dangerous control character fails validateOpaqueDispatchField.
    const res = await call(app, 'post', PATH, {
      prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-invalid-marker',
      composedRunMarker: 'bad\x00marker'
    });

    assert.equal(res.status, 400, `expected a 400 on the wire, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.error, 'expected an error message');
    assert.equal(captured.item, undefined);
  });

  test('a composedRunMarker-carrying request against a NON-terminal anchor still succeeds (201) — the guard is scoped, not blanket', async () => {
    const captured = {};
    const app = buildApp({ captured, anchorStateType: 'started' });
    const res = await call(app, 'post', PATH, {
      prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-nonterminal',
      composedRunMarker: 'ruling-composed-run'
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.composedRunMarker, undefined, 'composedRunMarker is a guard signal only — it must never be persisted onto the stored item');
  });

  test('an ordinary dispatch with NO composedRunMarker is unaffected even against a terminal anchor', async () => {
    const captured = {};
    const app = buildApp({ captured, anchorStateType: 'completed' });
    const res = await call(app, 'post', PATH, { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-no-marker' });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item, 'a plain dispatch must never be gated by this guard');
  });
});
