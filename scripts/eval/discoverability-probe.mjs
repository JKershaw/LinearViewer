#!/usr/bin/env node
/**
 * LIN-4086 — AI discoverability probe (research infra; no production wiring).
 *
 * Question: how do AI models describe "Harbour" / "harbour.cat" today, before anything
 * about the site has been changed for discoverability? This is the BEFORE baseline.
 *
 * For every (question × model × mode × repeat) we ask the model under test the bare
 * question (no system prompt, nothing a real user would not type), then a fixed judge
 * model (temperature 0, rubric below) labels the answer:
 *   correct       identifies harbour.cat / Harbour as the AI-agent control plane
 *   confused      describes a different, real product (CNCF Harbor, Terminal-Bench Harbor, other)
 *   unknown       says it doesn't know / declines / (category tier) never mentions Harbour
 *   hallucinated  confidently describes a nonexistent or wrong product that isn't a known collision
 *
 * Modes:
 *   off  plain chat completion, no tools
 *   web  OpenRouter web plugin, `plugins: [{ id: 'web' }]` (exactly what the `:online` slug
 *        suffix expands to; native search for Anthropic/OpenAI/Google, Exa for the rest)
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval/discoverability-probe.mjs
 *   DRY=1 node scripts/eval/discoverability-probe.mjs        # stub answers + judge, no network
 * Env knobs:
 *   MODELS       comma list of OpenRouter ids        (default DEFAULT_MODELS)
 *   MODES        off,web                             (default both)
 *   REPEATS      repeats per (question, model, mode) (default 3)
 *   ONLY         comma list of question-id substrings
 *   CONCURRENCY  parallel answer+judge pipelines     (default 4)
 *   JUDGE_MODEL  judge id                            (default DEFAULT_JUDGE_MODEL)
 *   RUN_DATE     YYYY-MM-DD output folder            (default today, UTC)
 *   OUT_DIR      output dir (default scripts/eval/discoverability-out/<RUN_DATE>;
 *                a temp dir for DRY runs when OUT_DIR is unset)
 *
 * Output: <OUT_DIR>/runs.jsonl (one row per answer) + <OUT_DIR>/report.md.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const DEFAULT_MODELS = [
  'anthropic/claude-haiku-5.5',
  'openai/gpt-5.6-luna',
  'google/gemini-3.5-flash-lite',
  'deepseek/deepseek-v3.2',
];
export const DEFAULT_JUDGE_MODEL = 'x-ai/grok-4.7';
export const MODES = ['off', 'web'];
export const LABELS = ['correct', 'confused', 'unknown', 'hallucinated'];
export const CONFUSED_WITH = ['cncf-harbor', 'terminal-bench-harbor', 'other'];
export const TIERS = ['named', 'ambiguous', 'category'];
export const ANSWER_MAX_TOKENS = 2000;

// ── judge rubric (fixed; changing it changes the baseline, so version it) ─────────────────────
export const RUBRIC_VERSION = 'lin-4086-v1';
export const JUDGE_RUBRIC = `You are grading how an AI assistant's answer describes a specific product. Be strict and literal.

REFERENCE — the product the user means ("Harbour", website https://harbour.cat):
- A web app: a control plane / cockpit for AI-augmented software development, i.e. for AI coding agents.
- It reads your issue backlog (Linear, GitHub Issues/Projects, Jira, or a local store), turns the next task into a grounded prompt, dispatches it to an AI coding agent, and verifies the work on real evidence (CI results, merges, diffs) rather than the agent's own claims.
- Tagline: "keep human intent in command of AI execution". Spelled "Harbour" (British spelling); domain harbour.cat.

KNOWN NAME COLLISIONS (real products that are NOT the reference):
- cncf-harbor: Harbor, the CNCF open-source cloud-native container/artifact registry (goharbor.io, originally VMware).
- terminal-bench-harbor: Harbor, the agent evaluation / benchmarking harness framework associated with Terminal-Bench.
- other: any other real product, project or thing named Harbour/Harbor (e.g. the Harbour xBase/Clipper-compatible programming language, a local-LLM toolkit called Harbor, a shipping port, a company). Name it in the reason.

LABELS — choose exactly one:
- "correct": the answer identifies Harbour/harbour.cat as the reference product, with at least one substantive specific that matches the reference AND that is not merely a restatement of words already in the user's question (e.g. names harbour.cat when the question did not; describes the backlog -> prompt -> dispatch -> verify loop; names the backlog sources; evidence-based verification via CI/merges/diffs). It must not assert major contradicting facts (a different core function). Minor gaps are fine.
- "confused": the answer describes Harbour/harbour.cat as (or substitutes) one of the known real collisions above. Set confused_with accordingly.
- "unknown": the answer says it does not know / cannot find / is not sure what it is, declines, or only offers clearly hedged guesses without asserting them as fact. For CATEGORY-tier questions (the user did not name Harbour), an answer that never mentions Harbour/harbour.cat at all is "unknown".
- "hallucinated": the answer confidently describes a product that does not match the reference and is not one of the known real collisions — e.g. invents what harbour.cat is (a cat site, a marina booking site, ...), invents a maker/founders/features, or confidently restates the user's own question as if it were knowledge and pads it with invented specifics that do not match the reference.

Tie-breaks: a confident wrong description that mixes the reference with a collision -> "confused". A hedged answer that then asserts specifics as fact -> judge by the asserted specifics. Explaining what the domain or name might mean (e.g. what the .cat TLD is, a list of things it "could be", safety advice) while explicitly saying it cannot identify the site -> "unknown", not "hallucinated"; "hallucinated" needs a confident, specific claim about what the product IS. Cited URLs are context only: citing harbour.cat does not make an answer correct unless the text describes the product correctly.

ALSO REPORT:
- harbour_mentioned: true if the answer mentions anything named Harbour/Harbor/harbour.cat at all (any product), else false.
- confused_with: one of "cncf-harbor", "terminal-bench-harbor", "other" when label is "confused", otherwise null.
- reason: ONE short line (<= 25 words) justifying the label, quoting or paraphrasing the decisive claim.

Respond with only a JSON object: {"label": ..., "confused_with": ..., "harbour_mentioned": ..., "reason": ...}`;

export const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'confused_with', 'harbour_mentioned', 'reason'],
  properties: {
    label: { type: 'string', enum: LABELS },
    confused_with: { type: ['string', 'null'], enum: [...CONFUSED_WITH, null] },
    harbour_mentioned: { type: 'boolean' },
    reason: { type: 'string' },
  },
};

// ── pure: questions & jobs ────────────────────────────────────────────────────────────────────
/** Flatten the tiered question file into `{ id, tier, question }` rows, validating shape. */
export function flattenQuestions(file) {
  const out = [];
  const seen = new Set();
  for (const tier of TIERS) {
    for (const q of file?.tiers?.[tier] || []) {
      if (!q.id || !q.question) throw new Error(`question in tier ${tier} needs id + question`);
      if (seen.has(q.id)) throw new Error(`duplicate question id ${q.id}`);
      seen.add(q.id);
      out.push({ id: q.id, tier, question: q.question });
    }
  }
  const unknownTiers = Object.keys(file?.tiers || {}).filter((t) => !TIERS.includes(t));
  if (unknownTiers.length) throw new Error(`unknown tier(s): ${unknownTiers.join(', ')}`);
  return out;
}

/** Cartesian expansion, in a stable order: question → model → mode → repeat. */
export function expandJobs(questions, models, modes, repeats) {
  const jobs = [];
  for (const q of questions) {
    for (const model of models) {
      for (const mode of modes) {
        for (let repeat = 1; repeat <= repeats; repeat++) {
          jobs.push({ questionId: q.id, tier: q.tier, question: q.question, model, mode, repeat });
        }
      }
    }
  }
  return jobs;
}

/** The answer request: the bare user question, no system prompt. Web mode adds the web plugin. */
export function buildAnswerRequest(job, maxTokens = ANSWER_MAX_TOKENS) {
  const body = {
    model: job.model,
    messages: [{ role: 'user', content: job.question }],
    max_tokens: maxTokens,
    usage: { include: true },
  };
  if (job.mode === 'web') body.plugins = [{ id: 'web' }];
  return body;
}

/** URLs from OpenRouter's standardized `url_citation` annotations, plus bare URLs in the text. */
export function extractCitations(message) {
  const cited = [];
  for (const a of message?.annotations || []) {
    const u = a?.url_citation?.url || a?.url;
    if (u && !cited.includes(u)) cited.push(u);
  }
  const inText = [];
  const re = /https?:\/\/[^\s)\]>"'`]+/g;
  for (const m of String(message?.content || '').matchAll(re)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!inText.includes(u)) inText.push(u);
  }
  return { citations: cited, urlsInText: inText };
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

export function buildJudgeMessages(row) {
  const urls = [...new Set([...(row.citations || []), ...(row.urlsInText || [])])];
  const user = [
    `TIER: ${row.tier}${row.tier === 'category' ? ' (the user did NOT name Harbour)' : ''}`,
    `USER QUESTION: ${row.question}`,
    `CITED URLS: ${urls.length ? urls.slice(0, 20).join(' ') : '(none)'}`,
    'ANSWER:',
    '<<<',
    String(row.answer || '').slice(0, 8000),
    '>>>',
  ].join('\n');
  return [
    { role: 'system', content: JUDGE_RUBRIC },
    { role: 'user', content: user },
  ];
}

/** Parse + validate the judge's JSON. Throws on anything outside the schema. */
export function parseJudge(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`judge returned no JSON: ${s.slice(0, 120)}`);
  const j = JSON.parse(s.slice(start, end + 1));
  if (!LABELS.includes(j.label)) throw new Error(`judge label out of vocabulary: ${j.label}`);
  let confusedWith = j.confused_with ?? null;
  if (j.label === 'confused') {
    if (!CONFUSED_WITH.includes(confusedWith)) confusedWith = 'other';
  } else {
    confusedWith = null;
  }
  return {
    label: j.label,
    confusedWith,
    harbourMentioned: j.harbour_mentioned === true,
    reason: String(j.reason || '').replace(/\s+/g, ' ').trim(),
  };
}

// ── pure: tallying ────────────────────────────────────────────────────────────────────────────
const emptyCounts = () => ({ correct: 0, confused: 0, unknown: 0, hallucinated: 0, error: 0, n: 0, mentioned: 0 });

/** Label for tallying: the judge label, or `error` when the answer or the judge failed. */
export const rowLabel = (r) => (r.error || r.judgeError || !LABELS.includes(r.label) ? 'error' : r.label);

/**
 * Tally rows by an arbitrary key function. Returns a Map keyed by the joined key, in
 * first-seen order, each value `{ key: [...parts], counts }`.
 */
export function tallyBy(rows, keyFn) {
  const out = new Map();
  for (const r of rows) {
    const parts = keyFn(r);
    const k = parts.join('\u0000');
    if (!out.has(k)) out.set(k, { key: parts, counts: emptyCounts() });
    const c = out.get(k).counts;
    c[rowLabel(r)]++;
    c.n++;
    if (r.harbourMentioned) c.mentioned++;
  }
  return out;
}

export function tally(rows) {
  return {
    byTierMode: tallyBy(rows, (r) => [r.tier, r.mode]),
    byModelMode: tallyBy(rows, (r) => [r.model, r.mode]),
    byTierModelMode: tallyBy(rows, (r) => [r.tier, r.model, r.mode]),
    confusions: tallyBy(rows.filter((r) => rowLabel(r) === 'confused'), (r) => [r.confusedWith || 'other']),
  };
}

/** Sort a tally Map's values by a fixed ordering of each key part. */
export function sortedEntries(map, orders) {
  const idx = (order, v) => { const i = order ? order.indexOf(v) : -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return [...map.values()].sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const d = idx(orders[i], a.key[i]) - idx(orders[i], b.key[i]);
      if (d) return d;
      if (a.key[i] !== b.key[i]) return a.key[i] < b.key[i] ? -1 : 1;
    }
    return 0;
  });
}

export function sumCost(rows) {
  let answer = 0, judge = 0, answerKnown = 0, judgeKnown = 0;
  for (const r of rows) {
    if (typeof r.answerCost === 'number') { answer += r.answerCost; answerKnown++; }
    if (typeof r.judgeCost === 'number') { judge += r.judgeCost; judgeKnown++; }
  }
  return { answer, judge, total: answer + judge, answerKnown, judgeKnown };
}

/** Domains cited in web-mode answers, most frequent first (ties by name). */
export function citedDomains(rows) {
  const counts = new Map();
  for (const r of rows) {
    const doms = new Set([...(r.citations || []), ...(r.urlsInText || [])].map(domainOf).filter(Boolean));
    for (const d of doms) counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** Deterministic notable quotes: up to `perLabel` rows per label, spread across models. */
export function pickNotable(rows, perLabel = 2) {
  const picks = [];
  const order = ['correct', 'confused', 'hallucinated', 'unknown'];
  for (const label of order) {
    const pool = rows
      .filter((r) => rowLabel(r) === label && r.answer)
      .sort((a, b) => (a.tier === b.tier ? 0 : TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))
        || (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0)
        || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)
        || (a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : 0)
        || a.repeat - b.repeat);
    const usedModels = new Set();
    for (const r of pool) {
      if (picks.filter((p) => p.label === label).length >= perLabel) break;
      if (usedModels.has(r.model)) continue;
      usedModels.add(r.model);
      picks.push({ label, row: r });
    }
  }
  return picks;
}

export function snippet(text, max = 320) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const cell = (s) => String(s).replace(/\|/g, '\\|');
const countCells = (c) => [c.correct, c.confused, c.unknown, c.hallucinated, c.error, c.n];

// ── pure: report ──────────────────────────────────────────────────────────────────────────────
export function renderReport({ date, models, modes, repeats, judgeModel, questions, rows, notes = [] }) {
  const t = tally(rows);
  const cost = sumCost(rows);
  const L = [];
  const modelOrder = models;
  L.push(`# LIN-4086 — AI discoverability baseline (${date})`);
  L.push('');
  L.push('**BEFORE baseline.** Nothing about harbour.cat has been changed for discoverability yet. ' +
    'Each model gets the bare question (no system prompt); a fixed judge labels the answer.');
  L.push('');
  L.push(`- Date: ${date}`);
  L.push(`- Models: ${models.map((m) => `\`${m}\``).join(', ')}`);
  L.push(`- Modes: ${modes.map((m) => (m === 'web' ? '`web` (OpenRouter `plugins: [{ id: \'web\' }]`, ≡ `:online`)' : '`off` (no tools)')).join(', ')}`);
  L.push(`- Repeats: ${repeats} per (question, model, mode); questions: ${questions.length}`);
  L.push(`- Judge: \`${judgeModel}\`, temperature 0, rubric \`${RUBRIC_VERSION}\` (in \`discoverability-probe.mjs\`)`);
  L.push(`- Answer calls: ${rows.length}; answer errors: ${rows.filter((r) => r.error).length}; judge errors: ${rows.filter((r) => !r.error && r.judgeError).length}`);
  if (cost.answerKnown || cost.judgeKnown) {
    L.push(`- OpenRouter-reported cost: $${cost.total.toFixed(4)} (answers $${cost.answer.toFixed(4)} over ${cost.answerKnown} calls, judge $${cost.judge.toFixed(4)} over ${cost.judgeKnown} calls)`);
  }
  L.push('');
  L.push('Labels: **correct** = identifies Harbour/harbour.cat as the AI-agent control plane; ' +
    '**confused** = a different real product (CNCF Harbor, Terminal-Bench Harbor, other); ' +
    '**unknown** = doesn\'t know / declines / (category) never mentions Harbour; ' +
    '**hallucinated** = confidently wrong, not a known collision; **err** = call or judge failed.');
  L.push('');

  L.push('## Questions');
  L.push('');
  L.push('| id | tier | question |');
  L.push('|---|---|---|');
  for (const q of questions) L.push(`| ${q.id} | ${q.tier} | ${cell(q.question)} |`);
  L.push('');

  L.push('## By tier × mode (all models)');
  L.push('');
  L.push('| tier | mode | correct | confused | unknown | hallucinated | err | n | Harbour mentioned |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const e of sortedEntries(t.byTierMode, [TIERS, MODES])) {
    L.push(`| ${e.key[0]} | ${e.key[1]} | ${countCells(e.counts).join(' | ')} | ${e.counts.mentioned}/${e.counts.n} |`);
  }
  L.push('');

  L.push('## By model × mode (all tiers)');
  L.push('');
  L.push('| model | mode | correct | confused | unknown | hallucinated | err | n |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const e of sortedEntries(t.byModelMode, [modelOrder, MODES])) {
    L.push(`| \`${e.key[0]}\` | ${e.key[1]} | ${countCells(e.counts).join(' | ')} |`);
  }
  L.push('');

  L.push('## By tier × model × mode');
  L.push('');
  L.push('| tier | model | mode | correct | confused | unknown | hallucinated | err | n | mentioned |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const e of sortedEntries(t.byTierModelMode, [TIERS, modelOrder, MODES])) {
    L.push(`| ${e.key[0]} | \`${e.key[1]}\` | ${e.key[2]} | ${countCells(e.counts).join(' | ')} | ${e.counts.mentioned} |`);
  }
  L.push('');

  L.push('## Confusions');
  L.push('');
  const conf = sortedEntries(t.confusions, [CONFUSED_WITH]);
  if (!conf.length) L.push('_None._');
  else for (const e of conf) L.push(`- ${e.key[0]}: ${e.counts.n}`);
  L.push('');

  L.push('## Citations (web mode)');
  L.push('');
  const webRows = rows.filter((r) => r.mode === 'web' && !r.error);
  const withCites = webRows.filter((r) => (r.citations || []).length);
  const citedHarbour = webRows.filter((r) => [...(r.citations || []), ...(r.urlsInText || [])].some((u) => domainOf(u) === 'harbour.cat'));
  L.push(`- Web answers with url_citation annotations: ${withCites.length}/${webRows.length}`);
  L.push(`- Web answers citing harbour.cat: ${citedHarbour.length}/${webRows.length}`);
  const doms = citedDomains(webRows).slice(0, 15);
  if (doms.length) L.push(`- Top cited domains: ${doms.map(([d, n]) => `${d} (${n})`).join(', ')}`);
  L.push('');

  L.push('## Notable quotes');
  L.push('');
  const notable = pickNotable(rows);
  if (!notable.length) L.push('_None._');
  for (const { label, row } of notable) {
    L.push(`- **${label}** — \`${row.model}\` / ${row.mode} / ${row.questionId} #${row.repeat}: “${snippet(row.answer)}”`);
    if (row.reason) L.push(`  - judge: ${row.reason}`);
  }
  L.push('');

  L.push('## Errors / skips');
  L.push('');
  const errs = rows.filter((r) => r.error || r.judgeError);
  const notesOut = [...notes];
  if (!errs.length && !notesOut.length) L.push('_None._');
  for (const n of notesOut) L.push(`- ${n}`);
  const grouped = tallyBy(errs, (r) => [r.model, r.mode, r.error ? `answer: ${snippet(r.error, 160)}` : `judge: ${snippet(r.judgeError, 160)}`]);
  for (const e of grouped.values()) L.push(`- \`${e.key[0]}\` / ${e.key[1]} — ${e.counts.n}× ${cell(e.key[2])}`);
  L.push('');

  L.push('## Reproduce');
  L.push('');
  L.push('```');
  L.push('OPENROUTER_API_KEY=<key> node scripts/eval/discoverability-probe.mjs');
  L.push('node --test scripts/eval/discoverability-probe.test.mjs   # pure tally/report tests, no network');
  L.push('```');
  return L.join('\n') + '\n';
}

// ── output dir ────────────────────────────────────────────────────────────────────────────────
export function resolveOutDir(dry, outDir, date, here = HERE) {
  if (outDir) return outDir;
  return dry ? join(tmpdir(), `discoverability-dry-${process.pid}`) : join(here, 'discoverability-out', date);
}

// ── transport ─────────────────────────────────────────────────────────────────────────────────
async function postChat(body, key) {
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
    const t0 = performance.now();
    let res, text;
    try {
      res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/JKershaw/LinearViewer',
          'X-Title': 'Harbour discoverability probe',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      text = await res.text();
    } catch (e) {
      lastErr = `network: ${e.message}`;
      continue;
    }
    const latencyMs = Math.round(performance.now() - t0);
    if (res.status === 429 || res.status >= 500) { lastErr = `HTTP ${res.status}: ${text.slice(0, 200)}`; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    const json = JSON.parse(text);
    if (json.error) throw new Error(`API error: ${JSON.stringify(json.error).slice(0, 300)}`);
    return { json, latencyMs };
  }
  throw new Error(`gave up after 5 attempts (${lastErr})`);
}

function dryAnswer(job) {
  const content = job.tier === 'category'
    ? 'Use CI checks and diffs. Tools include Sweep and Devin.'
    : job.mode === 'web' ? 'Harbour (harbour.cat) is a control plane that reads your Linear backlog and verifies agent work on CI.' : 'Harbor is a CNCF container registry.';
  return { content, annotations: job.mode === 'web' ? [{ type: 'url_citation', url_citation: { url: 'https://harbour.cat/' } }] : [] };
}

function dryJudge(row) {
  if (row.tier === 'category') return JSON.stringify({ label: 'unknown', confused_with: null, harbour_mentioned: false, reason: 'dry: no mention' });
  if (row.mode === 'web') return JSON.stringify({ label: 'correct', confused_with: null, harbour_mentioned: true, reason: 'dry: matches' });
  return JSON.stringify({ label: 'confused', confused_with: 'cncf-harbor', harbour_mentioned: true, reason: 'dry: registry' });
}

async function runJob(job, ctx) {
  const row = {
    questionId: job.questionId, tier: job.tier, question: job.question, model: job.model, mode: job.mode, repeat: job.repeat,
    answer: null, citations: [], urlsInText: [], servedModel: null, finishReason: null,
    answerLatencyMs: null, answerCost: null, answerTokens: null, error: null,
    label: null, confusedWith: null, harbourMentioned: null, reason: null, judgeModel: ctx.judgeModel,
    judgeCost: null, judgeError: null, rubric: RUBRIC_VERSION, timestamp: new Date().toISOString(),
  };
  try {
    let msg, json = {}, latencyMs = 0;
    if (ctx.dry) msg = dryAnswer(job);
    else {
      ({ json, latencyMs } = await postChat(buildAnswerRequest(job), ctx.key));
      msg = json.choices?.[0]?.message || {};
      row.finishReason = json.choices?.[0]?.finish_reason ?? null;
    }
    row.answer = typeof msg.content === 'string' ? msg.content : '';
    Object.assign(row, extractCitations(msg));
    row.servedModel = json.model ?? null;
    row.answerLatencyMs = latencyMs;
    row.answerCost = json.usage?.cost ?? null;
    row.answerTokens = json.usage ? { prompt: json.usage.prompt_tokens ?? null, completion: json.usage.completion_tokens ?? null } : null;
    if (!row.answer.trim()) throw new Error(`empty answer (finish_reason=${row.finishReason})`);
  } catch (e) {
    row.error = e.message;
    return row;
  }
  try {
    let content, json = {};
    if (ctx.dry) content = dryJudge(row);
    else {
      ({ json } = await postChat({
        model: ctx.judgeModel,
        messages: buildJudgeMessages(row),
        temperature: 0,
        seed: 4086,
        max_tokens: 400,
        usage: { include: true },
        response_format: { type: 'json_schema', json_schema: { name: 'grade', strict: true, schema: JUDGE_SCHEMA } },
      }, ctx.key));
      content = json.choices?.[0]?.message?.content || '';
    }
    row.judgeCost = json.usage?.cost ?? null;
    Object.assign(row, parseJudge(content));
  } catch (e) {
    row.judgeError = e.message;
  }
  return row;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const key = process.env.OPENROUTER_API_KEY || '';
  const dry = !!process.env.DRY;
  if (!key && !dry) throw new Error('Set OPENROUTER_API_KEY (or DRY=1 for a no-network pipeline run)');
  const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);
  const models = list(process.env.MODELS, DEFAULT_MODELS);
  const modes = list(process.env.MODES, MODES);
  const badModes = modes.filter((m) => !MODES.includes(m));
  if (badModes.length) throw new Error(`unknown mode(s): ${badModes.join(', ')}`);
  const repeats = Number(process.env.REPEATS || 3);
  const concurrency = Number(process.env.CONCURRENCY || 4);
  const judgeModel = process.env.JUDGE_MODEL || DEFAULT_JUDGE_MODEL;
  const only = list(process.env.ONLY, []);
  const date = process.env.RUN_DATE || new Date().toISOString().slice(0, 10);
  const outDir = resolveOutDir(dry, process.env.OUT_DIR, date);

  let questions = flattenQuestions(JSON.parse(readFileSync(join(HERE, 'discoverability-questions.json'), 'utf8')));
  if (only.length) questions = questions.filter((q) => only.some((s) => q.id.includes(s)));
  const jobs = expandJobs(questions, models, modes, repeats);

  mkdirSync(outDir, { recursive: true });
  const runsPath = join(outDir, 'runs.jsonl');
  writeFileSync(runsPath, '');
  console.log(`${jobs.length} answer calls (+ judge) → ${outDir}`);

  let done = 0;
  const rows = await pool(jobs, concurrency, async (job) => {
    const row = await runJob(job, { key, dry, judgeModel });
    appendFileSync(runsPath, JSON.stringify(row) + '\n');
    done++;
    const tag = row.error ? `ERR ${snippet(row.error, 80)}` : row.judgeError ? `JUDGE-ERR ${snippet(row.judgeError, 80)}` : row.label;
    console.log(`[${done}/${jobs.length}] ${job.model} ${job.mode} ${job.questionId}#${job.repeat} → ${tag}`);
    return row;
  });

  // Rewrite runs.jsonl in stable job order (the streamed file is completion order).
  writeFileSync(runsPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const notes = [];
  for (const m of models) {
    for (const mode of modes) {
      const rs = rows.filter((r) => r.model === m && r.mode === mode);
      if (rs.length && rs.every((r) => r.error)) notes.push(`\`${m}\` / ${mode}: every call failed — mode effectively skipped for this model.`);
    }
  }
  writeFileSync(join(outDir, 'report.md'), renderReport({ date, models, modes, repeats, judgeModel, questions, rows, notes }));
  const cost = sumCost(rows);
  console.log(`done: ${rows.length} rows, ${rows.filter((r) => r.error).length} answer errors, ${rows.filter((r) => r.judgeError).length} judge errors, cost $${cost.total.toFixed(4)}`);
  console.log(`report: ${join(outDir, 'report.md')}`);
}

// ── entrypoint (guarded so tests can import helpers without running the probe) ────────────────
const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
