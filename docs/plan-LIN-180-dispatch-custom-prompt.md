# Implementation Plan: LIN-180 — Dispatch Custom Prompt

## Summary

Add a custom prompt textarea + dispatch buttons to the queue panel modal, allowing users to type freeform text (or slash commands) and dispatch directly. Include a recent custom prompts list persisted server-side via `UserPreferencesStore` (MongoDB/MangoDB) so prompts are available on any device.

## Architecture Decision: Server-Side Storage for Recent Prompts

Recent custom prompts are stored in the existing `user-preferences` MongoDB collection (via `UserPreferencesStore`), keyed by Linear user ID. This mirrors how `modelId` and `features` are already persisted cross-device.

**Schema** (within the existing preferences document):
```json
{
  "_id": "<linearUserId>",
  "preferences": {
    "modelId": "...",
    "features": { ... },
    "recentCustomPrompts": {
      "<workspaceUrlKey>": ["prompt text 1", "prompt text 2", ...]
    }
  }
}
```

Scoped per workspace since prompts may reference workspace-specific issues/context. Max 10 per workspace.

**New API endpoints** (in `routes/dispatch.js`):
- `GET /workspace/:urlKey/api/dispatch/recent-prompts` — fetch recent prompts list
- `POST /workspace/:urlKey/api/dispatch/recent-prompts` — save a prompt to the list (called after successful dispatch)

## Steps

### Step 1: Add recent prompts API endpoints (`routes/dispatch.js`)

The `createDispatchRoutes` function needs the `userPreferencesStore` dependency. Update the function signature and add two endpoints.

**Update function signature** (line 63):
```js
export function createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore }) {
```

**Add GET endpoint** — after the count endpoint (~line 220):
```
GET /workspace/:urlKey/api/dispatch/recent-prompts
```
1. Read `req.session.linearUserId`; return `[]` if not set
2. Call `userPreferencesStore.getUserPreferences(linearUserId)`
3. Extract `preferences.recentCustomPrompts[urlKey]` (default `[]`)
4. Return `{ prompts: [...] }`

**Add POST endpoint**:
```
POST /workspace/:urlKey/api/dispatch/recent-prompts
```
Body: `{ prompt: "text" }`
1. Validate `prompt` is non-empty string, max 10000 chars
2. Read existing preferences
3. Get `recentCustomPrompts[urlKey]` array (or `[]`)
4. Remove duplicate if exists (dedup by exact match)
5. Prepend new prompt
6. Trim to max 10 items
7. Save back to preferences
8. Return `{ success: true }`

### Step 2: Wire `userPreferencesStore` into dispatch routes (`server.js`)

**Edit** line 480: Pass `userPreferencesStore` to `createDispatchRoutes`:
```js
app.use(createDispatchRoutes({ dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore }))
```

### Step 3: Add test cleanup route (`routes/test.js`)

Add a `/test/clear-recent-prompts` endpoint that clears the `recentCustomPrompts` key for the test user, so E2E tests start from a clean slate.

### Step 4: Add custom prompt input HTML to queue panel (`public/app.js`)

**Edit `showQueuePanel()`** (line 1212): Insert a `queue-panel-input` div between the header and items divs in the panel's `innerHTML` template.

```html
<div class="queue-panel-input">
  <textarea class="queue-custom-prompt"
            placeholder="Type a custom prompt or /command..."
            rows="3"></textarea>
  <div class="queue-custom-actions">
    <button class="queue-custom-dispatch" data-target="cli">dispatch</button>
    <button class="queue-custom-dispatch" data-target="web">dispatch &rarr; web</button>
  </div>
  <div class="queue-custom-recents"></div>
</div>
```

After the panel is appended, fetch and render recent prompts:
```js
renderRecentPrompts(panel, urlKey)
```

### Step 5: Add `renderRecentPrompts()` function (`public/app.js`)

```js
async function renderRecentPrompts(panel, urlKey) {
  const container = panel.querySelector('.queue-custom-recents')
  try {
    const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/recent-prompts`)
    if (!res.ok) return
    const { prompts } = await res.json()
    if (!prompts || prompts.length === 0) {
      container.innerHTML = ''
      return
    }
    container.innerHTML = `
      <div class="queue-recents-label">Recent:</div>
      <div class="queue-recents-list">
        ${prompts.map(p => {
          const display = p.length > 60 ? p.slice(0, 60) + '…' : p
          return `<button class="queue-recent-item" data-prompt="${escapeHtml(p)}" title="${escapeHtml(p)}">${escapeHtml(display)}</button>`
        }).join('')}
      </div>
    `
  } catch (e) {
    // Non-fatal: just don't show recents
  }
}
```

### Step 6: Add click handler for recent prompts (`public/app.js`)

**Edit `initQueuePanel()`**: Add a delegated click handler for `.queue-recent-item` buttons.

On click:
1. Read `data-prompt` attribute (full prompt text)
2. Set `.queue-custom-prompt` textarea value
3. Focus the textarea

### Step 7: Add click handler for custom dispatch buttons (`public/app.js`)

**Edit `initQueuePanel()`** (after the existing remove-button handler): Add a delegated click handler for `.queue-custom-dispatch` buttons.

Logic:
1. Find the clicked `.queue-custom-dispatch` button
2. Get the panel's `data-url-key` attribute
3. Read textarea value from `.queue-custom-prompt`, trim whitespace
4. If empty, briefly show "empty" on button, return early
5. Read `data-target` from the button (`"cli"` or `"web"`)
6. Show "sending..." feedback on the button
7. `POST /workspace/${urlKey}/api/dispatch` with body:
   ```json
   { "prompt": "<text>", "promptName": "Custom", "target": "cli"|"web" }
   ```
8. On success:
   - Show "dispatched!" feedback on button
   - Save prompt to server: `POST /workspace/${urlKey}/api/dispatch/recent-prompts` with `{ prompt }`
   - Clear textarea
   - Re-fetch and re-render queue items in panel
   - Re-render recent prompts list (call `renderRecentPrompts()` again)
   - Update queue badge count
9. On error: show "failed" feedback
10. After 1500ms timeout, reset button text to original label

### Step 8: Adjust `.queue-panel-items` max-height (`public/style.css`)

**Edit** line 224: Update to account for the new input area:
```css
.queue-panel-items {
  max-height: calc(70vh - 170px);
}
```

### Step 9: Add custom prompt input and recent prompt styles (`public/style.css`)

**Insert after `.queue-panel-close:hover`** (after line 221):

```css
.queue-panel-input {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--fg-vdim);
}

.queue-custom-prompt {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-structural);
  font-size: 0.85em;
  padding: 0.5rem;
  border: 1px solid var(--fg-vdim);
  border-radius: 3px;
  background: var(--bg);
  color: var(--fg);
  resize: vertical;
  min-height: 3em;
}

.queue-custom-prompt:focus {
  outline: none;
  border-color: var(--blue, #4EA7FC);
}

.queue-custom-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.queue-recents-label {
  font-size: 0.8em;
  color: var(--fg-dim);
  margin-top: 0.5rem;
}

.queue-recents-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.queue-recent-item {
  background: none;
  border: 1px solid var(--fg-vdim);
  border-radius: 3px;
  padding: 0.15rem 0.4rem;
  font-family: var(--font-content);
  font-size: 0.75em;
  color: var(--fg-dim);
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-recent-item:hover {
  border-color: var(--blue, #4EA7FC);
  color: var(--blue, #4EA7FC);
}
```

### Step 10: Extend dispatch button styles (`public/style.css`)

**Edit** the `.prompt-dispatch` selectors (~line 1295) to also apply to `.queue-custom-dispatch`:
```css
.prompt-dispatch, .queue-custom-dispatch { ... }
.prompt-dispatch:hover, .queue-custom-dispatch:hover { ... }
.prompt-dispatch.dispatched, .queue-custom-dispatch.dispatched { ... }
```

### Step 11: Add E2E tests (`tests/e2e/dispatch.spec.js`)

Add a new `test.describe('Custom Prompt Dispatch')` block. `beforeEach`: clear dispatch queue, clear dispatch tokens, clear recent prompts, set session with dispatch feature, navigate.

**Test 1: "custom prompt input visible in queue panel"**
- Dispatch an item via API (to make badge visible)
- Click queue badge to open panel
- Assert `.queue-custom-prompt` textarea is visible
- Assert two `.queue-custom-dispatch` buttons with `data-target` "cli" and "web"

**Test 2: "can dispatch custom freeform text"**
- Dispatch item via API to make badge visible
- Open queue panel
- Fill textarea with "Review the auth module for security issues"
- Click `data-target="cli"` dispatch button
- Assert button shows "dispatched!" feedback
- Assert textarea is cleared
- Verify item in queue via API — prompt text matches, promptName is "Custom"

**Test 3: "can dispatch custom prompt with web target"**
- Open queue panel (with seed item for badge)
- Type "Check deployment status"
- Click `data-target="web"` dispatch button
- Verify dispatched item has `target: "web"` via API

**Test 4: "empty input shows validation feedback"**
- Open queue panel
- Click dispatch with empty textarea
- Assert button briefly shows "empty"
- Assert no new item in queue

**Test 5: "slash command dispatched as literal text"**
- Open queue panel, type "/plan", dispatch
- Verify item prompt is literally "/plan" via API

**Test 6: "recent custom prompts appear after dispatch"**
- Open queue panel
- Type "First custom prompt" and dispatch
- Close and reopen queue panel
- Assert `.queue-recent-item` is visible with text "First custom prompt"

**Test 7: "clicking recent prompt fills textarea"**
- Dispatch a custom prompt ("Reusable prompt text")
- Close and reopen queue panel
- Click the recent prompt item
- Assert textarea value is "Reusable prompt text"

### Step 12: Run tests and verify

- Run `npm test` to ensure all existing + 7 new tests pass

## Files Modified

| File | Change |
|------|--------|
| `routes/dispatch.js` | Add `userPreferencesStore` param; add GET/POST `/recent-prompts` endpoints |
| `server.js` | Pass `userPreferencesStore` to `createDispatchRoutes()` |
| `routes/test.js` | Add `/test/clear-recent-prompts` cleanup endpoint |
| `public/app.js` | Add input HTML in `showQueuePanel()`, `renderRecentPrompts()`, click handlers in `initQueuePanel()` |
| `public/style.css` | Add `.queue-panel-input` / `.queue-custom-prompt` / `.queue-custom-actions` / `.queue-recents-*` styles; extend dispatch-btn selectors; adjust items max-height |
| `tests/e2e/dispatch.spec.js` | Add 7 new test cases in `Custom Prompt Dispatch` describe block |

## Files NOT Modified

- `lib/user-preferences.js` — existing `getUserPreferences` / `saveUserPreferences` API is sufficient
- `lib/dispatch-store.js` — storage already handles any prompt string
- `lib/render.js` — server-rendered HTML unchanged; input is client-side only
- `lib/prompt-templates.js` — no template changes needed

## Acceptance Criteria

1. Queue panel shows textarea with placeholder "Type a custom prompt or /command..."
2. Two dispatch buttons below textarea: "dispatch" (cli) and "dispatch → web"
3. Typing text and clicking dispatch sends it to the queue
4. Dispatched item appears in queue items list (panel refreshes)
5. Queue badge updates after custom dispatch
6. Button feedback: sending → dispatched! → reset (1500ms)
7. Empty textarea rejected with "empty" feedback, no API call
8. Textarea cleared on successful dispatch
9. Recent custom prompts persisted server-side in user preferences (per workspace, max 10)
10. Recent prompts available on any device the user logs in from
11. Recent prompts displayed as clickable chips below the textarea
12. Clicking a recent prompt fills the textarea with its text
13. Recent list updates immediately after dispatching a new custom prompt
14. Consumer can poll and claim custom-dispatched items (existing API, no changes)
15. All existing dispatch tests continue to pass
