# SYN-9-validation — deepseek/deepseek-v4-flash
expect={implement|plan}  got=implement  hit=true  latency=27017ms  cost=$0.0006136104  body=330w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed – Task is crystal clear (add a length check in a known file mirroring an existing pattern). No external dependencies or assumptions to validate.
- Blockers: ✓ None – No blockers or bugs present.
- Ready: ✓ Yes – Requirements are concrete and the task is simple enough to implement directly. No plan needed.

**Signal Status:** Not applicable (task is unstarted).

→ **implement**
**Next:** Validate the change locally and commit.

## Prompt
```
# Implement SYN-9: Add validation: reject dispatch prompts longer than 50k chars

## Workflow
1. **Start**: Set SYN-9 status to "In Progress" in Linear.
2. **Fetch details**: Get full issue details for SYN-9 in Linear.
3. **Implement changes**:
   - Open `routes/dispatch.js` (as referenced in the ticket).
   - Locate the existing empty-prompt validation block that returns a 400 response.
   - Immediately above or below that block, add a check: if the prompt length exceeds 50000 characters, return a 400 response with an appropriate error message.
   - Ensure the error response follows the same structure as the existing empty-prompt validation.
   - Run the project’s test suite to verify no regressions (especially dispatch-related tests).
   - Test manually or via an integration test that a prompt of 50001 chars is rejected and one of 50000 chars is accepted (if the boundary allows).
4. **Update Linear**: Add a comment summarizing the change, then set status to "In Progress" (if not already) or "Done" after confirming tests pass.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:

1. List the referenced file: `routes/dispatch.js`.
2. Check whether it has changed since the ticket was created (2026-06-01): run `git log --since="2026-06-01" -- routes/dispatch.js`.
3. If any changes exist, re-read `routes/dispatch.js` at HEAD (not your own notes or the ticket prose) and reconcile discrepancies before trusting the ticket’s description.

## Context
- **Issue:** SYN-9 in the Product project
- **Task description:** Add validation in the POST dispatch handler to return 400 if the prompt exceeds 50000 characters, mirroring the existing empty-prompt validation.

## Goal
**Role**: Implementation engineer

Edit `routes/dispatch.js` to add a character-length check on the prompt, returning a 400 status when the prompt is longer than 50000 characters. Follow the exact pattern of the adjacent empty-prompt validation (same response structure, error format, and location).
```
