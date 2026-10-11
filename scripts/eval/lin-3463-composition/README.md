# LIN-3463 evidence: how a task is composed, and how that shapes the way it runs

Research evidence for the paper LIN-3463 asks for. Nothing here is product code, and nothing
imports it. Read 11 Oct 2026, LinearViewer `origin/main` `15990905`.

## What is here

| Path | What it is |
|---|---|
| `fetch.py` | Pulls every LIN-2440..LIN-3462 ticket through the workspace proxy: issue, `/cost` (dispatch lineages), `/snapshots` (task-history archive) and `/dispatch?issueIdentifier=`. ~1.1 s between calls (60/min cap). |
| `build_table.py` | One row per ticket: description at first dispatch (the earliest snapshot), lineages, kinds, children created after the first dispatch, PRs named in comments. |
| `outcomes.json` | That table without the ticket text: how each ticket ran, plus `auto` text features of its first-dispatch description and the joined PR size. |
| `transcripts.py`, `readorder.py` | Index every dispatched Claude Code session transcript on the runner machine (2,843 headed `# LIN-n · kind`, 29 Aug–11 Oct) and record the order the session read `/brief` and `/issues/:id` for its own ticket. Results: `results/read-order.txt`. |
| `fidelity/` | 60 sessions' brief against the ticket source the same session fetched. `RUBRIC.md` was written before coding. `codes-A-*.json`: primary blind coder; `codes-B-second.json`: second coder on 15. `propagation.json`: for the 27 coded material, whether the difference reached the work. `index.json` maps pairs to tickets and transcripts. |
| `composition/` | 376 tickets' first-dispatch descriptions coded blind to outcome. `RUBRIC.md` written before any join; `map.json` maps the blind ids to tickets; `codes-B-second.json` is the 28-ticket agreement sample. |
| `analyse.py`, `analyse2.py`, `sizebands.py`, `model.py`, `autofeatures.py`, `agreement.py`, `fidelity_summary.py` | The analyses; their outputs are in `results/`. |

## Re-run

Each script takes a working directory holding `data/`, `transcripts.json`, `table.json`,
`prs.json`, `fidelity/` and `composition/`. The raw ticket text, briefs and transcripts are not
committed. They come back from the proxy (`fetch.py`) and from `~/.claude/projects` on the runner
machine.

```sh
W=/tmp/lin-3463; mkdir -p $W/data
python3 -I fetch.py $W/data 2440 3462
python3 -I transcripts.py $W/transcripts.json && python3 -I readorder.py $W/transcripts.json
python3 -I build_table.py $W
git log origin/main --first-parent --since=2026-08-25 --format='%H|%cI|%s' \
  | grep -E 'Merge pull request #[0-9]+|\(#[0-9]+\)$'   # -> prs.json via git diff --numstat
python3 -I autofeatures.py $W && python3 -I analyse.py $W && python3 -I analyse2.py $W
python3 sizebands.py $W && python3 model.py $W   # model.py needs numpy
```

## Known limits of the data

- `/cost` lineages exist only for tickets first dispatched from about 10 Sep (LIN-2800 on). Before
  that the dispatch record has no rows, so the population is LIN-2800..LIN-3462.
- "Description at first dispatch" is the earliest task-history snapshot, which the first session's
  `/brief` read captures; an edit made between filing and the first dispatch is invisible.
- `sessions_total` is the ticket's own lineages plus those of every child created after its first
  dispatch; it matches the counts on LIN-3449 (LIN-3453: 11 + 18 = 29).
