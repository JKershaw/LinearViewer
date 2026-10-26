**Input 1: code review.** Written on 26 Oct by a fresh reader not involved in the work, comparing `8e59ed62` (23 Oct) with `d3f67854` (26 Oct), midpoint `686dd07b`. Its read-only checkouts and its own scratch files are not in the repo.

---

# Has Harbour got simpler? 23 to 26 Oct 2026

Base `8e59ed62` (23 Oct), midpoint `686dd07b` (25 Oct 18:27Z), head `d3f67854` (26 Oct 06:44Z). 153 commits: 137 in the first half, 16 in the second.

## 1. Verdict

**Overall: more complex. Confidence: high for the totals, medium for each half.**

**First half (23 to 25 Oct): about the same in structure, and bigger.** There were real wins. The Next run page was deleted (−2,227 production lines). The two 1,300 to 1,500-line router closures were broken up. Eight duplicated CSS blocks went, and two import knots were untied. Against that, production code grew by 6,732 lines and decision points by 1,680. Census groups (one decision held in many places) rose from 491 to 524. Most of the router work moved code rather than removing it: the dashboard split was 75% verbatim and added 430 lines net.

One correction to the brief: this half was not only structural. It already includes Home's opened-task work (`8ecce6bc`, +1,457 production lines) and a large Settings and model-routing build-out.

**Second half (25 to 26 Oct): more complex.** This half was mostly page features: +2,993 production lines, +630 decision points and +324 CSS lines. It undid part of the first half's CSS consolidation. The decision panel copied the Settings field and text-control rules instead of reusing them. Literal spacing went back to its series base (903, against 904 at the series base). New rules were also derived in client code, mainly `public/prompt-section.js`. That file now holds the longest function in the codebase.

## 2. Measures

Production means `lib/`, `routes/`, top-level `public/*.js` and `*.css`, and `server.js`. Line counts are `wc -l` over committed objects. "Shape" and "seams" are the repo's tools, with Harbour's scope and the head `areas.json` used for all three commits.

| Measure | Base | Mid | Head | Δ first half | Δ second half | Δ total |
|---|---|---|---|---|---|---|
| Production lines | 202,744 | 209,476 | 212,469 | +6,732 | +2,993 | **+9,725 (+4.8%)** |
| · `lib/` (incl. components) | 119,269 | 124,920 | 126,677 | +5,651 | +1,757 | +7,408 |
| · `routes/` | 26,955 | 28,442 | 28,559 | +1,487 | +117 | +1,604 |
| · `public/*.js` | 32,312 | 32,015 | 32,802 | −297 | +787 | +490 |
| · `public/*.css` | 19,551 | 19,596 | 19,920 | +45 | +324 | +369 |
| · `server.js` | 4,657 | 4,503 | 4,511 | −154 | +8 | −146 |
| Production files | 496 | 540 | 546 | +44 | +6 | +50 (57 added, 5 deleted at head; 3 vendor `.min.js` moved out of the top level) |
| Test lines (tests/ plus `*.test.*`, js/mjs) | 361,115 | 381,121 | 389,123 | +20,006 | +8,002 | **+28,008 (+7.8%)** |
| Test files | 1,052 | 1,190 | 1,230 | +138 | +40 | +178 |
| Shape: code lines | 97,121 | 101,078 | 102,600 | +3,957 | +1,522 | +5,479 |
| Shape: comment lines | 72,635 | 75,102 | 76,106 | +2,467 | +1,004 | +3,471 |
| Shape: functions | 9,249 | 9,913 | 10,126 | +664 | +213 | +877 |
| Shape: decision points | 28,252 | 29,932 | 30,562 | +1,680 | +630 | **+2,310 (+8.2%)** |
| Shape: units over complexity 10 | 752 | 793 | 815 | +41 | +22 | +63 |
| Functions over 100 / 200 code lines | 144 / 52 | 155 / 56 | 156 / 55 | +11 / +4 | +1 / −1 | +12 / +3 |
| Longest function (code lines) | 1,535 `createWorkspaceApiRoutes` | 1,432 `prompt-section.js` IIFE | 1,591 same | | | |
| Seams: area links / cross-area imports | 61 / 971 | 56 / 1,118 | 56 / 1,138 | −5 / +147 | 0 / +20 | −5 / **+167** |
| Seams: knot pairs / areas in the cycle | 11 / 9 | 9 / 8 | 9 / 8 | −2 / −1 | 0 | −2 / −1 |
| Census groups / mustRule / table | 491 / 85 / 277 | 524 / 94 / 285 | 532 / 95 / 287 | +33 / +9 | +8 / +1 | **+41 / +10** |
| CSS lines (files) | 19,551 (34) | 19,596 (33) | 19,920 (35) | +45 | +324 | +369 |
| CSS literal / token spacing | 900 / 661 | 898 / 649 | 903 / 675 | −2 | +5 | +3 / +14 |
| Distinct font sizes / breakpoints | 74 / 13 | 74 / 13 | 74 / 13 | 0 | 0 | 0 |
| Button-like classes | 37 | 35 | 36 | −2 | +1 | −1 |
| CSS duplicate blocks (`--dup-blocks`) | 35 | 28 | 29 | **−7** (8 gone, 1 new) | +1 (1 gone, 2 new) | −6 |
| CSS classes with no emitter (my heuristic, see §5) | 25 | 41 | 38 | +16 | −3 | +13 |
| `docs/architecture/` bytes | 242,860 | 314,189 | 331,918 | +71k | +18k | +89k (`ui-pieces.md` new, 72.5 KB) |

Outside production and tests, the first half added +127k lines under `docs/` (mostly paper data JSON) and +35.8k under `experiments/`. It deleted `prototypes/` (−2,745 lines).

## 3. Biggest simplifications

1. **The Next run page was retired** (`2c836676`, LIN-3912). Deleted: `lib/next-run.js` (1,003 lines), `public/next-run.js` (583), `next-run.css` (428), `routes/next-run.js` (222) and `render-next-run.js` (157). That is −2,227 production lines and −2,214 test lines net, plus `prototypes/`. This is the only large real deletion in the period.
2. **The router closures were broken up** (`b133a713` LIN-3742, then LIN-3842/3872/3876/3877/3883/3893/3894). `routes/workspace-api.js` went from 3,782 to 882 lines and `routes/dashboard.js` from 3,072 to 872. The two longest functions (1,535 and 1,288 code lines) are gone. This makes the code easier to navigate, but it is a move, not a reduction: the dashboard split is 75.2% verbatim (`verbatim.mjs`) and +430 lines net, and cross-area imports rose from 971 to 1,118.
3. **Settings untangle 3/4** (`ab481a49`, LIN-3889). Duplicate CSS blocks fell from 35 to 28: `.settings-link`, `.settings-subtitle`, the `.line` key/value row in 4 files, the back link in 3 files, and the text control in 3 files. `common-actions.css` went from 327 to 201 lines and `audit.css` from 453 to 422. Halt controls now have one implementation (`lib/components/halt-controls.js`). Net −49 production lines.
4. **Nine settings switches that did nothing were removed** (`d738a767`, LIN-3848): −244 production lines net.
5. **Copies of the harness, model and effort lists were removed** (`d53bb5bc` and `dfeabc20`). The census groups `DEFAULT_HARNESS`, `DISPATCH_CLAUDE_MODEL_SUGGESTIONS` and `DISPATCH_HARNESS_SUGGESTIONS`, each duplicated between `lib/render-settings.js` and `public/common.js`, are gone. `settings-change-panel.js` was deleted. This is a real consolidation of the decision, but both commits added code overall (+506 and +572 net). Separately, the two knots Front end↔LLM & prompts and Front end↔Providers were untied in the first half.

## 4. Biggest growth and new complexity

1. **`public/prompt-section.js`** went from 1,479 to 2,302 lines (+823). Its `init` function grew from 584 to 1,117 code lines, and the module IIFE from 956 to 1,591, now the longest function in the repo. Most of it came from `8ecce6bc` (+573), with `dfeabc20`, `a444390b`, `4f75f00d` and `2ab5e675` adding more. The client now holds run rules itself (see §5).
2. **Settings and model routing**: files matching `settings` or `model-routing` went from 4 files and 2,086 lines to 28 files and 5,683 lines. The main commits are `9f7acff7` (+1,165 net: change log, per-area pages), `68eec35a` (+865: model-routing store), `d53bb5bc` (+506) and `8bbd6b5f` (+418). Part of this is new features, not only restructuring.
3. **The dispatch store**: `lib/dispatch-store.js` went from 3,050 to 3,643 lines and is the largest `lib/` file. `fcab9f71` (lean/digest reads, +526 net) also added `dispatch-lineage-status.js` (243) and `dispatch-session-read.js` (89).
4. **Second-half page features**: Live Console `273385fc` (+751; `lib/live-console.js` 904 → 1,323), Observation `d3f67854` (+514; `public/observation.js` 4,513 → 4,833, the largest JS file), Home polish `a444390b` (+377) and decision-panel rounds `4f75f00d`/`33bedfaf` (+265). `public/style.css` grew from 4,372 to 4,948 lines; it took the consolidated pieces (+149) and also every new piece (+217 Home, +122 panel, +41 tabs).
5. **More decisions held in several places**: census groups rose from 491 to 532 and mustRule from 85 to 95. New groups include `{'effort','harness','model'}` in 4 files (one of them `public/prompt-section.js`), `inForce == 'opencode'` (`lib/components/decision-panel.js` and `public/prompt-section.js`), `why == 'again'`, `state == 'dead'` (`lib/render-session.js` and `public/live-console.js`), and `scope == 'current'` in 9 files. The docs grew alongside: `ui-pieces.md` is new at 72.5 KB, and `source-map.md` is 166 KB in 365 lines.

## 5. Duplication and leftovers (head unless noted)

**The same decision in two places**
- **Field row and text control.** `public/style.css:1301-1331` (`.decision-panel-field`, `-label`, `-control`) is byte-identical to `public/settings.css:741-773` (`.settings-field*`), and was added by `dfeabc20`. `.settings-field*` now has one emitter left: `lib/render-settings-models.js:255-256`.
- **Text control authority.** `ui-pieces.md` decision 15 names `.model-select`/`.token-label-input` (`style.css:3470ff`) as the one authority. But `.model-select` has had no emitter since `d53bb5bc`, and two new text-control bodies exist (`settings.css:759`, `style.css:1320`). The consolidation in `ab481a49` was overtaken within a day.
- **Terminal state types.** `public/prompt-section.js:1114` `FINISHED_STATE_TYPES` repeats `public/common.js:17` `window.TERMINAL_STATE_TYPES`; it was added in `8ecce6bc`.
- **Words parsed back out of HTML.** `public/prompt-section.js:1155-1165` regex-parses the server-rendered panel HTML and un-escapes it (`unescapeText`, a copy of the inverse of `lib/utils/html.js`) to recover words. `routingWords` (`lib/components/decision-panel.js`) already computes those words on the server. The census flags `unescapeText` as a tiny-rule clone.
- **Web target rule.** "Web needs Claude Code" lives in `public/prompt-section.js:1170` and `:1209`. A text search of `lib/` and `routes/` found no server check for it.
- **"Why this step is next" is worded twice.** The server version is `lib/render-task-page.js:198-206` (`renderNextLine`) and the client version is `public/prompt-section.js:1068-1080` (`renderStepLine`), with different words for the same states.
- **Two tab strips.** `lib/components/tabs.js` with `style.css:4913`, and `task-edit.css:143-170`. This is acknowledged in `ui-pieces.md`.
- **Two button systems are still live.** `.btn` is emitted from 13 files and `.action-btn` from 14. The new page-local `.obs-filter-btn` (`observation.css:1441`) adds a third look.
- **Pre-existing, untouched:** `style.css` and `swipe.css` both carry `.sessions-header` (4742/971), `.sessions-refresh` (4760/989), `.session-header` (4793/1022) and `.session-summary` (4828/1057). Home links `swipe.css` (`lib/render.js:303`).

**Leftovers**
- **CSS with no emitter that became dead during the period.** I tokenised all JS under `lib/`, `routes/` and `public/` plus `server.js`; dynamic class names can cause false positives.
  - `audit.css:78` `.model-form`, `:106` `.model-current`, `:112` `.model-id` (`d53bb5bc`)
  - `proxy.css:291` `.token-show-more`, `:338ff` `.runner-credential-*` (7 classes)
  - `settings.css:26` `.settings-group-subtitle`, `:280` `.feature-note`, `:286` `.feature-desc`, `:314` `.field-muted`, `:319` `.provider-blocked` (`9f7acff7`/`8bbd6b5f`)
  - `runner-setup.css:19,40` `.runner-setup-note` (`f6b4862c`)
  - `style.css:3470` `.model-select`
- **Comments that still cite the deleted `next-run.js`:** `public/common.js:253, 1435, 1810, 1853`; `public/ship-journey.js:177, 635`; `public/ship.js:1272`.
- **`lib/` modules that no production file imports (pre-existing, used only by their own tests):** `lib/bash-tool.js` (163 lines), `lib/observer-efficacy-signal.js` (407), `lib/plan-fee-config.js` (20), `lib/swim-graph.js` (141).
- **Run output committed to the repo:** `experiments/rebuild-rung7/replay/work/` holds 13 files and 1.5 MB, including six copies of `routes/workspace-api.js` at 4,673 lines each (`ea4c6f88`).
- **`source-map.md` misses 14 of the 57 new production files:** `lib/model-routing-{edit,spend,summary,validate,harnesses}.js`, `routes/proxy-model-routing.js`, `lib/pipeline-churn.js`, `lib/dispatch-session-read.js`, `lib/connection-secondary-remint.js`, `lib/harbour-token-format.js`, `lib/settings-copy-first-card.js`, `lib/components/{settings-spend-bar,head-meta}.js` and `public/stage-track.css`.
- **The "status at head" tables in `ui-pieces.md` are snapshots.** The consolidation figures it records (literal spacing 904 → 890, CSS 19,888 → 19,750) no longer hold: today the figures are 903 and 19,920.

## 6. What one simplification pass should target, in order

1. **`public/prompt-section.js`.** Move step fit, the web-target rule and the next-step words into the server model; the task page already has `renderNextLine`. Have the panel route return words as JSON instead of parsing HTML. Drop `FINISHED_STATE_TYPES`. Then split `init` (1,117 lines).
2. **CSS left behind by the Settings and panel work.** Fold `.settings-field*` into `.decision-panel-*`, or the reverse, and pick one text control. Delete `.model-select` and the 20 or so dead classes listed in §5. Re-run `--dup-blocks` and the literal-spacing count to get back below the Consolidate figures.
3. **One button system.** Move the 14 `.action-btn` emitters and `.obs-filter-btn` onto `.btn`, or record why not. Move the task-edit tabs onto `tabs.js`.
4. **Pre-existing duplicates.** Remove the `style.css`/`swipe.css` session-list duplicates and stop Home loading `swipe.css` if nothing needs it.
5. **Repository clutter.** Remove the replay `work/` copies, the stale `next-run` comments and the four test-only `lib/` modules, or wire them in.
6. **Size hot spots.** Then look at `public/observation.js` (4,833 lines), `lib/dispatch-store.js` (3,643) and `style.css` (4,948). Keep `ui-pieces.md` to its decisions and move the per-PR status history out.

## Not measured

- No tests were run, and no behaviour was checked at runtime.
- I did not run `cochange.mjs` or `retention.mjs`.
- `verbatim.mjs` was run only on the dashboard split.
- Census "new" and "gone" include groups that were only re-keyed; I read only the larger ones.
- The dead-CSS count is a token heuristic: class names built at runtime can show up as false "dead".
- I did not review e2e, visual or judge tests, the large `docs/` and `experiments/` additions, or performance.
- Area figures depend on the head `areas.json`.
- Housekeeping: early in the review I wrote three listing files (`ls-8e59ed62.txt`, `ls-686dd07b.txt`, `ls-d3f67854.txt`) into this review folder. The rules did not allow deleting them, so they are still there and can be deleted.
