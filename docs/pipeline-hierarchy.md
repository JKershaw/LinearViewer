# Pipeline Hierarchy: Leaf-Primary Rule

Background notes for **LIN-246** (`lib/pipeline-state.js`). The issue description links here instead of carrying all of this inline.

## The rule

The Pipeline grid must show the unit of actionable work, not the container. **Parents drop off the grid once they have incomplete children**, matching the pattern already used across the rest of the app.

## Precedents in the codebase

The leaf-primary pattern is already established; `pipeline-state.js` is conforming to it, not inventing it.

- `lib/linear.js:549` — `selectFocusSubtask()` implements the leaf-primary drill-down: in-progress → first non-blocked todo → first incomplete.
- `lib/linear.js:577` — `fetchRecommendationContext()` already returns `focusedChild` for parent tasks, so the recommender is already leaf-primary.
- `routes/proxy.js:1885` (foreman playbook) — *"If the top task has incomplete subtasks, work on the first incomplete subtask instead."*
- `lib/render-swim.js:58-70` — swim view already decorates issues with `parentInfo` from `parentId`.
- `routes/proxy.js:1520-1540` — `/api/proxy/stack` already returns `parentId`, `parentIdentifier`, `parentTitle`, `subtasks[]` on every task, and already calls `clusterByParent(applyBlockingOrder(...))` at `routes/proxy.js:1544`.

## What the state builder does with parents

1. **`active` filter:** `hasActiveLoop(issue) && (isLeaf(issue) || hasRecentOwnLoop(issue))`
   - `isLeaf(issue)` = no children, or all children `completed` / `canceled`.
   - `hasRecentOwnLoop(issue)` = a loop was dispatched against the parent itself within the snapshot window (e.g. the user ran a review on the parent post-completion). The parent gets to reappear as a cell in that case.

2. **Parent auto-drop:** when a breakdown loop produces children, the parent naturally falls out of `active` on the next poll and the children appear. No special-casing of breakdown loops needed.

3. **Parent chain tag:** each Task in `active` carries a `parentChain` walked via `parentId` so cells can render a `◀ LIN-243 Pipeline` tag. Chain is empty for top-level tasks.

4. **Loop counts stay per-cell:** no aggregation across parent/child. Health (green ≤3 / amber ≤6 / red >6) asks *"is this workstream stuck?"*, not *"is this project big?"*.

5. **Parents are still reachable:** `getTaskForIssue(identifier)` must work for non-leaf issues so the parent detail overlay (LIN-249) can fetch a container's own loop history, including the breakdown loop that spawned the children.
