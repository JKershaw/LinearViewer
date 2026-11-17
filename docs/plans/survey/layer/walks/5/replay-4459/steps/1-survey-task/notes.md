# Notes: 1-survey-task (task-113, LIN-4459)

**Written** (16:23:19–16:23:32): run-123 (ended `done`). decision-124: grounding is now 0092d8d9e. It supersedes decision-114. decision-125: the Waiting entry to settle is the runFact one, `about` finding-28. It supersedes decision-118. All of these to implementation: finding-126 (the helpers are async, walk up and sit in the wrong file), finding-127 (the store's lineage read may already answer it, with a possible change of course on LIN-4447), question-128 (does a held-wake holder share `rootItemId`?), finding-129 (two meanings of pending), finding-130 (import cycle), finding-131 (importer list), finding-132 (census scope), finding-133 (`llm-and-prompts.md:84-86`, `about` finding-64/65). I left finding-28/64/65 open. Implementation closes them, not the survey.

**Looked up:** `show --task task-113`; `find --to survey-task`; questions in task-82; `--text` for live-wait, runFact, "Waiting 14", compare-and-set; `get` on finding-28/65, decision-114/118, lesson-6. I did this to link to existing findings instead of repeating them, and to see which breakdown decisions the moved ground corrects.

**Refusals:** none.

**What my real output relied on that the brief and queries didn't give:** the whole repo at 0092d8d9e. That covers the commit count and file count, line numbers in `dispatch-store.js` (3230, 3437, ~2120) and in the area notes (:89, :84-86), and the 5,195-byte Lessons size. It also covers `deriveLineageFields`, `wireStatusOf`, `derivePendingPark`, LIN-2122, the importers and tests that really exist, and changelog line 188. The store has no code facts.

**What the brief carried that I didn't need:** decision-119's correction table, decisions 120–122 (John's rulings), lesson-11, and most of task-82's `asked`.

**Couldn't place:** "Before starting: ask LIN-4448 again" is still unrecorded, and no record holds it as open.
