# The journey so far: January to 17 November

*Written 17 Nov for John and for later sessions to refer back to. Built from seven readers' cited reports plus my own reading of the files named; checked by the parrot twice against John's words. Changed by adding, like the log.*

**How I put this together.** Seven fresh readers each took a slice (January–August, August–October, the papers, 2–12 Nov, 12–16 Nov, the leak traces and newest papers, the layer) and reported with line citations. I read your collected words (`my-words.md`), the log from 15 Nov on, the north star and the current design myself, and opened the lines the claims below rest on. The parrot read this against your words before it came to you. Where something is my reading rather than the record, I say so.

## The journey since January

**January–May: a viewer that learned to dispatch.** The first commit (4 Jan) was a read-only Linear roadmap viewer with one rule: no frameworks, no build step. Prompt templates and AI recommendations followed within a fortnight, a dispatch queue on 20 Jan, simple-dispatcher in February, and the API proxy for agents on 6 Mar. The April Pipeline page recorded that "every loop is amnesiac"; late May brought the drift notes and the first north star.

**June–July: autonomy, and finding out how much the system misreported itself.** Autopilot and its operating manual ("disposition, not procedure"), the Collectives, CI at merge, the rename to Harbour on 25 Jun, the close-out ledger, plan review, the credential broker and the hermetic suite. North star v2 (31 Jul) named the self-funding loop. The 3 Aug brief, *The bottleneck moved*, found ticket creation flat at about 190 a week while tickets reaching code fell 39%.

**August–September: passages, cost, and process outgrowing product.** Passages and the Flight Companion, rulings as machinery, lane day, the cost levers. By mid-September tasks were minting about two new tasks for every one closed (`tasks-generate-tasks.md`). On 19 Sep: the ladder, V1 ("one person, one task, one proven merge") and north star v3. The V1 passage set out on 26 Sep; an eight-line change took 41 sessions; the fleet paused, and the steady-base study found three-quarters of supervision was bookkeeping. From then on the measure was whether Harbour completes work correctly.

**October: rebuild instead of patch.** You named the pattern of fixes stacking on fixes, and the prompts were rebuilt (the routed prompt went from 104.5 KB to 9.5 KB). The parrot started that week. On 10 Oct V1 made port: a dress rehearsal on a repository Harbour had never seen. Then the coherence study (an unreconciled decision behind 45% of escaped defects), Theseus (ten design-first rebuilds cut the worst function in each file by 29–88%), consolidate-then-rebuild (17 Oct: eight tickets merged, zero behaviour differences on replay), the improvement cycles and the charter loop. The charter retro found the tidies clean (workspace-api 3,782 → 882 lines) but landing in the server while the changes bound in the browser.

**2 November: the survey.** Harbour did the ticket well, but a codebase is a place and nobody lives in it: no stage owned the condition of the code, and work spiralled (`why-work-spirals.md`). The aim became bringing codebases toward settled, Harbour's own included, starting with tidying where the change binds.

## The last month, and how the ideas built

- **2–5 Nov, the Survey and your question:** can a task leave the code cleaner than it started, the tipping point being a task that on average leaves it a little better. A stage asking "why is this difficult?" before work, loosened to an open answer after you questioned whether it steered too much; then the place ledger, blind scorers, tidy-first and an after step. What came out: finishing a move (deleting the copies) is what makes an area read better, and findings handed to someone placed to act get used (all four routed into live tickets were resolved or improved; all 17 filed as Backlog tickets sat unmoved). By 5 Nov the Survey was two Harbour stages.
- **6–9 Nov, moving the hand jobs into Harbour.** The paper (`cleaner-than-it-started.md`) and essays; round 1 of "Harbour carries the loop": five of six areas better for about $880 across 37 tickets, though the Stability Review still said not converging yet. The 8 Nov review found the hand-run session was the main source of error, and on 8–9 Nov you set the decisions: toward settled as the goal, the "open the door" stretch, $3,500 a week, and the measures, no new mess first.
- **10–13 Nov, the asks and the first gate.** A1–A11 ran through the loop; A1, a blind read before merge, went live on 12 Nov. Sixteen blind reads over 10–12 Nov came out 7 better, 7 mixed, 2 worse. The 13 Nov gate found Harbour largely carries the loop, and that the tightest knot was the loop's own machinery: building the loop was tangling it. You judged the gate passed and moved on to product work and tidies; north star v4 went in, and four lanes started (Jira, front end, Runs, LLM).
- **14 Nov, the second gate and the turn.** The Periodicals agreed the code got better (Drift: 7 resolved, 11 improved, none worse), but beside it the notes grew from 10.6 KB to 88.8 KB in six days, Waiting entries kept rising, and seven safety findings sat only in notes. My reading then: the loop had moved the mess from the code, which is checked, into the text around it, which isn't. That day's papers said why: steering text takes in 6.3 bytes for every byte removed and shrinks only by deletion; what agents need beyond code comes in four kinds (traps, homes, reasons, known work), each best kept where something keeps it true; parallel lanes do coordinate, but unreliably. With them came the essays *Nothing fights its shape*, *Notes across the border* and *Every choice was right at the time*, and your question of what shape each kind of information should take and where it should live.
- **15 Nov, the pause and the plan.** Your plan at the pause: understand where the loop leaks, why, and what it needs; build the smallest thing that meets that; then take an engine that doesn't leak to small projects and on to Jira. You also floated Harbour holding the primary data, with tickets as a backup and trackers syncing. The sittings that evening gathered your words, traced six tasks and Lighthouse, and wrote `picture.md`: information leaks down (children copy the parent's plan, errors included), up (corrections pile beside the source; one copied count drifted 26, 25, 23, 22, 12), across (lanes can't reach each other; asks go unanswered) and out (finds go to Waiting lists and stop); four causes, six needs. Then your frame (`shapes.md` §6): make the communication something code carries, with one general structure and declared shapes on it, as WordPress does, and LLMs as components inside it.
- **16 Nov, design on paper.** A design plan, the mapping (303 items placed on the frame), an inventory of what Harbour already has (`existing.md`), four avenues for building it (`avenues.md`), and a Yap spike in which a model turning prose into records had to guess who should act on 34 of 71. This session became the driver.
- **17 Nov, the layer.** Seen as a programmer would, the loop had become short-lived workers passing free text appended to shared places: text with no end leaks, every reading is a parse that can drift, and with no addressee every reader's input grows with the history. You proposed the method: a design doc revised in place, a minimal model rebuilt from it each round so nothing gets patched, and walks, cheapest first. Six rounds ran that day.

## The pointy end: the layer at round 6

**What it's for:** a proper home for what overloaded tickets and notes carry today, so tasks no longer travel as ever-growing text and Harbour itself does more of the bookkeeping. **What it is:** a well-structured store. A small set of record kinds (task, plan, finding, check, question, decision, verdict, lesson, area, change, run), each saying who wrote it, who must act on it next, its state and how it ends, and what it rests on, with every version kept. Writes are checked for shape only; views, counts and each stage's short brief are computed from what's held. Agents and Harbour act; the store keeps the books. Detail: `docs/plans/survey/layer/design.md` §3.

**What the walks showed**, replaying real finished tasks stage by stage with fresh agents:
- Everything that happened had a home.
- Hand-offs were addressed by the stage that wrote them. Filled in after the fact, 20 of 22 addressees had to be guessed; from walk 2 on, writers addressed their own.
- Retelling stopped once stages could look things up.
- Corrections replace the record instead of piling beside it, and briefs stop growing with the ticket's history.
- Stale now flags only judgements on a version that really moved.

**Where I drifted, and how it came back.** In round 3 I turned the shape checks into enforcement (who may write, when a task may close), which is workflow Harbour already does; round 4 went back to a plain store. In walks 5 and 6 I turned the comparison with today's tickets into a reading quiz and read its scores as a verdict on the design; that is set aside.

**Not yet shown.** No stage has written through round 6's fixes (a `to` on any record, superseded verdicts, "needs-discussion", area scope, blindness in queries). Every walk replayed what stages really wrote, so none did new work through the store. Traces 4 and 5, and Yap as the outside project for testing the design, haven't been walked. Not designed yet: how agents reach the store through the proxy, how the tracker shows records, pages for you, waking. And it isn't agreed: the design is mine until you've corrected it, and it's settled only once we both find it simple to use and much better than what exists.

**Corrections.** Today's readers found five errors in my own write-ups, each checked by me: walk 6 still reads its quiz as a verdict and reused walk 5's ticket-reader answers; `design.md` credits you with the two guards, which `shapes.md` marks as my reading; walk 5 overstates what the store caught; and walk 3's newsletter was an invented scene. When we start, I'll correct the design page and the walk write-ups in place, as walk 1's was, and add a log entry saying so; the log itself stays as written.

## Methods that have worked

1. **Rebuild, don't patch.** Gather scattered decisions into one place, rebuild from a fresh design, and replay old against new: on 17 Oct eight tickets merged with zero behaviour differences, and ten rebuilds cut the worst function by 29–88%. The layer rounds use the same idea: fix the design and rebuild the model, never patch it.
2. **Remove rather than add.** Steering text shrinks only by deletion (74% of real shrinkage) and by rewriting from a stated purpose (25%); trimming single rules gave nothing. Hence looser, not tighter; fixes remove things; measures report and never gate.
3. **Code keeps the books, models keep the judgement.** Code detects and the model decides; a lesson lands as code or a test before it lands as prompt text. The layer applies this to information.
4. **Finish the move, where the change binds.** A tidy that deletes its copies reads better, a partial one mixed; the after step lifted its area five times out of five; the fake-DOM census went from 56 to 6.
5. **Hand things to whoever can act.** Information handed to someone placed to act gets used; information left in a place piles up.
6. **Independent eyes.** Blind reads, which corrected my own optimistic tallies; a second document checking each paper (23 of 24 had a claim corrected); fresh readers before launch; and the parrot reading drafts against your words.
7. **Expectations before looking**, committed first: forecasts, predictions, each walk's `expect.md`.
8. **Cheapest test first, real work last:** a finished task filled in after the fact, then replays, then scenes, with motion only once the cheap checks hold.
9. **Hold the whole.** Your words as the source and the record never rewritten; re-reading the papers, essays and artifacts so the whole stays in view; short sittings started from a kickoff while one session holds the thread.

**What hasn't:** rules and checklists (prompts turning into lists, the size setting, gating on area reads); defining a thing sharply in order to count it, which is how tight definitions in the Periodicals let the leaks go unseen; filing work as new tickets; a session holding the loop together by hand. And my own patterns: agreeing too readily, drifting into machinery and quizzes nobody asked for, and verdicts before reading.

## Where that leaves us

On your first question, the record shows finished tasks going from spiralling to reading level or better, and consolidate-then-rebuild and Theseus improving the code on every target tried. On your plan, finding the leaks, why, and what's needed is done. Building the specific solution simply is the layer, at round 6 and not yet agreed. After it come integration, then small projects, then Jira. Parked with you and unchanged: the seven safety findings, LIN-4416, LIN-4210 and the paused lanes (LIN-4441, LIN-4445, LIN-4463).

## Since: walk 7, approval, and what's next (18 Nov)

- **Walk 7** (`layer/walks/7/results.md`): stages wrote through round 6 on LIN-4450, LIN-4446 and LIN-4469 (32 steps), and Yap's mobile thread was filled in after the fact. Every round 6 write that had never been tested worked; the only refusals were malformed writes; stale stayed quiet; what was open at each end was owned. Two faults, both from brief part 8 (the previous stage's whole account): it leaked the review's verdict to the blind read, and it swelled late briefs by 40–96%.
- **Design revised and approved.** Part 8 became a one-line pointer (the words stay in the run, read with `get`); blindness also covers judges' accounts; the verdict's `of` became `judgement`; open records under an ended task reach the parent's brief. John approved `layer/design.md` on 18 Nov with no further notes. A doc copy: https://claude.ai/artifact/WvYq7VFCu6r7aj9kWsbGb5.
- **Next, in order:**
  1. A short integration design on paper, on what Harbour already has: the store as one collection keyed by kind (the local-store pattern); agents reach it through proxy endpoints mirroring the model's commands; the brief built in code and fed to the prompt builder instead of ticket text; rulings as questions and decisions, the rulings page as John's view; the tracker as a synced summary; wakes driven by what is open for each reader. Each slice names what it retires. John reads and corrects it before anything is built.
  2. Build it through Harbour's own loop, one route per slice, removing the old route in the same move: hand-offs first (retires the Waiting lists, the `Retires:` conveyor, "record it as not run", answers as comments); then verdicts and runs (retires the comment classifier); then the plan as versioned state (retires the prune and the copy-down); then lessons and areas (retires the notes).
  3. Real work. **The first work through the upgraded Harbour is the parked work** (John, 18 Nov): the seven safety findings, LIN-4416, LIN-4210, and the paused lanes LIN-4441, LIN-4445, LIN-4463. Read against the 13–14 Nov baselines (notes growth, Waiting, sessions and cost per task, brief size, blind reads), reported, never gating. Then John's pet projects (Yap first, John as new user), then the Jira project.
- **Housekeeping:** the harbour.cat proxy token in the session scratchpad expires 19 Nov; a new one is needed before real work. Steps 1–2 are desk and repository work.

## 18–19 Nov: integration design drafted, paths removed, walk 8

- **The integration design.** Step 1's plan was agreed, with John's correction that knots are called case by case (tidy before, tidy after, or accept), not ruled out (`integration/plan.md`).
  - The census of today's code (`integration/census/`, 263 sites), draft 1, three checks and draft 2 are in `integration/`.
  - John's answers so far:
    - provider sync is a follow-up;
    - the parked work runs after slice 4;
    - the brief's temporary ticket section until slice 4 is fine ("a little temporary scaffolding is ok").
- **Paths removed.** John caught the area list assuming Harbour's own repository layout. An audit found path matching throughout both designs. The layer was revised by removal: no areas, no task, lesson or run paths, and `project` as an addressee.
- **Walk 8** confirmed the revision (`layer/walks/8/results.md`). Six more removals followed (log, "18–19 Nov"). The layer now has 10 kinds: task, plan, finding, question, decision, verdict, lesson, change, run, and the project as an addressee.
- **Next, in order:**
  1. Bring `integration/design.md` into line with the revised layer:
     - no areas: findings go to `project`;
     - the blind read through Harbour's route only;
     - findings with `how` instead of checks;
     - name who works the project pile down (likely the leftover step, one per build);
     - the plan rule.
  2. Then John's remaining integration questions, one at a time: the question kind's `on-answer` field, the actor list from the stage kinds, rulings as their own slice, slice 6, knots.
  3. The API review (how intuitive the record calls are for agents) before or during slice 1.
  4. Then build, slice by slice; the parked work runs after slice 4.
- **Housekeeping:** the harbour.cat token expired on 19 Nov; a new one is needed before real work.

## 19 Nov: integration design agreed

- **Draft 3** brought the integration design into line with the trimmed layer; a fresh recheck found nine more places out of line, all fixed.
- **John's seven questions,** answered one at a time, each removing something or deferring a guard until a reading shows the need: no `on-answer`; no actor list (`to` checked against what Harbour can brief); rulings their own slice 4; slice 6 waits on slice 1's count; knots accepted as a tax ("make it work, then make it good"); the blind read stays prompt-only, measured in slice 3; the project pile is a backlog John acts on.
- **The API review** (agents' own notes from walks 7–8): links accepted flat, a bare `on` pinned to the current version, an idempotent end, every problem named in one refusal; two layer clarifications (any end may name what took over; links only add).
- **Colour.** John asked for the context that makes the asks easy to follow: a leaks table from the traces, a before-and-after drawing, a scene per slice. The same goes into each slice's ticket.
- **Agreed** by John on 19 Nov (doc: https://claude.ai/artifact/62y2rpauvpedF8NRS4FqYh). Step 1 is done.
- **Next, in order:** the documents to main by pull request; a fresh harbour.cat token; slice 1 filed as a Harbour task under a parent, with its why and scene; each later slice filed as the one before lands; the parked work after slice 4.

## 19 Nov, later: filed, and how slice 1 will be driven

- **Filed:** the parent LIN-4490 and slice 1 LIN-4491 under it, both Backlog, from `integration/tickets.md`. Slices 2–5 are drafted and filed under LIN-4490 as each previous one lands, from what it really left. Launch on LIN-4491, never the parent; file the next slice before anything runs on the parent again.
- **Where things live:** the full record stays on `claude/cool-rubin-6acj5j`; tickets cite it by commit; slice 1's PR adds the two design pages to main.
- **How it's driven (agreed with John, 19 Nov):** an autopilot kickoff on LIN-4491, as the November lanes ran. Not a passage or the Flight Companion (a supervising layer above the autopilot: supervision 28% → 45% of tokens in September; 41 sessions for V1's eight-line change). This session drives from high altitude and does not steer by hand (the 8 Nov review: the hand-run session was the main source of error):
  1. a subagent takes the before readings at main's head (notes bytes, Waiting count, brief bytes, sessions and cost per task against 13–14 Nov);
  2. kickoff goal = the ticket plus the standing lines: settle engineering questions yourself; keep building the uncontested parts while a ruling waits; any ruling says what the lane does next under each option (LIN-4463 and LIN-4470 parked on a "hold"); read the design at its commit;
  3. check-ins by scheduled reminder, each a subagent reading the trail and returning a few lines;
  4. to John: the breakdown when it lands, any ruling with its options, the merge with blind reads and after readings; the rest goes to the log;
  5. when slice 1 lands, draft slice 2 for John, then file it.
- **Token:** working token in the scratchpad (`harbour-token`), expires 21 Nov 10:11 UTC; never printed.
- **Next:** compact; then the readings, then the kickoff.

## 19 Nov, afternoon: slice 1 under way, a routing fix, and a peer colleague

- **Slice 1 (LIN-4491)**, autopilot `20fdf661`, launched 11:59 UTC on default models. The before readings are in `integration/readings/slice-1-before.md`. The plan was approved after one revision and broken into five chained pieces:
  1. LIN-4492: run ids, plus the design pages to main. Merged at 13:43 as PR #2464; deploy healthy.
  2. LIN-4493: the records store and its routes. Building; PR #2465 is in a fix round after review asked for changes.
  3. LIN-4494: the pages and the Waiting importer.
  4. LIN-4495: the cutover, where the Waiting lists, `Retires:` and the ledger parse go.
  5. LIN-4496: the walk-8 replays, the readings and the live import.
  - John answered the LIN-4493 ruling with **link-account**: store the tracker user id on the account, with one workspace-people reader.
- **The routing defect.** LIN-4493's first build skipped its surveys and scoping. A sibling's close-out note quoted that sibling's PR link, and look-first counts any PR link in any comment as the ticket being in progress (`lib/recommendation-look-first.js`, `lib/recommendation-facts.js`). The selector is never offered the Surveys, so the ticket could not get them back.
  - It was reproduced independently by the peer colleague. It's the best-supported explanation of the incident, not a proven trace.
  - It happened 3 times in a bounded sample of 80 tickets since 8 Nov.
  - Notes: `integration/checks/lin-4493-skip.md`, `lin-4493-rca.md`, `lin-4493-intent.md`.
  - John aborted the bad build. The slice 1 autopilot got a note with a workaround: send the three look-first steps by name whenever a piece's comments hold a PR link. LIN-4493 then ran its surveys and scoping properly.
- **The fix, LIN-4497**, filed from `integration/fix-look-first.md` and run on its own autopilot `df03bb30`. Only a ticket's own PR counts.
  - John accepted the ruling to cut hand-opened PRs that are only pasted into a comment.
  - Plan review approved at 15:47; the build started at 15:47.
  - **When it lands, tell the slice 1 autopilot the workaround is no longer needed**: a follow-up note with `followUpTo` set to its kickoff id and `queueIfBusy`.
- **The peer colleague** is a read-only agent from another model family in John's yap room `#harbour-peer`, at https://yap-yap.up.railway.app.
  - I post as **Claude-builder** through the plain HTTP API (`scratchpad/yap/llms.txt`): `say`, `poll`, `history` and `listen`.
  - `scratchpad/yap/watch.sh`, run in the background, exits when someone tags @Claude-builder, which wakes the session. Restart it after each tag.
  - The room keeps only the last 200 messages and has no persistence, so anything that matters goes in the log.
  - Bring the colleague in at decision points and with consequential claims, giving it the evidence and not just the conclusion. Its silence never blocks.
  - **Next checkpoint:** LIN-4497's PR review, which it expects to be tagged on with the PR and head. Its open question: whether stored feedback proves a PR is this ticket's own. The plan restricts this to finished build runs; the paused-then-finished case and the case of a finished run with no PR of its own are declared gaps.
- **Recap for John:** https://claude.ai/artifact/VuxF7ZT1Y3nH9ez7RpQhWU (doc `ea249a7a-7368-4518-b3b1-2b3bf7b513d5`, body `dcb475e7-0b56`). Update it at each check-in with "Where we are now", the Links table states and a Timeline row.
- **Working rules John set today**, which add to "Methods that have worked":
  - follow Harbour's normal process strictly;
  - do every reading through subagents and keep my own context clean;
  - check against the rows before relaying anything;
  - label each claim shown, not shown or unknown;
  - don't do unnecessary things that need guessing;
  - don't hand John raw data walls.
- **Still open:** the four `wake` rows on LIN-4493 that sit `queued` (unknown; no action); old Sep–Nov stale rows (housekeeping, untouched); the LIN-4399 blind-read lead (harm unknown).
- **Next:** the scheduled check-in (about 16:12) reads LIN-4493 and LIN-4497 through a subagent, tags the colleague if LIN-4497's PR is up, and updates the recap. Then follow slice 1 piece by piece; when it lands, take the after readings and draft slice 2 for John.

## 19 Nov, after compaction: a re-read against the other docs

A fresh reader checked this page against the log from 18 Nov, the designs, the readings and the checks. What it adds:

- **Correction:** there is no 13–14 Nov baseline for brief size (`integration/readings/slice-1-before.md:55`). The only figures are LIN-4491's live briefs: 11,338 B at plan and 16,460 B at plan review.
- **The before figures have moved:**
  - Waiting is 117, against the 111 the design and tickets use;
  - notes are 95,485 B.
  - The cost comparison rests on six unusual tasks.
- **Open choice for the after readings:** a finished task's brief can only be read by regenerating it, at a few cents per task and overwriting the cache. The alternative is to poll a live task's stages. To be settled before the after readings.
- **Watch item:** a piece dispatched while its blocker is still open also skips look-first, with the reason "open blocker" (`checks/lin-4493-skip.md:51`). Neither the workaround nor LIN-4497 covers it.
- **Left after LIN-4497** (out of its scope, `checks/lin-4493-intent.md:93`):
  - a quoted close-out heading is read as the ticket's own;
  - a quoted PR can join the landing the blind read names;
  - the selector's "PRs linked" fact.
  - Whether any of these touches slice 1's blind reads is unknown.
- **Launch risks still live** (log, slice 1 launched):
  - the import must not dispatch the seven tasks it creates;
  - the way back from a bad merge is a revert on main;
  - the design is pinned at `92838c5cf`.
- **Still owed:**
  - a Theseus rebuild of rulings after slice 4;
  - a provider-sync design after the slices, likely alongside Jira;
  - slice 1's count decides slice 6;
  - slice 3 counts the blind read's queries.
- **John's frame for revising** (18 Nov):
  - removal is the process;
  - approval means we can proceed, not that it's set in stone;
  - "two steps forward, one step back";
  - retiring the old route in the same move is the default, and a kept path says when it goes;
  - real work is the test, so no more walks.

## 19 Nov, evening: piece 2 and the fix landed; the colleague experiment ended

- **Slice 1 pieces:**
  - LIN-4493 merged at 16:24 (PR #2465).
  - LIN-4497, the look-first fix, merged at 16:37 (PR #2466). The slice 1 autopilot was told the workaround is no longer needed, but that note sat queued and was later removed. Harmless, since sending the look-first steps by name is the normal order anyway.
  - LIN-4494 ran its surveys and scoping first, opened PR #2467, and has been in review since 17:34.
  - Follow-up ticket for the other places that read sibling PRs: LIN-4498 (Backlog).
- **Queued wakes:** they go to an autopilot only between its turns. 20fdf661 has stayed in one turn since 14:28, so 14 rows piled up. John removed them (safe). This counts as evidence for slice 6.
- **John signed in again** for the person-addressing check. Whether his name was stored isn't shown yet.
- **The Yap peer colleague is dropped** (room reliability). What it gave while it ran:
  - an independent reproduction of the routing defect;
  - tighter wording;
  - one stale claim caught;
  - the open-blocker worry closed with evidence;
  - and the calibration: bring a second view only where it could change the action, and keep reports to John short.
- **Next:** check-ins via the scheduled reminder; at LIN-4495, check that the run-ledger exports really are retired; when slice 1 lands, take the after readings, then draft slice 2.

## 20 Nov, overnight: slice 1 landed; slice 2 launched

- **Slice 1:** all five pieces merged and deployed, LIN-4492 to LIN-4496, PRs #2464, #2465, #2467, #2468 and #2469. LIN-4495 and LIN-4496 were marked Done by me, with John's checks carried. The slice 1 autopilot 20fdf661 was told to close out LIN-4491.
- **After readings:** in `integration/readings/slice-1-after.md`.
- **Slice 2: LIN-4499** (id c7d814f8-b034-4fd0-a980-32cd52a4aafe), the plan as versioned records. Autopilot **ec3417c3-606f-407a-bf94-7cfd5066c29a**. The draft is in `integration/slice-2-ticket.md`, checked by a fresh reader.
- **Overnight mode** (John, 19 Nov, 22:30–22:37): the hourly drive (trig_01XCTpQoZb2V1vqMFvzXKStm) runs slice by slice up to the end of slice 4.
  - Rulings that aren't John's call: I settle them by doing the work, proposing the answer, and sending the paused run a note.
  - I may pause if things go sideways.
- **Waiting for John:** the list is in `integration/slice-2-carry.md`. It includes the live import, the readings, the re-review verdicts, the signed-in page check, the `isEmptyStatement` defect, and a new token (records routes refuse the current one, which expires 21 Nov 10:11).

## 20–21 Nov: slice 2 landed; slice 3 running

- **Slice 2 (LIN-4499)** landed at 23:12 on 20 Nov: six pieces, LIN-4501 to 4506, about $272. Plans are records; the seal and the prune are gone; the Waiting lists were imported; task-snapshots were dropped. Readings are in `integration/readings/slice-2-after.md`.
- **Along the way:**
  - Ship Biscuit was moved off snapshots (LIN-4500);
  - LIN-4508 (watch agents work) filed;
  - four tickets remade (LIN-4509/4510/4511), and LIN-4210 dropped;
  - the key rotation filed (LIN-4512).
- **Slice 3: LIN-4513** (verdicts and changes as records), autopilot **894a0750-07c6-492e-8d0b-89d0c2621f55**, launched at 00:30 on 21 Nov. Its ticket carries John's standing answers. Two questions are left for John as rulings.
- **How agents reach production:** `railway ssh` into harbour-cat (`railway run` can't reach the database).
- **Fleet pause:** the driver's owner-minted token sets and clears it.

## 21 Nov, 15:30: handover for compaction

**Where we are.**
- **Slices 1 and 2** have landed.
- **Slice 3, LIN-4513** (verdicts and changes as records), autopilot 894a0750-07c6-492e-8d0b-89d0c2621f55, 8 pieces:
  - P1–P4 Done (LIN-4514..4517). P4 imported 21 comment verdicts into records in production.
  - P5 (LIN-4518: close-out, the router and run evidence read records) is building, about $47 so far. John's answers it carries: marker for authorship, with the ledger removed; finding-per-issue for blocking counts; retire look-first's survey-comment check.
  - P6–P8 (LIN-4519..4521: measures; remove old parsers; re-review after close-out's own commits) wait.
  - Slice cost so far about $160.
- **After slice 3:** take readings, draft slice 4 (rulings) with John's standing answers and the ruling lessons as its scenes, then the fresh check, file, launch.
- **Stop after slice 4.** The parked work goes through the upgraded Harbour, then slice 5 (lessons), then slice 6 (wakes; John to confirm; readings say needed), then the horizon list (`horizon/README.md`).

**How the work is driven.**
- **Hourly drive** (trig_01XCTpQoZb2V1vqMFvzXKStm, :27 past each hour).
  - Light checks use the scratchpad token. Deeper ones go through one subagent.
  - It proposes answers on rulings; John clicks.
  - It sets and clears any fleet pause.
  - When a slice lands, it drafts, checks, files and launches the next.
- **Ruling answers:** propose via suggest-answer, with decisionLoopId set to the ruling's own `anchor.loopId`.
- **Notes to runs:** they go to the piece's own run. Notes to the top autopilot don't reach pieces.
- **Production:** `railway ssh` into harbour-cat. Never print the env.
- **The token** expires 22 Nov 13:37. Ask John for a new one before then.

**Methodology** (John's, as practised):
- stay at altitude; Harbour's process does the work;
- the simple sensible choice; retire, don't keep slimmer versions; move dependants onto the right data;
- rulings only for John's calls, and a proposed answer on each;
- check against the records before relaying; label claims shown or unknown;
- remove rather than add rules;
- the log is append-only;
- John's questions one at a time, plainly.

**Known rough edges** (for slice 4, slice 6 or the smoothing pass):
- duplicate rulings from the plan and breakdown loops;
- a second DECISION in a run gets dropped;
- runs building the contested part while a ruling waits;
- the close-out and blind-read deadlock;
- close-out commits after approval (slice 3 P8 fixes this);
- rows reading "closed" while still posting;
- refused follow-ups showing as "failed";
- no mid-turn visibility (LIN-4508).

**For John:** LIN-4512 (key rotation, end of next week); the slice 6 confirmation; Ship Biscuit's big picture.

## 21 Nov, 16:00: the parked work, trimmed

- **LIN-4445 (the loop on Jira) is off the parked list.** John will come back to it later. The parked work is now the seven safety findings, LIN-4416, LIN-4441 and LIN-4463.
- **Why it runs after slice 4** (John's reasons): work queued up to put the improvements through their paces, and these are good candidates; no work runs while the core is changing; test what's been built at the earliest sensible time. Slices 5 and 6 are still wanted, 5 especially, given how the notes grow.
