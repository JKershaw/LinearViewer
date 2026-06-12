#!/usr/bin/env node
/**
 * Recommendation-engine baseline eval harness (LIN-432 — the "red test").
 *
 * The safety net every later subtask of LIN-431 measures against. It exercises the
 * LOCAL recommendation pipeline — `resolveRecommendation` (lib/recommend-recurse.js)
 * driving a `computeOne` that calls `getRecommendation` (lib/openrouter.js) — NOT the
 * deployed `GET /api/proxy/recommend/:id`. The deployed endpoint runs production and
 * would not see later branch changes, so it can only ever be reference data; the
 * committed output of THIS harness is the baseline subtasks 2–5 compare against.
 *
 * How it stays workspace-agnostic with only a PROXY READ token (no Linear API key):
 * per descent hop it fetches the node from the proxy read endpoints
 * (`GET /api/proxy/issues/{id}`) and reshapes that JSON into the context object
 * `getRecommendation` consumes ({parent, siblings, project, children, comments,
 * focusedChild}) — re-creating the live branch of the proxy's inner
 * `computeRecommendation` (routes/proxy.js) entirely here in scripts/, touching zero
 * production code. `focusedChild` is LOAD-BEARING: descent only fires when the prompt
 * carries the SUGGESTED-NEXT pointer derived from it, so an epic without it would be
 * mis-framed as a leaf and never descend.
 *
 * Fidelity notes (the harness is internally consistent — all subtasks use it, so the
 * baseline is defined BY this harness, not by production parity):
 *   - Context assembly reuses the exact production constants/helpers where exported
 *     (`SIBLING_CAP`, `getStateOrder`, `selectFocusSubtask`).
 *   - The proxy `/issues/{id}` shape omits a few fields the Linear GraphQL fetch has:
 *     `parent.state` (absent), `project.content`/repo (absent → repo null), child
 *     labels/relations (so child `isBlocked` is effectively false), and cousins (would
 *     need a fetch per sibling). These are secondary context; their omission is noted
 *     here and held constant across every run so comparisons stay apples-to-apples.
 *   - Proxy GETs are cached for the whole invocation: context is deterministic, only
 *     the LLM sampling varies between the K repeats, so caching cuts proxy load (and
 *     the 60 req/min limiter) without changing what any run sees.
 *
 * Parameterised so adding the Harbour targets is CONFIG, not code: each workspace
 * carries its own proxy base + token (from env); a workspace with no token is skipped
 * with a logged "deferred" line (never silently dropped). The LinearViewer proxy token
 * is workspace-isolated, so HAR-149/545/616 stay blocked until a read-scope Harbour
 * token + base URL are provided via HARBOUR_PROXY_TOKEN / HARBOUR_PROXY_BASE.
 *
 * Usage:
 *   PROXY_TOKEN=... OPENROUTER_API_KEY=... node scripts/eval-recommend-baseline.mjs
 *   (OPENROUTER_API_KEY is also picked up from .env via dotenv.)
 *
 * Env knobs:
 *   PROXY_TOKEN          LinearViewer proxy READ token            (required for LinearViewer)
 *   PROXY_BASE           LinearViewer proxy base URL              (default https://projects.jkershaw.com/api/proxy)
 *   HARBOUR_PROXY_TOKEN  Harbour proxy READ token                 (optional — unblocks HAR targets)
 *   HARBOUR_PROXY_BASE   Harbour proxy base URL                   (optional)
 *   OPENROUTER_API_KEY   OpenRouter key for the local LLM call    (required; from env or .env)
 *   MODEL                model id                                 (default openai/gpt-5.4-mini — the prod default)
 *   K                    repeats per target                       (default 6)
 *   ONLY                 substring filter on target id            (e.g. ONLY=LIN-428)
 *   OUT_DIR              output dir override                      (default scripts/eval/recommend-baseline/<DATE>)
 *   DATE                 baseline date stamp                      (default 2026-06-12 — passed in; no clock in-script)
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRecommendation, SIBLING_CAP } from '../lib/openrouter.js';
import { resolveRecommendation } from '../lib/recommend-recurse.js';
import { selectFocusSubtask } from '../lib/tree.js';
import { getStateOrder } from '../lib/providers/state-map.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.error('Set OPENROUTER_API_KEY (env or .env)'); process.exit(1); }
const MODEL = process.env.MODEL || 'openai/gpt-5.4-mini';
const K = Number(process.env.K) || 6;
const ONLY = process.env.ONLY;
const DATE = process.env.DATE || '2026-06-12';
const OUT_DIR = process.env.OUT_DIR || join(HERE, 'eval', 'recommend-baseline', DATE);

/**
 * Target catalogue — config, not code. Add Harbour by supplying its token/base via
 * env; a workspace whose token is absent is skipped + logged, never silently dropped.
 *
 * role is descriptive only (epic/mid/leaf); every target is driven by starting
 * `resolveRecommendation` at its own id, so the captured descent path + terminal give
 * the LIN-428 direct-vs-descent cross-check (compare LIN-428 as a direct start node
 * against its appearance as the terminal of any epic/mid descent).
 */
const WORKSPACES = [
  {
    name: 'LinearViewer',
    base: process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
    token: process.env.PROXY_TOKEN,
    targets: [
      { id: 'LIN-385', role: 'epic' },
      { id: 'LIN-389', role: 'mid' },
      { id: 'LIN-428', role: 'leaf (direct cross-check)' }
    ]
  },
  {
    name: 'Harbour',
    base: process.env.HARBOUR_PROXY_BASE,
    token: process.env.HARBOUR_PROXY_TOKEN,
    targets: [
      { id: 'HAR-149', role: 'epic' },
      { id: 'HAR-545', role: 'mid' },
      { id: 'HAR-616', role: 'leaf' }
    ]
  }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const byStateOrder = (a, b) => (getStateOrder(a.state?.type) ?? 2) - (getStateOrder(b.state?.type) ?? 2);

/**
 * Cached proxy GET (context is deterministic across the K repeats). Retries on
 * 429/5xx with backoff so the 60 req/min limiter doesn't fail a run.
 */
function makeProxyGet(base, token) {
  const cache = new Map();
  return async function proxyGet(path) {
    if (cache.has(path)) return cache.get(path);
    let lastErr = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await sleep(1000 * 2 ** (attempt - 1)); // 1s,2s,4s,8s
      try {
        const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
        if (r.status === 404) throw new Error(`not found: ${path}`);
        if (!r.ok) throw new Error(`proxy ${r.status} on ${path}`);
        const j = await r.json();
        cache.set(path, j);
        return j;
      } catch (e) {
        if (/not found/i.test(e.message)) throw e;
        lastErr = e.message;
      }
    }
    throw new Error(`proxy GET failed (${lastErr}) on ${path}`);
  };
}

/** Reshape a proxy `/issues/{id}` payload into the issue slice getRecommendation reads. */
function reshapeIssue(raw) {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description,
    url: raw.url,
    state: raw.state,
    createdAt: raw.createdAt,
    labels: (raw.labels?.nodes || []).map(l => l.name)
  };
}

/** Build the full context object for one node from proxy reads (mirrors fetchRecommendationContext). */
async function fetchContext(proxyGet, identifier) {
  const raw = await proxyGet(`/issues/${identifier}`);
  const issue = reshapeIssue(raw);

  const children = (raw.children?.nodes || [])
    .map(c => ({ id: c.id, identifier: c.identifier, title: c.title, state: c.state }))
    .sort(byStateOrder);

  const comments = (raw.comments?.nodes || [])
    .map(c => ({ body: c.body, createdAt: c.createdAt, user: c.user?.name || 'Unknown' }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const parent = raw.parent
    ? { id: raw.parent.id, identifier: raw.parent.identifier, title: raw.parent.title, state: raw.parent.state }
    : null;

  const project = raw.project ? { name: raw.project.name, description: raw.project.content } : null;

  // Siblings via one parent fetch (proxy issue carries no sibling list itself).
  let siblings = [];
  let siblingsTotal = 0;
  if (parent) {
    try {
      const parentRaw = await proxyGet(`/issues/${parent.identifier}`);
      const all = (parentRaw.children?.nodes || [])
        .filter(c => c.id !== issue.id)
        .map(c => ({ id: c.id, identifier: c.identifier, title: c.title, state: c.state }))
        .sort(byStateOrder);
      siblingsTotal = all.length;
      siblings = all.slice(0, SIBLING_CAP);
    } catch { /* parent unreadable — leaf-grade context, acceptable */ }
  }

  // focusedChild (LOAD-BEARING for descent): pick the focus child and fetch its detail.
  let focusedChild = null;
  if (children.length) {
    const focus = selectFocusSubtask(children);
    if (focus) {
      const childRaw = await proxyGet(`/issues/${focus.identifier}`);
      focusedChild = {
        issue: {
          id: childRaw.id,
          identifier: childRaw.identifier,
          title: childRaw.title,
          description: childRaw.description,
          url: childRaw.url,
          state: childRaw.state,
          labels: (childRaw.labels?.nodes || []).map(l => l.name)
        },
        comments: (childRaw.comments?.nodes || [])
          .map(c => ({ body: c.body, createdAt: c.createdAt, user: c.user?.name || 'Unknown' }))
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      };
    }
  }

  return { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild };
}

/**
 * One recommend hop — the harness's own `computeOne`, mirroring routes/proxy.js's
 * inner computeRecommendation live branch (the shape resolveRecommendation needs:
 * recommendedAction + deferTo drive descent; state + children arm the LIN-353 guards).
 */
function makeComputeOne(proxyGet) {
  return async function computeOne(identifier) {
    const { issue, parent, siblings, siblingsTotal, project, children, comments, focusedChild } =
      await fetchContext(proxyGet, identifier);

    const recommendation = await getRecommendation(
      issue,
      { parent, siblings, siblingsTotal, project, children, comments, focusedChild },
      { apiKey: OPENROUTER_API_KEY, model: MODEL, featureFlags: {} }
    );

    return {
      identifier: issue.identifier,
      reasoning: recommendation.reasoning,
      prompt: recommendation.prompt,
      truncated: recommendation.truncated,
      recommendedAction: recommendation.recommendedAction,
      deferTo: recommendation.deferTo || null,
      state: issue.state,
      children
    };
  };
}

/** Run one target K times through resolveRecommendation, capturing each run. */
async function runTarget(workspace, target, proxyGet) {
  const computeOne = makeComputeOne(proxyGet);
  const runs = [];
  for (let i = 0; i < K; i++) {
    try {
      const { recommendation, deferredVia, deferTruncated, deferStopReason } =
        await resolveRecommendation({ computeOne, startIdentifier: target.id });
      runs.push({
        run: i + 1,
        descentPath: deferredVia,
        terminal: recommendation?.identifier || null,
        action: recommendation?.recommendedAction || null,
        promptLength: recommendation?.prompt ? recommendation.prompt.length : 0,
        deferTruncated,
        deferStopReason,
        prompt: recommendation?.prompt || null,
        reasoning: recommendation?.reasoning || null
      });
      process.stdout.write('.');
    } catch (e) {
      runs.push({ run: i + 1, error: e.message });
      process.stdout.write('x');
    }
  }
  process.stdout.write('\n');
  return { id: target.id, role: target.role, workspace: workspace.name, runs };
}

// ---- main ----
const results = [];
const skipped = [];

for (const ws of WORKSPACES) {
  const targets = ws.targets.filter(t => !ONLY || t.id.includes(ONLY));
  if (!targets.length) continue;
  if (!ws.token) {
    skipped.push({ workspace: ws.name, reason: 'no proxy token (deferred — supply token+base via env)', targets: targets.map(t => t.id) });
    console.log(`\n[${ws.name}] DEFERRED — no proxy token. Targets blocked: ${targets.map(t => t.id).join(', ')}`);
    continue;
  }
  const proxyGet = makeProxyGet(ws.base, ws.token);
  console.log(`\n[${ws.name}] base=${ws.base}  model=${MODEL}  K=${K}  targets=${targets.map(t => t.id).join(', ')}`);
  for (const t of targets) {
    console.log(`  ${t.id} (${t.role})`);
    results.push(await runTarget(ws, t, proxyGet));
  }
}

// ---- write artifacts ----
mkdirSync(OUT_DIR, { recursive: true });

const meta = { date: DATE, model: MODEL, repeats: K, generatedBy: 'scripts/eval-recommend-baseline.mjs (LIN-432)' };
writeFileSync(join(OUT_DIR, 'run.json'), JSON.stringify({ meta, results, skipped }, null, 2));

// Compact per-run table: descent path / terminal / action / prompt length.
const tableLines = [
  `# Recommendation baseline — ${DATE}`,
  '',
  `model: \`${MODEL}\` · repeats: ${K} · harness: \`scripts/eval-recommend-baseline.mjs\` (local pipeline, NOT deployed proxy)`,
  '',
  '| target | role | run | descent path | terminal | action | prompt len | stop |',
  '|---|---|---|---|---|---|---|---|'
];
for (const r of results) {
  for (const run of r.runs) {
    if (run.error) {
      tableLines.push(`| ${r.id} | ${r.role} | ${run.run} | — | — | ERROR | — | ${run.error.slice(0, 40)} |`);
      continue;
    }
    const path = (run.descentPath || []).join(' → ');
    tableLines.push(`| ${r.id} | ${r.role} | ${run.run} | ${path} | ${run.terminal || '—'} | ${run.action || '—'} | ${run.promptLength} | ${run.deferStopReason || ''} |`);
  }
}
if (skipped.length) {
  tableLines.push('', '## Deferred (config-blocked)', '');
  for (const s of skipped) tableLines.push(`- **${s.workspace}**: ${s.reason} — ${s.targets.join(', ')}`);
}
writeFileSync(join(OUT_DIR, 'table.md'), tableLines.join('\n') + '\n');

// Stable pointer file (the documented "red baseline" entry point).
const pointer = [
  '# Recommendation engine — red baseline (LIN-432)',
  '',
  `The committed baseline the LIN-431 subtasks (2–5) compare against. Produced by the`,
  `LOCAL recommendation pipeline via \`scripts/eval-recommend-baseline.mjs\` — never the`,
  `deployed \`/api/proxy/recommend\` (which runs production and won't see branch changes).`,
  '',
  `**Latest baseline:** \`scripts/eval/recommend-baseline/${DATE}/\``,
  `- \`table.md\` — compact per-run table (descent path / terminal / action / prompt length)`,
  `- \`run.json\` — full capture incl. every prompt + reasoning`,
  '',
  '## Regenerate',
  '',
  '```',
  'PROXY_TOKEN=<linearviewer read token> OPENROUTER_API_KEY=<key> \\',
  '  node scripts/eval-recommend-baseline.mjs',
  '```',
  '',
  'Add Harbour by supplying `HARBOUR_PROXY_TOKEN` + `HARBOUR_PROXY_BASE` (config, not code).',
  ''
].join('\n');
writeFileSync(join(HERE, 'eval', 'recommend-baseline.md'), pointer);

console.log(`\nBaseline written:`);
console.log(`  ${join(OUT_DIR, 'table.md')}`);
console.log(`  ${join(OUT_DIR, 'run.json')}`);
console.log(`  ${join(HERE, 'eval', 'recommend-baseline.md')} (pointer)`);
if (skipped.length) console.log(`  (${skipped.length} workspace(s) deferred — see table.md)`);
