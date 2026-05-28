# Recommender Blind Spot: Greedy Local Correctness → Structural Drift

## Status

Design note / problem statement. No code changes proposed as committed work yet —
this exists so the blind spot is concrete and pointable-at before we decide to act.

## Summary

The AI recommendation loop (`/api/proxy/recommend`, `/workspace/:urlKey/api/recommend/:id/stream`)
is a **greedy local optimizer**: for a single issue, given that issue's context, it returns
the one correct next action. That is exactly what it's good at, and it's the right design for
the common case.

It has one structural failure mode: when a series of locally-correct actions accumulates into
a globally-wrong trajectory, **nothing in the loop can see it, and nothing in the loop can
correct it.** Each step is defensible in isolation; the sequence is pathological; and the
process has no altitude at which the sequence becomes visible.

This note names the pattern, explains why this tool is structurally prone to it, and sketches
the fix. It is deliberately scoped to *recommendation routing* — not to the trustworthiness of
individual generated prompts, which is working as intended.

## The failure, observed in the field

A real run (different project) produced a cluster of tickets, each patching a symptom of the
previous one, none addressing the shared root cause:

- Ticket A documents a contention problem.
- Ticket B adds an eviction handshake to work around it.
- Ticket C adds logic to decide what to evict.
- Ticket D adds retry-with-backoff so transient races stop surfacing.

Ticket D's retry was **correct in isolation** and **catastrophic in aggregate**: it serialized
a boot path that another caller had explicitly declared best-effort, turning a rare ~3% error
into a 100% hang on contention-heavy boots. Every ticket assumed the prior architecture and
patched one symptom. None reduced the root structural quantity (how many components held a
contended resource). The fix, once someone zoomed out, was not another patch — it was a
single architectural decision that collapsed the whole ticket cluster into a 20-line concern.

## The pattern (generalized)

**Greedy local correctness accumulating into global structural drift, with no altitude at
which the drift is legible.** Three sub-mechanics:

1. **Symptom-patching that preserves the broken invariant.** Each step moves forward but along
   a vector that diverges from the correct structure. The invariant that actually needs to
   change is never touched, because no single step is "about" it.
2. **A uniform policy applied across contexts with different correctness contracts.** One
   chokepoint (a retry wrapper, a cache, a middleware) gets one policy, but its call sites have
   different "must-succeed" vs "best-effort" semantics. The policy is right for some and wrong
   for others.
3. **The patch graph itself is the diagnostic** — but only from above. From inside any single
   ticket, the latest patch looks like a clean win.

## Why this tool produces it

The properties that make the recommender *trustworthy* are the same ones that make it *blind*
to this class of error.

### 1. The grounding rule blinds the router by design

`lib/prompts/meta-prompt-template.js` instructs the model that the generated prompt may only
contain information explicitly present in the task context. This is correct and necessary for
producing a prompt *body* you can trust — it stops the model inventing file paths, schemas, and
acceptance criteria.

But it also scopes every recommendation to a single issue. The router structurally **cannot
see** that tickets A/B/C/D are one problem, because each is evaluated against only its own
context. It will keep returning the locally-correct next action (`bug` → fix the retry,
`blocked` → unblock) indefinitely. The cluster is invisible by construction.

### 2. The decision tree has no zoom-out operator

The tree in `meta-prompt-template.js` routes with priority
`blocked > bug > preparing > implementation`, plus `breakdown`. But `breakdown` only
decomposes *downward* (into subtasks). There is no operator that **consolidates upward** or
**challenges the substrate** — no "this is the Nth patch touching the same constraint; stop
patching and reassess the foundation." The exact altitude at which the field failure was
eventually resolved is the one altitude the tree cannot reach.

### 3. `preparing` / Surface Assessment is the seed of the missing capability, but it's amnesiac

The `preparing` branch asks "can *this* task land cleanly, or does it need a prerequisite
refactor?" That's the right *question* — but it's asked fresh every time, against one issue,
with no memory that the last three tasks also answered "sort of, with a workaround." Three
"sort of"s in a row *is* the signal, and nothing accumulates it across recommendations.

### 4. Self-correction requires the drift to be legible in Linear — and it isn't

This is the core of "it couldn't self-correct." Each patch ticket closes green. The workaround
*works*, locally. On the next pass the loop re-reads green Linear state
(`routes/proxy.js` stack/recommend; `routes/workspace-api.js` recommend stream both read
current issue/comment state) and proceeds. The global failure surfaces at runtime — *outside*
the ticket-completion loop the recommender reads. A locally-correct/globally-wrong step leaves
no trace in the per-issue context, so the loop has **no input that would let it correct.** It
is a greedy optimizer with no error signal for the specific kind of error being made.

## Proposed fix

Each item maps to a mechanic above. (1) and (2) are the high-leverage pair; they attack the
blind spot directly. The rest are reinforcement.

1. **Feed the recommender a cross-issue cluster signal.** When generating a recommendation,
   include siblings, relations, and recently-closed tickets touching the same area, and
   **relax the grounding rule for routing only** (never for the prompt body) so the model can
   detect "Nth fix touching the same constraint." The raw material already exists:
   `/api/proxy/stack` and `/api/proxy/relations/:issueId` (`routes/proxy.js`), and the context
   assembly in the recommend stream (`routes/workspace-api.js`).

2. **Add an escalation branch to the decision tree** — `step-back` / `architectural-review` —
   that fires when the cluster signal trips and recommends a structural assessment *instead of*
   the next patch. It must sit **above** `bug`/`implementation` in priority when a cluster is
   detected, because "do the obvious next fix" is precisely the trap. This must be added to
   **both** prompt paths to stay in sync: the AI path
   (`lib/prompts/meta-prompt-template.js`) and the handwritten path
   (`lib/prompt-template-defs.js` / `lib/prompt-templates.js`).

3. **Add a policy-uniformity check to fix/implementation prompts.** When a change is a wrapper
   at a shared chokepoint (retry, cache, middleware), the generated prompt should require
   enumerating the call sites and confirming the policy is correct for *each* — the
   "one chokepoint, three contracts" lesson, encoded.

4. **Make drift legible at close-out.** Fix/implementation prompts should ask the agent to
   record, on completion, "what invariant did this change touch — did it add or remove a
   coordination owner / a holder of the contended resource?" so the next recommendation pass
   has something to read. This is what gives the loop an error signal it currently lacks.

## Scope guard

This is narrowly about recommendation *routing* and the loop's ability to detect
cross-issue structural drift. It does **not** propose weakening the grounding rule for prompt
bodies, and it does **not** claim the greedy local optimizer is wrong for the common case — it
is right, and most issues should continue to route exactly as they do today. The goal is a
single new capability: notice when the *accumulation* of correct local moves is the problem,
and escalate instead of patching once more.
