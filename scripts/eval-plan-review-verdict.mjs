#!/usr/bin/env node
/**
 * Seeded-plan eval for the `plan-review` VERDICT (LIN-1603 acceptance criterion 2).
 *
 * Sibling to scripts/eval-plan-review.mjs, which measures ROUTING — whether the
 * recommender reaches `plan-review` at all. This measures the thing the step exists
 * for: given a plan carrying KNOWN planted defects, does the handwritten template
 * actually catch them and say Request Changes?
 *
 *   "A seeded plan with a known missing sibling and a known unnamed relaxation
 *    receives Request Changes naming both."  — LIN-1603, Acceptance
 *
 * The seeded plan is realistic for THIS codebase (the four hand-rolled Markdown
 * typography subsets are real — see CLAUDE.md on `.desc-full-content` /
 * `.comment-body` / `.swipe-accordion-body` / `.task-edit-preview`), and both
 * defects are detectable from the plan's own text, which matters because this
 * harness makes a single tool-less call:
 *
 *   DEFECT 1 (check 1, completeness) — the plan's own background names three
 *     sibling renderers that share the pipeline it is changing, then omits them
 *     from the surface list and never marks them in- or out-of-scope with a named
 *     identifier. The template's rule: a missed sibling is Request Changes unless
 *     folded in or explicitly scoped out with an identifier.
 *   DEFECT 2 (check 5, relaxation guard) — the plan widens the DOMPurify attribute
 *     allowlist (a sanitiser guard) and never declares it as a relaxation nor names
 *     the adversarial follow-up that re-tightens or bounds it. The template's rule:
 *     an unnamed loosening is Request Changes.
 *
 * HONEST SCOPE — this is a LOWER bound, and a tighter one than the routing harness:
 * production runs plan-review as a dispatched agent WITH tools, so check 1's
 * "re-run the search yourself" is a real grep there and impossible here. Both
 * defects were therefore planted so the plan's own text is sufficient evidence
 * ("where the plan makes no such claim, that absence is itself the finding"). A
 * miss here is a genuine finding; a catch here is a floor, not a ceiling.
 *
 * Scoring is mechanical (verdict regex + per-defect keyword detection) AND every
 * run is printed VERBATIM, because a keyword hit is not proof the reviewer made the
 * right argument — the transcript is the evidence, the counters are the index.
 *
 * Usage:   OPENROUTER_API_KEY=... node scripts/eval-plan-review-verdict.mjs
 * Env knobs: GEN_MODEL, K (runs), QUIET (suppress the verbatim transcripts).
 */
import { generatePrompt } from '../lib/prompt-templates.js';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const GEN_MODEL = process.env.GEN_MODEL || 'anthropic/claude-haiku-4.5';
const K = Number(process.env.K) || 5;
const QUIET = process.env.QUIET === '1';
const TEMP = 0.7;

const SEEDED_ISSUE = {
  id: 'seeded-plan-uuid',
  identifier: 'LIN-9001',
  title: 'Render Markdown tables in the dashboard task description',
  url: 'https://linear.app/linearviewer/issue/LIN-9001',
  createdAt: '2026-07-24T00:00:00.000Z',
  labels: [],
  state: { name: 'In Progress', type: 'started' },
  description: `## Background

The dashboard renders issue descriptions through \`window.renderMarkdown\` (the vendored
marked + DOMPurify pair in \`public/common.js\`). Markdown typography for the rendered
body lives on \`.desc-full-content\` in \`public/style.css\`. The same \`renderMarkdown\`
pipeline also feeds the comment list (\`.comment-body\`), the Swipe accordion
(\`.swipe-accordion-body\`), and the task-edit preview pane (\`.task-edit-preview\`) —
each of which hand-rolls its own subset of element rules.

Users pasting Markdown tables into a description currently get an unstyled, borderless
grid that is hard to read.

## Implementation Plan

- Add \`table\`, \`thead\`, \`tbody\`, \`th\`, \`td\` rules to \`.desc-full-content\` in
  \`public/style.css\`: collapsed borders, a semantic-token border colour, cell padding,
  and a subtle header background. Semantic tokens only, so it stays dark-safe.
- Wrap the rendered table in an \`overflow-x: auto\` container so a wide table scrolls
  inside its own box rather than pushing the page sideways on mobile.
- Widen the DOMPurify configuration in \`public/common.js\` to keep the \`style\`
  attribute on \`td\` and \`th\`, so the column alignment marked emits
  (\`style="text-align:right"\`) survives sanitisation.
- Tests: a unit test asserting \`renderMarkdown\` preserves the alignment attribute, and
  a Playwright visual check of a table in a description.

## Surfaces

- \`.desc-full-content\` table typography in \`public/style.css\`
- the \`renderMarkdown\` DOMPurify configuration in \`public/common.js\`

No dependency arrows between them.

**Strategy framing:** single viable strategy, no framing trade-off.

**History signal:** \`git log --oneline -15 -- public/style.css public/common.js\` shows
routine churn; nothing protecting a table-related constraint.

**Session fit:** fits one focused session — the two surfaces are small and land together.

**plan-review due:** yes — (c) the plan changes the sanitiser configuration.`
};

const SEEDED_CONTEXT = {
  project: { name: 'Autopilot, Recommendation & Prompt Engine', description: null },
  parent: null,
  siblings: [],
  children: [],
  comments: []
};

// What each planted defect looks like when NAMED. Keyword detection is deliberately
// generous — it answers "did the reviewer raise this subject at all", and the
// verbatim transcript is what decides whether it raised it correctly.
const DEFECTS = [
  {
    key: 'missing-sibling',
    label: 'DEFECT 1 — sibling renderers omitted from the surface list (check 1, completeness)',
    re: /comment-body|swipe-accordion|task-edit-preview|sibling|parallel (code )?path|other (three )?renderer|hand-roll/i
  },
  {
    key: 'unnamed-relaxation',
    label: 'DEFECT 2 — undeclared DOMPurify allowlist relaxation (check 5, relaxation guard)',
    re: /(dompurify|sanitis|sanitiz|allowlist|allow-list|style attribute|xss)/i
  }
];

/** Read the verdict the template asks for: Approve / Request Changes / Needs Discussion. */
function readVerdict(text) {
  if (text.endsWith('__TRUNCATED__')) return '(truncated)';
  // Prefer an explicit verdict line; fall back to the last mention anywhere.
  const line = text.match(/\*\*Verdict[^\n]*/i)?.[0] || '';
  const scan = line || text;
  const last = [...scan.matchAll(/(request changes|needs discussion|approve)/gi)].pop();
  return last ? last[1].toLowerCase().replace(/\s+/g, ' ') : '(none)';
}

/** A relaxation finding only counts if the reviewer treats it AS a relaxation. */
function relaxationFramed(text) {
  return /(relax|loosen|widen|weaken|softe|drop)/i.test(text) &&
         /(dompurify|sanitis|sanitiz|allowlist|allow-list|style attribute|xss)/i.test(text);
}

async function call(prompt) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEN_MODEL, temperature: TEMP, max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const j = await r.json();
  if (!j.choices) return '__ERR__' + JSON.stringify(j).slice(0, 200);
  // A verdict cut off by the token cap is a HARNESS failure, not an abstention —
  // the first run of this eval mis-scored 4/5 that way. Surface it as its own state.
  const finish = j.choices[0].finish_reason;
  const text = j.choices[0].message.content;
  return finish === 'length' ? text + '\n\n__TRUNCATED__' : text;
}

// The REAL template, rendered exactly as production renders it — plus the ONE thing
// a tool-less call cannot do for itself. The rendered prompt deliberately carries no
// description: it tells the agent to "start by reading the plan in the description",
// which production's dispatched agent does through its tracker tools. Without that,
// the first run of this harness (correctly) refused to issue a verdict at all rather
// than judge a plan it could not see. So the fetch is performed FOR it and pasted in
// verbatim — the same move eval-review-closeout.mjs makes with its evidence block.
// Nothing is added beyond what `GET /issues/LIN-9001` would return, and nothing
// points at the planted defects.
const FETCHED = `

---

## Fetched: LIN-9001 (the read your tracker tools would perform)

**Title:** ${SEEDED_ISSUE.title}
**State:** ${SEEDED_ISSUE.state.name}
**Labels:** (none) · **Subtasks:** (none) · **Comments:** (none)

### Description

${SEEDED_ISSUE.description}

---

**Environment note:** this session has no shell and no repository access, so any check
that calls for running a command yourself cannot be run here. Judge each check against
the plan's own text and the read above, and say explicitly where a check could not be
independently re-run. Then issue the verdict the template asks for.`;

const { prompt: rendered } = generatePrompt('plan-review', SEEDED_ISSUE, SEEDED_CONTEXT);
const prompt = rendered + FETCHED;

console.log(`model=${GEN_MODEL}  K=${K}  temp=${TEMP}`);
console.log(`prompt: generatePrompt('plan-review', …) — ${rendered.length} chars, unmodified — plus a ${FETCHED.length}-char fetched-description block\n`);
console.log('Planted defects (both detectable from the plan text alone — this harness has no tools):');
for (const d of DEFECTS) console.log(`  ${d.label}`);
console.log('\nAcceptance criterion under test: "a seeded plan with a known missing sibling and a');
console.log('known unnamed relaxation receives Request Changes naming both".\n');

const runs = await Promise.all(Array.from({ length: K }, () => call(prompt)));

const rows = runs.map((out, i) => {
  const verdict = readVerdict(out);
  const hits = Object.fromEntries(DEFECTS.map(d => [d.key, d.re.test(out)]));
  const framed = relaxationFramed(out);
  if (!QUIET) {
    console.log(`\n${'='.repeat(78)}\nRUN ${i + 1} — verdict: ${verdict} | defect1 named: ${hits['missing-sibling']} | defect2 named: ${hits['unnamed-relaxation']} (framed as a relaxation: ${framed})\n${'='.repeat(78)}\n${out}\n`);
  }
  return { verdict, ...hits, framed };
});

const count = (fn) => rows.filter(fn).length;
console.log(`\n${'='.repeat(78)}\n========== aggregate ==========`);
console.log(`  verdict = Request Changes        : ${count(r => r.verdict === 'request changes')}/${K}`);
console.log(`  verdict = Needs Discussion       : ${count(r => r.verdict === 'needs discussion')}/${K}`);
console.log(`  verdict = Approve                : ${count(r => r.verdict === 'approve')}/${K}`);
console.log(`  verdict CUT OFF by the token cap : ${count(r => r.verdict === '(truncated)')}/${K}   (harness failure, not an abstention)`);
console.log(`  named DEFECT 1 (missing sibling) : ${count(r => r['missing-sibling'])}/${K}`);
console.log(`  named DEFECT 2 (relaxation)      : ${count(r => r['unnamed-relaxation'])}/${K}   [framed AS a relaxation: ${count(r => r.framed)}/${K}]`);
console.log(`  BOTH named + Request Changes     : ${count(r => r.verdict === 'request changes' && r['missing-sibling'] && r['unnamed-relaxation'])}/${K}   ← the acceptance criterion`);
console.log(`\nThe counters index the transcripts; the transcripts are the evidence. A keyword hit`);
console.log(`is not proof the reviewer made the right argument — read the runs before believing a rate.`);
