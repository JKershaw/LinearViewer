# INF-1-ttl-deep — anthropic/claude-sonnet-4.6
expect={implement|plan}  got=plan  hit=true  latency=41206ms  cost=$0.043353  body=897w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Complete - The agent comment contains thorough research findings: the constant location, all three read sites, the absolute-timestamp persistence behavior, both tests with line numbers, and both doc locations. The approach is validated and the knowledge is in hand.
- Blockers: ✓ None - No blockers identified.
- Ready: ✓ Yes - Research is done, the plan is not yet documented (no session-fit answer committed), so the next step is `plan`.

**Signal Status:** Research signals are met (key questions answered, actionable recommendations present). Plan signals are unmet — no documented plan with session-fit answer exists yet.

→ **plan** — a complete implementation plan with session-fit answer needs to be documented before implementation begins.
**Next:** Once the plan is documented with a session-fit answer, route to `implement` (or `breakdown` if multi-session).

## Prompt

# Plan INF-1: Bump the dispatch item TTL from 24h to 48h

## Workflow
1. **Start**: Set INF-1 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details and comments for INF-1 in Linear
3. Read the research findings in the agent comment carefully — they are the primary input to this plan
4. Perform the staleness check below before trusting any file references
5. Document the implementation plan in the issue description
6. Answer the session-fit question explicitly
7. **Update Linear**: Add a comment summarizing the plan and update the description with the finalized plan

## Re-ground the Ticket (staleness check)
Treat the research findings as a hypothesis about the codebase, not ground truth — they were accurate when written but may have been invalidated by later commits. Before relying on them:
1. List the files and symbols the research references: `lib/dispatch-store.js` (lines 14, 52, 88, 131), `tests/unit/dispatch-store.test.js` (line 41), `tests/e2e/dispatch.spec.js` (line 210), `docs/dispatch-integration.md`.
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-01" -- lib/dispatch-store.js tests/unit/dispatch-store.test.js tests/e2e/dispatch.spec.js docs/dispatch-integration.md`
3. If any have changed, re-read that source at HEAD (not the agent's notes or the ticket prose) and reconcile any discrepancies before trusting the research's description of the codebase.

## Context
**Project:** Product
**Research findings (from agent comment, Jun 2 2026):**
- `DISPATCH_TTL_MS` constant lives in `lib/dispatch-store.js` line 14 (`24 * 60 * 60 * 1000`)
- The constant is consumed in three places: `pruneExpired()` (line 88), `listAvailable()` (line 131), and `enqueue()` (line 52)
- The store persists items with an absolute `expiresAt` timestamp computed at write time — changing the constant only affects items enqueued after the change; existing rows keep their old expiry
- Unit test `tests/unit/dispatch-store.test.js` line 41 asserts `expiresAt - createdAt === 86400000`
- E2e test `tests/e2e/dispatch.spec.js` line 210 uses a clock mock at the 24h boundary
- Docs `docs/dispatch-integration.md` mentions "Items expire after 24 hours" in two places
- Recommended approach: lift the constant to a named export, update both tests' expected value, update both doc mentions, add a migration note that in-flight items keep the old expiry

## Goal
**Role:** Implementation planner

Produce a complete, ordered implementation plan for bumping the dispatch TTL from 24h to 48h, enumerating every surface to be changed, any dependency arrows between them, and a committed session-fit answer.

---

## Strategy Framing

Before enumerating surfaces, score the viable strategies:

**Cost-of-doing:** How large is the session, what is the blast radius, and does any surface touched have high churn (3+ commits since 2026-06-01 per the staleness check above)?

**Cost-of-not-doing:** The research identifies that the constant is read in three places and that lifting it to a named export would make future TTL changes safer. If the plan routes around that lift (i.e., edits the raw literal in place), name the contract gap left open — ticket identifier or "none identified" — and note the workaround tax paid on every future change.

Score both strategies explicitly, then choose one and state why. Do not let the cheaper default go unnamed.

---

## Completeness Check

The research cites specific symbols and line numbers. Before finalizing the surface list, confirm it is complete — not just correct — by searching for the concept itself, not only the cited symbol:

- Search for the numeric literal `86400000` and `24 * 60 * 60` across the entire codebase (not just the files the research named) — a parallel code path or a copy of the constant may exist under a different name or in a different module.
- Search for the string `"24 hour"` / `"24h"` / `"24 hours"` in docs and comments beyond `docs/dispatch-integration.md`.
- A clean search result is not proof of completeness; it is evidence. Mark every instance found as in-scope or out-of-scope with a brief reason.

---

## Surface Enumeration

After the completeness check, list every surface to be changed. For each surface, note:
- File and location (reconciled against HEAD, not the research notes)
- What changes
- Any dependency on another surface (e.g., "test update depends on constant change landing first")

Draw dependency arrows explicitly so the implementation order is unambiguous.

---

## Cross-Cutting Concerns Check

After listing surfaces, ask: do any of the changes share the same code path, state, or interface?

Specifically:
- The three read sites of `DISPATCH_TTL_MS` (`pruneExpired`, `listAvailable`, `enqueue`) all derive behavior from the same constant. If the constant is lifted to a named export, confirm all three import sites are updated — a partial update would leave one read site on the old value.
- The absolute-timestamp persistence behavior means the TTL change is not retroactive. Confirm whether a migration note belongs in the docs surface, the code (a comment at the write site), or both — and mark that decision in the plan.

---

## Session-Fit Answer

Commit explicitly to one of:
- **"Fits one session"** — all surfaces can be changed, tested, and reviewed in a single focused pass
- **"Needs multiple sessions"** — state which surfaces block others and propose the split

This answer is required. Do not leave it implicit.

---

## Update Linear

- Update the issue **description** with the finalized plan (surfaces, dependency arrows, session-fit answer, and the strategy choice with its rationale)
- Add a **comment** summarizing the plan and flagging any surprises found during the completeness check or staleness check
