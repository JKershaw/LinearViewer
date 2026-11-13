## Area read: Front end: server-rendered pages @ 4b5001ddf

**Role:** control (untouched by the work). Piece 0 baseline, LIN-4453 beat 2. Read in one window with the frozen kit; the kit was not changed.

**Recorded fields**
- Base commit: `4b5001ddfa185eed683ccb8b9805d493c8c380da` (`origin/main`, short `4b5001ddf`)
- `docs/areas/areas.json` blob: `d13fca20e50c37e859e82fbc820177acefd4e48d`
- Kit `docs/plans/survey/area-read.md` blob: `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` (committed `4a21feb1d`)
- Reader prompt `docs/plans/survey/area-read-reader-prompt.md` blob: `ef1c2ca9173831f53ca32b60da1d805d27bf2159`
- N = 14 per area, by the stable SHA-256 path-hash rule in the kit. The snippet reproduces this list at the base commit.
- Date: 2026-11-13
- Note: `docs/areas/front-end-pages.md`, blob `971d4bf6c505cfcde1885f3c0dd0c57a1b841d59`, 6,404 bytes.

**Sample (exact file list, at the base commit)**

| Bytes | Path |
| --: | -- |
| 30,098 | `lib/components/navbar.js` |
| 8,124 | `lib/render-swipe.js` |
| 2,949 | `lib/render-audit.js` |
| 29,757 | `lib/render-session.js` |
| 1,864 | `lib/settings-copy-first-card.js` |
| 8,628 | `lib/render-ship-journey.js` |
| 61,250 | `lib/render-task-page.js` |
| 18,375 | `lib/ship-journey.js` |
| 13,127 | `lib/render-collective.js` |
| 2,204 | `lib/components/settings-group.js` |
| 4,120 | `lib/render-passage-planner.js` |
| 12,982 | `lib/render-settings-you.js` |
| 6,881 | `lib/render-proxy.js` |
| 6,171 | `lib/render-custom-prompts.js` |

Sample total: 14 files, 206,530 bytes.

**Reader passes** (two independent fresh agents; each output below is verbatim)

Pass A (agent `a581ef74887791352`):

```
Code
- K1: 4. Page renderers are named for their page (`render-task-page.js`, `render-session.js`, `render-settings-you.js`) and file headers cross-reference the splits, though the Lessons point at modules outside this set (`task-timeline.js`, `render-settings.js`).
- K2: 3. The viewer gate and close-out wording each have one home, but the page-id list is restated in `lib/components/navbar.js`, and the decided-state-to-pill mapping is held twice in `lib/render-task-page.js` (`TASK_PAGE_PILL_FOR_STATE` and `PILL_FOR_TASK_STATE`).
- K3: 3. Most functions read cleanly in isolation, but the task-page renderers depend on model fields and state values (`waitingFor`, `unsettled`, close-out statuses) whose meaning is defined in loader and evidence modules not in the set (`lib/render-task-page.js`).
- K4: 3. Names and comments explain why at length, but the same concept shifts: session, run, loop, step and stage are used interchangeably across `lib/render-session.js` and `lib/render-task-page.js`, and comments are heavy with ticket references.
- Code mean: 3.3

Note
- M1: 4. Each lesson states the action (name every per-row control; route new page figures through `withoutSpend` and the guest test; give a new desktop section its own `grid-area`) and the consequence it prevents.
- M2: 2. Each entry names its file and what is waiting, but only three of the thirteen say why it is unscheduled (the session link and swipe viewport entries, and the styleguide entry noting that open tickets do not cover it), so the rest must be inferred.
- Note mean: 3.0

Where I could not tell: The note cites many files outside this set, including `lib/render-settings.js`, `lib/task-timeline.js`, `lib/render-task-timeline.js`, `lib/mask-secrets-in-html.js`, `lib/providers/jira/adf.js`, `lib/render-library.js`, `lib/render-styleguide.js`, `lib/render-runner-setup.js` and `public/task-page.css`, so I could not check the lessons' claims or the waiting entries against code. The three review documents it cites were not provided, and the README.md the note refers to for format rules is absent. Whether any waiting entry has since been ticketed or scheduled elsewhere is also unknown.
```

Pass B (agent `a29ecc88e5768defa`):

```
Code
- K1: 4. File names and header comments say what each renderer owns (for example `render-task-page.js`, `render-session.js`, `navbar.js`), so a behaviour is usually easy to locate. Cite lib/render-task-page.js, lib/components/navbar.js.
- K2: 3. Some rules have a single home, such as the owner/guest split in `renderOwnerControls` and the question gate in `renderTaskQuestion`, but the pill mapping is held twice in `render-task-page.js` (`TASK_PAGE_PILL_FOR_STATE` and `PILL_FOR_TASK_STATE`), and the note reports the tick rule restated in the timeline renderer. Cite lib/render-task-page.js, lib/render-task-timeline.js.
- K3: 4. Most functions, such as `renderStage`, `renderLineageGroup` and `renderSteps`, read on their own with a JSDoc or header comment, though several depend on state vocabularies defined in other files. Cite lib/render-session.js, lib/render-task-page.js.
- K4: 3. Comments explain the why well, but the same concept is called run, session, loop, attempt, step and stage across renderers, and many comments lean on LIN ticket numbers a reader outside the tracker cannot resolve. Cite lib/render-session.js, lib/render-task-page.js.
- Code mean: 3.5

Note
- M1: 4. Each lesson names the action and its reason (label each per-row control, route any new task-page figure through `withoutSpend`, give a new grid section its own `grid-area`), though the first two carry review dates and counts that dilute the instruction.
- M2: 2. Each waiting entry names its file and the problem, but most give no reason it is unscheduled (no ticket, deferred, out of scope), so a reader cannot tell whether it was left on purpose.
- Note mean: 3.0

Where I could not tell: lib/render-settings.js, lib/task-timeline.js, lib/task-page-loader.js, lib/question-card.js, and public/task-page.css were not in the inputs, so the note's claims about them and the `withoutSpend` strip could not be checked. The cited review documents and the named tests were also absent, so I could not tell whether any waiting entry has since been ticketed or why it was left unscheduled.
```

**Combined baseline (no after-read yet; no Runs-minus-control difference computed here)**
- Code means: pass A 3.3, pass B 3.5; combined 3.40.
- Note means: pass A 3.0, pass B 3.0; combined 3.00.
- Noise guard (code means differ by 1.0 or more): |A − B| = 0.2, so the guard did not fire.
- Code movement and note movement are reported separately; this baseline has neither.

**Limits carried from the kit:** the sample holds 1 of the 13 planned Runs files (`lib/cost-read.js`); the read measures the area at large. Readers had the note and the 14 files only, supplied as one bundle file with the note first and each file headed by its path. Readers had general tool access, so their use of tools was not restricted by configuration; see the beat report for what was checked.
