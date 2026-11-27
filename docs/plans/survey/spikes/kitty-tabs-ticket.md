# Draft: the kitty tabs spike (not filed)

Revised 27 Nov after John's steer. First see whether the ghosts can be detected at all, then whether tabs are easy to open and close. No prescribed method. If tabs work, we assume one window sidesteps the ghosts.

## Ticket

**Title:** Can simple-dispatcher run sessions as kitty tabs in one window?

**Team:** LIN. **State:** Backlog. Investigation only; no code or config changes.

**Why.** On the dispatcher Mac (macOS 27.0.1, kitty 0.47.4), each closed session window leaves an invisible "ghost" border behind. They build up while nobody is logged in to the screen, logging in pauses while they clear, and on 25 Nov so many had built up that logging in crashed the machine. It's a known macOS bug, not just kitty's (kitty #8952; Firefox and Thunderbird see it too). simple-dispatcher opens a new kitty OS window for every session (`terminal-driver.js:1176`), so every session leaves one ghost. Running sessions as tabs in one window should sidestep this.

**Questions, in order:**
1. Can the ghost windows be detected at all from the machine? It's a macOS bug, so they may not be visible to any tool. That's worth knowing either way.
2. Can a session be opened, run and closed as a tab in a single kitty window, easily and reliably?
3. If so, what would simple-dispatcher need to change, and roughly how big is that?

**Done when** a comment on this ticket answers the three questions.

Background: `docs/plans/survey/spikes/1-kitty.md` on `claude/cool-rubin-6acj5j`.

## Dispatch prompt (custom, target cli, on this ticket)

You're running a short research spike on the dispatcher Mac. Read this ticket first; it has the why and the three questions. Record your findings as one comment on it.

Live sessions may be running on this machine. Don't change simple-dispatcher's code, config or running state, and don't close, signal or touch any window or process you didn't open yourself. Use your own kitty instance for anything you try. How you investigate is up to you.

While you're there, read these without acting on them (they're for a separate ticket):
- the dispatcher log's leftover-process census and signal lines around 25 Nov;
- its stall-failsafe lines from 13:48 to 14:08 UTC on 25 Nov mentioning d43947be;
- the resource metrics for the hour before 12:48 UTC on 25 Nov.

Summarise each in a few lines. Never print secrets or environment variables.

Keep the comment short: one answer per question with its evidence, then the log notes.
