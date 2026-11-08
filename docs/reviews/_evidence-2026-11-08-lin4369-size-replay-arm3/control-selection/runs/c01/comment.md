## Survey open-0: LIN-1512 @ 921abf747

**Short version:** the code change is small. What makes it hard is that the request is ambiguous, and it reverses a placement that was deliberate and is covered by tests. Triage it before anyone writes code.

**Where search lives now**
- `lib/components/navbar.js` emits both parts of search, only when `currentPage === 'projects'`. The `search` toggle sits in `.nav-actions`, row 1 of the sticky header. The `#search-panel` is a sibling rendered after `<nav>`, so it opens above the `<h1>`.
- On a phone, row 1 (wordmark, workspace, team, search) sits above the view tab strip. That is almost certainly the "above the nav" in the report.
- `public/app.js` `initSearch()` (~L1932) finds its elements by class and id. Moving the markup into `lib/render.js` after `renderPageHeader(...)` (L196) shouldn't need JS changes.

**Why it's harder than it looks**
1. **Two readings.** Either (a) move the toggle and panel below the `<h1>`, or (b) drop the toggle and show the input itself below the title. (b) fits "part of the page" better, but it changes the layout every visitor sees. Someone has to choose.
2. **It costs sticky access.** In the nav, search can be reached from anywhere on a long tree. Below the title it scrolls out of view. The `/` shortcut is desktop-only, and the reporter is on Android. Accept that on purpose.
3. **It reverses LIN-1149 (d398331).** That ticket encoded "search goes in `.nav-actions`, before the queue badge" in the navbar JSDoc and in tests: `tests/e2e/header-nav.spec.js` ~L229–264 and `tests/e2e/search.spec.js` L183. Rewrite them to the new rule rather than deleting them. Keep the "search doesn't appear on other pages" guarantee.
4. **Layout knock-ons.**
   - The global `header` is `text-align: center`, but `.search-panel` is a left-aligned 48ch card. Their alignment needs a decision.
   - The mobile `--nav-sticky-h: 7.75rem` (`public/style.css` ~L1664) was measured against today's row 1. Taking search out may change the header's height and throw off the LIN-984/1058 `scroll-margin-top` clearance. Measure again.
5. **Docs and landing.** `public/llms.txt` (L99–100, L393) says search is in or below the nav bar. The landing page passes `heroHtml` in place of the header, so guard the moved markup on `!isLanding`.

**Is this a symptom?** Partly. The navbar mixes global chrome with controls for one page: the team selector and search are both projects-only special cases in `navbar.js`. The reporter's reasoning ("it searches this page") applies just as well to the team filter. I'd note that in triage but keep this ticket to search.

**What I'd do first**
1. Take a screenshot of the projects page at about 400px width at this commit, to confirm which element the reporter meant.
2. Choose (a) or (b), and record whether losing sticky access is acceptable.
3. Then it's about one PR: move the markup from `navbar.js` to `render.js`, rewrite the LIN-1149 tests, re-measure `--nav-sticky-h`, and update `llms.txt`. If the choice is (b), expect churn across `search.spec.js`, because every test there begins by clicking `.search-toggle`.
