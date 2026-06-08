# SYN-5-pagination — anthropic/claude-sonnet-4.6
expect={plan}  got=plan  hit=true  latency=50878ms  cost=$0.048129  body=1223w

---

## Reasoning
**Assessment:**
- Preparation: ✓ Not needed — The task describes a well-understood pattern (page-based pagination on an existing endpoint + UI controls). The approach is stated, the behavior contract is clear (no page param = existing default behavior), and no external dependencies or unvalidated assumptions are present.
- Blockers: ✓ None — No blocked label, no unresolved questions in comments.
- Ready: ✗ No — The task is unstarted with no documented implementation plan. The description states intent but does not enumerate surfaces (which files/layers handle the endpoint, where the UI list lives, how the response schema should change, etc.), has no dependency ordering, and has not committed to a session-fit answer.

**Signal Status:** Plan signals unmet — no files enumerated, no approach documented, no session-fit answer.

→ **plan** — A plan is needed before implementation can begin.
**Next:** Once the plan commits to a session-fit answer, either proceed directly to `implement` (fits one session) or `breakdown` (needs multiple sessions).

---

## Prompt

# Plan SYN-5: Add pagination to the issues list (API + UI)

## Workflow
1. **Start**: Set SYN-5 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-5 in Linear
3. Research the codebase to enumerate all surfaces touched
4. Apply Strategy Framing
5. Assess scope and commit to a session-fit answer
6. Document the plan in the issue description
7. **Update Linear**: Add the completed plan to the issue description; add a comment summarizing the session-fit decision and any dependency arrows; leave status as "In Progress"

---

## Re-ground the Ticket (staleness check)

Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:

1. List the files and symbols the ticket references (the `GET /issues` endpoint handler, the issues list UI component, and any shared response-shaping utilities).
2. Check whether any have changed since the ticket was created: run `git log --since="2026-06-01" -- <paths>` for those paths.
3. If any have changed, re-read that source at HEAD (not your notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

---

## Context

**Project:** Product
**Task:** SYN-5 — unstarted, no prior plan or comments.

**What the ticket says:**
- The `GET /issues` endpoint currently returns all issues at once.
- Add page-based pagination to that endpoint.
- Add prev/next controls to the issues list UI.
- Callers that pass no `page` param must retain existing default behavior (no breaking change).

---

## Goal

**Role:** Technical planner

Produce a complete, actionable implementation plan that enumerates every surface this change touches, documents any dependency arrows between them, and commits to a clear session-fit answer ("fits one session" or "needs multiple sessions").

---

## Surface Enumeration

For each surface below, locate the relevant file(s) and record them in the plan. Do not rely on assumed paths — find them in the codebase.

1. **API endpoint handler** — Find the handler for `GET /issues`. Identify:
   - How query parameters are currently parsed and validated.
   - How the response is currently shaped (identify the response schema from existing endpoint handlers in this codebase — do not assume field names).
   - Where the data-fetch/query layer is called from, and whether pagination parameters need to be threaded through to it.

2. **Data/query layer** — Identify whether the database query or data-access layer needs a change to support limit/offset (or equivalent). Note whether this layer is shared with other callers that must not be broken.

3. **Response contract** — Determine what the paginated response should include (e.g., items for the current page, total count, current page, page size, has-next/has-prev). Derive this from how similar patterns are handled elsewhere in this codebase, if any exist — do not invent a schema.

4. **UI issues list component** — Find the component that renders the issues list. Identify:
   - How it currently fetches data from `GET /issues`.
   - Where state would live for the current page.
   - What the prev/next control interaction model needs to be (derive from existing UI patterns in this codebase).

5. **API client / data-fetching layer (if present)** — Determine whether there is a shared API client or fetch wrapper between the UI and the endpoint. If so, it may need to accept and forward a `page` parameter.

---

## Completeness Check

Do not stop at the symbol the ticket cites. Search for the concept or behavior itself:

- Search for all places in the codebase that call or reference the issues list data fetch — not just the primary component. There may be parallel code paths, server-side rendering paths, or other consumers of `GET /issues`.
- Search for any existing pagination utilities, hooks, or helpers already present in the codebase — reuse is preferable to duplication.
- For each instance found, explicitly mark it **in-scope** or **out-of-scope** with a one-line reason. A genuinely single-surface result is valid; the goal is to make scope a decision, not an accident.

---

## High-Churn File Check

For each file identified in the surface enumeration:

- Run `git log --since="2026-06-01" -- <file>` and count commits.
- If any file has 3 or more commits since the ticket was created, read what those changes were protecting against before proposing modifications to it. Document this in the plan.

---

## Cross-Cutting Concerns Check

After listing all surfaces, ask: do any of the requirements share the same code path, state, or interface?

Specifically:
- The "no page param = existing default behavior" requirement touches both the API handler (parameter parsing) and any callers that currently omit the param. Confirm the default is enforced in one place and not duplicated.
- The UI prev/next controls and the API client layer both depend on the response contract. Confirm the contract is defined once and consumed consistently — document the expected interaction explicitly if these surfaces share state or a type definition.

---

## Strategy Framing

Before committing to a session-fit answer, score the viable strategies:

**Cost-of-doing** (for each viable approach):
- How many surfaces does it touch in this session?
- What is the blast radius — could it break existing callers that pass no `page` param?
- Does it touch any high-churn files identified above?

**Cost-of-not-doing:**
- What contract gap is left unsolved if pagination is deferred or partially implemented (e.g., API paginated but UI not updated, or vice versa)?
- What workaround tax would future changes pay — duplicated fetch logic, per-caller branching, or a growing response payload that callers must filter client-side?
- Name the contract gap explicitly (use the ticket identifier SYN-5 or "none identified" if no tracked gap exists beyond this ticket).

**Default:** For a feature that spans API and UI with a clear contract dependency between them, prefer closing the full gap (both surfaces) unless the cost-of-doing is prohibitively higher than a staged approach. If you choose a staged approach, name the gap left open and record it.

---

## Scope Assessment and Session-Fit Answer

After completing the surface enumeration, completeness check, and strategy framing:

1. List every in-scope surface with the file(s) it maps to and any dependency arrows (e.g., "UI component depends on response contract, which depends on API handler change").
2. Estimate whether the full set of changes fits one focused session or requires multiple sessions.
3. Commit to exactly one of:
   - **"Fits one session"** → plan proceeds directly to `implement`
   - **"Needs multiple sessions"** → plan proceeds to `breakdown`, which will create one subtask per surface and copy dependency arrows into `blocked-by` relations

Record the session-fit answer explicitly in the plan — do not leave it implied.

---

## Plan Document Format

Write the plan into the issue description using this structure:

```
## Implementation Plan

### Surfaces
- [ ] Surface name — file(s) — dependency arrows if any

### Cross-Cutting Concerns
[Document any shared code paths, state, or interfaces]

### Default Behavior Contract
[How "no page param = existing behavior" is enforced and where]

### Response Contract
[Agreed schema for the paginated response, derived from codebase patterns]

### Session-Fit Decision
[Fits one session | Needs multiple sessions] — [one-sentence rationale]

### Open Questions
[Any unresolved questions that must be answered before or during implementation]
```
