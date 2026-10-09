// LIN-3362: hop text frames and concurrent read batches in streamChatWithTools.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { streamChatWithTools } from '../../lib/openrouter.js';

describe('streamChatWithTools hop text + concurrent tools (LIN-3362)', () => {
  let originalFetch;
  let bodies;
  const proxyKeys = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'];
  let savedProxy;

  beforeEach(() => {
    originalFetch = global.fetch;
    savedProxy = Object.fromEntries(proxyKeys.map(k => [k, process.env[k]]));
    proxyKeys.forEach(k => delete process.env[k]);
    bodies = [];
  });
  afterEach(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedProxy)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const hop = (toolCalls = [], content = null) => ({
    ok: true,
    json: async () => ({
      model: 'm', provider: 'p',
      choices: [{ message: { role: 'assistant', content, tool_calls: toolCalls }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 }
    })
  });
  const stream = (pieces) => {
    const enc = new TextEncoder();
    const blocks = pieces.map(p => `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 1, cost: 0 } })}\n\n`, 'data: [DONE]\n\n');
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  };
  const call = (id, name, args = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const wire = (hops) => {
    const q = [...hops];
    global.fetch = mock.fn(async (url, o) => {
      const body = JSON.parse(o.body);
      bodies.push(body);
      if (body.stream === true) return stream(['done.']);
      return q.shift();
    });
  };
  const TOOLS = ['a', 'b', 'send_follow_up'].map(name => ({ type: 'function', function: { name } }));
  const run = async (opts, onEvent) => streamChatWithTools([{ role: 'user', content: 'hi' }], { apiKey: 'k', tools: TOOLS, ...opts }, onEvent);
  const collect = () => { const events = []; return { events, fn: (type, data) => events.push({ type, data }) }; };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  test('default options: no hop-text frame, serial execution (frames interleave call/result)', async () => {
    wire([hop([call('1', 'a'), call('2', 'b')], 'checking'), hop([])]);
    const { events, fn } = collect();
    await run({ executeTool: async ({ name }) => `r-${name}` }, fn);
    assert.ok(!events.some(e => e.type === 'hop-text'));
    assert.deepStrictEqual(events.filter(e => e.type === 'tool').map(e => `${e.data.phase}:${e.data.id}`),
      ['call:1', 'result:1', 'call:2', 'result:2']);
    assert.deepStrictEqual(bodies[1].messages.filter(m => m.role === 'tool').map(m => m.tool_call_id), ['1', '2']);
  });

  test('emitHopText emits the hop prose before its call frames, never as a token', async () => {
    wire([hop([call('1', 'a')], 'Looking at the stalled ones'), hop([])]);
    const { events, fn } = collect();
    await run({ emitHopText: true, executeTool: async () => 'x' }, fn);
    const i = events.findIndex(e => e.type === 'hop-text');
    assert.ok(i >= 0);
    assert.strictEqual(events[i].data.text, 'Looking at the stalled ones');
    assert.strictEqual(events[i + 1].data.phase, 'call');
    assert.ok(!events.some(e => e.type === 'token' && e.data.token === 'Looking at the stalled ones'));
  });

  test('emitHopText skips empty / whitespace / null content', async () => {
    wire([hop([call('1', 'a')], ''), hop([call('2', 'a')], '  \n'), hop([call('3', 'a')], null), hop([])]);
    const { events, fn } = collect();
    await run({ emitHopText: true, maxIterations: 5, executeTool: async () => 'x' }, fn);
    assert.ok(!events.some(e => e.type === 'hop-text'));
  });

  test('concurrent batch overlaps (~max, not sum) and reports in call order', async () => {
    wire([hop([call('1', 'a'), call('2', 'b')]), hop([])]);
    const { events, fn } = collect();
    const delays = { a: 120, b: 40 };
    const t0 = Date.now();
    await run({
      concurrentTools: new Set(['a', 'b']),
      executeTool: async ({ name }) => { await sleep(delays[name]); return `r-${name}`; }
    }, fn);
    assert.ok(Date.now() - t0 < 160, `took ${Date.now() - t0}ms, expected overlap`);
    assert.deepStrictEqual(events.filter(e => e.type === 'tool').map(e => `${e.data.phase}:${e.data.id}`),
      ['call:1', 'call:2', 'result:1', 'result:2']);
    assert.deepStrictEqual(bodies[1].messages.filter(m => m.role === 'tool').map(m => [m.tool_call_id, m.content]),
      [['1', 'r-a'], ['2', 'r-b']]);
  });

  test('a failing tool in a batch is isolated; its sibling still succeeds', async () => {
    wire([hop([call('1', 'a'), call('2', 'b')]), hop([])]);
    const { events, fn } = collect();
    await run({
      concurrentTools: new Set(['a', 'b']),
      executeTool: async ({ name }) => { if (name === 'a') throw new Error('boom'); return 'ok'; }
    }, fn);
    const t = events.filter(e => e.type === 'tool');
    assert.deepStrictEqual(t.map(e => e.data.phase), ['call', 'call', 'error', 'result']);
    assert.strictEqual(t[2].data.error, 'boom');
    assert.strictEqual(bodies[1].messages.find(m => m.tool_call_id === '1').content, 'Error: boom');
  });

  test('a hop containing a non-concurrent tool runs fully serial', async () => {
    wire([hop([call('1', 'a'), call('2', 'send_follow_up')]), hop([])]);
    const { events, fn } = collect();
    let running = 0, maxRunning = 0;
    await run({
      concurrentTools: new Set(['a', 'b']),
      executeTool: async () => { running++; maxRunning = Math.max(maxRunning, running); await sleep(10); running--; return 'x'; }
    }, fn);
    assert.strictEqual(maxRunning, 1);
    assert.deepStrictEqual(events.filter(e => e.type === 'tool').map(e => `${e.data.phase}:${e.data.id}`),
      ['call:1', 'result:1', 'call:2', 'result:2']);
  });

  test('abort during a batch: the started batch is fully reported, nothing is emitted after the throw', async () => {
    const ac = new AbortController();
    const q = [hop([call('1', 'a'), call('2', 'b')]), hop([])];
    global.fetch = mock.fn(async (url, o) => {
      const body = JSON.parse(o.body);
      bodies.push(body);
      if (o.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return q.shift();
    });
    const { events, fn } = collect();
    await assert.rejects(run({
      signal: ac.signal,
      concurrentTools: new Set(['a', 'b']),
      executeTool: async ({ name }) => { if (name === 'a') ac.abort(); await sleep(5); return `r-${name}`; }
    }, fn));
    // The aborted signal stops the next hop before any request is built, so the
    // observable contract is: the started batch fully reported, then silence.
    assert.strictEqual(bodies.length, 1);
    assert.deepStrictEqual(events.filter(e => e.type === 'tool').map(e => `${e.data.phase}:${e.data.id}`),
      ['call:1', 'call:2', 'result:1', 'result:2']);
    assert.ok(!events.some(e => e.type === 'token' || e.type === 'done'));
  });
});
