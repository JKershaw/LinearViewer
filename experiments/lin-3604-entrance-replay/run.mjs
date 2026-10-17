/**
 * LIN-3604 replay runner. Drives the four dispatch entrances over HTTP, one input at a time,
 * against the tree named by --tree, and writes one JSON record per input to --out.
 *
 *   TZ=UTC NODE_ENV=test node --import ./preload.mjs ./run.mjs --tree <root> --out <file> [--lane S,P,Ro,Rl,K] [--limit N]
 *
 * Run it once against a `git archive` of the merge-base and once against the branch, then
 * `node compare.mjs old.jsonl new.jsonl`. The inputs come from inputs.mjs and depend only on
 * the seed, so both runs see the identical request stream.
 */
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { writeFileSync, appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildInputs } from './inputs.mjs';
import { buildWorld, loadTree, ser } from './world.mjs';

const { values: args } = parseArgs({ options: { tree: { type: 'string' }, out: { type: 'string' }, lane: { type: 'string' }, limit: { type: 'string' }, seed: { type: 'string' }, mutate: { type: 'string' } } });
if (!args.tree || !args.out) throw new Error('usage: run.mjs --tree <root> --out <file>');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(port, input) {
  return new Promise((resolve) => {
    const payload = input.rawBody !== undefined ? input.rawBody : (input.noBody ? null : JSON.stringify(input.body));
    const headers = { ...(input.headers || {}) };
    if (payload !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: input.path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => resolve({ status: 'res-error', headers: {}, text: '' }));
    });
    req.on('error', () => resolve({ status: 'aborted', headers: {}, text: '' }));
    if (input.world?.hangupAfterMs) setTimeout(() => req.destroy(), input.world.hangupAfterMs);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const KEEP_HEADERS = /^(content-type|retry-after|ratelimit.*|x-ratelimit.*)$/i;

async function runOne(tree, input) {
  const console_ = [];
  globalThis.__replayConsole = console_;
  // The free-tier lane is decided by env (resolveChatCredential); no paid env key is ever set.
  delete process.env.OPENROUTER_API_KEY;
  if (input.world?.freeEnv) process.env.OPENROUTER_FREE_TIER_KEY = 'free-fixture'; else delete process.env.OPENROUTER_FREE_TIER_KEY;
  const { app, rec, path } = buildWorld(tree, input);
  const server = await new Promise((resolve) => { const s = createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
  let result;
  try {
    result = await send(server.address().port, { ...input, path });
    const w = input.world || {};
    await sleep(w.slowMs ? w.slowMs + 60 : 12);
  } finally {
    await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
    globalThis.__replayConsole = null;
  }
  const headers = {};
  for (const [k, v] of Object.entries(result.headers || {})) if (KEEP_HEADERS.test(k)) headers[k] = v;
  // A keepalive that flushed wrote one leading space before the JSON; keep that fact, not the count.
  const text = result.text;
  const flushed = /^\s/.test(text);
  // The listening port is the only thing that differs between two runs of the same request.
  const norm = (str) => str.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT');
  return {
    id: input.id, lane: input.lane, tag: input.tag,
    status: result.status, headers, flushed, body: norm(text.replace(/^\s+/, '')),
    calls: rec.calls.map((c) => norm(ser(c, { sortKeys: c[1] === 'addItem' }))),
    console: console_.map(([level, message]) => [level, norm(message)])
  };
}

const tree = await loadTree(args.tree);
let inputs = buildInputs({ seed: args.seed ? Number(args.seed) : 3604 });
if (args.lane) { const lanes = new Set(args.lane.split(',')); inputs = inputs.filter((i) => lanes.has(i.lane)); }
if (args.limit) inputs = inputs.slice(0, Number(args.limit));
writeFileSync(args.out, '');
let n = 0;
for (const input of inputs) {
  let record;
  try { record = await runOne(tree, input); } catch (err) { record = { id: input.id, lane: input.lane, tag: input.tag, harnessError: String(err?.stack || err) }; }
  appendFileSync(args.out, `${JSON.stringify(record)}\n`);
  n += 1;
}
process.stderr.write(`replayed ${n} inputs against ${args.tree}\n`);
process.exit(0);
