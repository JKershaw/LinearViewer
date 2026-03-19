# Swim View — Horizontal Ordering by Status Segments

## Goal

Within each swim lane, group items by status into "segments" that align globally
across all lanes. In-progress items pack left, todo items start at a consistent
offset, backlog items further right. No visual dividers — just whitespace created
by `min-width` on segment containers.

## Design

### Segment assignment

Each item gets a `segment` key derived from its `stateType`:
- `started` → segment 0
- `unstarted` → segment 1
- `backlog` → segment 2
- `completed`/`canceled` → segment 3 (only visible when "show completed" is on)

**Exception — dependency promotion**: In dependency grouping mode, a todo/backlog
item that blocks an in-progress item stays in segment 0 (it's part of the active
chain). This prevents gaps in the middle of dependency sequences.

### Within-segment ordering

Items within a segment keep their current ordering logic:
- Dependency mode: topological sort (blockers before blocked)
- Other modes: original sort order (priority-based from `sortIssuesForSwipe`)

Status is used as a **tiebreaker** in the topological sort for dependency mode:
among items at the same dependency level, in-progress sorts before todo.

### Global alignment

Each segment gets a `min-width` computed as:
```
segmentMinWidth[s] = maxItemsInSegment(s, acrossAllLanes) * slotWidth
```

Where `slotWidth` accounts for box width + gap + arrow. This ensures all lanes'
segment-1 items start at roughly the same horizontal offset.

`slotWidth` varies by compact mode:
- Normal: ~210px (200px max-width box + gap + arrow)
- Compact: ~140px (120px max-width box + gap + arrow)

### HTML structure change

Before:
```html
<div class="swim-lane-items">
  [box] → [box] → [box] → [box]
</div>
```

After:
```html
<div class="swim-lane-items">
  <div class="swim-lane-segment" data-segment="0" style="min-width: 420px">
    [box] → [box]
  </div>
  <div class="swim-lane-segment" data-segment="1" style="min-width: 320px">
    [box] → [box]
  </div>
</div>
```

### CSS for segments

```css
.swim-lane-segment {
  display: flex;
  align-items: center;
  gap: 8px;           /* same as current .swim-lane-items gap */
  flex-shrink: 0;
  flex-wrap: nowrap;
}
```

The parent `.swim-lane-items` keeps its flex layout — segments flow left to right.

## Implementation Steps

### 1. Add segment assignment to `lib/swim-lanes.js` and client-side copy

New exported function:
```js
export function assignSegments(lanes, options)
```

- Walks each lane's items and assigns a `segment` property (0, 1, 2, 3)
- In dependency grouping: promotes blockers-of-started items to segment 0
- Returns the modified lanes (mutates items in place)

Also add status-based tiebreaker to `orderByDependency` — when two items have
the same in-degree of 0 and same original index priority, prefer lower segment
(started before unstarted).

### 2. Add segment layout computation

New function (client-side only, in `public/swim.js`):
```js
function computeSegmentWidths(lanes, slotWidth)
```

- For each segment index, find the max item count across all lanes
- Returns array of min-widths: `[seg0Width, seg1Width, ...]`

### 3. Update `render()` in `public/swim.js`

- After `assignLanes()`, call `assignSegments()` on the result
- Compute segment widths
- When rendering lane items, wrap each segment's boxes in a
  `.swim-lane-segment` div with the computed `min-width`
- Groups (parent+children) stay together — the entire group counts as
  one "slot" for width calculation purposes

### 4. Add CSS for `.swim-lane-segment`

Minimal styling — just flex container properties. Inherits gap from
current `.swim-lane-items`.

### 5. Update `lib/swim-lanes.js` server-side (mirror)

Keep server and client copies in sync. The server-side module gets
`assignSegments` exported for potential future SSR use and for unit tests.

### 6. Add unit tests

In `tests/unit/swim-lanes.test.js`:
- `assignSegments` puts started items in segment 0, unstarted in 1, backlog in 2
- Dependency promotion: todo item blocking a started item → segment 0
- Segment widths computed correctly (max across lanes)
- Empty lanes produce no segments

### 7. Update E2E tests

In `tests/e2e/swim.spec.js`:
- Verify `.swim-lane-segment` elements exist within lanes
- Verify segment data attributes

### 8. Regenerate screenshots

Run the screenshot spec to capture the new layout with segment alignment.

## Files Changed

| File | Change |
|------|--------|
| `lib/swim-lanes.js` | Add `assignSegments()` export |
| `public/swim.js` | Add `assignSegments()`, `computeSegmentWidths()`, update `render()` |
| `public/swim.css` | Add `.swim-lane-segment` styles |
| `tests/unit/swim-lanes.test.js` | Add segment assignment tests |
| `tests/e2e/swim.spec.js` | Update selectors for segment structure |
