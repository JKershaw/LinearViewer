# Notes review: 23 to 25 Nov

Gathered at the pause, 25 Nov 18:30Z, from `log.md`. Slice 4 (LIN-4529), the queued work (LIN-4416, LIN-4441, LIN-4463, LIN-4548), the UI lane (LIN-4546, LIN-4342) and LIN-4508 are all Done. Each item gives what happened, the evidence, and any fix already found. John decides what happens to each one.

## A. How the loop converges

1. **A re-review adds a new condition each round.** Fixing a condition means a new commit, the approval goes stale, and the next review finds one more small thing. LIN-4549 went round three times. Workaround: John's words in decision-5dbdf161 ("A re-review checks only the fixes for the conditions it set. Anything new and small goes to project"), plus standing permission to tell the autopilot. The cause is the same as LIN-4544's (fixed for blind reads): a check that should use judgement was written down as a rule.
2. **Close-out and review wait on each other.** Close-out parks waiting for re-review, and the engine refuses review beside an open close-out (STAGE_IN_FLIGHT). Or review approves after close-out has parked, and nothing wakes it. Seen on LIN-4549, 4553, 4557, 4567, 4568 and LIN-4342's closing PR (project finding-34ab47ef). By the end the autopilot was pinning the step itself; once (LIN-4567) it needed a note. The engine should resume a parked close-out when its verdict lands.
3. **Stale questions.** Example: question-2fea4d20 (redeploy c48d188) was overtaken at about 06:15 when d22e7fa carried the change live. It stayed open until 08:25, holding LIN-4560 and LIN-4561. Earlier ones were overtaken by events and still waited to be dismissed. Nothing prompts the asker to check again once it has asked.
4. **Where the blind read sits.** One per change now (LIN-4544). Moving it before review was left for later.
5. **Findings filed to project that nothing reads.** Small tidy-ups go there by design. They have no owner yet; John expects most to fold into planned work.
6. **The donut.** John: fuzzy checks written as rules become friction and then more complexity; "the answer is a vastly simpler system". Items 1 to 3 are instances.

## B. The UI

7. **UI retro.** Why did dozens of reviews and checks never update the UI and UX (raw text, unstyled cards, pages changed without CSS)? John's morning verdict after LIN-4546 and LIN-4342: "the UI is so much nicer!"
8. **Held UI tickets:** LIN-4343 (walk every page), LIN-3976 (run page), LIN-4017 (stylesheet). Add them or not. The nav rebuild is also waiting.
9. **LIN-4508 leftovers (John's calls):** finding-554005cc (the transcript on a real phone and in dark mode), finding-ce6e4602 (old feedback rows from before masking still hold raw secrets; backfill?), finding-c93ea0bb (the reaper can delete a record that still has words queued).

## C. The runner and the machine (simple-dispatcher)

10. **Resume race (LIN-4569, the main cost).** The dispatcher writes RESUMING and the follow-up only after the terminal launch returns. A warm "ready" turn ends in about 3s, so the Stop hook sees the old phase and the follow-up is lost until the 60-minute failsafe. 20 of 65 resumes since 24 Nov were lost (about 31%), rising since early Nov with no code change. Fixes on LIN-4569: commit RESUMING before the launch; the hook waits briefly on a bootstrap turn; a short backstop.
11. **Phantom "tool running" in the heartbeat (LIN-4569).** Claude Code's new `api-request-blob` transcript lines repeat old tool_use ids, which also suppresses the stall warning (76 of 356 transcripts). Fix: skip those lines.
12. **Leaked terminal windows; the machine crashed (25 Nov, 12:48).** Kill-first is refused ("identity-unreadable"), so old `claude --resume` processes pile up (24+, some from 13 Nov). John: crashes are "usually caused by so many opened and closed terminals". Worth its own ticket.
13. **After a restart.** There's no startup recovery (there never has been); the failsafe re-fires sessions 25 to 60 minutes after their last transcript line. A background wait killed by the reboot kept LIN-4342's autopilot from being re-fired (restarted by hand at 14:08). A failed re-fire launch ends FAILED, not retried.
14. **Long Bash waits (CI) look like stalls.** These were hour-long gaps on 24 Nov. LIN-4508's mid-turn words now show what a run is waiting on.
15. **Deploys.** Railway didn't retry after a flaky scheduler lease-timing test failed the first CI run (c48d188, 25 Nov 04:26). The next merge carried it.

## D. Access and process

16. **Production access.** It was hidden from agents on purpose, so slice 4 needed it put back by comment. John: one for a later permissions sweep, or keep as is (a product tweak may rightly need a person).
17. **Log comments become findings.** Since LIN-4548, a comment John's token posts on LIN-4008 is filed as his finding on its task. I've ended each one by hand.
18. **Models.** Builds run on Opus. Haiku is fine where the preparation is done (LIN-4538's thrash was fixed by an Opus swap).

## E. John's calls after the review

- Which of the above become tickets, and in what order. The clean-up ticket is the natural home for A1, A2, A3 and C10 to C13.
- The held UI tickets (item 8).
- Slice 5 (lessons), slice 6 only if needed, the final report.
- My Harbour token expires 26 Nov 07:05Z.
