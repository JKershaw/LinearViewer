# LIN-1412 — chat interface prototypes

Design artifacts for LIN-1412. **Nothing here ships.** The contract these demonstrate is
`plans/lin-1412-design-notes.md`.

## Run it

```bash
open prototypes/lin-1412-chat/shape-a.html      # embedded panel
open prototypes/lin-1412-chat/shape-b.html      # viewport-anchored full page

node prototypes/lin-1412-chat/verify.mjs        # both shapes against the same contract
node prototypes/lin-1412-chat/verify.mjs b      # one shape
node prototypes/lin-1412-chat/shoot.mjs         # light/dark × desktop/mobile, both shapes
```

Both scripts must be run **from the repo root** (they resolve `playwright` from the repo's
`node_modules`). The pages themselves need nothing but a browser.

Current: **Shape A 35/35 · Shape B 40/40**. Shape B's extra five are the rules only it can
reach — viewport-anchored composer, single page scroller, dvh sizing, last-message clearance,
and the declared safe-area inset.

## The two shapes

| | Shape | Model |
|--|--|--|
| **A** | `shape-a.html` | Chat as an **embedded panel** inside a host page — the current model, made compliant. Host content above *and below* the panel, because that is the real constraint (Task Chat has a saved-chat list under its ask bar, `lib/render-task-chat.js:105`). |
| **B** | `shape-b.html` | The guide's §3 model — slim header, the thread as the page's one scroller, composer anchored to the viewport bottom. |

**The only variable is the layout.** Both load the same `chat-next.js`, the same
`chat-next.css`, and the same `scenes.js` — same conversation, same six states, same
transport. A difference between them is the shape and nothing else.

**Zero behaviour-layer changes were needed to serve both.** Shape B is an opt-in `.chat-page`
CSS block, in the same idiom as `.chat-thread--log` and `.chat-composer--inline`. That is
evidence the behaviour seam is separable from the layout question — the shape decision does
not block the implementation.

### Measured difference

| | Shape A | Shape B |
|--|--|--|
| Contract checks | 35/35 | 40/40 |
| Reading area (900px viewport) | **46%** | **65%** |
| Composer anchored to viewport | no — impossible | yes |
| Page scrollers | 2 (page + thread) | 1 |

## Files

| File | What it is |
|--|--|
| `chat-next.js` | **The proposed shared behaviour layer** — `ChatUI.mount()`, additive over the real `public/chat.js`. Shape-agnostic. |
| `chat-next.css` | **The proposed delta to `public/chat.css`**, including the opt-in `.chat-page` anchored variant. |
| `scenes.js` | The conversation, the six states and the transport wiring — shared by both shapes so the comparison is fair. |
| `shape-a.html` / `shape-b.html` | The two host pages. |
| `mock-agent.js` | Fake transport — token-at-a-time, visible first-token delay, abortable, injectable failure. |
| `verify.mjs` | Drives both pages and asserts the contract rule by rule. |
| `shoot.mjs` | The screenshot matrix, and it re-runs the §9 proof. |
| `compare.mjs` | Measures the two shapes side by side (reading area, answer visibility, composer reachability, scroller count). Analysis only — no pass/fail. |
| `screenshots/` | Committed evidence, `shape-{a,b}-{scene}-{theme}-{width}.png`. |

## What is real and what is faked

**Real:** the token layer and the shared chat primitives (`public/style.css`,
`public/chat.css`, `public/common.js`, `public/chat.js`, `marked.min.js`, `purify.min.js`)
are linked, not copied — so the prototypes render what the app would render, and dark mode
works through the actual `.theme-dark` hook. `chat-next.*` is the proposed change on top.

**Faked:** the transport, the session data, and the surrounding page.

**One deliberate divergence:** the §9 at-bottom test belongs inside `public/chat.js`'s
`reveal()` — the one function every shared consumer calls on every append. A prototype must
not edit production files, so `chat-next.js` passes `reveal: false` and owns the scroll
decision itself. Same logic, different home.

**Font note:** `public/style.css` declares its faces at root-absolute `/fonts/*.woff2`, which
only a server resolves. Both pages re-declare the same files by relative path so they render
in real Inter / JetBrains Mono under `file://`.

## What Shape A cannot reach

1. **§3 viewport-anchored input — impossible.** The composer is in document flow with a whole
   section below it.
2. **§3's ~120px bottom clearance — N/A.** Nothing to clear.
3. **§10 input above the mobile keyboard — no mechanism.** With the composer mid-document,
   that is the browser's scroll-into-view decision, not something the layer can own.
4. **Two nested scrollers, permanently** — and the ambiguity about *which box* is exactly what
   produced the C1 bug in Collective.
5. **Long answers are read through a keyhole** — 46% of the viewport vs Shape B's 65%.
6. **Jump-to-latest sits inside a small panel.** (Beat 3 claimed this overlaps content in a way
   Shape B avoids; `compare.mjs` measured it and the pill floats over message content in
   **both** shapes — that is what a floating pill in a scroll container does. The claim is
   withdrawn; the real difference is only that A's panel is 46% of the viewport to B's 65%.)

## What Shape B costs

1. **It has to opt out of the app's page box.** `public/style.css:293-300` gives every page
   `padding: var(--space-5)` and `max-width: 120ch; margin: auto`. A `100dvh` shell cannot
   live inside that, so `shape-b.html` resets `body`. Every other Harbour page shares that box.
2. **§3's "~120px bottom padding" does not apply.** That rule assumes an input that *overlays*
   the scroll container; in a three-row shell the composer is its own row, so 120px of
   clearance would be 120px of dead space. `verify.mjs` asserts what the rule is actually
   protecting instead — the last message ends above the composer (currently 24px).
3. **Host content has to go somewhere.** Task Chat's setup and saved-chat sections
   (`lib/render-task-chat.js:101-105` — three stacked `renderSection` blocks) would have to
   become header affordances plus an overlay, and **Harbour has no drawer or modal primitive**
   — `lib/components/` is 20 chrome modules (button/card/surface/section/field/empty-state/
   disclosure/…), none of them an overlay.
4. **It is structurally wrong for the session page.** See below — this is the finding that
   makes a clean binary impossible.
5. **IA cost.** The Observation feed links `open ↗` / `reply →` straight at the session page
   (`public/observation.js:282`). A separate chat route puts the conversation two hops from
   the evidence — and the transcript, telemetry and artifacts you would want to quote while
   asking are on the page you just left.

### Shape B does not apply to all four surfaces

| Surface | Shape B? | Why |
|--|--|--|
| **S1 Task Chat** | **Yes** | Already its own route (`routes/task-chat.js:194`) and already a dedicated conversational page. The best fit of the four. |
| **S2 Session reply** | **No — structurally** | The session page does not have *a* transcript and *a* composer. `lib/render-session.js:199-210` renders a transcript **and an inline reply box per run**, and `renderLineageGroup` (`:287-297`) hoists exactly one box per lineage — the tail's own, "not synthesized or aggregated". `public/session.js:169-192` iterates `[data-testid="session-inline-reply"]`: N composers, each carrying its own `data-loop-id` → `followUpTo`. A single-composer page has one target; S2's semantic is *reply to THIS run*, and LIN-1478/LIN-1252 made that targeting deliberately precise (`force` comes from the tail's own terminal status and must never be aggregated across a lineage). Flattening the runs into one conversation would discard that. |
| **S3 Collective** | **Partly** | The live watch-the-swarm transcript suits a full page well. But `/start` must precede watching, so the page is setup-then-watch; only the watch half is Shape B. |
| **S4 Roadmap chat** | **No** | It is a `<details>` panel on a report page (`public/roadmap.js:692-696`) whose entire value is asking about the report in front of you. A full page divorces the question from its subject. |

**So the honest answer is not A-or-B.** It is one shared behaviour layer with two layout
variants, chosen per surface: Shape B for Task Chat (and Collective's watch mode), Shape A —
made compliant — for the session page and Roadmap. Beat 4 owns the recommendation.
