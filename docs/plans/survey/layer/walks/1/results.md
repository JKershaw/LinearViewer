# Walk 1 results: LIN-4450, filled in after the fact

*17 Nov. Model built from `design.md` §3–4 (`ff7970890`); fill by a fresh agent that saw only the spec, the CLI notes and the material (`fill/`); read-out by `readout/readout.mjs`. Marks as on `situation.md`. "The fill says" means the fill agent's log, which I spot-checked where marked.*

## What ran

- **Model:** 256 lines, generic records, kinds from `kinds.json`. I read it all; its own test passes [checked].
- **Fill:** 45 records (88 versions), 87 writes, re-runnable from empty (`fill/fill.sh`, byte-identical on a second run, the fill says). No refusals, no rule hits [checked: `check` and `hits` on the store].
- **Read-out:** each stage's brief as of its dispatch time, beside what it could read on the tracker then [checked, by script]:

| Stage | Tracker text (lower bound) | Brief | Open things carried | Addressed to it |
|---|---|---|---|---|
| survey-task | 57,039 | 4,753 | 4 | 0 |
| survey-place | 61,029 | 5,322 | 7 | 2 |
| scoping | 64,375 | 9,273 | 16 | 8 |
| implementation | 64,375 | 9,845 | 17 | 8 |
| review | 69,876 | 8,435 | 14 | 1 |
| blind-read | 80,869 | 8,188 | 15 | 0 |
| close-out | 83,518 | 10,820 | 20 | 5 |

  Characters. The tracker figure misses LIN-4450's pre-prune description, and neither side includes the diff or the repository. "Open" is inflated: decisions and lessons are written open and stay so (break 7).

## Against the expectations (`expect.md`, `46e6b66`)

| # | Prediction | Result | Why |
|---|---|---|---|
| 1 | Every row placed; only R7, R15, R16 outside | **Failed in part** | Besides those, R8 (implementation's own summary) and part of R12 (review's gap analysis) have no home: a run's account of itself needs `run`, and a verdict holds no reasoning (break 1) |
| 2 | Kind counts | **Mostly held** | Plan 1 with 3 versions, 5 decisions, 3 verdicts as predicted. Surprises: 3 `question`s (predicted 0: the surveys' "decide which up front" became questions), 15 findings, 4 areas, 2 stub tasks |
| 3 | R1 strains for want of `setting`; R2 clean; R12 overlaps `check`; R10 a finding ended | **Held** | "Decided by the standing policy" is a string; the child links to its plan piece; review's right/wrong conditions became the checks' fields; the retired Waiting entry is a finding ended done |
| 4 | Bulk-path gap → one finding | **Held** [checked in store] | One finding, revised by leftover; blind read's item is a question shelved as the same thing. The fill counts it in four places on the tickets |
| 5 | Live probe → 1–3 checks, not scattered | **Held in part** | It stayed in checks, as four: review's checks 2 and 3 link back to the survey's probe as `same-as`, and the probe's end reason names them [checked in store]. But the probe had to end "declined" when the truth was "restated as" (break 2) |
| 6 | Rule 1 doesn't hit at close-out | **Held** | The open checks are addressed to John and the operator, not the task. The question stands: should a task close over checks it raised? |
| 7 | Rule 2 doesn't hit; departures on the plan | **Held** | Implementation's departures became plan v3 |
| 8 | Rule 4 shows the after-approval fixes | **Failed** | The PR head did move after review and blind read (the store links three heads), and nothing went stale: the PR isn't a record (break 3). Rule 4 fired somewhere unexpected instead (break 4) |
| 9 | No hits from rules 3, 5, 6 | **Held** | |
| 10 | Briefs carry much less than the tracker text | **Held** | 8–16% of the characters (table) |
| 11 | At least one brief lacks something its stage used | **Held, but not where predicted** | No brief carries the person's words: the child's `asked` is empty by design, and the parent's ask (with John's "settle engineering questions yourself") never reaches LIN-4450's stages (break 5). Whether the build used design reasoning beyond its plan piece: can't tell |
| 12 | Review and close-out link the PR, don't hold it | **Held** | |
| 13 | 20–40% of addressees guessed | **Failed** | 20 of 22 hand-offs (the fill says). The stages write for "the builder" or per area and almost never say who must act or decide |
| 14–15 | No evidence on `ask` or who-is-working | **Held** | No lanes, one stage at a time |
| 16 | The fill reaches for measured values | **Held** | Evidence (mutation table, probes, CI results) went unplaced for want of a field |
| 17 | `run` and `setting` missed | **Held** | `run`: the summary, the in-session tidies, the cost record. `setting`: the size policy, the standing direction |

## Breaks, each with why

1. **A verdict is too thin.** It holds an outcome and what it's on. Review's gap analysis and rollback plan had nowhere to go, and "approve with notes", "approve, conditional on close-out" and "better, with a worse side" all became `pass`. *Why:* the design gives a verdict no body and no outcome set; the builder invented pass/fail.
2. **A check can't be handed on.** *Why:* only `finding` has `handed-on` with a target. The fill joined the probe to review's checks with `same-as` links and an end reason, but had to end the probe "declined", which says it was refused, not restated. (Corrected 17 Nov: I first wrote that no link joined them.)
3. **A verdict on a PR head never goes stale.** *Why:* the PR isn't a record, so its heads have no versions. "Nobody re-reads these" stays invisible, the gap trace 1 named.
4. **A new plan version stales the whole plan's approval.** Piece 1's departures (v3) staled plan review's approval of pieces 2 and 3 too, and the breakdown's decision, whose basis is that approval, keeps standing with nothing flagged. *Why:* pieces have no versions of their own, and a decision resting on a verdict isn't re-checked when the verdict goes stale.
5. **The person's words never reach the child's stages.** *Why:* the brief takes only the task's own `asked`, and a child's is empty by the design's rule. Today the child at least points into the parent's text.
6. **The area pull brings other work into a build's brief.** Implementation's brief carries the test-token Waiting entry from another task (the one whose retirement pulled an unrelated sweep into this PR) and three "better still, not this task's" findings. *Why:* the brief includes every open finding for the areas a task touches, with no sense of whose it is. That reproduces the `Retires:` conveyor's effect by design [my reading].
7. **Decisions and lessons stay "open" forever.** *Why:* every record is written open, and "stands" or "holds" needs an explicit end. Briefs overstate what is open.

**Not a break but a limit:** 20 of 22 addressees were guessed, so a retro walk can't test routing. The prose doesn't carry it. This agrees with the Yap spike, more strongly, and says routing has to be written by the stage itself, which is only testable in motion.

## Better than today? (a and b)

*[my reading, from one task]*
- **Better:** one finding where the tickets have four to six retellings; the departures on the plan instead of beside it; open checks as records with an addressee; each stage's brief about a tenth of the tracker text; and one thing the tickets hide (below).
- **Worse or no better:** the person's words drop out of the child's brief (5); the area pull adds load (6); verdicts lose their reasoning (1).
- **Untested:** who writes, waking, and anything to do with lanes.

## Seen through the model, about live work

Of the three live checks LIN-4450 handed to LIN-4452, only the property check reached LIN-4452's runbook [checked]:
- The runbook's step 3 writes below the line through Harbour's proxy, not Jira's editor. LIN-4450's close-out asked for "digest survives a Jira editor save below the block", which the PR calls "the risk the live check exists to catch".
- No step dispatches a never-dispatched Jira-native ticket. Step 6 says "Running a true last step needs a dispatch on your site, and that is not proposed here."
- LIN-4452's own description and 15 comments don't mention either check [checked by search for "editor", "Jira-native", "never-dispatched", "first dispatch"; not a full read].

What it means: running the runbook as it stands would not test those two. LIN-4452 is still In Progress. This is John's call; nothing is filed.

## For the next round (not applied until John has read this)

Candidate changes to `design.md`, each from a break above. Then the page is refactored back, the model rebuilt, and this walk re-run before any other:
- verdict: a body and a declared outcome set (1)
- `handed-on` for every hand-off kind (2)
- the PR as a record whose heads are versions, or verdicts stale on the change itself (3)
- versions per plan piece; a decision resting on a stale verdict flagged (4)
- the brief carries the root task's `asked` (5)
- the area pull: decide what reaches a build (6)
- decisions and lessons written standing, not open (7)
- `run` and `setting` built (17)

The fill script is tied to this round's CLI, so the re-run needs a fresh fill against the rebuilt model, using `fill-log.md` as its guide.
