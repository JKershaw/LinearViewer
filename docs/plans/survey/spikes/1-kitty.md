# Spike 1: kitty "zombie" windows on the unattended Mac

Tags: **[S]** from a source (URL given), **[C]** from the code (file:line),
**[I]** my inference. Code paths are relative to the dispatcher checkout (`sd-main/`).

## What the sources say

- Yes, this is a known macOS 26 (Tahoe) bug. kitty #8952, "Window fails to fully close
  on macOS 26": a closed OS window leaves an invisible rectangle that eats clicks and
  shows as an empty tile in Mission Control. The maintainer calls it "clearly a bug in
  the OS". [S] https://github.com/kovidgoyal/kitty/issues/8952
- Duplicates: "Phantom windows…" #8978, "Transparent window left on desktop" #9009,
  "ghost upon closure" #9051. [S] https://github.com/kovidgoyal/kitty/issues/9009
- kitty's workaround (commit d837a64): set the window's frame to zero size before
  `close`, because "NSWindow::close no longer actually closes the window". Shipped
  in 0.43.1 (2025-10-01). Maintainer: "Fix is too strong a word". [S]
  https://github.com/kovidgoyal/kitty/commit/d837a64 · https://sw.kovidgoyal.net/kitty/changelog/
- In #8952: gone for one user on macOS 26.4. Quitting kitty clears it. The maintainer
  suggests `macos_quit_when_last_window_closed yes`. [S] It likely never fires here, since
  the `--start-as=hidden` first window stays open. [I]
- It's not only kitty. Apple Developer Forums, "Failing to close NSWindows after display
  sleep" (June 2026): on Tahoe, windows closed during display sleep "accumulate" and
  slow the Mac down. FB21391882; Apple says it is "continuing to look into" it. QA
  sees it still in the next macOS beta. No workaround is posted.
  [S] https://developer.apple.com/forums/thread/832819
- Same symptom reported in Thunderbird and Firefox on macOS 26 (invisible window blocks
  clicks, empty Mission Control tile, gone after restarting the app). [S]
  https://support.mozilla.org/questions/1545902 ·
  https://connect.mozilla.org/t5/discussions/ghost-windows-on-macos/td-p/111664
- **Nothing found** about the build-up being caused by a locked screen or fast user
  switching, about windows "clearing on login", or about a WindowServer crash caused by
  too many leftover windows. The closest: a WindowServer crash when an app draws in an
  *inactive* (switched-out) session, fixed in 14.6.1. [S]
  https://developer.apple.com/forums/thread/761464 Nothing ties decorations, shadows
  or `background_opacity` settings to this bug.

## Likely cause

- macOS 26 does not fully remove a closed NSWindow, especially while the display is
  asleep (Apple thread above). WindowServer keeps the surface. On login or wake it
  catches up, which explains the pause and then the clean-up. With hundreds pending,
  that catch-up can bring the machine down. [I, built on the sources above]
- kitty's zero-frame workaround may not cover windows closed while asleep or switched
  out. One NSWindow per session means dozens of leaked windows a day. [C+I]

## How the service launches and closes windows today

- One kitty process for everything, started hidden with a socket:
  `open -a kitty --args --listen-on … --start-as=hidden -1 --instance-group`
  (terminal-driver.js:1052-1061; design note at :887-892). [C]
- Every session gets a **new OS window**:
  `kitty @ launch --type=os-window --dont-take-focus /bin/zsh -l -c <claude>`
  (terminal-driver.js:1176, run at :1179). [C]
- Close: `kitty @ close-window --match id:N` (:1130), then SIGTERM to the process
  group as a backstop (:1137-1143). [C]
- `countWindows` counts all windows in `kitty @ ls` (:976-985, :1069-1075). kitty's
  own list drops closed windows, so it cannot see the zombies WindowServer still holds. [C+I]
- A tmux driver already exists: `tmux new-session -d` with no GUI window at all
  (terminal-driver.js:1457-1498). Select it with `SD_TERMINAL=tmux` (config.js:1200,
  README.md:24-31; can be set per workspace). [C]

## Options, simplest first

1. **Upgrade kitty (≥0.43.1, current 0.51.1) and macOS (latest 26.x).** No code.
   Might not fix the display-sleep variant (Apple bug still open). [S+I]
2. **`SD_TERMINAL=tmux` on the Mac.** One setting, the driver is already written. No
   NSWindows, so nothing can leak. Watch a session with `tmux -S <sock> attach -t <id>`
   from any terminal, on demand. Trade-offs: proven on Linux, not macOS
   (docs/linux-substrate-findings.md:121-127), so re-run the LIN-790 transcript check
   on the Mac. It uses `/bin/bash -lc`, not zsh (:1463), so check PATH. Watching is
   opt-in rather than always on screen. Pilot one workspace first. [C+I]
3. **Tabs in one OS window** (`--type=tab`, or `--type=window` into one kept OS
   window) instead of `os-window` at :1176. Tabs aren't NSWindows, so only one long-lived
   window, still watchable. Trade-offs: code change. The launch must target that
   window (`--match`) and recreate it if it's closed. Untested. [I]
4. **Restart kitty when it holds no sessions** (for example nightly, or when the count
   hits 0). Sources say quitting the app clears the ghosts. Trade-off: it must never
   kill live sessions, and it doesn't prevent build-up between restarts. [S+I]
5. **Stop the display sleeping** (`caffeinate -d`, or display sleep set to Never).
   Targets the trigger the Apple thread names. Trade-offs: power and screen wear. It
   doesn't help if his account is switched out rather than just asleep. [S+I]

Suggestion: do 1 now, then pilot 2. Keep 3 as the fallback if he wants live windows. [I]

## What to check on the machine

- Versions: `sw_vers`, `kitty --version`.
- How he logs in (Screen Sharing, fast user switching, or at the machine), and
  whether the display sleeps: `pmset -g`, `pmset -g log | grep -i display`.
- Count: Mission Control empty kitty tiles vs `kitty @ --to unix:<sock> ls` count.
- WindowServer memory over a day (`ps -o rss= -p $(pgrep WindowServer)`), and
  WindowServer `.ips` or panic logs in /Library/Logs/DiagnosticReports.
- Quick test over SSH: open and close 20 os-windows through the socket (a) awake,
  (b) after `pmset displaysleepnow`, (c) switched out or locked. Then log in and count
  ghosts. Repeat (b) with `--type=tab` and with `SD_TERMINAL=tmux`.
