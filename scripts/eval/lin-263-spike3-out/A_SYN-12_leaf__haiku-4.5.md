## Reasoning

**Assessment:**
- Preparation: ✗ Needed — The ticket describes a multi-surface migration (session-store.js, server.js, user-preferences.js) with a data migration step and rollback path, but does not document the current file structure, the existing MongoDB schema/contract, how sessions are currently stored, or the target schema. The approach assumes MongoDB is the target but does not pin down initialization, connection setup, or how the migration will preserve existing session data. The ticket names the surfaces but not their current behavior or dependencies.
- Blockers: ✓ None — No `blocked` label present; no external dependencies or decisions blocking work.
- Ready: ✗ No — No implementation plan exists. The description outlines *surfaces* (session-store.js, server.js, user-preferences.js, migration, rollback) and notes they have "distinct edges," but does not document the dependency arrows between them, the current code structure, or a session-fit decision (fits one session / needs multiple sessions). The ticket is in "In Progress" but lacks the plan needed to proceed to implementation or breakdown.

**Signal Status:**
- Plan completeness: Missing. Surfaces are named but not analyzed; no dependency arrows documented; no session-fit answer committed.
- Research completeness: Incomplete. Current session storage behavior, MongoDB contract, and migration strategy are not yet gathered.

→ **research** — Gather the current code structure, session storage contract, and migration feasibility before planning.

**Next:** Once research findings are documented, the plan phase will enumerate surfaces with dependency arrows and commit to a session-fit answer (fits one session / needs multiple sessions), enabling either direct implementation or breakdown into subtasks.

## Prompt

```
# Research SYN-12: Migrate session storage from file-based MongoDB to MongoDB

## Workflow
1. **Start**: Confirm SYN-12 status is "In Progress" in Linear
2. **Fetch details**: Get full issue details for SYN-12 in Linear
3. **Re-ground the ticket**: Check for changes since creation
4. **Gather current state**: Inspect the three named surfaces and their dependencies
5. **Validate the approach**: Confirm MongoDB setup and migration feasibility
6. **Document findings**: Add exploration notes as a comment in Linear
7. **Update Linear**: Add Surface Assessment to the description

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `session-store.js`, `server.js`, `user-preferences.js`, and any data migration or rollback logic.
2. Check whether any have changed since the ticket was created (2026-06-01T00:00:00Z): run `git log --since="2026-06-01" -- session-store.js server.js user-preferences.js` (and any migration/rollback files you identify).
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project**: Product
- **Task**: Migrate session storage from file-based MongoDB to MongoDB
- **Surfaces named**: session-store.js, server.js (store wiring), user-preferences.js (shares the store), data migration step, rollback path
- **Status**: In Progress (started)

## Goal
**Role**: Technical researcher

Understand the current session storage implementation, the target MongoDB contract, and the feasibility of a clean migration with rollback. Identify any prerequisite refactors or setup steps that would make the implementation land cleanly.

## Key Questions to Answer

### Current State
1. **session-store.js**: What is the current session storage mechanism? (file-based, in-memory, or other?) What is the current interface/contract (methods, return types, error handling)?
2. **server.js**: How is the store wired into the server? What initialization or configuration is required?
3. **user-preferences.js**: How does it depend on the session store? What contract does it rely on?
4. **Call sites**: Are there other call sites beyond these three surfaces? Search the codebase for imports or references to session-store to confirm the scope is complete.

### Target State
5. **MongoDB setup**: Is MongoDB already initialized and available in this codebase? If so, where is the connection established, and what is the current schema/contract for any existing MongoDB collections?
6. **Session schema**: What should the MongoDB session document structure be? (e.g., session ID, user ID, data, expiry, timestamps)
7. **Migration strategy**: How will existing sessions (if any) be migrated to MongoDB? What is the rollback strategy if the migration fails or needs to be reversed?

### Feasibility & Dependencies
8. **Breaking changes**: Will the new session-store.js interface differ from the current one? If so, what changes are required in server.js and user-preferences.js?
9. **Initialization order**: Does the MongoDB connection need to be established before the store is instantiated? Are there any async setup steps?
10. **High-churn files**: Have session-store.js, server.js, or user-preferences.js been modified recently (3+ commits in the last few weeks)? If so, what were those changes protecting against, and how should the migration respect them?

## Exploration Steps

1. **Read the current session-store.js**: Document the current interface (exported functions/methods, parameters, return types, error handling).
2. **Trace server.js wiring**: Identify how the store is instantiated and used. Note any configuration or initialization steps.
3. **Check user-preferences.js**: Identify which session-store methods it calls and what contract it depends on.
4. **Search for all call sites**: Run `grep -r "session-store" --include="*.js"` (or equivalent) to confirm no other files depend on the store.
5. **Inspect MongoDB setup**: If MongoDB is already in use, find the connection code and any existing schema patterns. If not, identify where and how it should be initialized.
6. **Check git history**: For each of the three surfaces, run `git log --oneline -10 -- <file>` to see recent changes and understand what they were addressing.

## Surface Assessment

After exploration, provide an explicit answer to this question:

**Can the implementation land cleanly on the current code, or is a prerequisite refactor needed?**

- **Yes, implementation can land cleanly**: [Describe why — e.g., "The current session-store.js interface is stable and can be reimplemented with MongoDB without breaking changes to call sites."]
- **Refactor needed**: [Describe the minimal scoped change — e.g., "session-store.js exports a factory function that accepts a storage backend; refactor server.js to pass a MongoDB backend instead of a file backend. This is a single-surface change that does not affect user-preferences.js."]

Do not leave this answer implied — state it explicitly so the plan phase can act on it.

## Deliverable

Add a comment to SYN-12 in Linear with:
- Current session storage mechanism and interface
- MongoDB setup status and schema (if applicable)
- Migration and rollback strategy (high-level)
- Any breaking changes or initialization dependencies
- Surface Assessment (explicit yes/no + reasoning)

Then update the issue description with the Surface Assessment so the plan phase can reference it.
```