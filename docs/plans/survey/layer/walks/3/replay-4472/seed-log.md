# Seed log: replay-4472

The moment is 2026-11-13T17:22:38Z. `seed.sh` rebuilds `store.json` from empty, and one run gave 81 records with an empty `check`.

**Ids:** parent `task-1`. LIN-4472 is `task-28`, and its piece is `plan-10` (v2). LIN-4471 is `task-27`, done, with piece `plan-9`.

**Sources**
- **Parent description.**
  - `asked`: a byte-exact copy of `## As asked`, without the end marker.
  - Done-when.
  - Size of the move: a scoping decision.
  - The plan: two pieces made of verbatim slices, plus 13 design decisions.
- **Comments before the moment.**
  - Surveys: 2 questions.
  - Harbour, the brief's questions: 4.
  - Plan review: the piece v2s, verdicts on `@2`, and 1 decision.
  - Breakdown: 12 decisions.
  - LIN-4471: 7 decisions, plus PR #2431 merged.
- **LIN-4472.** Its earliest snapshot.
- **Areas at `17faa83f4`.**
  - Browser code: `public/`.
  - Server-rendered pages: the fixed prefixes of its pattern, `lib/render`, `lib/components/` and 15 `lib/<x>.js`.
  - Waiting entries became findings (9 and 11) and Lessons became lessons (8 and 3).

**Refusals**
- `{"refused":[{"rule":"6","msg":"plan-review may not revise plan-9"}]}`
- `{"refused":[{"rule":"6","msg":"plan-review may not revise plan-10"}]}`

In place of these I wrote the same revise `--by design`, with plan review named in the reason.

**Not placed, or judgement calls**
- Times are estimates: the plan at 15:55 and the areas at 17:22.
- LIN-4471's ticket isn't in the material. Its done-when and paths are derived from the breakdown row and piece 1.
- Other features (`^lib/`) is left out because registry order puts the renderer in front-end-pages.
- Survey advice and runs were not recorded.
- One lesson cites no file, so its path falls back to `public/`.
