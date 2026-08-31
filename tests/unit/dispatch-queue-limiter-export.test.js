/**
 * LIN-2434 beat 1 (R1, the ratified operator hazard) — `dispatchQueueLimiter`
 * (routes/dispatch.js) was module-private, with its only two references being
 * its own declaration and its one use on POST /workspace/:urlKey/api/dispatch.
 * The upcoming approve-follow-up route lives on a DIFFERENT router
 * (routes/flight-companion.js) and inherits nothing by registration, so a
 * dispatch-creating endpoint there would otherwise carry no rate limit at all.
 *
 * This pins two things: (1) the limiter is now a named export, reachable from
 * outside routes/dispatch.js, and (2) mounting it on the existing dispatch
 * route is completely behavior-preserving — same 30/min budget, same window,
 * same message shape, same test-mode skip. Beat 2 wires this same exported
 * instance onto the new approve route; this beat only proves it is reachable
 * and unchanged.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes, dispatchQueueLimiter } from '../../routes/dispatch.js';

const realNodeEnv = process.env.NODE_ENV;
after(() => {
  if (realNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = realNodeEnv;
});

function buildDispatchApp() {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: {
      addItem: async (urlKey, item) => ({ _id: 'disp-1', dispatchedAt: '2026-08-31T00:00:00.000Z', ...item })
    },
    dispatchTokenStore: {},
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey };
      req.session = { linearUserId: 'u1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null
  }));
  return app;
}

async function post(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('dispatchQueueLimiter is exported and behavior-preserving', () => {
  test('is a named export of routes/dispatch.js (an express middleware function)', () => {
    assert.equal(typeof dispatchQueueLimiter, 'function');
  });

  test('skips enforcement under NODE_ENV=test, exactly as before (unchanged default posture)', async () => {
    process.env.NODE_ENV = 'test';
    const app = buildDispatchApp();
    for (let i = 0; i < 35; i++) {
      const res = await post(app, '/workspace/ws1/api/dispatch', { prompt: `p${i}` });
      assert.notEqual(res.status, 429, `request ${i} must not be rate-limited under NODE_ENV=test`);
    }
  });

  test('enforces exactly 30/min on the real dispatch route once active (NODE_ENV != test)', async () => {
    process.env.NODE_ENV = 'development';
    const app = buildDispatchApp();

    const statuses = [];
    for (let i = 0; i < 31; i++) {
      const res = await post(app, '/workspace/ws1/api/dispatch', { prompt: `p${i}` });
      statuses.push(res.status);
      if (i === 30) {
        assert.equal(res.status, 429, 'the 31st request in the window must be rate-limited');
        assert.deepEqual(res.body, { error: 'Too many dispatch requests, please try again later' },
          'the 429 body must match the limiter\'s original message, unchanged by the hoist');
      }
    }
    const allowed = statuses.filter(s => s !== 429).length;
    assert.equal(allowed, 30, 'exactly 30 requests per minute must be allowed, matching the original limiter config');
  });

  test('the SAME exported instance carries its already-exhausted budget onto an unrelated router (proves it is a shared singleton, not a fresh instance)', async () => {
    process.env.NODE_ENV = 'development';

    // The prior test just drove the shared 30/min budget for this IP to
    // exhaustion against POST /workspace/:urlKey/api/dispatch. If the export
    // is the SAME middleware instance (not re-created per mount point), a
    // bare, unrelated router — standing in for a future consumer on a
    // different factory (e.g. routes/flight-companion.js) — must be
    // rate-limited on its very FIRST request too. A fresh instance with the
    // same config would instead allow 30 more requests before blocking,
    // which this immediate-429 assertion would catch.
    const otherApp = express();
    otherApp.post('/other/route', dispatchQueueLimiter, (req, res) => res.json({ ok: true }));

    const server = otherApp.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/other/route`, { method: 'POST' });
      assert.equal(res.status, 429,
        'a shared limiter instance must already be exhausted here; a freshly-constructed one would wrongly allow this request');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
