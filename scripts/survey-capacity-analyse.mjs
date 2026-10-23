// cheaper-capacity.md: October's model mix and cost by stage, the price of one reference session on each candidate model,
// the free models' state, what each subscription buys, and the re-tiering scenarios. Reads survey-capacity-fetch.mjs's
// snapshot and the committed benchmark table; writes docs/papers/harbour/cheaper-capacity-data.json.
// Usage: node scripts/survey-capacity-analyse.mjs [--in data/survey-capacity] [--out docs/papers/harbour/cheaper-capacity-data.json]
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const IN = arg('--in', 'data/survey-capacity');
const OUT = arg('--out', 'docs/papers/harbour/cheaper-capacity-data.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : null; };

// ---- 1. October: who did the work, and what each stage cost (API-equivalent USD, Harbour's own pricing).
// A lineage reported under two tickets (the /cost endpoint's documented limitation) is counted once, by rootItemId.
const cost = read(join(IN, 'cost.json'));
const seen = new Set();
const sessions = [];
for (const [ticket, v] of Object.entries(cost)) {
  for (const s of v.workerSessions || []) {
    if (seen.has(s.rootItemId)) continue;
    seen.add(s.rootItemId);
    sessions.push({ ticket, kind: s.kind, model: s.model || 'not stated', usd: s.costUsd || 0, at: s.dispatchedAt });
  }
}
const totalUsd = sessions.reduce((a, s) => a + s.usd, 0);
const groups = new Map();
for (const s of sessions) {
  const k = `${s.kind}\u0000${s.model}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(s.usd);
}
const stages = [...groups].map(([k, v]) => {
  const [kind, model] = k.split('\u0000');
  const usd = v.reduce((a, b) => a + b, 0);
  return { kind, model, sessions: v.length, usd: r2(usd), share: r4(usd / totalUsd), medianUsd: r2(median(v)) };
}).sort((a, b) => b.usd - a.usd);
const byModel = {};
for (const s of sessions) byModel[s.model] = r2((byModel[s.model] || 0) + s.usd);
const dates = sessions.map((s) => s.at).filter(Boolean).sort();
const tickets = Object.values(cost).filter((v) => !v.noLineage && !v.error);
const october = {
  tickets: Object.keys(cost).length,
  ticketsWithLineage: tickets.length,
  lineages: sessions.length,
  firstDispatch: dates[0],
  lastDispatch: dates.at(-1),
  totalUsd: r2(totalUsd),
  medianTicketUsd: r2(median(tickets.map((v) => v.pricedUsd))),
  appCallsUsd: r2(Object.values(cost).reduce((a, v) => a + ((v.appCalls || {}).costUsd || 0), 0)),
  byModel,
  stages,
};

// ---- 2. The open pile.
const issues = read(join(IN, 'issues.json'));
const pile = {};
for (const i of issues) pile[i.state.type] = (pile[i.state.type] || 0) + 1;
const backlog = { total: issues.length, byStateType: pile, open: (pile.backlog || 0) + (pile.unstarted || 0) + (pile.started || 0) };

// ---- 3. One reference session, priced on every candidate. The mix is chosen so that Sonnet 5.5 prices it at about
// October's median Sonnet 5.5 implementation session ($0.92): 2.0M input-side tokens, 92% of them cache reads (the share
// lib/model-pricing.js measured), 6% cache writes, 2% uncached, plus 30k output. A model with no cache-read or
// cache-write price is charged its input price for those tokens (the pessimistic reading). A long-context override is
// priced as a second, upper figure, since an agent's later requests carry contexts past 100k.
const MIX = { cacheRead: 1.84e6, cacheWrite: 0.12e6, input: 0.04e6, output: 0.03e6 };
const catalog = new Map(read(join(IN, 'openrouter-models.json')).data.map((m) => [m.id, m]));
const perM = (x) => (x == null || x === '' ? null : Number(x) * 1e6);
const priceSession = (p) => {
  const input = perM(p.prompt), out = perM(p.completion);
  const cr = perM(p.input_cache_read) ?? input, cw = perM(p.input_cache_write) ?? input;
  return (MIX.cacheRead * cr + MIX.cacheWrite * cw + MIX.input * input + MIX.output * out) / 1e6;
};
const sessionCost = (id) => {
  const m = catalog.get(id);
  if (!m) return null;
  const base = priceSession(m.pricing);
  const long = (m.pricing.overrides || []).find((o) => o.min_prompt_tokens);
  return { base: r4(base), long: long ? r4(priceSession({ ...m.pricing, ...long })) : null };
};

// Benchmarks: the committed table (independent rows only), keyed by the name the leaderboards use.
const bench = new Map();
const csv = readFileSync('docs/papers/harbour/cheaper-capacity-benchmarks.csv', 'utf8').trim().split('\n').slice(1);
for (const line of csv) {
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
  const [model, , , benchmark, score, , , , independent] = cells;
  if (independent !== 'yes' || score === '' || Number.isNaN(Number(score))) continue;
  if (!bench.has(model)) bench.set(model, {});
  bench.get(model)[benchmark] = Number(score);
}

// Candidates: Harbour's anchors (with what the capability ledger saw them do) and the current models that matter.
// harbour: 'judge' = does every step and judges; 'builder' = implemented or planned to the gate's standard;
// 'small' = implemented grounded small tickets to the gate's standard; 'none' = produced no work; null = not tried.
const CANDIDATES = [
  ['anthropic/claude-opus-5', 'Claude Opus 5', 'Opus 5', 'judge', 'claude'],
  ['anthropic/claude-sonnet-5', 'Claude Sonnet 5', 'Sonnet 5', 'builder', 'claude'],
  ['deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash (Sept 2026)', 'DeepSeek V4.1 Flash (Sept)', 'small', 'open'],
  ['deepseek/deepseek-v4-flash-0731', 'DeepSeek V4 Flash 0731', 'DeepSeek V4 Flash 0731', 'small', 'open'],
  ['z-ai/glm-5.3', 'GLM-5.3', 'GLM-5.3', 'small', 'open'],
  ['google/gemini-3.8-flash', 'Gemini 3.8 Flash', 'Gemini 3.8 Flash', 'small', 'closed'],
  ['openai/gpt-oss-120b', 'gpt-oss-120b', 'gpt-oss-120b', 'none', 'open'],
  ['anthropic/claude-opus-5.5', 'Claude Opus 5.5', 'Opus 5.5', null, 'claude'],
  ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', 'Sonnet 5.5', null, 'claude'],
  ['anthropic/claude-haiku-5.5', 'Claude Haiku 5.5', 'Haiku 5.5', null, 'claude'],
  ['anthropic/claude-fable-5.1', 'Claude Fable 5.1', 'Fable 5.1', null, 'claude'],
  ['openai/gpt-6-astra', 'GPT-6 Astra', 'GPT-6 Astra', null, 'closed'],
  ['openai/gpt-6.1-sol', 'GPT-6.1 Sol', 'GPT-6.1 Sol', null, 'closed'],
  ['openai/gpt-6-luna', 'GPT-6 Luna', 'GPT-6 Luna', null, 'closed'],
  ['google/gemini-4-argon', 'Gemini 4 Argon', 'Gemini 4 Argon', null, 'closed'],
  ['deepseek/deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash 1017', 'DeepSeek V4.1 Flash 1017', null, 'open'],
  ['z-ai/glm-5.3-flash', 'GLM-5.3 Flash', 'GLM-5.3 Flash', null, 'open'],
  ['minimax/minimax-m3.1-flash', 'MiniMax-M3.1-Flash', 'MiniMax M3.1 Flash', null, 'open'],
  ['xiaomi/mimo-v2.6-pro', 'MiMo V2.6 Pro', 'MiMo V2.6 Pro', null, 'open'],
  ['xiaomi/mimo-v2.6-flash', 'MiMo V2.6 Flash', 'MiMo V2.6 Flash', null, 'open'],
  ['qwen/qwen3.8-max-0902', 'Qwen 3.8 Max (0902)', 'Qwen 3.8 Max', null, 'closed'],
  ['moonshotai/kimi-k3', 'Kimi K3', 'Kimi K3', null, 'open'],
  ['x-ai/grok-4.7', 'Grok 4.7', 'Grok 4.7', null, 'closed'],
  ['stepfun/step-5-preview', 'Step 5 Preview', 'Step 5 Preview', null, 'closed'],
  ['thinkingmachines/inkling', 'Inkling', 'Inkling', null, 'closed'],
];
const candidates = CANDIDATES.map(([id, benchName, label, harbour, family]) => {
  const b = bench.get(benchName) || {};
  const m = catalog.get(id);
  return {
    id, label, harbour, family,
    inPerM: m ? r4(perM(m.pricing.prompt)) : null,
    outPerM: m ? r4(perM(m.pricing.completion)) : null,
    session: sessionCost(id),
    tb4: b['Terminal-Bench 4.0'] ?? null,
    vibe: b['Vibe Code Bench v1.1'] ?? null,
    aaCodingAgent: b['AA Coding Agent Index'] ?? null,
  };
});
// Terminal-Bench 4.0 for Inkling is on Vals' live board (0.51) but outside the committed table's model list.
const inkling = candidates.find((c) => c.id === 'thinkingmachines/inkling');
if (inkling.tb4 == null) { inkling.tb4 = 0.51; inkling.tb4Note = 'Vals Terminal-Bench 4.0 board, 2026-10-22'; }

// ---- 4. The free models: what OpenRouter lists, how each endpoint is holding up, and when it ends.
const freeModels = [...catalog.values()].filter((m) => m.id.endsWith(':free')).map((m) => {
  let ep = null;
  try { ep = read(join(IN, 'endpoints', `${m.id.replace(/[/:]/g, '_')}.json`)).data.endpoints[0]; } catch { /* no endpoint record */ }
  return {
    id: m.id,
    context: m.context_length,
    tools: (m.supported_parameters || []).includes('tools'),
    expires: m.expiration_date || null,
    provider: ep ? ep.provider_name : null,
    uptime1d: ep && ep.uptime_last_1d != null ? r2(ep.uptime_last_1d) : null,
    uptime30m: ep && ep.uptime_last_30m != null ? r2(ep.uptime_last_30m) : null,
  };
}).sort((a, b) => a.id.localeCompare(b.id));
const FREE_LIMITS = { requestsPerMinute: 20, requestsPerDayUnder10Credits: 50, requestsPerDayWith10Credits: 1000, source: 'https://openrouter.ai/docs/api-reference/limits' };
// Requests per agent session: Harbour does not record it per session; 60–150 brackets one tool call per request over
// a session of starting-context.md's 24 calls to the first edit plus the edit, test and PR work after it.
const REQUESTS_PER_SESSION = [60, 150];
const days = (Date.parse(october.lastDispatch) - Date.parse(october.firstDispatch)) / 86400000;
const freeLane = {
  sessionsPerDay: REQUESTS_PER_SESSION.map((r) => r2(FREE_LIMITS.requestsPerDayWith10Credits / r)).reverse(),
  fleetSessionsPerDay: r2(october.lineages / days),
};

// ---- 5. What the Claude subscription is worth, in API-equivalent dollars a week.
// lib/weekly-budget.js: 27 points of the weekly window = $1,070.58 on 2026-08-14, during the +50% promotion that ran to
// 2026-09-13; since 2026-09-14 limits are +25% over the pre-promotion baseline. So today's window ≈ 100 points × 39.65 ×
// 1.25 / 1.5. The plan's price is the archive's own figure, about £45 a week (Archive #5, "The Cheap Ships").
const perPoint = 1070.58 / 27;
const windowUsd = 100 * perPoint * 1.25 / 1.5;
const subscription = {
  usdPerPoint: r2(perPoint), windowUsdAtCalibration: r2(100 * perPoint), windowUsdNow: r2(windowUsd),
  planUsdPerWeek: r2(200 * 12 / 52), leverage: r2(windowUsd / (200 * 12 / 52)),
};

// ---- 6. What one dollar buys, in reference sessions, by route. A plan's figure is its vendor's own volume statement
// turned into reference sessions; where the vendor states no volume, there is no row.
const ref = (id) => candidates.find((c) => c.id === id).session.base;
const sonnetRef = ref('anthropic/claude-sonnet-5.5');
const REF_TOKENS = MIX.cacheRead + MIX.cacheWrite + MIX.input + MIX.output;
const routes = [
  { route: 'Claude Max 20x, inside the weekly window (Sonnet 5.5)', kind: 'subscription', perDollar: r2(windowUsd / sonnetRef / (200 * 12 / 52)), note: 'calibrated window; assumes the window draws in proportion to API price' },
  { route: 'Claude Max 20x, inside the weekly window (Haiku 5.5)', kind: 'subscription', perDollar: r2(windowUsd / ref('anthropic/claude-haiku-5.5') / (200 * 12 / 52)), note: 'as above; Haiku 5.5 untried in Harbour' },
  { route: 'Z.ai GLM Coding Plan Pro (GLM-5.3), $80', kind: 'subscription', perDollar: r2([290e6, 580e6].map((t) => t * 52 / 12 / REF_TOKENS / 80)[0]), perDollarHigh: r2(580e6 * 52 / 12 / REF_TOKENS / 80), note: 'vendor estimate 290–580M tokens a week at a 95% cache hit' },
  { route: 'GitHub Copilot Max, $100 (Sonnet 5.5 at API rates)', kind: 'subscription', perDollar: r2(2 / sonnetRef), note: '$200 of credits at API rates for $100' },
  { route: 'OpenRouter: DeepSeek V4 Flash 0731', kind: 'api', perDollar: r2(1 / ref('deepseek/deepseek-v4-flash-0731')) },
  { route: 'OpenRouter: DeepSeek V4.1 Flash 1017', kind: 'api', perDollar: r2(1 / ref('deepseek/deepseek-v4.1-flash-1017')) },
  { route: 'OpenRouter: GLM-5.3 Flash', kind: 'api', perDollar: r2(1 / ref('z-ai/glm-5.3-flash')) },
  { route: 'OpenRouter: Claude Haiku 5.5', kind: 'api', perDollar: r2(1 / ref('anthropic/claude-haiku-5.5')) },
  { route: 'OpenRouter: GPT-6 Luna', kind: 'api', perDollar: r2(1 / ref('openai/gpt-6-luna')) },
  { route: 'OpenRouter: GPT-6.1 Sol', kind: 'api', perDollar: r2(1 / ref('openai/gpt-6.1-sol')) },
  { route: 'OpenRouter: Claude Sonnet 5.5', kind: 'api', perDollar: r2(1 / sonnetRef) },
  { route: 'OpenRouter: Claude Opus 5.5', kind: 'api', perDollar: r2(1 / ref('anthropic/claude-opus-5.5')) },
];

// ---- 7. Re-tiering inside the window: re-price October's sessions as if each stage ran on another model, by the
// ratio of the two models' reference-session prices, and read the result as window drawn (same assumption as above).
const JUDGE = new Set(['review', 'plan-review', 'autopilot', 'research', 'wake', 'blocked', 'bug', 'custom', 'design', 'retrospective-audit', 'breakdown', 'spike', 'scoping']);
const BUILD = new Set(['implementation', 'plan', 'close-out', 'triage']);
const ratio = (from, to, which = 'base') => (ref(to) && candidates.find((c) => c.id === to).session[which] || ref(to)) / ref(from);
const opusId = 'anthropic/claude-opus-5.5', sonnetId = 'anthropic/claude-sonnet-5.5', haikuId = 'anthropic/claude-haiku-5.5';
const modelId = (m) => (m === 'claude-opus-5-5' ? opusId : m === 'claude-sonnet-5-5' ? sonnetId : null);
const reprice = (rule) => sessions.reduce((a, s) => {
  const from = modelId(s.model);
  const to = from && rule(s.kind, from);
  return a + (to && to !== from ? s.usd * (typeof to === 'string' ? ratio(from, to) : to(from)) : s.usd);
}, 0);
const scenario = (name, rule) => { const usd = reprice(rule); return { name, usd: r2(usd), capacity: r2(totalUsd / usd) }; };
const scenarios = [
  scenario('Today: Opus 5.5 judges, Sonnet 5.5 builds', () => null),
  scenario('Judging stages to Sonnet 5.5', (k, from) => (JUDGE.has(k) && from === opusId ? sonnetId : null)),
  scenario('Building stages to Haiku 5.5 (short-context price)', (k, from) => (BUILD.has(k) && from === sonnetId ? haikuId : null)),
  scenario('Building stages to Haiku 5.5 (long-context price)', (k, from) => (BUILD.has(k) && from === sonnetId ? () => ratio(sonnetId, haikuId, 'long') : null)),
  scenario('Both: Sonnet 5.5 judges, Haiku 5.5 builds (short)', (k, from) => (JUDGE.has(k) && from === opusId ? sonnetId : BUILD.has(k) && from === sonnetId ? haikuId : null)),
  scenario('Both: Sonnet 5.5 judges, Haiku 5.5 builds (long)', (k, from) => (JUDGE.has(k) && from === opusId ? sonnetId : BUILD.has(k) && from === sonnetId ? () => ratio(sonnetId, haikuId, 'long') : null)),
];
const buildUsd = sessions.filter((s) => BUILD.has(s.kind) && modelId(s.model) === sonnetId).reduce((a, s) => a + s.usd, 0);
const offWindow = {
  buildingStagesUsd: r2(buildUsd),
  buildingStagesShare: r4(buildUsd / totalUsd),
  onDeepSeekFlash1017Usd: r2(buildUsd * ratio(sonnetId, 'deepseek/deepseek-v4.1-flash-1017')),
  onGlm53FlashUsd: r2(buildUsd * ratio(sonnetId, 'z-ai/glm-5.3-flash')),
  onDeepSeekFlash0731Usd: r2(buildUsd * ratio(sonnetId, 'deepseek/deepseek-v4-flash-0731')),
  days: r2(days),
};

const out = {
  generatedFrom: { catalogAccessed: '2026-10-23', proxyRead: '2026-10-23', benchmarksAccessed: '2026-10-23' },
  referenceSession: { ...MIX, sonnet55: r4(sonnetRef), octoberMedianSonnetImplementation: october.stages.find((s) => s.kind === 'implementation' && s.model === 'claude-sonnet-5-5').medianUsd },
  october, backlog, candidates, freeModels, freeLimits: FREE_LIMITS, freeLane, subscription, routes, scenarios, offWindow,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ october: { totalUsd: october.totalUsd, byModel }, backlog: backlog.open, subscription, scenarios, offWindow, freeLane }, null, 1));
