## Implementation Plan

### Problem and what done looks like
As asked: *"Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too."*

Today, opening Brief or Recap runs a cheap status GET. Unless a current (`fresh`) result is cached, the section stops on a placeholder with a button (`✦ generate` when `missing`, `↻ refresh` when `stale`), and nothing is generated until that button is clicked (`public/brief.js:127-145`, `public/recap.js:160-178`). Context has no such state: its `init()` fetches and renders straight away (`public/context.js:320-335`).

**Done when** (the ticket has no Done-when, so this one is the plan's own): opening Brief or Recap, on the dashboard tree (the reported page) or on the swipe card, ends on generated content with no click whenever no current one is cached, whether it was never generated or has gone out of date. A current cached result is shown as it is, with no regeneration. Collapsing and re-expanding the section never triggers another generation. The `↻ refresh` button still regenerates on demand.

### Cuts to the As asked block
None. The research comment proposed auto-generating only on `missing` and leaving `stale` behind the manual `↻ refresh`. **This plan does not take that cut.** A stale section shows no brief at all, only "Inputs have changed… Refresh to update." (`brief.js:61-65`, `recap.js:89-98`), because the status GET returns no body for `stale`. Leaving stale manual would therefore keep the exact "open, then click to generate" flow the ticket asks to remove, for every task whose inputs have changed. The "re-open tax" argument does not hold up either. `stale` means the hashed issue slice changed after the last generation (description, comments, state, labels, children: `lib/recap-cache.js:43-86`). One auto-regeneration turns the section `fresh` again, and later opens cost nothing until the inputs change. It is the same single spend the user would make by clicking to see anything.

One limit is not a cut: where AI is not configured (POST 503) or the daily free-tier budget is used up (POST 429), nothing can be generated, by auto-generation or by the button. The section opens on the existing error state, which carries the server's message (for example "AI brief is not configured. Connect OpenRouter…") and a `↻ retry` button.

### Which way the change goes, and why
**Change `init()` in both client modules so that any status other than `fresh` hands off to the module's existing `refresh()`.** `refresh()` already runs generating → POST → fresh or error and wires its own button (`brief.js:108-117`, `recap.js:141-150`). The server does not change. The cheap GET stays the gate: a POST fires only when the GET says the cache cannot be shown. That is why a fresh result is never overwritten.

- `init()` must not call `wireRefresh` again after handing off to `refresh()`. Today `init()` ends with an unconditional `wireRefresh` (`brief.js:144`, `recap.js:177`). Keeping it would stack a second click listener on the button `refresh()` has just wired, and every later refresh click would then send two POSTs. Wire exactly once on each path.
- `renderMissing()` and `renderStale()` become unreachable. Delete them. Update the module header comments, which list "four states", to say that open-time generation replaces the missing and stale placeholders. No CSS keys off `data-state="missing|stale"` for these sections, and no other client code reads those states (checked with `grep -rn "data-state" public/*.css`, plus a grep for the status strings in `public/*.js`).
- Update the comment on the mount guard in `public/app.js:181-182` ("a re-fetch is wasteful"). That guard, together with `swipe.js` removing the `data-*-placeholder` attribute, is now what stops a re-expand from spending an LLM call, and the comment should say so. The guard logic itself does not change.

**Product call on free-tier spend, decided rather than parked:** auto-generate for every tier, with no client-side "skip if free tier" gate. The sections mount only when a person explicitly expands them, which is the intent to read. Nested detail toggles are not persisted or restored on load (`app.js` `state.expanded` tracks issue lines only), and swipe accordions start closed (`swipe.js:340-362`). Each open therefore costs at most the one click the user would otherwise make. The server's existing guards (the 503 when unconfigured, and `freeTierStore.tryUse` metering at 20 per day per workspace) remain the cost boundary and are untouched. A client tier-gate would need tier knowledge the client does not have, and would bring the click back for exactly the users the ticket is about.

Alternatives set aside:
- Auto-generate on `missing` only (research V1): it keeps the click for stale sections. See Cuts above.
- Return the stale body from GET and show it while regenerating: nicer, but it changes the API contract and is not needed to meet Done-when.
- Server-side "generate on GET": it would turn the cheap read into a metered spend for every caller, including the proxy consumers of the same routes.
- Auto-generate only on paid or non-free-tier workspaces: see the product call above.

### Every place this behaviour lives
The behaviour is "a Brief or Recap section that lands on a manual generate/refresh placeholder when opened". It lives only in the two shared modules. They are mounted from exactly two places, both through `init()`: `public/app.js:176-209` (`loadLazySection`, dashboard tree; markup from `lib/render.js:896-902`) and `public/swipe.js:675-701` (swipe accordion). `grep -rn "BriefSection\|RecapSection" public lib routes server.js` finds no other mount sites. Changing `init()` therefore covers both surfaces.

| Place | In or out |
|---|---|
| `public/brief.js`, `public/recap.js` `init()` | In: this is the change |
| `public/app.js:181` guard comment | In: comment only |
| `tests/e2e/swipe.spec.js:470-563` (Recap UI and Brief UI, swipe) | In: the "refresh button triggers POST" tests describe today's click-first shape. Rewrite them as the open-lands-fresh witnesses below. |
| `tests/e2e/tree-sections.spec.js:39-111` | In: add the witnesses for the reported surface. The existing state regexes still pass. |
| `tests/e2e/brief.spec.js`, `recap.spec.js`, `workspace-api-recap-brief-local.spec.js` | Unaffected: they are API-level and the server is unchanged |
| `routes/workspace-api.js` brief/recap GET and POST (`:1458`, `:1518`, `:1684`, `:1744`) | Out: unchanged by design |
| Observation page run-summary "summarise this session" (`public/observation.js:233`, `:766`) | Out: a different feature (per-run summaries), deliberately labelled "explicit spend only", and not named by the ticket |
| Roadmap recap/brief | Out: project-level narrative with its own flow, not these task sections |

### Witnesses
These are Playwright e2e tests on a seeded local-provider workspace, where `shouldMockAi` makes the POST deterministic. Each must fail at HEAD and pass after the change. They must not depend on the per-worker cache state: clear it with `/test/clear-brief-cache` or `/test/clear-recap-cache`, or pin the GET status with `page.route`. Count requests to `/api/brief/` and `/api/recap/` by method.
1. **Missing → populated on open** (tree view, both sections): with the cache empty, a single expand ends on `data-state="fresh"` with `.brief-content` (Brief) or `.recap-list`/`.recap-empty` (Recap) visible, after exactly one POST and no click. At HEAD it stops on `missing`.
2. **Stale → populated on open**: with the GET forced to `{status:'stale'}`, a single expand ends on `fresh` after one POST. At HEAD it stops on `stale`.
3. **Fresh is not regenerated**: after one API POST for the issue, opening shows `fresh` with **zero** POSTs.
4. **Re-expand does not spend**: extend "mounts only once": collapse and re-expand after the section settles, and confirm no further GET or POST is sent.
5. **One POST per refresh click**: after auto-generation lands, clicking `↻ refresh` sends exactly one POST. This catches the stacked-listener bug.
6. **Error on open is retryable**: with the POST forced to 503, opening ends on `data-state="error"` showing the server message and `↻ retry`. One retry click sends exactly one POST.
7. Swipe: rewrite the two "refresh button triggers POST" tests as witness 1 (open → fresh without a click) for that surface.

### Likeliest ways this breaks
1. Stacked click listeners from the trailing `wireRefresh` in `init()`, so each refresh sends double POSTs and double spend. Caught by witness 5.
2. Generation firing without a deliberate open (a re-mount on every expand, or a future surface that mounts eagerly), which spends silently. Caught by witness 4. Any new mount site must keep the "init once, on user expand" rule, which the updated guard comment states.
3. The error state on open becoming a dead end. Caught by witness 6.

### Grounding
I checked every claim above at HEAD `973a8ec`. `git log --since=2026-07-04 -- public/{brief,recap,context,app,swipe}.js routes/workspace-api.js lib/render.js` returns no commits, so the triage and research descriptions of the code still hold, apart from the stale-scope disagreement noted above. `git log --oneline -15` on the touched files shows only unrelated churn (header nav, theme, StatusPill) and no constraint that bears on `init()`.

### Size and review
One focused change: two near-identical client functions, one comment, and e2e tests. It is small and has no seam worth splitting. **fits one session**.

It loosens no server validation or contract. It does remove the explicit click that used to sit in front of an LLM spend, and the research flagged that as the product question this plan has decided. That earns a second reader before building.

plan-review due: yes
