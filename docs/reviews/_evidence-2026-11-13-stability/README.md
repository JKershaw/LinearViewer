# Evidence: Stability Review, run 6 (LIN-4442), 2026-11-13

Report: `docs/reviews/stability-review-2026-11-13.md`. Delta vs run 5 (`docs/reviews/stability-review-2026-11-08.md`).

## Pins (recorded at measurement)

| repo | base | head (origin/main when measured) | landings |
|---|---|---|---|
| LinearViewer | `9574d5371cd78a4ce0ab98bc5278706eb4e1bc6f` (run 5's head pin, as the declaration fixes it) | `163efc0698934c3e8a5f3c30e48dc15b51ac3a24` | 35 first-parent |
| simple-dispatcher | `5d8489e7fd8434f0e69af7df11a3746790abbe64` (run 5's SD pin) | `af9b496d57f042972b912a30eb8c4d1164bbab77` | 3 first-parent |

`reading.json` → `window.head` carries the LV head. Landings that merge after `163efc069` belong to the next review.

## No measuring scripts

As `docs/reviews/stability-measures/README.md` declares, this folder holds **no measuring script**. Every number in the
report comes from one of three places:

1. the committed tool `scripts/stability-measures.mjs`, run exactly as declared (the opening) and over four sub-windows;
2. the single-line `git` / `gh` / proxy commands in `oneliners.txt`, each printed with its output, in the order run;
3. `jq` over `reading.json`, also in `oneliners.txt`.

Run 5's `measure_*.py`, `rewrites.py` and `surfaces.sh` stay in `_evidence-2026-11-08-stability/` as frozen evidence.
They were read for their path lists, never re-run.

## Files

| file | what | made by |
|---|---|---|
| `reading.json` | the full declared reading `9574d537..HEAD`, all five measures | `node scripts/stability-measures.mjs . 9574d537 HEAD --runner ../simple-dispatcher --reference docs/reviews/stability-measures/reference-2026-11-08.json > reading.json 2> table.txt`, run from the LV root with `HARBOUR_LOCAL_BASE` set and SD beside it at `af9b496` |
| `table.txt` | the opening table from the same run, printed verbatim in the report | same command (stderr) |
| `subwindow-pre-ci-break.{json,txt}` | `9574d537..eb14b7fff`: up to PR #2413, the last landing before the parallel unit arm | the same tool with `HARBOUR_LOCAL_BASE` unset (git and `gh` rows only; tracker rows print `not measured`) |
| `subwindow-post-ci-break.{json,txt}` | `eb14b7fff..163efc069`: PR #2414 (LIN-4441) onward | same |
| `subwindow-pre-lin4414.{json,txt}` | `9574d537..b349c219b`: up to LIN-4414's one-retirement-per-build rule | same |
| `subwindow-post-lin4414.{json,txt}` | `b349c219b..163efc069`: after it | same |
| `ci-main-runs-2026-11-13.json` | the last 120 `test.yml` runs on `main` | `gh run list --workflow test.yml --branch main --limit 120 --json databaseId,headSha,status,conclusion,createdAt,startedAt,updatedAt,event` |
| `oneliners.txt` | every other command and its output: landings and their day split, the landing list with PR titles, path-surface touches, hot files, the prompt-contract set, file sizes, blob bytes, CI per-job durations, runtime test counts from unit logs, PR creation dates (both repos), SD history, rewrite events, ceiling raises, ticket states, and `jq` over `reading.json` | hand-run, appended as run |

## Definitions kept apart

- `ci` in the opening is `ciRow`'s: successful `test.yml` runs on `main` whose head sha is a window landing, `updatedAt −
  startedAt`. `scripts/measure-ci-wall.mjs` (LIN-4441) uses `createdAt` and includes queue time. None of its numbers are used.
- Per-job durations in `oneliners.txt` are `completedAt − startedAt` per job (`gh run view --json jobs`), used only to name
  the critical path, never as a `ci` value.
- Rewrite-in-place events are read with a one-line `git` filter (≥50% of a file's prior lines deleted in one landing; JSON
  and `_evidence` excluded). That approximates run 4/5's `rewrites.py` rule over all non-JSON paths; it is not the same script.
