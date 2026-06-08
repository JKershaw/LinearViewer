## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The issue already contains a concrete plan with referenced surfaces and a session-fit answer (`needs multiple sessions`).
- Blockers: ✓ None - No `blocked` label or blocking dependency is provided in the task context.
- Ready: ✓ Yes - The task is not for implementation yet; the plan indicates it should be broken down first.

**Signal Status:** Plan exists; session-fit answer is `needs multiple sessions`.

→ **breakdown** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
**Next:** Create one subtask per surfaced area and copy the plan’s dependency arrows into blocked-by relations, then comment back in Linear.

## Prompt
# Breakdown SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear
3. Read the plan in the issue description and identify the surfaces it names: `session-store.js`, `server.js (store wiring)`, `user-preferences.js (shares the store)`, and `a data migration step`, plus `a rollback path`.
4. Create one subtask per surface the plan enumerates.
5. Copy the plan’s dependency arrows directly into `blocked-by` relations: server wiring depends on the store rewrite; migration depends on both.
6. Make sure the subtasks reflect the plan’s session-fit answer: the task needs multiple sessions, so the subtasks should preserve that split rather than collapsing the work into one item.
7. **Update Linear**: Add a summary comment noting the subtasks created and the dependency arrows copied over.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
Project: Product. The issue is already In Progress and its plan says it needs multiple sessions. The plan names these surfaces and dependency arrows; use only those details when creating subtasks.

## Goal
**Role**: workflow coordinator

Decompose the planned work into actionable subtasks, preserving the plan’s stated dependencies and session split so implementation can proceed in separate sessions.