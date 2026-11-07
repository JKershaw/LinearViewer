## Implementation Plan

### What this is for, and what done looks like

**As asked:** "Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too."

Today, opening Brief or Recap shows a placeholder and a `✦ generate` button (when nothing is cached) or an "out of date · ↻ refresh" notice (when the cache is stale). Neither one shows any content until the user clicks. Context shows its content as soon as it opens. This is a feature request, not a bug fix, so there is no cause to fix.

**Done when** (the ticket has no Done-when, so this one is the plan's own, written from the block): opening Brief or Recap, on the tree view and on the swipe view, shows the current brief or recap with no click.
- If a fresh cached copy exists, it is shown straight away and no new generation is paid for.
- If the cache is missing or stale, the section shows the existing "generating…" spinner, then the content.
- If generation fails (AI not configured, free-tier limit reached, provider error), the section shows the existing inline error with `↻ retry`, and nothing is retried automatically.
- The `↻ refresh` button on a fresh brief or recap still regenerates on demand.

**Cuts to the As-asked block:** none. Both sections are populated on open, on both surfaces where they live, for every AI tier.

### Which way the change goes, and why

**Decision: on open, anything not `fresh` generates.** Each module's `init()` already reads the cheap cache-status GET. Today the `missing` and `stale` branches render a click-to-generate placeholder. Instead, both branches call the module's existing `refresh()`, which does generating → POST → fresh or error and wires its own button. `fresh` keeps rendering the cached body with no POST. The change is client-only, in `public/brief.js` and `public/recap.js`. No route, cache or lazy-mount change is needed.

- **Stale also auto-generates. This differs from research** (comment 2026-07-04T09:12, "Leave `stale` on the manual refresh"). `renderStale` (`public/brief.js:61-65`, recap equivalent) shows no content: the GET returns no body for `stale` (`routes/workspace-api.js:1712-1717`, `:1486-1491`). Leaving stale manual would mean a stale section still opens empty, and that would be a cut. The cost is bounded by the cache. A POST fires only when the task's hashed inputs have changed since the last generation (`hashContext`, `lib/recap-cache.js:94`). That is the same call the user would have clicked, and opening the same section again without changes reads `fresh` for free.
- **All tiers auto-generate, including free tier. Recorded here because research called it the one product question.** Free-tier spend stays capped server-side by `freeTierStore.tryUse` (20 per day per workspace, plus a global hourly cap). The POST routes keep that guard unchanged (`routes/workspace-api.js:1544`, `:1768`). Holding free tier back to the manual button would be a cut of the ask for those users. Once the cap is reached, the section shows the existing inline error, which includes the reset reason. This is a departure from the "LLM generation only on an explicit button" contract that the Observation page keeps (`public/observation.js:23-27`, `routes/dashboard.js:650-653`). That contract covers the Observation poll and run drill-downs, not Brief/Recap. This ticket deliberately chooses the opposite for these two sections, and that is why plan review is due (below).
- **Errors on auto-generate render the existing inline error, with no special fallback.** A 503 "AI brief is not configured…" tells the user why the section is empty. A fallback `✦ generate` button would fail with the same 503.

Alternatives set aside:
- A server-side "get-or-generate" endpoint (one round trip, one provider fetch). It changes the API contract to save one context fetch, and only when a costly LLM call follows anyway.
- Rendering the stale cached body with an "out of date" badge instead of regenerating. That shows content the server already knows is outdated, and it needs a GET contract change.
- Gating auto-generate on paid keys only. That would be a cut, as above.

### Where the behaviour lives (all places)

The behaviour is "a Brief/Recap section, when it is mounted, decides whether to show content or ask for a click". It lives only in the two modules' `init()`. Both mount sites call it:

- `public/app.js:176-209` `loadLazySection` mounts the tree/dashboard Details toggles that `lib/render.js:893-900` renders.
- `public/swipe.js:677-701` mounts the swipe accordions.

Both sites mount once per card. app.js sets `content.dataset.loaded`, and both sites remove `data-*-placeholder` before `init`. This is the existing guard against firing twice on collapse/re-expand, and it stays. No other surface (swim, ship, roadmap, observation) renders these sections. To repeat the search: `grep -rn -e BriefSection -e RecapSection public lib`. `routes/proxy.js` brief/recap are agent-facing proxy reads, not a section opened in the UI, so they are out of scope.

**In scope:**
1. `public/brief.js` and `public/recap.js` `init()`: `fresh` renders. `missing` and `stale` hand off to `refresh()` and return without the trailing `wireRefresh` (see risk 1). The GET-error path is unchanged (renders the error, retry → `refresh()`).
2. `renderMissing` and `renderStale` in both files become dead. Delete them, and update each file's header comment. `missing` and `stale` are no longer rendered states. The states that remain are loading → generating → fresh | error.
3. Tests (see witnesses), including updating today's tests that describe the old shape:
   - `tests/e2e/swipe.spec.js:483-516, 537-563`: "initialises" accepts `missing|stale`. "refresh button triggers POST" assumes the button is the first generation. Change these so they assert auto-generation, and keep a separate "manual refresh on fresh regenerates" check.
   - `tests/e2e/tree-sections.spec.js:54-71, 87-100`: the state regex accepts `missing`.

   The API-level `tests/e2e/{brief,recap}.spec.js` and `workspace-api-recap-brief-local.spec.js` are unaffected.

**Out of scope:** CSS (`.brief-placeholder` and the spinner are still used by the generating and error states), the routes, and the cache.

### Likeliest ways this breaks

1. **Double-wired button.** If `init()` still runs its trailing `wireRefresh` after `refresh()` has already wired the button, one click fires two POSTs. That spends twice and races two cache writes.
2. **Spend on every open.** The main risk is a regression where a fresh section, or a collapse/re-expand, fires a POST. The click used to guard spend, so the tests must try exactly what that guard prevented.
3. **Error loops.** An auto-generate that fails must land on `error` and stop. Any automatic retry would drain the free tier.

### Witnesses

Each fails before the change and passes after, unless marked as a regression guard. They are Playwright e2e on the seeded local provider, where `shouldMockAi` makes the POST deterministic (`routes/workspace-api.js:78-81`). To count requests, use `page.on('request')` for method + URL. To force stale or failure, `page.route` can stub the GET (`{status:'stale', generatedAt}`) or the POST (429 or 503 JSON).

Run each of these for **both sections on both surfaces** (tree Details toggle and swipe accordion):
- **Missing → populated, no click:** open the section with no cache. It reaches `data-state="fresh"` and shows `.brief-content` / `.recap-list` or `.recap-empty`, with exactly one POST.
- **Stale → populated, no click:** stub the GET as stale and open the section. Exactly one POST fires and the state reaches `fresh`.
- **Fresh never spends** (regression guard for risk 2): generate once, reload, open. The state reaches `fresh` with zero POSTs. Then collapse and re-expand: still zero POSTs.
- **One click, one POST** (risk 1): after auto-generation lands, click `↻ refresh`. Exactly one more POST fires.
- **Failure stops** (risk 3): stub the POST with a 429 that has an error body. The state reaches `error`, the message is shown with `↻ retry`, and no second POST fires within a short wait. Clicking `↻ retry` fires exactly one POST.

### Landing, size, review

- Land it as a single PR: both modules plus the tests. Nothing has to land first, and research marked no refactor as required (comment 2026-07-04T09:12, "REFACTOR NOT REQUIRED"). Checked: no commit since the ticket was created touches `public/{brief,recap,context,app,swipe}.js` or the brief/recap routes. The commits today on `lib/render.js` (2aad59a) and the swipe/tree specs (bdff8eb) are header/section-primitive changes that don't touch these sections. In `git log -15` for the two modules, the last behavioural change was LIN-545/LIN-421 (helper hoists), so there is no hidden constraint.
- fits one session
- **Plan review: due.** The plan removes the click that gated LLM spend for these sections, and it deliberately breaks from the codebase's "generate only on an explicit button" cost contract for them (free tier included). A second reader should confirm that before it is built.

plan-review due: yes
