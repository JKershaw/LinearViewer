# SYN-9-validation — anthropic/claude-opus-4.8
expect={implement|plan}  got=implement  hit=true  latency=21667ms  cost=$0.081195  body=571w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - The task names the exact file (routes/dispatch.js), the exact condition (prompt > 50000 chars → 400), and points to an existing pattern to mirror (the empty-prompt validation right above it). The knowledge needed lives in the codebase and is discoverable during the work, not via a separate research pass.
- Blockers: ✓ None - No blocked or bug labels; no external dependencies.
- Ready: ✓ Yes - Single-file, single-surface validation with a concrete in-file pattern to mirror. The existing empty-prompt validation supplies the response shape and conventions, so direct implementation is appropriate.

**Signal Status:** No prior work to assess; task is in Todo. This is a small, well-scoped single-surface change — direct implementation, no plan phase needed.

→ **implement**
**Next:** After implementation lands with test coverage, the change moves to review to verify the validation behaves correctly and mirrors the existing convention.

## Prompt

# Implement SYN-9: Add validation: reject dispatch prompts longer than 50k chars

## Workflow
1. **Start**: Set SYN-9 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-9 in Linear
3. Implement the validation (steps below), run tests, commit
4. **Update Linear**: Add a summary comment noting what changed and how it was tested; leave status for the review step

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `routes/dispatch.js`, the POST dispatch handler, and the existing empty-prompt validation within it.
2. Check whether any have changed since the ticket was created (2026-06-01T00:00:00Z): run `git log --since="2026-06-01T00:00:00Z" -- routes/dispatch.js`.
3. If it has changed, re-read `routes/dispatch.js` at HEAD (not your notes or the ticket prose) and reconcile any discrepancies — confirm the empty-prompt validation still exists and still has the shape the ticket assumes before mirroring it.

## Context
- **Project:** Product
- This is a small, single-surface validation change confined to the POST dispatch handler in `routes/dispatch.js`. There is an existing empty-prompt validation directly above the insertion point; the new check should mirror it.

## Goal
**Role**: implementation engineer

Add a length validation to the POST dispatch handler in `routes/dispatch.js` that returns a 400 when the prompt exceeds 50000 characters, placed to mirror the existing empty-prompt validation immediately above it.

**Steps:**
1. Locate the empty-prompt validation in the POST dispatch handler in `routes/dispatch.js`. Read it to determine the exact response contract this codebase uses for a 400 — status code emission, error body shape/message format, and how the handler returns/exits early. Do not assume a shape; copy it from the existing check.
2. Add a new validation immediately following the empty-prompt check that returns a 400 when the prompt length exceeds 50000 characters. Match the surrounding style, error structure, and early-return pattern exactly so the two validations are consistent.
3. Confirm ordering and short-circuit behavior: the new check should not change the behavior of the empty-prompt check or any subsequent handler logic. A prompt of exactly 50000 chars must pass (only strictly greater than 50000 is rejected); an empty prompt must still be caught by the existing check.

**Cross-cutting / side-effect checks (embed in the work, don't defer):**
- Verify the two validations don't interact incorrectly — e.g., that an empty prompt is still rejected by the empty-prompt check rather than slipping past, and that the length check operates on the same prompt field/source the empty check uses.
- Test for unintended side effects in addition to the intended behavior: confirm that valid prompts (including the 50000-char boundary) still reach the rest of the handler and that the handler's normal success path is unaffected.

**Testing:**
- Add test coverage for: prompt over 50000 chars → 400; prompt at exactly 50000 chars → accepted; and confirm the existing empty-prompt behavior is unchanged. Determine the existing test file and testing conventions from the codebase and follow them.
- Run the test suite and ensure it passes before committing.

**Commit & report:** Commit the change, then add a Linear comment summarizing the validation added, the boundary behavior chosen (>50000 rejected, =50000 accepted), the response shape mirrored from the existing check, and the tests run.
