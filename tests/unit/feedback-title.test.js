// =============================================================================
// AI-generated feedback ticket titles (LIN-643)
// =============================================================================
//
// Two layers:
//   1. Pure helpers in lib/feedback-title.js — message shaping + response
//      sanitisation (quotes, labels, trailing period, length clamp).
//   2. The POST /workspace/:urlKey/api/feedback route's title resolution:
//      - AI enabled + no explicit title  → LLM title, NO 60-char truncation
//      - AI title generation fails        → deterministic 60-char fallback
//      - AI disabled (no key)             → deterministic 60-char fallback
//      - explicit title                   → wins, no LLM call
//
// The route AI path is exercised against a stubbed global fetch that emits a
// canned OpenRouter SSE stream, so no network is touched.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  buildFeedbackTitleMessages,
  parseFeedbackTitle,
} from '../../lib/feedback-title.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

describe('feedback-title pure helpers (LIN-643)', () => {
  test('buildFeedbackTitleMessages carries the trimmed body as the user turn', () => {
    const messages = buildFeedbackTitleMessages('  the swipe view jumps on mobile  ');
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.match(messages[0].content, /title/i);
    assert.strictEqual(messages[1].role, 'user');
    assert.strictEqual(messages[1].content, 'the swipe view jumps on mobile');
  });

  test('parseFeedbackTitle strips quotes, labels, and a trailing period', () => {
    assert.strictEqual(parseFeedbackTitle('"Fix swipe jump on mobile."'), 'Fix swipe jump on mobile');
    assert.strictEqual(parseFeedbackTitle('Title: Fix swipe jump'), 'Fix swipe jump');
    assert.strictEqual(parseFeedbackTitle('`Fix swipe jump`'), 'Fix swipe jump');
  });

  test('parseFeedbackTitle keeps only the first non-empty line', () => {
    assert.strictEqual(parseFeedbackTitle('\n\nFix swipe jump\nsome rambling'), 'Fix swipe jump');
  });

  test('parseFeedbackTitle preserves question/exclamation marks and ellipses', () => {
    assert.strictEqual(parseFeedbackTitle('Why does swipe jump?'), 'Why does swipe jump?');
    assert.strictEqual(parseFeedbackTitle('Swipe sometimes jumps...'), 'Swipe sometimes jumps...');
  });

  test('parseFeedbackTitle clamps an over-long title to 120 chars', () => {
    const out = parseFeedbackTitle('x'.repeat(300));
    assert.strictEqual(out.length, 120);
  });

  test('parseFeedbackTitle returns empty string for empty/garbage input', () => {
    assert.strictEqual(parseFeedbackTitle(''), '');
    assert.strictEqual(parseFeedbackTitle(null), '');
  });
});

// -----------------------------------------------------------------------------
// Route title resolution
// -----------------------------------------------------------------------------

const PROVIDER_NAME = 'feedback-title-fake';

function makeFakeProvider() {
  const calls = { createIssue: [] };
  const provider = {
    name: PROVIDER_NAME,
    supports: (cap) => ({ createIssue: true, uploadFile: true, fetchTeams: true }[cap] === true),
    // LIN-1557: the feedback route's priority write-contract check consults
    // this unconditionally.
    apiWriteFields: () => ['title', 'description', 'teamId', 'projectId', 'priority'],
    async fetchTeams() { return [{ id: 'team-default', name: 'Default' }]; },
    async createIssue(token, input) {
      calls.createIssue.push(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'LIN-900', title: input.title, url: 'https://lin/LIN-900', state: { name: 'Todo', type: 'unstarted' } } };
    },
  };
  return { provider, calls };
}

function buildApp({ provider, sessionApiKey = null }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token' };
      req.session = { linearUserId: 'user-1', openRouterApiKey: sessionApiKey };
      next();
    },
    // A working workspace-preferences stub so resolveWorkspaceModel resolves
    // (the empty {} other feedback tests pass would throw on the AI path).
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    // Triage enqueue is best-effort; a no-op store keeps the focus on titles.
    dispatchQueueStore: { addItem: async () => ({ _id: 'd1' }) },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {},
  });
  app.use(router);
  return app;
}

async function submit(app, urlKey, payload) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/${urlKey}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// Fake OpenRouter SSE stream yielding the given content tokens. The route's
// own loopback submit uses real fetch, so the stub forwards anything that
// isn't the OpenRouter completions endpoint to the original fetch.
function installFetchStub(tokens, { ok = true } = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (typeof url === 'string' && url.includes('openrouter.ai')) {
      if (!ok) return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
      async function* gen() {
        for (const t of tokens) {
          yield new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
        }
        yield new TextEncoder().encode('data: [DONE]\n\n');
      }
      return { ok: true, status: 200, body: gen(), text: async () => '', json: async () => ({}) };
    }
    return realFetch(url, options);
  };
  return () => { globalThis.fetch = realFetch; };
}

describe('feedback title resolution (LIN-643)', () => {
  let savedEnv;
  let restoreFetch = null;
  beforeEach(() => {
    savedEnv = {
      key: process.env.OPENROUTER_API_KEY,
      free: process.env.OPENROUTER_FREE_TIER_KEY,
      team: process.env.FEEDBACK_TEAM_ID,
      httpProxy: process.env.HTTP_PROXY,
      httpsProxy: process.env.HTTPS_PROXY,
    };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_FREE_TIER_KEY;
    delete process.env.FEEDBACK_TEAM_ID;
    // Force the streaming path (which uses global fetch we can stub).
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
  });
  afterEach(() => {
    if (restoreFetch) { restoreFetch(); restoreFetch = null; }
    for (const [k, v] of [['OPENROUTER_API_KEY', savedEnv.key], ['OPENROUTER_FREE_TIER_KEY', savedEnv.free], ['FEEDBACK_TEAM_ID', savedEnv.team], ['HTTP_PROXY', savedEnv.httpProxy], ['HTTPS_PROXY', savedEnv.httpsProxy]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const LONG_MESSAGE = 'When feedback is submitted, if the user has AI enabled the title for the new task should be generated by an LLM and not truncated.';

  test('AI-enabled: generates the title via LLM and skips the 60-char truncation', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    restoreFetch = installFetchStub(['Generate AI feedback ', 'titles instead of truncating']);
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status } = await submit(app, 'acme', { message: LONG_MESSAGE });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.createIssue.length, 1);
    const generated = calls.createIssue[0].title;
    assert.strictEqual(generated, 'Generate AI feedback titles instead of truncating');
    // Crucially: NOT the deterministic 60-char first-line slice.
    assert.ok(!generated.startsWith('Feedback: '), 'AI path must not use the Feedback: fallback prefix');
  });

  test('AI generation failure falls back to the deterministic 60-char title', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    restoreFetch = installFetchStub([], { ok: false });
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status } = await submit(app, 'acme', { message: LONG_MESSAGE });

    assert.strictEqual(status, 201);
    const fallback = `Feedback: ${LONG_MESSAGE.slice(0, 60)}`;
    assert.strictEqual(calls.createIssue[0].title, fallback);
  });

  test('AI disabled (no key) uses the deterministic 60-char fallback', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status } = await submit(app, 'acme', { message: LONG_MESSAGE });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.createIssue[0].title, `Feedback: ${LONG_MESSAGE.slice(0, 60)}`);
  });

  test('explicit title always wins, even with AI enabled (no LLM call)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    // Stub throws if the LLM endpoint is hit — proves the explicit-title path skips it.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (typeof url === 'string' && url.includes('openrouter.ai')) throw new Error('LLM should not be called for explicit titles');
      return realFetch(url, options);
    };
    restoreFetch = () => { globalThis.fetch = realFetch; };

    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status } = await submit(app, 'acme', { message: LONG_MESSAGE, title: 'My explicit title' });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.createIssue[0].title, 'My explicit title');
  });
});
