# INF-1-ttl-deep — openai/gpt-5.4-mini
expect={implement|plan}  got=implement  hit=true  latency=5614ms  cost=$0.00751725  body=370w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The discussion comment already contains concrete research findings: the TTL constant location, the read sites, the persistence behavior, and the tests/docs affected.
- Blockers: ✓ None - No blocker or bug labels are given, and the comment does not indicate an external dependency blocking progress.
- Ready: ✓ No - The work is not yet implemented, and the findings indicate a multi-surface change still needs execution.

**Signal Status:** Research already done; implementation surface is known; no blockers/bugs indicated.

→ **implement** — use EXACTLY one action name, verbatim, from this list: blocked, bug, plan, code review, look into, triage, breakdown, research, scoping, design, spike, context, implement, review, defer. This name is parsed into a machine-readable kind downstream, so do not rename, pluralize, or invent a value outside the list.
**Next:** Implement the TTL increase, update the affected tests and docs, then add a summary comment in Linear with any migration note about existing items.

## Prompt
# Implement INF-1: Bump the dispatch item TTL from 24h to 48h

## Workflow
1. **Start**: Set INF-1 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for INF-1 in Linear
3. Implement the TTL change end to end based on the research findings already in the discussion: update the dispatch expiry constant, the places that read it, the unit test expectations, the e2e test boundary, and the two documentation mentions of 24 hours.
4. Verify the change for unintended side effects in the dispatch flow, especially around existing in-flight items whose expiry was already written before this change; confirm the migration note reflects that those items keep their old expiry.
5. **Update Linear**: Add a comment summarizing the change, the tests/docs updated, and the note about existing rows keeping their old expiry.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references.
2. Check whether any have changed since the ticket was created (use the **Created** date from the Task Context): run `git log --since="2026-06-01T00:00:00Z" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
Project: Product.
Discussion history includes one research comment that traced the dispatch expiry end to end: `DISPATCH_TTL_MS` in `lib/dispatch-store.js` is used in `pruneExpired()`, `listAvailable()`, and `enqueue()`, with persistence storing absolute `expiresAt` timestamps, so the change affects only items enqueued after the update. The same comment identified the unit test in `tests/unit/dispatch-store.test.js`, the e2e test in `tests/e2e/dispatch.spec.js`, and documentation in `docs/dispatch-integration.md`.

**Discussion History:** Research findings already identify the relevant constant, read sites, tests, docs, and the migration note for in-flight items.

## Goal
**Role**: implementation engineer

Make the TTL increase consistently across the code paths already identified in the discussion findings, update the related tests and docs, and preserve the stated behavior that existing stored items keep their previously written expiry.
