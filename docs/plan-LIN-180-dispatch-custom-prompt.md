# Implementation Plan: LIN-180 — Dispatch Custom Prompt

## Summary

Add the ability for users to type and dispatch a custom freeform prompt from the queue panel. If the text starts with a `/` (slash command), resolve it to the corresponding prompt template before dispatching.

## Current State

- Users can only dispatch **pre-built prompts** (14 handwritten templates like `look-into`, `plan`, `implementation`) or **AI-generated recommendations**
- Dispatching requires: click issue → expand Prompts → click label → wait for prompt to load → click dispatch
- The queue panel (modal) shows queued items but has no input capability
- The dispatch API (`POST /workspace/:urlKey/api/dispatch`) already accepts freeform prompt text — no backend changes needed

## Design

### Where: Queue Panel

Add a custom prompt input area **at the top of the queue panel** (above the items list). This is the natural location because:
- The queue panel is already the dispatch management hub
- It avoids cluttering the per-issue Prompts section
- General-purpose prompts don't always need issue context

### Slash Command Handling

When the user types text starting with `/`, treat the remainder as a prompt template key:
- `/plan` → resolves to the "plan" template
- `/look-into` → resolves to the "look into" template
- `/implementation` → resolves to the "implement" template

Since slash commands require issue context to generate the full prompt, and the queue panel is not issue-scoped, slash commands dispatched from the queue panel will be sent **as-is** (the literal text `/plan`, `/look-into`, etc.) and interpreted by the consumer. This keeps the implementation simple and avoids requiring an issue picker.

> **Note**: If issue-scoped slash command resolution is desired later, it can be added as a follow-up by placing a custom input in the per-issue Prompts section.

### Data Flow

```
User opens queue panel → types custom text → clicks "dispatch" or "dispatch → web"
  → POST /workspace/:urlKey/api/dispatch
    {
      prompt: "<user text>",
      promptName: "Custom",
      issueId: null,
      issueTitle: null,
      target: "cli" | "web"
    }
  → Item appears in queue → consumer polls and claims
```

## Files to Modify

### 1. `public/app.js` — Client-side dispatch logic

**Location**: `showQueuePanel()` function (line ~1199)

**Changes**:
- Add custom prompt input form to the panel HTML (textarea + dispatch buttons)
- Add event handler for the custom dispatch buttons
- On submit: POST to `/workspace/:urlKey/api/dispatch` with the textarea content
- Show feedback (dispatched!/failed) and refresh the items list
- Clear textarea on success

**New HTML in panel** (inserted between header and items):
```html
<div class="queue-panel-input">
  <textarea class="queue-custom-prompt"
            placeholder="Type a custom prompt or /command..."
            rows="3"></textarea>
  <div class="queue-custom-actions">
    <button class="queue-custom-dispatch" data-target="cli">dispatch</button>
    <button class="queue-custom-dispatch" data-target="web">dispatch → web</button>
  </div>
</div>
```

**Event handler** (in `initQueuePanel()`):
- Listen for clicks on `.queue-custom-dispatch`
- Read textarea value, validate non-empty
- POST to dispatch API
- Show button feedback (sending → dispatched! → reset)
- Refresh queue items and badge

### 2. `public/style.css` — Styling

**New styles** (after `.queue-panel-header` block, ~line 208):

```css
.queue-panel-input {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--fg-vdim);
}

.queue-custom-prompt {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--font-mono);
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

/* Reuse .dispatch-btn styling from prompt containers */
```

### 3. `tests/e2e/dispatch.spec.js` — E2E tests

**New test cases**:

1. **Custom prompt input visible in queue panel** — Open panel, verify textarea and dispatch buttons exist
2. **Can dispatch custom freeform text** — Type text, click dispatch, verify "dispatched!" feedback, verify item appears in queue
3. **Can dispatch custom prompt with web target** — Same as above but click "dispatch → web", verify target is "web"
4. **Empty input shows validation feedback** — Click dispatch with empty textarea, verify "failed" or no-op
5. **Slash command dispatched as literal text** — Type `/plan`, dispatch, verify prompt text is literally "/plan"

## Scope Assessment

**Single coherent change**: Yes. All modifications are tightly coupled:
- The panel HTML, its event handlers, and its styling ship together
- No independent sub-features that could ship separately
- No backend changes needed
- No context-switching between unrelated systems

**Estimated test additions**: 5 new test cases in `dispatch.spec.js`

**No changes needed to**:
- `routes/dispatch.js` (API already accepts freeform text)
- `lib/dispatch-store.js` (storage already handles any prompt string)
- `lib/render.js` (server-rendered HTML doesn't change; input is client-side in panel)
- `lib/prompt-templates.js` (no template changes)

## Acceptance Criteria

1. Queue panel shows a textarea input with "dispatch" and "dispatch → web" buttons
2. User can type freeform text and dispatch it to the queue
3. Dispatched custom prompt appears in queue items list
4. Button feedback works (sending → dispatched! → reset)
5. Empty input is rejected (no dispatch with blank text)
6. Queue badge updates after custom dispatch
7. Consumer can poll and claim custom-dispatched items
8. All existing dispatch tests continue to pass
