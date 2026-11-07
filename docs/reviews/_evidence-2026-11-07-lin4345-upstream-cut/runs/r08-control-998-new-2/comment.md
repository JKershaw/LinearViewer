**Plan: written to the description (`## Implementation Plan`)**

**Change:** in `BriefSection.init()` / `RecapSection.init()` (`public/brief.js:127`, `public/recap.js:160`), when the status GET returns anything other than `fresh`, call the existing `refresh()` (spinner → POST → content) instead of showing a click-to-generate placeholder. Both mount paths use these functions: the tree view (`app.js` `loadLazySection`, the reporter's page) and the swipe view (`swipe.js` accordion). So one change in each module covers both surfaces. A fresh cache is shown as-is with no POST.

**Decisions taken, with reasons (see the plan for detail):**
- **Stale regenerates on open too, not just missing.** This goes against the research recommendation. The stale GET returns no content, so keeping stale manual would still open to a "Refresh to update" placeholder every time the task changes. That's the reported problem, and leaving it would be a cut of the ask. The cost is bounded because `hashContext` only covers stable fields.
- **Free tier is not gated.** Opening a section is a deliberate, per-task act (sections are never auto-opened), and the agent proxy GET already auto-regenerates missing/stale under the same rules. When the budget runs out, the 429 reason shows inline.
- **Errors (503 not configured / 429 limit) show inline with `↻ retry`,** with no fallback to a `✦ generate` button that could only fail the same way.

**Watch for:** `init()` ends with its own `wireRefresh`, and so does `refresh()`. If both run, one click sends two POSTs (two free-tier charges). Witness W4 catches this.

**Witnesses:** auto-generation on missing, on both tree and swipe views, for Brief and Recap; auto-generation on stale; no POST on fresh or on re-expand, and exactly one POST per refresh click; the error path settles with no loop.

Cuts to As asked: none. Sized for a single build session. **plan-review due: yes**: this removes the click-before-spend gate on two LLM sections. Plan review is the place to overturn the free-tier ruling if the team wants that gate.
