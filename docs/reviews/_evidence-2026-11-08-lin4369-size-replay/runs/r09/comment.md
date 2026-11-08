**Scope: size record written ("consolidate the decision this task touches", by the standing policy). Needs a ruling on cuts before build.**

**Re-grounding.** I checked every file the ticket and Surveys name: `public/brief.js`, `public/recap.js`, `public/app.js` `loadLazySection`, `public/swipe.js` `handleAccordionClick`, `public/context.js`, `routes/workspace-api.js` brief/recap GET/POST, `routes/proxy.js` recap/brief GET, `lib/free-tier-store.js` and `lib/render.js`. No commit touches any of them after the ticket was created (2026-07-04T09:06Z). HEAD `973a8ec` is the commit both Surveys read, so their line references hold.

**What the code shows (beyond the Surveys):**
- Context and Brief/Recap mount the same way and at the same moment. Context just does free, deterministic work. Brief/Recap GET only reads the cache, and only POST spends.
- The human-facing POST charges a free-tier unit before it fetches context or generates, so a failed generation still uses quota. The agent-facing GET charges only after the cache check. The shared rule in the size record settles this ordering in one place.
- The workspace routes have no LLM timeout. The proxy wraps generation in a timeout. Auto-generation on open would inherit the untimed path unless the generation path is shared.
- `lib/render.js` emits the Brief/Recap toggles with no `aiRecommendations` check, while the AI prompt row right below it is gated on that flag. This is why AI-off workspaces are listed as a cut.
- Re-open is already guarded in both views (`dataset.loaded` in the tree, placeholder attribute removal in Swipe). Duplicates come from concurrent mounts or tabs, or an agent reading at the same moment, not from re-expanding.

**Size:** consolidate the decision this task touches, decided by the standing policy (err larger). What the human-facing read now needs is the rule the agent-facing read already has: serve if current, generate on missing or stale, charge only when generation is certain. Making that one shared rule, with coalescing of concurrent generations, is what stops duplicate paid calls at the cause. Merging the two near-mirror client modules is a follow-up and isn't required. The deeper want, background generation so content is already waiting, is noted as a later step.

**Ruling needed (cuts to "can we make Brief and Recap populated on section open too"):**
- Recommended: generate on open for missing **and** stale, but only with a session or paid key. Free-tier users keep the button, because the free pool (20/day per workspace, 50/hour global) is shared with prompt generation.
- In every option, workspaces with AI turned off keep the button.
- Alternatives: everyone including free tier (full ask apart from AI-off); missing-only; or keep the button (decline).
