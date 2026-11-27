# Dig: do these small defects deserve tracking? (27 Nov)

**Context.** A sweep of a working log (`/home/user/LinearViewer/docs/plans/survey/log.md`, 2–27 Nov 2026) about Harbour, a control plane that runs AI agent sessions on tickets, and its runner, simple-dispatcher, turned up small defects. Each item's original note is in `/home/user/LinearViewer/docs/plans/survey/spikes/sweep/merged.md`, and a check against main is in `check-1.md`–`check-3.md` beside it. Look the item up by its id.

John (the owner) doesn't think all of them warrant tracking. For each of your items, find out:
1. **How often it actually happened.** Once, a few times, or never seen (only reasoned from code)? Use the log and anything else that records real runs.
2. **Whether it was really a defect.** Or the system was working as designed and something in the setup, the operator's actions or the circumstances wasn't quite right.
3. **Whether it is still possible on main today,** from the code itself.

Then give one call:
- **ignore unless it comes back:** a one-off, or harmless;
- **not a defect:** working as designed, or a setup issue;
- **worth tracking:** real, still possible, and likely to bite. Say in one line what it would cost John or a user.

**Where to look:**
- Harbour code at `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/main`, and simple-dispatcher at `…/scratchpad/sd-main`. Both are at origin/main; use git history for what changed and when.
- The log.
- Ticket JSONs already fetched in `…/scratchpad/sweep/tix/`.

Read the code itself; a search hit alone isn't evidence.

Read-only: don't edit, comment, file or dispatch anything. Never print secrets or environment variables. Don't guess: if you can't tell, say what you checked.

**Write** to `/home/user/LinearViewer/docs/plans/survey/spikes/sweep/dig-<n>.md`, one short paragraph per item: id, the call, then the evidence for frequency, defect-or-not and still-possible (log lines, file:line, commits). Return a summary of at most 4 lines.
