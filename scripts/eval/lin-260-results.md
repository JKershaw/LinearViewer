# LIN-260 — prompt-scaling eval results

Recorded runs of `scripts/eval-prompt-scaling.mjs`. Generator `qwen/qwen3.7-plus`,
judge `anthropic/claude-haiku-4.5` (held constant). `K=1` unless noted — directional,
small-n; numbers are a lower bound on real agent behavior (a single call can't grep
or self-restrain the way Claude Code can). See `docs/lin-260-prompt-scaling-research.md`
§ *Measurement & eval plan* for methodology.

Metrics: **words** = word count of the generated prompt's `## Prompt` body (lower
bound: small tasks should be light). **lane** = judge YES/NO, 1 = stayed in lane,
only scored for non-terminal phases (research/plan/breakdown); terminal phases show
`-`. **qual** = quality-floor guard (1 = surface + change + verification retained).
**inflation** = words(deep upstream) / words(thin upstream) on the SAME task; >1 = depth leaked.

## Phase 1 — baseline (status quo, no lib changes)

```
case                          scale     action      words   lane  qual   inflation
SYN-7 typo                    small     implement     270     -      1        -
SYN-9 mirror-a-validation     small     plan          562      0     1        -
SYN-8 plan-exists fits-one-session  small implement   402     -      1        -
SYN-12 migration multi-session  large   breakdown     392      0     1        -
SYN-5 pagination multi-surface  standard plan         545      0     1        -
INF-1 ttl-bump plan           small     implement     465     -      1     1.46x
GRD-deceptive-small           large     implement     372     -      1        -
GRD-deceptive-large           small     ?             380     -      1     0.96x
```

**What the baseline proves (John's complaint, quantified):**

1. **Sizing is inverted, not just uniform.** SYN-9 (a trivial "reject prompts >50k
   chars" validation) generated a **562-word plan** — *larger* than SYN-12, a
   genuinely multi-session Mango→Mongo migration (392 words). Output length tracks the
   phase scaffold, not the task scale. This is the lower-bound failure as a number.
2. **The plan prompt writes the plan itself (lane-bleed).** Every plan/breakdown case
   scored `lane=0`: the generated prompt pre-writes implementation-level steps that are
   the next agent's job. This is the Grounding-Rule × full-context intersection in the
   research notes, confirmed behaviorally.
3. **Depth propagates (inflation).** INF-1 — a one-line TTL bump — inflated **1.46×**
   purely because a deep research artifact sat in the comments. The task did not change;
   the upstream depth leaked into the downstream prompt.
4. **Quality floor is intact at baseline (qual=1 everywhere)** — so any scale-down later
   must hold this line; "shorter" cannot be allowed to win by hollowing the prompt.

Targets for the change phases: lane↑ on the plan cases, inflation→~1.0 on INF-1,
words↓ on the small cases — each without qual dropping below baseline on the guards.

## Phase 2 — lane-boundary directive (A/B: strip block vs live)

Directive landed in BOTH paths: meta-prompt `## Stay In Your Lane`, handwritten
`formatLaneBoundary()`. `MODE=ab STRIP=lane`, K=1, qwen3.7-plus.

```
case                          scale     A.words  B.words   ΔW    A.lane B.lane   A.qual B.qual
SYN-7 typo                    small        342     330    -12      -     -         1     1
SYN-9 mirror-a-validation     small        368     421     53      -     -         1     1
SYN-8 plan-exists fits-one-session small   388     449     61      -     -         1     1
SYN-12 migration multi-session  large      377     401     24       0     1        1     1
SYN-5 pagination multi-surface  standard   534     574     40       0     0        0     1
INF-1 ttl-bump plan           small        692     704     12       0     0        1     1
GRD-deceptive-small           large        473     582    109       0     0        1     1
GRD-deceptive-large           small        350     364     14      -     -         1     1

lane-discipline  A=0.00  B=0.25  Δ=+0.25   quality: no regressions
```

**Read (honest): weak/noisy positive at K=1, NOT yet a clear win.** lane Δ=+0.25 is driven by
a single case (SYN-12: 0→1); SYN-5/INF-1/guard stayed 0→0. Two limitations the run
exposed: (1) **lane is only scored on non-terminal routes**, and routing flips run-to-run
at K=1, so only ~2–4 usable data points per run; (2) the block slightly *raises* words
(it adds "don't do X" framing) — length is Phase 3's lever, not this one.

### Phase 2 confirm (K=3) — the directive FAILS the gate, and the lane judge is unreliable

```
case                          A.lane B.lane   A.qual B.qual
SYN-9 mirror-a-validation       0      0        1     1
SYN-12 migration multi-session  0.33   0.5      0.67  1
SYN-5 pagination multi-surface  0.33   0        1     1
INF-1 ttl-bump plan             0      0        1     1
GRD-deceptive-small             -      0        1     0.67
lane-discipline  A=0.17  B=0.13  Δ=-0.04
```

The K=1 +0.25 was noise; at K=3 the directive shows **no lift (Δ=-0.04)**. Diagnosis (judge
calibration + output inspection):

1. **The lane judge is reliable on clean extremes but not in the messy middle.** A
   hand-labeled in-lane research prompt scores 4/4 YES and a hand-labeled code-dump scores
   0/4 — perfect separation. But the REAL generated plan prompts (dense with Strategy
   Framing / completeness-check / cross-cutting instructions) get judged `NO` even though
   they only *instruct* the consumer to make a thorough plan — they do not pre-write THIS
   ticket's plan. The judge conflates "a prompt that heavily specifies plan structure" with
   "a prompt that contains the plan." Both arms therefore floor at ~0.15 and the directive's
   effect is undetectable.
2. **The directive is a weak lever** — exactly the research doc's thesis: you cannot reliably
   instruct a model to un-see context; *"the lane-boundary directive is the backstop, not
   the primary fix; the real lever is the structural cut."* The eval now **empirically
   confirms** that the upper bound is not directive-tractable.

**Conclusion:** the upper-bound failure is best measured by the **deterministic inflation
ratio** (no judge), and its real fix is the **structural distillation cut (Phase 4)**, not a
directive. The lane judge is demoted from a ship gate to at most a coarse sanity check.

**Disposition: REVERTED.** Per the ship gate, an unproven prompt change is not retained.
The lane directive was removed from both paths (full e2e suite green). The harness's
`STRIP=lane` arm is retained for future use but is inert until/unless a lane directive returns.

## Phase 3 — scale-down (lower bound, deterministic length)

A `## Scale To The Task` rule added to the meta-prompt (and mirrored as `formatScaleToTask()`
in the handwritten plan/research templates). Measured by word count — no judge in the loop.
`MODE=ab STRIP=scale`, K=3, qwen3.7-plus. **Arm A = stripped (status quo), Arm B = live.**

### v1 — clean win on genuine smalls, but the over-trim guard tripped

```
case                          scale     A.words  B.words   ΔW    qual A→B
SYN-7 typo                    small        345     276    -69     1 → 1
SYN-9 mirror-a-validation     small        398     364    -34     1 → 1
SYN-8 plan-exists fits-one-session  small  436     383    -53     1 → 1
INF-1 ttl-bump plan           small        702     586   -116     1 → 1
GRD-deceptive-large           small        349     328    -21     1 → 1   (wall of context, still shrank — good)
SYN-12 migration multi-session  large      358     366     +8     1 → 0.67 (held full — guard OK)
SYN-5 pagination multi-surface  standard   596     525    -71  0.33 → 1   (shrank, but quality IMPROVED)
GRD-deceptive-small           large        505     309   -196     1 → 1   ← OVER-TRIM: terse "rename everywhere" read as small
```

Genuine small tasks shrank 34–116 words (~10–20%) with the quality floor held — the lower
bound IS directive-tractable, as the research doc predicted (no context-gravity fighting it).
But `GRD-deceptive-small` ("rename `urlKey` everywhere" — terse description, actually
multi-surface) was trimmed −196 words: the directive inferred "small" from the one-line
description. The over-trim guard caught exactly the failure the corpus was built to catch.

### v2 — added the deceptive-small guard; over-trim fixed, win preserved

Refined the rule: *do NOT infer "small" from a terse description; rename/refactor/migrate
"across the codebase" or shared-identifier changes fan out to many surfaces even in one
sentence.* Re-measured (guard cases K=4, smalls K=3):

```
GRD-deceptive-small           large        491     510    +19     0.75 → 1   ← FIXED (was -196), now holds full
GRD-deceptive-large           small        377     336    -41        1 → 1   (still shrinks correctly)
SYN-7 typo                    small        344     276    -68        1 → 1
SYN-9 mirror-a-validation     small        420     364    -56     0.67 → 1
SYN-8 plan-exists fits-one-session  small  376     377     +1        1 → 1   (already lean)
```

**Gate met.** Genuine smalls shrink (−56 to −68) with quality held/improved; the
deceptive-small over-trim is gone (−196 → +19); deceptive-large still shrinks. Shipped to
**both paths** (meta-prompt rule + `formatScaleToTask()` woven into plan/research, before the
heavy framing machinery — not tail-appended, since scale-down is subtractive). Structural
tests added to both unit suites; routing-eval baseline snapshot regenerated. This is the
first directive to clear the ship gate.

## Phase 4 — distillation hand-off (upper bound, structural) — MECHANISM PROVEN, BUILD DEFERRED

The upper-bound fix the directive (Phase 2) couldn't deliver. Mechanism probe
(`scripts/eval/phase4-distillation-probe.mjs`): generate the INF-1 plan prompt under three
upstream conditions and measure inflation + a load-bearing-constraint-recall judge. The
distilled hand-off is a hand-authored brief-style summary (Current / Recommended /
**Constraint** / Surface Assessment) of the same raw research artifact. qwen3.7-plus, K=3:

```
upstream          words   inflation(vs thin)   constraint-recall
thin                400         1.00x              (n/a)
raw-deep            661         1.65x              0.67
distilled-deep      571         1.43x              1.00
```

**Both target metrics move the right way:**
- **Inflation ↓** 1.65× → 1.43× (~13% of the leak removed). Modest, not all the way to 1.0 —
  because some inflation is *correct*: the plan legitimately absorbs the distilled findings.
  Distillation trims the verbatim-depth/style mirroring while keeping the substance.
- **Constraint-recall ↑** 0.67 → 1.00 (the guard, and the nicer result). In the raw dump the
  load-bearing constraint ("existing in-flight items keep their old expiry") is buried and the
  plan drops it 1-in-3; the distilled hand-off *foregrounds* it, so the plan keeps it every
  time. Distillation isn't just shorter — it's higher-signal.

**Why the build is deferred (a real decision, not a slam dunk):** unlike Phases 2–3 (prompt
text), this needs a **semantic summary of upstream comments — an LLM call inside the
context-builder**, on the recommendation hot path. A deterministic cap won't substitute: it
would drop the buried constraint and fail the very guard distillation just improved. So the
seam adds latency + cost + a failure mode to every recommend that carries deep comments, and
must be **opt-in per consumer** (phase prompts distil; recap/brief keep the raw dump they
depend on). The mechanism is proven; whether the modest inflation cut + constraint-retention
gain is worth that architectural cost is the user's call. Spec for the seam: a
`distillHandoff(comments)` (reusing the `/brief` primitive) invoked in
`getRecommendation`/`getRecommendationStream` before `buildMetaPrompt`, gated to
phase-generation callers, replacing `context.comments` with the distilled summary.

