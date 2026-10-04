#!/usr/bin/env node
/**
 * LIN-3294: compare brief-writer models on real tickets (a sanity check, not a gate).
 *
 * Each ticket is routed once, on the router model, with the routing-only meta call, so every
 * writer model gets the same stage, rules bundle and router lines. Then, for each ticket and
 * writer model, the finished prompt is produced through the real writer path
 * (composeRoutedRecommendation: writeBrief, then the code-owned finish), and the run records
 * bytes, latency, tokens and cost from OpenRouter's usage data, whether the writer shipped or
 * fell back, and the automatic checks (code-owned sections once each, no role line, no "we",
 * no copied writer-instruction phrases). It also writes a blind pack (briefs shuffled under
 * random labels) for grading by hand, and a re-grade pack (a random 20%, relabelled).
 *
 * Run (ticketDir holds proxy issue JSON, one ticket per file; models are comma-separated):
 *   OPENROUTER_API_KEY=... node scripts/eval/brief-writer-compare.mjs run <ticketDir> <outDir> \
 *     <model>,<model>,... [--router <model>] [--budget-multiple 20] [--seed 3294]
 *
 * Grade blind/*.md into <outDir>/grades.json and blind/regrade.md into <outDir>/regrades.json:
 *   { "<label>": { "purpose": [4, "reason"], "faithful": [..], "brief": [..], "tone": [..],
 *                  "specific": [..], "concise": [..] }, ... }
 * Then unblind and write the per-ticket files and summary.md (notes.md, if present, is appended):
 *   node scripts/eval/brief-writer-compare.mjs report <outDir>
 *
 * The router defaults to the app's default model. Re-running `run` resumes: routes and
 * finished pairs already in <outDir> are reused. One call per pair, retried once on a
 * transient failure. The run stops before a call, routing or writing, that would take total
 * spend (every attempt counted) past --budget-multiple times the estimated cost of one call
 * on the ladder's priciest model, on the largest writer prompt any stage could give.
 * A writer call's look-ahead assumes the writer spends its whole reasoning headroom on top
 * of a typical brief, since the app gives every writer that headroom; a routing call's is
 * the dearest routing call so far.
 * The key is read from the environment and never written. Each writer call runs with the
 * app's own token budget (briefWriterBudget: a reasoning allowance on top of the prose
 * budget for every model), recorded per model in ladder.json. A writer reply that did not
 * finish falls back as 'truncated' or 'unfinished-<reason>'; an upstream error mid-reply is
 * retried once like the other transient failures.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lib = (p) => import(join(REPO, 'lib', p));

await lib('providers/index.js');
const { getProvider } = await lib('providers/registry.js');
const { generatePrompt, deriveDispatchKind, PROMPT_TEMPLATES } = await lib('prompt-templates.js');
const {
  DEFAULT_MODEL, getRecommendation, composeRoutedRecommendation, setLlmCallRecorder,
  splitStageBody, routerFocus, BRIEF_WRITER_FEATURE, BRIEF_WRITER_PROSE_TOKENS, briefWriterBudget
} = await lib('openrouter.js');
const { formatStageContract } = await lib('prompt-contract.js');
const { formatStageIntent, buildBriefWriterPrompt } = await lib('prompts/brief-writer.js');
const { appendGroundingSections, resolvePromptUi, applyPromptCapabilities } = await lib('prompt-formatters.js');
const { collectIssueAttachments } = await lib('proxy-wire.js');

const CRITERIA = [
  ['purpose', 'purpose clear'],
  ['faithful', 'faithful to the rules'],
  ['brief', 'a brief, not a checklist'],
  ['tone', 'tone standard'],
  ['specific', 'specific to the situation'],
  ['concise', 'concise']
];
const TRANSIENT = /^(http-(408|429|5\d\d)|timeout|error|empty|unfinished-error)$/;

const [mode, ...rest] = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i];
  else pos.push(rest[i]);
}
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

// ---------------------------------------------------------------------------------------
// Shared helpers

const providerUi = getProvider('linear').ui;
const featureFlags = {};
const caps = resolvePromptUi(featureFlags, providerUi);

const STATE_ORDER = { started: 0, unstarted: 1, backlog: 1, triage: 1 };
/** Proxy issue JSON → the { issue, context } getRecommendation reads. */
function adapt(j) {
  const order = (t) => STATE_ORDER[t] ?? 2;
  const children = [...(j.children || [])].sort((a, b) => order(a.state?.type) - order(b.state?.type));
  return {
    issue: {
      id: j.id, identifier: j.identifier, title: j.title, description: j.description, url: j.url,
      state: j.state, labels: (j.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
      createdAt: j.createdAt, updatedAt: j.updatedAt
    },
    context: {
      parent: j.parent ? { id: j.parent.id, identifier: j.parent.identifier, title: j.parent.title, state: j.parent.state } : null,
      siblings: [],
      project: j.project ? { name: j.project.name, description: j.project.content ?? j.project.description } : null,
      children,
      comments: (j.comments || []).map(c => ({ commentId: c.id, body: c.body, createdAt: c.createdAt, user: c.user?.name || 'Unknown' }))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      attachments: collectIssueAttachments({ description: j.description, formalAttachmentNodes: j.attachments })
    }
  };
}

const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const section = (text, heading) => {
  const m = text.match(new RegExp(`^${heading}\\b[^\\n]*\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[0].trim() : null;
};
const words = (t) => t.toLowerCase().replace(/[`*_>#]/g, ' ').split(/[^a-z0-9'-]+/).filter(Boolean);
const shingles = (t, n = 8) => {
  const w = words(t);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
};

const ROLE = /\bact as\b|\bin the role of\b|\byou are (?:an?|the) (?:(?:senior|expert|experienced|skilled|seasoned|capable)\s+)?(?:[a-z-]+\s+)?(?:agent|engineer|developer|reviewer|architect|expert|assistant|investigator|planner|auditor|colleague)\b/i;
const WE = /\b(?:we|we're|we've|we'll|let's|our|ours|us)\b/i;
const LEAK = /\brouter\b|\brules bundle\b|<bundle>|<lead>|\bthe writer\b|\bstage's (?:shape|lead)\b/i;

/** The bundle Goal the writer reads, and the rest of the stage, for one ticket. */
function stageParts(kind, issue, context) {
  const body = PROMPT_TEMPLATES[kind].generate(issue, context, featureFlags);
  const parts = splitStageBody(body);
  return { ...parts, goal: applyPromptCapabilities(parts.goal, caps) };
}

/**
 * The automatic checks on one finished prompt. A fallback must be the unwritten prompt byte
 * for byte, and is checked for that alone: the writer checks are about what a writer wrote.
 */
function runChecks(prompt, kind, issue, context, bundleGoal, written) {
  const off = generatePrompt(kind, issue, context, featureFlags, providerUi).prompt;
  if (!written) return { fails: prompt === off ? [] : ['fallback-not-bundle'], copied: [], leak: null };
  const goal = section(prompt, '## Goal') || '';
  // Quoted strings are the rules' own words ("we will notice"), not the brief's voice.
  const voice = goal.replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, '');
  const fails = [];
  const wfOff = section(off, '## Workflow');
  if (wfOff && (count(prompt, '## Workflow') !== 1 || section(prompt, '## Workflow') !== wfOff)) fails.push('workflow');
  const factsHead = kind === 'triage' ? '## Current State' : '## Context';
  const factsOff = section(off, factsHead);
  if (factsOff && (count(prompt, factsHead) !== 1 || section(prompt, factsHead) !== factsOff)) fails.push('facts');
  const intent = formatStageIntent(kind).trim();
  if (intent && (count(prompt, '## Scope and Authority') !== 1 || !prompt.includes(intent))) fails.push('scope');
  const contract = applyPromptCapabilities(formatStageContract(kind, issue.identifier, caps), caps);
  if (contract && count(prompt, contract) !== 1) fails.push('contract');
  const grounding = applyPromptCapabilities(appendGroundingSections('', issue, context, kind), caps);
  if (grounding && count(prompt, grounding) !== 1) fails.push('grounding');
  if (count(prompt, '## Goal') !== 1) fails.push('goal-count');
  if (ROLE.test(voice)) fails.push('role-line');
  if (WE.test(voice)) fails.push('we');
  // Writer-instruction phrases: an 8-word run from the writer's own prompt (its instructions
  // and the stage's shape, not the scope lines or the bundle) that the bundle does not have.
  const instr = buildBriefWriterPrompt({ kind, bundle: '', focus: null, sections: [] })
    .replace(/## What code adds[\s\S]*$/, '');
  const fromBundle = shingles(bundleGoal);
  const copied = [...shingles(goal)].filter(s => shingles(instr).has(s) && !fromBundle.has(s));
  if (copied.length || LEAK.test(goal)) fails.push('copied-instructions');
  return { fails, copied: copied.slice(0, 3), leak: (goal.match(LEAK) || [])[0] || null };
}

// Seeded shuffle, so the blind labels are stable across re-runs of the same results.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function labels(n, rand, taken = new Set()) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const out = [];
  while (out.length < n) {
    const l = Array.from({ length: 3 }, () => abc[Math.floor(rand() * abc.length)]).join('');
    if (!taken.has(l)) { taken.add(l); out.push(l); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// run

async function run() {
  const [ticketDir, outDir, modelArg] = pos;
  if (!ticketDir || !outDir || !modelArg) throw new Error('usage: run <ticketDir> <outDir> <model,model,...>');
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const models = modelArg.split(',').map(s => s.trim()).filter(Boolean);
  const router = flags.router || DEFAULT_MODEL;
  const multiple = Number(flags['budget-multiple'] ?? 20);
  const seed = Number(flags.seed ?? 3294);
  mkdirSync(join(outDir, 'blind'), { recursive: true });

  // Prices, from OpenRouter's current list.
  const list = await (await fetch('https://openrouter.ai/api/v1/models')).json();
  const byId = new Map(list.data.map(m => [m.id, m]));
  const ladder = [];
  for (const id of [...new Set([router, ...models])]) {
    const m = byId.get(id);
    if (!m) throw new Error(`model not on OpenRouter's list: ${id}`);
    const { reasoning, maxTokens } = briefWriterBudget(id);
    ladder.push({ id, name: m.name, inPerM: Number(m.pricing.prompt) * 1e6, outPerM: Number(m.pricing.completion) * 1e6, writer: models.includes(id), router: id === router, writerMaxTokens: maxTokens, writerReasoningTokens: reasoning?.max_tokens ?? null });
  }
  writeJson(join(outDir, 'ladder.json'), { router, models, ladder, fetchedAt: new Date().toISOString() });
  const price = (id) => ladder.find(l => l.id === id);

  const files = readdirSync(ticketDir).filter(f => /\.json$/.test(f)).sort();
  const tickets = files.map(f => JSON.parse(readFileSync(join(ticketDir, f), 'utf8')))
    .filter(j => j && j.identifier).map(j => adapt(j));

  // The guard: multiple × one call on the priciest writer, sized on the largest writer prompt.
  // It covers the routing pass too, so it is sized before routing, on every stage a ticket
  // could be routed to.
  const estimate = (id, inBytes, outTokens = 1500) => (inBytes / 3.5) * price(id).inPerM / 1e6 + outTokens * price(id).outPerM / 1e6;
  const priciest = ladder.filter(l => l.writer).sort((a, b) => estimate(b.id, 20000) - estimate(a.id, 20000))[0];
  // A writer may spend its whole reasoning headroom before the brief, so a call's look-ahead
  // counts it on top of a typical brief's output.
  const headroom = (id) => briefWriterBudget(id).maxTokens - BRIEF_WRITER_PROSE_TOKENS;

  const calls = [];
  setLlmCallRecorder((rec) => calls.push(rec));
  const routesPath = join(outDir, 'routes.json');
  const runsPath = join(outDir, 'runs.json');
  const routes = readJson(routesPath, {});
  const runs = readJson(runsPath, []);
  const spent = () => Object.values(routes).reduce((s, r) => s + (r.usage?.cost || 0), 0)
    + runs.reduce((s, r) => s + r.attempts.reduce((t, a) => t + (a.cost || 0), 0), 0);

  let maxBytes = 0;
  for (const t of tickets) {
    for (const kind of Object.keys(PROMPT_TEMPLATES)) {
      const { goal } = stageParts(kind, t.issue, t.context);
      maxBytes = Math.max(maxBytes, Buffer.byteLength(buildBriefWriterPrompt({ kind, bundle: goal, focus: null, sections: [] })));
    }
  }
  const unit = estimate(priciest.id, maxBytes);
  const budget = multiple * unit;
  console.log(`guard: ${multiple} × ~$${unit.toFixed(4)} (one ${priciest.id} call) = $${budget.toFixed(3)}; spent so far $${spent().toFixed(4)}`);
  let stopped = null;

  // 1. Route each ticket once on the router. The writer is handed a spent deadline, so it
  // returns 'no-time' without a call and only the routing call goes out. Every attempt is
  // paid for, and each is guarded, looking ahead by the dearest routing call so far.
  let routeAhead = Object.values(routes).reduce((m, r) => Math.max(m, r.usage?.cost || 0), 0);
  for (const t of tickets) {
    const id = t.issue.identifier;
    if (routes[id]) continue;
    let rec = null; let error = null; let u = {};
    const attemptCosts = [];
    for (let attempt = 0; attempt < 2 && !rec; attempt++) {
      const pending = attemptCosts.reduce((s, c) => s + c, 0);
      if (spent() + pending + routeAhead > budget) {
        stopped = `before routing ${id}: spent $${(spent() + pending).toFixed(4)}, next ~$${routeAhead.toFixed(4)}, budget $${budget.toFixed(3)}`;
        break;
      }
      calls.length = 0;
      try {
        rec = await getRecommendation(t.issue, t.context, {
          apiKey, model: router, featureFlags, providerUi, briefWriter: { model: router }, deadline: 0,
          callMeta: { feature: 'recommend', issueIdentifier: id }
        });
      } catch (e) { error = e.message.slice(0, 300); }
      u = calls.find(c => c.feature === 'recommend') || {};
      attemptCosts.push(u.cost || 0);
      routeAhead = Math.max(routeAhead, u.cost || 0);
    }
    if (!attemptCosts.length) break;
    const cost = attemptCosts.reduce((s, c) => s + c, 0);
    routes[id] = rec
      ? { action: rec.recommendedAction, kind: rec.recommendedAction === 'defer' ? 'defer' : deriveDispatchKind(rec.recommendedAction), deferTo: rec.deferTo || null, reasoning: rec.reasoning, focus: routerFocus(rec.reasoning), usage: { model: u.model, promptTokens: u.promptTokens, completionTokens: u.completionTokens, cost, durationMs: u.durationMs } }
      : { error, usage: { cost } };
    writeJson(routesPath, routes);
    console.log(`route ${id}: ${routes[id].action ?? 'ERROR ' + error} → ${routes[id].kind ?? '-'}`);
    if (stopped) break;
  }

  // 2. Each ticket × writer model, through the real writer path (none once the guard stopped).
  outer:
  for (const t of stopped ? [] : tickets) {
    const id = t.issue.identifier;
    const r = routes[id];
    if (!r?.kind || r.kind === 'defer' || !PROMPT_TEMPLATES[r.kind]) continue;
    const { goal: bundleGoal } = stageParts(r.kind, t.issue, t.context);
    const parsed = { reasoning: r.reasoning, recommendedAction: r.action, prompt: null, truncated: false, deferTo: null };
    for (const model of models) {
      const done = runs.find(x => x.ticket === id && x.model === model);
      if (done) {
        // Re-check what is on disk, so a re-run applies the current checks without a call.
        done.checks = done.prompt ? runChecks(done.prompt, r.kind, t.issue, t.context, bundleGoal, done.written) : { fails: ['no-prompt'], copied: [] };
        continue;
      }
      const attempts = [];
      let out = null;
      const t0 = Date.now();
      for (let attempt = 0; attempt < 2; attempt++) {
        const next = estimate(model, Buffer.byteLength(bundleGoal) + 4000, 1500 + headroom(model));
        if (spent() + attempts.reduce((s, a) => s + (a.cost || 0), 0) + next > budget) {
          stopped = `before ${id} × ${model}: spent $${spent().toFixed(4)}, next ~$${next.toFixed(4)}, budget $${budget.toFixed(3)}`;
          break;
        }
        calls.length = 0;
        const start = Date.now();
        try {
          out = await composeRoutedRecommendation(parsed, t.issue, t.context, featureFlags, providerUi, {
            apiKey, model, signal: null, deadline: Date.now() + 175000, callMeta: { feature: 'recommend', issueIdentifier: id }
          });
        } catch (e) {
          out = { prompt: null, written: false, writerReason: 'threw: ' + e.message.slice(0, 200) };
        }
        const c = calls.find(x => x.feature === BRIEF_WRITER_FEATURE) || {};
        attempts.push({ written: !!out.written, reason: out.writerReason ?? null, servedModel: c.model ?? null, finishReason: c.finishReason ?? null, promptTokens: c.promptTokens ?? null, completionTokens: c.completionTokens ?? null, cost: c.cost ?? null, durationMs: c.durationMs ?? (Date.now() - start) });
        if (out.written || !TRANSIENT.test(out.writerReason || '')) break;
      }
      if (!attempts.length) break outer;
      const last = attempts[attempts.length - 1];
      const prompt = out?.prompt || '';
      const goal = section(prompt, '## Goal') || '';
      const checks = prompt ? runChecks(prompt, r.kind, t.issue, t.context, bundleGoal, last.written) : { fails: ['no-prompt'], copied: [] };
      runs.push({
        ticket: id, model, kind: r.kind, written: last.written, reason: last.reason, retried: attempts.length > 1,
        bytes: Buffer.byteLength(prompt), goalBytes: Buffer.byteLength(goal), bundleGoalBytes: Buffer.byteLength(bundleGoal),
        latencyMs: last.durationMs, wallMs: Date.now() - t0,
        promptTokens: attempts.reduce((s, a) => s + (a.promptTokens || 0), 0),
        completionTokens: attempts.reduce((s, a) => s + (a.completionTokens || 0), 0),
        cost: attempts.reduce((s, a) => s + (a.cost || 0), 0),
        attempts, checks, goal, prompt
      });
      writeJson(runsPath, runs);
      console.log(`${id} × ${model}: ${last.written ? 'written' : 'FELL BACK (' + last.reason + ')'} · ${Buffer.byteLength(prompt)} B · ${(last.durationMs / 1000).toFixed(1)} s · $${(runs.at(-1).cost).toFixed(5)} · checks ${checks.fails.join(',') || 'ok'}`);
      if (stopped) break outer;
    }
  }
  writeJson(runsPath, runs);
  if (stopped) console.log(`STOPPED by the cost guard ${stopped}`);
  writeJson(join(outDir, 'guard.json'), { multiple, unit, budget, priciest: priciest.id, spent: spent(), stopped });

  // 3. The blind pack: each ticket's Goals shuffled under random labels, with the stage, the
  // router's lines and the bundle Goal the writers read. The key goes to a separate file.
  const rand = rng(seed);
  const taken = new Set();
  const key = {};
  for (const t of tickets) {
    const id = t.issue.identifier;
    const r = routes[id];
    const mine = runs.filter(x => x.ticket === id);
    if (!mine.length) continue;
    const { goal: bundleGoal } = stageParts(r.kind, t.issue, t.context);
    const order = shuffle(mine, rand);
    const ls = labels(order.length, rand, taken);
    const md = [`# Blind: ${id} (stage \`${r.kind}\`)`, '', `Title: ${t.issue.title}`, '',
      '## Router lines the writer saw', '', '```', r.focus || '(none)', '```', '',
      '## Bundle Goal (the rules the writer rewrote)', '', '````markdown', bundleGoal.trim(), '````', ''];
    order.forEach((x, i) => {
      key[ls[i]] = { ticket: id, model: x.model, pass: 1 };
      md.push(`## Brief ${ls[i]}${x.written ? '' : ' (writer fell back: this is the bundle Goal)'}`, '', '````markdown', x.goal, '````', '');
    });
    writeFileSync(join(outDir, 'blind', `${id}.md`), md.join('\n'));
  }
  // The re-grade pack: a random 20% of the briefs, relabelled and reshuffled.
  const pool = Object.keys(key);
  const pick = shuffle(pool, rand).slice(0, Math.max(1, Math.round(pool.length * 0.2)));
  const relabels = labels(pick.length, rand, taken);
  const md = ['# Blind re-grade', ''];
  pick.forEach((orig, i) => {
    const k = key[orig];
    const x = runs.find(y => y.ticket === k.ticket && y.model === k.model);
    key[relabels[i]] = { ticket: k.ticket, model: k.model, pass: 2, of: orig };
    md.push(`## Brief ${relabels[i]} (ticket ${k.ticket}, stage \`${x.kind}\`; see blind/${k.ticket}.md for the bundle)`, '', '````markdown', x.goal, '````', '');
  });
  writeFileSync(join(outDir, 'blind', 'regrade.md'), md.join('\n'));
  writeJson(join(outDir, 'blind-key.json'), key);
  console.log(`blind pack: ${pool.length} briefs, ${pick.length} to re-grade; total spend $${spent().toFixed(4)}`);
}

// ---------------------------------------------------------------------------------------
// report

function median(xs) {
  const a = xs.filter(x => typeof x === 'number').sort((p, q) => p - q);
  if (!a.length) return null;
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const f2 = (x) => (x == null ? '–' : x.toFixed(2));

function report() {
  const [outDir] = pos;
  if (!outDir) throw new Error('usage: report <outDir>');
  const { router, models, ladder } = readJson(join(outDir, 'ladder.json'));
  const routes = readJson(join(outDir, 'routes.json'), {});
  const runs = readJson(join(outDir, 'runs.json'), []);
  const key = readJson(join(outDir, 'blind-key.json'), {});
  const grades = readJson(join(outDir, 'grades.json'), {});
  const regrades = readJson(join(outDir, 'regrades.json'), {});
  const guard = readJson(join(outDir, 'guard.json'), {});

  const labelOf = {};
  for (const [l, k] of Object.entries(key)) if (k.pass === 1) labelOf[`${k.ticket}|${k.model}`] = l;
  const scoreOf = (r) => grades[labelOf[`${r.ticket}|${r.model}`]] || null;
  const overall = (g) => (g ? mean(CRITERIA.map(([c]) => g[c]?.[0]).filter(x => typeof x === 'number')) : null);

  // Per ticket, unblinded.
  for (const id of [...new Set(runs.map(r => r.ticket))]) {
    const rt = routes[id];
    const mine = models.map(m => runs.find(r => r.ticket === id && r.model === m)).filter(Boolean);
    const md = [`# ${id}: stage \`${rt.kind}\` (routed \`${rt.action}\` on \`${router}\`)`, '',
      '## Router lines the writer saw', '', '```', rt.focus || '(none)', '```', '',
      '## Scores', '',
      `| model | label | ${CRITERIA.map(([, n]) => n).join(' | ')} | overall | checks | shipped | bytes | latency | cost |`,
      `|---|---|${CRITERIA.map(() => '---:').join('|')}|---:|---|---|---:|---:|---:|`];
    for (const r of mine) {
      const g = scoreOf(r);
      md.push(`| \`${r.model}\` | ${labelOf[`${r.ticket}|${r.model}`] || '–'} | ${CRITERIA.map(([c]) => g?.[c]?.[0] ?? '–').join(' | ')} | ${f2(overall(g))} | ${r.checks.fails.join(', ') || 'ok'} | ${r.written ? 'written' : 'fell back (' + r.reason + ')'} | ${r.bytes} | ${(r.latencyMs / 1000).toFixed(1)} s | $${r.cost.toFixed(5)} |`);
    }
    md.push('');
    for (const r of mine) {
      const g = scoreOf(r);
      md.push(`## \`${r.model}\` (${labelOf[`${r.ticket}|${r.model}`] || '–'})`, '');
      if (g) for (const [c, n] of CRITERIA) md.push(`- **${n}: ${g[c]?.[0] ?? '–'}**. ${g[c]?.[1] ?? ''}`);
      if (r.checks.copied?.length || r.checks.leak) md.push(`- Check detail: ${[r.checks.leak && `leak "${r.checks.leak}"`, ...r.checks.copied.map(s => `"${s}"`)].filter(Boolean).join('; ')}`);
      md.push('', '````markdown', r.goal, '````', '');
    }
    writeFileSync(join(outDir, `${id}.md`), md.join('\n'));
  }

  // Summary.
  const defaultModel = ladder.find(l => l.writer && l.router)?.id || models[0];
  const defCost = mean(runs.filter(r => r.model === defaultModel).map(r => r.cost));
  const rows = [];
  for (const m of models) {
    const rs = runs.filter(r => r.model === m);
    const gs = rs.map(scoreOf).filter(Boolean);
    const l = ladder.find(x => x.id === m);
    rows.push({
      m, l, n: rs.length,
      crit: CRITERIA.map(([c]) => mean(gs.map(g => g[c]?.[0]).filter(x => typeof x === 'number'))),
      overall: mean(gs.map(overall).filter(x => x != null)),
      checkFails: rs.filter(r => r.checks.fails.length).length,
      checkDetail: [...new Set(rs.flatMap(r => r.checks.fails))].join(', '),
      fallbacks: rs.filter(r => !r.written).length,
      latency: median(rs.map(r => r.latencyMs)),
      cost: mean(rs.map(r => r.cost)),
      tokIn: rs.reduce((s, r) => s + r.promptTokens, 0), tokOut: rs.reduce((s, r) => s + r.completionTokens, 0)
    });
  }
  // Grading consistency: pass-2 labels against their pass-1 originals.
  const pairs = [];
  for (const [l, k] of Object.entries(key)) {
    if (k.pass !== 2 || !regrades[l] || !grades[k.of]) continue;
    for (const [c] of CRITERIA) {
      const a = grades[k.of][c]?.[0]; const b = regrades[l][c]?.[0];
      if (typeof a === 'number' && typeof b === 'number') pairs.push(Math.abs(a - b));
    }
  }
  const routeTok = Object.values(routes).reduce((s, r) => [s[0] + (r.usage?.promptTokens || 0), s[1] + (r.usage?.completionTokens || 0), s[2] + (r.usage?.cost || 0)], [0, 0, 0]);
  const md = ['# Brief-writer model comparison (LIN-3294)', '',
    `${Object.keys(routes).length} tickets routed once on \`${router}\`; ${runs.length} briefs written across ${models.length} writer models. Default writer: \`${defaultModel}\`.`, '',
    '## Routing', '', '| ticket | action | stage |', '|---|---|---|',
    ...Object.entries(routes).map(([id, r]) => `| ${id} | \`${r.action ?? 'error'}\` | ${r.kind ?? '–'} |`), '',
    '## Per model', '',
    `| model | $/M in · out | n | ${CRITERIA.map(([, n]) => n).join(' | ')} | overall | check failures | fallbacks | median latency | mean cost / brief | × default |`,
    `|---|---|---:|${CRITERIA.map(() => '---:').join('|')}|---:|---|---:|---:|---:|---:|`,
    ...rows.map(r => `| \`${r.m}\` | ${r.l.inPerM.toFixed(2)} · ${r.l.outPerM.toFixed(2)} | ${r.n} | ${r.crit.map(f2).join(' | ')} | **${f2(r.overall)}** | ${r.checkFails}${r.checkDetail ? ' (' + r.checkDetail + ')' : ''} | ${r.fallbacks} | ${r.latency == null ? '–' : (r.latency / 1000).toFixed(1) + ' s'} | $${r.cost.toFixed(5)} | ${defCost ? (r.cost / defCost).toFixed(2) + '×' : '–'} |`), '',
    '## Grading consistency', '',
    pairs.length
      ? `${pairs.length / CRITERIA.length} briefs re-graded blind (${pairs.length} criterion scores): exact agreement ${(100 * pairs.filter(d => d === 0).length / pairs.length).toFixed(0)}%, within one point ${(100 * pairs.filter(d => d <= 1).length / pairs.length).toFixed(0)}%, mean absolute difference ${mean(pairs).toFixed(2)}.`
      : 'No re-grades recorded.', '',
    '## Spend', '',
    `Routing: ${routeTok[0]} in / ${routeTok[1]} out tokens, $${routeTok[2].toFixed(4)}. Writing: ${rows.reduce((s, r) => s + r.tokIn, 0)} in / ${rows.reduce((s, r) => s + r.tokOut, 0)} out tokens, $${runs.reduce((s, r) => s + r.cost, 0).toFixed(4)}. Guard: ${guard.multiple ?? '?'} × ~$${(guard.unit ?? 0).toFixed(4)} (one \`${guard.priciest ?? '?'}\` call) = $${(guard.budget ?? 0).toFixed(3)}${guard.stopped ? `; STOPPED ${guard.stopped}` : '; not reached'}.`, ''];
  const notes = join(outDir, 'notes.md');
  if (existsSync(notes)) md.push(readFileSync(notes, 'utf8'));
  writeFileSync(join(outDir, 'summary.md'), md.join('\n'));
  console.log(md.slice(0, 40).join('\n'));
}

const USAGE = 'usage: brief-writer-compare.mjs run <ticketDir> <outDir> <model,model,...> [--router m] [--budget-multiple 20] [--seed n]\n       brief-writer-compare.mjs report <outDir>';
if (mode === 'run') await run();
else if (mode === 'report') report();
else if (mode === '--help' || mode === '-h' || mode === 'help') console.log(USAGE);
else {
  console.error(USAGE);
  process.exit(2);
}
