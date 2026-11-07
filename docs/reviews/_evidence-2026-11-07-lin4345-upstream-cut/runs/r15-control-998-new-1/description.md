## Implementation Plan

### What this is for
As asked: *"Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too."* The aim is to remove a click. Opening Brief or Recap should show the output, the same way Context does, without the user having to press `✦ generate` / `↻ refresh` first.

**Done when** (the ticket has no Done-when, so this one is the plan's own): on both surfaces that show these sections (the tree view's nested Details toggles and the Swipe card accordion), opening Brief or Recap for a task:
- with no output yet, or with output that is out of date, shows the generating spinner and then the generated output, with no click;
- with output that is already current, shows it straight away and does not generate again;
- if generation fails (AI not configured, free-tier quota used up, model error), shows the error inline with `↻ retry`, as a failed click does today.

**Cuts to the As-asked block:** none. Research (comment 2026-07-04T09:12) suggested leaving `stale` on the manual `↻ refresh` button. This plan does **not** take that suggestion, so no cut is inherited (reasoning under *Decisions*).

### Cause
Generation only starts in `refresh()`, and `refresh()` is only called from the button click. `init()` runs the cheap status GET and, for anything other than `fresh`, renders a placeholder with a button: `public/brief.js:136-140` and `public/recap.js:169-173`. Context has no such gate: `public/context.js:320-335` fetches and renders. The fix goes in the same place: `init()` in both shared modules.

### Which way the change goes
In `BriefSection.init()` and `RecapSection.init()`: when the status GET returns `fresh`, render it as today. Any other status (`stale`, `missing`, or anything unexpected) calls the existing `refresh(container, urlKey, identifier)` and returns. `refresh()` already does generating → POST → fresh/error, and wires the button that matches the outcome. A GET error keeps today's error + `↻ retry` (retry runs `refresh()`).
- Both mount paths call these same `init()`s: tree `public/app.js:176-209` (from the first-expand trigger at `:755-763`) and swipe `public/swipe.js:675-700`. So one change per module covers both surfaces, and neither caller changes.
- Generation must not wire the button twice. Today `init()` ends with an unconditional `wireRefresh()` (`brief.js:144`, `recap.js:177`), and `refresh()` wires its own button too. If both run, one click sends two POSTs. The auto-generate branch must therefore return without falling through to that line, or the trailing call must move so it covers only the paths that do not go through `refresh()`.
- `renderMissing()` and `renderStale()` can no longer be reached, so delete them. Update each module's header comment (`brief.js:1-13`, `recap.js:1-12`), which lists missing/stale as states the section renders. The server still returns those statuses, and nothing on the server changes.

**Decisions and reasons**
1. **Stale also auto-generates, not only missing.** A stale section today shows no content at all, only "Inputs have changed… Refresh to update." (`brief.js:61-65`, `recap.js:89-98`). Leaving it manual would leave exactly the click the ticket asks to remove. Research worried about a "re-open tax", but there isn't one. Regenerating stores the new `inputHash`, so later opens are `fresh` and cost nothing until the task's inputs change again. The hash is a deterministic SHA-256 of the context slice (`lib/recap-cache.js:94-97`). It is computed from the same `fetchRecommendationContext` call on GET and POST (`routes/workspace-api.js:1476-1480` vs `:1560-1565`, and the same for brief), so a freshly generated output does not come back stale.
2. **Auto-generate for every AI tier, the free tier included.** Research marked this as "the one genuine product decision". The ask settles it: the request is unconditional. Turning auto-generate off on the free tier would cut the ask for those users. The server still enforces every guard on the POST: 503 when AI isn't configured, and `freeTierStore.tryUse` with 429 at quota (`routes/workspace-api.js:1536-1547`, brief `:1763-1772`). The client changes only *when* the POST is sent, never whether it is allowed. The cost of this choice: on the free tier, opening a Brief/Recap with no current output now spends one unit of the shared 20/day budget (the same budget prompt generation uses), where before it took a click. One unit per explicit open is bounded, for two reasons. Sections mount once per page (`content.dataset.loaded`, `app.js:183`; placeholder removal, `swipe.js:678/692`). Swipe cards render their accordions closed (`swipe.js:340-362`), so swiping never opens one by itself. If the drain turns out to matter in practice, the follow-up is a server-side free-tier policy, not a client gate.
3. **No special handling for "AI not configured".** Falling back to the old `✦ generate` placeholder would just show a button that fails the same way when clicked. The inline error states the actual reason ("AI brief is not configured. Connect OpenRouter…"), which serves the user better.

**Alternatives set aside**
- An `autoGenerate` option passed by the callers (`app.js`, `swipe.js`): both callers would always pass it, so it would be a flag with one value.
- Making the GET generate on a miss: that turns a cheap read into a metered LLM call for every client of the endpoint, including the proxy routes (`routes/proxy.js:47-48`), and breaks the GET/POST cost split.
- Returning the stale body from the GET and showing it while regenerating: nicer, but it needs a server contract change and the ask doesn't need it. Possible follow-up.

### Where the behaviour lives (and how I know that's all of it)
The behaviour: *the Brief/Recap task section, on first open, shows a placeholder and needs a click to generate.* I searched with `grep -rnE "BriefSection|RecapSection|brief-placeholder|recap-placeholder|api/brief|api/recap" public lib routes tests docs CLAUDE.md README.md`. That is the search to repeat.
- **In scope:** `public/brief.js`, `public/recap.js`. These are the only renderers.
- **Unchanged, but covered by the change:** both mount sites, `public/app.js:176-209` and `public/swipe.js:675-700`. Placeholders are server-rendered at `lib/render.js:899,902` and `public/swipe.js:347,360`.
- **In scope, tests that describe today's shape:**
  - `tests/e2e/swipe.spec.js:495-513` (recap) and `:548-563` (brief), "refresh button triggers POST…". These assume the section lands on a clickable state after the GET. They would probably still pass by luck, because `toBeVisible` waits until fresh renders its `↻ refresh`, but their intent is now wrong. Rewrite them to the new contract (see the witnesses below).
  - `tests/e2e/tree-sections.spec.js:54-73,85-99`: the state regexes already accept `generating|fresh|error`. They need no change, but must still pass.
- **Out of scope:**
  - API-level specs (`tests/e2e/brief.spec.js`, `recap.spec.js`, `workspace-api-recap-brief-local.spec.js`): the server contract doesn't change.
  - Proxy brief/recap routes (`routes/proxy.js`): agent-facing, with no section UI.
  - Observation run/session summaries (`lib/run-summary.js`, `session-summary.js`): a separate on-demand feature that only shares the recap lineage. It is not a Brief/Recap section, and the ask doesn't name it.
- No docs describe the manual generate flow. `CLAUDE.md:184` only names the modules.

### Witnesses
These are Playwright e2e tests on the seeded local-provider workspace. `shouldMockAi` (`routes/workspace-api.js:78-81`) mocks the model for local sessions, so the POST resolves without a key. Put them next to the existing section tests and run each for both `brief` and `recap`:
1. **Auto-populates on open (swipe and tree).** Open the section on a task with nothing cached. It reaches `data-state="fresh"` and shows its content (`.brief-content`, or `.recap-list` / `.recap-empty`) with no click, and a POST to `/api/<section>/` was seen. *Fails today*: the section stops at `missing`.
2. **Current output is not regenerated.** Generate once (via the auto-open or an API POST), reload, and open again. The section reaches `fresh`, and **no** POST to `/api/<section>/` is sent. This catches an implementation that always POSTs. In test mode it also catches a stale loop where the hashes never match.
3. **Stale auto-regenerates.** Use `page.route` to answer the GET with `{status:'stale', generatedAt}` and let the POST through. Opening the section ends `fresh` after one POST. *Fails today*: it stops at `stale`.
4. **Guard still holds, and failure is quiet** (this checks what the removed click was protecting against). Use `page.route` to answer the POST with 429 `{error: 'free tier limit reached'}`, and in a second case with 503 `{error: 'AI brief is not configured…'}`. The section shows `data-state="error"`, the message, and a `↻ retry` button, and exactly **one** POST was sent (no retry loop).
5. **One click, one POST.** In the rewritten swipe "refresh" tests, after the auto-generated fresh render, one `↻ refresh` click sends exactly one POST and lands `fresh` again. This catches the double-wired button.

Run the full `tests/e2e/swipe.spec.js` and `tests/e2e/tree-sections.spec.js`, plus `npm run test:unit`.

### Likeliest ways this breaks
- **Double-wired button:** the trailing `wireRefresh` in `init()` runs after `refresh()` has already wired its own, so each click POSTs twice. Witness 5 catches it.
- **Generating on every open:** the fresh branch gets folded into the auto path, or GET and POST hashes drift. Witness 2 catches both.
- **Error loop or noisy failure** when AI is unconfigured or the quota is used up. Witness 4 catches it.

### Landing and size
One PR changing `public/brief.js`, `public/recap.js` and the e2e specs above. There is no server, route or schema change, and no refactor goes first (research: refactor not required; I confirmed it at HEAD). Staleness check: `git log --since=2026-07-04` on the referenced files is empty, and HEAD is `973a8ec`. The recent history of `public/brief.js` / `public/recap.js` (LIN-545, LIN-421, LIN-505) moved their helpers onto the `window.*` shared helpers in `common.js` and `window.api()`. Keep using those and don't reintroduce private copies.

fits one session

This plan doesn't need a second reader. It is one session's work, routes around nothing, and leaves every server guard in place (witness 4 tests them). It touches no credentials, merge rules or dispatch contract, and reverting it is a two-file revert.

plan-review due: no
