#!/usr/bin/env node
/**
 * LIN-263 spike 5 — context-scaling RELIABILITY test for the recommend endpoint.
 *
 * John's field report: GPT-5.4-Mini occasionally returns malformed or incomplete
 * recommendations on large-ish task contexts; a rerun fixes it. That's an intermittent
 * FORMAT/COMPLETENESS reliability failure, invisible at K=1. This finds the breakpoint.
 *
 * Independent variable: number of comments on the task (the dimension that balloons as a
 * task ages). At each size we run K runs/model and score each with the REAL production
 * parser (parseRecommendationResponse) — the exact surface that fails in prod:
 *   PASS  = parser returns a recommendedAction, a non-empty prompt (or a valid defer),
 *           and finish_reason != 'length'.
 *   FAIL  = malformed (parser throws / no action line) OR truncated (incomplete).
 * We tally the failure MODE so we can see whether it's bad format or a cut-off body.
 *
 *   OPENROUTER_API_KEY=... node scripts/eval/lin-263-spike5.mjs
 *   ... SIZES=0,10,20,40 K=5 node scripts/eval/lin-263-spike5.mjs
 *
 * Answers: "did we test a non-mini GPT?" (now yes — gpt-5.5) and "how big until mini
 * struggles?" (the reliability-vs-size curve).
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

const MODELS = (process.env.MODELS || 'openai/gpt-5.4-mini,openai/gpt-5.5,anthropic/claude-opus-4.8').split(',');
const SIZES = (process.env.SIZES || '0,5,10,20,40').split(',').map(Number);
const K = Number(process.env.K) || 5;
const KREF = 2; // cheaper anchor: opus runs fewer
const RECOMMENDATION_MAX_TOKENS = 8000; // mirror lib/openrouter.js
const short = m => m.split('/')[1].replace('claude-', '');

// A realistic, in-progress task whose substance genuinely needs a prompt (a plan-ish leaf).
const baseIssue = {
  identifier: 'SCALE-1', createdAt: '2026-05-01T00:00:00Z',
  state: { name: 'In Progress', type: 'started' }, labels: [],
  title: 'Add per-workspace rate limiting to the dispatch + proxy endpoints',
  description: `## What
Introduce per-workspace rate limiting across the dispatch queue API and the Linear API proxy so a single workspace cannot exhaust shared capacity. Limits should be configurable per workspace with sane defaults, surfaced in the response headers, and return 429 with a retry hint when exceeded.

## Why
We've seen one busy workspace's automation saturate the proxy and starve others. The existing global IP rate limit (60/min) doesn't isolate by workspace, and dispatch has no limit at all.

## Surfaces (initial)
- \`routes/proxy.js\` — the consumer endpoints (read + write groups).
- \`routes/dispatch.js\` — the queue + consumer endpoints.
- A shared limiter helper (new) keyed by workspace id.
- Response headers + the 429 body shape (shared with the existing IP limiter).

## Done when
Each workspace has independent limits, 429s carry a retry hint, defaults are configurable, and the existing global IP limit still applies as a backstop.`
};

// Pool of substantive, varied engineering comments (~120-180 words each) so context grows
// the way a real aging thread does — decisions, pivots, findings, blockers, corrections.
const POOL = [
  `Spiked the limiter approach. A token-bucket keyed by workspace id (not IP) is the right primitive — IP buckets leak across NAT'd consumers and don't isolate workspaces. Reusing the existing in-memory store is fine for single-dyno, but note we run multiple dynos on Heroku, so an in-memory bucket under-counts by a factor of the dyno count. Either pin to a shared store (Mongo) or accept approximate limits. Recommend: approximate is acceptable for v1 (the goal is starvation prevention, not billing-grade accuracy), but document it. Constraint surfaced: must NOT block the request path on a Mongo round-trip per call — that adds latency to every proxy hit. Keep the hot path in-memory, reconcile lazily.`,
  `Correction to my last comment: we cannot use the existing IP limiter's 429 body verbatim. The proxy integration guide documents the IP-limit 429 as having a \`Retry-After\` seconds header only; consumers parse that. If we add a workspace limit with a different body shape we break existing consumers. Decision: the workspace 429 MUST mirror the IP 429 contract exactly (same \`Retry-After\` header, same JSON \`{error, retryAfter}\`). The only new thing is an \`X-RateLimit-Scope: workspace\` header so a consumer can tell which limit fired. This is load-bearing — don't invent a new error shape.`,
  `Blocker: the dispatch consumer endpoints authenticate by Bearer token, not session, so "workspace id" isn't on the request the way it is for the session-auth user endpoints. We resolve the token → workspace in \`dispatch-tokens.js\`. The limiter has to run AFTER token resolution, not as upstream middleware. That reorders the middleware stack. Flagging because it means the limiter can't be a single app-level \`app.use\` — it has to be mounted per-router after auth.`,
  `Re-grounded against HEAD. \`routes/proxy.js\` already imports a \`rateLimit\` helper from \`lib/\` for the IP limit (added in LIN-210). We should extend that helper with a \`keyBy\` option rather than writing a second limiter — two limiter implementations will drift. Checked: the helper is pure-ish (takes a key fn), so adding \`keyBy: req => workspaceId(req)\` is a small change. Updating the plan: NOT a new helper file; extend the existing \`lib/rate-limit.js\`.`,
  `Product input: defaults. We discussed 600 req/min/workspace for read, 60/min for write, 120/min for dispatch enqueue. These are starting points — make them config so we can tune without a deploy. Store the overrides on the workspace preferences doc (we already have \`workspace-preferences.js\`). Open question: do free-tier workspaces get a lower ceiling? Leaving that out of v1 unless it's trivial.`,
  `Found an edge case while testing the spike: burst behaviour. A token bucket with refill allows a burst up to the bucket size on a cold workspace, which is correct, but our retry hint computes \`Retry-After\` from a fixed window assumption. With a leaky/token bucket the correct retry is "time until one token refills," not "time until window reset." If we ship the window math with a bucket limiter the \`Retry-After\` will be wrong (too long). Constraint: the retry hint math must match the limiter algorithm. Pick one and keep them consistent.`,
  `Scope check after the above: this is creeping. Original ticket was "add a workspace limit." We've now got: bucket-vs-window, multi-dyno accuracy, middleware reordering, 429 contract parity, configurable defaults, and retry-hint correctness. I think v1 should be: extend the existing helper with keyBy, in-memory approximate, mirror the 429 contract, hardcode defaults with a config hook stubbed. Defer the Mongo-backed exact counting and the free-tier ceiling. Calling that out so the prompt for this scopes to v1 and doesn't try to do all of it.`,
  `Verified the existing tests. \`tests/unit/rate-limit.test.js\` asserts the IP limiter's window reset and the 429 body. If we extend the helper we must keep those green AND add workspace-keyed cases. There's also an e2e in \`tests/e2e/proxy.spec.js\` that asserts a 429 after N requests — that one pins the IP path; a workspace-keyed test should sit alongside it, not replace it. Don't modify the existing assertions; add parallel ones.`,
  `One more finding: the foreman endpoints (\`/api/proxy/stack\`, \`/recommend\`, etc.) share the proxy router, so they'd inherit the workspace read limit. \`/recommend\` can take 25-60s and a consumer may legitimately poll it. If we count those against a 600/min read budget it's fine, but if someone sets a low override they could lock themselves out of recommend. Note in the prompt: recommend/brief/recap are read-group; document that they share the read budget so operators don't set it too low.`,
  `Decision recorded after sync: v1 ships in-memory approximate, keyBy workspace, contract-parity 429 with X-RateLimit-Scope, token-bucket with matching retry math, defaults hardcoded behind a config accessor. Deferred to follow-ups: Mongo-exact counting, free-tier ceilings, per-endpoint overrides. The plan prompt should reflect exactly this cut — not the full epic. This comment supersedes the earlier "maybe Mongo" discussion.`
];

const makeComments = n => Array.from({ length: n }, (_, i) => ({
  user: i % 3 === 0 ? 'John' : (i % 3 === 1 ? 'Agent' : 'Reviewer'),
  createdAt: new Date(Date.UTC(2026, 4, 2 + i)).toISOString(),
  body: POOL[i % POOL.length] + (i >= POOL.length ? ` (follow-up pass ${Math.floor(i / POOL.length) + 1}: re-confirmed at HEAD, still load-bearing.)` : '')
}));

function buildMeta(nComments) {
  const comments = makeComments(nComments);
  const ctx = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments };
  return buildMetaPromptTemplate({
    issueContext: formatIssueContext(baseIssue, ctx),
    identifier: baseIssue.identifier,
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
    hasComments: comments.length > 0, commentCount: comments.length,
    aiHints: formatAIHintsForMetaPrompt(),
    actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(),
    focusedSubtaskId: null, featureFlags: {}
  });
}

async function callOnce(meta, model) {
  const t0 = Date.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: RECOMMENDATION_MAX_TOKENS, usage: { include: true }, messages: [{ role: 'user', content: meta }] })
    });
    if (!r.ok) return { mode: 'http', ms: Date.now() - t0 };
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    const finish = j.choices?.[0]?.finish_reason;
    const cost = j.usage?.cost ?? 0;
    const promptTok = j.usage?.prompt_tokens ?? null;
    if (!content) return { mode: 'empty', ms: Date.now() - t0, cost, promptTok };
    // Score with the REAL production parser — this is the exact prod failure surface.
    try {
      const parsed = parseRecommendationResponse(content, finish, j.usage?.completion_tokens);
      if (finish === 'length' || parsed.truncated) return { mode: 'truncated', ms: Date.now() - t0, cost, promptTok };
      if (!parsed.recommendedAction) return { mode: 'no-action', ms: Date.now() - t0, cost, promptTok };
      return { mode: 'pass', action: parsed.recommendedAction, ms: Date.now() - t0, cost, promptTok };
    } catch (e) {
      return { mode: 'malformed', detail: e.message.slice(0, 50), ms: Date.now() - t0, cost, promptTok };
    }
  } catch (e) { return { mode: 'neterr', detail: e.message.slice(0, 40), ms: Date.now() - t0 }; }
}

mkdirSync(OUT, { recursive: true });
const wc = s => (s.trim().match(/\S+/g) || []).length;
console.log(`models=[${MODELS.map(short).join(', ')}]  sizes(comments)=[${SIZES.join(', ')}]  K=${K} (opus K=${KREF})\n`);

const metaBySize = {};
for (const n of SIZES) metaBySize[n] = buildMeta(n);
console.log('context sizes:');
for (const n of SIZES) console.log(`  ${String(n).padStart(2)} comments → ~${wc(metaBySize[n])} word meta-prompt`);
console.log();

const grid = {};
for (const model of MODELS) {
  grid[model] = {};
  const k = model.includes('opus') ? KREF : K;
  for (const n of SIZES) {
    const runs = await Promise.all(Array.from({ length: k }, () => callOnce(metaBySize[n], model)));
    const pass = runs.filter(r => r.mode === 'pass').length;
    const modes = {}; for (const r of runs) modes[r.mode] = (modes[r.mode] || 0) + 1;
    const okRuns = runs.filter(r => r.cost != null);
    const avgMs = Math.round(okRuns.reduce((a, r) => a + r.ms, 0) / okRuns.length);
    const cost = okRuns.reduce((a, r) => a + (r.cost || 0), 0);
    const ptok = runs.find(r => r.promptTok)?.promptTok || null;
    grid[model][n] = { pass, k, modes, avgMs, cost, ptok };
    const failModes = Object.entries(modes).filter(([m]) => m !== 'pass').map(([m, c]) => `${m}×${c}`).join(',') || '-';
    console.log(`${short(model).padEnd(14)} ${String(n).padStart(2)}c (${String(ptok).padStart(6)}tok)  ${pass}/${k} pass   fails: ${failModes.padEnd(28)}  ${avgMs}ms  $${cost.toFixed(4)}`);
  }
  console.log();
}

// reliability grid
console.log('===== RELIABILITY GRID (pass/K at each context size) =====');
console.log('comments→'.padEnd(16) + SIZES.map(n => (n + 'c').padStart(8)).join(''));
for (const model of MODELS) {
  let line = short(model).padEnd(16);
  for (const n of SIZES) { const c = grid[model][n]; line += `${c.pass}/${c.k}`.padStart(8); }
  console.log(line);
}
writeFileSync(join(OUT, 'spike5.json'), JSON.stringify({ models: MODELS, sizes: SIZES, K, ranAt: new Date().toISOString(),
  sizeTokens: Object.fromEntries(SIZES.map(n => [n, grid[MODELS[0]][n].ptok])), grid }, null, 2));
console.log(`\nspike5.json in ${OUT}/`);
