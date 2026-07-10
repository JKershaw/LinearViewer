# Harbour Prompt-System Audit — Determinism & Token Cost

> A directive-level audit of Harbour's prompt surfaces: where the tokens actually go,
> which asks genuinely need intelligence versus which are deterministic in disguise, and
> where fresh sessions re-derive work a prior one already did.
>
> **Scope:** worker templates · meta-prompt · autopilot orchestrator
> **Method:** each surface rendered with a representative issue; tokens ≈ chars⁄4 (±15%, directional).
> A rendered HTML version lives beside this file at `docs/prompt-system-audit.html`.

## Headline

~85% of the *instruction* token budget lives in three static blobs (meta-prompt, kickoff,
handbook), not in per-task worker prompts. The genuinely-hard reasoning is a small, dense
core that should stay with the LLM. The single highest-leverage move isn't a prompt edit at
all — it's recording a few **structured facts** so today's judgment calls become tomorrow's
lookups.

| Metric | Value | Note |
|---|---|---|
| Meta-prompt input | ~15,100 tok | Read on *every* recommendation call — once per autopilot step. |
| Kickoff + handbook | 12.9–14.8k tok | Injected into every orchestrator dispatch; handbook (~8.2k) re-read each orient beat. |
| Worker prompt (avg) | 1,326 tok | Range 650–3,000 across 15 kinds. The *generated* prompt; the worker then spends far more doing the work. |
| Largest waste | re-grounding | Every fresh worker re-reads the ticket, runs `git log`, re-reads source at HEAD — 5+×/task. Not shared. |

---

## 1. Where the tokens actually are

| Surface | Spent when | Tokens | Note |
|---|---|--:|---|
| **Meta-prompt** (choose action + write prompt) | every `/recommend` | 15,086 | Cheap model (gpt-5.4-mini) but once per loop step. |
| ↳ completion-signals sub-block | inside meta-prompt | 758 | Trim candidate. |
| ↳ aiHints sub-block | inside meta-prompt | 1,452 | Trim candidate. |
| **Kickoff** — standard / general | orchestrator dispatch | 12,903 | Handbook is ~8.2k of it. |
| **Kickoff** — stepper variant | stepper runs | 14,836 | +~1.9k of flag-mechanics prose (B19). |
| **Autopilot handbook** alone | every kickoff + each orient beat | 8,203 | Static bytes re-materialized repeatedly. |
| Worker templates — full range | per worker dispatch | 650–2,996 | review · research · plan are the heavy three. |
| ↳ shared grounding post-pass | appended to every worker | 366 | Staleness ~165 + terminal/children/bug notes. |

Worker templates, sorted: review 2,996 · research 2,743 · plan 2,140 · close-out 1,648 ·
implementation 1,470 · bug 1,329 · retro 1,269 · breakdown 1,029 · triage 902 · blocked 813 ·
scoping 768 · design 758 · context 720 · look-into 658 · spike 650. Average 1,326.

Every one of the three big blobs is a candidate for provider-side prompt caching the code
does not currently arrange.

---

## 2. Task types & who needs an LLM

Three buckets. The codebase already has a mature "compute-it-don't-ask-it" seam — frontier
facts, session-fit extraction, node-state counts, terminal-state routing, the staleness date,
all capability shaping. That is proof the pattern works; the audit is about where it hasn't
been applied yet.

- **A — already deterministic.** Computed in code and injected. Precedent; nothing to do.
- **B — automatable.** Asked as prose today; could move to code with real payoff.
- **C — genuine judgment.** The reason an LLM is in the loop. Leave alone.

### Bucket A — the precedent already in the tree
Frontier ranking · subtask & blocked counts · "all children complete" · attachment counts ·
tracker capability shaping · the staleness `--since` date injected from `issue.createdAt`.
Roughly a dozen facts the code computes and drops into the prompt — the model never reasons
them out.

### Bucket B — prose today, code tomorrow (ranked by leverage)

| Move | Effort | Payoff | Risk |
|---|---|---|---|
| **B19** — a `dispatchBeat()` verb that sets the stepper flags (`followUpTo:ROOT`, `force`, `waitForFollowUps`, `subscription`) | medium | Deletes ~1,900 tok of flag-combo prose; removes an agent error class | Needs a higher-level dispatch verb |
| **B16** — runtime-owned wedged-session timer (the "~30 min silence → nudge" clock) | medium | Removes a stateful clock the orchestrator holds in its head | Scheduler feature work |
| **B15** — a looping/sprawling *detector* over dispatch-kind history, fed in as a signal | medium | Turns "eyeball the kind sequence" into a computed flag | Detection is B; the *response* stays C |
| **B1/B2** — inject `git log` output + high-churn verdict for ticket-referenced paths | medium | Cuts per-worker archaeology on the paths the ticket names | Partial: plan/review file lists unknown until the LLM writes them; server may lack the checkout |
| **B6** — consolidate hand-rolled inline workflows into `formatWorkflow` | easy | ~7 templates stop duplicating scaffolding as literals | Consolidation only; no behavior change |
| **B4/B5** — bug-label retention & branch-name as code invariants | easy | Deletes repeated policy prose | Low |
| **B18** — platform-enforce "review never merges" / read-only mode | hard | Stops relying on prose for an *irreversible* action | Code admits it's convention, not a sandbox — real platform work |

### Bucket C — leave with the LLM
No deterministic marker exists for any of these in the current data model.
- **Routing intelligence** — the research-necessity test, the divergence veto (did a later comment overturn an earlier root cause?), the already-landed guard, the design hatch.
- **Deliverable judgment** — bug root-cause & "isolated or a class?", plan surface enumeration / completeness, the Surface Assessment verdict, plan-fidelity reconciliation, review gap-analysis + ledger authorship, close-out discharge decisions.
- **The autopilot disposition** — trajectory reading, continue/complete/pause, the four lines, the verb-override.

---

## 3. Redundancy — computed *and* re-narrated

The near-free deletions: the code already computes the fact, yet the prompt re-derives it in
prose. Each is a place where two code paths express one truth — the drift risk the both-paths
discipline exists to prevent.

1. **Node-state sentence** restates counts as English; the "all complete → consider closing" verdict duplicates the terminal-state note. *(computeNodeStateCounts · formatChildrenCompleteNote)*
2. **Session-fit** is extracted deterministically *and* re-asked ("read the description for whether it fits one session") in Step 3. *(extractSessionFit → frontier block)*
3. **Frontier counts** carry a "do not re-derive" header — yet Step 4 walks the model back through deriving from those same counts. *(frontierFactsBlock)*
4. **Bug-label presence** is computed once and narrated in three places. *(formatBugInvestigatedNote)*
5. **"Merge is close-out's job, not review's"** is restated across kickoff + handbook + two templates — one enforced rule beats prose in four spots.

---

## 4. Duplicated effort *across* sessions

LLM-call duplication is well-controlled — recap/brief/summaries are hash-cached with sane
TTLs. The real waste is worker-side re-grounding and context re-fetching that is never shared.
In several cases a store built to prevent exactly this exists, but was never wired in.

| # | Duplication | Magnitude | Cache that exists but isn't wired |
|--:|---|---|---|
| 1 | **Per-session re-grounding.** Every fresh worker re-reads the ticket, runs `git log`, re-reads source at HEAD from zero. A research→plan→impl→review→close-out arc re-grounds the same file-set 5+×. | **worst** — 1k–10k+ worker tok × N dispatches | **task-snapshot-store (LIN-598)** already detects "unchanged since snapshot N" via `diffLatest` — nothing feeds it into prompt-gen. Slice also lacks a git-HEAD dimension. |
| 2 | **Cold re-onboarding.** "Each is a fresh session with no memory" — full repo ingestion re-paid every dispatch. | ~15k meta-prompt + cold context / step | Only the stepper warm-drip & the narrow `followUpTo` mitigate it; the default *standard* variant re-onboards cold every step. |
| 3 | **Handbook re-materialized.** The ~8k-token handbook is spliced into every kickoff *and* the kickoff instructs re-fetching it each orient beat. | ~8k static tok re-read per beat | Disk read is process-cached, but no prompt-level dedupe / provider prompt-cache. |
| 4 | **Context re-fetched per endpoint.** `fetchRecommendationContext` re-runs at /stack, /brief, /recap, /recommend — up to 4 full assemblies for one task in one loop. A cache *hit* still pays a full Linear round-trip. | N round-trips where 1 would do | No request-scoped context memoization; snapshot store not consulted to short-circuit. |
| 5 | **Session reconstruction per page load.** pipeline-loops recomputed on each request — a documented ~147s full 30-day scan in the naive path. | up to full 30-day log scan | Materializer (observationSessionsStore) exists, but the Sessions tab / standalone / inference-grouped paths bypass it. |

---

## 5. The one structural insight — C → A is a data-model change

Several of the hardest bucket-C judgments are hard *only because* the data model has no
deterministic marker for them. The divergence veto, the already-landed guard, and the
bug-investigation-complete gate are judgment calls **because** "investigation confirmed,"
"PR merged," and "root cause still stands" live in free-form comments, not structured facts.

Record a few structured signals — `investigation_confirmed`, `pr_merged` / CI-green-on-SHA,
and a **git-HEAD dimension on the task snapshot** — and two things happen at once: those
judgments move C → A (routing becomes deterministic), *and* the #1 duplication becomes
suppressible ("slice unchanged AND HEAD unchanged → skip the re-read").

---

## 6. Recommendations — ranked by leverage-to-effort

1. **Wire `task-snapshot-store.diffLatest` into prompt generation** (+ add a git-HEAD dimension). Gate the staleness / plan-fidelity re-read on a real change. Kills the biggest per-worker cost. *(medium · highest payoff)*
2. **Request-scoped context memoization** — one `fetchRecommendationContext` per (workspace, issue) per loop, shared across stack/recap/brief/recommend. *(low–medium · high)*
3. **Delete the §3 redundant prose** — free, and removes the two-code-paths-one-fact drift risk. *(easy)*
4. **Add a `dispatchBeat()` verb (B19)** — sets the stepper flags in code; removes ~1,900 tokens and a whole error class from stepper runs. *(medium)*
5. **Record structured `investigation_confirmed` / `pr_merged` facts** — the C → A unlock from §5, sequenced as its own piece of platform work. *(medium–hard)*

---

*Token figures from rendering each surface with a representative issue; estimate ≈ chars⁄4,
treat as ±15% and directional — the ratios are the point, not the third digit. Bucket IDs
(B1–B19) map to the directive-level classification behind this report.*

---

# Part II — The Reframe & the Research Plan

> Part I measured prompt *size* — the wrong denominator. Tokens are cheap and getting cheaper.
> This part reframes the problem around the two things that actually move outcomes, then lays
> out a research piece to test whether the theory holds against real session logs.

## 7. Two currencies, not one

Raw tokens are cheap; optimizing them polishes the wrong surface. What's scarce is:

- **Axis 1 · correctness — working memory.** How many live, interacting obligations (decision
  branches, invariants, exceptions) the model must hold *while* pursuing the goal. Not token
  count: a 500-token block with eight conditional rules is heavier than a 3,000-token slab of
  static context.
- **Axis 2 · efficiency — spend trajectory.** Where the session's *work* tokens go once it's
  running: orientation & re-grounding, the core change, self-correction — versus the
  irreducible problem.

**The model to hold:** split the agent's load into *intrinsic* (the actual problem) and
*extraneous* (bookkeeping, routing, re-grounding, keeping invariants straight). Determinism's
whole job is to drive extraneous load toward zero so the whole attention budget goes to
intrinsic. The two axes are one coin: pre-computing a fact removes an obligation the model was
tracking (correctness) **and** the re-derivation spend it cost at runtime (efficiency). That
reframes Part I's redundancy findings — deleting the re-narrated node-state sentence matters
not for its ~200 tokens but because it removes a rule the model must reconcile.

## 8. What we can measure — and what we can't

Harbour never runs the worker; an external runner does and posts back only free-form feedback
markers. So Harbour sees a rich *outside* and a low-resolution pulse of the *inside* — but is
structurally blind to worker tokens. The gold data is the worker's own Claude Code session
transcript (JSONL).

| Signal | Available today? | Source |
|---|---|---|
| Session / step wall-clock, queue→take latency | ✓ yes | timestamps · kpi-stats.js |
| Effort split — onboarding / active / waiting / wrap-up | ✓ yes (heartbeat resolution) | wall-clock-summary.js (LIN-987) |
| Per-heartbeat tool tallies (`Bash×7`), kind sequences, outcomes | ✓ yes (coarse) | session-telemetry.js · pipeline-loops.js |
| Token / cost for Harbour's *own* calls (recommend/brief/recap) | ✓ yes | llm-call-log.js (LIN-418) |
| Worker-session **token counts** (per-turn or total) | ✗ blind | emitted nowhere — needs the JSONL |
| Per-turn structure; which **files** read (re-read-same-file 5×) | ✗ blind | tools counted, targets not — needs the JSONL |
| Worker model id; full transcript | ✗ blind | only marker strings retained |

The clean split: the **outside view exists today** (enough for a fast first pass); the
**inside view needs the JSONL** — worker tokens, per-turn structure, and file targets are the
exact gap the exported session logs fill.

## 9. Four hypotheses to test

| ID | Hypothesis & prediction | Data that tests it |
|---|---|---|
| **H1** | **Correctness tracks complexity, not prompt size.** Failed / looping / sprawling sessions correlate with more concurrent constraints (surfaces, blockers, longer kind-sequences) — not bigger prompts. | outcome × complexity proxies (loop data) × prompt size — *outside view, now* |
| **H2** | **Orientation dominates early spend.** A large share of a session's effort goes to re-grounding before the first productive edit. | time-to-first-Edit & orientation ratio — coarse now (wall-clock), precise from JSONL |
| **H3** | **Determinism pays.** Tasks with richer deterministic facts (frontier facts present, session-fit stated) show lower orientation ratio and cleaner completion. | facts-present flag × orientation ratio × outcome — *needs JSONL* |
| **H4** | **Cross-session duplication is real.** Multiple sessions on one task re-read the same files from scratch each dispatch. | file-read overlap across sessions sharing a task id — *needs JSONL* |

## 10. Metrics, the join & a two-track method

The analysis joins the inside and outside of every session on `sessionId` — the worker JSONL
(tokens, tool calls, file targets, timestamps) against Harbour's loop record (kind, task,
terminal outcome).

**Per-session metrics:**
- **Orientation ratio** — Read + Grep + git/ls tokens ÷ total. The extraneous-load proxy.
- **Time-to-first-productive-action** — tokens/tool-calls before the first Edit/Write.
- **Rework ratio** — repeated edits to the same file; test-fail → edit loops.
- **Concurrent-constraint load** — surfaces touched, blockers, kind-sequence length. The H1 proxy.
- **Cross-session file-read overlap** — same-task duplication for H4.

**Two tracks:**
- **Track A · basic · run now** — the outside view from existing telemetry (extend
  `wall-clock-summary.js` + loop data). No new data, no JSONL. Answers H1 and a coarse H2
  within a day, and gives a baseline to sanity-check against.
- **Track B · full · needs JSONL** — the inside view: parse worker transcripts for tokens,
  per-turn structure, file targets. Answers H2/H3/H4 precisely; produces the real spend profile.

**The compare:** does the coarse outside signal predict the fine inside truth? If Track A's
wall-clock orientation share tracks Track B's token orientation share, we can run this
continuously from telemetry alone — no JSONL export after calibration.

**Forward instrumentation:** the cleanest way to make the inside view measurable *in
production* is to have the runner post worker token/turn counts on the existing
`[working]`/`[done]` markers — the same append-only feedback seam that already flows into
`session-telemetry`. The research doubles as the spec for that instrumentation.

## 11. Deliverables, success criteria & caveats

- **Deliverable** — a per-session spend profile (orientation / core / rework %), an aggregate
  across kinds & outcomes, and a go/no-go on the determinism bet *with numbers*.
- **Success looks like** — "X% of a typical session is orientation, and cutting it via
  determinism predicts Y fewer failures/reworks" — precise enough to prioritize against.
- **Treat as directional** — small N, confounders (task difficulty), heartbeat sampling
  coarseness, `waiting` is a documented lower bound, JSONL format may drift. Correlation, not
  proof — enough to steer, not to close the question.

**My read:** the reframe is right and it re-ranks Part I. The prize isn't trimming the
15k-token meta-prompt — it's the orientation and rework tax, where both correctness and
efficiency leak at once. Wiring the snapshot-diff (Part I, rec #1) is still the top move: it
removes the re-grounding obligation *and* the re-grounding spend in one change. And the
highest-durability output of this research may not be the findings — it's the instrumentation:
emitting worker tokens on the feedback markers turns a one-off log study into a permanent
instrument, so every future determinism change can be measured, not argued.
