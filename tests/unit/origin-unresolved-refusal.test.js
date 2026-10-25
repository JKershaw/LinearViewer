/**
 * LIN-3931: a request with no Host header and no PUBLIC_ORIGIN has no origin.
 * publicOrigin() then yields `http://undefined`, and that text must never reach a
 * run's prompt or a text a raw client runs. Each site that embeds the origin is
 * refused with the shared ORIGIN_UNRESOLVED refusal before anything is minted or
 * enqueued. Sites that never embed it (the claude-code/MCP preamble, aborts) keep
 * working with no Host.
 *
 * Every probe is a raw HTTP/1.0 request with no Host through the real composed
 * proxy router (createProxyRoutes), the same wire form as tests/unit/feedback-route.test.js.
 *
 * Run with: node --test tests/unit/origin-unresolved-refusal.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { requestWithoutHost } from './lib/raw-http.js';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';

const ORIGIN_EXPECTED_CODE = 'ORIGIN_UNRESOLVED';
const RUN_PATH = '/api/proxy/dispatch';
const RECOMMEND_PATH = '/api/proxy/recommend-and-dispatch';
const KICKOFF_PATH = '/api/proxy/autopilot/kickoff';
const RUNNER_PROMPT_PATH = '/api/proxy/runner/prompt';

// Each probe gets its own stores so nothing is shared across tests.
function proxyApp({ grants = ['take', 'dispatch'] } = {}) {
  const enqueued = [];
  const minted = [];
  const token = { token: 'bootstrap', kind: 'bootstrap', scope: 'readWrite' };
  const app = buildApp({
    proxyTokenStore: {
      ...BASE_DEPS().proxyTokenStore,
      validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy: 'u1', grants, workspaceId: 'ws-acme' }),
      createToken: async (...args) => { minted.push(args); return token; },
      mintGrantBootstrap: async (...args) => { minted.push(args); return token; },
    },
    dispatchQueueStore: {
      ...BASE_DEPS().dispatchQueueStore,
      addItem: async (urlKey, item) => { enqueued.push(item); return { _id: `d${enqueued.length}`, ...item }; },
    },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
  });
  return { app, enqueued, minted };
}

describe('LIN-3931 — prose-harness runs are refused before minting when the origin is unresolved', () => {
  let savedPublicOrigin;
  beforeEach(() => {
    savedPublicOrigin = process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.EMAIL_LINK_ORIGIN;
  });
  afterEach(() => {
    if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
  });

  test('a prose harness run with no Host is refused: nothing minted, nothing enqueued, no http://undefined', async () => {
    const { app, enqueued, minted } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', RUN_PATH, { body: { prompt: 'Tidy the docs', harness: 'opencode' } });

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, ORIGIN_EXPECTED_CODE);
    assert.equal(r.body.retryable, false);
    assert.match(r.body.error, /PUBLIC_ORIGIN/);
    assert.equal(enqueued.length, 0, 'nothing enqueued');
    assert.equal(minted.length, 0, 'nothing minted');
    assert.doesNotMatch(JSON.stringify(r.body), /undefined/);
  });

  test('with PUBLIC_ORIGIN set, the same prose run launches and embeds the configured origin', async () => {
    process.env.PUBLIC_ORIGIN = 'https://harbour.example';
    const { app, enqueued } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', RUN_PATH, { body: { prompt: 'Tidy the docs', harness: 'opencode' } });

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(enqueued.length, 1);
    assert.match(enqueued[0].prompt, /https:\/\/harbour\.example\/api\/proxy\/token/);
    assert.doesNotMatch(enqueued[0].prompt, /http:\/\/undefined/);
  });

  test('control: a claude-code (MCP) run with no Host still launches, with a clean prompt and a minted token', async () => {
    const { app, enqueued, minted } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', RUN_PATH, { body: { prompt: 'Tidy the docs', harness: 'claude-code' } });

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(enqueued.length, 1);
    assert.equal(minted.length, 1, 'the bootstrap is minted');
    assert.doesNotMatch(enqueued[0].prompt, /undefined/);
  });

  test('control: a prose run that opts out of the proxy block embeds no origin, so it launches with no Host', async () => {
    const { app, enqueued, minted } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', RUN_PATH, { body: { prompt: 'Tidy the docs', harness: 'opencode', appendProxyContext: false } });

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(enqueued.length, 1);
    assert.equal(minted.length, 0);
    assert.equal(enqueued[0].prompt, 'Tidy the docs');
  });

  test('recommend-and-dispatch with a pinned kind, prose harness and no Host is refused the same way', async () => {
    const { app, enqueued, minted } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', RECOMMEND_PATH, { body: { issueIdentifier: 'TEST-1', kind: 'implementation', harness: 'opencode' } });

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, ORIGIN_EXPECTED_CODE);
    assert.equal(r.body.retryable, false);
    assert.equal(enqueued.length, 0, 'nothing enqueued');
    assert.equal(minted.length, 0, 'nothing minted');
  });

  test('control: recommend-and-dispatch on the claude-code harness still launches with no Host', async () => {
    const { app, enqueued, minted } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', RECOMMEND_PATH, { body: { issueIdentifier: 'TEST-1', kind: 'implementation', harness: 'claude-code' } });

    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(enqueued.length, 1);
    assert.equal(minted.length, 1);
  });

  test('control: an abort with no Host is never refused, whatever the harness', async () => {
    const { app, enqueued } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', RUN_PATH, { body: { abort: true, abortTo: '6f1c2b3a-0d4e-4f5a-9b8c-7d6e5f4a3b2c', harness: 'opencode' } });

    assert.notEqual(r.body?.code, ORIGIN_EXPECTED_CODE, JSON.stringify(r.body));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(enqueued.length, 1);
  });
});

describe('LIN-3931 — the autopilot kickoff is refused with no Host, since it always embeds the origin', () => {
  let savedPublicOrigin;
  beforeEach(() => {
    savedPublicOrigin = process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.EMAIL_LINK_ORIGIN;
  });
  afterEach(() => {
    if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
  });

  test('POST kickoff with no Host is refused even on the claude-code harness: nothing minted, nothing enqueued', async () => {
    const { app, enqueued, minted } = proxyApp();

    const r = await requestWithoutHost(app, 'POST', KICKOFF_PATH, { body: { goal: 'Tidy the docs', harness: 'claude-code' } });

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, ORIGIN_EXPECTED_CODE);
    assert.equal(r.body.retryable, false);
    assert.equal(enqueued.length, 0, 'nothing enqueued');
    assert.equal(minted.length, 0, 'nothing minted');
  });

  test('GET kickoff preview with no Host is refused as JSON, not served as text with http://undefined', async () => {
    const { app } = proxyApp();

    const r = await requestWithoutHost(app, 'GET', `${KICKOFF_PATH}?goal=Tidy`);

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, ORIGIN_EXPECTED_CODE);
    assert.equal(r.body.retryable, false);
    assert.doesNotMatch(String(r.body.error), /http/);
  });

  test('GET kickoff preview with PUBLIC_ORIGIN set serves the kickoff on the configured origin', async () => {
    process.env.PUBLIC_ORIGIN = 'https://harbour.example';
    const { app } = proxyApp();

    const r = await requestWithoutHost(app, 'GET', `${KICKOFF_PATH}?goal=Tidy`);

    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body, /https:\/\/harbour\.example\/api\/proxy/);
    assert.doesNotMatch(r.body, /http:\/\/undefined/);
  });
});

describe('LIN-3931 — the runner prompt is refused with no Host, since it hands the runner its callback base', () => {
  let savedPublicOrigin;
  beforeEach(() => {
    savedPublicOrigin = process.env.PUBLIC_ORIGIN;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.EMAIL_LINK_ORIGIN;
  });
  afterEach(() => {
    if (savedPublicOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = savedPublicOrigin;
  });

  test('GET runner prompt with no Host is refused as JSON, not served with http://undefined as its base', async () => {
    const { app } = proxyApp();

    const r = await requestWithoutHost(app, 'GET', RUNNER_PROMPT_PATH);

    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body.code, ORIGIN_EXPECTED_CODE);
    assert.equal(r.body.retryable, false);
  });

  test('GET runner prompt with PUBLIC_ORIGIN set serves the prompt on the configured origin', async () => {
    process.env.PUBLIC_ORIGIN = 'https://harbour.example';
    const { app } = proxyApp();

    const r = await requestWithoutHost(app, 'GET', RUNNER_PROMPT_PATH);

    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body, /https:\/\/harbour\.example\/runner-kit\/runner\.mjs/);
  });

  test('control: a Host-bearing GET still serves the runner prompt (the existing behaviour)', async () => {
    const { app } = proxyApp();

    const r = await call(app, 'GET', RUNNER_PROMPT_PATH);

    assert.equal(r.status, 200);
    assert.match(r.body, /http:\/\/127\.0\.0\.1:\d+\/runner-kit\/runner\.mjs/);
  });
});
