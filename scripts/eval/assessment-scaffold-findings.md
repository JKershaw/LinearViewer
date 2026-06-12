# Assessment-scaffold spike — findings

**Question.** Does the meta-prompt's 3-bullet Reasoning scaffold (`Preparation /
Blockers / Ready`) bias routing toward the implement-funnel and under-serve the
types it has no slot for — `review` (Step 0), `defer`/`breakdown` (Step 4),
`triage` (vague fallback)? And does broadening the scaffold fix it?

**Harness.** `scripts/eval/assessment-scaffold-spike.mjs` — builds the prompt from
the LIVE template per case and swaps ONLY the Assessment block per arm, so any
delta is attributable to the scaffold. Grades the `→ **action**` line
deterministically. Model `openai/gpt-5.4-mini` (prod default), temp 0. Leaf scope
(`defer` is node-shaped and not exercised — same boundary as
`eval-research-routing.mjs`).

Two runs: an exploratory 4-arm pass (K=3, 10 cases) and a confirmation pass of the
two finalists (K=5, 12 cases — a second `triage` and `breakdown` case added).

## Verdict: do NOT broaden the scaffold

The original hypothesis is **disconfirmed on both synthetic AND real large tasks**,
and no scaffold variant is a reliable win once run-to-run variance is controlled.
Recommendation: leave the Assessment block as-is. The durable routing weakness this
surfaced lives elsewhere (see "The real signal" below).

> **Headline for the realism question (asked after the synthetic runs): does larger,
> real task text sharpen the difference?** It looked like it at K=3 — then washed out
> at K=5. The apparent effect was variance concentrated in a handful of cases, not a
> scaffold effect. See "Real-data runs" below.

### 1. `review` is not crowded out

`review` routed correctly **10/10 on baseline** (both the terminal-Done leaf and the
landed-but-In-Progress leaf), tied by every variant. Step 0 (rendered when the state
is terminal) and the Step-3 landed-branch already cover this at the leaf. There is no
review deficit for a broadened scaffold to fix.

### 2. Broadening with more bullets is actively worse

Exploratory pass (K=3) overall accuracy: baseline **87%**, `disposition` 93%,
`broadened` **83%**, `completion-first` **80%**. Adding `Completion` + `Shape`
bullets (`broadened`) or a leading `Completion` bullet (`completion-first`) *lowered*
accuracy — they pulled vague and breakdown cases toward `plan`. More structure ≠
better routing; it dilutes the funnel's focus.

### 3. The `disposition` one-liner is within noise, and trades wins for losses

Confirmation pass (K=5, the two finalists):

```
metric                    baseline          disposition
overall accuracy          45/60 (75%)       46/60 (77%)
  review                  10/10 (100%)      10/10 (100%)
  triage                   7/10 (70%)        6/10 (60%)
  guard-research            4/5 (80%)         4/5 (80%)
  guard-common            24/35 (69%)       26/35 (74%)
research over-fire         7/45 (16%)        9/45 (20%)
```

+2pts overall is inside the run-to-run noise. Per-case, `disposition` **trades**:
- **Wins:** multi-surface plan (baseline 0/5 → 3/5), breakdown SYN-12 (2/5 → 5/5).
- **Losses:** bug SYN-11 (baseline 5/5 → **2/5**, leaked to research), breakdown
  SYN-24 (2/5 → **1/5**, leaked to research), and research over-fire **rose** 16%→20%.

The disposition line's explicit `needs-prep (→ research/triage)` option actively
*increases* research selection — it makes the over-fire problem worse, not better.

## Real-data runs (LIN-385 epic, full-size prompts)

To test whether realistic, large tasks (descriptions up to ~12k chars, with comment
threads) sharpen the difference, 22 tasks were pulled from the LIN-385 epic via the
proxy (`scripts/eval/fetch-proxy-tasks.mjs` → fixtures; gold labels assigned by a
subagent, kept out of the orchestrator's context). The harness `REAL_DIR` mode builds
the prompt through the production `formatIssueContext` + `buildMetaPrompt` wiring, so
these are faithful full-size prompts — including real nodes (finally exercising
`defer`, which the synthetic leaf-only set could not). Curated set: 12 tasks (2
node→`defer`, 1 all-done node→`review`, 2 open leaves, 7 terminal-leaf→`review`).

**Exploratory (4 arms, K=3)** *looked* like realism flipped the synthetic result —
`broadened`/`completion-first` hit 97% vs baseline 86%, with `node` 4/6→6/6 and
`implement` 1/3→3/3. **Confirmation (baseline vs `broadened`, K=5) dissolved it:**

```
metric              baseline      broadened
overall accuracy    55/60 (92%)   56/60 (93%)   ← dead even
  node              10/10 (100%)  10/10 (100%)  ← baseline's K=3 4/6 was variance
  review            40/40 (100%)  40/40 (100%)  ← trivial on real terminal tasks too
  blocked            5/5 (100%)    5/5 (100%)
  implement          0/5 (0%)      1/5 (20%)    ← the one durable signal (below)
research over-fire   1/60 (2%)     0/60 (0%)
```

So real, large tasks did **not** sharpen a scaffold difference — they confirmed
there isn't a reliable one. `review` is 40/40 on baseline (no crowding-out even on
12k-char terminal tasks); `node`/`defer` and `blocked` are solid on baseline once K≥5.

**Method lesson worth keeping:** K=3 with single-case buckets is *misleading* against
`gpt-5.4-mini`'s temp-0 nondeterminism — BOTH the synthetic and real exploratory runs
produced double-digit deltas that vanished at K=5. Any future routing A/B needs K≥5
and ≥2–3 cases per bucket. This epic is also review-heavy (40 of 60 real datapoints),
so it barely stresses the funnel — a sharper real eval needs more *open* leaves and
`research`/`plan`/`bug` tasks, which a mostly-completed epic doesn't supply.

## The real signal: a fully-planned task re-routing to `plan`, and over-firing

The one weakness that **persisted across K and across synthetic+real** is NOT a
missing scaffold slot:

- **`implement` → `plan` leak.** LIN-428 — a large leaf with a complete, single-
  session plan already in its description — routed to `plan` on **0/5 baseline** runs
  (and 1/5 broadened). The synthetic twin (SYN-8, a *short* documented plan) hit
  implement 5/5 — so the leak is triggered by **plan length/richness**, not the
  scaffold: a big detailed plan reads as "planning material" and the model re-plans
  instead of implementing. This is a Step-3 readiness-wording problem (distinguishing
  "a complete plan exists → implement" from "needs planning").
- **`research` over-firing** on synthetic plan/breakdown cases (e.g. the multi-surface
  pagination task → research 5/5 baseline), addressed by Step-1 over-fire-guard
  wording, not the Assessment format.



The dominant, **generalizable** failure mode is not a missing scaffold slot — it is
the prod model over-routing to `research`:
- The multi-surface pagination task (a clear `plan`) went to `research` **5/5 on
  baseline**.
- Both `breakdown` cases leaked to `research`/`plan` repeatedly on both arms.
- `gpt-5.4-mini` is markedly **nondeterministic even at temp 0** on these routing
  edges (e.g. the bug case swinging 5/5 → 2/5 between arms that share an identical
  Step-2 block) — so K=3 single-case buckets are directional only, and any future
  routing change needs K≥5 and ≥2 cases per bucket to clear the noise.

`breakdown` *is* genuinely under-served (no funnel slot, leaks to research/plan), but
the `disposition` fix doesn't hold across cases — a more direct lever would be the
breakdown signal / research over-fire guard wording itself, not the self-assessment
format.

## Next, if pursued

1. **Best lead: the large-plan → `plan` leak.** Re-target the spike at Step-3
   readiness wording so a complete in-description plan routes to `implement`
   regardless of the plan's length (LIN-428 is the gold case; SYN-8 the short twin
   that passes). A/B the Step-3 block, not the Assessment block.
2. **`research` over-fire** on plan/breakdown leaves — tighten the Step-1 over-fire
   guard / breakdown signal.
3. Grow a **balanced real eval set** (more open leaves + `research`/`plan`/`bug`
   tasks from active epics; this LIN-385 set is review-heavy) and standardize on
   **K≥5** — the K=3 deltas here were variance, not signal.
4. Consider whether the routing leg wants a higher-K **majority vote** given
   `gpt-5.4-mini`'s temp-0 nondeterminism on borderline cases.

No live-template change was made. Both paths (`lib/prompts/meta-prompt-template.js`
and the handwritten `lib/prompt-templates.js`) are untouched.
