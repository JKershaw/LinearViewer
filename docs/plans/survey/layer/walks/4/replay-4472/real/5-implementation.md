# What this stage really wrote

## Summary comment on LIN-4472 at 17:50:29

**LIN-4472: summary.** Task page converted to a module, its suites imported. PR: https://github.com/JKershaw/LinearViewer/pull/2436

- `public/task-page.js`: IIFE and `module.exports` seam replaced by named exports; renderer `SCRIPTS` entry is `{ module: '/task-page.js' }`. Golden diff is the seven script tags only.
- `lib/time-words.js` (new served leaf at `/lib/time-words.js`): `fmtDuration` and `relativeAgo` now have one home; the page's `formatElapsed` and `relativeWords` copies are removed (decision on LIN-4463, `lin4472-served-leaf`).
- Suites import the module; `tests/unit/helpers/task-page-world.js` is the shared init harness. Census baseline 102 → 100.
- Retires: the seam and IIFE, the loadWorld + module.exports pattern in the task-page suites, the duplicate helpers, and the module-capable-loader Waiting entry.
- Known shortfall: "each migrated suite reads shorter" holds for most suites by a few lines, but `lin-3975-task-run-links` grew by 4 lines and two suites were re-anchored, not shortened. Details in the PR.
- Edge: `fmtDuration(Infinity)` is now `null` (old clock printed `Infinityh`); no page path passes a non-finite span.

CI on the final commit: CI success, Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, and Secret scan all pass.

## PR #2436 body (opened 17:44)

## Body

Closes LIN-4472 (piece 2 of LIN-4463). Piece 1 (LIN-4471, PR #2431) is merged.

## What changed

- **`public/task-page.js` is an ES module.** The IIFE and the `typeof module` / `module.exports` seam are gone; the page exports its pure rules and render helpers by name. The renderer's last `SCRIPTS` entry is `{ module: '/task-page.js' }`. Listener order is unchanged: the page's one `DOMContentLoaded` listener still registers last. The file adds nothing to the bridge (no `window.*` writes).
- **`lib/time-words.js` (new served leaf).** `fmtDuration` and `relativeAgo` now have one home, allow-listed at `/lib/time-words.js` and mapped to `front-end-pages`. Every server caller imports `lib/time-words.js` directly; `lib/render-run-steps.js` and `lib/task-page-loader.js` no longer re-export either name, and a guard in `lin-4472-time-words.test.js` (scanning `lib/`, `routes/` and `server.js`) fails if a server module defines or re-exports them again. The classic browser copies (`public/session.js`, `observation.js`, `live-console.js`) are outside the guard and are listed in the browser area's Waiting entry. This is the engineering call recorded on LIN-4463 (`lin4472-served-leaf`); the leaf is one file plus one allow-list entry.
- **Golden fixture:** only the seven script tags changed, to `<script type="module" …>` (checked: 7 insertions, 7 deletions, all tags).
- **Suites:** the task-page suites import the module. Pure rules are plain static imports. The init-driven tests use `tests/unit/helpers/task-page-world.js` (new, 36 lines), which sets up `importWorld` with the page's stub defaults and a fresh module instance per test.
- **Indentation-keyed source probes** (`lin-3975-summary-and-time`, `lin-3975-task-run-control`, `lin-3975-chat-fold`) now anchor on `function init(doc) {` / `function toggle(row) {`. The `relativeWords` probe is replaced by a test of the exported `shareTime`.
- **Census:** `task-page-client` and `task-timeline-client` left `CLASSIC_LOADER_SUITES`; the baseline goes 102 → 100.
- **Docs:** `front-end-browser.md` drops the module-capable-loader Waiting entry (the native-import suites are the proof); `source-map.md` describes `task-page.js` as a module and gains a `time-words.js` entry. Lessons is 3,869 bytes, under the cap.

## Retires

- the `typeof module` seam and the IIFE in `task-page.js`;
- the `loadWorld` + `window.module.exports` pattern in the task-page suites (`task-page-client`, `task-timeline-client`, `task-page-question`'s `makePage`, `lin-3975-proposal-refresh`'s URL helper, `lin-3975-task-run-links`' vm run);
- the page's copies of the duration and relative-time helpers (`formatElapsed` → `fmtDuration`, `relativeWords` → `relativeAgo`);
- the module-capable-loader Waiting entry (`docs/areas/front-end-browser.md`).

Not retired: `question-cards.js` still runs through `loadWorld` in `task-page-question`'s second describe, and `task-chat.js` through `loadWorld` in `lin-3975-proposal-refresh`. Both are other views' classic scripts, so those suites stay in the census.

## Behaviour notes

- **`fmtDuration(Infinity)` is `null`.** The page's old `formatElapsed(Infinity)` returned `"Infinityh"`. I checked the old function in git. No page path can pass a non-finite span: `tickClocks` skips unparsed starts, and `Date.now()` minus a parsed start is finite. The witness `tests/unit/lin-4472-time-words.test.js` pins the new value.
- **`shareTime(doc, value, now)`** takes an optional `now`, so its words are testable without stubbing the clock. Its `now` default is the same `new Date()` that `relativeAgo` uses.

## Witnesses

- Each migrated suite was run after its conversion (task-page-client 52/52, task-timeline-client 9/9, task-page-question 22/22, proposal-refresh 9/9, run-links 20/20, summary-and-time 28/28, run-control 31/31, chat-fold 14/14).
- **Mutation:** I broke `fmtDuration` in `lib/time-words.js` (`${totalSec}s` → `${totalSec} s`). `lin-4472-time-words` and `lin-3975-task-run-links` both failed (1 failure), then the file was restored and both passed.
- `grep -n "module.exports\|typeof module" public/task-page.js` returns nothing.
- Real browser: `npx playwright test tests/e2e/task-page.spec.js tests/e2e/task-timeline.spec.js`: 18 passed locally.
- Local targeted unit run: the 175 suites that touch the task page, the leaf, the allow-lists, the census, the bridge, the area notes and the source map, plus `scripts/code-shape` and `scripts/eval`: all green (5,539 + 122 tests). The full unit suite is left to CI, per the repo's CI rule.

## Suite lengths

The acceptance says each migrated suite must read shorter. Each does (`run-control` and `chat-fold` only had source anchors changed):

| suite | before | after |
|---|---|---|
| task-page-client | 707 | 700 |
| task-timeline-client | 256 | 250 |
| task-page-question | 344 | 341 |
| lin-3975-proposal-refresh | 247 | 242 |
| lin-3975-summary-and-time | 372 | 369 |
| lin-3975-task-run-links | 228 | 219 |
| lin-3975-task-run-control | 615 | 615 (re-anchored, not migrated) |
| lin-3975-chat-fold | 198 | 198 (re-anchored, not migrated) |

`lin-3975-task-run-links` first grew by four lines (the replacement clock test); close-out moved that test beside the leaf it pins, into `lin-4472-time-words.test.js`, so run-links is now shorter than its base. The shared helper (`task-page-world.js`, 36 lines) is the added complexity; it is shared by three suites, not hidden in one.

## Notes for review

- Only `public/task-page.js` changed in `public/`. The bridge inventory now lists `task-page.js` among the emitted modules, which the inventory test pins.
- The parent ticket's Session-fit line ("no serving change") is superseded by the LIN-4463 engineering call that extracts the leaf; this PR follows that call.

