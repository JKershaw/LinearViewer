# SYN-5-pagination — google/gemini-3.5-flash
expect={plan}  got=plan  hit=true  latency=17245ms  cost=$0.0354015  body=621w

---

## Reasoning
**Assessment:**
- Preparation: [✓ Not needed] - The requirements are clear and describe a standard pagination feature. No exploratory research or external dependencies are mentioned.
- Blockers: [✓ None] - No active blockers or bugs are associated with this task.
- Ready: [✓ Yes] - The task is ready for planning to define the exact files, API contract, and UI changes needed.

**Signal Status:**
- No prior plan exists in the description, so we must route to `plan`.

→ **plan**
**Next:** The developer will proceed to implementation (if it fits in one session) or breakdown (if it requires multiple sessions).

## Prompt
```
# Plan SYN-5: Add pagination to the issues list (API + UI)

## Workflow
1. **Start**: Set SYN-5 status to "In Progress" in Linear (if not already)
2. **Fetch details**: Get full issue details for SYN-5 in Linear
3. **Analyze Codebase**: Locate the existing `GET /issues` endpoint and the issues list UI components.
4. **Formulate Plan**: Create a detailed implementation plan addressing both the API and UI requirements.
5. **Update Linear**: Document the finalized plan in the issue description, including the surface list, dependency arrows, and the session-fit commitment.

Always include the "Start" step to ensure work visibility.

## Re-ground the Ticket (staleness check)
Treat this ticket as a hypothesis about the codebase, not ground truth — its description may have been accurate when written but invalidated by later commits. Before relying on what it says about the code:
1. List the files and symbols the ticket references (e.g., the `GET /issues` endpoint and the issues list UI).
2. Check whether any have changed since the ticket was created (2026-06-01T00:00:00Z): run `git log --since="2026-06-01T00:00:00Z"` for those paths.
3. If any have changed, re-read that source at HEAD (not your own notes or the ticket prose) and reconcile any discrepancies before trusting the ticket's description of the codebase.

## Context
- **Project**: Product
- **Issue**: SYN-5
- **Description**: The issues list returns everything at once. Add page-based pagination to the GET /issues endpoint and add prev/next controls to the issues list UI. Keep existing default behavior for callers that pass no page param.

## Goal
**Role**: Technical Architect / Lead Planner

Create a clear implementation plan to add page-based pagination to the issues list API and UI, identify all affected surfaces, and determine whether the work can be completed in a single session.

### 1. Surface Identification & Completeness Check
Identify all files that need to be modified or created. To ensure completeness:
- Do not rely solely on the symbols mentioned in the ticket. Search the codebase for the concept of the "issues list" and "GET /issues" to find all parallel code paths, state management files, route handlers, and UI components.
- List every affected file and mark it explicitly as in-scope or out-of-scope for this change.
- Identify the existing response schema for `GET /issues` and determine how to add pagination metadata (e.g., total pages, current page) without breaking existing callers that pass no page parameter.
- Identify the UI framework, state management, and styling patterns used in the issues list UI from the codebase.

### 2. Cross-Cutting Concerns & High-Churn Check
- Analyze if the changes to the API and UI share the same code path, state, or interface with other features. Document the expected interactions explicitly.
- Check the git history of the files you plan to modify. If any file has high churn (3+ commits in recent history), document what those recent changes were protecting against and how to avoid regressing them.

### 3. Strategy Framing
Before committing to a scope assessment, evaluate your proposed implementation strategy:
- Score your strategy on **cost-of-doing** (current-ticket session size, blast radius, risk to high-churn files) vs **cost-of-not-doing** (any contract gaps left unsolved, plus the workaround tax paid on future changes).
- If your strategy routes around an existing contract gap or technical debt, explicitly name that gap (using a ticket identifier or "none identified"). Do not leave it as a bare description.

### 4. Scope Assessment & Session-Fit
Based on the strategy and surfaces identified, commit to a session-fit answer:
- Does this work fit into **one focused session**? Or does it **need multiple sessions**?
- If it needs multiple sessions, draw dependency arrows between the identified surfaces to show the order in which they must be updated.
```
