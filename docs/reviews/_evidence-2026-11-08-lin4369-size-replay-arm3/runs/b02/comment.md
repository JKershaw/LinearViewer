## Scope: size of the move

**Size: just the task.** Decided by the standing policy (err larger, set 2026-11-07). No finding binds on this ticket, so there is no larger move for the policy to weigh, and a small, clear ticket stays just the task. Nobody has posted a size ruling on the trail.

**Staleness check: clean.** `git log --since=2026-07-21T08:21:53Z` returns nothing for `lib/components/navbar.js`, `lib/render.js`, `public/style.css`, `public/app.js`, `public/llms.txt`, `tests/e2e/search.spec.js` or `tests/e2e/header-nav.spec.js`. HEAD (`921abf7`) still matches what triage and both Surveys describe.

**What "the task" covers.** The visible "search" in the report is the toggle in nav row 1, which on a phone sits above the view tab strip. To deliver "search below the title, not above the nav", both the toggle and its panel have to leave the shared nav and render under the projects page title. These pieces belong to the task, not to a bigger size, because without them the asked change breaks or stays only half done:
- The nav stops emitting search. Two copies would duplicate the ids.
- The LIN-1149 placement tests (`header-nav.spec.js`, and the `.nav-actions .search-toggle` case in `search.spec.js`) get rewritten to the new rule. Keep the guarantee that search never appears on other pages. Don't delete these tests; repin them.
- Landing previews don't show the moved search. The nav used to give them this for free.
- Text that now says "search is in the nav" gets updated: `llms.txt` lines 99-100 and 393, the `.search-panel` CSS comment, and the navbar LIN-1149 comment and JSDoc. The agent-facing ids and attributes (`#search-input`, `#search-clear`, `#search-no-results`, `[data-search-text]`) stay as they are.

**Not a cut, but a change from triage's recommendation.** Triage recommended moving only the panel and leaving the `search` toggle in `.nav-actions`. I'm not adopting that: it leaves "search" above the nav, so it would cut the ask. Moving the toggle too covers the ask in full.

**Lost sticky access.** Once search sits under the title, it scrolls away on a long tree. That is what the reporter asked for ("part of the page, not nav"), so it is accepted as part of the ask, not a side effect.

**Left to the next stage (how, not size):** keep the toggle-and-panel pattern under the title, or show the input all the time. Both deliver the ask. The toggle keeps behaviour and most of `search.spec.js` unchanged. An always-visible input changes the layout every visitor sees and isn't asked for, so treat it as a separate call.

**Weighed and not binding (stay in the Surveys):**
- The deeper pattern behind this report: the shared nav carries one page's controls.
- Moving the team selector out of the nav.
- A shared page-controls slot under the page header (Swipe's filter bar, the prompts toolbar, search).
- Re-measuring the mobile sticky-header height. That token is a lower bound, so removing a nav item can only leave extra clearance, never too little.

The asked change works without any of these, so none of them bind.
