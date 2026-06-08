# SYN-12-migration — openai/gpt-5.4-mini
expect={breakdown}  got=breakdown  hit=true  latency=4770ms  cost=$0.0069795  body=333w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The ticket already contains a plan with named surfaces and arrows, so no separate research pass is needed from the task context alone.
- Blockers: ✓ None - No `blocked` label or external dependency is mentioned.
- Ready: ✗ No - The plan explicitly says the task **needs multiple sessions**, so this should move to breakdown rather than implementation.

**Signal Status:** Plan exists; session-fit answer is explicitly **needs multiple sessions**.

→ **breakdown** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
**Next:** Decompose the planned surfaces into one subtask per surface and copy the dependency arrows into blocked-by relations so implementation can proceed in ordered sessions.

## Prompt
# Breakdown SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear
3. Read the plan in the issue description and identify the surfaces it names: session-store.js, server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
4. Create one subtask per surface the plan enumerates.
5. Copy the dependency arrows from the plan into `blocked-by` relations so the ordering is preserved.
6. Add a summary comment in Linear noting the subtasks and their dependency order.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
Project: Product
Issue: SYN-12 - Migrate session storage from file-based MangoDB to MongoDB
State: In Progress (started)
Description plan surfaces: session-store.js, server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
The plan states that server wiring depends on the store rewrite; migration depends on both.
Scope note: migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.

## Goal
**Role**: workflow coordinator

Break this multi-session migration into one subtask per named surface, preserving the dependency arrows exactly as described in the plan. Ensure the resulting subtasks are ordered so later work can depend on earlier work without collapsing distinct edges into a single item.
