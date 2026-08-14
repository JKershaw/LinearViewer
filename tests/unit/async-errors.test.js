/**
 * Unit tests for lib/async-errors.js (LIN-609).
 *
 * Pins the REAL fix signal, not a proxy for it: a rejecting async route handler
 * must make the client receive a 500 from the Express error middleware — NOT hang
 * the request (which on Heroku becomes an H12 timeout / "Application error" host
 * page). Asserting "no unhandledRejection fired" or "the dyno stayed up" would be
 * the wrong signal — LIN-608's process handler already does that while the request
 * still hangs. So every test here drives a real HTTP request and asserts the
 * client got a response.
 *
 * Run with: node --test tests/unit/async-errors.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { installAsyncErrorForwarding } from '../../lib/async-errors.js';

installAsyncErrorForwarding();

describe('async error forwarding (LIN-609)', () => {
  let server;
  let base;

  before(async () => {
    const app = express();

    // The failure mode LIN-609 is about: async handler rejecting AFTER an await.
    app.get('/async-reject', async (req, res) => {
      await Promise.resolve();
      throw new Error('store blew up after await');
    });
    // Async handler that rejects via a returned rejected promise (no throw).
    app.get('/async-return-reject', (req, res) =>
      Promise.reject(new Error('returned rejection')));
    // Async handler that succeeds — must still respond normally.
    app.get('/async-ok', async (req, res) => {
      await Promise.resolve();
      res.send('ok');
    });
    // Synchronous throw — Express already routed these; must not regress.
    app.get('/sync-throw', (req, res) => {
      throw new Error('sync boom');
    });
    // Handler that already responded then rejects — must not double-send.
    app.get('/respond-then-reject', async (req, res) => {
      res.send('first');
      throw new Error('too late');
    });

    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      res.status(500).json({ error: 'handled', message: err.message });
    });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => server && server.close());

  // Bound timeout so a regression (hung request) FAILS fast instead of hanging CI.
  async function get(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(base + path, { signal: ctrl.signal });
      const text = await res.text();
      return { status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  }

  test('async rejection after await reaches the error middleware (no hang)', async () => {
    const { status, text } = await get('/async-reject');
    assert.equal(status, 500);
    assert.match(text, /store blew up after await/);
  });

  test('returned rejected promise reaches the error middleware', async () => {
    const { status, text } = await get('/async-return-reject');
    assert.equal(status, 500);
    assert.match(text, /returned rejection/);
  });

  test('successful async handler still responds normally', async () => {
    const { status, text } = await get('/async-ok');
    assert.equal(status, 200);
    assert.equal(text, 'ok');
  });

  test('synchronous throw still routes to the error middleware (no regression)', async () => {
    const { status, text } = await get('/sync-throw');
    assert.equal(status, 500);
    assert.match(text, /sync boom/);
  });

  test('a late rejection after the response is sent does not double-send', async () => {
    const { status, text } = await get('/respond-then-reject');
    assert.equal(status, 200);
    assert.equal(text, 'first');
  });
});

describe('installAsyncErrorForwarding is idempotent', () => {
  test('calling it repeatedly does not double-wrap or change behaviour', async () => {
    installAsyncErrorForwarding();
    installAsyncErrorForwarding();

    const app = express();
    app.get('/x', async () => {
      await Promise.resolve();
      throw new Error('once');
    });
    let calls = 0;
    app.use((err, req, res, next) => {
      calls += 1; // a double-wrap would forward the same error twice
      res.status(500).end();
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/x`);
      assert.equal(res.status, 500);
      await new Promise((r) => setTimeout(r, 50)); // let any stray forward land
      assert.equal(calls, 1);
    } finally {
      server.close();
    }
  });
});
