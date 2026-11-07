## Implementation Plan

### What this is for
As asked: *"Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too."*

Today, opening Brief or Recap shows a placeholder and a button (`✦ generate` when nothing is cached, `↻ refresh` with no content when the cache is out of date). You only see output after a click. Context shows its content straight away. This change gives Brief and Recap the same behaviour.

**Done when** (the ticket has no Done-when, so this one is the plan's own): opening the Brief or Recap section on the tree view (`/workspace/:urlKey/`) or the swipe view shows the generated output with no click, whether the cache was missing, out of date or fresh. A fresh cache is shown as-is and spends nothing. If generation can't run (AI not configured, free-tier limit reached, provider error), the section shows the reason inline with a `↻ retry` button. It does not show a blank or a click-to-generate placeholder.

**Cuts to the As asked block:** none. Both sections, both surfaces, every not-fresh state.

### The behaviour, named so its places can be recognised
> When a Brief/Recap section mounts and its cached output isn't fresh, the client generates it right away and shows the result. When the cache is fresh, the client shows it and spends nothing.

Places, and how I found them (`grep -rnE "BriefSection|RecapSection|data-(brief|recap)-placeholder|api/(brief|recap)"` across `public/ lib/ routes/ tests/ docs/`):
- **In scope: `public/brief.js` `init()` (:127-145) and `public/recap.js` `init()` (:160-178).** This is the only place the decision is made. Both surfaces call it:
  - tree view: `public/app.js:176-209` `loadLazySection`, placeholders rendered in `lib/render.js:897-902` (this is the reporter's page, `/workspace/linearviewer/`);
  - swipe view: `public/swipe.js:672-700` `handleAccordionClick`, placeholders in `public/swipe.js:340-362`.
  
  Neither call site needs a change.
- **In scope: the module header comments** in `brief.js:1-13` and `recap.js:1-12`. They describe the states. They should now say that `init` generates when the cache isn't fresh.
- **In scope: tests that show today's manual flow.** `tests/e2e/swipe.spec.js:495-513` (recap) and `:548-563` (brief), the "refresh button triggers POST" tests, assume you open the section and then click. Rewrite them to open, check that the section auto-generates, and then cover the manual `↻ refresh` from the fresh state. `tests/e2e/tree-sections.spec.js` only checks that the state settles to one of a set (its regex already includes `generating|fresh`), so it still passes. Leave it as it is.
- **Out of scope, already right:** `routes/proxy.js:3386` / `:3659` (agent `GET /api/proxy/issues/:id/{recap,brief}`). These already auto-regenerate when missing or stale, and charge the free tier only after a cache miss (`:3453-3456`). The UI change brings the app into line with them.
- **Out of scope, different surface:** the Observation page's session/run summaries (`public/observation.js:233`, "explicit spend only"). Those summaries cover every session in a list, so auto-generating them would spend on every row without the user asking. They are not Brief/Recap sections and nothing here asks to change them.
- **Not affected:** the server GET/POST routes (`routes/workspace-api.js` recap :1458/:1518, brief :1684/:1744) and the API specs `tests/e2e/{brief,recap}.spec.js`, `workspace-api-recap-brief-local.spec.js`, `workspace-model.spec.js`. Their contracts don't change.

The witnesses below fail on any surface where opening still lands on a click-to-generate state. Brief and Recap are tested on both tree and swipe, so a missed mount path shows up as a red test.

### Which way the change goes, and why
**Client-side: in `init()`, when the status GET returns anything other than `fresh` (`missing` or `stale`), call the module's existing `refresh()`** (renders generating, POSTs, renders fresh or error, wires the button). Do not render the placeholder.

- **Stale regenerates too.** I disagree with the research comment on this point. Research recommended auto-generating on `missing` only and keeping `stale` behind the manual button. But the stale GET returns no content (`workspace-api.js:1485-1490` returns only `generatedAt`/`model`), and `renderStale` shows only "Refresh to update" plus a button. Leaving stale manual means the section still opens to a click-to-generate placeholder every time the task has changed, which is exactly what was reported. That would be a cut. The cost is bounded: `hashContext` (`lib/recap-cache.js:44-97`) hashes only stable fields (title, description, state type, labels, comment bodies and ids, child/parent state), so a section goes stale only when the task really changes, and one regeneration makes it fresh again.
- **Free-tier workspaces get auto-generation too, with no gating.** Opening a section is a deliberate act for one task. Detail toggles and swipe accordions are never opened automatically: tree detail toggles aren't part of the persisted `state.expanded`, and swipe accordions render closed on each card. So spend is at most one call per section per task per real change, the same contract the proxy GET already uses. When the shared 20/day budget runs out, the POST returns 429 with its reason and the section shows it inline. Gating free tier back to a manual button would cut the ask for those users. If the team wants that gate, it can say so at plan review.
- **Errors show inline. There is no fallback to a manual button.** If AI isn't configured (503) or the budget is spent (429), clicking `✦ generate` would just return the same error. Showing the reason is more honest than a button that can only fail. `refresh()`'s catch already renders `renderError` with `↻ retry`.

Alternatives set aside:
- *Make the workspace GET auto-regenerate, as the proxy GET does.* This would turn a cheap read into a spend path, break the `GET → missing` API tests, and leave the client stuck on "loading" for the whole LLM call with no generating state. Rejected.
- *Show the previous content while regenerating stale.* The server doesn't return stale content, and adding it would widen the GET contract for a cosmetic gain. Not needed for the ask.
- *Extract a shared section helper for brief/recap.* The two modules are deliberately mirrored (CLAUDE.md). The change is a few lines in each. Not worth a refactor here.

No refactor is required. Research concluded the same, and I confirmed it at HEAD.

### What the builder must get right
1. **Exactly one button listener.** `init()` ends with an unconditional `wireRefresh(...)` (`brief.js:144`, `recap.js:177`), and `refresh()` also ends with `wireRefresh` (`brief.js:116`, `recap.js:149`). If `init` calls `refresh()` and then falls through to its own `wireRefresh`, the button gets two listeners, and one click fires two POSTs, which is two free-tier charges. The auto path must not wire the button a second time.
2. **No loops.** An error after the auto-POST stays in `error` until the user clicks retry. A GET error renders the error without trying a POST. `fresh` never POSTs.
3. **Mount-once guard stays as it is.** `content.dataset.loaded` (app.js:183) and placeholder removal (swipe.js:678/692) already stop a re-expand from re-running `init`. Do not touch them.

### Witnesses (each fails before the change, passes after, unless noted)
Use the seeded local-provider workspace (`shouldMockAi` makes POST return mock content). The brief/recap cache persists per worker, so clear the target issue first with `/test/clear-brief-cache` / `/test/clear-recap-cache` (`routes/test.js:432`, `:480`). Count POSTs to `/api/brief/` and `/api/recap/` with `page.on('request')`.
- **W1 – missing auto-generates, tree view** (Brief and Recap): clear the cache, expand the toggle, do not click. `data-state` reaches `fresh`, content is visible (`.brief-content`, or `.recap-list`/`.recap-empty`), and exactly 1 POST is sent.
- **W2 – missing auto-generates, swipe view** (Brief and Recap): same as W1, through the accordion. Replaces the two "refresh button triggers POST" tests' opening steps.
- **W3 – stale auto-generates:** route the status GET (`page.route`) to return `{status:'stale', generatedAt}`, then open. Exactly 1 POST is sent and the section lands on `fresh`.
- **W4 – guard (what the manual click used to prevent: unrequested spend):** with a fresh cache (POST once through the API first), open the section. It shows `fresh` with 0 POSTs. Collapse and re-expand: still 0 POSTs. Then click `↻ refresh` once: exactly 1 POST. This catches a doubled listener. It passes before the change too, which is intended. It is a regression guard.
- **W5 – error path:** route the POST to return 503 `{error:'AI recap is not configured…'}`, clear the cache, then open. `data-state` is `error`, the message is shown, `↻ retry` is visible, exactly 1 POST is sent, and there is no second POST after a short wait.

Run `npm test` (unit and full E2E). No other spec should need to change. If one does, it was asserting today's manual shape, so update it to the new behaviour. Don't weaken it.

### Likeliest ways this breaks
- A doubled button listener means double POSTs per click (W4).
- A retry loop or auto-POST on error or fresh (W4, W5).
- Tests that pass for the wrong reason because the cache was already fresh from an earlier test in the same worker. W1 and W2 must clear the cache first and count POSTs, not just check the final state.

### Constraints from recent history
`git log --oneline -15 -- public/brief.js public/recap.js tests/e2e/swipe.spec.js tests/e2e/tree-sections.spec.js`: the client modules call `window.api(url, { on401: false })` (LIN-505), which surfaces errors inline instead of logging the user out. Keep that. They also use the shared `window.escapeHtml`/`relativeTime`/`renderMarkdown` (LIN-421/545), and the specs run on the local provider with per-worker urlKey (LIN-427/627). Nothing has touched these files since the ticket was filed (`git log --since=2026-07-04` is empty for brief/recap/context/app/swipe/workspace-api).

### Session fit and review
fits one session: two mirrored small edits, two header comments, and five witness tests in two existing spec files. Land them as one PR.

This change removes the click-before-spend gate on two LLM-backed sections, which loosens a cost guard. A second reader should confirm the free-tier ruling and the stale decision before it is built.

plan-review due: yes
