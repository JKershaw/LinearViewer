# SYN-12-migration — deepseek/deepseek-v4-flash
expect={breakdown}  got=breakdown  hit=true  latency=25819ms  cost=$0.001481102  body=492w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete – The ticket already contains a plan with enumerated surfaces (session-store.js, server.js, user-preferences.js, migration, rollback) and explicit dependency arrows ("server wiring depends on the store rewrite; migration depends on both"). The plan also commits to a session-fit answer ("Needs multiple sessions"). No research gaps remain.
- Blockers: ✓ None – No blocked label or bug label indicated. Status is already "In Progress", implying work is ongoing.
- Ready: ✓ Yes – The plan is documented and the session-fit answer is "needs multiple sessions", which directly routes to breakdown.

**Signal Status:** Plan is complete (surfaces enumerated, arrows documented, session-fit answer given). No prior breakdown exists.

→ **breakdown** — Create subtasks per surface with `blocked-by` relations, enabling parallel or sequenced execution.
**Next:** After breakdown, each subtask can be worked on independently or in dependency order. The developer or coordinator can then decide which subtask to start.

## Prompt
```
# Breakdown SYN-12: Migrate session storage from file-based MangoDB to MongoDB

## Workflow
1. **Start**: Ensure SYN-12 status is set to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-12 in Linear – reread the description's surface list and dependency arrows.
3. **Breakdown**:
   - Create **one subtask per surface** the plan enumerates:
     * Surface 1: **session-store.js** – Rewrite the store to use MongoDB instead of file-based MangoDB.
     * Surface 2: **server.js** – Wire the new store into the server (stores wiring code).
     * Surface 3: **user-preferences.js** – Update this file to share the new store (it shares the store).
     * Surface 4: **Data migration + rollback path** – According to the plan, "migration + rollback alone is its own focused pass". Create one subtask for both.
   - **Copy dependency arrows into `blocked-by` relations**:
     * The plan states: "server wiring depends on the store rewrite; migration depends on both."
     * Therefore:
       - Subtask 2 (server.js) → blocked-by Subtask 1 (session-store.js)
       - Subtask 4 (migration+rollback) → blocked-by Subtask 1 AND Subtask 2
     * Subtask 3 (user-preferences.js) is not explicitly arrowed but the description says it "shares the store", which implies it also depends on the store rewrite. Set Subtask 3 → blocked-by Subtask 1.
   * **New subtask titles** (create these in Linear under SYN-12):
     - SYN-12-A: Rewrite session-store.js to MongoDB
     - SYN-12-B: Wire new store in server.js
     - SYN-12-C: Update user-preferences.js to share the new store
     - SYN-12-D: Data migration and rollback path
4. **Update Linear**: Add a summary comment to SYN-12 listing the created subtasks and their `blocked-by` relationships. Set SYN-12 status to "Breakdown complete" or equivalent in your workflow.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references: `session-store.js`, `server.js`, `user-preferences.js`.
2. Check whether any have changed since the ticket was created (2026-06-01T00:00:00Z): run `git log --since="2026-06-01" -- session-store.js server.js user-preferences.js` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
**Project:** Product  
**Issue:** SYN-12 – Migrate session storage from file-based MangoDB to MongoDB  
**Status:** In Progress (started)  
**Plan (from description):** Surfaces: session-store.js, server.js (store wiring), user-preferences.js (shares the store), data migration step, and rollback path. Dependencies: server wiring depends on store rewrite; migration depends on both. Scope: "Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges."

## Goal
**Role:** Breakdown specialist  
**Objective:** Decompose the multi-session plan into actionable subtasks, each corresponding to one surface, with explicit `blocked-by` relations that mirror the plan's dependency arrows. This enables sequential or parallel execution of the migration work.
```
