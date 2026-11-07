**Plan written to the description (`## Implementation Plan`).**

- **Change:** in `public/brief.js` and `public/recap.js`, `init()` now hands off to the existing `refresh()` whenever the cheap status GET returns anything other than `fresh`. The server is unchanged. Both the dashboard tree and the swipe card mount through `init()`, so both get the new behaviour.
- **Scope, and where it disagrees with research:** stale sections are auto-regenerated as well as missing ones. A stale section shows no brief at all, so leaving it manual would keep the click the ticket asks to remove. Regeneration happens once per input change, the same spend as the click. No cuts to the As asked block.
- **Product call, decided rather than parked:** auto-generate for every tier. Sections mount only on an explicit user expand, nested toggles are not restored on page load, and the existing server guards (the 503 when AI is unconfigured, the free-tier meter at 20/day) remain the cost boundary. When generation can't run, the section shows the server's error message with `↻ retry`.
- **Main risk:** the trailing `wireRefresh` in `init()` would stack a second listener, so each refresh click would send two POSTs. The plan requires wiring exactly once on each path, and a witness test counts POSTs per click.
- **Witnesses:** e2e tests for: opening a missing or stale section lands on `fresh` with no click; a fresh section is opened with zero POSTs; re-expanding sends nothing; one refresh click sends one POST; an error on open can be retried.

Session fit and review flag are in the plan (review due: it removes the explicit click that gated an LLM spend).
