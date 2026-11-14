# Area read: Front end: server-rendered pages @ 49776653d (after, control, LIN-4470 piece 6)

The after-read of the control area for LIN-4448, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). The method is [area-read-method-as-run.md](../area-read-method-as-run.md), section 8. Its baseline is [front-end-pages-e8e92d50a.md](front-end-pages-e8e92d50a.md). The work area's read at the same base is [llm-and-prompts-49776653d.md](llm-and-prompts-49776653d.md), and the comparison is [comparison-49776653d-vs-e8e92d50a.md](comparison-49776653d-vs-e8e92d50a.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | Front end: server-rendered pages (`front-end-pages`), the control |
| Base commit | `49776653d` (the same base as the work area's read) |
| Date | 2026-11-14 |
| `docs/areas/areas.json` blob | `a4f33893e57fd7e936b05879f515c1edd4115078` (baseline `1dc2ba7014ef021c785c06dc3eda7d5694a0facd`) |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`, unchanged |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159`, unchanged |
| Note | `docs/areas/front-end-pages.md`, blob `c10926a11cd86c21965168e9f188867c4c1d28f0`, 7,115 B: 14 Waiting entries (baseline blob `ae9c007e1d7612200d028e26e808daaa4e56ea8e`, 5,825 B, 12 entries) |
| Universe | 94 files in the area by first match, code scope (baseline 92) |
| N | 14 (frozen) |
| Sample | 14 files, 206,753 B (baseline 206,545 B) |
| Sampling rule | the kit's snippet, run at `49776653d` with slug `front-end-pages` and N = 14 |
| Inputs | one bundle built as in method-as-run section 2: the note, then the 14 sampled files in path order, from `git show 49776653d:<path>`; 214,386 B. Each pass reads that file, and nothing else |

## Sample

| Bytes | Path |
| --: | -- |
| 30,098 | `lib/components/navbar.js` |
| 2,204 | `lib/components/settings-group.js` |
| 2,949 | `lib/render-audit.js` |
| 13,127 | `lib/render-collective.js` |
| 6,171 | `lib/render-custom-prompts.js` |
| 4,120 | `lib/render-passage-planner.js` |
| 6,986 | `lib/render-proxy.js` |
| 29,789 | `lib/render-session.js` |
| 12,982 | `lib/render-settings-you.js` |
| 8,628 | `lib/render-ship-journey.js` |
| 8,070 | `lib/render-swipe.js` |
| 61,390 | `lib/render-task-page.js` |
| 1,864 | `lib/settings-copy-first-card.js` |
| 18,375 | `lib/ship-journey.js` |

Sample total: 14 files, 206,753 bytes.

**Paired set.** The 14 paths are the same as the baseline's, so all 14 are paired. Four of them have changed bytes since `e8e92d50a`: `lib/render-task-page.js` (61,250 → 61,390), `lib/render-session.js` (29,757 → 29,789), `lib/render-proxy.js` (6,881 → 6,986) and `lib/render-swipe.js` (8,124 → 8,070). The tracked files the kit names (`lib/render-task-timeline.js`, `lib/render-run-evidence.js`, `lib/render-task-page.js`, `lib/render-session.js`) are checked by blob in the comparison file.

**Control moved (verdict 4).** The control's sample changed in four files, and the note changed (blob `ae9c007e1` → `c10926a11`, 12 → 14 Waiting entries). Both are flagged in the comparison file beside D. This does not change the control's scores here.

## Passes

Two passes, each a fresh general-purpose agent with the default toolset, launched in one batch with no shared context. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 4. File names follow the pages (render-task-page.js, render-session.js, render-settings-you.js, navbar.js), so the file for a given page is easy to find, though the task-page status and timeline pieces are split across files a reader must already know. Cite: lib/render-task-page.js, lib/components/navbar.js.
- K2: 3. The viewer gate and the question gate each say they are the one place, but the same task states are mapped twice (TASK_PAGE_PILL_FOR_STATE and PILL_FOR_TASK_STATE), and the page list for workspace switching is restated in renderWorkspaceOptions. Cite: lib/render-task-page.js, lib/components/navbar.js.
- K3: 3. Typical functions read cleanly on their own, but most depend on model fields (stages, evidence.closeOut, taskState) whose shape is defined in files that were not given. Cite: lib/render-task-page.js, lib/render-session.js.
- K4: 3. Names and comments mostly say what and why, but one concept takes several names (stage, step and task-step; needs you, waiting and parked; data-status and data-state), and many comments cite ticket numbers rather than the reason. Cite: lib/render-task-page.js, lib/render-session.js.
- Code mean: 3.3

Note
- M1: 4. Each lesson gives a rule and its reason (a guest sees no spend; a new section renders at the top without its own grid area), though the accessible-name lesson leaves the WCAG reason implicit.
- M2: 3. Each entry names its file and the problem, but few say why the item is not scheduled; only the render.js and render-task-create.js entries give that reason.
- Note mean: 3.5

Where I could not tell: the files the note's entries cite (lib/render-settings.js, lib/render-task-timeline.js, lib/task-timeline.js, lib/render-library.js, lib/render-styleguide.js, lib/render-pages.js, lib/components/halt-controls.js, public/task-page.css) and the review documents were not in the inputs, so I could not check any waiting entry against its code or verify the 86, 42 and 117 counts. The model shapes passed into the renderers (task-page-loader, run-view, close-out) are also absent.
```

Pass A: code mean 3.3 (raw 3.25), note mean 3.5.

### Pass B

```
Code
- K1: 4. File names such as `render-task-page.js`, `render-session.js` and `render-settings-you.js`, plus each file's header comment, say which page or behaviour lives where. Cited: lib/render-task-page.js, lib/render-settings-you.js.
- K2: 3. The viewer rule is decided in one function (`renderOwnerControls`) and the question gate in `renderTaskQuestion`, but the page-set lists are restated in `navbar.js` (`FILTERABLE_PAGES`, `ASSIGNEE_PAGES`, and a separate `featureFlaggedPages` inside `renderWorkspaceOptions`). Cited: lib/components/navbar.js, lib/render-task-page.js.
- K3: 3. Most render functions read clearly on their own, but `renderTaskPullRequest` and `prDetail` depend on evidence and close-out shapes defined in other modules, and the long ticket-history comments add to the reading load. Cited: lib/render-task-page.js, lib/render-session.js.
- K4: 3. Names such as `renderHomeStatus` and `renderStageStrip` say what they draw, but one concept has several names (stage, step and track; blocked, parked and needs-you), and many comments are long ticket references. Cited: lib/render-task-page.js, lib/components/navbar.js.
- Code mean: 3.3

Note
- M1: 4. Each lesson says what to do (name the control, run the guest strip and the three-response test, give a new section its own grid-area) and why, though the first leaves the accessibility reason implicit.
- M2: 3. Each waiting entry names its file, but several do not say why the item is unscheduled (the Jira picker overflow, the halt-controls tone, the Library double `&lt;h1&gt;`), and the session run-chat entry has no ticket.
- Note mean: 3.5

Where I could not tell: the files behind several entries (`lib/render-settings.js`, `lib/components/halt-controls.js`, `lib/render-pages.js`, `lib/render-library.js`, `lib/render-styleguide.js`, `lib/task-timeline.js`, `lib/render-task-timeline.js`, `lib/render.js`) are not in the inputs, so the counts, pixel widths and the claimed tick-rule restatement are unverified. The review documents and the state of LIN-3957 and LIN-3960 are also not here. The evidence and close-out shapes that `renderTaskPullRequest` uses are not in front of me.
```

Pass B: code mean 3.3 (raw 3.25), note mean 3.5.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.3 (raw 3.25) | 3.5 |
| Pass B | 3.3 (raw 3.25) | 3.5 |
| **Area** | **3.3** | **3.5** |

- **Noise guard:** the passes' code means differ by 0.0, under 1.0, so the read is decided. The note means differ by 0.0.
- Area code is the mean of the two passes' reported code means, and area note the mean of their reported note means (the kit's combined-score convention).
- **Control flag:** the control moved (see Recorded fields and the comparison file). Its Δ is stated beside D there.

## Control and contamination

- **Open PRs.** Twelve were open at the check. None touches a sampled file or one of the four tracked files (`lib/render-task-timeline.js`, `lib/render-run-evidence.js`, `lib/render-task-page.js`, `lib/render-session.js`). The check read each PR's file list; it did not inspect diffs.
- **Contamination check.** Each counted reader's transcript was parsed for every tool call and checked against its own inputs file, by reading the transcript's structured tool-use records.

  | Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
  | --- | --: | --- | --- | --- |
  | A | 9 | Read only | the front-end `inputs.md`, 9 reads | yes |
  | B | 5 | Read only | the front-end `inputs.md`, 5 reads | yes |

  - Both passes' first user message is the reader prompt with the inputs line, and nothing else from the repository.
  - Neither pass used Grep, Glob, Bash, WebFetch or any other tool. Both are clean.
- **Limit on the check.** It sees tool calls, not what the harness loaded before the first call (see the work area's report).

## Where the readers could not tell

Both passes name the cited files the bundle does not hold, so the counts and the claimed restatements in the note could not be verified against the code.
