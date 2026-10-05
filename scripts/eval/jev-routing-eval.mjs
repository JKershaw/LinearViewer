#!/usr/bin/env node
/**
 * LIN-3107 — Jev routing-only evaluation harness (research infra; no production wiring).
 *
 * Question: can TypeSafe's Jev do STEP ONE of the meta prompt — choose the routing task
 * type — given a distilled current state and a direct, literal `choice` question, over the
 * live 17-action vocabulary? The writer/task-creation half stays on the incumbent.
 *
 * Three arms, SAME widened fixture set, K runs each:
 *   1. Jev + distilled state                              (the candidate)
 *   2. incumbent (gpt-5.4-mini) + distilled state         (model-vs-representation control)
 *   3. incumbent (gpt-5.4-mini) + raw state, via the LIVE  getRecommendation()  (the
 *      production incumbent; its cost/latency/prompt come from the graded call's own
 *      recorder hooks — no duplicate rebuild call). Since LIN-3300 that is the one path:
 *      the routing prompt (buildRouterPrompt) and its parse (routeStage); code assembles
 *      the stage prompt with no further model call.
 *
 * Fixture classes (see the README):
 *   A. scripts/eval/fixtures/*.json                       (7 real frozen)
 *   B. scripts/eval/fixtures/recommend/*.json             (54 targets over 10 files)
 *   C. scripts/eval-research-routing.mjs inline CASES[]   (24 inline)
 *   D. scripts/eval/fixtures-widened/*.json               (5 targets: LIN-830 x2, LIN-1084,
 *                                                          breakdown-fork-neg, all-terminal-node)
 *   Total 7 + 54 + 24 + 5 = 90 fixtures.
 *
 * Grading is deterministic (no LLM judge). Gold overrides are harness-side only; the frozen
 * fixture files are read, never written.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval/jev-routing-eval.mjs
 * Env knobs:
 *   K          runs per fixture per arm          (default 3)
 *   ONLY       comma-separated id substrings      (cheap focused runs)
 *   ARMS       1 | 2 | 3 | 12 | 123               (default 123)
 *   MODEL      incumbent model                    (default openai/gpt-5.4-mini)
 *   JEV_MODEL  Jev model                          (default typesafe/jev-1.13)
 *   DRY        1 = deterministic stub answers, no network (pipeline verification). Writes to a
 *                  temp dir unless OUT_DIR is set, so it can never overwrite the canonical
 *                  scripts/eval/jev-routing-out artifacts.
 *   SELFTEST   1 = stub fetch + call the real getRecommendation once to verify recorder
 *                  correlation, then exit (no spend)
 *   OUT_DIR    output dir                          (default scripts/eval/jev-routing-out;
 *                  a temp dir for DRY runs when OUT_DIR is unset)
 *
 * Output: jev-routing-out/results.json + report.md (+ a compact stdout summary).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { getRecommendation, setLlmCallRecorder, setPromptTraceRecorder, setFetchImpl, DEFAULT_MODEL } from '../../lib/openrouter.js';
import { selectFocusSubtask } from '../../lib/recommendation-facts.js';
import { buildDistilledState } from './jev-routing-state.mjs';
import { buildRoutingQuestion, buildIncumbentPrompt, norm, LIVE_VOCABULARY } from './jev-routing-criteria.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.MODEL || DEFAULT_MODEL;
const JEV_MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.13';
const K = Number(process.env.K || 3);
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const ARMS = process.env.ARMS || '123';
const DRY = !!process.env.DRY;

/**
 * Resolve the output directory. An explicit OUT_DIR always wins; otherwise a DRY run uses a
 * temp dir so the advertised `DRY=1` pipeline check can never overwrite the canonical
 * `scripts/eval/jev-routing-out` evidence, and a non-DRY run keeps its canonical default.
 * Exported so the output-dir safety is unit-testable (LIN-3107 ledger item 9).
 */
export function resolveOutDir(dry, outDir, here = HERE) {
  if (outDir) return outDir;
  return dry ? join(tmpdir(), `jev-routing-dry-${process.pid}`) : join(here, 'jev-routing-out');
}
const OUT_DIR = resolveOutDir(DRY, process.env.OUT_DIR);
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

// ── Harness-side gold overrides (binding final-review corrections 1, 2, minor) ────────────────
// Applied at grading time only; the committed fixture / CASES[] files are never edited.
export const GOLD_OVERRIDES = {
  'LIN-571': {
    expect: ['plan-review'], avoid: 'plan', loop: true,
    reason: 'LIN-1603 (2026-07-26) added the plan-review gate after this fixture was last ' +
      'touched (LIN-588, 2026-06-23). The fixture\'s own description states "Session fit: Needs ' +
      'multiple sessions" for its own zero-children, undecomposed scope, with no plan-review ' +
      'verdict on trail → criterion (a) fires under today\'s contract. Original gold ' +
      '(breakdown/implementation/implement, avoid plan) graded a pre-LIN-1603 contract and is ' +
      'superseded. `avoid: plan` / `loop: true` are RETAINED: under today\'s contract, re-emitting ' +
      '`plan` is still the trap.',
  },
  'SYN-12': {
    expect: ['plan-review'],
    reason: 'Same LIN-1603 criterion-(a) trap as LIN-571: an explicit "Needs multiple sessions" ' +
      'scope answer with no plan-review verdict on trail. Original gold (breakdown) predates the ' +
      'gate\'s existence in this suite.',
  },
  'LIN-385@breakdown': {
    expect: ['plan-review'],
    reason: 'Third real criterion-(a) violation (binding review correction 1). Class B ' +
      '(fixtures/recommend/linearviewer.json), last touched 2026-06-22, before LIN-1603. A leaf ' +
      'with 0 children, 1 comment, no plan-review verdict; its plan says "Session-fit: does NOT ' +
      'fit one session. 4 sessions". The phrase grep in the plan missed it because it does not ' +
      'use the words "multiple session". Same LIN-1603 criterion-(a) provenance as LIN-571.',
  },
  'FIX-830-pos': {
    expect: ['breakdown', 'plan-review'],
    reason: 'Binding review correction 2. Frozen 2026-06-30, before LIN-1603. A 0-child leaf ' +
      'with no plan-review verdict; its gold rests only on the implicit multi-phase signal. The ' +
      'live template says multi-phase structure "is itself a needs-multiple-sessions answer", but ' +
      'whether that implicit answer also trips gate criterion (a) is the implicit/explicit ' +
      'ambiguity. Accepting BOTH `breakdown` and `plan-review` grades it fairly under either ' +
      'reading; its per-arm distribution is reported separately.',
  },
};

// ── fixture loading ───────────────────────────────────────────────────────────────────────────
const issueBundle = (issue, comments) => ({
  issue: {
    id: issue.identifier,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    state: issue.state,
    createdAt: issue.createdAt,
    labels: issue.labels || [],
  },
  parent: null, siblings: [], siblingsTotal: 0, project: null,
  children: [],
  comments: (comments || []).map((c) => ({ user: c.user, createdAt: c.createdAt, body: c.body })),
  focusedChild: null,
});

function classA() {
  const dir = join(HERE, 'fixtures');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const fx = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return {
      id: fx.identifier, source: 'A', provenance: `fixtures/${f}`,
      bundle: issueBundle(fx, fx.comments),
      gold: { expect: fx.expect || [], avoid: fx.avoid || null, loop: !!fx.loop, deferTarget: null },
      goldSourceComment: fx.why || null,
    };
  });
}

/** Class B and D share the {name, targets, bundles} shape. Node targets → defer gold. */
function classTargets(dir, source, provenanceOf) {
  const cases = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const ws = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!ws.targets || !ws.bundles) continue;
    for (const t of ws.targets) {
      const bundle = ws.bundles[t.id];
      if (!bundle) continue;
      const isNode = !!bundle.focusedChild;
      const focus = isNode ? selectFocusSubtask(bundle.children) : null;
      const gold = isNode
        ? { expect: ['defer'], avoid: null, loop: false, deferTarget: focus ? focus.identifier : null }
        : { expect: t.expect || [], avoid: null, loop: false, deferTarget: null };
      cases.push({
        id: t.id, source, provenance: provenanceOf(f), bundle, gold,
        goldSourceComment: t.goldSourceComment || t.role || null,
      });
    }
  }
  return cases;
}

/** Extract the 24 inline CASES[] from eval-research-routing.mjs (read-only) without running it. */
function classC() {
  const src = readFileSync(join(ROOT, 'scripts', 'eval-research-routing.mjs'), 'utf8');
  const start = src.indexOf('const CASES = [');
  const marker = src.indexOf('// Real-task fixtures', start);
  if (start < 0 || marker < 0) throw new Error('could not locate inline CASES[] in eval-research-routing.mjs');
  const end = src.lastIndexOf('];', marker);
  const literal = src.slice(start + 'const CASES = '.length, end + 2);
  const inProgress = { name: 'In Progress', type: 'started' };
  const todo = { name: 'Todo', type: 'unstarted' };
  const arr = new Function('inProgress', 'todo', `return ${literal};`)(inProgress, todo);
  if (!Array.isArray(arr) || arr.length !== 24) {
    throw new Error(`expected 24 inline CASES, got ${Array.isArray(arr) ? arr.length : 'non-array'}`);
  }
  return arr.map((c) => ({
    id: c.issue.identifier, source: 'C', provenance: 'scripts/eval-research-routing.mjs CASES[]',
    bundle: issueBundle(c.issue, c.issue.comments),
    gold: { expect: c.expect || [], avoid: c.avoid || null, loop: !!c.loop, deferTarget: null },
    goldSourceComment: c.why || null,
  }));
}

export function loadCases() {
  const cases = [
    ...classA(),
    ...classTargets(join(HERE, 'fixtures', 'recommend'), 'B', (f) => `fixtures/recommend/${f}`),
    ...classC(),
    ...classTargets(join(HERE, 'fixtures-widened'), 'D', (f) => `fixtures-widened/${f}`),
  ];
  return cases;
}

/** Apply harness-side gold overrides in place; returns the applied list for provenance. */
export function applyOverrides(cases) {
  const applied = [];
  for (const c of cases) {
    const o = GOLD_OVERRIDES[c.id];
    if (!o) continue;
    c.gold = {
      expect: o.expect,
      avoid: o.avoid !== undefined ? o.avoid : c.gold.avoid,
      loop: o.loop !== undefined ? o.loop : c.gold.loop,
      deferTarget: c.gold.deferTarget,
      overridden: true,
    };
    c.overrideReason = o.reason;
    applied.push({ id: c.id, expect: o.expect, reason: o.reason });
  }
  return applied;
}

// ── grading (deterministic) ───────────────────────────────────────────────────────────────────
/**
 * Eval-wide `defer` rule, applied identically to every arm: `defer` is a hit only on a node
 * with a real, non-terminal child; a leaf `defer` is a miss for every arm. Node `defer` is
 * scored on the ACTION only (arm 3's `deferTo` agreement is a separate diagnostic).
 */
export function gradeAnswer(caseObj, action, deferEligible) {
  const a = norm(action);
  const accept = new Set((caseObj.gold.expect || []).map(norm));
  if (a === 'defer') {
    if (!deferEligible) return { hit: false, kind: 'ineligible-defer' };
    return { hit: accept.has('defer'), kind: 'node-defer' };
  }
  return { hit: accept.has(a), kind: 'action' };
}

// ── statistics ────────────────────────────────────────────────────────────────────────────────
export function wilson(k, n, z = 1.96) {
  if (!n) return { lo: 0, hi: 0 };
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
}
const erfc = (x) => 1 - erf(x);

/** McNemar's paired test with continuity correction; returns {b,c,chi2,p}. */
export function mcNemar(pairs) {
  let b = 0, c = 0;
  for (const [a1, a3] of pairs) { if (a1 && !a3) b++; else if (!a1 && a3) c++; }
  if (b + c === 0) return { b, c, chi2: 0, p: 1 };
  const chi2 = Math.pow(Math.abs(b - c) - 1, 2) / (b + c);
  return { b, c, chi2, p: erfc(Math.sqrt(chi2 / 2)) };
}

/**
 * Newcombe's paired-difference interval (Newcombe 1998, Method 10) for p1 - p2, built from
 * the two Wilson score intervals and the observed phi coefficient (MOVER with covariance).
 */
export function newcombeDifference(a, b, c, d, z = 1.96) {
  const n = a + b + c + d;
  if (!n) return { delta: 0, lo: 0, hi: 0, phi: 0 };
  const p1 = (a + b) / n, p2 = (a + c) / n;
  const w1 = wilson(a + b, n, z), w2 = wilson(a + c, n, z);
  const denom = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  const phi = denom ? (a * d - b * c) / denom : 0;
  const delta = p1 - p2;
  const sqrtClamp = (v) => Math.sqrt(Math.max(0, v));
  const L = delta - sqrtClamp(Math.pow(p1 - w1.lo, 2) + Math.pow(w2.hi - p2, 2) - 2 * phi * (p1 - w1.lo) * (w2.hi - p2));
  const U = delta + sqrtClamp(Math.pow(w1.hi - p1, 2) + Math.pow(p2 - w2.lo, 2) - 2 * phi * (w1.hi - p1) * (p2 - w2.lo));
  return { delta, lo: Math.max(-1, L), hi: Math.min(1, U), phi };
}

export const majority = (flags) => flags.filter(Boolean).length > flags.length / 2;

// ── transports ────────────────────────────────────────────────────────────────────────────────
async function postJson(url, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const latencyMs = Math.round(performance.now() - t0);
    const text = await res.text();
    if (res.status === 429 || res.status === 529 || res.status >= 500) continue;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return { json: JSON.parse(text), latencyMs };
  }
  throw new Error('gave up after 5 attempts');
}

function extractAction(content) {
  const lc = String(content || '').toLowerCase();
  const ordered = [...LIVE_VOCABULARY].sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const re = new RegExp(`(^|[^a-z-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z-]|$)`);
    if (re.test(lc)) return name;
  }
  return null;
}

// ── arms ──────────────────────────────────────────────────────────────────────────────────────
async function armJev(state, offerDefer) {
  if (DRY) return { action: norm(state.__goldDry), confidence: 0.9, probabilities: {}, latencyMs: 1, cost: 0, inputTokens: 0, outputTokens: 0, servedModel: 'dry' };
  const { json, latencyMs } = await postJson(DECISIONS_URL, {
    model: JEV_MODEL, state, questions: buildRoutingQuestion({ offerDefer }),
  });
  const ans = json.answers.routing;
  return {
    action: ans.choice, confidence: ans.confidence ?? null, probabilities: ans.probabilities || {},
    latencyMs, cost: json.usage?.cost ?? null, inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null, servedModel: json.model,
  };
}

async function armIncumbentDistilled(state, offerDefer) {
  if (DRY) return { action: norm(state.__goldDry), latencyMs: 1, cost: 0, inputTokens: 0, outputTokens: 0, raw: 'dry' };
  const prompt = buildIncumbentPrompt(state, { offerDefer });
  const { json, latencyMs } = await postJson(CHAT_URL, {
    model: MODEL, temperature: 0, max_tokens: 24,
    messages: [{ role: 'user', content: prompt }],
  });
  const content = json.choices?.[0]?.message?.content || '';
  return {
    action: extractAction(content), raw: content.slice(0, 120), latencyMs,
    cost: json.usage?.cost ?? null, inputTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null,
  };
}

/**
 * Arm 3 — the live single-hop incumbent. One real `getRecommendation()` call per fixture/run.
 * Cost/usage/latency and the exact metaPrompt come from the registered recorder hooks, keyed
 * by a unique per-call `callMeta.evalCallId` (no duplicate rebuild call).
 */
async function armIncumbentRaw(bundle, evalCallId, recorders) {
  if (DRY) {
    // Stub arm-3 output: push one placeholder record per recorder kind so the run shape matches
    // a live run. This branch RETURNS BEFORE the correlation assertion below, so it does NOT
    // exercise that assertion; SELFTEST is the no-spend check that does.
    recorders.llm.push({ evalCallId, durationMs: 1, cost: 0 });
    recorders.trace.push({ evalCallId, metaPrompt: 'dry' });
    return { action: norm(bundle.__goldDry), deferTo: null, latencyMs: 1, cost: 0, inputTokens: 0, outputTokens: 0, promptChars: 0 };
  }
  const { issue } = bundle;
  const context = {
    parent: bundle.parent, siblings: bundle.siblings || [], siblingsTotal: bundle.siblingsTotal || 0,
    project: bundle.project, children: bundle.children || [], comments: bundle.comments || [],
    focusedChild: bundle.focusedChild || null,
    // The task's recent runs (LIN-3300), passed as the live routes pass them.
    runs: bundle.runHistory?.runs || [],
  };
  const callMeta = { evalCallId, issueIdentifier: issue.identifier };
  const t0 = performance.now();
  const rec = await getRecommendation(issue, context, {
    apiKey: KEY, model: MODEL, featureFlags: {}, callMeta,
  });
  const wallMs = Math.round(performance.now() - t0);
  const llm = recorders.llm.filter((r) => r.evalCallId === evalCallId);
  const trace = recorders.trace.filter((r) => r.evalCallId === evalCallId);
  // LIN-3309: a code-settled route (no reply after the latest verdict) skips the
  // routing LLM call entirely — 0 llm records, 1 trace — so the correlation check
  // accepts that shape too instead of failing the run.
  const expectedLlm = rec.codeRoute ? 0 : 1;
  if (llm.length !== expectedLlm || trace.length !== 1) {
    throw new Error(`recorder correlation failed for ${evalCallId}: llm=${llm.length} (expected ${expectedLlm}) trace=${trace.length}`);
  }
  return {
    action: rec.recommendedAction, deferTo: rec.deferTo || null, codeRoute: rec.codeRoute || null,
    latencyMs: rec.codeRoute ? 0 : (llm[0].durationMs ?? wallMs), cost: rec.codeRoute ? 0 : (llm[0].cost ?? null),
    inputTokens: rec.codeRoute ? 0 : (llm[0].promptTokens ?? null), outputTokens: rec.codeRoute ? 0 : (llm[0].completionTokens ?? null),
    promptChars: (trace[0].metaPrompt || '').length, servedModel: rec.codeRoute ? 'code-route' : (llm[0].model || null),
  };
}

// ── recorder registration (harness-local; unregistered in finally) ─────────────────────────────
function registerRecorders() {
  const recorders = { llm: [], trace: [] };
  setLlmCallRecorder((r) => { recorders.llm.push(r); });
  setPromptTraceRecorder((t) => { recorders.trace.push(t); });
  return recorders;
}
function unregisterRecorders() {
  setLlmCallRecorder(null);
  setPromptTraceRecorder(null);
}

/** Assert the harness never imports server.js (the only registrant of the production recorders). */
export function assertNoServerImport() {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  if (/(from|require\()\s*['"][^'"]*\/server\.js['"]/.test(src) || /['"]\.\.\/server\.js['"]/.test(src)) {
    throw new Error('harness must not import server.js');
  }
  return true;
}

// ── calibration sweep ─────────────────────────────────────────────────────────────────────────
function calibrationSweep(caseResults, incumbentArmKey = 'arm3') {
  const runs = [];
  for (const c of caseResults) {
    for (const r of c.runs) {
      if (r.arm1.action == null) continue;
      const inc = r[incumbentArmKey];
      runs.push({
        confidence: r.arm1.confidence ?? 0,
        jevHit: r.arm1.hit,
        incumbentHit: inc ? inc.hit : false,
      });
    }
  }
  const thresholds = [];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const tRound = Math.round(t * 100) / 100;
    let solo = 0, handback = 0, combinedHit = 0;
    for (const r of runs) {
      if (r.confidence >= tRound) { solo++; combinedHit += r.jevHit ? 1 : 0; }
      else { handback++; combinedHit += r.incumbentHit ? 1 : 0; }
    }
    thresholds.push({
      threshold: tRound, solo, handback,
      handbackRate: runs.length ? handback / runs.length : 0,
      soloAccuracy: solo ? null : null,
      combinedAccuracy: runs.length ? combinedHit / runs.length : 0,
    });
  }
  return { runs: runs.length, thresholds };
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
async function runSelftest() {
  assertNoServerImport();
  const recorders = registerRecorders();
  setFetchImpl(async () => ({
    ok: true, status: 200,
    json: async () => ({
      model: 'stub', choices: [{ message: { content: '## Reasoning\n→ **implement**\n\n## Prompt\nDo it.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.01 },
    }),
    text: async () => '{}',
  }));
  try {
    const id = 'selftest#0';
    await getRecommendation({ identifier: 'SELF', title: 't', description: 'd', state: { name: 'Todo', type: 'unstarted' }, labels: [] }, {}, { apiKey: 'stub', model: MODEL, callMeta: { evalCallId: id } });
    const llm = recorders.llm.filter((r) => r.evalCallId === id);
    const trace = recorders.trace.filter((r) => r.evalCallId === id);
    if (llm.length !== 1 || trace.length !== 1) throw new Error(`selftest correlation failed: llm=${llm.length} trace=${trace.length}`);
    console.log('SELFTEST ok: exactly one recordLlmCall + one recordPromptTrace for the graded call; harness does not import server.js.');
  } finally {
    setFetchImpl(null);
    unregisterRecorders();
  }
}

async function main() {
  assertNoServerImport();
  if (!KEY && !DRY) throw new Error('Set OPENROUTER_API_KEY (or DRY=1 for a no-network pipeline run)');

  let cases = loadCases();
  if (ONLY.length) cases = cases.filter((c) => ONLY.some((t) => c.id.includes(t)));
  const appliedOverrides = applyOverrides(cases);
  const armKeys = ['1', '2', '3'].filter((a) => ARMS.includes(a)).map((a) => `arm${a}`);

  // Expected total count check (only when unfiltered).
  if (!ONLY.length && cases.length !== 90) {
    console.warn(`WARNING: expected 90 fixtures, loaded ${cases.length}`);
  }

  const recorders = registerRecorders();
  const ranAt = new Date().toISOString();
  const caseResults = [];
  const latencies = { arm1: [], arm2: [], arm3: [] };

  try {
    for (const c of cases) {
      const state = buildDistilledState(c.bundle);
      const offerDefer = state.deferEligible;
      if (DRY) { state.__goldDry = c.gold.expect[0] || 'review'; c.bundle.__goldDry = state.__goldDry; }
      const runs = [];
      for (let k = 0; k < K; k++) {
        const run = { k };
        if (armKeys.includes('arm1')) {
          try {
            const r1 = await armJev(state, offerDefer);
            const g = gradeAnswer(c, r1.action, offerDefer);
            run.arm1 = { ...r1, hit: g.hit, gradeKind: g.kind };
            if (r1.latencyMs != null) latencies.arm1.push(r1.latencyMs);
          } catch (e) { run.arm1 = { action: null, error: e.message, hit: false, gradeKind: 'error' }; }
        }
        if (armKeys.includes('arm2')) {
          try {
            const r2 = await armIncumbentDistilled(state, offerDefer);
            const g = gradeAnswer(c, r2.action, offerDefer);
            run.arm2 = { ...r2, hit: g.hit, gradeKind: g.kind };
            if (r2.latencyMs != null) latencies.arm2.push(r2.latencyMs);
          } catch (e) { run.arm2 = { action: null, error: e.message, hit: false, gradeKind: 'error' }; }
        }
        if (armKeys.includes('arm3')) {
          try {
            const r3 = await armIncumbentRaw(c.bundle, `${c.id}#${k}`, recorders);
            const g = gradeAnswer(c, r3.action, offerDefer);
            // Diagnostic only: does arm 3's deferTo agree with selectFocusSubtask?
            // Compare identifiers verbatim (they are case-sensitive; norm lowercases).
            r3.deferToAgrees = r3.action === 'defer' && state.deferEligible
              ? String(r3.deferTo || '').trim() === String(state.deferTarget || '').trim() : null;
            run.arm3 = { ...r3, hit: g.hit, gradeKind: g.kind };
            if (r3.latencyMs != null) latencies.arm3.push(r3.latencyMs);
          } catch (e) { run.arm3 = { action: null, error: e.message, hit: false, gradeKind: 'error' }; }
        }
        runs.push(run);
      }
      caseResults.push({
        id: c.id, source: c.source, provenance: c.provenance,
        expect: (c.gold.expect || []).map(norm), avoid: c.gold.avoid ? norm(c.gold.avoid) : null,
        loop: !!c.gold.loop, deferEligible: offerDefer, deferTarget: state.deferTarget,
        overridden: !!c.gold.overridden, overrideReason: c.overrideReason || null,
        goldSourceComment: c.goldSourceComment, runs,
      });
      process.stdout.write(`. ${c.id}\n`);
    }
  } finally {
    unregisterRecorders();
  }

  // ── aggregate per arm ──
  const aggregate = (key) => {
    let hits = 0, n = 0, avoids = 0, loopHits = 0, loopAvoid = 0;
    for (const c of caseResults) {
      for (const r of c.runs) {
        const a = r[key]; if (!a) continue;
        n++; if (a.hit) hits++;
        if (c.avoid && norm(a.action) === c.avoid) avoids++;
        if (c.loop && c.avoid) { loopAvoid++; if (norm(a.action) === c.avoid) loopHits++; }
      }
    }
    const w = wilson(hits, n);
    return { hits, n, rate: n ? hits / n : 0, wilson: w, avoids, loopRepeat: loopAvoid ? loopHits / loopAvoid : null };
  };
  const arms = {};
  for (const key of armKeys) arms[key] = aggregate(key);

  // ── per-fixture majority + paired stats (arm1 vs arm3, arm1 vs arm2) ──
  const majorityFor = (key) => caseResults.map((c) => majority(c.runs.filter((r) => r[key]).map((r) => r[key].hit)));
  const paired = {};
  if (armKeys.includes('arm1')) {
    const m1 = majorityFor('arm1');
    for (const other of ['arm2', 'arm3']) {
      if (!armKeys.includes(other)) continue;
      const m2 = majorityFor(other);
      let a = 0, b = 0, c = 0, d = 0;
      for (let i = 0; i < m1.length; i++) {
        if (m1[i] && m2[i]) a++; else if (m1[i] && !m2[i]) b++; else if (!m1[i] && m2[i]) c++; else d++;
      }
      paired[`arm1_vs_${other}`] = {
        counts: { a, b, c, d },
        mcnemar: mcNemar(m1.map((x, i) => [x, m2[i]])),
        newcombe: newcombeDifference(a, b, c, d),
        arm1Majority: m1.filter(Boolean).length, otherMajority: m2.filter(Boolean).length, total: m1.length,
      };
    }
  }

  // ── calibration (Jev confidence) ──
  const calibration = armKeys.includes('arm1') ? calibrationSweep(caseResults) : null;

  // ── normalization delta: raw `implementation` answers before norm ──
  let normRewrites = 0;
  for (const c of caseResults) for (const r of c.runs) for (const k of armKeys) {
    if (r[k] && norm(r[k].action) === 'implement' && String(r[k].action).toLowerCase() === 'implementation') normRewrites++;
  }

  // ── defer deltas ──
  const deferStats = (key) => {
    const leaf = caseResults.filter((c) => !c.deferEligible);
    const node = caseResults.filter((c) => c.deferEligible);
    const count = (cs) => { let defer = 0, n = 0; for (const c of cs) for (const r of c.runs) { const a = r[key]; if (!a) continue; n++; if (norm(a.action) === 'defer') defer++; } return { defer, n }; };
    return { leaf: count(leaf), node: count(node) };
  };
  const deferByArm = {};
  for (const key of armKeys) deferByArm[key] = deferStats(key);
  const arm3DeferToAgreement = (() => {
    let agree = 0, n = 0;
    for (const c of caseResults) for (const r of c.runs) {
      if (r.arm3 && r.arm3.deferToAgrees != null) { n++; if (r.arm3.deferToAgrees) agree++; }
    }
    return { agree, n };
  })();

  // ── per-arm distribution for FIX-830-pos (correction 2) ──
  const fix830 = (() => {
    const c = caseResults.find((x) => x.id === 'FIX-830-pos');
    if (!c) return null;
    const dist = {};
    for (const key of armKeys) {
      const d = {};
      for (const r of c.runs) { const a = r[key]; if (!a) continue; const nm = norm(a.action) || '(none)'; d[nm] = (d[nm] || 0) + 1; }
      dist[key] = d;
    }
    return { expect: c.expect, distribution: dist };
  })();

  const latencyCost = (key) => {
    const ls = latencies[key].slice().sort((x, y) => x - y);
    const med = ls.length ? ls[Math.floor(ls.length / 2)] : null;
    let cost = 0, costN = 0, inTok = 0, outTok = 0;
    for (const c of caseResults) for (const r of c.runs) {
      const a = r[key]; if (!a) continue;
      if (typeof a.cost === 'number') { cost += a.cost; costN++; }
      if (typeof a.inputTokens === 'number') inTok += a.inputTokens;
      if (typeof a.outputTokens === 'number') outTok += a.outputTokens;
    }
    return {
      calls: latencies[key].length,
      latencyMs: ls.length ? { min: ls[0], median: med, max: ls[ls.length - 1], mean: ls.reduce((a, b) => a + b, 0) / ls.length } : null,
      totalCostUsd: cost, meanCostUsd: costN ? cost / costN : null, inputTokens: inTok, outputTokens: outTok,
    };
  };
  const resources = {};
  for (const key of armKeys) resources[key] = latencyCost(key);

  // ── go/no-go ──
  const goNoGo = (() => {
    if (!armKeys.includes('arm1') || !armKeys.includes('arm3')) return { decided: false, note: 'both arm 1 and arm 3 required' };
    const j = arms.arm1, inc = arms.arm3;
    const p = paired.arm1_vs_arm3.mcnemar.p;
    const worse = inc.rate - j.rate;
    if (j.rate >= inc.rate) return { decided: true, pass: true, branch: 'at-or-better', detail: `Jev ${(j.rate * 100).toFixed(1)}% ≥ incumbent ${(inc.rate * 100).toFixed(1)}%` };
    if (p >= 0.05) return { decided: true, pass: true, branch: 'indistinguishable', detail: `Jev ${(j.rate * 100).toFixed(1)}% vs incumbent ${(inc.rate * 100).toFixed(1)}%, McNemar p=${p.toFixed(3)} ≥ 0.05` };
    // calibration branch: does a threshold reach incumbent accuracy while Jev solos most?
    const best = calibration.thresholds
      .filter((t) => t.handbackRate <= 0.5)
      .sort((a, b) => b.combinedAccuracy - a.combinedAccuracy)[0];
    if (best && best.combinedAccuracy >= inc.rate) {
      return { decided: true, pass: true, branch: 'calibrated-handoff', detail: `threshold ${best.threshold}: combined ${(best.combinedAccuracy * 100).toFixed(1)}% ≥ incumbent ${(inc.rate * 100).toFixed(1)}% with ${(best.handbackRate * 100).toFixed(0)}% handed back` };
    }
    return { decided: true, pass: false, branch: 'worse', detail: `Jev ${(j.rate * 100).toFixed(1)}% vs incumbent ${(inc.rate * 100).toFixed(1)}% (${(worse * 100).toFixed(1)} pts worse), McNemar p=${p.toFixed(3)}; no threshold reaches incumbent accuracy while Jev solos most` };
  })();

  const corpus = existsSync(join(HERE, 'jev-routing-corpus.json'))
    ? JSON.parse(readFileSync(join(HERE, 'jev-routing-corpus.json'), 'utf8')) : null;

  const results = {
    task: 'LIN-3107', ranAt, dryRun: DRY,
    models: { jev: JEV_MODEL, incumbent: MODEL },
    k: K, arms: armKeys, fixtureCount: caseResults.length,
    sourceCounts: caseResults.reduce((m, c) => { m[c.source] = (m[c.source] || 0) + 1; return m; }, {}),
    goldOverrides: appliedOverrides,
    deferRule: 'defer eligible only on a node with a real non-terminal child; leaf defer is a miss in every arm; node defer scored on action only; arms 1/2 filter at prompt time, arm 3 at grading time',
    corpusQuery: corpus ? { query: corpus.query, runAt: corpus.runAt, groundedAt: corpus.groundedAt, hitCount: corpus.hitCount, cap: corpus.cap, included: corpus.dispositions.filter((d) => d.disposition === 'included').length, excluded: corpus.dispositions.filter((d) => d.disposition !== 'included').length } : null,
    arms, paired, calibration, resources, deferByArm, arm3DeferToAgreement,
    fix830PosDistribution: fix830, normalizationRewrites: normRewrites, goNoGo, cases: caseResults,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  writeReport(results, corpus, join(OUT_DIR, 'report.md'));

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`\nfixtures=${caseResults.length} K=${K} arms=${armKeys.join(',')}`);
  for (const key of armKeys) console.log(`  ${key}: ${arms[key].hits}/${arms[key].n} (${pct(arms[key].rate)}) Wilson[${pct(arms[key].wilson.lo)},${pct(arms[key].wilson.hi)}]`);
  if (paired.arm1_vs_arm3) console.log(`  McNemar arm1 vs arm3: b=${paired.arm1_vs_arm3.mcnemar.b} c=${paired.arm1_vs_arm3.mcnemar.c} p=${paired.arm1_vs_arm3.mcnemar.p.toFixed(3)}; Newcombe Δ[${paired.arm1_vs_arm3.newcombe.lo.toFixed(3)},${paired.arm1_vs_arm3.newcombe.hi.toFixed(3)}]`);
  console.log(`  GO/NO-GO: ${goNoGo.pass ? 'PASS' : 'NO-GO'} (${goNoGo.branch}) — ${goNoGo.detail}`);
  console.log(`\nWrote ${join(OUT_DIR, 'results.json')} and ${join(OUT_DIR, 'report.md')}`);
}

function writeReport(r, corpus, path) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const L = [];
  L.push('# LIN-3107 — Jev routing-only evaluation report', '');
  L.push(`- **Run at:** ${r.ranAt}${r.dryRun ? ' (DRY RUN — no network)' : ''}`);
  L.push(`- **Jev model:** \`${r.models.jev}\` · **incumbent:** \`${r.models.incumbent}\``);
  L.push(`- **Fixtures:** ${r.fixtureCount} (A=${r.sourceCounts.A || 0} real frozen, B=${r.sourceCounts.B || 0} recommend bundles, C=${r.sourceCounts.C || 0} inline cases, D=${r.sourceCounts.D || 0} widened) · **K=${r.k}**`);
  L.push(`- **Grading:** deterministic (no LLM judge); harness-side gold overrides only; frozen fixtures read-only.`);
  L.push('');
  L.push('## Decision rule');
  L.push('Jev is viable for step one if it is **statistically indistinguishable from or better than** the incumbent on the widened set, **or** a confidence-threshold hand-off reaches incumbent-level accuracy while Jev handles most calls alone. **A tie counts as a pass.**');
  L.push('');
  L.push('## Result');
  const g = r.goNoGo;
  L.push(`**${g.pass ? 'GO' : 'NO-GO'}** — branch \`${g.branch}\`: ${g.detail}`);
  L.push('');
  L.push('## Heads-up on what each arm measures');
  L.push('- **Arm 1** = Jev choosing over the distilled state (the candidate).');
  L.push('- **Arm 2** = the incumbent (gpt-5.4-mini) choosing over the SAME distilled state — this is the **like-for-like step-one cost/latency comparator**.');
  L.push('- **Arm 3** = the incumbent over the raw state via the live `getRecommendation()`. Its latency and cost are the **routing call** (code assembles the stage prompt), so Jev\'s arm-1 cost compares with it directly; arm 2 isolates the representation.');
  L.push('');
  L.push('## Hit rates (per run) and Wilson intervals');
  L.push('| arm | hits/runs | rate | Wilson 95% | loop-repeat | off-gold avoid |');
  L.push('|---|---|---|---|---|---|');
  for (const key of r.arms ? Object.keys(r.arms) : []) {
    const a = r.arms[key];
    L.push(`| ${key} | ${a.hits}/${a.n} | ${pct(a.rate)} | [${pct(a.wilson.lo)}, ${pct(a.wilson.hi)}] | ${a.loopRepeat == null ? '—' : pct(a.loopRepeat)} | ${a.avoids} |`);
  }
  L.push('');
  L.push('## Paired comparison (per-fixture majority vote)');
  for (const [name, p] of Object.entries(r.paired || {})) {
    const m = p.mcnemar, n = p.newcombe;
    L.push(`- **${name}:** counts a=${p.counts.a} b=${p.counts.b} c=${p.counts.c} d=${p.counts.d}; McNemar b=${m.b} c=${m.c} χ²=${m.chi2.toFixed(2)} p=${m.p.toFixed(3)}; Newcombe paired-difference Δ=${n.delta.toFixed(3)} [${n.lo.toFixed(3)}, ${n.hi.toFixed(3)}] (φ=${n.phi.toFixed(2)}).`);
  }
  L.push('');
  L.push('## Latency and cost');
  L.push('| arm | calls | latency mean/median/max (ms) | total cost (USD) | mean cost/call | in tok | out tok |');
  L.push('|---|---|---|---|---|---|---|');
  for (const [key, res] of Object.entries(r.resources || {})) {
    const la = res.latencyMs;
    L.push(`| ${key} | ${res.calls} | ${la ? `${la.mean.toFixed(0)}/${la.median}/${la.max}` : '—'} | $${(res.totalCostUsd || 0).toFixed(5)} | ${res.meanCostUsd == null ? '—' : '$' + res.meanCostUsd.toFixed(6)} | ${res.inputTokens} | ${res.outputTokens} |`);
  }
  L.push('');
  L.push('## Calibration / confidence-threshold hand-off (arm 1 → arm 3)');
  if (r.calibration) {
    L.push('| threshold | handed back | hand-back rate | combined accuracy |');
    L.push('|---|---|---|---|');
    for (const t of r.calibration.thresholds) {
      L.push(`| ${t.threshold.toFixed(2)} | ${t.handback}/${r.calibration.runs} | ${pct(t.handbackRate)} | ${pct(t.combinedAccuracy)} |`);
    }
  }
  L.push('');
  L.push('## `defer` handling (eval-wide rule, identical across arms)');
  L.push('`defer` is eligible ONLY for a node with a real, non-terminal child (per `selectFocusSubtask`/`isTerminalState`);');
  L.push('a leaf `defer` is a miss for every arm; node `defer` is scored on the ACTION only. **Asymmetry:** arms 1/2 filter');
  L.push('`defer` at prompt time (it is withheld from the offered criteria on leaves), while arm 3\'s prompt-level vocabulary is');
  L.push('never filtered, so its defer-eligibility is checked at grading time. This is an eval choice, not the live contract:');
  L.push('lib/openrouter.js injects the full vocabulary into every prompt, leaves included.');
  for (const [key, d] of Object.entries(r.deferByArm || {})) {
    L.push(`- **${key}:** leaf defer ${d.leaf.defer}/${d.leaf.n}, node defer ${d.node.defer}/${d.node.n}`);
  }
  L.push(`- **arm 3 \`deferTo\` agreement with \`selectFocusSubtask\` (diagnostic):** ${r.arm3DeferToAgreement.agree}/${r.arm3DeferToAgreement.n}`);
  L.push('');
  L.push('## Normalization delta');
  L.push(`\`implementation\` → \`implement\` rewrites observed in raw answers: **${r.normalizationRewrites}** (both gold and every answer are normalized through the same seam).`);
  L.push('');
  if (r.fix830PosDistribution) {
    L.push('## `FIX-830-pos` per-arm distribution (binding correction 2)');
    L.push(`Expect: ${r.fix830PosDistribution.expect.join(' | ')}`);
    for (const [key, d] of Object.entries(r.fix830PosDistribution.distribution)) {
      L.push(`- **${key}:** ${Object.entries(d).map(([a, n]) => `${a}×${n}`).join(', ') || '—'}`);
    }
    L.push('');
  }
  L.push('## Gold overrides (harness-side, frozen files untouched)');
  for (const o of r.goldOverrides || []) L.push(`- **${o.id}** → expect ${JSON.stringify(o.expect)}: ${o.reason}`);
  L.push('');
  L.push('## Corpus provenance and exclusions');
  if (corpus) {
    L.push(`Verb-override corpus: \`${corpus.query}\`, run ${corpus.runAt}, grounded at \`${corpus.groundedAt}\`, **${corpus.hitCount} hits (endpoint cap ${corpus.cap})**.`);
    L.push('');
    L.push(`- Included: ${corpus.dispositions.filter((d) => d.disposition === 'included').map((d) => d.identifier).join(', ') || '—'}`);
    L.push(`- **Cap disclosure:** ${corpus.capNote}`);
    L.push('');
    L.push('| identifier | disposition | rule | reason |');
    L.push('|---|---|---|---|');
    for (const d of corpus.dispositions) L.push(`| ${d.identifier} | ${d.disposition} | ${d.rule} | ${d.reason}${d.corrected ? ` _(corrected: ${d.corrected})_` : ''} |`);
  }
  L.push('');
  L.push('## Reproduce');
  L.push('```');
  L.push('OPENROUTER_API_KEY=<key> node scripts/eval/jev-routing-eval.mjs');
  L.push('DRY=1 ONLY=LIN-571 OUT_DIR=/tmp/jev-dry node scripts/eval/jev-routing-eval.mjs   # no-network pipeline check (non-canonical dir)');
  L.push('SELFTEST=1 node scripts/eval/jev-routing-eval.mjs            # recorder-correlation check, no spend');
  L.push('```');
  writeFileSync(path, L.join('\n') + '\n');
}

// ── entrypoint (guarded so tests can import helpers without running the eval) ─────────────────
const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  const entry = process.env.SELFTEST ? runSelftest() : main();
  entry.catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
