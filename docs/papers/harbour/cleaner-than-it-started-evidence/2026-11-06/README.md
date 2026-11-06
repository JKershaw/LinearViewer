# Evidence for "Can a task finish with the codebase cleaner than it started?" (LIN-4315)

Frozen 2026-11-06 (the freeze finished at `manifest.json` → `freeze_finished_at`). Every number in
`cleaner-than-it-started.md` is a key in `analysis.json`, with its n. The analysis reads this folder
alone: no network call, no git call.

Grounded at LinearViewer `1d10f9b3` (main, after the notebook sync LIN-4314) and simple-dispatcher
`07c88f7` (main). Rows are first-parent merges from 4 Nov 00:00 UTC to those pins, plus the 3 Nov
baseline rows and the UI context rows the place ledger names. LIN-4254 is in flight at the pin: its
pieces 0 and 1 are merged (LIN-4306, LIN-4307), pieces 2 to 6 are not.

## Files

- `manifest.json`: repo pins, the population rule, the parents, the ledger ids checked against merge
  subjects, and a `read_at` and sha256 for every frozen file.
- `comments/LIN-4150.json`: the blind-read ticket's comments, raw. Read first, because the proxy
  returns at most 50 comments per issue. It returned exactly 50, and the freeze asserted that batches
  A to D (the 42 "Blind place scoring" passes) are inside them.
- `issue/`, `cost/` (`?perDispatch=true`), `dispatch/`: raw workspace-API answers for every ticket
  named in a population merge subject, plus the parents.
- `prompts/`: the 73 custom (after-answer) prompts dispatched since 4 Nov, raw.
- `git/merges-LinearViewer.tsv`, `git/merges-simple-dispatcher.tsv`, `git/merges-LinearViewer-2026-11-02-03.tsv`:
  the first-parent merge lists at the pins.
- `git/place-ledger.at-pin.snapshot`: the place ledger at `1d10f9b3`, read in place.
- `git/population.txt`: the ticket ids frozen.
- `git/census-by-merge.json`: the HAND_WRITTEN_FAKE_DOM_FILES list read at every LinearViewer merge in
  the window (`git show <merge>:tests/unit/fake-dom-census.test.js`), with its `// stop:` entries.
  Before LIN-4265 (`69e8f1754`) the file does not exist, so no count is recorded there.
- `blind-codes.json`: one entry per blind pass (42) and per scored row (94). Each row's sign is the
  pass's own Balance cell, copied verbatim with the bold markers removed, and its reason cell is kept
  beside it. `code-blind.mjs` does the copying; no sign was re-judged. The scoring map is written in
  the file: better +1, neutral 0, mixed 0, worse -1.
- `roles.json`: the one hand-written input. It gives each merge's role (place, baseline, outside the
  ledger, Periodical, parent and so on), its group, the tidy-after pairs, and the ticket the blind
  read names as unsurveyed. Its roles follow the research comment's C1 membership on LIN-4315. A merge
  with no role is reported in `analysis.json` as unclassified; there are none.
- `evidence-table.tsv`: one row per merge (90 rows, 82 in the window and 8 outside it). Columns:
  repo, sha, date, PR, ticket, role, group, Survey location, scope call, the two batch signs, area
  reads, the ledger's balance history (history only, never an input), Periodical coverage, census
  count, cost and its state, after-answer, and code-or-notebook notes.
- `analysis.json`: every derived number, with its n, and the sha256 of each hand-written or derived
  input it reads.

## Re-run

From the LinearViewer root (the freeze needs `HARBOUR_LOCAL_BASE`; the rest does not):

```
node docs/papers/harbour/cleaner-than-it-started-scripts/freeze.mjs docs/papers/harbour/cleaner-than-it-started-evidence/<new-date>
node docs/papers/harbour/cleaner-than-it-started-scripts/census-by-merge.mjs docs/papers/harbour/cleaner-than-it-started-evidence/<new-date>
node docs/papers/harbour/cleaner-than-it-started-scripts/code-blind.mjs docs/papers/harbour/cleaner-than-it-started-evidence/<new-date>
node docs/papers/harbour/cleaner-than-it-started-scripts/analyse.mjs docs/papers/harbour/cleaner-than-it-started-evidence/<new-date>
```

`roles.json` must be copied into the new folder by hand (it is an input, not a frozen answer). The
analysis is byte-identical on re-run from this folder with the network unavailable (checked). A
re-run from a live API writes new read times, so it goes into a new dated folder and the paper cites
the folder it used.

## What the folder cannot show

- The blind-read prompt is not in the repository and not reachable through the API. The paper says
  so; `blind-codes.json` records only what each pass wrote.
- The proxy's comment cap is 50. LIN-4150's Surveys from 2 to 4 Nov are beyond it and are not in this
  folder. For the 4 Nov forward rows, the Surveys the ledger calls "surveyed" are visible only in the
  notebook's log narration, not on the tickets or on LIN-4150.
- Cost is live. A parent's cost excludes its children (LIN-4255 is listed on its own, and its 14
  pieces are summed separately).
