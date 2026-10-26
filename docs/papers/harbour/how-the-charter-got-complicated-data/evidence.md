---
title: Evidence: how the charter got complicated
kind: data
date: 2026-10-26
authors: [the LIN-4007 implementation session, for John]
---

# Evidence: how the charter got complicated

Sidecar to `../how-the-charter-got-complicated.md`. Every table here is printed by the scripts in
`../how-the-charter-got-complicated-scripts/` from the files in this folder,
and the transcript is in `../how-the-charter-got-complicated-transcript/`. Record read at **14:20Z**
on 26 Oct (`fetched-at.txt`). Anything after 14:06Z on LIN-3975 is out of scope.

Re-run: `python3 fetch.py` (GET only, needs `HARBOUR_LOCAL_BASE`), then `python3 classify.py` (no network).
The fetch writes no raw ticket JSON; the derived CSVs are committed in this folder.

## 1. John's requests, and what each became (C1)

Transcript times are the header of each entry in `comment-1.md` to `comment-3.md`. Quotes were
checked with `grep -F` against `../how-the-charter-got-complicated-transcript/` (all found, one each or more).
The part 2a §6 messages (25 Oct evening to 26 Oct 07:15Z) are the operator's paraphrase of John's
messages, with card answers paraphrased; only the verbatim spans are quoted here.

| # | Time (UTC) | John's words (verbatim) | What it became | Where it landed |
|---|---|---|---|---|
| 1 | 23 Oct 09:28 (part 2b) | "Happy for this to all be bundled into a Charter if that makes things simpler." | The charter LIN-3490 | LIN-3490 and its children |
| 2 | 24 Oct ~18:50 (part 2b, msg 1) | "Chances are I'll want to keep a lot, but their relative displays for the less important views can likely be simplified so they're not too burdensome." | Plain treatments for kept pages | LIN-3950 (Plain layout), LIN-3970 to 3973 (Plain batches, Backlog) |
| 3 | 24 Oct 18:50–19:05 (part 2b, msg 2) | "I use the live console almost constantly and find it delightful" | Keep the Live Console's delight | LIN-3977 title; its brief "What makes it delightful, and must survive the rebuild" |
| 4 | 25 Oct ~17:25 (part 3 log) | "Fantastic, yes let's do this." | Order: Home first | LIN-3833 (Done 25 Oct 17:39Z) |
| 5 | 25 Oct ~18:45 (part 3 log) | "Fantastic, I agree with your recommendations. Roadmap and library can stay out. Go on the briefs. Release." | UI session files the design briefs; Roadmap and Library out | LIN-3975, LIN-3977, LIN-3983 briefs (written by the UI session, per part 3's line "UI session files a design BRIEF = the ticket") |
| 6 | 25 Oct 13:40 (part 3 log) | "keep a little note of how the duel-session approach goes. This might become a useful pattern." | The operator's dual-session log | Part 3 log; the UI review's "How the gap arose" |
| 7 | 25 Oct 19:40 (part 3 log) | "you have authority to rule on obvious things to keep things moving." | Operator rules overnight | Eight rulings passed on overnight (part 2a §6; the operator's own count, "passed 8 rulings on") |
| 8 | 25 Oct 21:20 (part 3 log) | "good plan to pass decisions on when I'm asleep." | Standing permission to pass decisions while John sleeps | The overnight rulings; the operator later wrote "I over-steered" (part 2a, 26 Oct 07:20Z PAUSED block) |
| 9 | 26 Oct 07:18 (part 1) | "Very carefully, as I suspect tickets have become bloated and contain far more rules than I intended." | Review of code, UI and tickets | Operator's 07:20Z table and 07:24 to 07:47Z reviews; retro inputs 1 and 2 |
| 10 | 26 Oct 07:24 and 07:27 (part 1) | John asks for code and ticket review by the operator, and UI review by the UI session | Three read-only reviews, and the UI review (PR #2173, merged as `973d08e`) | `docs/reviews/ui-design-gap-review-2026-10-26/`; retro inputs 1 and 2 |
| 11 | 26 Oct 07:52 (part 1) | "I think we call this charter here and do a retro to pull all this juicy information out." | Retro ticket | LIN-4006; `docs/reviews/charter-retro-2026-10-26/` (merged `123867bd`) |
| 12 | 26 Oct 07:57 (part 1) | "We also have this wonderful dashboard which tells quite the story" | Dashboard read into the retro | Retro input 4 (operator interventions) |
| 13 | 26 Oct 08:49 (part 1) | "File a new ticket to perform the retro" | The retro dispatched | LIN-4006 |
| 14 | 26 Oct 13:07 (part 1) | "my gut feeling is this just added an appended to every ticket" | The question this paper asks | LIN-4007 description, "Why" section (quoted there) |
| 15 | 26 Oct 13:10 (part 1) | "Worth another investigation to pull this all together? Perhaps a Paper/essay?" | Paper, not essay | LIN-4007, created 14:05:24Z, titled "Paper" |
| 16 | 26 Oct 14:00 (part 1) | "If we think through the actual information that we're sort of fishing for we can keep this relatively simple as exercise to just identify what happened." | The six transcript comments; the scope of the research | LIN-4007 comments 14:05:25 to 14:05:38Z |

Earlier turns, quoted in the operator's logs only:

| Time | Quoted in | Words | Became |
|---|---|---|---|
| 25 Oct evening | part 2a §6 | "We're at 80%, and I'm comfortable up to 95%" | The meter ceiling for the week; the operator's 95% plan |
| 25 Oct 07:05 | part 3 log | "Haiku was intentional" | The Haiku choice for implementation is John's, not a finding (the operator's log entry says "drop that concern") |
| 26 Oct 07:20 | part 2a PAUSED block | "That's a shame we couldn't follow the process." | Pause of all launches and steering; the operator's record of its own over-steer |

Ticket-side John choices (LIN-3833, from the ticket's comments; these are the operator's relay, not
John's words, and are not quoted as his):

- 25 Oct 09:16:58Z: ruling on Q1 (`lin3833-q1-harness`): stop forcing the harness.
- 25 Oct 09:42:10Z: plan revision after "John's ruling `c73a200d`", dropping the Q3 lineage reader. John's words in the operator's log: "For now, we want what's simple and correct" (part 3).
- 25 Oct 17:05:34Z: review ledger amended by ruling `lin3833-fit-rule-loop`.

Limits of this trace: John's turns from 23 Oct 09:40Z to 24 Oct 18:50Z and the 25 Oct daytime survive
only as operator quotes; words given in other sessions (UI, Costs, observer) are not in this record. The
turn-by-turn record before 26 Oct 07:17Z was not kept (the transcript's part 2a is a summary).

## 2. Where the five main UI tickets' text came from (C2, C3)

Classes: `brief` = description headings not listed below (includes the UI session's briefs and John's own
text). `operator` = headings or comments that say operator, prediction, score or visual judge. `john` =
"Open for John", "Answered by John", and comments opening "John", "Ruling" or answers to open questions.
`pipeline` = research, plan, plan-review, review, close-out, autopilot, implementation and fix-up
comments, and their description sections. `unmatched` = comments whose opening line matches none of
these; reported, not assumed to be pipeline (the research's spike assumed so; the counts differ by up to
2 points).

Character shares. "Cut 1" = description without pipeline sections, plus comments created before the first
pipeline comment (what the implementer had at launch). "Cut 2" = the current description plus every comment
created before the first implementation dispatch. "Now" = the whole record at 14:20Z.

| Ticket | Cut 1 chars | brief | john | operator | unmatched | Cut 2 chars | pipeline | Now chars | pipeline |
|---|---|---|---|---|---|---|---|---|---|
| LIN-3833 Home | 17,005 | 67.5 | 9.7 | 17.7 | 5.1 | 103,760 | 81.5 | 164,826 | 85.7 |
| LIN-3975 Task page | 18,713 | 69.6 | 2.4 | 24.5 | 3.6 | 150,867 | 87.3 | 224,086 | 84.9 |
| LIN-3977 Live Console | 18,589 | 74.4 | 1.2 | 19.2 | 5.2 | 126,637 | 83.3 | 161,494 | 82.8 |
| LIN-3983 Observation | 18,370 | 72.9 | 1.5 | 18.6 | 6.9 | 99,411 | 80.9 | 165,918 | 83.4 |
| LIN-3952 Models | 19,192 | 66.1 | 0.0 | 33.9 | 0.0 | 81,447 | 75.7 | 102,202 | 77.2 |

Cut 2 for LIN-3977 and LIN-3983 undercounts pipeline text: both are Done, and their plan sections were pruned
after close. LIN-3983 was 69,195 characters at about 07:45Z (retro input 6) and 17,405 now. Cut 1 is not
affected, since it excludes pipeline sections and Done tickets' brief and operator sections were not pruned.

Brief authorship (from the record, not inferred): LIN-3975, LIN-3977 and LIN-3983 were filed by the UI
session and checked by the operator (part 3, "UI session files a design BRIEF = the ticket"); LIN-3952 was
"written from John's review via other session" (part 3, STATE-2026-10-25-1855); LIN-3833's author is not
recorded. The LIN-3833 brief's author shares are unknown and are not estimated.

Comment author is one token for all of them ("John Kershaw"), so every comment was attributed by its
opening line, as the research's §3 describes. Unmatched comments: LIN-3833 8, LIN-3975 9, LIN-3977 4,
LIN-3983 8, LIN-3952 2.

## 3. Stage by stage: durable artefacts (C4, C7)

Runs by stage across the retro's index (`input-6`, 07:45Z; 1,107 runs on the tickets created or closed
since 23 Oct; `custom` runs appear to be the operator's own follow-up dispatches, per part 2a §2's example):

| Run kind | Runs |
|---|---|
| implementation | 174 |
| review | 168 |
| plan | 154 |
| custom | 143 |
| close-out | 138 |
| autopilot | 135 |
| plan-review | 118 |
| research | 49 |
| blocked | 11 |
| design | 7 |
| breakdown | 4 |
| bug | 3 |
| retrospective-audit | 2 |
| triage | 1 |

Rulings per main UI ticket (`GET /rulings?issueIdentifier=X&includeResolved=true`, read 14:20Z): LIN-3833 8,
LIN-3975 5, LIN-3977 2, LIN-3983 4, LIN-3952 1. Total 20. Comparison tickets: LIN-3846 1, the rest 0.

Plan-review sessions on the same tickets (`/issues/X/cost`): LIN-3833 5, LIN-3975 5, LIN-3977 8,
LIN-3983 6, LIN-3952 2.

Served the goal (C5). The walk of the retro's index from LIN-3490, LIN-3892, LIN-3757 and LIN-3855 found
68 tickets under the four roots, each with a state in the index (`tree.csv`, 07:45Z). Coded by one reader from each title
(`c5-coding.csv`), with the rule: **served** = changed what a user of the kept pages sees, or removed
code; **process-only** = kept the pipeline moving (tests, tooling, rules, papers, rulings mechanics);
**not-needed** = neither; **umbrella** = a grouping ticket, not counted; **open** = not Done.

| State | served | process-only | not-needed | umbrella | open |
|---|---|---|---|---|---|
| Done | 24 | 17 | 1 | 1 | |
| open | | | | 2 | 23 |

Of the 42 Done tickets that are not umbrellas, 24 (57%) are coded served. Titles were the only evidence, so
the coding is a single reader's and is not checked; the research recommended a second reader on a sample,
which this pass did not make. The index was fetched at 07:45Z; tickets filed later are not in it.
The walk finds 22 direct children of LIN-3490 in the index, where the research counted 24 at 14:10Z;
the difference is tickets filed after the index snapshot.

## 4. Did long tickets make the work harder? (C6, Q4)

Length is measured at launch (cut 1), not from final size. Outcomes are implementation sessions,
plan-review and review sessions, post-dispatch comments by John or the operator (`john` and `operator`
classes after the first implementation dispatch), and the summed session time of implementation runs
(`durationMs`, not start-to-merge; the merge dates in the index are day-level only). The first-pass review
verdict was not parsed in this pass and is not reported.

Model tier is from `/issues/X/cost`. A null model is "not recorded". Identifiers are not written here.

| Ticket | Set | Cut-1 chars | Impl sessions | Impl tier | Plan-review | Review | Post-dispatch John/operator comments | Impl session hours |
|---|---|---|---|---|---|---|---|---|
| LIN-3986 | short | 6,434 | 1 | Haiku | 0 | 1 | 2 | 0.56 |
| LIN-4003 | short | 6,394 | 1 | Haiku | 0 | 1 | 1 | 0.26 |
| LIN-3995 | short | 8,404 | 1 | Haiku | 0 | 1 | 1 | 0.54 |
| LIN-3992 | short | 12,851 | 1 | Haiku | 0 | 1 | 2 | 0.49 |
| LIN-3849 | short, Sonnet | 8,432 | 1 | Sonnet | 4 | 1 | 0 | 0.97 |
| LIN-3872 | router move | 29,857 | 1 | Sonnet | 0 | 1 | 1 | 0.29 |
| LIN-3876 | router move | 47,062 | 1 | Sonnet | 0 | 1 | 1 | 0.25 |
| LIN-3877 | router move | 45,968 | 1 | Sonnet | 1 | 1 | 1 | 0.21 |
| LIN-3883 | router move | 15,412 | 1 | Sonnet | 1 | 1 | 1 | 0.20 |
| LIN-3893 | router move | 34,398 | 1 | Sonnet | 1 | 1 | 1 | 0.18 |
| LIN-3917 | router move | 41,333 | 1 | Haiku | 0 | 1 | 1 | 0.27 |
| LIN-3846 | Sonnet UI | 35,598 | 2 | Sonnet / not recorded | 2 | 1 | 0 | 2.66 |
| LIN-3833 | Haiku UI | 17,005 | 5 | Haiku | 5 | 4 | 4 | 4.12 |
| LIN-3975 | Haiku UI | 18,713 | 6 | Haiku / not recorded | 5 | 6 | 1 | 21.50 |
| LIN-3977 | Haiku UI | 18,589 | 2 | Haiku | 8 | 2 | 2 | 2.66 |
| LIN-3983 | Haiku UI | 18,370 | 5 | Haiku | 6 | 6 | 1 | 3.66 |
| LIN-3952 | Haiku UI | 19,192 | 2 | Haiku | 2 | 2 | 0 | 3.96 |

Reading this table:

- Within Haiku, the four short tickets (6–13K at launch) took one implementation each. The five UI tickets
  (17–19K at launch) took two to six, with 2–8 plan-review sessions. Scope, period and length move together here.
- The long router moves (15–47K at launch) took one implementation each and none had a ruling. Five of six
  were Sonnet; LIN-3917 was Haiku. The research assumed Haiku for the router moves; the cost endpoint does not
  support that, so the router moves are not a clean Haiku-on-long-tickets case.
- LIN-3849, a short Sonnet ticket, had four plan-review sessions, which length alone does not explain.
- The record cannot separate model, length, scope and period. The UI tickets are all Haiku, all open-ended,
  all had rulings or post-dispatch comments; the router moves are mostly Sonnet, byte-identical, and had
  neither. This agrees with `ticket-record-and-quality.md` (size predicts nothing for first-pass approval)
  and `how-a-task-is-composed.md` (size and composition cannot be separated). The candidate the record
  supports is open-endedness plus mid-run changes; it is not tested.

## 5. Method

- Scripts: `../how-the-charter-got-complicated-scripts/fetch.py` (GET only, six transcript comments byte for
  byte, derived CSVs) and `classify.py` (classes, cut points, Q4 table, run kinds, C5 summary).
- Record: LIN-4007 comments and description, LIN-3833, 3975, 3977, 3983, 3952 (description, comments,
  `/rulings`, `/cost`), 12 comparison tickets (`/issues/X`, `/cost`, `/rulings`), and the retro's
  input 6 CSV for the tree and run kinds.
- Transcript: `../how-the-charter-got-complicated-transcript/comment-1.md` to `comment-6.md`, copied from the
  proxy and compared by byte count with the fetch.
- Checks made: each John quote in the paper and in section 1 found by `grep -F` in the transcript files
  (all found); no ticket, ruling or code changed; no model identifier written by the scripts.

## 6. Checks and gaps

- Transcript comment 4 contains one model identifier, in a STATE line dated 25 Oct 04:05Z, as the
  operator wrote it. The transcript is committed as given, per the ticket. This is the one identifier in
  the repository's new files; the rest use tier names.
- Descriptions are the current text. For Done tickets the plan was pruned after close, so cut 2 for the
  Done tickets undercounts pipeline text.
- The research's "about 13 KB" paper and its Q4 hours (7.7–34 h start to merge) were not re-derived here.
- The record time is 14:20Z. LIN-3975 was paused at 14:06Z by its autopilot; anything after is not counted.
