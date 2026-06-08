# SYN-7-typo — qwen/qwen3.7-plus
expect={implement}  got=(none)  hit=false  latency=55257ms  cost=$0.006872  body=274w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - The task is a simple, single-surface typo fix with the exact file path explicitly provided in the description.
- Blockers: ✓ None - No blockers or bugs indicated; state is Todo.
- Ready: ✓ Yes - The task is simple enough to implement directly without requiring a formal planning phase.

**Signal Status:** N/A (unstarted task)

→ implement
**Next:** The typo will be fixed in the specified file, verified, and the task will be marked as done.

## Prompt
# Implement SYN-7: Fix typo in footer: "Copyrght" -> "Copyright"

## Workflow
1. **Start**: Set SYN-7 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-7 in Linear
3. **Implement**: 
   - Identify any dependents of `lib/components/footer.js` in the codebase before making changes.
   - Open `lib/components/footer.js`, locate the string "Copyrght", and change it to "Copyright".
   - Test for unintended side effects in addition to the intended behavior (e.g., ensure the component still renders correctly and no existing tests fail).
4. **Update Linear**: Commit the change, add a summary comment in Linear stating the typo has been fixed, and set the status to "Done".

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- lib/components/footer.js` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
Project: Product

## Goal
**Role**: Implementation engineer

Fix the spelling of "Copyrght" to "Copyright" in the footer component.

## Scope Note
This is a small, single-surface task. The only file to modify is `lib/components/footer.js`. No broader refactoring or cross-cutting checks are needed beyond verifying the string replacement is accurate and dependent components are unaffected.
