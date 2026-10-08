/**
 * One path for every recommendation (LIN-3300). Every surface that hands out a stage
 * prompt assembles it in code: generatePrompt for the stage, its fixed Goal lead
 * (STAGE_LEADS), Scope and Authority, process, contract and grounding.
 *
 * Routed surfaces (the UI's Recommend stream and buffered GET, proxy GET recommend,
 * recommend-and-dispatch): one routing call per hop picks the stage, and the prompt is
 * generatePrompt for that stage, byte for byte. Pinned surfaces (the UI's stage
 * buttons, recommend ?kind=, recommend-and-dispatch with `kind`, the proxy template
 * read): no model call and no free-tier charge. A workspace preference left over from
 * the deleted `briefWriter` experiment changes nothing.
 *
 * A client that hangs up aborts the routing call; recommend-and-dispatch never
 * enqueues for a client that left before the enqueue, and never abandons an enqueue
 * that had started.
 *
 * OpenRouter is captured at the fetch boundary (setFetchImpl). Servers bind 127.0.0.1.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { formatStageContract } from '../../lib/prompt-contract.js';

before(() => { process.env.NODE_ENV = 'test'; });

const PROVIDER = 'lin3300-one-path-fake';
const LEAF = {
  id: 'w-leaf-1', identifier: 'WR-1', title: 'Leaf task for the one-path wiring',
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
const PROVIDER_UI = { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' };
// What the deleted experiment left in a workspace's preferences: it must change nothing.
const STALE_PREFS = { briefWriter: true };
const handwritten = (kind, issue = LEAF) => generatePrompt(kind, issue, ctxOf(issue), {}, PROVIDER_UI).prompt;

// The issue-context read the pinned recommend-and-dispatch arm makes just before
// its enqueue-boundary hang-up check. A test can hold it open to land a hang-up in
// the gap between the prompt being assembled and the enqueue starting. (The routed
// arm awaits nothing between the model call and its enqueue boundary once the repo
// guard was removed — a hang-up there ends in the routing catch, covered by the
// "hang-up during the routing call" test below.)
let contextHold = null;
// The issue context read; a test can delay it so a keepalive armed with a past
// X-Request-Start flushes before the route replies.
let contextDelayMs = 0;
// The creator's OpenRouter key read, the routed proxy route's first await after auth:
// a test can hold it open to land a hang-up before the route arms its signal.
let keyHold = null;
registerProvider({
  name: PROVIDER,
  ui: { write: true, comments: true, estimates: false, subtasks: true, displayName: 'Linear' },
  supports: () => true,
  async fetchRecommendationContext(_scope, id) { if (contextDelayMs) await new Promise(r => setTimeout(r, contextDelayMs)); return contextFor(id); },
  async fetchIssueContext(_scope, id) { if (contextHold) await contextHold(); if (contextDelayMs) await new Promise(r => setTimeout(r, contextDelayMs)); return contextFor(id); }
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
    const call = { content, signal: opts.signal, abortedAt: null, abortedAtStart: !!opts.signal?.aborted };
    calls.push(call);
    onCall(call);
    const text = content.includes(PARENT.description) ? DEFER : ROUTING;
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

/** A dispatch store holding finished runs per issue (LIN-3300: the selector reads them). */
function runStore(rows) {
  return {
    listItems: async () => [],
    listHistory: async (urlKey, { issueIdentifier }) => ({ items: rows.filter(r => r.issueIdentifier === issueIdentifier) })
  };
}

function buildProxyApp({ features = {}, openRouterKey = 'sk-test-key', freeTier = { count: 0, allowed: true }, addItem, events = [], runRows = [] } = {}) {
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
      addItem: addItem || (async (urlKey, item) => ({ _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item })),
      ...runStore(runRows)
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

function buildUiApp({ features = {}, sessionKey = 'sk-test', freeTier = { count: 0, allowed: true }, responses = [], runRows = [] } = {}) {
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
    promptTraceStore: {},
    dispatchQueueStore: runStore(runRows)
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

const isRoutingPrompt = (content) => content.includes('## How to choose') && !content.includes('## Prompt Structure') && !content.includes('\n## Prompt\n');

describe('routed surfaces: one routing call, then code assembles the stage prompt', () => {
  test('UI stream, leaf: one routing call, no writing phase, the prompt is generatePrompt for the stage', async () => {
    const calls = capture();
    const { status, text } = await request(buildUiApp({ features: STALE_PREFS }), `/workspace/acme/api/recommend/${LEAF.id}/stream`);
    assert.equal(status, 200);
    const events = sseEvents(text);
    assert.equal(calls.length, 1);
    assert.ok(isRoutingPrompt(calls[0].content), 'the call is the routing prompt, with no writing blocks');
    assert.deepEqual(events.filter(e => e.type === 'phase').map(e => e.data.phase).filter(p => p !== 'fetching_context'), ['reasoning', 'prompt']);
    const prompt = streamedPrompt(events);
    assert.equal(prompt, handwritten('review'));
    assert.equal(prompt.split(formatStageContract('review', LEAF.identifier)).length, 2, 'the contract once');
    assert.equal(events.at(-1).type, 'done');
  });

  test('UI stream, container descent: a routing call per hop; the terminal hop is generatePrompt', async () => {
    const calls = capture();
    const { text } = await request(buildUiApp({ features: STALE_PREFS }), `/workspace/acme/api/recommend/${PARENT.id}/stream`);
    const events = sseEvents(text);
    assert.equal(calls.length, 2, text.slice(0, 400));
    assert.ok(calls.every(c => isRoutingPrompt(c.content)));
    assert.equal(streamedPrompt(events), handwritten('review', CHILD));
    const done = events.find(e => e.type === 'done');
    assert.equal(done?.data.identifier, CHILD.identifier);
  });

  test('UI buffered GET: one routing call; the prompt is generatePrompt', async () => {
    const calls = capture();
    const { status, body } = await request(buildUiApp({ features: STALE_PREFS }), `/workspace/acme/api/recommend/${LEAF.id}`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(calls.length, 1);
    assert.equal(body.prompt, handwritten('review'));
  });

  test('proxy GET recommend: one routing call; the prompt is generatePrompt', async () => {
    const calls = capture();
    const { status, body } = await request(buildProxyApp({ features: STALE_PREFS }), `/api/proxy/issues/${LEAF.id}/recommend`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(calls.length, 1);
    assert.ok(isRoutingPrompt(calls[0].content));
    assert.equal(body.prompt, handwritten('review'));
  });

  test('recommend-and-dispatch: one routing call; the dispatched prompt is generatePrompt', async () => {
    const calls = capture();
    let stored = null;
    const app = buildProxyApp({ features: STALE_PREFS, addItem: async (urlKey, item) => { stored = item; return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }; } });
    const { status, body } = await request(app, '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: LEAF.identifier, appendProxyContext: false } });
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(calls.length, 1);
    assert.equal(stored.prompt, handwritten('review'));
  });

  test('UI stream: a client hang-up aborts the in-flight routing call', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    const calls = capture({ hold: () => true, onCall: () => started() });
    const srv = await listen(buildUiApp({ features: {} }));
    try {
      const ac = new AbortController();
      const pending = fetch(`${srv.base}/workspace/acme/api/recommend/${LEAF.id}/stream`, { signal: ac.signal }).then(r => r.text()).catch(() => null);
      await routingStarted;
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => calls[0].abortedAt != null), 'the routing call saw the abort');
      assert.equal(calls.length, 1);
    } finally {
      await srv.close();
    }
  });

  test('UI stream: a client that left during the free-tier gate, before the stream began, gets no model call', async () => {
    await withEnv({ OPENROUTER_API_KEY: null, OPENROUTER_FREE_TIER_KEY: 'sk-free' }, async () => {
      const calls = capture();
      let held;
      const gateStarted = new Promise(r => { held = r; });
      const freeTier = { count: 0, allowed: true, hold: async () => { held(); await new Promise(r => setTimeout(r, 300)); } };
      const srv = await listen(buildUiApp({ features: {}, sessionKey: null, freeTier }));
      try {
        const ac = new AbortController();
        const pending = fetch(`${srv.base}/workspace/acme/api/recommend/${LEAF.id}/stream`, { signal: ac.signal }).then(r => r.text()).catch(() => null);
        await gateStarted;
        ac.abort();
        await pending;
        await new Promise(r => setTimeout(r, 600));
        assert.equal(freeTier.count, 1, 'the gate ran');
        assert.deepEqual(calls.filter(c => !c.abortedAtStart), [], 'no model call reached the wire');
      } finally {
        await srv.close();
      }
    });
  });
});

// ── Pinned surfaces ─────────────────────────────────────────────────────────

describe('every routed surface gives the selector the task\'s recent runs (LIN-3300)', () => {
  const planRun = (issue) => ({ issueIdentifier: issue.identifier, kind: 'plan', status: 'taken', feedback: [{ message: '[done] ok', timestamp: '2026-10-04T14:51:34.000Z' }] });
  const RUN_LINE = '  - plan: done, 2026-10-04 14:51';

  test('UI buffered GET, UI stream (leaf and each descent hop) and proxy GET recommend', async () => {
    const rows = [planRun(LEAF), planRun(PARENT), planRun(CHILD)];
    for (const [label, app, path] of [
      ['UI buffered', buildUiApp({ runRows: rows }), `/workspace/acme/api/recommend/${LEAF.id}`],
      ['UI stream leaf', buildUiApp({ runRows: rows }), `/workspace/acme/api/recommend/${LEAF.id}/stream`],
      ['UI stream descent', buildUiApp({ runRows: rows }), `/workspace/acme/api/recommend/${PARENT.id}/stream`],
      ['proxy GET', buildProxyApp({ runRows: rows }), `/api/proxy/issues/${LEAF.id}/recommend`]
    ]) {
      const calls = capture();
      await request(app, path);
      assert.ok(calls.length > 0, label);
      for (const c of calls) assert.ok(c.content.includes(RUN_LINE), `${label}: every routing call carries the run`);
    }
  });

  test('no runs, no list', async () => {
    const calls = capture();
    await request(buildUiApp(), `/workspace/acme/api/recommend/${LEAF.id}`);
    assert.ok(!calls[0].content.includes('Recent runs'));
  });
});

describe('pinned surfaces: no model call, no charge, generatePrompt byte for byte', () => {
  const free = (fn) => withEnv({ OPENROUTER_API_KEY: null, OPENROUTER_FREE_TIER_KEY: 'sk-free' }, fn);

  test('UI stage button', () => free(async () => {
    const calls = capture();
    const freeTier = { count: 0, allowed: true };
    const { status, body, text } = await request(buildUiApp({ features: STALE_PREFS, sessionKey: null, freeTier }), `/workspace/acme/api/prompt/${LEAF.id}/review`);
    assert.equal(status, 200, text);
    assert.equal(calls.length, 0);
    assert.equal(freeTier.count, 0);
    assert.equal(body.prompt, handwritten('review'));
  }));

  test('UI stage button: a missing issue is a plain 404, with no keepalive bytes', async () => {
    capture();
    const { status, body, text } = await request(buildUiApp({ features: STALE_PREFS }), '/workspace/acme/api/prompt/WR-404/review');
    assert.equal(status, 404);
    assert.equal(text.startsWith(' '), false);
    assert.equal(body.error, 'Issue not found: WR-404');
  });

  test('proxy GET recommend ?kind=: override stays marked', () => free(async () => {
    const calls = capture();
    const freeTier = { count: 0, allowed: true };
    const { status, body, text } = await request(buildProxyApp({ features: STALE_PREFS, openRouterKey: null, freeTier }), `/api/proxy/issues/${LEAF.id}/recommend?kind=review`);
    assert.equal(status, 200, text);
    assert.equal(calls.length, 0);
    assert.equal(freeTier.count, 0);
    assert.equal(body.override, true);
    assert.equal(body.prompt, handwritten('review'));
  }));

  test('proxy GET prompt/:templateKey: the same bytes', async () => {
    const calls = capture();
    const { status, body } = await request(buildProxyApp({ features: STALE_PREFS }), `/api/proxy/issues/${LEAF.id}/prompt/review`);
    assert.equal(status, 200);
    assert.equal(calls.length, 0);
    assert.equal(body.prompt, handwritten('review'));
  });

  test('recommend-and-dispatch with kind', () => free(async () => {
    const calls = capture();
    const freeTier = { count: 0, allowed: true };
    let stored = null;
    const app = buildProxyApp({ features: STALE_PREFS, openRouterKey: null, freeTier, addItem: async (urlKey, item) => { stored = item; return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item }; } });
    const { status, body, text } = await request(app, '/api/proxy/recommend-and-dispatch', { method: 'POST', body: { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false } });
    assert.equal(status, 201, text);
    assert.equal(body.statusCode, undefined);
    assert.equal(text.startsWith(' '), false, 'no keepalive bytes');
    assert.equal(calls.length, 0);
    assert.equal(freeTier.count, 0);
    assert.equal(stored.prompt, handwritten('review'));
  }));
});

// ── Client hang-ups on the proxy ────────────────────────────────────────────

const postDispatch = (srv, body, signal) => fetch(`${srv.base}/api/proxy/recommend-and-dispatch`, {
  method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
}).catch(() => null);

describe('a client hang-up on the proxy', () => {
  test('GET recommend: aborts the in-flight routing call', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    const calls = capture({ hold: () => true, onCall: () => started() });
    const srv = await listen(buildProxyApp({ features: {} }));
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

  test('recommend-and-dispatch, pinned (kind): a client that left after the prompt was assembled but before the enqueue gets nothing enqueued', async () => {
    const calls = capture();
    let held;
    const contextStarted = new Promise(r => { held = r; });
    contextHold = async () => { held(); await new Promise(r => setTimeout(r, 300)); };
    let added = 0;
    const events = [];
    const srv = await listen(buildProxyApp({ features: {}, events, addItem: async (urlKey, item) => { added++; return { _id: 'disp-1', ...item }; } }));
    try {
      const ac = new AbortController();
      const pending = postDispatch(srv, { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false }, ac.signal);
      await contextStarted;
      assert.equal(calls.length, 0, 'the pinned arm makes no model call');
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => events.some(e => e.status === 499)), `the route recorded the hang-up: ${JSON.stringify(events.map(e => e.status))}`);
      assert.equal(added, 0, 'nothing was enqueued');
    } finally {
      contextHold = null;
      await srv.close();
    }
  });

  for (const [label, body] of [
    ['pinned (kind)', { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false }],
    ['routed', { issueIdentifier: LEAF.identifier, appendProxyContext: false }]
  ]) {
    test(`recommend-and-dispatch, ${label}: a client that left once the enqueue had started still gets the dispatch`, async () => {
      capture();
      let addStarted;
      const enqueueStarted = new Promise(r => { addStarted = r; });
      let added = 0;
      const events = [];
      const srv = await listen(buildProxyApp({
        features: {},
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
        const pending = postDispatch(srv, body, ac.signal);
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

describe('a client hang-up is the client leaving (499), never an AI outage (503)', () => {
  test('proxy GET recommend: a hang-up during the routing call records 499', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    capture({ hold: () => true, onCall: () => started() });
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

  test('routed recommend-and-dispatch: a hang-up during the routing call records 499 and enqueues nothing', async () => {
    let started;
    const routingStarted = new Promise(r => { started = r; });
    const calls = capture({ hold: () => true, onCall: () => started() });
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
    const calls = capture({ hold: () => true, onCall: () => started() });
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

  test('routed recommend-and-dispatch: a client that left before the route armed its signal gets no model call and nothing enqueued', async () => {
    const calls = capture();
    let held;
    const keyReadStarted = new Promise(r => { held = r; });
    keyHold = async () => { held(); await new Promise(r => setTimeout(r, 300)); };
    let added = 0;
    const events = [];
    const srv = await listen(buildProxyApp({ features: {}, events, addItem: async (urlKey, item) => { added++; return { _id: 'disp-1', ...item }; } }));
    try {
      const ac = new AbortController();
      const pending = postDispatch(srv, { issueIdentifier: LEAF.identifier, appendProxyContext: false }, ac.signal);
      await keyReadStarted;
      ac.abort();
      await pending;
      assert.ok(await waitFor(() => events.length > 0), 'the route recorded an outcome');
      assert.deepEqual(events.map(e => e.status), [499]);
      assert.deepEqual(calls.filter(c => !c.abortedAtStart), [], 'no model call reached the wire');
      assert.equal(added, 0, 'nothing was enqueued');
    } finally {
      keyHold = null;
      await srv.close();
    }
  });
});

// ── After the keepalive has flushed ─────────────────────────────────────────
//
// A past X-Request-Start puts the request beyond the keepalive's first-byte target,
// so armKeepalive flushes at once; the issue read is delayed a little so the flush
// lands before the route replies. From then on the HTTP status is a committed 200
// and the real one rides in the body as `statusCode`.

const PAST = () => ({ 'X-Request-Start': String(Date.now() - 25_000) });

describe('recommend-and-dispatch with kind, after the keepalive has flushed', () => {
  afterEach(() => { contextDelayMs = 0; });

  test('the 201 rides in a 200 as statusCode', async () => {
    capture();
    contextDelayMs = 50;
    const { status, body } = await request(buildProxyApp({ features: {} }), '/api/proxy/recommend-and-dispatch', {
      method: 'POST', headers: PAST(), body: { issueIdentifier: LEAF.identifier, kind: 'review', appendProxyContext: false }
    });
    assert.equal(status, 200);
    assert.equal(body.statusCode, 201);
    assert.equal(body.success, true);
    assert.equal(body.override, true);
  });

  test('a missing issue is a 200 carrying statusCode 404', async () => {
    capture();
    contextDelayMs = 50;
    const { status, body } = await request(buildProxyApp({ features: {} }), '/api/proxy/recommend-and-dispatch', {
      method: 'POST', headers: PAST(), body: { issueIdentifier: 'WR-404', kind: 'review', appendProxyContext: false }
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { error: 'Issue not found', statusCode: 404 });
  });
});
