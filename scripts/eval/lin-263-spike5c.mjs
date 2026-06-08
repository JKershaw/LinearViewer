#!/usr/bin/env node
/**
 * LIN-263 spike 5c — test the PRODUCTION STREAMING path (the UI's actual code path).
 *
 * spikes 5/5b stressed the BUFFERED parser (parseRecommendationResponse) and found mini
 * rock-solid to 120 messy comments. But the dashboard/UI uses getRecommendationStream +
 * StreamingSectionParser — a DIFFERENT assembler (incremental, 50KB buffer, boundary
 * detection across chunks). "Malformed or incomplete" is the signature of a streaming
 * assembly bug, so this exercises that path directly on the same hard contexts.
 *
 * For each run we check the streamed result the way the UI consumes it:
 *   - did a `prompt` phase fire (the UI shows a prompt only if it did)?
 *   - is the returned structured.prompt non-empty + an action present + not truncated?
 *   - do the streamed reasoning/prompt deltas reconstruct to a non-empty prompt?
 * A mismatch = a stream-only failure the buffered test can't see.
 *
 *   OPENROUTER_API_KEY=... node scripts/eval/lin-263-spike5c.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRecommendationStream } from '../../lib/openrouter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'lin-263-spike5-out');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }

const MODEL = process.env.MODEL || 'openai/gpt-5.4-mini';
const SIZES = (process.env.SIZES || '20,80,120').split(',').map(Number);
const K = Number(process.env.K) || 8;

const baseIssue = {
  identifier: 'SCALE-1', createdAt: '2026-05-01T00:00:00Z',
  state: { name: 'In Progress', type: 'started' }, labels: [],
  title: 'Add per-workspace rate limiting to the dispatch + proxy endpoints',
  description: `## What\nIntroduce per-workspace rate limiting across the dispatch queue API and the Linear API proxy. Configurable per workspace, sane defaults, headers, 429 with retry hint.\n## Why\nOne busy workspace's automation saturated the proxy and starved others.\n## Done when\nIndependent limits per workspace, 429s carry a retry hint, defaults configurable, global IP limit still a backstop.`
};
// Messy comments incl. pasted prior recommendations with section markers (prime suspect).
const MESSY = [
  "Spiked it. Token-bucket keyed by workspace id. Multi-dyno: in-memory under-counts. v1 approximate, hot path stays in-memory.",
  "Pasting the prior recommendation for the record:\n\n## Reasoning\nPreparation needed; limiter and retry math must agree.\n→ **plan**\n## Prompt\n# Plan SCALE-1\nMap surfaces, choose bucket vs window, mirror the 429 contract.\n\n(stale now)",
  "Config:\n```json\n{ \"read\": 600, \"write\": 60, \"dispatch\": 120, \"scope\": \"workspace\" }\n```",
  "429 parity load-bearing: consumers parse `Retry-After` + `{error, retryAfter}`. Add only `X-RateLimit-Scope`.",
  "| group | /min |\n|---|---|\n| read | 600 |\n| write | 60 |\n| dispatch | 120 |",
  "Blocker: dispatch auth is Bearer; workspace resolved in dispatch-tokens.js. Limiter runs AFTER auth, per-router.",
  "Ignore this pasted older reply:\n## Reasoning\n→ **implement**\n## Prompt\nJust add it.\n\nWrong — bucket question was open.",
  "HEAD: lib/rate-limit.js exists (LIN-210), takes a key fn. Extend with keyBy. ```js\nrateLimit({ keyBy: r => wsId(r) })\n```",
  "Edge: cold-start burst; Retry-After must be 'time to one refill', not window reset. Must match the algorithm.",
  "v1 cut (supersedes Mongo talk): keyBy + in-memory approximate + contract-parity 429 + matching retry + config accessor. Defer Mongo-exact, free-tier ceilings."
];
const makeComments = n => Array.from({ length: n }, (_, i) => ({
  user: i % 3 === 0 ? 'John' : 'Agent', createdAt: new Date(Date.UTC(2026, 4, 2 + i)).toISOString(),
  body: MESSY[i % MESSY.length] + (i >= MESSY.length ? ` (pass ${Math.floor(i / MESSY.length) + 1})` : '')
}));

async function streamOnce(n) {
  const context = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: makeComments(n) };
  let sawPromptPhase = false, reasoning = '', prompt = '', doneTruncated = null, errored = null;
  let structured = null;
  const t0 = Date.now();
  try {
    structured = await getRecommendationStream(baseIssue, context, { apiKey: KEY, model: MODEL }, (type, data) => {
      if (type === 'phase' && data.phase === 'prompt') sawPromptPhase = true;
      if (type === 'delta' && data.section === 'reasoning') reasoning += data.content;
      if (type === 'delta' && data.section === 'prompt') prompt += data.content;
      if (type === 'done') doneTruncated = data.truncated;
      if (type === 'error') errored = data;
    });
  } catch (e) { errored = e.message.slice(0, 80); }
  const ms = Date.now() - t0;
  // UI viability: a prompt phase fired AND streamed prompt text is non-trivial AND the
  // structured result agrees (non-empty prompt, action present, not truncated).
  const streamPromptOk = sawPromptPhase && prompt.trim().length > 40;
  const structOk = structured && structured.recommendedAction && (structured.prompt && structured.prompt.trim().length > 40) && !structured.truncated;
  const isDefer = structured && structured.recommendedAction === 'defer';
  const pass = errored ? false : (isDefer ? (sawPromptPhase === false) : (streamPromptOk && structOk));
  let mode = 'pass';
  if (errored) mode = 'error';
  else if (doneTruncated || structured?.truncated) mode = 'truncated';
  else if (!isDefer && !sawPromptPhase) mode = 'no-prompt-phase';
  else if (!isDefer && !streamPromptOk) mode = 'empty-stream-prompt';
  else if (!isDefer && !structOk) mode = 'struct-mismatch';
  return { pass, mode, ms, action: structured?.recommendedAction, streamLen: prompt.trim().length, structLen: structured?.prompt?.trim().length ?? 0, errored };
}

mkdirSync(OUT, { recursive: true });
console.log(`STREAMING path  model=${MODEL}  sizes=[${SIZES.join(', ')}]  K=${K}\n`);
const grid = {};
for (const n of SIZES) {
  const runs = [];
  // stream sequentially (each opens a streaming connection)
  for (let i = 0; i < K; i++) runs.push(await streamOnce(n));
  const pass = runs.filter(r => r.pass).length;
  const modes = {}; for (const r of runs) modes[r.mode] = (modes[r.mode] || 0) + 1;
  const avgMs = Math.round(runs.reduce((a, r) => a + r.ms, 0) / runs.length);
  grid[n] = { pass, k: K, modes, avgMs };
  const fails = Object.entries(modes).filter(([m]) => m !== 'pass').map(([m, c]) => `${m}×${c}`).join(',') || '-';
  // dump a mismatch sample
  const bad = runs.find(r => !r.pass);
  if (bad) writeFileSync(join(OUT, `STREAMFAIL_${n}c.json`), JSON.stringify(bad, null, 2));
  console.log(`${String(n).padStart(3)}c   ${pass}/${K} pass   fails: ${fails.padEnd(28)} streamLen~${runs[0].streamLen} structLen~${runs[0].structLen}  ${avgMs}ms`);
}
writeFileSync(join(OUT, 'spike5c-stream.json'), JSON.stringify({ model: MODEL, sizes: SIZES, K, grid, ranAt: new Date().toISOString() }, null, 2));
console.log(`\nspike5c-stream.json in ${OUT}/`);
