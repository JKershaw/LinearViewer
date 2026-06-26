#!/usr/bin/env node
/**
 * A/B eval for the RESEARCH prompt's "Horizontal Obligations" directive (LIN-697).
 *
 * The completeness-check harness (scripts/eval-completeness-check.mjs) is hard-wired
 * to the PLAN template's `**Completeness check.**` paragraph and CANNOT measure this
 * research-template directive — hence this fork. Same methodology (docs/prompt-change-
 * validation.md §5), different directive and different gold case.
 *
 * What the directive does: it makes the research step characterise not just *what the
 * change builds* (the vertical slice) but *what it must hold true against* in the system
 * it lands in — its horizontal obligations: reuse-don't-duplicate (existing structure),
 * cross-surface / source-of-truth parity, failure & lifecycle states, behavioural
 * equivalence — plus an "attack your own research" adversarial pass and a Surface-
 * Assessment trigger that treats a SECOND REPRESENTATION of something already modelled
 * as `refactor required`.
 *
 * Design (mirrors the completeness-check harness, the trustworthy template):
 *   - The prompt is the ONLY variable. Arm B = the live research prompt; Arm A = the
 *     same prompt with the ENTIRE LIN-697 contribution removed — the `### Horizontal
 *     Obligations` + `### Attack Your Own Research` block AND the symmetric duplicate-
 *     representation sentence inside Surface Assessment. Both strip targets MUST match
 *     (we throw otherwise) so a silent no-op A==B is impossible. Stripping both makes
 *     Arm A the genuine pre-LIN-697 research prompt — the honest "prompt is the only
 *     variable" baseline, not a half-stripped hybrid.
 *   - Evidence is NOT pre-solved (the ceiling-effect trap, §5). The gold case gives only
 *     what the ticket author would have seen — a clean grep of the NEW symbol (0 hits,
 *     it doesn't exist yet) plus the one model/render file an author naturally opens,
 *     which HAPPENS to contain the existing representation but never flags it as a
 *     duplicate. We measure the DECISION to enumerate obligations / spot the duplicate,
 *     not recall of a pre-handed answer.
 *   - A constant LLM judge (held on one cheap model regardless of the generator under
 *     test) grades each output YES/NO against a strict rubric.
 *
 * Gold case ground truth = the documented KUL-567 / HAR-697 retro (LIN-697 description):
 * an implementation that landed "locally right but globally wrong" because the research
 * characterised what it built and skipped what it had to hold true against — it added a
 * SECOND REPRESENTATION of something the system already modelled and missed cross-surface
 * sync / lifecycle. The gold cases below re-encode that failure shape (not the literal
 * KUL-567 code, which lives in another project) at author-visible-evidence fidelity.
 *
 * Overfitting control (the plan's explicit watch-item): a genuinely small / single-surface
 * task. The scale-to-task guard should SUPPRESS the obligation enumeration there; if Arm B
 * forces ritual axis-listing on a typo-fix (and materially more than Arm A), that is the
 * overfitting failure and the directive must be tightened, not merged.
 *
 * This is a LOWER BOUND: a single call can't run tools, so it measures the decision to
 * check obligations, not the check itself — real agents (Claude Code) should beat it.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval-horizontal-obligations.mjs
 *
 * Env knobs:
 *   GEN_MODELS   comma list of generators under test
 *                (default openai/gpt-5.4-mini,anthropic/claude-haiku-4.5)
 *                gpt-5.4-mini is the PROD default — the model /recommend actually runs,
 *                so A/B-ing old-vs-new on it measures the real consumer. haiku is the
 *                cheap cross-check. (We do NOT use Opus here — far too expensive.)
 *   JUDGE_MODEL  judge, held constant            (default anthropic/claude-haiku-4.5)
 *   K            runs per arm per cell            (default 10)
 *   ONLY         substring filter on case id      (e.g. ONLY=GOLD-1)
 *   GROUP        filter by group: gold | control
 */
import { generatePrompt } from '../lib/prompt-templates.js';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const GEN_MODELS = (process.env.GEN_MODELS || 'openai/gpt-5.4-mini,anthropic/claude-haiku-4.5').split(',').map(s => s.trim()).filter(Boolean);
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'anthropic/claude-haiku-4.5';
const K = Number(process.env.K) || 10;
const ONLY = process.env.ONLY;
const GROUP = process.env.GROUP;
const TEMP = 0.7;

// ---------------------------------------------------------------------------
// Cases. Each: a research ticket, the author-visible evidence (NEW-symbol grep =
// 0 hits + a file tree + the one file an author opens, which contains the existing
// representation but never labels it a duplicate), and a strict YES/NO judge rubric
// whose ground truth is the horizontal obligation the ticket omits.
// ---------------------------------------------------------------------------
const mockContext = { project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [] };

const CASES = [
  // ===== GOLD: KUL-567-shaped second-representation + cross-surface sync (decisive) =====
  {
    id: 'GOLD-1 archived-vs-status (2nd representation)', group: 'gold',
    issue: {
      identifier: 'GOLD-1', url: 'x', createdAt: '2026-06-20T00:00:00Z', labels: ['research'],
      title: 'Add an `archived` flag to projects so finished projects can be hidden from the sidebar',
      description: 'Users want to hide finished projects from the left sidebar without deleting them. Add an `archived` boolean to the project model, a toggle in the project menu, and filter archived projects out of the sidebar list. Research the cleanest way to add this.'
    },
    evidence: `\`\`\`
$ grep -rln "archived" lib/ public/
(no matches — the field does not exist yet)

$ ls lib/ public/
lib/project-model.js  lib/render-sidebar.js  lib/project-store.js
public/sidebar.js  public/project-menu.js

--- lib/project-model.js (the file you'd add the field to) ---
export function makeProject(input) {
  return {
    id: input.id,
    name: input.name,
    // lifecycle of a project; drives most list/filter behaviour
    status: input.status || 'active', // 'active' | 'paused' | 'completed' | 'cancelled'
    createdAt: input.createdAt,
    teamId: input.teamId
  };
}

--- lib/render-sidebar.js (server-rendered sidebar) ---
export function renderSidebar(projects) {
  const visible = projects.filter(p => p.status !== 'cancelled' && p.status !== 'completed');
  return visible.map(p => \`<li data-status="\${p.status}">\${p.name}</li>\`).join('');
}

--- public/sidebar.js (client re-render after live updates) ---
function clientRenderSidebar(projects) {
  // mirrors the server filter so the list doesn't flicker on socket updates
  return projects.filter(p => p.status !== 'cancelled' && p.status !== 'completed');
}
\`\`\``,
    judgeRubric: 'Does the research output raise an OBLIGATION TO THE EXISTING SYSTEM for the new `archived` flag — specifically does it (a) flag that `archived` overlaps or duplicates the existing project `status` lifecycle (active/paused/completed/cancelled) and that the change should reuse or extend `status` rather than introduce a parallel/second representation of "is this project still shown", OR (b) flag that the new flag must be kept consistent across the server `renderSidebar` filter and the client `clientRenderSidebar` filter (two copies of the same source-of-truth filter)? Answer YES only if it concretely raises at least one of these (reuse-vs-duplicate of status, OR cross-surface/source-of-truth sync of the filter). Answer NO if it only describes how to add the boolean, the toggle, and the sidebar filter without confronting either obligation. (Ground truth: the system already models project lifecycle via `status` and filters BOTH the server and client sidebar on it; `archived` is a second representation that should reuse/extend `status` and must stay in sync across both render surfaces.)'
  },
  // ===== GOLD: cross-surface parity + failure/lifecycle, different scenario (robustness) =====
  {
    id: 'GOLD-2 retryCount sync + lifecycle', group: 'gold',
    issue: {
      identifier: 'GOLD-2', url: 'x', createdAt: '2026-06-20T00:00:00Z', labels: ['research'],
      title: 'Track a retry count on dispatch items and stop retrying after 3 attempts',
      description: 'Some dispatch items get retried forever when a consumer keeps failing. Add a `retryCount` to dispatch items, increment it on each retry, and stop offering an item once it has been retried 3 times. Research how to add this.'
    },
    evidence: `\`\`\`
$ grep -rln "retryCount" lib/ docs/
(no matches — the field does not exist yet)

$ ls lib/ docs/
lib/dispatch-store.js  lib/proxy-events.js  docs/dispatch-integration.md

--- lib/dispatch-store.js (item shape + lifecycle transitions) ---
function enqueue(item) {
  return store.insert({ ...item, status: 'queued', takenAt: null, expiresAt: now() + TTL_MS });
}
function take(id, consumer)   { return store.update(id, { status: 'taken', takenAt: now(), consumer }); }
function requeue(id)          { return store.update(id, { status: 'queued', takenAt: null }); } // on consumer timeout
function markFailed(id, why)  { return store.update(id, { status: 'failed', error: why }); }
function listAvailable()      { return store.find({ status: 'queued', expiresAt: { $gt: now() } }); }

--- docs/dispatch-integration.md (the consumer wire contract) ---
A polled item is: { id, prompt, target, status, expiresAt }.
Consumers MUST treat the item shape as the contract; fields not listed here are internal.
On failure, POST /feedback marks the item; the server may requeue it for another consumer.
\`\`\``,
    judgeRubric: 'Does the research output raise an OBLIGATION TO THE EXISTING SYSTEM for `retryCount` — specifically does it (a) flag the failure/lifecycle question of WHERE retryCount is incremented across the existing transitions (enqueue/take/requeue/markFailed) and what its value must be on requeue vs a fresh item (correctness under the non-happy-path requeue/fail transitions), OR (b) flag that exposing/using retryCount interacts with the documented consumer wire contract (the published item shape in dispatch-integration.md) and the source-of-truth question of whether it is internal-only or part of the contract? Answer YES only if it concretely raises at least one of these (lifecycle-transition correctness OR wire-contract/source-of-truth parity). Answer NO if it only describes adding the field and the >3 check without confronting either. (Ground truth: retryCount must be threaded correctly through the existing requeue/take/fail lifecycle and its visibility decided against the documented poll contract — exactly the failure/lifecycle and source-of-truth-parity axes.)'
  },
  // ===== CONTROL: genuinely small / single-surface — must NOT trigger ritual axis-listing =====
  {
    id: 'CTRL-1 footer typo (small)', group: 'control',
    issue: {
      identifier: 'CTRL-1', url: 'x', createdAt: '2026-06-20T00:00:00Z', labels: ['research'],
      title: 'Fix typo in footer: "Copyrght" -> "Copyright"',
      description: 'The footer in lib/components/footer.js renders the word "Copyrght". Fix the spelling to "Copyright".'
    },
    evidence: `\`\`\`
$ grep -rn "Copyrght" lib/
lib/components/footer.js:12:  return \`<footer>Copyrght \${year} Harbour</footer>\`;
\`\`\``,
    // For the control, YES = the BAD outcome (ritual axis-listing on a trivial task).
    control: true,
    judgeRubric: 'Does this research output impose a multi-axis "horizontal obligations" treatment on what is a one-character typo fix in a single file — i.e. does it produce an explicit Horizontal Obligations section, enumerate obligations across existing-structure / parallel-surfaces / failure-&-lifecycle / past-behaviour axes, or run an adversarial self-review pass — disproportionately to a trivial single-surface change? Answer YES if it does that ritual axis-listing / obligation enumeration. Answer NO if it keeps the response appropriately short and just identifies the file and the fix. (We WANT NO here: the scale-to-task guard should suppress the obligation tax on a typo.)'
  }
];

// ---------------------------------------------------------------------------
// Arm construction. Strip BOTH LIN-697 additions to make Arm A the true pre-LIN-697
// research prompt; throw if either target is absent (no silent no-op).
// ---------------------------------------------------------------------------
const HO_BLOCK_RE = /\n### Horizontal Obligations[\s\S]*?(?=\n### Surface Assessment)/;
const DUP_REP_RE = /\nOne shape always counts as demanding a structural change:[^\n]*\n/;

function buildArms(c) {
  const full = generatePrompt('research', c.issue, mockContext).prompt;
  if (!HO_BLOCK_RE.test(full)) throw new Error('Horizontal Obligations/Attack block not found to strip for ' + c.id);
  if (!DUP_REP_RE.test(full)) throw new Error('Surface-Assessment duplicate-representation sentence not found to strip for ' + c.id);
  const armA = full.replace(HO_BLOCK_RE, '\n').replace(DUP_REP_RE, '\n');
  if (armA === full) throw new Error('strip was a no-op for ' + c.id);
  const task = `\n\n## Codebase Evidence (you cannot run tools now — this is what is known so far)\n${c.evidence}\n\n## Output\nProduce your research findings and recommended approach for this task, following the research instructions above. Work only from the evidence shown. Be concise.`;
  return { A: armA + task, B: full + task };
}

// ---------------------------------------------------------------------------
// Model I/O (with light retry on 429/5xx, like eval-prompt-scaling.mjs).
// ---------------------------------------------------------------------------
let lastErr = '';
async function call(prompt, model, max = 900, temp = TEMP) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 800 * 2 ** (attempt - 1)));
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: temp, max_tokens: max, messages: [{ role: 'user', content: prompt }] })
      });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      if (j.choices?.[0]?.message?.content) return j.choices[0].message.content;
      lastErr = (j.error?.message || JSON.stringify(j)).slice(0, 140);
    } catch (e) { lastErr = e.message.slice(0, 140); }
  }
  return '__ERR__' + lastErr;
}

async function judge(output, rubric) {
  if (output.startsWith('__ERR__')) return null;
  const p = `You are grading a research output against a strict rubric. Answer with ONLY "YES" or "NO".\n\nRUBRIC: ${rubric}\n\nRESEARCH OUTPUT:\n${output}\n\nAnswer YES only if the output genuinely does what the rubric describes. Answer:`;
  return /yes/i.test(await call(p, JUDGE_MODEL, 5, 0)) ? 1 : 0;
}

async function rate(prompt, rubric, genModel, k) {
  const runs = await Promise.all(Array.from({ length: k }, () => call(prompt, genModel)));
  const scores = await Promise.all(runs.map(o => judge(o, rubric)));
  const ok = scores.filter(s => s !== null);
  const hits = ok.reduce((a, b) => a + b, 0);
  return { hits, n: ok.length, errs: scores.length - ok.length };
}

// ---------------------------------------------------------------------------
let cases = CASES.filter(c => !ONLY || c.id.includes(ONLY));
if (GROUP) cases = cases.filter(c => c.group === GROUP);

console.log(`# Horizontal Obligations A/B (LIN-697)`);
console.log(`gens=${GEN_MODELS.join(', ')}  judge=${JUDGE_MODEL}  K=${K}  temp=${TEMP}`);
console.log(`Arm A = research prompt with LIN-697 block + dup-rep sentence stripped; Arm B = live research prompt.\n`);

for (const genModel of GEN_MODELS) {
  const k = K;
  console.log(`========================================================================`);
  console.log(`GENERATOR: ${genModel}  (K=${k} per arm)`);
  console.log(`========================================================================`);
  for (const c of cases) {
    const { A, B } = buildArms(c);
    const a = await rate(A, c.judgeRubric, genModel, k);
    const b = await rate(B, c.judgeRubric, genModel, k);
    const pct = (x, n) => n ? (x / n * 100).toFixed(0) + '%' : 'n/a';
    const dA = a.n ? a.hits / a.n : 0, dB = b.n ? b.hits / b.n : 0;
    console.log(`\n# ${c.id}${c.control ? '   [CONTROL — YES = ritual axis-listing = BAD]' : ''}`);
    console.log(`  arm A (pre-LIN-697): ${a.hits}/${a.n}  (${pct(a.hits, a.n)})${a.errs ? `  [${a.errs} errs]` : ''}`);
    console.log(`  arm B (live):        ${b.hits}/${b.n}  (${pct(b.hits, b.n)})${b.errs ? `  [${b.errs} errs]` : ''}`);
    console.log(`  Δ = ${((dB - dA) * 100).toFixed(0)} pts` + (c.control
      ? `   (want B LOW and Δ ≈ 0; a large positive Δ here = overfitting)`
      : `   (want B HIGH and Δ positive = directive lifts obligation-awareness)`));
  }
  console.log('');
}
