# UI Divergences

The client UI converges on shared primitives wherever it can — one `escapeHtml`,
one `relativeTime`, one `showModal`, one `toast`, one `api()` (see `public/common.js`).
This document records the **deliberate** exceptions: places where a divergence
from "one shared primitive" is the considered, ratified choice rather than drift.
Each entry exists so a future reader (or a convergence sweep) does not "fix" a
divergence that was decided on purpose.

## Destructive-action confirmation: in place (LIN-3889; supersedes LIN-511)

**Decision (current):** a destructive or everyone-affecting change is confirmed **on the page**,
in place: the Settings ask (`askInPlace`, `lib/components/settings-*.js` (moved here by LIN-3890)) opens a panel that says
what will happen, asks why where the change is for everyone, and confirms with a real filled
tone of `.btn` (`btn--red` for halt, remove and revoke; `btn--primary` for turn on and undo), with a
real Cancel (`btn--quiet`). Key revoke uses the same panel with the script transport (LIN-3890): its
Confirm sends the DELETE to the existing route, and it renders no Confirm for a non-owner.

John decided this on 24 October, asked whether LIN-511's native `confirm()` or the in-place ask
should win: "On the page is best, I think." The earlier LIN-511 rule below no longer reads as
current. It is kept for its reasons, because the native dialog is still the right tool for the
sites that have not moved.

**Superseded:** LIN-511 (native `confirm()`), as the rule for new destructive actions. It is
still the code at the sites listed under "Still native" below; those migrate only when their page
is changed for another reason.

**Still native (follow-up, not migrated by LIN-3889):**

- `public/common.js` (`form[data-confirm]` submit guard, comment at 2734), used by `lib/components/navbar.js` to remove a workspace;
- `public/custom-prompts.js` (delete a custom prompt);
- `public/observation.js` (bulk agree);
- `public/scan.js` (retire and unretire);
- `public/session.js` (`window.confirm`);

An entry here is removed when its site moves in place. The four sites the LIN-511 rule named
(`public/proxy.js` and `public/dispatch.js` token revokes) no longer exist: token revoke is on
Settings › Agent access, in place.

**Why native was chosen, and why it is no longer the default (LIN-511, kept for its reasons):**

- **Accessibility for free.** Native `confirm()` provides focus trapping, keyboard handling
  (Enter/Esc), screen-reader announcement and focus return with no code. An in-place ask gets the
  same by being a real form: a focusable button in the panel, with the reason field labelled.
- **Not the toast/alert precedent.** Replacing blocking `alert()` with `toast()` was about
  non-interactive notifications. A destructive confirm is blocking on purpose.
- **Scope.** The in-place form is built once (`askInPlace`) and works with no script, so it is
  no longer a net-new primitive for each site.

**Constraint preserved:** every destructive action stays guarded. The in-place ask never acts on
a click alone: the confirm button exists only inside the opened panel.

**Revisit if:** a shared confirm needs a typed confirmation or a diff preview. Then the native
dialog is not enough and `askInPlace` grows the field, rather than a second primitive appearing.
