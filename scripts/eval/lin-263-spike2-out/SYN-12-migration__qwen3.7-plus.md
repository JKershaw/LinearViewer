# SYN-12-migration — qwen/qwen3.7-plus
expect={breakdown}  got=breakdown  hit=true  latency=48455ms  cost=$0.0062924  body=306w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The task description already contains a detailed plan with surfaces, dependency arrows, and a session-fit assessment.
- Blockers: ✓ None - No blockers or bugs indicated in the context.
- Ready: ✓ Yes - The plan explicitly states "Needs multiple sessions", making it ready for breakdown into subtasks.

**Signal Status:** Plan core signal met (implementation plan documented with session-fit decision made).

→ **breakdown**
**Next:** Subtasks will be created for each surface with dependency arrows mapped to `blocked-by` relations.

## Prompt
# Breakdown SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear
3. **Read plan**: Extract the surfaces and dependency arrows from the issue description.
4. **Create subtasks**: Create one subtask per surface (session-store.js, server.js, user-preferences.js, data migration step, rollback path).
5. **Map dependencies**: Copy the dependency arrows directly into `blocked-by` relations (server wiring depends on store rewrite; migration depends on both).
6. **Update Linear**: Add a summary comment listing the created subtasks and their dependencies.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
Project: Product
Plan surfaces: session-store.js, server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
Arrows: server wiring depends on the store rewrite; migration depends on both.
Scope: Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.

## Goal
**Role**: Task decomposer

Create one subtask per surface the plan enumerated, and copy any dependency arrows directly into blocked-by relations.

Ensure each subtask is actionable and clearly scoped based on the plan's description of distinct edges and focused passes.
