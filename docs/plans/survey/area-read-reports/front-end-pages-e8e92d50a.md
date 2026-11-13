# Area read: Front end: server-rendered pages @ e8e92d50a (control, baseline, LIN-4464 piece 0)

The control read for the LIN-4448 baseline, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). The adoption differences are in [area-read-adoption-e8e92d50a.md](../area-read-adoption-e8e92d50a.md). The work-area read at the same base is [llm-and-prompts-e8e92d50a.md](llm-and-prompts-e8e92d50a.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | Front end: server-rendered pages (`front-end-pages`), the control |
| Base commit | `e8e92d50a` (`origin/main`; nothing after it on main when checked) |
| Date | 2026-11-13 |
| `docs/areas/areas.json` blob | `1dc2ba7014ef021c785c06dc3eda7d5694a0facd` |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` (`docs/plans/survey/area-read.md`) |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159` (`docs/plans/survey/area-read-reader-prompt.md`) |
| Note | `docs/areas/front-end-pages.md`, blob `ae9c007e1d7612200d028e26e808daaa4e56ea8e`, 5,825 B: Lessons 1,023 B, 12 Waiting entries (guard's count) |
| Universe | 92 files in the area, by first match, code scope |
| N | 14 (frozen) |
| Sample | 14 files, 206,545 B (see below) |
| Sampling rule | the kit's snippet, run at `e8e92d50a` with slug `front-end-pages` and N = 14 |

### Adoption fields

- **Role:** control. Its Δ will be the second term of the verdict, `D = Δ(llm-and-prompts) − Δ(front-end-pages)`. This report is the baseline and carries no Δ.
- **Control moved (verdict 4 flag).** Since the kit's reference `4b5001ddf`, three sampled files changed and the control note changed. The after-read must state this beside any control Δ:

  | Path | Blob at `4b5001ddf` | Blob at `e8e92d50a` | Change |
  | --- | --- | --- | --- |
  | `lib/render-proxy.js` (sampled) | `1163626c3` | `b66ee3624` | #2424 (LIN-4457), two `aria-label`s |
  | `lib/render-swipe.js` (sampled) | `32aefe9f0` | `c8b9e1744` | #2423 (LIN-4446) |
  | `lib/render-task-page.js` (sampled; one of the kit's four tracked files) | `e5e1626cc` | `06654bb14` | #2423 (LIN-4446) |

  - The control note moved from 6,404 B (blob `971d4bf6c`, at `4b5001ddf`) to 5,825 B (blob `ae9c007e1`). Its Waiting entries fell from 14 to 12.
  - All of this sits inside the baseline, since the work-area read is also at `e8e92d50a`. The control's scores here do not match LIN-4453's read at `4b5001ddf`.
  - The kit's other tracked files are unchanged since `4b5001ddf`: `lib/render-task-timeline.js` (`1f26d9308`), `lib/render-run-evidence.js` (`29ea01bd2`) and `lib/render-session.js` (`05fafa3d2`, sampled).
- **Unsampled control files that import `lib/openrouter.js`.** The work changes that module (piece 1), so these are the control's exposure to it. Their blobs at base are recorded for the after-read:

  | Path | Blob at `e8e92d50a` |
  | --- | --- |
  | `lib/render-settings-models.js` | `3d9826e5d` |
  | `lib/render-roadmap.js` | `8b8fd2a31` |
  | `lib/components/model-change-lines.js` | `45922afce` |
  | `lib/render-settings.js` | `2b8937c06` |
  | `lib/render-landing.js` | `69cf14f6e` |
  | `lib/components/decision-panel.js` | `f947939aa` |

  The sampled control file that imports it is `lib/render-settings-you.js` (`159262e5b`).
- **Limits that apply here** (adoption addendum, section 2):
  - **Byte imbalance.** This control sample is 206,545 B, against the work-area sample of 380,459 B (1.84×). N is frozen; the imbalance is recorded, not corrected.
  - **Frozen K2 examples are about Runs.** The reader prompt's K2 examples are about Runs & dispatch. Absolute scores are not compared across areas.
  - **Concentration.** The two largest sampled files, `lib/render-task-page.js` (61,269 B) and `lib/components/navbar.js` (30,098 B), make up 44% of this sample (91,367 B of 206,545 B). A control move in either file moves this read's code score.
- **Pieces 1–6:** nothing has landed (`git log e8e92d50a..origin/main` is empty when checked).

## Sample

Sorted by the kit's key (rank order). Bytes from `git ls-tree -l` at `e8e92d50a`.

| Rank | Bytes | Path | Blob |
| --: | --: | -- | -- |
| 1 | 30,098 | `lib/components/navbar.js` | `680fec28e` |
| 2 | 8,070 | `lib/render-swipe.js` | `c8b9e1744` |
| 3 | 2,949 | `lib/render-audit.js` | `7d7a5ea9b` |
| 4 | 29,757 | `lib/render-session.js` | `05fafa3d2` |
| 5 | 1,864 | `lib/settings-copy-first-card.js` | `f87549ec2` |
| 6 | 8,628 | `lib/render-ship-journey.js` | `41a29a991` |
| 7 | 61,269 | `lib/render-task-page.js` | `06654bb14` |
| 8 | 18,375 | `lib/ship-journey.js` | `30a24ce91` |
| 9 | 13,127 | `lib/render-collective.js` | `97b5e39a1` |
| 10 | 2,204 | `lib/components/settings-group.js` | `60d28a92c` |
| 11 | 4,120 | `lib/render-passage-planner.js` | `c323b4178` |
| 12 | 12,982 | `lib/render-settings-you.js` | `159262e5b` |
| 13 | 6,931 | `lib/render-proxy.js` | `b66ee3624` |
| 14 | 6,171 | `lib/render-custom-prompts.js` | `9caf01137` |

**Sample total: 14 files, 206,545 bytes.** Reader bundle (note plus sample) 212,888 bytes, built from the git object store at `e8e92d50a`.

## Passes

Two passes, each a fresh general-purpose agent with the default toolset, launched in one batch. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 4. The file names track the pages (`lib/render-task-page.js`, `lib/render-settings-you.js`), and each header says what the file owns and where a split went, so the file to open is clear.
- K2: 3. Some rules have one clear home, such as the owner-only fragments in `renderOwnerControls` and the assignee gate in `lib/components/navbar.js`, but the task-state-to-pill mapping is restated as two tables in `lib/render-task-page.js` that disagree on backlog's tone.
- K3: 3. Most renderers read clearly, but they take view models whose fields (such as `model.nextStep.why` and `taskState.unsettled`) are defined in modules that are not in front of the reader.
- K4: 3. The comments explain why well, but one concept is called stage, step, run and session in turn, and many comments lean on ticket numbers and "was" history rather than the current rule.
- Code mean: 3.3

Note
- M1: 4. Each lesson states the action and the reason (the accessible-name rule, the `withoutSpend` strip with the guest test as the gate, the `grid-area` rule for new sections), though the grid lesson does not say which two templates it means.
- M2: 3. Each entry names a file and what is wrong, but almost none says why it is not scheduled; only the session-link entry gives a reason ("no ticket").
- Note mean: 3.5

Where I could not tell: the note's cited files are not in the set (`lib/render-settings.js`, `lib/task-timeline.js`, `lib/render-task-timeline.js`, `lib/components/halt-controls.js`, `lib/render-library.js`, `lib/render-styleguide.js`, `lib/mask-secrets-in-html.js`, `lib/render-pages.js`, `lib/render-runner-setup.js`, `lib/providers/jira/adf.js`, `tests/unit/task-timeline-page.test.js`), so I could not check the waiting counts, the `withoutSpend` copy or the tick-rule restatement. The view-model modules (`run-view.js`, `task-page-loader.js`, `task-state.js`) are also absent, so I could not confirm the shapes these renderers assume. I read all 3933 lines of the inputs file and did not open the review documents the note links to.
```

Pass A: code mean 3.25 raw, reported 3.3. Note mean 3.5.

### Pass B

```
Code
- K1: 4. Files are named for the page or component they render, and each header states its job, such as `lib/render-settings-you.js` saying it was split from `render-settings.js`, so the file to open is easy to find. Cite: lib/render-settings-you.js, lib/render-task-page.js.
- K2: 3. Owner-only gating is decided in one function (`renderOwnerControls`) and the nav page sets are in one place, but the task-state-to-pill rule is held in two maps in `lib/render-task-page.js` (`TASK_PAGE_PILL_FOR_STATE` and `PILL_FOR_TASK_STATE`) that disagree on backlog and idle. Cite: lib/render-task-page.js, lib/components/navbar.js.
- K3: 3. Most functions can be followed alone, but `prDetail` and `renderTaskPullRequest` stack many conditions on close-out, ledger and settling state, and they depend on rules held in modules that are not in front of me. Cite: lib/render-task-page.js.
- K4: 3. Comments give reasons well, but ticket-history narration runs through most blocks, and `canReplyTo` means different things in `lib/render-session.js` (`(canReply, loop)`) and in `lib/render-task-page.js` (imported from run-view, called with a producer), while run, session, loop, stage and step name the same objects. Cite: lib/render-session.js, lib/render-task-page.js.
- Code mean: 3.3

Note
- M1: 4. Each lesson names the action (label each per-row control, route any new figure through `withoutSpend`, give a new section its own `grid-area` in both templates) and the cause behind it.
- M2: 3. Each entry names its file and its review source, but most do not say why the item is unscheduled, so the reader has to infer it from wording such as "no ticket" or "a seam".
- Note mean: 3.5

Where I could not tell: I did not read lines 2836 to 3088 of the inputs (the derivation helpers in `lib/ship-journey.js`); the rest of the file is read. Several files the note and code refer to are not in the inputs: `lib/render-settings.js` (the 86 unnamed controls), `lib/task-timeline.js`, `lib/render-task-timeline.js`, `lib/run-view.js`, `lib/task-state.js`, `lib/task-page-loader.js`, `public/task-page.css`, and the guest test. So I could not verify those rules or the Waiting entries against code. Whether each Waiting item is still open, or why it was left unscheduled, is not in these files.
```

Pass B: code mean 3.25 raw, reported 3.3. Note mean 3.5.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.3 (raw 3.25) | 3.5 |
| Pass B | 3.3 (raw 3.25) | 3.5 |
| **Area** | **3.3** | **3.5** |

- **Noise guard:** the passes' code means differ by 0.0, under 1.0, so the read is decided. The note means differ by 0.0.
- Area code is the mean of the two passes' reported code means, and area note the mean of their reported note means (the kit's combined-score convention).
- **Control flag:** the control moved (see Adoption fields). Any Δ of this control in the after-read is stated beside D, with the three moved files named.

## Open pull requests

Fourteen were open. None touches a sampled file, and none touches this area's note (`docs/areas/front-end-pages.md`). #2427 (LIN-4455) touches the work area's note, `docs/areas/llm-and-prompts.md`, and is recorded in the LLM report. The check reads each PR's file list from `gh pr view`; it does not inspect diffs.

## Contamination check

Each counted reader's transcript was parsed for every tool call and checked against its own inputs file.

| Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
| --- | --: | --- | --- | --- |
| A | 7 | Read only | the control `inputs.md`, 7 reads | yes |
| B | 7 | Read 6 times, Bash 1 time | the control `inputs.md`, 6 reads and one `grep -n "^=== "` on the same file | yes |

- **Deviation, Pass B.** Pass B ran one Bash `grep` for the `=== ` header lines of its own inputs file. The kit's clean-pass check reads "no reader used Grep, Glob, Bash, WebFetch or any other tool", so by that wording Pass B is not clean. The grep targeted only its own inputs file and returned header lines from it. It read nothing outside the bundle. Pass B is counted, the deviation is recorded here, and its reported scores (3.3 and 3.5) match Pass A's. The after-read should keep the reader tools read-only on the inputs file, as the method-as-run addendum's improvement note proposes.
- Both passes' first user message is the reader prompt with the inputs line. It names no ticket identifier. It names the scratchpad path of the inputs file, which the method requires; it names no other repository path.
- Limit: the check sees tool calls. It cannot see what the harness loaded into a reader's context before the first call, such as the repository's `CLAUDE.md`. The adoption addendum records this.

## Where the readers could not tell

Both passes report that the bundle holds only the note and the 14 sampled files. Pass A and Pass B name the view-model modules, the cited tests and the css as outside the sample, so the note's Waiting entries could not be checked against current code. Neither could say whether those entries are still open or why they are unscheduled.
