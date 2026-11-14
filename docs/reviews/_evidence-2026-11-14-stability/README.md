# Evidence: Stability Review run 7 (2026-11-14)

Report: `docs/reviews/stability-review-2026-11-14.md`. Pins: LV base `163efc069` (run 6's head), head `fb358dbda`; SD `af9b496` → `7d5fe7d`.

| file | what it is |
|---|---|
| `reading.json` | The full committed-tool reading, `scripts/stability-measures.mjs . 163efc069 fb358dbda --runner ../simple-dispatcher --reference docs/reviews/stability-measures/reference-2026-11-08.json`, with `HARBOUR_LOCAL_BASE` set. `window.head` = `fb358dbda7f26ab44b3f58acb15886b21ac20950`. |
| `table.txt` | The opening table from the same run, printed as the tool wrote it. |
| `subwindow-pre-v4.json` / `.txt` | Git and `gh` rows only (`HARBOUR_LOCAL_BASE` unset), `163efc069..4b5001ddf` (4 landings, before North star v4). |
| `subwindow-post-v4.json` / `.txt` | Git and `gh` rows only, `4b5001ddf..fb358dbda` (29 landings, after North star v4). |
| `landings-churn.tsv` | One row per window landing: production added and deleted (plain and `-w`), docs churn, docs/areas touch, file count, tidy-programme attribution, subject. |
| `cost-per-task-raw.json` | `GET /issues/{id}/cost` responses for the 25 finished tasks in the `cost` row (`workerSessions` used for stage-kind sums). |
| `analysis-notes.md` | Every ad hoc read behind the report's tables: reproduction of the tool's churn, whitespace share, sub-windows, programmes, file sizes, rebuild filter, test counts, CI listing reproduction, cost by stage kind, and other reads. |

The measuring tool is the committed one and was not changed. The ad hoc reads are one-liners, recorded with their outputs in `analysis-notes.md`.
