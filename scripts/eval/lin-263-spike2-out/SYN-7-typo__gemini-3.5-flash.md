# SYN-7-typo — google/gemini-3.5-flash
expect={implement}  got=implement  hit=true  latency=11566ms  cost=$0.0269115  body=247w

---

## Reasoning
**Assessment:**
- Preparation: [✓ Not needed] - The task is a straightforward typo fix with an explicit file path provided.
- Blockers: [✓ None] - No blockers or bugs are indicated.
- Ready: [✓ Yes] - The requirements are extremely clear and concrete, and the task is simple enough to implement directly without a separate planning phase.

→ **implement**
**Next:** The developer will commit the spelling fix, verify it doesn't cause side effects, and mark the task as completed.

## Prompt
# Implement SYN-7: Fix typo in footer: "Copyrght" -> "Copyright"

## Workflow
1. **Start**: Set SYN-7 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-7 in Linear
3. **Identify Dependents**: Identify any dependents of `lib/components/footer.js` in the codebase before making changes to this component.
4. **Modify Code**: In `lib/components/footer.js`, change the text "Copyrght" to "Copyright". Ensure this change is self-contained.
5. **Verify**: Verify the spelling fix. Test for any unintended side effects in the rendering or layout of the footer in addition to verifying the intended spelling change.
6. **Update Linear**: Set SYN-7 status to "Completed" and add a comment summarizing the change.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project**: Product
- **File**: `lib/components/footer.js`

## Goal
**Role**: Implementation Engineer

Fix the spelling of "Copyrght" to "Copyright" in the footer component located at `lib/components/footer.js`.
