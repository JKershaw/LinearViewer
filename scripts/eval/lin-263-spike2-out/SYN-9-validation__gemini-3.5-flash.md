# SYN-9-validation — google/gemini-3.5-flash
expect={implement|plan}  got=implement  hit=true  latency=16037ms  cost=$0.036516  body=357w

---

## Reasoning
**Assessment:**
- Preparation: [✓ Not needed] - The task is extremely straightforward, specifying the exact file (`routes/dispatch.js`), the exact handler (POST dispatch), the exact condition (>50000 chars), the exact response (400), and the exact implementation pattern (mirroring the existing empty-prompt validation).
- Blockers: [✓ None] - No blockers are indicated.
- Ready: [✓ Yes] - The task is simple enough to implement directly without a separate planning phase.

→ **implement**
**Next:** The developer will implement the validation, verify it with tests, and submit the changes for review.

## Prompt
```markdown
# Implement SYN-9: Add validation: reject dispatch prompts longer than 50k chars

## Workflow
1. **Start**: Set SYN-9 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-9 in Linear
3. **Implement validation**: Add the length check to the POST dispatch handler in `routes/dispatch.js`
4. **Verify**: Run tests to confirm the validation works and has no side effects
5. **Update Linear**: Add a comment summarizing the changes and test results, then move the task to "In Review"

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references (e.g., `routes/dispatch.js`, POST dispatch handler).
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- routes/dispatch.js` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- Project: Product
- Issue: SYN-9

## Goal
**Role**: Implementation Engineer

Add validation to the POST dispatch handler in `routes/dispatch.js` to reject prompts longer than 50000 characters with a 400 status code, mirroring the existing empty-prompt validation.

### Implementation Steps
1. **Locate and Analyze**: Open `routes/dispatch.js` and find the POST dispatch handler. Locate the existing empty-prompt validation. Identify any dependents of this handler or validation logic in the codebase before making changes.
2. **Implement Validation**: Add a check right next to the empty-prompt validation. If the prompt length exceeds 50000 characters, return a 400 status code. Ensure the response schema and error contract match the existing empty-prompt validation style (determine the exact response format from the existing code).
3. **Test**: Verify the new validation works as expected (returns 400 for >50k chars, passes for <=50k chars). Test for unintended side effects on other inputs or routes. Ensure any test setup or teardown is fully self-contained.
```
