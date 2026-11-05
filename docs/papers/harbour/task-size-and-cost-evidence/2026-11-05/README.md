# Evidence for "How does the size of a task relate to its cost?" (LIN-4257)

Frozen on 2026-11-05. Every number in `task-size-and-cost.md` comes from this folder.
The analysis reads these files only; it makes no network call and no git call.

- `manifest.json`: window, population rule, candidate count, repo heads, and the read time of every file.
- `dispatch/`, `cost/`, `issue/`, `prompts/`: raw workspace-API answers (`GET /dispatch?issueIdentifier=`, `/issues/{id}/cost`, `/issues/{id}`, `/dispatch/{id}/prompt` for each custom follow-up). Each file's read time is in the manifest.
- `pairs/`: the natural-experiment tickets re-read last, with their own manifest (its own read times).
- `size/`: the size counters' raw output, each with its read time:
  - `lv-prs.json` (`coherence-census.mjs prs`, LinearViewer);
  - `sd-prs.json` (`size-prs-repo-neutral.mjs`, simple-dispatcher);
  - `lv-place-change.json` (`place-change.mjs` on every LinearViewer merge since 4 Nov);
  - `survey-balance.json` (the Survey ledger's balance column, read in place);
  - `survey-costmix-tokens.json` (`survey-costmix-tokens.mjs --since 2026-11-04T05:00:00Z`).
- `analysis.json`: the derived tables, the strata, and the self-check results.

Re-run (LinearViewer root; the freeze needs `HARBOUR_LOCAL_BASE`, the analysis does not):

```
node docs/papers/harbour/task-size-and-cost-scripts/freeze.mjs docs/papers/harbour/task-size-and-cost-evidence/2026-11-05
node docs/papers/harbour/task-size-and-cost-scripts/freeze.mjs docs/papers/harbour/task-size-and-cost-evidence/2026-11-05 --pairs
REPO=$PWD node docs/papers/harbour/coherence-as-it-grows-scripts/coherence-census.mjs prs origin/main --json > docs/papers/harbour/task-size-and-cost-evidence/2026-11-05/size/lv-prs.json
REPO=$PWD/../simple-dispatcher node docs/papers/harbour/task-size-and-cost-scripts/size-prs-repo-neutral.mjs origin/main > docs/papers/harbour/task-size-and-cost-evidence/2026-11-05/size/sd-prs.json
node docs/papers/harbour/task-size-and-cost-scripts/size-place-change.mjs docs/papers/harbour/task-size-and-cost-evidence/2026-11-05/size/lv-prs.json > docs/papers/harbour/task-size-and-cost-evidence/2026-11-05/size/lv-place-change.json
node docs/papers/harbour/task-size-and-cost-scripts/size-survey-balance.mjs > docs/papers/harbour/task-size-and-cost-evidence/2026-11-05/size/survey-balance.json
node scripts/survey-costmix-tokens.mjs --since 2026-11-04T05:00:00Z --until <read time> --out docs/papers/harbour/task-size-and-cost-evidence/2026-11-05/size/survey-costmix-tokens.json
node docs/papers/harbour/task-size-and-cost-scripts/analyse.mjs docs/papers/harbour/task-size-and-cost-evidence/2026-11-05
```

The analysis is byte-identical on re-run from this folder with the network unavailable. Re-running the freeze writes new read times and can change the answers. A re-run therefore goes into a new dated folder, and the paper cites the folder it used. The commands above write into the folder named, so change the folder name before re-running.
