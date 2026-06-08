# SYN-7-typo — deepseek/deepseek-v4-flash
expect={implement}  got=implement  hit=true  latency=11013ms  cost=$0.000889238  body=205w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - The file and typo are explicitly named; no research required.
- Blockers: ✓ None - No blockers or bugs.
- Ready: ✓ Yes - Task is a trivial one-file typo fix; implementation can proceed directly.

**Signal Status:** N/A (no prior work to assess)

→ **implement** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer.
**Next:** After implementation, the fix is complete and ready for review/merge.
**DeferTo:** (omit)

## Prompt
# Implement SYN-7: Fix typo in footer: "Copyrght" -> "Copyright"

## Workflow
1. **Start**: Set SYN-7 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-7 in Linear
3. **Implement**: Fix the typo in `lib/components/footer.js` – change the string "Copyrght" to "Copyright". Run any existing tests to confirm no regressions.
4. **Update Linear**: Add a comment summarizing the change (file modified, string corrected), then set status to "In Review" or "Done" as appropriate.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth – its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the file the ticket references: `lib/components/footer.js`.
2. Check whether it has changed since the ticket was created (2026-06-01): run `git log --since="2026-06-01" -- lib/components/footer.js`.
3. If it has changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product

## Goal
**Role**: Implementation engineer

Fix the single-character typo in `lib/components/footer.js` where "Copyrght" is rendered instead of "Copyright". No other changes are needed.
