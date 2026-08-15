# Capacity-Test Run Review — 2026-08-14

**Scope.** Post-run review of the deliberate fleet capacity test run on 2026-08-14: ~20
concurrent autopilot sessions across the rung-1 reliability batch (12 tickets), the Ship
Journey repair arc, the TEST_ credential armory, and the live-bug arc that became LIN-2097 —
all on a single £180/month subscription account whose weekly window resets Thursday 06:00Z.
This document is the durable write-up for **LIN-2087** (the run's prediction ledger); the
raw inputs are pinned as comments on that ticket. Written by the Flight Companion observer
session; reviewed adversarially before merge (Appendix B).

**Method and data sources.**

- **Dispatch usage snapshot**: every dispatch item for 2026-08-14 reachable through the
  proxy API (316 item ids collected: all ticketed legs via the `issueIdentifier` filter,
  plus unticketed items from 14:00Z onward via the general list; 314 fetched, 2 lost to
  rate-limit retries, 5 carried no usage lines). One disclosed gap: unticketed
  wake/coordination items dispatched **before** 14:00Z are unreachable past the list
  endpoint's 100-item page cap, so bucket B2 below is an **undercount** of coordination
  (bounded in §2).
- **`[usage]` lines are cumulative session counters, not per-turn deltas.** Verified
  directly: counters are monotone within an item's feedback trail, and consecutive wake
  items claimed by the same session repeat each other's lines verbatim. Naively summing
  lines overstates spend ~100× (the first pass of this analysis produced $107k for the day
  and was discarded on that smell test). The corrected method: global exact-tuple dedupe
  (a line counts once, for the earliest item carrying it), then per-item positive
  consecutive diffs, with an item's first absolute line counted only for genuinely fresh
  sessions (non-resume kind AND first cache-read < 50M tokens). Cross-checked two
  independent ways in Appendix A; bias direction: slight undercount, overcount impossible
  after dedupe.
- **Pricing**: `lib/model-pricing.js` rates — the same table the public `/kpis`
  terminal-marked-task cost card uses — so these numbers are commensurable with the
  product's own.
- **Daily dispatch counts**: the `/kpis` 30-day `dispatchByDay` series, captured ~21:15Z.
- **Weekly-quota checkpoints**: operator readings of the subscription usage meter (John),
  UTC-corrected.

---

## 1. Headline outcomes

The test asked one question — *what does a ~20-session day on one subscription actually
produce, cost, and break?* — and staked nine predictions on the answer (§6).

**Shipped on the day:**

- **Rung-1 reliability batch: 10 of 12 Done** (LIN-2031, 2080, 2044, 2045, 2046, 2075,
  2077, 2078, 2081, 2047), every close-out merged to main. The two carry-overs (LIN-2076,
  LIN-2079) stalled mid-pipeline for a reason the run itself surfaced (§7, event #6).
- **LIN-2097 — the day's crown**: a run dispatched to reduce log noise *refuted its own
  ticket's premise* against 2,910 log lines and found the real bug (a rejected credential's
  expiry re-stamped before the acceptance check, winning every max-expiry selection lane
  forever). Found, diagnosed, human-ruled, planned through a two-round review fight,
  implemented, reviewed, closed out and **merged to main the same day** (~6 hours
  finding-to-merge, PR #1138).
- **LIN-2057 TEST_ credential armory** completed and live-proven (3 providers × 2 auth
  shapes); LIN-1986 (owner-scope title resolution) merged with three follow-ups filed.
- **Ship Journey run 3** deliberately hard-stopped at plan-delivered under the end-of-day
  budget freeze — the reviewed 37KB implementation plan on LIN-2089 is the durable
  deliverable; implementation is queued behind an explicit human go.
- **Zero lost work** across six distinct stress events (§7).

## 2. Spend attribution — four buckets × model

Every `[usage]` line attributed to one of four buckets, mechanically:

- **B1 work-product** — the first leg of each kind on a ticket (research, plan,
  implementation, review, close-out, …): the spend that directly produced deliverables.
- **B2 coordination** — wakes, observer relays, and the autopilot **orchestrator tier**
  (broken out on its own line: the Opus sessions that dispatch and supervise legs).
- **B3 redundant-process** — a repeated leg kind on the same ticket *not* preceded by a
  change-requesting review. Note: this conflates deliberate re-runs with
  relaunch-after-stall recovery; the run's window-cap deaths (§7) put cap-recovery
  relaunches in this bucket too, so read B3 as "process repetition" rather than pure waste.
- **B4 rework** — a repeated kind immediately following a review/plan-review (a
  change-requested loop), or any `failed` item.

**Item counts** (314 items): B1 90 · B2 91 (77 wake/relay + 14 orchestrator) · B3 108 ·
B4 25.

**Spend** (delta-correct, API-list-rate USD, `lib/model-pricing.js` rates):

| Bucket | Model | Items w/ usage | Output tok | Cache-write | Cache-read | API-rate USD |
|---|---|---:|---:|---:|---:|---:|
| B1 work-product | claude-opus-5 | 64 | 2.9M | 23.0M | 370.1M | 402.33 |
| B1 work-product | claude-sonnet-5 | 27 | 1.6M | 33.2M | 496.3M | 198.21 |
| B2 coordination | claude-opus-5 | 6 | 0.11M | 2.8M | 80.6M | 60.48 |
| B2 orchestrator tier | claude-opus-5 | 14 | 1.2M | 8.4M | 325.0M | 245.96 |
| B3 redundant-process | claude-opus-5 | 17 | 0.76M | 3.4M | 103.1M | 91.71 |
| B3 redundant-process | claude-sonnet-5 | 6 | 0.22M | 2.0M | 64.2M | 20.02 |
| B4 rework | claude-opus-5 | 1 | 0.02M | 0.4M | 2.1M | 4.04 |
| B4 rework | claude-sonnet-5 | 16 | 0.66M | 6.5M | 125.1M | 47.84 |
| *(synthetic/unpriced lines)* | — | 5 | 0.26M | 1.6M | 28.5M | 0.00 |
| **Total** | | | **7.7M** | **80.5M** | **1,587.8M** | **1,070.58** |

**Bucket shares** (of API-rate USD / of output tokens):

| | USD share | Output-token share | USD |
|---|---:|---:|---:|
| B1 work-product | 56.1% | 60.7% | $600.54 |
| B2 coordination (incl. orchestrator) | 28.6% | 17.4% | $306.43 |
| — of which orchestrator tier | 23.0% | — | $245.96 |
| B3 redundant-process | 10.4% | 12.8% | $111.73 |
| B4 rework | 4.8% | 9.1% | $51.88 |

Three structural findings:

1. **Count and cost invert between coordination and work.** Coordination plus process
   repetition is the majority of *items* (B2's 91 + B3's 108 = 63% of items) but ~39% of
   *spend*; work-product is 29% of items and 56% of spend. The machine's chatter is cheap;
   its thinking is expensive. Most wake items carried near-zero *new* usage after dedupe —
   they re-post the same session counters — so they are item-noise more than token-cost.
2. **The Opus orchestrator tier is real but bounded** — 23.0% of the day at API rates.
   The mid-run observation that single orchestrator turns read 3–18M cached tokens is
   confirmed (the deepest orchestrator session ended the day at ~272M cumulative
   cache-read), but cache-read pricing (10% of the input rate) keeps the tier from
   dominating: its $245.96 is mostly its 1.2M *output* tokens at Opus completion rates.
3. **The pre-14:00 coordination gap.** Reachable coordination (14:00–21:00Z, ~7h) cost
   $306; the unreachable morning window (~08:00–14:00Z, 6h at fuller fleet width) plausibly
   carried a similar magnitude — call it **$150–350 of uncounted B2**. That widens B2
   toward parity with B1 in the worst case, and it is why the two bucket-share predictions
   scored against this table carry inline caveats (§6, P2/P3). It does not change finding 1's
   ordering of cost-per-item.

## 3. What the day cost, in cash — two columns

**Column 1 — subscription-amortised (what John actually paid).** The £180/month plan
prepays ≈ £45/window-week. Checkpoint readings (§4): the day ran the meter from 31%
(10:00Z) to 58% (20:50Z) — **≈ 27 points of the weekly window, ≈ £12.15 of prepaid value**
on the run-attributable span. Charging the whole week-to-date instead (58% × £45 = £26.10)
sets the upper bound; two disclosed smudges either way: the 08:00–10:00Z ramp-up burn sits
below the first reading, and the meter includes some personal use ("not much" — operator's
characterisation).

**Column 2 — API-list-rate equivalent (what the same tokens would have billed).**
**$1,070.58** at `lib/model-pricing.js` rates — roughly **£790–840** at recent exchange
rates.

**The gap is the finding: a ~30–65× multiplier** between prepaid subscription value
consumed and list-rate value received (~65× on the run-attributable £12.15; ~30× charging
the full week-to-date £26.10). Three honest caveats: API *list* price is not Anthropic's
marginal cost; the subscription's real price is the **cap** (once a week saturates, the
marginal token's cost is the work that didn't happen — §5); and the multiplier is exactly
why offload economics (converting capped prepaid capacity into uncapped marginal spend)
is the strategic lever rather than thrift.

Cross-check: the public `/kpis` terminal-marked-task cost card reports **$6,505
API-equivalent across 532 terminal-marked issues over the trailing 30 days** (≈ $12.2/task,
$0 cash — everything rides the subscription lane). Today's ~$1,071 on the 30-day chart's
biggest day (704 dispatches) is consistent with that series once its narrower scope
(terminal-marked lineages only) and the recent fleet-width growth are accounted for.

## 4. The burn curve

| Reading | Time (UTC) | Weekly % | Note |
|---|---|---|---|
| Window reset | Thu 2026-08-13 06:00Z | 0% | hard anchor (Thursday reset, 07:00 BST) |
| Baseline + morning ramp | Fri 10:00Z | 31% | includes Aug-13 (182 dispatches) + run start ~08:00Z |
| Mid-run | Fri ~14:40Z | 51% | ~20 sessions live |
| Post-freeze ruling | Fri ~18:05Z | 56% | essentials-only |
| Final (board drained) | Fri ~20:50Z | 58% | operator reading; some personal use in the mix |

Steepest segment: 31→51 in ~4h40m (**~4.3 points/hour** at full fleet width). The freeze
visibly flattened the curve (56→58 over the last ~3 hours despite landing LIN-2097 and
LIN-2047 in that window).

## 5. Saturation is (often) the operating mode — the quiet-Wednesday scan

The window resets Thursday 06:00Z, so an exhausted week shows up as a dead **Wednesday**
(the window's last day). The 30-day `/kpis` daily series, weekdays annotated:

- **Week Aug 7–12** (last week): 204, 246, 183, 210, **Tue 1, Wed 0** — a full exhaustion
  tail; the week died a day *early*. Matches the operator's report that it hit 100%.
- **Week Jul 17–22**: 655, 324, 422, 397, 555, **Wed 71** (vs a 300–800 norm) — a grazing
  partial exhaustion.
- **Week Jul 24–29**: ran clean — **810 dispatches on its final Wednesday**, the series
  maximum at that point.
- **Aug 4 (Tue) = 0 but Aug 5 (Wed) = 439**: a mid-week zero that *recovers before the
  reset* is not exhaustion (a spent cap cannot un-spend); cause unknown (outage or day
  off), excluded from the exhaustion count.

**Verdict: 2 of 4 fully-observed weeks hit or grazed the cap.** With n=4 this is evidence
of a common mode, not proof of a permanent one — but it is common enough to flip the
strategic frame: in a saturated week the binding constraint on throughput is the **cap**,
not the backlog, which prices "capacity per pound" (offload, cheaper models, less
redundant process) above "spend less this week". The scan is repeatable any time from
`/kpis`; the 30-day chart window is the reach limit.

## 6. The nine predictions, scored

| # | Prediction | Verdict |
|---|---|---|
| P1 | The fleet survives ~20 concurrent sessions without losing work | **PASS** — six stress events, zero lost work (§7) |
| P2 | Work-product (B1) ≤ 50% of spend | **MARGINAL FAIL on measured data** — 56.1%. The disclosed pre-14:00 B2 gap ($150–350 uncounted) would put B1 at ~42–49% if real, i.e. the prediction may be true and the measurement can't settle it. Scored against what was measured |
| P3 | Coordination (B2) 25–40% of spend and the dominant single bucket | **PARTIAL** — 28.6% is in-range, but B1 dominates on measured data (same gap caveat as P2, in the opposite direction) |
| P4 | Redundant process (B3) 10–25%; ≥3 of LIN-2075–2079 show redundant research | **PASS** — 10.4% (bottom of range), and the research half passed emphatically: **all five** tickets ran ≥4 research legs (2075: 4, 2076: 5, 2077: 4, 2078: 5, 2079: 7) |
| P5 | Rework (B4) 5–15% | **NARROW MISS** — 4.8%. The review loops were tighter than predicted; the two-round bound on plan-review (LIN-2097's fight notwithstanding) did its job |
| P6 | ≥10 of 12 rung-1 tickets Done unaided by end of day | **PASS — 10/12**, with an asterisk: the 10th (LIN-2047) landed via the observer executing an already-verified close-out's final writes under an explicit human ruling (§7, event #6), not by the fleet unaided |
| P7 | The day costs 10–18% of the weekly quota | **FALSIFIED — ~27 points (≈1.5× the upper bound).** The error was underestimating fleet width's multiplicative effect on the burn *rate* (4.3 pts/hr mid-run), not any single session's appetite |
| P8 | Offload potential 25–35% of spend | **PASS, rescored in capacity-conversion terms**: the Sonnet presets already carry plan/implement legs, so the honest "spend that could leave the subscription or be cheapened" is the Opus orchestrator tier (23.0%) plus B3's repetition overhead (10.4%) ≈ **33%** |
| P9 | ≥1 unpredicted systemic finding | **PASS, three times over**: LIN-2097 itself; the zombie-'taken' bookkeeping volume (LIN-1594 evidence: a 20-item taken list with 1 live session); and the silent-orchestrator-death stall class (§7 #6) |

Tally: 5 pass, 1 partial, 2 marginal misses, 1 clean falsification — scored against
measured data with gaps disclosed, including the two verdicts (P2/P3) the measurement
genuinely cannot settle.

## 7. Capacity narrative — six stress events, zero lost work

| # | Event | Recovery mechanism |
|---|---|---|
| 1 | Operator laptop battery death (~11:10Z) | one stalled session self-recovered; one dead leg auto-redispatched by its orchestrator |
| 2 | Instance-wide Linear 401 storm (12:30–13:35Z) | operator re-link; incident annotated on LIN-2076; sessions rode it out on retry |
| 3 | GitHub webhook gap (11:56–13:18Z) | LIN-2081's close-out parked rather than guessing; resumed on recovery |
| 4 | 5-hour window cap (~15:00–15:56Z, planned) | machinery refired cleanly on window reopen |
| 5 | Self-inflicted 3-minute all-grants-revoked outage (16:42–16:45Z, during the LIN-2097 re-auth) | diagnosed from probe signatures (app up, Linear grants dead); operator re-login via `/logout` (itself a UX finding — a stale session would not re-auth in place); ~3-minute blast radius |
| 6 | **Silent orchestrator death** (found ~20:45Z): the five "In Progress" stragglers had had no dispatch activity for 6+ hours — their final legs all ended with clean `[done]` markers, but the orchestrator sessions died around the window caps and never dispatched successors, leaving tickets In Progress with nobody working them and their `autopilot` items stuck 'taken' | observer detection + stall-notes on all four orphaned tickets; the one true BLOCKED park (LIN-2047's close-out, which had correctly parked at 09:42Z on a ledger item only a human browser session can exercise) was landed under an explicit human ruling, its unprovable item routed to LIN-2111 per the LIN-1579 lane. **This stall class is the run's most actionable reliability finding**: the fleet loses not work but *momentum*, silently, when an orchestrator dies — evidenced on LIN-1594 and squarely in LIN-2079's remit |

The pattern across all six: the parts *fail*, the state *survives*. Filesystem-as-IPC on
the dispatcher side and append-only feedback on the queue side meant every recovery was a
resume, not a redo.

## 8. Top-3 waste sinks → owning tickets

1. **Process repetition (B3, $111.73, 10.4% — and 108 items, 34% of all items)** — a mix
   of genuinely redundant re-research (LIN-2079's 7 research legs; LIN-2076's 5+4) and
   cap-death relaunches. Owners: **LIN-2079** (stall/zombie bookkeeping, which would let an
   orchestrator *know* a leg already ran), **LIN-1594** (stale 'taken' items), and the
   rung-2 eval chain (**LIN-2059 → 1747 → 1627**) for making re-runs cheaper when they do
   happen.
2. **The Opus orchestrator tier ($245.96, 23.0%)** — 14 sessions whose cache-read appetite
   (up to ~272M cumulative) is priced gently but whose 1.2M output tokens are Opus-priced.
   Owner: the model-tiering conversation (orchestrator on a cheaper preset, or **opencode
   offload** — gaps LIN-1125/1193/1146/1087).
3. **Wake chatter that outlives its purpose** — 77 wake/relay items in the reachable
   window alone (plus the unreachable morning population); most carried near-zero new
   usage after dedupe, i.e. the *items* are bookkeeping noise even where the *tokens* are
   small — the same population that produced the 20-item/1-live taken list. Owners:
   **LIN-1594 / LIN-2079** and the beat-alignment work already in their remit.

## 9. Verdict and the strategy inputs

The run proves the fleet can hold ~20 sessions through a genuinely hostile day and convert
one prepaid pound into roughly 30–65 pounds of list-rate compute — *when the week has
headroom*. The quiet-Wednesday scan shows headroom ran out in half the observed weeks, and
P7's falsification shows a full-width day eats ~a quarter of the week by itself. The
capacity-per-cost options, ranked by what this run's data says about each:

- **Bookkeeping/beat alignment** (LIN-1594, LIN-2079): kills the silent-stall and zombie
  classes — attacks B3's relaunch share and the lost-momentum failure mode (§7 #6), and is
  the cheapest of the four to land. The run's own evidence (event #6 cost the batch its
  last two tickets) argues this first.
- **Rung-2 evals** (LIN-2059 → 1747 → 1627): cheaper models per leg — attacks B1+B3 spend,
  the largest combined share (66%).
- **Opencode offload** (LIN-1125/1193/1146/1087): moves whole legs off the capped
  subscription — attacks the *cap* itself, which §5 shows is the binding constraint in
  saturated weeks.
- **Plan-tier upgrade**: buys headroom linearly with cash — the baseline the other three
  must beat.

---

## Appendix A — how the numbers were cross-checked

Three independent computations over the same snapshot:

1. **Naive line-sum** (discarded): $107,756 — refuted by the cumulative-counter
   verification and by the `/kpis` 30-day cross-check ($6.5k/30d); kept here as the
   cautionary tale for future consumers of `[usage]` feedback.
2. **Per-item positive diffs** (the table in §2): $1,070.58. Known bias: drops the
   boundary delta between consecutive items claimed by the same Claude session.
3. **Coordination-group walk**: wake/orchestrator items grouped by the queue's `sessionId`
   and walked as single cumulative sequences (which is valid *only* for coordination
   chains that genuinely share a Claude session). Result: coordination = $306.34 vs
   method 2's $306.43 — **agreement within 0.03%**, so the boundary-delta undercount is
   negligible.

A fourth attempt — grouping *all* items by the queue's `sessionId` — was **invalid and
rejected**: that field is the autopilot-*run* grouping (every leg of a run shares it), not
the Claude-session identity, so a running-max walk across legs collapses parallel
sessions' counters into one and undercounts ~30% (it produced $763). The queue does not
expose Claude-session identity; method 2 + the method-3 bound is the honest ceiling of
what the data supports.

## Appendix B — adversarial review (pre-merge)

Findings from the adversarial pass over this document, each either fixed in place or
disclosed inline; none withheld:

1. **Bucket rules are heuristic, and B1 is the flattered bucket.** "First leg of a kind =
   work-product" counts a first research leg as B1 even when it re-derived known context
   (the redundancy P4 measures shows this happened), and pushes only *repeats* to B3/B4.
   Direction: B1 overstated, B3 understated. The bucket-share predictions were scored
   without correcting for this, because any correction would be judgment, not measurement.
2. **P2 and P3 are not settleable from this data** (the pre-14:00 B2 gap spans both
   verdicts' thresholds). The scoring says so explicitly rather than picking the flattering
   reading — note the *unflattering* reading was kept for P2 (scored MARGINAL FAIL on
   measured data even though the gap plausibly rescues it).
3. **The freshness cap (50M cache-read) could misclassify** a pathologically long first
   turn as a resume (undercount). Observed first-stop values sit 2–3 orders of magnitude
   below the cap; risk accepted and named.
4. **The £ conversion and the 30–65× multiplier are deliberately given as ranges** — the
   exchange rate is approximate and the denominator depends on an attribution choice
   (run-span vs week-to-date) that is stated, not hidden.
5. **The observer graded its own run and its own prediction ledger.** Mitigations: every
   scoring rule is mechanical and stated before the number; the falsification (P7) and the
   two misses (P2, P5) are kept as misses; the P6 asterisk names the observer's own
   intervention as the reason the "unaided" clause is compromised; and this appendix plus
   the provenance trail make every number recomputable from the named sources.
6. **The `/kpis` "consistency" claim in §3 is qualitative**, not a reconciliation — the
   two series measure different populations (all-items-today vs terminal-marked lineages
   over 30 days). Phrased as consistency, not confirmation.
7. **Saturation verdict softened**: n=4 weeks with one excluded ambiguous zero (Aug 4) is
   a small sample; §5 now says "common mode", not "the operating mode", and the title's
   "(often)" carries the qualifier.
8. **Two of 316 items were never fetched** (rate-limit losses) and 5 carried no usage
   lines; both counts are disclosed in Method. Impact bound: ≤2 items of unknown bucket,
   almost certainly wake-kind (the population the pagination cap already truncates).

## Appendix C — provenance

- Usage snapshot: 316 dispatch item ids, pulled 21:00–21:20Z via the proxy API
  (`usage-snapshot-2026-08-14.jsonl`, observer scratchpad; aggregates reproduced in §2).
- `/kpis` capture: ~21:15Z (`generatedAt` in the embedded stats JSON).
- Checkpoint readings: operator (John), via chat, timestamps as tabled in §4.
- LIN-2087 ticket comments carry the same inputs pinned mid-run: pricing basis
  (`4c75040a`), checkpoint series (`44c7cf5a`, tz-fix `2bb4fd7f`), exhaustion-week
  signature (`c4d7013d`).
- LIN-2047's close-out disposition (the P6 asterisk): recorded on LIN-2047 and LIN-2111.
