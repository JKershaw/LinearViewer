# Area read: adoption at `c205190fd` and `0cf05ce8f` (LIN-4463, the paired read)

This file records how the frozen kit is adopted for the front-end browser pair: `front-end-browser` (the work area, LIN-4463) read before at `c205190fd` and after at `0cf05ce8f`, with an untouched control `auth-accounts-and-workspaces` read at both commits. It is an addendum, not an edit. The kit ([area-read.md](area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the reader prompt ([area-read-reader-prompt.md](area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`) are unchanged at both commits; both blobs were checked with `git rev-parse <commit>:<path>` before any reader ran.

The reports are [front-end-browser-c205190fd.md](area-read-reports/front-end-browser-c205190fd.md), [front-end-browser-0cf05ce8f.md](area-read-reports/front-end-browser-0cf05ce8f.md), [auth-accounts-and-workspaces-c205190fd.md](area-read-reports/auth-accounts-and-workspaces-c205190fd.md) and [auth-accounts-and-workspaces-0cf05ce8f.md](area-read-reports/auth-accounts-and-workspaces-0cf05ce8f.md). Each cites this file.

## 1. Adoption fields

| Field | Value |
| --- | --- |
| Work area | Front end: browser code (`front-end-browser`), universe `^public/`, 44 files |
| Control | Auth, accounts & workspaces (`auth-accounts-and-workspaces`), 64 files |
| Why this control | The kit's control is `front-end-pages`, which LIN-4463 changed (the review rules it out). `task-model` has 2 files, too few for N = 14. `auth-accounts-and-workspaces` is the one candidate with 64 files and no changed code file in the window (checked below) |
| Base commits | `c205190fd` (before, pre-work) and `0cf05ce8f` (after, LIN-4472 squash on `main`) |
| Sample size N | 14 per area, the kit's frozen N |
| Sampling rule | the kit's snippet, run at each commit with the slug and N = 14 (copied to a file, same code) |
| Reader passes | eight counted passes, two per cell (area × commit), each a fresh general-purpose agent, launched in one batch |
| Key | `sha256("lin-4453-area-read|" + path)` as the kit specifies; the same rule at both commits |

## 2. What differs from the kit, and why

1. **Control.** The kit's control (`front-end-pages`) changed in this window, so it cannot serve as untouched control. The candidates were checked: `task-model` has 2 code files (too few for N = 14); `auth-accounts-and-workspaces` has 64 files, and every one of its code files, and all 14 sampled blobs, is identical at both commits (see section 4).
2. **Byte imbalance.** The browser sample is 361,532 B at `c205190fd` and 358,690 B at `0cf05ce8f`. The control sample is 205,106 B at both. The ratio is 1.76×. N is frozen, so the imbalance is recorded, not corrected.
3. **Concentration.** `public/live-console.js` (84,967 B) and `public/dispatch.js` (50,156 B) make up 37% of the browser sample at `c205190fd`. A read that moves may move because of these two files.
4. **Work-area note movement.** `docs/areas/front-end-browser.md` changed between the commits (blob `293d19fe1` at `c205190fd`, 6,245 B; blob `00261bbc2` at `0cf05ce8f`, 8,296 B). The kit scores the note apart from the code, so the note movement is reported on its own (section 5).
5. **Note fixes are not in the reads.** The reads use the git objects at the two commits, not the working tree. The note fixes this ticket makes (the `public/brief.js`, `public/app.js`, `public/llms.txt` and `public/prompt-section.js` Waiting entries) land after `0cf05ce8f` and are not scored here.
6. **Control note movement.** `docs/areas/auth-accounts-and-workspaces.md` changed between the commits (blob `c69796f01`, 2,081 B; blob `fa65fd2b5`, 2,466 B). Its code is untouched; the note movement is reported on its own.
7. **Contamination deviation.** Browser pass A at `c205190fd` ran two Bash `wc -l` calls on its own inputs file. Its other tool calls were Reads of that file. This is the same kind of deviation the baseline addendum recorded for Front-end pass B: it reads only its own bundle, and it is counted. All other passes made only Read calls on their own bundle (section 6).

## 3. Samples

Universe and sample totals come from the kit's snippet. Ranks are path order, the order the bundle gives.

### Front end: browser code, `c205190fd` (universe 44 files, 1,662,262 B; sample 14 files, 361,532 B)

| # | Bytes | Path | Blob |
| --: | --: | -- | -- |
| 1 | 14,155 | `public/audit.js` | `8210af639` |
| 2 | 34,441 | `public/chat.js` | `185d47d0d` |
| 3 | 21,245 | `public/collective.js` | `879e6d13f` |
| 4 | 761 | `public/cost-format-global.js` | `3f9ba017f` |
| 5 | 5,001 | `public/decision-panel.js` | `14d497fd0` |
| 6 | 50,156 | `public/dispatch.js` | `3b47f3e21` |
| 7 | 12,888 | `public/kpis.js` | `36453120c` |
| 8 | 84,967 | `public/live-console.js` | `8baf0155a` |
| 9 | 2,018 | `public/passage-planner.js` | `f7b0083c6` |
| 10 | 18,094 | `public/proxy.js` | `ea599c6eb` |
| 11 | 29,567 | `public/session.js` | `10a9c0bab` |
| 12 | 35,479 | `public/ship-journey.js` | `5b6a69a31` |
| 13 | 6,747 | `public/task-edit.js` | `0981777b4` |
| 14 | 46,013 | `public/task-page.js` | `b6720783f` |

### Front end: browser code, `0cf05ce8f` (universe 44 files, 1,659,313 B; sample 14 files, 358,690 B)

Same 14 paths. Two blobs differ:

| # | Bytes | Path | Blob | Change from `c205190fd` |
| --: | --: | -- | -- | -- |
| 4 | 932 | `public/cost-format-global.js` | `b7570fec8` | changed (LIN-4471) |
| 14 | 43,000 | `public/task-page.js` | `5ba9b91ce` | changed (LIN-4472) |

The other 12 blobs are identical at the two commits. Four of the 44 universe files changed, and two are in the sample (`public/cost-format-global.js` and `public/task-page.js`). `public/common.js` and `public/workspace-kpis.js` changed too but are outside the sample.

### Auth, accounts & workspaces, `c205190fd` and `0cf05ce8f` (universe 64 files, 945,008 B; sample 14 files, 205,106 B)

Identical at both commits: same universe, same sample paths, same blobs.

| # | Bytes | Path | Blob |
| --: | --: | -- | -- |
| 1 | 2,111 | `lib/account-merge-log.js` | `3362706fd` |
| 2 | 4,430 | `lib/credential-state.js` | `bac04d660` |
| 3 | 11,807 | `lib/email-auth.js` | `7ed061160` |
| 4 | 7,941 | `lib/email-availability.js` | `bf3c9c583` |
| 5 | 5,316 | `lib/email-transport.js` | `398e2b25a` |
| 6 | 34,233 | `lib/owner-credential-store.js` | `b119029fd` |
| 7 | 7,565 | `lib/persist-binding.js` | `870c003bc` |
| 8 | 7,816 | `lib/refresh-strategy.js` | `45371adbe` |
| 9 | 3,565 | `lib/session-options.js` | `b585c789c` |
| 10 | 21,596 | `lib/user-preferences.js` | `4f3bd6506` |
| 11 | 24,330 | `lib/workspace-preferences.js` | `f2f9d8ada` |
| 12 | 7,798 | `lib/workspace-store.js` | `b720e1fa9` |
| 13 | 55,133 | `routes/jira-auth.js` | `15c3b155a` |
| 14 | 11,465 | `routes/openrouter-auth.js` | `b00a302e9` |

## 4. Control stability

- The control universe is 64 files at both commits, 945,008 B each. `git diff --name-only c205190fd 0cf05ce8f` over the control's `lib/` and `routes/` paths lists no file that maps to `auth-accounts-and-workspaces`. The kit's verdict 4 is therefore not triggered for the sampled code. Its one movement is the note (section 2, item 6).
- The 14 sampled blobs are identical at both commits.

## 5. Reader scores and the verdict

Per pass, from the eight reports. Code means are the mean of K1 to K4 (the kit's rule). The reader's own one-decimal figures are shown beside the raw means where they differ.

| Cell | Pass | K1 | K2 | K3 | K4 | Code mean (raw) | Note M1 | Note M2 | Note mean |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: |
| Browser `c205190fd` | A | 4 | 3 | 3 | 3 | 3.25 (reported 3.3) | 4 | 4 | 4.0 |
| Browser `c205190fd` | B | 4 | 2 | 3 | 3 | 3.00 | 4 | 3 | 3.5 |
| Browser `0cf05ce8f` | A | 4 | 3 | 4 | 3 | 3.50 | 4 | 4 | 4.0 |
| Browser `0cf05ce8f` | B | 4 | 3 | 3 | 3 | 3.25 (reported 3.3) | 4 | 3 | 3.5 |
| Control `c205190fd` | A | 4 | 3 | 3 | 3 | 3.25 (reported 3.3) | 4 | 3 | 3.5 |
| Control `c205190fd` | B | 4 | 3 | 3 | 3 | 3.25 (reported 3.3) | 4 | 3 | 3.5 |
| Control `0cf05ce8f` | A | 4 | 3 | 3 | 3 | 3.25 (reported 3.3) | 4 | 3 | 3.5 |
| Control `0cf05ce8f` | B | 4 | 3 | 3 | 3 | 3.25 (reported 3.3) | 4 | 3 | 3.5 |

**Area means (the mean of the two passes' raw code means, and of their note means):**

| Cell | Code | Note |
| --- | --: | --: |
| Browser `c205190fd` | 3.125 | 3.75 |
| Browser `0cf05ce8f` | 3.375 | 3.75 |
| Control `c205190fd` | 3.25 | 3.5 |
| Control `0cf05ce8f` | 3.25 | 3.5 |

**Noise guard (verdict 1).** The two passes' code means differ by 0.25 in the browser at `c205190fd`, by 0.25 in the browser at `0cf05ce8f`, and by 0.00 in each control cell. All are under 1.0, so every cell is decided. No repeat was needed.

**Verdict (verdict 2).**
- Δ(browser) = 3.375 − 3.125 = **+0.25** (code).
- Δ(control) = 3.25 − 3.25 = **0.00** (code).
- D = Δ(browser) − Δ(control) = **+0.25**.

The kit's frozen thresholds are D ≥ +0.5 (better), D ≤ −0.5 (worse), otherwise no detectable difference. D = +0.25 falls in the last band: **no detectable difference at this threshold.** The browser's after-minus-before code score is above the control's, but not by the kit's +0.5.

**Note movement (verdict 3), reported on its own, and not counted in D.**
- Browser note Δ = 3.75 − 3.75 = **0.00**. The note's text changed between the commits (6,245 B to 8,296 B), but both passes scored its Lessons and Waiting at the same level on average.
- Control note Δ = 3.5 − 3.5 = **0.00**. Its blob changed (2,081 B to 2,466 B).

## 6. Contamination check

Each counted reader's transcript was parsed for tool calls (tool names and input paths only).

| Cell | Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
| --- | --- | --: | --- | --- | --- |
| Browser `c205190fd` | A | 12 | Read 10, Bash 2 | own inputs file (Read 10 times); Bash `wc -l` on own inputs file (2) | yes; Bash deviation recorded in section 2 item 7 |
| Browser `c205190fd` | B | 12 | Read 12 | own inputs file | yes |
| Browser `0cf05ce8f` | A | 14 | Read 14 | own inputs file | yes |
| Browser `0cf05ce8f` | B | 16 | Read 16 | own inputs file | yes |
| Control `c205190fd` | A | 11 | Read 11 | own inputs file | yes |
| Control `c205190fd` | B | 19 | Read 19 | own inputs file | yes |
| Control `0cf05ce8f` | A | 7 | Read 7 | own inputs file | yes |
| Control `0cf05ce8f` | B | 4 | Read 4 | own inputs file | yes |

Limit: the check sees tool calls. It cannot see what the harness loaded into a reader's context before the first call, such as the repository's `CLAUDE.md`. The readers ran in the repository's working directory. The baseline addendum recorded the same condition.

## 7. Where the readers could not tell

The readers' "Where I could not tell" sections name the same gaps in every cell: the files the notes cite, the tests, the review documents, the window globals defined outside the sample (for example `window.api`, `taskPageHref`, `computeTimelineZoom`), and the model-routing and workspace modules the auth sample imports. These are limits of the sample, not of the readers.
