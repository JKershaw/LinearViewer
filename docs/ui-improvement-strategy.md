# UI Improvement Strategy

A research-backed plan for making the UI/UX of Harbour **easy to
change and improve** — and to keep it that way as the app grows.

> **Goal.** Reach a state where UI/UX work is cheap and safe, whether that's
> *incremental polish* or an eventual *coherent redesign / fresh look*. The
> plan below deliberately keeps **both paths open**: it builds the foundation
> and component layer that either path needs, and defers the redesign /
> information-architecture decision until that groundwork makes it cheap.
>
> **Non-negotiables.** Preserve the CLI/terminal aesthetic and the "no
> frameworks, no build step" principle throughout.

## 1. How the UI is built today

The stack is deliberately minimal (no framework, no build step):

| Layer | Where | Size |
|-------|-------|------|
| HTML (server-rendered template literals) | `lib/render*.js` (16 files) | ~4,200 lines |
| CSS | `public/*.css` (14 files) | ~9,500 lines |
| Client JS (vanilla, per-page) | `public/*.js` | ~13,700 lines |
| Shared components | `lib/components/navbar.js`, `lib/components/footer.js` | — |
| Shared client behavior | `public/common.js` (loaded in 13/15 render files) | ~458 lines |
| Design tokens | `:root` in `public/style.css` | colors + fonts only |

**What already works well — the model to extend:**

- The **nav bar and footer are real shared components** (`renderNavBar`,
  `renderPageFooter`) used consistently across all 13 authenticated pages.
- **`common.js` is a genuine shared client layer**: disclosure panels, the nav
  bar dropdowns, team selection, dispatch — loaded nearly everywhere.
- **Color/font tokens exist and are used** (~1,124 `var()` references).
- **E2E coverage is strong**: 39 Playwright specs in `tests/e2e/`. This is the
  safety net that makes refactoring viable.

So the bones are good. The problem is that *almost everything above these few
shared pieces is reinvented per page*. There are two distinct gaps: a
**foundation** gap and a **component-vocabulary** gap.

## 2. The foundation gap

These are prerequisites — necessary but, on their own, **not sufficient** for a
redesign (see §3).

### 2.1 No shared page shell

Every `render-*.js` hand-rolls the full HTML document — `<!DOCTYPE>`, `<head>`
(charset, viewport, favicon, stylesheet links), `<body>`, and the closing
`<script>` tags. **16 copies.** Examples: `lib/render.js:161`,
`lib/render-roadmap.js:407`, `lib/render-swim.js:92`,
`lib/render-dispatch.js:46`, `lib/render-pages.js:16`; the
`common.js` + `app.js` script pair repeats across ~13 files.

→ Any *global* change (meta tag, analytics, a `theme` class on `<body>`, a new
global stylesheet, `defer` on scripts, an a11y skip-link) means editing 16
files in sync.

### 2.2 Design tokens are incomplete

`:root` (`public/style.css:17`) defines **colors and fonts only**. No token for
spacing, border/divider color, radius, shadow, font-size scale, transitions, or
z-index. Spacing and borders are therefore magic numbers across ~9,500 lines.

### 2.3 Neutral colors bypass the token system

**317 hardcoded hex values**, **73 distinct colors**. The same conceptual
"border gray" appears as many literals: `#e0e0e0` ×20, `#999` ×13, `#ddd` ×10,
`#ccc` ×8, `#f0f0f0` ×5, `#aaa` ×5, `#888` ×5. Per-page CSS also re-embeds
fallbacks via `var(--token, #literal)`, which lets a token rename fail silently
and lets literals drift from `:root`.

### 2.4 Narrow visual-regression coverage

Baselines exist only for `ship`/`swim` (`tests/visual/`, `tests/screenshots/`).
The dashboard, settings, roadmap, dispatch, etc. have no baseline, so a
CSS/token refactor can't be *proven* non-regressing.

### 2.5 Consequence

Dark mode / a fresh palette is structurally impossible today (light-only
tokens, no `prefers-color-scheme`, no `<body>` theme hook, hundreds of colors
outside the token system).

## 3. The component-vocabulary gap (the real driver of drift)

Above the few shared pieces in §1, **every page reinvents the same UI concepts
under different names**. This — not the CSS literals — is why pages have drifted
in style *and* functionality, and it's the part a token cleanup alone does
**not** fix: tokenizing ten different "section" implementations just gives you
ten sections that drift in tokenized colors.

### 3.1 Server-side: one concept, many implementations

- **"Section" — ~10 implementations:** `settings-section`, `dispatch-section`,
  `proxy-section`, `foreman-section-header`, `roadmap-section-heading`,
  `custom-prompts-section`, `legal-section`, `in-progress-section`,
  `recent-activity-section`, plus a generic `section-header` /
  `section-description`.
- **"Card" — 11 implementations:** `prompt-card`, `custom-prompt-card`,
  `foreman-now-card`, `roadmap-milestone-card`, `ship-rect-cards`,
  `swipe-card`, …
- **"Status pill / badge / chip" — ~30 implementations:** `cell-stage-badge`,
  `foreman-filter-chip`, `queue-badge`, `label-tag`, `swipe-label-tag`,
  `ship-heading-chip`, `loop-stage`, `session-stage`, … The status indicator —
  arguably *the* core visual element of this app — is built dozens of ways.

Other recurring-but-unshared concepts: page headers, form fields
(`settings-label`/`settings-value` vs. `swim-setting-label` vs. …), section
descriptions, empty states.

### 3.2 Client-side: primitives reinvented per page

The per-page JS (~13,700 lines) reimplements the basics:

- **No shared data layer:** ~70 raw `fetch()` calls across 14 files (app.js 12,
  dispatch 9, foreman 8, roadmap 7, proxy 6, prompt-section 6, …), each with its
  own auth/error handling.
- **Toast / notification:** **one** implementation (roadmap.js). Error/success
  UX is inconsistent or absent elsewhere.
- **Modal / overlay:** reimplemented **5 separate times** (app, dispatch,
  pipeline, proxy, ship).

### 3.3 Information architecture / layout

There are **15 distinct pages** (projects, settings, audit, prompts, dispatch,
pipeline, proxy, foreman, roadmap, ship, swim, swipe, custom-prompts, legal).
They've grown organically, with different page-header treatments and nav
affordances, and several (ship/swim/swipe) read as alternate/experimental
views. A coherent "fresh look" needs an explicit decision about a shared layout
and which views are first-class — this is partly a **product decision**, not
just code, which is why it's deferred to a decision point rather than planned
up front.

## 4. Layer model: what's covered vs. what's missing

| Layer | Status today | Needed for easy UI work / redesign |
|---|---|---|
| Document shell (one `<head>`/scripts) | 16 copies | ✅ Phase 0 |
| Design tokens (color/space/radius/shadow…) | color+font only | ✅ Phase 0 |
| Visual-regression safety net | ship/swim only | ✅ Phase 0 |
| **Server component library** (section, card, pill, page-header, field, empty-state) | reinvented per page | ✅ **Phase A — core gap** |
| **Client primitives** (`api()`, `toast()`, `modal()`) | 1 toast, 5 modals, ~70 fetches | ✅ **Phase B** |
| **IA / layout consistency** (shared frame; first-class views) | organic drift | ⚠️ **Phase C — product call, deferred** |
| **A11y / responsive baked into components** | per-page, inconsistent | ✅ rides on A/B |

## 5. The plan

Sequenced so each phase is independently shippable and low-risk. The order is
deliberate: the component library (Phase A) is far safer to extract **after**
tokens exist (Phase 0B) and screenshots can prove nothing regressed
(Phase 0C/0D).

### Phase 0 — Foundation (no visible change; existing E2E proves safety)

- **0A. Shared page shell.** `lib/components/page.js` →
  `renderPage({ title, stylesheets, bodyClass, nav, content, scripts, embeddedData })`.
  Refactor all 16 render files onto it. *Makes every future global change a
  one-file edit.*
- **0B. Complete the token set.** Add `--border`/`--border-strong`, spacing
  scale (`--space-1..6`), `--radius`, `--shadow`, font-size scale, transitions;
  map the duplicated grays (§2.3) onto them.
- **0C. `/styleguide` page.** Render every primitive in one place (palette, type
  scale, buttons, status indicators `✓ ◐ ○`, cards, badges, nav, footer).
  Living reference **and** a single comprehensive visual-regression target.
- **0D. Expand visual baselines** to the key pages (dashboard, settings,
  roadmap, dispatch, styleguide).

### Phase A — Server-side component library (the core gap)

- Add render helpers in `lib/components/`: `renderSection`, `renderCard`,
  `renderStatusPill`, `renderPageHeader`, `renderField`, `renderEmptyState`,
  backed by consolidated `.section` / `.card` / `.pill` CSS (built on Phase 0
  tokens).
- Migrate pages onto them incrementally, deleting the per-page variants from
  §3.1. Each migration is guarded by E2E + the Phase 0 visual baselines.
- **Outcome:** a fresh look becomes "restyle ~8 components," and it propagates
  everywhere automatically. A11y and responsive behavior now live in one place.

### Phase B — Client primitives

- A small shared `api()` fetch wrapper (auth, JSON, consistent error handling) —
  retire the ~70 ad-hoc `fetch()` calls.
- Single `toast()` / notification and `modal()` primitives in `common.js` —
  retire the 5 modal copies; give every page consistent feedback UX.

### Phase C — IA / layout & the redesign decision point (deferred)

Once Phases 0–B land, the cost of a redesign collapses, and **this is the right
moment to decide direction** rather than now:

- Decide which of the 15 views are first-class vs. experimental.
- Adopt one shared page-header + content-frame layout.
- **Incremental path:** keep iterating components in place — drift no longer
  accumulates because there's one source of truth per concept.
- **Redesign path:** introduce a design direction and restyle the ~8 shared
  components + tokens; the visual baselines turn the redesign into a reviewable
  diff instead of a leap of faith.

## 6. Recommended order

1. **Phase 0** (0A → 0B → 0C/0D) — foundation + safety net.
2. **Phase A** — component library, migrating pages incrementally.
3. **Phase B** — client primitives.
4. **Phase C** — make the IA/redesign decision; execute incremental or full
   redesign on top of the now-cheap foundation.

This keeps both outcomes open: every step pays off for incremental polish *and*
de-risks a future redesign. Optional, now-unlocked extras: dark mode
(`prefers-color-scheme` + token overrides on the `<body>` theme hook).

## Appendix: how this was measured

- File sizes: `wc -l` over `lib/render*.js`, `lib/components/*.js`,
  `public/*.css`, `public/*.js`.
- Tokens: `grep` for `var(--…)` (~1,124) and `:root` (only `style.css`).
- Hardcoded colors: `grep -oE '#[0-9a-fA-F]{3,6}'` → 317 total, 73 distinct;
  gray frequencies via `sort | uniq -c`.
- Shell duplication: `grep` for `DOCTYPE` / `<head>` / `<script>` across
  `lib/render*.js` → 16 hand-rolled documents.
- Component duplication: `grep -oE 'class="[a-z-]*section[a-z-]*"'` (and `card`,
  `badge|pill|tag|chip`) across `lib/render*.js` + `public/*.css`.
- Client primitives: `grep -c 'fetch('` per file (~70 total); `grep -l` for
  `toast|modal|overlay` across `public/*.js`.
- Test coverage: `tests/e2e/` (39 specs); `tests/visual/` (ship/swim only).
