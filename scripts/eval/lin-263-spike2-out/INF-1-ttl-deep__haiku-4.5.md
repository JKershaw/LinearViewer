# INF-1-ttl-deep — anthropic/claude-haiku-4.5
expect={implement|plan}  got=implement  hit=true  latency=20166ms  cost=$0.016011  body=985w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete — The agent's research comment (Jun 2) has already identified all key surfaces (lib/dispatch-store.js, tests/unit/dispatch-store.test.js, tests/e2e/dispatch.spec.js, docs/dispatch-integration.md), traced the end-to-end behavior, and provided a validated recommended approach. The knowledge needed to implement is in hand.
- Blockers: ✓ None — No blocked label; no external dependencies or decisions blocking progress.
- Ready: ✓ Yes — Research findings are complete, approach is validated, and the task is straightforward: update a constant and its dependents (tests and docs). This fits one focused session.

**Signal Status:** 
- Research completion signals met: key questions answered (where TTL lives, how it's used, what breaks if changed), feasibility validated (approach is clear), prior findings documented in comment.
- Plan not yet documented in description, but the scope is simple enough that a plan step would be redundant — the recommended approach in the comment is already the implementation plan.

→ **implement** — The research is complete, the approach is validated, and the surfaces are enumerated. Proceed directly to implementation.

**Next:** After implementation completes, the task will be ready for code review to verify all surfaces were updated correctly and tests pass.

## Prompt

```
# Implement INF-1: Bump the dispatch item TTL from 24h to 48h

## Workflow
1. **Start**: Confirm INF-1 status is "In Progress" in Linear
2. **Fetch details**: Review the full issue and the agent's research comment (Jun 2) for the validated approach
3. **Re-ground the ticket**: Verify no changes have invalidated the research
4. **Implement the change**: Update the constant and all dependents
5. **Test**: Run unit and e2e tests to confirm they pass
6. **Update Linear**: Add a summary comment and move to "Done"

## Re-ground the Ticket (staleness check)
Treat the research findings as a hypothesis about the current codebase, not ground truth — commits since Jun 2, 2026 may have changed the files or behavior. Before implementing:

1. List the files and symbols the research references:
   - `lib/dispatch-store.js` (DISPATCH_TTL_MS constant at line 14, used in pruneExpired() line 88, listAvailable() line 131, enqueue() line 52)
   - `tests/unit/dispatch-store.test.js` (assertion at line 41)
   - `tests/e2e/dispatch.spec.js` (clock mock at line 210)
   - `docs/dispatch-integration.md` (two mentions of "24 hours")

2. Run `git log --since="2026-06-01" -- lib/dispatch-store.js tests/unit/dispatch-store.test.js tests/e2e/dispatch.spec.js docs/dispatch-integration.md` to detect changes since the ticket was created.

3. If any files have changed, re-read those files at HEAD (not the research notes or ticket prose) and reconcile any discrepancies before trusting the research description of line numbers and behavior.

## Context
**Project:** Product  
**Issue:** INF-1 - Bump the dispatch item TTL from 24h to 48h  
**Created:** 2026-06-01T00:00:00Z

**Discussion History:**  
Agent (Jun 2) provided complete research findings: DISPATCH_TTL_MS constant in lib/dispatch-store.js (line 14) is the single source of truth for the 24h TTL. It is read in three places (pruneExpired, listAvailable, enqueue). MongoDB stores absolute `expiresAt` timestamps computed at write time, so changing the constant only affects newly enqueued items; existing rows retain their old expiry. Two tests assert the 24h value (unit test line 41, e2e test line 210 via clock mock). Two doc mentions state "Items expire after 24 hours". Recommended approach: lift the constant to a named export, update both test assertions, update both doc mentions, and add a migration note about in-flight items.

## Goal
**Role**: Implementation engineer

Implement the validated approach from the research comment: update the TTL constant from 24 hours to 48 hours, and update all dependent tests and documentation to reflect the new value. Verify that all tests pass and that the change is complete across all surfaces.

## Implementation Steps

### 1. Update the TTL constant in lib/dispatch-store.js
- Locate `DISPATCH_TTL_MS` at line 14 (currently `24 * 60 * 60 * 1000`)
- Change it to `48 * 60 * 60 * 1000`
- Confirm the constant is used in pruneExpired() (line 88), listAvailable() (line 131), and enqueue() (line 52) — no changes needed at those call sites; they read the constant dynamically
- **Cleanup contract**: The constant change is self-contained; no rollback needed beyond reverting this line

### 2. Update the unit test assertion in tests/unit/dispatch-store.test.js
- Locate the assertion at line 41 that checks `expiresAt - createdAt === 86400000` (24 hours in milliseconds)
- Update the expected value to `172800000` (48 hours in milliseconds: `48 * 60 * 60 * 1000`)
- Run the unit test to confirm it passes: `npm test -- tests/unit/dispatch-store.test.js`
- **Cleanup contract**: Revert the expected value if the test fails; investigate why the constant change did not propagate

### 3. Update the e2e test in tests/e2e/dispatch.spec.js
- Locate the clock mock at line 210 that waits on a 24h boundary
- Update the time value to reflect a 48h boundary (identify the exact value from the test context — do not assume a specific number)
- Run the e2e test to confirm it passes: `npm test -- tests/e2e/dispatch.spec.js`
- **Cleanup contract**: Revert the time value if the test fails; investigate whether the mock setup needs additional changes

### 4. Update documentation in docs/dispatch-integration.md
- Locate both mentions of "Items expire after 24 hours"
- Update each to "Items expire after 48 hours"
- Add a migration note (location: determine from existing doc structure) stating: "**Migration note:** Items enqueued before this change retain their original 24-hour expiry. Only items enqueued after the TTL change will expire after 48 hours."
- **Cleanup contract**: Revert doc changes if they conflict with other documented behavior; verify the migration note is accurate by checking whether the codebase enforces per-item TTL or uses the global constant

### 5. Verify completeness
- Search the codebase for any other references to "24" in the context of dispatch expiry, TTL, or timeout (e.g., comments, configuration files, API contracts, client-side code)
- Confirm no other surfaces reference the old 24h value
- **Cleanup contract**: If additional references are found, update them or document why they are out of scope

### 6. Run full test suite
- Run `npm test` to confirm all tests pass (unit, e2e, and any integration tests)
- Verify no unintended side effects in other modules that depend on dispatch behavior
- **Cleanup contract**: If tests fail, revert changes and investigate the failure before re-attempting

## Testing Strategy
- **Unit tests**: Confirm the assertion in dispatch-store.test.js passes with the new expected value
- **E2E tests**: Confirm the clock mock in dispatch.spec.js passes with the updated boundary
- **Full suite**: Run all tests to detect side effects in dependent modules
- **Manual verification** (if needed): Trace a dispatch item through enqueue → listAvailable → pruneExpired to confirm the 48h TTL is applied correctly

## Completion Checklist
- [ ] DISPATCH_TTL_MS constant updated to 48 hours
- [ ] Unit test assertion updated and passing
- [ ] E2E test clock mock updated and passing
- [ ] Both doc mentions updated to "48 hours"
- [ ] Migration note added to docs
- [ ] No other references to 24h dispatch TTL found in codebase
- [ ] Full test suite passes
- [ ] Comment added to Linear summarizing changes
- [ ] Status moved to "Done"
```
