# INF-1-ttl-deep — google/gemini-3.5-flash
expect={implement|plan}  got=plan  hit=true  latency=14994ms  cost=$0.036384  body=524w

---

## Reasoning
**Assessment:**
- Preparation: [✓ Complete] - Detailed research findings have already been gathered and documented in the comment by the agent on Jun 2, 2026, identifying the exact constant, read sites, database behavior, tests, and documentation.
- Blockers: [✓ None] - No active blockers or bugs are identified.
- Ready: [✗ No] - While the research is complete, there is no finalized implementation plan documented in the issue description, and no session-fit commitment ("fits one session" vs "needs multiple sessions") has been made.

**Signal Status:**
- `research` signals met: Key questions answered with actionable recommendations in the comments.
- `plan` signals unmet: Implementation plan is not yet documented in the description, and the session-fit decision is not made.

→ **plan**
**Next:** Once the plan is documented and the session-fit answer is committed to, the developer can proceed to implementation or breakdown.

## Prompt
```markdown
# Plan INF-1: Bump the dispatch item TTL from 24h to 48h

## Workflow
1. **Start**: Set INF-1 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for INF-1 in Linear
3. **Analyze and Plan**:
   - Review the research findings in the discussion history.
   - Perform a completeness check: Search the codebase for the concept of dispatch TTL, expiry, or `24` hour intervals to confirm the list of surfaces identified in the research is complete (and not just correct). Mark any additional instances found as in- or out-of-scope.
   - Check for high-churn files: Check if `lib/dispatch-store.js` has 3+ commits in recent history. If so, document what those changes were protecting against.
   - Perform a cross-cutting concerns check: Analyze whether the TTL change, the MangoDB absolute timestamp write behavior, the sweep prune, or the poll filter share the same code path, state, or interface, and document their expected interactions.
   - **Strategy Framing**:
     - Score viable strategies on *cost-of-doing* (current-ticket session size, blast radius, risk to high-churn files) vs *cost-of-not-doing* (named contract gap left unsolved, plus the workaround tax paid on every future change).
     - If a cheaper strategy routes around a tracked contract gap, name that gap explicitly (provide a ticket identifier or state "none identified").
     - For migration/convergence/pre-launch parent epics, default to closing the gap unless cost-of-doing is prohibitively higher.
   - **Scope Assessment**:
     - Enumerate all surfaces to be modified (including code, tests, and documentation) and draw any dependency arrows between them.
     - Commit to a session-fit answer: State explicitly whether this work "fits one session" or "needs multiple sessions".
4. **Update Linear**: Update the INF-1 issue description with the finalized implementation plan, the enumerated surfaces with dependency arrows, and the session-fit answer.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `lib/dispatch-store.js`, `DISPATCH_TTL_MS`, `tests/unit/dispatch-store.test.js`, `tests/e2e/dispatch.spec.js`, and `docs/dispatch-integration.md`.
2. Check whether any have changed since the ticket was created (2026-06-01T00:00:00Z): run `git log --since="2026-06-01T00:00:00Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project**: Product
- **Discussion History**: 
  - **agent** (Jun 2, 2026) identified that `DISPATCH_TTL_MS` lives in `lib/dispatch-store.js` line 14 (`24 * 60 * 60 * 1000`). It is read in `pruneExpired()` (line 88), `listAvailable()` (line 131), and `enqueue()` (line 52). The MangoDB file store persists items with an `expiresAt` absolute timestamp computed at write time, meaning existing rows keep their old expiry. Unit tests in `tests/unit/dispatch-store.test.js` (line 41) and e2e tests in `tests/e2e/dispatch.spec.js` (line 210) assert the 24h boundary. Consumer docs in `docs/dispatch-integration.md` also mention the 24-hour expiry.

## Goal
**Role**: Technical Planner

Create a clear implementation plan to bump the dispatch item TTL from 24h to 48h, addressing the constant change, test updates, documentation updates, and the migration implications for in-flight items.
```
