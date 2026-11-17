# Grade: LIN-4450, review stage, as of 2026-11-13T15:12:24Z

Read: `key.md`, `answers-T.md`, `answers-S.md`.

| # | Question | Reader T | Reader S |
|---|----------|----------|----------|
| 1 | What is addressed to this stage | **partly**: names PR #2421 at head `f9fa4a80c`, checked against the ask and the LIN-4445 departures, plus "Merge is for review and the orchestrator". Misses the out-of-plan `Retires:` extra (`isHermeticTestToken`) that was handed over for checking. | **partly**: names PR #2421 at the right head and the "Merge is for review" line. Doesn't say to review it against `## As asked` or the departures, and misses the `Retires:` extra. Its "nothing addressed by name" adds nothing on what the stage must act on. |
| 2 | What is open, and whose | **right**: has all four key items: review/merge (review, then orchestrator), the LIN-4452 live check needing John's credential, LIN-4451 blocked on merge, and bulk reads as a `providers.md` note with no ticket. A small gap: it doesn't say the createIssue size guard is LIN-4451's job. | **partly**: has the live check (as John's check-69, not LIN-4452), the PR (but "no owner set" where the key says review and orchestrator), and LIN-4451 blocked on merge. Misses the bulk-reads Waiting entry. Lists extra store findings (79, 80, 89) that the key doesn't count as open items. |
| 3 | Is 32,768 characters still the rule | **right**: No. It's 32,768 UTF-8 bytes of the serialized property, JSON escaping included (departure 2). | **right**: No. Same bytes rule, which decision-86 records and departure 2 matches. |
| 4 | Does a verdict cover the current head | **right**: No. Only the plan-review approval exists. Head `f9fa4a80…`, CI green there with one rerun, and the summary cited the older `a98d042c6`. | **right**: No. Only the plan-review verdicts 57–59 exist. Same head, CI and `a98d042c6` points. It correctly leaves out the 15:32 merge because that came after the moment. |
| 5 | How many departures on LIN-4445 | **right**: five, numbered 1–5. The "strictly four" caveat is extra and doesn't replace the answer. | **right**: five, all listed and matching the key. The "only 1–3 true" caveat is extra and doesn't replace the answer. |
| 6 | Do Harbour-written bodies never trip D1 | **right**: No. The empty fence makes `markdownToAdf` emit an empty `codeBlock`, D1 refuses it, and the fixed point fails. The PR fixes it in the codec. Doesn't raise the Done-when "D1 guard unchanged" judgment. | **right**: No. Same empty-fence case, with the fix in the open, unmerged PR. Also doesn't raise the Done-when judgment. |

## Totals

- **Reader T:** 5 right, 1 partly, 0 wrong, 0 can't tell.
- **Reader S:** 4 right, 2 partly, 0 wrong, 0 can't tell.
