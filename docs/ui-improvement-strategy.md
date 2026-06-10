# UI Improvement Strategy

A research-backed plan for making the UI of Linear Projects Viewer **easy to
change and improve**. This document orients on how the UI is built today,
names the specific friction points, and lays out a sequenced, low-risk plan.

> Scope note: the goal here is *changeability* — reducing the cost and risk of
> future UI work — not a redesign. Every recommendation preserves the existing
> CLI/terminal aesthetic and the "no frameworks, no build step" principle.

## 1. How the UI is built today

The stack is deliberately minimal, in line with the project's design
principles (no framework, no build step):

| Layer | Where | Size |
|-------|-------|------|
| HTML (server-rendered template literals) | `lib/render*.js` (16 files) | ~4,200 lines |
| CSS | `public/*.css` (14 files) | ~9,500 lines |
| Client JS (vanilla, per-page) | `public/*.js` | ~13,700 lines |
| Shared components | `lib/components/navbar.js`, `lib/components/footer.js` | — |
| Design tokens | `:root` in `public/style.css` | colors + fonts only |

**What already works well:**

- The **nav bar and footer are factored into shared components**
  (`renderNavBar`, `renderPageFooter`) and used consistently across all 13
  authenticated pages. This is the model to extend.
- **Design tokens exist** for colors and fonts (`public/style.css:17`) and are
  used heavily — ~1,124 `var()` references across the CSS.
- **E2E coverage is strong**: 39 Playwright specs in `tests/e2e/`. This is the
  safety net that makes refactoring viable.

## 2. What makes UI changes hard right now

### 2.1 There is no shared page shell (highest-impact gap)

Every `render-*.js` hand-rolls the entire HTML document — `<!DOCTYPE>`,
`<head>` (charset, viewport, favicon, stylesheet links), `<body>`, and the
closing `<script>` tags. There are **16 copies** of this boilerplate.

Representative examples:

- `lib/render.js:161`, `lib/render-roadmap.js:407`, `lib/render-swim.js:92`,
  `lib/render-dispatch.js:46`, `lib/render-pages.js:16` — all nearly identical
  `<head>` blocks (charset, viewport, favicon, `style.css`).
- `<script src="/common.js"></script>` + `<script src="/app.js"></script>`
  repeated across ~13 files.

**Consequence:** any *global* change — adding a meta tag, analytics, a `theme`
class on `<body>`, a new global stylesheet, `defer` on scripts, a skip-link for
accessibility — requires editing 16 files by hand and keeping them in sync.
This is the single biggest source of friction.

### 2.2 Design tokens are incomplete

`:root` in `public/style.css:17` defines **colors and font families only**.
There is no token for:

- spacing scale (margins, padding, gaps)
- border / divider colors
- border radius
- box shadows
- font-size scale
- transitions / z-index layers

As a result, spacing and borders are magic numbers scattered across ~9,500
lines of CSS, with no consistent scale to reason about or restyle from.

### 2.3 Neutral colors bypass the token system

There are **317 hardcoded hex values** across the CSS, and **73 distinct
colors** in total. The same conceptual "border gray" appears as several
different literals:

| Value | Occurrences |
|-------|-------------|
| `#e0e0e0` | 20 |
| `#999` | 13 |
| `#ddd` | 10 |
| `#ccc` | 8 |
| `#f0f0f0` | 5 |
| `#aaa` | 5 |
| `#888` | 5 |

Per-page stylesheets (notably `public/swim.css`, `public/swipe.css`,
`public/foreman.css`) also lean on a `var(--token, #hardcoded-fallback)`
pattern that re-embeds fallback literals everywhere. This partly defeats the
single-source-of-truth: a token rename fails silently behind its fallback, and
the literals drift out of sync with `:root`.

### 2.4 Downstream consequences

- **Dark mode is structurally impossible today**: tokens are light-only, there
  is no `prefers-color-scheme` handling, no `<body>` theme hook, and hundreds
  of colors are not behind tokens.
- **No living styleguide**: there is no single place to see buttons, status
  indicators, cards, and spacing. To restyle a button you must reverse-engineer
  it from `public/common-actions.css` plus 13 page-specific stylesheets.
- **Visual-regression coverage is narrow**: baselines exist only for `ship` and
  `swim` (`tests/visual/`, `tests/screenshots/`). The dashboard, settings,
  roadmap, dispatch, etc. have no visual baseline, so a CSS/token refactor
  can't be *proven* non-regressing.

## 3. The plan

Sequenced so each phase is independently shippable and low-risk. Phase 1A alone
removes the most friction; later phases compound from there.

### Phase 1 — Foundations (no visible change; existing E2E proves safety)

**1A. Extract a shared page shell.**
New `lib/components/page.js` exporting something like:

```js
renderPage({ title, stylesheets, bodyClass, nav, content, scripts, embeddedData })
```

Refactor all 16 render files (+ `lib/render-pages.js`) to compose their page
through it. Keep output byte-stable where practical; the 39 E2E specs are the
regression guard. *After this, every future global UI change is a one-file
edit.*

**1B. Complete the token set.**
Extend `:root` in `public/style.css` with `--border` / `--border-strong`, a
spacing scale (`--space-1..6`), `--radius`, `--shadow`, a font-size scale, and
transition tokens. Map the duplicated grays from §2.3 onto the new tokens.

### Phase 2 — Safety net (makes Phase 3 provably non-regressing)

**2C. Add a `/styleguide` page.**
Render every primitive in one place — palette, type scale, buttons, status
indicators (`✓ ◐ ○`), cards, badges, nav, footer. Doubles as a living design
reference *and* a single comprehensive visual-regression target.

**2D. Expand visual-regression baselines.**
Add baselines for the key pages (dashboard, settings, roadmap, dispatch,
styleguide) alongside the existing ship/swim coverage.

### Phase 3 — Consolidation (now safe)

**3E. Tokenize and dedupe.**
Replace hardcoded grays and `var(--x, #fallback)` literals with tokens across
the per-page CSS; consolidate repeated card/badge/button styles into shared
CSS.

**3F. (Now unlocked) optional dark mode.**
`prefers-color-scheme` + token overrides on a `<body>` theme hook.

## 4. Recommended order

1. **Phase 1A** — shared page shell (highest leverage, low risk).
2. **Phase 1B** — complete tokens.
3. **Phase 2C/2D** — styleguide + visual baselines (safety net).
4. **Phase 3E** — consolidate CSS onto tokens.
5. **Phase 3F** — dark mode, if desired.

## Appendix: how this was measured

- File sizes: `wc -l` over `lib/render*.js`, `lib/components/*.js`,
  `public/*.css`, `public/*.js`.
- Token usage: `grep` for `var(--…)` (~1,124) and `:root` (only `style.css`).
- Hardcoded colors: `grep -oE '#[0-9a-fA-F]{3,6}'` (317 total, 73 distinct).
- Shell duplication: `grep` for `DOCTYPE`, `<head>`, `<script` across
  `lib/render*.js` (16 hand-rolled documents).
- Test coverage: `tests/e2e/` (39 specs), `tests/visual/` (ship/swim only).
