## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - The ticket's description contains a documented plan with surfaces, dependency arrows, and an explicit session-fit answer ("Needs multiple sessions"). The knowledge needed to proceed is in the codebase and the plan itself; no further research is required.
- Blockers: ✓ None - No blocker labels, no unresolved dependencies mentioned.
- Ready: ✓ Yes - A plan exists and the session-fit answer directs to breakdown. The task is "In Progress" but has not yet been decomposed into subtasks.

**Signal Status:** The plan signal is met: surfaces enumerated, arrows documented, session-fit answer committed. The only remaining step before implementation across multiple sessions is to create subtasks with blocked-by relations.

→ **breakdown** — creates one subtask per surface and copies dependency arrows into blocked-by relations.
**Next:** Each subtask can be worked in order; implementation of the store rewrite can begin on the first subtask.

## Prompt

# Break Down SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear  
3. **Break down**:  
   - Read the plan enumerated in the issue description: surfaces are `session-store.js`, `server.js` (store wiring), `user-preferences.js` (shares the store), a data migration step, and a rollback path.  
   - For each surface, create a separate subtask under SYN-12. Use descriptive titles that match the surface (e.g., "Rewrite session-store.js to use MongoDB", "Wire store in server.js", etc.).  
   - Apply the dependency arrows exactly as stated:  
     - `server.js` wiring depends on the store rewrite.  
     - Migration depends on both `session-store.js` and `server.js`.  
   - Create the subtasks with initial status and assign the blocked-by relations: the subtask for `server.js` should block on the store rewrites subtask; the migration subtask should block on both the store rewrite and server wiring subtasks.  
   - The rollback path is a separate surface — decide its own dependencies based on the plan (it may not block or be blocked by others; the ticket does not specify arrows for it, so leave it without blocked-by unless you find otherwise in the codebase).  
   - Ensure the data migration and rollback subtasks are created as distinct subtasks (the ticket says they "each carry distinct edges" and are "its own focused pass").
4. **Update Linear**: Add a summary comment listing the subtasks created and their blocked-by relations.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `session-store.js`, `server.js`, `user-preferences.js`.
2. Check whether any have changed since the ticket was created (use the **Created** date: `2026-06-01`): run `git log --since="2026-06-01" -- session-store.js server.js user-preferences.js` and any other relevant paths you discover.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Issue**: SYN-12 – Migrate session storage from file-based MangoDB to MongoDB  
- **State**: In Progress (started)  
- **Created**: 2026-06-01  
- **Description plan**: Surfaces and arrows provided; session-fit answer is "needs multiple sessions".

## Goal
**Role**: workflow coordinator / breakdown engineer

Decompose SYN-12 into actionable subtasks that can be worked sequentially, respecting the dependency arrows documented in the plan. Ensure the subtasks cover all five surfaces (store rewrite, server wiring, user-preferences.js, migration, rollback) and that the blocked-by relations enforce the ordering: server wiring after store rewrite, migration after both. This enables parallel work on non-blocked subtasks and prevents ordering mistakes during implementation.