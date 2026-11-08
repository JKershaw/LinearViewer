## Scope: LIN-1512 @ 921abf7

**Size: just the task.** Decided by the standing policy (err larger, set 2026-11-07). Neither Survey turned up a finding this task binds on, so the policy has nothing to weigh, and a small, clear ticket stays just the task.

**Re-grounding.** `git log --since=2026-07-21T08:21:53Z` over `lib/components/navbar.js`, `lib/render.js`, `public/app.js`, `public/style.css`, `public/llms.txt`, `tests/e2e/search.spec.js` and `tests/e2e/header-nav.spec.js` returns nothing. HEAD matches the triage note and both Surveys: the `search` toggle (in `.nav-actions`, row 1 of the sticky nav) and `#search-panel` (emitted after `</nav>`) are both gated on `currentPage === 'projects'`, and `renderPage` in `lib/render.js` is the only caller that passes `'projects'`.

**What "the task" covers.** The ask puts "search" in quotes. That is the toggle's label, the word the reporter sees above the tab strip on a phone. So the task moves **the toggle and the panel** under the page title. I am **not** following triage's panel-only recommendation, because it would leave "search" above the nav and would be a cut to the ask. Doing the whole move also means:
- removing the nav's search branches, so there is one copy and no toggle in the nav wired to markup in another file;
- keeping search off landing previews now that the nav no longer does that for free;
- rewriting the LIN-1149 placement tests to the new rule ("search is never in `.nav-actions`"), keeping the "no search on other pages" guarantee and the "not gated on dispatch" check;
- re-measuring the mobile sticky-header clearance, since row 1 loses an item;
- updating the text that would go stale: `public/llms.txt` (the nav-bar wording; the `#search-*` ids it promises stay unchanged), the `.search-panel` CSS comment, and the navbar JSDoc/LIN-1149 comment.

These are the parts of delivering the ask without regressions. None of them is an extra.

**Engineering choices (mine, with reasons)**
- **Keep the toggle and don't make the input always visible** (Survey reading (b)). The ask is about placement only. An always-visible input changes the layout every visitor sees and churns every test in `search.spec.js`, and nothing in the report needs it.
- **Losing sticky access is accepted, not a cut.** Below the title, search scrolls out of view on long trees. That is the direct result of what the reporter asked for ("part of the page, not nav").

**Symptom of something deeper?** Partly. The shared nav carries one page's controls: search, and also the projects-only team selector. The reporter's reasoning applies equally to the team filter. That finding, and the shared page-controls slot under the title (Swipe, custom prompts and search each hand-roll their own), don't bind here: the asked move works and fixes what was reported without either. They stay in Survey global as candidates for their own tickets.

**Cuts:** none.
