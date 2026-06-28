#!/usr/bin/env node
/**
 * A/B eval for the review prompt's "What CI Did Not Prove" ledger directive (LIN-550).
 *
 * Sibling to scripts/eval-completeness-check.mjs (NOT a reuse): that harness is
 * plan-only — its arm-strip regex, its surface-list output instruction, and its
 * cases are all plan-specific. The ledger directive lives in the `review` template
 * and is measured differently (does review refuse a bare Approve when the
 * deliverable rests on a claim CI cannot prove?), so it gets its own single-purpose
 * eval rather than threading conditionals through the plan harness.
 *
 * Measures whether the directive raises *verification-depth awareness*: given a
 * change that is internally correct and CI-green, but whose correctness rests on
 * something the green run does NOT exercise (an external contract, a producer that
 * must emit an input the change now consumes, a user-reachable entry path), does the
 * generated review enumerate that claim as a Not-Proven-by-CI ledger item and issue
 * a CONDITIONAL approval — instead of collapsing to a bare Approve on "CI is green"?
 * (This is exactly the LIN-735 collapse the split exists to prevent.)
 *
 * Design (see docs/prompt-change-validation.md for the methodology):
 *   - The prompt is the ONLY variable. Arm B = the live review prompt; arm A = the
 *     same prompt with the `### What CI Did Not Prove` ledger section stripped out.
 *   - The output instruction is NEUTRAL and identical across both arms (just "review
 *     and conclude with a verdict") so only the directive's presence differs.
 *   - Evidence is a change that is green-on-CI but load-bearing on an unexercised
 *     claim, so a bare Approve is the wrong answer and the ledger is the right one.
 *   - A constant LLM judge (held on one model regardless of the generator under
 *     test) grades each output YES/NO against a strict rubric.
 *
 * This is a LOWER BOUND: a single call can't use tools. Real agents (Claude Code)
 * can inspect the PR + CI, so live behavior should beat these numbers.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval-ledger-check.mjs
 *
 * Env knobs:
 *   GEN_MODEL    generator under test       (default anthropic/claude-haiku-4.5)
 *   JUDGE_MODEL  judge, held constant        (default anthropic/claude-haiku-4.5)
 *   K            runs per arm per replication (default 10)
 *   REPS         replications, aggregated     (default 1)
 *   ONLY         substring filter on case id  (e.g. ONLY=LIN-728)
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

// Each case: a task ready for review whose change is CI-green but load-bearing on a
// claim the green run does not exercise. The judge's ground truth is the unproven
// claim that belongs in the ledger.
const CASES = [
  {
    id: 'LIN-728 external contract (consumer of an unproven producer)',
    issue: {
      identifier: 'LIN-728', url: 'x', createdAt: '2026-06-10T00:00:00Z',
      title: 'Handle the installations/new redirect after GitHub App install',
      description: 'After a user installs the GitHub App, GitHub redirects to /installations/new with an installation_id. Add a route that consumes installation_id and links it to the workspace.',
      labels: ['review']
    },
    evidence: `\`\`\`
PR #911 — "LIN-728: consume installation_id on /installations/new"
+ routes/github-install.js   (new route reads req.query.installation_id, links workspace)
+ tests/unit/github-install.test.js  (unit test posts installation_id=123, asserts link row written)

CI: ✅ green (unit + e2e). The e2e seeds installation_id=123 directly into the request.
\`\`\`
Note: nothing in this repo or its tests exercises GitHub actually redirecting to
/installations/new with a real installation_id — the producer of that input is GitHub's
install flow, which CI cannot drive. The unit/e2e tests synthesize the input themselves.`,
    judgeRubric: 'Does the review output enumerate, as a thing CI did NOT prove (a "Not-Proven-by-CI" / "What CI Did Not Prove" ledger item, or an explicitly CONDITIONAL approval), that GitHub actually redirects to /installations/new with a real installation_id in the shape the new route consumes — rather than issuing a bare/unconditional Approve because CI is green? (Ground truth: the green run only exercises a self-synthesized input; the real producer is GitHub\'s install redirect, which CI cannot drive, so this is a load-bearing claim CI did not prove.) Answer YES only if it flags the unexercised external/producer claim or makes the approval conditional on discharging it.'
  },
  {
    id: 'LIN-717 user-reachable entry path (parallel surface)',
    issue: {
      identifier: 'LIN-717', url: 'x', createdAt: '2026-06-08T00:00:00Z',
      title: 'Fix workspace not appearing in the switcher after add',
      description: 'When a user adds a workspace, it should appear in the switcher immediately. Fix the add path so the new workspace is pushed into session.workspaces.',
      labels: ['review']
    },
    evidence: `\`\`\`
PR #905 — "LIN-717: push added workspace into session.workspaces"
+ routes/workspace.js  (the /workspace/add handler now appends to session.workspaces)
+ tests/unit/workspace-add.test.js  (asserts the add handler appends)

CI: ✅ green. The test calls the add handler directly and checks the array.
\`\`\`
Note: the same "workspace list" is also built on the OAuth-callback path
(routes/auth.js) and rendered by the navbar from a separate read; neither is touched
or tested here. The fix is verified only on the one handler the test calls directly.`,
    judgeRubric: 'Does the review output flag, as something CI did NOT prove (a ledger item or a conditional approval), that the fix is verified only on the single add-handler path the test calls directly and that the user-reachable result (the workspace actually showing in the switcher, including via the OAuth-callback path / navbar read) is not exercised end-to-end — rather than a bare Approve on green CI? Answer YES only if it names the unexercised user-reachable / parallel-surface claim or makes approval conditional on it.'
  }
];

const mockContext = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [] };

// Arm A is the pre-LIN-550 review: every surface of the ledger directive removed so
// only its presence varies. Like the plan harness, the strips pin the live wording;
// the leak guard in buildArms() fails loudly if the template drifts out from under them.
function stripLedgerDirective(s) {
  return s
    // (1) the `### What CI Did Not Prove` section, up to the next "### " heading
    .replace(/### What CI Did Not Prove\n[\s\S]*?(?=\n### )/, '')
    // (2) the conditional-on-the-ledger verdict paragraph
    .replace(/\n\*\*The verdict is conditional on the ledger\.\*\*[^\n]*/, '')
    // (3) the Close-Out Gate hand-off's "carry the ledger" clause → plain hand-off
    .replace(/, carrying the ledger in your summary comment\. Close-out re-checks CI on a fresh read of the exact commit, discharges every ledger item, then merges and closes\./, '.')
    // (4) the Completion line's ledger clause
    .replace(/, the \*\*What CI Did Not Prove\*\* ledger \(its items, or the explicit `CI covers the deliverable; ledger empty\.` line\)/, '')
    .replace(/\n{3,}/g, '\n\n');
}

function buildArms(c) {
  const full = generatePrompt('review', c.issue, mockContext).prompt;
  const armA = stripLedgerDirective(full);
  if (armA === full) throw new Error('Ledger directive not found to strip for ' + c.id);
  if (/What CI Did Not Prove|conditional on the ledger|carrying the ledger/.test(armA)) {
    throw new Error('Arm A still leaks the ledger directive for ' + c.id + ' (template wording drifted — update stripLedgerDirective)');
  }
  const task = `\n\n## PR + CI Evidence (you cannot run tools now — this is what is known so far)\n${c.evidence}\n\n## Output\nReview this change and conclude with your verdict (Approve / Request Changes / Needs Discussion) plus any caveats. Be concise.`;
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
  const p = `You are grading a code-review output against a strict rubric. Answer with ONLY "YES" or "NO".\n\nRUBRIC: ${rubric}\n\nREVIEW OUTPUT:\n${output}\n\nAnswer YES only if the output genuinely does what the rubric describes. Answer:`;
  return /yes/i.test(await call(p, 5, 0, JUDGE_MODEL)) ? 1 : 0;
}

async function rate(prompt, rubric) {
  const runs = await Promise.all(Array.from({ length: K }, () => call(prompt)));
  const scores = await Promise.all(runs.map(o => judge(o, rubric)));
  return scores.reduce((a, b) => a + b, 0);
}

const cases = CASES.filter(c => !ONLY || c.id.includes(ONLY));
console.log(`gen=${GEN_MODEL}  judge=${JUDGE_MODEL}  K=${K}  REPS=${REPS}  (n=${K * REPS} per cell)\n`);
console.log('========== ledger-awareness rate (flagged a Not-Proven-by-CI claim / conditional approval) ==========');
let aTot = 0, bTot = 0, nTot = 0;
for (const c of cases) {
  const { A, B } = buildArms(c);
  let aHits = 0, bHits = 0;
  for (let r = 0; r < REPS; r++) { aHits += await rate(A, c.judgeRubric); bHits += await rate(B, c.judgeRubric); }
  const n = K * REPS;
  aTot += aHits; bTot += bHits; nTot += n;
  console.log(`\n# ${c.id}`);
  console.log(`  arm A (no ledger): ${aHits}/${n}  (${(aHits / n * 100).toFixed(0)}%)`);
  console.log(`  arm B (+ledger):   ${bHits}/${n}  (${(bHits / n * 100).toFixed(0)}%)`);
  console.log(`  Δ = ${((bHits - aHits) / n * 100).toFixed(0)} pts`);
}
console.log(`\n========== aggregate ==========`);
console.log(`  arm A: ${aTot}/${nTot}  (${(aTot / nTot * 100).toFixed(0)}%)`);
console.log(`  arm B: ${bTot}/${nTot}  (${(bTot / nTot * 100).toFixed(0)}%)`);
console.log(`  Δ = ${((bTot - aTot) / nTot * 100).toFixed(0)} pts  (positive ⇒ the ledger directive raises Not-Proven-by-CI awareness)`);
