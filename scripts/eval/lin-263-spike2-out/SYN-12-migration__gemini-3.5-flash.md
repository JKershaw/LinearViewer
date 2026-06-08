# SYN-12-migration — google/gemini-3.5-flash
expect={breakdown}  got=breakdown  hit=true  latency=14796ms  cost=$0.035448  body=435w

---

## Reasoning
**Assessment:**
- Preparation: [✓ Complete] - The issue description already contains a structured plan listing surfaces, dependency arrows, and a scope assessment.
- Blockers: [✓ None] - No active blockers or bugs are indicated.
- Ready: [✓ Yes] - The plan is complete and explicitly commits to a session-fit answer of "needs multiple sessions".

**Signal Status:**
- `plan` core signals met: The plan documents the surfaces (`session-store.js`, `server.js`, `user-preferences.js`, data migration, rollback), dependency arrows (server wiring depends on store rewrite; migration depends on both), and commits to "needs multiple sessions".

→ **breakdown**
**Next:** The developer will begin implementing the first unblocked subtask created during this breakdown.

## Prompt
```
# Breakdown SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear
3. **Analyze Plan**: Read the surfaces, dependency arrows, and scope notes from the issue description.
4. **Create Subtasks**: Create one subtask in Linear for each surface and step enumerated in the plan:
   - Rewrite `session-store.js` to use MongoDB
   - Wire the new store in `server.js`
   - Update `user-preferences.js` to share the new store
   - Implement the data migration step
   - Implement the rollback path
5. **Establish Dependencies**: Copy the dependency arrows from the plan into "blocked-by" relations in Linear:
   - The `server.js` wiring subtask must be blocked by the `session-store.js` rewrite subtask.
   - The data migration subtask must be blocked by both the `session-store.js` rewrite and the `server.js` wiring subtasks.
6. **Update Linear**: Add a summary comment to SYN-12 listing the created subtasks and their dependency relationships, then mark the breakdown action as complete.

Always include the "Start" step to ensure work visibility.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references (`session-store.js`, `server.js`, `user-preferences.js`).
2. Check whether any have changed since the ticket was created (2026-06-01T00:00:00Z): run `git log --since="2026-06-01T00:00:00Z" -- session-store.js server.js user-preferences.js` (and any other relevant paths found in the codebase).
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project**: Product
- **Issue**: SYN-12 - Migrate session storage from file-based MangoDB to MongoDB
- **Current Plan**: 
  - Surfaces: `session-store.js`, `server.js` (store wiring), `user-preferences.js` (shares the store), a data migration step, and a rollback path.
  - Arrows: server wiring depends on the store rewrite; migration depends on both.
  - Scope: Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.

## Goal
**Role**: Systems Analyst / Technical Coordinator

Decompose the documented migration plan into individual, trackable subtasks in Linear, preserving all dependency relationships specified in the plan.

Do not make implementation decisions, define database schemas, or write code during this breakdown. If any specific configuration details, connection parameters, or API contracts are required for the subtasks, instruct the downstream implementers to determine them directly from the codebase.
```
