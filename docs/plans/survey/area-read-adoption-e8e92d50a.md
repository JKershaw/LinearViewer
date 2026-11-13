# Area read: adoption at `e8e92d50a` (LIN-4464, piece 0 of LIN-4448)

This file records how the kit is adopted for the baseline pair `llm-and-prompts` (LLM & prompts, the work area) and `front-end-pages` (the control), at base `e8e92d50a`. It is an addendum, not an edit. The kit ([area-read.md](area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the reader prompt ([area-read-reader-prompt.md](area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`) are unchanged at this base. Both blob SHAs were checked at `e8e92d50a` before any reader ran.

The baseline reports are [llm-and-prompts-e8e92d50a.md](area-read-reports/llm-and-prompts-e8e92d50a.md) and [front-end-pages-e8e92d50a.md](area-read-reports/front-end-pages-e8e92d50a.md). Both cite this file.

## 1. Adoption fields

| Field | Value |
| --- | --- |
| Base commit | `e8e92d50a` (`origin/main` at the time of the run; no commit after it on main when checked) |
| Work area | LLM & prompts (`llm-and-prompts`) |
| Control | Front end: server-rendered pages (`front-end-pages`) |
| Target | LIN-4448 (LLM & prompts, left simpler) |
| Verdict mapping (for the after-read, not this baseline) | `D = Δ(llm-and-prompts) − Δ(front-end-pages)`, with the kit's thresholds (D ≥ +0.5 better, D ≤ −0.5 worse, otherwise no detectable difference) and the noise guard. This baseline fixes the "before" scores only; it has no Δ. |
| `docs/areas/areas.json` blob | `1dc2ba701` |
| Sample size N | 14 per area, the kit's frozen N |
| Reader passes | four counted passes, two per area, each a fresh general-purpose agent, launched in one batch |

The brief for this task named the same base, and the base includes the #2424 change (LIN-4457) that the ticket asked to be inside the baseline (`5dcf5bcda`), and the #2423 and #2425 changes.

## 2. What differs from the kit, and why

The kit is frozen and is not edited. These are the differences this adoption carries, recorded here so the reports can cite them.

1. **Base.** The kit's table is pinned to `4b5001ddf`. This adoption uses `e8e92d50a`, as the brief asks, so the control read and the work-area read share one commit. Both areas are read at this one base.
2. **Area.** The kit's `{AREA}` line and its report headings name Runs & dispatch. The reader prompt's `{AREA}` line is filled with `LLM & prompts` or `Front end: server-rendered pages`, the names in `areas.json`. Nothing else in the prompt changed.
3. **Byte imbalance.** The kit chose N = 14 to balance Runs (199,552 B) against the control (206,530 B at `4b5001ddf`). Here the balance is much worse. The LLM sample is **380,459 B** (14 of 91 files) and the control sample is **206,545 B** (14 of 92 files), a ratio of 1.84×. N is frozen, so it stays at 14. The imbalance is recorded as a limit, not corrected.
4. **Concentration.** `lib/openrouter.js` (103,188 B, rank 1) and `lib/prompt-template-defs.js` (120,531 B, rank 5) make up 223,719 B, **59%** of the LLM sample. The reader bundle is about 396 KB, nearly twice the 211–213 KB bundles the kit's readers received. Each reader scores these two files for most of the code score.
5. **Limits flip.** The kit's limit 1 says the sample barely sees the planned work. Here it does: all three files the plan names for this area are in the sample (`lib/openrouter.js` at rank 1, `lib/prompt-template-defs.js` at rank 5, `lib/recommendation-live-wait.js` at rank 8). The kit's limit 2 (most of the move is outside the area) does not apply to this area, which is where the move is. The limit that does apply is concentration (item 4): a read that moves may move because two files moved, not because the area as a whole did.
6. **Control movement.** The kit's control is at `4b5001ddf`. Since then, three control sample files changed (verdict 4 flags the control for this):

   | Path | Blob at `4b5001ddf` | Blob at `e8e92d50a` | Change |
   | --- | --- | --- | --- |
   | `lib/render-proxy.js` | `1163626c3` | `b66ee3624` | #2424 (LIN-4457), two `aria-label`s |
   | `lib/render-swipe.js` | `32aefe9f0` | `c8b9e1744` | #2423 (LIN-4446) |
   | `lib/render-task-page.js` | `e5e1626cc` | `06654bb14` | #2423 (LIN-4446); one of the kit's four tracked files |

   The control note also moved: `front-end-pages.md` is 5,825 B (blob `ae9c007e1`), down from 6,404 B (blob `971d4bf6c`), and its Waiting entries fell from 14 to 12. All of this change sits inside the baseline, since both reads are at `e8e92d50a`. The control's read is therefore not the one LIN-4453 took at `4b5001ddf`.
7. **The four tracked files.** Of the kit's four tracked files, `lib/render-task-timeline.js` (`1f26d9308`), `lib/render-run-evidence.js` (`29ea01bd2`) and `lib/render-session.js` (`05fafa3d2`) are unchanged since `4b5001ddf`. `lib/render-task-page.js` changed (item 6). `lib/render-session.js` is in the control sample; the other tracked files are not in it.
8. **Importers of `lib/openrouter.js` in the control.** Piece 1 changes `lib/openrouter.js`, so the control files that import it are the control's exposure to that change. Six are not sampled; their blobs are recorded so that the after-read can see whether they changed. One control file that imports it is sampled: `lib/render-settings-you.js` (`159262e5b`).

   | Unsampled control file | Blob at `e8e92d50a` |
   | --- | --- |
   | `lib/render-settings-models.js` | `3d9826e5d` |
   | `lib/render-roadmap.js` | `8b8fd2a31` |
   | `lib/components/model-change-lines.js` | `45922afce` |
   | `lib/render-settings.js` | `2b8937c06` |
   | `lib/render-landing.js` | `69cf14f6e` |
   | `lib/components/decision-panel.js` | `f947939aa` |

9. **Note facts.** The guard's own counting (`lessonsBytes` and the Waiting count in `tests/unit/area-notes.test.js`, run at `e8e92d50a`) gives:
   - LLM & prompts: note blob `b6b4c726d`, 14,838 B, Lessons **3,960 B**, **25** Waiting entries. The brief's figure of 26 is out of date; #2421 removed one.
   - Front end: server-rendered pages: note blob `ae9c007e1`, 5,825 B, Lessons **1,023 B**, **12** Waiting entries.

   The kit's own Lessons figures are for its pair at `4b5001ddf` (front end 1,012 B, Runs 4,257 B) and came from a different section boundary; the guard gives 1,023 B and 4,268 B for those (method-as-run addendum, section 7). Only the guard's counting is used here, and the kit has no figure for LLM & prompts.

## 3. Open pull requests, checked against both samples and both notes

Fourteen pull requests were open when checked (`gh pr list --state open`): #2429, #2428, #2427, #2344, #2185, #1809, #1768, #1490, #1337, #1122, #1099, #1074, #963 and #895. #2426 (LIN-4456) is merged and is the base.

Each open PR's file list (from `gh pr view`) was checked against the 28 sampled paths and against the two notes, `docs/areas/llm-and-prompts.md` and `docs/areas/front-end-pages.md`:

- **No open PR touches any sampled file** in either area.
- **#2427 (LIN-4455) touches the LLM note**, `docs/areas/llm-and-prompts.md` (+5 lines). The note is scored apart from the code, so this matters: the note in the baseline is blob `b6b4c726d` and does not include #2427's five lines. If #2427 merges before the after-read, the note moves, and the after-read reports that movement as note change, not code change.
- The other thirteen open PRs touch neither note.

The check reads each PR's file list as `gh` reports it. It does not inspect diffs.

**At merge (2026-11-13).** Re-checked against `origin/main` `0092d8d9e` and the open PR list immediately before merging:

- #2427 (LIN-4455) has merged (`192e1f81f`). The LLM note on main is now blob `eb976276d` (+5 lines, 172 to 177); the baseline stays `b6b4c726d`. The after-read reports that difference as note movement.
- #2428 (LIN-4456, `0092d8d9e`) touched neither note nor any sampled file.
- No sampled file changed between `e8e92d50a` and `0092d8d9e`: `git diff --name-only e8e92d50a origin/main` meets none of the 28 sampled paths. The control note is still blob `ae9c007e1`.
- No LIN-4465 to LIN-4470 commit is on `origin/main`.
- Open PRs now: #2431 (LIN-4471, opened after the baseline check) touches no sampled file and neither note. #2429 (LIN-4451) touches no sampled file but adds 6 lines to the control note `docs/areas/front-end-pages.md`; if it merges before the after-read, the control note moves and the after-read reports that as note change. The other eleven open PRs (besides this one) touch neither note nor any sampled file.

## 4. Where the planned work is and is not

Nothing from pieces 1 to 6 has landed. `git log e8e92d50a..origin/main` is empty when checked. The baseline therefore reads the area as it stands before any piece.

## 5. Reader passes and the contamination check

- Four counted readers, two per area, each a fresh general-purpose agent with the default toolset, launched in one batch. No model override. No `SendMessage` or resume.
- Each reader's whole instruction was the frozen prompt with the `{AREA}` line filled, followed by the one appended line from the method-as-run addendum, section 1, pointing at that area's `inputs.md`.
- The `inputs.md` bundles were built from the git object store at `e8e92d50a` (`git show e8e92d50a:<path>`), note first, then each sampled file in path order, headed by its path. Sizes: LLM bundle 395,903 B; control bundle 212,888 B.
- The contamination check is in each report's body. Every tool call of every counted reader was a Read of that reader's own bundle, except one: Front-end pass B ran a Bash `grep -n "^=== "` on its own bundle, which the kit's "Read only" wording does not allow. It read only the header lines of its own bundle. It is counted, and the deviation is recorded in the control report. The LLM readers and Front-end pass A made no such call.
- Limit: the readers run in the repository's working directory, and a general-purpose agent may load the repository's `CLAUDE.md` into its context by default. The prompt forbids the reader from using anything except the inputs file, and the check below verifies the tool calls, but it cannot see what the harness loaded into context before the first call. The method-as-run addendum recorded the same condition for the Runs baseline.
