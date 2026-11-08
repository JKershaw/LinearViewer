I wrote the LIN-998 survey to /Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/s08/output/comment.md (455 words). It is based on reading the code at 973a8ec77, and no files in the repository were changed.

What I found:
- **The ticket compares unlike things.** Context fills itself in on open because it costs nothing: it is built from data already loaded, with no AI call. Brief and Recap each make a paid OpenRouter call when generated, and that also uses up the free tier (20 a day per workspace). Making the user click to generate them is deliberate. It matches the cost rule written down for the Observation page (LIN-595): the AI only runs on an explicit button. So this is a cost decision for triage before it is a UI change.
- **The obvious change** is to have `init()` in `public/brief.js` and `public/recap.js` generate automatically when nothing is cached. That fixes both the tree view and the swipe view at once, but it has side effects:
  - Every time someone opens a section that is missing or out of date, it spends money. Out of date is common, because any comment or state change on the issue invalidates the cache.
  - When AI isn't set up or the free tier is used up, users see an error where they now see the "No brief yet" placeholder.
  - The same issue can be shown in two places at once, and nothing stops two generation requests running together for it.
  - `public/llms.txt` would quietly become wrong, and the existing tests would most likely still pass, so nothing would flag the change in cost.
- **Affordable improvement:** add an opt-in `autoGenerate` option, used only for missing results and only when a paid key is present. Fall back to the placeholder instead of an error, write the rule down next to the LIN-595 rule in CLAUDE.md, update `llms.txt`, and add one end-to-end test.
- **Larger work, not this ticket's:** merge the two near-identical client modules into one. Also pull the brief and recap generate-or-serve logic, which exists in four places across `routes/workspace-api.js` and `routes/proxy.js`, into one shared piece that also stops duplicate requests for the same issue.

DONE: Survey comment for LIN-998 @ 973a8ec77 written to output/comment.md; main finding is that auto-generating Brief/Recap would undo the deliberate "AI only on a button" cost rule, so triage should decide that first.
