# Grade: LIN-4450, review stage, as of 2026-11-13T15:12:24Z

Read: `key.md`, `answers-T.md`, `answers-S.md` only.

| # | Reader T (ticket) | Reader S (store) |
|---|---|---|
| 1. Addressed to this stage | **partly**: names PR #2421 at head `f9fa4a80c`, the As-asked items and the LIN-4445 departures, but leaves out the out-of-plan `Retires:` extra (`isHermeticTestToken`) that was handed over for checking. | **partly**: names PR #2421 at head `f9fa4a80c`, left for review, but leaves out both handed-over items: the five departures and the `Retires:` extra. |
| 2. Still open, and whose | **right**: all four items with the right owners: PR review and merge, the LIN-4452 live check, LIN-4451 blocked on merge, and the bulk-reads note with no ticket. The extra can't-tell line does no harm. | **right**: all four items: change-84 for review and merge, the live check (check-69 to John, finding-89 to task-62), LIN-4451 blocked (finding-88), and the bulk-reads Waiting entry (finding-91). The extra area-level findings are marked as beyond this task. |
| 3. 32,768 still the rule? | **right**: no; it is now 32,768 UTF-8 bytes of the serialized property, JSON escaping included (departure 2). | **right**: no; the same bytes rule (decision-86 / departure 2). |
| 4. Approval covers the current head? | **right**: no verdict on the code, only the rev 1 plan approval. Names head `f9fa4a80c`, CI green after one rerun, and the summary's older `a98d042c6`. | **right**: no verdict covers change-84, only plan approvals. Names head `f9fa4a80c`, CI green after one rerun, and the earlier `a98d042c6`. |
| 5. Departures recorded on LIN-4445 | **right**: five, numbered 1–5. The "strictly four" aside is extra and does not replace the answer. | **wrong**: says 3 (digest, bytes, throw). Misses departure 4 (the empty-fence codec fix) and departure 5 (every `getIssue` asks for the property). |
| 6. "Never trips D1" holds? | **right**: no. Gives the empty-fence case (an empty `codeBlock` refused by D1), says the earlier probes missed it, and that the PR fixes it in the codec. Does not raise the Done-when "D1 guard unchanged" check. | **right**: no. Gives the empty-fence case, the decision to fix the codec first, and the fix in PR #2421. Also does not raise the Done-when check. |

## Totals

- **Reader T:** 5 right, 1 partly, 0 wrong, 0 can't tell.
- **Reader S:** 4 right, 1 partly, 1 wrong, 0 can't tell.
