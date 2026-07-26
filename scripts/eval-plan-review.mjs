#!/usr/bin/env node
/**
 * A/B eval for the plan-review GATE and its routing branch (LIN-1603, item 2.8).
 *
 * Modelled on scripts/eval-review-closeout.mjs, but pointed at the RECOMMENDER:
 * the thing under test is the Step-3 routing branch in
 * lib/prompts/meta-prompt-template.js, not a handwritten prompt. The sibling
 * harness measures a prompt's OUTPUT quality with an LLM judge; this one measures
 * a ROUTING DECISION, which is a single parseable token (`→ **action**`), so it is
 * scored deterministically by `parseRecommendedAction` with no judge in the loop.
 *
 * THE RISK BEING MEASURED IS OVER-FIRING. `plan-review` exists to protect the
 * throughput of the work that needs it, so the expensive failure is not "the gate
 * missed a risky plan" — it is "the gate taxed every clean plan with an extra
 * dispatch". The headline question is therefore the negative one: does a clean
 * small plan (gate not met) still route STRAIGHT to `implementation`, with zero
 * added dispatches, exactly as it did before the gate existed?
 *
 * Arms (the prompt is the only variable):
 *   - Arm B = the shipped meta-prompt (gate + routing branch + S2 parity).
 *   - Arm A = the same prompt with the gate branch and the Plan-prompts gate/revision
 *     parity excised — the pre-LIN-1603 shape. The action vocabulary is left alone
 *     in both arms: `plan-review` was registered in Phase 1 (LIN-1602), so arm A is
 *     "the kind exists but nothing routes to it", which is the true baseline.
 *
 * Metrics (deterministic, exact-match on the parsed action):
 *   gate-fires-when-due       : on GATED cases, arm B emits `plan-review`.
 *                               Arm A's rate is the baseline (expected ~0).
 *   no-added-dispatch-when-not-due : on CLEAN cases, arm B emits the SAME verb arm A
 *                               does (i.e. never `plan-review`). This is the
 *                               over-fire guard and the acceptance criterion.
 *
 * The due cases are split along the signal the router actually reads, because the
 * first run of this harness showed the two behave completely differently:
 *   - `recorded` — the plan carries the "plan-review due: yes" line that item 2.1
 *     tells the plan phase to write. This is the designed primary path.
 *   - `rederive` — the plan predates the gate (no such line), so the router must
 *     judge criteria (a)-(d) from the plan text itself. This is the fallback.
 * Keeping them separate stops a healthy aggregate from hiding a dead fallback.
 *
 * Honest scope: a single call per run, no tools, synthetic contexts — a LOWER bound
 * on routing quality, same caveat as the sibling harness. The authoritative red→green
 * guard is deterministic and lives in tests/unit/openrouter.test.js ('plan-review gate
 * and routing (LIN-1603)'); this measures the same two properties under LLM load.
 *
 * Usage:   OPENROUTER_API_KEY=... node scripts/eval-plan-review.mjs
 * Env knobs: GEN_MODEL, K (runs per arm per case), ONLY (case-id filter).
 */
import { buildMetaPromptTemplate } from '../lib/prompts/meta-prompt-template.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../lib/completion-signals.js';
import { deriveDispatchKind } from '../lib/prompt-templates.js';
import { parseRecommendedAction } from '../lib/openrouter.js';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const GEN_MODEL = process.env.GEN_MODEL || 'anthropic/claude-haiku-4.5';
const K = Number(process.env.K) || 4;
const ONLY = process.env.ONLY;
const TEMP = 0.7;

// Each case is a childless, In-Progress leaf whose description already carries a
// plan — so Step 3 owns the decision and the ONLY question is whether the gate
// fires. `due` says whether any of criteria (a)-(d) is met; `signal` is 'recorded'
// when the plan states the decision outright and 'rederive' when the router must
// judge the criteria itself; `preGate` is where the task routed before the gate
// existed, and is what arm B must still reach when the gate is NOT met.
const CASES = [
  {
    id: 'DUE-recorded-relaxation', due: true, signal: 'recorded', preGate: 'implementation',
    context: `# LIN-917: Accept legacy timestamps in the agent-status intake

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Widen the \`timestamp\` validation in \`routes/proxy.js\` agent-status POST to accept
  a bare epoch integer in addition to ISO-8601 (older runners send the former).
- Drop the strict \`isFinite\` assertion that currently 400s those payloads.
- Tests: unit-cover both accepted shapes.

**Session fit:** fits one focused session.
**plan-review due:** yes — (c) the plan drops the strict \`isFinite\` assertion, relaxing an input guard.

## Comments
(none)`
  },
  {
    id: 'DUE-recorded-credential', due: true, signal: 'recorded', preGate: 'implementation',
    context: `# LIN-918: Let a worker mint a child proxy token for its own subtask

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Extend the token exchange in \`routes/dispatch.js\` so a working token can mint one
  scoped child token, inheriting scope and ownership.
- Record the parent token id on the child for the audit trail.
- Tests: unit-cover inheritance and the single-use bootstrap invariant.

**Session fit:** fits one focused session.
**plan-review due:** yes — (d) the plan touches the credential surface (token minting).

## Comments
(none)`
  },
  {
    id: 'DUE-a-multisession', due: true, signal: 'rederive', preGate: 'breakdown',
    context: `# LIN-910: Migrate the dispatch queue off the in-process store

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Move queue reads/writes in \`lib/dispatch-store.js\` behind a storage port.
- Add a Mongo-backed adapter; keep the in-process one for tests.
- Migrate the three call sites in \`routes/dispatch.js\` and the two in \`routes/proxy.js\`.
- Backfill existing queued items, then flip the default.

**Surfaces:** storage port, Mongo adapter, call-site migration, backfill script.
**Session fit:** needs multiple sessions.

## Comments
(none)`
  },
  {
    id: 'DUE-b-named-gap', due: true, signal: 'rederive', preGate: 'implementation',
    context: `# LIN-911: Add a per-workspace rate limit to the recap endpoint

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Add an in-process token bucket in \`routes/proxy.js\` around the recap read.
- Key it on workspace id; 30/min, shared with the existing proxy limiter's config.

**Strategy Framing:** the clean fix is the shared limiter middleware, but that
requires the limiter-registry refactor tracked as LIN-702, which is not scheduled.
Routing around it with a local bucket is cheaper now; the duplicated limiter is the
tax we pay on every future limit change. Routed-around gap: **LIN-702**.

**Session fit:** fits one focused session.

## Comments
(none)`
  },
  {
    id: 'DUE-c-relaxation', due: true, signal: 'rederive', preGate: 'implementation',
    context: `# LIN-912: Accept legacy timestamps in the agent-status intake

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Widen the \`timestamp\` validation in \`routes/proxy.js\` agent-status POST to accept
  a bare epoch integer in addition to ISO-8601 (older runners send the former).
- Drop the strict \`isFinite\` assertion that currently 400s those payloads.
- Tests: unit-cover both accepted shapes.

**Session fit:** fits one focused session.

## Comments
(none)`
  },
  {
    id: 'DUE-d-credential-surface', due: true, signal: 'rederive', preGate: 'implementation',
    context: `# LIN-913: Let a worker mint a child proxy token for its own subtask

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Extend the token exchange in \`routes/dispatch.js\` so a working token can mint one
  scoped child token, inheriting scope and ownership.
- Record the parent token id on the child for the audit trail.
- Tests: unit-cover inheritance and the single-use bootstrap invariant.

**Session fit:** fits one focused session.

## Comments
(none)`
  },
  // The two cases below exercise what ONLY item 2.4 provides. The `recorded` cases
  // above turned out to fire in BOTH arms (the plan's own "plan-review due: yes"
  // line is enough to pick the verb once Phase 1 registered the template), so the
  // routing branch's marginal value has to be measured where the branch is the only
  // source of the answer: what to do with a verdict once one is on the trail.
  {
    id: 'LOOP-1-request-changes', loop: true, expect: 'plan', preGate: 'implementation',
    context: `# LIN-919: Add a per-workspace rate limit to the recap endpoint

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Add an in-process token bucket in \`routes/proxy.js\` around the recap read.
- Key it on workspace id; 30/min.

**Session fit:** fits one focused session.
**plan-review due:** yes — (b) the plan routes around a tracked contract gap.

## Comments
### Plan Review Verdict
Re-ran the completeness search: \`lib/kpi-stats.js\` reads the same recap seam and is
not in the plan's surface list — a missed sibling, neither folded in nor marked
out-of-scope with an identifier. Strategy Framing describes the routed-around gap but
names no ticket identifier for it, so the trade-off is not auditable.

**Verdict: Request Changes.**`
  },
  {
    id: 'LOOP-2-second-request-changes', loop: true, expect: 'blocked', preGate: 'implementation',
    context: `# LIN-920: Add a per-workspace rate limit to the recap endpoint

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Add an in-process token bucket in \`routes/proxy.js\` around the recap read.
- Key it on workspace id; 30/min.
- Revised: folded in the \`lib/kpi-stats.js\` sibling surface.

**Session fit:** fits one focused session.
**plan-review due:** yes — (b) the plan routes around a tracked contract gap.

## Comments
### Plan Review Verdict
Missed sibling \`lib/kpi-stats.js\`; routed-around gap named no ticket identifier.

**Verdict: Request Changes.**

---

Revised the plan: folded in the kpi-stats surface. I do not agree the routed-around
gap needs an identifier — there is no ticket for it and I do not think one is warranted.

---

### Plan Review Verdict
The sibling surface is now folded in. The routed-around gap still names no identifier
and the revision declines to file one, so the trade-off remains unauditable — this is
the same finding as the first pass, unaddressed rather than answered.

**Verdict: Request Changes.**`
  },
  {
    id: 'CLEAN-1-single-string', due: false, signal: 'n/a', preGate: 'implementation',
    context: `# LIN-914: Footer deploy label should read "deployed" not "deploy"

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- One string in \`lib/components/footer.js\`: "deploy" → "deployed".
- Tests: the existing footer unit test asserts the label; update its expectation.

**Session fit:** fits one focused session.
**plan-review due:** no — none of (a)-(d): single session, no routed-around gap,
nothing relaxed, no credential / merge-rule / dispatch-contract surface.

## Comments
(none)`
  },
  {
    id: 'CLEAN-2-pure-helper', due: false, signal: 'n/a', preGate: 'implementation',
    context: `# LIN-915: clamp() should treat a NaN bound as a no-op

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Add a NaN guard to the pure \`clamp(value, min, max)\` in \`lib/graph-features.js\`
  so a NaN min/max returns the value unchanged.
- Tests: three unit cases (NaN min, NaN max, normal path).

**Surfaces:** one pure function. No callers change behaviour.
**Session fit:** fits one focused session.

## Comments
(none)`
  },
  {
    id: 'CLEAN-3-verdict-already-on-trail', due: false, signal: 'n/a', preGate: 'implementation',
    context: `# LIN-916: Cache the workspace audit report for 60s

**State:** In Progress · no subtasks · labels: (none)

## Description
## Implementation Plan
- Add a 60s in-process cache around \`computeAuditReport\` in \`lib/audit.js\`, keyed by
  workspace id; invalidate on the existing audit-refresh path.
- Tests: unit-cover hit/miss and the TTL boundary.

**Session fit:** fits one focused session.

## Comments
### Plan Review Verdict
Re-ran the completeness search: no sibling cache seam shares this path. Strategy
framing names no routed-around gap and none is needed. History signal on
\`lib/audit.js\` surfaces nothing the plan misses. Session-fit holds — no nameable
catches. Nothing relaxed; no prerequisite refactor claimed.

Claims verified; proceed to implementation.

**Verdict: Approve.**`
  }
];

/** Build both arms for a case. Arm A excises the gate; the excision must bite. */
function buildArms(context) {
  const common = {
    issueContext: context, identifier: context.match(/# (\S+):/)?.[1] || 'LIN-1',
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0,
    remainingCount: 0, hasComments: true, commentCount: 1,
    aiHints: formatAIHintsForMetaPrompt(),
    actionVocabulary: getAIRecommendationActionNames().join(', '),
    completionSignals: formatAllSignalsForMetaPrompt(),
    isTerminal: false, hasOpenChildren: false
  };
  const B = buildMetaPromptTemplate(common);

  // Arm A = pre-LIN-1603: remove the Step-3 gate branch (through the verdict
  // routing, up to the session-fit routing) and the Plan-prompts S2 parity.
  let A = B.replace(/\*\*Before routing on session-fit, check whether a `plan-review` is due[\s\S]*?(?=\*\*Otherwise route on the session-fit answer)/, '');
  if (A === B) throw new Error('gate branch not found to strip');
  let step = A;
  A = A.replace(/ \*\*Plan prompts must also carry the plan-review gate decision[\s\S]*?the one-revision-cycle bound can never be satisfied\./, '');
  if (A === step) throw new Error('Plan-prompts S2 parity not found to strip');
  step = A;
  A = A.replace(/ ONE exception, and only one: a `plan-review` that recorded[\s\S]*?bounds it to a single cycle\./, '');
  if (A === step) throw new Error('Completed-prep exception not found to strip');
  return { A, B };
}

// The prompt is sent EXACTLY as production sends it — no output override, so the
// measurement is of the real thing. `stop` cuts the generation at the `## Prompt`
// section: the decision (`→ **action**`) is emitted just above it, in the Reasoning
// block, so the routing answer is complete while the long prompt body is never paid for.
async function call(prompt) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GEN_MODEL, temperature: TEMP, max_tokens: 500, stop: ['## Prompt'],
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const j = await r.json();
  return j.choices ? j.choices[0].message.content : '__ERR__' + JSON.stringify(j).slice(0, 150);
}

/**
 * K runs of one arm → the parsed actions, normalised to dispatch KINDS.
 * The meta-prompt emits display names (`implement`), which the dispatch layer maps
 * to kinds (`implementation`) — comparing kinds is what the routing actually means.
 */
async function actionsFor(prompt) {
  const outs = await Promise.all(Array.from({ length: K }, () => call(prompt)));
  return outs.map(o => {
    const name = parseRecommendedAction(o);
    return name ? deriveDispatchKind(name) : '(unparsed)';
  });
}

const tally = (arr) => arr.reduce((m, a) => (m[a] = (m[a] || 0) + 1, m), {});
const fmt = (m) => Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}×${v}`).join(' ');

const cases = CASES.filter(c => !ONLY || c.id.includes(ONLY));
console.log(`gen=${GEN_MODEL}  K=${K}  (n=${K} per arm per case)\n`);
console.log('Hypothesis: the gate fires on gated plans and is INVISIBLE on clean ones —');
console.log('arm B reaches `plan-review` when due, and reaches arm A\'s destination when not.\n');

const due = { recorded: { a: 0, b: 0, n: 0 }, rederive: { a: 0, b: 0, n: 0 } };
const loop = { a: 0, b: 0, n: 0, third: 0 };
let cleanSameB = 0, cleanOverfireB = 0, cleanN = 0;

for (const c of cases) {
  const { A, B } = buildArms(c.context);
  const [aActs, bActs] = [await actionsFor(A), await actionsFor(B)];
  const label = c.loop ? `verdict on trail, expect \`${c.expect}\`` : (c.due ? `DUE, signal: ${c.signal}` : 'not due');
  console.log(`# ${c.id}  (${label}, pre-gate destination: ${c.preGate})`);
  console.log(`  arm A: ${fmt(tally(aActs))}`);
  console.log(`  arm B: ${fmt(tally(bActs))}`);
  if (c.loop) {
    const a = aActs.filter(x => x === c.expect).length;
    const b = bActs.filter(x => x === c.expect).length;
    const thirdReview = bActs.filter(x => x === 'plan-review').length;
    loop.a += a; loop.b += b; loop.n += K; loop.third += thirdReview;
    console.log(`  loop bound → \`${c.expect}\`: arm B ${b}/${K}  (arm A baseline ${a}/${K})  |  emitted another plan-review ${thirdReview}/${K}\n`);
  } else if (c.due) {
    const a = aActs.filter(x => x === 'plan-review').length;
    const b = bActs.filter(x => x === 'plan-review').length;
    const bucket = due[c.signal];
    bucket.a += a; bucket.b += b; bucket.n += K;
    console.log(`  gate-fires-when-due (${c.signal}): arm B ${b}/${K}  (arm A baseline ${a}/${K})\n`);
  } else {
    const same = bActs.filter(x => x === c.preGate).length;
    const over = bActs.filter(x => x === 'plan-review').length;
    cleanSameB += same; cleanOverfireB += over; cleanN += K;
    console.log(`  no-added-dispatch: arm B reached \`${c.preGate}\` ${same}/${K}  |  OVER-FIRED to plan-review ${over}/${K}\n`);
  }
}

const pct = (x, n) => n ? (x / n * 100).toFixed(0) + '%' : 'n/a';
console.log('========== aggregate ==========');
console.log(`  gate-fires-when-due [recorded] : arm B ${due.recorded.b}/${due.recorded.n} (${pct(due.recorded.b, due.recorded.n)})   arm A baseline ${due.recorded.a}/${due.recorded.n} (${pct(due.recorded.a, due.recorded.n)})`);
console.log(`  gate-fires-when-due [rederive] : arm B ${due.rederive.b}/${due.rederive.n} (${pct(due.rederive.b, due.rederive.n)})   arm A baseline ${due.rederive.a}/${due.rederive.n} (${pct(due.rederive.a, due.rederive.n)})`);
console.log(`  loop bound (verdict on trail)   : arm B ${loop.b}/${loop.n} (${pct(loop.b, loop.n)}) took the bounded route   arm A baseline ${loop.a}/${loop.n} (${pct(loop.a, loop.n)})   [another plan-review emitted: ${loop.third}/${loop.n}]`);
console.log(`  no-added-dispatch-when-not-due : arm B ${cleanSameB}/${cleanN} (${pct(cleanSameB, cleanN)}) reached the pre-gate destination`);
console.log(`  OVER-FIRE (the risk)           : arm B emitted plan-review on ${cleanOverfireB}/${cleanN} clean plans (${pct(cleanOverfireB, cleanN)})`);
console.log(`\nACCEPTANCE: over-fire ≈ 0% (a clean small plan costs zero added dispatches) AND gate-fires-when-due materially above arm A.`);
console.log(`Read the two due rows SEPARATELY: [recorded] is the designed path (the plan writes the decision, the router reads it);`);
console.log(`[rederive] is the fallback for plans written before the gate existed. A dead [rederive] row means the gate is opt-in`);
console.log(`via the plan template, NOT retroactive over the existing backlog — a coverage fact worth knowing, not a test failure.`);
