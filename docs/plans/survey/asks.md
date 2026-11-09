# Asks from the discussion (drafts, 9 Nov)

Each ask comes from a decision in `discussion.md`. Each is read back to John word for word, approved, then filed through Harbour, whose code seals the description as the ask. They say what and why, never how. Batch 1 runs until the switch; batch 2 is filed now but waits for the switch.

Every ask ends with the same line: **Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

---

## Batch 1: until the switch

### A1. No new mess before merge (D8)

**Title:** A change is read blind before it merges, and what the read finds is fixed while the work is fresh

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Harbour's goal is simple code. On average a task should leave the code a little better, and never worse. John: "Harbour should converge work, even if slowly, and resist spiralling out and generating more work (unless it's tidying up)." "No new mess" is the first of the five measures we read. Today the blind read that says whether a change left its area better or worse happens by hand, after merge, once the work has moved on.

**What we want.** Before a change merges, its area is read cold by someone who didn't write it, saying whether the area is better, the same or worse, and why. What the read finds inside the change's area is fixed before merge, while the work is fresh. Finds outside the area follow the leftover rule.

**Done when** every change that merges has had a blind read before merge, its findings are fixed on the branch or homed by the leftover rule, and the read can be seen on the task.

### A2. Waiting moves into code (D8, D19)

**Title:** Waiting is done by code: a quiet check-in costs no model call, and a stalled wait is noticed

**Repository:** JKershaw/LinearViewer (Harbour), and JKershaw/simple-dispatcher if the change needs it.

**What this is for.** While a task runs, its driving session wakes to check on its workers. In the session papers, 97% of "still waiting" wakes changed nothing, and they were 35% of all wakes, each one a model call. In round 1 an orchestrator waited about an hour without noticing that its worker had already ended, and it was noticed by hand. Noticing stalls is one of the hand jobs that stand between us and Harbour carrying the loop by itself.

**What we want.** When nothing has changed, finding that out takes no model call. A wait that has stalled (its worker ended, or nothing has moved for too long) is noticed and shown, not left.

**Done when** a quiet check-in costs no model call, a stall like round 1's hour-long wait is noticed within minutes and shows on the task, and the change names what it retires.

### A3. Periodical reviews skip the Surveys (D7)

**Title:** A Periodical's review ticket doesn't run the Surveys

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Every fresh task starts with two Surveys, one on the task and one on the place. For tasks that change code they have earned their keep. John: "whilst it's tempted to do a single review, we did find benefits from two." A Periodical's own review ticket changes no code, yet runs both today. John: "Happy to skip for periodicals though."

**What we want.** A Periodical's review ticket goes to its work without the Surveys. Every other task keeps both.

**Done when** a minted Periodical's review ticket runs without the Surveys, and other tasks still get both.

### A4. The Stability Review leads with the five measures, per piece of work (D16)

**Title:** The Stability Review opens with the five measures, per piece of work rather than per week

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** We read five measures, in this order when they clash:
1. no new mess (ordinary tickets read neutral or better in a blind read);
2. the curve (net production lines);
3. speed (time and sessions per ticket);
4. the person's seat (questions that were really theirs, and runs that needed no operator);
5. cost per finished task.

The Stability Review already runs as a Periodical. John: "weekly is sort of the wrong cadence as it's based on how much happened."

**What we want.** The Stability Review opens with those five measures in that order, each per landing or per task rather than per day or week, so a reading means the same however busy the period was. Net production lines lead, with code and comments counted apart, so trimming comments can't flatter the curve. The 8 November figures in `docs/plans/survey/discussion.md` (Baseline) are the starting point.

**Done when** the next Stability Review opens with the five measures in order, per piece of work, with code and comments apart, set against the 8 November baseline.

### A5. Find what matters in the open backlog (D11)

**Title:** Find the open tickets that describe something broken, blocking or unsafe, so nothing important is lost

**Repository:** JKershaw/LinearViewer (Harbour) and JKershaw/simple-dispatcher (their tickets share one Linear team).

**What this is for.** There are about 1,358 open tickets, two-thirds of them older than five weeks. John: "A large backlog isn't actually a problem as long as we're not losing important things in the mix. A lot of it can be consolidated, or will be overtaken/made redundant. Trying to figure it all out in advance will be a fool's errand, but tackled in chunks will likely help." This is the one pass over everything. The rest is sorted in chunks alongside the work.

**What we want.** One pass over every open ticket that finds those describing something broken, something blocking work, or something touching safety (security or authority included), and says for each whether it still looks true. Nothing is closed, moved or changed in this pass.

**Done when** this ticket carries the list, grouped by what each ticket affects, with each marked still true, no longer true or unsure, and no other ticket has been touched.

### A6. Outside-area finds go to the area's note (D3)

**Title:** What a change spots outside its own area goes into that area's note, not a new ticket

**Repository:** JKershaw/LinearViewer (Harbour), and JKershaw/simple-dispatcher where its notes say the same.

**What this is for.** Harbour's leftover rule files a follow-up ticket for anything a change spots outside its own area. Each landing mints about 1.4 tickets, and this is one reason the backlog grows when we want it to converge. John: "Good to know, not necessarily for now. Reduces a spiral out, especially on large codebases. Larger sweeps and specific tidy ups outside of tasks can still happen." On Jira, Harbour can't create tickets yet, but area notes live in the repo.

**What we want.** A find outside the change's area becomes a Waiting entry in that area's own note. It becomes a ticket only if it breaks something, blocks work or touches safety. Each item still has one home, never both.

**Done when** the rule says so everywhere Harbour states it, and the next close-out with an outside-area find writes a note, not a ticket, unless the find breaks, blocks or touches safety.

### Go-aheads (no new ticket)

- **G1.** Kick off LIN-4390 (Periodical prompts grant merge authority the review gate withholds) and LIN-4392 (a second stage can start beside a live one), as defects, on Opus.
- **G2.** Start Drift & Coherence and Seams & Tangles now over round 1's window (7–9 Nov), as the coherence baseline.

---

## Batch 2: filed now, waiting for the switch

### A7. The loop works on Jira (D1, D10)

**Title:** The loop works on Jira: Harbour can create Jira issues and hold the sealed ask

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** The first outside test will be a small team on Jira who already use agents and want agents building their product. John has used Harbour on Jira for a few weeks: "it's mostly fine except for the gaps that you've identified." The gaps:
- Harbour can't create a Jira issue, so on Jira the loop can't file a sealed task, mint a Periodical or file what close-out files;
- Jira can't yet hold the sealed As asked block (LIN-4355);
- the ticket walk only knows `LIN-` identifiers (LIN-2805).

**What we want.** On a Jira-backed workspace, the loop does what it does on Linear: a task can be filed with the person's words sealed, a Periodical can be minted, and close-out can file what it files. It's checked on John's own Jira, which is already in real use.

**Done when** on John's Jira a task filed through Harbour carries its sealed ask, a Periodical mints, close-out can file, and the ticket walk shows Jira keys.

### A8. The front end, left better than we found it (D10, D13)

**Title:** The front end, left better than we found it: browser code that shares rather than restates, in small slices

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** John: the UI is "mostly the original ones and are due a bit of a sprinkling. But! The front end code is messy." His gut: "the UI issues trace back to one of my very first rules: no build step… it's the biggest target of the Theseus method… We don't need to tidy it all, but it's a perfect example where we can leave it better than we found it."

On main (9 Nov):
- no browser file imports another;
- pages share through 66 globals on `window`;
- nine browser files restate server logic, with seven parity tests keeping the copies in step;
- the largest browser file is 5,019 lines.

On the views, John: "Lots of light little views is ideal, but the cost of them has to be balanced… I'd be sad to get rid, but happy to tidy."

**What we want.**
- Browser code that shares rather than restates. There's still no build step and no framework: the rule stays, read as allowing the browser to import, as browsers do natively, and that reading goes into the project's own notes.
- Taken in small slices, one view or one shared piece at a time. Each view is moved only after finding out why it got so large, and comes out lighter.
- The side rail and the sprinkling sit on the cleaner frame.
- No view is retired unless John rules it.

John expects agents to reach for big moves here: "very likely to get agents trying really hard to do big things when we want small." So the size is John's call, and for this work it's small.

**Done when** the reading of the rule is in the project's notes, and the first slice has landed: one view or shared piece now shares rather than restates, it's lighter than before, it names what it retired, and the next slices are listed in the front-end area's note.

### A9. How much tidying a task does is a question (D6)

**Title:** How much tidying a task does is a question, answered by the person or by the default

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** John, 4 Nov: "a task is chosen, surveyed, and the user decides how much to tidy up." On 8 Nov, about the setting since removed: it "makes zero sense for someone who doesn't know specifics of how Harbour works"; "a default option for hands off operation is fine"; "we'll give users a per task breakdown of options to choose from." On 9 Nov: "I imagined a page a little like the rulings page, as that's our q&a feature really. Sometimes a driving agent will rule, sometimes it'll go to a human… We want to avoid building out some big complex system, and this could simply use rulings? Settings provides a nice few options, allowing users to always be asked, or follow some default." And the removed setting "wasn't wrong per se, just unusable".

**What we want.**
- The size of a task is a ruling: how much tidying on this task, with the sizes as options, a rough cost for each from the Survey, and a recommended pick that leans larger. It shows wherever rulings show.
- A setting chooses who answers: ask me, or let the driving agent decide with the default.
- Even on "ask me", the question comes only when there's a real choice. A small, clear task stays just the task.
- The setting makes sense to a new user who doesn't know how Harbour works.

**Done when**
- on "ask me", a task with a real size choice puts the question, with options and rough costs, where rulings show, and the answer becomes the task's size;
- on the default, the driving agent decides and the task says so;
- the setting reads plainly to a newcomer.
