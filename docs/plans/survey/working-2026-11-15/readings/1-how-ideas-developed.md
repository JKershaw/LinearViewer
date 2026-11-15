# How the ideas developed: the trail, 2 to 14 November 2026

Read-only recap for the write-up. Every claim carries a citation. John's words are in quotation marks and copied exactly, typos included. Where the log reports John without quotation marks I say "reported". Anything I worked out myself is marked (inferred).

**Short names for files**

- `log` = `/home/user/LinearViewer/docs/plans/survey/log.md`
- `plan` = `/home/user/LinearViewer/docs/plans/survey.md`
- `disc`, `review`, `asks`, `gate13`, `gate14`, `course`, `round1` = `discussion.md`, `review-2026-11-08.md`, `asks.md`, `gate-2026-11-13.md`, `gate-2026-11-14.md`, `course-2026-11-14.md`, `round1-results.md` in `/home/user/LinearViewer/docs/plans/survey/`
- `v1` = `/home/user/LinearViewer/docs/v1.md`
- `M/` = `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/wt-main/docs/` (main). So `M/north-star.md` is north star v4, and `M/papers/harbour/…` holds the papers.

**A caution on times.** The log says its own clock headings drift from git by up to 1.5 hours and should not be cited as times (log:2589). On 14 November the headings are also out of order (an "about 10:05 UTC" entry at log:3989 follows an "about 11:40" entry at log:3969). Use the order of the lines, not the clock (inferred).

---

## 1. Turning points, in date order

**1. 2 Nov. The question is first put: nobody lives in the place.**
- Before: Harbour was judged by the ticket. About 95% of asks were delivered as written, and outside reviews ("Periodicals") inspected the code and filed tickets (plan:9, plan:34).
- Change: the plan says "a codebase is a place, and nobody lives in it", sets the aim as bringing codebases "toward settled" (a balance, not smallness), and turns the question from "what is messy?" to "where does *this* change bind?" (plan:9, plan:11, plan:56).
- Cause: the record. 965 commits and +78,900 lines since 1 September, with about 100 commits that shrink code (plan:9); a tidy in October reached the server while the changes bound in the browser (plan:56).
- First practical form: ask finished builders "why was it difficult and where did the change bind" (log:57).

**2. 3 Nov. A forecast before the work is useful, and the prompt gets less guided.**
- Before: a structured Survey prompt with a menu (versions v0 to v2) (log:27-32).
- Change: the forecast "works as a *surveyor*, not just a reviewer" (log:7); from round 2 "for the first time we act on the forecast" (log:371); an open one-question version replaces the menu (log:454).
- Cause: John, "perhaps our prompt is too guiding?" (log:452) and "We want a pretty free form answer, and the temptation will be to specialise for Harbour as that's the shape of the code we're working with." (log:458). His two added questions to builders got a one-owner answer from 14 of 14 (log:515, log:841).

**3. 4 Nov morning. "Is the Survey a drill by other means?"**
- Before: the measure was whether a task landed well.
- Change: measure whether the codebase is getting cleaner. Periodicals become the top-down "push" beside the Survey's bottom-up "pull" (log:863).
- Cause: John's question (reported, log:863). The evidence leaned his way: every acted-on recommendation was a preparation for the task, and "No Survey on a feature ticket has yet caused a tidy" (log:866-867).

**4. 4 Nov midday. The goal becomes a per-task balance, and the size of the tidy is the person's call.**
- Change: a ledger with one row per merged ticket (log:1215); a priced range of options; the person chooses the scope (log:1237-1239).
- Cause, John: "there's a point… where the ratio tips: when a task truly does (on average) leave the codebase in a better place once finished, even a little, we're in a really strong place." (log:1213); "It's *my* call. Eventually a task is chosen, surveyed, and the user decides how much to tidy up." (log:1234); then he let Claude play the human and "choose a large enough option" (log:1249).
- The loop as it stood that evening, six steps: two Survey voices, a step-back with prices, the human's scope call, the build, a place reading at merge, Periodicals as independent checks (log:1456-1462).

**5. 4 Nov evening. Findings routed into live work get fixed; findings filed as tickets sit.**
- Measurement: 4 of 4 routed findings resolved, 17 of 17 pushed tickets unmoved (log:1449, log:1482).
- John then asked to try without the routing, "as if in a repo where they can't be assumed", and to err larger (log:1516-1521).
- A guard was set against prompts turning into rule lists: would a sentence make sense on a codebase that isn't Harbour? (log:1411). John: "I'm just adding a counterbalance to the temptation to make it a big list of rules" (log:1411).

**6. 5 Nov morning. The good result was the scorekeeper's own scoring.**
- Before: the ledger showed 10 better rows through the loop against a baseline of 1 better, 4 worse (log:1466-1469).
- Change: two blind readers who saw only code rated the loop's rows +0.37 and the baseline +0.38, then +0.37 against +0.50 (log:1925, log:1949). "the ledger's tipping point was my scoring" (log:1950).
- What did read better: deletions, and a tidy done as its own task (log:1951).
- John's reading (reported): the Survey is more the research step than the high-level view; Surveys could find things that become tasks done before the main task (log:1933).
- Steps added because of it: tidy first as its own task (log:1970); the at-merge balance becomes a blind read (log:1952).

**7. 5 Nov afternoon. Finish the move; a tidy that stops part-way reads like no tidy.**
- Measurement: the tidy that deleted every copy gave the only "better" rows; the tidy that stopped at 2 of about 30 copies read like the control (log:2072-2073).
- John: "we have almost a before, during, and after tidying up step" (log:2106). He would do big moves early, but a smaller scope "should" still make the next go smoother (reported, log:2026).
- Steps added: a count that may only fall, for partial moves (log:2030); a small tidy of the leftover copies straight after merge (log:2109). Four of these "after" steps each lifted an area's reading (log:2360).
- John set cost aside: "Right now we just want to know: does the task actually leave the codebase cleaner? We're happy to pay a premium for that at the moment" (log:2186).
- Periodicals became the independent check because the blind reads were "partly circular" (log:2261). Three of them said "better, small" (log:2300).

**8. 5 Nov evening. First sight of the mess moving into text.**
- An outside review found stale status claims in comments recurring "at about one a day", written by work landing in pieces (log:2268-2270).
- The operator found its own scope sentence had become a false code comment: "My scope text becomes the builder's comments." (log:2290, log:2302).
- This was logged as a scoping rule, not yet as the main problem (inferred from log:2270).

**9. 6 Nov. The paper narrows the claim.**
- Answer: "Tasks on average: not shown. Areas and finished moves: yes, on few cases." (log:2483). Its Surveys "corrected the headline I'd been giving John" (log:2419).
- Version 2: nine area readings over fifteen tickets all read better; one of four ordinary pairs did; the prompt is partly circular (M/papers/harbour/cleaner-than-it-started.md:38).
- A claim made that day ("the after-step's effect is real against this baseline") was withdrawn as an overclaim (log:2588).
- John (reported): the paper reads as though not much improved (log:2551).

**10. 7 Nov. Briefs lose intent at each hand-off; the operator sees its own habit.**
- After three essay rewrites built from checklists, the log records "Each hand-off loses intent and gains detail" and "I add rules beside rules, as they add code beside code." (log:2711, log:2716).
- A plain 440-word brief to one writer on a stronger model produced the version John merged (log:2722-2740).
- John, on what comes next: "The hard part is constantly keeping it moving in the right way, not trending back towards lists and drills." (log:2752).

**11. 7 to 8 Nov. Harbour takes over the hand's jobs, and the hand turns out to be the main source of error.**
- Six jobs moved into code (round1:9-16). John: "We want to make it easy for us, or anyone, to run the loop simply. Whilst building it we have extra checks, but these may not be needed in the product." (log:2863).
- Six tickets became about seventeen. John: "the spiral came from this session (the only non-regimented session in the loop, precisely what we're moving away from). That's Harbour's whole value, anecdotally proven." (log:3019).
- A brief that said how produced a setting John called unusable: "technically it's correct, but it's also obviously wrong and a mistake." (log:3071). Every check read from the same height as the brief, so none could see the feature itself was the mistake (log:3076).
- An agent writing scope drifted into how, as predicted (log:2948).
- On an over-built fix: "Harbour's goal is to be simple code … let's not swing far in the other way." (log:3001).
- The whole: "Not converging yet. The rate of change went up in this window." (Stability Review, quoted at log:3150).
- The review's summary: finished moves better, ordinary tickets not shown, the whole not settling (review:55-61); what held was structure, what failed was wording (review:73-90); "Harbour carried more by growing" (review:115-124).

**12. 8 to 9 Nov. Goal, measures in order, and a plan without a phase table.**
- Decided: toward settled; five measures in order (no new mess, the curve, speed, the person's seat, cost); a first stretch called "open the door" for a small outside team on Jira; $3,500 a week; targets set at gates. John: "Agreed, perfect" (disc:58-70).
- A proposed five-phase table and four streams were dropped: "no streams, no phase table" (disc:684). Instead two stretches, "what comes after is chosen when we get there" (disc:676).
- No big sort of the backlog. John: "My hope is the backlog shrinks with the code." (disc:484).
- Out-of-area finds go to area notes, not tickets (log:3231).
- A toy model found money was not the binding limit; work in flight and John's decisions were (log:3187).

**13. 12 to 13 Nov. Building the loop costs more than expected; the mess in text gets numbers.**
- Blind reads of two new mechanisms: mixed, then the first "worse". "each adds copies faster than it removes them, in the prompt and docs layer that no guard reads" (log:3442, log:3459).
- Stability run 6: "The product is settling; the process around it is costing more." 28 of 35 landings were process work; cost per task up; the notes' Waiting list growing on every landing (log:3563-3566).
- The number first appears as a measurement: 1.67 tickets minted per landing, against an earlier hand count of "about 1.4" (log:3471); then 1.37 (log:3566).
- An ask was retired on John's "this seems more complex than necessary" (log:3573). The lesson drawn: "an ask that names a mechanism invites one" (log:3574).
- John moves past the gate: "we've not been applying quite the right force to bend the curve." … "All the metrics showing mixed results is actually fine in my view" (log:3590). Real work and real tidies start in four lanes on default models (log:3595, log:3604).

**14. 13 to 14 Nov. A measurement written as a finish condition stalls the work; "looser, not tighter".**
- The area-wide read of the tidy lanes came back with no detectable difference (log:3779, log:3834). Both active lanes sat idle overnight on rulings (log:3844).
- Cause found in the operator's own drafting: "I wrote the gate into A13/A14 … as a Done-when; the cut rule then made it a lock only John could open." (log:3851).
- The operator answered with four new rules. John: "We want all this looser, not tighter." (log:3855). Measures now report and never gate (log:3862, log:3876).

**15. 14 Nov morning. The pattern is named: text grows about six to one, and the notes are a second backlog.**
- A history read: "a failure gets a sentence, and the sentence gets a guard that keeps it"; limits move text, they don't remove it; text shrinks when code takes the job (log:3933-3945). Notes went from 10.6 KB to 88.8 KB in six days (log:3909).
- John: "You propose the only solution is removing things. But then suggested rules, additional complexity, and giving agents authority to change the core parts. I think we're seeing the issue." (log:3961). "extra scaffolding and temporary structures are fine. We just need to plan their removal." (log:3964). "If code is getting 'cleaner' whilst a secret backlog grows, something is afoot" (log:3965).
- The papers agree: text shrinks when the thing it describes is deleted or one author rewrites a surface from its purpose; trimming rules never registered; every shrink grew back (M/papers/harbour/steering-text.md:14-36). The notes hold a backlog the tracker cannot see, 30 to 118 entries in six days (M/papers/harbour/beyond-the-code.md:36-43).

**16. 14 Nov afternoon and evening. One picture, one number (corrected the same day), and four versions of the plan.**
- The operator's summary: "the loop moved the mess from code (checked) into the text around it (unchecked)" (log:4078).
- A count of what causes work: of 142 tickets in a week, 16 to 20% came from complexity already in the code, 37 to 39% counting mess the week's own work added; two coders, κ 0.88 (log:4079).
- John's picture, confirmed with "Yes exactly! Please make a note of this": "My gut says if Harbour bends the curve and tidied itself as it runs, knowing importantly the maths has changed, we can arrive at a genuinely correct codebase, correctly arranged." The log's gloss: no rescue project, "V1 becomes V2 piece by piece" (log:4080).
- The number: "new work made per piece of work finished", given as 1.12 (log:4083), then corrected: 1.12 counted every ticket ID including planned slices; counting only what work left behind, ordinary work left about 0.65 per landing (log:4086).
- The plan took four forms in one day: a five-phase table to January (course:42-59); then, after John asked for a project manager's and product lead's view, one budget week at a time with a fresh-account walk pulling the work (log:4089-4095); then a narrative that gives each of thirteen areas one of three fates (log:4097-4102); then "bolder" (log:4103).
- "Bolder" entered as John's question: "What happens if we take bolder steps? Broad clean ups, refactoring, Theseus'ing, focus the loop, optimise. Efficiency." (log:4103). Its roots are older: "choose a large enough option" (log:1249), big moves early (log:2026), "a small variety, erring larger" (log:3596).

---

## 2. Ideas tried and dropped, or turned down by John

- **The structured Survey menu.** Over-guided and Harbour-shaped; replaced by one open question (log:452-458, log:1411).
- **The operator's own scoring of results.** Overturned by blind readers (log:1925, log:1950).
- **The agent choosing the scope.** John: "It's *my* call." (log:1234).
- **Routing Periodical findings into tasks.** Worked (log:1449), but John asked to run without it so the method does not depend on it (log:1516).
- **The economic argument, and a cheaper "after" step inside the same run.** Parked; John (reported) did not want to spend much on it (log:2119, log:2188).
- **Essays written from checklists.** Three versions; replaced by a plain brief (log:2708-2740).
- **A tiered rate limiter.** "let's not swing far in the other way." (log:3001).
- **A size record written by an agent.** Its test failed and it took four attempts (log:2943, log:3019).
- **The size-policy setting.** Removed: "I'd be happy to remove the feature cleanly" (log:3090).
- **"One tidy per area", a big up-front backlog sort, a census to retire views, an idle-time drain of the notes, the phase table.** All dropped in the 9 Nov discussion (log:3232, log:3239, log:3241, log:3236, disc:684).
- **A Periodical after every finished task.** Removed (log:3346, log:3360).
- **The stall alarm (A2).** Retired; John's prediction of over-complexity "scored early" (log:3573-3574).
- **Opus at every stage.** John: "It likely wasn't needed" (log:3604).
- **A prompt-size target.** "Prompt size isn't a huge issue. That limit is to push against lists if rules." (log:3627).
- **The area-read gate and its fixed 14-file sample.** The sample mostly missed the changed files (log:3836); John (reported): drop it (log:3853). The separate blind paired read went too (log:3876).
- **Four new operator rules, and an extra question for the fresh-reader check.** "We want all this looser, not tighter." (log:3855); "let's leave the parrot as is." (log:3875).
- **A standing direction to settle rulings overnight.** "we don't want to fight the system." (log:3799).
- **"Mixed readings are fine" as a north star line.** John: "this feels 'in the weeds'" (log:3623).
- **A hard weekly stop.** "I doubt the 'wait for Thursday' is true. It's just me keeping track of my budget." (log:3971).
- **The conventional phase chart.** Replaced by the operator itself within hours: "this answer replaces its method, not its numbers" (log:4089).
- **Never run, though recommended three times:** larger standalone tidies on the worst areas measured against an untouched area, until the 13 Nov lanes (gate13:26); and John's experiment on a blank or already-tidy codebase (log:2127).

---

## 3. John's own words on the goal

- The tipping point: "when a task truly does (on average) leave the codebase in a better place once finished, even a little, we're in a really strong place. Even if we rely on things like periodicals when we want to improve not tied to a ticket." (log:1213)
- "we're fighting a natural urge to just land the work. The best path may be a big chunk of refactoring then the small change. More work for the task, less work in future for the global." (log:1219)
- Converging: "Harbour should converge work, even if slowly, and resist spiralling out and generating more work (unless it's tidying up)." (asks:19)
- Simple code: "Harbour's goal is to be simple code … let's not swing far in the other way." (log:3001)
- Growth: "If we're adding, healthy growth is fine too." (log:3278)
- Scope of the tidy-up: "We're not redoing it all, but we are cleaning up potentially a significant amount of tech debt" (disc:436)
- The backlog: "My hope is the backlog shrinks with the code. A large backlog isn't actually a problem as long as we're not losing important things in the mix." (disc:484)
- Views: "Honestly, I like them all, but each is a candidate for Theseus'ing, after checking _why_ they end up so large." … "I'd be sad to get rid, but happy to tidy." (disc:550)
- The north star's ranking: John's words on it are only his acceptance, "Agreed, perfect", of five measures "in this order when they clash" (disc:58, disc:64-69). The applied text is at M/north-star.md:9. Speed was added because he asked about "fast tickets" (disc:73).
- Harbour's place: "if I choose to do something, Harbour is a passenger. This reflects that for many real projects, they're unlikely to be exclusively changed via Harbour." (log:3609)
- Cost: "The pricing limit need not become a red herring. We have our weekly limit, which is a fine somewhat informal limit." (log:3590)
- Readiness: "I'm confident our new approach beats our old one. I'm less confident our scaffolding is now fit for purpose, or when we will be simply running work which opens Harbour for business without needing hand holding." (log:4026)
- His seat: "If I need to click ok a few times, but all the work lands clean and right, that's a great place to be in." (log:4027)
- Shape: "if everything is in its right place, no tangles. And, likely, much much simpler. Nothing fights its shape." (log:4028)
- Old choices: "I assume every choice was right at the time. The mistake was continuing to build on it when it had outlived it's original intention." (log:4039)
- "It feels like we are close to be being able to make some large simple improvements, some Theseus'ing, and some removal/simplification. Getting us a textbook quality codebase, settled." (log:4078)
- "A* quality, through and through"; open to cutting features "if the cost to keep them is genuinely high enough"; the project's shape as "a first class data layer (on par with tasks and code)" (log:4085). These are fragments as the log keeps them.
- "a complete Harbour, open for business" (log:4088, quoted inside the log's account of his request).
- From 19 September, on v1: "we can build this v1 without a single other person and it will still be really, really good." (v1:31)

---

## 4. Threads that run all the way through

1. **A move is finished by deleting what it replaces.** The 2 November plan already cites "Deletion finishes" (plan:30); the 5 November rounds measured it (log:2072). The latest plan still ends each ask "in deletion" (log:4092) and calls deletion "the only move that costs less forever after" (log:4081).
2. **The person sets size and purpose; agents recommend.** Said on 4 November (log:1234) and kept in the 9 November roles (disc:124). The latest plan narrows it to "John's seat is purpose" and has John rule each area's fate (log:4084, log:4099).
3. **A check holds; a sentence does not, and rule lists are the trap.** John's counterweight against rule lists dates from 4 November (log:1411) and the review found "Structure worked; wording didn't" (review:73). The latest picture says "Prose is paid for on every run and a check once" (log:4081).
4. **Tidy where real work binds; pull beats push.** The first plan asks "where does *this* change bind?" (plan:56) and routed findings beat filed ones 4 to 0 (log:1482). The latest plan has tidying "ride on real work" and a walked path "pull the work" (log:4084, log:4092).
5. **Independent readers keep correcting the operator, and the operator is temporary.** Blind scorers, Periodicals, paper reviewers and a second coder each overturned or narrowed a claim (log:1950, log:2489, log:4069, log:4079). The session calls itself scaffolding to be removed (gate14:70) and the latest plan shrinks it to a weekly handover (log:4093).

---

## 5. Where the latest plan is contradicted or not supported by the record

**a. "Tidied itself as it runs" needs ordinary tasks to leave code better. That is the one thing the record has not shown.**
- The paper: "Ordinary tickets did not read better than the baseline." (M/papers/harbour/cleaner-than-it-started.md:44). The review: an ordinary ticket, "Not shown" (review:58).
- On 13 November: "no ordinary product task has gone through the finished loop yet" (gate13:15).
- The newest figure, 20 better, 2 same, 0 worse, is the loop's own verdict on itself ("self-reported", M/reviews/stability-review-2026-11-14.md:119), from a reader that was redesigned to have no "mixed" answer (log:3505).
- The paired area reads of the tidy lanes: "none witnesses convergence on code" (M/reviews/stability-review-2026-11-14.md:134).

**b. The corrected number (0.65, "already under one") rests on choices and on one week.**
- It sets aside what the Periodicals found (net +58 over 22 landings) and the 30 entries that seeded the notes; the coding is "mine" (log:4086).
- The kinds of work the plan wants more of are the ones above one: new capability 1.57 and defect fixes 1.60, "both too few to trust" (log:4086). The kinds below one are tidying.
- The Stability Review warns a flat Waiting count "can be settling and filing at the same rate" and that the reading is cut short at 1.2 days (M/reviews/stability-review-2026-11-14.md:250).
- The number moved from 1.67 to 1.37 to 1.12 partly because finds moved from tickets into notes: "Neither row alone is an improvement." (M/reviews/stability-review-2026-11-14.md:251).

**c. "The maths has changed" is stated more strongly than the cost paper allows.**
- The picture says a task costs about the same "almost whatever its size" (log:4081). The paper says "Cost rises with size, but slowly", calls the work slope "the least settled figure", and warns that a slope below 1 does not show cost bending (log:3474-3480). The plan's own reading has a 300+ line task at about 2.9 times a small one (log:4088).
- "a cleaner area is cheaper for every later task and the saving compounds" (log:4081): the first plan said "No trend in the cost of a same-sized change has been shown yet" (plan:64); the cost paper says "The tidy-first pairs are still anecdotes" (log:3482); the rebuild method's own test, later changes landing smaller, "has not had time to show" (M/papers/harbour/every-choice-was-right-at-the-time.md:140).
- "a rebuild costs about what a patch costs" (log:4081): I found no measurement of this in the files I read (inferred).

**d. "Bolder" has John's wish behind it but thin evidence that large moves change the shape.**
- For it: John has asked for larger moves since 4 November (log:1249, log:3596, log:4078), and rebuilds up to 2,816 lines merged cleanly (M/papers/harbour/rebuild-round.md:14-17).
- Against it: those rebuilds "did not move where decisions live" (M/papers/harbour/rebuild-round.md:21), and an earlier round left every area-level number unchanged (log:868). October's simplifying programme ended 9,725 lines larger (M/papers/harbour/every-choice-was-right-at-the-time.md:84). "Nothing shows the clearing is easy", and "100x" is unmeasured (same file:32, :141).
- "Err larger" has already been misread once as more pieces (log:3019, log:3024), and John warned agents are "very likely… trying really hard to do big things when we want small" (log:3241).
- The newest outside reading says the trajectory after the tidy wave "is unobserved" and offers "Let the wave finish and then pause it" (M/reviews/stability-review-2026-11-14.md:113-114, :448). The bolder answer does not wait for that reading (inferred).
- Its headline figures (100 to 130 landings a week, V1 in three to five budget weeks) are "derived, not measured" by its own account (log:4103). Nothing above 2,816 lines has been tried and the core is about 73,000 (course:65). The essay merged the same day puts the largest rebuild at "about 930 lines over two files" (M/papers/harbour/every-choice-was-right-at-the-time.md:140), so the two documents use different ceilings.

**e. Steps listed as dropped "on John's ruling" have not been ruled on, and two were his decisions to keep.**
- The course drops the plan-review loop, the cut rule, prose notes, and questions look-first and the blind read (course:31). The document itself says "Nothing here is decided" (course:3).
- On 9 November John kept both Surveys: "we did find benefits from two" (disc:321). "No new mess" read blind is the first-ranked measure (disc:65, M/north-star.md:9). Dropping the blind read removes the instrument for it (inferred).
- "no quality evidence" is fair for outcomes (point a), but the record does hold evidence that looking first corrected tickets: two of four ordinary tickets had a stale premise (log:1839-1842), and 15 of 16 finds in the blind-read pilot held up (log:3495).
- The agreed way to decide was one structure at a time, "stays, goes, or stays with a planned removal, in John's words" (log:3976). I found no record that this happened before the course was drawn (inferred from log:4077-4103).

**f. The agreed next round is missing from the latest plan.**
- Agreed on 14 November: "the notes spike first", then fixes, real work and bigger tidies (log:3977, gate14:74). The narrative version puts the replacement for notes "Not before the first outside team is in" (log:4102).
- The operator said a bare-session baseline should run first and "no more papers until an experiment gives a result" (log:4078). The course has no baseline step (inferred from course:21-48).
- Seven safety findings held only in notes were waiting on John at the gate (gate14:25) and still are (course:44).

**g. "Open for business has no definition" overlooks the accepted v1 document, and "V1" now means three different things.**
- The course says the phrase "has no definition or date in the record" and sets V1 as a stranger reaching a verified merge unaided, calling that "the north star's own bar" (course:10, course:18).
- `v1`, accepted 19 September, says v1 "is done at the dress rehearsal": John himself, on a fresh account and an unseen repo. "Strangers reaching the bar unaided is the next step's bar, not this one's." (v1:31-33, v1:130).
- `v1` puts a runner for other people outside v1 (v1:91); the course puts it in phase 4 (course:48). `v1` shows a free tier already built (v1:116); the course lists a free tier as later (course:19).
- John's 14 November wording adds a third bar: the whole codebase "A* quality, through and through" (log:4085).
- No file in the survey folder cites `v1.md` (my search; inferred that the five sub-agent readings missed it).

**h. Cutting features goes further than anything John has decided.**
- The course: "Cut before fixing", naming seven experimental views (course:26). The two-seat answer: "Shrink the product until the list fits" (log:4092).
- Decided 9 November: "No surfaces are retired by default"; retiring "only as John's call, and it's not the plan" (disc:545-547). His 14 November opening is conditional: "if the cost to keep them is genuinely high enough" (log:4085).

**i. Planning by the budget week hardens something John called informal, and brings back a table he set aside.**
- His words: "a fine somewhat informal limit" (log:3590); "weekly is sort of the wrong cadence" (disc:635); "I doubt the 'wait for Thursday' is true." (log:3971).
- A phase table was dropped on 9 November (disc:684); the course brought one back with dates to January (course:42-59) before the operator replaced it (log:4089).
- In support: John did say running fast leaves "more time for talk and test" (log:3592).

**j. "John's attention is the limit" is not how John put it.**
- The plan says the limits are John's attention and the budget (log:4091), and that half its speed comes from John ruling early (course:67).
- John: clicking OK a few times is "a great place to be in" (log:4027); on false escalations, "if I do become a blocker we can look into it" (log:3609).
- The overnight stall came from a finish condition the operator wrote, not from John being away (log:3851).

**k. The distance figures are soft.**
- "About 250" became "about 700" within the day (log:4088).
- The pass behind it recorded 888 tickets carrying a claim across 1,281 rows, 864 rows confirmed (log:3282), and "counted stale docs and vacuous tests as broken" (log:3283), which John later agreed are mess, not broken (log:3611). I could not trace "about 700 tickets" to a line in the record; the sub-agent files were not committed (course:3) (inferred).
- The course admits the 570 non-blocking tickets "are sized by guess" (course:63).

**l. Running other people's projects is untested.**
- John's idea is a V1 after which Harbour "mostly runs other projects" (reported, log:4085). The loop has run on Harbour and its runner only. The outside-codebase test proposed on 5 November and listed on 8 November never ran (log:2127, disc:671). The essay's own limit: "One codebase, one owner, a few weeks" (M/papers/harbour/every-choice-was-right-at-the-time.md:144).

**m. A small inconsistency about the north star's ranking.**
- The proposal file says the five measures "were drafted in and then cut" (M/north-star-v4-proposal.md:7, :103). The applied north star contains them (M/north-star.md:9), and the log ties John's "in the weeds" to a different line, "mixed readings are fine" (log:3623). Treat the applied text as the authority (inferred).
