# Verdict: LIN-1512 (Move page search below the title)

The asked change: put projects-page search below the page title instead of in or next to the nav.

Definition applied as written: the candidate qualifies only if neither Survey recommends a change beyond the asked change that this task could carry. That rules out any tidy, consolidation, move, rename, guard or shared helper. It also rules out anything in the place Survey's "better, at a cost this task could carry" section except doing the asked change itself well, and anything in the task Survey's "do first" except reading or checking for the asked change. Facts, risks, tests, and items the comment itself says are not this task's to carry do not disqualify.

## survey-task-comment.md (Survey open-0)

### Recommended changes beyond the ask that this task could carry (disqualifying)
None.

### Part of the asked change itself, or a fact, risk or test (not disqualifying)
- "`lib/components/navbar.js` emits both parts of search, only when `currentPage === 'projects'`. The `search` toggle sits in `.nav-actions`, row 1 of the sticky header. The `#search-panel` is a sibling rendered after `<nav>`, so it opens above the `<h1>`." (fact about where the change lands)
- "On a phone, row 1 (wordmark, workspace, team, search) sits above the view tab strip. That is almost certainly the \"above the nav\" in the report." (fact)
- "Moving the markup into `lib/render.js` after `renderPageHeader(...)` (L196) shouldn't need JS changes." (fact / the asked change)
- "**Two readings.** Either (a) move the toggle and panel below the `<h1>`, or (b) drop the toggle and show the input itself below the title. (b) fits \"part of the page\" better, but it changes the layout every visitor sees. Someone has to choose." (part of the asked change: two ways to read the request, not an extra change. Borderline because (b) goes further than moving the markup. I ruled it part of the asked change because the Survey presents it as a reading of the reporter's words "part of the page", not as an add-on.)
- "**It costs sticky access.** ... Accept that on purpose." (risk to the asked change)
- "**It reverses LIN-1149 (d398331).** ... Rewrite them to the new rule rather than deleting them. Keep the \"search doesn't appear on other pages\" guarantee." (tests of the asked change)
- "The global `header` is `text-align: center`, but `.search-panel` is a left-aligned 48ch card. Their alignment needs a decision." (part of placing the search below the title)
- "Taking search out may change the header's height and throw off the LIN-984/1058 `scroll-margin-top` clearance. Measure again." (risk / check of the asked change)
- "`public/llms.txt` (L99–100, L393) says search is in or below the nav bar." (docs that go stale because of the move, so updating them is part of the change)
- "The landing page passes `heroHtml` in place of the header, so guard the moved markup on `!isLanding`." (Borderline, because the definition lists "guard" by name. I ruled it part of the asked change. Today the navbar keeps search off the landing page as a side effect. The guard only keeps that behaviour once the markup moves, so it protects the asked change from a regression. It does not guard anything new or beyond the ask.)
- "Take a screenshot of the projects page at about 400px width at this commit, to confirm which element the reporter meant." (do-first: checking for the asked change, which the definition allows)
- "Choose (a) or (b), and record whether losing sticky access is acceptable." (do-first: deciding how to do the asked change, not extra work)
- "Then it's about one PR: move the markup from `navbar.js` to `render.js`, rewrite the LIN-1149 tests, re-measure `--nav-sticky-h`, and update `llms.txt`. If the choice is (b), expect churn across `search.spec.js`, because every test there begins by clicking `.search-toggle`." (the asked change, its tests, and the docs it makes stale)

### Not this task's to carry, per the comment (listed, not disqualifying)
- "**Is this a symptom?** Partly. The navbar mixes global chrome with controls for one page: the team selector and search are both projects-only special cases in `navbar.js`. The reporter's reasoning (\"it searches this page\") applies just as well to the team filter. I'd note that in triage but keep this ticket to search."

## survey-place-comment.md (Survey global)

### Recommended changes beyond the ask that this task could carry (disqualifying)
None.

### Part of the asked change itself, or a fact, risk or test (not disqualifying)
- "Projects-page search is owned by the shared nav, not the page. `lib/components/navbar.js` emits it through two of its three `currentPage === 'projects'` branches. ... `initSearch()` in `public/app.js` finds everything by selector, so moving the markup doesn't affect it." (facts about where the change lands)
- "This area is improving: LIN-978, 1058, 1088 and 1149 tidied the nav, and LIN-462 gave headers a shared component. Swipe already puts its page-local control (`.swipe-filter-bar`) directly under `renderPageHeader`, so the requested shape exists." (facts)
- "The ticket points at something deeper: shared chrome carrying one page's controls." (an observation, not a recommendation. The deeper fix appears only under "not this task's", below.)
- "Moving only the panel leaves the toggle in the nav, wired to markup in another file. That splits the feature and misses the ask." (risk to the asked change)
- "Moving the toggle as well breaks two of the three LIN-1149 tests in `tests/e2e/header-nav.spec.js`, because they assert `.search-toggle` is in `.nav-actions`. The third (\"no search leak\") then passes without testing anything." (tests / risk)
- "`initSearch()` returns early without an error if `.search-toggle` is missing. An always-visible input without a toggle means reworking `tests/e2e/search.spec.js`. Every test there clicks the toggle, so a quiet failure would be caught." (risk / tests)
- "`renderPage` still renders `isLanding` previews (`server.js:952/974/993`). The nav kept search off those for free. In render.js it needs its own `!isLanding` gate, and I found no test for that." (Borderline "guard". Same ruling as in the task Survey: the gate keeps existing behaviour after the move, so it is a risk to the asked change and part of doing it.)
- "Text that would go stale with no test noticing: `public/llms.txt` lines 99–100 (\"in nav bar\", \"below nav bar\") and line 393, the `.search-panel` comment in `public/style.css`, and the navbar.js LIN-1149 comment and JSDoc." (text the move itself makes stale, so updating it is part of the change)
- "Risk of a second copy: a render.js version beside a dead navbar branch, or a new toolbar style next to Swipe's." (risk to the asked change)
- Under "**Better, at a cost this task can carry.**": "Move both toggle and panel into the projects page, under the header." (the asked change itself)
- "Delete the nav's search branches." (Borderline: it could be read as a tidy. I ruled it part of the move. Moving the search out of the navbar means it stops being emitted there. These are the branches that emit search, and leaving them would create the "dead navbar branch" the comment warns about. The navbar's third projects-only branch, the team selector, is left alone and appears under "not this task's".)
- "Keep `#search-input`, `#search-clear`, `#search-no-results` and `[data-search-text]` unchanged, because llms.txt promises them to agents." (a limit on the asked change that makes it do less, so doing it well)
- "Repin LIN-1149 as \"search is never in `.nav-actions`\", and update llms.txt and the CSS comments." (test of the asked change, plus text the move makes stale)
- "Triage has to decide one thing: keep the toggle, or show the input all the time. Once search lives in the page there's little space left to save, an always-visible input matches Swipe, and `/` can just focus it. That choice sets how much of `search.spec.js` changes." (Borderline: the comment leans towards an always-visible input and a `/` change. I ruled it part of the asked change. It is framed as a choice between two forms of the asked placement, and it is left to triage. The `/` behaviour follows from that choice; it is not a separate improvement. It brings in no shared helper, consolidation or work on other pages.)

### Not this task's to carry, per the comment (listed, not disqualifying)
- "(a) A shared page-controls slot under `renderPageHeader`. Swipe's filter bar, the custom-prompts toolbar and project search each hand-roll one today."
- "(b) Moving the team selector, the last projects-only filter, out of the nav. That would leave navbar.js with no projects-page branches."

## Conclusion
Neither Survey recommends a tidy, consolidation, rename, shared helper or other change beyond the asked change that this task could carry. Everything under the place Survey's "better, at a cost this task can carry" heading is the asked move done thoroughly: both parts moved, the old emission removed, IDs kept, tests repinned, stale docs updated, plus one form choice left to triage. The task Survey's do-first steps only confirm and decide the asked change. The two `!isLanding` guards keep existing behaviour through the move, so they are risks to the asked change, not new guards. Three bigger moves are mentioned, and each comment marks them as not this task's: the team selector or filter, which appears in both Surveys, and a shared page-controls slot.

VERDICT: qualifies
