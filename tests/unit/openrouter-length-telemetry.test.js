/**
 * LIN-3359: `maxTokens` and `reasoningTokens` ride every call-log row the
 * Flight Companion writes, so a `finishReason: 'length'` row can say whether
 * reasoning or prose ate the cap. Telemetry only: request bodies are unchanged.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { streamChat, streamChatWithTools, setLlmCallRecorder } from '../../lib/openrouter.js';

const USAGE = {
  prompt_tokens: 100, completion_tokens: 4000, total_tokens: 4100, cost: 0.01,
  completion_tokens_details: { reasoning_tokens: 3900 }
};

function sseResponse(finishReason, usage) {
  const enc = new TextEncoder();
  const blocks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }], usage })}\n\n`,
    'data: [DONE]\n\n'
  ];
  return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
}

describe('LIN-3359 call-log telemetry', () => {
  let originalFetch;
  let savedProxyEnv;
  let records;

  beforeEach(() => {
    originalFetch = global.fetch;
    savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy
    };
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY;
    delete process.env.https_proxy; delete process.env.http_proxy;
    records = [];
    setLlmCallRecorder((r) => records.push(r));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setLlmCallRecorder(null);
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('streamChat final-answer row carries maxTokens + reasoningTokens through the usage merge', async () => {
    global.fetch = mock.fn(async () => sseResponse('length', USAGE));
    const events = [];
    await streamChat([{ role: 'user', content: 'hi' }], { apiKey: 'k', maxTokens: 4000 }, (t, d) => events.push([t, d]));
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].finishReason, 'length');
    assert.strictEqual(records[0].maxTokens, 4000);
    assert.strictEqual(records[0].reasoningTokens, 3900);
    assert.strictEqual(records[0].completionTokens, 4000);
    const done = events.find(([t]) => t === 'done')[1];
    assert.strictEqual(done.usage.reasoningTokens, 3900);
    // Telemetry only: the request body carries the bare cap and no reasoning field.
    const body = JSON.parse(global.fetch.mock.calls[0].arguments[1].body);
    assert.strictEqual(body.max_tokens, 4000);
    assert.ok(!('reasoning' in body));
  });

  test('reasoningTokens is null when usage carries no completion_tokens_details', async () => {
    global.fetch = mock.fn(async () => sseResponse('stop', { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }));
    await streamChat([{ role: 'user', content: 'hi' }], { apiKey: 'k', maxTokens: 1500 }, () => {});
    assert.strictEqual(records[0].reasoningTokens, null);
    assert.strictEqual(records[0].maxTokens, 1500);
  });

  test('the tool-hop row carries maxTokens + reasoningTokens', async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        model: 'm', provider: 'p', usage: USAGE,
        choices: [{ finish_reason: 'length', message: { content: 'cut' } }]
      })
    }));
    await streamChatWithTools(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'k', maxTokens: 4000, tools: [{ type: 'function', function: { name: 't', parameters: { type: 'object', properties: {} } } }], executeTool: async () => ({}) },
      () => {}
    );
    const hop = records.find((r) => r.finishReason === 'length');
    assert.ok(hop, 'a hop row was recorded');
    assert.strictEqual(hop.maxTokens, 4000);
    assert.strictEqual(hop.reasoningTokens, 3900);
  });
});
