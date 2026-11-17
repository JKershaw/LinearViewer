# Notes: 5-review, task-60

**Written:** run-89 (run, ended done); verdict-90 (review, approve, on change-80@1); check-91 (docblock sentence on unbound release wording, to close-out, on decision-83@1); check-92 (ci-success on exact merge commit, to close-out, on change-80@1); check-93 (Leftovers comment names Waiting 2, 4, 11, to close-out, on decision-65@1); check-94 (post-deploy watch on target-not-resumable, to close-out, on decision-86@1).
**Ended:** finding-88 done; reason says its point (3), the finding-73 docblocks, was not checked.
**Left open:** question-75, change-80.

**Looked up:** `show --task task-60` (full records behind the brief: done-when, findings 70/73, decisions); `get finding-88`, `get change-80` (version to rest the verdict on); `find --kind check`, `--to close-out`, verdicts in task-60, and `--text` for ci-success/Leftovers/erasure, to avoid duplicates. None existed.

**Refusals:** `{"refused": "a verdict needs an on link"}`: I had planned to link afterwards. Re-added with `links.on` in the JSON. Then `{"refused": "no record verdict-90"}` for the follow-up link, which followed from the first refusal. Reused those timestamps.

**Relied on, not in brief or store:** the PR diff and CI checks (8 checks, base c205190fd); current origin/main 5dcf5bcda and the local merge and unit run; the mutation results; `git log -30`; `lib/account-erasure.js:590` building a bare store; `UNBOUND_HELD_WAKE_RELEASE_NOTE` and the docblock paragraph; `producingRowIneligibility` and its log line; LIN-3677; Lessons byte count; the missing Leftovers comment on LIN-4455; the note at 4b5001ddf.

**Carried, not needed:** decisions 61-64 (staleness, session fit, blocking graph); lessons 3 and 4; part 1's full task-39 text.

**Couldn't place:** a "conditional approve". The outcomes are only approve, approve-with-notes and request-changes, so I recorded approve with the condition in the reasoning and checks.
