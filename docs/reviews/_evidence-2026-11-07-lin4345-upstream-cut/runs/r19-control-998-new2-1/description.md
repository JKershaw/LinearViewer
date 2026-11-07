## Implementation Plan

### What this is for
As asked: *"Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too."* Today, opening Brief or Recap with no current brief shows a `✦ generate` or `↻ refresh` button over placeholder text. The user wants to open the section and read it, the way Context works. This is not a bug fix. The behaviour comes from the client `init()` in `public/brief.js:127-145` and `public/recap.js:160-178`, which only ever renders a cached body and leaves generation to a button click.

**Done when** (the ticket has no Done-when, so this one is the plan's own): on both the tree/dashboard view and the swipe view, opening Brief or Recap for the first time on a card ends up showing the brief/recap body (`data-state="fresh"`) with no click, whether the cache was missing, out of date or current. If generation can't run (AI not configured, free-tier limit reached, provider error), the section shows that reason inline instead of a bare button. Opening a section whose cached copy is current makes no LLM call.

**Cuts to the As-asked block:** none. Earlier stages floated two narrowings. This plan adopts neither, so neither is a cut:
- *"Leave `stale` on the manual `↻ refresh`"* (research comment). Not adopted. A stale section renders no body at all: the GET returns only `{status, generatedAt, model}` for stale (`routes/workspace-api.js:1484-1490` recap, `:1710-1716` brief), and `renderStale()` shows "Inputs have changed… Refresh to update." Keeping stale manual would leave the section unpopulated on open, which is exactly what the ticket asks to change.
- *"Gate auto-gen behind AI-configured & not free-tier"* (research risk #1). Not adopted. For free-tier workspaces it would keep the click the ticket asks to remove. The decision and its cost are recorded under Decisions below.

### Re-grounding
Ticket created 2026-07-04. HEAD is `973a8ec` (2026-07-04 09:58). `git log --since=2026-07-04` over `public/{brief,recap,context,app,swipe}.js` and `routes/workspace-api.js` returns nothing, so the triage and research descriptions of these files still hold. I re-read them at HEAD and they match, with one correction to research below (tests).

### The change
In both `public/brief.js` and `public/recap.js`, `init()` keeps its cheap status GET and then branches:
- `fresh`: render the body, exactly as today. No POST.
- `missing` **or** `stale`: hand off to the module's existing `refresh(container, urlKey, identifier)`. That function already does generating → POST → fresh/error and wires the button. `init()` must then **not** call its own trailing `wireRefresh` for this path, because `refresh()` has already wired the button (see break #1).
- GET throws (401/404/500): render the error state, exactly as today. **No POST.**

`renderMissing()` and `renderStale()` then have no callers. Delete them from both files rather than leaving dead renderers. Update each file's header comment and the `init()` JSDoc so they say missing and stale auto-generate on open. The `window.api(..., { on401: false })` calls (LIN-505) and the shared `escapeHtml`/`relativeTime`/`renderMarkdown` aliases (LIN-421/545) stay untouched.

Server: no change. The GET/POST split is the cost boundary. The GET is a cache read plus content hash with no LLM call. The POST is the LLM call, and its guards stay as they are: 503 when AI isn't configured, checked *before* any free-tier spend; 429 from `freeTierStore.tryUse` at the daily limit (`routes/workspace-api.js:1532-1549` recap, `:1762-1772` brief). `hashContext` (`lib/recap-cache.js:94`, shared by `lib/brief-cache.js:22`) is a SHA-256 of a curated slice hashed via `stableStringify`. It has no volatile fields, so "stale" means the task's inputs really changed, and an auto-regenerate costs at most one call per real change per workspace (the cache key is `workspace:issue`, so one person's open freshens it for everyone).

### Decisions (with reasons)
- **Fix in the shared client modules, not at the mount sites.** Both surfaces mount through `init()`: tree via `public/app.js:176-209` (`loadLazySection`), swipe via `public/swipe.js:675-702` (`handleAccordionClick`). Changing `init()` covers both, and any future mount, in one place. *Set aside:* adding an `autoGenerate` option passed from each mount site. It adds a knob nobody needs, and a new mount site could forget to pass it.
- **Auto-generate on stale as well as missing.** This is the only way the section is "populated" on open (see Cuts). *Set aside:* changing the GET to return the cached body for stale and rendering it under an "out of date" banner. It costs nothing in LLM calls, but it puts the old brief in front of the user as current-looking content and changes a server contract for a UI preference. Context always shows the current state, and Brief/Recap now match it.
- **No free-tier gating.** Generation on open only ever runs when the cached copy is missing or out of date. Re-expanding a mounted section never re-inits (the `content.dataset.loaded` guard in `app.js:183`, and swipe removes the `data-*-placeholder` attribute before init). The server still refuses at the 20/day limit, and the 429 reason ("free tier limit…") shows inline. The remaining cost is that free-tier units are now spent by opening a section rather than by clicking a button. This is reversible in one branch if it turns out to bite. *Set aside:* hiding the auto-gen behind "paid key only". It keeps the click for exactly the users most likely to be on the free tier.
- **503 / 429 on open show the existing error state** (reason text and `↻ retry`). *Set aside:* falling back to the old `✦ generate` placeholder on 503. Clicking that button could only reproduce the same 503. Showing the reason ("AI brief is not configured. Connect OpenRouter…") tells the user what to do, and a 503 spends nothing because the config check runs before `tryUse`.
- **Duplicate POSTs across tabs or users** opening the same missing brief at the same moment are out of scope. Each is a separate page session, the last write wins in the cache, and they cost one extra call at most. Within one page, the mount guards above prevent a second init.

### Every place the behaviour lives
The behaviour is "what a Brief/Recap section shows when it is opened". I found its places with `grep -rn -E "BriefSection|RecapSection" public lib routes tests` and `grep -rn -E "api/(brief|recap)" public lib tests`, plus a search for other `✦ generate` placeholders (`grep -rn "✦\|u2726" public`). The places:
- **In scope:** `public/brief.js` and `public/recap.js` `init()`; the two mount sites (`public/app.js:185-197`, `public/swipe.js:675-702`), which need no edit and are named so a reviewer can confirm both surfaces; `tests/e2e/swipe.spec.js:470-563`; `tests/e2e/tree-sections.spec.js:39-103`.
- **Out of scope, with reason:** `routes/proxy.js` brief/recap (agent-facing Bearer API, no "section open"); the Roadmap page's project-level brief/recap (a different feature, which doesn't use `BriefSection`/`RecapSection`); `public/prompt-section.js` `✦ AI Recommend` (an explicit action, not a section body); Context and Sessions (already populate on open).
- The new e2e witnesses below fail on any surface that still opens to a button, so they catch a missed place.

### Tests: correction to research
Research said the existing tests are API-level and unaffected. That is true for `tests/e2e/{brief,recap}.spec.js`, but **not** for the UI specs:
- `tests/e2e/swipe.spec.js` "refresh button triggers POST and shows fresh content" (recap `:495-514`, brief `:548-563`) waits for `not loading` and then for a refresh button. After the change the section passes through `generating`, which has no button, before reaching `fresh`. These tests would still pass through auto-wait, but they would no longer test the manual refresh path. Rewrite them to wait for `fresh` after opening (no click), then click `↻ refresh` and assert exactly one POST and `fresh` again.
- `tests/e2e/tree-sections.spec.js` state regexes (`missing|fresh|stale|generating|error`) still pass. Tighten the "lazy-mounts on first expand" assertion to `fresh` (the local provider's mock AI always succeeds via `shouldMockAi`, `routes/workspace-api.js:78-81`). Leaving the loose regex in place would hide a regression back to `missing`.
- New specs follow LIN-627/LIN-427 conventions: the local provider with `seedLocal` and `localWorkerUrlKey`, and `test-base.js` fixtures.

### Witnesses (each fails before, passes after)
1. **Missing auto-generates, both surfaces.** Open Brief, and separately Recap, on the swipe view and on the tree view with an empty cache. The section reaches `data-state="fresh"` with body content (`.brief-content` / `.recap-list` or `.recap-empty`) with no click, after exactly one POST.
2. **Stale auto-generates.** Use `page.route` to answer the GET with `{status:'stale', generatedAt}` and let the POST through to the mock. The section reaches `fresh` with no click.
3. **Fresh never POSTs (guard on spend).** Seed the cache with a POST via `page.request`, open the section, and assert `fresh` and zero POSTs from the page.
4. **Re-expand never re-generates (guard on spend).** On the tree view, expand, wait for `fresh`, collapse and expand. Assert no further GET or POST.
5. **GET error never POSTs.** Route the GET to a 500. Assert `data-state="error"` and zero POSTs.
6. **POST error shows the reason.** Route the POST to a 503 with `{error:'AI brief is not configured…'}`. Assert `error` state, the message text, and a `↻ retry` button.
7. **One listener after auto-gen.** After witness 1 reaches `fresh`, click `↻ refresh` once and assert exactly one POST.

### Likeliest ways this breaks
1. **A double-wired button.** If `init()` still runs its trailing `wireRefresh` after `refresh()` has wired the button, every later refresh or retry click fires two POSTs: two LLM calls and two free-tier units. Caught by witness 7.
2. **Silent spend.** Branching so that `fresh` or a GET error falls through to `refresh()`, or a mount path that re-inits on re-expand, would spend LLM calls with no visible symptom. Caught by witnesses 3, 4 and 5.
3. **Tests that pass without testing.** The loose state regexes and the auto-wait in the swipe refresh tests would hide a regression back to the manual button. Fixed by tightening them, as above.

### Shape, scope and landing
Two client files, two spec files plus new cases, no server change, one PR. Recap and brief are deliberately mirrored, so make the same change in both in the same commit.

fits one session

This plan removes the click that was the only client-side gate on LLM spend for these sections, and it decides the free-tier question that triage and research flagged as the product call. The server guards are unchanged, but spend now follows from opening a section, so a second reader should confirm that before it is built.

plan-review due: yes
