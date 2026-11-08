## Size: LIN-1512 @ 921abf747

**Size: just the task.** It is decided by the standing policy (err larger, but a small, clear ticket stays just the task). No size ruling from a person is on the trail. The triage comment and both Surveys come from agents.

**Staleness check.** `git log --since=2026-07-21T08:21:53Z` over `lib/components/navbar.js`, `lib/render.js`, `public/app.js`, `public/style.css`, `public/llms.txt`, `server.js`, `tests/e2e/search.spec.js` and `tests/e2e/header-nav.spec.js` returns nothing. The triage notes and the Survey notes still match HEAD.

**What "just the task" covers.** The reporter sees the word "search" above the view tabs. That word is the toggle in `.nav-actions`, not the panel. Delivering the ask in full means both the toggle and the panel leave the nav and sit under the projects page `<h1>`. The following come with that move. They are not extras:
- Remove both search branches from the navbar, so no second copy remains.
- Gate the moved markup on `!isLanding`. The nav used to do that for free.
- Repin the LIN-1149 tests to the new rule, "search is never in `.nav-actions`, and appears only on projects". Those tests are in `header-nav.spec.js` ~L229-264 and `search.spec.js` L183.
- Re-measure the mobile `--nav-sticky-h` and the scroll clearance, because row 1 loses an item.
- Refresh the now-stale text in `llms.txt`, the `.search-panel` CSS comment and the navbar JSDoc. Keep the element ids that `llms.txt` promises to agents.

**Not panel-only.** Triage recommended moving only the panel. That would leave "search" above the nav, so it would be a cut, and this size does not take it.

**Toggle vs always-visible input.** Both deliver the ask, so neither is a cut. Keeping the toggle as it is and only moving it is the faithful reading, with the smallest test churn. An always-visible input would change the layout for every visitor, and nobody asked for it. Raise it separately if it is wanted.

**Accepted trade-off.** Below the title, search scrolls out of view on long trees, where it used to stay in the sticky header. That follows from the ask itself ("part of the page, not nav"). It is not a cut.

**Is this a symptom?** Partly. The shared nav carries controls for one page only: search, and also the team selector. None of that binds here. The move works and fixes what was reported without changing it. A shared page-controls slot under the header, and moving the team selector out of the nav, stay in the Surveys as separate work.
