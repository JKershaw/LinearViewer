# Pipeline: Design History

> **Superseded by the Observation view; the Pipeline view was removed in LIN-877.** Kept as design history.

> Background notes for **LIN-243** (Pipeline).
>
> The content below is the original three-iteration feasibility review and end-to-end design document. It is preserved verbatim because it records *why* each decision was made — particularly the TTL mismatch discovery in iteration 2 and the case for treating the dispatch history item as the Loop primary key in iteration 3.
>
> **Canonical current-state decisions live in the LIN-243 issue description.** Read this file for the reasoning.

## Iteration 1 — Feasibility review
### Short answer

Yes, it's possible to build Pipeline as a third sibling to `swipe` and `swim`, and the page/routing shape fits cleanly. But the design doc makes **several assumptions about server-side state that don't exist today** — specifically around loops, live agent status, git/CI, and real-time updates. These aren't blockers, but they mean "just another view" undersells the work. You'd be adding a new subsystem, not just a new renderer.

### What fits easily

The view scaffold is essentially free:

- **Route + renderer pattern**: swipe lives at `server.js:811` with `lib/render-swipe.js`, swim at `server.js:861` with `lib/render-swim.js`. Both server-render HTML with embedded JSON (`_*SWIPE_DATA*_`, `_*SWIM_DATA*_`) and a big client-side JS file (`public/swipe.js`, `public/swim.js`). Adding `/workspace/:urlKey/pipeline` + `lib/render-pipeline.js` + `public/pipeline.js` is a well-trodden path.

- **Task data**: `fetchAndPrepareProjects()` already returns in-progress trees, recent activity, etc. — enough for the left-rail queue and center grid to populate task cells.

- **Prompt generation & dispatch**: the "Generate Next Prompt" + "Dispatch to Agent" buttons in the detail overlay map directly to existing endpoints (`/api/proxy/recommend/:identifier` and `POST /workspace/:urlKey/api/dispatch`). Swipe already does this flow, so you can lift the pattern.

- **CLI aesthetic**: monospace + box-drawing styling is already in `public/style.css`; the "control panel" look just needs a page-scoped `pipeline.css`.

### What's actually missing

These are the gaps in LinearViewer that make Pipeline harder than it looks on paper. In rough order of severity:

#### 1. No loop count, and no way to compute one

The design says *"loop count is the primary health metric"* — green ≤3, red >6. But nothing in the current data model tracks iterations:

- `lib/dispatch-store.js:6` — dispatch items have `prompt`, `issueId`, `dispatchedAt`, but **no `loopNumber`**, and items expire after 24h (TTL). So you can't even count dispatches after a day.

- `lib/foreman-store.js:6` — foreman status entries are append-only with a 24h TTL, and crucially there's **no foreign key linking a foreman status entry to the dispatch item it corresponds to**.

- Prompt generation (`lib/prompt-templates.js`) is stateless — nothing is persisted about what prompt was generated when.

To get loop counts you need either: (a) add `iteration` to dispatch items, (b) drop/extend the 24h TTLs, and (c) link foreman entries to dispatch items via `dispatchId` or at minimum `(urlKey, issueIdentifier)`.

#### 2. No live agent status (running / waiting / error)

The floor view's whole premise is ambient status — pulsing green, amber, red per cell. Today, dispatch items only have two real states: *unclaimed* and *claimed* (via `POST /api/dispatch/take/:itemId` in `routes/dispatch.js:442`). There's no "running" heartbeat, no "error" state, no "waiting for input" concept. Foreman status is only recorded **after** an action completes (`routes/proxy.js:1780`), so it's retrospective.

To make the floor view meaningful you'd need:

- An explicit execution state on dispatch items (`queued | claimed | running | waiting | complete | error`), updated by the consumer

- Consumer-side heartbeats so "still running" is distinguishable from "agent crashed 20 minutes ago"

- A "last updated at" timestamp to age out stale states

#### 3. No stage model

The doc talks about four stages (research, plan, implement, review) as a core concept. LinearViewer today only has:

- Linear's native workflow `state.type` (`started / unstarted / backlog / completed / canceled`)

- A few magic labels (`preparing`, `blocked`, `bug`) that gate which prompt template fires (`lib/prompt-template-defs.js`)

Foreman records an `action` field (`research / implementation / review`) when logging status (`routes/proxy.js:1780`), but there's no canonical "what stage is this task currently in" — you'd have to derive it by querying the most recent foreman entry for each task, which is both a cross-collection query and subject to the 24h TTL.

#### 4. No git branch and no CI/CD

The right rail of the floor view — "CI/CD feed with branch names, commit hashes, run status, main highlighted" — has **zero** support today:

- `lib/linear.js:34` — `ISSUE_FIELDS_FRAGMENT` doesn't fetch attachments, and there's no git-branch-from-Linear code.

- No GitHub API integration exists in the codebase at all (the [CLAUDE.md](<http://CLAUDE.md>) note about `curl`-ing GitHub Actions is a dev instruction, not code).

- The "Branch and CI/CD box" at the bottom of the Task Detail view has the same problem.

This is the biggest single piece of missing capability. To ship the doc's right rail you'd be adding a GitHub Actions API client, a per-branch polling cache, and a workspace→repo mapping (dispatch items already carry a `repo` field, which helps).

#### 5. Not real-time

The doc is written like a live control panel. LinearViewer is a **snapshot-at-page-load** app:

- Swipe and swim are full server renders with no live refresh (`lib/render-swipe.js:479`, `lib/render-swim.js:150`).

- The only live thing in the app is the dispatch queue badge, which polls every 1s in `public/app.js:1214` — and only when the tab is visible.

- No WebSocket, no SSE, no background workers.

Polling every 1–2s extended to "full pipeline state" will work at small scale (dozens of tasks) and is the path of least resistance, but you'll want to be deliberate about the payload shape so it doesn't re-fetch the world every tick. SSE from `/workspace/:urlKey/pipeline/events` would be cleaner if you're willing to add it.

#### 6. "Stop a running agent" has no plumbing

Detail-view operator control #3 is a **Stop** button. Today the dispatch API is one-way: user enqueues → consumer claims → consumer posts feedback. There's no "cancel" signal from the server back to a running consumer. You'd need either a `cancelRequested` flag on the dispatch item that consumers check on their feedback-posting path, or a side channel.

### My take

**Building Pipeline as a LinearViewer view is the right call, but the design doc is overshooting what the current server can tell it.** I'd split this into two stages:

**Stage 1 — Pipeline as an honest control surface over what exists.**

Ship a floor view that shows what the server actually knows:

- Left rail: stack from `/api/proxy/stack` (already exists).

- Center grid: active tasks (Linear `state.type = started`), with "has open dispatch item" as the only liveness signal.

- Cells show task ID / title / state / current label-derived template name instead of a made-up "stage."

- No loop count yet — or a weak "dispatches in last 24h" proxy via the existing foreman store.

- Detail view: reuse the swipe prompt-generate + dispatch flow; the "history" section is just the foreman status entries for that task (which already kind of works via `/api/proxy/foreman/status`).

- Right rail: **drop CI/CD initially**, or replace it with the existing proxy event audit log (`/workspace/:urlKey/api/proxy/events`) — that's a real feed you already have and it's operator-useful.

That gets you the *interaction model* the doc cares about (overview → zoom → act → return) without inventing new storage.

**Stage 2 — Add the subsystems the doc actually needs.**

Once Stage 1 proves the UX:

1. Extend `DispatchStore` with `iteration`, `execState`, `lastHeartbeatAt`, `dispatchGroupId` (or reuse `issueIdentifier` as the grouping key), and remove/extend the 24h TTL for dispatch *history* — possibly by promoting "completed" dispatches into a separate, longer-lived collection so the live queue stays lean.

2. Link `ForemanStore` entries to dispatch items by `dispatchId`. That gives you real loops and real history.

3. Add a `POST /api/dispatch/heartbeat/:itemId` + consumer-side cancel check. That gets you running/waiting/error states honestly, and the Stop button becomes implementable.

4. Add a GitHub App or PAT-based integration for the right rail. Keep it behind `feature-defaults.js` — this is the biggest single addition and belongs last.

5. Consider SSE for the floor view at this point; 1s polling will start to feel heavy with workspace-wide state.

### Two things I'd push back on in the design doc itself

- **"Stage" as a first-class field is a trap in this codebase.** You have labels and workflow states. Inventing a parallel stage concept means you now have to keep it consistent with Linear, and nothing updates it unless Pipeline does. Consider deriving stage from `(state.type, labels, latest foreman action)` rather than storing it.

- **"Loop count 15 is stuck" as a health metric only works if loops are persisted past 24h.** Right now everything related to dispatch/feedback TTLs out in a day. Either the health metric needs to be "loops in the last 24h" (weaker but honest), or the TTLs move — and moving TTLs touches storage bills, MongoDB indexes, and the existing contract in `docs/dispatch-integration.md`. Worth deciding early.

### Concrete starting files if you want to proceed

- `server.js:811` and `server.js:861` — copy the swipe/swim route handlers

- `lib/render-swim.js:25` — closest structural analog (multi-lane grid render)

- `public/swim.js` — closest client-side analog (lane assignment, settings panel, shared sorting)

- `lib/dispatch-store.js:6` — where iteration/execState fields would go

- `lib/foreman-store.js:6` — where dispatchId linking would go

- `lib/components/navbar.js:37` — where the `pipeline` nav link slots in

## Iteration 2 — Revised picture

You're right — I under-read all three. Revised picture:

### What I got wrong

**Loops already (mostly) exist.** `POST /api/dispatch/feedback/:itemId` (`routes/dispatch.js:501`) appends to a feedback array on the **history** record, and that history has a **30-day TTL** (`lib/dispatch-store.js:42`), not 24h — I confused it with the live queue. Every history item carries `issueIdentifier`, so you can already ask "give me every dispatch + every feedback entry for [LIN-42](https://linear.app/linearviewer/issue/LIN-42/update-claudemd-with-relation-commands-documentation) in the last month" without adding any schema. Combine that with foreman status entries keyed by `taskIdentifier` and you have a real loop record, joinable today.

**Stages already exist, just in two places.** The meta-prompt (`lib/prompts/meta-prompt-template.js:62-110`) enforces a fixed decision tree whose leaves are exactly the stage vocabulary Pipeline wants: `preparing / plan / breakdown / implementation / review / blocked / bug`. And the foreman `action` field (`lib/foreman-store.js:11`, `routes/proxy.js:1780`) captures the same vocabulary when an agent reports back. So deriving "current stage" = "latest foreman entry's action for this issue" is a one-liner.

### What's actually still missing (tight list)

1. **TTL mismatch.** Dispatch history: 30 days. Foreman status: 24 hours (`lib/foreman-store.js:35`). If the pipeline wants honest loop counts and history across a multi-day task, foreman TTL has to match dispatch history (or go away). This is a one-line change with a storage implication, not a redesign.
2. **No server-side join.** Nothing currently takes `(urlKey, issueIdentifier)` and returns a merged, time-ordered loop timeline. The data is there in two collections, but each page renders them independently. Pipeline needs a `getLoopsForIssue()` helper (merge history + foreman by `issueIdentifier`, sort by timestamp, pair dispatches with subsequent feedback/foreman entries). Probably 80 lines in a new `lib/pipeline-loops.js`.
3. **Action type isn't captured structurally from the recommendation.** `getRecommendation()` (`lib/openrouter.js:724`) returns `{reasoning, prompt}` — both free-text. The meta-prompt instructs the model to emit `→ **[Recommendation Name]**` in the reasoning, but nothing parses it out. Two honest fixes:
   * Parse the `→ **[name]**` line out of reasoning and return it as `action` (brittle but cheap).
   * Or, don't bother — treat the **foreman entry** as the canonical stage record, since the agent writes `action` explicitly when it reports back. Pipeline then shows "last known stage" rather than "intended next stage." This is probably the right call, because the meta-prompt's recommendation is a *suggestion*, not a commitment.
4. **The recommender is stateless.** `getRecommendation()` does not read prior feedback or foreman entries for the issue when building the meta-prompt. For the Pipeline UX to feel like a real loop (loop 6 knows what loops 1–5 said), you need to pass prior foreman summaries + dispatch feedback into `issueContext` or as a new section of the meta-prompt. This is the one change that alters prompt **quality**, not just plumbing, so it deserves its own review — it's also the highest leverage change for the "production line" feel, because right now every loop is amnesiac.
5. **Still snapshot-at-page-load.** The swipe/swim pattern is full server render + embedded JSON (`lib/render-swim.js:150`). Pipeline's floor view only needs the cells to refresh — periodic polling of `/workspace/:urlKey/api/pipeline/state` every 5s is enough, matches the existing 1s dispatch-queue polling style (`public/app.js:1214`), and doesn't require SSE.
6. **Git/CI.** Confirmed deferred. The right rail ships empty or shows the proxy event log instead, until a later pass.

### Revised take

With your clarifications, the design is **closer to "mostly plumbing"** than I framed it. The honest scope for a first-cut Pipeline view is:

* New route `/workspace/:urlKey/pipeline`, new `lib/render-pipeline.js`, new `public/pipeline.js`, new `public/pipeline.css`. (Sibling of swim.)
* New `lib/pipeline-loops.js` that does the `(history × foreman)` merge per issue and computes `loopCount = dispatch history entries for this issue`.
* New JSON endpoint `GET /workspace/:urlKey/api/pipeline/state` that returns `{queue, activeCells, recentLoops}` for client polling.
* Foreman TTL raised to match dispatch history (30d), or dropped entirely in favor of per-workspace cleanup.
* Floor view derives stage from *latest foreman action for the issue*, status from *whether there's an unresolved dispatch item*, and loop count from *history entries*.
* Detail overlay lists merged loop pairs (dispatch prompt + subsequent feedback/foreman summary) chronologically, reuses the existing swipe prompt-generate + dispatch flow for the buttons.

The **one design decision worth making before coding**: do you want to fix item #4 (feed prior loop context into the next meta-prompt) now, or ship a dumb-but-working Pipeline first? I'd ship dumb first — it's still a better operator surface than the current swipe view — and treat context-aware recommendation as the next Pipeline feature once you're living in the view and can feel what's missing.

The two gaps I'm still calling genuinely load-bearing: **TTL alignment** and **loop-joining code**. Everything else the design needs already exists in the app, just not wired to a view yet.

## Iteration 3 — End-to-end design thinking


### 1. Data model

The whole thing pivots on one concept that doesn't exist yet as a first-class entity but is already implied by existing data: the **Loop**.

#### The Loop (derived)

A Loop is "one pass of prompt → dispatch → agent → result" against a task. Today, every piece of a Loop is already stored — it's just spread across two collections and not grouped:

- The **prompt** and **dispatch event** live in a dispatch history item.

- The **agent's response/intermediate signals** live as `feedback[]` on that same dispatch history item.

- The **agent's explicit stage/outcome report** lives in a foreman status entry, keyed by the same `issueIdentifier` and roughly contemporaneous.

So a Loop is naturally identified by the dispatch history item, with foreman entries snapped onto it by timestamp window.

Fields a Loop needs to expose to the UI (most are computed, not stored):

| Field | Source |

|---|---|

| `loopId` | dispatch history `_id` |

| `issueIdentifier` | dispatch history |

| `iteration` | count of prior loops for this issue (computed) |

| `promptName` | dispatch history (e.g. `plan`, `implementation`) |

| `promptText` | dispatch history |

| `dispatchedAt` / `takenAt` / `resolvedAt` | dispatch history |

| `feedback[]` | dispatch history (append-only) |

| `foremanAction` | latest foreman entry in this loop's window (`research`, `plan`, `implementation`, `review`, `blocked`, `bug`) |

| `foremanStatus` | same (`completed`, `failed`, `blocked`) |

| `agentState` | derived: `queued` / `running` / `waiting` / `complete` / `error` |

| `stage` | `foremanAction` if present, otherwise inferred from `promptName` |

#### The Pipeline Task (derived, one per issue)

The floor view's unit is a task, not a loop. The task is a rollup of its loops plus the underlying Linear issue:

| Field | Source |

|---|---|

| `identifier`, `title`, `priority`, `state`, `labels`, `url` | Linear (via existing `linear.js`) |

| `loops[]` | list of Loops (newest first), scoped to last 30 days |

| `loopCount` | `loops.length` |

| `currentStage` | `loops[0].stage` |

| `agentState` | `loops[0].agentState` |

| `healthColor` | `loopCount ≤3 green / ≤6 amber / >6 red` |

| `lastActivityAt` | max timestamp across loops (for sorting the grid) |

#### The Pipeline Snapshot (one per workspace per poll)

The whole payload the floor view needs in one JSON blob:

```

{

fetchedAt,

queue:  [Task, Task, …],   // no active loop, ready to start

active: [Task, Task, …],   // at least one open loop

recent: [Loop, Loop, …],   // for the right-rail feed (until git/CI lands)

}

```

Everything above is computed on read from existing collections plus Linear. The **only persisted schema changes worth considering** are:

1. **Required**: raise `ForemanStore` TTL from 24h to 30d so foreman entries survive as long as the dispatch history they belong to. Without this, loop stages older than a day become mystery meat.

2. **Optional but cheap**: add a `dispatchId` field to foreman entries when the agent can supply it. Makes the join exact instead of timestamp-windowed. Back-compat: if absent, fall back to window matching.

3. **Optional, defer**: `agentState` stored on the dispatch item, updated by a heartbeat endpoint. Only worth it if polling-derived state proves insufficient.

Everything else is a view over data that already exists.

### 2. UI ↔ data mapping

Keeping the doc's three-zone floor view and one detail overlay:

#### Floor view ← Pipeline Snapshot

**Left rail — Queue** ← `snapshot.queue`

- Already exists in spirit: `/api/proxy/stack` is the sorted queue, minus any issue that has an open loop. Rendered as narrow passive list. Priority color = Linear priority. The top item gets the "next up" emphasis.

**Center grid — Active** ← `snapshot.active`

- One cell per Pipeline Task. Cell contents map almost 1:1 to the Task fields:

* Header: `identifier` + `title`
* Stage label: `currentStage`
* Loop count pill: `loopCount`, tinted by `healthColor`
* Progress bar segments: one per loop in `loops[]`, color from each loop's `foremanStatus`
* Background tint: `agentState` (subtle green = running, amber = waiting, red = error, neutral = queued/complete)

- Sorting: by `agentState` severity first (errors/waiting float up), then by `lastActivityAt` descending.

- Auto-fill grid; no pagination. If there are 80 active tasks you get 80 cells and smaller cells.

**Right rail — Activity feed** ← `snapshot.recent` (provisional)

- Original design wants CI/CD. Until git integration lands, this becomes "recently resolved loops" — each entry is `issue + stage + status + timeAgo`. This is still genuinely useful for operator visibility and reuses data you already have. Leaves a slot for CI/CD to replace later without layout churn.

#### Task Detail overlay ← one Pipeline Task + its Loops

**Header**: issue identifier, title, `currentStage`, `loopCount`, `agentState`.

**Prompt-Agent History**: chronological render of `task.loops[]`, each loop as a prompt/agent pair:

- *Prompt block*: `promptName`, `promptText`

- *Agent block*: `feedback[]` entries in order + `foremanStatus` + `summary` from the matching foreman entry

- Latest loop's agent block gets the "pulsing" treatment if `agentState === 'running'`

**Operator controls** (state machine):

- No active loop → **Generate Next Prompt** button → calls `/api/proxy/recommend/:identifier` (existing)

- Prompt generated, not dispatched → show prompt + **Dispatch to Agent** button → calls `POST /workspace/:urlKey/api/dispatch` (existing)

- Loop running → show waiting indicator, no button (per your note, no Stop needed)

**Branch / CI box**: deferred; placeholder that says "git integration: pending."

#### Polling model

Pipeline page = full server render of the shell + initial snapshot (same pattern as swim), then `public/pipeline.js` polls `GET /workspace/:urlKey/api/pipeline/state` every ~5s to refresh the snapshot and diff cells. Detail overlay refreshes its one task at finer cadence (~2s) while open. Matches the existing visibility-gated polling in `public/app.js:1214`.

### 3. Integrations & what to change vs. build

#### What stays untouched

- **Linear fetch** (`lib/linear.js`) — existing `ISSUE_FIELDS_FRAGMENT` is sufficient for the Task's Linear-sourced fields. No GraphQL changes.

- **Prompt generation** (`/api/proxy/recommend`, `lib/openrouter.js`, `lib/prompt-templates.js`) — the "Generate Next Prompt" button calls the existing endpoint. Recommender stays stateless in v1. *(The "feed prior loop context into the meta-prompt" upgrade is a separate, deliberate Pipeline v2 feature — worth deciding but not for MVP.)*

- **Dispatch** (`routes/dispatch.js`, `lib/dispatch-store.js`) — the "Dispatch to Agent" button calls the existing endpoint. Dispatch history already carries everything Pipeline needs to reconstruct loops.

- **Foreman status** (`POST /api/proxy/foreman/status`) — agents already write to it; we just read it from a new place.

- **Swipe/swim views** — untouched. Pipeline is a sibling, not a replacement.

#### What changes (small surgical edits)

- **`lib/foreman-store.js`** — TTL from 24h to 30d. One line + a re-index. This is the only schema-touching change required.

- **`lib/components/navbar.js`** — add a `pipeline` link alongside swipe/swim.

- **`server.js`** — register the new route.

#### What gets built (new)

All greenfield, following the swim view's pattern:

- **`lib/pipeline-loops.js`** — pure function library. Takes `(urlKey, issueIdentifier)` → returns `Loop[]` by reading dispatch history + foreman and joining on `issueIdentifier` (exact when `dispatchId` present, timestamp-window otherwise). Also: `getLoopsForWorkspace(urlKey)` for the snapshot.

- **`lib/pipeline-state.js`** — builds the full Pipeline Snapshot: combines Linear fetch + stack + loop reconstruction into `{queue, active, recent}`.

- **`lib/render-pipeline.js`** — server renderer for the floor view shell + initial embedded `_*PIPELINE_DATA*_`.

- **`routes/pipeline.js`** — two endpoints:

* `GET /workspace/:urlKey/pipeline` — page
* `GET /workspace/:urlKey/api/pipeline/state` — JSON poll endpoint (optional: `?since=` for delta responses later)

- **`public/pipeline.js`** — polling loop, cell diffing, grid layout, detail overlay wiring, calls to existing recommend/dispatch endpoints.

- **`public/pipeline.css`** — the "control panel" aesthetic. Stays monospace but introduces denser grid + status tints. Kept page-scoped so it doesn't leak into swipe/swim.

#### What's deferred cleanly

- **Git/CI**: no code written. Right rail shows activity feed instead. Future work adds a GitHub client and swaps the feed contents — no layout surgery.

- **Stop button**: not built. No cancel signal needed on the dispatch item.

- **Stateful recommender**: meta-prompt stays blind to prior loops in v1. Ship Pipeline first, then decide whether Loop 6 feeling dumb about Loops 1–5 is actually a problem in practice.

- **Heartbeat/explicit agentState**: derive agentState from dispatch item state + latest feedback/foreman timestamp; only add a heartbeat endpoint if this proves too fuzzy.

### The one design choice that matters most

The whole thing rests on treating the **dispatch history item as the Loop primary key** and **foreman entries as decorators**, not the other way around. This is cheap because it means:

- No new collection

- No new foreign keys (except the optional `dispatchId` back-reference)

- Loops are automatically 30-day-scoped via the existing dispatch history TTL

- The feedback array, which is already append-only and per-item, becomes the Loop's intermediate signal stream for free

The only thing that has to change to unlock this model is the foreman TTL. Everything else is view code.

---

Pipeline design document is the original stand alone idea.

[pipeline-design-document.md](https://uploads.linear.app/a8c4b5e3-5392-42fb-884e-086f691fa0b8/c309e037-2c24-4a31-8e4d-46fe69626102/f103e3e2-c7e0-4015-acee-a58fa17f78da)
