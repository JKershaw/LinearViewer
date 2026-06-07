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
