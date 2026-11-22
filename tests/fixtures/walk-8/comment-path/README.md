# The comment path, frozen (LIN-4514)

What Harbour decided from comments before verdicts and changes became records (LIN-4513, slice 3). P5 (LIN-4518)
replays these inputs on records and is held to these decisions. P7 (LIN-4520) retired the comment path and its
helpers (`tests/helpers/comment-path-capture.js`, `tests/helpers/comment-path-rows.js`, the goldens' rerun test, and
`scripts/historic-comment-readers.mjs`). The files here stay as the record: the captured results are evidence, and
they cannot be regenerated any more. `tests/helpers/walk-8-frozen.js` loads them for the record-side replay.

| File | What it is |
|---|---|
| `lin-4469.json`, `lin-4446.json`, `lin-4450.json` | Frozen inputs: each ticket's real comments verbatim, each cited PR's head timeline and merge, the ticket's state over time, and walk 8's step boundaries |
| `seeds.json` | Frozen inputs for the five seeds the walks lack. Each comment says whether it is real (a LIN-4499 comment) or synthetic |
| `landings.json` | Frozen inputs for measure 1: each walk-8 ticket's own landing on main (commit, date, subject, files) |
| `goldens/lin-*.json` | The comment path's answers at every instant of each ticket |
| `goldens/seeds.json` | The answers for every seed case |
| `goldens/readings.json` | The old measure readers over each trail and seed, for P6 (LIN-4519). Where these inputs cannot carry a reader, it reads `not measured` with the reason |
| `rows.json` | The comment-path rows of lin-4438, lin-4458 and lin-4460 as data, with the cells their tests assert |

Everything under `goldens/` and `rows.json` is derived by the retired capture helper and must not be edited by hand.
Repeated text is stored once: `ledger.rawRef` points into `texts`, and `inputs.commentRefs` points into `comments`.
Read a derived file with `loadDerived` (or `resolveRefs`) from `tests/helpers/walk-8-frozen.js`, which puts them back.

Tests: `tests/unit/lin-4516-landing-replay.test.js` replays the record side against these frozen decisions. The
comment-path goldens tests and the rerun test were retired with the helper (LIN-4520).

The readings over history (blind reads, round trips, held runs, blind-read queries) are in
`docs/reviews/slice-3-readings/`.

## Known flaws of the baseline: a replay must match these, not fix them silently

**1. LIN-4469: the comment path never refused the commits no review saw.**
- The 21:49 comment ("Condition on LIN-4467's budget raise") cites LIN-4467's PR #2444. So from 22:58 the landing is
  #2444 (merged) plus #2447.
- `closeOutDecision`'s multi-PR branch has no head-moved refusal. From the 23:21:48 re-review to the merge, #2447's
  head is not the re-review's `05b592742`, yet the stop-at lane reads `partial` (then `merged`) with `refuses: null`,
  and the box reads `multiple-prs`.
- The head had already moved when the re-review was posted: `877f32cb4` was pushed at 23:18:42. Then came
  `534524f92` (23:30:04), `cc7792e58` and `350410829`, and the merge at 23:51:43.
- A records replay that marks the approval stale and refuses on #2447 is right. P5 must record it as a known
  difference from this golden, not as a regression, and not edit the golden to match.

**2. LIN-4446 and LIN-4450: close-out's own commits (ruling 1's case).**
- After the blind read, close-out pushed its own commit: LIN-4446's #2423 at `ad24a2102` (15:16:40), and LIN-4450's
  #2421 at `26299c9b0` (15:26:05).
- At those instants the stop-at lane refuses `head-moved` until the merge (15:22:55 and 15:32:12). Nothing re-read
  those commits.
- This is the case ruling 1 (LIN-4521, P8) is about. The goldens show it as the comment path saw it.

**What else bounds these inputs:**
- A head counts from the start of its first CI check run, and each head entry names its source.
- No CI check state is frozen, so run evidence's "now" reads "no checks set up".
- The ticket state is "started" until the issue's `completedAt`, because no state history is readable.
- At an instant the runs are unknown (`allRuns: null`). A seed case carries its own runs, constructed and said so.
- `findSha` reads the first head-labelled sha in a review. In these trails that is the sha the reviewer named.
