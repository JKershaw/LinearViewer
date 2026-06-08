# SYN-12-migration — anthropic/claude-opus-4.8
expect={breakdown}  got=breakdown  hit=true  latency=25604ms  cost=$0.08799  body=656w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed - The plan in the description already enumerates surfaces (session-store.js, server.js, user-preferences.js, migration step, rollback path) and dependency arrows (server wiring depends on store rewrite; migration depends on both). The approach is documented, not exploratory. Note: "MangoDB" → "MongoDB" suggests the source is file-based, not an external service requiring research; the target (MongoDB) is a known dependency the implementation phase will verify setup for.
- Blockers: ✓ None - No `blocked` or `bug` label; no unresolved dependency noted.
- Ready: ✓ Yes - A complete plan exists with surfaces and arrows, and it has committed to a session-fit answer: "Needs multiple sessions."

**Signal Status:** plan signals met — surfaces enumerated, dependency arrows drawn, session-fit answer committed ("needs multiple sessions"). This routes directly to breakdown, not back to plan.

→ **breakdown**
**Next:** Subtasks are created (one per surface) with blocked-by relations mirroring the plan's arrows; the unblocked subtasks become individually actionable.

## Prompt

# Break down SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Set SYN-12 status to "In Progress" in Linear (if not already).
2. **Fetch details**: Get full issue details for SYN-12 in Linear, including the Plan and Scope sections of the description.
3. **Read surfaces and arrows from the plan**: The plan already enumerates the surfaces and their dependency arrows — use them directly, do not re-derive them.
4. **Create one subtask per surface** (see Goal for the mapping).
5. **Copy arrows into blocked-by relations** exactly as the plan states them.
6. **Update Linear**: Add a summary comment on SYN-12 listing the subtasks created and the blocked-by relations between them.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `session-store.js`, `server.js` (store wiring), `user-preferences.js` (shares the store).
2. Check whether any have changed since the ticket was created (Created: 2026-06-01T00:00:00Z): run `git log --since="2026-06-01T00:00:00Z" -- session-store.js server.js user-preferences.js` (adjust paths to where these files actually live in the repo).
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the surfaces. In particular, confirm the three call sites still share the store as described and that the file-based store still exists before mapping subtasks.

## Context
- **Project:** Product
- **State:** In Progress (started)
- The plan identifies five surfaces and a stated dependency structure: server wiring depends on the store rewrite; migration depends on both (store rewrite and server wiring). The scope note explicitly says this needs multiple sessions, with migration + rollback as its own focused pass and the three call sites each carrying distinct edges.

## Goal
**Role**: workflow decomposer.

Decompose SYN-12 into one subtask per surface the plan enumerated, and copy the plan's dependency arrows directly into `blocked-by` relations so the subtasks can be worked in the correct order.

**Subtasks to create (one per surface from the plan):**
1. **Store rewrite** — rewrite `session-store.js` to back session storage with MongoDB instead of the file-based store.
2. **Server wiring** — update `server.js` where the store is wired in.
3. **user-preferences.js call site** — update the shared-store usage in `user-preferences.js`.
4. **Data migration + rollback** — the migration step and its rollback path (the plan groups these as one focused pass; keep them together unless re-grounding shows otherwise).

**Dependency arrows to encode as `blocked-by` relations (verbatim from the plan):**
- Server wiring (2) is **blocked by** Store rewrite (1).
- Data migration + rollback (4) is **blocked by** both Store rewrite (1) and Server wiring (2).
- The user-preferences.js call site (3): the plan states each of the three call sites carries distinct edges but only draws an explicit arrow for server wiring. Do not invent a dependency. If re-grounding reveals that `user-preferences.js` consumes the store interface that the rewrite changes, mark it blocked by the Store rewrite; otherwise leave it without a blocked-by relation and note the reasoning in the summary comment.

**Constraints:**
- Do not redesign or re-scope — the plan owns the surface list and the arrows. Your job is faithful translation into subtasks and relations.
- Each subtask description should restate its surface and its blocking relationship; do not add acceptance criteria, schemas, or file paths not present in the plan — instruct the eventual implementer to determine those from the codebase.
- After creating relations, confirm the unblocked subtask(s) — those with no blocked-by — are the natural starting points (the Store rewrite should be the root).

**Update Linear:** Add a comment on SYN-12 summarizing the subtasks created, their IDs, and the blocked-by relations, so someone can immediately start working the unblocked subtask(s) in order.
