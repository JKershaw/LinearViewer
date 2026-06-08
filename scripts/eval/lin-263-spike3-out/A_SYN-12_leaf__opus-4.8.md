## Reasoning
**Assessment:**
- Preparation: ✓ Complete — The description contains a documented plan: it enumerates surfaces (session-store.js, server.js, user-preferences.js, migration step, rollback path) and draws dependency arrows (server wiring depends on store rewrite; migration depends on both). The "MangoDB → MongoDB" migration is concrete and the approach is laid out, not hedged.
- Blockers: ✓ None — No `blocked` or `bug` label; no unresolved external dependency.
- Ready: ✓ Yes — A complete plan exists and it has committed to a session-fit answer: the Scope section explicitly states "Needs multiple sessions."

**Signal Status:** plan signal is met — files, surfaces, dependency arrows, and an explicit session-fit decision ("needs multiple sessions") are all documented. This routes directly to breakdown.

→ **breakdown**
**Next:** Subtasks are created (one per surface) with the plan's dependency arrows copied into blocked-by relations; work then proceeds on the first unblocked subtask.

## Prompt

# Break down SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already).
2. **Fetch details**: Get full issue details for SYN-12 in Linear, including the current description and any comments.
3. **Read surfaces and arrows from the plan**: The description's Plan and Scope sections enumerate the surfaces and dependency arrows. Use them as the basis for subtasks (see Goal below).
4. **Create subtasks**: Create one subtask per surface the plan enumerated.
5. **Copy arrows into blocked-by relations**: Translate each dependency arrow the plan drew directly into a `blocked-by` relation between the corresponding subtasks.
6. **Update Linear**: Add a summary comment on SYN-12 listing the subtasks created and the blocking relations established. Keep SYN-12 as the parent.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `session-store.js`, `server.js` (store wiring), `user-preferences.js`.
2. Check whether any have changed since the ticket was created (Created: 2026-06-01): run `git log --since="2026-06-01T00:00:00Z" -- session-store.js server.js user-preferences.js` (adjust to the actual paths once located in the codebase).
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase. If the store rewrite, wiring, or shared-store usage no longer matches what the plan assumes, adjust the subtask boundaries to reflect the code at HEAD.

## Context
- **Project:** Product
- **State:** In Progress (started)
- The plan in the description has already enumerated surfaces and committed to a session-fit answer of "Needs multiple sessions" — this breakdown executes that decision. Do not re-plan; your job is to decompose the existing plan into ordered, actionable subtasks.

## Goal
**Role**: workflow decomposition engineer

Decompose SYN-12 into one subtask per surface the plan enumerated, and copy the plan's dependency arrows directly into `blocked-by` relations so the subtasks can be worked in the correct order.

**Surfaces from the plan** (create one subtask each; confirm against the code at HEAD per the staleness check before finalizing names/boundaries):
- The store rewrite — `session-store.js`
- Server wiring — `server.js` (store wiring)
- Shared-store call site — `user-preferences.js` (shares the store)
- Data migration step
- Rollback path

The plan notes that "migration + rollback alone is its own focused pass" and that "the three call sites each carry distinct edges" — preserve that grouping intent when shaping the subtasks: the migration + rollback pass is one focused unit, and each call site carries its own distinct edges.

**Dependency arrows to copy into `blocked-by` relations** (restate exactly as the plan drew them — do not invent additional ordering):
- Server wiring depends on the store rewrite → the server-wiring subtask is `blocked-by` the store-rewrite subtask.
- Migration depends on both → the migration subtask is `blocked-by` both the store-rewrite subtask and the server-wiring subtask.

For any surface where the plan does not draw an arrow (e.g. the relationship between the rollback path and the migration step, or the `user-preferences.js` call site), do not fabricate a dependency. If the staleness check or the code reveals an ordering the plan did not capture, note it in the summary comment rather than silently adding it.

After creating the subtasks and relations, verify the result is actionable: someone reading the subtask list should be able to identify which subtask is unblocked and can start first (the store rewrite, since nothing blocks it), and work outward through the blocked-by chain.