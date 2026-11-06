---
title: What happened when the place became somebody's job
kind: essay
argument: When the loop finished a move (its planned work merged, then the copies that change left at its edges were gathered straight after), the area of code ended up cleaner, a small and real direction that the independent readings share; ordinary tickets done one at a time are not shown to help or hurt, what did the work was finishing by deleting copies rather than adding an owner beside them, and the person's part was the size of each move and the authority granted.
version: 1
date: 2026-11-06
authors: [Claude (LIN-4330, implementation), for John Kershaw]
model: "claude-haiku-5-5 (Haiku 5.5), Claude Code CLI, dispatched by Harbour as an implementation (LIN-4330); effort not recorded in this session. Two fresh readers, each a separate fresh subagent given only this essay (Reader A, new to Harbour, the main audience: claude-haiku-5-5; Reader B, an accuracy check against paper version 2, its evidence folder and the cited commits: claude-sonnet-5-5). Their findings and what changed are in the pull request. The essay is not independently checked by a person."
sources: ["docs/papers/harbour/cleaner-than-it-started.md@ea352306 (paper version 2)", "docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06-v2/analysis.json@ea352306", "docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06-v2/git/census-by-merge.json@ea352306", "docs/papers/harbour/tasks-are-tasks.md@ea352306", "docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06/prompts/blind-read-prompt.md@ea352306", "docs/plans/survey/notes-2026-11-05.md@1c894016:126-160", "docs/plans/survey/log.md@1c894016:1966-2040, 2389, 2413, 2419, 2430", "docs/plans/survey/place-ledger.md@1c894016:19", "docs/reviews/seams-tangles-review-2026-11-06-run9.md@509f797e:9,13,109,152", "docs/reviews/drift-coherence-review-2026-11-06.md@509f797e:15,17,47,73,238", "tests/unit/fake-dom-census.test.js@ea352306:52-59", "tests/unit/public-element-method-guards.test.js@ea352306:181", "lib/dispatch-entrance.js@ea352306:1218", "lib/providers/linear/index.js@ea352306:1169-1182", "docs/papers/standard.md@ea352306"]
---

# What happened when the place became somebody's job

**The argument.** When Harbour's loop finished a move, the area of code ended cleaner. Finishing meant two things in order: the planned work merged, and then the copies that change had left at its edges were gathered straight after. The direction is small, and the readings that do not share the scoring prompt agree on it, with exceptions this essay names. Ordinary tickets done one at a time are not shown to make their areas better or worse. What did the work was the finishing: deleting copies, rather than adding a new owner beside them. The person's part was the size of each move and the authority given to it. The reading is partly circular, and the essay says where.

This is the sequel to *Tasks are tasks, and the codebase is a place* [3]. That essay said nobody's job is the place, and asked what could hold it. This one tells what happened in the days, from 4 to 6 November 2026, when a loop run by a person and Claude together made the place somebody's job, and what the record can bear.

## The place had no one

Harbour is the product: a control plane that runs AI coding agents over a team's work items, which it calls tickets (here, issues in Linear, the tracker the team uses). Each ticket goes through a series of stages, each a fresh AI session that reads the ticket and does one job: research, planning, a second reader of the plan, building, review [3]. Each session is a contractor. It does the job it was given and leaves.

The prequel's point is about the place: the code as a whole, the things a later change has to work within. The place has owners, copies, lists and guards. A copy is the same decision written in more than one spot, so that a change to it has to be made several times, or it is made once and the others are left behind. The prequel's diagnosis was that the agent that feels the friction in the place is held to its ticket, what it learns is filed under the job, and the tidying that would make the next change easy has no owner. The software writer Kent Beck put the advice this way: "make the change easy (warning: this may be hard), then make the easy change" [10]. Inside a ticket, Harbour did the second half. Nobody did the first [3].

The prequel used John Kershaw's images for this. Harbour is best seen, he said, as a film, and what holds its shape is a hand held out to keep a forcefield in place. Every time the hand moves, the shape dissolves [3]. The prequel also used a ball, where a change "binds" on the layers of code it has to push through [3]. Those images are John's, and the essay marks them as his. A drill and a chisel, the image of an agent as a drill and a builder as the one hand touching the stone, came from a conversation John had with Claude, and the prequel marks it as that [3].

The question this essay takes up is whether a loop could be the hand that stays. The loop, defined below, is a sequence run on each ticket, with a person holding its authority.

## The loop, in one picture

![Three columns, before, during and after: a read-only Survey and a scope call before the work; a tidy first where the change binds, then the change, during the work; two blind reads and the builder's answers at merge; a tidy-after of the copies left at the edges, straight after the merge. A dashed arrow returns from the tidy-after to the next ticket in the same area. The figure has no numbers.](figures/the-place-became-somebodys-job/loop-before-during-after.svg)

*Figure 1. The loop as the notebook drew it on 5 November, from the notebook's own list of its steps [4]: before the work, a Survey and a scope call; during it, a tidy first and the change; at merge, two blind reads and the builder's answers; after the merge, the tidy-after of the copies left at the edges. The dashed arrow is the notebook's rule that a tidy-after which reads better gets no tidy-after of its own: its residues go to the notebook, for the next ticket in the area to pull. It has no numbers.*

Some terms first, because the loop has its own words. A **Survey** is a read-only step before a ticket's work. It is posted on the ticket and says what the code looks like now. The **scope call** is a section written onto the ticket, headed "How to go about it", that says how big the move should be and what to check when it lands. A **tidy-first** is a small tidy, filed and landed as its own task, ahead of a broad ticket. A **tidy-after** is the follow-on that removes what the parent left behind. A **blind read** is a reader that scores a commit from its code alone, without the ticket, and gives it a sign: better, neutral, mixed or worse. Each sweep of such scoring over a set of changes is a **pass** [1]. The **notebook** is the working record the loop keeps in `docs/plans/survey/`. The **operator** is the person who ran the loop and kept its notebook, with Claude [1, 4].

The notebook recorded the loop as it ran on the afternoon of 5 November [4]. Before the work, a Survey. Then the person's scope call, which the notebook lists as a set of rules: big moves early; a partial move leaves a ratchet, meaning a check that stops it drifting back; a sweep starts by writing the check it will pass; write the scope as instructions, not descriptions, because a description that is not quite true becomes a false comment in the code. During the work, a tidy first where the change binds, then the follow-on, re-surveyed on the tidied ground. At merge, two blind reads and the builder's answers to seven questions once the work's lineage has ended. After the merge, the copies the blind reads named at the edges became a small tidy-after, straight away, Surveyed first. The **Periodicals** are standing review reports on the whole codebase, such as Seams & Tangles and Drift & Coherence. They came in now and then, as the notebook put it, "the film" [4].

The loop is not a method anyone designed on paper first. It is the sequence the notebook describes, and each step is a judgement made by someone, often by Claude on behalf of the person. That matters later.

## What the code looks like at the commits cited

Four of the changes can be seen in the code. Each is given at the commit where it is true. None is a Periodical verdict, and the Periodicals are the only readers with that standing [1].

**The hand-written fake DOMs.** A DOM is a browser's model of a page. The test suite has one shared stand-in for it, so that client-side tests need not each build their own. Some tests still built their own by hand. The **census** is the test suite's own list of the files that still do this, and it only shrinks [9]. A file on the list that is marked "stop" needs a browser behaviour the shared stand-in does not model, and cannot move yet. The census began with 56 entries at 5 November 13:18Z (`69e8f1754`). It stood at 25 at `af55cb73` (5 November 19:02Z), and at 6 at `ce42e7217` (LIN-4312, 6 November 11:41Z). All six remaining entries are marked "stop", such as one that needs an event to bubble up the page [9].

The count is the census's own definition: how many hand-written fake DOMs are on its list. Figure 3 draws it merge by merge.

![One point per merge that carries a census count, 42 in all: the count of hand-written fake DOMs falls from 56 on 5 November to 25 at af55cb73, with stops first marked at 591bb9596, and reaches 6 at LIN-4312, all six marked stop. The stop split is not drawn before the marks exist.](figures/the-place-became-somebodys-job/census-by-merge.svg)

*Figure 3. The census count at each of the 42 merges that carry one [2, 9]. Many merges left the count where it was. Before the stop marks existed, only the total is drawn.* It is a proxy. It falls when a file leaves the list, not when the copies behind it go, and a file can leave the list without its copies going anywhere [1]. So the essay says the census reached 6, all of them stops. It does not say the fakes are gone. A cruder count, of the words `makeContainer` and `createElement` in the test folder, is a different measure, and it rose from 46 to 51 over the window of the Drift & Coherence review that ran on 6 November [8]. The essay puts the two side by side because they disagree.

**The method-presence guards.** A method-presence guard is a check that a node has a method before the code calls it, such as `x.querySelector ? x.querySelector(...) : null`. Seams & Tangles run 9 counted about fifty of them deleted from the browser code, by a crude token match [7]. A test now holds the spelling rule, with an allow-list that has been empty since LIN-4312 [9]. The test is what keeps the guards from coming back, and the essay gives it that role, not a claim that every removed check was wrong.

**One grant rule.** The rule for the periodical grant, which decides which periodical runs may take the dispatch grant (the permission to start agent work), was written in two places. LIN-4317 (`f2816e17`, 6 November 10:10Z) moved it into one function, `declaresPeriodicalGrant` [9]. Drift & Coherence run 5 reads this as better in the rule and neutral in its inputs [8]. Its second read found that the session lane still decides from text the browser posts, which it lists as an open item [8]. The rule is one rule now. What feeds it is not yet fixed.

**A silent cap.** Before LIN-4322, reading an issue's comments had no page size, and the workspace API proxy (the route through which Harbour reads Linear) returned at most 50 comments per issue [1]. The close-out gate, the check that reads a ticket's comments before it closes, could therefore have read a stale review and not known it. The paper found this. After LIN-4322 (`badec1fb`, 6 November 11:57Z), the read pages through the comments and fails if it cannot read them all [9]. After the deploy, `GET /issues/LIN-4150` returned all 143 comments [1]. The essay says the gate *could* have read a stale review. Nothing shows that one did.

## How the first measure was overturned

The loop's own tally, kept in the notebook, read 17 better, 3 mixed, 1 neutral and 0 worse [1]. The blind reads did not agree. Two blind passes, each by a separate scorer, scored the ordinary tickets against a baseline of eight earlier changes, the ones that landed before the loop. The blind readings score each change +1 for better, 0 for neutral or mixed, and -1 for worse, and a pass's score is the mean over its changes [1]. In pass 1 the baseline scored +0.38 and the forward tickets +0.39. In pass 2 the baseline scored +0.50 and the forward tickets +0.37 [1]. The notebook's own summary had been "no better than the baseline" [4]. The paper says a gap of a tenth is one row's sign, given counts of eight and nineteen, and it does not lean on the gap [1]. The essay does not lean on it either.

What read better was narrower than the tally. The forward tickets are the loop's own ordinary tickets, one row in the place ledger each. The notebook, at its 09:20 entry, corrected the morning's headline: the claim was about areas ending better when the loop finished a move, "not 'tasks on average leave it better'", and the notebook says the earlier recap had blurred the two [5]. The record's claim is therefore about finished moves, and the essay keeps to that.

The readers that do not share the scoring prompt are less tidy than the summary. Drift & Coherence run 5 rates its window "better, small", the same verdict as run 4, with one area mixed [8]. The mixed area is "production code shaped for tests". Its own detail is in the Drift report: a test-side copy of the lane template was removed, but `public/live-console.js` now publishes a second surface, `window.LiveConsoleLane`, which only the tests read [8]. The tidy removed a copy from the tests and added a surface that only the tests read. That is the essay's own pattern, and the Drift reader saw it. Seams & Tangles run 9 reports no area worse [7]. Its one worse area, from run 8, still stands. The catch-all, the set of library files that no other area claims ("other features"), grew from 16 to 17 when `lib/stage-writes.js` was added by LIN-4253, a tidy-first that read better in both blind passes. The Seams reader reads that as worse as a map, and run 9 leaves it unchanged [7]. So the loop touched one area that a Periodical reads as worse, and the essay says that plainly.

## Finishing, not adding

John's point about the size of a move, as the notebook records it, is the centre of the finding. Big moves come early. A partial move should still trend in the right direction, even when it does not move the whole stack [5]. The notebook called this "Towers of Hanoi", after the puzzle in which discs of different sizes must be moved between pegs, and the big disc moves early. Claude's gloss, which is not John's and which the essay marks as Claude's, is that to move a feature cleanly you first move its tidy, and to move the tidy you first move its copies.

The ratchet is what makes a partial move hold. A helper with nothing holding it can drift back: the notebook records an earlier approach that "stayed flat" while a fresh file wrote raw copies beside the helper. A count that may only fall keeps a smaller move from decaying [5]. The census is that count.

The evidence for finishing is eleven cases, read by one prompt. Six single changes that deleted or merged copies read better in both passes: LIN-4253 deleted two hand-kept name lists and derived them from each template; the others are LIN-4276, 4277, 4293, 4296 and 4304. Five that added code beside the old copies read mixed in both: LIN-4246, 4247, 4248, 4252 and 4263 [1]. The prompt asks every change whether it added a copy and what it deleted, so the prompt is part of the result, and the paper says so [1].

Figure 2 sets the finished moves beside the baseline. An **area** is a parent with its tidy-after or its pieces, read as one unit. Nine area readings over fifteen tickets, all better in both passes, and no pass read one worse. The four ordinary pairs of consecutive changes to the same files, from 20 October, were read with the same prompt. One of four ordinary pairs read better in both passes [1].

![Two groups of rows, each row with two cells, pass 1 and pass 2. The first group is nine finished-move area readings, all better in both passes. The second group is four ordinary pre-loop pairs: three mixed in both passes, and one, a consolidation that shared one stop rule, better in both.](figures/the-place-became-somebodys-job/area-readings-and-pairs.svg)

*Figure 2. Nine area readings over fifteen tickets, all better in both passes, beside four ordinary pre-loop pairs, one better in both. The same prompt scored both groups. This is not loop against no loop, and pairs are not untouched areas [1, 2].*

The one better pair was itself a consolidation. LIN-3717 moved loop-terminal checks into one module, and LIN-3722 then shared one rule for where a run stops. So the paper's sentence is the one the essay uses: reading a pair as one area does not by itself make it read better; what reads better is consolidation, and the loop's finished moves are consolidations [1]. The fair line is not that the loop beats ordinary work. It is that the moves that gather scattered decisions into one place read better, and the loop's finished moves are of that kind.

Two cases show the difference. LIN-4252 added a shared fake DOM helper while seventeen hand-written copies were still outstanding, and read mixed in both passes. Its follow-on, LIN-4255, tidied those copies, and the pair LIN-4252 with LIN-4255 read better in both [1]. The first move left its copies. The second took them away.

## The person's seat, and the turn

The scope call is where a person's judgement sits in the loop, and it is also where the record is thinnest. The paper counts a scope call on 22 of 68 place tickets [1]. Eight of the 22 say that John asked Claude to take the human's role, with the wording "how much to tidy" ("choose a large enough option", or "err on the side of larger tidies"). Those calls were written by Claude on John's delegation. The record does not show who wrote the other fourteen [1]. The scope call is absent on the other 46. A pre-work Survey is visible on 29 of 68 [1]. So on most place tickets there is no scope call to read.

Three cases show what can go wrong in that seat. Each is one case and none is measured [1]. A scope rule in LIN-4178's wording invited a new copy, which the ledger calls "a new twin, invited by the ticket's own wording" [6]. A sweep was drawn by a method name in LIN-4292, where the notebook says the line should be drawn by behaviour in any spelling [5]. A scope description in LIN-4255 became a false comment in the code. The essay's claim is narrow. The seat in which scope calls are written can generate mistakes, and it is the place where a structure would have to sit, at the scope call and at a sweep's name [1]. The essay does not put these mistakes on John personally, because the record does not.

John's reading, as the notebook records it, is that the mistakes of the operator's seat are what one would expect when a person is holding the reins, and that this is why the points a person holds should move into Harbour as structure, so that agents at this altitude do not need to supply judgement [5]. The notebook also records his view that the work should not be undersold: "even if it's small", the trend is toward a better, simpler, easier to maintain codebase [5]. The human calls, as the notebook lists them, stay human: how big a move is, the rulings, and granting authority. On 6 November John granted a new authority explicitly, as a human decision, and the grant is recorded on the ticket [5].

## Three habits the record keeps

Three patterns come up in the notebook's cases, and the essay names them because they are what a structure would have to hold [5].

A sweep starts by writing its check. Its hit list at the base is the work list, and the check passing is what done means. The notebook says two builders reached this independently [5].

A list kept by hand goes stale. A list derived from the code does not. LIN-4253 replaced two hand-kept name lists with ones derived from each template, and read better in both passes [1]. The prequel's point is the same one: a list kept by hand is a copy of the code, and copies drift [3].

Fix the fake, do not bend the production code to fit it. The notebook names this as a pattern [5], and the Drift reading's one mixed area is a case of it: production code shaped for the test, `window.LiveConsoleLane` [8]. The census counts hand-written fakes. It does not see a surface added to production code for a test, so a count can fall while this kind of copy grows.

## What it cost

The paper's median cost for the 68 place rows with an exact cost is $8.16 per row [1]. The tidy-afters cost a share of their parent. LIN-4276 cost $6.77 against its parent LIN-4263's $14.37, which is 47%. LIN-4277 cost $7.82 against LIN-4251's $11.94, which is 65%. LIN-4304 cost $7.18 against LIN-4292's $8.41, which is 85%. Those are three pairs, so the paper gives a range, not a rate [1]. LIN-4276 is the most detailed case in the record. It removed a private comparator, and a posting-key list that had been written twice was written once [1].

John's position, as the notebook records it: "Cost is measured, not optimised" [4]. The notebook's gloss on it is that the question for now is whether each task leaves the code cleaner, and that the premium is paid to find out. The essay reports the premium and does not argue about whether it is worth it.

## What the record cannot support

The reading is circular, and this is the largest limit. The prompt that scored every change asks whether it added a copy and what it deleted. The tidy-after is the change that answers that question, and the same prompt judges its result [1, 12]. The Periodicals bear on direction without the prompt, but only over their own windows [7, 8].

The numbers are small. There are nine area readings over fifteen tickets, four pairs, three cost pairs and eleven cases for the deletion finding. The baseline is four ordinary pairs, from one day in one repository [1].

The pairs are not untouched areas. The record has no baseline for an area that nobody touched. That question is still open [1].

Seven merges come after both Periodical windows: LIN-4312, LIN-4322, the LIN-4254 line-anchor correction at `afe9074f`, and four non-place merges, the two Periodical reports, the notebook sync and the script change [1]. No Periodical has read them. The essay states them as facts about the code at their commits. It does not say a Periodical judged them better. `afe9074f` appears in no reading and carries no area reading [1].

The census is a proxy. Over the Drift window the census fell from 25 to 10 while the crude grep rose from 46 to 51, so the two measures point in opposite directions [8, 9]. The census is not the fakes being gone.

The notebook is still synced into main by hand, and LIN-4332 was the latest such sync [4]. This is a list kept by hand going stale, and the essay names it without fixing it. The essay cites commits on main, so it does not depend on the next sync [4].

The Periodicals are written by the same kind of agent as the code. They agree with each other on direction and disagree on one area [1].

## Next

1. **A new line for `proposals.md`.** The essay's own question, which the paper did not file: would a guard, or a list derived from the code, at the scope call and at a sweep's name have stopped the copies the loop later removed? The three lines the paper already filed, on the larger tidy, on one-owner changes that delete their copies, and on an untouched-area baseline, stand as the paper left them at `docs/papers/proposals.md:663-665` [1].
2. **A Periodical run of its own** for the seven merges after both windows, before any essay cites them as judged.
3. **Not this essay.** The notebook's hand sync, and the session lane's grant (the code path that starts an agent session) decided from browser-posted text [8]. Both are named here and left to their own tickets.

## Reading list

1. **Paper: *Can a task finish with the codebase cleaner than it started?*, version 2** (`docs/papers/harbour/cleaner-than-it-started.md@ea352306`). Supports every number in this essay, the findings, and the limits. Does not show the blind scores were checked by a second person; its own fresh readers checked the paper, not the scores. Every figure in this essay that comes from it is read in place from its evidence folder.
2. **Evidence folder, version 2** (`docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06-v2/`). `analysis.json` gives Figure 2 and the pair readings; `git/census-by-merge.json` gives Figure 3. Supports the counts. Does not explain them: the readings are signs from a prompt, not an explanation of why a change read better.
3. ***Tasks are tasks, and the codebase is a place*, version 5** (`docs/papers/harbour/tasks-are-tasks.md@ea352306`). The prequel: the diagnosis, the forcefield, the ball, and the drill and the chisel. Supports the account of the problem. Predates the loop, so it says nothing about its results. The images are John's, except the drill and the chisel, which came from a conversation with Claude.
4. **Notebook, afternoon of 5 November** (`docs/plans/survey/notes-2026-11-05.md@1c894016:126-160`). The loop as it ran, the list of its rules, the table of blind reads on the day, and the cost line. Supports the description of the loop and its rules. Does not supply evidence of effect. Its clock headings drift from git and comment times by up to about an hour and a half, so the essay cites git and comment times where it can.
5. **Notebook log, dated entries** (`docs/plans/survey/log.md@1c894016`). Lines 1966 to 2040 hold the Hanoi entry (2025 to 2031) and the ratchet (2030). Line 2389 is the sweep rule, 2413 the grant, 2419 the headline correction, and 2430 John's reins reading. Supports John's words as the notebook records them and the operator's own corrections. Its headings are unreliable; the essay cites the lines.
6. **Place ledger** (`docs/plans/survey/place-ledger.md@1c894016:19`). The LIN-4178 row, the one scope-wording case. Its counts are stale and the essay does not use them.
7. **Seams & Tangles, run 9** (`docs/reviews/seams-tangles-review-2026-11-06-run9.md@509f797e:9,13,109,152`). No area worse; the catch-all unchanged at 17; the guard count, which is a crude token match. Supports the Seams reading. Does not cover the merges after its window. It is a delta report.
8. **Drift & Coherence, run 5** (`docs/reviews/drift-coherence-review-2026-11-06.md@509f797e:15,17,47,73,238`). Better, small; the one mixed area; the grant rule; the session-lane item; the crude grep rising from 46 to 51. Supports those readings. Does not cover the merges after `5c63aa26`.
9. **Code at `ea352306`:** `tests/unit/fake-dom-census.test.js:52-59` (the census list); `tests/unit/public-element-method-guards.test.js:181` (the allow-list, empty); `lib/dispatch-entrance.js:1218` (`declaresPeriodicalGrant`); `lib/providers/linear/index.js:1169-1182` (the comment read that fails when it cannot read everything). Supports the code facts as they stand at this commit. Does not show the code is correct; no reviewer read it for this essay.
10. **Kent Beck, on making the change easy before making the easy change**, quoted in [3]. A practitioner's rule of thumb from software practice, not an estimate. The essay uses it for the shape of the problem and not as evidence.
11. **Papers standard** (`docs/papers/standard.md@ea352306`). How an essay is written here: the argument, the markers, the reading list and the Next.
12. **Blind-read prompt** (`docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06/prompts/blind-read-prompt.md@ea352306`, from version 1's folder). The prompt that scored every change in this essay. It asks each change whether it added a copy and what it deleted. Supports the limit the essay names. Read it before weighing any sign in Figure 2.
