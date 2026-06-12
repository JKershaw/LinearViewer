# Recommendation Engine Redesign — "Make It Good"

**Status:** Draft proposal (for team alignment — no code yet)
**Scope:** Full re-architecture of the AI "Recommended next prompt" path
**Author:** generated from a measured investigation, June 2026
**Related:** `docs/recommender-failure-patterns.md`, `docs/recommender-structural-drift.md`, `docs/meta-prompt-audit-report.md`, `docs/prompt-change-validation.md`

---

## 1. Why now

The recommendation engine works, but it was built across multiple days of mostly-additive
patching. The result is reliable *plumbing* wrapped around an *unreliable decision*, plus a
maintenance tax (two prompt paths kept in sync by hand) that makes every behavior change cost
double. We have "made it work." This document is the plan to "make it good": **more reliable
outcomes, and code that is more straightforward to work with.**

The redesign is grounded in a controlled experiment (Section 2), not intuition.

---

## 2. What we measured

We ran the live proxy `/recommend` endpoint **6× per target** against two real in-progress epics
(default model `gpt-5.4-mini`, server sends `temperature: 0`), capturing the descent path,
terminal node, action, and prompt for every run.

| Target | Path stability | Terminal node(s) | Action distribution | Unique prompts |
|---|---|---|---|---|
| `LIN-428` direct leaf | n/a | LIN-428 ×6 | research ×5, **plan ×1** | 6/6 |
| `LIN-385` parent epic | always →389 | LIN-428 ×3, **LIN-389 ×3** | research ×2, breakdown ×3, plan ×1 | 6/6 |
| `LIN-389` mid node | — | LIN-428 ×4, **LIN-389 ×2** | research ×3, breakdown ×2, plan ×1 | 6/6 |
| `HAR-616` node | always →623 | HAR-623 ×4, **HAR-616 ×2** | review/implement×2/research/spike/blocked | 6/6 |
| `HAR-545` node | always →616→623 | HAR-623 ×5, HAR-616 ×1 | plan×2/blocked×2/implement/research | 6/6 |
| `HAR-149` deep epic | always →497→502 | HAR-502 ×5, HAR-149 ×1 | blocked ×3, research ×2, plan ×1 | 6/6 |

`deferStopReason` was `None` and `deferTruncated` was `false` on every run.

### What works
- **Traversal mechanics** (`resolveRecommendation`): clean stop reasons, no cycles, no
  terminal/non-child mis-hops. The loop faithfully executes whatever each hop decides.
- **Child selection within an active branch** is deterministic and matches a human's pick
  (LIN-385→389→428; HAR-545→616→623).
- **Terminal re-fetch fidelity**: a leaf reached via descent draws from the *same* action
  distribution as hitting it directly, with substantively equivalent prompts. Descent does not
  bias the leaf.
- **Leaf prompt quality** for well-scoped tickets is high.

### What does not
1. **Descent depth is unstable.** The model re-decides *defer-to-child* vs *do-node-work* at each
   hop and flip-flops. `LIN-385` reached the intended leaf only 3/6 times; the rest stopped at
   `LIN-389` doing `breakdown`. Root cause: the defer-vs-decompose ambiguity at a node with one
   open child + a "needs multiple sessions" plan.
2. **Entry-child selection on busy epics ignores the live frontier.** `selectFocusSubtask` picks
   the *lowest-identifier* in-progress child. `HAR-149` has three in-progress children
   (497, 545, 589) → always routes to `HAR-497` → a **blocked** leaf (`HAR-502`). The actual
   active frontier (`HAR-545→616→623`) is unreachable from the epic. This is deterministic *code*
   behavior, not model variance.
3. **Action repeatability is low, and `temperature: 0` does not fix it.** All 36 calls produced
   unique prompts; even the simplest leaf flips action. The code already sends `temperature: 0`
   (`lib/openrouter.js`), so this is **provider-side nondeterminism**, not a config bug. It cannot
   be tuned away with temperature.

### The diagnosis
One monolithic LLM call does **fact-finding + routing + prose generation** at once, and is asked
to re-derive facts that are actually deterministic (open-child count, which children are blocked,
whether all are done, the plan's session-fit answer). **The model is judging things it should be
told.** Variance in the prose leaks into the routing because they share one call.

---

## 3. Design principle

> **Graph-shaped questions are deterministic. Meaning-shaped questions are the LLM's — and the
> LLM is handed exactly the facts it needs, as structured input, for the one decision in front of
> it.**

"Which child is the frontier?" and "are all children done?" are graph facts (and we *want* them
stable). "Is the knowledge to do this gathered yet?" and "is this bug investigated enough to fix?"
are genuinely meaning-shaped — those stay with the LLM, fed the graph facts.

The goal is **not** to take decisions away from the LLM. It is to make deterministic code the
*fact-provider and safety-rail*, and give the LLM a single, well-lit choice.

---

## 4. Target architecture — three stages, one responsibility each

Today: `[ context → giant meta-prompt (facts + route + prose) → regex-parse ]`.

Target: split into three single-purpose stages.

### Stage 1 — Fact assembly `[D]` ("the briefing")
One deterministic, network-free, **unit-testable** module computes the structured fact set for a
node. No LLM. This is the bulk of the logic and should be boring, tested code:

- terminal-state (`state.type`)
- open-child count, and per-child `{open, blocked, in-progress, terminal}`
- **frontier ranking** of open children using the signals the `digest` view already computes
  (`downstreamUnblocks`, `criticalPathLen`, blocked-state) — *not* lowest-identifier
- blocker-resolution status (is the blocking issue itself still open? — queryable)
- the plan's session-fit answer ("fits one session" / "needs multiple sessions"), if present
- bug-investigation-present (bug label + prior code-grounded comment)

### Stage 2 — The decision `[L]` (one tight call)
The LLM receives the Stage-1 facts as **structured fields** and returns a **structured decision**
via JSON / tool-use — not a regex-scraped `→ **action**` line:

```
{ "action": "<enum>", "deferTo": "<id|null>", "reason": "<one line>" }
```

Small, cheap, easy to eval, easy to vote/ensemble if more stability is needed. This is the
"LLM makes the choice using exactly the right information" target. The brittle
`parseRecommendedAction` / `parseDeferTo` regexes retire.

### Stage 3 — Generation `[L]` (terminal node only)
Once routing lands on a real action, a second call writes the prompt body for that one action.
Intermediate defer hops generate **no prose** — making descent strictly cheaper, and quarantining
all prose variance into a stage that cannot affect routing.

### Why this hits both goals
- **Reliability:** routing becomes a small structured task fed exact facts; the HAR-149 mis-route
  and the LIN-389 flip-flop become isolated fact/prompt problems, not emergent monolith behavior.
- **Simplicity:** structured I/O kills the regex parsing; the decision and the prose stop fighting
  in one prompt; and it creates the seam to collapse the two-path tax (Section 6).

---

## 5. The per-node decision flowchart

`[D]` deterministic code · `[L]` LLM reasoning. One hop; `resolveRecommendation` repeats it on the
defer target. Deterministic code *computes and presents* the facts (and the obvious suggestion);
the LLM is the decision locus; guards are safety rails.

```
                        ┌─────────────────────────────┐
                        │  ENTER NODE (id)            │
                        │  [D] Stage-1 fact assembly  │
                        └──────────────┬──────────────┘
                                       │
                 [D] state.type terminal (Done/Cancel/Dup)?
                          │yes                    │no
                          ▼                       │
            [D] any open children? ──no──► [L] confirm & close      │
                   │yes                    (review / retro)         │
                   ▼                                                │
            continue to descent ◄───────────────────────────────────┤
                                                                    ▼
                                            [D] does node have open children?
                                              │yes (container)        │no (leaf)
                                              ▼                       │
                  ┌───────────────────────────────────────────┐      │
                  │ [D] RANK FRONTIER CHILDREN                 │      │
                  │   not-blocked > unblocks-most >           │      │
                  │   critical-path > in-progress > lowest-id │      │
                  │   (skip blocked unless all are blocked)   │      │
                  └──────────────────┬────────────────────────┘      │
                                     ▼                               │
                  [L] DEFER vs NODE-WORK?  ← fed structured facts:    │
                      child count, plan session-fit answer,          │
                      which children open/blocked, is scope          │
                      decomposed, the ranked frontier child          │
                   │defer            │node-work                       │
                   ▼                 ▼                                │
              descend to       [L] which node action?                │
              frontier child   (breakdown / triage / look-into)      │
                                                                     ▼
                                            ┌────────────────────────────────┐
                                            │ LEAF — [D] pre-classify facts:  │
                                            │  blocked label + blocker still  │
                                            │   open?  bug label + prior      │
                                            │   investigation in comments?    │
                                            └───────────────┬─────────────────┘
                                                            ▼
                                            [L] ACTION CLASS + readiness:
                                              research / plan / implement /
                                              bug / blocked / review
                                                            ▼
                                            [L] GENERATE PROMPT BODY (Stage 3)
                                                            ▼
                                            [D] validate decision + traversal
                                                guards (depth/cycle/terminal-edge)
```

Mapping to the failures:
- **Frontier ranking `[D]`** fixes the `HAR-149 → HAR-497` mis-route.
- **Defer-vs-node-work `[L]` fed structured facts** fixes the `LIN-389` flip-flop — the model is
  told the child count and the plan's session-fit answer instead of re-deriving them.
- **Leaf pre-classify `[D]`** reduces the research↔plan↔blocked leaf jitter by surfacing
  blocker/bug facts rather than asking the model to re-extract them.
- **Action class + prose `[L]`** stays LLM; residual variance is the inherent-nondeterminism tax,
  separately addressable with voting / model choice.

---

## 6. The debt to pay down: the two-path tax

Per `CLAUDE.md`, ~6 behaviors (staleness check, terminal-state, bug-investigated, class check,
surface-assessment, capability-awareness) must be **hand-maintained in both**
`lib/prompt-templates.js` (handwritten) **and** `lib/prompts/meta-prompt-template.js` (meta). This
is the single biggest source of accreted complexity and the reason changes feel like patching.

The redesign makes **"one source of truth per behavior rule"** a primary deliverable. The Stage 2/3
split creates the seam: each behavior rule becomes a single shared definition consumed by the
generation stage, rather than two prose copies. Whether to **collapse to one path** or **share
rules across two** needs a focused look at *why* both paths exist (deterministic template vs
LLM-authored variant) — flagged as an open decision (Section 8), not pre-committed here.

---

## 7. Sequencing (eval-first, de-risked — not a big-bang rewrite)

What makes a re-architecture safe is that we already have the measurement tool. Institutionalize
it; gate every step on it. **Nothing ships without moving the numbers.**

1. **Baseline eval fixture.** Commit today's experiment as a reusable eval: the real nodes
   (LIN-385/389/428, HAR-149/545/616) + expected routing/action, run N times, scored on
   **stability + correctness**. This is the definition of "reliable" and the regression guard.
   (Extends the existing `scripts/eval-*` pattern.)
2. **Two low-risk fact fixes** (no architecture change yet): frontier ranking `[D]`, and surface
   the structured facts into the *existing* meta-prompt. Re-run the harness — expected to kill the
   HAR-149 mis-route and shrink the LIN-389 fork on their own.
3. **The architectural split:** Stage 1 fact module → Stage 2 structured decision call (tool-use)
   → Stage 3 generation-only-at-terminal. Re-measure.
4. **Collapse the two-path tax.** Re-measure.

Each step is independently shippable; you are never holding a half-rewritten system.

---

## 8. Open decisions (for the team)

1. **Two-path resolution:** collapse to a single path, or keep two and share rule definitions?
   (Needs a look at the original rationale before deciding.)
2. **Decision-call shape:** structured JSON / tool-use *(recommended)* vs. keep markdown-with-markers.
3. **Stability lever, if Stage-2 facts aren't enough:** best-of-N vote on the action, a
   lower-variance routing model, or accept residual leaf-action variance.
4. **Frontier ranking weights:** confirm the `digest` signal ordering
   (not-blocked > unblocks-most > critical-path > in-progress > id) is the policy we want.

---

## Appendix A — Experiment method

- Endpoint: `GET /api/proxy/recommend/{id}` (read-scope proxy token), which runs the production
  `resolveRecommendation` descent server-side.
- 6 runs per target, captured: `deferredVia` (descent path), terminal `identifier`,
  `recommendedAction`, `deferStopReason`, `deferTruncated`, `truncated`, full `reasoning` and
  `prompt` (length + hash).
- Model: server default `openai/gpt-5.4-mini`, `temperature: 0`.
- Fixtures: LinearViewer epic `LIN-385` (E2E test migration) and Harbour epic `HAR-149` (custom
  node runtime), both in-progress with partly-finished subtasks.
