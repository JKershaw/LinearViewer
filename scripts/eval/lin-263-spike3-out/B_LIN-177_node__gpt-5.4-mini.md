## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The issue already contains a detailed, validated breakdown of the remaining surfaces, dependencies, and testing approach.
- Blockers: ✓ None - The blocker dependency is explicitly satisfied; LIN-176 is done.
- Ready: ✗ No - The task is a node with remaining subtasks, and the plan says it needs multiple sessions.

**Signal Status:** Plan exists; session-fit answer is “needs multiple sessions”; 6 subtasks total, 2 done, 4 remaining. Breakdown is the correct next node-level action.

→ **breakdown** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
**Next:** Create one subtask per planned surface and copy the dependency arrows into `blocked-by` relations so the work can be executed in order.

## Prompt
# Breakdown LIN-177: Phase 3: Source Tracking & Multi-Provider Rendering

## Workflow
1. **Start**: Set LIN-177 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for LIN-177 in Linear
3. Use the existing plan in the issue description to create one subtask per surface, and copy each dependency arrow into `blocked-by` relations exactly as documented.
4. Include the S3-adjacent client display strings in scope if they are part of the surface list, and keep out-of-scope consumer re-pointing routed elsewhere as documented in the plan.
5. **Update Linear**: Add a summary comment noting the subtasks created, the dependency arrows copied, and any explicitly out-of-scope items left for other tickets.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-02-11T09:49:35.867Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product
**Parent:** LIN-177 — Phase 3: Source Tracking & Multi-Provider Rendering
**Discussion History:** The issue already contains the re-grounded plan, dependency arrows, session-fit decision, and the 6 planned subtasks (S0–S5). The remaining work is to materialize those subtasks and relations in Linear.

## Goal
**Role**: workflow coordinator / decomposition operator

Your objective is to turn the documented plan into Linear subtasks with the blocked-by ordering preserved exactly as specified. Confirm the plan’s session-fit decision by creating the subtasks rather than re-litigating implementation details.