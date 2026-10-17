# Rung 6b: design-first rebuild of lib/kpi-stats.js, prediction (written before launch)

**Baseline** (`1f8010a0`, kit `shape.mjs`): 598 code lines, 47 functions, cyclomatic total 200, worst `collectKpiStats` 77. It's the privacy boundary of the public `/kpis` page. One source-text test (`lifetime-retention-contract-drift`, the `workspacesBasis` wording); `lin3014-capture-kpis` pins read shapes. The ticket carries the efficiency and comment-retention wording.

**Run**
- Not split: about 85%. Merges: about 80%. Done without a ruling: about 50%.
- 45–110 minutes.

**Result**
- 480–580 code lines (a 3–20% cut). The aggregation pipelines are long and distinct, so there's little to share.
- Worst function at most 30: about 70%. `collectKpiStats` is a long list of independent collectors.
- My replay (3,192 inputs, real in-memory aggregation, a canary privacy scan) finds 0 privacy leaks: about 95%. No value regression: about 65%. If one ships, it's most likely in window boundaries (midnight vs rolling 30 days) or in pipeline arguments rewritten into an equivalent form, which the replay reports as a store-call difference and I'd then judge.
