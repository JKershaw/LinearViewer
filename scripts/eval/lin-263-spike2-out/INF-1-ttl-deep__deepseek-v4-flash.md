# INF-1-ttl-deep — deepseek/deepseek-v4-flash
expect={implement|plan}  got=implement  hit=true  latency=25831ms  cost=$0.00136766  body=617w

---

##Reasoning
**Assessment:**
- Preparation: ✓ Complete - The agent's research comment (Jun 2, 2026) already traced the TTL constant end-to-end, identified all files, tests, and docs, and recommended a validated approach. No further discovery needed.
- Blockers: ✓ None
- Ready: ✓ Yes - The task is small, well-scoped, and the plan is clear from the research findings. It fits one focused session.

**Signal Status:** Research signals met (key questions answered, actionable recommendations). Plan signals not formally documented in description, but the research comment serves as a de facto plan. Implementation can proceed directly.

→ **implement** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
**Next:** After implementation, the code changes will be ready for review and merge.
**DeferTo:** (omit)

## Prompt
# Implement INF-1: Bump the dispatch item TTL from 24h to 48h

## Workflow
1. **Start**: Set INF-1 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for INF-1 in Linear
3. **Implement changes** (see Goal below)
4. **Update Linear**: Add a comment summarizing what was changed, then set status to "In Review"

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `lib/dispatch-store.js` (symbols: `DISPATCH_TTL_MS`, `pruneExpired`, `listAvailable`, `enqueue`, `expiresAt`, `createdAt`), `tests/unit/dispatch-store.test.js` (line 41), `tests/e2e/dispatch.spec.js` (line 210), `docs/dispatch-integration.md`.
2. Check whether any have changed since the ticket was created (2026-06-01): run `git log --since="2026-06-01" -- lib/dispatch-store.js tests/unit/dispatch-store.test.js tests/e2e/dispatch.spec.js docs/dispatch-integration.md`.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product  
**Discussion History:** The agent's research comment (Jun 2, 2026) traced the TTL end-to-end. Key findings:
- `DISPATCH_TTL_MS` constant in `lib/dispatch-store.js` line 14 is `24 * 60 * 60 * 1000`.
- Used in `pruneExpired()` (line 88), `listAvailable()` (line 131), and `enqueue()` (line 52).
- MangoDB file store persists `expiresAt` absolute timestamp at write time — changing the constant only affects new items; existing rows keep old expiry.
- Unit test at `tests/unit/dispatch-store.test.js` line 41 asserts `expiresAt - createdAt === 86400000`.
- E2e test at `tests/e2e/dispatch.spec.js` line 210 waits on a 24h boundary via clock mock.
- Docs at `docs/dispatch-integration.md` state "Items expire after 24 hours" in two places.
- Recommended approach: lift the constant to a named export, update both tests' expected value, update both doc mentions, and add a migration note that in-flight items keep the old expiry.

## Goal
**Role**: Implementation engineer

Implement the planned changes to bump the dispatch item TTL from 24 hours to 48 hours. Follow the approach from the research comment: lift the constant to a named export, update the unit test and e2e test expected values, update both doc mentions in `docs/dispatch-integration.md`, and add a migration note about in-flight items keeping the old expiry.

### Implementation Steps
1. **Modify `lib/dispatch-store.js`**:
   - Change `DISPATCH_TTL_MS` from `24 * 60 * 60 * 1000` to `48 * 60 * 60 * 1000`.
   - Export the constant as a named export (e.g., `export const DISPATCH_TTL_MS = ...`) so it can be referenced in tests and docs.
   - Ensure all three usage sites (`pruneExpired`, `listAvailable`, `enqueue`) continue to reference the exported constant.

2. **Update `tests/unit/dispatch-store.test.js`**:
   - Change the assertion on line 41 from `86400000` (24h in ms) to `172800000` (48h in ms).
   - If the test imports the constant directly, update the import to use the named export.

3. **Update `tests/e2e/dispatch.spec.js`**:
   - Change the clock mock boundary on line 210 from 24h to 48h (i.e., advance time by 48 hours instead of 24).

4. **Update `docs/dispatch-integration.md`**:
   - Replace both occurrences of "Items expire after 24 hours" with "Items expire after 48 hours".
   - Add a migration note: "Note: Items enqueued before this change retain their original 24-hour expiry; only new items use the 48-hour TTL."

5. **Test for unintended side effects**:
   - Run the full test suite for the dispatch store (unit and e2e) to confirm all tests pass.
   - Verify that no other code paths implicitly depend on the old 24h value (e.g., hardcoded `86400000` elsewhere). If any are found, update them or document as out of scope.

6. **Commit** with a descriptive message, e.g., `feat: bump dispatch item TTL from 24h to 48h`.
