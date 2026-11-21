# Slice 3: pre-landing readings (LIN-4514)

These readings were taken on 21 Nov, before verdicts and changes became records (LIN-4513). They are reported, never a
gate. The readers that parse verdicts out of comments retire in P7 (LIN-4520), and from P6 (LIN-4519) the measures
read records from a cutover instant. So this history is committed now, and nobody re-derives it later with a parser
that is gone (lesson LIN-4505, `docs/areas/reports-and-operator-tools.md`).

| File | What it holds |
|---|---|
| `history-2026-11-21.json` | Blind-read results and review round trips over history. Written by `scripts/slice-3-pre-landing-readings.mjs` through the workspace proxy |
| `production-2026-11-21.json` | Held runs, how long records addressed to them sat, and blind-read queries from the query log. Read from production with `production-read.mjs` |
| `production-read.mjs` | That production read: read-only, run in `harbour-cat` through `railway ssh`. It prints counts and record ids only |
| `cutover-query.mjs` | LIN-4517 (P4): the read-only cutover query. Open tasks whose latest review, plan review or blind read is a comment with no verdict record, open tasks whose latest review's ledger carries items (including those `isEmptyStatement` misreads as empty), and open tasks with no verdict record at all. Its `dump` step runs in `harbour-cat` through `railway ssh` (records); its `query` step runs locally through the workspace proxy (ticket states and comments). It prints counts, task ids and ticket ids only. Tested in `tests/unit/lin-4517-cutover-query.test.js`; run again inside P5's fleet pause. Its `needsImportOrReReview` is the selection of the one-off verdict import, `scripts/records/slice-3-verdict-import.mjs` (LIN-4517; runs only if John rules "import") |
| `cutover-2026-11-21.json` | That query's first production reading (21 Nov 04:09Z), the "before" count for P5's pause |
| `cutover-2026-11-21-after-import.json` | The query rerun after the one-off verdict import was applied in production (21 Nov 08:06Z dump): 9 tasks remain, exactly the import's named skips (LIN-2153, LIN-2919, LIN-751, LIN-2626, LIN-2627, LIN-2634, LIN-4452, LIN-4441, LIN-4491). 21 verdicts are marked `via: import`. P5 reruns the query and the import inside its fleet pause |

The same readers, applied to the frozen walk-8 trails and seeds, are in `tests/fixtures/walk-8/comment-path/goldens/readings.json`.

## The readings

| Reading | Value | Source and window |
|---|---|---|
| Blind-read results (measure 1) | 65 landings: 39 read before merge (28 better, 11 same, 0 worse); 11 with no read on record, 13 not ordinary landings, 2 with no ticket | `blindRow` (`scripts/stability-measures-blind.mjs`) over main's first-parent landings from the blind-read gate (`eb14b7fff`, LIN-4438, 12 Nov 21:06Z) to `bc0535b5c`, against each ticket's comments. Read 21 Nov 01:30Z |
| Plan-review round trips | 9 of 49 tickets reached plan review. First-pass approval 4 of 9 (0.44, below the reader's sufficiency floor). Round trips: mean 0.67; 0 trips ×4, 1 ×4, 2 ×1 | `computePlanReviewRoundTrips` (`lib/plan-review-round-trips.js`), plan-review → plan, over the 49 tickets of the window's ordinary landings. Verdict tiers: 15 from comments (tier A) |
| Code-review round trips | 41 of 49 reached review. First-pass approval 28 of 41 (0.68, below the reader's sufficiency floor). Round trips: mean 0.39; 0 trips ×31, 1 ×6, 2 ×2, 3 ×2 | The same walk, review → implementation. Verdict tiers: 60 from comments, 4 structural (tier C) |
| Round trips, gate-due series | not measured | Plan facts were not read, and the reader alone would count those tickets as not due |
| Blind-read queries for anything beyond the change it judges and its own records | 0 query-log rows from 12 blind-read runs | Records query log, 19 Nov 16:32Z to 21 Nov 01:24Z (536 rows). The join was checked: 53 of 54 run askers match run records (review 182 rows, close-out 129, implementation 59, …) and none is a blind read. Blind reads have no brief and are told to read nothing about the task, and so far they made no records queries at all |
| Records addressed to a held run, and how long each sat | 4 held runs; 8 records addressed, 8 read; median sit 17.22 h. All 8 were addressed to `implementation`: 0.58 h, 15.13 h, and six at 17.22 h | Production, 21 Nov 01:28Z, slice 2's method (below). Slice 2's reading (20 Nov 21:35Z): 24 records, median 1.0 h, and 17.2 h for the 8 addressed to `implementation`. LIN-4499's task records, 16 of slice 2's 24, are no longer open |
| Other rows read at the same time | Open records' sit time: median 12.4 h, mean 15.1 h (232 open). Stale open runs: 2 of 5. Store: 1 change record, 3 verdict records | The same read |

**Method copied from slice 2.** This is section 1 of slice 2's readings comment on LIN-4499 (20 Nov 21:47Z, from
`d9d8c372`). It reads production through `railway ssh` into `harbour-cat` with the deployed build, read-only, using
`scripts/records-readings.mjs` (`readFromDb`). The same data then goes to `heldRunReading`
(`scripts/stability-measures-core.mjs`) for its per-record sample, split by addressee. Only reading output was
printed.

Blind-read results and round trips follow slice 1's and 2's posture: the existing readers, unchanged, over a stated
window. The window starts at measure 1's own gate, so that every landing in it could have had a blind read. The
query-log count is new in this slice, as the design says (§3).
