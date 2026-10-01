#!/usr/bin/env node
/**
 * LIN-1693 dense-context recommendation sweep harness.
 *
 * The measurement harness for the "Cut costs for Recommended next prompt" ticket.
 * It is NOT a second evaluation stack: it drives the SAME code path the product
 * uses — `resolveRecommendation` (lib/recommend-recurse.js) over each committed
 * context bundle, one hop = `getRecommendation` (lib/openrouter.js) — and it loads
 * the SAME fixtures as `scripts/eval-recommend-baseline.mjs`, including the
 * large/dense set built by `scripts/eval/build-large-dense-fixtures.mjs`. It adds
 * only what a cost sweep needs that the baseline harness does not:
 *
 *   - a per-run MODEL override threaded into `getRecommendation({ model })`
 *     (an existing option; no production behaviour is changed for it);
 *   - per-call accounting captured from OpenRouter's own response usage —
 *     prompt/completion tokens and the ACTUAL USD `cost` (usage.include:true),
 *     plus wall-clock latency — via the existing `setLlmCallRecorder` hook;
 *   - resumable, append-after-every-call JSONL output;
 *   - a hard `MAX_USD` spend cap that halts the sweep before exceeding it;
 *   - an immediate stop (no retry) on a 402 / "exceed your available credits";
 *   - a cheap deterministic prompt-quality check (structure + description-copy);
 *   - a STUB model mode for a full end-to-end dry run with zero paid calls.
 *
 * Usage:
 *   # real sweep (spends money):
 *   OPENROUTER_API_KEY=... node scripts/eval/eval-dense.mjs
 *   # dry run over every fixture, no network, no spend:
 *   STUB=1 node scripts/eval/eval-dense.mjs
 *
 * Env knobs:
 *   OPENROUTER_API_KEY  OpenRouter key (env or .env); required unless STUB=1
 *   MODELS              comma-separated model ids (default: the 5 planned models)
 *   K                   repeats per (model,target)             (default 1)
 *   MAX_USD             hard spend cap for THIS sweep          (default 10)
 *   STUB                when set, install a fake transport; zero calls, zero cost
 *   ONLY                substring filter on target id
 *   FIXTURES_DIR        fixtures dir override
 *   OUT_DIR             output dir override (default recommend-baseline/<DATE>-dense)
 *   DATE                output date stamp (default 2026-10-01)
 *
 * Output (append-only; safe to re-run — completed (model,target,run) rows are skipped):
 *   <OUT_DIR>/calls.jsonl   one row per LLM call (actual usage + cost + latency)
 *   <OUT_DIR>/runs.jsonl    one row per (model,target,run): grade + per-run cost
 *   <OUT_DIR>/summary.json  aggregate + per-model + per-action + prompt-quality
 *   <OUT_DIR>/summary.md    human table
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getRecommendation, setLlmCallRecorder, setFetchImpl } from '../../lib/openrouter.js';
import { resolveRecommendation } from '../../lib/recommend-recurse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = !!process.env.STUB;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!STUB && !OPENROUTER_API_KEY) { console.error('Set OPENROUTER_API_KEY (env or .env), or STUB=1 for a dry run'); process.exit(1); }

const DEFAULT_MODELS = [
  'openai/gpt-5.6-sol',          // incumbent (price fingerprint, 12b8569a)
  'openai/gpt-5.4-mini',         // current code default / weak reference
  'openai/gpt-5-mini',           // cheap candidate
  'google/gemini-2.5-flash-lite',// cheap candidate
  'qwen/qwen3.6-flash'           // cheap candidate
];
// Reference only, NOT run by default: openai/gpt-5.5 (~$0.40/call).
const MODELS = (process.env.MODELS ? process.env.MODELS.split(',') : DEFAULT_MODELS).map(s => s.trim()).filter(Boolean);
const K = Number(process.env.K) || 1;
const MAX_USD = process.env.MAX_USD != null ? Number(process.env.MAX_USD) : 10;
const ONLY = process.env.ONLY;
const DATE = process.env.DATE || '2026-10-01';
const FIXTURES_DIR = process.env.FIXTURES_DIR || join(HERE, 'fixtures', 'recommend');
const OUT_DIR = process.env.OUT_DIR || join(HERE, 'recommend-baseline', `${DATE}-dense`);

const CALLS_PATH = join(OUT_DIR, 'calls.jsonl');
const RUNS_PATH = join(OUT_DIR, 'runs.jsonl');

const norm = s => (s || '').toLowerCase().trim();
const acceptOf = t => new Set((Array.isArray(t.expect) ? t.expect : (t.expect ? [t.expect] : [])).map(norm));

function loadWorkspaces(dir) {
  if (!existsSync(dir)) { console.error(`No fixtures dir: ${dir}`); process.exit(1); }
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    const ws = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!ws.bundles || !ws.targets) throw new Error(`fixture ${f} missing targets/bundles`);
    return { name: ws.name || f.replace(/\.json$/, ''), file: f, targets: ws.targets, bundles: ws.bundles };
  });
}

function readJsonl(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function appendJsonl(p, obj) { appendFileSync(p, JSON.stringify(obj) + '\n'); }

// ---- deterministic prompt-quality check (beat 2 proposal) -------------------------
// Zero-LLM-cost. Catches the blind spot kind-only grading has: a model that picks the
// right action but emits an empty, malformed, or description-copying prompt.
function checkPrompt(prompt, issue) {
  const problems = [];
  if (!prompt || !prompt.trim()) { problems.push('empty'); return { ok: false, problems }; }
  if (!/^#\s/.test(prompt.trim())) problems.push('no-header');
  if (!/##\s/.test(prompt)) problems.push('no-sections');
  const desc = (issue.description || '').replace(/\s+/g, ' ').trim();
  if (desc.length > 240) {
    const shingles = new Set();
    for (let i = 0; i + 60 <= desc.length; i += 30) shingles.add(desc.slice(i, i + 60));
    if (shingles.size) {
      let hit = 0;
      for (const s of shingles) if (prompt.includes(s)) hit++;
      if (hit / shingles.size > 0.6) problems.push('copies-description');
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---- stub transport (dry-run) -----------------------------------------------------
// Emits a valid recommendation for the issue found in the meta-prompt. For a node
// (a SUGGESTED NEXT defer candidate present) it emits `defer` to that child so the
// descent is exercised; otherwise it emits the target's first expected action so the
// dry run also proves the grader end-to-end. Cost 0 — no network.
//
// Test knobs (dry-run only):
//   STUB_COST=<n>     report a fake USD cost per call (proves the MAX_USD cap)
//   STUB_FAIL_AT=<n>  make call #n return HTTP 402 "exceed your available credits"
//                     (proves the immediate-stop-on-402 behaviour)
function installStub(fixtures) {
  const actionFor = {};
  const stubCost = Number(process.env.STUB_COST) || 0;
  const failAt = Number(process.env.STUB_FAIL_AT) || 0;
  let n = 0;
  const add = (key, a) => { if (key && a) actionFor[key] = a; };
  for (const ws of fixtures) for (const t of ws.targets) {
    const a = Array.isArray(t.expect) ? t.expect[0] : t.expect;
    add(t.id, a);
    add(ws.bundles[t.id]?.issue?.identifier, a);
    const d = t.descentExpect;
    if (d && d !== t.id) { add(d, a); add(ws.bundles[d]?.issue?.identifier, a); }
  }
  setFetchImpl(async (_url, opts = {}) => {
    n++;
    if (failAt && n === failAt) {
      return { ok: false, status: 402, json: async () => ({}), text: async () => 'This request would exceed your available credits' };
    }
    const body = JSON.parse(opts.body || '{}');
    const prompt = body.messages?.[0]?.content || '';
    const idM = prompt.match(/\*\*Issue:\*\* ([A-Za-z0-9][A-Za-z0-9._-]*)/);
    const id = idM ? idM[1] : 'UNKNOWN';
    const suggested = prompt.match(/SUGGESTED NEXT \(defer candidate\): ([A-Za-z0-9][A-Za-z0-9._-]*)/);
    let content;
    if (suggested) {
      content = `## Reasoning\nHealthy container; the next work lives in the child.\n\n→ **defer**\n\n**DeferTo:** ${suggested[1]}\n`;
    } else {
      const action = actionFor[id] || 'research';
      content = `## Reasoning\nDense context assessed (stub).\n\n→ **${action}**\n\n## Prompt\n# ${action} ${id}: stub\n\n## Context\nStub prompt for the dry run — references ${id}, copies nothing.\n\n## Goal\n**Role**: stub\n\nProduce the ${action} deliverable for ${id}.\n`;
    }
    const pt = Math.round(prompt.length / 4);
    return {
      ok: true, status: 200,
      json: async () => ({
        model: body.model, provider: 'stub',
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: pt, completion_tokens: 80, total_tokens: pt + 80, cost: stubCost }
      }),
      text: async () => ''
    };
  });
}

// ---- one recommend hop with per-call usage capture --------------------------------
let pendingCalls = [];
function makeComputeOne(bundles, model, onCall) {
  return async function computeOne(identifier) {
    const b = bundles[identifier];
    if (!b) throw new Error(`not found: ${identifier}`);
    pendingCalls = [];
    const t0 = Date.now();
    const recommendation = await getRecommendation(
      b.issue,
      {
        parent: b.parent, siblings: b.siblings || [], siblingsTotal: b.siblingsTotal || 0,
        project: b.project, children: b.children || [], comments: b.comments || [],
        focusedChild: b.focusedChild || null
      },
      { apiKey: OPENROUTER_API_KEY, model, featureFlags: {} }
    );
    const wallMs = Date.now() - t0;
    for (const c of pendingCalls) onCall({ model, hop: identifier, wallMs, ...c });
    pendingCalls = [];
    return {
      identifier: b.issue.identifier,
      reasoning: recommendation.reasoning,
      prompt: recommendation.prompt,
      truncated: recommendation.truncated,
      recommendedAction: recommendation.recommendedAction,
      deferTo: recommendation.deferTo || null,
      state: b.issue.state,
      children: b.children || []
    };
  };
}

const CREDIT_RE = /(402|exceed your available credits|insufficient credits|not enough credits|weight_exceeds_budget|limit_source:\s*openrouter_credits)/i;

async function runOne(model, ws, target, state) {
  const accept = acceptOf(target);
  const descentExpect = target.descentExpect || target.id;
  const calls = [];
  let runCost = 0;
  const computeOne = makeComputeOne(ws.bundles, model, (c) => { calls.push(c); runCost += Number(c.cost) || 0; });
  let out;
  try {
    const { recommendation, deferredVia, deferTruncated, deferStopReason } =
      await resolveRecommendation({ computeOne, startIdentifier: target.id });
    const action = recommendation?.recommendedAction || null;
    const terminal = recommendation?.identifier || null;
    const prompt = recommendation?.prompt || null;
    const pq = prompt == null ? { ok: true, problems: ['defer'] } : checkPrompt(prompt, ws.bundles[terminal]?.issue || {});
    out = {
      model, target: target.id,
      workspace: ws.name, descentPath: deferredVia, terminal, action,
      expected: [...accept], descentExpect,
      actionCorrect: accept.size ? accept.has(norm(action)) : false,
      descentCorrect: norm(terminal) === norm(descentExpect),
      truncated: !!recommendation?.truncated, deferTruncated, deferStopReason,
      promptLength: prompt ? prompt.length : 0,
      promptOk: pq.ok, promptProblems: pq.problems,
      runCostUsd: Number(runCost.toFixed(6)),
      calls: calls.map(c => ({ hop: c.hop, promptTokens: c.promptTokens, completionTokens: c.completionTokens, totalTokens: c.totalTokens, costUsd: c.cost, latencyMs: c.wallMs, finishReason: c.finishReason }))
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    out = {
      model, target: target.id, workspace: ws.name, error: msg,
      credited402: CREDIT_RE.test(msg), actionCorrect: false, descentCorrect: false,
      runCostUsd: Number(runCost.toFixed(6)),
      calls: calls.map(c => ({ hop: c.hop, promptTokens: c.promptTokens, completionTokens: c.completionTokens, totalTokens: c.totalTokens, costUsd: c.cost, latencyMs: c.wallMs, finishReason: c.finishReason }))
    };
    if (CREDIT_RE.test(msg)) state.halted = { reason: 'credits', detail: msg };
  }
  state.spentUsd += Number(out.runCostUsd) || 0;
  return out;
}

// ---- main -------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const fixtures = loadWorkspaces(FIXTURES_DIR);
if (STUB) installStub(fixtures);

setLlmCallRecorder((rec) => { pendingCalls.push(rec); });

const done = new Set(readJsonl(RUNS_PATH).map(r => `${r.model}|${r.target}|${r.run}`));
const state = { spentUsd: 0, halted: null };
let completed = 0, skipped = 0;
const startedAt = Date.now();

outer:
for (const ws of fixtures) {
  for (const target of ws.targets) {
    if (ONLY && !target.id.includes(ONLY)) continue;
    for (let run = 1; run <= K; run++) {
      for (const model of MODELS) {
        const key = `${model}|${target.id}|${run}`;
        if (done.has(key)) { skipped++; continue; }
        if (state.halted) break outer;
        if (state.spentUsd >= MAX_USD) { state.halted = { reason: 'budget', detail: `spend ${state.spentUsd.toFixed(4)} >= MAX_USD ${MAX_USD}` }; break outer; }
        const rec = await runOne(model, ws, target, state);
        rec.run = run;
        // append the per-call rows first (the durable, per-call record) then the run row
        for (const c of rec.calls || []) appendJsonl(CALLS_PATH, { model: rec.model, target: rec.target, run, ...c });
        appendJsonl(RUNS_PATH, rec);
        completed++;
        process.stdout.write(`  ${model} ${target.id} r${run} → ${rec.error ? 'ERR' : rec.action} ${rec.actionCorrect ? '✓' : '✗'} $${(rec.runCostUsd || 0).toFixed(4)}\n`);
      }
    }
  }
}

// ---- summarize (from the durable jsonl, so resume counts the whole sweep) ---------
const runs = readJsonl(RUNS_PATH);
const calls = readJsonl(CALLS_PATH);
const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
const byModel = {};
for (const r of runs) {
  const m = byModel[r.model] = byModel[r.model] || { calls: 0, runs: 0, actionHit: 0, descentHit: 0, error: 0, costUsd: 0, promptOk: 0, promptTotal: 0, latencies: [] };
  m.runs++; if (r.error) m.error++;
  if (r.actionCorrect) m.actionHit++;
  if (r.descentCorrect) m.descentHit++;
  m.costUsd += Number(r.runCostUsd) || 0;
  if (typeof r.promptOk === 'boolean') { m.promptTotal++; if (r.promptOk) m.promptOk++; }
  for (const c of r.calls || []) m.latencies.push(c.latencyMs);
}
for (const c of calls) { const m = byModel[c.model] = byModel[c.model] || { calls: 0, runs: 0, actionHit: 0, descentHit: 0, error: 0, costUsd: 0, promptOk: 0, promptTotal: 0, latencies: [] }; m.calls++; }
for (const m of Object.values(byModel)) {
  m.latencies.sort((a, b) => a - b);
  m.p50LatencyMs = m.latencies.length ? m.latencies[Math.floor(m.latencies.length / 2)] : null;
  delete m.latencies;
}
const perAction = {};
for (const r of runs) {
  const k = (r.expected || []).map(norm).sort().join('|') || '—';
  const a = perAction[k] = perAction[k] || { hit: 0, n: 0, descentExpect: r.descentExpect };
  a.n++; if (r.actionCorrect) a.hit++;
}
const promptQuality = { ok: runs.filter(r => r.promptOk).length, total: runs.filter(r => typeof r.promptOk === 'boolean').length, bad: runs.filter(r => r.promptProblems && r.promptProblems.length && !(r.promptProblems.length === 1 && r.promptProblems[0] === 'defer')).map(r => ({ model: r.model, target: r.target, problems: r.promptProblems })) };
const summary = {
  generatedBy: 'scripts/eval/eval-dense.mjs',
  date: DATE, stub: STUB, models: MODELS, repeats: K,
  completedThisRun: completed, skippedResumed: skipped, totalRuns: runs.length,
  spentThisRunUsd: Number(state.spentUsd.toFixed(6)),
  totalCostUsd: Number(sum(runs.map(r => r.runCostUsd)).toFixed(6)),
  maxUsd: MAX_USD, halted: state.halted, wallSeconds: Math.round((Date.now() - startedAt) / 1000),
  byModel, perAction, promptQuality,
  overall: { actionHit: runs.filter(r => r.actionCorrect).length, n: runs.length, descentHit: runs.filter(r => r.descentCorrect).length, errors: runs.filter(r => r.error).length }
};
writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const pct = (x, n) => n ? Math.round((x / n) * 100) + '%' : '-';
const lines = [
  `# LIN-1693 dense recommendation sweep — ${DATE}${STUB ? ' (STUB dry run)' : ''}`, '',
  `harness: \`scripts/eval/eval-dense.mjs\` · models: ${MODELS.join(', ')} · K=${K} · cap $${MAX_USD}`,
  `runs: ${runs.length} · spend: $${summary.totalCostUsd.toFixed(4)}${state.halted ? ` · HALTED: ${state.halted.reason}` : ''}`, '',
  '| model | runs | action-acc | descent-acc | prompt-ok | errors | mean $/run | p50 latency |',
  '|---|---|---|---|---|---|---|---|'
];
for (const [m, v] of Object.entries(byModel)) {
  lines.push(`| ${m} | ${v.runs} | ${v.actionHit}/${v.runs} (${pct(v.actionHit, v.runs)}) | ${v.descentHit}/${v.runs} (${pct(v.descentHit, v.runs)}) | ${v.promptOk}/${v.promptTotal} | ${v.error} | $${(v.costUsd / (v.runs || 1)).toFixed(4)} | ${v.p50LatencyMs != null ? v.p50LatencyMs + 'ms' : '—'} |`);
}
lines.push('', '### Per expected-action', '', '| expect | descentExpect | accuracy |', '|---|---|---|');
for (const [k, v] of Object.entries(perAction)) lines.push(`| ${k} | ${v.descentExpect} | ${v.hit}/${v.n} (${pct(v.hit, v.n)}) |`);
writeFileSync(join(OUT_DIR, 'summary.md'), lines.join('\n') + '\n');

console.log(`\n[${STUB ? 'STUB' : 'sweep'}] runs=${runs.length} completed=${completed} skipped=${skipped} spend=$${summary.totalCostUsd.toFixed(4)}${state.halted ? ` HALTED=${state.halted.reason}` : ''}`);
console.log(`  ${join(OUT_DIR, 'summary.md')}`);
if (state.halted && state.halted.reason === 'credits') process.exitCode = 2;
