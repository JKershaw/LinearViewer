// LIN-2705: streamChatWithTools reports each model hop's usage on the stream, so a
// tool-using turn's cost can be the sum of every hop, not just the final call.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { streamChatWithTools } from '../../lib/openrouter.js';

describe('streamChatWithTools reports each hop\'s usage (LIN-2705)', () => {
  let originalFetch;
  let savedProxy;
  const proxyKeys = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'];

  beforeEach(() => {
    originalFetch = global.fetch;
    savedProxy = Object.fromEntries(proxyKeys.map(k => [k, process.env[k]]));
    proxyKeys.forEach(k => delete process.env[k]);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedProxy)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  // A non-streaming tool hop, with a usage payload whose cost is the hop's own.
  const hop = (toolCalls, content, cost) => ({
    ok: true,
    json: async () => ({
      model: 'm', provider: 'p',
      choices: [{ message: { role: 'assistant', content, tool_calls: toolCalls }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost }
    })
  });
  // The final streamed answer: its own usage arrives on the last SSE chunk.
  const finalStream = (cost) => {
    const enc = new TextEncoder();
    const blocks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8, cost } })}\n\n`,
      'data: [DONE]\n\n',
    ];
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  };
  const call = (id, name) => ({ id, type: 'function', function: { name, arguments: '{}' } });
  // Serves the hops in order for non-streaming requests; the streamed answer for the final call.
  const wire = (hops, finalCost) => {
    const queue = [...hops];
    global.fetch = mock.fn(async (_url, o) => {
      const body = JSON.parse(o.body);
      if (body.stream === true) return finalStream(finalCost);
      return queue.shift();
    });
  };
  const TOOLS = [{ type: 'function', function: { name: 'a' } }];
  const run = (opts, onEvent) => streamChatWithTools([{ role: 'user', content: 'hi' }], { apiKey: 'k', tools: TOOLS, executeTool: async () => 'r', ...opts }, onEvent);
  const collect = () => { const events = []; return { events, fn: (type, data) => events.push({ type, data }) }; };
  const usageFrames = (events) => events.filter(e => e.type === 'usage');

  test('emitHopUsage: one usage frame per hop, tool-requesting and tool-declining alike, before the streamed answer', async () => {
    // Hop 1 and 2 request a tool; hop 3 declines, so it breaks into the streamed
    // answer (a second billed call). Every one of the three hops must be reported.
    wire([hop([call('1', 'a')], null, 0.1), hop([call('2', 'a')], null, 0.2), hop([], null, 0.4)], 0.3);
    const { events, fn } = collect();
    await run({ emitHopUsage: true }, fn);

    const frames = usageFrames(events);
    assert.deepStrictEqual(frames.map(e => e.data.iteration), [1, 2, 3]);
    assert.deepStrictEqual(frames.map(e => e.data.usage.cost), [0.1, 0.2, 0.4]);
    assert.ok(events.findIndex(e => e.type === 'usage') < events.findIndex(e => e.type === 'token'));
    // The final answer's own done usage is unchanged: the hop frames are additive.
    const done = events.find(e => e.type === 'done');
    assert.strictEqual(done.data.usage.cost, 0.3);
  });

  test('emitHopUsage: a hop-1 no-tool answer rides on done alone, with no separate usage frame', async () => {
    wire([hop([], 'hi', 0.05)], null);
    const { events, fn } = collect();
    await run({ emitHopUsage: true }, fn);
    assert.strictEqual(usageFrames(events).length, 0);
    assert.strictEqual(events.find(e => e.type === 'done').data.usage.cost, 0.05);
  });

  test('default options: no usage frame, so callers that do not sum are unchanged', async () => {
    wire([hop([call('1', 'a')], null, 0.1), hop([], null, 0.2)], 0.3);
    const { events, fn } = collect();
    await run({}, fn);
    assert.strictEqual(usageFrames(events).length, 0);
    assert.strictEqual(events.find(e => e.type === 'done').data.usage.cost, 0.3);
  });
});
