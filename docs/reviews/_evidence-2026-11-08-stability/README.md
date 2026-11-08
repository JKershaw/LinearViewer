# Evidence: Stability Review, run 5 (LIN-4394), 2026-11-08

Report: `docs/reviews/stability-review-2026-11-08.md`. Delta vs run 4 (`docs/reviews/stability-review-2026-11-04.md`).

## Pins (recorded at measurement)

| repo | pin | window (delta) | window (rolling) |
|---|---|---|---|
| LinearViewer | `9574d5371cd78a4ce0ab98bc5278706eb4e1bc6f` (origin/main when measured) | `5334c81a7207b9f2cc85ca429a2c6b18e1635c0e..pin` (run 4's pin to this pin; 114 landings, ≈4.45 days) | `f25aa127..pin` (357 landings, ≈18.7 days) |
| simple-dispatcher | `5d8489e7fd8434f0e69af7df11a3746790abbe64` (origin/main when measured) | `67ff5c3b..pin` (20 landings) | `bb1da78..pin` (55 landings) |

The CI series was pulled 2026-11-08 (`gh run list --workflow test.yml --branch main --limit 1000`). The last run in it is
2026-11-08T17:10Z. Figures from CI are over that list; the window medians are computed on `startedAt` dates.

## Files

| file | what | made by |
|---|---|---|
| `measure_lv.py` | run 4's LV measurement script, parameterised: `HEAD` is the pin, `DELTA_BASE` is run 4's pin, a `generated` bucket for `experiments/**/replay/work/`. Run `python3 measure_lv.py <LV repo> <this dir>`. | copied from `_evidence-2026-11-04/measure_lv.py` |
| `lv-measure.json` | output of `measure_lv.py`. Key `window_f25aa127_HEAD_landings` holds the **delta** count (114); `rolling_landings` is the rolling count (357). | `measure_lv.py` |
| `lv-window-landings.tsv` | the 114 delta landings: sha, committer date, subject | `measure_lv.py` |
| `rewrites.py` | run 4's method-8 rewrite rule over any range. `python3 rewrites.py <LV repo> <range> <out.json>` | new (same rule as `measure_lv.py`) |
| `rewrites-run4-window.json` | `f25aa127..5334c81a`: reproduces run 4's **38** events (28 whole-file, 10 in place, 0 repeats) | `rewrites.py` |
| `rewrites-delta.json` | `5334c81a..pin`: 3 events (2 whole-file, 1 in place) | `rewrites.py` |
| `rewrites-rolling.json` | `f25aa127..pin`: 41 events (30 whole-file, 11 in place) | `rewrites.py` |
| `measure_extra.py` | prompt-contract path-set share, review-layer weight, review blob bytes at three commits, SD windows. `python3 measure_extra.py <LV repo> <SD repo> <out.json>` | new |
| `extra-measures-2026-11-08.json` | output of `measure_extra.py` | `measure_extra.py` |
| `surfaces.sh` → `surfaces-2026-11-08.txt` | in-remit surfaces audit: `bash surfaces.sh <LV repo>`. Also: Periodicals, dispatch-store, server.js, prompt-template-defs and prompt-section line counts; test-file and static test-call counts; the Home cluster; `docs/areas`; fixtures; the prompt-size budget test; `routes/proxy.js`; `runner.mjs`; `source-map.md`; `llms.txt`. | new |
| `ci-main-runs-2026-11-08.json` | the 1,000 `test.yml` main runs listed above | `gh run list` |
| `measure_ci.py` | daily and window medians (successful runs, `updatedAt − startedAt`). `python3 measure_ci.py ci-main-runs-2026-11-08.json` | copied from run 4, unchanged |
| `measure_ci_logs.py` → `ci-unit-log-sample-2026-11-08.tsv` | unit-job logs of sampled runs (two per day from 10-01): runner `Region:`, `ℹ tests` and `ℹ duration_ms` per arm. Needs `gh` auth; ~6 minutes. | copied from run 4, unchanged except the output path (passed as argument) |

## Commands not captured in a script (run from the repos, pins as above)

Single-line checks quoted in the report:

```
# SD split, delta (test share), and the run-4 window for comparison
git -C <SD> log --first-parent -m --numstat --no-renames --format='@@C@@%H|%cI|%s' 67ff5c3b..5d8489e7 \
  | awk 'NF==3{ if($3~/^test\//) t+=$1; else if($3~/^(lib|routes|public)\//||$3~/\.js$/) s+=$1 } END{print t,s}'
# SD PRs created per day (gap check); last 60 PRs, all states
gh pr list -R JKershaw/simple-dispatcher --state all --limit 60 --json number,createdAt,mergedAt,state
# Review-layer decomposition by evidence directory (delta)
git -C <LV> log --first-parent -m --numstat --no-renames --format='@@%h' 5334c81a..9574d537 -- docs/reviews \
  | awk '/^@@/{next} NF==3 {split($3,p,"/"); k=(p[3] ~ /^_evidence-/)? p[3] : "(report file)"; a[k]+=$1} END{for(k in a) print a[k], k}' | sort -rn
# Tracker: IDs and mint times quoted in F10 (from the ticket records, not a script)
#   LIN-4206 minted 2026-11-04T07:45:30Z; LIN-4394 minted 2026-11-08T16:20:57.831Z
```

## Measurement limits

- Stagnation denominator: this run's `measure_lv.py` gives 110 candidates / 95 present; run 4 published 106 / 91. The silent sets
  match. Unresolved.
- Unit test-file count: 1,149 at `5334c81a` (run 4 published 1,163). Counting rule not recovered.
- Runtime test counts exist only from 10-23 (earlier logs carry no `ℹ tests` line). 29 sampled logs carry them.
- Runner image and the runner-pool assignment were not sampled.
- Tracker issue list has no timestamps; task age and cycle time are not measured.
- Review-ticket minting actor, production dispatch and session counts: not available.
