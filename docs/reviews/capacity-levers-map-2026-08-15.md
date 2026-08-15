# Capacity Levers Map — 2026-08-15

**What this is.** The action synthesis of the 2026-08-14 capacity-test trilogy —
[between-leg economics](capacity-test-run-review-2026-08-14.md) (LIN-2087),
[intra-session anatomy](intra-session-efficiency-review-2026-08-14.md) (LIN-2112), and
[context-efficiency ceilings](context-efficiency-ceiling-review-2026-08-15.md) (LIN-2115) —
plus the fix wave that landed while it was being written. One page, maintained by editing,
not by appending.

**The objective function (John's framing, 2026-08-15):** not "save money" —
**verified outcomes per week under a fixed weekly budget** (the subscription window,
≈£45/week, resets Thu 06:00Z). The operating model is a standing budget the fleet is
optimised against until it clips happily under it — predicted lifespan of "under it": never.
Cost reduction is the mechanism; throughput is the metric; the burn gauge (LIN-2118) is the
instrument.

## Baseline (measured, F3-corrected)

A full-width day (~20 concurrent sessions): **~$1,540 API-rate equivalent ≈ 27 points of
the weekly window.** Decomposition: ~$580 coordination carry (observer + orchestrators),
~$730 work legs, ~15% process repetition/rework. 95.5% of all spend is carried-context
re-reads. 2 of 4 observed weeks hit or grazed the cap.

## The levers

| # | Lever | Attacks | Size (per full-width day) | Owner(s) | Status |
|---|---|---|---:|---|---|
| 1 | **Hosted observer/orchestrator harness** — coordination tiers move from Claude Code sessions to a scheduler + tools + small-context LLM calls at judgement points | The *turns that carry context at all* (carry ratios 1,047–1,420×) | ~$580 → ~$30–60 (**≈$500**) | **LIN-2114** (scope ruled 2026-08-15: coordination-state sessions in, workers out; escalate-to-depth + chat surface load-bearing) | Front of queue; C\* E2 probes de-risked the distill-and-handoff mechanism |
| 2 | **Within-leg compaction** — drop the bootstrap segment for short leg kinds; compact at beat boundaries; bound the long tail | The *tokens carried per turn* on the workers that remain | ~$220–360 | **LIN-2116** (bootstrap, $77/day), **LIN-2117** (beat boundary, 64% of a measured leg), long-tail checkpointing (design input: C\* §9) | Filed, evidence-backed, cheap; can land ahead of #1 |
| 3 | **Model tiering** — orchestrator + eligible Opus legs to Sonnet, gated on evals | The *price per token* of what survives #1–#2 | ~$100–200 *post-compaction* (shrinks as #1/#2 land — which is why it goes last) | Rung-2 chain **LIN-2059 → 1747 → 1627**; **LIN-1085** baselines now exist (C\* per-leg tables) | Deliberately sequenced behind #1–#2 |
| 4 | **Reliability floor** — credential-resolution flapping; zombie/stall bookkeeping | Lost momentum + observer intervention load (the 2026-08-15 fix wave needed ~10 manual unwedges) | Not $/day — it buys back autonomy | **LIN-2076** (three timestamped failure shapes recorded 2026-08-15: per-mint pinning, per-path divergence, per-request flapping), **LIN-2079** (predicate, in final review), **LIN-1594** (disposition rides 2079) | 2079 in flight; 2076 promoted by two live incidents in one day |
| 5 | **Instrumentation** — burn gauge; honest pricing | The ability to steer at all | — | **LIN-2118** (gauge, calibrated from the LIN-2087 checkpoint series), **LIN-2113** ✅ (1h-cache pricing, merged 2026-08-15 — all figures were ~18% understated before it) | 2113 done; 2118 design-first |

**Explicitly deprioritised by the data:** general prompt-diet work (the smallest measured
pool, ~$45–90 upper bound once CLAUDE.md's mid-session-read reality is accounted for) and
opencode offload as a *capacity* purchase (re-price against #7-style plan upgrade only if
the cap still binds after #1–#3 — likely moot at a 3.5–5× reduction).

## Pull order

1. **Now / in flight:** #4's 2079 predicate (final review), #5's 2118 design. LIN-1594
   dispositioned on 2079's landing (observer's delegated call).
2. **Next dispatch wave:** #2 (2116 → 2117 — small, independent, land while #1 is
   researched) and **#1's research leg** (LIN-2114: observer contract → harness shape →
   migration path; the 2026-08-15 hand-run of three orchestrations is the working
   prototype of its decision loop).
3. **Then:** #1 implementation phased observer → orchestrators → periodicals
   (LIN-1629/373 direction), with 2076's root cause fixed en route or made moot by the
   harness owning credential refresh natively.
4. **Last:** #3 tiering evals against the post-compaction base.

**Ceiling if all land:** a full-width day at **~$300–450 ≈ 6–9 window points** — the week
fits ~11–16 full-width days instead of ~3.7, i.e. the current workload stops clipping and
the fleet widens until it clips again (by design).

## Watch-list / honest caveats

- The C\* compaction claims hold for well-scoped changes; **algorithm-shaped work resists
  distillation** (measured) — #2's mechanisms must not be applied blindly to it.
- Savings lines **overlap**; the composite 3.5–5× is the honest multiplicative estimate,
  never the sum of the table.
- Checkpoint economics carry **shared-meter noise** (personal + pet-project use on the
  same subscription) — treat window-point figures as ranges; 2118's calibration must
  survive this.
- Next natural credential-failure window: **~12:55Z 2026-08-16** (24h after the last
  re-auth). A clean pass weakens the expiry-rhythm theory; a reproduction hands LIN-2076
  its smoking gun.
