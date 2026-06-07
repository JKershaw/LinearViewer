#!/usr/bin/env node
/**
 * A/B eval for prompt+output SCALING (LIN-260).
 *
 * John's complaint, made measurable. Outputs are uniformly sized regardless of the
 * task's real scale, in two ways the existing single-directive evals don't capture:
 *
 *   - LOWER BOUND  — a one-line task gets the same heavy plan a refactor does.
 *   - UPPER BOUND  — a deep upstream artifact (research dumped in comments) inflates
 *                    the downstream prompt, and the meta-prompt starts writing the
 *                    NEXT phase's deliverable itself ("the plan writes the plan").
 *
 * Three behaviors, three metrics — two of them deterministic (just output length,
 * which IS the complaint), one a constant-judge rate:
 *
 *   length        words in the generated prompt's `## Prompt` body. Lower bound:
 *                 small tasks should land in a light band. Deterministic.
 *   inflation     words(out | DEEP upstream) / words(out | THIN upstream) on the
 *                 SAME task. >1 means depth propagated. Deterministic.
 *   lane          judge YES/NO: did the generated prompt STAY IN ITS LANE — only
 *                 instruct the next agent — rather than pre-writing that agent's
 *                 deliverable (a written-out implementation plan / actual code)?
 *   quality       judge YES/NO (the guard): does the prompt still name the surface,
 *                 the change, and a verification approach? Stops "shorter" winning
 *                 by dropping substance — the over-trim guard.
 *
 * Faithfulness: the meta-prompt is rebuilt from the LIVE lib exports (not a txt
 * snapshot), so any lib change in Phases 2-4 is measured automatically. Arm A is
 * produced by regex-stripping a directive from that live prompt (the completeness-
 * check pattern); Arm B is the live prompt. Strip one change at a time.
 *
 * This is a LOWER BOUND on real behavior: a single call can't grep or restrain
 * itself the way a real agent (Claude Code) can. Numbers are model/sample-dependent.
 * See docs/prompt-change-validation.md and docs/lin-260-prompt-scaling-research.md.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval-prompt-scaling.mjs            # baseline (1 arm)
 *   ... MODE=ab STRIP=lane node scripts/eval-prompt-scaling.mjs           # A/B a directive
 *
 * Env knobs:
 *   MODE        baseline | ab                  (default baseline)
 *   STRIP       which directive to strip for arm A: lane | scale  (MODE=ab)
 *   GEN_MODEL   generator under test           (default qwen/qwen3.7-plus)
 *   JUDGE_MODEL judge, held constant           (default anthropic/claude-haiku-4.5)
 *   K           runs per arm per case          (default 1)
 *   ONLY        substring filter on case id    (e.g. ONLY=SYN-7)
 *   GROUP       filter by group: small|large|inflation|guard
 *   MAX_TOKENS  output cap                      (default 2000 — must not truncate a
 *                                                bloated prompt, or inflation hides)
 */
import { formatIssueContext } from '../lib/openrouter.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../lib/completion-signals.js';
import { buildMetaPromptTemplate } from '../lib/prompts/meta-prompt-template.js';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const MODE = (process.env.MODE || 'baseline').toLowerCase();
const STRIP = (process.env.STRIP || 'lane').toLowerCase();
const GEN_MODEL = process.env.GEN_MODEL || 'qwen/qwen3.7-plus';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'anthropic/claude-haiku-4.5';
const K = Number(process.env.K) || 1;
const ONLY = process.env.ONLY;
const GROUP = process.env.GROUP;
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 2000;

const inProgress = { name: 'In Progress', type: 'started' };
const todo = { name: 'Todo', type: 'unstarted' };

// Faithful reconstruction of lib/openrouter.js buildMetaPrompt() from exported
// pieces, so the harness reads the LIVE prompt. Leaf-task context (no focusedChild).
function buildMeta(issue, context = {}) {
  const ctx = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [], ...context };
  const issueContext = formatIssueContext(issue, ctx);
  const children = ctx.children || [];
  const comments = ctx.comments || [];
  return buildMetaPromptTemplate({
    issueContext,
    identifier: issue.identifier,
    hasSubtasks: children.length > 0,
    subtaskCount: children.length,
    completedCount: 0,
    inProgressCount: 0,
    remainingCount: children.length,
    hasComments: comments.length > 0,
    commentCount: comments.length,
    aiHints: formatAIHintsForMetaPrompt(),
    actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(),
    focusedSubtaskId: null,
    featureFlags: {}
  });
}

// Strip a directive to make arm A. Each regex MUST match (throws otherwise) so a
// silent no-op strip can't masquerade as "no effect". The `lane` and `scale`
// markers are added to the meta-prompt in Phases 2/3; until then ab mode on that
// directive will correctly refuse to run.
const STRIPPERS = {
  // matches the universal lane-boundary block added in Phase 2
  lane: t => t.replace(/\n## Stay In Your Lane[\s\S]*?(?=\n## )/, '\n'),
  // matches the scale directive added in Phase 3
  scale: t => t.replace(/\n## Scale To The Task[\s\S]*?(?=\n## )/, '\n')
};

function strip(metaPrompt) {
  const fn = STRIPPERS[STRIP];
  if (!fn) throw new Error(`Unknown STRIP=${STRIP} (expected: ${Object.keys(STRIPPERS).join(', ')})`);
  const out = fn(metaPrompt);
  if (out === metaPrompt) throw new Error(`STRIP=${STRIP} matched nothing — the directive is not in the live prompt yet (add it in lib before A/B-ing it).`);
  return out;
}

// ----- corpus -------------------------------------------------------------
// expectScale: the case's TRUE scale, used to read length bands and guards.
//   small    -> arm B should land LIGHT
//   large    -> arm B should stay FULL (proves we didn't globally truncate)
// deepUpstream: a research artifact injected as a comment for the inflation runner.
//   The SAME issue is generated thin (no comment) and deep (with it); ratio>1 = leak.
const DEEP_RESEARCH = `## Research findings

I traced the dispatch expiry end to end. The TTL constant DISPATCH_TTL_MS lives in lib/dispatch-store.js line 14 (\`24 * 60 * 60 * 1000\`). It is read in three places: the sweep in pruneExpired() (line 88), the poll filter in listAvailable() (line 131), and the expiry stamp written at enqueue() (line 52). The MangoDB file store persists items with an \`expiresAt\` absolute timestamp computed at write time, NOT a relative TTL — so changing the constant only affects items enqueued AFTER the change; existing rows keep their old expiry. There is a unit test tests/unit/dispatch-store.test.js that asserts \`expiresAt - createdAt === 86400000\` (line 41) and an e2e test tests/e2e/dispatch.spec.js that waits on a 24h boundary via a clock mock (line 210). The consumer docs docs/dispatch-integration.md state "Items expire after 24 hours" in two places (the overview and the poll-endpoint section). The proxy events log records an \`expired\` event type that downstream dashboards group by; no schema change needed there. Recommended approach: lift the constant to a named export, update both tests' expected value, update both doc mentions, and add a migration note that in-flight items keep the old expiry. Surface Assessment: [refactor needed: extract DISPATCH_TTL_MS to a single named export consumed by the three call sites before changing the value, so the change lands in one place].`;

const CASES = [
  // ---- genuinely small (arm B must shrink) ----
  { id: 'SYN-7 typo', group: 'small', expectScale: 'small',
    issue: { identifier: 'SYN-7', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Fix typo in footer: "Copyrght" -> "Copyright"',
      description: 'The footer in lib/components/footer.js renders "Copyrght". Fix the spelling.' } },
  { id: 'SYN-9 mirror-a-validation', group: 'small', expectScale: 'small',
    issue: { identifier: 'SYN-9', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add validation: reject dispatch prompts longer than 50k chars',
      description: 'In the POST dispatch handler (routes/dispatch.js), return 400 if the prompt exceeds 50000 chars. Mirror the existing empty-prompt validation right above it.' } },
  { id: 'SYN-8 plan-exists fits-one-session', group: 'small', expectScale: 'small',
    issue: { identifier: 'SYN-8', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Add a --json flag to the CLI viewer command',
      description: `## Plan
- Files to modify: lib/linear-cli.js (the 'viewer' command handler).
- Change: when argv includes --json, JSON.stringify the user object instead of pretty-printing.
- Edge: --json with no other args; unknown user (null) -> print {}.
- Testing: add a unit test asserting JSON output shape.

## Scope
Single surface. Fits one session.` } },

  // ---- genuinely large (arm B must NOT shrink) ----
  { id: 'SYN-12 migration multi-session', group: 'large', expectScale: 'large',
    issue: { identifier: 'SYN-12', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Migrate session storage from file-based MangoDB to MongoDB',
      description: `## Plan
Surfaces: session-store.js, server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
Arrows: server wiring depends on the store rewrite; migration depends on both.
## Scope
Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.` } },
  { id: 'SYN-5 pagination multi-surface', group: 'large', expectScale: 'standard',
    issue: { identifier: 'SYN-5', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add pagination to the issues list (API + UI)',
      description: 'The issues list returns everything at once. Add page-based pagination to the GET /issues endpoint and add prev/next controls to the issues list UI. Keep existing default behavior for callers that pass no page param.' } },

  // ---- inflation (same task thin vs deep) ----
  // A plan task with a thin description; the deep variant dumps a full research
  // artifact into comments. Gold for "deep research inflates the plan".
  { id: 'INF-1 ttl-bump plan', group: 'inflation', expectScale: 'small', inflation: true,
    deepUpstream: DEEP_RESEARCH,
    issue: { identifier: 'INF-1', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Bump the dispatch item TTL from 24h to 48h',
      description: 'Change the dispatch expiry from 24 hours to 48.' } },

  // ---- guards (over-trim traps) ----
  // deceptively small: terse one-liner, actually multi-surface -> must stay full
  { id: 'GRD-deceptive-small', group: 'guard', expectScale: 'large',
    issue: { identifier: 'GRD-1', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Rename the `urlKey` workspace param to `workspaceSlug`',
      description: 'Rename urlKey to workspaceSlug everywhere.' } },
  // deceptively large: wall of context, trivial actual change -> must go light
  { id: 'GRD-deceptive-large', group: 'guard', expectScale: 'small', inflation: true,
    deepUpstream: DEEP_RESEARCH,
    issue: { identifier: 'GRD-2', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Change the footer copyright year to 2026',
      description: 'Update the hardcoded year in lib/components/footer.js from 2025 to 2026.' } }
];

// ----- model I/O ----------------------------------------------------------
let lastErr = '';
async function call(prompt, model, max = MAX_TOKENS, temp = 0.3) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: temp, max_tokens: max, messages: [{ role: 'user', content: prompt }] })
      });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      if (j.choices?.[0]?.message?.content) return j.choices[0].message.content;
      lastErr = (j.error?.message || JSON.stringify(j)).slice(0, 120);
    } catch (e) { lastErr = e.message.slice(0, 120); }
  }
  return '__ERR__' + lastErr;
}

const wc = s => (s.trim().match(/\S+/g) || []).length;
// The generated artifact carries a `## Prompt` body; measure that (the deliverable),
// falling back to the whole output if the model omitted the header.
function promptBody(out) {
  const i = out.indexOf('## Prompt');
  return i >= 0 ? out.slice(i + '## Prompt'.length).trim() : out.trim();
}
function action(out) {
  const m = out.match(/→\s*\*\*(.+?)\*\*/);
  return m ? m[1].toLowerCase().trim() : '?';
}

async function judge(rubric, output) {
  const p = `You are grading a GENERATED PROMPT (instructions written for a downstream coding agent) against a strict rubric. Answer with ONLY "YES" or "NO".\n\nRUBRIC: ${rubric}\n\nGENERATED PROMPT:\n${output}\n\nAnswer:`;
  return /yes/i.test(await call(p, JUDGE_MODEL, 5, 0)) ? 1 : 0;
}
const LANE_RUBRIC = 'Does this generated prompt STAY IN ITS LANE — i.e. it INSTRUCTS the downstream agent to produce the deliverable (research, a plan, or an implementation) without PRE-WRITING that deliverable itself? Answer YES if it only directs/structures the work. Answer NO if it bleeds across the lane by including a concrete written-out implementation plan, step-by-step code changes, or actual code that would be the receiving agent\'s job to produce.';
const QUALITY_RUBRIC = 'Does this generated prompt retain the essential substance needed to do the task — i.e. it points at the relevant surface/file(s), states what change is wanted, and asks for some verification or testing? Answer YES if all three are present in some form. Answer NO if it has been hollowed out (missing the surface, the change, or any verification).';

// ----- runners ------------------------------------------------------------
// Lane-bleed can only happen from a phase that HAS a downstream deliverable to
// pre-empt. Research/plan can write the plan/impl that is the next agent's job;
// implement/review/bug/blocked ARE terminal — directing the concrete change there
// is the job, not a bleed. Gate the lane judge so terminal phases don't pollute it.
const NON_TERMINAL = new Set(['research', 'plan', 'breakdown', 'scoping', 'design', 'look into', 'look-into']);

async function genStats(metaPrompt, opts = {}) {
  const out = await call(metaPrompt, GEN_MODEL);
  if (out.startsWith('__ERR__')) return { err: out.slice(0, 60) };
  const body = promptBody(out);
  const act = action(out);
  const s = { words: wc(body), action: act };
  if (opts.lane && NON_TERMINAL.has(act)) s.lane = await judge(LANE_RUBRIC, body);
  if (opts.quality) s.quality = await judge(QUALITY_RUBRIC, body);
  return s;
}

async function avg(metaPrompt, opts) {
  const runs = await Promise.all(Array.from({ length: K }, () => genStats(metaPrompt, opts)));
  const ok = runs.filter(r => !r.err);
  if (!ok.length) return { err: runs[0].err };
  const mean = k => ok.reduce((a, r) => a + (r[k] || 0), 0) / ok.length;
  const laneRuns = ok.filter(r => typeof r.lane === 'number'); // terminal phases excluded
  return {
    words: Math.round(mean('words')),
    action: ok[0].action,
    lane: opts.lane && laneRuns.length ? +(laneRuns.reduce((a, r) => a + r.lane, 0) / laneRuns.length).toFixed(2) : undefined,
    quality: opts.quality ? +mean('quality').toFixed(2) : undefined
  };
}

const fmt = v => v === undefined ? '  - ' : String(v);

let cases = CASES.filter(c => !ONLY || c.id.includes(ONLY));
if (GROUP) cases = cases.filter(c => c.group === GROUP);

console.log(`mode=${MODE}${MODE === 'ab' ? ` strip=${STRIP}` : ''}  gen=${GEN_MODEL}  judge=${JUDGE_MODEL}  K=${K}  cases=${cases.length}\n`);

if (MODE === 'baseline') {
  console.log('case                          scale     action      words   lane  qual   inflation');
  console.log('─'.repeat(92));
  for (const c of cases) {
    const thin = buildMeta(c.issue);
    const r = await avg(thin, { lane: true, quality: true });
    if (r.err) { console.log(`${c.id.padEnd(28)}  ERR ${r.err}`); continue; }
    let infl = '   -';
    if (c.inflation) {
      const deep = buildMeta(c.issue, { comments: [{ user: 'agent', createdAt: '2026-06-02T00:00:00Z', body: c.deepUpstream }] });
      const d = await avg(deep, {});
      if (!d.err) infl = (d.words / Math.max(1, r.words)).toFixed(2) + 'x';
    }
    console.log(
      `${c.id.padEnd(28)}  ${c.expectScale.padEnd(8)}  ${(r.action || '?').padEnd(10)}  ${String(r.words).padStart(5)}   ${fmt(r.lane).padStart(4)}  ${fmt(r.quality).padStart(4)}     ${infl}`
    );
  }
  console.log('\nReading: small/guard-small want LOW words + lane=1; large/guard-large want HIGH words.');
  console.log('inflation>1 = deep upstream leaked into the generated prompt (the upper-bound failure).');
} else {
  // A/B: arm A = stripped directive, arm B = live. Strip ONE directive at a time.
  console.log(`A/B on STRIP=${STRIP}  (A=stripped, B=live)\n`);
  console.log('case                          scale     A.words  B.words   ΔW    A.lane B.lane   A.qual B.qual');
  console.log('─'.repeat(96));
  let sumLaneA = 0, sumLaneB = 0, nLane = 0;
  for (const c of cases) {
    const liveMeta = buildMeta(c.issue, c.inflation ? { comments: [{ user: 'agent', createdAt: '2026-06-02T00:00:00Z', body: c.deepUpstream }] } : {});
    const a = await avg(strip(liveMeta), { lane: true, quality: true });
    const b = await avg(liveMeta, { lane: true, quality: true });
    if (a.err || b.err) { console.log(`${c.id.padEnd(28)}  ERR`); continue; }
    if (typeof a.lane === 'number' && typeof b.lane === 'number') { sumLaneA += a.lane; sumLaneB += b.lane; nLane++; }
    console.log(
      `${c.id.padEnd(28)}  ${c.expectScale.padEnd(8)}  ${String(a.words).padStart(6)}  ${String(b.words).padStart(6)}  ${String(b.words - a.words).padStart(5)}   ${fmt(a.lane).padStart(5)} ${fmt(b.lane).padStart(5)}    ${fmt(a.quality).padStart(5)} ${fmt(b.quality).padStart(5)}`
    );
  }
  if (nLane) console.log(`\nlane-discipline  A=${(sumLaneA / nLane).toFixed(2)}  B=${(sumLaneB / nLane).toFixed(2)}  Δ=${((sumLaneB - sumLaneA) / nLane).toFixed(2)}  (higher B = directive helps; quality must not drop)`);
}
