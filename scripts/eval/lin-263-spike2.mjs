#!/usr/bin/env node
/**
 * LIN-263 spike 2 — complexity gradient × refreshed model list.
 *
 * Hunts the "Haiku is fine until complexity X, then falls off" cliff John reported.
 * Tasks are ordered by ascending complexity; for each (task × model) we capture the
 * routing decision (auto-scored against the known-correct action — a cheap, strong
 * cliff proxy), wall-clock latency, OpenRouter cost, and the generated prompt body
 * (dumped to files for the manual quality read). K=1, temp 0 — directional spike.
 *
 *   OPENROUTER_API_KEY=... node scripts/eval/lin-263-spike2.mjs
 *
 * Model list refreshed 2026-06-08 from the live OpenRouter /models API (the codebase
 * AVAILABLE_MODELS was stale: opus-4.7→4.8, gemini-3-flash-preview→3.5-flash,
 * deepseek-v3.2→v4-flash, + qwen3.7-plus the newest model on the platform).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { formatIssueContext } from '../../lib/openrouter.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'lin-263-spike2-out');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }

const REFERENCE = 'anthropic/claude-opus-4.8';
const MODELS = [
  'anthropic/claude-opus-4.8',      // reference (refreshed: was 4.7)
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5',     // the cliff suspect
  'google/gemini-3.5-flash',        // refreshed: was gemini-3-flash-preview
  'qwen/qwen3.7-plus',              // newest model on the platform
  'deepseek/deepseek-v4-flash',     // refreshed: was v3.2 — ultra-cheap ($0.10/$0.20)
  'openai/gpt-5.4-mini'             // continuity with spike 1
];

const inProgress = { name: 'In Progress', type: 'started' };
const todo = { name: 'Todo', type: 'unstarted' };

const DEEP_RESEARCH = `## Research findings

I traced the dispatch expiry end to end. The TTL constant DISPATCH_TTL_MS lives in lib/dispatch-store.js line 14 (\`24 * 60 * 60 * 1000\`). It is read in three places: the sweep in pruneExpired() (line 88), the poll filter in listAvailable() (line 131), and the expiry stamp written at enqueue() (line 52). The MangoDB file store persists items with an \`expiresAt\` absolute timestamp computed at write time, NOT a relative TTL — so changing the constant only affects items enqueued AFTER the change; existing rows keep their old expiry. There is a unit test tests/unit/dispatch-store.test.js that asserts \`expiresAt - createdAt === 86400000\` (line 41) and an e2e test tests/e2e/dispatch.spec.js that waits on a 24h boundary via a clock mock (line 210). The consumer docs docs/dispatch-integration.md state "Items expire after 24 hours" in two places. Recommended approach: lift the constant to a named export, update both tests' expected value, update both doc mentions, and add a migration note that in-flight items keep the old expiry.`;

// Complexity gradient (ascending). expect = acceptable routes; deepUpstream = inflation trap.
const TASKS = [
  { id: 'SYN-7-typo', complexity: '1 trivial', expect: ['implement'],
    issue: { identifier: 'SYN-7', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Fix typo in footer: "Copyrght" -> "Copyright"',
      description: 'The footer in lib/components/footer.js renders "Copyrght". Fix the spelling.' } },

  { id: 'SYN-9-validation', complexity: '2 simple', expect: ['implement', 'plan'],
    issue: { identifier: 'SYN-9', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add validation: reject dispatch prompts longer than 50k chars',
      description: 'In the POST dispatch handler (routes/dispatch.js), return 400 if the prompt exceeds 50000 chars. Mirror the existing empty-prompt validation right above it.' } },

  { id: 'SYN-5-pagination', complexity: '3 medium', expect: ['plan'],
    issue: { identifier: 'SYN-5', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add pagination to the issues list (API + UI)',
      description: 'The issues list returns everything at once. Add page-based pagination to the GET /issues endpoint and add prev/next controls to the issues list UI. Keep existing default behavior for callers that pass no page param.' } },

  { id: 'INF-1-ttl-deep', complexity: '4 inflation-trap', expect: ['implement', 'plan'],
    deepUpstream: DEEP_RESEARCH,
    issue: { identifier: 'INF-1', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Bump the dispatch item TTL from 24h to 48h',
      description: 'Change the dispatch expiry from 24 hours to 48.' } },

  { id: 'SYN-12-migration', complexity: '5 multi-session', expect: ['breakdown'],
    issue: { identifier: 'SYN-12', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Migrate session storage from file-based MangoDB to MongoDB',
      description: `## Plan
Surfaces: session-store.js, server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
Arrows: server wiring depends on the store rewrite; migration depends on both.
## Scope
Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.` } },

  { id: 'LIN-325-research', complexity: '6 research-gold', expect: ['research'],
    issue: { identifier: 'LIN-325', createdAt: '2026-06-07T08:41:20.522Z', state: inProgress, labels: [],
      title: 'Write the autopilot operating manual',
      description: `## What
Write the **autopilot operating manual** — a field guide the autopilot reads on kickoff and references when a situation calls for it — and wire the Autopilot prompt to consult it (\`lib/prompts/autopilot-kickoff.js\` / \`buildAutopilotKickoff()\`). Reference, don't inline — keep the light-orchestrator invariant.
## Why
This is the autopilot-native, cheaper realisation of the superseded drift-defense epic LIN-289: the supervisor and evidence-discipline become guide-text read by an agent already positioned to flag.
## The specifics that matter (hold these; fill in the rest from the track record)
* Write it human-shaped: intro → how a run normally goes → known issues to watch for.
* Ground it on altitude. The autopilot is high; the generated prompts do the heavy lifting low; the loop self-corrects across passes.
* Tolerant operating stance. Don't halt at the first sign of trouble.
* Descriptive, never normative.
## Method (high level)
Seed from the design conversation → research our own track record concretely — the named failure episodes (\`docs/autopilot-experiment.md\` runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the \`retro\` lens over a real churn cluster for a worked example per known-issue) → write it → wire the prompt to it.
## Done when
The manual exists and is human-shaped, with the Drift entry complete and the rest at least drafted from named episodes; altitude is the visible through-line; and the Autopilot prompt reads and references it.
## Out of scope
No new sensor service, scheduler, or auto-remediation — documentation + a prompt instruction.
## Relations
Supersedes LIN-289.` } }
];

function buildMeta(task) {
  const ctx = { project: { name: 'Product' }, parent: null, siblings: [], children: [],
    comments: task.deepUpstream ? [{ user: 'agent', createdAt: '2026-06-02T00:00:00Z', body: task.deepUpstream }] : [] };
  const children = ctx.children, comments = ctx.comments;
  return buildMetaPromptTemplate({
    issueContext: formatIssueContext(task.issue, ctx),
    identifier: task.issue.identifier,
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
    hasComments: comments.length > 0, commentCount: comments.length,
    aiHints: formatAIHintsForMetaPrompt(),
    actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(),
    focusedSubtaskId: null, featureFlags: {}
  });
}

async function call(metaPrompt, model) {
  const t0 = Date.now();
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 8000, usage: { include: true },
          messages: [{ role: 'user', content: metaPrompt }] })
      });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      const ms = Date.now() - t0;
      const content = j.choices?.[0]?.message?.content;
      if (!content) { lastErr = (j.error?.message || JSON.stringify(j)).slice(0, 140); continue; }
      return { ms, content, cost: j.usage?.cost ?? null, outTok: j.usage?.completion_tokens ?? null };
    } catch (e) { lastErr = e.message.slice(0, 140); }
  }
  return { err: lastErr, ms: Date.now() - t0 };
}

const action = s => { const m = s.match(/→\s*\*\*(.+?)\*\*/); return m ? m[1].toLowerCase().trim() : '(none)'; };
const promptBody = s => { const i = s.indexOf('## Prompt'); return i >= 0 ? s.slice(i + 9).trim() : s.trim(); };
const wc = s => (s.trim().match(/\S+/g) || []).length;

mkdirSync(OUT, { recursive: true });
const short = m => m.split('/')[1].replace('claude-', '').replace('-preview', '');
console.log(`reference=${REFERENCE}  tasks=${TASKS.length}  models=${MODELS.length}  (K=1, temp 0)\n`);

const grid = {}; // grid[taskId][model] = {action, hit, words, ms, cost}
const totals = {}; MODELS.forEach(m => totals[m] = { ms: 0, cost: 0, hits: 0 });

for (const task of TASKS) {
  const meta = buildMeta(task);
  grid[task.id] = {};
  process.stdout.write(`\n[${task.complexity}] ${task.id}  expect={${task.expect.join('|')}}\n`);
  // Call all models in parallel so the slowest model sets per-task wall-clock, not the sum.
  const settled = await Promise.all(MODELS.map(async model => ({ model, res: await call(meta, model) })));
  for (const { model, res } of settled) {
    if (res.err) { grid[task.id][model] = { err: res.err }; console.log(`   ${short(model).padEnd(20)} ERR ${res.err}`); continue; }
    const act = action(res.content);
    const hit = task.expect.includes(act);
    const words = wc(promptBody(res.content));
    grid[task.id][model] = { action: act, hit, words, ms: res.ms, cost: res.cost };
    totals[model].ms += res.ms; totals[model].cost += res.cost || 0; totals[model].hits += hit ? 1 : 0;
    writeFileSync(join(OUT, `${task.id}__${short(model)}.md`),
      `# ${task.id} — ${model}\nexpect={${task.expect.join('|')}}  got=${act}  hit=${hit}  latency=${res.ms}ms  cost=$${res.cost}  body=${words}w\n\n---\n\n${res.content}\n`);
    console.log(`   ${short(model).padEnd(20)} ${(hit ? 'HIT ' : 'MISS')} ${act.padEnd(11)} ${String(words).padStart(4)}w  ${String(res.ms).padStart(6)}ms  $${(res.cost ?? 0).toFixed(4)}`);
  }
}

// routing-correctness grid (the cliff view): rows = complexity, cols = models
console.log('\n\n===== ROUTING GRID (✓=correct route, ✗=wrong) — the cliff view =====');
console.log('task'.padEnd(22) + MODELS.map(m => short(m).slice(0, 11).padEnd(12)).join(''));
for (const task of TASKS) {
  let line = `${task.complexity.padEnd(17)}`.slice(0, 17) + ' ' + task.id.slice(0, 4).padEnd(4);
  line = task.complexity.padEnd(18);
  for (const m of MODELS) {
    const c = grid[task.id][m];
    line += (c.err ? 'ERR' : (c.hit ? '✓ ' : '✗ ') + (c.action || '').slice(0, 9)).padEnd(12);
  }
  console.log(line);
}

console.log('\n===== per-model totals =====');
console.log('model'.padEnd(22) + 'route_hits'.padEnd(12) + 'total_$'.padEnd(12) + 'total_latency');
for (const m of MODELS) {
  const t = totals[m];
  console.log(short(m).padEnd(22) + `${t.hits}/${TASKS.length}`.padEnd(12) + `$${t.cost.toFixed(4)}`.padEnd(12) + `${(t.ms / 1000).toFixed(1)}s`);
}

writeFileSync(join(OUT, 'grid.json'), JSON.stringify({ reference: REFERENCE, ranAt: new Date().toISOString(), models: MODELS, grid, totals }, null, 2));
console.log(`\nOutputs + grid.json in ${OUT}/  (read the hard-task files for the quality cliff, not just routing)`);
