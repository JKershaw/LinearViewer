#!/usr/bin/env node
/**
 * LIN-263 manual research spike — NOT a harness.
 *
 * One task, one Opus reference run + a handful of cheaper models. Captures the two
 * things you can't eyeball (wall-clock latency + OpenRouter-reported cost) and dumps
 * each model's generated prompt to a file so a human can compare quality by reading.
 * No LLM judge, no rubric, no JSON schema — that's the point of a spike.
 *
 *   OPENROUTER_API_KEY=... node scripts/eval/lin-263-spike.mjs
 *
 * Reuses the LIVE meta-prompt (rebuilt from lib exports, same as eval-prompt-scaling.mjs).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { formatIssueContext } from '../../lib/openrouter.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'lin-263-spike-out');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }

const REFERENCE = 'anthropic/claude-opus-4.7';
const MODELS = [
  'anthropic/claude-opus-4.7',     // reference — "we know Opus works"
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5',
  'google/gemini-3-flash-preview',
  'openai/gpt-5.4-mini',
  'deepseek/deepseek-v3.2'
];

// --- the task: LIN-325, the routing-eval "research" gold case (verbatim) -----
const issue = {
  identifier: 'LIN-325', createdAt: '2026-06-07T08:41:20.522Z',
  state: { name: 'In Progress', type: 'started' }, labels: [],
  title: 'Write the autopilot operating manual',
  description: `## What

Write the **autopilot operating manual** — a field guide the autopilot reads on kickoff and references when a situation calls for it — and wire the Autopilot prompt to consult it.

\`docs/autopilot-operating-manual.md\` (or similar) + an instruction in the Autopilot kickoff/orchestrator prompt (\`lib/prompts/autopilot-kickoff.js\` / \`buildAutopilotKickoff()\`) to read it on kickoff and reference the relevant part when a trigger appears. Reference, don't inline — keep the light-orchestrator invariant.

## Why

This is the **autopilot-native, cheaper realisation of the superseded drift-defense epic LIN-289**: the supervisor and evidence-discipline become guide-text read by an agent already positioned to flag, rather than bespoke coded subsystems. Most detection already exists in the per-prompt sensors and the proxy API; the manual is the **judgment layer that ties them together**.

## The specifics that matter (and why)

These are the decisions research won't independently rediscover — hold them; fill in everything else from the track record.

* **Write it human-shaped: intro → how a run normally goes → known issues to watch for.** An onboarding doc, not a flat rulebook.
* **Ground it on altitude.** The autopilot is high; the generated prompts do the heavy lifting low; the loop self-corrects across passes.
* **Tolerant operating stance.** Don't halt at the first sign of trouble.
* **Descriptive, never normative.**

## Method (high level)

Seed from the design conversation (above) → **research our own track record concretely** — the named failure episodes, not abstractions (\`docs/autopilot-experiment.md\` runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the \`retro\` lens over a real churn cluster for a worked example per known-issue) → write it → wire the prompt to it.

## Done when

The manual exists and is human-shaped, with the Drift entry complete and the rest at least drafted from named episodes; altitude is the visible through-line; and the Autopilot prompt reads and references it.

## Out of scope

No new sensor service, scheduler, or auto-remediation — this is documentation + a prompt instruction.

## Relations

Supersedes LIN-289.`
};

// Faithful live meta-prompt (leaf task, featureFlags:{}) — exactly what the proxy sends.
const ctx = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [] };
const metaPrompt = buildMetaPromptTemplate({
  issueContext: formatIssueContext(issue, ctx),
  identifier: issue.identifier,
  hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
  hasComments: false, commentCount: 0,
  aiHints: formatAIHintsForMetaPrompt(),
  actionVocabulary: getAIRecommendationActionNames().join(', '),
  completionSignals: formatAllSignalsForMetaPrompt(),
  focusedSubtaskId: null, featureFlags: {}
});

async function run(model) {
  const t0 = Date.now();
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, temperature: 0, max_tokens: 8000,
          messages: [{ role: 'user', content: metaPrompt }],
          usage: { include: true } // ask OpenRouter to report cost in the response
        })
      });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      const ms = Date.now() - t0;
      const content = j.choices?.[0]?.message?.content;
      if (!content) { lastErr = (j.error?.message || JSON.stringify(j)).slice(0, 160); continue; }
      const u = j.usage || {};
      return {
        model, ms, content,
        promptTokens: u.prompt_tokens ?? null,
        completionTokens: u.completion_tokens ?? null,
        cost: u.cost ?? null,
        finish: j.choices?.[0]?.finish_reason ?? null
      };
    } catch (e) { lastErr = e.message.slice(0, 160); }
  }
  return { model, ms: Date.now() - t0, err: lastErr };
}

// Pull the `## Prompt` body (the deliverable) for at-a-glance length.
const promptBody = s => { const i = s?.indexOf('## Prompt'); return i >= 0 ? s.slice(i + 9).trim() : (s || '').trim(); };
const wc = s => (s.trim().match(/\S+/g) || []).length;

mkdirSync(OUT, { recursive: true });
console.log(`task=${issue.identifier} (research gold case)  reference=${REFERENCE}  models=${MODELS.length}  meta-prompt≈${wc(metaPrompt)} words\n`);

const results = [];
for (const m of MODELS) {
  process.stdout.write(`→ ${m} ... `);
  const res = await run(m);
  results.push(res);
  if (res.err) { console.log(`ERR ${res.err}`); continue; }
  const body = promptBody(res.content);
  const slug = m.replace(/[^a-z0-9]+/gi, '_');
  writeFileSync(join(OUT, `${slug}.md`), `# ${m}\n\nlatency=${res.ms}ms  cost=${res.cost}  prompt_tok=${res.promptTokens}  completion_tok=${res.completionTokens}  finish=${res.finish}\n\n---\n\n${res.content}\n`);
  console.log(`${res.ms}ms  cost=$${res.cost ?? '?'}  out=${res.completionTokens}tok  body=${wc(body)}w`);
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ task: issue.identifier, reference: REFERENCE, ranAt: new Date().toISOString(), results: results.map(({ content, ...r }) => r) }, null, 2));

console.log('\n== summary (speed + cost; quality = read the files in lin-263-spike-out/) ==');
console.log('model'.padEnd(34) + 'latency'.padEnd(10) + 'cost'.padEnd(12) + 'out_tok'.padEnd(9) + 'body_words');
for (const r of results) {
  if (r.err) { console.log(r.model.padEnd(34) + 'ERR ' + r.err); continue; }
  console.log(r.model.padEnd(34) + `${r.ms}ms`.padEnd(10) + `$${r.cost ?? '?'}`.padEnd(12) + String(r.completionTokens).padEnd(9) + wc(promptBody(r.content)));
}
console.log(`\nOutputs + per-model metadata written to ${OUT}/`);
