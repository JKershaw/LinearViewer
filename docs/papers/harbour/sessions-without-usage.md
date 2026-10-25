---
title: Can model, effort, kind and run time estimate the cost of a session that never reported usage?
kind: paper
version: 1
date: 2026-10-25
authors: [Claude (LIN-3944), for John Kershaw]
model: claude-haiku-5-5 in Claude Code, dispatched by simple-dispatcher (dispatch eaab6f5a-62e6-4271-9874-b0e13b025ea9, kind implementation, LIN-3944), effort high
grounded_at: 3861e1ea (LinearViewer, origin/main); 955349d (simple-dispatcher, HEAD); runner logs, transcripts and /cost records read 25 Oct 2026
cites:
  - "lib/task-cost.js@3861e1ea:85 (buildTaskCost, which keeps status 'taken'), :138-141 (the no-telemetry branch), :175-179 (totalUsd nulled)"
  - "lib/terminal-marked-task-cost.js@3861e1ea:142 (reduceLineageCost, the second cost path)"
  - "lib/model-pricing.js@3861e1ea:347 (computeUsageCostUsd)"
  - "docs/plans/costs.md@3861e1ea:55 (Not counted), :115 (Consolidate), :132 (this question)"
  - "simple-dispatcher/hook.js@955349d:359 (postUsageSnapshot), :1628-1634 (a text-only turn has no transcript at Stop), :1763 and six other Stop branches"
  - "simple-dispatcher/transcript.js@955349d:408-411 (walkUsage's sidechain note), :421 (walkUsage)"
  - "LIN-3944 comment 18db768b (25 Oct 2026), the research notes this paper re-runs"
  - "LIN-3859 (subagent transcripts), LIN-3936 (Costs), LIN-3937 (Costs untangle, step 1), LIN-3945 (the 7 unpriced Haiku rows)"
data: "sessions-without-usage-sessions.csv (one row per dispatch lineage, 3,508); sessions-without-usage-scripts/ (the stage scripts); sessions-without-usage-analysis.txt (the stage-2 output this text quotes)"
---

## The answer

No, not as a number to show. Model, kind and run time predict a reported session's cost to a median 31% error. On the sessions that actually went missing they do not: on the 25 of them with a transcript on disk, the same estimator misses each session by a median 96% and the total by +29%. The missing spend is small, about $18 of $8,260 reported (0.22%), and 41% of the 117 rows with no usage never ran a session at all.

**Recommendation: classify, recover and bound; do not estimate.** Rows that never launched leave the cost figures. Sessions whose transcripts survive are recovered exactly. What remains stays under Not counted as a count with an upper bound, labelled "≤", never as "≈" and never inside a total. The cause fix, a final usage post at session end, belongs to simple-dispatcher and is listed under Next.

## Findings

**1. The estimator works on reported sessions and fails on the missing ones.** Fit on the 3,384 priced sessions, five-fold, with run time: median per-session error 31%, and 80% of sessions fall within ×0.54 to ×1.91. Per-fold errors on totals run from −23% to +12%. By model it is 27% for Opus and 26% for Sonnet, and 165% for DeepSeek. By kind it is 9–41% for plan, plan-review, breakdown, research, review, close-out, custom, autopilot and blocked, and 88–89% for wake and implementation. On the 25 real missing sessions with a transcript it predicts $18.75 against $14.50 true (+29% in total), with a median per-session error of 96%. Without run time it predicts $47.03 (+224%). The missing sessions are mostly one-turn sessions under a minute, which the estimator has not seen.

**2. 48 of the 117 rows are not sessions.** Twenty-one are aborts, one of which logged "No session to abort" rather than "Aborting session". Fifteen are follow-ups rejected because their target was gone, five are follow-ups signalled into a waiting parent, and seven were refused at launch ("Unknown repo"). None created a workspace session, so their true cost is $0. Costs still counts them as missing telemetry: `buildTaskCost` keeps every `taken` row and marks an unlaunched one as `noTelemetryCount` (`lib/task-cost.js:138-141`), which nulls `totalUsd` for their issues (`:175-179`).

**3. Twenty-five sessions are recoverable exactly.** These are claude-code sessions whose transcript is still on the runner host. Recomputed with simple-dispatcher's own `walkUsage` and priced with `computeUsageCostUsd`, they cost $14.50 in total (median $0.22, maximum $5.53). Their reported cost is absent, so they should be backfilled.

**4. What cannot be recovered is a few dollars.** Thirty-five DeepSeek sessions on opencode (26 Sep to 8 Oct) have no surviving records. Their same-model, same-kind cost is $1.91 at the median, $10.46 at p90 and $51.74 at the maximum. Seven claude-code sessions have no transcript (one turn, all under two minutes): $1.53 at the recoverable median and $5.95 at p90. Two launched with no assistant turn (about $0). Counting the recovered $14.50, the whole no-usage set is $17.94 likely, 0.22% of reported spend. The upper bound on the 42 unrecovered rows, using the run-time-matched maximum below, is $82.02, which brings the whole set to $96.52 (1.17%).

**5. The reported total is short of the transcripts, and the subagent gap is larger than the no-usage gap.** On the 2,981 matched sessions, reported cost is $8,104 against $8,294 in the transcripts, a $190 (2.3%) shortfall. The per-session ratio has a median of 0.958 (p5 0.913, p95 1.000). The cause is not verified; the likely reason is a Stop-time snapshot taken before the last turn is flushed. Separately, 130 sessions have subagent transcripts that carry $801 (9.7% of priced reported cost). No main transcript contains a sidechain line (0 of 3,022), so subagent turns sit in separate files that `walkUsage` never reads. LIN-3859 owns this. For scale, $801 is about forty-five times the $18 likely across every no-usage row.

**6. Effort adds nothing measurable here, but it was not constant within a kind.** Taking effort out of the estimator's cell leaves the five-fold median at 30% instead of 31%, and the time-split total at +34% instead of +35%. Within a kind, most models ran at one effort, but six kind and model pairs ran at two: review on Opus (633 medium, 4 high), implementation on Sonnet (371 medium, 1 high), autopilot on Opus (340 high, 54 medium), autopilot on Sonnet (44 high, 1 medium), implementation on Opus (38 high, 1 medium) and wake on Opus (27 high, 12 medium). An earlier note said every model ran at one effort per kind; that is too strong.

**7. The newest routing has no priced training rows.** Haiku 5.5 took implementation from 24 Oct: seven sessions, all unpriced (over the 100k context tier, LIN-3945), and none priced. A time split, trained before 18 Oct and tested from 18 Oct, gives +35% on the total with run time and +85% with the cell median alone. Routing moved faster than the estimator can follow.

## Method

**Population.** Dispatch lineages (`rootItemId`) whose UTC `dispatchedAt` day falls from 26 Sep to 24 Oct 2026, read through `GET /api/proxy/cost/{id}` for each issue in the list. The list is every issue in the runner logs dated 24 Sep or later, plus LIN-3807 to LIN-3944 (the research's first pass). That gives 694 issues, reproduced exactly from the logs by `issue-numbers.py`. The result is 3,508 lineages: 3,384 priced, 7 unpriced, 117 with no usage.

**Stage 1 (needs the runner host and the proxy).** Run in this order:

1. `python3 -I issue-numbers.py <logs> issues.txt`
2. `HARBOUR_LOCAL_BASE=… python3 -I sweep.py cost.jsonl issues.txt` (read-only; paced under the proxy's 60/min limit)
3. `python3 -I logmap.py <logs> logmap.json` (dispatch item to launched session, with the harness, model and effort the launch log records)
4. `node transcript-cost.mjs logmap.json tcost.json <simple-dispatcher> <LinearViewer> <workspaces>` (`walkUsage` and `computeUsageCostUsd`, plus the sidechain count)
5. `python3 -I build-table.py <logs> cost.jsonl logmap.json tcost.json sessions.csv`

**Classes.** A row is *priced* when it has a harness or model and a cost, and *unpriced* when it has a harness but no cost. A row with neither is *no-usage*, and its subclass comes from the runner's own logs: *abort* (its block says "Aborting session" or "No session to abort"), *follow-up-reject* or *follow-up-signal* (a `[follow-up]` line for its first eight characters), *refused* ("Unknown repo"), and *no-launch-record* (none of these; zero rows). A row that launched is *opencode* when its launch record says so, *no-transcript* when its Claude Code transcript is missing, *no-turn* when the transcript holds no assistant turn, and *recoverable* otherwise.

**Estimator.** Cells are kind, model family and effort, backing off to kind and model, then kind, then global, at five or more sessions. Each cell gives the median cost, or a within-cell log-log fit of cost on run time in minutes with Duan smearing for totals. Five folds are seeded with 3944; the time split is at 18 Oct.

**Bounds.** The cell maximum is the largest priced cost in the same kind and model family. The run-time-matched maximum is the largest priced cost in that cell among sessions that ran no longer than the row did, falling back to the cell maximum when none did. Each is back-tested against the 25 recoverable sessions, each of which has a true transcript cost.

**Stage 2 (runs on the committed table alone).** `python3 -I analyse.py sessions-without-usage-sessions.csv` prints every figure above. Its output is committed as `sessions-without-usage-analysis.txt`, and a re-run must match it byte for byte.

## Limits

- **One runner host.** Every reported session in the window has a launch record on this host, so for this workspace the population is complete. Other runners cannot be bounded from here, and issue-less sessions are unbounded (there are none on this host).
- **The issue list is a rule, checked only by reproduction.** A lineage on an issue missing from the list would be invisible. The rule reproduces the 694 issues exactly, but that is evidence that it is consistent, not that it is complete.
- **The snapshot is not the live state.** The `/cost` records were read at 11:47 on 25 Oct; the logs and transcripts were read later. The count is 117 here against the Costs note's 114, because in-flight rows moved. The difference is reported, not trimmed. Stage 1's inputs (`cost.jsonl`, `logmap.json`, `tcost.json`) are not committed; `build-table.py` was re-run from them to reproduce the table exactly, but a fresh sweep reads later state and will differ.
- **The reported-cost shortfall is a measurement, not a diagnosis.** Its cause is a hypothesis.
- **The decisive test is small.** Twenty-five sessions, mostly one-turn and under a minute. Its error is measured on those, not on the whole missing population.
- **The bounds are ceilings, not guarantees.** The run-time-matched bound covers 24 of 25 recoverable sessions. The miss is LIN-3461, a 3.0-minute plan session that cost $0.996 against a matched maximum of $0.863. The opencode sessions ran toward the 60-minute failsafe, so if they were heavier than their cell the bound understates them. The cell maximum is shown beside the matched figure. It covers all 25, but the unrecovered rows reach $1,351 under it, which is useless as a bound.
- **Two claims were read once and are not scripted.** The LIN-3229 check (first-wins and per-field maximum sums match on all main transcripts) was not re-run here. The consumer list in Next came from two greps in the research notes.
- **Corrections to the research notes.** `reduceLineageCost` is in `lib/terminal-marked-task-cost.js:142`, not `dispatch-lineage.js`. `walkUsage` is at `transcript.js:421`. The "one effort per model per kind" claim is wrong (six pairs). The "kind median" bound was a same-model median, and the note's "≤ X" was a median, not a maximum. The note's "2–5× over" is 3.2× without run time and +29% with it. The median non-abort duration is 1.2 minutes here, not 0.7.

## Next

These four moves are the recommendation. None is blocking. Each lands in the layer named, and the owner is named in its entry.

- **(a) Rows that never launched are not sessions.** Take the 48 out of Not counted and out of `noTelemetryCount` in both cost paths: `lib/task-cost.js:138-141` and `lib/terminal-marked-task-cost.js:142`. Owner: LIN-3936 (Consolidate, `docs/plans/costs.md:115`). LIN-3937 is its first step and holds `costs.md` now, so this paper does not edit it.
- **(b) The cause fix.** The runner posts a final usage snapshot at session end and at reap, read after the transcript is flushed, so one-turn and killed sessions post too. Owner: simple-dispatcher (`hook.js:359`, and the Stop branches from `:1763`). Subagent files are LIN-3859.
- **(c) Backfill the recoverable sessions** from their transcripts on the runner host, through `walkUsage` and the same pricer, so that there is one reducer.
- **(d) The residue stays under Not counted** as a count and "≤ $82" for the 42 unrecovered rows, from the run-time-matched bound (the largest priced cost in the same kind and model among sessions that ran no longer; a ceiling, which covered 24 of the 25 back-tested sessions). It is never "≈" and never in a total.

The layers that must agree with (a) and (c), from the research's grep, are `lib/task-cost.js`, `lib/terminal-marked-task-cost.js`, `lib/weekly-budget.js`, `lib/observation-sessions-store.js`, `lib/kpi-stats.js` (its own Mongo projection), `lib/run-view.js`, `lib/render-run-steps.js`, `lib/render-session.js`, `lib/effort-readout.js` and `lib/liveness-detectors.js`. A bound is never rendered as a cost.

Two lines go into `proposals.md`: the runner's end-of-session usage post and the capture rate it buys, and whether a run-time-matched bound holds on a larger sample of one-turn sessions than the 25 here.
