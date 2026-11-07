## Implementation Plan

### What this is for
As asked: *"Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too."*

When you open Brief or Recap today you get a placeholder and a button: `✦ generate` if nothing is cached, `↻ refresh` with "Inputs have changed…" if the cache is out of date. Only a fresh cache shows content without a click. Context has no such gate. This change makes opening Brief or Recap show current content, the way Context does.

**Done when** (the ticket has none, so this one is the plan's own): opening Brief or Recap, on the dashboard tree card (Details, then Brief/Recap) or in the swipe accordion, ends on rendered content without a click.
- **Fresh** cache: renders from cache. No LLM call.
- **Missing or stale** cache: generates automatically behind the existing `generating…` spinner, then renders.
- **Failure** (AI not configured, free-tier limit, model error): shows the existing inline error with `↻ retry`, and does not retry by itself.
- The `↻ refresh` button on fresh content keeps working as a manual regenerate.

### Cuts to the As-asked block
None. Two narrower scopes came up in the thread, and this plan takes neither, because each would be a cut:
- *"Leave `stale` on the manual `↻ refresh`"* (research comment). Not taken. A stale section shows no body at all (`renderStale` in `public/brief.js:61-65` and `public/recap.js:90-98` render only a placeholder, and the GET omits the body on stale: `routes/workspace-api.js:1486-1491`, `:1712-1717`). Leaving stale manual would mean a section that is still "open, then click to generate".
- *"Gate auto-gen behind 'AI configured & not free-tier'"* (research risk 1). Not taken. Free-tier users would still have to click.

### Cost: settled here, not escalated
Research called free-tier spend "the one genuine product decision". I am settling it as an engineering call, for these reasons:
- **The person asked for exactly this.** The spend happens only when someone deliberately opens a section that has no current content. That is the same single call the click it replaces would make.
- **It costs one call per input change, not one per open.** After generating, the cache is fresh and later opens are cache reads.
- **The system already works this way for agents.** The proxy GET auto-regenerates when the cache is missing or stale (`routes/proxy.js:3386`, `:3659`; `docs/proxy-integration.md:474`, `:506`), and it shares this cache.
- **Running out of quota is visible.** When the 20/day free tier is used up, the POST returns 429 with its reason (`routes/workspace-api.js:1543-1548`, `:1767-1772`), which `renderError` shows inline. AI not configured gives a 503 with "Connect OpenRouter…", which is a more useful thing to see on open than a button that fails the same way when clicked.

### Which way it goes
The decision moves into the client modules' `init()`. Today `BriefSection.init` and `RecapSection.init` (`public/brief.js:127-145`, `public/recap.js:160-178`) render the missing or stale placeholder. After this change, both statuses hand off to the module's existing `refresh()`, which already does generating → POST → fresh or error and wires the button. Fresh stays as it is.

Alternatives set aside:
- **Make the in-app GET auto-regenerate, like the proxy.** Rejected. The GET would block for 25s+ behind the `loading` state with no "generating" signal. It would also change the in-app API contract that `tests/e2e/{brief,recap}.spec.js` pin (GET returns `missing`).
- **Return the stale body and render it marked "out of date".** Rejected. You would open the section to content that is known to be wrong, which is not what Context-parity means.

### Where the behaviour lives (how I know this is every place)
The behaviour is: what a Brief or Recap section does when it mounts. It lives only in `BriefSection.init` and `RecapSection.init`. Repeatable check: `grep -rn -E "BriefSection|RecapSection" public lib` finds exactly two mount sites:
- `public/app.js:186-196` (`loadLazySection`, dashboard tree card)
- `public/swipe.js:675-700` (`handleAccordionClick`, swipe deck)

Both call the same `init`, so both surfaces change together. The recap.js header mentions "pipeline pages", but no pipeline caller exists today. Each place, in or out of scope:
- **In: `public/brief.js`, `public/recap.js`.** Change `init` as above. `renderMissing` and `renderStale` become unreachable, so delete them and update the four-state header comments. No CSS keys on `data-state="missing|stale"` (checked `public/*.css`). `.brief-placeholder` / `.recap-placeholder` stay, because the generating and error states use them.
- **In: an in-flight dedup per (urlKey, identifier) inside each module's `refresh()`.** If a POST for the same issue is already pending, a second `refresh()` waits on that one and renders its result into its own container instead of sending another POST.
  - *Why:* research said the `dataset.loaded` mount guard already covers this. That is true within one mount only. The swipe deck rebuilds the card on every swipe (`renderCard` → `card.innerHTML`, `public/swipe.js:437`, `:459`), so swiping away and back during a 10–25s generation mounts a fresh section, whose GET still says `missing`. That would fire a second metered POST. Once opening a section spends a call, that duplicate is a real cost.
  - *Lifetime:* the entry is cleared when its promise settles, so a later manual `↻ refresh` always regenerates.
- **In: tests describing today's shape.**
  - `tests/e2e/swipe.spec.js:495-514` and `:548-566` click the refresh button after the open. Rewrite both: the open alone ends `fresh` with content, and then clicking `↻ refresh` sends a POST and ends `fresh` again.
  - `tests/e2e/tree-sections.spec.js:72` and `:93` accept `missing|stale` as settled states. Tighten them to `fresh` (local-provider sessions use the AI mock: `shouldMockAi`, LIN-388).
- **Out, unchanged: the server routes** (`routes/workspace-api.js` GET/POST brief and recap) **and `tests/e2e/{brief,recap}.spec.js`, `workspace-api-recap-brief-local.spec.js`, `workspace-model.spec.js`.** These are API-level, and the API does not change.
- **Out: the proxy routes.** They already auto-regenerate.
- **Out: `docs/proxy-integration.md`.** It is still accurate. No in-app doc describes the generate button (checked `docs`, `CLAUDE.md`, `README.md`).

### Likeliest ways it breaks, and the witness for each
All witnesses are Playwright specs on the seeded local-provider workspace. Count requests with `page.on('request')` or `page.route`. Each fails at HEAD and passes after the change.

1. **Fresh content gets regenerated anyway.** This would bypass the cache and burn quota on every open.
   *Witness:* generate once through the API (`page.request.post`), then open the section → it ends `fresh` and **zero** POSTs come from the page.
2. **A failure loops, or retries by itself.**
   *Witness:* `page.route` the POST to return 503 or 429 → opening ends in `data-state="error"`, the server's message is shown, a `↻ retry` button is present, and exactly **one** POST was sent.
3. **A re-mount during generation sends a duplicate POST** (the swipe case above).
   *Witness:* `page.route` holds the brief POST open. Open Brief, swipe to the next card and back, open Brief again, then release → exactly **one** POST, and the visible section ends `fresh`.

**Core witness, on both surfaces and both sections:** with no cache, opening ends `fresh` with content (`.brief-content`, or `.recap-list` / `.recap-empty`) and no click. This is the rewrite of the swipe specs plus a tree-sections case. For **stale**, generate, then change the seeded issue so its context hash moves (any local-provider edit the seed helpers allow), then open → it ends `fresh` after one POST. At HEAD this lands on `stale` with a button.

Constraints from `git log --oneline -15` on these files: there are no recent behavioural changes to `brief.js` or `recap.js`. The last ones are LIN-545 and LIN-421, which moved `esc`, `renderMarkdown` and `relativeTime` onto `common.js` aliases. Keep using those aliases. The swipe specs run on the per-worker local urlKey (LIN-627). New specs must use `localWorkerUrlKey` and `seedLocal`, not `test-token`. Nothing has touched these files since the ticket was filed, and the triage and research line references above were re-checked at HEAD (`973a8ec`).

### Order, size, review
- **Order:** one change. Both modules, then the specs.
- **Session:** fits one session.
- **Review:** this plan turns a manual click gate on a metered LLM call into an automatic call on open, which counts as a gate loosened. Witnesses 1–3 test exactly what that click used to prevent.

plan-review due: yes
