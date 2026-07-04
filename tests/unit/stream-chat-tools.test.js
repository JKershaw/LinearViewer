// Unit tests for the reusable tool-calling loop `streamChatWithTools` (LIN-988).
//
// The loop runs NON-STREAMING tool hops (each offering `tools`/`tool_choice`),
// executes any returned tool_calls via the injected executor, appends
// `role: 'tool'` results, and repeats until the model stops asking for tools or
// the iteration cap fires — after which the FINAL answer streams via streamChat.
//
// Both the tool hops and the final streamed answer go through `global.fetch`
// (no egress proxy configured in tests), so a single fetch mock — routed by
// whether the request body sets `stream: true` — drives the whole flow.

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  streamChatWithTools,
  truncateToolResult,
  DEFAULT_MAX_TOOL_ITERATIONS,
  TOOL_RESULT_MAX_CHARS
} from '../../lib/openrouter.js';

describe('truncateToolResult', () => {
  test('returns short strings unchanged', () => {
    assert.strictEqual(truncateToolResult('hello', 100), 'hello');
  });

  test('truncates and annotates over-budget strings', () => {
    const out = truncateToolResult('x'.repeat(50), 10);
    assert.ok(out.startsWith('x'.repeat(10)));
    assert.match(out, /\[truncated 40 chars\]/);
  });

  test('JSON-stringifies non-string results before truncating', () => {
    assert.strictEqual(truncateToolResult({ a: 1 }, 100), '{"a":1}');
  });

  test('defaults to TOOL_RESULT_MAX_CHARS', () => {
    const out = truncateToolResult('y'.repeat(TOOL_RESULT_MAX_CHARS + 5));
    assert.match(out, /\[truncated 5 chars\]/);
  });
});

describe('streamChatWithTools (LIN-988)', () => {
  let originalFetch;
  let savedProxyEnv;

  // Records every request the loop issues so assertions can inspect the wire
  // bodies (tools present on hops, tool results appended, no tools on the final).
  let calls;

  beforeEach(() => {
    originalFetch = global.fetch;
    savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy
    };
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY;
    delete process.env.https_proxy; delete process.env.http_proxy;
    calls = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  // A non-streaming tool-hop response carrying (optional) tool_calls.
  function toolHopResponse({ toolCalls = [], content = null } = {}) {
    return {
      ok: true,
      json: async () => ({
        model: 'openai/gpt-5.4-mini',
        provider: 'OpenAI',
        choices: [{
          message: { role: 'assistant', content, tool_calls: toolCalls },
          finish_reason: toolCalls.length ? 'tool_calls' : 'stop'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 }
      })
    };
  }

  // A streamed SSE final answer (mirrors the streamChat streaming shape).
  function streamResponse(pieces) {
    const enc = new TextEncoder();
    const blocks = pieces.map(p =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 3, cost: 0.0002 } })}\n\n`);
    blocks.push('data: [DONE]\n\n');
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  function makeToolCall(id, name, args) {
    return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
  }

  // Wire a fetch mock: streaming requests get `finalPieces`; every other
  // (non-streaming) request shifts the next queued tool-hop response.
  function wireFetch(toolHops, finalPieces) {
    const queue = [...toolHops];
    global.fetch = mock.fn(async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.stream === true) return streamResponse(finalPieces);
      return queue.shift();
    });
  }

  test('executes a tool call, feeds the result back, then streams the answer', async () => {
    wireFetch(
      [
        toolHopResponse({ toolCalls: [makeToolCall('c1', 'get_issue', { id: 'LIN-1' })] }),
        toolHopResponse({ toolCalls: [] }) // model is satisfied after seeing the result
      ],
      ['The ', 'answer.']
    );

    const executeTool = mock.fn(async () => 'ISSUE DATA');
    const events = [];

    await streamChatWithTools(
      [{ role: 'user', content: 'tell me about LIN-1' }],
      { apiKey: 'k', tools: [{ type: 'function', function: { name: 'get_issue' } }], executeTool },
      (type, data) => events.push({ type, data })
    );

    // Executor invoked once with parsed args + the tool identity.
    assert.strictEqual(executeTool.mock.calls.length, 1);
    const arg = executeTool.mock.calls[0].arguments[0];
    assert.strictEqual(arg.name, 'get_issue');
    assert.deepStrictEqual(arg.arguments, { id: 'LIN-1' });

    // Breadcrumbs: a call then a result.
    const toolEvents = events.filter(e => e.type === 'tool');
    assert.strictEqual(toolEvents[0].data.phase, 'call');
    assert.strictEqual(toolEvents[1].data.phase, 'result');
    assert.strictEqual(toolEvents[1].data.result, 'ISSUE DATA');

    // Final answer streams token-by-token and completes.
    const tokens = events.filter(e => e.type === 'token').map(e => e.data.token).join('');
    assert.strictEqual(tokens, 'The answer.');
    assert.ok(events.some(e => e.type === 'done'));

    // First request is a tool hop (tools + tool_choice, no stream);
    // last is the tool-less streamed answer carrying the tool result.
    assert.ok(calls[0].tools && calls[0].tool_choice === 'auto');
    assert.notStrictEqual(calls[0].stream, true);
    const finalBody = calls[calls.length - 1];
    assert.strictEqual(finalBody.stream, true);
    assert.strictEqual(finalBody.tools, undefined);
    const toolMsg = finalBody.messages.find(m => m.role === 'tool');
    assert.ok(toolMsg, 'the tool result is appended as a role:tool message');
    assert.strictEqual(toolMsg.content, 'ISSUE DATA');
    assert.strictEqual(toolMsg.tool_call_id, 'c1');
  });

  test('hard-caps iterations, emits a cap breadcrumb, then answers tool-less', async () => {
    // Every hop keeps asking for a tool — the cap must stop the loop.
    const alwaysToolHop = () => toolHopResponse({ toolCalls: [makeToolCall('c', 'loop_tool', {})] });
    wireFetch([alwaysToolHop(), alwaysToolHop(), alwaysToolHop(), alwaysToolHop()], ['done']);

    const executeTool = mock.fn(async () => 'again');
    const events = [];

    await streamChatWithTools(
      [{ role: 'user', content: 'go' }],
      { apiKey: 'k', tools: [{ type: 'function', function: { name: 'loop_tool' } }], executeTool, maxIterations: 2 },
      (type, data) => events.push({ type, data })
    );

    // Exactly two tool hops ran (the cap), then the streamed final answer.
    const hopCalls = calls.filter(b => b.stream !== true);
    assert.strictEqual(hopCalls.length, 2);
    assert.strictEqual(executeTool.mock.calls.length, 2);

    // A cap breadcrumb fired.
    const cap = events.find(e => e.type === 'tool' && e.data.phase === 'cap');
    assert.ok(cap, 'emits a cap breadcrumb');
    assert.strictEqual(cap.data.maxIterations, 2);

    // Final answer still streamed, and without tools.
    const finalBody = calls[calls.length - 1];
    assert.strictEqual(finalBody.stream, true);
    assert.strictEqual(finalBody.tools, undefined);
    assert.strictEqual(events.filter(e => e.type === 'token').map(e => e.data.token).join(''), 'done');
  });

  test('a throwing tool is reported and fed back as an error result, loop continues', async () => {
    wireFetch(
      [
        toolHopResponse({ toolCalls: [makeToolCall('c1', 'boom', {})] }), // hop 1: asks for the tool
        toolHopResponse({ toolCalls: [] })                                // hop 2: model gives up asking
      ],
      ['recovered']
    );

    const executeTool = mock.fn(async () => { throw new Error('tool exploded'); });
    const events = [];

    await streamChatWithTools(
      [{ role: 'user', content: 'go' }],
      { apiKey: 'k', tools: [{ type: 'function', function: { name: 'boom' } }], executeTool },
      (type, data) => events.push({ type, data })
    );

    // An error breadcrumb surfaced (not a thrown rejection).
    const errEvent = events.find(e => e.type === 'tool' && e.data.phase === 'error');
    assert.ok(errEvent, 'emits a tool error breadcrumb');
    assert.match(errEvent.data.error, /tool exploded/);

    // The error was appended as the tool result so the model could recover.
    const secondHop = calls.filter(b => b.stream !== true)[1];
    const toolMsg = secondHop.messages.find(m => m.role === 'tool');
    assert.match(toolMsg.content, /Error: tool exploded/);

    // The loop still reached a streamed final answer.
    assert.strictEqual(events.filter(e => e.type === 'token').map(e => e.data.token).join(''), 'recovered');
    assert.ok(events.some(e => e.type === 'done'));
  });

  test('truncates each tool result before appending it', async () => {
    wireFetch(
      [
        toolHopResponse({ toolCalls: [makeToolCall('c1', 'big', {})] }),
        toolHopResponse({ toolCalls: [] })
      ],
      ['ok']
    );

    const huge = 'z'.repeat(100);
    const executeTool = mock.fn(async () => huge);

    await streamChatWithTools(
      [{ role: 'user', content: 'go' }],
      { apiKey: 'k', tools: [{ type: 'function', function: { name: 'big' } }], executeTool, toolResultMaxChars: 20 },
      () => {}
    );

    const finalBody = calls[calls.length - 1];
    const toolMsg = finalBody.messages.find(m => m.role === 'tool');
    assert.ok(toolMsg.content.length < huge.length);
    assert.match(toolMsg.content, /\[truncated 80 chars\]/);
  });

  test('short-circuits hop 1 when the model answers with no tool_calls (one LLM call)', async () => {
    // Hop 1 returns a plain answer and declines tools. The loop must emit that
    // answer directly and NOT make a second (tools-off) streamChat call (LIN-1009).
    wireFetch(
      [toolHopResponse({ toolCalls: [], content: 'Direct answer from hop 1.' })],
      ['SHOULD-NOT-STREAM'] // a second streamed call here would leak into tokens
    );

    const executeTool = mock.fn(async () => 'unused');
    const events = [];

    await streamChatWithTools(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'k', tools: [{ type: 'function', function: { name: 'get_issue' } }], executeTool },
      (type, data) => events.push({ type, data })
    );

    // Exactly ONE LLM call was made — the non-streaming hop, no streamed re-call.
    assert.strictEqual(calls.length, 1);
    assert.notStrictEqual(calls[0].stream, true);
    assert.ok(calls[0].tools, 'the single call is the tool-offering hop');
    assert.ok(!calls.some(b => b.stream === true), 'no second streamed call was made');

    // The executor was never invoked (the model asked for no tools).
    assert.strictEqual(executeTool.mock.calls.length, 0);
    assert.ok(events.every(e => e.type !== 'tool'), 'no tool breadcrumbs emitted');

    // The hop-1 answer was emitted verbatim, followed by a terminal done event.
    const tokens = events.filter(e => e.type === 'token').map(e => e.data.token).join('');
    assert.strictEqual(tokens, 'Direct answer from hop 1.');
    const done = events.find(e => e.type === 'done');
    assert.ok(done, 'emits a terminal done event');
    assert.strictEqual(done.data.finishReason, 'stop');
    assert.ok(done.data.usage, 'done carries the hop usage payload');
  });

  test('does NOT short-circuit a no-tool hop 1 with empty content — streams a real answer', async () => {
    // Hop 1 declines tools but returns no usable content: fall through to the
    // streamed final answer rather than emitting an empty blob (LIN-1009 guard).
    wireFetch(
      [toolHopResponse({ toolCalls: [], content: '' })],
      ['real ', 'answer']
    );

    const executeTool = mock.fn(async () => 'unused');
    const events = [];

    await streamChatWithTools(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'k', tools: [{ type: 'function', function: { name: 'get_issue' } }], executeTool },
      (type, data) => events.push({ type, data })
    );

    // The hop ran, then the tools-off streamed answer was made (two calls).
    assert.strictEqual(calls.length, 2);
    assert.notStrictEqual(calls[0].stream, true);
    const finalBody = calls[calls.length - 1];
    assert.strictEqual(finalBody.stream, true);
    assert.strictEqual(finalBody.tools, undefined);

    // The streamed answer reached the client (not the empty hop-1 content).
    assert.strictEqual(events.filter(e => e.type === 'token').map(e => e.data.token).join(''), 'real answer');
    assert.ok(events.some(e => e.type === 'done'));
  });

  test('with no tools it degrades to a plain streamed chat (no tool hop)', async () => {
    wireFetch([], ['plain ', 'answer']);
    const events = [];

    await streamChatWithTools(
      [{ role: 'user', content: 'hi' }],
      { apiKey: 'k' },
      (type, data) => events.push({ type, data })
    );

    // Only the streaming request was made — no non-streaming tool hop.
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].stream, true);
    assert.strictEqual(calls[0].tools, undefined);
    assert.strictEqual(events.filter(e => e.type === 'token').map(e => e.data.token).join(''), 'plain answer');
    assert.ok(events.every(e => e.type !== 'tool'));
  });

  test('exposes a sane default iteration cap', () => {
    assert.strictEqual(DEFAULT_MAX_TOOL_ITERATIONS, 4);
  });
});
