/**
 * LIN-4358: the routing call (getRecommendationStream, and getRecommendation, its
 * buffered twin) is budgeted from the catalog like every other call. It used to send a
 * bare `max_tokens: 8000` of its own, outside lib/call-budget.js, so a reasoning model got
 * no headroom above the visible 8000 and nothing held the ask to the catalog's limits.
 *
 * What the call layer promises (#2362, pinned in stream-chat-whole-or-loud.test.js):
 * headroom is held to the catalog's output limit, but the ask never drops below the
 * visible output requested; a model whose limit is below that is refused by the
 * provider, loudly, rather than silently given less.
 *
 * Restoring the literal 8000 in either path turns these red.
 *
 * Also pins the catalog cache's id index (getCachedCatalogModel is a Map lookup): every
 * way the cache is filled keeps it in step, and a reset empties it.
 *
 * Nothing here touches the network. Run with: node --test tests/unit/lin-4358-routing-budget.test.js
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendationStream, getRecommendation, setFetchImpl } from '../../lib/openrouter.js';
import {
  getCachedCatalogModel, _seedCatalogFromBodyForTests, _setCatalogCacheForTests, _resetCatalogCacheForTests,
} from '../../lib/openrouter-catalog.js';

const SMALL = {
  id: 'newco/small-out',
  name: 'NewCo: Small Out',
  context_length: 128000,
  pricing: { prompt: '0.0000001', completion: '0.0000004' },
  top_provider: { context_length: 128000, max_completion_tokens: 4000 },
  supported_parameters: ['max_tokens', 'tools', 'tool_choice'],
};
// Reasons, but its endpoint gives at most 10,000 output tokens: 8000 + 8000 headroom is held to 10,000.
const CAPPED_THINKER = {
  id: 'newco/capped-thinker',
  name: 'NewCo: Capped Thinker',
  context_length: 200000,
  pricing: { prompt: '0.0000002', completion: '0.0000008' },
  top_provider: { context_length: 200000, max_completion_tokens: 10000 },
  supported_parameters: ['max_tokens', 'reasoning', 'tools', 'tool_choice'],
  reasoning: { mandatory: false, supported_efforts: ['medium'], default_effort: 'medium' },
};
const THINKER = {
  id: 'newco/thinker',
  name: 'NewCo: Thinker',
  context_length: 400000,
  pricing: { prompt: '0.0000003', completion: '0.0000012' },
  top_provider: { context_length: 400000, max_completion_tokens: 64000 },
  supported_parameters: ['max_tokens', 'reasoning', 'tools', 'tool_choice'],
  reasoning: { mandatory: false, supported_efforts: ['high', 'medium', 'low'], default_effort: 'medium' },
};

const ISSUE = {
  identifier: 'LIN-1', title: 'A leaf task', description: 'Do the thing.',
  url: 'https://linear.app/test/issue/LIN-1', state: { name: 'In Progress', type: 'started' },
};
const CONTEXT = { parent: null, siblings: [], project: { description: '' }, children: [], comments: [], focusedChild: null };
const REPLY = '## Reasoning\n→ **research**\nLook into it.\n**Next:** plan';

function streamResponse() {
  const enc = new TextEncoder();
  const blocks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: REPLY }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 12 } })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
}

function bufferedResponse() {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: REPLY }, finish_reason: 'stop' }], usage: { completion_tokens: 12 } }),
  };
}

const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'];

describe('routing call budget comes from the catalog (LIN-4358)', () => {
  let savedProxy;
  let originalFetch;

  beforeEach(() => {
    savedProxy = Object.fromEntries(PROXY_KEYS.map(k => [k, process.env[k]]));
    for (const k of PROXY_KEYS) delete process.env[k]; // the stream path streams only with no proxy
    originalFetch = global.fetch;
    _seedCatalogFromBodyForTests({ data: [SMALL, THINKER, CAPPED_THINKER] });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setFetchImpl(null);
    _resetCatalogCacheForTests();
    for (const [k, v] of Object.entries(savedProxy)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  async function streamBody(model) {
    const fetchMock = mock.fn(async () => streamResponse());
    setFetchImpl(fetchMock);
    const result = await getRecommendationStream(ISSUE, CONTEXT, { apiKey: 'test-key', model }, () => {});
    assert.equal(result.recommendedAction, 'research');
    assert.equal(fetchMock.mock.callCount(), 1);
    return JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
  }

  async function bufferedBody(model) {
    const fetchMock = mock.fn(async () => bufferedResponse());
    setFetchImpl(fetchMock);
    const result = await getRecommendation(ISSUE, CONTEXT, { apiKey: 'test-key', model });
    assert.equal(result.recommendedAction, 'research');
    assert.equal(fetchMock.mock.callCount(), 1);
    return JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
  }

  for (const [path, bodyOf] of [['stream', streamBody], ['buffered', bufferedBody]]) {
    test(`${path}: a reasoning model gets headroom above 8000 and no reasoning field`, async () => {
      const body = await bodyOf(THINKER.id);
      assert.equal(body.max_tokens, 16000, '8000 visible + 8000 reasoning headroom');
      assert.equal('reasoning' in body, false, 'no explicit reasoning bound on the first attempt');
    });

    test(`${path}: the headroom is held to the catalog's output limit`, async () => {
      const body = await bodyOf(CAPPED_THINKER.id);
      assert.equal(body.max_tokens, 10000, 'top_provider.max_completion_tokens');
      assert.equal('reasoning' in body, false);
    });

    test(`${path}: a non-reasoning model is asked for the visible 8000, never less (the provider refuses an impossible ask)`, async () => {
      const body = await bodyOf(SMALL.id);
      assert.equal(body.max_tokens, 8000);
      assert.equal('reasoning' in body, false);
    });

    test(`${path}: a model the catalog does not list keeps the plain 8000`, async () => {
      const body = await bodyOf('someone/unlisted');
      assert.equal(body.max_tokens, 8000);
      assert.equal('reasoning' in body, false);
    });
  }
});

describe('catalog cache id index (LIN-4358)', () => {
  afterEach(() => _resetCatalogCacheForTests());

  test('seed, direct set and reset keep getCachedCatalogModel in step with the cached models', () => {
    assert.equal(getCachedCatalogModel(SMALL.id), null, 'cold cache');

    _seedCatalogFromBodyForTests({ data: [SMALL] });
    assert.equal(getCachedCatalogModel(SMALL.id)?.id, SMALL.id);
    assert.equal(getCachedCatalogModel(THINKER.id), null);

    // A later fill replaces the index along with the list: no stale id survives.
    _seedCatalogFromBodyForTests({ data: [THINKER] });
    assert.equal(getCachedCatalogModel(SMALL.id), null);
    assert.equal(getCachedCatalogModel(THINKER.id)?.id, THINKER.id);

    const direct = { id: 'direct/one', name: 'Direct One', pricing: null };
    _setCatalogCacheForTests({ at: Date.now(), models: [direct] });
    assert.equal(getCachedCatalogModel('direct/one'), direct);
    assert.equal(getCachedCatalogModel(THINKER.id), null);

    _resetCatalogCacheForTests();
    assert.equal(getCachedCatalogModel('direct/one'), null);
  });
});
