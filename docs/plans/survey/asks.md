# Asks from the discussion (drafts, 9 Nov)

Each ask comes from a decision in `discussion.md`. Each is read back to John word for word, approved, then filed through Harbour, whose code seals the description as the ask. They say what and why, never how. Batch 1 runs until the switch; batch 2 is filed now but waits for the switch.

A parrot check (a sub-agent, 9 Nov) read the first drafts against the decisions and John's quoted words. Its fixes are applied here. The one quote it couldn't find in the written record (A1's) is John's, verbatim, from this session's conversation during round 1.

---

## Batch 1: until the switch

**Approved word for word by John on 10 Nov** ("Those all look good"). **Filed 10 Nov, about 07:40 UTC,** each sealed by Harbour: A1 LIN-4396, A2 LIN-4397, A3 LIN-4398, A4 LIN-4399, A5 LIN-4400, A6 LIN-4401. G1 and G2 started the same morning (see `log.md`).

### A1. No new mess before merge (D8)

**Title:** A change is read blind before it merges, and what the read finds is fixed while the work is fresh

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Harbour's goal is simple code. On average a task should leave the code a little better, and never worse. John: "Harbour should converge work, even if slowly, and resist spiralling out and generating more work (unless it's tidying up)." "No new mess" is the first of the five measures we read. Today the blind read that says whether a change left its area better or worse happens by hand, after merge, once the work has moved on.

**What we want.** Before a change merges, its area is read cold by someone who didn't write it, saying whether the area is better, the same or worse, and why. What the read finds inside the change's area is fixed before merge, while the work is fresh. Finds outside the area follow the leftover rule.

**Done when** every change that merges has had a blind read before merge, its findings are fixed before merge or homed by the leftover rule, and the read can be seen on the task.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A2. A quiet check-in costs no model call, and a stall is noticed (D8, D19)

**Title:** A quiet check-in costs no model call, and a stalled wait is noticed

**Repository:** JKershaw/LinearViewer (Harbour), and JKershaw/simple-dispatcher if the change needs it.

**What this is for.** While a task runs, its driving session wakes to check on its workers. In September's session records, 97% of "still waiting" wakes changed nothing, and they were 35% of all wakes, each one a model call. In round 1 an orchestrator went about an hour without noticing that its worker had ended. Only a blunt failsafe re-ask woke it. Noticing stalls is one of the hand jobs that stand between us and Harbour carrying the loop by itself.

**What we want.** When nothing has changed, finding that out takes no model call. A wait that has stalled (its worker ended, or nothing has moved for too long) is noticed promptly and raises an alarm a person sees.

**Done when** a quiet check-in costs no model call, and a stall like round 1's hour-long wait is noticed promptly and raises an alarm a person sees.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A3. Periodical reviews skip the Surveys (D7)

**Title:** A Periodical's review ticket doesn't run the Surveys

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Every fresh task starts with two Surveys, one on the task and one on the place. For tasks that change code they have earned their keep. John: "whilst it's tempted to do a single review, we did find benefits from two." A Periodical's own review ticket changes no code, yet runs both today. John: "Happy to skip for periodicals though."

**What we want.** A Periodical's review ticket goes to its work without the Surveys. Every other task keeps both.

**Done when** a minted Periodical's review ticket runs without the Surveys, and other tasks still get both.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A4. The Stability Review leads with the five measures, per piece of work (D16)

**Title:** The Stability Review opens with the five measures, per piece of work rather than per week

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** We read five measures, in this order when they clash:
1. no new mess (ordinary tickets read neutral or better in a blind read);
2. the curve: net production lines, with deletions per addition, CI time, Waiting entries in the area notes, and tickets minted per landing beside it;
3. speed (time and sessions per ticket);
4. the person's seat (questions that were really theirs, and runs that needed no operator);
5. cost per finished task, measured but not optimised for now.

The Stability Review already runs as a Periodical. John: "weekly is sort of the wrong cadence as it's based on how much happened."

**What we want.** The Stability Review opens with those five measures in that order, each per landing or per task rather than per day or week, so a reading means the same however busy the period was. Net production lines lead, with code and comments counted apart, so we can see whether the share of comment-only lines falls. No new scheduling: the review runs as Periodicals already do.

**The starting point (8 November):**
- net source growth +1.56k lines a day (about 2,390 added, 830 deleted);
- 0.35 lines deleted per line added;
- production JavaScript 206,782 lines; by the area registry's count (207,338 lines), 82,154 are comment-only;
- CI median 8.55 minutes;
- 66 Waiting entries (56 Harbour, 10 runner);
- 1.43 tickets minted per landing;
- round 1 cost about $24 a ticket;
- one task (LIN-4393): 8 sessions, $14.94, 54 minutes from first Survey to merge.

**Done when** the next Stability Review opens with the five measures in order, per piece of work, with code and comments apart, set against the 8 November starting point.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A5. Find what matters in the open backlog (D11)

**Title:** Find the open tickets that describe something broken, blocking or unsafe, so nothing important is lost

**Repository:** JKershaw/LinearViewer (Harbour) and JKershaw/simple-dispatcher (their tickets share one Linear team).

**What this is for.** There are about 1,358 open tickets, two-thirds of them older than five weeks. John: "A large backlog isn't actually a problem as long as we're not losing important things in the mix. A lot of it can be consolidated, or will be overtaken/made redundant. Trying to figure it all out in advance will be a fool's errand [typed "a good errand"; John confirmed the reading], but tackled in chunks will likely help." This is the one pass over everything. The rest is sorted in chunks alongside the work.

**What we want.** One pass over every open ticket that finds those describing something broken, something blocking work, or something touching safety (security or authority included), noting for each whether it still looks true. Nothing is closed, moved or changed in this pass.

**Done when** this ticket carries the list, noting for each whether it still looks true, and no other ticket has been touched.

**Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A6. Outside-area finds go to the area's note (D3)

**Title:** What a change spots outside its own area goes into that area's note, not a new ticket

**Repository:** JKershaw/LinearViewer (Harbour), and JKershaw/simple-dispatcher where its notes say the same.

**What this is for.** Harbour's leftover rule files a follow-up ticket for anything a change spots outside its own area. Each landing mints about 1.4 tickets, and this is one reason the backlog grows when we want it to converge. John: "Good to know, not necessarily for now. Reduces a spiral out, especially on large codebases. Larger sweeps and specific tidy ups outside of tasks can still happen." On Jira, Harbour can't create tickets yet, but area notes live in the repo.

**What we want.** A find outside the change's area becomes a Waiting entry in that area's own note. It becomes a ticket only if it breaks something, blocks work or touches safety. Each item still has one home, never both.

**Done when** the rule says so everywhere Harbour states it, and the next close-out with an outside-area find writes a note, not a ticket, unless the find breaks, blocks or touches safety.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### Added 11 Nov: A10 and A11

**Approved word for word by John on 11 Nov** ("And this all looks great to me."). **Filed 11 Nov, about 21:40 UTC,** sealed by Harbour: A10 LIN-4414, A11 LIN-4415. LIN-4415 kicked off at 21:42 with the usual goal. A10 runs first in lane 1 on Thursday, before A6.

### A10. Waiting work in an area gets done, and its lessons stay short (D3, D8, D12)

**Title:** An area's waiting work gets done over time instead of being cut to make room, and its lessons stay short

**Repository:** JKershaw/LinearViewer (Harbour), and JKershaw/simple-dispatcher where its notes say the same.

**What this is for.** Each area of the code has a note in two parts: Lessons, read before every change in the area, and Waiting, work known there but not scheduled. A note has a size cap so it stays short enough to read before every change. The three busiest notes are at or near the cap, and most of each is Waiting. A Waiting entry leaves when a change happens to settle it, when a ticket is filed for it, or when it is cut down to make room, so detail is being squeezed out of entries that are still true. A6 will send more finds into these notes. John: "Harbour should converge work, even if slowly, and resist spiralling out and generating more work (unless it's tidying up)." On the notes: "I'd be happy to address the notes issue potentially next."

**What we want.** Lessons stay short enough to read before every change. Waiting work is not squeezed or cut to make room. And waiting work gets done: over time an area's waiting list shrinks, as tidying.

**Done when** no note loses a still-true entry, or its detail, to fit; each note's Lessons stay within today's size limit; and the next changes in a busy area do some of its waiting work, so its list shrinks without entries being dropped or turned into tickets.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A11. A finished task doesn't start a Periodical by default (D7)

**Title:** A finished task no longer starts a Periodical by default; Periodicals run when chosen

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** When a run scoped to one task merges it, the run then starts one Periodical, if any is due or has had work merged in its repo since it last ran. There are 15 Periodicals that read a repo, so that is nearly always, and each task brought one. On 10 Nov these came to about $101, a quarter of the day's spend, and none changed code. John: "we probably don't need a periodical every time by default?" and "I very much agree."

**What we want.** A finished task doesn't start a Periodical unless it was asked to. Periodicals still run when chosen: by a person, or by a goal that asks for one. A general run's own order of work is unchanged.

**Done when** a task that merges without being asked for a Periodical starts none, and a Periodical can still be started on purpose.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### Go-aheads (no new ticket)

- **G1.** Kick off LIN-4390 (Periodical prompts grant merge authority the review gate withholds) and LIN-4392 (a second stage can start beside a live one), as defects, on Opus.
- **G2.** Start Drift & Coherence and Seams & Tangles now over round 1's window (7–9 Nov), as the coherence baseline.

---

## Batch 2: filed now, waiting for the switch

**Not yet read back to John.**

### A7. The loop works on Jira (D1, D10)

**Title:** The loop works on Jira: Harbour can create Jira issues, and Jira can hold a task's sealed words

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** The first outside test will be a small team on Jira who already use agents and are looking to have agents build their product. John has used Harbour on Jira for a few weeks: "it's mostly fine except for the gaps that you've identified." The gaps:
- Harbour can't create a Jira issue, so on Jira the loop can't file a task with the person's words sealed, mint a Periodical, or file what a task's last step files;
- Jira can't yet hold the block that keeps the person's words exactly as asked.

**What we want.** On a Jira-backed workspace, the loop does what it does on Linear: a task can be filed with the person's words sealed, a Periodical can be minted, and a task's last step can file what it files. It's checked on John's own Jira, which is already in real use.

**Done when** on John's Jira a task filed through Harbour keeps the person's words sealed, a Periodical mints, and a task's last step can file.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A8. The front end, left better than we found it (D10, D13)

**Title:** The front end, left better than we found it: browser code that shares rather than restates, in small slices

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** John: "Side rail and other UI improvements are important purely because the current ones are just mostly the original ones and are due a bit of a sprinkling. But! The front end code is messy." And his gut: "the UI issues trace back to one of my very first rules: no build step… it's the biggest target of the Theseus method… We don't need to tidy it all, but it's a perfect example where we can leave it better than we found it. Likely this will take a fair amount of hand holding."

On main (9 Nov), no browser file can import another, nine browser files restate logic the server already has, and the largest browser file is 5,019 lines.

On the views, John: "Lots of light little views is ideal, but the cost of them has to be balanced… I'd be sad to get rid, but happy to tidy."

**What we want.**
- Browser code that shares rather than restates. There's still no build step and no framework: the rule stays, read as allowing the browser to import, as browsers do natively, and that reading goes into the project's own notes.
- Taken in small slices, one view or one shared piece at a time. Each view is reworked only after finding out why it got so large, and comes out lighter.
- Anything bigger that a slice spots is left out of it and goes into the area's note.
- The side rail and the visual refresh come after, built on the cleaner code.
- No view is retired unless John rules it.

John expects agents to reach for big moves here: "very likely to get agents trying really hard to do big things when we want small." So the size is John's call, and for this work it's small.

**Done when** the reading of the rule is in the project's notes; the first slice has landed, sharing rather than restating, lighter than before and naming what it retired; and John has read the first slice's result before the next starts.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A9. How much tidying a task does is a question (D6)

**Title:** How much tidying a task does is a question, answered by the person or by the default

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** John, 4 Nov: "Eventually a task is chosen, surveyed, and the user decides how much to tidy up." On 8 Nov, about the setting since removed: it "makes zero sense for someone who doesn't know specifics of how Harbour works"; "a default option for hands off operation is fine"; "we'll give users a per task breakdown of options to choose from." On 9 Nov: "I imagined a page a little like the rulings page, as that's our q&a feature really. Sometimes a driving agent will rule, sometimes it'll go to a human… We want to avoid building out some big complex system, and this could simply use rulings? Settings provides a nice few options, allowing users to always be asked, or follow some default." And the removed setting "wasn't wrong per se, just unusable".

**What we want.**
- No new page or system: the size of a task is asked as a ruling. It asks how much tidying to do on this task, with the sizes as options, a rough cost for each, and a recommended pick that leans larger. It shows wherever rulings show.
- A setting chooses who answers: ask me, or let the agent running the task decide with the default.
- Even on "ask me", the question comes only when there's a real choice. A small, clear task stays just the task.
- The setting makes sense to a new user who doesn't know how Harbour works, as every setting should.

**Done when**
- on "ask me", a task with a real size choice puts the question, with options and rough costs, where rulings show, and the answer becomes the task's size;
- on the default, the agent running the task decides and the task says so;
- the setting reads plainly to a newcomer.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A12. The confirmed safety problems are closed in code (D11)

**Approved word for word by John on 11 Nov and filed as LIN-4416.** It starts after the switch.

**Title:** The safety problems the backlog pass confirmed are closed in code, through the loop

**Repository:** JKershaw/LinearViewer (Harbour), and JKershaw/simple-dispatcher where a theme reaches it.

**What this is for.** The backlog pass (A5, LIN-4400) found 134 open tickets with confirmed safety or blocking problems. Most recur in a few themes: merge and read-only limits that exist only in prompt text; tokens inside prompt text; tracker text that can be forged (LIN-3386, LIN-3387, LIN-3402); and tokens that members can mint (LIN-4215). LIN-2576 (the report gate runs on only one route) has topped a Periodical's findings five times. A small outside team will soon hand Harbour real work, and the north star says secure defaults assume hostile input. John: "Agreed on the safety - a code collection of tasks to run through the improved loop. Alongside the other work we identified as best to work on."

**What we want.** The confirmed problems are closed in code, as a collection of tasks run through the loop alongside the other work after the switch.

**Done when** each confirmed problem is fixed in code and its ticket closed for that reason, or John has ruled it can wait.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

---

## Batch 3: after the switch (drafted 13 Nov; checked by a fresh reader; not yet read back)

From the gate discussion (`gate-2026-11-13.md`, section 5). Points 2 and 3 decided one ask per tidy lane, written from real cases, and workspace sharing as one big tidy.

### A13. Runs & dispatch, left simpler (gate point 2)

**Title:** Runs & dispatch, left simpler: each rule written once, the area's waiting work settled, in pieces of varied size

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** John: "we've not been applying quite the right force to bend the curve… now want to run both real work, and some real tidies." The Drift & Coherence and Seams & Tangles reviews of 13 Nov found this area carrying rules written in two places that disagree. Batch 1 added several of them:
- Harbour can mark a task Done on a person's check before its blind read, while another check refuses that same task, and a read is then sent to a ticket that's already Done (Drift run 7, `close-out-gate-precedence-split`). John's ruling: "if I choose to do something, Harbour is a passenger. This reflects that for many real projects, they're unlikely to be exclusively changed via Harbour."
- Two pieces of code decide which PRs belong to a task, and they disagree about agent notes, so a blind read can be offered over a PR no review covered (Seams run 12, §3.0a).
- The task timeline decides which model a dispatch used by its own rule, separate from the one the cost figures use (Drift, row 150).
- The check that makes a stage wait while another is live is a runs rule, but it lives with the prompts (Seams, P-LW1).

The area's note holds 20 Waiting entries, and `lib/dispatch-store.js` is 4,530 lines. Seams also tried moving files between areas three ways, and none made the tangle smaller.

**What we want.**
- Each rule in the area has one home, and the copies are gone.
- When a person acts, Harbour follows, and that rule is written once.
- The area's Waiting entries are settled, or each says why it can't be yet.
- Each piece finishes one move and names what it retired. John: "I'd be happy to run a small variety, erring larger, to see", so piece sizes vary, leaning larger.
- The LLM & prompts side of the seam is A14's.

**Done when**
- the cases above are settled, or John has ruled they can wait;
- the area's Waiting entries are settled or say why not;
- the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A14. LLM & prompts, left simpler, with its safety problems closed in code (gate points 2 and 3)

**Title:** LLM & prompts, left simpler: rules written once, limits held in code rather than prompt words, in pieces of varied size

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** The tightest tangle in Harbour is between LLM & prompts and Runs & dispatch: the links between the two areas grew from 32 one way and 50 the other to 38 and 55 over batch 1 (Seams run 12). On this side:
- the list of routes that code settles without asking a model is copied about nine times, and `docs/architecture/prompt-system.md` and `public/llms.txt` already describe it wrongly (Drift, row 154);
- the blind read's name and heading are retyped outside the file that defines them (Drift, row 151);
- the frozen prompt total rose about 21,000 bytes over batch 1 (A6 +5,425, A1 +14,079, A10 +435, LIN-4441 +1,002) and is now 378,915 bytes;
- LIN-4350 asks to fold the rules together into plainer, more general instructions.

The safety pass (A5, LIN-4400) found two themes here: merge and read-only limits that exist only in prompt text (LIN-1242, LIN-1273, LIN-3417), and tokens inside prompt text (LIN-1372, LIN-1395, LIN-1408). Both are part of A12 (LIN-4416). The area's note holds 26 Waiting entries.

**What we want.**
- Each rule has one home; the copies are gone, and the docs say what the code does.
- A limit that matters is held in code, not only in a prompt's words.
- The prompts end smaller than they started.
- The area's Waiting entries are settled, or each says why it can't be yet.
- Each piece finishes one move and names what it retired; piece sizes vary, leaning larger.
- The Runs & dispatch side of the seam is A13's.

**Done when**
- the cases above are settled, or John has ruled they can wait;
- the safety tickets named above are closed in code for that reason, or John has ruled they can wait;
- the prompts themselves are measurably smaller than at the start, not just their limits;
- the area's Waiting entries are settled or say why not;
- the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

### A15. A team shares a workspace, set up the way people expect (gate point 3)

**Title:** A team shares a workspace, set up the way people expect from a SaaS or CI tool: one idea of who belongs and what they can do

**Repository:** JKershaw/LinearViewer (Harbour), and JKershaw/simple-dispatcher if the runner needs it.

**What this is for.** A small outside team will hand Harbour real work, and today they can't share a workspace. Each person's "Continue with Jira" makes their own workspace, with its own owner and its own key for their runner, and nothing joins them or says so. Linear workspaces belong to the organisation, so they share. John: "Sharing workspaces and how that's set up (essentially following a standard Saas/CICD model) feels like one big tidy?"

The code carries the same question in several places:
- "owner" means two different things: the first person to connect the workspace, and the account an access key belongs to (`ownerAccountId`, on about 270 lines). CLAUDE.md has a warning not to confuse them.
- Any workspace member can make read and read-write access keys for it (LIN-4215, on A12's safety list).
- Removing a workspace doesn't revoke the keys of accounts merged into the user's (LIN-3836).

**What we want.**
- A team shares one workspace, whatever tracker it uses, set up the way a team expects from a standard SaaS or CI tool.
- One idea, written once, of who belongs to a workspace and what each person can do.
- Taken as one big tidy, in pieces that each finish a move and name what they retired, erring larger.

**Done when**
- on John's Jira, a second person joins the same workspace as John and can use it;
- CLAUDE.md's warning about two kinds of owner no longer applies, because only one remains;
- LIN-4215 and LIN-3836 are closed for that reason, or John has ruled they can wait.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
