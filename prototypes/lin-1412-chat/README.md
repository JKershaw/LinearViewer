# LIN-1412 — chat interface prototypes

Design artifacts for LIN-1412. **Nothing here ships.** The contract these demonstrate is
`plans/lin-1412-design-notes.md`.

## Run it

```bash
open prototypes/lin-1412-chat/shape-a.html      # no server, no build

node prototypes/lin-1412-chat/verify.mjs        # drive it and assert the contract (33 checks)
node prototypes/lin-1412-chat/shoot.mjs         # light/dark × desktop/mobile screenshots
```

Both scripts must be run **from the repo root** (they resolve `playwright` from the repo's
`node_modules`). The page itself needs nothing but a browser.

## Shapes

| | Shape | Status |
|--|--|--|
| **A** | `shape-a.html` — chat as an **embedded panel** inside a host page, on a shared behaviour layer. The current model, made compliant. | built (beat 2) |
| **B** | viewport-anchored full-page chat | beat 3 |

Shape A's host page deliberately has content **above and below** the panel, because that is
the real constraint: Task Chat has a "Saved chats" section under its ask bar
(`lib/render-task-chat.js:105`), and the session page has brief/recap panels under its reply
box. It is why §3's viewport-anchored input is unreachable in this shape.

## Files

| File | What it is |
|--|--|
| `chat-next.js` | **The proposed shared behaviour layer** — `ChatUI.mount()`, additive over the real `public/chat.js`. This is the reference implementation the plan pass would sequence, not throwaway demo code. |
| `chat-next.css` | **The proposed delta to `public/chat.css`** — nothing restated, only what the change would add. |
| `shape-a.html` | The host page: prototype banner, fake session chrome, the chat panel, a scene rail. |
| `mock-agent.js` | Fake transport — token-at-a-time with a visible first-token delay, an abortable stream, and an injectable failure. |
| `verify.mjs` | Drives the page and asserts the contract rule by rule. |
| `shoot.mjs` | Screenshots, and re-runs the §9 proof. |
| `screenshots/` | Committed evidence. |

## What is real and what is faked

**Real:** the token layer and the shared chat primitives (`public/style.css`,
`public/chat.css`, `public/common.js`, `public/chat.js`, `public/marked.min.js`,
`public/purify.min.js`) are linked, not copied — so the prototype renders what the app would
render, and dark mode works through the actual `.theme-dark` hook. `chat-next.*` is the
proposed change on top.

**Faked:** the transport, the session data, and the surrounding page.

**One deliberate divergence:** the §9 at-bottom test belongs inside `public/chat.js`'s
`reveal()` — the one function every shared consumer calls on every append. A prototype must
not edit production files, so `chat-next.js` passes `reveal: false` and owns the scroll
decision itself. Same logic, different home; see the header comment in `chat-next.js`.

**Font note:** `public/style.css` declares its faces at root-absolute `/fonts/*.woff2`, which
only a server resolves. `shape-a.html` re-declares the same files by relative path so the
prototype renders in real Inter / JetBrains Mono under `file://`.
