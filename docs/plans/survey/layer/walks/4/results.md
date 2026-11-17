# Walk 4 results: walk 3 again, on a store that checks shape only

*17 Nov. Model built fresh from `design.md` round 4 (226 lines, read by me; its test passes). Seeds ported from walk 3 with the old workarounds removed; each stage a fresh agent with its brief, its real output and the store (`stage-instructions.md`); the six scenes played one agent each (`situations/`). Counts are [checked, by `analyse.mjs`, the stores and `show`]; stage and scene agents' notes are [reported]; readings are [my reading]. Expectations: `expect.md` (`d02894d`).*

## What ran

- **Three tasks, 27 steps** (LIN-4450 8, LIN-4472 10 with the autopilot and John, LIN-4455 9 with the autopilot); about 100 to 130 queries per task. **Six scenes.**
- **Refusals across all 27 steps:** two, both right: a verdict written without its `on` link, and the follow-up that depended on it. In walk 3 every task needed workarounds for who-may-write rules, and the autopilot was refused outright.
- **What is open at each task's end** [checked]: LIN-4450: one finding to review (a source-map check its real review didn't make); the two live checks went to LIN-4452's task, their owner. LIN-4472: two browser checks to John, one finding to the parent. LIN-4455: one log check to John, two findings and a question to the area, one finding to the parent.
- **Stale at each task's end:** two records per task, and in all three they are the review's and blind read's verdicts, made stale when close-out moved the PR head. Walk 3: 22 in LIN-4450, mostly noise.

**Brief against the child ticket each stage saw** (bytes; walk 3's brief in brackets):

| Stage | LIN-4450 ticket / brief (w3) | LIN-4472 ticket / brief (w3) | LIN-4455 ticket / brief (w3) |
|---|---|---|---|
| survey-task | 5,424 / 9,553 (9,818) | 4,142 / 12,095 (14,665) | 2,323 / 6,447 (6,749) |
| survey-place | 9,414 / 11,816 (27,003) | 7,275 / 15,299 (28,379) | 6,053 / 9,977 (20,256) |
| scoping | 12,760 / 14,486 (14,673) | 10,936 / 16,787 (20,794) | 9,402 / 12,098 (14,385) |
| implementation | 13,082 / 17,764 (15,090) | 11,283 / 18,318 (20,678) | 9,753 / 12,795 (15,176) |
| leftover | 13,082 / 13,533 (13,563) | 11,283 / 15,691 (15,505) | 23,388 / 17,709 (19,538) |
| review | 16,214 / 15,930 (14,780) | 12,649 / 17,035 (16,936) | 12,699 / 12,073 (14,982) |
| blind-read | 16,214 / 18,100 (18,685) | 12,649 / 18,005 (18,412) | 12,699 / 14,308 (17,291) |
| close-out | 29,856 / 20,274 (21,272) | 27,178 / 21,787 (21,385) | 23,388 / 19,505 (21,089) |

Survey-place's brief halved: it now gets each area's id and how many open records it holds, and looks them up. The rest are close to walk 3, and settle between about 12,000 and 22,000 while the ticket reaches 23,000 to 30,000.

## Against the expectations

| # | Prediction | Result | Why |
|---|---|---|---|
| 1 | Only malformed writes refused; seeds need no workarounds | **Held** | Two refusals, both shape. Seeds wrote plan-review's and design's revisions as themselves |
| 2 | Corrections replace rather than pile | **Held** | Stages revised each other's findings (survey-place, review, blind read, leftover), review rewrote the live check instead of adding one, leftover moved the PR head, implementation revised a lesson. Walk 3: linked additions instead |
| 3 | Retelling stays stopped | **Held** | LIN-4450: the empty fence is one finding settled by one decision; the live probe one check, handed on once and revised; the bulk-path gap one finding handed on into one question for the area |
| 4 | Survey-place under 10,000; others within a fifth of walk 3 | **Half** | Survey-place halved (9,977–15,299), under 10,000 only for LIN-4455. Others within a fifth, all three tasks |
| 5 | Stale quieter and right | **Held** | Two per task, both the verdicts on the moved head |
| 6 | Open at the end is owned | **Held** | Each open record is addressed to a task, an area, a stage or John |
| 7 | Review can find the plan as approved | **Can't tell** | No review needed to: none asked for an earlier version |
| 8 | The autopilot writes as itself | **Held** | It settled scoping's question as decision-66, ended the question, and on its own revised the breakdown's out-of-date "no serving change" line |
| 9 | Implementation acts on the autopilot's decision, saying whose | **Held** | decision-70 rests `on` decision-66@1 |
| 10 | John's answer supersedes the autopilot's | **Half** | His answer agreed with the autopilot's, so it was linked `same-as`, not superseded: right, and my prediction was wrong. But nothing was open for John when he answered; he found the question only by searching his own words |
| 11 | The autopilot's summary adds little | **Held** | "Almost everything" was already in the store; it wrote only its run |
| 12 | Waiting 2, 4, 11 ended by the stage that settled them | **Half** | Implementation handed them on into the PR record rather than ending them done, and nothing ended them at the merge. Closed and traceable, not marked settled |
| 13 | S1: builds' asks are questions; silence leaves them open | **Held** | All three asks reached LIN-4448's lane, and its autopilot saw them at every wake |
| 14 | S2: the gate line shows stale after the withdrawal | **Held, better** | The autopilot saw the stale flag in its brief and ended the false line itself; the next morning nothing said merge was gated |
| 15 | S3: no one types a count | **Held** | Counts came from the brief and `find`; the reviewer re-ran the 10:00 query as of 10:00 and 17:00. No two figures disagree |
| 16 | S4: B learns of A from its brief | **Half** | B learned of A only by looking up an index line. The brief's open-runs part lists runs of *other* tasks, so two runs on the same task were missed |
| 17 | S5: the pile stays | **Better** | Each run looked up what was open for John, linked near-repeats and handed the older one on; the last withdrew two past their own deadline. Only because they looked: no brief part points a run at what is open for the person |
| 18 | S6: every record has a home; close-out sees the check | **Held** | A saved file is a `change` with a content hash as head; the verdict rests on that version. Close-out saw the open questions and didn't send |

## Breaks, each with why

1. **The brief doesn't carry the task's own done-when and paths** (LIN-4472 survey-task, LIN-4455 scoping, S6). *Why:* part 1 is "the person's words", and a child task has no `asked`; its done-when needed a lookup.
2. **One link of each type** (LIN-4455 scoping couldn't rest a decision on two findings; S3; S5). *Why:* §3.1 doesn't say a record may hold several links of a type, and the build chose one.
3. **The blind read's brief carries the review's verdict and reasoning** (LIN-4450). *Why:* part 4 shows what stands about the task to every actor. A blind read should not see the judgement it is checked against.
4. **The open-runs part misses runs on the same task** (S4). *Why:* §3.5 part 6 says "runs of other tasks".
5. **Tracker ids aren't held.** Most stages had to work out which task LIN-4451 or LIN-4447 was from text. *Why:* a task has no field for its ticket.
6. **The stale flag doesn't say why** (S2). *Why:* the view gives a flag, not the link that moved.

**Not the store's, and handled by agents as Harbour would:** whether a question settled by the autopilot still reaches John (LIN-4472: nothing was open for him); a question with no reply staying open, and if-unanswered deadlines as free text (S1, S5); a task closing over checks to John (LIN-4472 close-out judged it). These are Harbour's workflow. The store showed each of them plainly to whoever looked.

**Listed, not scored:** the standing rules Harbour keeps in prompts and code (the "size of the move" vocabulary and policy, asked about by every scoping); seeded areas missing for paths some findings named (`routes/`, runs-and-dispatch); "sent" not an end of `change` in S6, and the store keeps a hash, not the file; a verdict's "approve, conditional on close-out" carried in its reasoning and checks; the query log on the real clock. **Instruction breach:** LIN-4450's leftover opened `store.json` directly once; the instructions now say not to, and later stages didn't.

## Is the store holding? [my reading]

- **Yes.** With every rule about who may write or when taken out, nothing went wrong that those rules had been preventing: no malformed record entered, no stage wrote over another's work wrongly, and the agents did the acting (settling, superseding, handing on, ending) themselves, as Harbour's agents do with tickets today.
- **It got better where the rules had been in the way:** corrections replace instead of piling, stale shows only the real signal, the autopilot has a place, and survey-place's brief halved.
- **What's left is small and about the store's shape:** the brief's first part, more than one link per type, what a blind read is shown, the same-task runs, a tracker id, and saying why something is stale. Each is a line in the design, not a new idea.
