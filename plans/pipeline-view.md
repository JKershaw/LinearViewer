# Pipeline View — Design Document

A control surface for AI-assisted software development, built as a third
sibling to the existing `swipe` and `swim` views inside LinearViewer.

Status: design. No code yet.

---

## Context

**LinearViewer** already provides:

- A Linear-connected dashboard that fetches projects and issues.
- Two alternative views (`/swipe`, `/swim`) that reshape the same underlying
  task data for different operator workflows.
- AI prompt generation via a meta-prompt that recommends one of a fixed set of
  next actions (`preparing`, `plan`, `breakdown`, `implementation`, `review`,
  `blocked`, `bug`).
- A dispatch queue that lets external AI agents claim prompts and post
  feedback against them.
- A foreman status log where agents record the outcome of each action they
  take on a task.

These pieces already support the full loop — pull a task, generate a prompt,
run it through an agent, receive results — but the loop is operator-driven.
Today you copy prompts between windows, track status in your head, and jump
between tabs. Pipeline exists to make that loop visible, ambient, and
operable from a single screen.

## Motivation

The mental model is a production line, not a project board. Tasks feed in,
get processed through prompt-agent loops, and come out as pull requests. The
operator monitors the line, intervenes when something stalls, and keeps
things flowing. The goal is not to manage work — Linear does that — but to
**operate the process of doing work**.

Why this matters:

- Tasks move through stages (research, plan, implement, review) with fuzzy
  boundaries. The system, not the operator, determines what comes next.
- Multiple agents can run in parallel. The dashboard must show many tasks at
  once without requiring individual attention.
- The prompt-agent loop is the atomic unit of progress. A task may take 2
  loops or 20.
- Loop count is a health signal. Loop 3 is normal. Loop 8 is a smell. Loop 15
  is stuck.

The view should feel like operating a CNC machine: glanceable status, big
physical controls, and the ability to zoom in when something needs attention.

## Design Principles

- **The operator is not the worker.** Pipeline doesn't help you write code or
  think about architecture. It helps you run the machine that does those
  things.
- **Loop count is the primary health metric.** Stage names tell you what's
  happening. Loop count tells you if something is wrong.
- **Status is ambient, action is deliberate.** The floor view is passive —
  you look at it. The detail view is active — you press buttons.
- **Everything visible, nothing hidden.** No pagination, no "load more." If
  there are 50 active tasks, you see 50 cells. The grid gets denser, not
  longer.

---

## Data Model

Pipeline is read-heavy and computes almost everything on the fly from data
that already exists in the app. Only two concepts are new, and both are
derived views over existing collections.

### The Loop (derived)

A **Loop** is one pass of `prompt → dispatch → agent → result` against a
task. Every piece of a Loop is already stored today; it's just spread across
two collections and not grouped.

Primary key: the dispatch history item. Foreman entries decorate it by
`issueIdentifier` and timestamp window.

| Field | Source |
|---|---|
| `loopId` | dispatch history `_id` |
| `issueIdentifier` | dispatch history |
| `iteration` | count of prior loops for this issue (computed) |
| `promptName` | dispatch history (e.g. `plan`, `implementation`) |
| `promptText` | dispatch history |
| `dispatchedAt` / `takenAt` / `resolvedAt` | dispatch history |
| `feedback[]` | dispatch history (append-only feedback array) |
| `foremanAction` | latest foreman entry in this loop's window |
| `foremanStatus` | same (`completed`, `failed`, `blocked`) |
| `agentState` | derived: `queued` / `running` / `waiting` / `complete` / `error` |
| `stage` | `foremanAction` if present, else inferred from `promptName` |

### The Pipeline Task (derived, one per issue)

The floor view's unit is a task, not a loop. A Pipeline Task is a rollup of
its Loops plus the underlying Linear issue.

| Field | Source |
|---|---|
| `identifier`, `title`, `priority`, `state`, `labels`, `url` | Linear (via existing `lib/linear.js`) |
| `loops[]` | list of Loops (newest first), scoped to last 30 days |
| `loopCount` | `loops.length` |
| `currentStage` | `loops[0].stage` |
| `agentState` | `loops[0].agentState` |
| `healthColor` | `loopCount ≤3 green / ≤6 amber / >6 red` |
| `lastActivityAt` | max timestamp across loops (for sorting) |

### The Pipeline Snapshot (one per workspace per poll)

The complete payload the floor view needs in one JSON blob:

```
{
  fetchedAt,
  queue:  [Task, Task, …],   // no active loop, ready to start
  active: [Task, Task, …],   // at least one open loop
  recent: [Loop, Loop, …],   // for the right-rail activity feed
}
```

### Persisted schema changes

Almost everything above is computed on read. The only storage changes worth
making:

1. **Required**: raise `ForemanStore` TTL from 24h to 30d in
   `lib/foreman-store.js:35` so foreman entries survive as long as the
   dispatch history they belong to. Without this, stages older than a day
   become mystery meat.
2. **Optional, cheap**: add an optional `dispatchId` field to foreman entries
   when the agent can supply it. Makes the join exact instead of
   timestamp-windowed. Back-compatible: if absent, fall back to window
   matching.
3. **Deferred**: `agentState` column on the dispatch item, updated by a
   heartbeat endpoint. Only worth adding if polling-derived state proves too
   fuzzy.

### Key design choice

Pipeline treats the **dispatch history item as the Loop primary key** and
**foreman entries as decorators**, not the other way around. This means no
new collection, no new foreign keys (except the optional `dispatchId`
back-reference), and loops automatically inherit the 30-day dispatch history
TTL. The feedback array already on dispatch items becomes the Loop's
intermediate signal stream for free.

---

## UI ↔ Data Mapping

Two views: the **Floor** (always-visible overview) and the **Task Detail**
overlay (zoomed-in, actionable).

### Floor view ← Pipeline Snapshot

Three zones arranged horizontally, fixed 1024px+ desktop layout. On mobile,
pinch-zoom to navigate rather than collapsing to a mobile layout.

**Left rail — Queue** ← `snapshot.queue`

Narrow vertical list of tasks waiting to be worked. Source is
`/api/proxy/stack` (existing), filtered to exclude issues with an open loop.
Each entry shows identifier, title, priority color. Top entry is visually
emphasised as "next up." Deliberately passive — a hopper, not a workspace.

**Centre — Active grid** ← `snapshot.active`

Auto-fill responsive grid of cells, one per Pipeline Task with an open loop.
Each cell shows:

- `identifier` + `title`
- Stage label (`currentStage`)
- Loop count pill, tinted by `healthColor`
- Progress bar — one segment per loop in `loops[]`, each colored by
  `foremanStatus`
- Background tint from `agentState`: subtle green (running), amber (waiting),
  red (error), neutral (queued / complete)

Sorted: `agentState` severity first (errors and waiting float up), then
`lastActivityAt` descending. No pagination — if there are 80 active tasks you
get 80 cells and they get smaller. Tapping any cell opens Task Detail.

**Right rail — Activity feed** ← `snapshot.recent` (provisional)

The original design wants a CI/CD feed here. Until git integration lands,
this slot renders recently resolved loops instead — each entry is
`issue + stage + status + timeAgo`. Operator-useful on day one, swappable for
CI/CD later without layout churn.

### Task Detail overlay ← one Pipeline Task + its Loops

Full-screen overlay opened by tapping an active cell.

**Header**: issue identifier, title, `currentStage`, `loopCount`,
`agentState`.

**Prompt-Agent History**: chronological render of `task.loops[]`, each loop
rendered as a prompt/agent pair:

- *Prompt block*: `promptName` + `promptText`, indigo accent, visually
  distinct from the agent side.
- *Agent block*: `feedback[]` entries in order, plus the matching foreman
  entry's `summary` and `status`. Colored by result status.

The latest loop's agent block pulses while `agentState === 'running'`.

**Operator controls** (state machine, rendered below the history):

| Current state | Control |
|---|---|
| No open loop | **Generate Next Prompt** → calls `/api/proxy/recommend/:identifier` |
| Prompt generated, not dispatched | Show prompt text + **Dispatch to Agent** → calls `POST /workspace/:urlKey/api/dispatch` |
| Loop running / waiting | Show status indicator, no button |

No Stop button in v1 — if you need to intervene the agent's terminal is open
anyway.

**Branch / CI box**: placeholder, pinned at the bottom. "Git integration:
pending." Slot exists so it can be filled later without touching the layout.

### Interaction model

Overview → zoom → act → return.

1. Floor view shows everything at once. Scan for amber or red cells.
2. Tap a cell to read the prompt-agent history.
3. Generate next prompt or dispatch it.
4. Close the overlay. You're back on the floor.

Most of the time the floor is sufficient. You only zoom when something needs
attention or when you want to advance a waiting task.

### Polling model

Same pattern as swim: full server render of the shell with initial snapshot
embedded as `__PIPELINE_DATA__`, then `public/pipeline.js` polls
`GET /workspace/:urlKey/api/pipeline/state` every ~5s to refresh the snapshot
and diff cells in place. Detail overlay refreshes its single task at ~2s
while open. Visibility-gated, matching the existing 1s dispatch-queue poll in
`public/app.js:1214`.

---

## Integrations and Changes

### What stays untouched

- **Linear fetch** (`lib/linear.js`). The existing `ISSUE_FIELDS_FRAGMENT`
  has everything the Pipeline Task needs from Linear. No GraphQL changes.
- **Prompt generation** (`/api/proxy/recommend`, `lib/openrouter.js`,
  `lib/prompts/meta-prompt-template.js`, `lib/prompt-templates.js`). The
  "Generate Next Prompt" button calls the existing endpoint. Recommender
  stays stateless in v1.
- **Dispatch** (`routes/dispatch.js`, `lib/dispatch-store.js`). The "Dispatch
  to Agent" button calls the existing endpoint. Dispatch history already
  carries everything needed to reconstruct loops.
- **Foreman status** (`POST /api/proxy/foreman/status`). Agents already write
  to it; Pipeline just reads from a new place.
- **Swipe / swim views.** Untouched. Pipeline is a sibling.

### Small surgical edits

- `lib/foreman-store.js` — raise TTL from 24h to 30d. One-line change plus a
  re-index. **Only schema-touching change required for v1.**
- `lib/components/navbar.js` — add a `pipeline` link alongside swipe/swim.
- `server.js` — register the new route.

### New pieces to build

All greenfield, following the swim view's pattern:

- **`lib/pipeline-loops.js`** — pure-function library. Core primitive is
  `getLoopsForIssue(urlKey, issueIdentifier) → Loop[]`, which reads dispatch
  history + foreman and joins on `issueIdentifier`. Also provides
  `getLoopsForWorkspace(urlKey)` for the snapshot builder. Exact join when
  `dispatchId` is present, timestamp-window otherwise.
- **`lib/pipeline-state.js`** — snapshot builder. Combines the Linear fetch,
  the existing stack endpoint, and loop reconstruction into
  `{queue, active, recent}`.
- **`lib/render-pipeline.js`** — server renderer for the floor view shell and
  initial embedded data.
- **`routes/pipeline.js`** — two endpoints:
  - `GET /workspace/:urlKey/pipeline` — page
  - `GET /workspace/:urlKey/api/pipeline/state` — JSON poll endpoint
    (optional `?since=` later for delta responses)
- **`public/pipeline.js`** — polling loop, grid layout, cell diffing, detail
  overlay, calls to existing recommend/dispatch endpoints.
- **`public/pipeline.css`** — control-panel aesthetic layered on top of the
  existing monospace terminal style. Page-scoped so it doesn't leak into
  swipe/swim.

### Explicitly deferred

- **Git / CI integration.** No code in v1. Right rail uses the activity feed
  instead. Future work adds a GitHub client and swaps the feed contents — no
  layout surgery required.
- **Stop button.** Not built. No cancel signal on dispatch items.
- **Stateful recommender.** The meta-prompt stays blind to prior loops in
  v1. Ship Pipeline first, then decide whether "loop 6 has no memory of
  loops 1–5" is a real problem in practice. If yes, the fix is to feed prior
  foreman summaries and dispatch feedback into the meta-prompt's
  `issueContext`.
- **Heartbeat / explicit `agentState` column.** Derive `agentState` from
  dispatch item state + latest feedback/foreman timestamp. Only add a
  heartbeat endpoint if derivation proves too fuzzy in practice.

---

## Open Questions

1. **Foreman TTL**: raise to 30d, or drop entirely with periodic per-workspace
   cleanup? Drop is simpler but shifts storage growth onto the operator.
2. **Stateful recommender in v1 or v2?** Current plan says v2. Worth
   revisiting if the "amnesiac loops" feel bad immediately.
3. **Should completed tasks linger in the grid briefly?** A "fade-out"
   behaviour (stay for ~30s after `complete`) may help the operator catch
   outcomes without hunting the activity feed.
4. **How does Pipeline coexist with swipe for the single-task workflow?**
   Pipeline replaces swipe for power users but swipe is still useful for
   "one thing at a time" sessions. No immediate conflict, but worth flagging.

---

## Gaps Filled vs. Original Pipeline Concept

For reference, the original design doc assumed a number of things the app
didn't directly provide. The Pipeline v1 plan resolves each as follows:

| Original assumption | Resolution |
|---|---|
| Loop count as first-class health metric | Derived from dispatch history count per `issueIdentifier` |
| Task stage (research/plan/implement/review) | Derived from latest foreman entry's `action`, falling back to `promptName` |
| Agent running/waiting/error state | Derived from dispatch lifecycle + feedback/foreman timestamps |
| Prompt-agent history per task | Derived from dispatch history + feedback array + foreman entries |
| CI/CD feed with branch info | Deferred; replaced by recently-resolved-loops feed in v1 |
| Real-time updates | Polling every 5s (floor) / 2s (detail), visibility-gated |
| Stop button | Dropped in v1 |
| 24h foreman TTL covering multi-day tasks | TTL raised to 30d to match dispatch history |
