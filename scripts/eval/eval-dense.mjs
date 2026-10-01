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
 *   - a `MAX_USD` spend cap checked before each run: it halts once spend has met
 *     the cap, or once spend plus the largest run cost seen so far would exceed
 *     it — so a steady sweep halts BEFORE exceeding it. The first run of a sweep
 *     is unconditional (there is no observed cost to project from yet), so a
 *     single run can still carry spend over the cap;
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
 *   MAX_USD             spend cap for THIS sweep, checked before each run (default 10)
 *   STUB                when set, install a fake transport; zero calls, zero cost
 *   ONLY                substring filter on target id
 *   FIXTURES_DIR        fixtures dir override
 *   OUT_DIR             output dir override (default recommend-baseline/<DATE>-dense[-stub])
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
// STUB never reaches the network, so it must not require a real key. Supply a
// placeholder so `getRecommendation` gets past its key check and lands on the
// injected stub transport. The paid path keeps its normal key requirement.
const API_KEY = OPENROUTER_API_KEY || (STUB ? 'stub-dry-run-placeholder' : undefined);
const RESCORE = !!process.env.RESCORE;
if (!STUB && !RESCORE && !OPENROUTER_API_KEY) { console.error('Set OPENROUTER_API_KEY (env or .env), or STUB=1 for a dry run'); process.exit(1); }

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
const DENSE_ONLY = !!process.env.DENSE_ONLY;
const DATE = process.env.DATE || '2026-10-01';
const FIXTURES_DIR = process.env.FIXTURES_DIR || join(HERE, 'fixtures', 'recommend');
const OUT_DIR = process.env.OUT_DIR || join(HERE, 'recommend-baseline', `${DATE}-dense${STUB ? '-stub' : ''}`);

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
//   STUB_BAD_AT=<n>   make call #n return a 200 whose body fails the parser
//                     (a retriable format error — exercises retry cost accounting)
//   STUB_BAD_ALWAYS   make EVERY call fail the parser (exercises error-run cost)
function installStub(fixtures) {
  const actionFor = {};
  const stubCost = Number(process.env.STUB_COST) || 0;
  const failAt = Number(process.env.STUB_FAIL_AT) || 0;
  const badAt = Number(process.env.STUB_BAD_AT) || 0;
  const badAlways = !!process.env.STUB_BAD_ALWAYS;
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
    if (badAlways || (badAt && n === badAt)) {
      content = 'malformed stub response (missing ## Reasoning and ## Prompt)\n';
    } else if (suggested) {
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
function makeComputeOne(bundles, model, onCall, hopLog) {
  return async function computeOne(identifier) {
    const b = bundles[identifier];
    if (!b) throw new Error(`not found: ${identifier}`);
    // Every recorder row captured from this hop's FIRST attempt onward is real spend,
    // whether the attempt is retried or the hop ultimately throws. Keep them all and
    // flush them together; resetting per attempt (the old behaviour) silently dropped
    // the retried attempt's cost, and never flushing on a throw recorded every error
    // run as $0 — spend `MAX_USD` then could not see.
    const hopStart = pendingCalls.length;
    const flush = () => {
      for (const c of pendingCalls.slice(hopStart)) {
        onCall({ model, hop: identifier, wallMs: c.durationMs != null ? c.durationMs : c.wallMs, ...c });
      }
      pendingCalls.length = hopStart;
    };
    const callOnce = async () => {
      const t0 = Date.now();
      const recommendation = await getRecommendation(
        b.issue,
        {
          parent: b.parent, siblings: b.siblings || [], siblingsTotal: b.siblingsTotal || 0,
          project: b.project, children: b.children || [], comments: b.comments || [],
          focusedChild: b.focusedChild || null
        },
        { apiKey: API_KEY, model, featureFlags: {} }
      );
      return { recommendation, wallMs: Date.now() - t0 };
    };
    let res;
    try {
      res = await callOnce();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // Credit exhaustion is terminal — never retry it. Any OTHER error gets at most
      // ONE retry for this call, then it propagates (recorded as an error, not a miss).
      if (CREDIT_RE.test(msg)) { flush(); throw e; }
      try {
        res = await callOnce();
      } catch (e2) {
        flush();
        throw e2;
      }
    }
    const { recommendation } = res;
    flush();
    if (hopLog) hopLog.push({
      hop: identifier,
      action: recommendation.recommendedAction || null,
      deferTo: recommendation.deferTo || null,
      reasoning: recommendation.reasoning ? recommendation.reasoning.slice(0, 2000) : null
    });
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
  const hopLog = [];
  let runCost = 0;
  const computeOne = makeComputeOne(ws.bundles, model, (c) => { calls.push(c); runCost += Number(c.cost) || 0; }, hopLog);
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
      // The model's own stated assessment per hop (truncated) so beat 3 can tell a
      // wrong LABEL from a wrong MODEL on every dense target and every miss.
      reasoning: recommendation?.reasoning ? recommendation.reasoning.slice(0, 2000) : null,
      hops: hopLog,
      runCostUsd: Number(runCost.toFixed(6)),
      calls: calls.map(c => ({ hop: c.hop, promptTokens: c.promptTokens, completionTokens: c.completionTokens, totalTokens: c.totalTokens, costUsd: c.cost, latencyMs: c.wallMs, finishReason: c.finishReason }))
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    out = {
      model, target: target.id, workspace: ws.name, error: msg,
      credited402: CREDIT_RE.test(msg), actionCorrect: false, descentCorrect: false,
      hops: hopLog,
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

// Current accept-set / descentExpect per target, from the committed fixtures. Used
// both when running and when re-scoring offline (RESCORE=1), so a label fix in the
// fixtures is reflected without editing the raw result rows.
const targetMeta = {};
for (const ws of fixtures) for (const t of ws.targets) {
  targetMeta[t.id] = { expect: t.expect, descentExpect: t.descentExpect || t.id };
}

setLlmCallRecorder((rec) => { pendingCalls.push(rec); });

const done = new Set(readJsonl(RUNS_PATH).map(r => `${r.model}|${r.target}|${r.run}`));
const state = { spentUsd: 0, maxRunCostUsd: 0, halted: null };
let completed = 0, skipped = 0;
const startedAt = Date.now();

outer:
for (const ws of fixtures) {
  if (RESCORE) break;
  if (DENSE_ONLY && ws.name !== 'LargeDense') continue;
  for (const target of ws.targets) {
    if (ONLY && !target.id.includes(ONLY)) continue;
    for (let run = 1; run <= K; run++) {
      for (const model of MODELS) {
        const key = `${model}|${target.id}|${run}`;
        if (done.has(key)) { skipped++; continue; }
        if (state.halted) break outer;
        // Cap checked BEFORE each run. Once a run cost has been observed, halt if the
        // next run could cross the cap, so a steady sweep stops before exceeding it.
        // The FIRST run is unconditional (nothing to project from yet), so the cap can
        // still be overshot by that one run.
        const projected = state.maxRunCostUsd > 0 ? state.spentUsd + state.maxRunCostUsd : state.spentUsd;
        if (state.spentUsd >= MAX_USD || projected > MAX_USD) {
          state.halted = { reason: 'budget', detail: `spend ${state.spentUsd.toFixed(4)} + projected ${state.maxRunCostUsd.toFixed(4)} > MAX_USD ${MAX_USD}` };
          break outer;
        }
        const rec = await runOne(model, ws, target, state);
        state.maxRunCostUsd = Math.max(state.maxRunCostUsd, Number(rec.runCostUsd) || 0);
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
const isDense = (r) => r.workspace === 'LargeDense';
const order = () => ({ runs: 0, ok: 0, errors: 0, calls: 0,
  // lab view: errors EXCLUDED from the denominator
  actionHit: 0, actionN: 0, descentHit: 0, descentN: 0,
  denseOk: 0, smallOk: 0, denseActionHit: 0, smallActionHit: 0, denseDescentHit: 0,
  // production view: an error (unparseable response) is a FAILURE; denominator = runs
  prodHit: 0, prodN: 0, denseProdHit: 0, denseProdN: 0, smallProdHit: 0, smallProdN: 0,
  costUsd: 0, denseCostUsd: 0, smallCostUsd: 0,
  promptOk: 0, promptN: 0, latencyAll: [], latencyDense: [], confusion: {}, lin2149Descent: { hit: 0, n: 0 } });
const byModel = {};
// Recompute correctness from the CURRENT fixture accept-sets (targetMeta), not the
// stored beat-2 flags — this is what makes RESCORE reflect a label fix.
const scoreOf = (r) => {
  const meta = targetMeta[r.target] || { expect: r.expected, descentExpect: r.descentExpect };
  const accept = new Set((meta.expect || []).map(norm));
  const actionCorrect = !r.error && (accept.size ? accept.has(norm(r.action)) : false);
  const descentCorrect = !r.error && norm(r.terminal) === norm(meta.descentExpect);
  return { meta, actionCorrect, descentCorrect };
};
for (const r of runs) {
  const m = byModel[r.model] = byModel[r.model] || order();
  const { meta, actionCorrect, descentCorrect } = scoreOf(r);
  const dense = isDense(r);
  m.runs++;
  // production denominator counts every attempted run; an error is a production failure
  m.prodN++; if (actionCorrect) m.prodHit++;
  if (dense) { m.denseProdN++; if (actionCorrect) m.denseProdHit++; } else { m.smallProdN++; if (actionCorrect) m.smallProdHit++; }
  m.costUsd += Number(r.runCostUsd) || 0;
  if (dense) m.denseCostUsd += Number(r.runCostUsd) || 0; else m.smallCostUsd += Number(r.runCostUsd) || 0;
  if (r.target === 'LIN-2149') { m.lin2149Descent.n++; if (descentCorrect) m.lin2149Descent.hit++; }
  if (r.error) { m.errors++; continue; } // lab view excludes errors
  m.ok++;
  m.actionN++; if (actionCorrect) m.actionHit++;
  m.descentN++; if (descentCorrect) m.descentHit++;
  if (dense) { m.denseOk++; if (actionCorrect) m.denseActionHit++; if (descentCorrect) m.denseDescentHit++; }
  else { m.smallOk++; if (actionCorrect) m.smallActionHit++; }
  if (typeof r.promptOk === 'boolean') { m.promptN++; if (r.promptOk) m.promptOk++; }
  for (const c of r.calls || []) { m.latencyAll.push(c.latencyMs); if (dense) m.latencyDense.push(c.latencyMs); }
  const key = (meta.expect || []).map(norm).sort().join('|') || '—';
  const c = m.confusion[key] = m.confusion[key] || {};
  const got = norm(r.action) || '—';
  c[got] = (c[got] || 0) + 1;
}
for (const c of calls) { const m = byModel[c.model] = byModel[c.model] || order(); m.calls++; }
const pctl = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
// Wilson 95% interval for a binomial proportion (continuity not applied).
function wilson(k, n) {
  if (!n) return null;
  const z = 1.959963984540054, p = k / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { lo: Math.max(0, (c - h) / d), hi: Math.min(1, (c + h) / d) };
}
for (const m of Object.values(byModel)) {
  m.p50LatencyMs = pctl(m.latencyAll, 0.5);
  m.p90LatencyMs = pctl(m.latencyAll, 0.9);
  m.p50LatencyDenseMs = pctl(m.latencyDense, 0.5);
  m.meanCostPerCall = m.calls ? m.costUsd / m.calls : 0;
  m.meanCostPerDenseCall = (m.denseOk + (m.denseProdN - m.denseOk)) ? m.denseCostUsd / (m.denseProdN || 1) : 0;
  m.prodAccuracy = m.prodN ? m.prodHit / m.prodN : 0;
  m.labAccuracy = m.actionN ? m.actionHit / m.actionN : 0;
  m.wilsonProdAll = wilson(m.prodHit, m.prodN);
  m.wilsonProdSmall = wilson(m.smallProdHit, m.smallProdN);
  m.wilsonProdDense = wilson(m.denseProdHit, m.denseProdN);
  delete m.latencyAll; delete m.latencyDense;
}
const perAction = {};
for (const r of runs) {
  if (r.error) continue;
  const { meta, actionCorrect } = scoreOf(r);
  const k = (meta.expect || []).map(norm).sort().join('|') || '—';
  const a = perAction[k] = perAction[k] || { hit: 0, n: 0, descentExpect: meta.descentExpect, dense: isDense(r) };
  a.n++; if (actionCorrect) a.hit++;
}
const promptQuality = { ok: runs.filter(r => r.promptOk).length, total: runs.filter(r => typeof r.promptOk === 'boolean').length, bad: runs.filter(r => r.promptProblems && r.promptProblems.length && !(r.promptProblems.length === 1 && r.promptProblems[0] === 'defer')).map(r => ({ model: r.model, target: r.target, problems: r.promptProblems })) };
const summary = {
  generatedBy: 'scripts/eval/eval-dense.mjs',
  rescore: RESCORE,
  generatedFrom: 'saved raw outputs (runs.jsonl); correctness recomputed against current fixtures',
  date: DATE, stub: STUB, models: MODELS, repeats: K,
  completedThisRun: completed, skippedResumed: skipped, totalRuns: runs.length,
  spentThisRunUsd: Number(state.spentUsd.toFixed(6)),
  totalCostUsd: Number(sum(runs.map(r => r.runCostUsd)).toFixed(6)),
  maxUsd: MAX_USD, halted: state.halted, wallSeconds: Math.round((Date.now() - startedAt) / 1000),
  byModel, perAction, promptQuality,
  // production view: errors (unparseable response) are failures — what the user actually gets
  production: { hit: runs.filter(r => scoreOf(r).actionCorrect).length, n: runs.length, errors: runs.filter(r => r.error).length },
  // lab view: errors excluded
  lab: { hit: runs.filter(r => !r.error && scoreOf(r).actionCorrect).length, n: runs.filter(r => !r.error).length }
};
writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const pct = (x, n) => n ? Math.round((x / n) * 100) + '%' : '-';
const lines = [
  `# LIN-1693 dense recommendation sweep — ${DATE}${STUB ? ' (STUB dry run)' : ''}${RESCORE ? ' (RESCORED offline)' : ''}`, '',
  `harness: \`scripts/eval/eval-dense.mjs\` · models: ${MODELS.join(', ')} · K=${K} · cap $${MAX_USD}`,
  `runs: ${summary.production.n} · spend: $${summary.totalCostUsd.toFixed(4)}${state.halted ? ` · HALTED: ${state.halted.reason}` : ''}`, '',
  `**Production-fitness (errors count as failures): ${summary.production.hit}/${summary.production.n} (${pct(summary.production.hit, summary.production.n)}); lab view (errors excluded): ${summary.lab.hit}/${summary.lab.n} (${pct(summary.lab.hit, summary.lab.n)}) on ${summary.production.errors} errors.**`, '',
  '| model | runs | errors | prod-acc (all) | prod small | prod dense | lab-acc (ok only) | LIN-2149 descent | prompt-ok | mean $/call | dense $/call | p50 lat | p90 lat |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|'
];
for (const [m, v] of Object.entries(byModel)) {
  lines.push(`| ${m} | ${v.prodN} | ${v.errors} | ${v.prodHit}/${v.prodN} (${pct(v.prodHit, v.prodN)}) | ${v.smallProdHit}/${v.smallProdN} (${pct(v.smallProdHit, v.smallProdN)}) | ${v.denseProdHit}/${v.denseProdN} (${pct(v.denseProdHit, v.denseProdN)}) | ${v.actionHit}/${v.actionN} (${pct(v.actionHit, v.actionN)}) | ${v.lin2149Descent.hit}/${v.lin2149Descent.n} | ${v.promptOk}/${v.promptN} | $${v.meanCostPerCall.toFixed(4)} | $${v.meanCostPerDenseCall.toFixed(4)} | ${v.p50LatencyMs != null ? v.p50LatencyMs + 'ms' : '—'} | ${v.p90LatencyMs != null ? v.p90LatencyMs + 'ms' : '—'} |`);
}
lines.push('', '### Confusion by expected action (lab runs, current labels)', '', '| model | expect | got | n |', '|---|---|---|---|');
for (const [m, v] of Object.entries(byModel)) {
  for (const [exp, got] of Object.entries(v.confusion || {})) for (const [g, n] of Object.entries(got)) lines.push(`| ${m} | ${exp} | ${g} | ${n} |`);
}
lines.push('', '### Per expected-action (all models pooled, lab)', '', '| expect | dense | descentExpect | accuracy |', '|---|---|---|---|');
for (const [k, v] of Object.entries(perAction)) lines.push(`| ${k} | ${v.dense ? 'dense' : ''} | ${v.descentExpect} | ${v.hit}/${v.n} (${pct(v.hit, v.n)}) |`);
writeFileSync(join(OUT_DIR, 'summary.md'), lines.join('\n') + '\n');


console.log(`\n[${STUB ? 'STUB' : RESCORE ? 'RESCORE' : 'sweep'}] runs=${runs.length} completed=${completed} skipped=${skipped} spend=$${summary.totalCostUsd.toFixed(4)} prod=${summary.production.hit}/${summary.production.n}${state.halted ? ` HALTED=${state.halted.reason}` : ''}`);
console.log(`  ${join(OUT_DIR, 'summary.md')}`);
if (state.halted && state.halted.reason === 'credits') process.exitCode = 2;
