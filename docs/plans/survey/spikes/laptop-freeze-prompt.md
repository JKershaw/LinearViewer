# Prompt: root cause of today's laptop freezes

For a local Claude Code session on John's MacBook, started in the **admin** account (short name `admin`), so system logs can be read with `sudo`. Paste everything below the line.

---

You're investigating why this MacBook has frozen hard four times: three times today (27 Nov 2026) and once on 25 Nov. Each time the screen locked up and needed a forced power-off, with no crash popup afterwards. The goal is the **root cause, with evidence**, and the smallest fix.

**Rules**
- **Investigate only.** Don't change the system, settings, accounts, login items, simple-dispatcher or kitty without asking John first.
- **Don't try to reproduce a freeze** unless John agrees; each one needs a forced power-off.
- **Never print secrets or environment variables.** simple-dispatcher's config holds tokens.
- **Report what you saw separately from what you infer.** A guess must be labelled as one. The person who wrote this prompt guessed wrong twice today.

## The machine

- macOS 27.0.1. The clock is UTC.
- **Accounts:** `autopilot` (the runner account, not an admin) and `admin` (admin). Check `dscl . -list /Users` for any others; don't assume names.
- **Auto-login:** until today, the laptop logged into `autopilot` automatically at boot so simple-dispatcher would restart. John turned that off after the third freeze. He switches between accounts with fast user switching (lock the screen, then log into the other account).
- **simple-dispatcher (SD):**
  - It runs in `autopilot`, from a checkout under `/Users/autopilot/development/simple-dispatcher`. Its logs and `state/` (including `oplog.jsonl` and `resource-metrics.jsonl`) are there.
  - It launches Claude Code sessions in its own hidden kitty instance. It starts that instance with `open -a kitty --args --listen-on unix:$TMPDIR/sd-kitty-<hash>.sock -o allow_remote_control=socket-only --start-as=hidden -1 --instance-group <group>`, and opens each session as a new kitty OS window over that socket (`terminal-driver.js` around lines 1052 and 1176).
- **kitty:** 0.47.4, at `~/Applications/kitty.app` for `autopilot`. `/opt/homebrew/bin/kitty` points into another user's home folder.

## What happened today

Times are UTC. Each item says where it comes from.

1. **About 08:03.** The laptop was up. SD's kitty instance (PID 35317) ran from 08:03. (Source: a research session's notes.)
2. **08:10–09:12.** A research session ran in `autopilot` with John's other account on screen. It started its own throwaway kitty on its own socket, opened and closed about 40 OS windows and 30 tabs, and ran a background probe until about 09:06. It reported its kitty stopped and nothing of its own left running. No freeze.
3. **Between about 10:40 and 10:50: freeze 1.** It happened while John was rotating keys and changing SD's token. He restarted the laptop.
4. **After the restart,** SD was given the wrong kind of token, so it took no work until about 11:17.
5. **Between about 11:00 and 11:17: freeze 2.** John suspects account switching.
6. **About 11:15–11:17.** John made a new token, put it in SD's config and restarted SD.
7. **11:17:27 to about 11:21.** SD took three tasks. Each failed about a minute later with: `Failed to connect to unix:/var/folders/cj/t50g73253g56t5xkthmyv22r0000gr/T/sd-kitty-be7ca94c914a.sock … no such file or directory`. So SD's own kitty instance wasn't running or listening.
8. **11:24:16–20: freeze 3,** on switching back into `autopilot`. In the system log:
   - a new loginwindow starts;
   - WindowServer says session 259 is "defunct";
   - it logs `Display reconfiguration sync timeout (wait_id=9) - 1 of 2 client(s) failed to respond within 250ms`;
   - a flood of `_CGXPackagesSetWindowConstraints: Invalid window`, and several clients' datagram buffers are cleared;
   - the last line is at 11:24:31, then nothing until boot at **11:28:54**.
9. **"Invalid window" errors per minute,** 11:00–11:28:

   | 11:00 | 11:06 | 11:07 | 11:11 | 11:12 | 11:14 | 11:15 | 11:16 | 11:17 | 11:19 | 11:24 |
   |---|---|---|---|---|---|---|---|---|---|---|
   | 5 | 5 | 10 | 26 | 10 | 3 | 29 | 25 | 71 | 10 | 53 |

   There were none at 11:18 or from 11:20 to 11:23, while SD's launches were failing. So the counts don't clearly follow SD's launch attempts.

10. **25 Nov, about 12:48:** an earlier freeze, when John logged in. SD's `resource-metrics.jsonl` shows load rising from about 8 to 59.9 at 12:47:56, then a gap until 12:54.

## Hypotheses (none proven)

- **A.** A macOS 27 problem when fast-switching back into an account that's running a hidden GPU app (kitty) in the background.
- **B.** Something in the `autopilot` session, such as kitty, SD, or SD's repeated `open -a kitty` attempts when its socket is missing, leaves WindowServer holding windows it treats as invalid. Switching back then hangs it.
- **C.** Something else altogether.

## What to find out

1. **The exact boot and shutdown times** for today and 25 Nov (for example `log show` for boot markers, or `last reboot`), and so exactly when each freeze began.
2. **For each freeze, the two minutes before it:**
   - WindowServer, loginwindow, kernel and display/GPU messages;
   - memory pressure or jetsam;
   - which processes, and which user's session, were creating windows or connections WindowServer flagged as invalid, or failing to respond. Map connection ids (cid) and pids to processes where the log allows.
3. **Whether each freeze happened at an account switch,** and which direction: into `autopilot`, or out of it.
4. **What `autopilot` was running at those times:** SD's own logs and `oplog.jsonl` (kitty launches, `open -a kitty` retries, window closes), and any kitty logs or crash reports, under both users' `~/Library/Logs` and `/Library/Logs/DiagnosticReports`.
5. **Whether hypotheses A, B or C fit the evidence,** and what would tell them apart without freezing the laptop.

## Report

Write `~/freeze-findings.md` in the `admin` account, then print a short summary covering:
- each freeze's exact time and trigger;
- the evidence, shown and inferred kept apart;
- the most likely root cause and how confident you are;
- the smallest fix, and what to avoid until it's in place.

Keep it plain and short. John will bring the summary back to the session that wrote this prompt.
