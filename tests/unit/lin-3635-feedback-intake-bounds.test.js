/**
 * LIN-3635 (June review M3) — feedback intake bounds: the body parser matches
 * only `text/plain` (the widget's type), and `feedbackSubmitLimiter` budgets
 * the route per account with an IP fallback. The free-tier gate witnesses live
 * in feedback-title.test.js. Stubbed providers only; no network.
 */
import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes, feedbackSubmitLimiter } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const realNodeEnv = process.env.NODE_ENV;
after(() => {
  if (realNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = realNodeEnv;
});

const PROVIDER_NAME = 'lin-3635-fake';

function buildApp(createCalls) {
  registerProvider({
    name: PROVIDER_NAME,
    supports: (cap) => ({ createIssue: true, uploadFile: true, fetchTeams: true }[cap] === true),
    apiWriteFields: () => ['title', 'description', 'teamId', 'projectId', 'priority'],
    async fetchTeams() { return [{ id: 't', name: 'Default' }]; },
    async createIssue(token, input) {
      createCalls.push(input);
      return { success: true, issue: { id: 'i1', identifier: 'LIN-1', title: input.title, url: 'u', state: { name: 'Todo', type: 'unstarted' } } };
    },
  });
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  // Session is attached before the router, as the real session middleware is.
  app.use((req, res, next) => {
    const acct = req.get('x-test-account');
    req.session = { linearUserId: 'u', ...(acct ? { accountId: acct } : {}) };
    next();
  });
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'tok' };
      next();
    },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    dispatchQueueStore: { addItem: async () => ({ _id: 'd1' }) },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {},
  }));
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(r => server.close(r)); }
}

async function post(base, contentType, body, headers = {}) {
  const res = await fetch(`${base}/workspace/acme/api/feedback`, {
    method: 'POST', headers: { 'Content-Type': contentType, ...headers }, body,
  });
  let json = {};
  try { json = await res.json(); } catch (_) { /* ignore */ }
  return { status: res.status, body: json };
}

const VALID = JSON.stringify({ message: 'hello there' });

describe('feedback body parser is text/plain only (LIN-3635)', () => {
  beforeEach(() => { process.env.NODE_ENV = 'test'; });

  test('text/plain still files the ticket', async () => {
    const calls = [];
    await withServer(buildApp(calls), async (base) => {
      const r = await post(base, 'text/plain;charset=UTF-8', VALID);
      assert.strictEqual(r.status, 201);
      assert.strictEqual(calls.length, 1);
    });
  });

  for (const type of ['application/octet-stream', 'application/x-www-form-urlencoded']) {
    test(`${type} is not parsed: 400, no ticket`, async () => {
      const calls = [];
      await withServer(buildApp(calls), async (base) => {
        const r = await post(base, type, VALID);
        assert.strictEqual(r.status, 400);
        assert.strictEqual(calls.length, 0);
      });
    });
  }

  test('text/plain over 12mb is refused 413', async () => {
    const calls = [];
    await withServer(buildApp(calls), async (base) => {
      const r = await post(base, 'text/plain', JSON.stringify({ message: 'x'.repeat(13 * 1024 * 1024) }));
      assert.strictEqual(r.status, 413);
      assert.strictEqual(calls.length, 0);
    });
  });
});

describe('feedbackSubmitLimiter (LIN-3635)', () => {
  test('is exported', () => {
    assert.strictEqual(typeof feedbackSubmitLimiter, 'function');
  });

  test('under NODE_ENV=test nothing is limited', async () => {
    process.env.NODE_ENV = 'test';
    await withServer(buildApp([]), async (base) => {
      for (let i = 0; i < 7; i++) {
        const r = await post(base, 'text/plain', VALID, { 'x-test-account': 'acct-test-skip' });
        assert.strictEqual(r.status, 201);
      }
    });
  });

  test('6th POST from one account is 429; another account and the IP bucket are separate', async () => {
    process.env.NODE_ENV = 'development';
    try {
      await withServer(buildApp([]), async (base) => {
        for (let i = 0; i < 5; i++) {
          const r = await post(base, 'text/plain', VALID, { 'x-test-account': 'acct-a' });
          assert.strictEqual(r.status, 201, `request ${i + 1}`);
        }
        const limited = await post(base, 'text/plain', VALID, { 'x-test-account': 'acct-a' });
        assert.strictEqual(limited.status, 429);
        assert.deepStrictEqual(limited.body, { error: 'Too many feedback submissions, please try again later' });

        const other = await post(base, 'text/plain', VALID, { 'x-test-account': 'acct-b' });
        assert.strictEqual(other.status, 201);

        // No account: shares the IP bucket (5 then 429).
        for (let i = 0; i < 5; i++) {
          assert.strictEqual((await post(base, 'text/plain', VALID)).status, 201);
        }
        assert.strictEqual((await post(base, 'text/plain', VALID)).status, 429);
      });
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });
});
