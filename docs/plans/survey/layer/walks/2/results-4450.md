# Walk 2 results, LIN-4450: stages replayed one at a time

*17 Nov. Model built from `design.md` round 2 §3–4 (`e4db362`); parent's part seeded by one agent (`replay-4450/seed.sh`); each of the child's eight stages then replayed by a fresh agent given only its brief, its real output from the history, and its kinds (`replay-4450/steps/<n>-<stage>/`: brief, notes, and what the task looked like after). Counts are [checked, by script over the store and steps]; stage agents' notes are [reported]; readings are [my reading]. Expectations: `expect.md` (`ddb61d0`).*

## What ran

- **80 writes by the stages, one refusal** (leftover gave an area a field it doesn't have). `check` passes on the final store.
- **28 hand-offs raised during the task, every one addressed by its writer;** none guessed (walk 1: 20 of 22 guessed). 25 went to a reader that exists; 3 went to `place`, which is no reader at all (break 3).
- **At close:** 20 of the 28 ended (14 done, 5 handed on, 1 answered); 8 left open: 4 to John (the live checks LIN-4452 owns, and "sealing is now live on your site"), 3 to `place`, 1 to the providers area.

**Each stage's brief, against what its ticket held when it started** (characters; the ticket figure is Harbour's snapshot of the child ticket; a stage also read parts of the parent):

| Stage | Child ticket | Brief | Walk 1 brief | Brief carried: open / addressed to it / stale |
|---|---|---|---|---|
| survey-task | 5,424 | 16,921 | 4,753 | 14 / 0 / 0 |
| survey-place | 9,414 | 30,872 | 5,322 | 50 / 0 / 0 |
| scoping | 12,760 | 17,470 | 9,273 | 28 / 0 / 0 |
| implementation | 13,082 | 23,190 | 9,845 | 30 / 11 / 0 |
| leftover | 13,082 | 17,767 | — | 26 / 3 / 1 |
| review | 16,214 | 18,433 | 8,435 | 29 / 0 / 1 |
| blind-read | 29,856 | 20,073 | 8,188 | 34 / 0 / 1 |
| close-out | 29,856 | 35,312 | 10,820 | 39 / 7 / 1 |

## Against the expectations

| # | Prediction | Result | Why |
|---|---|---|---|
| 1 | W1.1 verdicts hold reasoning; outcomes fit | **Held** | Review: approve-with-notes, with its reasoning, rollback and the three post-deploy checks. Blind read: better, with its "worse side" in the reasoning |
| 2 | W1.2 probe handed on, not declined | **Held** | Close-out handed `check-1` (the probe) and implementation's `finding-45` on to review's `check-3` |
| 3 | W1.3 after-approval fixes visible | **Held in the record, not at the moment** | After close-out moved the PR head, review's and blind read's verdicts show *STALE: change-1@2 now at v4* in `show`. Close-out wasn't warned, because its own move came after its brief, and the task closed over them (break 7) |
| 4 | W1.4 only piece 1's approval goes stale; the breakdown decision is flagged | **Half** | Plan review's verdict on piece 1 went stale at implementation's v3; pieces 2 and 3 didn't. The breakdown's decisions resting on that verdict were not flagged: stale doesn't pass along a chain (break 6) |
| 5 | W1.5 every brief carries the parent's ask | **Held** | All eight. Three stages said they didn't need it; whether it shaped anyone's judgement can't be seen in a replay |
| 6 | W1.6 only survey-place sees area findings | **Held** | Implementation's brief carried none. Survey-place took none on ("none bears on the Jira seal"), where the real run pulled an unrelated entry into the PR |
| 7 | W1.7 close-out's open count falls to 10 or fewer | **Failed** | 39. The model counts every record in its starting state, decisions and lessons included. *Why:* my refactor cut the line that said only hand-offs count as open, and the builder took the simplest reading (break 5) |
| 8 | Every hand-off addressed by its writer; 80% reach a reader who ends it | **Held** | 0 guessed; 20 of 28 ended or handed on by a reader; 4 more rightly open to John |
| 9 | Survey findings to implementation; "not this task's" to the area | **Half** | All survey findings for the build went to implementation. The "not this task's" went to close-out or `place`, because no brief gave the providers area's id (break 2) |
| 10 | Rule 1 forces close-out to deal with what is addressed to the task | **Can't tell** | Close-out ended or handed on everything first; no refusal was needed |
| 11 | Briefs stay below the child ticket from scoping on | **Failed** | Larger at every stage but blind read; larger than walk 1 at every stage (break 4) |
| 12 | Each stage misses at most two things | **Failed** | Most misses are outside by design (the code, the diff, CI, PR links). The ones that are the layer's: earlier records' content (every stage after the first), area ids, sibling tasks' ids, and two standing rules no record holds (breaks 1, 2, 10) |
| 13 | A few refusals, each corrected | **Failed** | One. The stages wrote cleanly |
| 14 | Leftover refused for want of a stage | **Failed, worse** | Not refused: an undeclared name is treated as an unrestricted person, so leftover created an area, revised the PR and ended implementation's finding (break 3) |

## Breaks, each with why

1. **Later stages see earlier records only as ids.** So they rewrote what was already there: the empty-fence defect twice, the live check three times (close-out later joined them), the bulk-path gap three times. *Why:* brief part 8 ("raised in this task, still open, by state") gives ids to every stage but the one that closes. The one thing a later stage most needs, what is already open, it can't read.
2. **No brief names the task's areas.** Survey-place couldn't address the providers area (it had no findings, so its id never appeared), leftover created a second "providers" area, and blind read and close-out addressed `place`. *Why:* areas reach a brief only through their findings or lessons.
3. **Any name is accepted as an addressee or an author.** `place` is no reader, so three findings went nowhere; `leftover`, undeclared, wrote with no limits. *Why:* the build's choice that an unknown name is a person, which the spec didn't rule out.
4. **The brief over-pulls.** Survey-task's 16,921 characters were mostly the parent's decisions and verdicts, including those about the sibling tasks (7,513), and lessons with long path lists (4,543); close-out's lists records twice. *Why:* part 4 takes every decision on an ancestor, not only those about this task; lessons are shown whole.
5. **Standing records count as open** (W1.7 regressed). *Why:* my refactor removed the sentence that defined it.
6. **Stale doesn't pass along a chain.** *Why:* the rule names the record's own `on` link only.
7. **A task closes over approvals resting on a moved head.** The record now shows it; nothing stops it. The real close-out template says "Nobody reviews what you change after the approval" (trace 1). Whether to refuse the close, ask for a re-review, or only show it is a call about how Harbour works, so John's.
8. **Implementation can't write a check,** so its live-check worry became a finding to John. *Why:* the stage table.
9. **No leftover stage.** *Why:* the stage table.
10. **Two standing rules have no record:** "the standing size policy" and "post-deploy checks don't hold the close". Today they live in Harbour's code and prompt text. *Why:* nobody declared them as settings; the seed found none in the material, because they aren't in the material.

## What a task looks like after each step

`steps/<n>-<stage>/show.txt` holds it. In short [checked]: 9 records after survey-task, 19 after survey-place, 22 after scoping, 27 after implementation, 28 after leftover, 34 after review, 40 after blind read, 43 at close with 13 still open (4 to John, 3 to `place`, and standing records).

## Better than today? [my reading]

- **Better:** the writers route their own hand-offs; the live check is one thread handed on to the right owner; verdicts carry their reasoning; plan departures are a new version of the piece; and the gap trace 1 named, fixes after approval that nobody re-read, now shows in the record.
- **Worse than walk 1:** briefs are bigger, and retelling came back. Both trace to breaks 1, 2 and 4, which are about what the brief shows, not to the shapes.
- **Untested still:** waking, lanes, and whether a better brief would have changed what a stage did.

## For the next round (not applied until John has read this)

From breaks 1–6 and 8–10, each a change to the page, not the code:
- every stage sees the content of what is open in its task (1);
- the brief names the task's areas by id (2);
- an addressee or author must be a declared stage, a record or a declared person (3);
- part 4 keeps only what is about this task, its piece or its change; lessons show what they say, not their path lists (4);
- the page says again that only hand-offs count as open (5);
- stale passes along `on` links (6);
- stage table: implementation may write checks; a leftover stage (8, 9);
- Harbour's standing rules seeded as settings when a walk depends on them (10).

Break 7 is John's.
