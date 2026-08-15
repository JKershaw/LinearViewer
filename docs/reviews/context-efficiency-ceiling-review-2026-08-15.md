# Context-Efficiency Ceiling Review — hindsight-minimal context (C\*) vs carried context

**Written for LIN-2115.** The third document over the 2026-08-14 fleet-capacity-test day. The
[capacity-test run review](capacity-test-run-review-2026-08-14.md) (merged `454490c8`, ledger
**LIN-2087**) measured the *between-leg* structure. The
[intra-session efficiency review](intra-session-efficiency-review-2026-08-14.md) (merged `6b9c9c54`,
**LIN-2112**) measured *where tokens go inside a leg* and found F1: the window is 95.5% cache-read,
so intra-session cost **is** carried context. Neither asked the next question: **how much of that
carry is principled?** This document measures that — the ratio of what a leg actually carries to the
smallest context that demonstrably suffices to produce the same verified outcome.

**Data discipline.** Same boundary as LIN-2112: transcripts stay on-machine; this document carries
aggregates and structural quotes only, never raw dumps or credential material. Re-run spend is
bounded and reported in §8.

---

## 1. The framing

For a fixed model *M* and a task with a verifiable outcome *V*, **C\*** is the smallest context that
gets *M* to a *V*-passing output. Three properties, from the ticket, each of which this study either
confirms or qualifies:

1. **C\* is model-relative.** Context is the part of the program not already in the weights, so a
   stronger model should have a smaller C\*. **Measured (§5.3): not the binding constraint on any
   task here.** On the two localized tasks, Haiku 4.5 and Sonnet 5 passed the same verifier from the
   *same* distillate — the tier bought no context reduction, only a 4.4× price increase. On the
   algorithm-shaped task both tiers failed the same distillate with the *same three* assertions. The
   one place tier did separate the models was the review probe (§6.2), where it separated depth of
   engagement rather than context need. Specification completeness dominated tier at every size
   measured.
2. **Two distinct minimums.** *C\*-output* — the hindsight-minimal context to **emit** the answer.
   *C\*-search* — the minimum to **find** it, which legitimately includes exploration. **Measured
   (§4.3): the gap is 2.2× in cost and 2.8× in turns** on the decisive case — removing a single
   file-and-function pointer (93 tokens) from an otherwise identical handoff cost +33 turns and
   +$0.43 for a bit-for-bit equivalent outcome. The distinction is real, it is large, and it is
   cheap to close.
3. **The deliverable metric**: per leg kind, **actual-carried / C\*** — the *context-efficiency
   ceiling*. §6 reports it.

**One correction to the framing up front.** The ticket estimates C\*-output for a typical
implementation leg at "the files the diff touches + the plan + conventions; plausibly 20–30k tokens."
Measured, the *conventions* term is not load-bearing: dropping `CLAUDE.md` (~27.8k tokens of the
probe's resident context) changed the verifier result not at all and cut probe cost 23% (§4.4). The
files-touched term is also smaller than assumed, because a session that is told *where* to look reads
a fraction of what a session that must search reads.

---

## 2. Method

### 2.1 Data sources

| Source | What it is | Where |
|---|---|---|
| The 2026-08-14 transcript archive | 161 Claude transcript JSONLs, SHA-256 `8b97b13f…`, capture verified by LIN-2112 | `~/harbour-transcript-archives/claude-transcripts-2026-08-14.tar.gz` |
| The live transcripts | The same 160 usage-bearing sessions, **still present on the dispatcher machine** — verified 160/160 readable at their recorded paths, so all measurement here reads the live files and the tarball serves as the frozen capture | `~/.claude/projects/` |
| LIN-2112's measurement bundle | Per-session aggregates (`sessions.json`, 160 rows), analyzer, reports | `~/harbour-transcript-archives/lin-2112-measurement/` |
| Landed ground truth | The commits those legs produced, and their own regression suites | `LinearViewer` at `4f328ba5` |
| Pricing | `lib/model-pricing.js` at HEAD — same table as LIN-2112, so figures are commensurable | `LinearViewer/lib/model-pricing.js:77-86` |

New tooling for this study lives beside the LIN-2112 bundle (`~/harbour-transcript-archives/lin-2115-measurement/`); it is not repo-tracked, for the same reason LIN-2112's was not.

### 2.2 The experiments

**E2 — minimal-handoff probes (run first, per the ticket).** At natural checkpoints of a real
archived session, distil the session state into a compact handoff, hand it to a **genuinely fresh
session** — a new headless `claude -p` process with its own context window, not a sub-agent sharing
this one — in a git worktree reset to that leg's true pre-state, and check whether it lands an
equivalent deliverable. Passing means the distillate was sufficient: **an upper bound on C\***.

**E1 — bounded hindsight ablation.** For 3 completed tasks with verifiable outcomes, run the same
probe across a ladder of progressively pruned contexts (as-dispatched → requirement+site →
requirement only), and where a rung fails, add back the minimum information that closes it. That
add-back is the bisection: it localises C\* between the failing and passing rungs.

Both experiments use the same instrument, which is why E2 running first mattered — E2 established
that the instrument works before E1 spent anything on breadth.

### 2.3 The verifiers — and whether each one is valid

Step one was to establish what can actually verify a completed task here, and whether each signal
tracks the outcome it claims to.

| Verifier | Applies to | Verdict |
|---|---|---|
| **The landed regression suite, run against the fresh session's production change** | implementation legs | **Valid.** Objective, mechanical, and discriminating: confirmed to fail on the true pre-state and pass on the true post-state for all three tasks (LIN-2078 38/43 → 43/43; LIN-2045 0/5 → 5/5; LIN-2065 load-error → 18/18). Because it is the leg's *own* suite, "equivalent deliverable" is not a judgement call. |
| The same suite, as a test of the *whole* deliverable | implementation legs | **Limited.** It verifies the production behaviour only. The real legs also wrote those tests; the probes wrote their own, which are then overwritten by the landed file. So the probe proves behavioural equivalence of the change, not that the fresh session would have written an equivalent test suite. Diff inspection (§4.2) is the partial compensation. |
| The same suite, on LIN-2065 | that task specifically | **Limited, and over-strict.** Three of its assertions pin representation, not behaviour — e.g. that a non-placeable waypoint carries *no* `x`/`y` **key** (`!('x' in wp)`), and that a fresh segment berths at exactly the origin. A different-but-correct implementation fails them. Recorded, and the consequence is carried into §5.2 rather than hidden. |
| **A known-defect recovery check** (does a fresh review session find the defect the real review leg found?) | review legs | **Invalid — established by running it (§6.2).** It looked limited-but-usable in advance: real, specific ground truth (PR #1126's finding F1) and a binary check. Running it showed the ground-truth finding was *defensive*, guarding a state an upstream filter already prevents, so a correct review can rightly decline to file it. A verifier that scores a correct review as a failure does not track the outcome. **Replaced by nothing — no valid review-leg verifier was found.** |
| Tests-pass / CI-green as recorded in the transcript | any leg | **Must be replaced.** It verifies the real leg's own claim about itself; it cannot verify a counterfactual context. Not used. |
| "The review approved it" | plan / plan-review / close-out legs | **Must be replaced for this purpose.** An approval is a human-or-LLM judgement recorded once, with no way to re-run it against a pruned context at constant standard. **No valid verifier was found for plan, plan-review, research, close-out, autopilot or observer legs**, and no C\* was measured for them. §6 says so explicitly rather than extrapolating. |

The honest consequence: **this study measures C\* for implementation legs only.** The review-leg
attempt is reported in full (§6.2) because its failure is itself a result, but it yields no C\*.
Everything reported for the other kinds is carried context and handed context — measured — with no
C\* denominator.

---

## 3. Audit — the layers this study must stay consistent with

Every layer, how it is represented today, the source, and what this study does to preserve it.

| Layer | How it is represented today | Source | What this study preserves |
|---|---|---|---|
| Transcript / archive evidence | Per-turn `usage` on each assistant message; the archive is the frozen capture, the live `~/.claude/projects/` files are byte-identical originals | `intra-session-efficiency-review-2026-08-14.md` §"Method and data sources"; 160/160 live files verified present this session | Same dedupe-on-`message.id` rule; same window definition `input + cache_read + cache_creation` |
| Session / leg classification | The transcript is self-identifying: session UUID = filename = clone dir; the bootstrap prompt's first `# <ISSUE> · <kind>` line gives issue and leg kind | ibid.; reproduced in `lin-2112-measurement/sessions.json` (160 rows, `kind`/`issue` fields) | Reused verbatim — not re-derived, so the two studies cannot disagree about what a leg *is* |
| Carried-context measurement | `cacheRead = Σ_turns context(t)` — the cost identity | LIN-1236 program / LIN-1591 ("orchestrator poll loops re-read their whole context per beat — 15% of token spend, measured", 73 sessions) | Same identity; §7's compaction pricing is the same `T × cacheWrite + T × cacheRead × (N−i)` model as LIN-2112 §5 |
| Outcome verification | Landed commit + its own regression suite; `docs/prompt-change-validation.md` §5 is the house convention for measuring a prompt-side change | `LinearViewer/docs/prompt-change-validation.md:65-104` | §5's design rules adopted: prompt is the only variable; don't pre-solve the evidence; real gold case; test more than one model; be price-conscious. **One rule not met: "run k× replications" — k=3 on the decisive cell only, k=1 elsewhere.** Disclosed in §9. |
| Distillation / handoff procedure | Already exists **between** legs: the dispatch prompt is a distillate a plan leg wrote for an implementation leg; `brief`/`recap` are LLM distillates of a ticket | `simple-dispatcher/dispatcher.js:953`; proxy `/brief/{id}`, `/recap/{id}` | §4.1 measures the existing between-leg distillate directly rather than inventing a new format |
| Re-run cost accounting | `total_cost_usd` per headless run; `lib/model-pricing.js` for transcript-side pricing | `claude -p --output-format json`; `lib/model-pricing.js:78-86` | Both reported; §8 |
| Report conventions | `docs/reviews/` sibling: scope, method, findings, ranked candidates with a non-summing caveat, risks/limits, follow-ups, provenance | `intra-session-efficiency-review-2026-08-14.md` structure | Followed, including the "these rows do not sum" discipline |
| Named downstream consumers | long-tail bounding (run review §8 / LIN-2112 F7), LIN-2114 harness contract, LIN-1085 tiering evals | `capacity-test-run-review-2026-08-14.md:221-237`, LIN-2114, LIN-1085 | §9 addresses each by name with a bounded recommendation |

### 3.1 Adversarial review of the audit

*What sibling studies would a search have surfaced that the ticket did not name?* Searching the
workspace for the **concepts** rather than the identifiers (`compaction`, `context window`,
`distill`, `handoff`, `minimal context`, `tiering`, `token budget`, `long tail`, `eval`) surfaces
four the ticket does not mention, all of which bear on this one:

- **LIN-1861 — "Reverse ablation: measure which prompt directives each model tier still needs."**
  The closest methodological sibling in the workspace, and the one most at risk of duplication: it is
  an ablation over *prompt directives* per tier, using `docs/prompt-change-validation.md` §5's
  harness. This study is an ablation over *task context* per leg. They share a method and do not
  overlap in subject — but LIN-1861 should adopt §4.3's result (a site pointer is worth 2.2× in
  cost), and this study adopts LIN-1861's framing that the answer is never "delete 80%" but
  "density as a function of the resolved model".
- **LIN-1591 — orchestrator poll loops, 15% of spend, measured over 73 sessions (write-up on
  LIN-1236).** Prior art for the cost identity used here, and an already-measured instance of exactly
  the pathology this study generalises: context carried while producing nothing. Its "worst single
  case — re-read a 208k context 119 times, largely to wait, $16.12 to sit still" is the same shape as
  §7's beat-boundary finding.
- **LIN-816 — "Research our context length usage"** (Backlog): carries the Chroma *context-rot*
  evidence that every frontier model degrades with input length at constant task complexity. That is
  the **quality** argument for compaction, which this study's cost argument does not supersede and
  should not be read as replacing.
- **LIN-1150 — "Roll-on sessions"** (Todo): proposes *continuing* a session across a leg boundary
  rather than starting fresh, to "get more out of the LLM's abilities". This is the direct
  counter-hypothesis to compaction and this study bears on it — see §7.3.

*What duplicate sources of truth exist?* Two. (a) LIN-2112's analyzer inlines a copy of the pricing
table; this study's tooling inlines the same three rates, so a third copy now exists on the same
machine — same standing limitation, same reason (CommonJS scripts against an ESM module), disclosed
not filed. (b) The dispatch prompt and the ticket description both carry the task specification; §4.1
measures the prompt, not the description, and the two can drift.

*What failure paths were not exercised?* The probes only ever ran the happy path of a leg that
*succeeded*. Legs that failed, stalled, or were re-dispatched (the 108 process-repetition items the
run review priced at $111.73) are not represented; a distillate's behaviour under a wrong or stale
handoff is unmeasured and is the largest unexplored risk in the compaction design.

*Why is the layer set complete?* It is not claimed to be. It covers every layer the ticket named plus
the four siblings above. The search that would surface an omitted sibling is the concept search
reproduced at the head of this section; running it again for `roll-on`, `context rot`, `re-grounding`
and `orientation tax` adds LIN-1235 and LIN-824 (prior wall-clock research on the re-grounding tax),
which are upstream of LIN-1591 and are covered by citing it.

---

## 4. E2 — minimal-handoff probes

### 4.1 The first result came before any probe ran: the handoff already exists, and it is ~1,000 tokens

Every hook-substrate leg is handed a task prompt through the dispatch API. That prompt **is** a
distillate — a plan leg's hindsight-minimal summary written for an implementation leg. Its size is
recoverable from the transcript (the `/dispatch/{id}/prompt` tool result), which makes the
already-existing between-leg distillation directly measurable for the first time.

Across the **124 of 160** legs whose dispatch prompt is recoverable — median tokens, `bytes/4`;
"task" excludes the auto-appended workspace-API access block, which is harness boilerplate, not task
context:

| leg kind | n | med task-prompt tok | med full-prompt tok | med window/turn | carried ÷ handed |
|---|--:|--:|--:|--:|--:|
| implementation | 26 | 1,013 | 1,494 | 193,326 | **190.8×** |
| bug | 2 | 1,202 | 1,683 | 192,125 | 159.8× |
| research | 15 | 1,255 | 1,731 | 149,408 | 119.1× |
| plan | 23 | 1,096 | 1,577 | 132,829 | 121.2× |
| plan-review | 18 | 1,105 | 1,586 | 98,356 | 89.0× |
| review | 23 | 1,143 | 1,624 | 93,664 | 81.9× |
| close-out | 10 | 987 | 1,468 | 84,918 | 86.0× |
| autopilot | 2 | 234 | 234 | 245,065 | 1,047× |
| observer/custom | 1 | 254 | 254 | 360,645 | 1,420× |

Singletons omitted from the table (scoping n=1, 87.7×; triage n=1, 102.3×; design n=1, 181.1×;
blocked n=1, 100.3×) — 4 legs, 120+4 = 124.

The right-hand column is **not** the efficiency ceiling — a leg must read code the prompt does not
contain, so the denominator is not C\*. It is the ratio of *derived working state* to *stated task*,
and it says the specification is a rounding error against the exploration residue. The two
coordination kinds sit two orders of magnitude worse than any work kind, which is the quantitative
form of LIN-2114's argument.

### 4.2 The decisive probe — LIN-2078, an implementation leg

**Subject.** `01c694bd` — LIN-2078 implementation, Sonnet 5, 77 turns, $4.28, median window 157,014,
peak 205,920. Landed as `d0274c4a` (3 files, +118/−1). Its production change is **two lines**: a
`if (child.abort === true) return null;` guard at the top of `buildWakeFollowUp`
(`lib/dispatch-wake.js`) and one observability-string extension (`lib/dispatch-store.js`).

**Natural checkpoints**, read off the transcript's own structure:

| CP | Turn | Window | Session state |
|---|--:|--:|---|
| CP0 | 8 | 53,006 | bootstrap "summarise this project" complete; real task not yet fetched |
| CP1 | 14 | 64,270 | task fetched, branch created, nothing read |
| CP2 | ~16 | 106,877 | search concluded — both edit sites located |
| CP3 | 29 | 136,200 | guard + tests written, verification not yet run |
| CP4 | 42 | 160,136 | beat 1 complete: code done, tests green, mutation-checked |
| CP5 | 66 | 191,085 | PR open, CI in flight |

**The ladder.** Each rung is a distillate handed to a fresh session in a worktree reset to
`04acdb20` (the leg's true base), with the landed `tests/unit/dispatch-wake.test.js` swapped in
afterwards as the verifier. The pre-state fails it 5/43; the true post-state passes 43/43.

| Rung | Checkpoint modelled | Task ctx (tok) | Model | Verifier | Turns | Cost | Probe med window |
|---|---|--:|---|---|--:|--:|--:|
| R0 — as dispatched | CP1 | 878 | haiku-4.5 | **43/43** | 43 | $0.781 | 110,381 |
| R1 — requirement + site | CP2 | 239 | haiku-4.5 | **43/43** | 16 | $0.357 | 92,088 |
| R1 (replication k2) | CP2 | 239 | haiku-4.5 | **43/43** | 30 | $0.491 | 93,764 |
| R1 (replication k3) | CP2 | 239 | haiku-4.5 | **43/43** | 18 | $0.334 | 87,031 |
| R1 — same rung, better model | CP2 | 239 | sonnet-5 | **43/43** | 23 | $1.583 | 116,372 |
| R1 — CLAUDE.md removed | CP2 | 239 | haiku-4.5 | **43/43** | 20 | $0.276 | 60,023 |
| R2 — requirement only, no site | CP1′ | 146 | haiku-4.5 | **43/43** | 51 | $0.783 | 98,277 |

Every rung passed, including all three R1 replications (**3/3**, median $0.357, median 18 turns,
spread $0.334–$0.491 and 16–30 turns). **A 239-token handoff and an 18-turn Haiku session reproduced
a verified outcome that cost 77 turns and $4.28 to produce the first time.** The produced diff was
not merely outcome-equivalent: R1-haiku emitted `if (child.abort === true) return null;` at the same
position in the same function, with its own 69-line regression block (the landed one is 105 lines).

### 4.3 C\*-output vs C\*-search, made empirical

R1 and R2 differ by one sentence — R1 names `buildWakeFollowUp` in `lib/dispatch-wake.js`, R2 does
not — 93 tokens.

| | R1 (site named, k=3) | R2 (must search, k=1) | Δ |
|---|--:|--:|--:|
| Task context | 239 tok | 146 tok | −93 tok |
| Turns | 18 (median; 16–30) | 51 | **2.8×** |
| Cost | $0.357 (median; $0.334–$0.491) | $0.783 | **2.2×** |
| Cumulative cache-read | 1.31M (best run) | 4.80M | **3.7×** |
| Verifier | 43/43, 3/3 runs | 43/43 | — |

This is the ticket's C\*-output / C\*-search distinction, priced: **93 tokens of hindsight bought a
2.2× cost reduction at identical verified outcome**, and R2's single run cost more than the *worst*
of R1's three, so the gap survives R1's replication spread. It also bounds what compaction can and
cannot do — compaction at the point search concludes captures this 2.2×; nothing recovers it for a
session that must still search.

### 4.4 Conventions are not part of C\* for a localized change

Removing `CLAUDE.md` from the fresh session's reach (26k tokens of the LinearViewer file; the probe's
turn-1 window fell 54,547 → 26,780) left the verifier result unchanged at 43/43 and cut cost 23%
($0.357 → $0.276) and peak window 28% (108,146 → 77,673). For this task the repo conventions file was
**pure carry**. This is the direct experimental test of LIN-2112's candidate 3 (CLAUDE.md carry,
$69.80/day, 5.0%), which was an insertion-point estimate; it now has one confirming probe. It is a
single localized task and does not license dropping CLAUDE.md generally — see §9's bounded form.

---

## 5. E1 — bounded hindsight ablation

Three completed tasks, all implementation legs with landed regression suites, all verified
discriminating on their true pre/post states (§2.3). Cheapest tier first (Haiku 4.5), escalating only
on failure.

### 5.1 LIN-2045 — a three-line threading fix

Landed `04acdb20`: `providerUi` read from the resolved row's own binding rather than the active
provider, at three call sites in `routes/workspace-api.js` (+3/−3), plus a 309-line test file.
Real leg `56f75275`: Sonnet 5, 113 turns, **$11.52**, median window 212,694, 117 minutes.

A 220-token requirement+site distillate on Haiku 4.5: **5/5 verifier, 10 turns, $0.258, 63 seconds**,
and a diffstat of `routes/workspace-api.js | 6 +++---` — byte-for-byte the landed production change.

### 5.2 LIN-2065 — an algorithm-shaped change, and the rung that failed

Landed `c4a22a32`: replace the Journey trail's absolute-polar placement with a server-side
heading-inertia cumulative walk (`lib/ship-journey.js` +143, plus client, server, CLAUDE.md).
Real legs `29edf790` (127 turns, $6.64) and `f19df08f` (87 turns, $4.44) — **$11.08** combined,
median window 193,326.

| Rung | Task ctx (tok) | Model | Verifier |
|---|--:|---|---|
| R1 — requirement + site + 6 behavioural clauses | 595 | haiku-4.5 | **15/18 — FAIL** |
| R1 — same | 595 | sonnet-5 | **15/18 — FAIL** |
| R1b — R1 + 3 clauses closing the identified gaps | 760 | haiku-4.5 | **14/18 — FAIL** |

The three R1 failures were identical across tiers, which is the informative part: **this was not a
model ceiling, it was a specification gap.** The failing assertions pin (a) that a direct N→S
reversal must take multiple bounded-turn steps and never snap heading straight across in one flip,
(b) that a segment break resets both heading and position to a fresh berth (starting at `x=0`), and
(c) that a non-placeable waypoint carries no `x`/`y` **key at all**. None was stated in R1; two of
the three are representation contracts rather than behaviour (§2.3), so the verifier here is
over-strict relative to "equivalent deliverable".

R1b added exactly those three clauses (+165 tokens). It closed exactly **one** of them — the
segment-break assertion passed — while the reversal-arc and placeable-projection assertions R1 had
already failed **stayed failing**, and two assertions R1 had passed newly broke (one-unit spacing,
and the out-of-vocabulary bearing): 1 closed, 2 still failing, 2 newly broken, landing at **14/18**
(down from 15/18). **The bisection did not converge within the spend cap — it moved backward.** The
honest reading is not "C\* is between 595 and 760 tokens" but rather: for an algorithm-shaped change
with a representation-pinning suite, adding specification prose is not monotone — a longer distillate
produced a *different* wrong implementation, not a closer one. C\* for this task is **above 760
tokens of specification** and was not located.

**This is the study's clearest negative result, and it bounds the compaction claim.** Localized
changes (LIN-2078, LIN-2045) compact to a few hundred tokens with a verified outcome. An
algorithm-shaped change does not, at least not by prose specification alone, and a compaction design
that assumes it does will silently produce plausible-but-wrong work on exactly the legs that are
hardest to check.

### 5.3 Tier was not the C\* lever on any *work-shaped* leg — but it separated the judgement-shaped one

| Task | Kind | Distillate | Haiku 4.5 | Sonnet 5 |
|---|---|--:|---|---|
| LIN-2078 | implementation | 239 tok | 43/43 (3/3 runs), $0.357 | 43/43, $1.583 (**4.4× the price, same outcome**) |
| LIN-2045 | implementation | 220 tok | 5/5, $0.258 | not run (no failure to escalate) |
| LIN-2065 | implementation | 595 tok | 15/18 | 15/18 (**the same three assertions**) |
| LIN-2065 review | review | 476 tok | missed the site, 5 turns | found the mechanism, 27 turns (§6.2) |

For localized changes the cheap tier is sufficient and the expensive tier buys nothing. For the
algorithm-shaped change the expensive tier did not rescue an under-specified handoff. **On the
implementation legs, C\*'s model-relativity was real in principle but never the binding constraint —
specification completeness was.** The review probe is the counter-case and the caution against
generalising: there the tiers were not substitutable at any context size tried.

---

## 6. The context-efficiency ceiling, per leg kind

**Definitions used.** *Actual-carried* **A** = the leg's median per-turn context window (LIN-2112's
§2 quantity, the one F1 says drives cost). *C\* upper bound* **Ĉ** = the fresh probe session's median
per-turn window when it passed the verifier — an upper bound, because the probe still carried a full
harness preamble and its own dead ends. Since Ĉ ≥ C\*, **A/Ĉ ≤ A/C\*: every ratio below is a floor on
the true ceiling, never an estimate of it.**

Two readings are given: *gross*, on the whole window, and *net*, after subtracting each session's own
turn-1 harness preamble (the system prompt + tool schemas + auto-loaded files, which no compaction
scheme can remove).

| Leg kind | Task | A gross | Ĉ gross | **Ceiling ≥** | A net | Ĉ net | **Ceiling ≥ (net)** |
|---|---|--:|--:|--:|--:|--:|--:|
| implementation | LIN-2078 | 157,014 | 92,088 | **1.7×** | 116,920 | 37,541 | **3.1×** |
| implementation | LIN-2078 (no CLAUDE.md) | 157,014 | 60,023 | **2.6×** | 116,920 | 33,243 | **3.5×** |
| implementation | LIN-2045 | 212,694 | 91,793 | **2.3×** | 172,616 | 37,293 | **4.6×** |
| implementation | LIN-2065 | 193,326 | *no passing rung — §5.2* | — | 153,236 | — | — |
| review | LIN-2065 review | 99,959 | *verifier invalid — §6.2* | — | 71,194 | — | — |
| plan · plan-review · research · close-out · autopilot · observer | — | measured, §4.1 | **no valid verifier** | **not measured** | — | — | — |

**The headline, stated conservatively: the measured floor on the implementation-leg context-efficiency
ceiling is 2.3–4.6×, on two of three tasks.** The ticket's hypothesised C\*-output of 20–30k tokens
would put the true ceiling at **5–8× net**; nothing measured here contradicts that, and the probes'
own residual (an 18-turn session still carrying ~37k of task context to emit two lines) suggests the
true figure is nearer the upper end. The third task reached no passing rung at all, which is the
countervailing evidence and is not averaged away.

**The cost ratio is much larger than the context ratio, and it is the operationally relevant one**
(probe figures are the k=3 median where replicated):

| Task | Real leg | Probe (verified equivalent) | Ratio |
|---|--:|--:|--:|
| LIN-2078 | $4.28 (77 turns) | $0.357 (18 turns) | **12.0×** |
| LIN-2078, code-production segment only (turns 1–42) | $1.52 | $0.357 | **4.3×** |
| LIN-2045 | $11.52 (113 turns) | $0.258 (10 turns) | **44.6×** |
| LIN-2065 | $11.08 (214 turns, 2 legs) | *no passing rung* | — |

The gap between 1.7× on carried context and 12–45× on cost is the whole point: **cost is carried
context × turns × tier**, and compaction attacks only the first factor. The probes shrank all three
at once, which is why they are not a like-for-like measurement of compaction alone. §7 separates
them.

### 6.1 Scope caveat on the cost column

The real legs did work the probes did not: branch hygiene, commit, push, PR, CI polling, and a Linear
comment. For LIN-2078 that is turns 43–77, priced at **$2.76 of the leg's $4.28 (64%)**. The
code-production row above is the like-for-like comparison; the full-leg row is the real invoice.
Neither is wrong, and they must not be conflated.

### 6.2 The one review-leg reading — and the verifier that failed

**Design.** The real review leg for LIN-2065 (`d08a0a97`, Opus 5, 54 turns, **$4.47**, median window
99,959) reviewed PR #1126 and produced finding **F1**: `derivePositions` carried an out-of-vocabulary
bearing straight into `heading`, so one unknown bearing would `NaN`-poison every later waypoint in
the segment. That finding landed as a second commit inside `c4a22a32`. The probe reconstructs the
exact pre-F1 state and asks a fresh session to review it, with ground truth "does it find F1".

**Two things went wrong, and both are findings.**

*First, the probe leaked its own answer.* The first pair of runs was built by reverting the F1 guard
in a worktree at `c4a22a32` — which left the landed **docstring** ("An out-of-vocabulary bearing …
holds the current heading steady … (review F1, LIN-2065)") and the landed **test** named after the
defect still in the tree. Haiku 4.5 found F1 in 17 turns and $0.330, quoting the docstring back as
its evidence. That result is void. It is also a live demonstration of
`docs/prompt-change-validation.md` §5's "don't pre-solve the evidence" rule: the same model, the same
tier, the same task, differs completely on whether the answer was already in context. Both runs are
kept in the bundle, the first labelled void.

*Second, on the de-leaked state, the verifier itself turned out to be invalid.*

| Run | Model | Turns | Cost | Med window | Outcome |
|---|---|--:|--:|--:|---|
| REV-A (void — answer in tree) | haiku-4.5 | 17 | $0.330 | 79,777 | found F1, quoting the docstring |
| REV-B | haiku-4.5 | 5 | $0.256 | — | **Missed it.** Reported a different (client-side `cx="undefined"`) concern instead |
| REV-B | sonnet-5 | 27 | $1.721 | — | Found the **exact mechanism**, then argued it unreachable and reported *no defects* |

Sonnet's argument was that `routes/workspace-api.js`'s `normalizeBearings` drops any non-archived
orientation entry whose bearing is outside the 8-point vocabulary before persistence, and that
`lib/ship-journey.js` excludes archived entries from candidate readings — so no unmapped bearing can
reach `derivePositions`. **Checked by hand against the source: it is right.** `normalizeBearings`
drops `!valid && !archived` (`routes/workspace-api.js:3337-3339`), and the candidate-reading walk
requires `!entry.archived && entry.identifier && entry.bearing` (`lib/ship-journey.js:123`).

So the real review's F1 was a **defensive** finding — a guard against a state the upstream filter
already prevents, preserving the old `toXY`'s `(wp.angle || 0)` posture — not a live-reachable bug.
Which means **"did the fresh session find the defect the real review found" is not a valid verifier**,
because a correct review can legitimately decline to file a defensive finding. It is graded *invalid*
retrospectively, not merely limited.

**What can still be said:** no C\* was measured for review legs, and the attempt produced evidence
running the *other* way — the cheap tier reviewed shallowly (5 turns) and missed the site entirely,
while the tier that engaged properly cost $1.72 against the real leg's $4.47 for a 54-turn Opus
session. Review legs are the kind where compaction is least supported by this study's evidence, and
§9 does not recommend it for them.

---

## 7. Within-leg compaction points

What the probes establish, and what they do not. Nothing below is claimed beyond its evidence.

### 7.1 Safe, with direct evidence

**CP0 — the end of the bootstrap segment.** Every hook-substrate leg opens with a "Summarise this
project briefly" turn before the real task arrives. Measured across the **148** legs with an
identifiable bootstrap segment: **$76.79 of those 148 legs' own $1,369.87 subtotal (5.6%)**, median 8
turns, leaving a median **11k–21k tokens** resident that then rides every remaining turn of the leg.
$1,369.87 is *not* the day total — it is the subtotal of only the legs a bootstrap segment could be
identified in. Against LIN-2112's whole-session day total ($1,398.19, the basis its own candidate
percentages use), the same $76.79 is **5.5% of the day** — the figure §9.1 rec 5 compares against
LIN-2112's candidates for commensurability.

| leg kind | n | med bootstrap turns | med bootstrap $ | bootstrap share of kind | med residual ctx |
|---|--:|--:|--:|--:|--:|
| implementation | 26 | 8 | $0.25 | 2.8% | 11,031 |
| review | 24 | 8 | $0.55 | 15.0% | 18,781 |
| plan-review | 18 | 8 | $0.56 | 15.4% | 19,031 |
| close-out | 15 | 12 | $0.70 | 15.0% | 18,303 |
| plan | 24 | 8 | $0.24 | 7.2% | 17,615 |
| research | 15 | 8 | $0.58 | 5.0% | 21,208 |
| autopilot | 13 | 10 | $0.60 | 3.7% | 19,133 |
| observer/custom | 6 | 14 | $0.81 | 1.3% | 19,314 |

Singletons/small-n rows omitted from the table (scoping n=1 $0.62, 31.1%; triage n=1 $0.48, 31.3%;
design n=1 $0.36, 7.3%; blocked n=2 $0.77 combined, 19.9%; bug n=2 $2.25 combined, 7.1% — $4.48
combined) — 7 legs, 141+7 = 148. Note that scoping and triage carry the **two highest** bootstrap
shares of any kind measured (31.1%, 31.3%), ahead of every row in the table above; they are omitted
here only because n=1 makes the median unstable, not because the effect is small.

The evidence that this is *safe* to discard is direct, and it is the study's best-supported safety
claim: **all twelve** task-executing probes in §4–§5 ran with **no** bootstrap segment at all, and
every one of the eight on a localized change passed its verifier (LIN-2078 across four context rungs,
two tiers and three replications; LIN-2045 first time, byte-identically). The four that failed
(LIN-2065, §5.2) failed on *specification* content, not on missing project orientation — the same
three assertions failed at both tiers, and adding orientation was never what the failing rungs
lacked. The bootstrap's stated purpose — orientation — was not load-bearing for any measured outcome.
Note the asymmetry: it is only 2.8% of an implementation leg but **15%** of the short
review/plan-review/close-out kinds, where it is a fixed cost against a small job.

**CP2 — the moment search concludes.** §4.3 prices the difference at 2.2×. A session that distils to
its located sites and intended change at that moment, and drops the exploration residue, is provably
still able to emit the answer, because a fresh session given exactly that distillate does.

**CP4 — a beat/step boundary.** LIN-2078's leg is a two-beat stepped implementation. Beat 2 (turns
43–77: commit, push, PR, poll CI, post one comment) cost **$2.76 — 64% of the whole leg** — while
carrying beat 1's full 160k context. Beat 2's own C\* is a branch name, three file paths, a ticket id
and a PR number. This is the largest single measured compaction opportunity in the study, and it sits
at a boundary the harness **already knows about**, because it is the harness that fed the beat.

### 7.2 Unsafe, or unproven

- **Mid-verification (LIN-2078 turns 30–41).** The mutation check — revert the guard, prove the tests
  fail, restore — needs the diff, the test state, and the exact command outputs simultaneously. No
  probe tested compaction here and none should be claimed.
- **Any compaction on a leg that is failing, stalled, or re-dispatched.** Not measured at all (§3.1);
  a distillate built from a wrong intermediate state is the obvious failure mode and this study has
  no evidence about it.
- **Compaction for quality rather than cost.** LIN-816's context-rot evidence argues shorter context
  is also *more reliable*. This study measured cost, not accuracy, and cannot corroborate that.

### 7.3 What this says to LIN-1150 ("roll-on sessions")

LIN-1150 proposes the opposite move — continue a session across a leg boundary rather than start
fresh. The probes bear on it directly and the answer is not symmetric: continuing a session **retains
the derived working state** (which §4.1 shows is 82–191× the size of the stated task) and its cost is
paid on every subsequent turn. A roll-on across a boundary should therefore carry a **distillate**,
not the raw tail — which is what the dispatch prompt already is. The measured case *for* roll-on is
the 2.2× search cost (§4.3): a fresh leg that must re-locate what the previous leg already found pays
it again. Both effects are real; the resolution is roll-on **with** compaction, not roll-on instead of it.

---

## 8. Bounded re-run spend

Cap set before E2 began: **$25**. Actual: **$12.51 across 17 fresh sessions** (50% of cap). Every
figure is `total_cost_usd` as reported by the headless runner at first-party API rates — not an
estimate.

| Group | Runs | Spend |
|---|--:|--:|
| Mechanism test (verify the runner reports usage) | 1 | $0.019 |
| E2 — LIN-2078 ladder (R0, R1, R2, R1-sonnet, R1-noCLAUDEmd) | 5 | $3.780 |
| E2 — LIN-2078 R1 replications (k2, k3) | 2 | $0.826 |
| E1 — LIN-2045 | 1 | $0.258 |
| E1 — LIN-2065 (R1 haiku, R1 sonnet, R1b ×2) | 4 | $4.489 |
| Review-leg probe — REV-A (void, answer leaked into tree) | 2 | $1.158 |
| Review-leg probe — REV-B (de-leaked) | 2 | $1.977 |
| **Total** | **17** | **$12.507** |

Two efficiency notes on the method itself, both reusable:

- **Cheapest-tier-first is the right ordering and it paid.** 12 of 17 runs were Haiku 4.5; escalating
  to Sonnet only after a Haiku failure kept the bill at half the cap while still answering the tier
  question on both tasks where it mattered.
- **$4.49 of the $12.51 — 36% — went on LIN-2065, the task with no passing rung.** That is the
  expected shape of an ablation: the cell that does not converge is the expensive one. Reported rather
  than trimmed, because a spend table that only shows successful cells understates what the next
  study should budget.

Not counted here: this research session's own cost, which is the study's overhead, not its re-run
spend. Transcript-side figures elsewhere in this document are priced from `lib/model-pricing.js` and
carry LIN-2112 F3's unfixed `[1m]` cache-write understatement (+18.2%); the probe figures above are
the runner's own and do not.

---

## 9. Recommendations

### 9.1 For the long-tail bounding design (run review §8 / LIN-2112 F7 — $436/day, 31.2%)

1. **Rank checkpointing above turn-capping.** LIN-2112 F7 identifies the long tail as the largest
   pool; this study says *why* it costs what it does — a long session pays its whole accumulated
   context on every additional turn. A turn cap truncates work; a checkpoint that re-seeds a fresh
   session from a distillate keeps the work and drops the carry. The probes are an existence proof
   that the re-seed lands: a 239-token handoff reproduced a $4.28 leg's verified outcome.
2. **Take the beat boundary first.** It is already instrumented (the harness feeds the beat), it is
   the biggest measured single point (64% of one leg), and it needs no new judgement about *when* to
   compact.
3. **Drop the bootstrap segment for the short leg kinds first.** 15% of a review, plan-review or
   close-out leg, with direct evidence of safety, and no compaction machinery needed at all — it is a
   launch-shape change.
4. **Scope the compaction claim to localized work, and make the design fail loudly outside it.**
   LIN-2065 (§5.2) is the counter-example: an algorithm-shaped change did not compact to prose at 595
   or 760 tokens, and the longer distillate produced a *different* wrong implementation rather than a
   closer one. A checkpoint scheme that compacts indiscriminately will do its worst damage on exactly
   the legs whose output is hardest to check. Whatever the design, it needs a verifier at the re-seed
   boundary — which for implementation legs the repo already has, in the leg's own test suite.
5. **Do not sum these with LIN-2112's §5 candidates.** Same tokens, different slice. The bootstrap
   figure (5.5% of LIN-2112's whole-session day total, the same $1,398.19 basis its own candidates
   use — 5.6% against these 148 legs' own subtotal, see §7.1) overlaps candidate 2 (preamble diet)
   and candidate 1 (long tail).

### 9.2 For LIN-2114's harness contract (observation-type sessions → a simpler cloud harness)

The observer/custom and autopilot kinds carry **1,047× and 1,420×** their handed task specification
(§4.1) — one to two orders of magnitude worse than any work kind, and the quantitative form of
LIN-2114's own argument. Three contract requirements this study's evidence supports:

1. **The state summary is small, and the number to design against is ~1k tokens.** Every work leg is
   already driven from a ~1,000-token dispatch prompt (§4.1), and 239 tokens sufficed to reproduce a
   whole implementation leg. An observer's judgement-point payload should be budgeted in that range,
   not in tens of thousands.
2. **Judgement points must be stateless calls, not turns in a conversation.** The measured pathology
   is not that observers think — it is that every mechanical poll pays for the whole accumulated
   conversation. This is LIN-1591's already-measured finding ($16.12 to sit still in one session) and
   this study's §4.1 ratio agrees with it from a different direction.
3. **Budget the harness preamble explicitly.** In the probes, 26k tokens of the fresh session's
   window was the harness's own preamble before a single task token. A purpose-built harness that
   does not carry Claude Code's full tool schema starts ~26k ahead per call; that is a first-class
   design win, not an implementation detail.

### 9.3 For LIN-1085's tiering evals

1. **Add a context axis; a tier comparison at fixed context is measuring the wrong variable.** On
   both localized implementation tasks Haiku 4.5 matched Sonnet 5 exactly at 4.4× less cost, and on
   the algorithm-shaped one the tiers failed on the *same three* assertions. Specification
   completeness dominated tier at every size measured. The eval question "which model fits this task
   shape" should become "which (model, context) pair".
   **The exception is the leg kind LIN-1085 would most want to cut costs on.** On the review probe
   (§6.2) the tiers were not interchangeable at all: Haiku spent 5 turns and missed the site
   entirely; Sonnet spent 27 turns, found the exact mechanism, and traced the upstream filter that
   made it unreachable. Judgement-shaped legs separate the tiers where work-shaped legs did not — so
   a single per-kind default derived from implementation legs would be the wrong generalisation.
2. **Use landed regression suites as the verifier.** They are objective, they discriminate (verified
   on all three tasks), they cost nothing to run, and they remove the LLM-judge variance that
   `docs/prompt-change-validation.md` §5 has to work around. Where a suite pins representation rather
   than behaviour (LIN-2065, §5.2), say so — that is a finding about the suite.
3. **Haiku 4.5 is a credible default for localized implementation legs on this evidence** — two
   tasks, one with 3/3 replications, both producing the landed production change — **and is not a
   credible default for review legs** (§6.2). That is a hypothesis worth an eval, not a routing
   change.
4. **Coordinate with LIN-1861.** It is running the same instrument on the prompt-directive axis
   (§3.1); the two should share the harness rather than build two.

---

## 10. Risks and limits

1. **Small n, and k=1 on most cells.** Three tasks, one leg kind with a valid verifier, k=3 on one
   cell. `docs/prompt-change-validation.md` §5 requires replications; this study meets that on the
   decisive cell only. Treat every single-cell number as directional.
2. **One of three implementation tasks reached no passing rung, and one of two verifier designs was
   invalid.** LIN-2065 (§5.2) and the review probe (§6.2). A reading that takes only the LIN-2078 and
   LIN-2045 results is reading half the study.
3. **A probe leaked its own answer once (§6.2) and was caught only by reading the output.** The
   de-leak was manual — strip the docstring, strip the test named after the defect — and there is no
   automated check that a reconstructed pre-state does not contain its own solution. Any future run
   of this instrument needs one.
4. **Ĉ is an upper bound on C\*, so every ceiling is a floor.** Stated in §6 and repeated here
   because it is the easiest thing to misread in the other direction.
5. **The probes shrank context, turns and tier simultaneously.** The 12–45× cost ratios are not
   attributable to compaction alone. §6.1 and §7 separate what can be separated.
6. **The probe distillates were authored with hindsight, by design.** That is what "hindsight-minimal"
   means, but it means the ladder measures *sufficiency*, never whether a real session could have
   produced the distillate at that checkpoint unaided.
7. **Verifier scope.** The landed suites verify production behaviour, not the whole deliverable
   (§2.3). LIN-2065's suite is additionally over-strict.
8. **Non-implementation leg kinds have no C\* measurement at all.** §6's table says "not measured"
   rather than extrapolating, and that is the largest gap in this deliverable against the ticket's
   "per leg kind" ask.
9. **Bytes/4 token estimates** are used for distillate and dispatch-prompt sizes; window and cost
   figures are exact from the API's own usage accounting.
10. **The tooling inlines a third copy of the pricing table** (§3.1) — a standing limitation of the
    on-machine bundle, not an in-repo drift risk.
11. **The `[1m]` cache-write understatement (LIN-2112 F3, +18.2%) is unfixed** and applies to the
    transcript-side figures here exactly as it did there; the probe costs are the runner's own
    first-party figures and are unaffected.

---

## 11. Follow-ups

Two filed, both related to LIN-2115, neither implemented here (this ticket lands no harness or prompt
change):

- **LIN-2116** — *Drop the bootstrap "Summarise this project" segment for the short leg kinds.*
  $76.79/day (5.6%) measured across 148 legs, and **15%** of a review, plan-review or close-out leg.
  Carries §7.1's table and the safety evidence (12 task-executing probes across three tasks, none with
  a bootstrap segment; every one on a localized change passed its verifier). Research-then-change, per leg kind — not a blind
  deletion.
- **LIN-2117** — *Compact at the beat boundary: re-seed a stepped leg's next beat from a distillate.*
  Beat 2 of LIN-2078's leg was **64% of the leg's cost** carrying beat 1's context. Sits at a boundary
  the harness already owns, and is the concrete first cut at the long-tail pool.

Not filed, deliberately:

- **The over-strict assertions in `tests/unit/ship-journey.test.js`** (§5.2) — three of them pin
  representation (`!('x' in wp)`, an exact origin berth) rather than behaviour. Real, but it is a
  note about one suite, not a defect, and no consumer is harmed. Recorded here.
- **A third copy of the pricing table** in this study's on-machine tooling (§3.1) — the same standing
  limitation LIN-2112 disclosed rather than filed, for the same reason (no in-repo drift risk).
- **A duplicate of LIN-1861** — its reverse-ablation on prompt directives shares this study's
  instrument and should adopt §4.3's result, but it is not the same subject and does not need a new
  ticket (§3.1).

---

## Provenance

- Archive: `~/harbour-transcript-archives/claude-transcripts-2026-08-14.tar.gz`, SHA-256
  `8b97b13f6fead86a9208a714c58ca1c0d3eae19c239c7482d12b7fc6f4eee044` — **re-hashed this session and
  matching both LIN-2112's record and the ticket's own citation**; the 160 usage-bearing transcripts
  verified still present and readable at their recorded `~/.claude/projects/` paths.
- Staleness check (per the ticket's own re-grounding instruction): `git log` since the ticket's
  creation (2026-08-15T10:18:26Z) over `docs/reviews/`, `lib/model-pricing.js`, `lib/dispatch-wake.js`,
  `lib/dispatch-store.js`, `lib/ship-journey.js`, `routes/workspace-api.js` in Harbour and the whole
  of simple-dispatcher returns **no commits** — every code reference this study relies on is
  unchanged since the ticket was written, and all of it was read at HEAD rather than from the ticket
  prose.
- LIN-2112 measurement bundle reused for classification and per-session aggregates:
  `~/harbour-transcript-archives/lin-2112-measurement/sessions.json`.
- This study's tooling, distillates, per-probe run records, produced diffs and verifier outputs:
  `~/harbour-transcript-archives/lin-2115-measurement/` (dispatcher machine, not repo-tracked).
- Ground truth commits, all in `LinearViewer`: `d0274c4a` (LIN-2078), `04acdb20` (LIN-2045),
  `c4a22a32` (LIN-2065); bases `04acdb20`, `cdfa77dd`, `3d92408a`.
- Pricing: `LinearViewer/lib/model-pricing.js:78-86` at HEAD `4f328ba5`.
- Siblings this joins to: [`intra-session-efficiency-review-2026-08-14.md`](intra-session-efficiency-review-2026-08-14.md)
  (LIN-2112) and [`capacity-test-run-review-2026-08-14.md`](capacity-test-run-review-2026-08-14.md)
  (LIN-2087).
