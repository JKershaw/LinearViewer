## Area read: Front end: server-rendered pages @ 302edafc3

**Role:** control. The kit calls it untouched, but it moved in this window (see the flags). This is the after-read for LIN-4462, the repeat of piece 0 after the last piece of LIN-4447. Both areas were read in one window, with the frozen kit, and the kit was not changed. The baseline is [front-end-pages-4b5001ddf.md](front-end-pages-4b5001ddf.md). The comparison is [comparison-302edafc3-vs-4b5001ddf.md](comparison-302edafc3-vs-4b5001ddf.md).

**Recorded fields**
- Base commit: `302edafc3a27a8d0d64a88435766625ab8d24cb5` (`origin/main`, short `302edafc3`). Nothing had landed on main after it when the readers ran.
- `docs/areas/areas.json` blob: `a4f33893e57fd7e936b05879f515c1edd4115078` (at baseline `d13fca20e50c37e859e82fbc820177acefd4e48d`). The sampled paths did not move.
- Kit `docs/plans/survey/area-read.md` blob: `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`, checked with `git rev-parse 302edafc3:<path>` before any reader ran. It is the same blob as at baseline.
- Reader prompt `docs/plans/survey/area-read-reader-prompt.md` blob: `ef1c2ca9173831f53ca32b60da1d805d27bf2159`, checked the same way. It is the same blob as at baseline.
- Method: [area-read-method-as-run.md](../area-read-method-as-run.md) section 8, repeated.
- N = 14 per area, by the kit's stable SHA-256 path-hash rule. The kit's snippet reproduces this list at the base commit.
- Date: 2026-11-14
- Note: `docs/areas/front-end-pages.md`, blob `c10926a11cd86c21965168e9f188867c4c1d28f0`, 7,115 bytes (6,404 at baseline). Lessons 1,023 bytes by the guard's `lessonsBytes`, the same as at baseline. 14 Waiting entries (14 at baseline).
- Universe: 94 files by first match, code scope (92 at baseline). Since baseline, 14 files changed in place and 2 are new (`lib/cost-format.js`, `lib/time-words.js`). None was removed.
- Reader bundle: the note plus the 14 sampled files, 214,386 bytes, built from the git object store at `302edafc3`. The builder reproduces the baseline bundle byte-for-byte at `4b5001ddf` (213,452 bytes).
- Readers: two fresh general-purpose agents, no model override. Every transcript records the model `claude-opus-5-5`. The baseline's model was not recorded.

**Sample (exact file list, at the base commit)**

The same 14 paths as the baseline, so the paired set is the full sample (14 of 14). Four blobs changed.

| Bytes | Path | Blob | Since `4b5001ddf` |
| --: | -- | -- | -- |
| 30,098 | `lib/components/navbar.js` | `680fec28e` | unchanged |
| 8,070 | `lib/render-swipe.js` | `c8b9e1744` | changed (was `32aefe9f0`) |
| 2,949 | `lib/render-audit.js` | `7d7a5ea9b` | unchanged |
| 29,789 | `lib/render-session.js` | `6762087d4` | changed (was `05fafa3d2`) |
| 1,864 | `lib/settings-copy-first-card.js` | `f87549ec2` | unchanged |
| 8,628 | `lib/render-ship-journey.js` | `41a29a991` | unchanged |
| 61,390 | `lib/render-task-page.js` | `9e47c1791` | changed (was `e5e1626cc`) |
| 18,375 | `lib/ship-journey.js` | `30a24ce91` | unchanged |
| 13,127 | `lib/render-collective.js` | `97b5e39a1` | unchanged |
| 2,204 | `lib/components/settings-group.js` | `60d28a92c` | unchanged |
| 4,120 | `lib/render-passage-planner.js` | `c323b4178` | unchanged |
| 12,982 | `lib/render-settings-you.js` | `159262e5b` | unchanged |
| 6,986 | `lib/render-proxy.js` | `600c760b0` | changed (was `1163626c3`) |
| 6,171 | `lib/render-custom-prompts.js` | `9caf01137` | unchanged |

Sample total: 14 files, 206,753 bytes (206,530 at baseline).

**Control moved: kit verdict 4 fires** (recorded before any reader ran, LIN-4462 comment `7305f073`)

| Path | In sample | Blob at `4b5001ddf` | Blob at `302edafc3` | Changed by |
| --- | --- | --- | --- | --- |
| `lib/render-swipe.js` | yes | `32aefe9f0` | `c8b9e1744` | LIN-4446 |
| `lib/render-session.js` (tracked) | yes | `05fafa3d2` | `6762087d4` | LIN-4472 |
| `lib/render-task-page.js` (tracked) | yes | `e5e1626cc` | `9e47c1791` | LIN-4446, LIN-4472, **LIN-4460** |
| `lib/render-proxy.js` | yes | `1163626c3` | `600c760b0` | LIN-4471, **LIN-4457** (leftovers) |
| `lib/render-task-timeline.js` (tracked) | no | `1f26d9308` | `5de60ac8d` | LIN-4472 |
| `lib/render-run-evidence.js` (tracked) | no | `29ea01bd2` | `29ea01bd2` | unchanged |

LIN-4460 (piece 1) and LIN-4457 (piece 7) are pieces of LIN-4447 itself. So part of this control's Δ is the treatment, and D is biased by an amount that cannot be measured. As the kit requires, the control is flagged and not substituted.

**Other flags recorded before any reader ran**
1. **K2's frozen examples are about Runs** (close-out, PRs per task, which model a dispatch used). Absolute scores are not compared across areas.
2. **Reader conditions.** Both readers used Bash on their own inputs file (`wc -l` only), where the baseline readers used Read only. Tools were unrestricted at both reads. The readers ran from a working directory outside the repository, so no repository `CLAUDE.md` reached them.

**Reader passes** (two independent fresh agents, launched in one batch with the two Runs passes. Each output below is verbatim.)

Pass A (agent `afc37738012c82a04`):

```
Code
- K1: 4. The `render-<page>.js` names and `components/` folder point to the right file for most page behaviour, but Home-only renderers (`renderHomeStatus`, `renderStageStrip`) live in the task-page file, and a route handler sits among the renderers in `lib/`. Cites `lib/render-task-page.js`, `lib/settings-copy-first-card.js`.
- K2: 3. Some rules are explicitly given one home (the question-card gate, the email-availability predicate, `getViewNavLinks`), but others are restated: two parallel state-to-pill tables, the placeable-waypoint filter in both ship-journey files, a hard-coded retention cap of 20, and a local `canReplyTo` in the session renderer while the task page imports a differently shaped one from `run-view.js`. Cites `lib/render-task-page.js`, `lib/render-ship-journey.js`.
- K3: 3. Each function is commented heavily enough to follow with a careful read, but the task and session renderers depend on model shapes and helpers defined elsewhere (`taskState`, `pageStatusOf`, `STAGE_STATE_WORD`, `runView`, `model.evidence`), so you cannot be sure of their inputs from this file alone. Cites `lib/render-task-page.js`, `lib/render-session.js`.
- K4: 3. Comments usually say why, but the same thing is called loop, run, session, attempt, step and stage by turns: `renderTaskTrack` renders stages, and the "session" page is headed "Run". The numbered section headers in `lib/render-task-page.js` do not match its top-of-file outline (two "3." headers, among other mismatches), and there are orphaned doc comments and `currentPage` values that are missing from the typedef. Cites `lib/render-task-page.js`, `lib/components/navbar.js`.
- Code mean: 3.3

Note
- M1: 4. Each of the three lessons names the rule, the file and the gate test, and says why it matters, though the money lesson is packed tightly enough to need a second read.
- M2: 3. Every entry names its file and describes the defect precisely, but only a few say why the work is not scheduled ("larger than a fix", "a separate design decision"); most give only the review the finding came from.
- Note mean: 3.5

Where I could not tell:
- The shapes and meaning of `taskState`, `pageStatusOf`, `isUnendedState`, `STAGE_STATE_WORD` and `canReplyTo` (in `lib/task-state.js` and `lib/run-view.js`), and whether that `canReplyTo` matches the local one in `lib/render-session.js`.
- The model built by `lib/task-page-loader.js` and the `runView` built by `buildRunView`.
- Whether the retention cap of 20 hard-coded in `lib/render-ship-journey.js` still equals `MAX_REPORTS_PER_WORKSPACE`.
- The `renderPage`, `renderSection` and settings-row component contracts.
- Where Home calls `renderHomeStatus` and `renderStageStrip`.
- The note format rules in README.md.
```

Pass B (agent `af9a8df79c37f1765`):

```
Code
- K1: 4. Most files are named `render-<page>.js` after the page they draw, and `lib/render-task-page.js` opens with a numbered map of its sections, but a few names point the wrong way: the run page lives in `render-session.js`, and an Express route sits in `lib/settings-copy-first-card.js` beside the renderers. `lib/render-task-page.js`, `lib/settings-copy-first-card.js`
- K2: 3. Some rules say where they are decided (the question gate in `renderTaskQuestion`, the viewer check in `renderOwnerControls`), but others are stated twice: the task page has two state-to-pill tables (`TASK_PAGE_PILL_FOR_STATE`, `PILL_FOR_TASK_STATE`), the "has a `completedAt`" filter appears in both ship-journey files, the 20-run retention cap is hard-coded in the renderer, and `canReplyTo` is defined locally in the session page but imported from `run-view.js` in the task page. `lib/render-task-page.js`, `lib/render-ship-journey.js`
- K3: 3. The simple pages (proxy, collective, audit, the navbar helpers) make sense on their own, but the task-page and session-page functions use model fields (`taskState`, `nextStep`, `waitingFor`, `view.steps`, `contextMiss`) whose shape lives in loader and view-model files that are not here. `lib/render-task-page.js`, `lib/render-session.js`
- K4: 3. Comments usually explain why, but they are heavy with ticket numbers and rulings attributed to a named person, and one concept goes by several names: the session page heads a session id as "Run", `renderRun(loop)` emits `data-loop-id`, and the task page calls the same thing a stage, a session and an attempt. `lib/render-session.js`, `lib/render-task-page.js`
- Code mean: 3.3

Note
- M1: 4. Each of the three lessons says what to do (name every per-row control, route new money figures through `withoutSpend` with the guest test as the gate, give each new section its own `grid-area`) and why, with the files named, though the money lesson is dense.
- M2: 3. Every entry names its file and the defect, but only some say why it is not scheduled ("larger than a fix", "a separate design decision", "comment fixes, no behaviour", "a seam"), while the overflow, halt-controls, Library `<h1>`, styleguide and run-chat-link entries give no reason.
- Note mean: 3.5

Where I could not tell:
- The shapes produced by `task-page-loader.js`, `run-view.js` and `task-state.js`, which the task and session renderers depend on.
- Whether the two pill tables in `lib/render-task-page.js` are meant to differ.
- The note format rules in README.md.
- Most files the note's entries refer to, which were not given (`render-settings.js`, `render-task-timeline.js`, `view-nav.js`, `footer.js`, `halt-controls.js`, `render-pages.js`, `render-library.js`, `render-styleguide.js`, `mask-secrets-in-html.js`, `render-runner-setup.js`, `render.js`, `render-task-create.js`), so I could not check those entries against the code.
```

**Scores, recomputed from the criteria**

| Pass | K1 | K2 | K3 | K4 | Code mean (raw) | Code (reported) | M1 | M2 | Note mean |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| A | 4 | 3 | 3 | 3 | 3.25 | 3.3 | 4 | 3 | 3.5 |
| B | 4 | 3 | 3 | 3 | 3.25 | 3.3 | 4 | 3 | 3.5 |

Each reader's reported one-decimal means match its own criteria.

**Combined after-read** (the method addendum's convention: the mean of the two passes' one-decimal means)
- Code means: pass A 3.3, pass B 3.3. Combined **3.30** (from the raw criteria, 3.25).
- Note means: pass A 3.5, pass B 3.5. Combined **3.50**.
- Noise guard (code means differ by 1.0 or more): |A − B| = 0.0, so the guard did not fire and the read is decided.
- Code movement and note movement against the baseline are reported separately, in the comparison.

**Contamination check** (method section 5, run before scoring)

| Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
| --- | --: | --- | --- | --- |
| A | 9 | Read 8, Bash 1 | the control `inputs.md` only (Bash: `wc -l`) | yes |
| B | 9 | Read 8, Bash 1 | the control `inputs.md` only (Bash: `wc -l`) | yes |

- Each reader's first user message is the reader prompt with the one inputs line. It names no repository path and no ticket identifier.
- No reader used Grep, Glob, git, a web tool, or any file but its own inputs. No output names a ticket, a baseline, a commit, the other area or the work.
- The Bash calls are a deviation from the baseline's Read-only use, and both passes are counted, as in LIN-4463's after-read.

**Limits carried from the kit:** the control moved (above), so verdict 4 is stated beside D. Readers had the note and the 14 files only, supplied as one bundle file with the note first and each file headed by its path.
