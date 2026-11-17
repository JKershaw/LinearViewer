# What this stage really wrote

## Comment on LIN-4464 at 16:49:08

## Close-out — LIN-4464

**Merged:** PR #2430, merge commit `2aab32bf0`, pinned to head `17900065c` with `--match-head-commit`. Docs only: three new files under `docs/plans/survey/` (the `llm-and-prompts` and `front-end-pages` reports at `e8e92d50a`, and the adoption addendum). Review's account of how this meets the ask stands: both areas read at one base with the frozen kit (`cbec2d848`) and reader prompt (`ef1c2ca91`), contamination notes and open-PR list in both reports, no piece 1–6 on main, no Waiting entry retired. This is a docs-only change with no deploy, so there were no post-deploy steps. I checked the landed content on `origin/main`: all three files are present, the diff from `0092d8d9e` is those three files only (367 insertions), and both fixes are in the text.

### Changes I made (review's fixes, on the PR branch)
- `8237ec317`, answers review fix 1: the LLM report's "Control moved" bullet now names `lib/render-proxy.js` (#2424, LIN-4457), `lib/render-swipe.js` and `lib/render-task-page.js` (#2423, LIN-4446), and the control note's move from `971d4bf6c` to `ae9c007e1` (14 to 12 Waiting entries). It keeps the addendum pointer.
- `8237ec317`, answers review fix 2: a dated "At merge (2026-11-13)" line in adoption section 3 and in the LLM report's `Open PRs` bullet. The "when checked" wording is untouched. It records #2427 merged (`192e1f81f`; LLM note `b6b4c726d` to `eb976276d`, +5 lines, so the after-read must report note movement), and #2428 (`0092d8d9e`) touching neither note nor a sampled file.
- `bc89fb61e`: my own wording error ("twelve" other open PRs, should be eleven).
- `17900065c`: the open-PR refresh found two PRs opened after the baseline check, now recorded. **#2432 (LIN-4459) is open and touches the sampled file `lib/openrouter.js` and the LLM note.** It has not merged, so the baseline holds, but if it merges before the after-read, that file's blob and the note move and the after-read must account for both. #2429 (LIN-4451) adds 6 lines to the control note `front-end-pages.md` and is also open. #2431 (LIN-4471) touches neither note nor a sampled file.

No blind-read fixes were applied (see below).

### Ledger
- **Nothing from pieces 1–6 lands before this merges (inside):** immediately before the merge, `git log origin/main --oneline -E --grep='LIN-44(6[5-9]|70)'` was empty. `git diff --name-only e8e92d50a origin/main` (28 files) met none of the 28 sampled paths. I extracted the sample from the reports' rank tables, 28 paths, and compared. Main was `0092d8d9e`.
- **Open-PR and contamination record accurate at merge (inside):** done by fixes 1 and 2 above, with `gh pr list --state open` re-run and every file list checked against the 28 paths and both notes. Re-run again right before the merge: the open set was unchanged from the one recorded.
- **Frozen prompt, tool-call check, Pass B grep, possible `CLAUDE.md` exposure (inside):** discharged as recorded by review. Transcripts are not committed, so they cannot be re-run. The reports are the record, as in #2422.
- **Outside, the method spread over three files:** review judged it outside, not a ticket (it breaks nothing today), and the builder's Leftovers put it in this summary because those paths map to no area note. For John: the area-read method now lives in the frozen kit `docs/plans/survey/area-read.md`, `area-read-method-as-run.md` and `area-read-adoption-e8e92d50a.md`. A third read would need a third addendum. A kit that takes base, area, N and salt as inputs would fix it; it is outside this task. No ticket filed, no Waiting entry written (no area owns these files).
- No named monitor or rollback applied. The ledger had none.

### Blind read
Its "worse" verdict compared the branch with `0092d8d9e`, a later diverged main, so it describes #2427's (LIN-4455) merged code changes, not this docs-only PR (3 files, +358 −0 at `444b58246`). I applied none of its code fixes. Its finds about `lib/dispatch-store.js`, `lib/dispatch-leftover.js` and the feedback-kinds table concern LIN-4455's work and belong to that ticket's own review. I filed nothing from it.

### Final CI
`CI success` and all seven jobs (Unit tests, Unit tests proxy clock +400d, E2E 1–4, Secret scan) green on the final head `17900065c`, run 43465388521. CI exists on this repo, so no substitute was needed.

### Close-out housekeeping
Set to Done. Archive: `GET /issues/LIN-4464/brief?noRefresh=1`, then `/snapshots`, which shows a snapshot (captured 16:32:38) whose description equals the live one. The description holds only the `## As asked` block and `## Size of the move`, with no plan, research or design sections, so there was no discharged artifact to prune. I added a short stub under its own heading and left both existing sections as they were. Related tickets: parent LIN-4448 and siblings LIN-4465 to LIN-4470 are unsettled by this work and stay as they are.

## Added to LIN-4464 description after the 16:32:38 snapshot (live description)

## Implemented

PR #2430 merged at `2aab32bf0` (docs only): the paired baseline area reads for `llm-and-prompts` and `front-end-pages` at `e8e92d50a`, with an adoption addendum. Implemented as asked; the one deviation from the ask's wording is that the base is `e8e92d50a` (after `5dcf5bcda`, as the ask allows). The full history is preserved in the task snapshots and the comment trail.

LIN-4464 set to Done (completedAt 16:49:08.269Z).
