# The Survey: tidying first, and bringing codebases toward settled

*Working document, started 2 November 2026 by John Kershaw and Claude. It records what we know, what we think, and the spikes we plan. It is updated as the spikes run, and it is a reference, not a spec.*

> **Where it stands (5 November).** The spikes below have run, and the Survey has grown into a loop: two read-only voices before work (open-0 for the task, a code-only global for the place), a scope call by the person, the build, and a place reading plus the builder's after-questions at merge. Over 4–5 November the place ledger went from 1 better / 1 mixed / 3 neutral / 4 worse (the baseline) to 17 better / 3 mixed / 1 neutral / 0 worse through the loop. The current picture is `survey/notes-2026-11-05.md`; the record is `survey/log.md`, `survey/place-ledger.md` and `survey/broad-options.md`; the prompts are `survey/prompt.md`. The next step is moving the two Survey voices into Harbour as stages that are triggered by hand. The rest of this document is the plan as it was written, kept for reference: its menu-based Survey was replaced by the open question, and its "What it reads" by the code alone.

## Why this exists

Harbour runs coding agents over tickets, and it does the ticket well: requests survive, and about 95% of asks are delivered as written. But a codebase is a place, and nobody lives in it. Each stage answers to its ticket, so the condition of the code that tickets land in belongs to no one. The code only grows: since 1 September there have been 965 commits and +78,900 lines, and about 100 of those commits shrink the code, nearly all of them from tickets whose job was removal. Every later change pays to push through what the earlier ones left.

The aim is to have Harbour bring codebases **toward settled**, its own included. Settled is a balance, not smallness: the code's size tracks what the product does rather than its history. John's image for it is a marble beacon on a trig point. It is not a destination. It is the fixed point every change is surveyed from, and a change moves the place either toward settled or away from it.

The long argument is the essay `docs/papers/harbour/tasks-are-tasks.md` (v5, LIN-4149, merged 2 November). The evidence behind it is `docs/reviews/_evidence-2026-11-02-ticket-intent/investigation-notes.md`. A handoff for continuing the discussion is in the same folder.

## What we know (from the record)

**The pipeline is faithful to the ticket.**
- 94% of requests survive word for word.
- A coverage check of 254 tickets found 94.7% of asks delivered.
- About 1 ticket in 9 was reduced without a human decision, with no detectable difference between open and concrete asks.
- The problem isn't a leaky stage.

**Friction is noticed and left.**
- In about three-quarters of 256 comment threads, agents record friction they saw and left alone.
- "Improvement noticed, not required" appears 158 times.
- The builder is the one hand in contact with where a change binds, and its signal is written down with nowhere to collect.

**The code's side (Library shelf):**
- **`steady-base`.** The code and prompts only grow, fastest at the gates. Fixes land as prose, and 5 of 101 citations ever left the prompts.
- **`coherence-as-it-grows`.** What grows is the number of places holding one decision. 45% of escaped defects trace to an unreconciled decision (27% among those found by use). A change that touches such a decision is 5× the size and sent back 2.5× as often. "Deletion finishes"; review-and-file, parity tests and helper extraction don't.
- **`consolidate-then-rebuild`.** On 17 October, eight Theseus tickets all merged, with zero behaviour differences on replay. They cost John two ruling presses.

**What was tried before:**
- **Periodicals (16).** They are inspectors outside the timeline of tasks: they report, mint tickets and leave. The weekly cadence is "a fallback floor, not a trigger", so Drift & Coherence hasn't run since 23 October.
- **Passages' maintenance leg.** It budgeted for running the inspectors. John: it missed the point.
- **The Surface Assessment.** It started in June as "would a refactor make this land better?" (LIN-192), misfired on LIN-391 by inventing a seam nothing called, and was turned to serve the ticket (LIN-397, a necessity gate). The June misfire added structure; what worked in October removed it.
- **Adopt-on-next-touch.** It was tried, and adoption stayed flat: a new file imported the shared helpers *and* wrote eight raw copies beside them.

**The resident has existed.** For 16 days, 11 to 26 October, one operator session worked with John across four episodes: the coherence loop (LIN-3449), Theseus rounds 1 to 3, the improvement cycles (LIN-3613), and the charter's Theseus loop (LIN-3490). It did the resident's work and survived two compactions. It ended when the frame moved. Continuity of *method* is largely solved (the code-shape kit, the census, the runbook). Continuity of *standing* is not.

**The two live streams John is holding by hand:**
- **Costs (LIN-3936).** A record ticket works as the area's notebook. It holds the goal: "the only behaviour to preserve is the outcome". The work goes one tidy at a time toward a Theseus rebuild. After each tidy, two questions are asked: did the area get cleaner, and what did the ticket get wrong? A "bar for a Costs ticket" is revised from evidence, and its lines mostly grant freedom or remove things.
- **UI round 3 (LIN-4040), as of 3 November:**
  - Five planned groups became 17 tickets. Every extra level was a prerequisite the run discovered mid-flight. Each one was defensible, but together they were slow.
  - A piece took 80 to 256 minutes, and the slow ones were mostly fighting the unreliable local browser-test run.
  - The code is tidier where it was aimed (task state has one owner and one set of facts) but not overall. `lib` grew about 1,900 lines and the unit tests about 13,000. New modules were added beside old ones more often than old ones were removed.

  This is tidy-first happening reactively, one discovery at a time. It settles where it is aimed and relocates mass everywhere else. It is the before-picture for Spike 1c.
- **Costs tidy 5 (LIN-4147, merged as `46b43b3b`, 3 November):**
  - It fixed a live bug with no plan-review rounds. One lineage had been counted under both LIN-4114 and LIN-4139; about $49.50 left those issues. A sweep found 0 lineages under more than one issue.
  - Its one miss shows the monkey's paw. It was guarded on one side ("never under two issues") but not the other ("every issue still gets a figure"), and afterwards 114 of 198 issues showed no lineage, unchecked against before. The bar gained "no issue loses a figure unless named".
  - It also filed LIN-4148, a real bug, despite a buried "list, don't file".
  - Three of its four product defaults (wakes count under the lineage's issue; no issue means nowhere; a lane counts under its anchor) wait on the per-request ledger. Until then, per-issue cost undercounts work done through autopilot's child tickets, so cost per area or per lineage is the usable money view for the spikes.
  - Rebuild 1, one cost read for seven surfaces in one PR, is drafted. A checker reshaped it against spiralling: it now lists the surfaces and defines "right". That is a forecast acting on the ticket.

**Tidy where the change binds (charter retro, essay v5).** Between 23 and 26 October the charter's tidy moves were clean: `routes/workspace-api.js` went from 3,782 lines to 882, and `routes/dashboard.js` from 3,072 to 872. Yet `routes/` grew overall, the Settings consolidation was copied back out within a day, and `public/prompt-section.js` grew from 1,479 lines to 2,302 while copying rules the server holds. The tidy reached the server while the changes bound in the browser. So the Survey's question is not "what is messy?" but "where does *this* change bind?"

**Authority already exists, up to the cause (essay v5).** Since 4 October, Scope and Authority lines in every building and judging stage's prompt say "its cause is part of the work, wherever it lives". Friction that isn't this task's cause stays out by design. The Survey is about that friction.

**Cost is the incentive.**
- A tidier codebase is cheaper because there is less to do. In Harbour a task takes hours, against minutes in a simple project.
- The payback depends on traffic: a tidy pays every time its area changes again, so hotspots come first, and untouched mess costs little.
- The saving is spread out and counterfactual, which is why it only shows in motion.
- **The honest version (essay v5).** The record prices size and send-backs: 229 production lines at the median against 45, and send-backs of 0.56 against 0.23. *Within a size band* those changes take no more working hours and escape no more often. "The size *is* the cost", and the measure is partly circular. No trend in the cost of a same-sized change has been shown yet. That is what the Costs meter should eventually show.
- The Costs stream is building the meter: every model call counted once, under the issue its work was for.

## What we think (the concept)

- **The forcefield (John).** His attention holds the shape of the work, the way a hand holds a forcefield in a film. When the hand moves, the shape dissolves. Harbour in operation is the projector, and the shape is best seen in motion and zoomed out, not as stills. The hand turns out to be mostly *continuity*, plus compensating for the pipeline's reading habits. Two parts are genuinely John's: a goal that outranks the implementation, and taste about whether the code has settled.
- **The drill and the chisel** (from a separate conversation, with Claude on Fable 5.1). Agents are drills: all force, pointed by a ticket, powering through friction. A chisel reads friction as information. "The mess isn't the waste. The thrown-away signal about the mess is."
- **The material is the memory** (the same conversation). Code kept legible holds what *is*; that is what "textbook style" is for. A small notebook kept with the area holds where we're going and how to move. The ticket keeps only what was done. Understanding persists; the hands stay finite.
- **The ball (John).** A task is a point inside a ball, and the layers around it are the code its diff has to push through. Tidying first shrinks the radius. If every task leaves the code tidier, it tends toward settled.
- **The TDD switch (John).** Forecast, then prepare. It is more work and the wrong order, and it pays inside the same ticket. Beck's *Tidy First?* asks the same question, and the question mark is the forecast.
- **The spine and its offshoot (John).**
  - The pipeline is the spine.
  - **The Survey** is an offshoot before the task.
  - **Periodicals** track the place over time, show where it stands now, and do preventive tidying when idle.
  - Drilling is always allowed: "you can always just drill."

## The Survey

**What it is.** Before a task starts, the Survey asks **"why is this difficult?"** "Why" names causes, not effort: pinning tests, a decision held in nine places, callers that keep a seam in place. Causes are facts you can act on, whereas Theseus's own predictions were weakest on effort.

**What it returns.** A menu, in sizes, and each option says what it buys *this* task (for example, "the change drops from about 14 files to 4") and what it costs:
1. **Just drill.** It's often right: narrow tickets land fine even in tangled code. It must always be on the menu.
2. **A small tidy**, in Beck's sense: minutes, and reversible. Small in scope but complete: if it gathers anything, the copies are deleted in the same change. A helper extracted beside its copies is adopt-on-next-touch under a new name. Small is fine; partial isn't.
3. **Consolidate the decision this task touches.** One authority, with the copies deleted in the same change.
4. **Theseus the area.** Free the seam, consolidate, rebuild.

**What it reads:**
- the task;
- the code at the base commit;
- the periodicals' maps (Seams & Tangles knots, change coupling, the coherence census);
- the area's notebook.

**How the choice is made.** The Survey recommends; small options just proceed; John is asked only when the large option is recommended. The ruling card with the recommended answer as its main button (LIN-4114) is the natural surface for that.

**Asked twice.** The Survey asks before the task. The builder answers the same question after merge, when nothing is at stake. The Survey doesn't need to be right; it needs to be wrong in a way the after-answer can show. The pairs over time are the area's film, without a viewer.

**Who compares the pairs.** Pairs don't teach anything just by existing. Whoever runs the spikes owns the comparison: John, with Claude or the operator doing the reading. Each comparison ends in a line taken *out* of the Survey's prompt where the after-answers keep contradicting it, or "none, and why". This is Costs' "what did the ticket get wrong? → revise the bar" rhythm. Without it, the pairs become one more report and the Survey grows like every other gate. Removing lines is the smallest part of John's hand that can't yet be lowered.

**Its ancestor** is the Surface Assessment, a verdict grown into a menu.

**Its limits:**
- **It advises; it doesn't gate.** Asked as a gate, it is a judgement question on a broad ask, which is the recipe for plan-review spirals. Use a single pass with no review loop on the menu.
- **Pull, not push.** It acts in proportion to this task's difficulty, never as "anything could be better".

**Periodicals in this design** stop minting tickets into the queue. They become:
- the place's film: trend over time, and where it stands now;
- the Survey's map;
- the idle-time chisel. *Correction from essay v5:* autopilot's order is "a goal a person has set, else a periodical reading `due`, else the top of the stack", so a due periodical runs *ahead* of real tasks, not in idle time. A tidying move given that rank would be pushed, not pulled. The rank that fits pull is a new one *under* the stack: no goal set, nothing due, nothing waiting. The order has no such rank today.

**What else it implies:**
- **Review** must expect "made the change easy, then made the easy change" as the normal shape of a PR, or it reads the tidy as creep.
- **The pipeline's prompts** are themselves a place nobody lives in. They grew five- to sixfold until October. Since 2 October every prompt surface has been frozen at its byte size. In the first week the total fell from 568,534 bytes to 342,621, through real removals (LIN-3300 deleted the meta-prompt; LIN-3326 shed gates). Since 6 October the freeze has *held* the prompts rather than lightened them, and the total is back to 332,910 after a new surface on 1 November (essay v5). Theseus for the prompts would lighten every stage, and every prompt habit it removes is a line the Costs bar can drop.

## Spikes

These are small, read-only first, and judged by looking. Each spike's result is noted here. **Spike 2 is the verdict; spikes 1 and 3 are calibration.** Agents explain known outcomes beautifully, and builders defend their detours, so only a forecast made before the clay is touched tests the Survey's claim. That forecast is exactly where the Surface Assessment stood when it misfired. If the Survey only explains afterwards, it is a good reviewer, not a surveyor.

**Spike 0: can we ask a finished session?**
- simple-dispatcher supports follow-up resume (`claude --resume`, `RESUMING → EXECUTING → COMPLETED`; `docs/session-lifecycle.md`).
- Confirm that a session completed hours ago can be resumed through Harbour with a question, and that its answer can be captured.
- Fallback: a fresh session reads the ticket's record and diff and answers as that builder. That is weaker evidence.
- *Partly answered by essay v5's research:* a follow-up reaches a session only while the runner still holds it, so older sessions may be gone, and sending one needs the `dispatch` grant (John's or an operator's). Still to confirm: how long the runner holds a session.

**Spike 1: retrospective survey of UI round 3.**
- Tickets LIN-4117 to LIN-4145: fresh sessions, a well-mapped area, known outcomes.
- **1a.** Ask each builder and researcher "why was this difficult, and what would you have done first?" *before* showing them any data.
- **1b.** Compare their answers with the tangle data (Seams & Tangles, change coupling, census).
- **1c.** Run a Survey at S3's base commit, with no access to anything after it (no later tickets, commits or notes), and see whether it would have predicted the 17 tickets and their prerequisites.
- **Judged by:** whether it names the tangles that actually cost the work, and whether it says "just drill" where the work really was fine.

**Spike 2: forward survey on S4 (LIN-4106).**
- S4 and S5 are on hold as of 3 November.
- Survey S4 before it starts: its "why is this difficult?" and its menu. Then let S4 run, unchanged or with a chosen option, and compare.
- It is the only spike where the Survey has to predict rather than explain.

**Spike 3: historical backtest.**
- Use about ten past tickets that touched a known scattered decision and five that didn't, from June to 8 October, each at its base commit and blind to what came after.
- The coherence census is the answer key (`docs/papers/harbour/coherence-as-it-grows-census.json` `knownDecisions`/`twins`, `-exposure.json` `perPr`).
- The Survey finds the prize only if it names a decision that later caused an escaped defect. The clean tickets check that it stays quiet.

**Independent of the Survey, and cheap:** change review's expectation so that "made the change easy, then made the easy change" is the normal shape of a PR. It is the one change that lets any tidy survive review. It is a prompt change, so it goes through the prompt-size budget with its reason recorded.

**Later, once the Survey earns it:**
- move the Costs notebook into the repo beside its design note;
- add an idle rank under the stack (no goal, nothing due, nothing waiting) that takes one tidying move from that notebook;
- widen the builder's permission (find what touches, put it together in its own commit, then cut), then watch one live move;
- Theseus for the prompts.

Then: just run tasks, tidy as we go, and measure, with cost per lineage over time as the money view.

**Run the periodicals when the current round of work ends,** so there is a fresh map for the spikes.

## Cautions

- **Build no new nouns.** No viewer, no notebook as a new ticket type, no periodical inspecting notebooks. That is the accretion reflex in a new coat.
- **Taste travels by example.** "Textbook style" is a taste, carried by worked examples (Theseus's experiments), not prompt rules.
- **One area first.** Generalise only when the hand feels lighter there.
- **Independent hands.** Ask builders before they see each other's answers or the data, or their agreement is echo, not evidence.
- **Builders defend their detours,** even after merge. Read their answers with that in mind.
- **Push versus pull.** A step loyal to the place finds something on every task unless it answers to a need: the June misfire.
- **A new step is a new gate, and gates are where prose collects.** Keep the Survey out of the review loop.

## Open questions

- How much of John's hand is structure Harbour can hold, and how much is attention that needs a resident?
- Where does each area's notebook live, and who writes to it?
- How should the forecast weigh traffic (hotspots) against tangle?
- How do we see the place in motion without building a viewer? The notes and the film may be enough.
- Name: "Survey" is the current choice.

## Working rules

- Research and writing go through Harbour tickets and autopilot.
- File tickets only when John asks.
- Judge by looking; don't build rating schemes.
- Write tickets at the level of the idea.
