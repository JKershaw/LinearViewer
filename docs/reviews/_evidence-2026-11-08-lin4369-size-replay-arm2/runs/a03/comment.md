**Scoping: size of the move recorded (just the task, decided by the standing policy)**

Staleness check: the ticket was created 2026-07-04T09:06Z. HEAD (973a8ec) has no commits since then touching public/brief.js, public/recap.js, public/app.js, public/swipe.js, public/context.js, routes/workspace-api.js or lib/render.js. The triage comment and both Surveys still match the code.

What the code shows:
- Both views mount Brief and Recap only once per page load (the tree view's loadLazySection and Swipe's accordion handler drop the placeholder marker), so auto-generating in init() fires once per open, not on every re-expand.
- The GET returns no body when the cache is `stale`, only `generatedAt`/`model`. So a section that is out of date can only be "populated" by regenerating it, or by having the GET return the last body. Either is the builder's call; neither is a cut.
- The POST already returns 503 when no AI is configured and 429 when the free tier runs out. These need to land back on today's generate button, not on an error state. That is part of doing the task, not an extra.
- Nothing on the server stops duplicate calls. A client-side guard for a section that is already generating is part of the task. Server-side coalescing across tabs is not needed for the ask.

Why not larger: none of the Surveys' findings bind. Merging brief.js and recap.js, and pulling the four brief/recap generate-and-cache paths into one seam, are worth doing, but the ask works without them. The err-larger standing policy only weighs sizes that a binding finding opens, so it leaves this at just the task.

Why I didn't take the Surveys' narrower policy: auto-generating only for `missing`, or only with a paid key, would leave stale sections or free-tier users clicking a button. That cuts the ask, and a cut needs a ruling. I scoped the full ask instead and raised the cost points below as open questions.

Open questions, which could be tickets of their own:
- Opening a section now spends money. That includes the shared free-tier quota, which also covers prompt generation, and every open of a stale section, since any comment or state change makes it stale. A separate budget or quota for this may be worth a ticket.
- lib/render.js shows Brief/Recap without checking `featureFlags.aiRecommendations`. Should that switch also turn off auto-generation?
- What the user really wants is the content waiting before they open the section. Generating in the background when a task changes would remove the wait and the duplicates. That is a larger product call.

Housekeeping the builder should not miss: the written "LLM generation only on an explicit button" stance (LIN-595, public/observation.js) no longer holds for these two sections. That should be stated where the team keeps such rules. public/llms.txt also describes these sections as "lazy AI", which becomes out of date.
