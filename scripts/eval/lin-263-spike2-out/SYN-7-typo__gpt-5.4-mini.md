# SYN-7-typo — openai/gpt-5.4-mini
expect={implement}  got=implement  hit=true  latency=3932ms  cost=$0.00297705  body=256w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - This is a simple typo fix; the ticket already states the exact issue in `lib/components/footer.js`.
- Blockers: ✓ None - No blocker or bug labels are provided.
- Ready: ✓ Yes - The work is concrete and small enough to implement directly without a separate plan.

**Signal Status:** No research signals; no blockers; no plan required for a single-file typo fix.

→ **implement** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer.
**Next:** Update the footer spelling in the referenced component, verify the change, and record the result in Linear.

## Prompt
# Implement SYN-7: Fix typo in footer: "Copyrght" -> "Copyright"

## Workflow
1. **Start**: Set SYN-7 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-7 in Linear
3. Inspect the code referenced by the ticket and fix the spelling from "Copyrght" to "Copyright".
4. Verify the change in the codebase and check for any unintended side effects from touching the referenced footer code.
5. **Update Linear**: Add a concise comment summarizing the fix and set the issue to done when complete.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- Project: Product
- Issue: SYN-7
- Description: The footer in `lib/components/footer.js` renders "Copyrght". Fix the spelling.

## Goal
**Role**: implementation engineer

Make the spelling correction described in the issue, using the referenced footer code as the source of truth. Confirm the updated text is correct and ensure the change does not introduce unintended side effects.
