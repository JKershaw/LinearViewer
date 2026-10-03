/**
 * The brief writer's switch reaches every surface that hands out a stage prompt
 * (LIN-3293 wiring). Before this, only the proxy recommend path (computeRecommendation)
 * read the workspace's experimental `briefWriter` feature; the UI's Recommend (the SSE
 * stream and the buffered GET), the UI's stage buttons, and the two pinned-stage proxy
 * verbs (GET recommend ?kind= and recommend-and-dispatch with `kind`) took the old
 * single-call path, so the setting had holes.
 *
 * Routed surfaces: with the switch on, a routing call and then the writer. Pinned
 * surfaces (stage chosen up front, no routing call): the writer only, and with the
 * switch off no model call at all, byte for byte today's prompt. A free-tier caller
 * is charged the prompt safety-net unit on a pinned surface only when the writer
 * actually runs. A client that hangs up aborts the model calls; recommend-and-
 * dispatch never enqueues for a client that left before the enqueue, and never
 * abandons an enqueue that had started.
 *
 * GET /api/proxy/issues/:id/prompt/:templateKey stays deterministic on purpose: no
 * dispatch, autopilot or lane path fetches the prompt an agent runs from it.
 *
 * OpenRouter is captured at the fetch boundary (setFetchImpl). Servers bind 127.0.0.1.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { formatStageContract } from '../../lib/prompt-contract.js';

before(() => { process.env.NODE_ENV = 'test'; });

const PROVIDER = 'lin3293-wiring-fake';
const LEAF = {
  id: 'w-leaf-1', identifier: 'WR-1', title: 'Leaf task for the writer wiring',
  description: 'Body.', state: { name: 'In Progress', type: 'started' }, labels: [],
  createdAt: '2026-06-01T00:00:00.000Z', url: 'https://example.test/WR-1'
};
const CHILD = {
  id: 'w-child-2', identifier: 'WR-3', title: 'Child task of the container',
  description: 'Child body.', state: { name: 'Todo', type: 'unstarted' }, labels: [],
  createdAt: '2026-06-01T00:00:00.000Z', url: 'https://example.test/WR-3'
};
const PARENT = {
  id: 'w-parent-2', identifier: 'WR-2', title: 'Container task',
  description: 'Parent body.', state: { name: 'In Progress', type: 'started' }, labels: [],
  createdAt: '2026-06-01T00:00:00.000Z', url: 'https://example.test/WR-2'
};
const childRef = { id: CHILD.id, identifier: CHILD.identifier, title: CHILD.title, state: CHILD.state };
const ctxOf = (issue, extra = {}) => ({ issue, parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null, attachments: [], ...extra });
const CONTEXTS = {
  [LEAF.id]: ctxOf(LEAF), [LEAF.identifier]: ctxOf(LEAF),
  [PARENT.id]: ctxOf(PARENT, { children: [childRef], focusedChild: childRef }), [PARENT.identifier]: ctxOf(PARENT, { children: [childRef], focusedChild: childRef }),
  [CHILD.id]: ctxOf(CHILD), [CHILD.identifier]: ctxOf(CHILD)
};
const contextFor = (id) => {
  if (id === 'WR-401') throw Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
  const ctx = CONTEXTS[id];
  if (!ctx) throw new Error(`Issue not found: ${id}`);
  return ctx;
};

const ROUTING = '## Reasoning\n**Assessment:**\n- Ready: ✓ Yes - built\n→ **review**\n**Next:** close-out';
const DEFER = `## Reasoning\nWR-2 is a container.\n→ **defer**\n**DeferTo:** ${CHILD.identifier}`;
const BRIEF = '## Goal\n\nA plain written brief.';
const PROVIDER_UI = { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' };
const isWriterCall = (content) => content.startsWith('You are writing the brief');

// The repo inventory read recommend-and-dispatch makes just before its enqueue
// (validateDispatchRepo). A test can hold it open to land a hang-up in the gap
// between the writer finishing and the enqueue starting; it then fails, which the
// guard treats as "no inventory, accept the repo".
let inventoryHold = null;
// The issue context read; a test can delay it so a keepalive armed with a past
// X-Request-Start flushes before the route replies.
let contextDelayMs = 0;
// The creator's OpenRouter key read, the proxy route's first await after auth: a
// test can hold it open to land a hang-up before the route arms its signal.
let keyHold = null;
registerProvider({
  name: PROVIDER,
  ui: { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' },
  supports: () => true,
  async fetchRecommendationContext(_scope, id) { if (contextDelayMs) await new Promise(r => setTimeout(r, contextDelayMs)); return contextFor(id); },
  async fetchIssueContext(_scope, id) { if (contextDelayMs) await new Promise(r => setTimeout(r, contextDelayMs)); return contextFor(id); },
  async fetchProjectsList() { if (inventoryHold) await inventoryHold(); throw new Error('no inventory'); }
});

/** A canned OpenRouter reply usable by both the buffered and the streaming reader. */
function reply(text) {
  const enc = new TextEncoder();
  const blocks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 3 } })}\n\n`,
    'data: [DONE]\n\n'
  ];
  return {
    ok: true,
    body: (async function* () { for (const b of blocks) yield enc.encode(b); })(),
    json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } })
  };
}

/**
 * Capture every OpenRouter call. `hold` (optional) decides, per call, to hold the
 * reply until the call's signal aborts (or `releaseMs` passes).
 */
function capture({ hold = () => false, releaseMs = 3000, onCall = () => {} } = {}) {
  const calls = [];
  setFetchImpl(async (url, opts = {}) => {
    const content = JSON.parse(opts.body).messages[0].content;
    // abortedAtStart: the call never reached the wire (real fetch refuses an aborted signal).
    const call = { isWriter: isWriterCall(content), content, signal: opts.signal, abortedAt: null, abortedAtStart: !!opts.signal?.aborted };
    calls.push(call);
    onCall(call);
    let text;
    if (call.isWriter) text = BRIEF;
    else if (content.includes(PARENT.description)) text = DEFER;
    else text = ROUTING;
    if (hold(call)) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, releaseMs);
        opts.signal?.addEventListener('abort', () => {
          call.abortedAt = Date.now();
          clearTimeout(timer);
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    return reply(text);
  });
  return calls;
}

afterEach(() => { setFetchImpl(null); });

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  const restore = () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  return Promise.resolve().then(fn).finally(restore);
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  };
}

async function request(app, path, { method = 'GET', body, headers = {} } = {}) {
  const srv = await listen(app);
  try {
    const opts = { method, headers: { Authorization: 'Bearer anything', ...headers } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(`${srv.base}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text, contentType: res.headers.get('content-type') };
  } finally {
    await srv.close();
  }
}

const waitFor = async (predicate, ms = 2000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (predicate()) return true; await new Promise(r => setTimeout(r, 10)); }
  return predicate();
};

// ── Proxy app ───────────────────────────────────────────────────────────────

function buildProxyApp({ features = {}, openRouterKey = 'sk-test-key', freeTier = { count: 0, allowed: true }, addItem, events = [] } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async (e) => { events.push(e); } },
    resolveWorkspaceAccess: async () => ({ token: 'live-access-token', reason: 'ok', provider: PROVIDER }),
    getWorkspaceAccessToken: async () => 'live-access-token',
    getWorkspaceOpenRouterKey: async () => { if (keyHold) await keyHold(); return openRouterKey; },
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: addItem || (async (urlKey, item) => ({ _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }))
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async (urlKey) => (urlKey === 'acme' ? { features } : {}) },
    // tryUse is the prompt safety-net charge; checkRun the free-tier run gate at the enqueue.
    freeTierStore: {
      tryUse: async () => { freeTier.count++; return { allowed: freeTier.allowed, reason: 'limit', remaining: 0, limit: 1, resetsAt: null }; },
      checkRun: async () => ({ allowed: true, runsUsed: 0, limit: 10, remaining: 10, resetsAt: null })
    }
  }));
  return app;
}

// ── Workspace (UI) app ──────────────────────────────────────────────────────

function buildUiApp({ features = {}, sessionKey = 'sk-test', freeTier = { count: 0, allowed: true }, responses = [] } = {}) {
  const app = express();
  app.use(express.json());
  // The UI routes keep no event log: a test reads the status a route set on its
  // response, even one it set after the client had gone.
  app.use((req, res, next) => { responses.push(res); next(); });
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER, accessToken: 'ws-token' };
      req.session = { openRouterApiKey: sessionKey, features: {} };
      next();
    },
    freeTierStore: { tryUse: async () => { freeTier.count++; if (freeTier.hold) await freeTier.hold(); return { allowed: freeTier.allowed, reason: 'limit', remaining: 0, limit: 1, resetsAt: null }; } },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({ features }) },
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    agentStatusStore: {},
    promptTraceStore: {}
  }));
  return app;
}

function sseEvents(text) {
  return text.split('\n\n').filter(Boolean).map(block => {
    let type = 'message'; let data = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) type = line.slice(7);
      else if (line.startsWith('data: ')) data = JSON.parse(line.slice(6));
    }
    return { type, data };
  });
}
const streamedPrompt = (events) => events.filter(e => e.type === 'delta' && e.data?.section === 'prompt').map(e => e.data.content).join('');

// ── Routed surfaces ─────────────────────────────────────────────────────────

describe('UI Recommend honours the briefWriter switch (routed)', () => {
  test('stream, leaf, switch on: routing call then writer; a writing phase, then the written prompt', async () => {
    const calls = capture();
    const { status, text } = await request(buildUiApp({ features: { briefWriter: true } }), `/workspace/acme/api/recommend/${LEAF.id}/stream`);
    assert.equal(status, 200);
    const events = sseEvents(text);
    assert.deepEqual(calls.map(c => c.isWriter), [false, true]);
    assert.ok(events.some(e => e.type === 'phase' && e.data.phase === 'writing'), 'the wait for the writer is announced');
    const prompt = streamedPrompt(events);
    assert.ok(prompt.startsWith('# Review WR-1'), prompt.slice(0, 80));
    assert.ok(prompt.includes(BRIEF + '\n\n## Scope and Authority'));
    assert.equal(prompt.split(formatStageContract('review', LEAF.identifier)).length, 2);
    assert.equal(events.at(-1).type, 'done');
  });

  test('stream, leaf, switch off: one call and no writing phase', async () => {
    const calls = capture();
    const { text } = await request(buildUiApp({ features: {} }), `/workspace/acme/api/recommend/${LEAF.id}/stream`);
    assert.deepEqual(calls.map(c => c.isWriter), [false]);
    assert.ok(!sseEvents(text).some(e => e.type === 'phase' && e.data.phase === 'writing'));
  });

  test('stream, container descent, switch on: the terminal hop is written', async () => {
    const calls = capture();
    const { text } = await request(buildUiApp({ features: { briefWriter: true } }), `/workspace/acme/api/recommend/${PARENT.id}/stream`);
    const events = sseEvents(text);
    assert.deepEqual(calls.map(c => c.isWriter), [false, false, true], text.slice(0, 400));
    assert.ok(streamedPrompt(events).includes(BRIEF));
    const done = events.find(e => e.type === 'done');
    assert.equal(done?.data.identifier, CHILD.identifier);
  });

  test('buffered GET, switch on: routing call then writer', async () => {
    const calls = capture();
    const { status, body } = await request(buildUiApp({ features: { briefWriter: true } }), `/workspace/acme/api/recommend/${LEAF.id}`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(calls.map(c => c.isWriter), [false, true]);
    assert.ok(body.prompt.includes(BRIEF));
  });

  test('stream: a client hang-up aborts the in-flight model call', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    const calls = capture({ hold: (c) => !c.isWriter, onCall: (c) => { if (!c.isWriter) started(); } });
    const srv = await listen(buildUiApp({ features: { briefWriter: true } }));
    try {
      const ac = new AbortController();
      const pending = fetch(`${srv.base}/workspace/acme/api/recommend/${LEAF.id}/stream`, { signal: ac.signal }).then(r => r.text()).catch(() => null);
      await routingStarted;
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => calls[0].abortedAt != null), 'the routing call saw the abort');
      assert.deepEqual(calls.map(c => c.isWriter), [false], 'no writer call after the client left');
    } finally {
      await srv.close();
    }
  });

  test('stream: a client that left during the free-tier gate, before the stream began, gets no model call', async () => {
    await withEnv({ OPENROUTER_API_KEY: null, OPENROUTER_FREE_TIER_KEY: 'sk-free' }, async () => {
      const calls = capture();
      let held;
      const gateStarted = new Promise(r => { held = r; });
      const freeTier = { count: 0, allowed: true, hold: async () => { held(); await new Promise(r => setTimeout(r, 300)); } };
      const srv = await listen(buildUiApp({ features: { briefWriter: true }, sessionKey: null, freeTier }));
      try {
        const ac = new AbortController();
        const pending = fetch(`${srv.base}/workspace/acme/api/recommend/${LEAF.id}/stream`, { signal: ac.signal }).then(r => r.text()).catch(() => null);
        await gateStarted;
        ac.abort();
        await pending;
        await new Promise(r => setTimeout(r, 600));
        assert.equal(freeTier.count, 1, 'the gate ran');
        assert.deepEqual(calls.filter(c => !c.abortedAtStart).map(c => c.isWriter), [], 'no model call reached the wire');
      } finally {
        await srv.close();
      }
    });
  });
});

// ── Pinned surfaces: UI stage buttons ───────────────────────────────────────

describe('UI stage buttons honour the briefWriter switch (pinned)', () => {
  test('switch on: the writer alone runs (no routing call), and the brief ships with its contract', async () => {
    const calls = capture();
    const { status, body } = await request(buildUiApp({ features: { briefWriter: true } }), `/workspace/acme/api/prompt/${LEAF.id}/review`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(calls.map(c => c.isWriter), [true]);
    assert.ok(body.prompt.startsWith('# Review WR-1'));
    assert.ok(body.prompt.includes(BRIEF + '\n\n## Scope and Authority'));
    assert.equal(body.prompt.split(formatStageContract('review', LEAF.identifier)).length, 2);
  });

  test('switch off: no model call, byte for byte the handwritten prompt', async () => {
    const calls = capture();
    const { body } = await request(buildUiApp({ features: {} }), `/workspace/acme/api/prompt/${LEAF.id}/review`);
    assert.equal(calls.length, 0);
    const providerUi = { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' };
    assert.equal(body.prompt, generatePrompt('review', LEAF, ctxOf(LEAF), {}, providerUi).prompt);
  });

  test('free tier: charged only when the writer runs; a refused charge is a clean 429', async () => {
    await withEnv({ OPENROUTER_API_KEY: null, OPENROUTER_FREE_TIER_KEY: 'sk-free' }, async () => {
      capture();
      const off = { count: 0, allowed: true };
      await request(buildUiApp({ features: {}, sessionKey: null, freeTier: off }), `/workspace/acme/api/prompt/${LEAF.id}/review`);
      assert.equal(off.count, 0);
      const on = { count: 0, allowed: true };
      await request(buildUiApp({ features: { briefWriter: true }, sessionKey: null, freeTier: on }), `/workspace/acme/api/prompt/${LEAF.id}/review`);
      assert.equal(on.count, 1);
      const refused = { count: 0, allowed: false };
      const { status } = await request(buildUiApp({ features: { briefWriter: true }, sessionKey: null, freeTier: refused }), `/workspace/acme/api/prompt/${LEAF.id}/review`);
      assert.equal(status, 429);
    });
  });
});

// ── Pinned surfaces: proxy ──────────────────────────────────────────────────

describe('proxy pinned-stage verbs honour the briefWriter switch', () => {
  test('GET recommend ?kind=, switch on: the writer alone runs; override stays marked', async () => {
    const calls = capture();
    const { status, body } = await request(buildProxyApp({ features: { briefWriter: true } }), `/api/proxy/issues/${LEAF.id}/recommend?kind=review`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(calls.map(c => c.isWriter), [true]);
    assert.equal(body.override, true);
    assert.ok(body.prompt.includes(BRIEF + '\n\n## Scope and Authority'));
  });

  test('GET recommend ?kind=, switch off: no model call, no charge', async () => {
    await withEnv({ OPENROUTER_API_KEY: null, OPENROUTER_FREE_TIER_KEY: 'sk-free' }, async () => {
      const calls = capture();
      const freeTier = { count: 0, allowed: true };
      const { status } = await request(buildProxyApp({ features: {}, openRouterKey: null, freeTier }), `/api/proxy/issues/${LEAF.id}/recommend?kind=review`);
      assert.equal(status, 200);
      assert.equal(calls.length, 0);
      assert.equal(freeTier.count, 0);
    });
  });

  test('GET recommend ?kind=, switch on, free tier: charged once', async () => {
    await withEnv({ OPENROUTER_API_KEY: null, OPENROUTER_FREE_TIER_KEY: 'sk-free' }, async () => {
      capture();
      const freeTier = { count: 0, allowed: true };
      const { status } = await request(buildProxyApp({ features: { briefWriter: true }, openRouterKey: null, freeTier }), `/api/proxy/issues/${LEAF.id}/recommend?kind=review`);
      assert.equal(status, 200);
      assert.equal(freeTier.count, 1);
    });
  });

  test('GET prompt/:templateKey stays deterministic with the switch on', async () => {
    const calls = capture();
    const { status } = await request(buildProxyApp({ features: { briefWriter: true } }), `/api/proxy/issues/${LEAF.id}/prompt/review`);
    assert.equal(status, 200);
    assert.equal(calls.length, 0);
  });

  test('recommend-and-dispatch with kind, switch on: the writer alone runs and its brief is dispatched', async () => {
    const calls = capture();
    let stored = null;
    const app = buildProxyApp({ features: { briefWriter: true }, addItem: async (urlKey, item) => { stored = item; return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }; } });
    const { status, body } = await request(app, '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false } });
    assert.equal(status, 201, JSON.stringify(body));
    assert.deepEqual(calls.map(c => c.isWriter), [true]);
    assert.ok(stored.prompt.includes(BRIEF));
  });
});

// ── Client hang-ups on the proxy ────────────────────────────────────────────

describe('a client hang-up on the proxy', () => {
  test('GET recommend: aborts the in-flight routing call', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    const calls = capture({ hold: (c) => !c.isWriter, onCall: () => started() });
    const srv = await listen(buildProxyApp({ features: { briefWriter: true } }));
    try {
      const ac = new AbortController();
      const pending = fetch(`${srv.base}/api/proxy/issues/${LEAF.id}/recommend`, { headers: { Authorization: 'Bearer x' }, signal: ac.signal }).catch(() => null);
      await routingStarted;
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => calls[0].abortedAt != null), 'the routing call saw the abort');
    } finally {
      await srv.close();
    }
  });

  for (const [label, body] of [
    ['pinned (kind)', { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false }],
    ['routed', { issueIdentifier: LEAF.identifier, appendProxyContext: false }]
  ]) {
    test(`recommend-and-dispatch, ${label}: a client that left during the writer gets nothing enqueued`, async () => {
      let started;
      const writerStarted = new Promise(r => { started = r; });
      const calls = capture({ hold: (c) => c.isWriter, onCall: (c) => { if (c.isWriter) started(); } });
      let added = 0;
      const events = [];
      const srv = await listen(buildProxyApp({ features: { briefWriter: true }, events, addItem: async (urlKey, item) => { added++; return { _id: 'disp-1', ...item }; } }));
      try {
        const ac = new AbortController();
        const pending = fetch(`${srv.base}/api/proxy/recommend-and-dispatch`, {
          method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal
        }).catch(() => null);
        await writerStarted;
        ac.abort();
        await pending;
        assert.ok(await waitFor(() => calls.find(c => c.isWriter)?.abortedAt != null), 'the writer saw the abort');
        assert.ok(await waitFor(() => events.some(e => e.status === 499)), `the route recorded the hang-up: ${JSON.stringify(events.map(e => e.status))}`);
        assert.equal(added, 0, 'nothing was enqueued');
      } finally {
        await srv.close();
      }
    });

    test(`recommend-and-dispatch, ${label}: a client that left after the writer but before the enqueue gets nothing enqueued`, async () => {
      const calls = capture();
      let held;
      const inventoryStarted = new Promise(r => { held = r; });
      inventoryHold = async () => { held(); await new Promise(r => setTimeout(r, 300)); };
      let added = 0;
      const events = [];
      const srv = await listen(buildProxyApp({ features: { briefWriter: true }, events, addItem: async (urlKey, item) => { added++; return { _id: 'disp-1', ...item }; } }));
      try {
        const ac = new AbortController();
        const pending = fetch(`${srv.base}/api/proxy/recommend-and-dispatch`, {
          method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, repo: 'owner/repo' }), signal: ac.signal
        }).catch(() => null);
        await inventoryStarted;
        assert.ok(calls.some(c => c.isWriter), 'the writer had already run');
        ac.abort();
        await pending;
        assert.ok(await waitFor(() => events.some(e => e.status === 499)), `the route recorded the hang-up: ${JSON.stringify(events.map(e => e.status))}`);
        assert.equal(added, 0, 'nothing was enqueued');
      } finally {
        inventoryHold = null;
        await srv.close();
      }
    });

    test(`recommend-and-dispatch, ${label}: a client that left once the enqueue had started still gets the dispatch`, async () => {
      capture();
      let addStarted;
      const enqueueStarted = new Promise(r => { addStarted = r; });
      let added = 0;
      const events = [];
      const srv = await listen(buildProxyApp({
        features: { briefWriter: true },
        events,
        addItem: async (urlKey, item) => {
          addStarted();
          await new Promise(r => setTimeout(r, 200));
          added++;
          return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
        }
      }));
      try {
        const ac = new AbortController();
        const pending = fetch(`${srv.base}/api/proxy/recommend-and-dispatch`, {
          method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal
        }).catch(() => null);
        await enqueueStarted;
        ac.abort();
        await pending;
        assert.ok(await waitFor(() => added === 1), 'the enqueue completed');
        assert.ok(await waitFor(() => events.some(e => e.status === 201)), `the dispatch was recorded: ${JSON.stringify(events.map(e => e.status))}`);
      } finally {
        await srv.close();
      }
    });
  }
});

// ── A hang-up recorded as the client leaving, not an AI outage ──────────────

const postDispatch = (srv, body, signal) => fetch(`${srv.base}/api/proxy/recommend-and-dispatch`, {
  method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
}).catch(() => null);

describe('a client hang-up is the client leaving (499), never an AI outage (503)', () => {
  test('proxy GET recommend: a hang-up during the routing call records 499', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    capture({ hold: (c) => !c.isWriter, onCall: () => started() });
    const events = [];
    const srv = await listen(buildProxyApp({ features: {}, events }));
    try {
      const ac = new AbortController();
      const pending = fetch(`${srv.base}/api/proxy/issues/${LEAF.id}/recommend`, { headers: { Authorization: 'Bearer x' }, signal: ac.signal }).catch(() => null);
      await routingStarted;
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => events.length > 0), 'the route recorded an outcome');
      assert.deepEqual(events.map(e => e.status), [499]);
    } finally {
      await srv.close();
    }
  });

  test('routed recommend-and-dispatch, writer off: a hang-up during the routing call records 499 and enqueues nothing', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    const calls = capture({ hold: (c) => !c.isWriter, onCall: () => started() });
    let added = 0;
    const events = [];
    const srv = await listen(buildProxyApp({ features: {}, events, addItem: async (urlKey, item) => { added++; return { _id: 'disp-1', ...item }; } }));
    try {
      const ac = new AbortController();
      const pending = postDispatch(srv, { issueIdentifier: LEAF.identifier, appendProxyContext: false }, ac.signal);
      await routingStarted;
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => events.length > 0), 'the route recorded an outcome');
      assert.deepEqual(events.map(e => e.status), [499]);
      assert.ok(calls[0].abortedAt != null, 'the routing call saw the abort');
      assert.equal(added, 0);
    } finally {
      await srv.close();
    }
  });

  test('UI buffered GET recommend: a hang-up during the routing call is answered 499, not 503', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    const calls = capture({ hold: (c) => !c.isWriter, onCall: () => started() });
    const responses = [];
    const srv = await listen(buildUiApp({ features: {}, responses }));
    try {
      const ac = new AbortController();
      const pending = fetch(`${srv.base}/workspace/acme/api/recommend/${LEAF.id}`, { signal: ac.signal }).catch(() => null);
      await routingStarted;
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => calls[0].abortedAt != null), 'the routing call saw the abort');
      assert.ok(await waitFor(() => responses[0]?.statusCode !== 200), 'the route answered the hang-up');
      assert.equal(responses[0].statusCode, 499);
    } finally {
      await srv.close();
    }
  });

  for (const [label, body] of [
    ['pinned (kind)', { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false }],
    ['routed', { issueIdentifier: LEAF.identifier, appendProxyContext: false }]
  ]) {
    test(`recommend-and-dispatch, ${label}: a client that left before the route armed its signal gets no model call and nothing enqueued`, async () => {
      const calls = capture();
      let held;
      const keyReadStarted = new Promise(r => { held = r; });
      keyHold = async () => { held(); await new Promise(r => setTimeout(r, 300)); };
      let added = 0;
      const events = [];
      const srv = await listen(buildProxyApp({ features: { briefWriter: true }, events, addItem: async (urlKey, item) => { added++; return { _id: 'disp-1', ...item }; } }));
      try {
        const ac = new AbortController();
        const pending = postDispatch(srv, body, ac.signal);
        await keyReadStarted;
        ac.abort();
        await pending;
        assert.ok(await waitFor(() => events.length > 0), 'the route recorded an outcome');
        assert.deepEqual(events.map(e => e.status), [499]);
        assert.deepEqual(calls.filter(c => !c.abortedAtStart).map(c => c.isWriter), [], 'no model call reached the wire');
        assert.equal(added, 0, 'nothing was enqueued');
      } finally {
        keyHold = null;
        await srv.close();
      }
    });
  }
});

// ── After the keepalive has flushed ─────────────────────────────────────────
//
// A past X-Request-Start puts the request beyond the keepalive's first-byte target,
// so armKeepalive flushes at once; the issue read is delayed a little so the flush
// lands before the route replies. From then on the HTTP status is a committed 200
// and the real one rides in the body as `statusCode`.

const PAST = () => ({ 'X-Request-Start': String(Date.now() - 25_000) });

describe('after the keepalive has flushed', () => {
  afterEach(() => { contextDelayMs = 0; });

  test('UI stage button, writer on: a missing issue is a 200 carrying statusCode 404', async () => {
    capture();
    contextDelayMs = 50;
    const { status, body, text } = await request(buildUiApp({ features: { briefWriter: true } }), '/workspace/acme/api/prompt/WR-404/review', { headers: PAST() });
    assert.equal(status, 200);
    assert.ok(text.startsWith(' '), 'the keepalive had flushed');
    assert.deepEqual(body, { error: 'Issue not found: WR-404', statusCode: 404 });
  });

  test('UI stage button, writer on: ?format=md after the flush still sends the prompt bytes', async () => {
    capture();
    contextDelayMs = 50;
    const { status, text, contentType } = await request(buildUiApp({ features: { briefWriter: true } }), `/workspace/acme/api/prompt/${LEAF.id}/review?format=md`, { headers: PAST() });
    assert.equal(status, 200);
    assert.match(contentType, /application\/json/, 'the flush committed the JSON headers');
    assert.ok(text.startsWith(' # Review WR-1'), text.slice(0, 40));
    assert.ok(text.includes(BRIEF + '\n\n## Scope and Authority'));
  });

  test('recommend-and-dispatch with kind: the 201 rides in a 200 as statusCode', async () => {
    capture();
    contextDelayMs = 50;
    const { status, body } = await request(buildProxyApp({ features: { briefWriter: true } }), '/api/proxy/recommend-and-dispatch', {
      method: 'POST', headers: PAST(), body: { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false }
    });
    assert.equal(status, 200);
    assert.equal(body.statusCode, 201);
    assert.equal(body.success, true);
    assert.equal(body.override, true);
  });

  test('recommend-and-dispatch with kind: a missing issue is a 200 carrying statusCode 404', async () => {
    capture();
    contextDelayMs = 50;
    const { status, body } = await request(buildProxyApp({ features: { briefWriter: true } }), '/api/proxy/recommend-and-dispatch', {
      method: 'POST', headers: PAST(), body: { issueIdentifier: 'WR-404', kind: 'review', appendProxyContext: false }
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { error: 'Issue not found', statusCode: 404 });
  });

  // The UI's readers, through the REAL window.api from public/common.js against the
  // live route: the only fabricated piece is the fetch shim, which resolves the
  // origin-relative URL and adds the past router stamp.
  function loadApi(origin) {
    const window = { location: { href: '' }, addEventListener() {} };
    const sandbox = {
      window, console, setTimeout, clearTimeout, URLSearchParams,
      document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
      localStorage: { getItem: () => null, setItem() {} },
      navigator: {},
      fetch: (url, opts = {}) => globalThis.fetch(new URL(url, origin), { ...opts, headers: { ...(opts.headers || {}), ...PAST() } })
    };
    vm.runInContext(readFileSync(new URL('../../public/common.js', import.meta.url), 'utf8'), vm.createContext(sandbox));
    return window;
  }

  test('UI reader (statusInBody): a flushed 404 rejects with the real status', async () => {
    capture();
    contextDelayMs = 50;
    const srv = await listen(buildUiApp({ features: { briefWriter: true } }));
    try {
      const window = loadApi(srv.base);
      await assert.rejects(
        window.api('/workspace/acme/api/prompt/WR-404/review', { on401: false, statusInBody: true }),
        (err) => err.status === 404 && err.message === 'Issue not found: WR-404'
      );
      // Without the opt-in the same reply would read as a prompt.
      const plain = await window.api('/workspace/acme/api/prompt/WR-404/review', { on401: false });
      assert.equal(plain.statusCode, 404);
    } finally {
      await srv.close();
    }
  });

  test('UI reader (statusInBody): a flushed 401 still sends the user to /logout', async () => {
    capture();
    contextDelayMs = 50;
    const srv = await listen(buildUiApp({ features: { briefWriter: true } }));
    try {
      const window = loadApi(srv.base);
      await assert.rejects(window.api('/workspace/acme/api/prompt/WR-401/close-out', { statusInBody: true }), (err) => err.status === 401);
      assert.equal(window.location.href, '/logout');
    } finally {
      await srv.close();
    }
  });

  test('both stage-prompt readers opt in to statusInBody', () => {
    const read = (f) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8');
    assert.match(read('prompt-section.js'), /window\.api\(`\$\{apiPrefix\}\/api\/prompt\/[^\n]*statusInBody: true/, 'prompt-section.js stage button');
    assert.match(read('session.js'), /'\/api\/prompt\/' \+ encodeURIComponent\(ctx\.issueId\) \+ '\/close-out',\s*\{ statusInBody: true \}/, 'session.js close-out button (default on401: /logout)');
  });
});

// ── Writer off: the pinned dispatch is exactly as before ────────────────────

describe('recommend-and-dispatch with kind, writer off', () => {
  test('201, no model call, no charge, and the stored prompt is generatePrompt byte for byte', async () => {
    await withEnv({ OPENROUTER_API_KEY: null, OPENROUTER_FREE_TIER_KEY: 'sk-free' }, async () => {
      const calls = capture();
      const freeTier = { count: 0, allowed: true };
      let stored = null;
      const app = buildProxyApp({ features: {}, openRouterKey: null, freeTier, addItem: async (urlKey, item) => { stored = item; return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }; } });
      const { status, body, text } = await request(app, '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false } });
      assert.equal(status, 201, text);
      assert.equal(body.statusCode, undefined);
      assert.equal(text.startsWith(' '), false, 'no keepalive bytes');
      assert.equal(calls.length, 0);
      assert.equal(freeTier.count, 0);
      assert.equal(stored.prompt, generatePrompt('review', LEAF, ctxOf(LEAF), {}, PROVIDER_UI).prompt);
    });
  });
});
