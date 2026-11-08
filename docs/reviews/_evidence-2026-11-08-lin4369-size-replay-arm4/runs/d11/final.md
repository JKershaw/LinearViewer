I scoped LIN-1512 and sized it **just the task**, decided by the standing policy. The size record is in `output/description.md`, and the move to In Progress is in `output/tracker-actions.md`. As the prompt says, I posted no comment.

**Is the ticket still accurate?** Yes. `git log --since=2026-07-21T08:21:53Z` finds no changes to any file the ticket touches (navbar.js, render.js, style.css, app.js, llms.txt, search.spec.js, header-nav.spec.js). HEAD is 921abf7, so what the triage note and both Surveys say about the code still holds.

**What the code shows**
- The shared navbar emits both search pieces, and only on the projects page. The "search" toggle sits in the nav's action area, on row 1 above the view tabs. That's the "above the nav" the reporter saw on Android. The panel opens between the nav and the title.
- Only `renderPage` in render.js asks for the projects page, so this changes one page.
- The search script finds its elements by id and class, so moving the markup won't break it.

**Why "just the task"**
- The ask works without any Survey finding:
  - The shared page-controls slot (Swipe and prompts each have their own toolbar) is nearby work, not needed for this move.
  - Moving the team selector out of the nav is the same story.
  - The deeper pattern, the shared header carrying one page's controls, is real. This task fixes it for search, and the rest stays in the Surveys.
- With nothing binding, the standing policy has no bigger size to weigh. A small, clear ticket stays just the task.

**What the task itself covers.** These come with doing the move properly, not extra pieces:
- Take the search branches out of the navbar, so no dead copy is left behind.
- Rewrite the three LIN-1149 placement tests in header-nav.spec.js and the one in search.spec.js to the new rule ("search is never in the nav actions, and only appears on projects"), rather than deleting them.
- Render the moved markup only when the page is not the landing page.
- Re-measure the mobile sticky-header height once the toggle leaves row 1.
- Update the stale text in llms.txt (lines 99–100 and 393) and the comments in style.css and navbar.js.

**No cuts, with one condition.** The ask says "search" should appear below the title, and "search" is the toggle's own label. The triage comment recommended moving only the panel and leaving the toggle in the nav. That would leave "search" above the nav, so it would be a cut. I sized for moving both the toggle and the panel.

**Notes for implementation:**
- **Keep the toggle or show the input all the time.** Both deliver the ask. Keeping the toggle is the literal reading and churns fewer tests. That's a design choice, not a size question.
- **Search will scroll away.** Once it sits below the title, it scrolls out of view on long pages. That comes with the ask, so it isn't a cut, but it's worth noting in the PR.

DONE: Sized LIN-1512 as "just the task" (standing policy, no cuts): move the search toggle and panel from the shared nav to below the projects page title.
