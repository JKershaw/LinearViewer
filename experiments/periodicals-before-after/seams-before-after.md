# Seams & Tangles (and code shape): before and after the 15–17 Oct rebuild round

Facts only. No judgement is written here.

## Commits measured

| Label | Commit | What it is |
|---|---|---|
| **Baseline** | `2a07f3ea` | The first-parent parent of LIN-3556's merge `269a6189` (#1891). This is the "Papers: Theseus…" commit (#1890), 15 Oct 11:29. |
| Midpoint | `350242d5` | LIN-3573 (#1899), which is `rebuild-ladder.md`'s `grounded_at`. It comes after LIN-3556/57/61/64/65/66/69/70/73. |
| **Head** | `91fca7dd` | `origin/main` at measurement, LIN-3591 (#1907), 17 Oct 01:02. |

Between the baseline and head there are 17 first-parent commits. 15 of them touch production code. The LIN-3583 commit (E2E) and the rebuild-ladder papers commit do not touch it.

## How it was run

The tool is `scripts/code-shape/seams.mjs`. It is the same at both commits, unchanged since 6597d6e0, and run from the `/home/user/LinearViewer` checkout. It reads each commit from the git object store, so no checkout is needed.
- **Guide:** the `scripts/code-shape/areas.json` from `origin/main`, passed explicitly as the third argument, **the same file for every run**. The guide is unchanged since 6597d6e0.
- **Command:** `node scripts/code-shape/seams.mjs /home/user/LinearViewer <commit> <S>/writeup/tools/areas.json`
- **Raw output:** `S/writeup/tools/seams-{2a07f3ea,350242d5,91fca7dd}.json`
- **Diff script:** `S/writeup/tools/diff.mjs`

**Cross-check against the published baseline.** At `2a07f3ea` the tool reproduces the Seams & Tangles baseline review exactly. That review (`docs/reviews/seams-tangles-review-2026-10-13.md`, measured at `6597d6e0`) reports 429 files, 4 unresolved, 63 link rows, 897 cross-area imports, 19 two-way pairs and one knot group of 9. `theseus.md`'s 13 Oct row (`38fc3b5c`) has the same figures: 429, 897 and 19. Nothing in scope moved between 6597d6e0 and the baseline.

## Area level (the periodical's series)

| Measure | Baseline `2a07f3ea` | Midpoint `350242d5` | Head `91fca7dd` | Δ base→head |
|---|--:|--:|--:|--:|
| Files in scope | 429 | 429 | 431 | +2 |
| Parse failures / non-literal dynamic imports / unmapped files | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| Unresolved relative imports | 4 | 4 | 4 | 0 (still `routes/test.js` → `tests/fixtures/*`) |
| Area→area link rows | 63 | 63 | 64 | +1 |
| Cross-area imports (distinct file pairs) | 897 | 897 | 901 | +4 |
| Within-area imports | 581 | 581 | 583 | +2 |
| **Two-way pairs (knots)** | **19** | **19** | **20** | **+1** |
| Knot groups (cycles of areas) | one of 9 | one of 9 | one of 9 (same 9 areas) | 0 |
| Entry files, summed over areas | 314 | 314 | 316 | +2 |

**The midpoint is identical to the baseline on every area-level number.** Rebuilds 1A–4 cover `adf.js`, `render-roadmap.js`, `proxy-reads.js`, `proxy-writes.js` and `proxy-rulings.js`, and none of them changed one cross-area link. All of the movement is in the second half of the round (rungs 5–6).

### Every link that changed, baseline → head

| Link | Before | After | The file pairs behind the change |
|---|--:|--:|---|
| Agent API (proxy) → Runs & dispatch | 44 | 46 | + `routes/proxy-dispatch.js` → `lib/dispatch-entrance.js`, + `routes/proxy-kickoff.js` → `lib/dispatch-entrance.js` (LIN-3592) |
| Front end: server-rendered pages → LLM & prompts | 15 | 14 | − `lib/render-swipe.js` → `lib/prompt-templates.js` (LIN-3579) |
| Front end: server-rendered pages → Other features | 0 | 2 | + `lib/render.js` → `lib/home-swipe-prompt-opts.js`, + `lib/render-swipe.js` → `lib/home-swipe-prompt-opts.js` (LIN-3579) |
| Other features → LLM & prompts | 2 | 3 | + `lib/home-swipe-prompt-opts.js` → `lib/prompt-templates.js` (LIN-3579) |

### Knots that changed

| Pair | Before (a→b / b→a) | After |
|---|---|---|
| Agent API ↔ Runs & dispatch | 44/7 | 46/7 |
| Server-rendered pages ↔ LLM & prompts | 15/7 | 14/7 |
| LLM & prompts ↔ Other features | 2/2 | 2/3 |
| **Server-rendered pages ↔ Other features** | — | **2/1 (new knot)** |

**Where the new knot comes from.** LIN-3579 extracted the module `lib/home-swipe-prompt-opts.js`. Its header says: "both pages feed `PromptSection.init` the same flags and prompt catalog, so the computation lives here once". No pattern in the guide names that module, so it falls into the catch-all "Other features" area (`^lib/`). The thin direction of the knot, Other features → pages, is a single import that already existed: `lib/ship-journey.js` → `lib/ship-layout.js`. No knot was untied.

### Entry files that changed

| Area | Files | Entry files | Change |
|---|---|---|---|
| Runs & dispatch | 89 → 90 | 78 → 79 | New entry `lib/dispatch-entrance.js`, with 2 importers, both from the Agent API area |
| Other features | 9 → 10 | 9 → 10 | New entry `lib/home-swipe-prompt-opts.js`, with 2 importers, both from pages |
| LLM & prompts | — | — | `lib/prompt-templates.js` keeps 14 importers. Its importing areas now include Other features. |

Every other area's file count, internal-import count and entry-file list is identical at both commits.

## File level (same tool, guide with one area per file)

The tool was run again with a guide that gives each file its own area: `S/writeup/tools/perfile.json`, built by `perfile-guide.mjs` from the union of files at the three commits. This turns links into file→file import edges.
- **Raw output:** `S/writeup/tools/files-{2a07f3ea,91fca7dd}.json`
- **Diff script:** `filediff.mjs`

| Measure | Baseline | Head |
|---|--:|--:|
| File→file import edges (`server.js`, `lib/`, `routes/`, `public/`) | 1,478 | 1,484 |
| File-level two-way pairs | 0 | 0 |
| File-level cycles | 0 | 0 |

**Edges added (7):**
- `lib/dispatch-entrance.js` → `lib/dispatch-validation.js`
- `routes/{dispatch,proxy-dispatch,proxy-kickoff}.js` → `lib/dispatch-entrance.js`
- `lib/{render,render-swipe}.js` → `lib/home-swipe-prompt-opts.js`
- `lib/home-swipe-prompt-opts.js` → `lib/prompt-templates.js`

**Edges removed (1):**
- `lib/render-swipe.js` → `lib/prompt-templates.js`

**Fan-out and fan-in of the 17 rebuilt files is unchanged**, apart from the new edges to the two extracted modules. The rebuilt files are `adf.js`, `render-roadmap`, `proxy-reads`, `proxy-writes`, `proxy-rulings`, `pipeline-loops`, `render`, `render-session`, `render-settings`, `render-swipe`, `dispatch-factory`, `dispatch-validation`, `task-page-loader`, `routes/dispatch`, `proxy-dispatch`, `proxy-kickoff` and `kpi-stats`. Two examples: `pipeline-loops.js` is out 6 / in 17 at both commits, and `dispatch-factory.js` is out 11 / in 9 at both.

**The wrong-way edges named in the 10-13 review are all still present at head:**
- F1: `follow-up-dispatch` → `chat-tools`, `observer-state-store` → `recap-cache` and `task-page-loader` → `brief-cache`.
- F2: `task-stack` → `render-swipe` and `roadmap` → `render-swipe`. `render-swipe.js` still exports `flattenTrees`, `sortIssuesForSwipe`, `applyBlockingOrder`, `clusterByParent`, `computeOffPageBlockers` and `buildWhy`. Also `task-page-loader` → `render-run-steps`, `render-task-page` → `task-page-loader` and `live-console` → `timeline-zoom`.
- F3: `providers/linear` → `openrouter`, and `providers/{github,jira}` → `proxy-ref-resolver`.

So none of the review's follow-ups F-A, F-B or F-C landed in this round, even though `render-swipe.js` and `task-page-loader.js` were themselves rebuilt.

## Function size and complexity: the Code Quality measure

The Code Quality periodical has **no committed tool**. Its prompt asks for "lightweight built-in signals (file/function length, nesting depth, fan-out)", and the 10-12 edition measured by hand. The nearest committed definitions are the rebuild kit's: `experiments/rebuild-exp1/kit/lib/shape-core.mjs` on branch `claude/jolly-knuth-dgn3m1`. That is the measure `rebuild-ladder.md` uses: code lines, decision points (= cyclomatic − 1 per unit), and the worst function.

I applied it to every `server.js`, `lib/` and `routes/` `.js`/`.mjs` file read from the object store at each commit. Definitions are in `shape-core.mjs`. Every function node is counted, including nested ones. "Top-level" means a function not enclosed by another.
- **Script:** `S/writeup/tools/fnshape.mjs`
- **Raw output:** `fn-{2a07f3ea,91fca7dd}.json`

| Measure (`server.js`, `lib/`, `routes/`) | Baseline | Head | Δ |
|---|--:|--:|--:|
| Files / parse failures | 393 / 0 | 395 / 0 | +2 |
| Code lines | 75,301 | 74,018 | −1,283 (−1.7%) |
| Decision points | 21,881 | 21,254 | −627 (−2.9%) |
| Functions | 6,065 | 6,398 | +333 |
| Functions spanning ≥100 lines (all / top-level) | 209 / 144 | 192 / 132 | −17 / −12 |
| Functions spanning ≥200 lines (all / top-level) | 70 / 52 | 63 / 47 | −7 / −5 |
| Functions spanning ≥500 lines | 20 | 19 | −1 |
| Units with cyclomatic >10 | 597 | 582 | −15 |
| Units with cyclomatic ≥50 | 21 | 11 | −10 |
| Units with cyclomatic ≥100 | 4 | 1 | −3 |
| Units with max nesting ≥5 / ≥7 | 29 / 2 | 24 / 2 | −5 / 0 |

**The 17 rebuilt files plus the 2 extracted modules account for all of the repo-wide change**, to within 2 code lines. The remaining +2 is in `jira/index.js` and `unanswered-decisions.js`.
- Code lines: 9,403 → 8,118 (−1,285, −13.7%)
- Decision points: 3,370 → 2,743 (−627, −18.6%)
- Functions: 588 → 921

**The 10 most complex units at baseline:**
- 9 of them sit in files later rebuilt.
- `runner.mjs:runCommand` (114) is the exception.

**The 10 most complex units at head:**
- 2 of them sit in rebuilt files: `routes/dispatch.js` λ@483 (63) and `routes/proxy-dispatch.js` λ@766 (52).
- The old #1, `createDispatchItem`, went from 181 to 49, and its span from 913 to 193 lines.
- `runCommand` (114, not a target) is now #1.

The **largest spans are unchanged route factories**, all with nesting 0:
- `createWorkspaceApiRoutes` 4,364
- `createDashboardRoutes` 2,539
- `createTestRoutes` 1,853

### Per rebuilt file

Columns: code lines; decision points; worst unit's cyclomatic; longest function span; max nesting.

| File (ticket) | Code | Decision pts | Worst unit | Longest span | Max nest |
|---|---|---|---|---|---|
| `lib/providers/jira/adf.js` (3556/57/61/64/65/70) | 322 → 345 | 153 → 163 | 28 → 24 | 77 → 28 | 4 → 3 |
| `lib/render-roadmap.js` (3566) | 375 → 364 | 115 → 88 | 34 → 22 | 183 → 57 | 3 → 3 |
| `routes/proxy-reads.js` (3569) | 448 → 378 | 98 → 72 | 31 → 22 | 745 → 526 | 3 → 3 |
| `routes/proxy-writes.js` (3573) | 693 → 421 | 210 → 150 | 39 → 26 | 1,005 → 619 | 5 → 2 |
| `routes/proxy-rulings.js` (3573) | 236 → 198 | 57 → 46 | 21 → 12 | 407 → 293 | 2 → 2 |
| `lib/pipeline-loops.js` (3578) | 800 → 634 | 388 → 300 | 113 → 29 | 496 → 53 | 5 → 4 |
| `lib/render.js` (3579) | 579 → 465 | 311 → 209 | 75 → 45 | 320 → 101 | 5 → 3 |
| `lib/render-session.js` (3579) | 435 → 423 | 228 → 202 | 75 → 42 | 199 → 73 | 2 → 2 |
| `lib/render-settings.js` (3579) | 879 → 786 | 194 → 145 | 39 → 28 | 357 → 83 | 1 → 1 |
| `lib/render-swipe.js` (3579) | 420 → 335 | 184 → 128 | 41 → 29 | 106 → 92 | 5 → 3 |
| `lib/home-swipe-prompt-opts.js` (3579, new) | — → 24 | — → 9 | — → 10 | — → 25 | — → 1 |
| `lib/dispatch-factory.js` (3580) | 545 → 490 | 208 → 169 | 181 → 49 | 913 → 193 | 6 → 5 |
| `lib/dispatch-validation.js` (3580) | 182 → 146 | 77 → 57 | 42 → 20 | 114 → 61 | 1 → 2 |
| `lib/task-page-loader.js` (3590) | 441 → 488 | 287 → 257 | 77 → 13 | 198 → 204 | 2 → 3 |
| `lib/dispatch-entrance.js` (3592, new) | — → 11 | — → 3 | — → 3 | — → 7 | — → 2 |
| `routes/dispatch.js` (3592) | 1,150 → 1,051 | 348 → 331 | 122 → 63 | 1,883 → 1,653 | 5 → 4 |
| `routes/proxy-dispatch.js` (3592) | 1,005 → 846 | 289 → 250 | 93 → 52 | 1,726 → 1,456 | 5 → 5 |
| `routes/proxy-kickoff.js` (3592) | 295 → 250 | 71 → 65 | 62 → 41 | 556 → 521 | 4 → 4 |
| `lib/kpi-stats.js` (3591) | 598 → 463 | 152 → 99 | 77 → 9 | 418 → 119 | 3 → 3 |

**`adf.js` is measured end to end, from the baseline to head.** Head includes two feature additions: LIN-3564 (inline code) and LIN-3570 (nested lists and italics). So its +23 code lines are not one rebuild's delta. `rebuild-ladder.md` gives the per-rung figures.

**The rungs 2–4 figures here match `rebuild-ladder.md`'s table**:
- render-roadmap: 375 → 364 code lines, 115 → 88 decision points.
- proxy-reads: 448 → 378, 98 → 72.
- writes + rulings: 929 → 619, 267 → 196.

## Places per decision: the Drift / coherence census, same two commits

**`known-decisions.sh`** (`docs/papers/harbour/coherence-as-it-grows-scripts/`, 11 named decisions, counted in files) was run with `git show origin/main:… | bash -s 2a07f3ea 91fca7dd`.

| Commit | terminalStates | fenceParse | tsParse | fmtDuration | stampClassifier | sessionClass | shipLayout | segmentRank | ledgerHeading | pageShell | storeClear | Prod files |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| `2a07f3ea` | 5 | 0 | 0 | 5 | 8 | 6 | 4 | 2 | 6 | 15 | 19 | 429 |
| `91fca7dd` | 5 | 0 | 0 | 5 | 8 | 6 | 4 | 2 | 6 | 15 | 19 | 431 |

**Every count is identical.**

**`coherence-census.mjs admissions`** (production comments that admit a second copy):

| Measure | Baseline | Head |
|---|--:|--:|
| Admission lines | 123 | 120 |
| Files holding them | 65 | 63 |
| Sync-pinning tests | 34 | 34 |

Read line by line, the 8 removed lines are rewordings that the census regex no longer matches:
- 5 reappear reworded in the same file: `adf.js`, `render-session.js`, `render-settings.js`, `routes/dispatch.js` and `proxy-reads.js`.
- `render.js`'s `allowedHosts` twin is still present, as "in sync with that endpoint's `allowedHosts`".
- One was a "single source of truth" claim (`dispatch-validation.js`), not a twin.
- One described client-side ownership (`render.js` `toggleItem`).

No declared twin was retired.

Output: `S/writeup/tools/admissions-{2a07f3ea,91fca7dd}.txt`.
