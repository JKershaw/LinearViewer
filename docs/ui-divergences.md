# UI Divergences

The client UI converges on shared primitives wherever it can — one `escapeHtml`,
one `relativeTime`, one `showModal`, one `toast`, one `api()` (see `public/common.js`).
This document records the **deliberate** exceptions: places where a divergence
from "one shared primitive" is the considered, ratified choice rather than drift.
Each entry exists so a future reader (or a convergence sweep) does not "fix" a
divergence that was decided on purpose.

## Destructive-action confirmation: native `confirm()` (LIN-511)

**Decision:** destructive actions use the browser's native `confirm()` dialog.
We do **not** ship a shared `showConfirm()` primitive.

**Sites (all four use native `confirm()`):**

- `public/common.js` — `form[data-confirm]` submit guard (the generic helper)
- `public/custom-prompts.js` — delete a custom prompt
- `public/proxy.js` — revoke a proxy token
- `public/dispatch.js` — revoke a dispatch token

**Why native, not a custom modal:**

- **Accessibility for free.** Native `confirm()` provides focus trapping, keyboard
  handling (Enter/Esc), screen-reader announcement, and focus return with zero
  code. The shared `showModal` in `common.js` is deliberately **display-only**
  (it returns `{overlay, modal, close}`, not `Promise<boolean>`, and implements
  none of those a11y behaviours). A custom `showConfirm()` that wasn't an
  accessibility regression would have to re-implement all of it.
- **Not the toast/alert precedent.** Replacing blocking `alert()` with `toast()`
  was about *non-interactive notifications*, where blocking was the harm. A
  destructive confirm is intentionally blocking — the user must answer before the
  action proceeds — so the native dialog's semantics are a feature, not a wart.
- **Scope.** These are a handful of low-frequency yes/no guards. A net-new
  `Promise<boolean>` primitive plus styleguide entry and visual baseline is
  maintenance surface out of proportion to the gain. LIN-495 correctly scoped
  confirm out of the fetch/modal/toast convergence waves for this reason.

**Constraint preserved:** every destructive action stays guarded; this ratifies
the existing safe behaviour, it does not weaken it.

**Revisit if:** a confirm flow needs richer content than a single yes/no string
(e.g. a typed confirmation, a diff preview, or multiple options) — at that point a
shared `showConfirm()`/`showModal`-backed primitive returning `Promise<boolean>`
becomes justified, and all four sites should migrate together (single-site
migration is explicitly the wrong pattern: the first confirm-modal with nothing
to mirror).
