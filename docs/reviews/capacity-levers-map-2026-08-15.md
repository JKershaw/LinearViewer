# Capacity Levers Map — 2026-08-15

**What this is.** The action synthesis of the 2026-08-14 capacity-test trilogy —
[between-leg economics](capacity-test-run-review-2026-08-14.md) (LIN-2087),
[intra-session anatomy](intra-session-efficiency-review-2026-08-14.md) (LIN-2112), and
[context-efficiency ceilings](context-efficiency-ceiling-review-2026-08-15.md) (LIN-2115) —
plus the fix wave that landed while it was being written. One page, maintained by editing,
not by appending.

**Revised 2026-09-05.** Levers 6–10 added from Harbour Archive #5, *The Cheap Ships*
(`/archive/5`, `docs/archive/5.html`), the pull order and ceiling re-scored, and the docket
filed under **LIN-2686** (children LIN-2687–LIN-2694). The 2026-08-15 rows are unchanged.

**The objective function (John's framing, 2026-08-15):** not "save money" —
**verified outcomes per week under a fixed weekly budget** (the subscription window,
≈£45/week, resets Thu 06:00Z). The operating model is a standing budget the fleet is
optimised against until it clips happily under it — predicted lifespan of "under it": never.
Cost reduction is the mechanism; throughput is the metric; the burn gauge (LIN-2118) is the
instrument.

**Second target (2026-09-05):** the **exchange rate** — cost per verified task on the API lane
against the plan fee (`PLAN_FEE_MONTHLY_USD`). The subscription is a lane, not a ceiling; the
multiple at which the API lane costs less than the plan is the multiple at which the
subscription becomes optional (Archive #5 §3 puts it near 100× blended). **LIN-2693** is the
lane-policy decision that turns this from an estimate into a metered number.

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
| 6 | **Handed context** — a deterministic index (symbols, importers, test-to-code, ticket-to-file history) regenerated from HEAD; handoffs carry pointers so a leg is told where to look instead of searching; synthesised prose only as a hashed cache | The *C\*-search gap* on worker legs (2.2× cost / 2.8× turns; probes 12× and 44.6×; a 93-token pointer worth 33 turns) and the long tail ($436/day, 31%) | ~3–5× on worker legs post-#2 (overlaps #2 — do not add) | **LIN-2689** (index + pointer handoffs + the CLAUDE.md two-audience measurement), evidence **LIN-2115**, **LIN-1591** | Filed 2026-09-05; measured by replaying the LIN-2115 probes |
| 7 | **Implementation harness (Dash)** — the whole implementation leg on a small-model harness: deterministic search/replace diffs through git, a verify loop with bounded corrections, decomposition hints on rejection; selected per kind on the existing harness axis | The *price per token* of the work-product bucket (B1, 56% of the day) and rework (B3+B4, 15%) | 10–30× on implementation legs (Flash-class $0.75/$3.75 vs $10/$50; local inference at zero marginal) | **LIN-2687** (harness row + per-kind routing), **LIN-2688** (Dash-shaped plan subtasks + deterministic reroute on rejection), meter **LIN-1181**; delegation route **LIN-1176** stays separate | Filed 2026-09-05; the row is days, the decomposition is the real work |
| 8 | **Verification mechanisation** — verify-loop evidence (test command, runs, corrections) into the ledger; harness-aware survived-the-next-gate read-out; mutation checks unchanged on cheap-lane diffs | The *judgement lane that grows as output grows* — review, plan-review, close-out stay frontier-priced, so their share rises as #7 lands | Not $/day — it bounds the lane #7 cannot shrink | **LIN-2690** (extends LIN-2641; LIN-2274/LIN-2303 floors untouched) | Filed 2026-09-05; blocked by LIN-2687 |
| 9 | **Runtime consolidation (Harbour OS)** — the index, Dash, the observer and the companion on one in-browser floor with local inference | Terminal-driver fragility (the launch breaker, the iTerm/tmux/Terminal.app matrix) and the zero-marginal-cost floor | Long pole; not priced | **LIN-1814** (Harbour OS as the real-teeth workspace), **LIN-259** | Sequenced last; finish transitions before starting capabilities |
| 10 | **The operator's answer rate** — decision context + dependency impact on the companion; false-escalation rate on a public instrument | The ceiling *after* #1–#9: nineteen questions parked overnight, nearly all false alarms (Archive #4) | Not $/day — operator minutes, the north star's scarce resource | **LIN-2672**, **LIN-2691** (escalation KPIs to the review layer and `/kpis`) | Filed; becomes binding as #7 lands |

**Explicitly deprioritised by the data:** general prompt-diet work (the smallest measured
pool, ~$45–90 upper bound once CLAUDE.md's mid-session-read reality is accounted for).
Harness offload was deprioritised here on 2026-08-15 as a *capacity* purchase (re-price
against a plan upgrade only if the cap still bound after #1–#3). Archive #5 re-frames it as a
*price* lever on the implementation lane (#7), which is a different claim — it moves the bulk
work off the subscription rather than buying more subscription — and is what changed the pull
order below. The two are not in tension: #1–#3 shrink what the subscription carries, #7
changes which lane carries it.

## Pull order (re-scored 2026-09-05)

1. **Now / in flight:** #1 — the observer harness (LIN-2114) and its Flight Companion docket
   (LIN-2617–LIN-2634, follow-ups LIN-2670–LIN-2678); #5's gauge (LIN-2118) reads live on
   `/kpis`. #4's 2079 predicate landed; 2076 recorded its shapes.
2. **Next dispatch wave:** #2 (2116 → 2117, small and independent); **#7's harness row**
   (LIN-2687, days once the hosted/BYOK Dash path is stable) with its meter (LIN-1181) in the
   same wave; **#6's index** (LIN-2689, a fortnight), measured by replaying the LIN-2115
   probes. **#10's lane-policy ruling** (LIN-2693) is John's and gates nothing technical.
3. **Then:** #7's decomposition half (LIN-2688) once the row exists; #8's read-out
   (LIN-2690) so the cheap lane's survival rate is a number *before* it is trusted; the
   routing evals #3 → **LIN-1627 → LIN-1628** against the post-compaction base, run as the
   cheap-models roadmap's four acceptance tests (a cheap model finishes a real task
   unattended; you can see what it cost; the smart model catches the cheap one; a run survives
   a hiccup).
4. **Folding it in:** the Cost Levers periodical (LIN-2692) re-scores this table against the
   live meter each edition and edits the status column in place; the north star v3 proposal
   (LIN-2694) is John's to apply.
5. **Last:** #9, the runtime; by then #10 is the binding constraint.

**Ceiling if all land.** For #1–#5 the 2026-08-15 estimate stands: a full-width day at
**~$300–450 ≈ 6–9 window points** — the week fits ~11–16 full-width days instead of ~3.7.
With #6–#8 on the implementation lane the multiplier on *that lane* is **~50–250×** (product of
conservative ends: 1.5 × 3–5 × 10–30 × 1.2) and the day-one blended figure **~20–50×**, climbing
toward the ~100× exchange rate as decomposition pushes more of the work-product bucket into the
cheap lane (Archive #5 §3). Uptime (#1) is a throughput multiplier, not a cost one, and is
deliberately not in that product.

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
- **The #6–#8 multipliers are ranges that overlap** — the honest composite is the product of
  conservative ends, never the sum, and the blended figure is bounded by the judgement lane
  staying frontier-priced by design (#8 is what stops that lane growing without bound).
- **Public benchmark scores behind #7's price tier are mostly vendor self-reported** (Sep
  2026); the harness-controlled comparisons are Scale's SWE-bench Pro and Artificial
  Analysis's Terminal-Bench 2.1, and both show 20-point spreads against vendor tables. Price
  the lane on Harbour's own probes (LIN-2115, and LIN-2689's replay), not on the leaderboards.
- **Decomposition quality is the real #7 integration.** Dash wants single-concern, few-file
  tasks with a precise test command; a plan stage that cannot emit those turns the price lever
  into a rejection stream (LIN-2688 owns this).
