/**
 * LIN-3718 — every caller of the dispatch-id pattern gives the same answer for
 * the same string. One shared table; each caller reads "accept" as "not refused
 * for UUID format". Expected values were captured on 8f39afd8, before the three
 * module-private copies were replaced by the `lib/dispatch-validation.js` export.
 *
 * Class (d): the pattern accepts the nil UUID and any version digit, and
 * rejects braces. That is today's behaviour and is pinned here as it is.
 *
 * `routes/proxy-runner.js` takes the id in the path, so the empty-string row is
 * left out there (it 404s at routing, before the regex).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { validateFeedbackBody } from '../../lib/dispatch-feedback-validation.js';
import { abortToError, followUpToError } from '../../lib/dispatch-validation.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { buildApp as buildProxyApp, call as callProxy, ACME } from './lib/proxy-fake-deps.js';

const VALID = '3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c';

// [name, input, accepted]
const TABLE = [
  ['valid lowercase', VALID, true],
  ['valid uppercase', VALID.toUpperCase(), true],
  ['mixed case', '3F2b8C1e-9A4d-4E7b-8c21-5D6e7F8a9B0c', true],
  ['braced', `{${VALID}}`, false],
  ['nil UUID', '00000000-0000-0000-0000-000000000000', true],
  ['no hyphens', VALID.replaceAll('-', ''), false],
  ['one char short', VALID.slice(0, -1), false],
  ['one char long', `${VALID}0`, false],
  ['non-hex g', `g${VALID.slice(1)}`, false],
  ['leading space', ` ${VALID}`, false],
  ['trailing space', `${VALID} `, false],
  ['trailing newline', `${VALID}\n`, false],
  ['empty string', '', false],
];

describe('LIN-3718 — dispatch-id pattern, validateFeedbackBody rootItemId', () => {
  for (const [name, input, accepted] of TABLE) {
    test(`${name} -> ${accepted ? 'kept' : 'dropped'}`, () => {
      const result = validateFeedbackBody({ message: 'hello', rootItemId: input });
      assert.equal(result.error, undefined);
      assert.equal(result.value.rootItemId, accepted ? input : undefined);
    });
  }
});

describe('LIN-3718 — dispatch-id pattern, abortToError', () => {
  for (const [name, input, accepted] of TABLE) {
    test(`${name} -> ${accepted ? 'null' : 'message'}`, () => {
      const result = abortToError({ isAbort: true, abortTo: input });
      if (accepted) assert.equal(result, null);
      else assert.equal(result, 'abortTo is required and must be a UUID when abort is true');
    });
  }
});

describe('LIN-3718 — dispatch-id pattern, followUpToError', () => {
  for (const [name, input, accepted] of TABLE) {
    test(`${name} -> ${accepted ? 'null' : 'message'}`, () => {
      const result = followUpToError({ followUpTo: input, target: 'cli' });
      if (accepted) assert.equal(result, null);
      else assert.equal(result, 'Invalid followUpTo format');
    });
  }
});

describe('LIN-3718 — dispatch-id pattern, POST /api/dispatch/broker-token itemId', () => {
  // An accepted id passes the format gate and reaches the declaration lookup,
  // which is made to fault so nothing is minted (503, not 400).
  function brokerApp() {
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: { getGrantDeclaration: async () => { throw new Error('lookup down'); } },
      dispatchTokenStore: { validateToken: async () => ({ urlKey: 'acme', label: 'sd-runner', createdBy: 'account-A' }) },
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      proxyTokenStore: {},
    }));
    return app;
  }

  async function post(itemId) {
    const app = brokerApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/dispatch/broker-token`, {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  for (const [name, input, accepted] of TABLE) {
    test(`${name} -> ${accepted ? 'past the format gate' : '400 Invalid item ID format'}`, async () => {
      const res = await post(input);
      if (accepted) {
        assert.equal(res.status, 503, JSON.stringify(res.body));
      } else {
        assert.equal(res.status, 400, JSON.stringify(res.body));
        assert.equal(res.body.error, 'Invalid item ID format');
      }
    });
  }
});

describe('LIN-3718 — dispatch-id pattern, POST /api/proxy/runner/take/:id', () => {
  function takeApp() {
    return buildProxyApp({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants: ['take'] }),
        listTokens: async () => [],
        describeRejectionCause: async () => null,
      },
      dispatchQueueStore: { takeItem: async () => null },
    });
  }

  for (const [name, input, accepted] of TABLE.filter(([name]) => name !== 'empty string')) {
    test(`${name} -> ${accepted ? 'past the format gate (404 not taken)' : '400 Invalid item ID format'}`, async () => {
      const res = await callProxy(takeApp(), 'POST', `/api/proxy/runner/take/${encodeURIComponent(input)}`, { body: {} });
      if (accepted) {
        assert.equal(res.status, 404, JSON.stringify(res.body));
        assert.deepEqual(res.body, { error: 'Item not found or already taken' });
      } else {
        assert.equal(res.status, 400, JSON.stringify(res.body));
        assert.deepEqual(res.body, { error: 'Invalid item ID format' });
      }
    });
  }
});
