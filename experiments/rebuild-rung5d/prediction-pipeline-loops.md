# Rung 5d: design-first rebuild of lib/pipeline-loops.js, prediction (written before launch)

**Baseline** (`f4749b91`, kit `shape.mjs`): 800 code lines, 388 decision points; worst functions `_buildLoops` 113 and `_buildSessions` 76. Pure apart from `_fetchWorkspaceData`. The ticket says "This is one PR. Don't split it into child tickets."

**Run**
- Harbour doesn't split it: about 80%.
- Merges: about 80%. Done without a ruling: about 50%.
- 50–120 minutes.

**Result**
- 560–720 code lines (a 10–30% cut).
- Decision points down 20–35%. Worst function at most 40: about 60%.
- The redaction census pin (`timed`, `redigestHistoryRows` read sites) is kept as written: about 90%.
- My replay (3,795 inputs, 100% line coverage of the old file) finds no regression: about 70%. If one ships, it's most likely in the odd edges (anchor issues, null-timestamp ties, `horizon:'all'` with epoch-0 times).
