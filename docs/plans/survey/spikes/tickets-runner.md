# Runner tickets (simple-dispatcher), drafts for filing as Todo

From the agreed plan (`plan.md` and the 27 Nov calls in `log.md`). Each states the outcome and the why; the build chooses the how. Order: R1, R2, R3, R4. Revised after a fresh review.

Background files are on LinearViewer, branch `claude/cool-rubin-6acj5j`, under `docs/plans/survey/spikes/`.

---

## R1. The heartbeat says "tool running" only while a tool is running

**Why.** Newer Claude Code transcripts carry `api-request-blob` lines that repeat the ids of tools that have already finished. The heartbeat reads these as a tool still running, so a session that has gone quiet looks busy and the stall warning never fires. LIN-4569 found these lines in 76 of 356 transcripts. The false "running" hid the resume race (R2).

**Outcome.**
- A finished tool no longer shows as running.
- A session that has genuinely gone quiet gets the stall warning as designed.
- A deferred (async) wait is still recognised as one.

**Witness.** A test built on a real transcript containing those lines, failing before the change and passing after.

**Background.** LIN-4569's findings comment; `spikes/1-runner.md` §2.

---

## R2. A follow-up reaches a resumed session on its first turn

**Why.** When a session is resumed, the dispatcher records that it is resuming only after the terminal launch returns. A warm session can finish its first turn before that. The Stop hook then sees the old phase, and the follow-up is lost until the 60-minute failsafe picks it up. LIN-4569 counted 20 of 65 resumes losing their follow-up since 24 Nov (about 31%), the main cost it found. A lost race on a completed session also marks it "human continued", which stops its window closing when it's done. That mark accounted for 6 of the 26 leftover processes at the 25 Nov peak.

**Outcome.**
- A resumed session gets its follow-up on its first turn.
- If a delivery is lost anyway, it is noticed within minutes, not an hour.
- A lost race no longer marks a session "human continued".

Notes for the build:
- An older process on the same session must not take the follow-up. How to prevent that is the build's choice; no ruling is needed.
- LIN-4569's second idea, the hook waiting on a bootstrap turn, was found unnecessary (`1-runner.md` §1).

**Witness.**
- A test that fires the real Stop hook while the launch is still in progress, so it watches the race happen: failing before, passing after.
- A test each for "noticed within minutes" and "no false human continued".
- At runtime, after deploy: no follow-up lost across about 10 resumes into warm sessions, read from the dispatcher's logs. At the old rate, about 97% of runs of 10 would lose at least one.

**Background.** LIN-4569's findings comment; `spikes/1-runner.md` §1.

---

## R3. Sessions run as tabs in one kitty window

**Why.** On the dispatcher Mac (macOS 27.0.1, kitty 0.47.4), macOS can keep an invisible ghost of a closed OS window. It's a macOS bug known since macOS 26 (kitty #8952; Firefox and Thunderbird see it too). The suspected trigger is display sleep: Apple's forums report windows not closing while the display sleeps, and the machine's display is off most of each day.
- **What John sees:** ghosts build up while he's away, and logging in stalls while they clear. They're suspected in the 25 Nov crash.
- **What the spike found:** LIN-4570 could detect ghosts, but with the display on, every closed window was released, so the display-off case is still untested.
- **Why it matters:** the dispatcher opens a new OS window for every session, so every session can leave one.

**What LIN-4570 showed about tabs:** they aren't macOS windows. Thirty sessions run as tabs in one window left the macOS window count flat. Launch, reading the screen, finding the process, close and the SIGTERM backstop all worked unchanged.

**Outcome.**
- New sessions open as tabs in one kitty window.
- Sessions already open as windows keep working and close as they do today.

Note for the build: a launch must not depend on one particular tab still existing. LIN-4570 found that targeting a tab fails once that tab is gone.

**Witness.**
- A test on the launch arguments, failing before and passing after (none covers them today).
- A real `claude` session run end to end in a tab, including the transcript-flush check (LIN-790).
- After a day of normal work that includes display-off hours, the macOS window list shows no ghost build-up. LIN-4570's comment says how to count ghosts.

**Background.** LIN-4570's findings comment; `spikes/1-kitty.md`, `spikes/1d-lin4570-findings.md`.

---

## R4. Dead sessions come back promptly; failed launches and closes are retried; the reaper logs what it drops

**Why.**
- **Dead sessions sit unnoticed.** After the 25 Nov restart, the LIN-4342 autopilot's session stayed "executing" against a window that no longer existed, from 12:54 until it was aborted by hand at 14:07, 73 minutes. The stall failsafe never acted.
  - There's no recovery after a restart, and the failsafe's clock runs from the last transcript line (25 or 60 minutes).
  - Why this case went past even that is unknown. Candidates: a child record still reading "executing", the 60-minute async-wait ceiling, or the blob lines R1 fixes.
  - After a reboot every in-flight process is gone at once, and the machine was already heavily loaded at the 12:54 restart (load 86 to 100). Re-firing everything at once would add to that.
- **A re-fire whose launch fails goes straight to FAILED,** even when the failure is a passing one.
- **A failed window close loses its handle.** When one close attempt fails, resume and re-fire drop the old window's handle for good, and its process can be left behind.
- **The reaper drops queued words silently.** When it deletes a session record after 7 idle days, any follow-up words still queued for it go without a trace (finding-c93ea0bb).

**Outcome.**
- A session whose process is gone is noticed and re-fired within minutes. This holds even if a child record still reads "executing", and without every session re-firing at once after a restart.
- A launch failure that may pass is tried again, until the existing stall deadline, then FAILED.
- A failed close is retried rather than forgotten, and a retry never closes another session's window (window ids can be reused after kitty restarts).
- The reaper logs what it drops.

**Not in scope.** Closing leftover processes. The leftover census stays log-only (John, 27 Nov), as a source of clues to remaining bugs. Its count is read after R2 and this ticket land.

**Witness.**
- Tests for each outcome, failing before and passing after.
- At runtime: kill a session's process mid-run (or reboot the host with a session in flight), and see it re-fired within a pass or two. A dispatcher restart alone leaves `claude` running, so it doesn't test this.

**Background.** `spikes/1-runner.md` §3–4; `spikes/2-cleanup.md` §5 (the reaper); LIN-4570's log notes (the census and the 12:54–14:07 gap).
