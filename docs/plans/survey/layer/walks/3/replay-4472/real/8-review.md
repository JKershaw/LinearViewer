# What this stage really wrote

## Comment on LIN-4472 at 18:07:16

## Review — LIN-4472

Reviewed PR https://github.com/JKershaw/LinearViewer/pull/2436 at head `ffa70b7821e9859a403e043e1ea55d588b67ac73` (2 commits on main `5cf4f6aa2`, which is the merge base, so nothing is stale).

CI: green on `ffa70b782`. Passing checks: CI success, Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan.

### What I checked

**The conversion.** I diffed `public/task-page.js` ignoring whitespace. The IIFE and the `typeof module` seam are gone, and the file now has one `import` from `../lib/time-words.js` and one named `export { … }`. The `typeof document` guard around the only `DOMContentLoaded` listener is unchanged. `formatElapsed` and `relativeWords` are removed, and `tickClocks` and `shareTime` call `fmtDuration` and `relativeAgo` instead. `shareTime` takes an optional `now`. Nothing else in the logic changed. `grep -n "module.exports\|typeof module" public/task-page.js` returns nothing.

**The golden diff.** A word diff of `tests/fixtures/render-task-page-golden.json` shows exactly 7 additions of `type="module"` and nothing else. ✓

**The leaf.** `lib/time-words.js` is a copy of the two old server functions, byte for byte. Every server caller now imports it directly, and the re-exports are gone (commit `ffa70b782`). It is allow-listed in `SHARED_MODULES`, mapped in `areas.json`, and served with its exact bytes (`shared-modules.test.js`). This follows John's answered ruling `lin4472-served-leaf` ("extract"), which supersedes the Session-fit line's "no serving change".

**The tests.** I ran the task-page, timeline, lin-3975, census, bridge, golden, shared-modules, time-words and area-note suites on head (30 files): **557 pass, 0 fail**.

**Mutation checks.** For each check I broke the code, re-ran the test that claims to cover it, then reverted:
| mutation | test that went red |
|---|---|
| `tickClocks` prints a raw number instead of `fmtDuration` | `lin-3975-task-run-links` (1 fail), `task-page-client` (1 fail) |
| `shareTime` text set to `'x'` | `lin-3975-summary-and-time` + `lin-4472-time-words` (2 fail) |
| the `DOMContentLoaded` listener removed | `task-page-client` / `-question` / `task-timeline-client` (20 fail) |
| `pageWorld` stops running `classic: ['close-out.js']` | `task-page-client` (2 fail: the real close-out cases d and f) |
| `SCRIPTS` entry put back to a classic string | golden + bridge-inventory (8 fail) |
| a re-export of `fmtDuration` added to `render-run-steps.js` | `lin-4472-time-words` guard (1 fail) |
| `proposalsUrlOf` returns `'x'` | `lin-3975-proposal-refresh` (2 fail) |
| `TIMELINE_WINDOW_MS = 1` | `task-timeline-client` (1 fail) |
| **real browser:** the import changed to `../lib/time-words-missing.js` | `tests/e2e/task-page.spec.js` (5 fail with retries off). The e2e suite catches a page module that fails to load. |

**Regression check.** `git log` on every changed lib file and `public/task-page.js` shows no reverted change and no earlier fix that this change touches. The only commits since the ticket was filed are piece 1's (`7efb0b83e`, `122f95e4c`, `0efb4b820`), and they are already in the base. The close-out.js order in `SCRIPTS` (LIN-4040) is unchanged.

**Caching.** HTML is `no-store`, and `express.static` revalidates `/task-page.js` by ETag on every load. So a reader with an old page cannot end up running the new module file as a classic script.

### Isolated, or one of a class?
The class is duration and relative-time wording that is copied instead of imported. Siblings I found:
- `public/session.js` `formatElapsed`, `public/observation.js` `formatRuntime`, and `public/live-console.js` `fmtDuration` (no hour rung). **Outside**: each lives on a page that is not converted yet, and the parent's order puts each one in its own piece. The builder already recorded them as a `## Waiting` entry in `docs/areas/front-end-browser.md`. Nothing more to file.
- `lib/task-timeline.js` `gapWords` (adds a day rung and rounds to minutes) and `live-console.js` `describeSpan` ("47 minutes", "2 hours") are **not copies**. Each is a deliberately different wording.

**Leftovers `Retires:`** names the `docs/areas/front-end-pages.md` quiet-offers flake entry, and the diff does remove it. ✓ The e2e change behind it (`expect.poll` on the offers' offset) is outside the plan's listed places. It is small, and it is settled by that retirement, so this is not a finding.

### Against what was asked, sentence by sentence
- *Convert `public/task-page.js` top down, tests as plain imports.* Met.
- *Replace the IIFE and seam with named exports; `SCRIPTS` entry becomes `{ module: '/task-page.js' }`.* Met.
- *Preserve listener order and behaviour; assigns no `window.*`.* Met. The page still has one listener, and it is still last. The bridge inventory pins that there are no `window` writes. One edge changed: `fmtDuration(Infinity)` returns `null` where the old clock printed `Infinityh`. No page path can produce a non-finite span (an unparsed start is skipped), so the page behaves as before. Pinned by `lin-4472-time-words`.
- *Add nothing to the bridge.* Met. `bridge-inventory` shows that only `cost-format-global.js` writes.
- *Migrate the suites that run task-page.js via loadWorld/module.exports, using the piece 1 helper; load close-out.js through the classic-sibling loader.* Met, for all five suites that executed the file (the brief named three; the surveys found the other two). `close-out.js` goes through `runClassic`, and the mutation above shows it really runs.
- *Script-scope `world.run` probes become exports or go.* Met. The `relativeWords` text slice became a test of the exported `shareTime`.
- *Each migrated suite must read shorter than before.* **Met only in part.** `lin-3975-task-run-links` grew from 228 to 232 lines. That is because the old 4-line vm parity test against the removed twin became a behaviour test. Close-out fix F1 below makes it shorter. Every other migrated suite is shorter. `run-control` and `chat-fold` only had their source anchors changed, so they don't count as migrated suites.
- *Don't hide complexity in the helper; say so in the PR.* Met. `task-page-world.js` (36 lines) is shared by three suites, and the PR says so.
- *Replace helpers in task-page.js that duplicate a common.js global or lib export.* Met, for the two real duplicates, which have different names from their twins. This went beyond the name-only search, as the ruling allowed.
- *Golden only for the module tag.* Met.
- *Delete the module-capable-loader Waiting entry; update the source-map description.* Met.
- *Testing strategy* (suites rerun, census falls 102 → 100, grep empty, full unit suite). Met: CI runs the full unit suite, and I reran the targeted suites.
- *Retires, named in the PR.* Met, except that the PR body is now stale. See F2.
- *Acceptance: merged and verified on its own.* That is close-out's job and the post-deploy step below.

### Fixes for close-out to make
- **F1. `tests/unit/lin-3975-task-run-links.test.js` must read shorter.** Move the test `the page's running clock paints fmtDuration's words for every span it can show` (currently `:211–221`) into `tests/unit/lin-4472-time-words.test.js`, inside its `describe`, and change that file's import to `import { shareTime, tickClocks } from '../../public/task-page.js';`. In run-links, delete the now-unused imports of `createFakeDom` and `tickClocks`. Change the header bullet at `:10` to say that the server's running suffix is fmtDuration's words and that the page's clock is pinned in `lin-4472-time-words.test.js`. I tried this: run-links becomes 218 lines (base 228), both suites pass (24/24), and the moved test still fails when `tickClocks` stops calling `fmtDuration`. The test belongs beside the leaf it pins anyway.
- **F2. PR #2436 body is stale since `ffa70b782`.** The "What changed" bullet says `render-run-steps.js` and `task-page-loader.js` "re-export them, so no caller changed". Change it to say that every server caller imports `lib/time-words.js` and that a guard in `lin-4472-time-words.test.js` forbids re-exports. Also update the run-links row in the "shorter" table after F1.
- **F3. Nits in `tests/unit/task-page-client.test.js`:** remove the unused `(t)` parameter on `a guest share state URL reports gone`, and remove the extra blank line left where `load()` was removed (just after the imports).

### What CI Did Not Prove
- **Inside.** Claim: *the task page behaves as before in browsers other than Chromium.* CI's Playwright runs Chromium only (no `projects` in `playwright.config.js`). The claim needs a real browser to load a module script at the root that imports `../lib/time-words.js` under `script-src 'self'`. **After the deploy:** open a live owner task page with a running stage in Safari and in Firefox. It is right if `/task-page.js` and `/lib/time-words.js` both return 200 with a JavaScript MIME type, the console shows no error or CSP refusal, the stage clock reads `in progress · Xm` and ticks, and the share list shows "N minutes ago". It is wrong if the clock stays at its server text and the console shows a module or MIME error. **Rollback:** revert the squash commit of #2436. Nothing is persisted and no third party consumes it, so the change is fully reversible.
- **Inside.** Claim: *merged and verified on its own after piece 1* (acceptance). **After the deploy:** on the deployed site, load one owner task page and one guest share page (`/t/<token>`). The poll repaints the header without a reload, and there is no `pageerror`. Same rollback as above.

### Verdict
Approve — conditional on close-out discharging the ledger

Close-out makes F1–F3 before the merge and re-checks CI on the new head. After the deploy, it runs the two live checks above.

