/**
 * LIN-4358: no Harbour call quietly returns a partial.
 *
 * On 7 Nov 2026 the brief, on anthropic/claude-haiku-5.5, stopped mid-sentence and was
 * cached as whole: `generateBrief` sent a bare 3000-token cap and kept only the text,
 * never the finish reason. The investigation reproduced that for every early stop
 * (`length`, a mid-stream `error`, a dropped stream with no reason) and found the same
 * shape at every bare caller. These tests pin the call-layer fix:
 *
 * - whole or loud: `streamChat` / `streamChatWithTools` hold tokens until the call
 *   finishes on its own, and otherwise throw TruncatedOutputError, with no `done`;
 * - one recovery: a `length` stop is retried once with a larger budget (an explicit
 *   reasoning bound when hidden reasoning ate the cap);
 * - the budget is sized from the catalog: reasoning headroom for a model that can
 *   reason, within its output limits, and no `reasoning` field on the first attempt;
 * - the brief route answers 502 OUTPUT_TRUNCATED and caches nothing;
 * - `allowPartial` keeps the old live behaviour for callers that handle a cut-off.
 *
 * The catalog is the real /models response of 7 Nov 2026, trimmed
 * (tests/fixtures/openrouter-models-2026-11-07.json), run through the real normalizer.
 * The transport is the `setFetchImpl` seam, so the real streamChat runs.
 *
 * Run with: node --test tests/unit/stream-chat-whole-or-loud.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import {
  streamChat, streamChatWithTools, setFetchImpl, setLlmCallRecorder,
  TruncatedOutputError, isCompleteFinish, truncationFailureOf
} from '../../lib/openrouter.js';
import {
  _setCatalogCacheForTests, _resetCatalogCacheForTests, _normalizeModelForTests, getCachedCatalogModel
} from '../../lib/openrouter-catalog.js';
import { planCallBudget, planRetryBudget, canReason } from '../../lib/call-budget.js';
import { generateBrief } from '../../lib/brief.js';
import { InMemoryBriefCacheStore } from '../../lib/brief-cache.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProviderInterface } from '../../lib/providers/interface.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('../fixtures/openrouter-models-2026-11-07.json', import.meta.url), 'utf8'));
const HAIKU = 'anthropic/claude-haiku-5.5';
const SOL = 'openai/gpt-6.1-sol';
const MINI = 'openai/gpt-5.4-mini';
const NO_REASONING = 'scaledown/summarize'; // no `reasoning` object; max_completion_tokens 4000

function seedLiveCatalog() {
  _setCatalogCacheForTests({ at: Date.now(), models: FIXTURE.data.map(_normalizeModelForTests).filter(Boolean) });
}

// --- transport -------------------------------------------------------------------

/** An SSE body: `text` as one content chunk, then a closing chunk with the given reason/usage/error. */
function sse({ text = '', finishReason, usage, error } = {}) {
  const enc = new TextEncoder();
  const blocks = [];
  if (text) blocks.push({ choices: [{ delta: { content: text }, finish_reason: null }] });
  const last = { choices: [{ delta: {}, finish_reason: finishReason ?? null }] };
  if (usage) last.usage = usage;
  if (error) last.error = error;
  if (finishReason !== undefined || usage || error) blocks.push(last);
  return {
    ok: true,
    body: (async function* () {
      for (const b of blocks) yield enc.encode(`data: ${JSON.stringify(b)}\n\n`);
      if (finishReason !== undefined) yield enc.encode('data: [DONE]\n\n');
    })()
  };
}

let bodies;
let records;
/** Queue one reply per request; records every request body. */
function replies(...queue) {
  setFetchImpl(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra OpenRouter request');
    return typeof next === 'function' ? next() : next;
  });
}

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
let savedProxy = {};
beforeEach(() => {
  bodies = [];
  records = [];
  setLlmCallRecorder((r) => records.push(r));
  savedProxy = Object.fromEntries(PROXY_VARS.map(k => [k, process.env[k]]));
  for (const k of PROXY_VARS) delete process.env[k];
  _resetCatalogCacheForTests();
});
afterEach(() => {
  setFetchImpl(null);
  setLlmCallRecorder(null);
  _resetCatalogCacheForTests();
  for (const [k, v] of Object.entries(savedProxy)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const MSGS = [{ role: 'user', content: 'Summarize the ticket.' }];
const REASONING_CAP = { prompt_tokens: 9000, completion_tokens: 3000, total_tokens: 12000, completion_tokens_details: { reasoning_tokens: 2600 } };
const PROSE_CAP = { prompt_tokens: 9000, completion_tokens: 3000, total_tokens: 12000 };
const WHOLE = { prompt_tokens: 9000, completion_tokens: 900, total_tokens: 9900, completion_tokens_details: { reasoning_tokens: 300 } };

async function collect(promise, events) {
  try { return { value: await promise }; } catch (error) { return { error, events }; }
}

// --- whole or loud ---------------------------------------------------------------

describe('streamChat: a call that does not finish on its own throws, and emits nothing', () => {
  const EARLY_STOPS = [
    ['a mid-stream provider error', { text: '## Current\nPiece B is merged and the', finishReason: 'error', error: { code: 502, message: 'upstream overloaded' } }, 'error', /upstream overloaded/],
    ['a dropped stream (no finish_reason)', { text: '## Current\nPiece B is merged and the' }, null, /no finish_reason/],
    ['a content filter stop', { text: '## Current\nPiece', finishReason: 'content_filter' }, 'content_filter', /content_filter/],
  ];
  for (const [name, reply, reason, words] of EARLY_STOPS) {
    test(name, async () => {
      replies(sse(reply));
      const events = [];
      const { error } = await collect(streamChat(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 3000 }, (t, d) => events.push([t, d])), events);
      assert.ok(error instanceof TruncatedOutputError, `expected TruncatedOutputError, got ${error}`);
      assert.equal(error.code, 'OUTPUT_TRUNCATED');
      assert.equal(error.finishReason, reason);
      assert.match(error.message, /^OpenRouter output cut off: anthropic\/claude-haiku-5\.5/);
      assert.match(error.message, words);
      assert.deepEqual(events, [], 'no token and no done reached the caller');
      assert.equal(bodies.length, 1, 'only a length stop is retried');
      assert.equal(records.length, 1, 'the call is still logged');
    });
  }

  test('a length stop that the retry cannot cure throws after exactly one retry, naming where the tokens went', async () => {
    replies(
      sse({ text: 'partial one', finishReason: 'length', usage: REASONING_CAP }),
      sse({ text: 'partial two', finishReason: 'length', usage: REASONING_CAP }),
    );
    const events = [];
    const { error } = await collect(streamChat(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 3000 }, (t, d) => events.push([t, d])), events);
    assert.ok(error instanceof TruncatedOutputError);
    assert.equal(error.finishReason, 'length');
    assert.equal(error.retried, true);
    assert.match(error.message, /2600 of them hidden reasoning/);
    assert.match(error.message, /after one retry/);
    assert.deepEqual(events, []);
    assert.equal(bodies.length, 2);
    assert.equal(records[1].retry, 'length', 'the retry row says it is one');
  });

  test('isCompleteFinish: only stop and tool_calls are whole', () => {
    assert.equal(isCompleteFinish('stop'), true);
    assert.equal(isCompleteFinish('tool_calls'), true);
    for (const r of ['length', 'error', 'content_filter', null, undefined, '']) assert.equal(isCompleteFinish(r), false, String(r));
  });
});

describe('streamChat: one recovery for a length stop', () => {
  test('hidden reasoning ate the cap: the retry bounds reasoning explicitly and keeps the prose budget; only the whole answer is emitted', async () => {
    seedLiveCatalog();
    replies(
      sse({ text: 'cut mid-sen', finishReason: 'length', usage: { ...REASONING_CAP, completion_tokens: 6000, completion_tokens_details: { reasoning_tokens: 5800 } } }),
      sse({ text: 'The whole answer.', finishReason: 'stop', usage: WHOLE }),
    );
    const events = [];
    const out = await streamChat(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 3000 }, (t, d) => events.push([t, d]));
    assert.equal(out.text, 'The whole answer.');
    assert.equal(out.complete, true);
    assert.deepEqual(events.map(([t]) => t), ['token', 'done']);
    assert.equal(events[0][1].token, 'The whole answer.', 'the cut attempt\'s text never reached the caller');
    assert.equal(events[1][1].finishReason, 'stop');
    // First attempt: headroom, no reasoning field (it must not switch thinking on, LIN-1665).
    assert.equal(bodies[0].max_tokens, 6000);
    assert.ok(!('reasoning' in bodies[0]));
    // Retry: reasoning bounded at the allowance, prose budget on top.
    assert.deepEqual(bodies[1].reasoning, { max_tokens: 3000 });
    assert.equal(bodies[1].max_tokens, 6000);
  });

  test('the visible answer overran a non-reasoning model\'s cap: the retry doubles it', async () => {
    replies(
      sse({ text: 'a long', finishReason: 'length', usage: PROSE_CAP }),
      sse({ text: 'a long answer, whole.', finishReason: 'stop', usage: WHOLE }),
    );
    const out = await streamChat(MSGS, { apiKey: 'k', model: 'unlisted/model', maxTokens: 1500 }, () => {});
    assert.equal(out.text, 'a long answer, whole.');
    assert.equal(bodies[0].max_tokens, 1500);
    assert.equal(bodies[1].max_tokens, 3000);
    assert.ok(!('reasoning' in bodies[1]));
  });

  test('the non-streaming transport (HTTPS_PROXY set) is held to the same rule', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.invalid:3128';
    const json = (content, finish_reason, usage) => ({ ok: true, json: async () => ({ model: HAIKU, usage, choices: [{ finish_reason, message: { content } }] }) });
    replies(json('cut', 'length', REASONING_CAP), json('cut again', 'length', REASONING_CAP));
    const { error } = await collect(streamChat(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 3000 }, () => {}));
    assert.ok(error instanceof TruncatedOutputError);
    assert.ok(!('stream' in bodies[0]));
  });
});

describe('allowPartial: callers that handle a cut-off keep the live behaviour', () => {
  test('tokens stream live, done carries length, no retry, no throw', async () => {
    replies(sse({ text: 'partial', finishReason: 'length', usage: REASONING_CAP }));
    const events = [];
    const out = await streamChat(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 3000, allowPartial: true }, (t, d) => events.push([t, d]));
    assert.equal(out.complete, false);
    assert.equal(out.finishReason, 'length');
    assert.deepEqual(events.map(([t]) => t), ['token', 'done']);
    assert.equal(events[1][1].finishReason, 'length');
    assert.equal(bodies.length, 1);
  });
});

// --- budget from the catalog -------------------------------------------------------

describe('the budget is sized from the live catalog', () => {
  test('the live reasoning shape normalizes: default_enabled tri-state, efforts and limits kept', () => {
    seedLiveCatalog();
    const haiku = getCachedCatalogModel(HAIKU);
    assert.deepEqual(haiku.reasoning, { mandatory: false, default_enabled: null, supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'], default_effort: 'medium' });
    assert.equal(haiku.context_length, 1000000);
    assert.equal(haiku.max_completion_tokens, 128000);
    assert.equal(getCachedCatalogModel(SOL).reasoning.default_enabled, true);
    assert.equal(getCachedCatalogModel(MINI).reasoning.default_enabled, false);
    assert.equal(getCachedCatalogModel(NO_REASONING).reasoning, null);
  });

  test('a model that can reason gets headroom and no reasoning field; one that cannot gets its exact cap; an unlisted id gets its exact cap', () => {
    seedLiveCatalog();
    for (const id of [HAIKU, SOL, MINI]) {
      assert.equal(canReason(id), true, id);
      assert.deepEqual(planCallBudget({ model: id, maxTokens: 3000 }), { maxTokens: 6000, reasoning: undefined, proseTokens: 3000, headroom: 3000 }, id);
    }
    assert.equal(canReason(NO_REASONING), false);
    assert.equal(planCallBudget({ model: NO_REASONING, maxTokens: 3000 }).maxTokens, 3000);
    assert.equal(canReason('unlisted/model'), null);
    assert.equal(planCallBudget({ model: 'unlisted/model', maxTokens: 3000 }).maxTokens, 3000);
    // Small caps get the floor of headroom, large ones the ceiling.
    assert.equal(planCallBudget({ model: HAIKU, maxTokens: 150 }).maxTokens, 2150);
    assert.equal(planCallBudget({ model: HAIKU, maxTokens: 20000 }).maxTokens, 28000);
  });

  test('headroom stays inside the catalog\'s output limit and the context left after the prompt, never below the prose asked for', () => {
    _setCatalogCacheForTests({ at: Date.now(), models: [
      _normalizeModelForTests({ id: 'x/small-out', reasoning: { mandatory: false }, top_provider: { context_length: 100000, max_completion_tokens: 4000 } }),
      _normalizeModelForTests({ id: 'x/small-ctx', reasoning: { mandatory: false }, context_length: 10000, top_provider: { max_completion_tokens: 128000 } }),
    ] });
    assert.equal(planCallBudget({ model: 'x/small-out', maxTokens: 3000 }).maxTokens, 4000);
    assert.equal(planCallBudget({ model: 'x/small-out', maxTokens: 5000 }).maxTokens, 5000, 'the provider, not Harbour, refuses an impossible ask');
    // 24,000 prompt chars ~ 6,000 tokens of a 10,000 window: 4,000 left, so 3000 + 3000 headroom is trimmed to 4,000.
    assert.equal(planCallBudget({ model: 'x/small-ctx', maxTokens: 3000, promptChars: 24000 }).maxTokens, 4000);
    assert.equal(planCallBudget({ model: 'x/small-ctx', maxTokens: 3000 }).maxTokens, 6000, 'with no prompt the window is not the limit');
  });

  test('an explicit reasoning field (roadmap, ship-biscuit) is kept as the caller sized it', () => {
    seedLiveCatalog();
    assert.deepEqual(planCallBudget({ model: SOL, maxTokens: 6000, reasoning: { max_tokens: 3000 } }), { maxTokens: 6000, reasoning: { max_tokens: 3000 }, proseTokens: 6000, headroom: 0 });
  });

  test('the retry plan: an explicit reasoning bound when reasoning was spent, a doubled cap otherwise, null when nothing can improve', () => {
    seedLiveCatalog();
    const first = planCallBudget({ model: HAIKU, maxTokens: 3000 });
    assert.deepEqual(planRetryBudget({ model: HAIKU, first, usage: { reasoningTokens: 5800 } }), { maxTokens: 6000, reasoning: { max_tokens: 3000 } });
    assert.deepEqual(planRetryBudget({ model: HAIKU, first, usage: { reasoningTokens: 0 } }), { maxTokens: 12000, reasoning: undefined });
    _setCatalogCacheForTests({ at: Date.now(), models: [_normalizeModelForTests({ id: 'x/capped', top_provider: { max_completion_tokens: 1000 } })] });
    const capped = planCallBudget({ model: 'x/capped', maxTokens: 1000 });
    assert.equal(planRetryBudget({ model: 'x/capped', first: capped, usage: {} }), null);
  });
});

// --- tool hops ------------------------------------------------------------------

describe('streamChatWithTools: a cut-off first hop does not short-circuit as the answer', () => {
  const TOOLS = [{ type: 'function', function: { name: 't', parameters: { type: 'object', properties: {} } } }];
  const hop = (content, finish_reason, usage = PROSE_CAP) => ({ ok: true, json: async () => ({ model: HAIKU, usage, choices: [{ finish_reason, message: { content } }] }) });

  test('strict: the hop-1 partial is dropped and the streamed final answer is the one returned', async () => {
    replies(hop('cut', 'length'), sse({ text: 'Whole final answer.', finishReason: 'stop', usage: WHOLE }));
    const events = [];
    await streamChatWithTools(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 500, tools: TOOLS, executeTool: async () => ({}) }, (t, d) => events.push([t, d]));
    assert.deepEqual(events.filter(([t]) => t === 'token').map(([, d]) => d.token), ['Whole final answer.']);
    assert.equal(events.find(([t]) => t === 'done')[1].finishReason, 'stop');
  });

  test('strict: a whole hop-1 answer still short-circuits (LIN-1009 unchanged)', async () => {
    replies(hop('Whole hop answer.', 'stop'));
    const events = [];
    await streamChatWithTools(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 500, tools: TOOLS, executeTool: async () => ({}) }, (t, d) => events.push([t, d]));
    assert.deepEqual(events.map(([t]) => t), ['token', 'done']);
    assert.equal(bodies.length, 1);
  });

  test('the hop is sized from the catalog too', async () => {
    seedLiveCatalog();
    replies(hop('Whole hop answer.', 'stop'));
    await streamChatWithTools(MSGS, { apiKey: 'k', model: HAIKU, maxTokens: 500, tools: TOOLS, executeTool: async () => ({}) }, () => {});
    assert.equal(bodies[0].max_tokens, 2500);
  });
});

// --- the brief, end to end --------------------------------------------------------

class FakeContextProvider extends ProviderInterface {
  constructor(name, description) { super(); this.name = name; this.description = description; }
  async fetchRecommendationContext() {
    const issue = { id: 'uuid-4358', identifier: 'ENG-4358', title: 'Long ticket', description: this.description, state: { type: 'started' }, labels: [] };
    return { issue, comments: [], children: [], parent: null, focusedChild: null };
  }
}

function proxyApp({ provider, briefCacheStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'real-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'real-token',
    getWorkspaceOpenRouterKey: async () => 'sk-test',
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, put: async () => {} },
    briefCacheStore,
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: null,
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

async function call(app, method, path) {
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (...args) => realSetTimeout(...args).unref?.();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: 'Bearer anything' } });
    let json = {};
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json };
  } finally {
    global.setTimeout = realSetTimeout;
    await new Promise(resolve => server.close(resolve));
  }
}

const MODEL_BRIEF = '## Current\nWhole.\n\n## Constraints\n- _None._\n\n## Open questions\n- _None._\n\n## Changelog\n- _None._';

describe('the brief: whole, or a clear refusal with nothing cached', () => {
  test('generateBrief on Haiku 5.5: the 7 Nov failure (reasoning ate the cap) now recovers to a whole brief', async () => {
    seedLiveCatalog();
    replies(
      sse({ text: '## Current\nPiece B is merged and deployed. The seal at first dispatch has not been seen live yet, and the', finishReason: 'length', usage: { prompt_tokens: 8300, completion_tokens: 6000, total_tokens: 14300, completion_tokens_details: { reasoning_tokens: 5600 } } }),
      sse({ text: MODEL_BRIEF, finishReason: 'stop', usage: WHOLE }),
    );
    const issue = { identifier: 'LIN-4352', title: 't', description: 'd', state: { type: 'started' }, labels: [] };
    const { brief } = await generateBrief(issue, { issue, comments: [], children: [], parent: null }, { apiKey: 'k', model: HAIKU });
    assert.equal(brief, MODEL_BRIEF);
    assert.equal(bodies[0].max_tokens, 6000, 'the brief asks for 3000 visible tokens plus headroom');
  });

  test('the proxy brief route answers 502 OUTPUT_TRUNCATED, names the model and reason, and caches nothing', async () => {
    replies(
      sse({ text: '## Current\nPiece B is merged and the', finishReason: 'length', usage: REASONING_CAP }),
      sse({ text: '## Current\nStill cut', finishReason: 'length', usage: REASONING_CAP }),
    );
    const store = new InMemoryBriefCacheStore();
    const app = proxyApp({ provider: new FakeContextProvider('lin-4358-cut', 'A long ticket.'), briefCacheStore: store });
    const { status, body } = await call(app, 'POST', '/api/proxy/brief/ENG-4358');
    assert.equal(status, 502, JSON.stringify(body));
    assert.equal(body.code, 'OUTPUT_TRUNCATED');
    assert.equal(body.finishReason, 'length');
    assert.match(body.detail, /cut off/);
    assert.equal(await store.get('acme', 'uuid-4358'), null, 'no partial was cached');
  });

  test('truncationFailureOf maps only a TruncatedOutputError', () => {
    const err = new TruncatedOutputError({ model: HAIKU, finishReason: 'length', completionTokens: 3000, reasoningTokens: 2600, maxTokens: 3000 });
    const [status, message, extra] = truncationFailureOf(err);
    assert.equal(status, 502);
    assert.match(message, /cut off/);
    assert.equal(extra.code, 'OUTPUT_TRUNCATED');
    assert.equal(truncationFailureOf(new Error('OpenRouter API error: 500')), null);
  });
});
