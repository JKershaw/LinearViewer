#!/usr/bin/env node
/**
 * Harvest real brief test cases from the workspace API proxy.
 *
 * Built for the in-browser-LLM feasibility experiment: the question is whether a
 * small model running on the user's own device (WebGPU / WebLLM / a built-in
 * Prompt API) can do a job Harbour currently sends to OpenRouter. The brief is
 * the chosen probe because it is a pure text→text transform with a fixed output
 * contract and no tool use, so it can be run anywhere the prompt fits.
 *
 * A case is a golden pair:
 *   input  — the EXACT messages lib/brief.js would send (real BRIEF_SYSTEM_PROMPT
 *            + real formatIssueContext), so what the phone sees is the app's own
 *            prompt rather than a paraphrase of it
 *   output — the server's own brief for that issue, as the reference to judge
 *            the local model against
 *
 * The context is rebuilt from the proxy's source-neutral issue payload rather
 * than from provider.fetchRecommendationContext, so it is a close but not
 * byte-identical reconstruction: issue/description/labels/dates, parent, project,
 * children and comments all carry over, and siblings are recovered with one extra
 * parent read. Cousins and focusedChild (two-tier node mode) are not — they only
 * appear on epic-shaped parents, which are the cases too large for this
 * experiment anyway.
 *
 * Cost: harvesting is FREE by default. References are read with `noRefresh=1`,
 * which serves the brief cache and never calls OpenRouter — a case with no cached
 * brief is recorded with `reference: null`. Pass --generate to spend a real LLM
 * call per missing reference.
 *
 * Usage:
 *   HARBOUR_PROXY_TOKEN=... node scripts/harvest-brief-cases.mjs
 *   HARBOUR_PROXY_TOKEN=... node scripts/harvest-brief-cases.mjs --max-tokens 2500 --out cases.json
 *   HARBOUR_PROXY_TOKEN=... node scripts/harvest-brief-cases.mjs --print LIN-1558
 *
 * Flags:
 *   --ids A,B,C     harvest these identifiers instead of walking the stack
 *   --limit N       stack tasks to consider (default 50, max 50)
 *   --max-tokens N  drop cases whose prompt exceeds this estimate (default: keep all)
 *   --generate      spend an LLM call for references that are not cached
 *   --print ID      write one case's paste-ready prompt to stdout and exit
 *   --out PATH      output file (default brief-cases.json)
 *
 * Env:
 *   HARBOUR_PROXY_TOKEN  working proxy token (exchange a bootstrap first)
 *   HARBOUR_PROXY_BASE   proxy base URL (default https://harbour.cat)
 */
import { writeFileSync } from 'node:fs';
import { buildBriefMessages } from '../lib/brief.js';

const TOKEN = process.env.HARBOUR_PROXY_TOKEN;
if (!TOKEN) {
  console.error('Set HARBOUR_PROXY_TOKEN (exchange your single-use bootstrap at POST /api/proxy/token first).');
  process.exit(1);
}
const BASE = (process.env.HARBOUR_PROXY_BASE || 'https://harbour.cat').replace(/\/$/, '');
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const has = (name) => args.includes(name);

const OUT = flag('--out') || 'brief-cases.json';
const LIMIT = Number(flag('--limit')) || 50;
const MAX_TOKENS = Number(flag('--max-tokens')) || Infinity;
const EXPLICIT_IDS = (flag('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
const PRINT_ID = flag('--print');
const GENERATE = has('--generate');

// The proxy rate-limits at 60 requests/minute per IP. That budget is spent by
// individual REQUESTS, not by cases (a case costs up to three), so the interval
// is enforced globally in `get` rather than as a per-case sleep — pacing per case
// is what makes a multi-call harvest silently 429 partway through.
const MIN_REQUEST_INTERVAL_MS = 1100;
const MAX_429_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let nextRequestAt = 0;
async function throttle() {
  const wait = nextRequestAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
}

async function get(path, attempt = 0) {
  await throttle();
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  const text = await res.text();

  if (res.status === 429 && attempt < MAX_429_RETRIES) {
    // Serve the window out rather than hammering it; the limiter is per-minute.
    const backoffMs = Number(res.headers.get('retry-after')) * 1000 || 15000 * (attempt + 1);
    console.error(`  429 — backing off ${Math.round(backoffMs / 1000)}s`);
    await sleep(backoffMs);
    return get(path, attempt + 1);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} → ${res.status}, non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${path} → ${res.status} ${body?.error || ''}`);
  return body;
}

/** Rough token estimate. Good enough to bucket cases by whether they fit a context window. */
const estimateTokens = (text) => Math.round(text.length / 4);

/**
 * Rebuild the shape lib/brief.js expects from the proxy's flat issue payload.
 * Siblings cost one extra read and are skipped when the issue has no parent.
 */
async function buildCase(identifier, maxTokens = Infinity) {
  const issue = await get(`/api/proxy/issues/${identifier}`);
  if (issue.trashed) return null;

  const context = {
    project: issue.project || null,
    parent: issue.parent || null,
    children: issue.children || [],
    comments: issue.comments || [],
    siblings: [],
    focusedChild: null
  };

  // Size-check on the issue read alone, before spending the parent and reference
  // reads: siblings are one short line each, so they cannot rescue a case that is
  // already over budget, and an over-budget case is about to be discarded anyway.
  const provisional = buildBriefMessages(issue, context);
  const provisionalTokens = provisional.reduce((n, m) => n + estimateTokens(m.content), 0);
  if (provisionalTokens > maxTokens) return { identifier: issue.identifier, oversized: true, promptTokensApprox: provisionalTokens };

  if (issue.parent?.identifier) {
    try {
      const parent = await get(`/api/proxy/issues/${issue.parent.identifier}`);
      context.siblings = (parent.children || []).filter((c) => c.id !== issue.id);
    } catch {
      // A parent we cannot read costs us the sibling lines, not the case.
    }
  }

  const messages = buildBriefMessages(issue, context);
  const system = messages.find((m) => m.role === 'system').content;
  const user = messages.find((m) => m.role === 'user').content;

  const refPath = `/api/proxy/issues/${identifier}/brief${GENERATE ? '' : '?noRefresh=1'}`;
  let reference = null;
  try {
    const brief = await get(refPath);
    // noRefresh returns status fresh|stale|missing; only `fresh` carries a body.
    if (brief.brief) {
      reference = { brief: brief.brief, model: brief.model, generatedAt: brief.generatedAt };
    }
  } catch (err) {
    console.error(`  reference unavailable for ${identifier}: ${err.message}`);
  }

  return {
    identifier: issue.identifier,
    title: issue.title,
    state: issue.state?.name || null,
    counts: {
      descriptionChars: (issue.description || '').length,
      comments: context.comments.length,
      commentChars: context.comments.reduce((n, c) => n + (c.body || '').length, 0),
      children: context.children.length
    },
    promptTokensApprox: estimateTokens(system) + estimateTokens(user),
    system,
    user,
    reference
  };
}

async function resolveIdentifiers() {
  if (EXPLICIT_IDS.length) return EXPLICIT_IDS;
  const stack = await get(`/api/proxy/stack?limit=${Math.min(LIMIT, 50)}&view=digest`);
  return (stack.tasks || []).map((t) => t.identifier);
}

async function main() {
  if (PRINT_ID) {
    const one = await buildCase(PRINT_ID);
    if (!one || one.oversized) {
      console.error(`${PRINT_ID} is trashed or unreadable.`);
      process.exit(1);
    }
    // Paste-ready: the two messages, separated so a chat UI with no system slot
    // can be fed the whole thing as one turn.
    process.stdout.write(`${one.system}\n\n---\n\n${one.user}\n`);
    return;
  }

  const identifiers = await resolveIdentifiers();
  console.error(`Harvesting ${identifiers.length} candidates from ${BASE}…`);

  const cases = [];
  const oversized = [];
  for (const id of identifiers) {
    try {
      const built = await buildCase(id, MAX_TOKENS);
      if (!built) continue;
      if (built.oversized) {
        oversized.push(built);
        console.error(`  skip ${id} (~${built.promptTokensApprox} tok > ${MAX_TOKENS})`);
        continue;
      }
      cases.push(built);
      console.error(`  ${id}: ~${built.promptTokensApprox} tok, reference ${built.reference ? 'yes' : 'MISSING'}`);
    } catch (err) {
      console.error(`  ${id} failed: ${err.message}`);
    }
  }

  cases.sort((a, b) => a.promptTokensApprox - b.promptTokensApprox);
  const withRef = cases.filter((c) => c.reference).length;
  writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, cases }, null, 2)}\n`);

  const tokens = cases.map((c) => c.promptTokensApprox);
  const pct = (p) => tokens[Math.floor((tokens.length - 1) * p)] ?? 0;
  console.error(`\nWrote ${cases.length} cases to ${OUT} (${withRef} with a reference brief).`);
  console.error(`Prompt tokens — min ${pct(0)}, p50 ${pct(0.5)}, p90 ${pct(0.9)}, max ${pct(1)}`);

  // The skipped population IS the headline feasibility number for a local model,
  // so report it rather than letting a small case file imply full coverage.
  if (oversized.length) {
    const overTokens = oversized.map((c) => c.promptTokensApprox).sort((a, b) => a - b);
    const share = Math.round((oversized.length / (oversized.length + cases.length)) * 100);
    console.error(`Over the ${MAX_TOKENS}-token budget: ${oversized.length} of ${oversized.length + cases.length} tasks (${share}%), up to ~${overTokens[overTokens.length - 1]} tok.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
