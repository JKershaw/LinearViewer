# 10-blind-read notes

**Written:** run-171 (ended done); verdict-172 (blind-read, better, `on` change-142@3, `about` area-1, task-108). Findings to close-out (PR #2447, before merge): 173 (`<= 1` in folds test), 174 (`committedSearch` + `.slice(0,-1)`, about finding-40), 175 (lin-4313 header, about finding-166), 176 (source-map "imports nothing", about finding-153, lesson-10). To area-1: 177 (stage-kinds `intent: null` mutated, about finding-25), 179 (trim witness table hashes, about decision-163, lesson-164). To area-65: 178 (completion-signals dead exports), 180 (`STEP_KIND_WORDS`, about finding-25). Nothing ended or handed on: I closed nothing.

**Looked up:** `show --task task-131` (what is open, change-142's head); `find` for verdicts (any earlier blind-read verdict), changes (no record for #2444), and text searches on each finding's subject to avoid duplicates. Found finding-166, finding-153, finding-40, finding-25, decision-163/lesson-164 and linked rather than rewrote.

**Refusal:** `{"refused":"a verdict takes no to"}`. Dropped `to` from the verdict and rewrote it at the same time.

**Relied on outside brief/queries:** the PR diffs themselves (#2444 and #2447, both base/head shas), the code at `877f32cb4` (line ~991, the six unused exports, `stageLabel` vs `stepKindWord`), and the 106-line witness churn. None of that is in the store.

**Brief carried that I didn't need:** almost all of it. The ask, plan piece, breakdown decisions, rulings, budget condition and the close-out fixes. A blind reader shouldn't use them.

**Couldn't place:** decision-163 had already settled "keep the witness" 6 minutes before my read. My real output reopened it, so I narrowed 179 to the table hashes. There's no change record for #2444 to rest the verdict on.
