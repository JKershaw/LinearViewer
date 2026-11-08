# LIN-1512: Move page search below the title

State: Todo
Labels: none

## Description

## As asked

On this page, "search" should appear below the title, rather than above the nav. It's searching on this page, so the placement feels more natural as part of the page, not nav.

---

* **Page:** `https://harbour.cat/workspace/linearviewer/`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36`

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.

## Comments (oldest first)

### 2026-07-21T08:27:19.664Z (posted with the ticket)

**Triage complete** — metadata only; scope and description left exactly as reported.

**Changes applied**
| Field | Before | After |
|---|---|---|
| State | Backlog | **Todo** (triaged, ready to implement) |
| Project | *(none)* | **UX, Theme** |
| Priority | High | **Medium** |
| Labels | *(none)* | **Improvement**, **small-model-candidate** |
| Assignee | unassigned | unassigned *(no change — no clear owner)* |

**Why priority moved High → Medium:** this arrived straight from the feedback widget at the widget's default priority. It's a genuine, low-risk UX improvement with a small, well-understood fix, but nothing is blocked on it. Medium reflects real urgency without burying it.

**Why `small-model-candidate`:** grounding the report against HEAD shows this is a contained, mechanical change — see below.

**Grounding / staleness check (clean)**
`git log --since=2026-07-21T08:21:53Z` over the relevant paths returns nothing; `lib/components/navbar.js` was last touched 2026-07-08 (`d3983310`, LIN-1149). The report is accurate at HEAD.

Observations only, not new requirements:
- The search toggle (`lib/components/navbar.js:88-90`) and panel (`:93-101`) are both gated on `currentPage === 'projects'`, and `lib/render.js:168` is the **only** caller passing `'projects'` — so despite living in the shared navbar component, this is a **one-page change**. The other 20 `renderNavBar` callers are unaffected.
- Current DOM order is `<nav>` → search panel → `<header><h1>` → `<main>`; the panel is emitted as a sibling right after `</nav>` (`navbar.js:130`).
- CSS (`public/style.css:956-1013`, mobile rule `:1703-1706`) uses no position-dependent selectors, and `public/app.js:1934-1938` binds purely by `id`/`class` — so a DOM move should break neither styling nor behaviour.

**Recommended next action (single):** implement the move — stop emitting `${searchPanel}` from `navbar.js` and render it from `lib/render.js` immediately after `renderPageHeader(...)`.

**One decision to make first:** move *only the panel* below the title and leave the `search` toggle in `.nav-actions`, or move both. Panel-only satisfies the report as written and keeps the nav-order regression test at `tests/e2e/search.spec.js:183-189` (LIN-1149) passing; moving the toggle too would require updating that test. Recommend panel-only. Whoever picks this up should also refresh the now-stale comment at `public/style.css:951` and the `#search-panel` / `.search-toggle` descriptions in `public/llms.txt:99-104`.

### (Survey, survey-task, posted before work began)

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

### (Survey, survey-place, posted before work began)

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
