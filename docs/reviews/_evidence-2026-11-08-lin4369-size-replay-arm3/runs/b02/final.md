I've scoped LIN-1512 as **just the task**.

**What the task is.** On a phone, the "search" link sits in the top row of the navigation, above the row of view tabs. That is the "above the nav" in the report. To deliver the ask, both that link and the panel it opens have to come out of the shared navigation and sit under the projects page title. Doing that properly means:
- removing search from the navigation, so it doesn't exist twice;
- rewriting the LIN-1149 tests that pin search inside the navigation, so they check the new placement and still check that search never shows on other pages;
- keeping search off the landing previews;
- updating the agent guide and the code comments that say search is in the nav.

**Triage's recommendation.** Triage suggested moving only the panel and leaving the "search" link in the nav. I didn't adopt that: "search" would still sit above the nav, so it would cut the ask.

**Why not a larger size.** No finding from the Surveys has to be fixed for the move to work, so the standing "err larger" policy had nothing to weigh. These stay in the Surveys:
- the navigation carrying controls that belong to one page;
- moving the team filter out of the navigation;
- a shared slot for page controls under the title;
- re-measuring the mobile header height, which is a lower bound, so removing an item can only leave extra space.

**Left for the next stage.** Keep the "search" link that opens the panel, or show the search box all the time. Both deliver the ask. An always-visible box changes what every visitor sees and wasn't asked for, so I've noted it as a separate call.

The code hasn't changed since the ticket was filed. I made no changes to the clone.

Files written to `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b02/output/`:
- `description.md`: the "Size of the move" section (just the task, no cuts, decided by the standing policy)
- `comment.md`: the reasoning, what the task covers, and what was weighed and not taken
- `tracker-actions.md`: status set to In Progress

DONE: LIN-1512 scoped as "just the task" (no cuts, decided by the standing policy): move the "search" link and its panel out of the nav to under the page title.
