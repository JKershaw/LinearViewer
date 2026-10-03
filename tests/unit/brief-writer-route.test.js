/**
 * LIN-3293: the proxy recommend route (computeRecommendation, shared by GET
 * /recommend and the fused recommend-and-dispatch verb) turns the brief writer on
 * from the workspace's experimental briefWriter feature, and off again. The route
 * runs on a proxy token with no user session, which is why the switch is a
 * workspace feature. Mounted on the real
 * routes/proxy.js with a fake provider; OpenRouter is captured at the fetch
 * boundary (setFetchImpl), as in lin-2353-recommend-llm-provider-ui.test.js.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { guardNetwork } from '../fixtures/network-guard.js';

before(() => { process.env.NODE_ENV = 'test'; });

const FAKE_PROVIDER = 'lin3293-writer-fake';
const ISSUE = {
  id: 'w-leaf-1', identifier: 'WR-1', title: 'Leaf task for the writer route',
  description: 'Body.', state: { name: 'In Progress', type: 'started' }, labels: [],
  createdAt: '2026-06-01T00:00:00.000Z'
};
const CONTEXT = { issue: ISSUE, parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null, attachments: [] };
const ROUTING = '## Reasoning\n**Assessment:**\n- Ready: ✓ Yes - built\n→ **review**\n**Next:** close-out';
const BRIEF = '## Goal\n\nA plain brief.';

function buildApp(features = {}) {
  registerProvider({
    name: FAKE_PROVIDER,
    ui: { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' },
    supports: () => true,
    async fetchRecommendationContext(_scope, issueId) {
      if (issueId !== ISSUE.id) throw new Error(`Issue not found: ${issueId}`);
      return CONTEXT;
    }
  });
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'live-access-token', reason: 'ok', provider: FAKE_PROVIDER }),
    getWorkspaceAccessToken: async () => 'live-access-token',
    getWorkspaceOpenRouterKey: async () => 'sk-test-key',
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem: async () => ({ _id: 'disp-1' }) },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async (urlKey) => (urlKey === 'acme' ? { features } : {}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function recommend(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/issues/${ISSUE.id}/recommend`, { headers: { Authorization: 'Bearer anything' } });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function capture() {
  const calls = [];
  setFetchImpl(async (url, opts = {}) => {
    const content = JSON.parse(opts.body).messages[0].content;
    const isWriter = content.startsWith('You are writing the brief');
    calls.push({ isWriter, content });
    const reply = isWriter ? BRIEF : (content.includes('## Prompt Structure') ? `${ROUTING}\n## Prompt\nMETA BODY` : ROUTING);
    return { ok: true, json: async () => ({ choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
  });
  return calls;
}

afterEach(() => { setFetchImpl(null); });

describe('the recommend route and the brief writer switch (LIN-3293)', () => {
  test('switch off: one call, the meta body ships with its contract', async () => {
    const guard = guardNetwork();
    try {
      const calls = capture();
      const { status, body } = await recommend(buildApp({ briefWriter: false }));
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(calls.length, 1);
      assert.ok(body.prompt.startsWith('META BODY' + formatStageContract('review', ISSUE.identifier)));
    } finally {
      guard.restore();
      assert.equal(guard.attempts.length, 0);
    }
  });

  test('switch on in this workspace\'s Settings: a routing call, then the writer; the brief ships with its contract', async () => {
    const guard = guardNetwork();
    try {
      const calls = capture();
      const { status, body } = await recommend(buildApp({ briefWriter: true }));
      assert.equal(status, 200, JSON.stringify(body));
      assert.deepEqual(calls.map(c => c.isWriter), [false, true]);
      assert.ok(body.prompt.includes(BRIEF + '\n\n## Scope and Authority'));
      assert.ok(body.prompt.startsWith('# Review WR-1'));
      assert.equal(body.prompt.split(formatStageContract('review', ISSUE.identifier)).length, 2);
    } finally {
      guard.restore();
      assert.equal(guard.attempts.length, 0);
    }
  });

  test('the old environment switch does nothing: the workspace feature is the only switch', async () => {
    const saved = process.env.HARBOUR_BRIEF_WRITER;
    process.env.HARBOUR_BRIEF_WRITER = 'on';
    const calls = capture();
    const { body } = await recommend(buildApp({}));
    if (saved === undefined) delete process.env.HARBOUR_BRIEF_WRITER; else process.env.HARBOUR_BRIEF_WRITER = saved;
    assert.equal(calls.length, 1);
    assert.ok(body.prompt.startsWith('META BODY'));
  });
});
