# C: the document read against the larger ideas

Reader: an independent sub-agent, read-only. Written 15 November 2026.

Path short-hands used in citations:

- `P/` = `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/wt-main/docs/papers/harbour/`
- `M/` = `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/wt-main/docs/`
- `A/` = `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/artifacts/` (line numbers are lines of the HTML source)
- `log` = `/home/user/LinearViewer/docs/plans/survey/log.md`
- `doc` = `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/writeup/review/doc-v2.md` (the document under review, as exported)

Anything marked "my reading" or "my inference" is mine, not the record's and not John's.

---

## 1. First reading of the body of work

*This section was written before I opened the document, and has not been edited since. I read the four essays in full, the three pages, the north star and v1, the summaries and conclusions of fifteen papers (the thirteen suggested, plus `tasks-are-tasks.md` and `the-second-copy.md`, with shorter looks at `flow-and-convergence.md`, `how-process-changes-land.md` and `task-size-and-cost.md`), the log from line 4020 to the end, the log's John quotes on the named themes, and section 3 of `1-how-ideas-developed.md`.*

### What I think it is saying, in one paragraph

The body of work keeps finding one mechanism in different materials. Something is added for a good reason, beside what is already there. Nothing gives it an end. Later work treats it as given and builds on it. The result is the same whether the material is code (one decision written in eighteen files), the text that steers agents (six bytes in for every byte out), the process (fourteen temporary structures added, none removed), the backlog (two tickets made for each one closed), or a person's own passing remark hardened into a policy. The cure is also one thing at every size: look at what is there, find what each part is *for*, ask whether that is still true, have a person say what it should be for now, rebuild from that purpose, and delete what the rebuild replaces. What is new is the price. An agent can rebuild in an hour or two, so the cure is cheap in work and limited by three things only: a purpose that a person states, a judge that is not the builder, and an ending in deletion. Everything else in the essays is this idea applied to a particular material, or an honest note of where the record does not yet bear it out.

### The ideas

**1. Mess is good choices built on past the end of their reasons, so the unit that matters is the standing choice, not the line or the ticket.**
John: "I assume every choice was right at the time. The mistake was continuing to build on it when it had outlived it's original intention." (`log:4039`). The essay tests this against the record and finds that tidying *inside* a choice "has bought percentages and often added code", while "the large removals on record each took a choice away" (`P/every-choice-was-right-at-the-time.md:32`, and the evidence at `:84-92`). It names why building-on is the default: "a choice arrives with a beginning and no end" (`:78`). It also finds the same pattern in the loop and in John's own rulings (`:110`, table at `:120-127`). Where the record falls short of the framing, the essay says so: some choices were wrong when made, "easily" and "100x" are not shown (`:137-144`).

**2. What a check holds stays true and what prose holds drifts, so each kind of knowledge should rest where something keeps it true, and move on by changing form instead of being retold.**
The page states the mechanism most plainly: "What a check holds stays true. What prose holds drifts. So the code got better while the text around the code grew." (`A/land-on-the-horizon.html:262`). The shape essay gives the general form: code, comment, doc, note, ticket and log "name where something is written, not what it says" (`P/nothing-fights-its-shape.md:14`); a thing's shape is "what keeps it true, how it ends, what it is about, and who needs it and when" (`:62`); a healthy move "changes the form and closes the old one" (`:78`), as when a lesson becomes a test. The measured side: steering text took in 6.3 bytes per byte out, cut campaigns grew it, and it has only shrunk when the thing described was deleted or one author rewrote a surface from its purpose (`P/steering-text.md:14-36`). The paper's own conclusion is about direction, not stock: "change where lessons land, not to cut the stock again" (`P/steering-text.md:35-36`). John's phrase: "if everything is in its right place, no tangles. And, likely, much much simpler. Nothing fights its shape." (`log:4028`). His guess that "Some may simply not he necessary" (`log:4024`) is given a list of candidates at `P/nothing-fights-its-shape.md:102-113`.

**3. The codebase is a place and tasks are jobs; a place settles when each job leaves it a little better, and a move is finished only when it deletes what it replaces.**
"Every task is looked after. Nobody's job is the place." (`P/tasks-are-tasks.md:15`). The thing that costs is not untidy text but one decision held in many places (`P/coherence-as-it-grows.md:14`; `P/theseus-method.md:48`), and "you cannot ask for coherence. You have to build the one place to change, and you have to make deleting the old one part of what finished means." (`P/the-second-copy.md:25`). The measured result is narrow and real: "A move that finishes, deleting the old copies, reads better. A move that only starts, adding a new owner beside copies that keep running, reads mixed" (`P/the-place-became-somebodys-job.md:55`); nine finished areas read better, ordinary tickets did not (`P/cleaner-than-it-started.md:38`). Two riders travel with it: tidy where the change binds, "Pull, not push" (`P/tasks-are-tasks.md:132`), and "Settled is a balance, not smallness" (`P/tasks-are-tasks.md:77`; `M/north-star.md:7`). John's tipping point is the goal stated at the size of one task: "when a task truly does (on average) leave the codebase in a better place once finished, even a little, we're in a really strong place." (`log:1213`).

**4. The price has changed: writing is nearly free, reading is the scarce thing, and prose is paid for on every run. That turns rebuilding from the risky choice into the ordinary one, provided the scattered thing is gathered first and the result is judged by something other than the builder.**
"An AI coding agent can now rebuild a module in an hour or two. That changes what is worth doing" (`P/theseus-method.md:28`); "Gather before you rebuild" (`:32`); "Judge by replay, not by the test suite" (`:35`); "The scarce thing is a person's attention" (`:148`). The page's three changes are at `A/land-on-the-horizon.html:376-392`, ending "Deletion is the only move that costs less forever after." John's version: "knowing importantly the maths has changed" (`log:4080`). The record's own caution is that the payoff, "later changes in the gathered areas landing smaller and cleaner, has not had time to show" (`P/theseus-method.md:181`), and that cost does rise with size, slowly (`P/task-size-and-cost.md`, opening paragraph).

**5. There are two loops and each feeds itself; which one you are in shows in one number, and last week most of the work was work about the work.**
Wrong shape needs steering, steering adds text and steps, those add sessions and leftovers, and the shape gets worse; or the reverse (`A/land-on-the-horizon.html:329-371`, and `log:4082-4083`). The papers supply the parts: tickets generate tickets at 2.1 to 1 (`P/tasks-generate-tasks.md:14-20`); the spiral is mostly the process's own enumerate-and-reject loop, not the code (`P/why-work-spirals.md:14`); "A system made of many careful agents does not fail where any one of them is looking" (`P/between-the-sessions.md:36`). The week's count: 69 of 115 landings were "work around the work", and "Each new step in the loop brought about one clean-up behind it" (`A/land-on-the-horizon.html:295-327`). John: "Harbour should converge work, even if slowly, and resist spiralling out and generating more work (unless it's tidying up)." (`M/north-star.md:7`, and quoted at `A/land-on-the-horizon.html:251`). The same idea names what the loop must not do: gain steps. "Fourteen temporary structures were added to the loop. None was removed." (`A/land-on-the-horizon.html:282`). John: "extra scaffolding and temporary structures are fine. We just need to plan their removal." (`log:3964`).

**6. A shape lasts only while something holds it, and a hand cannot be that something; structure holds, wording does not, and whoever does the work cannot be the judge of it.**
John's forcefield image, as the essay reports it: "Every time the hand moved, the shape dissolved." (`P/tasks-are-tasks.md:67`). The first page turns it into layers: code decides order and holds lines, models judge inside fixed shapes, the person decides size, spending and authority (`A/toward-settled.html:552`), with the test result "Wording gets most of the way. Structure finishes." (`A/toward-settled.html:575`). The second half is about the operator: "The hand is where the mistakes came from. It also marked its own homework generously." (`A/toward-settled.html:506`); "My habit mirrors the agents'. I add rules beside rules, as they add code beside code." (`A/toward-settled.html:502`); the hand tally was overturned by blind readers (`P/the-place-became-somebodys-job.md:75`). On 14 November it happened again, live: asked how to get out of the loop, the session proposed three new rules, and John said "I think we're seeing the issue." (`log:3961`). Where judgement belongs is measured: "At the gates and in the making, nearly always; in supervision, rarely" (`P/where-judgement-happens.md:15`). The person's part is purpose and the size of a move: "It's *my* call." (`log:1234`); and as built the loop has this backwards, "Clauses reach the person; choices do not." (`P/every-choice-was-right-at-the-time.md:108`).

**7. The cure is the same shape at every size, and John pictures Harbour itself doing the mapping.**
"I imagine Harbour looks at the code, maps it out, then figures out what's holding complexity or mess simply because a square peg is trying to go in a round hole. ... The right shape for the right choices, and that's the Theseus method in full effect." (`log:4037`). "That's also the exact pattern we've built in our loop. It's fractal." (`P/every-choice-was-right-at-the-time.md:50`). The essay finds the cure running at the size of a task and of an area, and says of the whole product and of the loop: "Nobody has run it yet" (`:116`) and "It is a plan." (`:131`). The companion idea, as the log keeps it in fragments, is Harbour holding a project's shape as "a first class data layer (on par with tasks and code)" (`log:4085`): what each part is for, its check and its neighbours (`A/land-on-the-horizon.html:502`). The exam the page proposes for V1 is this idea made checkable: every part has a purpose and a check at its edge, is rebuildable from those two, one home per rule, nothing unowned, one visible list (`A/land-on-the-horizon.html:488-496`).

Two smaller ideas sit beside these and I do not want to lose them. First, work can run as a network and not a line: two lanes settled a border by notes with no person involved, and "the shared code and its tests carry most of the coordinating" (`P/notes-across-the-border.md:86`). Second, the product promise in `v1.md` is the same shape as the research: "v1 is not a cut-down Harbour; it is Harbour at the scale of one decision" (`M/v1.md:13`), and outside use is "the only judgement that eventually matters" (`M/v1.md:23`).

### How they fit together (my reading)

Ideas 1, 2 and 3 are one finding about three materials: choices, knowledge and code each go wrong by being added beside, with no home that keeps them true and no end. Idea 5 is what that looks like in motion: adding beside makes more work, and more work makes more adding. Idea 4 is why the way out is now affordable. Idea 6 says who does what on the way out: structure holds, an outside reader judges, the person states purpose. Idea 7 says the way out is the same at every size, so it does not need a different plan for the task, the area, the product and the loop. It needs one move, repeated.

I notice the record keeps catching the research itself doing the thing it describes. The loop built to tidy code grew its own untidy text (`A/land-on-the-horizon.html:261-289`). The paper that counted six additions for every removal had its recommendation turned into a new rule (`P/every-choice-was-right-at-the-time.md:106`). The session asked for removal answered with rules (`log:3959-3961`). I take that as the body of work's most practical warning: whoever writes the next thing will, by default, add.

### What the record does not yet support (so the ideas are held, not proven)

- Ordinary tasks leaving the code better: "tasks on average: not shown" (`P/cleaner-than-it-started.md:38`).
- Gathering and rebuilding making later work smaller: "has not had time to show" (`P/theseus-method.md:181`).
- Any of it on a codebase that is not Harbour: "One codebase, one owner, a few weeks" (`P/every-choice-was-right-at-the-time.md:144`).
- The kinds-of-knowledge table: "this essay's guess" (`P/nothing-fights-its-shape.md:127`).
- The one number: one week, the operator's own coding (`A/land-on-the-horizon.html:512-522`).

### What kind of plan this implies (my reading, before seeing the document)

1. **It would be organised by purpose, not by task.** Its working list would be the standing choices and the parts of the product, each with what it is for and whether that is still true. Tasks would follow from that list; they would not be the list.
2. **The person would be asked about choices, and only a few.** The questions put to John would be of the kind "what is this for now?" and "how big a move?", not "which wording for this step?". The essay's own short list of what the framing asks for is: "a standing choice kept with its reason and the sign that it is over; a looking step that asks about the choices a task stands on, not only the code; and the choice, not the clause, put to the person." (`P/every-choice-was-right-at-the-time.md:135`).
3. **It would be one move repeated at different sizes**, not a sequence of different phases: map, find the misfit, a person rules, rebuild from purpose, delete, with a judge that is not the builder. It would say which size it is running first and why.
4. **It would turn the move on the loop as well as on the code**, because the loop is where last week's mess went. Each piece of scaffolding would be ruled "stays, goes, or stays with a planned removal, in John's words" (`log:3976`).
5. **It would be a direction with a reading, not a schedule.** "Converge work, even if slowly." The plan would name the one or two readings that say which loop Harbour is in, and who takes them from outside.
6. **It would state what is hoped and not shown, and make those the experiments**: an ordinary task through the loop read from outside; an area re-measured after its rebuild; the notes held another way; a project that is not Harbour.
7. **It would itself obey the ideas.** It would be short. Each thing in it would carry its reason and its end. It would add nothing to the loop. A long sheet of specific rulings would be, in the operator's own words, "rules beside rules".

*End of the first reading. Everything below was written after reading the document.*

---

## 2. Idea by idea: what the document does with it

Two more short-hands from here on: `disc` = `/home/user/LinearViewer/docs/plans/survey/discussion.md`, and `trail` = `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/writeup/1-how-ideas-developed.md`.

| Idea (from section 1) | What the document does with it |
|---|---|
| 1. Good choices built on past their reasons | Loses it |
| 2. A check holds, prose drifts; each kind of knowledge in its place | Mentions it, uses one corner, and hands the rest to the notes spike without saying what the spike is for |
| 3. The place, not the job; finished means deleted; tidy where the change binds | Carries it best of the seven, with one reversal |
| 4. The price has changed, so rebuild | Carries the method; treats the idea as a claim to be lowered |
| 5. Two loops and one number | Keeps the prohibition, loses the picture and the reading |
| 6. Structure holds; the judge is outside; the person states purpose | Carries the outside judge well, half-carries the person's part, loses "structure holds" |
| 7. The same cure at every size; Harbour does the mapping | No place |

### Two things to say before the detail

**The document's own five ideas are a different five.** The section "Five ideas that run all the way through" (`doc:41-49`) matches, one for one and in the same order, the five "threads that run all the way through" in the sub-agent file on how the ideas developed (`trail:170-174`). All five are about how to work: finish by deleting, the person sets the size, a check holds, tidy where work is, independent readers. None is about what the work *found*. Each is joined to the plan by the same phrase: "It is why every rebuild here ends in deletion" (`doc:45`), "It is why this doc ends in a ruling sheet" (`doc:46`), "It is why the loop loses steps here and gains none" (`doc:47`), "It is why the rehearsal chooses the work and the backlog does not" (`doc:48`), "It is why my session shrinks" (`doc:49`). The plan's shape was there first: it "takes four forms in a day... This doc is the fifth" (`doc:243`), and after the fact-check "I have kept the plan's shape and lowered its confidence" (`doc:53`). My inference: the ideas were attached to a plan to justify it. They did not produce it. I think this is most of what John is hearing.

**The ideas of 14 November appear only as things to be careful about.** They are the ideas John voiced himself, and one he confirmed with "Yes exactly! Please make a note of this" (`log:4080`). In the document they turn up in three places: a list of eight overclaims (`doc:55-62`), two retractions (`doc:64-67`), and quotations in the dated history (`doc:241-243`). A word count makes the point. "Theseus" appears nowhere. "Shape" appears twice: "the plan's shape" (`doc:53`) and an essay title (`doc:251`). "Choice" appears twice: a ticket's "choice about how a stop is handled" (`doc:159`) and an essay title (`doc:251`). "The curve" appears only in the history (`doc:238`, `doc:242`).

I think the cause is honest and fixable. The big ideas were fact-checked, found thin, and so taken out of the spine. But an idea that is not yet shown is not a reason to plan without it. It is the thing a plan should be built to test. The document has the tests in hand (see idea 3 below) and files them as side items.

### Idea 1: good choices built on past their reasons. Lost.

The essay is cited once in the body, for a size: "one essay counts the largest at about 930" (`doc:58`). Its argument is not used anywhere.

- The distinction it draws, tidying inside a choice against retiring a choice, is absent. Both planned rebuilds are tidies inside existing choices: "A single write pipeline for issues" and "`server.js`" (`doc:149-150`). That may well be the right first step. But the document never says which kind of act these are, or that the record puts the large gains in the other kind (`P/every-choice-was-right-at-the-time.md:84-92`).
- No standing choice is named or put to John. The one John himself called "the biggest target of the Theseus method" (his words as the essay quotes LIN-4446, `P/every-choice-was-right-at-the-time.md:94`) appears as "Later, and not asked now: the providers, the browser code, and the runs and prompts core" (`doc:152`) and as a housekeeping row: "LIN-4463, the paused front-end work... Resume in round 1, with no pass figure" (`doc:161`).
- The essay's question, "What was this for, and is that still true?" (`P/every-choice-was-right-at-the-time.md:56`), is not asked of anything. Ruling 2 asks of each feature "Yes", "Not yet" or "Remove" (`doc:103`). Ruling 3 asks of each loop step keep or drop (`doc:128-137`). The column that carries the case is "What the code shows" or "What the record shows", which is what the thing costs and yields now, not what it was for.
- The essay's point about who is asked what, "Clauses reach the person; choices do not" (`P/every-choice-was-right-at-the-time.md:108`), is used once and narrowly: "Narrow the cut rule so that only narrowing your own words reaches you" (`doc:136`). It is not turned on the ruling sheet itself. Of the 28 rows, two ask John for a purpose in his own words (the two rebuild rows, `doc:149-150`). Several are plainly clauses: a ticket's option (`doc:159`), a paused ticket (`doc:161`), a docs pull request (`doc:162`).

### Idea 2: a check holds, prose drifts, and each kind of knowledge has its place. Mentioned; one corner used.

The document says: "A check holds and a sentence in a prompt does not... It is why the loop loses steps here and gains none." (`doc:47`). That is the idea used as a prohibition. The finding behind it, that this fortnight's mess went into the text around the code, is not in the plan.

- The notes spike is the vehicle, it is John's, and it goes first, which is right (`doc:13`, `doc:69`). But the document never says what the spike is testing. It hands the spike three open matters ("Where its finds go instead is for the notes spike to settle", `doc:132`; "the notes with their leftover step, consequence test and Retires line, which the notes spike will settle", `doc:139`) and leaves it there. In the record the spike is a trial of the claim the shape essay went on to argue: its versions are "John's TS idea, the 'each kind to where it can't drift' version, and possibly a near-nothing version" (`log:3977`). John flagged the matter as important in his own words: "If code is getting 'cleaner' whilst a secret backlog grows, something is afoot and the note about the types of information I think is important." (`log:3965`).
- "Open for business" is defined as "a stranger reaches a proven merge unaided, and outside readers find the code clean throughout" (`doc:27`). That is the code only. The week's finding was that the code can read clean while the notes, the prompts and the known-work lists grow (`A/land-on-the-horizon.html:261-289`). The page's own exam for V1 included "One visible list: all known work where work is ranked" (`A/land-on-the-horizon.html:494`). The definition drops it.
- The essay's reading of the ticket ("conflates three things: the record of the job, the plans, and the place's memory", `P/tasks-are-tasks.md:25`) has no place.

### Idea 3: the place, finishing, and where the change binds. Carried, with one reversal.

This is the idea the document knows best.

- "A change is finished by deleting what it replaces" (`doc:45`), and the rebuild method ends "by deleting what was replaced" (`doc:145`).
- One sentence is a real derivation from the idea, the only one I found: "Tidying as work passes only cleans where work goes. So a feature that is part of Harbour at opening, but off the route a new person takes, has to be brought up to standard on purpose." (`doc:101`).
- It is honest that the centre is unshown: "This needs ordinary tasks to leave the code better, which is the one thing never shown." (`doc:55`).

What it does not do is make that unshown thing the question the plan answers. John's goal at the size of one task is in the history table (`doc:234`) and is not the stated outcome of either round. Round 1's "How we will know" is "You complete the rehearsal yourself. The Periodicals say whether the code reads better." (`doc:13`). Yet the document also says new features and defect fixes "are the kinds of work round 1 will mostly be" (`doc:56`). So round 1 will put much more ordinary product work through the loop than the twelve landings counted so far (`A/land-on-the-horizon.html:410`). That is the test the fortnight has been waiting for, and the document does not name it as one. The comparison that would make it readable, "Three ordinary tasks run as a plain session, for comparison", sits in "five smaller questions" (`doc:154`, `doc:160`).

The reversal: "Tidy where real work is happening... It is why the rehearsal chooses the work" (`doc:48`). But the first rebuild is chosen before the rehearsal has run, and John is asked to mark it as one of the five marks needed to start (`doc:21`). The reason given for the choice is that it is to hand: "Both were rebuilt once in trials, and replays exist" (`doc:149`). The essays' caution is specific: "tidying where a change does not bind moves stone without settling it, and the question that matters is where this change binds" (`P/tasks-are-tasks.md:77`). In fairness, John has asked for "a few bigger intentional tidies" (`log:3972`), and the target is on the route ("Agent API... Nearly all", `doc:217`). So it is not wrong. It is unargued, and a session goes through the rehearsal first anyway (`doc:13`), so what that pass trips on could choose the rebuild.

### Idea 4: the changed price, and rebuilding. Method carried, idea lowered.

The method is all there: "gather the decision into one owner, put behaviour tests around it, rebuild with the old code in view, check the result against an independent replay, land one pull request, and end by deleting what was replaced" (`doc:145`). The purpose lines in Ruling 4 are the document's best moment: "`server.js` only connects the parts. No rule lives in it." (`doc:150`). That is a part stated by what it is for, offered to John to rewrite.

The idea itself is listed as an overclaim (`doc:57`) and its support moved to a background section (`doc:191-197`). What is missing is the step between. John's phrase is "knowing importantly the maths has changed" (`log:4080`). If the plan rests on that, the plan should say which of the three changes it is betting on and how round 1 gives a first reading. One reading is nearly free: the method's own test is "Re-measuring those areas" (`P/theseus-method.md:181`), and the areas gathered on 17 October have had a month of later changes. The document does not propose it. (That it would be cheap is my inference; I have not checked what data exists.)

### Idea 5: two loops and one number. Prohibition kept, picture lost.

Kept: "Nobody sorts the backlog, the loop gains no steps and no papers are written." (`doc:39`). Kept in the numbers: 44 product landings against 69 around the work (`doc:176-177`).

Lost: the picture John confirmed, that the same parts run in either direction (`log:4082`), and the reading that says which. The 0.65 is in the overclaims (`doc:56`) and the numbers table (`doc:178`), but no round is read by it. Instead the document sizes a round by throughput: "about 75 product landings a week against 34. Reaching 100 also needs a landing to cost about a quarter less" (`doc:189`). Counting landings from a list is what the earlier page called "the contractor's view" (`A/plotting-the-course.html:354`).

### Idea 6: structure holds, the judge is outside, the person states purpose. Half carried.

The outside judge is carried well, and I would keep all of it: the whole section "Where this plan goes beyond the record" (`doc:51-69`); "They report and gate nothing" (`doc:36`); the two retractions (`doc:64-67`).

The person's part is half carried. "The person sets the size... It is why this doc ends in a ruling sheet." (`doc:46`). John's "It's *my* call." (`log:1234`) was about how much to tidy on a task. The essay's later finding is that he should be asked about choices and not clauses. A 28-row sheet does not follow from either. The good half is Ruling 4: "Each needs a purpose line in your words" (`doc:143`).

"Structure holds" is lost. The plan is held by hand again: rounds, a handover, "we search the tracker for tickets that match it" (`doc:39`). John's readiness sentence on 14 November has two halves: "I'm less confident our scaffolding is now fit for purpose, or when we will be simply running work which opens Harbour for business without needing hand holding." (`log:4026`). The document takes "open for business" as its title for the goal and leaves out "without needing hand holding". The operator's own note of that day gives the test: its role's "removal point is when Harbour takes ordinary work and finishes it without me in the middle" (`log:4029`). In the document that is one row, "Shrink mine to a handover at the end of each round" (`doc:137`), with no test. The 8 November course had one: a week's work that "needs nothing from the agent running it beyond filing words, starting runs and recording results" (`A/plotting-the-course.html:395`). (Four lanes ran on 13 November with John's go-ahead, `log:3595`, so the "two in flight" number in that gate was overtaken. My point is the test, not the number.)

Also missing here: John's "extra scaffolding and temporary structures are fine. We just need to plan their removal." is quoted in the history (`doc:241`), and the agreed way to decide was "stays, goes, or stays with a planned removal, in John's words" (`log:3976`). Ruling 3 offers keep, drop, narrow or shrink. No row has a sign that the step is over. The third answer, agreed on 14 November, is not on the sheet.

### Idea 7: the same cure at every size, and Harbour doing the mapping. No place.

Nothing in the document maps anything, asks Harbour to, or treats the plan as one move at several sizes. The thirteen-row area table (`doc:209-223`) has the columns "Source lines", "On the route" and "Entries waiting". The same sub-agent pass that found "no feature has usage evidence" also found "no area has a written purpose" (`log:4088`). The document keeps the first half (`doc:62`) and drops the second. The second is where idea 7 starts.

---

## 3. Where the document is "specific" in the way John means

My reading of how it happened: the body is built from three lists that were to hand. The document names them: "how the ideas developed, the new person's route through the code, and the existing definitions and open questions" (`doc:253`). The first became "Five ideas" and the history table. The second became Ruling 2's feature table and the area table. The third became Ruling 1 and Ruling 5. Each section is what was left of a list after checking. That is why it reads as an inventory with a plan on top.

**1. Ruling 2, the feature table (`doc:99-118`). Present because the list existed.** It is what remains of a list of things to cut (the sub-agent file's own heading is "Cut candidates in detail", `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/writeup/2-areas-and-path.md:76`). The document then found that cutting is not what John wants ("So I am not asking which to kill", `doc:101`) and that it "is worth less than I told you" (`doc:207`). The table stayed, with the question changed to fit it. What was agreed on 9 November is idea-shaped and different: "Every view is a candidate for a Theseus move, starting with finding out *why* it got so large. The aim is lots of light little views, each cheap enough to keep." (`disc:545`), and John: "each is a candidate for Theseus'ing, after checking _why_ they end up so large" (`disc:550`). The ideas would ask "why is it this large, and what is it for?" The table gives line counts and who imports what. Also, "Not yet means it stays exactly as it is and nothing is spent on it" (`doc:103`) is what happens by default. Only one row suggests "Remove" (`doc:109`). Two suggest a small change to the landing page (`doc:113-114`). The other three carry "No suggestion" (`doc:110-112`), so they need no ruling today. By "Pull, not push" (`P/tasks-are-tasks.md:132`) most of this ruling could wait until something on the route binds on one of these features.

**2. Ruling 3, the ten loop steps (`doc:120-139`). The right subject, derived the wrong way.** Turning the cure on the loop is exactly what the ideas call for. But six rows "rest on September's measurements" (`doc:124`), which were available, and every row argues from yield: "11 of 94 plans", "107 findings, 97 about tests only", "74% of the follow-ups" (`doc:130-132`). The ideas would give each row three different things: what the step was for, whether that is still true, and the sign that it is over. The yield figures would support the second.

**3. Ruling 5 and the two requests (`doc:154-167`). A to-do list in a planning document.** A ticket's option, a paused ticket, a docs pull request, three Jira credentials, an expiring token. They are here because a sub-agent listed everything waiting on John. Two of the five do not belong with the others. The seven safety findings (`doc:158`) are urgent and are also the clearest live case of idea 2: a kind of thing kept where the tool that needs it cannot see it (`P/nothing-fights-its-shape.md:68`). And the plain-session comparison (`doc:160`) is the plan's central experiment, filed under "smaller questions".

**4. Ruling 1's last two rows and the README line (`doc:94-97`).** Whether "funds itself" stays in a sentence, and bringing the README into line, are wording questions. The row before them, whether "leaves the place cleaner" is promised, is the largest question in the document and is asked as a landing-page matter.

**5. The background tables (`doc:169-225`).** "What a round might buy" (`doc:189`) is arithmetic on landings. The area table gives source lines to five figures for areas whose splits "could be off by thousands of lines" (`doc:225`). These are records of looking. The essay on shape would call a hand-written count of the present "a detective's list about the present with no date" (`P/nothing-fights-its-shape.md:58`). The document does date them and marks counted against derived (`doc:171`), which is to its credit. They are still not part of an argument.

**6. The five marks and the five-step round (`doc:17-23`, `doc:29-39`).** A round is a new piece of process, described in steps, with no stated end. It is light, and John's own words are behind "talk and test" (`doc:37`). I flag it because the document says "the loop gains no steps" one paragraph after introducing a five-step procedure around the loop.

**7. The two rebuild targets (`doc:149-150`).** Chosen because trials and replays exist and because one mounts the other. The method's own rule for choosing is "places × change" (`P/theseus-method.md:82`), and John's picture is to find "what's holding complexity or mess simply because a square peg is trying to go in a round hole" (`log:4037`). Neither is used. They may point at the same targets. The document does not show it.

What I would *not* call specific in John's sense: the exact definition of the rehearsal (`doc:93`), and the eight overclaims. Those are in section 6.

---

## 4. What the document would be if it were built from the ideas down

Not a rewrite. The spine, with draft wording where something is new. All draft wording below is mine and is offered for marking up.

### The opening argument

> **Harbour: one move, at three sizes, with a judge from outside**
>
> Two weeks of looking found the same thing in four places: in the code, in the text that steers the agents, in the steps of the loop, and in old decisions. Something was added beside what was already there, for a good reason. Nothing said when it should end. Later work built on it. You put it this way: "I assume every choice was right at the time. The mistake was continuing to build on it when it had outlived it's original intention."
>
> The way out is one move. Look at a part. Say what it is for. Ask whether that is still true. You rule on what it should be for now. Harbour rebuilds it from that purpose and deletes what the rebuild replaces. Someone who did not do the work says whether it is better. Agents make the rebuilding cheap. The purpose has to come from you, and the judge has to come from outside.
>
> This plan runs that move at three sizes at once. At the size of a task: ordinary work on the route a new person takes. At the size of an area: one part gathered and rebuilt. At the size of the loop: the notes, and the steps we added this fortnight. The judge is the dress rehearsal v1 has asked for since September, and after it the outside team.
>
> Three things under this are hoped and not yet shown. That an ordinary task leaves its place better. That a rebuilt area makes later work there smaller. That any of it holds on code that is not Harbour's. Each size is set up to give a first answer to one of them, and I say below what a "no" would look like.

### The sections

1. **What the fortnight found, and how sure we are.** Five or six lines. Each says: shown, shown narrowly, or hoped. This replaces both "Five ideas that run all the way through" and "Where this plan goes beyond the record", by putting the finding and its limit in the same line. Draft of two lines:
   > - *A move that finishes by deleting what it replaces leaves its area reading better.* Shown, on nine areas, by two blind readers. Not shown for ordinary single tasks.
   > - *What a check holds stays true and what prose holds grows.* Shown for one week: the code read better while the notes went from 30 waiting entries to 118. Not shown: that holding the notes another way fixes it. The notes spike is the first test.
2. **The move, and who does which part.** One paragraph and no table. You: what a part is for, and how big a move. Harbour: the looking, the rebuilding, the deleting. An outside reader: whether it is better. Me: less each round, with a stated end (see the new question 4 below).
3. **The three sizes.** One short block each, with the same five lines: the part; what it is for (your words, or a draft to rewrite); who judges; which hope it tests; how it ends.
4. **The judge.** The rehearsal, defined exactly as now (`doc:93`), then the outside team. This is where today's "The order" table goes, cut to two rows.
5. **What I need from you.** Purposes and a few choices. See below.
6. **What would change the plan.** For each of the three hopes, the reading that would count as "no".
7. **Housekeeping, on a separate page.** Tokens, the Jira items, LIN-4210, LIN-4463, the docs pull request.

### What happens to the current rulings

| Current ruling | Fate | Why |
|---|---|---|
| "Is this the rehearsal?" (`doc:93`) | Survives as written | It is v1's gate and has to be exact |
| "Rounds 1 and 2 in this order?" (`doc:91`) | Survives, as a consequence | The judge comes before the people who would be hurt by a bad rebuild |
| The two rebuild rows with purpose lines (`doc:149-150`) | Survive, and become the pattern for everything else | They are the only rows that ask what a part is for |
| "Seven safety findings" (`doc:158`) | Survives, moved to the top as urgent, and named as a live case of a thing kept in the wrong place | It should not wait on a plan |
| "Three ordinary tasks run as a plain session" (`doc:160`) | Changes shape: from a smaller question to the centre of round 1 | It is the test of the one thing never shown |
| "Is 'leaves the place cleaner' promised to users yet?" (`doc:94`) | Changes shape: from a landing-page question to "what reading would let us promise it?" | It is the plan's main question |
| Ruling 3, the loop steps (`doc:128-137`) | Changes shape: each row gains what it was for, whether that still holds, and stays / goes / stays until a named sign | John: "We just need to plan their removal." (`log:3964`) |
| Ruling 2, the features (`doc:109-114`) | Changes shape and shrinks: one question covering the one "Remove" row and the four files nothing imports (`doc:105`, `doc:109`); the rest are asked "why is it this large?" only when work on the route binds on them | `disc:545`, `disc:550`; "Pull, not push" |
| "The first rebuild", as a mark needed to start (`doc:21`) | Changes shape: marked after the session's first pass through the rehearsal, from where that work binds | `doc:48` says the rehearsal chooses the work |
| "Open for business" (`doc:27`, `doc:87`) | Changes shape: the code clean, the text around the code no longer growing, known work on one visible list, and ordinary work running without hand-holding | `log:4026`; `A/land-on-the-horizon.html:488-496` |
| "Are these three the steps to open?" (`doc:92`) | Disappears into the section on the judge | |
| "Does 'funds itself' stay?" (`doc:95`), the README line (`doc:97`) | Disappear from this document | Wording, not course |
| LIN-4210, LIN-4463, the survey record, the two requests (`doc:159-167`) | Move to the housekeeping page | Clauses |
| "What a round might buy" (`doc:189`) | Disappears | Throughput is not the reading the ideas use |

### Questions it would ask that the current document does not

**1. Which standing choices do you want looked at, and in what order?** This is the essay's own closing proposal: "A register of standing choices, each with its reason and the sign that it is over" (`P/every-choice-was-right-at-the-time.md:196`). I would keep it as a short list inside the document and not a new kind of thing, because of the caution "Build no new nouns" (`P/tasks-are-tasks.md:130`). Draft:

> **Standing choices.** These are early decisions, good when made, that a lot has since been built on. I have not judged any of them. For each I give what it was for, as far as the record says, and what now stands on it. I am asking only which you want looked at, and in what order. "Looked at" means one read-only pass that says what would go if the choice went and what that would cost. Then you rule.
>
> | The choice | What it was for | What stands on it now |
> |---|---|---|
> | "No frameworks, no build step" | A 188-line script in January. No reason was written down. | 44 browser scripts, hand-written components, eleven hand copies of server logic. You re-read the rule on 13 November: it stays, and allows browser imports. How much of the front end exists only to serve it has not been measured. |
> | The ticket is the source of truth | One record per job. | It now holds the job's record, the plans, and what was learned about the place. The notes were added beside it and became a second backlog. |
> | An issue has Linear's shape | Linear was the only tracker. | Four other providers rebuild that shape. The first outside team is on Jira. |
> | Every filed description is sealed as the person's words | So that an ask is never retold. | Text an agent drafted is sealed too, so clauses an agent wrote reach you as rulings. |
> | Agents post under your account | Agents have no accounts of their own. | A note without a heading Harbour knows is read as your word. |

The rows are my selection from the record, not John's list: `P/every-choice-was-right-at-the-time.md:60`, `:72`, `:94`, `:108`, `:123`, `:126`; `P/tasks-are-tasks.md:25` (the essay reports the ticket as "the one decision he would be willing to reopen"; I have not seen John's own words for it); `P/nothing-fights-its-shape.md:68`; `P/notes-across-the-border.md:72-74`.

**2. What is each part on the route for?** Not thirteen lines at once. Only the areas round 1 will touch first, each as a draft for John to rewrite, in the manner of `doc:150`. Draft heading for the table that replaces `doc:209-223`: "Area | What it is for (draft, yours to rewrite) | What checks it at its edge today | On the route". An area whose purpose cannot be written in a line is a finding in itself. (My inference.)

**3. For each of the three hopes, what would count as "no"?** Draft:

> - *An ordinary task leaves its place better.* Round 1's ordinary tasks are read by someone outside the loop, beside three done as a plain session. "No" is: the loop's tasks read no better, and leave no fewer new items behind.
> - *A rebuilt area makes later work smaller.* The areas gathered on 17 October are measured again now, and the write pipeline a few weeks after its rebuild. "No" is: later changes there are no smaller and are sent back no less.
> - *It holds on other code.* The rehearsal's one task on an unseen repository cannot answer this. The outside team's first weeks can begin to. Until then it stays a hope, and "leaves the place cleaner" stays off the landing page.

**4. When is my session over?** Draft: "My session is scaffolding. It is over when a round's ordinary work runs from your words to a merge with nothing from me but filing, starting and recording. Until then each round ends with a count of what I did by hand." The test is from 8 November (`A/plotting-the-course.html:395-441`) and the end condition from `log:4029`.

**5. For each step we added this fortnight: what was it for, is that still true, and what is the sign it is over?** Draft of one row, to show the shape:

> | Step | What it was for | Still true? | Stays, goes, or stays until |
> |---|---|---|---|
> | Blind read before merge | To catch new mess while the builder can still fix it | As a reading, yes: it is the only reading for the first of your five measures. As a gate, no: you have said measures report. | The read stays. The gate goes. The read is over when a round of ordinary work reads neutral or better without it. |

The last cell is my suggestion for the kind of sign needed, not something in the record.

---

## 5. Ideas with no place in the current plan, and whether they should have one

| Idea, and where it is | In the document? | Should it be? | Does the record support it, or is it a hope? |
|---|---|---|---|
| **Harbour looks at the code and maps the misfits.** John: "I imagine Harbour looks at the code, maps it out, then figures out what's holding complexity or mess simply because a square peg is trying to go in a round hole." (`log:4037`) | No | Yes, small: one read-only mapping pass whose output is the standing-choices list above | Supported at the size of a task (the Survey) and of an area (the Theseus method's first two moves). At the size of the product: "Nobody has run it yet" (`P/every-choice-was-right-at-the-time.md:116`). A hope at that size. |
| **The project's shape as "a first class data layer (on par with tasks and code)"** (`log:4085`, a fragment as the log keeps it) | No. The notes spike is its seed and the document does not say so | Only as one sentence saying what the spike is the first test of. Not as a build | Partly supported for known work and for which place owns a rule: a data module under a check removes the kind of claim that was false in seven of eight false entries (`P/beyond-the-code.md:43-51`). Not supported for reasons and warnings: "No data structure keeps the prose of a trap or a reason true." (same paragraph). Mostly a hope. |
| **Two loops, and one number that says which** (`A/land-on-the-horizon.html:329-371`; confirmed by John at `log:4080`) | The number is in a table. The picture and the reading are not | Yes, as the reading of each round, counted by someone other than the operator | Weak: one week, the operator's own coding, and it leaves out what the Periodicals found (`doc:56` says this fairly). The direction is supported by older papers (`P/tasks-generate-tasks.md:14-20`). Keep it as a reading, not a target. |
| **Each kind of knowledge where something keeps it true; much writing is retelling** (`P/nothing-fights-its-shape.md:14`, `:102-113`) | Only through the spike | Yes: it tells the spike what to compare | The measured parts are supported (`P/beyond-the-code.md`, `P/steering-text.md`). The table of kinds is "this essay's guess" (`P/nothing-fights-its-shape.md:127`). The essay's reviewer noted that the table "reads close to a scheme", and called that "the risk John named" (`log:4070`). |
| **Turning the cure on the loop, with planned removal** (John, `log:3964`; agreed at `log:3976`) | Half: Ruling 3, without removal signs | Yes, fully. John has already asked for it in these words | Supported: none of 27 process changes came with a condition for retiring it (`P/how-process-changes-land.md:14-21`; quoted at `P/nothing-fights-its-shape.md:94`). |
| **Work running "without needing hand holding"** (John, `log:4026`) | No | Yes, as part of what "open for business" means and as the end of the operator's session | Supported as a need: "The hand is where the mistakes came from" (`A/toward-settled.html:506`). Whether Harbour can yet do it is not shown. |
| **The no-build rule as "the biggest target of the Theseus method"; a UI "100x simpler"** (`P/every-choice-was-right-at-the-time.md:94`; `log:4037`) | Deferred: "Later, and not asked now" (`doc:152`) | As a question, yes. As work, not yet | "100x" is "Unmeasured. Nothing on record comes near it" (`P/every-choice-was-right-at-the-time.md:141`). The essay proposes the measurement: classify the front end by whether each piece serves the rule, and rebuild one page each way (`:192`). A hope with a cheap test. |
| **Five properties that can be read off the code** as the exam for V1 (`A/land-on-the-horizon.html:488-496`) | No. Replaced by "outside readers find the code clean throughout" (`doc:27`) | Yes: they make "clean throughout" something a reader can check | The page says most are "already measured by the Periodicals". I did not verify that. The properties are a proposal, not a finding. |
| **Notes between lanes; messages addressed to a place** (`P/notes-across-the-border.md:96-112`; `A/land-on-the-horizon.html:503`) | No | Not in the spine. One line in round 2, where the `server.js` rebuild "in stages" (`doc:150`) meets four lanes that all change that file (`P/notes-across-the-border.md:84`) | One day and one border. "None of the five has been tried yet" (`P/notes-across-the-border.md:110`). A hope. The flaw where an agent's note is read as John's word (`:72-74`) is a fact, and bears on "human intent in command". |
| **A small outside project as a judge before V1** (`A/land-on-the-horizon.html:504`; John's blank-repository experiment, `log:2127`) | In effect yes: the rehearsal uses "a repository Harbour has never seen" (`doc:13`), and the document does not say that this is also the first run on code that is not Harbour's | Say so, and say what one small task can and cannot show | Never run (`doc:61`). A hope. |

---

## 6. Where I disagree with John's reaction

John's reaction is fair on the main point. I disagree on four things, and add one warning about my own section 4.

**1. The rehearsal should stay first, and should stay exact.** A fresh account, email sign-in, Linear and the GitHub App, an unseen repository, the runner kit, a proven merge (`doc:93`). That is as specific as anything in the document, and it is right. It is v1's own accepted gate (`M/v1.md:31`), it has never been run on a fresh account (`doc:85`), and the north star asks for gates that are "a measured artifact, not a declared intention" (`M/north-star.md:19`). It is also what the big ideas themselves demand: a judge from outside. A plan built only from the ideas would risk a third week in which most landings are about the work and not the product (`doc:176-177`). The rehearsal is the guard against that. Finding `docs/v1.md` and building on it was the best correction in the document (`log:4105`).

**2. "Where this plan goes beyond the record" should stay, nearly word for word.** It is the most valuable section and it is the body of work's own habit: every essay ends by saying where the record falls short of the framing (`P/every-choice-was-right-at-the-time.md:137-144`). The record did push back on John's 14 November framing: "every" fails as a finding, "easily" is not shown, "100x" is unmeasured. A document that simply leaned on the bigger ideas would repeat the overclaims that thirteen checks had just removed. My complaint is about what the section was used for. It was used to subtract the ideas. It should be used to turn them into the plan's questions.

**3. Some of the specifics are the ideas, at work.** "The loop gains no steps and no papers are written" (`doc:39`). "They report and gate nothing" (`doc:36`). "Everything else on the sheet can wait, and no work idles while it waits" (`doc:17`), which is the lesson of the overnight stall. The purpose lines in Ruling 4. The seven safety findings. The sentence at `doc:101`. These should survive any rewrite. The document's fault is not that it is specific. It is the order: the specifics came first and the ideas were attached after. The same specifics hung from an argument would read very differently.

**4. A plan is not an essay, and John has said he is content to rule.** "If I need to click ok a few times, but all the work lands clean and right, that's a great place to be in." (`log:4027`). He has also twice pulled back from abstraction that got ahead of the work: of one proposed north-star line he said "this feels 'in the weeds'" (`log:3623` as the log reports it), and the reviewer of the shape essay recorded that its table "reads close to a scheme, with the papers as the frame (the risk John named)" (`log:4070`; I have not seen John's own words for that risk). So "lean on the bigger ideas" should not mean more theory in the plan. It should mean one opening argument, each part stated by what it is for, and fewer, larger questions.

**A warning about my own section 4.** A list of standing choices, a purpose line per area, and a removal sign per loop step are three new things to keep. That is the habit the record keeps catching: asked for removal, the session proposed rules, and John said "I think we're seeing the issue." (`log:3961`). If the rewrite adds these and keeps all 28 rows, it has made the document worse. Each should replace something: the choices list replaces Ruling 2; the purpose column replaces the line counts in the area table; the removal sign replaces the yield figures as the lead of Ruling 3. The document should end shorter than its 5,500 words.

### If only three things change

1. Open with the argument, and move the five process threads and the history to the back.
2. Name round 1 as the first proper test of the one thing never shown, and bring the plain-session comparison from "smaller questions" to the centre.
3. Ask John for purposes: the handful of standing choices, and for each loop step "stays, goes, or stays with a planned removal".
