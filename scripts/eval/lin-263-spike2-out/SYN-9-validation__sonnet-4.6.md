# SYN-9-validation — anthropic/claude-sonnet-4.6
expect={implement|plan}  got=implement  hit=true  latency=22202ms  cost=$0.030612  body=485w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed — The ticket is explicit: file (`routes/dispatch.js`), location (POST dispatch handler), condition (prompt > 50000 chars), response (400), and pattern (mirror existing empty-prompt validation). No unknowns to research.
- Blockers: ✓ None — No blockers mentioned.
- Ready: ✓ Yes — Requirements are clear and concrete, single-file change, pattern already exists in the codebase to mirror.

**Signal Status:** No prior work to assess.

→ **implement** — Small, single-surface, well-specified validation addition with an explicit pattern to follow.
**Next:** After implementation, move to code review to verify the change is correct and tested.

## Prompt

# Implement SYN-9: Add validation — reject dispatch prompts longer than 50k chars

## Workflow
1. **Start**: Set SYN-9 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-9 in Linear
3. Open `routes/dispatch.js` and locate the POST dispatch handler
4. Find the existing empty-prompt validation and mirror it with a length check (reject if prompt exceeds 50000 chars, return 400)
5. Add or update tests to cover the new validation path
6. Run the test suite and confirm it passes
7. Commit the change
8. **Update Linear**: Add a comment summarising what was changed and move SYN-9 to "In Review"

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references (`routes/dispatch.js`, the POST dispatch handler, the empty-prompt validation).
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-01" -- routes/dispatch.js`
3. If any have changed, re-read that source at HEAD (not your notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Goal
**Role**: Implementation engineer

Add a prompt-length guard to the POST dispatch handler in `routes/dispatch.js`: return 400 if the prompt exceeds 50000 characters, placed immediately after (or alongside) the existing empty-prompt validation, mirroring its structure exactly.

### Implementation steps

1. **Read the existing validation** — locate the empty-prompt check in the POST handler. Note its exact shape: how it reads the prompt from the request, how it constructs the 400 response, and what (if any) error body or message it returns. Your new check must match that shape.

2. **Add the length check** — directly below (or adjacent to) the empty-prompt validation, add a guard that rejects the request with a 400 response when the prompt length exceeds 50000 characters. Mirror the response structure of the existing check (body format, headers, message style) — determine the correct shape from the existing code, not from assumptions.

3. **Check for unintended side effects** — before finalising, verify that the new guard does not interfere with any other validation or middleware in the same handler. Identify any dependents of the dispatch handler in the codebase and confirm the new early-exit path does not break their expectations.

4. **Test coverage** — add or update tests to cover:
   - A prompt of exactly 50000 chars (boundary — should pass or fail depending on whether the condition is `>` or `>=`; match the ticket's intent of "exceeds 50000")
   - A prompt of 50001 chars (should return 400)
   - A prompt well within the limit (should proceed normally)
   - Confirm the existing empty-prompt test still passes

5. **Run the full test suite** and fix any failures before committing.
