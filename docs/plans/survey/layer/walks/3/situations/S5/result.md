# S5 result: proposals pile with nothing declining them

**Seed:** `area-1` (Harbour). No task, because the seed names none.

**Runs 1–6 (14–19 Nov, 09:00).** Writing as the run itself was refused: `{"rule":"5","msg":"finding-2: by run is not a declared stage or person"}`. A brief was not available either: `brief survey-place --task area-1` gave `{"error":"no task area-1 as of 2026-11-14T09:00:00Z"}`. So each run acted as **survey-place**, the nearest stage, given only `find --kind finding --to John --state open`, which showed the whole pile (0→10). Each run wrote a `run` `in` the area plus two findings to John, one of them a near-repeat: 4≈3, 7≈3, 10≈6, 13≈9, 16≈12. Run 6 spotted the repeats by reading, linked each `same-as` its original, and asked one question, `question-18`, instead of proposing more.

**John** ran `find`, saw 10 records and wrote nothing.

**Answer.** Yes, the pile still grows: 11 records are open to John (findings 3–16 and `question-18`). Nothing ends except the six runs. Nothing expires an unanswered proposal; `if-unanswered` is just text. The near-repeats were seen only because a run read them and judged them so. The layer doesn't flag them, `find --text` misses differently worded ones, and `same-as` changes no count.

**Gaps:**
- John's silence has no record. It is only a query-log line, stamped with the wall clock rather than the scene time.
- `find` has no `--as-of`, so nobody can replay what a given run saw.
- All six runs share the writer `survey-place`, so rule 6 lets any run end any other run's proposals.
- `question-18` retypes a count ("ten … none answered") that goes stale as soon as John answers one.
