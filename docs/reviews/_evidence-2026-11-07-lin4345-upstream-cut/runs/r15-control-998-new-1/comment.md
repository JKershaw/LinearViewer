**Plan: written to the description under `## Implementation Plan`**

**Change:** in `BriefSection.init()` / `RecapSection.init()` (`public/brief.js`, `public/recap.js`), a `fresh` status renders as it does today. Any other status calls the existing `refresh()`, so the section generates on first open. Both surfaces mount through these `init()`s (tree `public/app.js:176-209`, swipe `public/swipe.js:675-700`), so both get the change. There is no server change.

**Decisions taken (reasons are in the plan):**
- **Stale auto-generates as well, not only missing.** This departs from the research suggestion. A stale section shows no content today, so leaving it manual would keep the click the ticket asks to remove. Once regenerated, later opens are `fresh` and free.
- **Every AI tier auto-generates, the free tier included.** The ask is unconditional, so a free-tier gate would be a cut. The server still enforces its 503 and free-tier 429 guards. Cost: on the free tier, opening a section with no current output spends one unit of the 20/day budget, at most once per explicit open.
- **A failure shows the existing inline error + `↻ retry`**, with no fallback to the old generate button.

**Cuts to As asked:** none.

**Witnesses:** e2e tests for both brief and recap: auto-populates with no click; reopening current output sends no POST; stale regenerates; 429/503 show the error after exactly one POST; one refresh click sends one POST.

fits one session · plan-review due: no
