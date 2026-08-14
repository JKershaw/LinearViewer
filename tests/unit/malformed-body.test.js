/**
 * Unit tests for malformed / oversized request-body handling (LIN-1158).
 *
 * Bug: a malformed JSON body made body-parser throw a 400 SyntaxError
 * (`type: 'entity.parse.failed'`, `status: 400`), but the final catch-all
 * middleware ignored that status and forced a 500 "Internal server error",
 * logged as an "Unhandled route error". Callers/agents then assumed the server
 * was broken when the real fault was their own request body.
 *
 * Two layers are pinned:
 *  1. The pure classifiers `clientErrorStatus` / `clientErrorMessage`.
 *  2. The real signal end-to-end: an express app whose error middleware uses
 *     those classifiers must return 400 (not 500) for a body REAL body-parser
 *     rejects — proving the classifier matches body-parser's actual error shape,
 *     not a hand-mocked one.
 *
 * Run with: node --test tests/unit/malformed-body.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { clientErrorStatus, clientErrorMessage } from '../../lib/errors.js';

describe('clientErrorStatus (LIN-1158)', () => {
  test('body-parser parse failure → 400 via numeric status', () => {
    assert.equal(clientErrorStatus({ type: 'entity.parse.failed', status: 400 }), 400);
  });

  test('body-parser parse failure → 400 even if only .type is present', () => {
    assert.equal(clientErrorStatus({ type: 'entity.parse.failed' }), 400);
  });

  test('oversized body (entity.too.large) → 413 via status', () => {
    assert.equal(clientErrorStatus({ type: 'entity.too.large', status: 413 }), 413);
  });

  test('honors err.statusCode when err.status is absent', () => {
    assert.equal(clientErrorStatus({ statusCode: 415 }), 415);
  });

  test('a genuine 5xx / unclassified error → null (keeps the 500 path)', () => {
    assert.equal(clientErrorStatus(new Error('store blew up')), null);
    assert.equal(clientErrorStatus({ status: 500 }), null);
    assert.equal(clientErrorStatus(null), null);
    assert.equal(clientErrorStatus(undefined), null);
  });
});

describe('clientErrorMessage (LIN-1158)', () => {
  test('parse failure names the JSON body, not a generic 400', () => {
    assert.equal(clientErrorMessage(400, { type: 'entity.parse.failed' }), 'Invalid JSON body');
  });
  test('413 names the size', () => {
    assert.equal(clientErrorMessage(413, { type: 'entity.too.large' }), 'Request body too large');
  });
  test('415 names the content type', () => {
    assert.equal(clientErrorMessage(415, {}), 'Unsupported content type');
  });
  test('a bare 400 that is not a parse failure stays generic', () => {
    assert.equal(clientErrorMessage(400, {}), 'Bad request');
  });
});

describe('malformed body reaches the client as 400, not 500 (LIN-1158)', () => {
  let server;
  let base;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: '1kb' }));
    app.post('/echo', (req, res) => res.json({ ok: true, body: req.body }));

    // Mirrors the real server.js catch-all: honor a carried client error before
    // defaulting to 500.
    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      const status = clientErrorStatus(err);
      if (status !== null) {
        return res.status(status).json({ error: clientErrorMessage(status, err) });
      }
      res.status(500).json({ error: 'Internal server error' });
    });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => server && server.close());

  async function post(body, headers = { 'content-type': 'application/json' }) {
    const res = await fetch(base + '/echo', { method: 'POST', headers, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  test('malformed JSON → 400 "Invalid JSON body" (not 500)', async () => {
    const { status, json } = await post('{ bad json');
    assert.equal(status, 400);
    assert.equal(json.error, 'Invalid JSON body');
  });

  test('unescaped control character in a string → 400 (the ticket repro)', async () => {
    const { status, json } = await post('{"body":"line1\nline2"}');
    assert.equal(status, 400);
    assert.equal(json.error, 'Invalid JSON body');
  });

  test('oversized body → 413 "Request body too large" (not 500)', async () => {
    const big = JSON.stringify({ x: 'a'.repeat(2000) });
    const { status, json } = await post(big);
    assert.equal(status, 413);
    assert.equal(json.error, 'Request body too large');
  });

  test('valid JSON still parses and responds 200', async () => {
    const { status, json } = await post(JSON.stringify({ hello: 'world' }));
    assert.equal(status, 200);
    assert.deepEqual(json.body, { hello: 'world' });
  });
});
