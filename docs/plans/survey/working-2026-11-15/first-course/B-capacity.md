# B — Capacity: what a week of budget buys

Paths: `P/` = `wt-main/docs/papers/harbour/`; `SR` = `wt-main/docs/reviews/stability-review-2026-11-14.md`; `LOG` = `course/survey-log.md`. **[M]** measured in the source, **[D]** derived here from cited numbers, **[A]** assumed. Budget: $3,500 a week at API list prices (LOG:3178); stop new work at about 80% (LOG:3744-3745) = **$2,800 [D]**.

## What a task costs today

| Reading | $ per finished task | Sessions | Minutes, first dispatch → last landing |
|---|---|---|---|
| 12–14 Nov, 25 tasks, mostly default models (SR:51,61) | median 15.25, mean 17.17 | median 8 | median 69.5, mean 93.7 |
| 8–12 Nov, 33 tasks, Opus asked on every stage, some child runs on defaults (SR:181-183; LOG:3430) | median 16.70 | 7 | 86.5 |
| 4–8 Nov, 106 tasks, Haiku builds, before look-first (SR:52,62) | median 9.53, mean 14.29 | 5 | 56.3 |

- **Per stage, 12–14 Nov [M]** (SR:184-188): look-first prefix $2.88 (2.48 sessions), implementation $4.77, blind read $1.02 (1.00 session), research $0.99, close-out $1.04.
- **Spot files [D].** `costs-now.txt`: 9 priced tickets, median $13.44, mean $15.36 (11 read $0). `cost-1110.txt` (Opus batch): 13 tickets, median $19.01, mean $29.61.
- **Size.** Cost rises slowly: the fixed legs (planning, review, close-out) grow about 16% per doubling of production lines and implementation about 30%; no slope reaches 1 (P/task-size-and-cost.md:32). The paper reads this as a large fixed cost per task plus a smaller part that rises with size (same line). Median total by size band over the 98 exact tickets **[D from `task-size-and-cost-evidence/2026-11-12/analysis.json`]**: 0 lines $5.52 (n 30), 1–49 $7.34 (15), 50–299 $11.40 (34), 300+ $21.18 (19). September: at least half of a standalone change's cost is fixed (P/cost-mix.md:238,251). A lane parent's own sessions add more: LIN-4447 $52.87 over ten pieces (LOG:3842,3849).
- **Time split.** No single November table. Pieces: CI median 5.72 min (SR:38); PR open → merge median 36 min, n 25 (SR:116); "about eight sessions and three CI waits" a task (LOG:4081, stated, no source), so about 17 of 69.5 minutes is CI **[D]**. LIN-4441's baseline (7–12 Nov, 38 tasks, 333 dispatches): 28% of worker time waiting on CI and 10–13% in local full-suite runs; no committed script reproduces it (`wt-main/scripts/measure-ci-wall.mjs`:13-17; LOG:3540). Person: 0.28 rulings per task; at most 72% of tasks operator-free (SR:54,58); both active lanes sat idle from 00:12 to about 08:15 on 14 Nov waiting on John (LOG:3843-3849). Review loops: 17 review and 3 plan-review round trips across 98 tickets (P/task-size-and-cost.md:70). September session time: 28% working, 61% waiting on another session, 11% on a person (P/where-the-effort-goes.md:105).

## Weekly capacity now

- **All-in burn [D].** The budget read 51% at about midday 14 Nov (LOG:4043) = $1,785. LinearViewer main took 56 first-parent landings from the 12 Nov 07:00 reset to then (`git log --first-parent` in wt-main, counted here; simple-dispatcher's few landings, 3 in SR:10, are left out). So **$32 per landing all-in**, and $2,800 buys **about 88 landings**.
- **Four lanes on defaults [D].** 28% at 15:55 → 41% at about 22:15 on 13 Nov (LOG:3741,3801) = $455 for 19 landings = **$24 per landing → about 117 landings**.
- **Burn rate.** About 1.9% an hour with four lanes (LOG:3801), so 80% lasts about 42 hours of four-lane running **[D]**. So money binds at four lanes; the toy model found it did not at two (LOG:3187-3188).
- **Share not building.** 44 of 115 landings (7–14 Nov) were product or code work; 69 were loop-building, its clean-up, measuring or papers (LOG:4086). Tracked task cost is about $13 per landing (25 × $17.17 / 33; SR:9,61) against $32 all-in, so about **41% of the burn is tracked task sessions [D, windows differ]**. The rest (lane parents, area reads, Periodicals, papers, the supervising session) is not split in the record; the log holds only guesses of 3–5 points each for after-reads, a paper and an essay (LOG:3807). Tracked costs also omit subagents: 9.7% in October (P/sessions-without-usage.md:37). **Supervising session's own cost: not found.**

## Levers

| Lever | Measured | Effect | Evidence | On? |
|---|---|---|---|---|
| Model per stage: build on Haiku, close-out Sonnet, judge Opus (LOG:3427-3429) | Median task $16.70 (Opus everywhere) → $15.25; implementation $7.06 → $4.77 (SR:181,185) | −9% per task, populations differ (SR:105) | measured, confounded | Yes, from 13 Nov 13:12 (LOG:3632) |
| Judge on Sonnet instead of Opus | October re-priced (P/cheaper-capacity.md:119) | ×1.48 capacity; with Haiku builds ×2.26–2.77 (:121); "neither move has been tried" (:26-27) | estimated | No |
| Parallel CI (LIN-4441) | CI median 8.59 → 5.72 min over 32 runs (SR:38-39) | −2.9 min per CI wait; floor is E2E shard 2/4, 320–359 s (SR:291-292) | measured | Yes, 12 Nov |
| Skip duplicate local full runs | 10–13% of worker time (baseline above) | re-measure not done (SR:415) | proposed; rule is prompt text | Rule on; effect unmeasured |
| Sessions per task | 5 → 7 (look-first) → 8 (blind read) (SR:197) | look-first $2.88 and blind read $1.02 a task; $3.90 of $17.17 = 23% **[D]** | cost measured; "no quality evidence" (`course/gate-2026-11-14.md`:57) | Both stages on |
| Task size | Slopes 0.21 and 0.38 (above) | 300+ lines costs 2.9× a 1–49-line task **[D]** | measured, association only | "Erring larger" agreed (LOG:3596) |
| Split families | ×1.8 (P/cost-mix.md:259) | September only | measured | Lanes still split |
| Parallel lanes | 4 lanes: 25 PRs in about 8 h; 33 landings in 1.4 days (SR:116) | throughput, not cost | measured | Yes |
| Held vs fresh supervisor | Relay as proposed 0% (−17% to +9%); lean relay −19%; quiet wakes to code −10% to −14% (P/held-or-fresh.md:23-33) | modelled on September's wakes | estimated | No |
| Starting context | Orientation 5.8–25.8% of tokens; re-finding 4.9–12.1% (P/starting-context.md:29-34) | saving 5–12% if removed (:48-49) | measured census, saving estimated | No |
| Check-in wakes | September: 29% of tokens, 12% changed nothing (P/wake-inventory.md:30-31). Now: $1.40 of $17 on LIN-4441, about 8% (LOG:3573) | small now | measured (one ticket) | A2 retired (LOG:3573) |
| Review loops | Repeats took 10% of tokens; a repeated close-out changed nothing in 20 of 20 (P/why-legs-repeat.md:38-40) | up to 10% | measured (Sept) | not found |
| Prompt size | Frozen total 378,915 → 396,064 bytes (SR:337); +22% since 1 Nov (`course/gate-2026-11-14.md`:60) | August arithmetic: 25% cut saves 3.2% (P/efficiency-levers.md:36) | estimated | Ceiling test on; still growing |

## Parallelism

- **Now:** four lanes (LOG:3647), up from two plus a third slot (LOG:3252,3484). August: 15 lanes, peak 16 concurrent sessions, 0 collisions (P/efficiency-levers.md:44,46,59).
- **Conflicts:** 48 of 353 files were changed by more than one lane, one visible conflict, all 30 main CI runs green (P/lanes-across-the-seam.md:54-56,245-246). Pieces sharing a hand-edited list must run in sequence (LOG:2194).
- **Limits seen:** John's rulings (LOG:3844) and the budget (LOG:3802). No fleet rate limit on record; only the supervising session's reads hit 429s (LOG:3319).
- **Sweet spot:** not found.

## Capacity model (80% = $2,800)

- **(a) Today:** $2,800 ÷ $32 all-in per landing [D] = **about 88 landings a week**, about 34 of them product at this week's 38% (44 of 115) [A: mix holds].
- **(b) Measured levers on:**
  1. Default models with lanes kept busy: $24 per landing [D, one 6-hour interval] → **about 117**.
  2. Also drop look-first and blind read: tracked share $13 × 0.77 = $10, so $21 per landing [A: other spend unchanged; quality effect unmeasured] → **about 133**.
  3. Ceiling, every dollar on task sessions at the 4–8 Nov cost: $2,800 ÷ $14.29 = 196 tasks [M cost, A zero overhead].
- **Not included (estimated only):** Sonnet judging ×1.48, lean relay −19%, re-finding −5% to −12%.
- **Cross-check:** 115 landings in 7–14 Nov (given); that span crosses a reset, so its budget share is not found.

## Gaps

- Budget dollars split by purpose (build, measuring, papers, supervising session).
- Whether 100% of John's gauge equals $3,500 list (assumed here).
- LIN-4441's post-merge re-measure of CI-wait and local-run shares.
- Wall-clock split of a task; John's time to answer a ruling.
- Cost per landing by number of lanes.
- Quality cost of removing look-first or blind read, or of a Sonnet judge.
- Cost per product landing, apart from process landings.
- A full budget week on default models.
