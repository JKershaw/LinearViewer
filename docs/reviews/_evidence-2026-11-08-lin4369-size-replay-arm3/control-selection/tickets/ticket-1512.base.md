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
