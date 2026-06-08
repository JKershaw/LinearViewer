## Reasoning
**Assessment:**
- Preparation: [✓ Complete] - The issue description already contains a documented plan listing surfaces, dependency arrows, and a session-fit scope assessment ("Needs multiple sessions").
- Blockers: [✓ None] - No active blockers or bugs are indicated.
- Ready: [✓ Yes] - Since a complete plan exists and it specifies that the task "needs multiple sessions", the next logical step is to break it down into subtasks.

**Signal Status:**
- Plan has documented surfaces and dependency arrows: Met
- Plan commits to a session-fit answer ("needs multiple sessions"): Met

→ **breakdown**
**Next:** The developer will work on the individual subtasks created during this breakdown phase.

## Prompt
```markdown
# breakdown SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear
3. **Analyze Plan**: Read the surfaces, dependency arrows, and scope details from the SYN-12 description.
4. **Create Subtasks**: Create a subtask in Linear for each of the surfaces identified in the plan:
   - Rewrite `session-store.js`
   - Wire store in `server.js`
   - Update `user-preferences.js`
   - Implement data migration step
   - Implement rollback path
5. **Establish Relationships**: Link the subtasks using `blocked-by` relations in Linear based on the dependency arrows:
   - The `server.js` wiring subtask is blocked by the `session-store.js` rewrite subtask.
   - The data migration step subtask is blocked by both the `session-store.js` rewrite subtask and the `server.js` wiring subtask.
6. **Update Linear**: Add a comment to SYN-12 summarizing the created subtasks and their relationships.

Always include the "Start" step to ensure work visibility.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references (`session-store.js`, `server.js`, `user-preferences.js`).
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z"` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project**: Product
- **Issue**: SYN-12 - Migrate session storage from file-based MangoDB to MongoDB
- **Plan from Description**: 
  - Surfaces: `session-store.js`, `server.js` (store wiring), `user-preferences.js` (shares the store), a data migration step, and a rollback path.
  - Arrows: server wiring depends on the store rewrite; migration depends on both.
  - Scope: Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.

## Goal
**Role**: Workflow Coordinator / Analyst

Decompose the SYN-12 migration plan into individual, tracked subtasks in Linear, mapping the specified dependency arrows directly to `blocked-by` relations.

Ensure no additional files, schemas, or requirements are assumed beyond what is explicitly written in the task description. If any subtask requires further details (such as the specific MongoDB connection configuration or MangoDB schema), instruct the assignee of that subtask to determine it from the codebase.
```