# Walk 1 fill log: LIN-4450 into the walk-1 model

Store: `store.json` (retro mode). It is rebuilt from empty by `fill.sh`: 87 writes, 0 refusals, 0 hits. `check` reports no failures. Running `fill.sh` a second time from empty gives a byte-identical store (sha256 `0436bae3…`).

45 records in all: area 4, lesson 6, finding 15, task 4, decision 5, plan 1 (3 versions), verdict 3, question 3, check 4.

Times. Each record is written at the time of the comment or event it comes from. The exceptions are marked in the table and in `fill.sh`:
- pre-existing records use a placeholder, 12:00Z;
- the parent's Size record (13:25) and the Implementation Plan (13:36) are guessed, placed between the comments around them;
- scoping wrote no comment, so its decision uses the last model request in the cost record (13:55:31);
- close-out's fixes end at the merge time (15:32:12);
- task-2 closes at `completedAt` (15:39:58), 39 s before the close-out comment.

"Guessed" means the addressee (on findings and checks) or the decider (on questions) is not named in the material.

## Records

| id | kind | source | guessed? |
|---|---|---|---|
| area-1 | area `providers` | LIN-4445 plan "Area notes read" (slug exists, no notes file); PR notes diff (providers.md created) | n/a. Paths `lib/providers/` guessed from the material |
| area-2 | area `llm-and-prompts` | LIN-4445 Design "Area notes"; PR notes diff | n/a. Paths guessed from the entries the notes diff shows |
| area-3 | area `other-features` | LIN-4445 Design "Area notes"; Blind read area label | n/a. No paths given (the notes call `as-asked-seal.js` homeless) |
| area-4 | area `web-routes` | Blind read area labels | n/a. Paths `routes/` guessed |
| lesson-1 | lesson | LIN-4445 Design 13:31 "Area notes" (LIN-4362); LIN-4450 description item 1 | no. Area named |
| lesson-2 | lesson | LIN-4445 Design 13:31 "Area notes" (LIN-4393) | no. Area named |
| finding-1 | finding (Waiting) | PR notes diff, llm-and-prompts entry removed (LIN-4347). Ended done 15:11 by leftover ("Retires:") | no. The entry is in the llm-and-prompts notes |
| task-1 | task LIN-4445 | LIN-4445 description "## As asked" | yes, `--by John --via driving-session`: the text speaks of John in the third person and quotes him, so a session composed it |
| decision-1 | decision (Size) | LIN-4445 description "## Size of the move" | the author (`scoping`) and the time are guessed. Decider: the standing policy |
| decision-2 | decision (shape B) | LIN-4445 comment 13:31:04 "Design: LIN-4445" and description "## Design (chosen approach)" | no. Design decided |
| plan-1 | plan | v1: LIN-4445 description "## Implementation Plan". v2: comment 13:40:55 "Plan Review Verdict" notes 1–6. v3: comment 14:08:01 "Session 1 (LIN-4450): where the code moved the plan" | v1's author (`design`) and time are guessed. The list of stage names has no planning stage, and the plan cites "the Design comment (13:31)" as an earlier, separate text |
| verdict-1 | verdict pass on plan-1@2 | comment 13:40:55 "Plan Review Verdict: Approve". The layer marked it stale at 14:08 when plan-1 went to v3 | n/a |
| task-2 | task LIN-4450 | LIN-4450 createdAt 13:43:57; description "Done when", parent, grounding commit (link `on commit:4b5001ddf`). Ended done 15:39:58 by close-out | n/a |
| decision-3 | decision (plan-review due: no; fits one session) | LIN-4450 description header lines; LIN-4445 Breakdown 13:44:23 | no. Breakdown decided |
| task-3 | task LIN-4451 (stub) | LIN-4445 Breakdown table row 2. Created-at not in the material, so set to the comment time | n/a |
| task-4 | task LIN-4452 (stub) | LIN-4445 Breakdown table row 3. Same time choice | n/a |
| question-1 | question (end-line rule) | LIN-4450 13:47:23 "Survey open-0" item 1. Answered 14:08 by decision-5 | yes, decider `implementation`. Survey says only "Decide which up front"; implementation decided it (14:08 departure 1) |
| question-2 | question (empty fence) | Survey open-0 item 2. Answered 13:55 by decision-4 | yes, decider `scoping`. "Pick one deliberately", no decider named; scoping's Size record took the fix in as "one tidy done first" |
| check-1 | check (live probe before code) | Survey open-0 item 3 and "What I'd do first". Declined 15:18 by review, linked `same-as` from check-2 and check-3 | yes, to `John`: needs a real Jira site. Who ended it is also guessed: nobody did on the ticket, and review restated it |
| finding-2 | finding | Survey open-0 "Smaller points" 1 (bulk vs getIssue, no cache compares). Done 15:18 by review | yes, to `task-2`: survey names no addressee; every later stage must see it |
| finding-3 | finding | Survey open-0 "Smaller points" 2 (bytes vs characters). Done 14:08 by implementation | yes, to `task-2` |
| finding-4 | finding | LIN-4450 13:51:36 "Survey global", "Two stores" and "A second ADF walker". Done 14:13 | yes, to `task-2` |
| finding-5 | finding | Survey global, "The reader accepts more than the writer refuses". Done 14:13 | yes, to `task-2` |
| finding-6 | finding | Survey global, "Scatter". Done 14:13 | yes, to `task-2` |
| finding-7 | finding | Survey global, "What has to learn". Done 14:13 | yes, to `task-2` |
| finding-8 | finding | Survey global, "A branch left without a witness". Done 14:13 | yes, to `task-2` |
| finding-9 | finding | Survey global, "Better still, not this task's": live Jira-native tickets. Still open | yes, to `area-1` (by path; survey gives no home) |
| finding-10 | finding | Survey global, "Better still": bulk path could ask for properties. Revised 15:11 by leftover to the providers.md Waiting text. Still open | yes, to `area-1` (later confirmed: leftover put it in providers.md) |
| finding-11 | finding | Survey global, "Better still": comment weight. Still open | yes, to `area-1` |
| decision-4 | decision (Size: a small tidy, empty-fence fix in) | LIN-4450 description "## Size of the move"; basis question-2 plus policy | no. The standing policy decided |
| decision-5 | decision (end line by digest) | LIN-4445 14:08:01 departure 1 ("Review note 1 resolved this way": review's comment shows it means Survey open-0 item 1) | no |
| lesson-3 | lesson | LIN-4450 15:11:36 "Leftovers"; PR notes diff providers.md Lesson 1 | no. providers.md |
| lesson-4 | lesson | providers.md Lesson 2 | no |
| lesson-5 | lesson | providers.md Lesson 3 | no |
| lesson-6 | lesson | providers.md Lesson 4 | no |
| verdict-2 | verdict pass on `PR#2421@f9fa4a80c` | LIN-4450 15:18:12 "Review", "### Verdict" (Approve, conditional on close-out discharging the ledger) | n/a |
| finding-12 | finding | Review "### Fix for close-out". Done 15:32 by close-out | no. "for close-out" |
| check-2 | check (property PUT/GET) | Review "What CI Did Not Prove" item 1. Revised 15:39 by close-out (in task-4, to operator), 17:49 (runbook cf38cbf6, to John), 18:06 (runbook f495ca4b). Still open | yes, to `John` at first. Review says only "the LIN-4452 live check on John's site". Later addressees are named in the material |
| check-3 | check (digest survives Jira editor save) | Review ledger item 2. Revised 15:39 by close-out (in task-4, to operator). Still open | yes, to `John` at first |
| check-4 | check (first dispatch of a Jira-native ticket) | Review ledger item 3. Revised 15:39 by close-out. Still open | yes, to `John` at first |
| verdict-3 | verdict pass on `PR#2421@f9fa4a80c` | LIN-4450 15:21:22 "Blind read", "Verdict: better" | n/a |
| finding-13 | finding | Blind read "Inside the area, fix-sized" 1 (workspace-api-audit.js). Done 15:32 | yes, to `close-out`: blind read names an area, not an actor; close-out fixed it |
| finding-14 | finding | Blind read fix-sized 2 (isTestToken alias). Done 15:32 | yes, to `close-out` |
| finding-15 | finding | Blind read fix-sized 3 (comment-phrase test). Done 15:32 | yes, to `close-out` |
| question-3 | question (bulk-read split) | Blind read "Inside the area, larger" ("closing it is a decision"). Shelved 15:39 by close-out, `same-as` finding-10 | yes, decider `close-out`: no decider named; the ask keeps engineering calls off John; close-out disposed of it |

**Hand-offs (finding, check, question): 22. Addressee or decider guessed on 20.** The two named are finding-1 (the area notes file) and finding-12 ("Fix for close-out"). Two later changes of addressee on checks are named in the material: close-out's "listed for the operator" and the runbook "for John". Other guesses: the author and relay of task-1, and the author and time of decision-1 and of plan-1 v1.

## Unplaced

- **Implementation's summary** (14:13): what was built and verified, the unit counts, CI green, and "Next: merge is for review and the orchestrator". It holds a session's claims and a hand-over in sequence; that is `run`, which is on paper only.
- **Tidies found and done in the same session**: leftover's four comment tidies and close-out's stale `isTestToken` citation. They are completed work, not something anyone must act on, so they too belong to a run's claims.
- **Review's rollback** (revert the squash commit; properties stay but nothing reads them; no data loss). It is an operator instruction for a contingency, so neither a check nor a finding.
- **Evidence**: review's mutation table, its probe of 16 shapes and its regression check; CI results; the drift and staleness checks (Design, Plan Review, Breakdown, both Surveys); the codec probes. The `evidence` field is left out until a walk needs it.
- **Review's gap analysis and scope reading**, and the plan review's "What I checked": the reasoning behind a verdict. A verdict holds only `outcome` and `on`.
- **The cost record** (model tier, effort, cost and duration per stage). This is `run`.
- **LIN-4452 "updated Lesson"** in providers.md (17:49:04, departure 4). The material does not say which lesson or what it now says, so no revise could be written.
- **Close-out housekeeping**: description archived and pruned, "Implemented" stub. Versions make this moot. Merge and deploy facts went only into task-2's end reason and its `on` links.
- **The 18:55 autopilot hand-back to John**: it changes no record. In the model it is John's page, a view that walk 1 does not build.
- **PR comment 15:40:38**: a copy of close-out's ledger, nothing new.

## Strains

1. **A check cannot be handed on.** Its only ends are done and declined.
   - Close-out's "LIN-4452 owns them" became a revise of `in` (to task-4) and `to`.
   - check-1, which review's checks restate, had to end `declined` with `same-as` links. "Superseded by" was the true end.
2. **No `blocks` link.** "LIN-4450 blocks LIN-4451" and the plan's "each blocked by the one before" have no place.
3. **Verdict outcomes `{pass, fail}` lose meaning.** Three judgements all became `pass`:
   - plan review's "Approve" with six non-blocking notes;
   - review's "Approve, conditional on close-out discharging the ledger";
   - blind read's "better", which had a stated worse side.

   The conditions survive only as other records (finding-12 and the checks).
4. **A verdict on a PR head never goes stale.** Close-out committed `26299c9b0` after both approvals at `f9fa4a80c` ("nobody re-reads these"). The layer cannot see a PR head move.
5. **A verdict goes stale on any revision, even one confined to a single piece.** Implementation's departures to piece 1 staled the plan approval for the whole plan (verdict-1, at 14:08), while LIN-4451 and LIN-4452 still build under it. decision-3 ("plan-review due: no", basis verdict-1) still stands on a stale basis, and nothing flags it.
6. **Decision `basis` is limited to question, setting or policy.**
   - The design's shape-B choice rests on the ask's standing rule ("settle engineering questions yourself").
   - Breakdown's "plan-review due: no" rests on a verdict.

   Both bases were written as free strings or refs. The layer does not check basis kinds.
7. **No `setting` or `policy` record.** "Decided by: the standing policy" is a string.
8. **The task has no fields for:**
   - the grounding commit (stretched into a link `on commit:4b5001ddf`);
   - session fit (folded into a decision);
   - "Starting point: follow the plan; where the code shows it wrong, change course and say so on LIN-4445" (no place for a standing instruction; plan-revise-with-reason is the model's form of it).
9. **The brief carries only decisions whose `in` is the task.** The parent's decisions (decision-1, decision-2 shape B) never reach LIN-4450's stages except as plan-piece text.
10. **Non-hand-off kinds are written `open`** and reach `stands`/`holds`/`kept` only by an explicit end, so `carries.open` counts live decisions and lessons as open. For example, close-out's brief at dispatch shows 20 open, of which 5 are instructions.
11. **Plan pieces have no versions of their own.** Revising piece 1 re-sends all three pieces and bumps the version that pieces 2 and 3 show in their briefs.
12. **`question` has no `about` field** (used a link). A finding's `about` mixes refs and paths in one field.
13. **Area-labelled but fix-now findings** (blind read) had to be addressed to `close-out`, with the area in `about`. Addressed to the area, two of them (web-routes) would never reach close-out's brief, because web-routes is not among the task's areas. The model cannot say "in area X, for stage Y".
14. **Pre-existing records** (areas, area lessons, the LIN-4347 Waiting entry) needed an invented time and author.
15. **A check's addressee must be "John or operator"**, and the material uses both for what is likely one person: close-out says "operator", the runbook says John.

## Refusals

None. Every write was accepted, field checks included.

## Choices where the model invited a different handling

1. **Plan review's notes became plan v2**, written by plan-review, with the verdict on v2. On the ticket they were a comment beside the plan, which breakdown later copied into each child's slice.
2. **Implementation's departure comment on LIN-4445 became plan v3** with a reason, instead of a comment. Side effect: the layer staled verdict-1 (strain 5).
3. **LIN-4450's description "Approach"** (plan items 1–6 plus notes 2, 3, 6, retyped) is not copied. task-2 links `about plan-1#session-1`.
4. **One record for the bulk-read gap.** On the tickets it appears four times: Survey global's "better still", leftover's new Waiting entry, blind read's "larger" item, and close-out's "Outside". In the model, the survey's finding to area-1 is revised by leftover, and blind read's item is a question shelved `same-as` that finding.
5. **The survey's "Decide which up front" and "Pick one deliberately" became questions** with options and deciders. On the tickets they were answered implicitly: question-2 by scoping's Size text; question-1 by implementation's comment, which cites the wrong source ("Review note 1").
6. **The survey's live probe became a check to John.** On the tickets nobody answered it until review restated it as post-deploy checks.
7. **The runbook comments became revisions of check-2's `how`**, including the corrected runbook that "supersedes cf38cbf6", instead of new comments.
8. **The parent's surveys are left out**, per the scope. Not recorded: the parent's Survey open-0 question to John (byte-exact or render-exact?), which design made unnecessary.

**Seen through the model:** of LIN-4450's three open checks, only check-2 was ever carried into LIN-4452's runbook.
- Runbook step 3 is a Harbour below-the-line write, not the Jira-editor save that check-3 asks for.
- No step dispatches a Jira-native ticket (check-4).

check-3 and check-4 stay open, addressed to `operator`, with no runbook. The ticket trail and the 18:55 hand-back ("run one check") do not show this gap.

## What was hard

- **Addressees.** The stages almost never say who must act: 20 of 22 hand-offs are guessed. Surveys write for "the builder" and blind read writes per area. Nobody names a decider for "decide which up front".
- **Facts spread across copies.** One fact lives in up to four places: the bulk-read gap, the live probe that review restated as checks, and the plan-review notes that breakdown re-sliced. I had to choose one record and link the rest.
- **Missing times and authors.** Parts of the parent's plan, and scoping's output, have neither. They live only in post-hoc descriptions; the LIN-4450 description is the pruned one.
- **The rule-4 design question.** Deciding whether plan-review or breakdown "owns" the folded-in notes changes whether a verdict goes stale, so that choice settles the result rather than reporting it.
- **Checks' substance.** Telling whether the runbook covers each check needed a careful comparison: a write through Harbour is not a Jira editor save.
