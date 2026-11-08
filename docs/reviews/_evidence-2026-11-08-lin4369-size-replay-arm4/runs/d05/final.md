I sized LIN-1512 as **just the task**. Nothing is cut from the ask, and the standing "err larger" policy decided the size.

**What I wrote**
- `output/description.md`: the four-line `## Size of the move` record, to go below `## As asked`.
- `output/tracker-actions.md`: status Todo -> In Progress.
- No comment was posted, as the prompt says. The working tree is clean.

**Staleness check:** no commits since the ticket was created (2026-07-21) to any file it references: `lib/components/navbar.js`, `lib/render.js`, `public/style.css`, `public/app.js`, `public/llms.txt`, `tests/e2e/search.spec.js` or `tests/e2e/header-nav.spec.js`. HEAD is `921abf7`, and the code matches what the Surveys describe.

**What the ask needs**
- The word the reporter sees as "search" is the toggle in `.nav-actions`, on row 1 of the nav. On a phone, row 1 sits above the view tab strip.
- So the toggle has to move below the `<h1>`, not just the panel. Triage recommended moving only the panel, which would leave "search" above the nav. That is a cut, and I did not take it.
- Moving both parts means:
  - deleting the nav's search branches, so no second copy is left behind;
  - rendering search under the page header in `renderPage`, guarded so it doesn't show on landing previews;
  - rewriting the LIN-1149 tests to the new rule, "search is never in `.nav-actions`", and keeping the "no leak onto other pages" guarantee;
  - updating `llms.txt` and the CSS and JSDoc comments.
- All of that is the asked change done properly, not extra scope.

**Why nothing larger**
- No Survey finding binds:
  - **Shared page-controls slot** (Swipe, prompts toolbar, search): the move works without it.
  - **Team selector out of the nav:** nearby, but not needed for this move.
  - **"Shared chrome carries one page's controls":** a deeper pattern. The ticket is a real instance of it, but not a symptom that needs it fixed first.
- The policy weighs the sizes a binding finding opens. It cannot make a finding bind, so it adds nothing here.
- The mobile `--nav-sticky-h` is a lower bound ("≥ measured"). A shorter row 1 only adds clearance, so it isn't a blocker. It's still worth re-measuring during the work.

**Notes for implementation (approach, not scope)**
- Keep the toggle rather than an always-visible input. The report quotes "search" as the thing to move, and keeping the toggle keeps `search.spec.js` mostly unchanged.
- Losing sticky access to search is part of what was asked, not a cut.
- Keep `#search-input`, `#search-clear`, `#search-no-results` and `[data-search-text]` unchanged. `llms.txt` promises them to agents.

DONE: Sized LIN-1512 as "just the task" (move the search toggle and panel below the projects title), with no cuts, decided by the standing policy; status set to In Progress
