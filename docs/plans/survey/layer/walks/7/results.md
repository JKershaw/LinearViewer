# Walk 7 results: stages writing through round 6, and an outside project

*17 Nov. Round 6 page; model built fresh from design §3–4 (296 lines, read by me; its test passes 16/16). Three replays from walk 5's seeds and real outputs, each stage a fresh agent: LIN-4450 (8 steps), LIN-4446 (13), LIN-4469 (11), 32 steps in all. Yap's mobile thread filled in after the fact (29 records). Counts are [checked, `analyse.mjs`, `steps/*/show.txt`, the stages' `notes.md`]; stage notes are [reported]; readings are [my reading]. Expectations: `expect.md`, committed before the build (`e0a7a7b16`).*

**Two harness notes.** All three first stages were stopped by an API safeguard false positive (`reasoning_extraction`) before writing anything; the stage instructions had told each agent the output file was "what you really wrote in this session" and to copy it "verbatim". Reworded to treat the file as material to record (`4600f54c5`); no further stops. In LIN-4469, the review's one-second-per-write times ran past the autopilot's real start; step 9 was briefed after the review's last write (`replay-4469/steps/9-autopilot/timing-note.md`).

## Against the expectations

| # | Prediction | Result | Why |
|---|---|---|---|
| 1 | Only malformed writes refused | **Held** | 6 refusals in 32 steps, all malformed: four verdicts with a target in `of` instead of the judgement's name, two verdicts sent without `on`. No refusal of a `to` (walk 5: 23) |
| 2 | Hand-offs carried by judgements reach their reader | **Held** | Verdicts carried `to` (design, implementation, close-out); review's and the blind read's fixes reached close-out's brief in every task (e.g. LIN-4469: findings 174–182) |
| 3 | Nothing left with no reader | **Half** | Open at each end, all owned: a finding to a sibling task (4450); a finding to an area and the live checks to John (4469). But in LIN-4446 a check addressed to task-9 sits under a task that has ended, with no reader |
| 4 | Stale is quiet | **Held** | At most 2 flags per task at any step, each a verdict on a version that moved: close-out's after-approval fixes (all three tasks), plan-review's first verdict on the old plan (4446, cleared when superseded), a second review that never judged the head leftover moved to (4469, as the real reviewer said) |
| 5 | Briefs 20–60% larger than walk 5's | **Failed, larger** | Early steps about the same; later steps 40–96% larger (4446 plan-review 30,885 against 15,776 bytes; 4469 autopilot 38,383 against 22,090). The cause is part 8, the previous stage's whole output, which most stages listed as not needed |
| 6 | The blind read sees no other verdict | **Failed** | Verdict records were hidden in brief and queries, but part 8 carried the review's full account, its "Approve" included, in LIN-4450 and LIN-4446 (both blind readers reported it) |
| 7 | LIN-4450 as walk 5; close-out deals with the stale verdicts | **Half** | No refusals of meaning; both verdicts stale after close-out's fixes, shown in the record; close-out ended its fixes and merged without re-judging, as the real close-out did |
| 8 | LIN-4446: first verdict superseded; John's read an area-scoped decision | **Half** | The first verdict ended superseded into the second, which rests on the revised plan. John's read became a decision scoped to the task plus a child task for the next slices; the child's brief shows the decision. An area scope was written elsewhere (LIN-4469's leftover kept a witness test as a standing check for the area) and worked |
| 9 | LIN-4469: needs-discussion, superseded, withdrawn; stale on the ruling only if linked `on` | **Held, with the half** | All three written. The "merge waits" decisions linked the ruling `about`, not `on`, so no flag; the autopilot wrote a decision replacing those lines, so the writer handled it |
| 10 | Yap: everything has a home | **Half** | 29 records, no refusals. No PR text was reachable, so tasks have no `asked` or `done-when`; two actors were invented (an unknown author, the recorder) |
| 11 | Yap: the fix to a fix reads as one subject | **Held** | PR #13's lesson revised by #17, then superseded into #20's; the later changes link `about` the ones they redo |
| 12 | Yap's standing text splits into decisions and lessons | **Can't tell** | The thread cited none of `philosophy.md`, `rejected-ideas.md` or `AGENTS.md`; `todo.md` items fitted as tasks |

**The five round 6 writes never tested before all ran and behaved:** a `to` on decisions and verdicts; a verdict superseded (twice); "needs-discussion"; a decision scoped to an area; blindness in queries (for verdict records).

## Breaks, each with why

1. **Blindness leaks through part 8.** *Why:* part 8 carries the previous stage's account in full, and `blind` filters only verdict records.
2. **Part 8 makes briefs large, and stages mostly didn't use it.** *Why:* the account is the whole output. Round 6 added it so nothing a stage wrote is lost; the account is still in the run, which any stage can `get`.
3. **`of` was misread four times.** *Why:* the name reads as "of what" (the plan, the PR) rather than "which judgement".
4. **A record addressed to an ended task has no reader.** *Why:* nothing shows open records `to` or `in` a task that has ended.
5. **A `to` on a standing record (plan, verdict, decision) isn't in "addressed to you".** *Why:* part 3 lists open records only. Here each still reached its reader through parts 2 and 4.

**Listed, not scored:** the model silently ignores unknown options (`--to`, `--links` on the command line instead of in the JSON); a satisfied decision has no "fulfilled" end; walk 7's ticket readers of walk 6 are not involved here.

## What it says [my reading]

The structure holds what happens on a task when stages write through it: every hand-off was addressed by its writer and reached its reader, corrections replaced rather than piled, judgements were superseded rather than stacked, rulings were answered or withdrawn and ended, and what is open at the end is owned. The two faults that matter both come from round 6's own addition, part 8, and one subtraction answers both: keep each stage's words in its run, and have the brief carry only a line pointing to the previous run, as the index does. Then nothing is lost, briefs return to walk 5's size, and the blind read sees no account it shouldn't. With `of` renamed (say `judgement`) and ended tasks' open records shown somewhere, I see nothing left that is shape rather than polish.
