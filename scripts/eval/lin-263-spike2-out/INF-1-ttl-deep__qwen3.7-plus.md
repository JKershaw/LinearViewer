# INF-1-ttl-deep — qwen/qwen3.7-plus
expect={implement|plan}  got=implement  hit=true  latency=89846ms  cost=$0.00940448  body=436w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The agent's comment provides comprehensive research findings, exact file paths, line numbers, and a clear, validated recommended approach.
- Blockers: ✓ None - No blockers or bugs identified.
- Ready: ✓ Yes - The task is a small, well-scoped constant/config change with a clear approach from the research comment, making it ready for direct implementation.

**Signal Status:** Research findings are complete and actionable.

→ **implement**
**Next:** The agent will implement the TTL bump, update tests and docs, and add the migration note as specified in the research findings.

## Prompt
# Implement INF-1: Bump the dispatch item TTL from 24h to 48h

## Workflow
1. **Start**: Set INF-1 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for INF-1 in Linear
3. **Re-ground**: Verify the files and lines mentioned in the research comment are still accurate at HEAD.
4. **Implement**: 
   - Lift `DISPATCH_TTL_MS` to a named export in `lib/dispatch-store.js` and update its value to `48 * 60 * 60 * 1000`.
   - Update the unit test assertion in `tests/unit/dispatch-store.test.js` (line 41) to expect the new 48h value.
   - Update the e2e test in `tests/e2e/dispatch.spec.js` (line 210) to wait on the 48h boundary via the clock mock.
   - Update the two mentions of "24 hours" in `docs/dispatch-integration.md` to "48 hours".
   - Add a migration note (e.g., in the PR description or a relevant changelog) stating that in-flight items will keep their old 24h expiry.
5. **Test**: Run the updated unit and e2e tests to ensure they pass, and test for unintended side effects by running the broader dispatch module test suite.
6. **Update Linear**: Add a summary comment detailing the changes made and mark the task as Done.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- lib/dispatch-store.js tests/unit/dispatch-store.test.js tests/e2e/dispatch.spec.js docs/dispatch-integration.md` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product
**Discussion History:** Agent research (Jun 2, 2026) identified `DISPATCH_TTL_MS` in `lib/dispatch-store.js` (line 14), used in `pruneExpired()`, `listAvailable()`, and `enqueue()`. Recommended approach: lift constant to named export, update tests (`tests/unit/dispatch-store.test.js` line 41, `tests/e2e/dispatch.spec.js` line 210), update docs (`docs/dispatch-integration.md`), and add a migration note that in-flight items keep the old expiry.

## Goal
**Role**: Implementation engineer

Implement the dispatch TTL bump from 24h to 48h by updating the constant, associated tests, and documentation as outlined in the research findings. 

**Scope Note**: This is a small, single-surface task. Focus strictly on the four files identified in the research. Before changing the shared `DISPATCH_TTL_MS` constant, quickly search the codebase to identify any dependents and confirm there are no other unmentioned usages. Ensure the migration note regarding in-flight items is clearly documented.
