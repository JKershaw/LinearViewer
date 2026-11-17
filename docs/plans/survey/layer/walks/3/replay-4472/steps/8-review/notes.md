# 8-review notes (task-28, LIN-4472)

**Written:** run-108 (ended done); finding-109 F1, finding-110 F2, finding-111 F3 (all to close-out, about change-97); check-112 non-Chromium browsers and check-113 deployed owner + guest page (both to John); verdict-114 (review, approve-with-notes, on change-97@2, about plan-10).
**Ended:** finding-100 handed-on to finding-109; finding-101 done; finding-104 done.

**Looked up:** change-97 (which head it names), findings 100/101/104 and question-84 (to answer or end them); `find --text formatRuntime`, which found finding-99/105 on area-49 (so I filed no sibling finding); open checks, which found check-86 (Chromium e2e, done), so my checks cover only what it did not.

**Refusal:** `revise change-97 {"head":"ffa70b78…"}` → `{"rule":"6","msg":"review may not revise change-97"}`. Left out. The verdict rests on change-97@2, which still names the old head `a6492a984`. I named the reviewed head in the verdict's reasoning and in finding-104's end reason.

**Relied on, not given by the brief or a query:** the PR itself: diff, golden word-diff, line counts (228/232/218), the run-links test name and `:211–221`/`:10` lines, the PR body text, CI check names, `git log` regression scan, caching headers (`no-store`, ETag), `playwright.config.js` having no `projects`, the 30-suite run and nine mutations. Also that `gapWords`/`describeSpan` are deliberate variants.

**Carried but not needed:** decisions 33–36 and 95; lessons 60, 63, 66; most of verdict-25's reasoning.

**Couldn't place:** "conditional approve" has no outcome; I used approve-with-notes. The real review gave the live checks to close-out; I sent them to John as the brief said.
