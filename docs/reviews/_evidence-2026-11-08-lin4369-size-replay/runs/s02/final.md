I wrote the LIN-998 survey to `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/s02/output/comment.md`. It's under 500 words, and the `code/` checkout is unchanged.

**The request rests on a misreading.** Context doesn't load earlier than Brief or Recap. All three fetch only when their toggle is opened (`public/app.js` `loadLazySection`, and the Swipe accordion in `public/swipe.js`). Context only seems automatic because it is a free graph lookup with no model call. Brief and Recap first check a cache. When there's nothing current, they show a "generate" button, and only that button's POST calls the model.

**The code change is small; the policy is the hard part:**
- **Cost and quota.** Opening a section would start spending money. Users without an OpenRouter key draw on the free tier, which allows 20 calls a day per workspace and is shared with prompt generation. If we also regenerate when the cache is out of date, every new comment means another paid call on the next open.
- **Errors.** "AI not configured" (503) and "free tier used up" (429) would show as errors where a harmless button sits now. The sections also ignore the `aiRecommendations` flag, so workspaces with AI turned off would get auto-generation too.
- **Latency and duplicates.** Generation is slow; the route already needs a keepalive to avoid Heroku timeouts. Nothing on the server stops two tabs from paying for the same generation twice.
- **Swipe changes too.** The tree view and Swipe share the Brief and Recap modules, so changing one changes both. The Swipe e2e tests would need updating.

**There's a precedent.** The agent-facing routes in `routes/proxy.js` already generate on read when the cache is missing or out of date. They have a `?noRefresh` opt-out and charge the free tier only on a cache miss.

**What I'd do first.** Settle three questions in triage:
- Auto-generate only when nothing exists, or also when the cached copy is out of date?
- Leave free-tier users out?
- Should opening one section also start the other?

After that, the change is an `autoGenerate` option in both modules that falls back to the button on 503 or 429. The comment also raises the deeper option: generate in the background when a task changes or is dispatched, so the content is already there when the section opens.

DONE: survey comment for LIN-998 @ 973a8ec77 written to output/comment.md
