#!/usr/bin/env node
/**
 * A/B eval for the plan prompt's "Completeness check" directive.
 *
 * Measures whether the directive raises *breadth-awareness*: given only what a
 * ticket author would have seen (a clean grep of the CITED symbol = one hit,
 * plus a camouflaged file tree with no contents), does the generated plan flag
 * that the same concept may live elsewhere and instruct a concept-level search —
 * instead of trusting the single grep hit as the whole surface set?
 *
 * Design (see docs/prompt-change-validation.md for the methodology):
 *   - The prompt is the ONLY variable. Arm B = the live plan prompt; arm A = the
 *     same prompt with the Completeness-check paragraph stripped out.
 *   - Evidence is deliberately NOT pre-solved. An earlier version handed the model
 *     the snippets from every surface and both arms scored 100% (ceiling effect) —
 *     a directive that says "go search" can only be measured when the answer isn't
 *     already in context. So we withhold the divergent-name surfaces and test the
 *     decision-to-search, which is the directive's actual mechanism.
 *   - A constant LLM judge (held on one model regardless of the generator under
 *     test) grades each output YES/NO against a strict rubric.
 *
 * This is a LOWER BOUND: a single call can't use tools, so it cannot capture the
 * directive's nudge to actually run the grep — only the decision to. Real agents
 * (Claude Code) can grep, so live behavior should beat these numbers.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval-completeness-check.mjs
 *
 * Env knobs:
 *   GEN_MODEL    generator under test       (default anthropic/claude-haiku-4.5)
 *   JUDGE_MODEL  judge, held constant        (default anthropic/claude-haiku-4.5)
 *   K            runs per arm per replication (default 10)
 *   REPS         replications, aggregated     (default 1)
 *   ONLY         substring filter on case id  (e.g. ONLY=LIN-295)
 */
import { generatePrompt } from '../lib/prompt-templates.js';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const GEN_MODEL = process.env.GEN_MODEL || 'anthropic/claude-haiku-4.5';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'anthropic/claude-haiku-4.5';
const K = Number(process.env.K) || 10;
const REPS = Number(process.env.REPS) || 1;
const ONLY = process.env.ONLY;
const TEMP = 0.7;

// Each case: a ticket that names ONE surface, the evidence an author would see
// (cited-symbol grep -> one hit + a file tree with no contents), and a judge
// rubric whose ground truth is the divergent-name surfaces the ticket omits.
const CASES = [
  {
    id: 'LIN-295 dispatch row',
    issue: {
      identifier: 'LIN-295', url: 'x', createdAt: '2026-05-29T06:54:39Z',
      title: 'Dispatch in the UI should be one button which then expands to show options',
      description: 'The dispatch options are listed in a row and it gets cluttered. On the dispatch page the row is the `.dispatch-prompt-send` buttons (cli/web/dash) in lib/render-dispatch.js. Collapse them behind a single Dispatch toggle.',
      labels: ['plan']
    },
    evidence: `\`\`\`
$ grep -rln ".dispatch-prompt-send" lib/ public/
lib/render-dispatch.js
\`\`\`

$ ls lib/ public/
lib/render.js  lib/render-dispatch.js  lib/render-swim.js  lib/render-ship.js
lib/render-pages.js  lib/render-pipeline.js  lib/tree.js  lib/linear.js
public/app.js  public/dispatch.js  public/prompt-section.js  public/swipe.js  public/pipeline.js

--- lib/render-dispatch.js (the only file the grep matched) ---
<div class="line dispatch-prompt-actions">
  <button class="action-btn save dispatch-prompt-send" data-target="cli">cli</button>
  <button class="action-btn save dispatch-prompt-send" data-target="web">web</button>
  <button class="action-btn save dispatch-prompt-send" data-target="dash">dash</button>
</div>`,
    judgeRubric: 'Does the surface list flag that the dispatch button row might exist in OTHER files/views beyond lib/render-dispatch.js, OR instruct searching for the dispatch-button concept (e.g. by behavior, by the "Dispatch:" label, by data-target, across render files) rather than trusting that the single grep hit is the only surface? (Ground truth: the same row also lives in lib/render.js and public/prompt-section.js under different class names.)'
  },
  {
    id: 'LIN-401 implement-prompt rule (both-paths)',
    issue: {
      identifier: 'LIN-401', url: 'x', createdAt: '2026-06-01T00:00:00Z',
      title: 'Add a "verify the response schema against existing endpoints" instruction to the implementation prompt',
      description: 'The implementation prompt should tell the agent to verify response schema. The implement template lives in lib/prompt-template-defs.js (the generate() for the "implement" template).',
      labels: ['plan']
    },
    evidence: `\`\`\`
$ grep -rln "'implement'" lib/prompt-template-defs.js
lib/prompt-template-defs.js
\`\`\`

$ ls lib/ lib/prompts/
lib/prompt-templates.js  lib/prompt-template-defs.js  lib/prompt-formatters.js
lib/openrouter.js  lib/audit.js  lib/prompts/meta-prompt-template.js  lib/prompts/foreman-playbook.js

--- lib/prompt-template-defs.js ('implement' template, named in the ticket) ---
'implement': {
  name: 'implement',
  generate: (issue, context) => {
    const sections = [ formatHeader('Implement', issue), '## Implementation Guidelines', ... ];
    return sections.join('\\n');
  }
}`,
    judgeRubric: 'Does the surface list flag that implementation-prompt behavior might be defined in a SECOND place beyond lib/prompt-template-defs.js, OR instruct checking for a parallel prompt-generation path? (Ground truth: an AI-generated prompt path in lib/prompts/meta-prompt-template.js also controls implementation-prompt content and must be updated too.)'
  }
];

const mockContext = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [] };

function buildArms(c) {
  const full = generatePrompt('plan', c.issue, mockContext).prompt;
  const armA = full.replace(/\n*\*\*Completeness check\.\*\*[^\n]*\n/, '\n');
  if (armA === full) throw new Error('Completeness paragraph not found to strip for ' + c.id);
  const task = `\n\n## Codebase Evidence (you cannot run tools now — this is what is known so far)\n${c.evidence}\n\n## Output\nDo the "List the surfaces your plan touches" step ONLY. Output the surface list (and, per the plan instructions, any checks needed before the surface list can be trusted). Be concise.`;
  return { A: armA + task, B: full + task };
}

async function call(prompt, max = 700, temp = TEMP, model = GEN_MODEL) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: temp, max_tokens: max, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  return j.choices ? j.choices[0].message.content : '__ERR__' + JSON.stringify(j).slice(0, 150);
}

async function judge(output, rubric) {
  const p = `You are grading a planning output against a strict rubric. Answer with ONLY "YES" or "NO".\n\nRUBRIC: ${rubric}\n\nPLANNING OUTPUT:\n${output}\n\nAnswer YES only if the output genuinely does what the rubric describes. Answer:`;
  return /yes/i.test(await call(p, 5, 0, JUDGE_MODEL)) ? 1 : 0;
}

async function rate(prompt, rubric) {
  const runs = await Promise.all(Array.from({ length: K }, () => call(prompt)));
  const scores = await Promise.all(runs.map(o => judge(o, rubric)));
  return scores.reduce((a, b) => a + b, 0);
}

const cases = CASES.filter(c => !ONLY || c.id.includes(ONLY));
console.log(`gen=${GEN_MODEL}  judge=${JUDGE_MODEL}  K=${K}  REPS=${REPS}  (n=${K * REPS} per cell)\n`);
console.log('========== breadth-awareness rate (flagged completeness risk / concept search) ==========');
for (const c of cases) {
  const { A, B } = buildArms(c);
  let aHits = 0, bHits = 0;
  for (let r = 0; r < REPS; r++) { aHits += await rate(A, c.judgeRubric); bHits += await rate(B, c.judgeRubric); }
  const n = K * REPS;
  console.log(`\n# ${c.id}`);
  console.log(`  arm A (no check): ${aHits}/${n}  (${(aHits / n * 100).toFixed(0)}%)`);
  console.log(`  arm B (+check):   ${bHits}/${n}  (${(bHits / n * 100).toFixed(0)}%)`);
  console.log(`  Δ = ${((bHits - aHits) / n * 100).toFixed(0)} pts`);
}
