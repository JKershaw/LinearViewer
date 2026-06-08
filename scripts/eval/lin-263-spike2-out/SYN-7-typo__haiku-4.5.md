# SYN-7-typo — anthropic/claude-haiku-4.5
expect={implement}  got=implement  hit=true  latency=7509ms  cost=$0.008895  body=247w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed — The task is a straightforward typo fix in a single named file with no dependencies or unknowns.
- Blockers: ✓ None — No blockers or bugs labeled; task is unstarted and ready to proceed.
- Ready: ✓ Yes — The requirement is concrete (fix "Copyrght" → "Copyright" in `lib/components/footer.js`), the scope is single-surface, and the change fits one focused session.

**Signal Status:** Implementation readiness met — concrete requirement, single file, obvious change, no plan needed for a typo fix.

→ **implement** — Execute the typo fix directly.
**Next:** Once implemented and tested, the task moves to review or closes directly if CI passes.

## Prompt

# Fix typo in SYN-7: Fix typo in footer: "Copyrght" -> "Copyright"

## Workflow
1. **Start**: Set SYN-7 status to "In Progress" in Linear
2. **Fetch details**: Get full issue details for SYN-7 in Linear
3. **Locate and fix the typo**: Open `lib/components/footer.js`, find the string "Copyrght", and change it to "Copyright"
4. **Test**: Render the footer in the app (or run any existing tests covering this component) to confirm the text now displays correctly
5. **Commit**: Commit the change with a clear message (e.g., "Fix typo in footer: Copyrght → Copyright")
6. **Update Linear**: Set SYN-7 status to "Done" and add a comment summarizing the fix

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `lib/components/footer.js`, the string "Copyrght"
2. Check whether any have changed since the ticket was created (2026-06-01T00:00:00Z): run `git log --since="2026-06-01" -- lib/components/footer.js`
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product  
**Issue:** SYN-7  
**State:** Todo (unstarted)  
**Created:** 2026-06-01T00:00:00Z

## Goal
**Role**: Implementation engineer

Fix the spelling error in the footer component by changing "Copyrght" to "Copyright" in `lib/components/footer.js`. Verify the change renders correctly and commit.
