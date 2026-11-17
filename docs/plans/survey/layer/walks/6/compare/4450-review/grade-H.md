# Grade: LIN-4450, review stage, Reader H, as of 2026-11-13T15:12:24Z

Read: `key.md`, `answers-H.md`, `grade.md` (for the standard used on T and S).

| # | Question | Reader H |
|---|----------|----------|
| 1 | What is addressed to this stage | **partly**: names PR #2421 at the right head `f9fa4a80c…` and the "Merge is for review and the orchestrator" line. Doesn't say to review it against `## As asked` or the LIN-4445 departures, and misses the out-of-plan `Retires:` extra (`isHermeticTestToken`). Its "no record is addressed to the stage" adds nothing on what the stage must act on. |
| 2 | What is open, and whose | **right**: has all four key items with the right owners: review/merge (review and the orchestrator), the LIN-4452 live check needing John's credential, LIN-4451 blocked on merge, and the bulk-read note in `providers.md`. Small gaps: the property PUT/GET isn't named as waiting on LIN-4452, and the createIssue size guard isn't said to be LIN-4451's job. Extras (check-69, findings 79/80/88) are framed as covered by LIN-4452 or as area items, so they don't misstate ownership. |
| 3 | Is 32,768 characters still the rule | **right**: No. It's 32,768 UTF-8 bytes of the serialized property, JSON escaping included, the stricter reading (departure 2, decision-86). |
| 4 | Does a verdict cover the current head | **right**: No. Only plan-review's Approve exists, covering the plan, not the code. Names head `f9fa4a80c…`, CI green there, and the summary's older `a98d042c6`. Doesn't mention the rerun. |
| 5 | How many departures on LIN-4445 | **right**: five, all listed and matching the key. The "three beyond what was approved" caveat is extra and doesn't replace the answer. |
| 6 | Do Harbour-written bodies never trip D1 | **right**: No (it didn't hold). The empty fence makes `markdownToAdf` emit an empty `codeBlock`, D1 refuses it, the fixed point fails, and the PR fixes it in the codec. Doesn't raise the Done-when "D1 guard unchanged" judgment. |

## Totals

- **Reader H:** 5 right, 1 partly, 0 wrong, 0 can't tell.
