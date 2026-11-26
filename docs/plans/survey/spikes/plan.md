# The revised plan, after the spikes (26 Nov)

From the six spike pages in this folder (0 to 5), read against `expect.md`, and checked by a fresh reader against your words. Each step gives the change, then why. Sizes are the spikes' estimates. Your calls are gathered at the end, each with a proposed answer. Nothing here is settled until you've made them.

## What the spikes changed

- **Slice 6 would fix neither problem it was meant to take** (spike 4). The close-out/review wait and stale questions have different causes:
  - The wait comes from an engine rule: a step that has paused waiting on another ("parked") still counts as running, so Harbour refuses to start the review that the parked close-out is waiting for.
  - A stale question has nothing to prompt the asker when the world changes. The merge that overtakes it is on another task, addressed to nobody.

  Slice 6's designed rule only rings a run when a record addressed to it arrives, and neither case writes one. Proposed: drop slice 6, and put two small fixes in the clean-up ticket (call 1).
- **The clean-up ticket changes shape** (spike 2). Two of its items were already fixed or barely seen, and the two fixes above come in.
- **The runner becomes three tickets, and the leaked-terminals picture changes.** There are two separate problems:
  - **Leftover processes** (spike 1): 24 old `claude` processes were alive on 25 Nov. The "identity-unreadable" refusal that the notes blamed is usually what a *successful* close logs. The real causes in the code: some windows are never closed by design; a lost resume race turns off close-on-DONE for that session; and resume and re-fire drop the old window's handle if one close fails.
  - **Ghost window borders** (your note): you've seen it yourself each time you log back in to that account from your laptop. Closed windows leave a transparent border, the borders build up while you're away, and logging in pauses and then clears them. Recently there were so many that logging in crashed the machine. You believe it's a known kitty/macOS issue; a research spike is checking (`1-kitty.md`).
- **Slice 5 is small,** 3 to 4 pieces (spike 3). It also has a ready failing test: the brief says "0 lessons" while 3 exist.
- **UI order flips** (spike 5). The run page, LIN-3976, is the worst page now. LIN-4017 (one stylesheet) has no visible payoff.
- **The ledger found 21 open items outside the plan** (spike 0). The ones that matter are under "Not in the steps".

## The steps

**1. Runner (simple-dispatcher), three tickets.** It's a separate repo, so it can run beside step 2.
- **1a. The heartbeat says "tool running" only while a tool runs.** It reads tool blocks only from user and assistant lines. Tiny, so it goes first. Why: the false signal hid the stalls behind the resume race.
- **1b. A follow-up reaches a resumed session on its first turn.** The dispatcher records that the session is resuming before the terminal launches, plus a 5-minute backstop instead of 60. Why: about 31% of resumes lost their follow-up for up to an hour. The planned "hook waits on a bootstrap turn" isn't needed. The build picks how to stop an older process on the same session taking the follow-up: an engineering choice, not a ruling.
- **1c. Leftover processes and failed re-fires.**
  - A failed window close is retried instead of losing the window's handle, and 1b's fix removes the false "human continued" mark. Why: these are the leak paths the code shows.
  - A re-fire whose launch fails for a passing reason is tried again on the next pass, instead of ending FAILED. Small, and needs no ruling.
  - **Depends on the machine's logs.** Two things wait for a read of its process census and its stall-failsafe log lines from 13:48 to 14:08 on 25 Nov:
    - whether SD may close leftover processes itself (your call);
    - whether to re-fire a session as soon as its process is gone, instead of after 25 to 60 minutes. Spike 1 couldn't say why LIN-4342's autopilot wasn't re-fired, so this fix may or may not have caught it.
  - **The ghost borders** (`1-kitty.md`). This is a known macOS 26 (Tahoe) bug: a closed window can stay behind as an invisible rectangle. Firefox and Thunderbird users see it too, and kitty's maintainer calls it an OS bug. An Apple forum thread says Tahoe doesn't close windows while the display sleeps, so they pile up. SD opens one OS window per session (`terminal-driver.js:1176`), so every session leaves one ghost.
    - The options, simplest first:
      1. Upgrade kitty (0.43.1 and later shrinks a window before closing it) and macOS (one user says 26.4 cleared it). No code.
      2. Pilot the existing headless tmux driver (`SD_TERMINAL=tmux`, `terminal-driver.js:1244`). It opens no windows, and you can still watch a session with `tmux attach`. It has only been proven on Linux, so it needs a short pilot on the Mac.
      3. If you want windows always on screen, run sessions as tabs in one kitty window (a small code change).
    - Checks on the machine: macOS and kitty versions, display-sleep settings, and how you log in.
  - Also here: the reaper (the job that deletes old session records) logs how many queued follow-up messages it drops before deleting a record (finding-c93ea0bb). Spike 2 found this is simple-dispatcher code.

**2. Harbour clean-up ticket, about 3 pieces.**
- **A parked step stops holding its ticket.** When the next step is the parked step's own kind, Harbour resumes that session. This replaces the one exception that exists today (a close-out parked on the blind read). Mostly removal. Why: 12 reviews were sent by override beside a parked close-out, plus 14 hand-written resumes and one hand note.
- **A merge prompts askers to look again.** When a merge lands in the project, each run waiting on its own open question is prompted once to check whether events have overtaken it and, if so, to withdraw it. The asker still judges. Spike 4 puts the cost at a short turn for 0 to 2 waiting askers per merge. Why: 4 of 14 questions since 20 Nov were overtaken before an answer.
- **Your re-review ruling, in the review instructions.** "A re-review checks only the fixes for the conditions it set. Anything new and small goes to project." Why: the ruling (decision-5dbdf161) sits in LIN-4546's task, so other tasks never saw it, and LIN-4342 added a new condition twice after it.
- **Leaves the ticket:**
  - hand-back findings with no owner: LIN-4521 already fixed this; 66 were written and none are open;
  - plan review for edited piece plans: only 5 of 46 pieces were ever revised, all to apply your rulings;
  - the secrets backfill: a person's production step (call 5).

**3. Slice 5, lessons as records, about 3 to 4 pieces.**
- The brief counts the project's lessons. The leftover step writes lesson records instead of notes. The 139 lessons in the notes are imported once. The project page lists lessons. The notes files, their size cap and test, and the pointer to them go.
- It also takes two items from the clean-up list: the audit's dead path for opening a notes PR, and the stale `notes` names.
- Why: the notes are back to 54 KB and most sit at their cap. Lessons are used (24 of 80 plans mention one), so the reader stays and only its home changes.
- Reading kept: the share of plans mentioning a lesson, before (24 of 80) and after, so lessons don't become a second unread pile.

**4. UI, as tokens allow, one at a time.**
- LIN-3976 trimmed to its display outcomes. LIN-4343 trimmed to the pages still off, starting with Dispatch and KPIs. LIN-3976's Stop and follow-up controls move to LIN-4343 or a later ticket.
- LIN-4017 deferred.

**Then, added to what you agreed:** a short report with the readings below. It replaces the final report that was planned after slice 6.

## Not in the steps (from the ledger)

- **The seven safety findings** are all still open; LIN-4416 built none of them. You called them "nice test tasks", "not too essential", but never parked them (call 8).
- **LIN-4512 key rotation** is past your target date. It's your own step, not loop work.
- **61 findings are waiting on you,** about 46 of them post-deploy checks nobody ran, including your three signed-in checks. A pass that ends the stale ones would make the rest readable.
- **Admin I can do on your go:**
  - end finding-145b1665 (fixed);
  - set LIN-4491 Done;
  - close LIN-4498 as retired by slice 3;
  - clear the 23 stale "taken" dispatch rows.
- **Small tidies, not sized by any spike:** `lib/records/check.js` still lets a non-URL change ref through, and a flaky lease-timing test failed a deploy's CI. They fit the clean-up ticket if you want them.
- **Yours to order later:**
  - LIN-4509, LIN-4510 and LIN-4511;
  - Ship Biscuit's big picture;
  - two rough edges with no home: runs building the contested part while a question waits, and engineering questions raised to you.
- **Due about 1 Dec:** the time-to-answer reading (finding-581bfa0e).

## How we'll know it worked

These are reports only and never block anything. Each is compared with this week:
- share of resumes lost (31%);
- reviews sent by override, and hand-written resumes (12 and 14, across six tasks);
- minutes from an approving verdict to close-out resuming;
- how long a question stays open after the event that overtook it;
- hand nudges per task;
- notes size (54 KB), and the share of plans mentioning a lesson (24 of 80).

## Your calls, each with a proposed answer

1. Drop slice 6, with both fixes in the clean-up ticket? *Yes. Reopen it only if records addressed to a parked run are seen sitting unread.*
2. Let review run beside a parked close-out, as the blind read already does? *Yes.*
3. What prompts an asker to re-check: each merge, or a timer? *Each merge.*
4. Spike 2 offers a bigger removal: stop close-out's own fixes making the approval stale (reversing LIN-4521). That would remove the hand-back and most re-review rounds in one cut, and it's simpler than calls 2 and 3. The cost: fixes close-out commits after an approval would merge without a re-review, which is the gap slice 3 closed on purpose. *Not now. Once your ruling reaches every review, rounds should mostly stop, and close-out's fixes keep a reviewer's eye. Revisit if loops continue.*
5. The secrets backfill: a dry-run count in production, then a rewrite only if rows hold secrets? *Yes, run by a person. If the count is 0, end the finding.*
6. Slice 5: import all 139 lessons? Retire simple-dispatcher's notes (including its 13 Waiting entries) in the same move? Drop the size cap and report the count instead? List lessons on the project page? *Yes to all four.*
7. LIN-3976 before LIN-4343, and defer LIN-4017? *Yes.*
8. The seven safety findings: run them after slice 5, or park them? *Park them, given token use. They're good test tasks for later.*
9. Turn the machine on, so its process census, stall-failsafe lines and resource log can be read before 1c is written and your ghost-border diagnosis checked? *Yes, when convenient. Connecting it to this session through Remote Control lets me read them without a dispatch.*
