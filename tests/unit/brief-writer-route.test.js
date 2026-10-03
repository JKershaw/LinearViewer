/**
 * LIN-3293: the proxy recommend route (computeRecommendation, shared by GET
 * /recommend and the fused recommend-and-dispatch verb) turns the brief writer on
 * from HARBOUR_BRIEF_WRITER, per workspace, and off again. Mounted on the real
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
const BRIEF = '# Review WR-1: Leaf task for the writer route\n\nA plain brief.';

function buildApp() {
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
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
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

const saved = process.env.HARBOUR_BRIEF_WRITER;
afterEach(() => {
  setFetchImpl(null);
  if (saved === undefined) delete process.env.HARBOUR_BRIEF_WRITER; else process.env.HARBOUR_BRIEF_WRITER = saved;
});

describe('the recommend route and the brief writer switch (LIN-3293)', () => {
  test('switch off: one call, the meta body ships with its contract', async () => {
    delete process.env.HARBOUR_BRIEF_WRITER;
    const guard = guardNetwork();
    try {
      const calls = capture();
      const { status, body } = await recommend(buildApp());
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(calls.length, 1);
      assert.ok(body.prompt.startsWith('META BODY' + formatStageContract('review', ISSUE.identifier)));
    } finally {
      guard.restore();
      assert.equal(guard.attempts.length, 0);
    }
  });

  test('switch on for this workspace: a routing call, then the writer; the brief ships with its contract', async () => {
    process.env.HARBOUR_BRIEF_WRITER = 'acme';
    const guard = guardNetwork();
    try {
      const calls = capture();
      const { status, body } = await recommend(buildApp());
      assert.equal(status, 200, JSON.stringify(body));
      assert.deepEqual(calls.map(c => c.isWriter), [false, true]);
      assert.ok(body.prompt.startsWith(BRIEF + formatStageContract('review', ISSUE.identifier)));
    } finally {
      guard.restore();
      assert.equal(guard.attempts.length, 0);
    }
  });

  test('switch on for another workspace only: this one stays on today\'s path', async () => {
    process.env.HARBOUR_BRIEF_WRITER = 'other-workspace';
    const calls = capture();
    const { body } = await recommend(buildApp());
    assert.equal(calls.length, 1);
    assert.ok(body.prompt.startsWith('META BODY'));
  });
});
