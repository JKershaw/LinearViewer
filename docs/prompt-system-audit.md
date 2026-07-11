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

---

## Part II Appendix — Track-A baseline (first pull, 2026-07-10)

First outside-view silhouette, pulled live through the workspace proxy (`/dispatch` + feedback markers) and parsed with the repo's **own** `parseHeartbeats` (`lib/session-telemetry.js`) + `dispatch-terminal` helpers. **26 recent sessions; 21 did real tool work (≥3 tools); 13 terminal-done.** Tool-**count** silhouette only — no tokens, no file targets (that's Track B).

**Numbers**

- Orientation share (explore-class Read/Grep/Glob ÷ all *named* tools): median **18%**, range 0–38%.
- Read:edit ratio median **1.1**; the edit-bearing sessions (n=5) ran a median **11 tools before the first Edit**.
- **16/21 sessions did zero edits** — correctly: they're read-only / orchestration kinds (research, triage, review, close-out, plan, wake, periodical, autopilot).
- Tool mix: explore 63 · edit 39 · **Bash 197** · other 18.

**The headline finding is a limit — and it's the useful one.** **Bash is 62% of all tool calls, and a heartbeat can't say what a Bash call *did*** (git log = orientation? `npm test` = verify? a real change?). So the 18% orientation figure is a hard **lower bound** — most of the read-vs-work signal is hiding inside Bash, which the outside view cannot open. This is the first *measured* argument for Track B: the `<sessionId>.jsonl` transcripts carry the actual bash commands, file targets, and per-turn tokens that resolve exactly this ambiguity.

**What we can't yet claim.** The done-vs-not-done orientation split (21% vs 14%) is **confounded** — the not-done set is mostly orchestration/wake sessions with no edits, not failed work — so H1/H3 need the inside view and more edit-bearing sessions. Track A proved the join + parse work end-to-end and **sized the resolution wall**; it did not (and cannot) put a real number on the orientation *tax*.

**Triangulation note.** This is the **D2** dataset. When the JSONL lands, **D3** resolves the Bash 62% and **D1** (LIN-824's busy-span method) sits between — the three-way compare then tells us whether this cheap silhouette can stand in for the token truth.

---

# Part III — Track B / D3 results: the inside view (2026-07-11)

> The JSONL landed. This part opens the Bash box Track A couldn't, and puts a real
> number on the orientation tax. Method, code, and data are reproducible:
> `lib/transcript-spend.js` (pure, unit-tested) + `scripts/transcript-spend.mjs`.

## 12. Method — D3, built on the LIN-824 join

`scripts/transcript-spend.mjs` joins Harbour's dispatch records (kind + terminal
outcome, via the proxy) to each worker's own Claude Code transcript
(`<sessionId>.jsonl`) on the LIN-824 key — a dispatch item's feedback carries
`[working] Session launched (session: <8hex>…)`, whose prefix is the transcript
filename. `lib/transcript-spend.js` then classifies every `tool_use` into six
spend classes. The load-bearing move — the one Track A structurally could not
make — is **classifying Bash by its command**: dispatched sessions have **no
Grep/Glob tool** (verified: a `<tool_use_error>` "No such tool available: Grep"),
so all search routes through Bash `grep`/`find`, and git archaeology / file reads
/ tests all arrive as Bash. The classes:

- **ORIENT** — Read/LS; Bash `git log/diff/show/status/blame`, `cat/head/tail`, `grep/find`.
- **CORE** — Edit/Write/MultiEdit; mutating Bash (`git commit/add`, `mkdir`, `sed -i`).
- **VERIFY** — Bash matching the wall-clock CI signature (`npm test`, `node --test`, `playwright`, `tsc`, `gh pr checks`).
- **COORD** — `mcp__*`, `ToolSearch`, `WebFetch`, and proxy/api curls (the appended proxy-context block makes workers curl the proxy heavily — it is coordination, **not** task work, and must be excluded or it swamps everything).
- **SCAFFOLD** — pure `echo/cd/export` plumbing. **UNKNOWN** — unrecognised Bash (`python3` one-offs), kept distinct so it is never silently miscounted as orientation.

Orientation ratio is reported **three ways** (per the LIN-1235 decision): by
tool-**count** (comparable to Track A's 18%), by tool-result **bytes** (context
ingested — the "load" headline), and by the **output tokens** of the issuing
turns. Cross-session file identity is normalised to a repo-relative path
(`normalizeRepoPath`) because each session runs in its own `…-workspaces/<uuid>/`
clone — without that, the same file never matches across sessions (the H4 trap).

**Sample.** 156 dispatch items across all statuses; **39 carried a launch marker
and joined to a transcript** (the rest are aborts / wakes / pre-launch failures
with no worker session). **16 edit-bearing.** Outcomes: 31 done, 8 in-flight
(`taken`), **0 clean failures** — which bounds what we can claim (see H1).

## 13. Headline — the tax is real, and Track A undercounted it ~4×

| Orientation ratio (median) | by count | by result-bytes | by output-tokens |
|---|--:|--:|--:|
| all joined sessions (n=39) | 36% | **50%** | 33% |
| edit-bearing only (n=16) | 39% | **68%** | 37% |

**By the measure that matters — context ingested (result-bytes) — a median
edit-bearing worker spends 68% of everything it reads on orientation.** Track A's
count-based 18% was a hard lower bound, exactly as predicted; opening the Bash box
and weighting by load roughly **quadruples** it. The reason the three lenses
diverge so hard is itself the finding: **orientation tools return large payloads
(a Read, a `git log`, a `cat`) while edits return a tiny `"ok"`** — so by
tool-count orientation looks like a third of the work, but by *bytes pulled into
the context window* it's two-thirds. And the context window is the scarce
resource: across the corpus, **input+cache tokens outweigh output 100:1** (241.7M
vs 2.39M). Optimising output tokens (Part I's instinct) polishes the 1%; the
orientation re-reads fill the 99%.

## 14. Hypothesis verdicts

- **H2 — orientation dominates early spend. ✅ CONFIRMED.** Edit-bearing sessions
  run a **median 15 tools before the first Edit** (implementation: 5–19). The
  session front-loads re-grounding; productive change starts a long way in.
- **H4 — cross-session duplication is real. ✅ CONFIRMED, strongly.** Six issues
  in the sample were worked by ≥2 sessions (full arcs:
  research→plan→impl→review→close-out). After path-normalisation, the **median
  later session re-reads 100% of the repo files a prior same-issue session already
  read**. Every dispatch re-grounds the same file-set from zero — precisely the
  Part I §4 #1 duplication, now measured. (Caveat: some later sessions have small
  read-sets, which inflates a share metric; the *direction* — near-total repeat —
  is unambiguous.)
- **H3 — determinism pays. ◐ PARTIAL / directional.** Orientation-by-bytes tracks
  kind in the way the determinism thesis predicts: it is **highest where fresh
  re-grounding is unavoidable** — research **80%**, periodical 69%, plan **60%**,
  implementation **57%** — and lowest where the work is writing or coordinating,
  not reading: close-out **11%**, triage 18%, autopilot 14%. So the tax
  concentrates exactly in the kinds a snapshot-diff would help. We cannot yet close
  the *outcome* half (facts-present → cleaner completion) — see H1.
- **H1 — correctness tracks complexity, not prompt size. ⚠️ UNTESTED here.** The
  joined set has **zero failed worker transcripts** (31 done, 8 in-flight), so the
  outcome axis has no contrast — the same confound Track A flagged, not yet
  resolved. Needs a sample that deliberately includes failed/looping runs. What we
  *can* see: **rework concentrates in implementation** (mean 6.8 repeat-edits/
  session, tail to 22), invisible in the whole-sample median (0%, dragged down by
  read-only kinds) — a complexity signal worth pursuing when failures are in-set.

## 15. The prize — the cheap signal does NOT predict the truth

The two-track bet was: run D2 (heartbeat silhouette) continuously, recalibrate
with D3 (JSONL) periodically. **For orientation, that bet fails.** D2's onboarding
share vs D3's orientation ratio, across the 39 sessions:

| D2 onboarding-share vs D3 orientation… | Pearson r |
|---|--:|
| …by count | **−0.43** |
| …by result-bytes | **−0.50** |
| …by output-tokens | −0.20 |

Not just uncorrelated — mildly **inversely** correlated. The mechanism is
structural: `decomposeEffort`'s "onboarding" only counts heartbeat intervals
**before the first tool runs** (the cold project-summary prep). But the real
orientation tax is **mid-session re-grounding** — re-reading source, `git log`,
`grep` *interleaved with* edits — and every one of those intervals has a tool
completing in it, so D2 files them as "active," not onboarding. **The cheap
outside-view silhouette is blind to exactly the cost this study is about.** You
cannot measure the orientation tax from heartbeats; you need the transcript, or
new token-level instrumentation.

## 16. The determinism shortlist, re-ranked by *measured* tax (feeds LIN-1153)

1. **Wire `task-snapshot-store.diffLatest` into prompt-gen + a git-HEAD dimension
   (Part I rec #1).** Now the top move on evidence, not just argument: orientation
   is 57–80% of context bytes in research/plan/impl, and H4 shows the re-read is
   100%-duplicated across a task's sessions. Gate the re-grounding on a real
   change and this is the single largest measured tax.
2. **Task-scoped "already-grounded" manifest (new, elevated by H4).** A
   research→plan→impl→review→close-out arc re-reads the same files 5× from zero.
   Carry a per-task file-ground set forward across dispatches so a later session
   re-reads only what *changed*. This is the cross-session complement to #1.
3. **Token/turn instrumentation on the feedback markers (LIN-817) — now
   necessary, not optional.** §15 proves the orientation tax is unmeasurable from
   the current outside view. Emitting per-marker token/tool-class counts is the
   only way to run this continuously in production; it turns this one-off study
   into a standing instrument. Sequenced with LIN-1114 (full-transcript ingest).
4. **Request-scoped context memoization (Part I rec #2).** Unchanged; independent
   of the worker-side tax but real.
5. **§3 redundant-prose deletions.** Still cheap and correct, but now known to be
   *low* measured tax — do them for the drift-risk hygiene, not the tokens.

## 17. Caveats

Small N (39 joined, 16 edit-bearing), done-heavy (H1 untestable without failures),
single 4-day window, one workspace. Orientation classification is
command-heuristic (a `python3` one-off lands in UNKNOWN, not ORIENT — conservative).
H4's share metric is inflated by small read-sets though its direction is robust.
Result-bytes ≈ tokens×4, directional. This is correlation to steer priorities, not
proof — but the top three shortlist moves now rest on measured load, and the
calibration question (§15) is answered cleanly in the negative.
