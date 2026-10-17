# Rung 6a: design-first rebuild of lib/task-page-loader.js, prediction (written before launch)

**Baseline** (`1f8010a0`, kit `shape.mjs`): 441 code lines, 56 functions, cyclomatic total 344, worst `buildTaskPageModel` 77. No source-text tests read the file. The ticket carries the efficiency wording (no forks, targeted tests while iterating, e2e left to CI, a lighter worker replay) and the comment-retention rule.

**Run**
- Not split: about 85%. Merges: about 85%. Done without a ruling: about 55%.
- 45–100 minutes.

**Result**
- 330–420 code lines (a 5–25% cut).
- Worst function at most 30: about 65%. Decision points down 20–35%.
- My replay (4,490 inputs, 100% line and block coverage) finds no regression: about 70%. If one ships, it's most likely in the odd edges (`constructor`/`__proto__` stage labels, PR #0, `fmtWhen(0)`, the reject-vs-unavailable split).
- Ticket references kept: at least 90%.
