# Swim View — Implementation Plan

## Overview

A new "Swim" page at `/workspace/:urlKey/swim` that visualises tasks as small boxes
arranged in horizontal swim lanes. Horizontal position = sequence (left is sooner),
vertical position = parallelism (separate lanes = independent work). Includes an
adjustable settings panel for prototyping different configurations.

Not linked from navbar or footer — prototype only.

---

## Step 1: Lane Assignment Algorithm (`lib/swim-lanes.js`)

New module that takes flattened, sorted issue cards and assigns them to lanes.

**Inputs:** Flat array of card objects (same shape as swipe cards, reusing
`flattenTrees`, `sortIssuesForSwipe`, `applyBlockingOrder` from `render-swipe.js`).

**Algorithm:**
1. Build a dependency graph from `blocksIds` and `parentId` relationships.
2. Compute chains: walk the graph to find connected sequences (A blocks B blocks C = one chain).
3. Assign each chain to a lane. Independent tasks (no connections) each get their own lane or fill gaps.
4. Within a lane, order left-to-right by dependency (blockers first), then priority.
5. Respect `maxLanes` setting — if chains exceed max, merge shortest chains into shared lanes.

**Grouping modes** (configurable):
- `dependency` (default): lanes are dependency chains as described above
- `project`: one lane per project, tasks ordered by priority/blocking within
- `assignee`: one lane per assignee
- `status`: lanes for backlog → todo → in-progress (more kanban-like)

**Exports:**
```js
export function assignLanes(issues, options = {})
// options: { maxLanes: 6, grouping: 'dependency' }
// Returns: { lanes: Array<{ id, label, items: Array<card> }>, links: Array<{ from, to, type }> }
```

The `links` array captures cross-lane relationships (blocking edges between lanes)
for optional visual connectors.

**Unit tests** in `tests/unit/swim-lanes.test.js`:
- Single chain → one lane
- Two independent chains → two lanes
- maxLanes merges smallest chains
- Blocking order respected within lane
- Parent/subtask clustering within lane
- Each grouping mode produces correct lane labels
- Empty input → empty lanes

---

## Step 2: Sample Data Generator (`tests/fixtures/swim-sample-data.js`)

A module that generates realistic issue data for prototyping, richer than the
existing `mock-data.js` (which has ~10 issues, no deep dependency chains).

**Generates:**
- 3-4 projects with 8-15 issues each
- Mix of states: ~20% in-progress, ~30% todo, ~15% backlog, ~20% completed, ~15% unstarted
- 2-3 blocking chains of 2-4 issues each
- 2-3 parent tasks with 2-4 subtasks each
- Realistic titles, varied priorities, some assignees, some labels
- Deterministic (seeded) so screenshots are reproducible

**Exports:**
```js
export function generateSwimSampleData(options = {})
// options: { issueCount: 40, chainCount: 3, subtaskGroups: 2, seed: 42 }
// Returns: { projects, issues } in the same shape as testMockData
```

Also export a pre-generated constant `swimSampleData` for the test route.

---

## Step 3: Server Route & Test Route

**Production route** in `server.js`:
```
GET /workspace/:urlKey/swim
```
- Same pattern as swipe route (line 643): `workspaceFromUrl` middleware,
  `fetchAndPrepareProjects`, error handling
- Calls `renderSwimPage()` with tree data + options

**Test route** addition in `routes/test.js`:
```
GET /test/set-session?swimSample=true
```
- When `swimSample=true`, use the richer swim sample data instead of `testMockData`
- This gives E2E tests and the screenshot maker access to realistic data

**Test mode in `server.js`:**
- When `NODE_ENV=test` and `accessToken === 'test-token'`, check for a session flag
  `req.session.swimSample` to decide whether to use swim sample data or standard mock data.

---

## Step 4: Renderer (`lib/render-swim.js`)

Server-side HTML generator, following the `render-swipe.js` pattern.

**`renderSwimPage(data, options)`:**
1. Flatten trees using existing `flattenTrees` from `render-swipe.js`
2. Sort + reorder using existing `sortIssuesForSwipe`, `applyBlockingOrder`
3. Call `assignLanes()` with default settings
4. Build `swimData` object with: `lanes`, `links`, `allIssues`, `settings` defaults,
   `filterGroups`, `urlKey`
5. Embed as `window.__SWIM_DATA__`
6. HTML structure:

```html
<body>
  {navbar}
  <main class="swim-page">
    <div class="swim-settings-panel">
      <!-- collapsible settings: maxLanes slider, grouping dropdown, box size toggle -->
    </div>
    <div class="swim-container">
      <div class="swim-lanes">
        <!-- lanes rendered client-side from embedded data -->
      </div>
    </div>
  </main>
  {footer}
  <script>window.__SWIM_DATA__ = {...}</script>
  <script src="/common.js"></script>
  <script src="/swim.js"></script>
</body>
```

The settings panel HTML is rendered server-side (it's static controls), but lane
content is rendered client-side so settings changes re-render without a page reload.

---

## Step 5: Client-Side Logic (`public/swim.js`)

Reads `window.__SWIM_DATA__`, renders lanes, handles settings changes.

**Initialization:**
- Extract data from `__SWIM_DATA__`
- Read settings from panel defaults (and localStorage for persistence)
- Call `render()`

**`render()` function:**
- Re-run `assignLanes()` client-side with current settings (the algorithm module
  will be embedded/duplicated in the client script since there's no build step)
- For each lane: create a horizontal row with lane label on the left, task boxes
  scrolling right
- For each task box: render status indicator, identifier, truncated title
- Subtask groups: wrap in a bordered container within the lane
- Apply cross-lane link indicators (coloured left-border on blocked tasks,
  small "← LIN-XX" label)

**Task box HTML:**
```html
<div class="swim-box" data-id="issue-id" data-status="started">
  <span class="swim-box-state">◐</span>
  <span class="swim-box-id">LIN-42</span>
  <span class="swim-box-title">Fix auth bug</span>
</div>
```

**Subtask group HTML:**
```html
<div class="swim-group" data-parent="parent-id">
  <div class="swim-group-label">Auth System</div>
  <div class="swim-group-items">
    {child boxes}
  </div>
</div>
```

**Settings panel controls:**
| Control | Type | Default | Effect |
|---------|------|---------|--------|
| Max lanes | range slider (1-12) | 6 | Caps lane count, merges overflow |
| Grouping | dropdown | dependency | Switches lane assignment mode |
| Box size | toggle: compact / normal | normal | Smaller boxes show only indicator + ID |
| Show completed | checkbox | false | Include/exclude done tasks |
| Show links | checkbox | true | Show/hide cross-lane relationship indicators |

Settings changes trigger `render()` and persist to `localStorage` key `swim-settings`.

**Click interaction:**
- Click a task box → show a small tooltip/popover with: full title, description
  preview, priority, assignee, link to Linear. Not a full detail view — keep it light.
- This is intentionally simpler than swipe's full card. Users who want detail can
  click through to the issue in the tree or swipe view.

---

## Step 6: Styles (`public/swim.css`)

CLI aesthetic, consistent with the rest of the app.

**Layout:**
- `.swim-page`: full width, horizontal scroll on overflow
- `.swim-settings-panel`: collapsible panel at top, monospace labels, compact controls
- `.swim-container`: overflow-x: auto for horizontal scrolling
- `.swim-lanes`: display: flex, flex-direction: column, gap between lanes
- `.swim-lane`: display: flex, flex-direction: row, align-items: center
- `.swim-lane-label`: fixed-width left column (120px), monospace, truncated
- `.swim-lane-items`: display: flex, flex-direction: row, gap: 8px, flex-wrap: nowrap

**Task boxes:**
- `.swim-box`: border: 1px solid #e0e0e0, border-radius: 6px, padding: 0.3rem 0.5rem,
  white-space: nowrap, max-width: 180px, overflow: hidden, text-overflow: ellipsis
- Status accent: coloured left border (green=done, yellow=in-progress, grey=todo)
- Hover: slight background change, cursor pointer
- `.swim-box.compact`: smaller padding, only shows state + identifier

**Groups:**
- `.swim-group`: dashed border, border-radius: 8px, padding: 4px,
  contains child boxes in a row
- `.swim-group-label`: tiny monospace text above the group

**Cross-lane links:**
- `.swim-box.blocked`: red-tinted left border
- `.swim-box-blocked-by`: tiny label below box text, "← LIN-XX", muted red

**Responsive:**
- Mobile: tighter padding/margins, smaller font sizes, narrower boxes
- Same horizontal scroll behaviour on all screen sizes

**Settings panel:**
- Monospace labels, compact inputs
- Collapsed by default, toggle with "⚙ settings" button
- Bordered section, light background

---

## Step 7: Screenshot Maker (`tests/e2e/swim-screenshots.spec.js`)

A Playwright test file specifically for generating screenshots of the swim view
with different configurations. Not part of the regular test suite — run manually.

**Approach:**
- Use the `swimSample=true` session flag to load rich sample data
- Navigate to `/workspace/test-workspace/swim`
- For each configuration variant, adjust settings via the UI controls, then
  capture a screenshot

**Screenshots to capture:**
1. Default view (dependency grouping, 6 max lanes, normal boxes)
2. Compact boxes
3. Project grouping
4. Assignee grouping
5. Max lanes = 3 (merged lanes)
6. Max lanes = 12 (many lanes)
7. With completed tasks shown
8. Mobile viewport (375px wide)

**Output:** Screenshots saved to `tests/screenshots/swim/` directory.

**Run command:** `npx playwright test tests/e2e/swim-screenshots.spec.js --project=chromium`

The test file uses `test.describe.configure({ mode: 'serial' })` since screenshots
are sequential. Each test case:
```js
test('default view', async ({ page }) => {
  await page.goto('/test/set-session?swimSample=true');
  await page.goto(SWIM_URL);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'tests/screenshots/swim/default.png', fullPage: true });
});
```

---

## Step 8: E2E Tests (`tests/e2e/swim.spec.js`)

Basic functional tests for the swim page.

**Tests:**
1. Page loads with lanes visible
2. Settings panel toggles open/closed
3. Changing max lanes slider re-renders with correct lane count
4. Changing grouping dropdown re-renders with correct lane labels
5. Compact mode reduces box size
6. Show completed toggle adds/removes completed tasks
7. Clicking a task box shows popover with title and details
8. Horizontal scrolling works (lanes wider than viewport)
9. Settings persist across page reload (localStorage)
10. Page works with standard mock data (not just swim sample)

---

## Step 9: Unit Tests (`tests/unit/swim-lanes.test.js`)

Already described in Step 1. Tests for the lane assignment algorithm covering:
- Dependency chain detection
- Lane merging with maxLanes
- All four grouping modes
- Edge cases: empty input, single issue, circular dependencies, orphan issues

---

## File Summary

| File | Type | Description |
|------|------|-------------|
| `lib/swim-lanes.js` | New | Lane assignment algorithm |
| `lib/render-swim.js` | New | Server-side HTML renderer |
| `public/swim.js` | New | Client-side rendering + settings |
| `public/swim.css` | New | Styles |
| `tests/fixtures/swim-sample-data.js` | New | Realistic sample data generator |
| `tests/unit/swim-lanes.test.js` | New | Unit tests for lane algorithm |
| `tests/e2e/swim.spec.js` | New | E2E functional tests |
| `tests/e2e/swim-screenshots.spec.js` | New | Screenshot capture script |
| `server.js` | Modified | Add swim route + swim sample data flag |
| `routes/test.js` | Modified | Support `swimSample` session flag |

---

## Implementation Order

1. `lib/swim-lanes.js` + `tests/unit/swim-lanes.test.js` — algorithm first, test-driven
2. `tests/fixtures/swim-sample-data.js` — sample data
3. `lib/render-swim.js` — renderer
4. `public/swim.css` — styles
5. `public/swim.js` — client-side logic
6. `server.js` + `routes/test.js` — route wiring
7. `tests/e2e/swim.spec.js` — E2E tests
8. `tests/e2e/swim-screenshots.spec.js` — screenshot maker
9. Verify: run unit tests, E2E tests, capture screenshots
