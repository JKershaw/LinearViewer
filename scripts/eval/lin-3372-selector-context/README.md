# LIN-3372: what the stage selector is given, and what decides its choice

Research evidence for the LIN-3372 paper. Nothing here is wired into production. Grounded at
`main` `a3b946a5`. Router model `openai/gpt-5.6-sol` (the workspace's `recommend` setting),
temperature 0, the same request body `getRecommendation` sends.

## What it does

`harness.mjs` rebuilds the selector's exact routing prompt for a ticket **as it stood at a past
moment**:

- comments with `createdAt` at or before the cut-off;
- the task's runs from the dispatch record, cut at the same moment (a run that had posted
  `[blocked]` by then reads `waiting on a person`, one still going reads `running`);
- the description, state and child states from the **task-history snapshot** taken at the next
  dispatch (`GET /issues/:id/snapshots`), so the description is the one the selector saw, not
  today's. The parent's description comes from its own latest snapshot before the cut-off.

It then calls the router model and parses the reply with the production `routeStage`.
`selectorArgs` is `buildSelectorArgs` line for line plus ablation knobs; with no knobs the
prompt is byte-identical to the library's (checked for every point).

`points.mjs` is the 8 Oct decision points named in LIN-3372, timed from comment and dispatch
timestamps. `gold` is what the Flight Companion then dispatched.

## Scripts

| script | what |
|---|---|
| `sizes.mjs` | per-part byte sizes of each decision point's prompt; writes `prompts/` (git-ignored) |
| `replay.mjs <variant> <K> [ids]` | replays points through the harness's `selectorArgs` with an ablation |
| `fixreplay.mjs <label> <K> [ids]` | replays points through the library's own `buildSelectorArgs`; run with `LV=<worktree>` and `FIX=` |
| `corpus-sizes.mjs` | per-part sizes over the 92-fixture routing corpus (`jev-routing-eval.mjs` `loadCases`) |
| `corpus-ablate.mjs <K> <variants…>` | the 92-fixture corpus under ablations, graded by the eval's own gold and `gradeAnswer` |
| `fixes-experiment.patch` | the candidate fixes, each behind `FIX=<letter>`; with `FIX` unset the prompt snapshots pass unchanged |

Proxy reads are cached in `.cache/` (git-ignored). Set `HARBOUR_LOCAL_BASE`, or `PROXY_BASE` and
`PROXY_TOKEN`, to fill it; set `OPENROUTER_API_KEY` for model calls.

The gate run is the existing harness on a worktree with the patch applied:

```sh
git worktree add --detach ../wt a3b946a5 && cd ../wt && git apply <this dir>/fixes-experiment.patch
FIX=        ARMS=3 K=3 MODEL=openai/gpt-5.6-sol OUT_DIR=/tmp/eval-main node scripts/eval/jev-routing-eval.mjs
FIX=b,c,d,e ARMS=3 K=3 MODEL=openai/gpt-5.6-sol OUT_DIR=/tmp/eval-fix  node scripts/eval/jev-routing-eval.mjs
```

## Raw outputs

`runs/<variant>.json` (decision points) and `corpus/*.json` (corpus ablations): one row per
call, with the stage, the `Why now` line, cost and prompt length. `runs/fix-<label>.json` came
from `fixreplay.mjs` with `FIX=<label>` (`none`/`none2` = toggles off, the main arm).

`gate/` holds the gate's own `results.json` and `report.md`, one folder per run:

| folder | FIX | what |
|---|---|---|
| `main`, `fix` | none / `b,c,d,e` | gate run 1, concurrent |
| `main2`, `fix2` | none / `b,c,d,g` | gate run 2, concurrent |
| `main-rerun`, `fix-rerun` | none / `b,c,d,e` | the four fixtures run 1 moved, K=6 |
| `iso-none`, `iso-b`, `iso-e` | none / `b` / `e` | HAR-697 and SYN-15, K=9, concurrent |
| `iso-f`, `iso-g` | `f` / `g` | the same two fixtures, K=9 (run later, no concurrent main) |

The fix toggles in `fixes-experiment.patch`: **a** plan facts on nodes; **b** `defer`'s "Not
when" names `plan-review` when the task's own plan is due one; **c** a leaf with no plan reads
its parent's plan; **d** an approving review's ledger reads "left for close-out to discharge";
**e** `retrospective-audit` withheld from the options when the task is not terminal; **f** a
"Task Done" fact; **g** `retrospective-audit`'s "Not when" adds "merged but not Done
(`close-out`)". The recommended set is b, c, d, g.

The first 72 rows of `runs/base.json` predate the harness reading `[blocked]` runs: in them
P12 shows LIN-3356's 18:45 close-out as `running`, not `waiting on a person`. Every later row,
and every other file, reads it correctly.
