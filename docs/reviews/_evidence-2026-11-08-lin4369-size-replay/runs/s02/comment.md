## Survey open-0: LIN-998 @ 973a8ec77

**Context doesn't load earlier than Brief or Recap. It's just cheaper.** All three sections fetch only when their toggle is opened: `loadLazySection` in `public/app.js` for the tree view, and the accordion handler in `public/swipe.js` (~675) for Swipe. What differs is the fetch:

- **Context** (`lib/context-graph.js`) is a deterministic graph with no model call. It's free and returns instantly.
- **Brief and Recap** send a GET (`routes/workspace-api.js` ~1458 and ~1684) that only checks the cache and returns `fresh`, `stale` or `missing`. On `missing` or `stale` the client shows a generate button. Only the POST calls the model.

The code change is small: in each module's `init()` (`public/brief.js`, `public/recap.js`), call `refresh()` when the GET comes back `missing` or `stale`. The hard part is the policy.

**Why it's harder than it looks**

1. **Cost and quota.** Every model call is a click today. With this change, opening a section spends money. Users without an OpenRouter key draw on the free tier (`lib/free-tier-store.js`: 20 a day per workspace, 50 an hour globally), which is shared with prompt generation. Generating on `stale` makes it worse: any new comment changes `inputHash`, so every later open regenerates.
2. **Failures look different.** The POST returns 503 when AI isn't configured and 429 when the free tier runs out. On open, these would show as error states where a harmless "generate" button sits now. `lib/render.js` (~886) also renders these sections without checking `featureFlags.aiRecommendations`, so auto-generation would ignore workspaces with AI turned off.
3. **Latency and duplicates.** Generation runs long enough that the route needs `armKeepalive` to avoid Heroku's H12 timeout. Nothing on the server stops duplicates, so two tabs mean two paid calls.
4. **Both views change together.** The tree view and Swipe share `BriefSection` and `RecapSection`, so a module change also changes Swipe. Decide that on purpose. Expect e2e updates in `tests/e2e/swipe.spec.js` (~483), and possibly in `brief.spec.js` and `recap.spec.js`.

**There's a precedent.** The agent-facing proxy routes (`routes/proxy.js` ~3395 and ~3700) already generate on GET when the cache is missing or stale. `?noRefresh=1` opts out, and the free-tier charge comes only after the cache check, so a cache hit is never billed.

**What I'd do first.** Settle three questions in triage before writing code:

- Auto-generate on `missing` only, or on `stale` too?
- Do free-tier users get it at all? I'd say only with a paid or session key, falling back to the button otherwise.
- Should opening one section also start the other?

Then add an `autoGenerate` option to both modules' `init()`, turn 503 and 429 into the manual state, and pass the option from `app.js` (and from `swipe.js` if Swipe should change too).

**The deeper problem.** The user really wants the content waiting when they open the section. Generating in the background when a task changes, or when it's dispatched, would remove the wait and the duplicates, at a higher cost. Weigh that in triage too.
