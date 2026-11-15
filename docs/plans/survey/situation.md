# Harbour: the situation on 15 November 2026

*One page, drafted 15 Nov from `my-words.md` (John's words), the survey record on `claude/cool-rubin-6acj5j`, and `docs/north-star.md`, `docs/v1.md` and the essays on main. A fresh reader then checked it against `my-words.md` alone, and this version carries its corrections. Keep it short by changing it, not by appending to it.*

**Marks.** Every line names its source and how I know it:
- **[checked]**: I read it myself in the source, or ran a script over it.
- **[reported]**: someone else's finding (the previous session, a review, a paper, the log's own account of an outcome) that I have not re-run. Where a line has two marks, the wording is checked and the finding is reported.
- **[my reading]**: my interpretation.
- **[guess]**: unsupported.

**Short names.** `log`, `disc` and `asks` are `log.md`, `discussion.md` and `asks.md` in this folder. `words §n` is a section of `my-words.md`. `NS` is `docs/north-star.md` and `v1` is `docs/v1.md`. Essay and paper files are under `docs/papers/harbour/`. On this page an ellipsis (…) inside a quote marks my cut, unless the source has it.

---

## 1. What Harbour is for

- **The promise:** "Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, brings codebases toward settled, its own included, funds itself doing it — and proves every word." — NS:5 [checked]
- **Settled is a balance, not smallness.** The aim is a task that, on average, leaves the code a little better, "Even if we rely on things like periodicals when we want to improve not tied to a ticket." (log:1213; NS:7, accepted 13 Nov) [checked]
- **The question, in his words:** "does the task actually leave the codebase cleaner?" (log:2186). The kickoff adds "and can Harbour carry that loop itself?". An agent drafted that wording, and John sent it as written (words §7) [checked]
- **His picture of the end:** "if Harbour bends the curve and tidied itself as it runs, knowing importantly the maths has changed, we can arrive at a genuinely correct codebase, correctly arranged." He asked for it to be noted (log:4080) [checked]
- **Who drives it.** A person stays in command, usually through an agent: "a human like me will control Harbour via an agent like you" (log:4170). The driving agent does less by hand but not nothing: "There's likely always going to be a few pieces for you, the driving agent, to handle, and that's fine." (log:3602) [checked]. v1 already bets on this shape: the person's own Claude Code session, opened with one copied prompt, takes their work (v1:99) [checked]. Reading the two as one design is [my reading].
- **The milestone ahead.** John's theory today: if we "completed" and "tidied" all we have, we reach an important milestone and can welcome strangers (words §7) [checked]. v1, accepted 19 Sep, names a smaller gate: v1 "is done at the dress rehearsal", John on a fresh account and an unseen repo, then invited people (v1:31-33) [checked]

## 2. Where it stands

- **His own reading:** "I'm confident our new approach beats our old one. I'm less confident our scaffolding is now fit for purpose, or when we will be simply running work which opens Harbour for business without needing hand holding." (log:4026, 14 Nov) [checked]
- **What the fortnight showed.** The paper's answer: "Tasks on average: not shown. Areas and finished moves: yes, on few cases." (log:2483). "Ordinary tickets did not read better than the baseline." (`cleaner-than-it-started.md:44`) [checked wording; the readings themselves reported]
- **What did read better:** deletions, a tidy done as its own task, a tidy-after as its own ticket (log:1951); the tidy that deleted every copy, not the one that stopped at 2 of about 30 (log:2072) [reported]
- **The mess moved into text.** The area notes grew from 10.6 KB to 88.8 KB between 8 and 14 Nov (log:3909) [reported]. Stability Review run 6: "The product is settling; the process around it is costing more." (log:3563) [reported]. John: "If code is getting 'cleaner' whilst a secret backlog grows, something is afoot" (log:3965) [checked]
- **The loop is not yet whole.** Parts of it live outside Harbour: in text on tickets, notes in the repo, the wording of prompts, and a supervising session doing things by hand (log:4175). This is the previous session's picture. John said "Your overall picture is improved." and corrected it (log:4170), then doubted the notes behind it (log:4227) [checked his words; the picture reported]
- **Harbour's record covers only Harbour's own code** (and simple-dispatcher). John has used Harbour elsewhere, but that use is outside this record and mostly earlier (words §7) [checked]. The newest essay's own limit: "One codebase, one owner, a few weeks" (`every-choice-was-right-at-the-time.md:144`) [checked]
- **v1's own gaps** still listed as open: the connect flow as one path (LIN-614), the run page (LIN-3349), credential-level stop at the PR (LIN-3417), publishing the free-tier number (LIN-1645), and the carried-over security Highs (v1:108-118). "no fresh-account run has happened yet" (v1:132) [reported: v1 as last edited, not re-checked against the tracker]
- **Nothing is in flight.** Lanes are paused: LIN-4441, LIN-4445 (Jira live check), LIN-4463 (log:4220) [reported]
- **Git is optional for a run.** Close-out handles a task with "no pull request found in this task's comments" (`lib/run-closeout-state.js:278`) [checked]
- **Where John is:** "Ok, I don't know how to proceed thats not going to waste money. I want out this loooooop!" (log:4164); "I thought I saw land. Now I think the ocean is driving me mad. I don't want to keep struggling." (log:4228) [checked]. Today he agreed with the read-back: "It's all pulling in the same direction." (words §7) [checked]

## 3. What is decided

- The goal and the five measures "in this order when they clash", in north star v4 (NS:7-9; "I like it, much nicer. Please apply it.", log:3624) [checked]
- Measures report and do not gate. John's words were a question, "We're running Periodicals next so that's likely covered?", and the log records the outcome as "reported, never gating" (log:3876) [checked his words; the outcome reported]
- "We want all this looser, not tighter." (log:3855). He objected to a fix that "suggested rules, additional complexity, and giving agents authority to change the core parts" (log:3961). Prompts may grow, against "a big list of rules" (log:1411), and healthy growth is fine (log:3278) [checked]
- Scaffolding is fine if its removal is planned (log:3964) [checked]
- How much to tidy is the person's call; agents recommend (log:1234) [checked]
- When a person acts, Harbour rides along (log:3609, NS:13) [checked]
- No big backlog sort up front: "Trying to figure it all out in advance will be a fool's errand" (disc:484) [checked]
- Views are tidied, not retired: "each is a candidate for Theseus'ing, after checking _why_ they end up so large … I'd be sad to get rid, but happy to tidy." (disc:550). Later he was open to cutting features "if the cost to keep them is genuinely high enough" (log:4085) [checked]
- The UI code tidy: "Yes to the UI code tidy. Followed by the discussed UI related tasks." (log:3598). The no-build-step rule is "the biggest target of the Theseus method" (disc:448), and switching the front end "requires humans to rule" (log:4039) [checked]
- Both Surveys stay on code tasks: "we did find benefits from two. Happy to skip for periodicals though." (disc:321) [checked]
- Cheap default models; no Opus at every stage (log:3604) [checked]
- The weekly budget is "a fine somewhat informal limit" (log:3590). On pacing he asked whether racing and pacing are "kind of the same thing?" (log:3592) and doubted "the 'wait for Thursday'" (log:3971) [checked]
- The record is not rewritten or wiped; he stopped an attempt (log:4227) [checked]
- v1's gate is the dress rehearsal (v1:31; accepted 19 Sep, v1:141) [checked]
- The pace is his call: "The "week or two" is my call" (words §7) [checked]

## 4. What is open

- **The plan itself.** His outline: "We find where then loop is leaking, understand deeply why, and what it needs, then build that specific solution in a simple form. Once the engine doesn't leak, we try it on a bunch of smaller projects." (log:4151). Then: "Why would we continue when we don't yet _have a plan_?" (log:4165) [checked]. A plan for the understanding half of step 1 is drafted in `plan.md`, not yet agreed: trace a few finished tasks, then test the picture on a project that isn't Harbour (words §8) [checked]
- **Where the pet projects come in.** Three of his statements place them differently:
  - after the engine stops leaking: "Once the engine doesn't leak, we try it on a bunch of smaller projects" (log:4151)
  - as aids to the research: "Happy to provide good test projects." (log:4155)
  - in the meantime: "we've plenty to work with, including many of my pet projects" (words §7)
  [checked]. For step 1 he has since offered one, "a slightly unconventional project which currently uses Harbour", as the outside test (words §8) [checked]. The other two placements stay open.
- **What completing and tidying "all we have" covers:** v1's gaps table, every surface, or the whole codebase to "A* quality" (v1:105-119, disc:550, log:4085). The scope is large: 13 areas, 585 source files, 212,226 lines of JavaScript (log:4200) [reported]. That the phrase needs settling is [my reading]
- **The order of the doors.** D17 set two stretches, "until the switch" and "open the door" (disc:676). The switch passed on 13 Nov: "This all reads like we're past the gate" (log:3590). D1's door was "a small outside team on Jira" (disc:61). His latest words put pet projects first and "the big Jira project" after (log:4137, log:4151) [checked]. That "the big Jira project" is D1's outside team, and that the later order replaces D1's, are [my reading]
- **v1's gate:** a fresh account or a fresh workspace, and eight steps or nine (v1:132, LIN-3808) [checked]
- **The notes format.** His idea: "simply saving the notes as TS" (log:3966). A spike on three versions was agreed on 14 Nov (log:3973-3977). It has not run: it was back in a proposed order that evening (log:4110) [checked by search]. The draft plan holds it until the trace shows what it should test (`plan.md` §6)
- **Where information lives.** John confirmed the leak: "when we apply the closing pieces, the notes squirted out as a necessity". He raised three questions at three sizes, and flagged that they may be ahead of ourselves (words §7) [checked]:
  - a correct home for the notes
  - whether all the information is in its best place
  - "a task feels like it's carrying a lot"
  The record has met each before:
  - his own 14 Nov question on how information should "relate, move, and need to be held in a shape" (log:4024)
  - the TS-notes idea and the unrun notes spike (log:3966, log:3977, log:4110)
  - the 2 Nov essay's finding that the ticket "conflates three things: the record of the job, the plans, and the place's memory." It reports that John named "the ticket as the source of truth" as the one decision he would reopen (`tasks-are-tasks.md:25`)
  [checked wording; the essay's report of John not checked against the log]
- **Harbour owning the tasks, with trackers as a sync** (log:4141-4142). On the doc: "Update the doc, we're still refining the idea" (log:4146). Then, on that idea: "appealing because the site is slow, but that's unrelated to moving the remaining parts of the loop into Harbour" (log:4151) [checked]
- **Who sets the size of a move, in practice.** Decided: "It's *my* call." (log:1234). But since 7 Nov size has gone ahead on a standing "err larger" (log:2747), which one essay reads as "the choice to take a larger move goes ahead under a standing policy, "err larger", with no ruling" (`every-choice-was-right-at-the-time.md:108`) [checked wording]. Whether that still matches what he wants is [my reading: open]
- **John's calls still waiting:** seven safety findings and LIN-4416; LIN-4210 (log:4221) [reported]

## 5. What was tried and dropped

- The operator's own ledger as the measure: blind readers scored the loop +0.37 against a baseline of +0.38, so "the ledger's tipping point was my scoring" (log:1925, log:1950) [reported]
- A structured Survey with a menu, replaced by one open question (log:452-458) [checked]
- Routing Periodical findings into live tasks: 4 of 4 resolved, against 17 of 17 filed tickets unmoved (log:1449). John then asked to run without it (log:1516) [reported; his request checked]
- The size-policy setting, removed as unusable (log:3060, log:3090, disc:292) [checked]
- A stall alarm (log:3573); a Periodical after every task (asks:138); Opus at every stage (log:3604) [checked]
- The area-read gate and its 14-file sample (log:3853); four new operator rules (log:3855) [checked]
- Phase tables: dropped on 9 Nov (disc:684), redrawn on 14 Nov, then replaced the same day (log:4089) [reported]
- A standing direction to settle rulings overnight: "we don't want to fight the system." (log:3799) [checked]

## 6. What the essays and papers say the loop needs

Two readers read fourteen essays and papers. I checked every quote below against its file on main.
- **Failures sit between the sessions.** "A system made of many careful agents does not fail where any one of them is looking." (`between-the-sessions.md:36`). "Code holds the sequence and watches the seams; models keep the judgement." (`:168`). Supervision is "Mostly bookkeeping." (`what-supervisors-do.md:15`). Judgement changes outcomes "At the gates and in the making, nearly always; in supervision, rarely" (`where-judgement-happens.md:15`) [checked wording; the measurements reported]
- **Text grows because nothing ends it.** The text grows "because every lesson enters it as a sentence at the point where something went" wrong, "and nothing in the system ever asks a sentence to leave." (`steering-text.md:14-15`), and "Trimming single rules has never moved the total by as much as a kilobyte." (`:29`) [checked wording]
- **Information needs a shape.** This was John's question first: "how do these (and others) relate, move, and need to be held in a shape … Perhaps if these were correctly established and used, a lot of issues evaporate." (log:4024). The essays answer: "Code, comment, doc, note, ticket and log are places to write, not kinds of information." (`nothing-fights-its-shape.md:14`). "Each kind should live where something keeps it true" (`beyond-the-code.md:43`). "If a thing's end is written when it is made, nothing has to be hunted down later" (`nothing-fights-its-shape.md:109`) [checked wording]
- **The place needs an owner, and looking comes first.** "Every task is looked after. Nobody's job is the place." (`tasks-are-tasks.md:15`). "You cannot size a job you have not looked at" (`the-place-became-somebodys-job.md:37`). "The cheapest moment to clear a leftover is now" (`:43`) [checked wording]
- **Retire choices; tidying inside them is not enough.** "Inside a choice, tidying has bought percentages and often added code." (`every-choice-was-right-at-the-time.md:84`). "Retiring a choice changes what the thing is for, which is not written in the code, so it needs a person." (`:106`). "Gather what is scattered, then rebuild what you gathered" (`theseus-method.md:24`) [checked wording]
- **Their own limits.** "The cure has not yet been turned on the loop itself." (`every-choice-was-right-at-the-time.md:131`). "The real payoff, later changes in the gathered areas landing smaller and cleaner, has not had time to show." (`theseus-method.md:181`). "We have done this once, on one codebase, over a few days" (`the-place-became-somebodys-job.md:105`) [checked wording]
- **How this bears on his step 1** ("find where then loop is leaking, understand deeply why, and what it needs", log:4151). The essays already offer candidate answers: the seams between sessions, and text with no home and no end. They come from one codebase and their own authors' readings, so they are hypotheses for step 1 to test, not its answer [my reading]

## 7. Testing the picture against the record

*Revised after John's corrections of 15 Nov (words §7).*

- **Converging.** John: "compared to how previous tasks built and made mess, we _are_ converging; if complete work makes no mess, and we can intentionally tidy, we converge." (words §7). The record supports both halves:
  - Before, an earlier paper found Harbour "only grows, and fastest at the gates" (`docs/papers/README.md:45`). By 13 Nov: "The product is settling" (log:3563).
  - Ordinary tickets read about like the baseline (`cleaner-than-it-started.md:44`). Tidies done as their own task, and finished moves, read better (log:1951, log:2072).
  [checked wording; findings reported]
- **Where "no mess" does not yet hold.** The same review ends "the process around it is costing more" (log:3563). The notes grew from 10.6 KB to 88.8 KB in six days (log:3909) [reported]. John: "If code is getting 'cleaner' whilst a secret backlog grows, something is afoot" (log:3965) [checked]. So his condition holds for the code and fails, so far, in the text around it. That failure is the leak his step 1 is after [my reading]
- **The maths.** John: fixing one small function and rebuilding a complete layer "are almost equal for the human and only a modest multiplier on the token costs, and there's room to optimise." (words §7). The record agrees:
  - "Cost rises with size, slowly"; every leg's slope is below 1 (`docs/papers/README.md:18`)
  - a 300+ line task costs "about 2.9 times" a 1–49 line one (log:4088)
  - design-first rebuilds of 441 to 2,816 lines: "Most ran in 50–106 minutes" (`docs/papers/README.md:23`)
  - the Theseus run touched people "at two points" (`docs/papers/README.md:108`)
  [checked wording; measurements reported]
- **Rewriting the bulk, decisions first.** The rebuilds improved the inside of files, "But decision location did not move" (`docs/papers/README.md:23`). The method's own answer is its first half: "only gathering fixes the second" kind of mess, by gathering each scattered decision "into one authority with the copies deleted" before rebuilding (`docs/papers/README.md:108`) [checked wording]. John: "the prior move is centralising decision points, through more regular refactoring. Nothing stops us using the classical tools of the trade." (words §7) [checked]. The largest rebuild on record is 2,816 lines (`docs/papers/README.md:23`) [reported]
- **The "week or two" is John's call**, a target and not a forecast: "with the right setup, we could rewrite the bulk in that time" (words §7) [checked]
- **Other projects.** Harbour's record covers only Harbour's own code (and simple-dispatcher). John has used Harbour elsewhere, outside this record and mostly earlier (words §7). The record does hold one outside use: Harbour on Jira at work, "for a few weeks" (disc:447) [checked]. That the fortnight's loop changes have not yet run on other code is [my reading]. Fresh tasks on fresh projects bring the semi-outside user on board (words §7) [checked]
---

## Sources and checks

- `my-words.md`: 116 quotes from the record matched to their cited lines by script, none missed. The check covers the record only, not this sitting's words.
- This page: every quote is matched to its cited line by the same kind of script, against main's copies of `docs/` and `lib/` at `6f6c5d2`, except John's words from this sitting, which are recorded in `my-words.md` §7.
- Essays and papers in §6 were read by two sub-agents. I opened and checked each quote used here; their summaries beyond those quotes are not relied on.
- A fresh reader, given only `my-words.md`, checked the first draft for drift. It found twelve points and three omissions; all are corrected here.
- John corrected the second draft on converging, the maths, the pace and other projects (words §7). §2, §3 and §7 carry his corrections.
- Dates on 14–15 Nov come from `git blame` on `log.md` at `a2a3c56`.
- Not opened by me: the area notes, Linear, the Stability Reviews, `place-ledger.md`, and the sub-agent files the pause note lists as relayed (log:4201).
