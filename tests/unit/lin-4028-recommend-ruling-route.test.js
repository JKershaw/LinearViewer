/**
 * LIN-4028: POST /api/proxy/recommend-and-dispatch honours a recorded routing ruling on the task, on BOTH
 * arms, through the real route and the real resolver. The store is a fake that serves one task's rows:
 * a DECISION whose chosen option pins a model and effort, and its `decision-answer` stamp.
 *
 * Witnesses, each shown red before the change and green after:
 *  - the verb-override arm (`kind` set) enqueues on the pinned model and effort, and the 201 says the
 *    model came from a ruling;
 *  - the descent arm (no `kind`) does the same for the terminal task it resolves;
 *  - an explicit `model` in the body still wins, and says so;
 *  - a ruling that names another harness than the body's is skipped, and the dispatch routes as today;
 *  - a ruling recorded onto another issue does not pin this task.
 *
 * Run with: node --test tests/unit/lin-4028-recommend-ruling-route.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const ROUTED = [
  { id: 'opus-custom', label: 'Dispatch as kind custom (opus/high)', routing: { model: 'opus', effort: 'high' } },
  { id: 'keep', label: 'Keep the default' }
];

const decisionEntry = (options, extra = {}) => ({
  kind: 'decision',
  message: `[decision] ${JSON.stringify({ decision_id: 'lin4023-writer-model', question: 'Who writes it?', options, ...extra })}`,
  timestamp: '2026-10-29T10:00:00.000Z'
});

const answerEntry = (optionId) => ({
  kind: 'decision-answer',
  message: JSON.stringify({ decision_id: 'lin4023-writer-model', option_id: optionId }),
  timestamp: '2026-10-29T11:00:00.000Z'
});

// One task's history: the answered ruling on TEST-1 itself.
function rulingRows({ options = ROUTED, optionId = 'opus-custom', issueIdentifier = 'TEST-1', extra = {} } = {}) {
  return [{
    id: 'row-decision',
    issueIdentifier,
    dispatchedAt: '2026-10-29T09:00:00.000Z',
    resolvedAt: '2026-10-29T09:30:00.000Z',
    status: 'done',
    kind: 'implementation',
    feedback: [decisionEntry(options, extra), answerEntry(optionId)]
  }];
}

function buildApp(captured, { historyRows = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        grants: ['dispatch'], workspaceId: 'ws-acme',
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      // The task's rows, as the store serves them for an issue read. The ruling's stamp is in history.
      listItems: async () => [],
      listHistory: async (_urlKey, opts) => ({
        items: historyRows.filter(r => !opts?.issueIdentifier || r.issueIdentifier === opts.issueIdentifier),
        total: historyRows.length
      }),
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-10-30T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
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

const OVERRIDE = { issueIdentifier: 'TEST-1', kind: 'implementation' };

describe('verb-override arm — a ruling pins the model and effort the body does not name (LIN-4028)', () => {
  test('dispatches on the pinned model and effort, and the receipt says the model came from a ruling', async () => {
    const captured = {};
    const res = await call(buildApp(captured, { historyRows: rulingRows() }), 'post', '/api/proxy/recommend-and-dispatch', OVERRIDE);

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.model, 'opus');
    assert.equal(captured.item.effort, 'high');
    assert.equal(res.body.routing.model, 'opus');
    assert.equal(res.body.routing.sources.model, 'ruling');
    assert.equal(res.body.routing.sources.effort, 'ruling');
  });

  test('an explicit model in the body still wins over the ruling, and says so', async () => {
    const captured = {};
    const res = await call(buildApp(captured, { historyRows: rulingRows() }), 'post', '/api/proxy/recommend-and-dispatch', { ...OVERRIDE, model: 'sonnet-5-5' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.model, 'sonnet-5-5');
    assert.equal(res.body.routing.sources.model, 'explicit');
    assert.equal(captured.item.effort, 'high', 'the ruling still answers the effort the body leaves open');
  });

  test('a ruling naming another harness than the body\'s is skipped, and the dispatch routes as it did before', async () => {
    const captured = {};
    const rows = rulingRows({
      options: [{ id: 'other', label: 'Other runner', routing: { harness: 'opencode', model: 'deepseek-v4-pro' } }],
      optionId: 'other'
    });
    const res = await call(buildApp(captured, { historyRows: rows }), 'post', '/api/proxy/recommend-and-dispatch', { ...OVERRIDE, harness: 'claude-code' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.harness, 'claude-code');
    assert.notEqual(captured.item.model, 'deepseek-v4-pro');
    assert.notEqual(res.body.routing.sources.model, 'ruling');
  });

  test('a ruling recorded onto another issue does not pin this task', async () => {
    const captured = {};
    const rows = rulingRows({ extra: { on_answer: { record_on: 'LIN-9999' } } });
    const res = await call(buildApp(captured, { historyRows: rows }), 'post', '/api/proxy/recommend-and-dispatch', OVERRIDE);

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.notEqual(captured.item.model, 'opus');
    assert.notEqual(res.body.routing.sources.model, 'ruling');
  });

  test('a task with no ruling routes exactly as today, and reports no ruling source', async () => {
    const captured = {};
    const res = await call(buildApp(captured, { historyRows: [] }), 'post', '/api/proxy/recommend-and-dispatch', OVERRIDE);

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.notEqual(captured.item.model, 'opus');
    assert.notEqual(res.body.routing.sources.model, 'ruling');
    assert.notEqual(res.body.routing.sources.effort, 'ruling');
  });
});

describe('descent arm — the same ruling pins the terminal task the descent resolves (LIN-4028)', () => {
  // The test-mode recommender descends TEST-1 (a container) to TEST-2 (the work). The pin is read for the
  // terminal task, so the ruling sits on TEST-2's own rows.
  test('a dispatch with no kind pins the model and effort from a ruling on the terminal task it resolves to', async () => {
    const captured = {};
    const rows = rulingRows({ issueIdentifier: 'TEST-2' });
    const res = await call(buildApp(captured, { historyRows: rows }), 'post', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.issueIdentifier, 'TEST-2');
    assert.equal(captured.item.model, 'opus');
    assert.equal(captured.item.effort, 'high');
    assert.equal(res.body.routing.sources.model, 'ruling');
  });

  test('a ruling on the container the descent starts from does not pin the work it descends to', async () => {
    const captured = {};
    const res = await call(buildApp(captured, { historyRows: rulingRows({ issueIdentifier: 'TEST-1' }) }), 'post', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.issueIdentifier, 'TEST-2');
    assert.notEqual(captured.item.model, 'opus');
    assert.notEqual(res.body.routing.sources.model, 'ruling');
  });
});
