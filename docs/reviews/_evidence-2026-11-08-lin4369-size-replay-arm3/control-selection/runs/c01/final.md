I wrote the survey comment for LIN-1512 to `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/c01/output/comment.md` (489 words, under the 500 limit). I read the code at 921abf747 and changed nothing; `code/` is clean.

**The code change itself is small.** The search toggle and panel are produced in `lib/components/navbar.js`, and only on the projects page. The script that runs search (`initSearch` in `public/app.js`) finds its elements by class and id, so the markup can move to just after the page title in `lib/render.js` without touching the script.

**What makes it hard:**
- **The request has two readings.** Either move the existing toggle below the title, or replace it with a search box that is always shown there.
- **Search stops being reachable while scrolling.** Today it sits in the sticky header. Below the title it scrolls away, and the `/` keyboard shortcut doesn't help the reporter, who is on an Android phone.
- **It reverses a deliberate decision.** LIN-1149 fixed search's place in the nav bar's action area. Tests depend on it in `tests/e2e/header-nav.spec.js` and `tests/e2e/search.spec.js`, and those would need rewriting.
- **Layout and docs follow on.** The page title is centred but the search panel is left-aligned. The mobile sticky-header height (`--nav-sticky-h`) was measured with search in the header and needs measuring again. `public/llms.txt` describes search as being in the nav bar.

**Is it a symptom of something deeper?** Partly. The nav bar mixes controls for every page with ones that only make sense on the projects page; the team filter is the other example. I flagged that but suggested keeping this ticket to search.

**What I'd do first:** take a phone-width screenshot to confirm which element the reporter meant. Then choose between the two readings and decide whether losing access while scrolling is acceptable. After that it is about one pull request.

DONE: Wrote the LIN-1512 survey: a small change, but it needs a triage decision first and reverses LIN-1149's nav placement
