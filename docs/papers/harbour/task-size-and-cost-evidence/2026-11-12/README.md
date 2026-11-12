# Evidence for "How does the size of a task relate to its cost?" (version 2, LIN-4427)

Frozen 2026-11-12 (`freeze_finished_at` 12:16:36Z in `manifest.json`; the pairs re-read at 12:17:24Z). Version 1's folder,
`../2026-11-05/`, is a frozen record and is not changed.

## Where the inputs live, and why

`inputs.json` sits in this folder, beside the evidence it governs, because version 2 has its own inputs (version 1's sit
beside the scripts, as a record of how v1 was made). The scripts take `--inputs <file>` and refuse the default where a
folder has its own `inputs.json`, so every command below names the file. The file was committed (`b4467d3e6`) before the
freeze and before any fit. It is not amended after the freeze: `as_of` is `manifest.freeze_finished_at`, and the manifest
stores the file's sha256.

## What is here

- `inputs.json`: the pre-registered rules. Each rule is read through `need()`, so a missing rule stops the analysis.
  Its `custom_founded_legs` are coded from founding prompts; `custom_founded_coding_quotes` quotes the line for each.
- `manifest.json`, `dispatch/`, `cost/`, `issue/`, `prompts/`: the raw workspace-API answers, each with its read time in
  `manifest.json`'s `files`. 276 candidates; 158 worked in the window (4 Nov 05:00Z to the freeze).
- `pairs/`: the natural-experiment tickets (LIN-4253 → 4251, 4252 → 4246, 4255, 4254, 4247, 4201 → 4226), re-read last.
- `size/`: the size counters' raw output, pinned to `origin/main` at the freeze: `lv-prs.json` (LinearViewer, at
  `94893cc35`), `sd-prs.json` (simple-dispatcher, at `a42456c`), `lv-golden-glob.json` and `sd-golden-glob.json` (the
  `*.golden.*` sensitivity), `lv-place-change.json`, `survey-balance.json`, `survey-costmix-tokens.json`.
- `analysis.json`: every table the chart and the paper read, the fits (`v2.fits`), the disclosed sensitivity
  (`v2.sensitivityMoved`), the rounds (`v2.rounds`), and the self-checks.
- `bridge.json`: version 1's 22 exact tickets against their version 2 reads (written by `bridge.mjs`).

## Rules, and the reason for each

- **Population:** tickets with a dispatch row in the window. Candidates are the ticket ids named in either repository's commits
  since the window start, plus `LIN-4170` up to the newest id seen. Discovery by commit mention can miss a ticket that no
  commit names. That hole is unbounded, as in v1, and is stated here.
- **Exact:** state `Done`, `totalUsd` non-null, every lineage record-backed (`dispatches` non-null), no lineage incomplete,
  and production or test lines in either repository. Result: 98 exact of 156 analysed. Outside the set: 9 approximate (a lineage with no dispatch split), 3 unpriced
  (LIN-4177 and LIN-4178, Haiku, unpriced in both reads; LIN-4427, this ticket, in progress).
- **Zero-request dispatch:** a dispatch that made no request (`requests` 0, `costUsd` null) costs 0. Reason: the lineage's own
  sum already counts it as 0. LIN-4200 is the case: its dispatch `3e49cc95` is null, and the lineage's `4.876455` equals the
  sum of its other dispatches. A dispatch that made a request and has no cost stays null, and its ticket is not exact.
- **Primary size:** production lines (added + deleted) over the ticket's merged PRs in both repositories (the census production
  rule for LinearViewer, the code rule for simple-dispatcher). Tests and docs are not in the primary. A ticket with zero primary
  size (30 of the 98 exact tickets, all test-only) is counted in the dropped count and not plotted.
- **Sensitivity size:** primary plus test lines, minus test files whose basename matches `*.golden.*`. Decision: the ask's
  glob, not the census's `isGolden` (`scripts/delivery-paths.mjs`, any test path containing "golden"). The two rules differ
  on this window's files, e.g. `tests/unit/render-session-golden.test.js` is `isGolden` and not `*.golden.*`. The ask names
  the glob, so the glob is what runs. Only two simple-dispatcher rows match it, so the sensitivity moves little.
- **Custom-founded coding:** ten lineages, each coded by its founding prompt's words (work: LIN-4201, 4202, 4224, 4265,
  4282; floor: LIN-4226 (a plan), LIN-4340 ×2 (essays, not exact), LIN-4358 and LIN-4377 (read-only investigations)). Coding
  followed the prompt's words, not any cost.
- **Tokens:** `inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens`, summed over the leg's rows.
  Price-free: the dollars are priced at read time, and LIN-4358's time-of-day tiers put a calendar term in them.
  `cacheCreation1hInputTokens` is inside `cacheCreationInputTokens` (`lib/model-pricing.js:48-51`) and is not added again.
- **Marker:** the repository with more primary production lines; a tie goes to LinearViewer. Simple-dispatcher markers are few
  (4 to 5 tickets per leg), so no slope is reported for that stratum.
- **Fit:** OLS of log10(USD or tokens) on log10(primary size), per leg. A 95% percentile bootstrap over tickets: mulberry32,
  seed `20261112`, 2000 resamples (`fit.mjs`). A slope needs n ≥ 8 (the existing rule). Its reading: an interval that holds 1
  is a straight line; one entirely below 1 flattens; one entirely above bends up.
- **Strata:** Haiku-only work and Opus-only work (work leg only); tickets first dispatched on or after 8 Nov; each marker.
- **Sensitivity:** every custom dispatch that is not an after-answer moved to keep-alive. The tickets whose legs move are
  listed in `analysis.json` (`v2.sensitivityMoved`).
- **Rounds:** `computeIssueRoundTrips` (`lib/plan-review-round-trips.js:481`), unchanged, with `{review, implementation}` and
  `{plan-review, plan}`, `asOf` the freeze time. Round trips are the regressor for the floor (`v2.rounds.fit`).

## Results at a glance (the paper reads these; the chart is `docs/papers/harbour/figures/task-size-and-cost/size-cost.svg`)

Slopes of log10 cost on log10 production lines, with 95% bootstrap intervals (`analysis.json`, `v2.fits.primary`):

| Leg | n | Dropped (size/cost) | Slope | 95% interval |
|---|---|---|---|---|
| floor | 67 | 30 / 1 | 0.21 | [0.10, 0.31] |
| work | 68 | 30 / 0 | 0.38 | [0.16, 0.63] |
| keep-alive | 48 | 30 / 20 | 0.03 | [−0.31, 0.25] |
| Survey | 44 | 30 / 24 | −0.04 | [−0.15, 0.05] |

These are the observed shape. The prior in the ask (a slope below 1 with a wide interval) holds for every leg. Every interval
lies below 1, so each reads as "flattens" by the rule above. Token slopes sit close to the dollar slopes: floor 0.22, work 0.31, keep-alive 0.03, Survey 0.04 (`v2.fits.tokens`). Within one
model, the work leg reads 0.31 for Haiku (n 32) and 0.20 for Opus (n 35). The rounds regression on the floor: the size slope
is 0.214 without rounds and 0.217 with them; the round-trip coefficient is 0.19 per round trip ([0.00, 0.31], n 67). Round
trips are rare: 17 review round trips across 15 tickets and 3 plan-review round trips across 3. The rounds result is one
association at low power, and a null would not show no effect.

## Reproduce

LinearViewer root. The freeze needs `HARBOUR_LOCAL_BASE`; the analysis, the chart and the bridge do not.

```
EV=docs/papers/harbour/task-size-and-cost-evidence/2026-11-12
node docs/papers/harbour/task-size-and-cost-scripts/freeze.mjs $EV --inputs $EV/inputs.json
node docs/papers/harbour/task-size-and-cost-scripts/freeze.mjs $EV --pairs --inputs $EV/inputs.json
REPO=$PWD node docs/papers/harbour/coherence-as-it-grows-scripts/coherence-census.mjs prs 94893cc354d235273a1bba1f8ec21a680a2d86ce --json > $EV/size/lv-prs.json
REPO=$PWD/../simple-dispatcher node docs/papers/harbour/task-size-and-cost-scripts/size-prs-repo-neutral.mjs a42456c6f606ac73acedaa37e80e4cdce50415cd > $EV/size/sd-prs.json
REPO=$PWD node docs/papers/harbour/task-size-and-cost-scripts/size-golden-glob.mjs 94893cc354d235273a1bba1f8ec21a680a2d86ce LinearViewer > $EV/size/lv-golden-glob.json
REPO=$PWD/../simple-dispatcher node docs/papers/harbour/task-size-and-cost-scripts/size-golden-glob.mjs a42456c6f606ac73acedaa37e80e4cdce50415cd simple-dispatcher > $EV/size/sd-golden-glob.json
node docs/papers/harbour/task-size-and-cost-scripts/size-place-change.mjs $EV/size/lv-prs.json > $EV/size/lv-place-change.json
node docs/papers/harbour/task-size-and-cost-scripts/size-survey-balance.mjs > $EV/size/survey-balance.json
node scripts/survey-costmix-tokens.mjs --since 2026-11-04T05:00:00Z --until <read time> --out $EV/size/survey-costmix-tokens.json
node docs/papers/harbour/task-size-and-cost-scripts/analyse.mjs $EV --inputs $EV/inputs.json
node docs/papers/harbour/task-size-and-cost-scripts/chart.mjs $EV
node docs/papers/harbour/task-size-and-cost-scripts/bridge.mjs docs/papers/harbour/task-size-and-cost-evidence/2026-11-05 $EV
npm run figures:theme
```

The analysis reads this folder alone and writes byte-identical output on re-run (checked). The size files are pinned to the
SHAs above, not to `origin/main` at re-run time. A re-freeze goes into a new dated folder.
