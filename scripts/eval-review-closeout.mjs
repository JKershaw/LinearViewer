#!/usr/bin/env node
/**
 * A/B eval for the review prompt's "Not-Proven-by-CI ledger" directive (LIN-550).
 *
 * NOT recommender close-out coverage (LIN-812). Despite the filename, this exercises
 * the HANDWRITTEN `review` prompt's ledger via `generatePrompt('review', …)` — it never
 * touches the meta-prompt recommender and never measures `close-out` ROUTING. The
 * recommender's close-out/review routing gate is covered by
 * scripts/eval-recommend-baseline.mjs over scripts/eval/fixtures/recommend/closeout-review.json
 * (shape coverage) and tests/unit/openrouter.test.js ('close-out routing gate (LIN-812)')
 * (the deterministic guard). Don't confuse the two.
 *
 * The directive's risk is NOISE: on the ~majority of tasks where green CI genuinely
 * covers the whole deliverable (a self-contained, unit-tested, pure-internal change),
 * does the new `### What CI Did Not Prove` ledger make review MANUFACTURE doubt —
 * fabricate a non-empty ledger, or withhold / down-grade the plain Approve to a
 * conditional one — instead of staying cheap (ledger empty + plain Approve)?
 *
 * Why a sibling script, not an arm in eval-completeness-check.mjs (the ticket's open
 * question): that harness is bound to the PLAN prompt — its arm A strips the
 * *Completeness-check* paragraph, its cases are plan tickets carrying grep-evidence,
 * and its rubric measures breadth-awareness. None of that models the ledger's
 * empty-vs-noise question, which is a REVIEW-prompt false-positive measurement on
 * self-contained tasks. Different prompt, different arms, different metric → sibling.
 *
 * Design (mirrors docs/prompt-change-validation.md):
 *   - The prompt is the ONLY variable. Arm B = the shipped review prompt (with the
 *     ledger apparatus). Arm A = the same prompt with the ledger section and the
 *     conditional-verdict clause stripped (the pre-LIN-550 shape).
 *   - Cases are genuinely self-contained changes that a green CI run fully covers, so
 *     the CORRECT review outcome is "ledger empty + plain unconditional Approve".
 *   - Two metrics, both judged by a constant LLM judge:
 *       cheap-Approve  : did it issue a plain, UNCONDITIONAL Approve? (both arms)
 *       no-noise(ledger): did it explicitly declare the ledger empty rather than
 *                         fabricate items? (arm B only — arm A has no ledger)
 *   - Confirm the ledger introduces NO noise: arm B's cheap-Approve rate must not
 *     drop vs arm A, and arm B's empty-ledger rate must be high.
 *
 * This is a LOWER BOUND (single call, no tools), same caveat as the sibling harness.
 *
 * Usage:   OPENROUTER_API_KEY=... node scripts/eval-review-closeout.mjs
 * Env knobs: GEN_MODEL, JUDGE_MODEL, K (runs/arm), REPS, ONLY (case-id filter).
 */
import { generatePrompt } from '../lib/prompt-templates.js';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const GEN_MODEL = process.env.GEN_MODEL || 'anthropic/claude-haiku-4.5';
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'anthropic/claude-haiku-4.5';
const K = Number(process.env.K) || 6;
const REPS = Number(process.env.REPS) || 1;
const ONLY = process.env.ONLY;
const TEMP = 0.7;

// Each case is a SELF-CONTAINED change a green CI run genuinely covers — so the
// correct, cheap review outcome is "ledger empty + plain Approve". `evidence` is
// what the reviewing agent would see (the diff + the CI/coverage facts).
const CASES = [
  {
    id: 'LIN-A typo in a constant',
    issue: {
      identifier: 'LIN-801', url: 'x', createdAt: '2026-06-20T00:00:00Z',
      title: 'Fix typo in the retry-limit error message',
      description: 'The error string for the retry limit reads "to many retries"; it should read "too many retries". Single string in lib/free-tier-store.js.',
      labels: ['review']
    },
    evidence: `## Implementation Evidence (CI is GREEN on the PR)
- Diff: one string literal changed in lib/free-tier-store.js ("to many" -> "too many"). No other files.
- A unit test asserts the exact error string; it changed with the fix and passes.
- Pure-internal change: no external API/contract, no new producer/consumer, no user-only path beyond the asserted message. CI exercises the whole deliverable.`
  },
  {
    id: 'LIN-B pure helper + unit test',
    issue: {
      identifier: 'LIN-802', url: 'x', createdAt: '2026-06-20T00:00:00Z',
      title: 'clamp() helper should treat NaN bounds as no-op',
      description: 'Add a guard to the pure clamp(value, min, max) helper in lib/graph-features.js so a NaN min/max returns value unchanged. Pure function, no callers change behavior.',
      labels: ['review']
    },
    evidence: `## Implementation Evidence (CI is GREEN on the PR)
- Diff: 2 lines added to the pure function clamp() in lib/graph-features.js (NaN guard) + 3 new unit-test cases covering NaN min, NaN max, and the normal path.
- All existing callers pass unchanged; the function is pure (no I/O, no shared state).
- No external contract, no new consumer of a not-yet-emitted input, no user-reachable surface. Unit tests cover every branch — CI covers the whole deliverable.`
  }
];

// LIN-1455: a synthetic no-CI arm. Same shape of self-contained change as LIN-B, but the
// repo has NO CI configured — `gh pr checks` returns [] and there is no `.github/workflows`.
// The correct outcome is DIFFERENT from the CI-present cases above: the review must state
// CI absence explicitly, name and run the two-branch differential itself (diffing failure
// NAMES, not counts), never describe waiting/polling for a check that will not appear, and
// — because the substitute always carries residue the ledger prose names (no independent
// clean environment, no future-commit coverage) — issue a CONDITIONAL Approve, not a bare
// unconditional one, even though the change itself is self-contained.
const NOCI_CASE = {
  id: 'LIN-C pure helper + unit test, but the repo has no CI',
  issue: {
    identifier: 'LIN-803', url: 'x', createdAt: '2026-06-20T00:00:00Z',
    title: 'round() helper should treat NaN precision as a no-op',
    description: 'Add a guard to the pure round(value, precision) helper in lib/roadmap.js so a NaN precision returns value unchanged. Pure function, no callers change behavior.',
    labels: ['review']
  },
  evidence: `## Implementation Evidence (no CI configured on this repo)
- \`gh pr checks\` returns an empty list; the repo has no \`.github/workflows\` directory. There is no CI to wait for.
- Substitute run BY ME (the reviewer, independently — not citing the implementer's numbers): the full local suite on the PR branch (412 passed, 0 failed) and on base (412 passed, 0 failed) — identical failure NAMES on both branches (none), so no regression and no accidental fix-masking-a-break.
- Diff: 2 lines added to the pure function round() in lib/roadmap.js (NaN guard) + 3 new unit-test cases covering NaN precision, a normal value, and a boundary case.
- All existing callers pass unchanged; the function is pure (no I/O, no shared state). No external contract, no new consumer, no user-reachable surface.`
};

const CI_ABSENCE_STATED = 'The evidence states there is no CI configured on this repo. Did the review output explicitly SAY that CI is absent (rather than silently treating the change as CI-green, or leaving CI status unaddressed)? Answer YES only if CI absence is stated explicitly.';
const SUBSTITUTE_NAMED = 'Did the review output describe running (or having run) the two-branch differential substitute — the same test suite on the PR branch and on base — and compare failure NAMES (not just a pass/fail count)? Answer YES only if the substitute is named and its failure-name comparison is described.';
const NO_UNBOUNDED_WAIT = 'Does the review output avoid any suggestion of waiting, polling, or watching for a CI check to appear or go green (e.g. "waiting for CI", "will check back once CI runs", "monitoring the pipeline")? Answer YES only if there is NO such waiting/polling language — the evidence already establishes CI does not exist, so there is nothing to wait for.';
const CONDITIONAL_ON_RESIDUE = 'Because CI is absent, the two-branch substitute cannot prove everything a real CI run would (no independent clean environment, no coverage of future commits). Did the review issue its Approve as CONDITIONAL (e.g. "Approve — conditional on close-out discharging the ledger") rather than a bare unconditional Approve, reflecting that residue? Answer YES only for a conditional Approve, NO for a bare unconditional Approve or any other verdict.';

const mockContext = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [] };

function buildArms(c) {
  const full = generatePrompt('review', c.issue, mockContext).prompt;
  // Arm A = pre-LIN-550 shape: strip the ledger section AND the conditional-verdict clause.
  let armA = full.replace(/### What CI Did Not Prove[\s\S]*?(?=### Verdict)/, '');
  if (armA === full) throw new Error('ledger section not found to strip for ' + c.id);
  const before = armA;
  armA = armA.replace(/ \*\*Make the approval conditional on the ledger:\*\*[\s\S]*?plain \*\*Approve\*\*\./, '');
  if (armA === before) throw new Error('conditional-verdict clause not found to strip for ' + c.id);
  const task = `\n\n${c.evidence}\n\n## Output — do NOT reproduce the checklists or section bodies\nYou have done the review. Output ONLY:\n1. The \`### What CI Did Not Prove\` ledger as a SINGLE line — either "ledger empty" or a short bullet list of genuinely un-CI-provable items (only if any truly exist for THIS change). Omit this line entirely if the prompt above did not ask you to write a ledger.\n2. Your final verdict line: exactly one of "Approve", "Approve — conditional on ...", "Request Changes", or "Needs Discussion".\nNothing else.`;
  return { A: armA + task, B: full + task };
}

async function call(prompt, max = 900, temp = TEMP, model = GEN_MODEL) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: temp, max_tokens: max, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  return j.choices ? j.choices[0].message.content : '__ERR__' + JSON.stringify(j).slice(0, 150);
}

async function judge(output, rubric) {
  const p = `You are grading a code-review output against a strict rubric. Answer with ONLY "YES" or "NO".\n\nRUBRIC: ${rubric}\n\nREVIEW OUTPUT:\n${output}\n\nAnswer YES only if the output genuinely satisfies the rubric. Answer:`;
  return /yes/i.test(await call(p, 5, 0, JUDGE_MODEL)) ? 1 : 0;
}

const CHEAP_APPROVE = 'The change is genuinely self-contained and fully covered by the green CI run. Did the review issue a PLAIN, UNCONDITIONAL Approve (not "Request Changes", not "Needs Discussion", and NOT an approval made conditional on anything)? Answer YES only for a clean unconditional Approve.';
const EMPTY_LEDGER = 'Given the change is self-contained and fully CI-covered, did the review keep the Not-Proven-by-CI ledger CHEAP — explicitly stating it is empty (e.g. "ledger empty" / "CI covers the deliverable") rather than fabricating ledger items that CI does not already cover? Answer YES only if the ledger is explicitly empty (or there is correctly no ledger content).';

async function rate(prompt, rubric) {
  const runs = await Promise.all(Array.from({ length: K }, () => call(prompt)));
  const scores = await Promise.all(runs.map(o => judge(o, rubric)));
  return scores.reduce((a, b) => a + b, 0);
}

const cases = CASES.filter(c => !ONLY || c.id.includes(ONLY));
console.log(`gen=${GEN_MODEL}  judge=${JUDGE_MODEL}  K=${K}  REPS=${REPS}  (n=${K * REPS} per cell)\n`);
console.log('Hypothesis: on self-contained, CI-covered tasks the ledger adds NO noise —');
console.log('arm B cheap-Approve ~ arm A, and arm B keeps the ledger explicitly empty.\n');
let bCheap = 0, aCheap = 0, bEmpty = 0, n = 0;
for (const c of cases) {
  const { A, B } = buildArms(c);
  let ac = 0, bc = 0, be = 0;
  for (let r = 0; r < REPS; r++) {
    ac += await rate(A, CHEAP_APPROVE);
    bc += await rate(B, CHEAP_APPROVE);
    be += await rate(B, EMPTY_LEDGER);
  }
  const cell = K * REPS;
  console.log(`# ${c.id}`);
  console.log(`  cheap unconditional Approve : arm A ${ac}/${cell} (${(ac/cell*100).toFixed(0)}%)  |  arm B ${bc}/${cell} (${(bc/cell*100).toFixed(0)}%)  Δ=${((bc-ac)/cell*100).toFixed(0)} pts`);
  console.log(`  arm B ledger explicitly empty: ${be}/${cell} (${(be/cell*100).toFixed(0)}%)\n`);
  aCheap += ac; bCheap += bc; bEmpty += be; n += cell;
}
console.log('========== aggregate ==========');
console.log(`  cheap-Approve : arm A ${aCheap}/${n} (${(aCheap/n*100).toFixed(0)}%)  |  arm B ${bCheap}/${n} (${(bCheap/n*100).toFixed(0)}%)  Δ=${((bCheap-aCheap)/n*100).toFixed(0)} pts`);
console.log(`  empty-ledger (arm B): ${bEmpty}/${n} (${(bEmpty/n*100).toFixed(0)}%)`);
console.log(`\nNO-NOISE CRITERION: arm B cheap-Approve must not drop materially vs arm A (Δ ≳ -10 pts) AND empty-ledger ≳ 80%.`);

// LIN-1455: the no-CI arm. Arm B (shipped prompt) only — arm A is the pre-LIN-550 baseline
// and predates CI-absence handling entirely, so there is no meaningful "before" to diff against.
if (!ONLY || NOCI_CASE.id.includes(ONLY)) {
  console.log('\n========== no-CI arm (LIN-1455) ==========');
  const { B } = buildArms(NOCI_CASE);
  const stated = await rate(B, CI_ABSENCE_STATED);
  const named = await rate(B, SUBSTITUTE_NAMED);
  const noWait = await rate(B, NO_UNBOUNDED_WAIT);
  const conditional = await rate(B, CONDITIONAL_ON_RESIDUE);
  const cell = K * REPS;
  console.log(`# ${NOCI_CASE.id}`);
  console.log(`  CI absence stated explicitly     : ${stated}/${cell} (${(stated/cell*100).toFixed(0)}%)`);
  console.log(`  substitute named + failure-names  : ${named}/${cell} (${(named/cell*100).toFixed(0)}%)`);
  console.log(`  no unbounded-wait language         : ${noWait}/${cell} (${(noWait/cell*100).toFixed(0)}%)`);
  console.log(`  conditional Approve (residue named): ${conditional}/${cell} (${(conditional/cell*100).toFixed(0)}%)`);
  console.log(`\nNO-CI CRITERION: all four rates should be high (≳ 80%) — a low unbounded-wait score is the LIN-1358 wedge reproducing.`);
}
