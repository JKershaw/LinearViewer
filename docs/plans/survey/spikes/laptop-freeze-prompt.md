This MacBook (macOS 27.0.1, clock on UTC) froze hard three times today, 27 Nov, and once on 25 Nov. Each needed a forced power-off, with no crash popup. Find out why, from the logs. Don't change anything without asking me, and don't print secrets or environment variables.

Setup:
- Two accounts: `autopilot`, which runs simple-dispatcher from `/Users/autopilot/development/simple-dispatcher`, and `admin`.
- Until today, the laptop auto-logged into `autopilot` at boot. I switch accounts by locking the screen and logging into the other one.
- simple-dispatcher runs Claude Code sessions in its own hidden kitty instance, started with `open -a kitty --args --listen-on unix:$TMPDIR/sd-kitty-<hash>.sock … --start-as=hidden -1 --instance-group …`, and opens a kitty OS window per session.

What we know so far:
- The last freeze began at 11:24:16, when I switched back into `autopilot`.
  - WindowServer logged session 259 "defunct", "Display reconfiguration sync timeout - 1 of 2 client(s) failed to respond within 250ms", and a flood of "_CGXPackagesSetWindowConstraints: Invalid window".
  - Nothing more until the boot at 11:28:54.
- The two earlier freezes today were roughly 10:40–10:50 and 11:00–11:17.
- From 11:17 to 11:21, simple-dispatcher failed three launches because its kitty socket didn't exist.

Don't assume any of this explains it. Check:
- when each freeze actually happened;
- what was going on just before each one, and which processes and account were involved;
- what the root cause is.
