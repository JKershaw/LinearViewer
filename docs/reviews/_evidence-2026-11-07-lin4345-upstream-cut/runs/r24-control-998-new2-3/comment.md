**Plan: written to the description (`## Implementation Plan`)**

- **What changes:** a client-only change in `public/brief.js` and `public/recap.js`. In `init()`, a `fresh` result renders the cached copy as it does today. A `missing` or `stale` result now calls the existing `refresh()` (generating spinner → POST → fresh or error) instead of showing the click-to-generate placeholder. Both mount sites (`public/app.js` tree Details and `public/swipe.js` accordions) get this, because both call `init()`.
- **Where I differ from research:** stale also auto-generates. A stale section shows no content (the GET returns no body), so leaving stale on the manual button would leave the ask partly undone. Cost stays bounded by the input-hash cache: a POST fires only after the task has actually changed.
- **The product call research raised, decided rather than parked:** every tier auto-generates, free tier included. The server-side free-tier cap (`tryUse`) is unchanged and still bounds spend. A 429 or 503 shows the existing inline error with `↻ retry` and is never retried automatically. Holding free tier back would cut the ask for those users.
- **Cuts to the As-asked block:** none.
- **Tests:** e2e witnesses on both surfaces cover these cases:
  - missing goes to fresh with no click, and exactly one POST
  - stale goes to fresh
  - a fresh section and collapse/re-expand fire zero POSTs
  - one refresh click fires one POST (guards against a double-wired button)
  - a failed POST stops on the error state
  
  The existing swipe and tree UI tests that assume a manual first generate get updated.
- Fits one session. **Plan review due: yes.** This removes the click that gated LLM spend on these two sections, and breaks deliberately from the Observation page's "generate only on an explicit button" cost contract, so a second reader should confirm it before it is built.
