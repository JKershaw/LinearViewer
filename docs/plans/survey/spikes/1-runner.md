# Spike 1: the runner (simple-dispatcher), 26 Nov

A code read of SD main `d692ac7`, plus LIN-4569's findings and the 25 Nov log. The machine is off.
"Shown" = read in code (file:line at `d692ac7`). "Unknown" = not checked.

**Still real?** Shown: yes, all four. Only two commits landed after LIN-4569's read (`3111e77`):
`9eefa88` (OpenCode words) and `d692ac7` (a contract fixture). Neither touches dispatcher.js,
hook.js, reapers.js, heartbeat.js, terminal-driver.js or signal-guard.js.

## 1. Resume race

Mechanism (shown):
- The follow-up path launches first (`dispatcher.js:1109`). It writes RESUMING and the follow-up
  only afterwards (`:1189` into `resumeSession`, `:301-327`). The comment at `:1182` assumes the
  bootstrap turn is slower. It often isn't.
- `launchCli` is synchronous. For kitty it polls `kitty @ ls` with 5 s timeouts and 1/2/4/8 s
  backoff (`terminal-driver.js:1215-1226`, `config.js:728,739-741`).
- A Stop on COMPLETED allows and sets `humanContinued` (`hook.js:919-922`).
  The RESUMING branch needs `!stopHookActive` (`hook.js:931`).
- The failsafe has the same order. `refire()` launches (`reapers.js:1827`). RESUMING is written later
  (`:2752`), in one `updateState` after *every* candidate in the pass has launched.

Smallest change: commit RESUMING, `dispatchedPrompt`, the item repoint and `brokerArmed` in
`updateState` **before** `launchCli` (all are known before the launch). Write `windowId` as a second delta.
- On launch failure, restore the prior fields only if the record is still this resume's
  (match `resumedAt`). The LIN-4079 CANCELLED check then refuses before any window opens.
- Short backstop: `findStalledBootstrap` (`reapers.js:1240-1252`) waits the full 60 min on a first
  RESUMING. Give it `BOOTSTRAP_STALL_MS` (5 min, `config.js:161-163`), counted from
  `max(last activity, resumedAt)`. A failsafe from RESUMING is already immune (LIN-4569).
- Drop "the hook waits on a bootstrap turn": the pre-launch write removes the window it covers,
  and its detector reads a text-only turn, which LIN-778 found can be unflushed at Stop (`hook.js:1348-1356`).
- The refire path matters less. Inferred, not seen: a lost refire leaves RESUMING plus `refiredAt`,
  which LIN-2510's 5-minute retry catches (`reapers.js:1567-1569,2408-2409`). Fix it for symmetry later.
- Retires: the 60-minute loss, the `:1182` assumption, and false `humanContinued` (feeds problem 3).

Design point (shown, the risk size is unknown): an older live `claude` on the same session id
could stop while RESUMING is set and take the follow-up. Today that gap lasts milliseconds
(the write at `:1189`, then the old window closes at `:1207`). Writing first widens it to the
launch time. The ticket must pick a guard: close the old window first, or mark the launch so the
hook knows its own process.

Witness: a system test whose stub `launchCli` runs the real Stop hook before returning. It fails
today (allow) and passes after (block). The seam exists (`test/system/follow-up-resume-race.test.js`).
Runtime: about 10 follow-ups into warm sessions (about 97% odds of a loss at the old 31% rate).
After the fix, no "hook saw old phase" signature in the oplog and no "re-delivering the task" lines.

## 2. Phantom "tool running"

Mechanism (shown): `pendingTool` (`heartbeat.js:111-128`), `summarizeActivity` (`:50-78`) and
`resolveAsyncWait` (`:253`) ignore the line type. A blob line repeating a finished `tool_use` id
re-opens it, and `stalled` requires `!running` (`:415`), so the stall warning is suppressed.
transcript.js's walks already gate on `type` (`:71-75`, `:406-413`), so they are immune.

Fix: those three walks take tool blocks only from `user`/`assistant` entries.
Keep other lines for the activity clock (`heartbeat.js:33`). Don't filter in `readTranscriptLines`:
cursors are line indices. Retires the false "Edit running" and the hidden stall warning.
Effect on the async-wait gate: unknown (the ScheduleWakeup clear at `:290` reads role, not type).
Witness: a unit fixture from 2d38189e's line 557 (a blob after the tool_result). It fails now and
passes after. Runtime: rerun LIN-4569's 76/356 count on new transcripts.
Overlap: none in mechanism; it only hid problem 1. Pure, tiny, independent: can ship first.

## 3. Leaked terminal windows

**Correction to the plan.** "Kill-first is refused, so processes leak" doesn't follow (shown):
kitty's close is the socket `close-window` *first*, and the pid signal is only a backstop
(`terminal-driver.js:1128-1143`). A gone pid reads as `identity-unreadable` (ESRCH gives null,
`signal-guard.js:94-100,190`). So the refusal is what a *successful* close usually logs.
Whether pid 28507 was still alive: unknown.

Leak paths that are shown:
- **By design:** COMPLETED-without-DONE, BLOCKED, FAILED and parked windows are never closed, and
  the record reap leaves the window (session-lifecycle.md, "never on a TIMER"). The 13 Nov
  processes are past 7-day record retention, so probably "no-record" (inferred).
- **Problem 1 feeds it:** a lost race on COMPLETED sets `humanContinued`, never cleared. Close-on-DONE
  skips it (`reapers.js:4051,4089`), and so does a cascade abort (`abort.js:61`).
- **Dropped handles:** resume/refire ignore the close-old-window result (`dispatcher.js:1207`,
  `reapers.js:1846`), and the record already holds the new `windowId`. One failed close
  (a 5 s socket timeout under load) loses the handle for good. That fits 2d38189e's two live pids.
- **kitty restart (unknown, plausible):** window ids are per-instance counters and the socket close
  is "always allowed", so after a reboot a stale id could close another session's window.

The LIN-3660 census already joins `ps` to records by bucket, but it is log-only by ruling (`reapers.js:4102-4153`).
Smallest change depends on which bucket the 24 were in. Likely: hand a failed close to the existing
`pendingWindowClose` retry; problem 1's fix; a ruling that lets the census close named classes
(no-record, or a superseded duplicate pid). Crash causality: unknown (see `resource-metrics.jsonl`).

## 4. After a restart, and a failed re-fire

Shown: no startup pass (log 25 Nov 13:10, checked to 30 Sep). Failsafe clocks run from the last
transcript line (25 or 60 min). A failed re-fire launch goes straight to FAILED (`reapers.js:2590-2602`).
The one exception is LIN-2510's bootstrap retry, which leaves the session for the next pass (`:2571-2589`).
Why LIN-4342's autopilot wasn't re-fired by 14:05: unknown. Candidates: the child shield (any
non-terminal child record shields, with no time limit, `reapers.js:1319-1324`; a child that died in
the crash still reads EXECUTING), the 60-minute live-async-wait ceiling (`:962`), or blob lines.
Smallest change, two outcomes:
- (a) An EXECUTING/RESUMING session whose recorded process is *positively* gone is re-fired on the
  next pass, not after 25–60 min. `inspectRecordedPid` already returns `gone` (`signal-guard.js:211-227`).
  The general rule also covers a kitty crash or a closed window; a startup-only pass doesn't.
  (Simplest variant: host boot time is later than last activity.)
- (b) A *transient* launch failure leaves the candidate for the next pass: LIN-2510's carve-out,
  generalised. `no-transcript` and `unmappable-model` stay terminal.
- Pace re-fires after a boot. A burst of windows is the crash risk John describes.
Witness: unit tests on the pure selectors (dead pid, then re-fire; a launch error, then left alone).
Runtime: one restart with an in-flight session, re-fired within a pass or two.

## Live evidence that would change these conclusions

Worth turning the machine on to **read** (no dispatch needed): the `leftover.census` lines and
`signal.refused/send` for the 24 pids (decides problem 3's fix); the dispatcher log's
`[stall-failsafe]` lines 13:48–14:08 for d43947be (problem 4's scope); a copy of 2d38189e's
transcript (problem 2's fixture); `resource-metrics.jsonl` before 12:48 (crash causality).
A dispatch before the fix adds nothing, since LIN-4569's 20/65 is the failing evidence.
Dispatch after each fix, as its runtime witness.

## Recommended ticket split

1. **The heartbeat says "running" only while a tool runs** (problem 2). Tiny and pure. It restores
   the stall warning that would have exposed problem 1, so ship it first.
2. **A follow-up reaches a resumed session on its first turn** (problem 1). This is the main cost,
   and it also removes one leak source (false `humanContinued`). It needs a ruling on the old-process guard.
3. **SD knows which `claude` processes are alive and acts on it** (problems 3 and 4). One primitive
   (the ps↔record join the census has) serves both outcomes: finished sessions leave no processes,
   and dead in-flight sessions resume within minutes, paced. Read the census first: which bucket
   leaks decides scope, and closing processes needs John's ruling. If that stalls, split out 4(b)
   (retry a transient re-fire failure), which is small and needs no ruling.
