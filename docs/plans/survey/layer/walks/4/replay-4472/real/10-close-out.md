# What this stage really wrote

## Comment on LIN-4472 at 18:37:56

## Close-out — LIN-4472

**What merged.** PR https://github.com/JKershaw/LinearViewer/pull/2436, squash commit `0cf05ce8f5234277e5aecde1800f50f652131e33`, pinned to head `a6492a9840e31798fbbc4a2854e544d466f3ed2f`. `public/task-page.js` is an ES module; its suites import it; the duration and relative-time wording lives once in the served leaf `lib/time-words.js`. How it meets what was asked: review's account (comment "Review — LIN-4472", Approve conditional on F1–F3) stands; the golden diff is the seven module tags only, the census falls 102 → 100, and no `module.exports` remains in the page.

**Changes I made after the approval** (nobody reviews these; each with its review line):
- `a81f9673e` F1: the page's running-clock test moved from `lin-3975-task-run-links.test.js` into `lin-4472-time-words.test.js` (import `tickClocks` there), run-links' unused `createFakeDom`/`tickClocks` imports removed, header bullet updated. run-links is now 219 lines against a 228-line base (review measured 218 with a one-line header; mine is two lines).
- `a81f9673e` F3: unused `(t)` parameter on `a guest share state URL reports gone` and the extra blank line after the imports in `task-page-client.test.js`.
- `a81f9673e` F2: PR body rewritten (direct leaf imports plus the no-re-export guard; suite-length table updated, all migrated suites are now shorter).
- `a81f9673e` blind-read fix-sized finds: the export comment in `public/task-page.js` now says the listener is above and the module writes no global; `lib/time-words.js` header and `docs/architecture/source-map.md` narrowed to "every server caller" (guard scans `lib/`, `routes/`, `server.js`); the `lin-3975-summary-and-time` share-list test retitled as a wiring check (kept; not a duplicate of the exact-words test).
- `ac2f0e07a` blind-read larger find, runs-and-dispatch Waiting entry: `fmtWhen` ownership (whether `lib/time-words.js` also owns absolute UTC stamps; about five importers). The `public/session.js` / `observation.js` / `live-console.js` copies were already a Waiting entry in `docs/areas/front-end-browser.md` from the builder.
- `a6492a984` merge of main (#2435 landed meanwhile and made the PR conflicting, which also stopped CI from starting): one conflict in `docs/areas/runs-and-dispatch.md`, both sides only appended Waiting entries, kept both.

**Ledger.**
- Inside, "behaves as before outside Chromium": the part that can be checked from here is settled by evidence: after deploy, `/task-page.js` and `/lib/time-words.js` return 200 as `application/javascript`, and the served page imports the leaf. The Safari/Firefox run (clock ticks, no console/CSP error) was **not run**: no signed-in session or those browsers here. Operator can run it; rollback is reverting `0cf05ce8f`.
- Inside, "owner and guest `/t/<token>` pages repaint through polling with no reload and no `pageerror`": **not run**, same reason, same operator and rollback. Recorded on the PR (comment 6861738662).
- Outside: none were raised by review or blind read. The sibling copies are noted in the area note, not ticketed (the change broke nothing and none touches safety).

**Final CI.** Green on the exact merged head `a6492a984`: CI success, Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan (run 43482176002). Also green on `a81f9673e` before the merge of main. Local run of the touched suites on the merged tree: 618/618.

**Tidy.** Archive of the pre-prune description verified (snapshot captured 18:37 UTC, byte-identical); description pruned to a stub below the Size record. Related tickets: LIN-4471 was already Done; LIN-4463 stays In Progress, since its own done-when (blind-read comparison, remaining Waiting entries) is not settled by this piece. No gate tickets filed.

**Deployed.** Production footer shows `0cf05ce8f5234277e5aecde1800f50f652131e33`.

