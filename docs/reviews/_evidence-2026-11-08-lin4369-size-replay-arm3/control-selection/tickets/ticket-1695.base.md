# LIN-1695: Increase goal text limit for autopilot dispatch

State: Todo
Labels: none

## Description

## As asked

When we dispatch to autopilot we can give it a goal can you ensure that the goal text is actually quite generous really there's not any reason why we should keep it fairly low as its instructions to the auto pilot so we can be very generous here.

---

* **Page:** `https://harbour.cat/workspace/linearviewer/`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36`

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.

## Comments (oldest first)

### 2026-07-29T13:55:22.365Z (posted with the ticket)

## Triage — LIN-1695

Raw in-app feedback, now triaged. Scope is unchanged; the description was not edited.

### Metadata changes applied

| Field | From | To | Reasoning |
|---|---|---|---|
| Project | *(none)* | Autopilot, Recommendation & Prompt Engine | The goal field is the free-text instruction baked into the Autopilot kickoff. Its originating ticket, LIN-564 (*Dispatch autopilot with a goal*, Done), lives in this project, as does LIN-603 which added the `?goal=` handoff. |
| State | Backlog | Todo | Triaged, direction is unambiguous, and the affected surfaces are enumerable. Ready to be picked up for the research/scoping step. |
| Priority | Medium (3) | *unchanged* | Real friction on a core Autopilot affordance and cheap to change, but nobody is blocked and there is a workaround (shorter goal prose). Medium remains right. |
| Labels | *(none)* | *unchanged* | `bug` does not apply — the cap is a deliberate, uniformly-applied validation constant, not unexpected behaviour. See the open question below about the GET-vs-POST inconsistency, which is the one thing that *might* re-classify as a bug once researched. |

### Findings — observations only, not research

Where the number 1000 actually binds the goal, at HEAD:

1. `lib/render-dispatch.js:85` — the dispatch page goal `<textarea>` carries `maxlength="1000"`. This is the surface a human types into, so it is the most likely thing the reporter hit.
2. `public/dispatch.js:317` — the `?goal=` prefill re-clamps to 1000 client-side.
3. `routes/workspace-api.js:632` — `GET /workspace/:urlKey/api/autopilot-prompt` does `req.query.goal.slice(0, 1000)` — silent truncation, no error.
4. `routes/proxy.js:4257` — `GET /api/proxy/autopilot/kickoff` does the same silent `slice(0, 1000)`.
5. `routes/proxy.js:4316` — `POST /api/proxy/autopilot/kickoff` (the fused launch verb) instead **rejects** with 400 `goal is invalid` when `goal.length > MAX_NAME_LENGTH`. That constant is `1000` in `lib/issue-write-validation.js:27` and is **shared** with `repo`, `model`, `harness`, `promptName` — so it is not a goal-specific knob.
6. `lib/next-run.js:622` — AI-suggested goal options are clamped with `goal.slice(0, 1000)` before they ever reach the dispatch handoff.

Two further observations that bear on how generous "generous" can be:

- `buildAutopilotKickoff` (`lib/prompts/autopilot-kickoff.js:260`) does **not** clamp the goal. Every cap sits at an edge; none is in the prompt composer.
- The dispatched prompt body itself is capped at `MAX_PROMPT_LENGTH = 10000000` (`lib/dispatch-validation.js:20`), and the goal is baked into the kickoff *before* dispatch — so the dispatch payload is nowhere near binding. But the goal-carrying GET paths pass it in a query string (`public/common.js:866`), and URLs are capped at `MAX_URL_LENGTH = 8000` (`lib/dispatch-validation.js:21`), which is a nearer ceiling on those paths than anything else found.

### Open questions for the research/scoping step

- Which surface did the reporter actually hit — the textarea `maxlength`, or a 400 from the POST launch verb?
- Should the goal get its own constant, or is raising the shared `MAX_NAME_LENGTH` acceptable given it also governs `repo`/`model`/`harness`/`promptName`?
- Should the GET paths keep silently truncating, or align with POST's explicit rejection? The two behaviours currently disagree.
- What is the practical upper bound: the goal is inlined into every kickoff (token cost per run), and goal-over-query-string paths meet the ~8000-char URL ceiling well before any prompt limit.

### Staleness check

HEAD is `b3cba5d` (LIN-1683, 29 Jul 10:27). `git log --since=2026-07-29T13:51:24Z` over all six paths above returns nothing — no commits since this ticket was filed. The description is consistent with HEAD.
