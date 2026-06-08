#!/usr/bin/env node
/**
 * LIN-263 spike 5b — push HARDER to find GPT-5.4-Mini's reliability cliff.
 *
 * spike 5 (clean prose, ≤40 comments) found NO failures. This pushes two levers that are
 * the likely real triggers of the malformed/incomplete responses seen in the field:
 *   1. SIZE — up to 120 comments (~20k+ input tokens).
 *   2. MESSY CONTENT — comments containing code fences, JSON blobs, markdown tables, and
 *      (the prime suspect) PASTED PRIOR RECOMMENDATIONS that themselves carry `## Reasoning`
 *      / `## Prompt` / `→ **action**` markers — exactly what confuses section parsing.
 *
 * Mini runs at K=10 (cheap; to catch a low-rate intermittent fail). gpt-5.5 spot-checks
 * the top sizes. Scored with the real parseRecommendationResponse; failure mode tallied.
 *
 *   OPENROUTER_API_KEY=... node scripts/eval/lin-263-spike5b.mjs
 *   ... CONTENT=clean SIZES=40,80 node scripts/eval/lin-263-spike5b.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { formatIssueContext, parseRecommendationResponse } from '../../lib/openrouter.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'lin-263-spike5-out');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }

const SIZES = (process.env.SIZES || '40,80,120').split(',').map(Number);
const KMINI = Number(process.env.K) || 10;
const CONTENT = process.env.CONTENT || 'messy';
const short = m => m.split('/')[1].replace('claude-', '');

const baseIssue = {
  identifier: 'SCALE-1', createdAt: '2026-05-01T00:00:00Z',
  state: { name: 'In Progress', type: 'started' }, labels: [],
  title: 'Add per-workspace rate limiting to the dispatch + proxy endpoints',
  description: `## What
Introduce per-workspace rate limiting across the dispatch queue API and the Linear API proxy so a single workspace cannot exhaust shared capacity. Limits configurable per workspace with sane defaults, surfaced in response headers, 429 with a retry hint when exceeded.
## Why
One busy workspace's automation has saturated the proxy and starved others. The global IP limit (60/min) doesn't isolate by workspace; dispatch has no limit at all.
## Done when
Each workspace has independent limits, 429s carry a retry hint, defaults are configurable, the global IP limit still applies as a backstop.`
};

// MESSY pool: code fences, JSON, a table, and pasted prior recommendations (the prime
// suspect — embedded `## Reasoning` / `## Prompt` / `→ **action**` markers).
const MESSY = [
  "Spiked it. Token-bucket keyed by workspace id. Note multi-dyno: in-memory under-counts by dyno count. v1 = approximate, document it. Hot path must stay in-memory (no Mongo round-trip per call).",
  "Pasting the prior recommendation we ran so it's on the record:\n\n## Reasoning\nPreparation: needed. The limiter algorithm and the retry math must agree.\n→ **plan**\n## Prompt\n# Plan SCALE-1\nMap the surfaces, choose bucket vs window, mirror the 429 contract. Verify with unit tests.\n\n— this is stale now, see below.",
  "Config shape we settled on:\n```json\n{ \"read\": 600, \"write\": 60, \"dispatch\": 120, \"scope\": \"workspace\", \"backstopIpLimit\": 60 }\n```\nStore overrides on the workspace-preferences doc.",
  "429 contract parity is load-bearing. Existing consumers parse `Retry-After` (seconds) + JSON `{error, retryAfter}`. Do NOT invent a new body. Add only `X-RateLimit-Scope: workspace`.",
  "Limits table we discussed:\n\n| group | default/min | notes |\n|---|---|---|\n| read | 600 | shares budget with recommend/brief/recap |\n| write | 60 | mutations |\n| dispatch | 120 | enqueue |\n\nThese are tunable via config.",
  "Blocker: dispatch consumer endpoints auth by Bearer token, workspace resolved in `dispatch-tokens.js`. Limiter must run AFTER token resolution — can't be a single app-level `app.use`. Mount per-router after auth.",
  "Another prior agent reply got pasted into the thread, ignore the action it picked:\n## Reasoning\n→ **implement**\n## Prompt\nJust add the limiter.\n\nThat was wrong — we hadn't resolved the bucket-vs-window question yet.",
  "Re-grounded at HEAD: `lib/rate-limit.js` already exists (LIN-210) and takes a key fn. Extend it with `keyBy`, don't write a second limiter. ```js\nrateLimit({ keyBy: req => workspaceId(req), max: cfg.read })\n```",
  "Edge case: token bucket allows a cold-start burst; the `Retry-After` math must be 'time to one refill', not 'window reset'. Retry hint must match the limiter algorithm or it'll be wrong.",
  "Scope cut for v1 (supersedes earlier Mongo discussion): extend helper with keyBy, in-memory approximate, contract-parity 429, token-bucket with matching retry, defaults behind a config accessor. Defer: Mongo-exact counting, free-tier ceilings, per-endpoint overrides."
];
const CLEAN = MESSY.map(s => s.replace(/```[\s\S]*?```/g, '(code omitted)').replace(/##\s*(Reasoning|Prompt)/g, 'section').replace(/→\s*\*\*\w+\*\*/g, 'an action').replace(/\|/g, '/'));
const POOL = CONTENT === 'clean' ? CLEAN : MESSY;

const makeComments = n => Array.from({ length: n }, (_, i) => ({
  user: i % 3 === 0 ? 'John' : (i % 3 === 1 ? 'Agent' : 'Reviewer'),
  createdAt: new Date(Date.UTC(2026, 4, 2 + i)).toISOString(),
  body: POOL[i % POOL.length] + (i >= POOL.length ? ` (pass ${Math.floor(i / POOL.length) + 1}, still load-bearing.)` : '')
}));

function buildMeta(n) {
  const comments = makeComments(n);
  const ctx = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments };
  return buildMetaPromptTemplate({
    issueContext: formatIssueContext(baseIssue, ctx), identifier: baseIssue.identifier,
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
    hasComments: comments.length > 0, commentCount: comments.length,
    aiHints: formatAIHintsForMetaPrompt(), actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(), focusedSubtaskId: null, featureFlags: {}
  });
}

async function callOnce(meta, model) {
  const t0 = Date.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 8000, usage: { include: true }, messages: [{ role: 'user', content: meta }] })
    });
    if (!r.ok) return { mode: 'http' + r.status, ms: Date.now() - t0 };
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    const finish = j.choices?.[0]?.finish_reason;
    const cost = j.usage?.cost ?? 0, ptok = j.usage?.prompt_tokens ?? null;
    if (!content) return { mode: 'empty', ms: Date.now() - t0, cost, ptok };
    try {
      const parsed = parseRecommendationResponse(content, finish, j.usage?.completion_tokens);
      if (finish === 'length' || parsed.truncated) return { mode: 'truncated', ms: Date.now() - t0, cost, ptok, content };
      if (!parsed.recommendedAction) return { mode: 'no-action', ms: Date.now() - t0, cost, ptok, content };
      return { mode: 'pass', action: parsed.recommendedAction, ms: Date.now() - t0, cost, ptok };
    } catch (e) { return { mode: 'malformed', detail: e.message.slice(0, 50), ms: Date.now() - t0, cost, ptok, content }; }
  } catch (e) { return { mode: 'neterr', detail: e.message.slice(0, 40), ms: Date.now() - t0 }; }
}

mkdirSync(OUT, { recursive: true });
const wc = s => (s.trim().match(/\S+/g) || []).length;
const MODELS = ['openai/gpt-5.4-mini', 'openai/gpt-5.5'];
console.log(`content=${CONTENT}  sizes=[${SIZES.join(', ')}]  mini K=${KMINI}, gpt-5.5 K=3 (top sizes)\n`);

const metaBySize = {}; for (const n of SIZES) metaBySize[n] = buildMeta(n);
for (const n of SIZES) console.log(`  ${String(n).padStart(3)} comments → ~${wc(metaBySize[n])} words`);
console.log();

let failsDumped = 0;
const grid = {};
for (const model of MODELS) {
  grid[model] = {};
  for (const n of SIZES) {
    const isMini = model.includes('mini');
    if (!isMini && n < SIZES[Math.max(0, SIZES.length - 2)]) { continue; } // gpt-5.5 only at top 2 sizes
    const k = isMini ? KMINI : 3;
    const runs = await Promise.all(Array.from({ length: k }, () => callOnce(metaBySize[n], model)));
    const pass = runs.filter(r => r.mode === 'pass').length;
    const modes = {}; for (const r of runs) modes[r.mode] = (modes[r.mode] || 0) + 1;
    const ok = runs.filter(r => r.cost != null);
    const avgMs = Math.round(ok.reduce((a, r) => a + r.ms, 0) / (ok.length || 1));
    const cost = ok.reduce((a, r) => a + (r.cost || 0), 0);
    const ptok = runs.find(r => r.ptok)?.ptok || null;
    grid[model][n] = { pass, k, modes, avgMs, cost, ptok };
    // dump up to 4 failing bodies for inspection
    for (const r of runs) if (r.mode !== 'pass' && r.content && failsDumped < 6) { writeFileSync(join(OUT, `FAIL_${short(model)}_${n}c_${failsDumped++}.md`), `# ${model} ${n}c — ${r.mode} ${r.detail || ''}\n\n---\n${r.content}`); }
    const fails = Object.entries(modes).filter(([m]) => m !== 'pass').map(([m, c]) => `${m}×${c}`).join(',') || '-';
    console.log(`${short(model).padEnd(14)} ${String(n).padStart(3)}c (${String(ptok).padStart(6)}tok)  ${pass}/${k} pass   fails: ${fails.padEnd(26)} ${avgMs}ms  $${cost.toFixed(4)}`);
  }
  console.log();
}
writeFileSync(join(OUT, `spike5b-${CONTENT}.json`), JSON.stringify({ content: CONTENT, sizes: SIZES, grid, ranAt: new Date().toISOString() }, null, 2));
console.log(`Failing bodies (if any) + spike5b-${CONTENT}.json in ${OUT}/`);
