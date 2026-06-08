# INF-1-ttl-deep — anthropic/claude-opus-4.8
expect={implement|plan}  got=plan  hit=true  latency=38511ms  cost=$0.11453  body=1056w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The agent comment contains thorough end-to-end research: the constant's location, all three read sites, the absolute-timestamp persistence quirk (existing rows keep old expiry), the two affected tests with their assertions, the two doc mentions, and a recommended approach. Substance is in hand.
- Blockers: ✓ None - No blocked or bug labels; the migration nuance is documented, not unresolved.
- Ready: ✗ No - Research is complete and a clear approach is recommended, but no committed implementation plan with a session-fit answer exists in the description yet. The change is multi-surface (constant + 3 read sites context + 2 tests + 2 docs + migration note), so a quick plan to enumerate surfaces and confirm session-fit is the right next step.

**Signal Status:** research signal met (key questions answered, actionable recommendation given, surface assessment implied via the "lift constant to named export" suggestion). plan signal unmet (no documented plan / session-fit decision in description).

→ **plan**
**Next:** With surfaces enumerated and a session-fit answer committed, route to implementation (likely fits one session) or breakdown.

## Prompt

# Plan INF-1: Bump the dispatch item TTL from 24h to 48h

## Workflow
1. **Start**: Set INF-1 status to "In Progress" in Linear (if not already).
2. **Fetch details**: Get full issue details for INF-1 in Linear, including the research comment.
3. **Analyze and enumerate surfaces**: Work through the steps below, then document the plan in the description.
4. **Update Linear**: Write the finalized plan (surfaces, dependency arrows, session-fit answer) into the issue description; keep exploration notes in comments.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — the research comment was written Jun 2 and the ticket Jun 1; later commits may have moved things.
1. List the files and symbols the ticket and comment reference: `lib/dispatch-store.js` (`DISPATCH_TTL_MS` at line 14, `pruneExpired()` line 88, `listAvailable()` line 131, `enqueue()` line 52, `expiresAt`), `tests/unit/dispatch-store.test.js` (assertion line 41), `tests/e2e/dispatch.spec.js` (clock mock line 210), `docs/dispatch-integration.md`.
2. Check whether any have changed since creation: run `git log --since="2026-06-01T00:00:00Z" -- lib/dispatch-store.js tests/unit/dispatch-store.test.js tests/e2e/dispatch.spec.js docs/dispatch-integration.md`.
3. If any changed, re-read that source at HEAD (not the comment or ticket prose) and reconcile discrepancies — line numbers especially may have drifted; locate symbols by name, not by line.

## Context
**Project:** Product. The task changes the dispatch expiry from 24 hours to 48.

**Discussion History:** A prior research comment (Jun 2) traced the expiry end to end. Findings: the TTL constant `DISPATCH_TTL_MS` (`24 * 60 * 60 * 1000`) lives in `lib/dispatch-store.js` and is read in three places — the `pruneExpired()` sweep, the `listAvailable()` poll filter, and the `expiresAt` stamp written at `enqueue()`. The MangoDB file store persists an absolute `expiresAt` computed at write time (not a relative TTL), so changing the constant only affects items enqueued AFTER the change — existing rows keep their old 24h expiry. Two tests are affected: a unit test asserting `expiresAt - createdAt === 86400000`, and an e2e test that waits on a 24h boundary via a clock mock. The docs (`docs/dispatch-integration.md`) state "Items expire after 24 hours" in two places. Recommended approach from the research: lift the constant to a named export, update both tests' expected value, update both doc mentions, and add a migration note that in-flight items keep the old expiry.

## Goal
**Role**: Implementation planner.

Produce a concise implementation plan that enumerates every surface the TTL change touches, notes any dependency ordering between surfaces, and commits to a session-fit answer. The research is already done — your job is to convert it into a verified, complete plan, not to re-investigate from scratch.

**Steps:**
1. **Confirm the surfaces from research against HEAD.** For each item the research named, confirm it still exists and capture the actual change: the constant value (`24 * 60 * 60 * 1000` → `48 * 60 * 60 * 1000`), the three read sites that consume it, the unit-test expected value (`86400000` → its 48h equivalent), the e2e clock-mock boundary, and the two doc mentions.
2. **Completeness check on the surface list.** The research found these by tracing one symbol; confirm the list is complete, not just correct. Search the codebase for the *concept* of dispatch expiry — not only `DISPATCH_TTL_MS` but also literal `86400000`, `24 * 60 * 60`, `24h`/`24 hours`/`86400` strings, any `expiresAt` computation, and parallel client/consumer code paths — since a clean search for the cited symbol is not proof there is no second implementation under a different name. Mark every instance found as in-scope or out-of-scope. A genuinely complete list matching the research is a valid result; the goal is to make scope a decision.
3. **Cross-cutting concerns check.** After listing changes, ask whether any of these surfaces share the same code path, state, or interface — in particular, the constant is read by three call sites, so confirm whether they should all derive from the single (now-exported) constant or whether any reads a separate literal that must be changed independently. Document the expected interaction explicitly.
4. **Address the migration nuance explicitly.** The research surfaced that existing persisted rows keep their old 24h `expiresAt`. Decide in the plan whether this is acceptable (document a migration note, as research recommended) or whether in-flight items must be rewritten — and capture that decision and its rationale. Do not silently absorb it.
5. **Surface Assessment from research.** The research recommends "lift the constant to a named export." Treat this as a prerequisite shaping step, not a separate blocking refactor — it is a one-file, in-place change scoped to enabling clean reads, so it can be the first step of implementation rather than a standalone subtask. Note it as such in the plan.

**Strategy Framing (complete this BEFORE the Scope Assessment below):**
Score the viable strategies on *cost-of-doing* vs *cost-of-not-doing*:
- The straightforward strategy is: change the constant, update the three reads as needed, update both tests, update both docs, add a migration note. Cost-of-doing: small, single-file core change plus mechanical test/doc edits; low blast radius.
- The migration-rewrite strategy (rewriting existing `expiresAt` rows to 48h): higher cost-of-doing (touches persisted state, risk of corrupting live data), against a cost-of-not-doing of leaving already-enqueued items on the old 24h expiry until they naturally age out.
- If you route around rewriting existing rows (the cheaper path), NAME the contract gap left open explicitly — here it is the "in-flight items keep old expiry" gap; if no tracking ticket exists for it, write "none identified" and capture it in the migration note. A bare description is not enough.
- This is not a migration/convergence/pre-launch epic, so defaulting to the cheaper path (constant change + migration note) is acceptable if cost-of-not-doing is low — but state that judgment, don't assume it.

**Scope Assessment (session-fit) — answer AFTER Strategy Framing:**
Enumerate the final surfaces with any dependency arrows (e.g. named-export step → the three reads → tests). Then commit to one explicit answer: **"fits one session"** or **"needs multiple sessions."** Given the surfaces are a constant, its consumers, two tests, two doc lines, and a migration note all in a small radius, this very likely fits one session — but state it explicitly so the next phase can route to implementation directly.

Restrict the plan to what is confirmed in the codebase and the research comment; do not invent file paths, test values, or migration mechanics beyond what HEAD and the comment support.
