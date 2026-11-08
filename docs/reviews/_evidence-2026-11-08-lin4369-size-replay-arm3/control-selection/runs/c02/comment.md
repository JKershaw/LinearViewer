## Survey global: LIN-1512 @ 921abf747

**Where it lands.** Projects-page search is owned by the shared nav, not the page. `lib/components/navbar.js` emits it through two of its three `currentPage === 'projects'` branches. The toggle sits in `.nav-actions`, above the view tab strip, which is why it reads as "above the nav" on mobile. The panel is appended after the nav, between the sticky nav and the `<h1>`. The title comes from `renderPageHeader` (`lib/render.js:196`). `initSearch()` in `public/app.js` finds everything by selector, so moving the markup doesn't affect it. This area is improving: LIN-978, 1058, 1088 and 1149 tidied the nav, and LIN-462 gave headers a shared component. Swipe already puts its page-local control (`.swipe-filter-bar`) directly under `renderPageHeader`, so the requested shape exists. The ticket points at something deeper: shared chrome carrying one page's controls.

**Done the obvious way** (move the panel string from navbar.js to after the header in render.js):
- Moving only the panel leaves the toggle in the nav, wired to markup in another file. That splits the feature and misses the ask.
- Moving the toggle as well breaks two of the three LIN-1149 tests in `tests/e2e/header-nav.spec.js`, because they assert `.search-toggle` is in `.nav-actions`. The third ("no search leak") then passes without testing anything.
- `initSearch()` returns early without an error if `.search-toggle` is missing. An always-visible input without a toggle means reworking `tests/e2e/search.spec.js`. Every test there clicks the toggle, so a quiet failure would be caught.
- `renderPage` still renders `isLanding` previews (`server.js:952/974/993`). The nav kept search off those for free. In render.js it needs its own `!isLanding` gate, and I found no test for that.
- Text that would go stale with no test noticing: `public/llms.txt` lines 99–100 ("in nav bar", "below nav bar") and line 393, the `.search-panel` comment in `public/style.css`, and the navbar.js LIN-1149 comment and JSDoc.
- Risk of a second copy: a render.js version beside a dead navbar branch, or a new toolbar style next to Swipe's.

**Better, at a cost this task can carry.** Move both toggle and panel into the projects page, under the header. Delete the nav's search branches. Keep `#search-input`, `#search-clear`, `#search-no-results` and `[data-search-text]` unchanged, because llms.txt promises them to agents. Repin LIN-1149 as "search is never in `.nav-actions`", and update llms.txt and the CSS comments. Triage has to decide one thing: keep the toggle, or show the input all the time. Once search lives in the page there's little space left to save, an always-visible input matches Swipe, and `/` can just focus it. That choice sets how much of `search.spec.js` changes.

**Better still, not this task's.**
- (a) A shared page-controls slot under `renderPageHeader`. Swipe's filter bar, the custom-prompts toolbar and project search each hand-roll one today.
- (b) Moving the team selector, the last projects-only filter, out of the nav. That would leave navbar.js with no projects-page branches.
