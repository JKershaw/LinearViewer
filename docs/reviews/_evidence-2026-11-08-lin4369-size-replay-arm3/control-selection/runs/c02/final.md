I've written the survey comment for LIN-1512 to `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/c02/output/comment.md` (473 words). I read the code at 921abf747 and changed nothing in `code/`. I didn't run `git fetch` or add the worktree the prompt asks for, because this run has no network and `code/` was already checked out at that commit.

- **Where search lives now:** the shared nav (`lib/components/navbar.js`) renders the projects-page search, in two `currentPage === 'projects'` branches. The page itself doesn't own it. The ticket is a symptom of that: the shared nav carries controls that belong to one page.
- **Precedent:** the Swipe page already puts its own filter control directly under the page header, so the requested layout already exists elsewhere.
- **Done the obvious way:** this breaks two of the three LIN-1149 tests in `tests/e2e/header-nav.spec.js`, which is a useful failure. The third test then passes without testing anything.
  - `initSearch()` in `public/app.js` gives up without an error if the toggle is missing. `tests/e2e/search.spec.js` would still catch that, because every test there clicks the toggle.
  - The search needs its own `!isLanding` gate in `lib/render.js`, because landing previews no longer get that from the nav. I found no test for this.
  - `public/llms.txt` (lines 99–100 and 393) and some CSS and JSDoc comments would go stale, and no test would notice.
- **Recommended:** move both the toggle and the panel into the projects page, under the title, and delete the search branches from the nav. Keep the element IDs unchanged, because llms.txt promises them to agents. Repin the LIN-1149 tests as "search is never in the nav actions", and update llms.txt.
- **Needs a triage decision:** whether to keep a toggle or show the search input all the time. That choice decides how much of `search.spec.js` gets rewritten.
- **Bigger follow-ups, not this ticket:** a shared slot for page controls under the page header, and moving the team selector out of the nav.

DONE: Wrote the LIN-1512 survey to output/comment.md: search is rendered by the shared nav rather than the page; it covers what moving it would break and recommends moving toggle and panel into the page, with a toggle-vs-always-visible call for triage.
