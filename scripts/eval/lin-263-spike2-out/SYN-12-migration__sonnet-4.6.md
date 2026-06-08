# SYN-12-migration — anthropic/claude-sonnet-4.6
expect={breakdown}  got=breakdown  hit=true  latency=27375ms  cost=$0.034035  body=570w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed — the ticket describes a concrete migration with named surfaces and dependency arrows; the substance is known enough to plan.
- Blockers: ✓ None — no blocked label or unresolved dependencies noted.
- Ready: ✗ No — a plan exists in the description (surfaces, dependency arrows, session-fit answer), and the session-fit answer is explicitly "needs multiple sessions." The next action is `breakdown` to create subtasks from the plan's enumerated surfaces and copy dependency arrows into blocked-by relations.

**Signal Status:** Plan signals met (surfaces enumerated, dependency arrows drawn, session-fit answered as "needs multiple sessions"). Breakdown not yet done — no subtasks exist.

→ **breakdown** — the plan has committed to "needs multiple sessions"; subtasks must be created before implementation can begin.
**Next:** Once subtasks exist with blocked-by relations, implementation can proceed surface by surface in dependency order.

---

## Prompt

# Break down SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear
3. Read the plan in the description — extract every named surface and every dependency arrow
4. Create one subtask per surface, with titles and descriptions derived directly from the plan
5. Copy every dependency arrow from the plan into `blocked-by` relations between the new subtasks
6. **Update Linear**: Add a comment to SYN-12 summarising the subtasks created and the blocking order; confirm the parent task links to all children

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `session-store.js`, `server.js`, `user-preferences.js`, and the migration/rollback step.
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-01" -- session-store.js server.js user-preferences.js` (and any paths you locate for the migration/rollback artefacts).
3. If any have changed, re-read that source at HEAD — not your notes or the ticket prose — and reconcile any discrepancies before trusting the ticket's description of the surfaces or their dependency arrows.

## Context
- **Project:** Product
- **Issue:** SYN-12 — Migrate session storage from file-based MangoDB to MongoDB
- **Plan state:** Complete. The description enumerates surfaces and dependency arrows and has committed to "needs multiple sessions." This breakdown step translates that plan directly into subtasks — it does not re-plan or add new surfaces.

## Goal
**Role**: Workflow coordinator

Read the plan's enumerated surfaces and dependency arrows exactly as written, create one Linear subtask per surface, and wire the dependency arrows as `blocked-by` relations so implementation can proceed in the correct order.

### Surfaces to decompose (from the plan)
The plan names these surfaces — use them as the basis for subtask titles. Do not invent additional surfaces or collapse any together:

1. `session-store.js` — rewrite the store
2. `server.js` — store wiring (depends on the session-store rewrite)
3. `user-preferences.js` — call site that shares the store (depends on the session-store rewrite)
4. Data migration step (depends on both the store rewrite and server wiring)
5. Rollback path (scoped together with the migration step per the plan's note that "migration + rollback alone is its own focused pass")

### Dependency arrows to encode as `blocked-by` relations
Directly from the plan:
- Server wiring (`server.js`) is blocked by the session-store rewrite (`session-store.js`)
- Migration step is blocked by both the store rewrite (`session-store.js`) and server wiring (`server.js`)
- Rollback path is scoped with the migration step (treat as a single subtask or as blocked-by migration — use whichever Linear models the plan's intent most faithfully; note your choice in the summary comment)

### Subtask content
For each subtask:
- Title: surface name as above
- Description: copy the relevant excerpt from SYN-12's plan, including any dependency notes
- Parent: SYN-12
- `blocked-by`: as per the arrows above

### Summary comment
After creating all subtasks, add a comment to SYN-12 that:
- Lists each subtask with its Linear identifier
- States the blocking order explicitly (e.g. "subtask A must complete before subtask B can start")
- Notes any modelling decision made for the rollback/migration pairing
