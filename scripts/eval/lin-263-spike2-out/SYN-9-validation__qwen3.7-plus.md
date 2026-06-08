# SYN-9-validation — qwen/qwen3.7-plus
expect={implement|plan}  got=(none)  hit=false  latency=53966ms  cost=$0.006794  body=355w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - The task is a small, single-surface validation change with a clear file path (`routes/dispatch.js`) and a specific pattern to follow (mirror existing empty-prompt validation).
- Blockers: ✓ None - No blocking dependencies or bugs indicated.
- Ready: ✓ Yes - Requirements are clear, concrete, and simple enough to implement directly without a formal multi-step planning phase.

**Signal Status:** N/A (unstarted task)

→ implement
**Next:** The code changes will be implemented, tested, and committed, ready for review or completion.

## Prompt
# Implement SYN-9: Add validation: reject dispatch prompts longer than 50k chars

## Workflow
1. **Start**: Set SYN-9 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-9 in Linear
3. **Re-ground**: Locate `routes/dispatch.js` and identify the existing empty-prompt validation to mirror.
4. **Implement**: Add the validation to reject prompts exceeding 50,000 characters, returning a 400 status code, placed right above the existing empty-prompt validation. Ensure consistent error formatting is embedded directly in this step.
5. **Test**: Verify the new validation triggers correctly for prompts > 50k chars and does not break existing dispatch functionality.
6. **Update Linear**: Add a summary comment of the changes made and update the task status (e.g., to "In Review" or "Done").

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- routes/dispatch.js` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product
**Issue:** SYN-9 - Add validation: reject dispatch prompts longer than 50k chars
**Description:** In the POST dispatch handler (routes/dispatch.js), return 400 if the prompt exceeds 50000 chars. Mirror the existing empty-prompt validation right above it.

## Goal
**Role**: Implementation engineer

Implement the 50,000 character length validation for dispatch prompts in `routes/dispatch.js`, returning a 400 status code, by mirroring the existing empty-prompt validation.

- Identify the error response schema from existing endpoints in this codebase to ensure the 400 response matches the project's error contract.
- Identify any dependents of this shared dispatch system in the codebase before changing it to ensure no unintended side effects.
- Test for unintended side effects in addition to the intended validation behavior.
