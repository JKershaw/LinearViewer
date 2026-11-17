# What this stage really wrote

## Comment on LIN-4464 at 16:28:18

## Review — LIN-4464

PR #2430, head `444b58246f37ce4796b181e9b0e21843fce29eee` (2 commits on `e8e92d50a`; adds 3 files, all under `docs/plans/survey/`, all docs).

CI: green on head `444b58246`. `CI success` and all seven jobs pass (Unit, Unit proxy +400d, E2E 1–4, Secret scan). The PR is MERGEABLE.

### What I checked again myself
- **Frozen kit.** At `e8e92d50a` and at current main, `area-read.md` is blob `cbec2d848` and `area-read-reader-prompt.md` is blob `ef1c2ca91`. The PR edits neither file. The differences for this read sit in a separate addendum, `area-read-adoption-e8e92d50a.md`.
- **Samples.** I ran the kit's snippet unchanged at `e8e92d50a`. llm-and-prompts: 91 files, 14 picked, 380,459 B. front-end-pages: 92 files, 14 picked, 206,545 B. Both lists match the reports path for path and byte for byte. `lib/openrouter.js` (rank 1), `lib/prompt-template-defs.js` (rank 5) and `lib/recommendation-live-wait.js` (rank 8) are in the sample, as the ask expects.
- **Recorded blobs.** The notes match the reports: `b6b4c726d` (LLM) and `ae9c007e1` (control). `areas.json` is `1dc2ba701`. The control-movement table checks out: `render-proxy` `1163626c3→b66ee3624`, `render-swipe` `32aefe9f0→c8b9e1744`, `render-task-page` `e5e1626cc→06654bb14`.
- **Importers of `lib/openrouter.js` in the control.** The six unsampled files plus `render-settings-you` are the complete set. `render-pages.js` and `settings-areas.js` only mention `/auth/openrouter` routes in strings and don't import the module.
- **Pieces 1–6 (LIN-4465…4470).** None of them has a commit on `origin/main`. None of the 28 sampled files changed between `e8e92d50a` and current main.
- **Regression check.** All three files are new; `git log` on those paths is empty. Nothing in the PR was reverted earlier or fixed before.
- **Area notes.** The PR paths are unmapped in `areas.json`. None of the `docs/areas/llm-and-prompts.md` Lessons covers a docs-only survey record. The builder rightly left both measured notes unedited, since an edit would move the blobs the reports pin.
- **Rulings.** None exist for LIN-4464 (`includeResolved=true`). I raise no `DECISION:`.

### Against the `## As asked` block, sentence by sentence
1. *Baseline read for `llm-and-prompts` before any other piece, with a fresh control read at the same commit.* **Met.** Both areas are read at `e8e92d50a`, and no piece has landed.
2. *Use the LIN-4453 kit and frozen prompt unchanged, with #2422 as the model.* **Met.** The blobs are unchanged and the adoption addendum holds the differences. The report layout mirrors #2422.
3. *One base commit, recorded in each report. The old table can't be reused.* **Met.** `e8e92d50a` appears in both reports' Recorded fields, and both samples were re-drawn.
4. *Control contamination from #2424. Take the base at or after `5dcf5bcda` and record it.* **Met.** `e8e92d50a` comes after `5dcf5bcda`, and the record goes further: #2423's two files and the control note's change are recorded too.
5. *List the open PRs touching either sample, check #2427 and #2426, and record the hash sample including the three planned files.* **Met.** The reports list 14 open PRs and record that none touches a sample. #2426 is the base itself, and #2427 touches the LLM note only. The sample tables carry blobs. The list goes stale at merge; see ledger item 2.
6. *Testing: the kit's own checks. Docs-only PR.* **Met.** Noise guard, contamination check and blob pins are all done, and the PR is docs only.
7. *Acceptance: two reports at the same base, made with the frozen prompt.* **Met.**
8. *Acceptance: the contamination notes and the open-PR list are in both reports.* **Met in part.** The open-PR list is in both. The LLM report only says the control "moved" and points to the other files. It doesn't name #2424, #2423 or the three files. Fix 1 closes that gap.
9. *Acceptance: nothing from pieces 1–6 lands before this merges.* **True now.** It has to hold until the merge; see ledger item 1.
10. *Retires: no Waiting entry.* **Met.** The Leftovers `Retires:` line says none and explains why. The diff removes no entry, which matches.

### Isolated, or one of a class?
The class is how the area-read method is written down. Two reads have now been done, and the method lives in three files: the kit, `area-read-method-as-run.md` and `area-read-adoption-e8e92d50a.md`. This is **outside** the ticket. The ask holds the kit frozen, and the Survey global ruled a reusable kit out of this task. It breaks nothing today, so it is not a ticket. The builder's Leftovers already put it in the summary comment for John, because these paths map to no area note. I agree with that. Apart from this, the change is isolated.

### Test quality
This is a docs-only record, so there is no code path to mutation-check. The evidence that counts is that the numbers can be reproduced: the samples, byte totals and blobs. I re-ran all of those myself, and they match.

### Fixes for close-out (make before merging)
1. **`docs/plans/survey/area-read-reports/llm-and-prompts-e8e92d50a.md`, section `## Control and contamination`, bullet "Control moved."** Name the moves the bullet refers to: `lib/render-proxy.js` (#2424, LIN-4457), and `lib/render-swipe.js` and `lib/render-task-page.js` (#2423, LIN-4446). Also name the control note going from `971d4bf6c` to `ae9c007e1` (12 Waiting entries, down from 14). Keep the pointer to the addendum. This meets acceptance sentence 8 word for word.
2. **The "when checked" statements are now stale.** Both reports and the addendum (sections 1, 3 and 4) say nothing is after `e8e92d50a` on main and that #2427 is open. Since then, #2427 (LIN-4455, merge `192e1f81f`) and #2428 (LIN-4456, `0092d8d9e`) have merged. Leave the "when checked" wording as it is. Add one dated "At merge" line to addendum section 3, and the same line to the `Open PRs` bullet in the LLM report. The line should say:
   - #2427 has merged, so the LLM note on main is now blob `eb976276d` (+5 lines) while the baseline stays `b6b4c726d`. The after-read reports that difference as note movement.
   - #2428 touched neither note nor any sampled file.
   - No sampled file changed between `e8e92d50a` and the merge commit.

   Re-check those facts at the moment of merging.

### What CI Did Not Prove
- **Inside** (acceptance sentence 9, "nothing from pieces 1–6 has landed before this merges"). **Before the merge:** right before merging, `git log origin/main --oneline -E --grep='LIN-44(6[5-9]|70)'` is empty, and `git diff --name-only e8e92d50a origin/main` meets none of the 28 sampled paths. Either one being non-empty means the baseline is no longer "before". Stop and raise it on LIN-4448.
- **Inside** (acceptance sentence 5/8, the open-PR and contamination record). The record must be accurate when it merges. **Before the merge:** make fixes 1 and 2, re-running `gh pr list --state open` and checking each PR's file list against the 28 paths and both notes.
- **Inside** (acceptance sentence 7, "made with the frozen prompt"). The reader transcripts aren't committed, so CI can't show that the four passes got exactly the frozen prompt with only `{AREA}` filled, or that the tool-call check was right. Review can't re-run them either, since a fresh pass is a new read and not a reproduction. This matches #2422's precedent: the reports are the record. **Discharged** as recorded: the builder's contamination tables and the verbatim pass outputs are in both reports.
- **Inside** (frozen method's clean-pass check). Front-end Pass B made one Bash `grep -n "^=== "` on its own inputs file. The as-run addendum's check lists Bash as not allowed. The report records the deviation openly. The grep read nothing outside the bundle, and Pass B's scores equal Pass A's (3.3 / 3.5), so leaving it out would not change the control's baseline. **Discharged** as recorded; I agree with counting it. The after-read should keep readers to Read only, as the report already says.
- **Inside** (known limit carried from #2422). Readers may have loaded the repository's `CLAUDE.md` into context before their first tool call, and the tool-call check can't see that. **Discharged** as recorded in the addendum's section 5. It affects the before and after reads alike, so Δ survives it.

### Verdict
Approve — conditional on close-out discharging the ledger

Close-out makes fixes 1 and 2 on the PR branch, runs the pre-merge check for pieces 1–6 and the sampled paths, and confirms `ci-success` is green on the final commit before merging. Next action: `close-out`.
