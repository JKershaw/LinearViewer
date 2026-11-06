---
title: What happened when the place became somebody's job
kind: essay
argument: When the loop finished a move (its planned work merged, then the copies that change left at its edges were gathered straight after), the area of code ended up cleaner, a small and real direction that the readings not sharing the scoring prompt agree on; ordinary tickets done one at a time are not shown to help or hurt, what did the work was finishing by deleting copies rather than adding an owner beside them, and the person's part was the size of each move and the authority granted.
version: 3
date: 2026-11-06
authors: [Claude (LIN-4338, implementation), for John Kershaw]
revision: "Version 3 rewrites version 2 from the start, in one voice, from one brief (LIN-4338). Version 2 was patched in layers while it was written, and the seams showed: the scene, the limits and a figure caption were each fixed in place and did not agree. Version 3 was written whole, in one pass, from the brief, with versions 1 and 2 and paper version 2 as sources; version 2 was not edited line by line, and version 2 is closed by this version. It opens on the census with the argument in the same paragraph, tells the forcefield as its spine, and gathers every limit into one section near the end. Figure 4 was fixed by giving its panel room, not by moving one coordinate, and the figure numbers in the generator's comments were corrected. No number or claim is new; a token check holds every number against version 2, paper version 2 and its evidence folder."
model: "claude-haiku-5-5 (Haiku 5.5), Claude Code CLI, dispatched by Harbour as an implementation (LIN-4338); effort not recorded in this session. Two fresh readers, each a separate fresh subagent given only the essay and what the pull request names: Reader A, new to Harbour, the main audience (claude-haiku-5-5); Reader B, an accuracy check against paper version 2, the hedge ledger and the plan's rulings (claude-sonnet-5-5). Their findings and what changed are in the pull request. The essay is not independently checked by a person."
sources: ["docs/papers/harbour/cleaner-than-it-started.md@ea352306 (paper version 2)", "docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06-v2/analysis.json@ea352306", "docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06-v2/git/census-by-merge.json@ea352306", "docs/papers/harbour/tasks-are-tasks.md@ea352306:55,67,75,144", "docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06/prompts/blind-read-prompt.md@ea352306", "docs/plans/survey/notes-2026-11-05.md@1c894016:126-160", "docs/plans/survey/log.md@1c894016:1966-2040, 2132, 2389, 2392, 2413, 2419, 2430", "docs/plans/survey/place-ledger.md@1c894016:19", "docs/reviews/seams-tangles-review-2026-11-06-run9.md@509f797e:9,13,109,152", "docs/reviews/drift-coherence-review-2026-11-06.md@509f797e:15,17,47,73,238", "tests/unit/fake-dom-census.test.js@ea352306:52-59", "tests/unit/public-element-method-guards.test.js@ea352306:181", "lib/dispatch-entrance.js@ea352306:1218", "lib/providers/linear/index.js@ea352306:1169-1182", "docs/papers/standard.md@ea352306"]
---

# What happened when the place became somebody's job

Between 5 and 6 November, a list of 56 hand-built test fakes fell to 6, one merge at a time. Where Harbour finished a move, tidying the copies it left behind, the code ended cleaner: by deleting copies, not adding an owner beside them.

The census counts the files on its own list, and the six left are marked stop: each needs a browser behaviour the shared stand-in does not model.

One marker covers the whole essay. The forcefield, the ball and the trig point below are John Kershaw's images, and the readings of the loop against them are Claude's. Where John's words are quoted, they are marked as his.

The census is the test suite's list of the files that still build a fake DOM by hand [9]. A DOM is a browser's model of a page, and the shared stand-in exists so that client tests need not each build their own. Figure 1 draws the count at each merge.

![One point per merge that carries a census count, 42 in all: the count of hand-written fake DOMs falls from 56 on 5 November to 25 by 19:02Z that day, and reaches 6 at 11:41Z on 6 November, with all six marked stop. The stop split is not drawn before the marks exist.](figures/the-place-became-somebodys-job/census-by-merge.svg)

*Figure 1. The census count at each of the 42 merges where the count was taken [2, 9]. Before the stop marks existed, only the total is drawn.*

## The place had no one

Harbour is a control plane that runs AI coding agents over a team's work items, which it calls tickets (here, issues in Linear). Each ticket goes through stages, and each stage is a fresh AI session that reads the ticket, does one job, and leaves [3].

The prequel's point is about the place: the code as a whole, the things a later change has to work within. A copy is the same decision written in more than one spot, so a change to it has to be made several times, or it is made once and the others are left behind. The prequel's diagnosis is that the agent who feels that friction is held to its ticket, and the tidying that would make the next change easy has no owner. Kent Beck's advice was "make the change easy (warning: this may be hard), then make the easy change" [10]. Inside a ticket, Harbour did the second half. Nobody did the first [3].

## Shapes that need holding

John's image for this is a film. Harbour is best seen as a film, in motion and zoomed out, not as stills. What holds its shape is a hand held out to keep a forcefield in place, and every time the hand moves, the shape dissolves [3]. The hand stands for the person's part in the loop. The default pipeline holds a simple shape, one ticket's change. A **passage**, the prequel's word for a stretch of work bigger than one ticket's change and held together by a plan or a person, holds a more complex shape. John, by hand, holds a more complex one again [3]. The ball is his second image: a change "binds" where it catches on the layers of code it has to push through [3].

The Periodicals are the film's slower frames. A **Periodical** is a standing review of the whole codebase, such as Seams & Tangles or Drift & Coherence, written outside any ticket and reading the code directly [7, 8].

The question is what could hold the more complex shape, so that the hand can move without the shape dissolving. The loop below is the sequence the record examines.

## The loop, in one picture

![Three columns, before, during and after: a read-only Survey and a scope call before the work; a tidy first where the change binds, then the change, during the work; two blind reads and the builder's answers at merge; a tidy-after of the copies left at the edges, straight after the merge. A dashed arrow returns from the tidy-after to the next ticket in the same area. The figure has no numbers.](figures/the-place-became-somebodys-job/loop-before-during-after.svg)

*Figure 2. The loop as the notebook drew it on 5 November [4]: before the work, a Survey and a scope call; during it, a tidy first and the change; at merge, two blind reads and the builder's answers; after the merge, the tidy-after of the copies left at the edges. The dashed arrow returns the leftovers of a tidy-after to the notebook, for the next ticket in the area to pull. The Periodicals sit outside the loop, and the figure has no numbers.*

In this essay a **move** is one piece of tidying work on the place, such as gathering a rule's copies into one owner. Before the work, a **Survey** is posted on the ticket: a read-only note of what the code looks like now. The **scope call** is the section headed "How to go about it", which says how big the move should be. During the work, a **tidy first** lands as its own small task ahead of the broad ticket, where the change binds. At merge, two **blind reads** score the commit. A blind read works from the code alone, without the ticket, and gives it a sign: better, neutral, mixed or worse. One sweep of such scoring over a set of changes is a **pass** [1]. The builder then writes an **after-answer**, its reply after the work. After the merge, the copies the change left at its edges become a **tidy-after**, which is a follow-on that removes what its parent left behind, and it is Surveyed first. The **notebook** is the working record the loop keeps in `docs/plans/survey/`. The **operator** is the person who ran the loop, with Claude [1, 4].

The notebook's rules are these: big moves come early; a partial move leaves a **ratchet**, a check that stops it drifting back; a sweep starts by writing its check; and the scope is written as instructions, not descriptions [4]. An **area** is a parent with its tidy-after or its pieces, read as one unit.

The loop was not designed on paper first. Each step is a judgement made by someone, often by Claude on behalf of the person. My reading is that the scope call and the calls on size are the part the hand holds. The rest is structure that runs on them.

## One change through the loop

A ticket split the cost figure per dispatch, so that each dispatch got its own cost. Two blind reads scored the split at merge, from its code alone, and it read mixed in both passes. The copies it dealt with were a private comparator, and a list of row keys that had been written twice [1].

Those copies were the next job, and its tidy-after had a pre-work Survey, a scope call and an after-answer [1]. The blind reads found the private comparator gone, and the key list written once instead of twice. Both passes read the pair as better [1].

The pre-work Survey had already said the comparator's NaN was not a live bug, because the sort maps NaN to zero. The defect the change removed was the second copy. Two comparators were left in place, one in `lib/dispatch-lineage.js` and one in `lib/recent-runs.js`, and the change still read better [1]. The follow-on's builder also found that a row known only by its loop id was listed twice, and that the second listing could null its total cost. That is the builder's own account, in the after-answer on the ticket, posted on 5 November at 14:48Z, and in the notebook's log [5, 6]. The paper does not report it, so it is not a paper finding.

![Three panels. First, one decision written in three separate boxes. Second, one box changed by a change, and the two others still holding the old rule, marked left behind. Third, the changed box is kept, and the two others now read from it, marked gathered by the tidy-after.](figures/the-place-became-somebodys-job/copy-at-the-edge.svg)

*Figure 3. A drawing, not data: one decision written in three places. A change that fixes one place leaves two behind; the tidy-after gathers them. Figure 3 draws the shape the loop works to, not the data of this case.*

My reading is that the copies a change leaves at its edges mark where it caught on that code, and that the tidy-after gathers them. This is the prequel's ball, given a shape.

## What the four changes did

Four changes can be seen in the code, each at the commit where it is true. The check table gives each one's ticket.

**The hand-written fake DOMs.** Some tests still built their own browser model by hand, and the census lists the files that still do. A file marked stop needs a browser behaviour the shared stand-in does not model. The count began at 56 on 5 November at 13:18Z, stood at 25 by 19:02Z that day, and reached 6 at 11:41Z on 6 November, with all six marked stop [9]. A cruder count, of `makeContainer` and `createElement` in the test folder, rose from 46 to 51 over the Drift & Coherence window [8]. The two disagree. The count is the census's own definition.

**The method-presence guards.** A method-presence guard checks that a node has a method before the code calls it, such as `x.querySelector ? x.querySelector(...) : null`. A Seams & Tangles run counted about fifty of them deleted from the browser code [7]. A test now holds the spelling rule, and its allow-list has been empty since the merge that took the census to 6 [9]. The test is what keeps the guards from coming back.

**One grant rule.** The rule that decides which Periodical runs may start agent work was written in two places. A change at 10:10 UTC on 6 November moved it into one function [9]. Drift & Coherence run 5 reads that as better in the rule and neutral in its inputs; its second reading found that the code path that starts an agent session still decides from text the browser posts, which is an open item [8]. The rule is one rule now.

**A silent cap.** Reading an issue's comments had no page size, and the workspace API proxy (the route through which Harbour reads Linear) returned at most 50 comments per issue [1]. The close-out gate reads a ticket's comments before it closes, so it could have read a stale review and not known it. The read now pages through the comments and fails if it cannot read them all [9]. After the deploy, the ticket that had been cut at 50 returned all 143 of its comments [1].

## How the first measure was overturned

The operator kept score. The loop's own tally, kept in the notebook, read 17 better, 3 mixed, 1 neutral and 0 worse [1, 5].

Then two blind passes, each by a separate scorer working from the code alone, scored the ordinary tickets against a baseline of eight earlier changes, the ones that landed before the loop. A change scores +1 for better, 0 for neutral or mixed, and -1 for worse, and a pass's score is the mean [1].

| Blind pass | Baseline: eight earlier changes | The loop's ordinary tickets |
|---|---|---|
| Pass 1 | +0.38 | +0.39 (18 rows) |
| Pass 2 | +0.50 | +0.37 (19 rows) |

*Source [1].*

On the ordinary tickets the paper finds that they did not read better than the baseline. In pass 1 the two were level; in pass 2 the baseline was ahead. Two forward rows read worse [1]. The readers that do not share the scoring prompt were less tidy than the loop's own summary.

What changed was the claim. The blind readers became the instrument, and the claim narrowed to what they read better: areas that ended better when the loop finished a move, not ordinary tickets. The notebook's own correction of the morning's headline says it plainly: the claim "is about areas ending better when the loop finishes the move, not 'tasks on average leave it better'". The earlier recap had blurred the two [5].

And it kept happening. Later readers, who did not share the scorer's view, corrected the summary again. Seams & Tangles, in its eighth run, reads one area as worse: the catch-all, the set of library files no other area claims. It grew from 16 to 17 files when a tidy-first added the `stage-writes` module. Both blind passes read that change as better, and neither caught the catch-all [1, 7].

Drift & Coherence found the same kind of case in one mixed area. The loop removed a test-side copy of a template, but the live-console script now publishes a second surface that only the tests read [8]. My reading is that being corrected by readers who did not share the scorer's view is the method working, said plainly.

## Finishing, not adding

John's point about the size of a move, as the notebook records it, is the centre of the finding. Big moves come early, and a partial move should still trend the right way even when it does not move the whole stack [5]. The notebook calls this the Towers of Hanoi, after the puzzle, where the bigger discs are the moves that matter most. That is the notebook's phrase. It is not recorded as John's own name for the idea, so it is used here as an image only. My reading is that to move a feature cleanly you first move its tidy, and to move the tidy you first move its copies.

The ratchet is what makes a partial move hold. A helper with nothing holding it can drift back: the notebook records an approach that "stayed flat" while a fresh file wrote raw copies beside the helper. A count that may only fall keeps a smaller move from decaying [5]. The census is that count.

![Two panels. On the left, a new owner box sits beside three old copies that are still there, and the result is marked mixed. On the right, one owner box stands with the copies deleted, and the result is marked better.](figures/the-place-became-somebodys-job/owner-or-finishing.svg)

*Figure 4. A drawing, not data: the hypothesis from eleven cases. A new owner beside the copies it leaves running reads mixed; deleting the copies reads better.*

The evidence is eleven cases, each read in both passes. Six single changes that deleted or merged copies read better in both passes. Five that added code beside the old copies read mixed in both [1]. The check table names them.

The one better pair in the ordinary set was a consolidation. Its first change moved loop-terminal checks into one module, and its second shared one rule for where a run stops. What reads better is the move that gathers scattered decisions into one place, and the loop's finished moves are consolidations [1].

Figure 5 sets the finished moves beside that baseline. Nine area readings cover fifteen tickets, and all nine read better in both passes; no pass read one worse. Of four ordinary pairs of consecutive changes to the same files, from 20 October, one read better in both passes [1].

![Two groups of rows, each row with two cells, pass 1 and pass 2. The first group is nine finished-move area readings, all better in both passes. The second group is four ordinary pre-loop pairs: three mixed in both passes, and one, a consolidation that shared one stop rule, better in both.](figures/the-place-became-somebodys-job/area-readings-and-pairs.svg)

*Figure 5. Nine area readings over fifteen tickets, all better in both passes, beside four ordinary pre-loop pairs, one better in both. This is not loop against no loop [1, 2].*

One pair shows the difference. A shared fake DOM helper was added while seventeen hand-written copies were still outstanding, and it read mixed in both passes. Its follow-on tidied those copies, and the pair read better in both [1]. The first move left its copies. The second took them away.

## The person's seat

The scope call is where a person's judgement sits. The paper counts a scope call on 22 of the 68 tickets that touched the place [1]. Eight of them say that John asked Claude to take the human's role, with the wording "how much to tidy": "choose a large enough option", or "err on the side of larger tidies". Those eight calls were written by Claude on John's delegation [1]. A pre-work Survey is visible on 29 of the 68 [1].

Three cases show what can go wrong in that seat. A scope rule's wording invited a new copy: the notebook's table of place merges calls it "a new twin, invited by the ticket's own wording" [6]. A sweep was drawn by a method name, where the notebook says the line should be drawn by behaviour in any spelling [5]. A scope description became a false comment in the code [1].

John's reading, as the notebook records it, is that these are the mistakes one would expect when a person is holding the reins: "are what I'd expect to happen when you're holding the reins". That is why the points a person holds should move into Harbour as structure, so that agents working one ticket at a time do not need to supply judgement [5]. The human calls stay human: how big a move is, the rulings, and granting authority. On 6 November John approved the grant for the route that starts a Periodical run, and the notebook records it as "I grant you authority". It is the first time, the notebook says, that the authority grant was made explicitly as a human call [5].

## Three habits the record keeps

Three patterns come up in the notebook's cases, and they are what a structure would have to hold [5]. A sweep starts by writing its check: its hit list is the work list, and the check passing is what done means. Two builders reached this independently. A list kept by hand goes stale, and a list derived from the code does not. A change that replaced two hand-kept name lists with lists derived from each template read better in both passes [1]. And fix the fake; do not bend the production code to fit it. The one mixed area in Drift & Coherence run 5 is production code shaped for a test: `window.LiveConsoleLane`, a handle only the tests read [8].

The loop has a cost too. The median cost of the 68 place rows with an exact cost is $8.16 per row, the paper's own unit [1]. Three tidy-afters cost a share of their parent: $6.77 against $14.37, which is 47%; $7.82 against $11.94, which is 65%; and $7.18 against $8.41, which is 85%. Those are three pairs, so the paper gives a range, not a rate [1]. John's position, as the notebook records it: "Cost is measured, not optimised."

## What this doesn't show

The method is in the paper, not here.

- **The reading is circular.** The prompt that scored every change asks whether it added a copy and what it deleted. The tidy-after answers that question, and the same prompt judges its result. The Periodicals bear on direction without the prompt, but only over their own windows [7, 8].
- **The numbers are small.** There are nine area readings over fifteen tickets, four pairs, three cost pairs and eleven cases for the deletion finding. The pair baseline is four pairs from one day in one repository, and the other baseline is eight changes [1].
- **The gap is small.** A gap of a tenth between the baseline and the ordinary tickets is one row's sign, given counts of eight and nineteen. Neither this essay nor the paper leans on it [1].
- **The pairs are not untouched areas.** The record has no baseline for an area that nobody touched. That question is still open [1].
- **Seven merges have no Periodical reading.** They come after both Periodical windows: the merge that reached 6 on the census, the comment-paging fix, a line-anchor correction, and four non-place merges. The essay states them as facts about the code at their commits, not as judged better [1].
- **The census is a proxy.** It falls when a file leaves the list, not when the copies behind it go. It does not say the fakes are gone, and it does not see a surface added to production code for a test. Over the Drift & Coherence window the census fell from 25 to 10 while the crude grep rose from 46 to 51, so the two point in opposite directions [8, 9].
- **Nothing shows the gate read a stale review.** It could have read one before the paging fix. Nothing shows that it did [1].
- **The guard count is a crude match.** The essay does not claim that every removed check was wrong [7].
- **None of the four changes is a Periodical verdict.** They are read from the code at their commits. The Periodicals are the only readers with that standing [1].
- **One area stays read as worse.** Seams & Tangles run 8's reading of the catch-all is not withdrawn by the latest Seams run, which reads no area worse but leaves the catch-all unchanged at 17 files [7].
- **The seat is one case each.** Each of the three seat cases is one case, and none is measured. The record does not show who wrote the other fourteen of the 22 scope calls, and the scope call is absent on 46 of the 68 tickets that touched the place. The essay does not put these mistakes on John personally, because the record does not [1].
- **The Periodicals are the same kind of agent** as the code. They agree with each other on direction and disagree on one area [1].
- **The notebook is synced by hand.** This list kept by hand is going stale, and the essay names it without fixing it. It cites commits on main, so it does not depend on the next sync [4].

## Where this points

The record shows small, real, finished moves, each of which gathered scattered decisions or deleted copies and read better in both passes. The readings that do not share the scoring prompt agree on that direction, with the exceptions named above.

What it points to is the aim the prequel's trig point stands for, a surveyor's pillar on a hilltop: "a marble beacon on the top of a trig point, allowing us to finally leverage Harbour to bring codebases towards settled. Including our own" [3]. The prequel glosses it as the fixed point every change can be surveyed from, and read against: toward settled, or away. This essay takes it as the aim the readings point toward, not as a standing that the blind reads or the Periodicals already have.

My reading is that the loop was a shape of a different complexity from the pipeline's. It was the place across tickets, before, during and after, with areas, follow-ons and a ratchet that keeps a partial move from slipping back. While it was held, it held: the areas ended cleaner. It was held by hand, by John and Claude together, and in my reading that is why the hand's mistakes show in it. That is John's case for structure [5].

So the question is not whether the hand can stay. It is what holds the more complex shape, so that the hand can move without the shape dissolving. My reading is that Harbour does not yet hold that shape by itself, and the record does not show that it does. The record shows the shape held while the hand held it. Two things in the notebook point toward the next step, though neither is a result yet: the Survey as two stages, and the Periodical mint route, which starts a Periodical run by its registry id [5]. In my reading, the hand stops holding the shape and starts shaping it, through the human calls. John's explicit grant on 6 November is the picture of that step, as a human decision [5].

## Next

1. **The question is already on the proposals list.** The line beginning "Would a guard, or a list derived from the code" in `docs/papers/proposals.md` asks whether a guard, or a list derived from the code, at the scope call and at a sweep's name, would have stopped the copies the loop later removed. It is not filed again here.
2. **A Periodical run of its own** for the seven merges after both windows, before any essay cites them as judged.
3. **Not this essay.** The notebook's hand sync, and the code path that starts an agent session still deciding from text the browser posts. Both are left to their own tickets.

## Where to check

| The change, as the body describes it | Ticket | Commit | Source line |
|---|---|---|---|
| Census first count, 56 entries, 5 November 13:18Z | — | 69e8f1754 | `git/census-by-merge.json` |
| Census at 25, 5 November 19:02Z | — | af55cb73 | `git/census-by-merge.json` |
| Census reaches 6, all marked stop, 6 November 11:41Z | LIN-4312 | ce42e7217 | `tests/unit/fake-dom-census.test.js:52-59` |
| Stop marks first appear | LIN-4272 | 591bb9596 | `git/census-by-merge.json` |
| Shared fake DOM and its follow-on, with seventeen copies outstanding | LIN-4252, LIN-4255 | — | [1] |
| Method-presence guards removed (about fifty, crude count) | LIN-4292, LIN-4304 | — | [7] |
| Spelling rule and its check; allow-list empty | LIN-4304, LIN-4292 | f742e5ac | `tests/unit/public-element-method-guards.test.js:181` |
| Periodical grant rule in one function, 10:10 UTC on 6 November | LIN-4317 | f2816e17 | `lib/dispatch-entrance.js:1218` |
| Comment paging; read fails if it cannot read all; the ticket with 143 comments read in full after the deploy | LIN-4322, LIN-4150 | badec1fb | `lib/providers/linear/index.js:1169-1182` |
| Two hand-kept name lists derived from each template; stage-writes module added | LIN-4253 | — | [1] |
| Cost split per dispatch (read mixed in both passes) and its tidy-after (read better in both) | LIN-4263, LIN-4276 | — | [1] |
| Builder's account: loop-id-only row listed twice (after-answer, 5 November 14:48Z) | LIN-4276 | 473cc865 | `docs/plans/survey/log.md@1c894016:2132`, `docs/plans/survey/place-ledger.md@1c894016:162` |
| Six deleting changes read better in both passes | LIN-4253, LIN-4276, LIN-4277, LIN-4293, LIN-4296, LIN-4304 | — | [1] |
| Five adding changes read mixed in both passes | LIN-4246, LIN-4247, LIN-4248, LIN-4252, LIN-4263 | — | [1] |
| Cost pairs: 47%, 65%, 85% of their parents | LIN-4276/4263, LIN-4277/4251, LIN-4304/4292 | — | [1] |
| Consolidation pair (better in both passes) | LIN-3717, LIN-3722 | 8ddb0f3b | [1] |
| Scope-wording twin | LIN-4178 | — | `docs/plans/survey/place-ledger.md@1c894016:19` |
| Sweep drawn by a method name | LIN-4292 | — | `docs/plans/survey/log.md@1c894016:2389` |
| Scope description became a false comment | LIN-4255 | — | [1] |
| Line-anchor correction, a non-place merge after both windows | LIN-4254 | afe9074f | [1] |
| Notebook sync, the latest by hand | LIN-4332 | — | [4] |
| Session lane grant decided from browser-posted text | — | — | `docs/reviews/drift-coherence-review-2026-11-06.md@509f797e:73` |
| Survey as two stages (LIN-4248), and the Periodical mint route (LIN-4313) | LIN-4248, LIN-4313 | — | `docs/plans/survey/log.md@1c894016:1897, 2392` |
| John's explicit grant, approved on the ticket on 6 November | LIN-4313 | — | `docs/plans/survey/log.md@1c894016:2413` |
| Next 1's proposal line | — | — | `docs/papers/proposals.md:666` |

Figure 5's rows, top to bottom. Areas: run-end and repaint, then tidy (LIN-4247, LIN-4246, LIN-4293); preamble PR wording, then its tidy (LIN-4251, LIN-4277); test stand-in and its follow-on (LIN-4252, LIN-4255); the census move (LIN-4254); hand-written fakes onto the shared fake (LIN-4255); cost read and its tidy-after (LIN-4263, LIN-4276); guards removed and one spelling (LIN-4292, LIN-4304); fake DOM models select, suites moved (LIN-4296, LIN-4254); mint route, then one grant rule (LIN-4313, LIN-4317). Pairs: free-tier seam and urlKey registry (LIN-3706, LIN-3700); KPI trend charts and cost figure (LIN-3710, LIN-3714); loop-terminal checks and one stop rule (LIN-3717, LIN-3722); workspace KPI charts and PR times (LIN-3711, LIN-3713). Source: `cleaner-than-it-started-evidence/2026-11-06-v2/analysis.json`. Figures 3 and 4 are drawings with no data, generated by the same script as the others.

## Reading list

1. **Paper: *Can a task finish with the codebase cleaner than it started?*, version 2** (`docs/papers/harbour/cleaner-than-it-started.md@ea352306`). Supports every number in this essay, the findings, and the limits. Does not show the blind scores were checked by a second person; its own fresh readers checked the paper, not the scores.
2. **Evidence folder, version 2** (`docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06-v2/`). `analysis.json` gives Figure 5 and the pair readings; `git/census-by-merge.json` gives Figure 1. Supports the counts. Does not explain them: the readings are signs from a prompt, not an explanation of why a change read better.
3. ***Tasks are tasks, and the codebase is a place*, version 5** (`docs/papers/harbour/tasks-are-tasks.md@ea352306`). The prequel: the diagnosis, the forcefield, the ball, the passage, and the trig point at line 144, where it says this leads. Supports the account of the problem. Predates the loop, so it supports no result from the loop. The forcefield, the ball and the trig point are John's images.
4. **Notebook, afternoon of 5 November** (`docs/plans/survey/notes-2026-11-05.md@1c894016:126-160`). The loop as it ran, its rules, the table of blind reads on the day, and the cost line ("measured, not optimised"). Supports the description of the loop and John's words as the notebook records them. Does not supply evidence of effect. Its clock headings drift from git and comment times by up to about an hour and a half, so the essay cites git and comment times where it can.
5. **Notebook log, dated entries** (`docs/plans/survey/log.md@1c894016`). Lines 1966 to 2040 hold the Hanoi entry and the ratchet; line 2132 holds the builder's double-count note; 2389 is the sweep rule, 2413 the grant, 2419 the headline correction, and 2430 John's reins reading. Supports John's words as the notebook records them and the operator's own corrections. Its headings are unreliable; the essay cites the lines.
6. **Place ledger** (`docs/plans/survey/place-ledger.md@1c894016:19`). The scope-wording row, the one case the essay uses. Its counts are stale and the essay does not use them.
7. **Seams & Tangles, run 9** (`docs/reviews/seams-tangles-review-2026-11-06-run9.md@509f797e:9,13,109,152`). No area worse; the catch-all unchanged at 17; the guard count, which is a crude token match. Supports the Seams reading. Does not cover the merges after its window. It is a delta report.
8. **Drift & Coherence, run 5** (`docs/reviews/drift-coherence-review-2026-11-06.md@509f797e:15,17,47,73,238`). Better, small; the one mixed area; the grant rule; the open item on text the browser posts; the crude grep rising from 46 to 51. Supports those readings. Does not cover the merges after `5c63aa26`.
9. **Code at `ea352306`:** `tests/unit/fake-dom-census.test.js:52-59` (the census list); `tests/unit/public-element-method-guards.test.js:181` (the allow-list, empty); `lib/dispatch-entrance.js:1218` (the grant rule); `lib/providers/linear/index.js:1169-1182` (the comment read that fails when it cannot read everything). Supports the code facts as they stand at this commit. Does not show the code is correct; no reviewer read it for this essay.
10. **Kent Beck, on making the change easy before making the easy change**, quoted in [3]. A practitioner's rule of thumb from software practice, not an estimate. The essay uses it for the shape of the problem and not as evidence.
11. **Papers standard** (`docs/papers/standard.md@ea352306`). How an essay is written here. Its rule that an essay has no Limits section is not followed by this essay, as version 2 did not follow it; the PR asks the Library to decide.
12. **Blind-read prompt** (`docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06/prompts/blind-read-prompt.md@ea352306`, from version 1's folder). The prompt that scored every change in this essay. It asks each change whether it added a copy and what it deleted. Supports the limit the essay names. Read it before weighing any sign in Figure 5.
13. **Hedge ledger, version 2** (the description of pull request #2341). Each limit of version 2 and its disposition. This essay's limits section takes its contract from it.
