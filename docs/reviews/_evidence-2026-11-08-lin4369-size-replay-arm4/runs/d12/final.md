## LIN-1512 sizing: just the task

The size record is written below `## As asked`. The status moves from Todo to In Progress. I posted no comment, because the prompt says not to.

**Check that the ticket still matches the code:** it does. Since the ticket was created (2026-07-21), nobody has changed `lib/components/navbar.js`, `lib/render.js`, `public/style.css`, `public/app.js`, `public/llms.txt`, `tests/e2e/search.spec.js` or `tests/e2e/header-nav.spec.js`. At HEAD 921abf7 the code is as both Surveys describe it:
- Search's toggle and panel are both gated on `currentPage === 'projects'` in `navbar.js` (L87-101).
- The page title comes from `renderPageHeader` in `render.js` (L196).
- `initSearch()` looks up its elements by selector, so moving them doesn't affect it.

**What the size covers:** what the reporter sees as "search" is the toggle in row 1 of the nav, so the toggle and the panel both move under the title. Everything that has to change for that to work is part of the task, not an extra:
- removing search from the shared nav entirely, so no dead nav branch or second copy is left behind;
- rewriting the LIN-1149 tests in `header-nav.spec.js` and `search.spec.js` L183 to the new rule ("search is never in `.nav-actions`"), while keeping the guarantee that search doesn't appear on other pages;
- a `!isLanding` guard;
- measuring `--nav-sticky-h` again;
- fixing the text that says search is in the nav: `llms.txt` L99-100 and L393, the comment in `style.css` (~L951), and the navbar JSDoc.

**Why nothing larger:** none of these findings binds on this task:
- a shared page-controls slot under the header;
- moving the team selector out of the nav;
- the "shared chrome carries one page's controls" pattern.

The move works without any of them and still fixes what was reported. They stay in the Surveys. The standing "err larger" policy only weighs sizes that a binding finding opens, and nothing opens one here. This is a small, clear ticket, so it stays just the task.

**Is this a symptom of something deeper?** Partly. The shared navbar carries controls that belong to the projects page alone: search, and the team selector too. The reporter's reasoning would apply to the team filter as well. That belongs in a separate ticket, not this one.

**Cuts: none.** Two things for whoever implements it:
1. Triage recommended moving the panel only. That would leave the "search" toggle above the nav, so it would be a cut to the ask. The record doesn't cover it.
2. Two design questions are left for the implementer. Neither one drops anything from the ask:
   - keep a toggle, or show the input all the time (the Survey leans towards always visible, to match Swipe's filter bar);
   - how to align the left-aligned panel inside the centred header.

   Search will no longer stay pinned to the top of the screen. That follows directly from what the reporter asked for, so it isn't a cut.

The code clone was only read and has not been changed.

DONE: Sized LIN-1512 as "just the task" under the standing policy, with no cuts; moved status to In Progress
