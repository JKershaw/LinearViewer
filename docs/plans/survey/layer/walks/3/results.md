# Walk 3 results: three tasks replayed, six scenes played

*17 Nov. Model built from `design.md` round 3 (`ebd1701`, 321 lines, read by me). Each task's parent part seeded by one agent; each stage then a fresh agent with its brief, its real output and its kinds, now allowed to query (`stage-instructions.md`). Scenes played by one agent each (`situations/`). Counts are [checked, by `analyse.mjs` and the stores]; stage and scene agents' notes are [reported]; readings are [my reading]. Expectations: `expect.md` (`a034db7`).*

## What ran

- **Three tasks, 27 stage steps, 3 actors outside the stages** (two autopilot steps, John's answer). About 105 queries per task; every stage looked things up (4 to 30 queries each).
- **What is open at each task's end, and to whom** [checked]: LIN-4450: three live checks to John (owned by LIN-4452), two findings to the sibling LIN-4451, one to the providers area. LIN-4472: two browser checks to John. LIN-4455: one production-log check to John. Everything else in the three tasks ended, was handed on, or answered.
- **Brief against the child ticket each stage saw** (bytes; the ticket figure is Harbour's snapshot, and a stage also read parts of the parent):

| Stage | LIN-4450 ticket / brief (walk 2 brief) | LIN-4472 ticket / brief | LIN-4455 ticket / brief |
|---|---|---|---|
| survey-task | 5,424 / 9,818 (16,921) | 4,142 / 14,665 | 2,323 / 6,749 |
| survey-place | 9,414 / 27,003 (30,872) | 7,275 / 28,379 | 6,053 / 20,256 |
| scoping | 12,760 / 14,673 (17,470) | 10,936 / 20,794 | 9,402 / 14,385 |
| implementation | 13,082 / 15,090 (23,190) | 11,283 / 20,678 | 9,753 / 15,176 |
| leftover | 13,082 / 13,563 (17,767) | 11,283 / 15,505 | 23,388 / 19,538 |
| review | 16,214 / 14,780 (18,433) | 12,649 / 16,936 | 12,699 / 14,982 |
| blind-read | 16,214 / 18,685 (20,073) | 12,649 / 18,412 | 12,699 / 17,291 |
| close-out | 29,856 / 21,272 (35,312) | 27,178 / 21,385 | 23,388 / 21,089 |

  Survey-place's size is the areas' open findings, which its job is to read. From scoping on, briefs stay in a band of about 13,500 to 21,400 while the ticket grows to 23,000–30,000.

## Against the expectations

| # | Prediction | Result | Why |
|---|---|---|---|
| 1 | Retelling stops | **Held** | LIN-4450 [checked]: the empty-fence defect is one finding plus one handed on to scoping's decision; the live probe is handed on to review's check; the bulk-path gap is handed on once to the area, and blind read added only what was new, linked to it. Walk 2 had three of each |
| 2 | Stages look things up | **Held** | Every stage queried; mostly to find what already existed before writing |
| 3 | The place is addressable | **Held** | "Not this task's" went to the area by id; no unknown names; when blind read tried a lane with no record ("A14") the layer refused it and the finding went to the area |
| 4 | Briefs shrink below walk 2, and below the ticket from scoping on | **Half** | Below walk 2 at every LIN-4450 stage. Below the ticket only from review on; survey-task 9.8k (predicted under 9k), close-out 21.3k (under 15k). Reported, not scored |
| 5 | Stale is right | **Held, but noisy** | Review's and blind read's verdicts went stale when close-out moved the head, not at merge; the breakdown's decision went stale through the chain. But see break 1 |
| 6 | Open counts honest | **Held** | Close-out's brief carries 4–6 records addressed to it; what is left open at the end is owned |
| 7 | The leftover writes as a stage and ends the area entry it settled | **Held** | LIN-4450's leftover ended the test-token entry with its reason |
| 8 | Scoping's question goes to John | **Held** | One question, to John, with a recommendation and an if-unanswered default. Scoping may not add a question, so it re-addressed survey-task's; the survey's options survive only in that question's first version |
| 9 | The autopilot has no place | **Held** | Refused even reading: "queries need --by <declared stage or person>"; its decision "by autopilot is not a declared stage or person" |
| 10 | The build goes ahead with the question open | **Held** | Implementation acted on the if-unanswered default, said so, and did not answer for John |
| 11 | John's answer ends the question, one decision | **Held** | decision-103 by John; the layer ended question-84 "answered by decision-103". Four accounts on the tickets became one question and one decision. *But* the breakdown's "no serving change" (decision-32) still stands, contradicted (break 6) |
| 12 | Waiting 2, 4, 11 ended by the stage that settled them | **Held** | Implementation, each "settled by PR #2427 and removed from the area note" |
| 13 | Departures become a new version of the piece | **Held** | All three tasks |
| 14 | The autopilot's summary has nothing to write | **Held** | 11 of its 14 lines were already in the record; its two writes were refused. The three gaps: its own evidence check, and the siblings being unblocked (no `blocks` link) |
| 15 | S1: asks open, silence not consent, no waking | **Held, better** | The asks reached LIN-4448's briefs in full at each wake (played as its nearest stage). Silence shows as open asks beside "proceeding" decisions. Builds can't ask a question; a merged PR doesn't mark an ask overtaken; each wake writes another run |
| 16 | S2: the false line stays | **Half** | The builder rested its line `on` the question, so after the withdrawal it shows stale everywhere. But the flag reaches no one, doesn't say why, and nobody supersedes it |
| 17 | S3: no one types the count | **Failed** | Every actor counted by hand and typed it (26, 25, 22). No counts view was built, and `find` has no as-of, so "how many at 10:00" can't be asked (break 4) |
| 18 | S4: ids fine, the double claim unseen | **Held** | Session B found A only by looking; A never learned of B (break 5) |
| 19 | S5: the pile grows | **Held** | 11 open to John; near-repeats linked only because the sixth run looked; nothing ends them |
| 20 | S6: every record has a home | **Held, with a cost** | Through a stretched `change`. But a check to John (placeholders still in the text) reached no reader, the task closed over it, and in the scene the newsletter went out with the placeholders (break 7; S6 is an invented scene, not a real task, corrected 17 Nov) |

## Breaks, each with why

1. **Stale over-fires.** In LIN-4450, 22 records in the task showed stale at the end, most of them already ended or merely linked `on` the plan piece "as context". *Why:* the rule doesn't skip ended records, and writers use `on` where they mean `about`. The real signal (approvals on an old head) is there but buried.
2. **The rights rule is too tight in four places.** Plan review couldn't revise the pieces it reviews (all three seeds); leftover and review couldn't move the PR's head, so review judged a head the record didn't hold; stages couldn't revise another stage's finding, so they wrote linked additions; leftover couldn't retire the lesson its new lesson replaces, so the old one stays standing beside it. *Why:* rule 6 gives revise and end to the writer, the addressee, people and close-out. The last case is the area notes' growth in miniature: corrections pile beside what they correct.
3. **Builds and scoping can't ask a question** (S1, LIN-4472). *Why:* the stage table.
4. **Counts get typed** (S3). *Why:* no counts view; `find` has no as-of.
5. **Overlapping work is unseen** (S4). *Why:* a run's claims are stored but nothing compares them.
6. **An answer doesn't retire what it overrides.** John's "extract the leaf" left the breakdown's "no serving change" standing. *Why:* nothing links an answer to the decisions it contradicts.
7. **A check to the person doesn't hold the close** (S6), and things addressed to John pile with nothing ending them (S5). *Why:* rule 1 counts only records addressed to the task; there is no waking or expiry.
8. **The autopilot has no place** (LIN-4472, LIN-4455). In Harbour it steps tasks and settles engineering questions under John's standing direction. *Why:* it isn't declared, and "settle engineering questions yourself" has no record a decider could rest on.
9. **Review needs the plan as approved, not only as built** (LIN-4455). *Why:* the brief shows the current version of the piece; the child's own ask is empty.

**Outside by design, relied on everywhere:** the diff, CI, the code, Atlassian's docs. Briefs link to the change; they never hold it. Right as it is.

**Listed, not scored** (code or a full build absorbs them): one link per type; links passed as flags; `find` without as-of; the query log using the real clock; no field for the tracker's id. **My error:** I told LIN-4472's implementation to record the merge head when the PR opened, so the record shows a commit before it existed.

## Is the layer containing everything? [my reading]

- **Yes, for what happened.** Across three tasks and six scenes, nothing that happened went without a home except the work product and evidence, which sit outside by design. Writers routed their own hand-offs; retelling stopped; a person's answer landed once and ended its question; what is left open at the end is honest and owned.
- **The breaks are of three kinds, none against the frame:**
  - **Tuning:** stale noise (1), the rights rule (2), the stage table (3), the brief for review (9).
  - **Views and timing not yet built:** counts (4), claims (5), waking and expiry (7).
  - **Decisions about how Harbour works, John's or later configuration:** what the autopilot is and on whose authority it settles questions (8); whether a check to the person holds the close (7); whether an answer supersedes what it overrides (6).
- **Load:** briefs no longer grow with the task's history the way the ticket does, but early briefs are still larger than the early ticket. That is reported, not scored, and an LLM smoothing step (design §3.4) would cut it further.
