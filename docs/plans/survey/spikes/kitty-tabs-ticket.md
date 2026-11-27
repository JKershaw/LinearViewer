# Draft: the kitty tabs spike (not filed)

## Ticket

**Title:** Do kitty tabs stop finished sessions leaving ghost windows on the Mac?

**Team:** LIN. **State:** Backlog. Investigation only; no code or config changes.

**Why.** On the dispatcher Mac, each closed session window leaves an invisible "ghost" border behind. They build up while nobody is logged in to the screen. Logging in pauses while they clear, and on 25 Nov there were so many that logging in crashed the machine. This is a known macOS bug: closed windows can linger, especially while the display sleeps (kitty #8952; an Apple Developer Forums thread; Firefox and Thunderbird see it too). simple-dispatcher opens a new kitty OS window for every session (`terminal-driver.js:1176`), so every session leaves one ghost. The machine runs macOS 27.0.1 and kitty 0.47.4, so kitty's 0.43.1 change hasn't cured it.

**The question.** If sessions ran as tabs inside one kitty OS window, would closing them stop the ghosts? If so, what would simple-dispatcher need to change?

**Done when** a comment on this ticket gives:
- the measured ghost counts for each case tried;
- whether tabs are viable, with what simple-dispatcher would need to change and a rough size;
- the read-only log findings listed in the prompt.

Background: `docs/plans/survey/spikes/1-kitty.md` and `1-runner.md` on `claude/cool-rubin-6acj5j`.

## Dispatch prompt (custom, target cli, on this ticket)

You're running a short research spike on the dispatcher Mac. Record your findings as one comment on this ticket. Don't change simple-dispatcher's code, config or running state, and don't close, signal or touch any window or process you didn't open yourself. Live sessions may be running.

1. **Versions and settings.** Record:
   - macOS version and kitty version;
   - display-sleep settings (`pmset -g`);
   - how many `claude` processes are alive now, with their start times.
2. **A way to count ghosts.** Find a way to count the windows WindowServer still holds for a kitty process, beyond what `kitty @ ls` reports. For example, `CGWindowListCopyWindowInfo` through JXA (`osascript -l JavaScript`) or Swift, filtered by owner pid. Check it against a window you open and close.
3. **A separate test kitty.** Start your own kitty instance with its own `--listen-on` socket, so simple-dispatcher's instance is untouched. Run each case with 20 cycles of open, run a trivial command, then close. Count ghosts before, right after, and five minutes after:
   - A. new OS windows (`--type=os-window`, as simple-dispatcher does today), display awake;
   - B. the same with the display asleep (`pmset displaysleepnow`; wake with `caffeinate -u -t 2`);
   - C. tabs in one OS window (`--type=tab`), display asleep;
   - D. optionally, the same as C closed with `close-tab` instead of `close-window`, if that differs.

   Then quit the test instance and count again.
4. **If tabs work.** Read `terminal-driver.js` (launch about :1176, close about :1130, `countWindows` about :1069) and say what simple-dispatcher would need to change: tab launch, which id it keeps, close and the counting. Give a rough size, and say what watching a session would look like for the owner.
5. **Read-only log reads** (for a separate ticket; don't act on them):
   - the dispatcher log's `leftover.census` and `signal.refused`/`signal.send` lines for the leftover `claude` processes around 25 Nov;
   - the `[stall-failsafe]` lines from 13:48 to 14:08 UTC on 25 Nov mentioning d43947be;
   - `resource-metrics.jsonl` for the hour before 12:48 UTC on 25 Nov.

   Summarise each in a few lines. Never print secrets or environment variables.

Keep the comment short: a table of counts, a yes/no/unclear on tabs with the reason, the change and its size, then the log findings.
