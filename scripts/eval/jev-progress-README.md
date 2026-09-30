# LIN-3169 — Jev progress-estimation eval (fuzzy progress bar)

Research-only. Standalone under `scripts/eval/`; nothing here is wired into `lib/`. Findings:
[`jev-progress-out/report.md`](jev-progress-out/report.md); every config's metrics:
[`jev-progress-out/summary.json`](jev-progress-out/summary.json). Feature ticket: LIN-3169.

## Question

Can TypeSafe's Jev (`typesafe/jev-1.13`, OpenRouter's alpha decisions endpoint; see
`docs/papers/harbour/jev-decision-model.md`) turn a task's current state into a calibrated
10-band curve over "how far through is this task", cheaply enough to show on every task row?

## Method

| | |
|---|---|
| Population | Completed tasks with 3–12 agent **work** sessions (autopilot/wake driver sessions excluded), from dispatch telemetry (`GET /api/proxy/issues/{id}/cost` → `workerSessions`). Telemetry starts ~late Aug 2026, so this is Sept 2026: 207 tasks. |
| Snapshots | Each task frozen just before work session k+1 of N (comments cut at that session's `dispatchedAt`). Round 1a used k ≈ 25/50/75% of N (586 snapshots); everything after uses every boundary k = 1…N−1 (1,045), which removes the lookup's advantage from the fixed sampling points. |
| Truth | k/N, the share of the task's work sessions already run. A proxy for share of *work* done. |
| Split | dev/test by a hash of the identifier: dev 97 tasks / 477 snapshots (all exploration and tuning), test 110 tasks / 568 snapshots (finalists locked first, then scored once). |
| Leak scrub | Descriptions are *today's* version; close-outs append `## Shipped`, merge commits and completion stubs. `scrub()` drops those sections and paragraphs and un-ticks `[x]`, so a snapshot is not shown its own ending. |
| Metrics | RPS (ranked probability score over the 10 bands, lower is better, scores the whole curve), MAE/bias of the curve mean (points), Spearman, within-task ordering, 80%-interval coverage. |
| Baselines | constant 50%, uniform, a hand rule on the last session kind, and the **lookup**: the empirical k/N histogram of *other* dev tasks with the same (last session kind, k), i.e. the best no-model predictor from the same metadata. |

A config is `view:question`. Views (`VIEWS` in `jev-progress-eval.mjs`) range from title-only through
metadata ladders to full context; questions (`QUESTIONS`) ask "what % is done" (`stage`, `neutral`,
`score`, `scorestage`, `cdf`) or "how many MORE work sessions" (`rem`, `rem2`), the latter mapped to
band `floor(10·k/(k+r))`. `jev-progress-analyze.mjs` adds offline temperature widening
(`p^(1/T)`), ensembles and the drift test.

## Artifacts

| file | role |
|---|---|
| `jev-progress-eval.mjs` | fetch (proxy), snapshot build + scrub, views, questions, Jev transport, results cache, metrics, report |
| `jev-progress-analyze.mjs` | `calibrate` (T + ensembles, dev), `final` (locked finalists on test + paired bootstrap), `drift-prep` / `drift` (weekly norms), `summary` |
| `jev-progress.test.mjs` | pure-function tests (scrub, answer→band mapping, RPS, norms), no network |
| `jev-progress-out/report.md` | findings, round by round |
| `jev-progress-out/summary.json` | metrics for every config and baseline; no task text, no raw answers |

The caches (issue bodies, snapshots, the ~35k raw Jev answers) live in `data/jev-progress/`
(git-ignored: live task text, and exploration output that is not repository material).

## Run

```sh
export HARBOUR_PROXY_TOKEN=…   # read-scoped workspace proxy token
export OPENROUTER_API_KEY=…
node scripts/eval/jev-progress-eval.mjs fetch                      # issues + session histories (~7 min, 60 req/min)
ALLK=1 node scripts/eval/jev-progress-eval.mjs build               # every-boundary snapshots (fetches issue bodies)
ALLK=1 SPLIT=dev CONFIGS=rawnf:rem2,tm:score CONC=12 node scripts/eval/jev-progress-eval.mjs run
ALLK=1 SPLIT=dev node scripts/eval/jev-progress-eval.mjs report     # COMBO=1 adds "+ lookup" ensembles
ALLK=1 node scripts/eval/jev-progress-analyze.mjs calibrate
ALLK=1 SPLIT=test CONFIGS=rawnf:rem2,tmnfl2c:rem2,tmnf:rem2,rawsess:stage node scripts/eval/jev-progress-eval.mjs run
ALLK=1 node scripts/eval/jev-progress-analyze.mjs final
node scripts/eval/jev-progress-analyze.mjs drift-prep
SNAPF=snapshots-drift.json SPLIT=drift CONFIGS=rawnfRoll:rem2,rawnfFrozen:rem2,rawnfOracle:rem2 node scripts/eval/jev-progress-eval.mjs run
node scripts/eval/jev-progress-analyze.mjs drift
node scripts/eval/jev-progress-analyze.mjs summary
node --test scripts/eval/jev-progress.test.mjs
```

A re-fetch reads the workspace as it is *now*: new tasks, edited descriptions and more telemetry
move the numbers, so compare a re-run against `summary.json` as a trend, not byte-for-byte.
Cost: `rawnf:rem2` is ~$0.0004/call; `cdf` bills its nine questions separately (~9×).

## Limitations

- Truth is the share of sessions, not of work; one workspace, one month, tasks with 3–12 sessions.
- The scrub is heuristic; plans written mid-task can still sit in an early snapshot's description.
- The `NORMS` sentence is the dev split's `computeNorms` output, frozen as the text every tuned
  config saw; the drift test recomputes it per week.
- Temperature and norms were tuned on dev only; the drift test is on Sept weeks 2–4.
