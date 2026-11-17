# What this stage really wrote

## Comment on LIN-4446 at 15:31:20

## Close-out — LIN-4446

**Merged:** PR [#2423](https://github.com/JKershaw/LinearViewer/pull/2423), squash commit `92676b1febeb5407878d69b5e7a8f166a9371777`, pinned with `--match-head-commit ad24a2102f0aa0fac4ec5ccbbe5075d660b8b67b`. Deployed: the harbour.cat footer shows `92676b1`.

**How it meets what was asked:** as the review's sentence-by-sentence account says. `lib/cost-format.js` is the one formatter, served unchanged at `/shared/cost-format.js` through the `SHARED_MODULES` allow-list. The reading of the no-build-step rule (browser may import natively) is in `CLAUDE.md` and `docs/areas/front-end-browser.md`. One shared piece was taken; no view was reworked or retired. The retired copy and its parity test are named in the PR (`public/cost-format.js`, 34 lines; `tests/unit/cost-format-parity.test.js`, 74 lines), as is the swipe viewport retirement.

**Changes I made after approval** (commit `ad24a2102`, on the PR branch):
- `tests/unit/cost-format-consumers.test.js`: title and comment now say "the shared formatter's words" (blind read, fix 1).
- `tests/unit/cost-format.test.js`: removed the false "parity comparison it used to carry" sentence and the unused `export` on `TABLE` (blind read, fix 2).
- `docs/areas/front-end-browser.md`: two `## Waiting` entries, for the module-to-global bridge's missing general timing guard and for the hand-synced `public/ship.js` / `public/ship-biscuit.js` copies (blind read, "larger" items).
- PR body: names the swipe viewport retirement and its witness `tests/unit/render-swipe.test.js`; the totals now read 35 files, +790 / −287; the "serving tests not run against HEAD" gap is replaced with the reviewer's mutation M8 evidence (review fix 1).

**Ledger:**
- *Chart deferral with real Chart.js, shim and CSP (inside):* discharged pre-merge by the reviewer's Chromium check. Head draws `$` ticks with no errors; main's `workspace-kpis.js` throws. Not re-run live: it needs an authenticated workspace with priced lineages.
- *Same behaviour outside Chromium (inside):* only Chromium ran. Named rollback is the review's: revert merge commit `92676b1fe`, with no migration or data-shape change.
- *John's read of the result (inside, human-only):* **not run, and not recorded.** It is a read only John can do and does not gate the merge or deploy. Please read this comment and PR #2423's body, then record your read as a comment here. **No next slice should be dispatched until that comment exists.** The review asked for the read before Done; the close-out rules say a post-deploy check I cannot run does not hold the close, so I am closing and leaving this open for the operator.
- Live verification after deploy: `/shared/cost-format.js` is byte-identical to `lib/cost-format.js` (200, `application/javascript`); `/shared/nope.js`, `/lib/cost-format.js` and `/cost-format.js` are 404; `/cost-format-global.js` is 200.

**Larger and outside finds:** all are `## Waiting` entries in `docs/areas/front-end-browser.md` (the `common.js` twins, a module-capable test loader, the `observation.js` size, and the two added today). The blind read found nothing outside the area, so I filed no tickets. There are no related tickets to tidy: the ticket has no relations or children.

**CI:** green on the exact merged head `ad24a2102`. That is Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan and CI success. Locally I ran the two edited suites, the area-note suites, `shared-modules` and the CLAUDE.md budget suite (all pass).


## LIN-4446 description's `## Implementation Plan` section, rewritten after 15:31:25 (the last snapshot still has step 6's plan; this is the description as read 17 Nov, everything above the section unchanged; the close-out session's last request was 15:31:50)

## Implementation Plan

Implemented: slice 1 (one shared cost formatter) merged as PR [#2423](<https://github.com/JKershaw/LinearViewer/pull/2423>), commit `92676b1febeb5407878d69b5e7a8f166a9371777`, deployed. The plan was implemented as approved after its one revision, with one sanctioned addition: the swipe viewport fix, a leftover-step retirement named in the PR. The discharged plan, revision note, research and scoping text are preserved in the task snapshots and the comment trail.

`fits one session`: one shared piece, a handful of files, one wrapped initializer and one real-browser check.

plan-review due: no

### Still open

John's read of the slice's result is not recorded (see the close-out comment). No next slice starts until it is.
